// Tag source: today's events from GNOME's calendar (whatever Evolution
// knows: GNOME Calendar, Online Accounts). Read from the clock menu's own
// event source rather than a second one: the calendar server keeps a single
// time range, and two clients asking for different ranges would empty
// each other's events. That menu always asks for a range with today in it.
//
//    14:00 standup      the event on now, or the next one today; red while
//                        it's on or starts within SOON_MINUTES
//   hostname             nothing left today (all-day events stay in the card)
//
// Hover lists the day: past events dim, the current one red.
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const ICON = ''; // nf-fa-calendar
const SOON_MINUTES = 10;
const LABEL_CHARS = 24;

const hhmm = d => `${d.getHours()}`.padStart(2, '0') + ':' + `${d.getMinutes()}`.padStart(2, '0');

function isAllDay(e) {
    const day = 24 * 3600 * 1000;
    return e.date.getHours() === 0 && e.date.getMinutes() === 0 &&
        (e.end - e.date) % day === 0 && e.end - e.date >= day;
}

export class CalendarSource {
    constructor(changed) {
        this._changed = changed;
        this.refreshSeconds = 0; // the event source says when it changes
        this.unreachable = 'no calendar events';
        this._events = null;
    }

    // the clock menu's event source; it's swapped (e.g. around the lock
    // screen), so look it up each time and follow the current one
    _eventSource() {
        const source = Main.panel.statusArea.dateMenu?._eventSource ?? null;
        if (source !== this._events) {
            this._events?.disconnectObject(this);
            this._events = source;
            source?.connectObject('changed', () => this._changed(), this);
        }
        return source;
    }

    async fetch() {
        return this._eventSource() ? {} : null;
    }

    view() {
        const source = this._eventSource();
        if (!source)
            return null;
        const now = new Date();
        const begin = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const end = new Date(begin.getFullYear(), begin.getMonth(), begin.getDate() + 1);
        const events = source.getEvents(begin, end);
        if (!events.length)
            return null;

        const timed = events.filter(e => !isAllDay(e));
        const current = timed.find(e => e.date <= now && now < e.end);
        const next = current ?? timed.find(e => e.date > now);

        let label = null, hot = false;
        if (next) {
            const s = next.summary || '(untitled)';
            label = `${ICON} ${hhmm(next.date)} ${s.length > LABEL_CHARS ? `${s.slice(0, LABEL_CHARS - 1)}…` : s}`;
            hot = !!current || next.date - now <= SOON_MINUTES * 60 * 1000;
        }
        const left = timed.filter(e => e.end > now).length;
        const rows = events.map(e => {
            const allDay = isAllDay(e);
            return {
                at: allDay ? 'all day' : hhmm(e.date),
                project: allDay ? '' : `→ ${hhmm(e.end)}`,
                task: e.summary || '(untitled)',
                kind: e === current ? 'hot' : !allDay && e.end <= now ? 'dim' : '',
            };
        });
        return {
            label, hot, rows,
            header: left ? `today · ${left} to go` : `today · nothing left  ${''}`,
        };
    }

    destroy() {
        this._events?.disconnectObject(this);
        this._events = null;
    }
}
