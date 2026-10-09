// rice bar: turns GNOME's top bar into something like the tmux status line.
//
//   left:  [host] 1 [2] 3  focused window
//   right: ♪ now playing  cpu 12 mem 41  bat 87% 3:12  [quick settings]  clock
//
// Only the segments are new. Quick settings and the calendar menu are
// GNOME's own (the clock is moved from the centre to the far right); the
// rice shell theme and stylesheet.css restyle them. Colors are palette.md.
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {HostTag} from './host.js';
import {Workspaces} from './workspaces.js';
import {WindowTitle} from './title.js';
import {NowPlaying} from './nowplaying.js';
import {Stats} from './stats.js';
import {Battery} from './battery.js';

const SEGMENTS = [
    // role, class, box, position
    ['rice-host', HostTag, 'left', 0],
    ['rice-workspaces', Workspaces, 'left', 1],
    ['rice-title', WindowTitle, 'left', 2],
    ['rice-nowplaying', NowPlaying, 'right', 0],
    ['rice-stats', Stats, 'right', 1],
    ['rice-battery', Battery, 'right', 2],
];

export default class RiceBarExtension extends Extension {
    enable() {
        this._segments = SEGMENTS.map(([role, Segment, box, position]) =>
            Main.panel.addToStatusArea(role, new Segment(), position, box));

        // the host tag opens the overview instead
        Main.panel.statusArea.activities.container.hide();

        // clock: centre → far right, after quick settings, like tmux's %H:%M
        const clock = Main.panel.statusArea.dateMenu.container;
        clock.get_parent().remove_child(clock);
        Main.panel._rightBox.add_child(clock);

        // The battery segment replaces quick settings' battery icon. That
        // indicator is built asynchronously at startup, so it may not exist
        // yet when we're enabled on login.
        this._hideBatteryIcon();
    }

    disable() {
        this._segments.forEach(s => s.destroy());
        this._segments = null;

        Main.panel.statusArea.activities.container.show();

        const clock = Main.panel.statusArea.dateMenu.container;
        clock.get_parent()?.remove_child(clock);
        Main.panel._centerBox.insert_child_at_index(clock, 0);

        if (this._batteryRetry) {
            GLib.source_remove(this._batteryRetry);
            this._batteryRetry = 0;
        }
        Main.panel.statusArea.quickSettings._system?._indicator.show();
    }

    _hideBatteryIcon(attempt = 0) {
        const system = Main.panel.statusArea.quickSettings._system;
        if (system) {
            system._indicator.hide();
            return;
        }
        if (attempt >= 20)
            return;
        this._batteryRetry = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._batteryRetry = 0;
            this._hideBatteryIcon(attempt + 1);
            return GLib.SOURCE_REMOVE;
        });
    }
}

