// rice bar: turns GNOME's top bar into something like the tmux status line.
//
//   left:  [host] 1 [2] 3  focused window
//   right: ♪ now playing  [cpu/mem alerts]  hp 80%  bat 87% 3:12  [quick settings]  clock
//
// Changing keyboard layout (US/UK) pops GNOME's OSD box with its name, and
// scripts can pop it too with bin/rice-osd (riceosd.js).
//
// Only the segments are new. Quick settings and the calendar menu are
// GNOME's own (the clock is moved from the centre to the far right); the
// rice shell theme and stylesheet.css restyle them, and gateIcon() keeps
// their status icons quiet: no night light or notification bell, wifi only
// when the connection is poor or down, volume only when muted. Colors are
// palette.md.
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {HostTag} from './host.js';
import {Workspaces} from './workspaces.js';
import {WindowTitle} from './title.js';
import {NowPlaying} from './nowplaying.js';
import {Stats} from './stats.js';
import {Devices} from './devices.js';
import {Battery} from './battery.js';
import {LayoutOsd} from './layoutosd.js';
import {RiceOsd} from './riceosd.js';
import {gateIcon} from './util.js';

// network icons that need no attention: strong wifi, a working cable
const GOOD_NETWORK = /^network-(wireless-signal-(excellent|good)|wireless-connected|wired)-symbolic$/;

const SEGMENTS = [
    // role, class, box, position
    ['rice-host', HostTag, 'left', 0],
    ['rice-workspaces', Workspaces, 'left', 1],
    ['rice-title', WindowTitle, 'left', 2],
    ['rice-nowplaying', NowPlaying, 'right', 0],
    ['rice-stats', Stats, 'right', 1],
    ['rice-devices', Devices, 'right', 2],
    ['rice-battery', Battery, 'right', 3],
];

export default class RiceBarExtension extends Extension {
    enable() {
        this._segments = SEGMENTS.map(([role, Segment, box, position]) =>
            Main.panel.addToStatusArea(role, new Segment(), position, box));
        this._layoutOsd = new LayoutOsd();
        this._riceOsd = new RiceOsd();

        // the host tag opens the overview instead
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

        // Quick settings' indicators are built asynchronously at startup,
        // so they may not exist yet when we're enabled on login.
        this._quietQuickSettings();
    }

    disable() {
        this._segments.forEach(s => s.destroy());
        this._segments = null;
        this._layoutOsd.destroy();
        this._layoutOsd = null;
        this._riceOsd.destroy();
        this._riceOsd = null;

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

    _quietQuickSettings(attempt = 0) {
        const qs = Main.panel.statusArea.quickSettings;
        if (qs._system) {
            this._ungates.push(
                // the battery segment replaces it
                gateIcon(qs._system._indicator, () => false),
                gateIcon(qs._nightLight._indicator, () => false),
                gateIcon(qs._volumeOutput._indicator, icon => icon.includes('muted')));
            // no NetworkManager → no _network
            if (qs._network) {
                this._ungates.push(gateIcon(qs._network._primaryIndicator,
                    icon => !GOOD_NETWORK.test(icon)));
            }
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

