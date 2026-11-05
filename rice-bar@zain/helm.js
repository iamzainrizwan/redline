// [helm #12 14:30] — the block at the far left, where tmux keeps its
// session name: the next unticked floor block from `helm today`. Dark
// normally; red once a floor block's start time has passed and it's still
// unticked (it then names the earliest such block). "helm" + a tick when
// the floor is done. Hover for today's unticked blocks. Click (or Super)
// opens the overview; replaces the Activities button.
//
// Data: ~/vault/helm/cli/helm today --json (the CLI tries both of helm's
// URLs itself), every REFRESH_SECONDS and on hover. If helm can't be
// reached the tag falls back to the hostname. From QUIET_FROM to QUIET_TO
// it never goes red: helm reads every block as unticked after 1am.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {placeUnder} from './util.js';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

const HELM = GLib.getenv('RICE_BAR_HELM') ??
    GLib.build_filenamev([GLib.get_home_dir(), 'vault', 'helm', 'cli', 'helm']);
const REFRESH_SECONDS = 300;
const HOVER_REFRESH_SECONDS = 60; // a hover refetches if the data is older
const QUIET_FROM = 1; // 01:00
const QUIET_TO = 5; // 05:00
const TICK = ''; // nf-fa-check
const TASK_CHARS = 44;

function minutes(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
}

function hours(h) {
    return `${Math.round(h * 10) / 10}`.replace(/\.0$/, '');
}

// The hover card: "today  4/8.3h floor", then one row per unticked block:
// time, #id, project, task. Overdue floor rows red, stretch rows dim.
class HelmCard {
    constructor(button) {
        this._button = button;
        this.actor = new St.BoxLayout({
            style_class: 'rice-helm-card', vertical: true, visible: false,
        });
        Main.layoutManager.addTopChrome(this.actor, {affectsInputRegion: false});
        button.connectObject(
            'notify::hover', () => this.sync(),
            'destroy', () => {
                Main.layoutManager.removeChrome(this.actor);
                this.actor.destroy();
            },
            this);
    }

    set(rows, header) {
        this.actor.destroy_all_children();
        this.actor.add_child(new St.Label({text: header, style_class: 'rice-helm-head'}));
        for (const {at, id, project, task, kind} of rows) {
            const row = new St.BoxLayout({style_class: `rice-helm-row ${kind}`});
            const cell = (text, style) => {
                const label = new St.Label({text, style_class: style});
                label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                row.add_child(label);
            };
            cell(at ?? '--:--', 'rice-helm-at');
            cell(`#${id}`, 'rice-helm-id');
            cell(project, 'rice-helm-project');
            cell(task.length > TASK_CHARS ? `${task.slice(0, TASK_CHARS - 1)}…` : task,
                'rice-helm-task');
            this.actor.add_child(row);
        }
        this.sync();
    }

    sync() {
        if (!this._button.hover || !this.actor.get_n_children()) {
            this.actor.hide();
            return;
        }
        placeUnder(this._button, this.actor);
        this.actor.show();
    }
}

export const Helm = GObject.registerClass(
class Helm extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'helm', true);
        this.add_style_class_name('rice-helm');
        this._label = new St.Label({
            text: GLib.get_host_name(),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._label);
        this._card = new HelmCard(this);
        this._data = null;
        this._fetchedAt = 0;
        this._cancellable = new Gio.Cancellable();

        this.connect('button-press-event', () => {
            Main.overview.toggle();
            return Clutter.EVENT_STOP;
        });
        this.connect('notify::hover', () => {
            if (this.hover && GLib.get_monotonic_time() / 1e6 - this._fetchedAt > HOVER_REFRESH_SECONDS)
                this._fetch();
        });
        // refetch now and then; re-judge "overdue" every 30 s as time passes
        let ticks = 0;
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
            ticks = (ticks + 1) % (REFRESH_SECONDS / 30);
            if (ticks === 0)
                this._fetch();
            else
                this._render();
            return GLib.SOURCE_CONTINUE;
        });
        this.connect('destroy', () => {
            this._cancellable.cancel();
            GLib.source_remove(this._timer);
        });
        this._fetch();
    }

    async _fetch() {
        if (this._fetching)
            return;
        this._fetching = true;
        try {
            const proc = Gio.Subprocess.new([HELM, 'today', '--json'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
            const [stdout] = await proc.communicate_utf8_async(null, this._cancellable);
            if (!proc.get_successful())
                throw new Error(`helm exited ${proc.get_exit_status()}`);
            this._data = JSON.parse(stdout);
            this._fetchedAt = GLib.get_monotonic_time() / 1e6;
        } catch (e) {
            if (this._cancellable.is_cancelled())
                return;
            this._data = null; // stale data would lie about what's done
            console.log(`rice-bar: helm unavailable: ${e.message}`);
        } finally {
            this._fetching = false;
        }
        this._render();
    }

    _render() {
        const plan = this._data?.plan?.[0];
        if (!plan) {
            this._label.text = GLib.get_host_name();
            this.remove_style_class_name('overdue');
            this._card.set([], 'helm unreachable');
            return;
        }
        const now = GLib.DateTime.new_now_local();
        const nowMinutes = now.get_hour() * 60 + now.get_minute();
        const quiet = now.get_hour() >= QUIET_FROM && now.get_hour() < QUIET_TO;

        const open = plan.blocks.filter(b => b.kind !== 'open' && b.done === false);
        const started = b => b.at !== null && minutes(b.at) <= nowMinutes;
        const byTime = (a, b) => minutes(a.at) - minutes(b.at);
        const floor = open.filter(b => b.floor);
        const overdue = quiet ? [] : floor.filter(started).sort(byTime);
        const next = overdue[0] ??
            floor.filter(b => b.at !== null && !started(b)).sort(byTime)[0] ??
            floor.find(b => b.at === null) ??
            floor[0];

        if (next)
            this._label.text = next.at ? `helm #${next.block_id} ${next.at}` : `helm #${next.block_id}`;
        else
            this._label.text = `helm ${TICK}`;
        if (overdue.length)
            this.add_style_class_name('overdue');
        else
            this.remove_style_class_name('overdue');

        // card: timed blocks in time order, then untimed; floor before stretch
        const order = b => (b.floor ? 0 : 2) + (b.at === null ? 1 : 0);
        const rows = [...open]
            .sort((a, b) => order(a) - order(b) || (a.at && b.at ? byTime(a, b) : 0))
            .map(b => ({
                at: b.at, id: b.block_id, project: b.project, task: b.task,
                kind: !b.floor ? 'stretch' : overdue.includes(b) ? 'overdue' : 'floor',
            }));
        const header = `today  ${hours(plan.floor_done_hours)}/${hours(plan.floor_hours)}h floor` +
            (open.length ? '' : `  ${TICK}`);
        this._card.set(rows, header);
    }
});
