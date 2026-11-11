// redline: turns GNOME's top bar into something like the tmux status line.
//
//   left:  [ 14:00 standup] 1 [2] 3  focused window   (the tag: tag.js)
//   right: ♪ now playing  [cpu/mem alerts]  hp 80%  bat 87% 3:12  [live] [mic off]
//          [quick settings]  clock
//
// Changing keyboard layout (US/UK) pops GNOME's OSD box with its name, and
// scripts can pop it too with bin/redline-osd (osd.js).
//
// Only the segments are new. Quick settings and the calendar menu are
// GNOME's own (the clock is moved from the centre to the far right); the
// stylesheet.css (and, on my machine, the rice shell theme) restyle them, and gateIcon() keeps
// their status icons quiet: no night light, mic privacy icon or
// notification bell, wifi only
// when the connection is poor or down, volume only when muted. Colours are
// OLED black, red and greys (see the README).
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Tag} from './tag.js';
import {Workspaces} from './workspaces.js';
import {WindowTitle} from './title.js';
import {NowPlaying} from './nowplaying.js';
import {Stats} from './stats.js';
import {Devices} from './devices.js';
import {Battery} from './battery.js';
import {Live, MicInUse, MicOff} from './live.js';
import {LayoutOsd} from './layoutosd.js';
import {Osd} from './osd.js';
import {gateIcon} from './util.js';

// network icons that need no attention: strong wifi, a working cable
const GOOD_NETWORK = /^network-(wireless-signal-(excellent|good)|wireless-connected|wired)-symbolic$/;

const QS_HANDLE = '\uf1de'; // nf-fa-sliders

const SEGMENTS = [
    // role, class, box, position
    ['redline-tag', Tag, 'left', 0],
    ['redline-workspaces', Workspaces, 'left', 1],
    ['redline-title', WindowTitle, 'left', 2],
    ['redline-nowplaying', NowPlaying, 'right', 0],
    ['redline-stats', Stats, 'right', 1],
    ['redline-devices', Devices, 'right', 2],
    ['redline-battery', Battery, 'right', 3],
    ['redline-micuse', MicInUse, 'right', 4],
    ['redline-live', Live, 'right', 5],
    ['redline-micoff', MicOff, 'right', 6],
];

export default class RedlineExtension extends Extension {
    enable() {
        this._segments = SEGMENTS.map(([role, Segment, box, position]) =>
            Main.panel.addToStatusArea(role, new Segment(), position, box));
        this._layoutOsd = new LayoutOsd();
        this._osd = new Osd();

        // the tag opens the overview instead
        Main.panel.statusArea.activities.container.hide();

        // clock: centre → far right, after quick settings, like tmux's %H:%M
        const dateMenu = Main.panel.statusArea.dateMenu;
        const clock = dateMenu.container;
        clock.get_parent().remove_child(clock);
        Main.panel._rightBox.add_child(clock);
        // Indicators that load later (or just-perfection re-pinning it) can
        // land after the clock; keep it last whenever the right box changes.
        this._clockKeeper = Main.panel._rightBox.connect('child-added', box => {
            if (clock.get_parent() === box && box.get_last_child() !== clock)
                box.set_child_above_sibling(clock, null);
        });

        // GNOME keeps the centred clock centred with an invisible pad on its
        // left, as wide as the notification dot on its right (and shown
        // whenever the dot is). At the right edge it's just a dead, hoverable
        // gap. Its visibility is bound to the dot, so detach it instead.
        const clockBox = dateMenu._clockDisplay.get_parent();
        this._clockPad = clockBox.get_children().find(c =>
            c !== dateMenu._clockDisplay && c !== dateMenu._indicator) ?? null;
        if (this._clockPad)
            clockBox.remove_child(this._clockPad);

        // notification bell (shown when there are unread ones): gone
        this._ungates = [gateIcon(dateMenu._indicator, () => false)];

        // GNOME's sharing/recording icons: the red live tag replaces them
        // (it watches the same sources itself, see live.js)
        const {screenSharing, screenRecording} = Main.panel.statusArea;
        if (screenSharing)
            this._ungates.push(gateIcon(screenSharing, () => false));
        if (screenRecording)
            this._ungates.push(gateIcon(screenRecording, () => false));

        // Quick settings' indicators are built asynchronously at startup,
        // so they may not exist yet when we're enabled on login.
        this._quietQuickSettings();
    }

    disable() {
        this._segments.forEach(s => s.destroy());
        this._segments = null;
        this._layoutOsd.destroy();
        this._layoutOsd = null;
        this._osd.destroy();
        this._osd = null;

        Main.panel.statusArea.activities.container.show();

        if (this._clockKeeper) {
            Main.panel._rightBox.disconnect(this._clockKeeper);
            this._clockKeeper = 0;
        }
        const dateMenu = Main.panel.statusArea.dateMenu;
        const clock = dateMenu.container;
        clock.get_parent()?.remove_child(clock);
        Main.panel._centerBox.insert_child_at_index(clock, 0);
        if (this._clockPad) {
            dateMenu._clockDisplay.get_parent().insert_child_at_index(this._clockPad, 0);
            this._clockPad = null;
        }

        if (this._quickSettingsRetry) {
            GLib.source_remove(this._quickSettingsRetry);
            this._quickSettingsRetry = 0;
        }
        this._ungates.forEach(ungate => ungate());
        this._ungates = null;
    }

    // With every icon gated away, quick settings would be an empty click
    // target; a dim glyph stands in whenever none of its icons is showing.
    _addQuickSettingsHandle(qs) {
        const box = qs._indicators;
        const handle = new St.Label({
            text: QS_HANDLE,
            style_class: 'redline-qs-handle',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(handle);
        const others = () => box.get_children().filter(c => c !== handle);
        const sync = () => {
            handle.visible = !others().some(c => c.visible);
        };
        const watched = others().map(c => [c, c.connect('notify::visible', sync)]);
        sync();
        this._ungates.push(() => {
            watched.forEach(([c, id]) => c.disconnect(id));
            handle.destroy();
        });
    }

    _quietQuickSettings(attempt = 0) {
        const qs = Main.panel.statusArea.quickSettings;
        if (qs._system) {
            this._ungates.push(
                // the battery segment replaces it
                gateIcon(qs._system._indicator, () => false),
                gateIcon(qs._nightLight._indicator, () => false),
                // the mic privacy icon: the mic pair names the apps instead
                gateIcon(qs._volumeInput._indicator, () => false),
                gateIcon(qs._volumeOutput._indicator, icon => icon.includes('muted')));
            // no NetworkManager → no _network
            if (qs._network) {
                this._ungates.push(gateIcon(qs._network._primaryIndicator,
                    icon => !GOOD_NETWORK.test(icon)));
            }
            this._addQuickSettingsHandle(qs);
            return;
        }
        if (attempt >= 20)
            return;
        this._quickSettingsRetry = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._quickSettingsRetry = 0;
            this._quietQuickSettings(attempt + 1);
            return GLib.SOURCE_REMOVE;
        });
    }
}

