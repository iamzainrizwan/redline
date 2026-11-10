//  artist – title — whatever MPRIS player is playing (Spotify, a browser
// tab, mpv...), else the first paused one; hidden when there's none. The
// artist only shows with a short title (<= ARTIST_TITLE_CHARS) and when it
// all fits (chars and pixels); else just the title, cut with … if that's
// still too long.
// Hover for a card with art, title, artist, album, a progress bar and the
// time (1:30 … 6:07).
// Click to play/pause, scroll to skip. Same source as cmatrix-saver's bar.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import Graphene from 'gi://Graphene';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {isCancelled, placeUnder, truncate} from './util.js';

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';
const MAX_CHARS = 40;
const ARTIST_TITLE_CHARS = 20;
const ICON = ''; // nf-fa-music
const ART_SIZE = 64;
const TEXT_WIDTH = 230; // the card's text column; the title wraps at this
const CARD_TITLE_CHARS = 120; // about 5 wrapped lines, so a runaway title can't fill the screen

// microseconds → "6:07", or "1:02:07" from an hour
function clock(us) {
    const s = Math.max(Math.floor(us / 1e6), 0);
    const ss = `${s % 60}`.padStart(2, '0');
    const m = Math.floor(s / 60);
    return m >= 60 ? `${Math.floor(m / 60)}:${`${m % 60}`.padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// The hover card: art | title / artist / album, progress bar underneath,
// elapsed and length under its two ends.
// Position isn't announced by MPRIS signals, so it's polled once a second
// while the card is up.
class TrackCard {
    constructor(button) {
        this._button = button;
        this._proxy = null;
        this._length = 0;
        this._timer = 0;
        this._artUrl = null;

        this.actor = new St.BoxLayout({
            style_class: 'redline-np-card', vertical: true, visible: false,
        });
        const row = new St.BoxLayout({style_class: 'redline-np-card-row'});
        this._art = new St.Icon({style_class: 'redline-np-art', icon_size: ART_SIZE});
        this._noArt = new St.Label({
            text: ICON, style_class: 'redline-np-noart',
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
        });
        this._artBox = new St.Bin({
            style_class: 'redline-np-artbox', width: ART_SIZE, height: ART_SIZE,
            y_align: Clutter.ActorAlign.START,
        });
        const text = new St.BoxLayout({
            vertical: true, width: TEXT_WIDTH,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._title = new St.Label({style_class: 'redline-np-title'});
        this._artist = new St.Label({style_class: 'redline-np-artist'});
        this._album = new St.Label({style_class: 'redline-np-album'});
        // long titles wrap in the card rather than getting cut again
        this._title.clutter_text.line_wrap = true;
        this._title.width = TEXT_WIDTH;
        this._title.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        [this._title, this._artist, this._album].forEach(l => text.add_child(l));
        row.add_child(this._artBox);
        row.add_child(text);
        this._trough = new St.Widget({
            style_class: 'redline-np-trough', x_expand: true,
            layout_manager: new Clutter.BinLayout(),
        });
        this._fill = new St.Widget({
            style_class: 'redline-np-fill', x_expand: true, y_expand: true,
            pivot_point: new Graphene.Point({x: 0, y: 0}), scale_x: 0,
        });
        this._trough.add_child(this._fill);
        this._times = new St.BoxLayout({style_class: 'redline-np-times'});
        this._elapsed = new St.Label({style_class: 'redline-np-elapsed', x_expand: true});
        this._total = new St.Label({style_class: 'redline-np-total'});
        this._times.add_child(this._elapsed);
        this._times.add_child(this._total);
        const progress = new St.BoxLayout({style_class: 'redline-np-progress', vertical: true});
        progress.add_child(this._trough);
        progress.add_child(this._times);
        this.actor.add_child(row);
        this.actor.add_child(progress);
        Main.layoutManager.addChrome(this.actor, {affectsInputRegion: false});

        button.connectObject(
            'notify::hover', () => this.sync(),
            'destroy', () => this._destroy(),
            this);
    }

    set(proxy, playing, metadata) {
        const str = key => metadata[key]?.unpack() ?? '';
        this._proxy = proxy;
        this._title.text = truncate(`${str('xesam:title')}`, CARD_TITLE_CHARS);
        // the boxes measure a wrapped label as one line; pin its real height
        // (measured in the card's bold font: unstyled it comes out a line short)
        this._title.height = -1;
        this._title.ensure_style();
        this._title.height = this._title.get_preferred_height(TEXT_WIDTH)[1];
        const artist = metadata['xesam:artist']?.deepUnpack() ?? [];
        this._artist.text = Array.isArray(artist) ? artist.join(', ') : `${artist}`;
        this._artist.visible = !!this._artist.text;
        this._album.text = str('xesam:album');
        this._album.visible = !!this._album.text;
        this._length = Number(metadata['mpris:length']?.unpack() ?? 0);
        const art = str('mpris:artUrl');
        if (art !== this._artUrl) {
            this._artUrl = art;
            // https art (Spotify) loads through gvfs, like GNOME's own media widget
            this._art.gicon = art ? new Gio.FileIcon({file: Gio.File.new_for_uri(art)}) : null;
            this._artBox.set_child(art ? this._art : this._noArt);
        }
        if (playing)
            this.actor.remove_style_class_name('paused');
        else
            this.actor.add_style_class_name('paused');
        this.sync();
    }

    clear() {
        this._proxy = null;
        this.sync();
    }

    sync() {
        if (!this._button.hover || !this._proxy || !this._button.visible) {
            this.actor.hide();
            this._stopTimer();
            return;
        }
        placeUnder(this._button, this.actor);
        this.actor.show();
        this._poll();
        this._timer ||= GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._poll();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _poll() {
        const proxy = this._proxy;
        this._trough.visible = this._times.visible = this._length > 0;
        if (!proxy || this._length <= 0)
            return;
        this._total.text = clock(this._length);
        proxy.get_connection().call(proxy.get_name(), MPRIS_PATH,
            'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', [PLAYER_IFACE, 'Position']),
            new GLib.VariantType('(v)'), Gio.DBusCallFlags.NONE, 1000, null,
            (conn, res) => {
                let position;
                try {
                    position = Number(conn.call_finish(res).deepUnpack()[0].unpack());
                } catch {
                    return; // player doesn't report position: leave the bar
                }
                if (proxy === this._proxy && this._length > 0) {
                    this._fill.scale_x = Math.min(Math.max(position / this._length, 0), 1);
                    this._elapsed.text = clock(position);
                }
            });
    }

    _stopTimer() {
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = 0;
    }

    _destroy() {
        this._stopTimer();
        this._proxy = null;
        Main.layoutManager.removeChrome(this.actor);
        this.actor.destroy();
    }
}

export const NowPlaying = GObject.registerClass(
class NowPlaying extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'now playing', true);
        this.add_style_class_name('redline-nowplaying');
        const box = new St.BoxLayout();
        this._icon = new St.Label({
            text: ICON,
            style_class: 'redline-np-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._label = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        // under MAX_CHARS can still be too wide for the room the panel has
        // (St ellipsizes it); drop the artist then too, once it's laid out
        this._short = '';
        this._label.connect('notify::allocation', () => {
            if (!this._short || this._label.text === this._short ||
                !this._label.clutter_text.get_layout().is_ellipsized())
                return;
            this._fitIdle ||= GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._fitIdle = 0;
                this._label.text = this._short;
                return GLib.SOURCE_REMOVE;
            });
        });
        box.add_child(this._icon);
        box.add_child(this._label);
        this.add_child(box);
        this._card = new TrackCard(this);

        this._players = new Map(); // bus name → Gio.DBusProxy
        this._wanted = new Set(); // bus names currently on the bus
        this._scrollDelta = 0;
        this._cancellable = new Gio.Cancellable();

        const bus = Gio.DBus.session;
        this._nameWatch = bus.signal_subscribe('org.freedesktop.DBus',
            'org.freedesktop.DBus', 'NameOwnerChanged', '/org/freedesktop/DBus',
            null, Gio.DBusSignalFlags.NONE, (...args) => {
                const [name, , newOwner] = args[5].deepUnpack();
                if (!name.startsWith(MPRIS_PREFIX))
                    return;
                if (newOwner)
                    this._add(name);
                else
                    this._remove(name);
            });
        bus.call('org.freedesktop.DBus', '/org/freedesktop/DBus',
            'org.freedesktop.DBus', 'ListNames', null,
            new GLib.VariantType('(as)'), Gio.DBusCallFlags.NONE, -1,
            this._cancellable, (conn, res) => {
                try {
                    const [names] = conn.call_finish(res).deepUnpack();
                    names.filter(n => n.startsWith(MPRIS_PREFIX))
                        .forEach(n => this._add(n));
                } catch (e) {
                    if (!isCancelled(e))
                        logError(e, 'redline: listing MPRIS players');
                }
            });

        this.connect('button-press-event', (_actor, event) => {
            if (event.get_button() !== Clutter.BUTTON_PRIMARY)
                return Clutter.EVENT_PROPAGATE;
            this._call('PlayPause');
            return Clutter.EVENT_STOP;
        });
        this.connect('scroll-event', (_actor, event) => this._onScroll(event));
        this.connect('destroy', () => {
            this._cancellable.cancel();
            if (this._fitIdle)
                GLib.source_remove(this._fitIdle);
            bus.signal_unsubscribe(this._nameWatch);
            this._players.clear();
        });

        this._update();
    }

    _add(name) {
        if (this._wanted.has(name))
            return;
        this._wanted.add(name);
        Gio.DBusProxy.new_for_bus(Gio.BusType.SESSION,
            Gio.DBusProxyFlags.DO_NOT_AUTO_START, null, name, MPRIS_PATH,
            PLAYER_IFACE, this._cancellable, (_source, res) => {
                let proxy;
                try {
                    proxy = Gio.DBusProxy.new_for_bus_finish(res);
                } catch (e) {
                    if (!isCancelled(e))
                        logError(e, `redline: MPRIS proxy for ${name}`);
                    return;
                }
                if (!this._wanted.has(name)) // left while we were connecting
                    return;
                this._players.set(name, proxy);
                proxy.connectObject('g-properties-changed', () => this._update(), this);
                this._update();
            });
    }

    _remove(name) {
        this._wanted.delete(name);
        this._players.get(name)?.disconnectObject(this);
        this._players.delete(name);
        this._update();
    }

    _current() {
        let paused = null;
        for (const proxy of this._players.values()) {
            const status = proxy.get_cached_property('PlaybackStatus')?.unpack();
            if (status === 'Playing')
                return {proxy, playing: true};
            if (status === 'Paused')
                paused ??= {proxy, playing: false};
        }
        return paused;
    }

    _update() {
        const current = this._current();
        const metadata = current?.proxy.get_cached_property('Metadata')?.deepUnpack() ?? {};
        const title = metadata['xesam:title']?.unpack() ?? '';
        if (!current || !title) {
            this.hide();
            this._card.clear();
            return;
        }
        const artist = (metadata['xesam:artist']?.deepUnpack() ?? []).join(', ');
        const text = artist ? `${artist} – ${title}` : title;
        this._short = truncate(title, MAX_CHARS);
        const full = text.length <= MAX_CHARS && title.length <= ARTIST_TITLE_CHARS
            ? text : this._short;
        // re-set only on a real change, so a fit-shortened label stays short
        if (full !== this._full) {
            this._full = full;
            this._label.text = full;
        }
        if (current.playing)
            this.remove_style_class_name('paused');
        else
            this.add_style_class_name('paused');
        this.show();
        this._card.set(current.proxy, current.playing, metadata);
    }

    _call(method) {
        this._current()?.proxy.call(method, null, Gio.DBusCallFlags.NONE, -1, null, null);
    }

    _onScroll(event) {
        switch (event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP:
            this._call('Previous');
            return Clutter.EVENT_STOP;
        case Clutter.ScrollDirection.DOWN:
            this._call('Next');
            return Clutter.EVENT_STOP;
        case Clutter.ScrollDirection.SMOOTH: {
            // touchpads: one skip per full notch's worth of scrolling
            const [, dy] = event.get_scroll_delta();
            this._scrollDelta += dy;
            if (Math.abs(this._scrollDelta) >= 1) {
                this._call(this._scrollDelta > 0 ? 'Next' : 'Previous');
                this._scrollDelta = 0;
            }
            return Clutter.EVENT_STOP;
        }
        default:
            return Clutter.EVENT_PROPAGATE;
        }
    }
});
