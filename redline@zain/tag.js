// The tag: the block at the far left, where tmux keeps its session name.
// What it shows comes from a source module, chosen once at enable:
//
//   helm.js      [helm 14:30 leetcode]  the next block from my planner's CLI;
//                used when that CLI exists (REDLINE_HELM or ~/vault/helm/cli/helm)
//   calendar.js  [ 14:00 standup]      the next event today from GNOME's
//                calendar (Evolution: GNOME Calendar, Online Accounts)
//
// REDLINE_TAG=helm|calendar forces one. Hover drops a card listing the
// day; click (or Super) opens the overview, as it replaces Activities. With
// nothing to show the tag is the hostname, like the old host tag.
//
// A source is a class with:
//   constructor(changed)  changed() asks the tag to fetch and redraw now
//   async fetch()         returns data (throws or returns null if it can't)
//   view(data)            {label, hot, header, rows} or null for the hostname;
//                         called every 30 s too, as time moves on.
//                         rows: [{at, project, task, kind ('hot'|'dim'|''), tier}]
//   refreshSeconds        how often to fetch again (0: only on changed())
//   destroy()
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {placeUnder} from './util.js';
import {HelmSource, helmInstalled} from './helm.js';
import {CalendarSource} from './calendar.js';

const HOVER_REFRESH_SECONDS = 60; // a hover refetches if the data is older
const TASK_CHARS = 44;

function pickSource() {
    const forced = GLib.getenv('REDLINE_TAG');
    if (forced === 'helm')
        return HelmSource;
    if (forced === 'calendar')
        return CalendarSource;
    return helmInstalled() ? HelmSource : CalendarSource;
}

// The hover card: a header, then one row per item (time, project, task),
// grouped under tier headings when the source gives them.
class TagCard {
    constructor(button) {
        this._button = button;
        this.actor = new St.BoxLayout({
            style_class: 'redline-tag-card', vertical: true, visible: false,
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
        this.actor.add_child(new St.Label({text: header, style_class: 'redline-tag-head'}));
        let tier = null;
        for (const {at, project, task, kind, tier: rowTier} of rows) {
            if (rowTier !== tier) {
                tier = rowTier;
                if (tier) // no heading for a row sent without a tier
                    this.actor.add_child(new St.Label({text: tier, style_class: 'redline-tag-tier'}));
            }
            const row = new St.BoxLayout({style_class: `redline-tag-row ${kind ?? ''}`});
            const cell = (text, style) => {
                const label = new St.Label({text, style_class: style});
                label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                row.add_child(label);
            };
            cell(at || '--:--', 'redline-tag-at');
            cell(project ?? '', 'redline-tag-project');
            const t = `${task ?? ''}`.replace(/\s+/g, ' ');
            cell(t.length > TASK_CHARS ? `${t.slice(0, TASK_CHARS - 1)}…` : t, 'redline-tag-task');
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

export const Tag = GObject.registerClass(
class Tag extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'tag', true);
        this.add_style_class_name('redline-tag');
        this._label = new St.Label({
            text: GLib.get_host_name(),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._label);
        this._card = new TagCard(this);
        this._data = null;
        this._fetchedAt = 0;
        const Source = pickSource();
        this._source = new Source(() => this._fetch());

        this.connect('button-press-event', () => {
            Main.overview.toggle();
            return Clutter.EVENT_STOP;
        });
        this.connect('notify::hover', () => {
            if (this.hover && GLib.get_monotonic_time() / 1e6 - this._fetchedAt > HOVER_REFRESH_SECONDS)
                this._fetch();
        });
        // fetch now and then; redraw every 30 s as time passes
        const every = Math.max(1, Math.round(this._source.refreshSeconds / 30));
        let ticks = 0;
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
            ticks = (ticks + 1) % every;
            if (ticks === 0 && this._source.refreshSeconds)
                this._fetch();
            else
                this._render();
            return GLib.SOURCE_CONTINUE;
        });
        this.connect('destroy', () => {
            this._destroyed = true;
            GLib.source_remove(this._timer);
            this._source.destroy();
        });
        this._fetch();
    }

    async _fetch() {
        if (this._fetching)
            return;
        this._fetching = true;
        let data = null;
        try {
            data = await this._source.fetch();
        } catch (e) {
            console.log(`redline: tag source unavailable: ${e.message}`);
        }
        this._fetching = false;
        if (this._destroyed)
            return;
        this._data = data; // null on failure: stale data would lie
        if (data)
            this._fetchedAt = GLib.get_monotonic_time() / 1e6;
        this._render();
    }

    _render() {
        let view = null;
        try {
            view = this._data ? this._source.view(this._data) : null;
        } catch (e) {
            logError(e, 'redline: tag view');
        }
        if (!view) {
            this._label.text = GLib.get_host_name();
            this.remove_style_class_name('hot');
            this._card.set(this._source.unreachable ?? 'nothing to show', []);
            return;
        }
        this._label.text = view.label || GLib.get_host_name();
        if (view.hot)
            this.add_style_class_name('hot');
        else
            this.remove_style_class_name('hot');
        this._card.set(view.header, view.rows);
    }
});
