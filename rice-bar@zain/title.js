// The focused window, dim, like tmux's window name: "kitty — ~/rice".
// Empty in the overview or when nothing has focus. Not clickable, but
// hoverable: a title cut off at MAX_CHARS shows whole underneath.
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {FullTextTooltip, truncate} from './util.js';

const MAX_CHARS = 60;

export const WindowTitle = GObject.registerClass(
class WindowTitle extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'window title', true);
        this.add_style_class_name('rice-title');
        this.can_focus = false; // no menu, so clicks already do nothing
        this._label = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._label);
        this._tooltip = new FullTextTooltip(this, this._label);

        global.display.connectObject('notify::focus-window', () => this._track(), this);
        Main.overview.connectObject(
            'showing', () => this._update(),
            'hidden', () => this._update(),
            this);
        this._track();
    }

    _track() {
        this._window?.disconnectObject(this);
        this._window = global.display.focus_window;
        this._window?.connectObject(
            'notify::title', () => this._update(),
            'unmanaged', () => {
                this._window.disconnectObject(this);
                this._window = null;
                this._update();
            },
            this);
        this._update();
    }

    _update() {
        const window = this._window;
        if (!window || Main.overview.visible) {
            this._label.text = this._tooltip.text = '';
            this._tooltip.sync();
            return;
        }
        const app = Shell.WindowTracker.get_default().get_window_app(window);
        const name = app?.get_name() ?? '';
        const title = window.get_title() ?? '';
        let text;
        if (!title)
            text = name;
        else if (!name || title.toLowerCase().includes(name.toLowerCase()))
            text = title;
        else
            text = `${name} — ${title}`;
        this._label.text = truncate(text, MAX_CHARS);
        this._tooltip.text = text;
        this._tooltip.sync();
    }
});
