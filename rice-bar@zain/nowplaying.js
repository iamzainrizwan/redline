//  artist – title — whatever MPRIS player is playing (Spotify, a browser
// tab, mpv...), else the first paused one; hidden when there's none. Click
// to play/pause, scroll to skip. Same source as cmatrix-saver's status bar.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {isCancelled, truncate} from './util.js';

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';
const MAX_CHARS = 40;
const ICON = ''; // nf-fa-music

export const NowPlaying = GObject.registerClass(
class NowPlaying extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'now playing', true);
        this.add_style_class_name('rice-nowplaying');
        const box = new St.BoxLayout();
        this._icon = new St.Label({
            text: ICON,
            style_class: 'rice-np-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._label = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._icon);
        box.add_child(this._label);
        this.add_child(box);

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
                        logError(e, 'rice-bar: listing MPRIS players');
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
                        logError(e, `rice-bar: MPRIS proxy for ${name}`);
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
            return;
        }
        const artist = (metadata['xesam:artist']?.deepUnpack() ?? []).join(', ');
        this._label.text = truncate(artist ? `${artist} – ${title}` : title, MAX_CHARS);
        if (current.playing)
            this.remove_style_class_name('paused');
        else
            this.add_style_class_name('paused');
        this.show();
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
