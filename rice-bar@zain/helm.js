// [helm 14:30 leetcode] — the block at the far left, where tmux keeps its
// session name: what to do next, from `helm missed`. Red when a floor
// block is missed (unticked and its time has started, or untimed):
// it names the first, which helm's own ranking (uni > cybersoc > leetcode
// > c++ > applications > s3ntry/ledgr, floor before stretch) puts first.
// Dark when nothing is missed: it names the next block to start. "helm" +
// a tick when the day's blocks are all done. Hover for the list. Click (or
// Super) opens the overview; replaces the Activities button.
//
// Data: ~/vault/helm/cli/helm missed --all --json, every REFRESH_SECONDS
// and on hover; --all adds the blocks that haven't started, and "started"
// is judged here the way helm judges it (untimed counts; an earlier day
// has all started). Until DAY_STARTS (05:00) the bar asks for yesterday
// by date, an hour past helm's own 04:00 rollover. The order is helm's; it's
// never re-sorted here. If the CLI fails it's retried with HELM_URL set to
// FALLBACK_URL, and if that fails too the tag falls back to the hostname.
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
const FALLBACK_URL = 'http://alexandria/helm/api';
const REFRESH_SECONDS = 300;
const HOVER_REFRESH_SECONDS = 60; // a hover refetches if the data is older
const TICK = ''; // nf-fa-check
const DAY_STARTS = 5; // the bar's day rolls over at 05:00
const TASK_CHARS = 44;

function hours(h) {
    return `${Math.round(h * 10) / 10}`.replace(/\.0$/, '');
}

// the day the bar shows: yesterday until DAY_STARTS
function helmDay() {
    const now = GLib.DateTime.new_now_local();
    return (now.get_hour() < DAY_STARTS ? now.add_days(-1) : now).format('%Y-%m-%d');
}

async function runHelm(env = {}) {
    const launcher = new Gio.SubprocessLauncher({
        flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
    });
    for (const [key, value] of Object.entries(env))
        launcher.setenv(key, value, true);
    const proc = launcher.spawnv([HELM, 'missed', helmDay(), '--all', '--json']);
    const [stdout] = await proc.communicate_utf8_async(null, null);
    if (!proc.get_successful())
        throw new Error(`helm exited ${proc.get_exit_status()}`);
    return JSON.parse(stdout);
}

// The hover card: "missed 5 · 5.8h (4.3h floor)", then helm's tiers in its
// order, one row per block: time, #id, project, task (the LeetCode problem
// for a LeetCode slot). Missed floor rows red, stretch rows dim, blocks
// still to come plain.
class HelmCard {
    constructor(button) {
        this._button = button;
        this.actor = new St.BoxLayout({
            style_class: 'rice-helm-card', vertical: true, visible: false,
        });
        // above the dock, which would otherwise cover the card's left edge
        Main.layoutManager.addTopChrome(this.actor, {affectsInputRegion: false});
        button.connectObject(
            'notify::hover', () => this.sync(),
            'destroy', () => {
                Main.layoutManager.removeChrome(this.actor);
                this.actor.destroy();
            },
            this);
    }

    set(header, rows) {
        this.actor.destroy_all_children();
        this.actor.add_child(new St.Label({text: header, style_class: 'rice-helm-head'}));
        let tier = null;
        for (const {at, project, task, kind, tier: rowTier} of rows) {
            if (rowTier !== tier) {
                tier = rowTier;
                this.actor.add_child(new St.Label({text: tier, style_class: 'rice-helm-tier'}));
            }
            const row = new St.BoxLayout({style_class: `rice-helm-row ${kind}`});
            const cell = (text, style) => {
                const label = new St.Label({text, style_class: style});
                label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                row.add_child(label);
            };
            cell(at ?? '--:--', 'rice-helm-at');
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

        this.connect('button-press-event', () => {
            Main.overview.toggle();
            return Clutter.EVENT_STOP;
        });
        this.connect('notify::hover', () => {
            if (this.hover && GLib.get_monotonic_time() / 1e6 - this._fetchedAt > HOVER_REFRESH_SECONDS)
                this._fetch();
        });
        // refetch now and then; re-judge "started" every 30 s as time passes
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
            this._destroyed = true;
            GLib.source_remove(this._timer);
        });
        this._fetch();
    }

    async _fetch() {
        if (this._fetching)
            return;
        this._fetching = true;
        let data = null;
        try {
            data = await runHelm();
        } catch {
            try {
                data = await runHelm({HELM_URL: FALLBACK_URL});
            } catch (e) {
                console.log(`rice-bar: helm unavailable: ${e.message}`);
            }
        }
        this._fetching = false;
        if (this._destroyed)
            return;
        this._data = data; // null on failure: stale data would lie about what's done
        if (data)
            this._fetchedAt = GLib.get_monotonic_time() / 1e6;
        this._render();
    }

    _render() {
        const data = this._data;
        if (!data?.blocks) {
            this._label.text = GLib.get_host_name();
            this.remove_style_class_name('overdue');
            this._card.set('helm unreachable', []);
            return;
        }
        const now = GLib.DateTime.new_now_local();
        const today = now.format('%Y-%m-%d');
        const time = now.format('%H:%M');
        // helm's rule: an earlier day has all started; today, untimed blocks
        // and ones whose time has come
        const started = b => data.date < today || !b.at || b.at <= time;

        const missed = data.blocks.filter(started);
        const upcoming = data.blocks.filter(b => !started(b));
        const next = missed[0] ??
            upcoming.reduce((a, b) => (a && a.at <= b.at ? a : b), null);

        if (next)
            this._label.text = ['helm', next.at, next.project].filter(Boolean).join(' ');
        else
            this._label.text = `helm ${TICK}`;
        // red for missed floor only: stretch is optional
        if (missed.some(b => b.floor))
            this.add_style_class_name('overdue');
        else
            this.remove_style_class_name('overdue');

        const sum = (blocks, f = () => true) =>
            blocks.filter(f).reduce((h, b) => h + b.hours, 0);
        const header = missed.length
            ? `missed ${missed.length} · ${hours(sum(missed))}h (${hours(sum(missed, b => b.floor))}h floor)`
            : `nothing missed  ${TICK}`;
        const rows = data.blocks.map(b => ({
            at: b.at, project: b.project, tier: b.tier,
            task: b.label ?? b.task,
            kind: !b.floor ? 'stretch' : started(b) ? 'overdue' : 'floor',
        }));
        this._card.set(header, rows);
    }
});
