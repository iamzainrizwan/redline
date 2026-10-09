// [valhalla] — the red block at the far left, like tmux's session name.
// Click (or Super) opens the overview; replaces the Activities button.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

export const HostTag = GObject.registerClass(
class HostTag extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'host', true);
        this.add_style_class_name('rice-host');
        this.add_child(new St.Label({
            text: GLib.get_host_name(),
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this.connect('button-press-event', () => {
            Main.overview.toggle();
            return Clutter.EVENT_STOP;
        });
    }
});
