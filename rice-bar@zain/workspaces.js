// 1 [2] 3 — workspaces like tmux windows: the current one is a red block,
// ones with windows are bright, empty ones dim. Click to switch, scroll to
// step through them. GNOME's dynamic workspaces always keep one empty
// workspace at the end; it's hidden unless you're on it.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

export const Workspaces = GObject.registerClass(
class Workspaces extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'workspaces', true);
        this.add_style_class_name('rice-workspaces');
        this._box = new St.BoxLayout();
        this.add_child(this._box);
        this._watched = [];

        global.workspace_manager.connectObject(
            'notify::n-workspaces', () => this._queue(),
            'active-workspace-changed', () => this._queue(),
            this);
        // windows moving between workspaces restack the display
        global.display.connectObject('restacked', () => this._queue(), this);
        this.connect('scroll-event', (_actor, event) => this._onScroll(event));
        this.connect('destroy', () => {
            if (this._idle)
                GLib.source_remove(this._idle);
            this._unwatch();
        });

        this._render();
    }

    _queue() {
        this._idle ||= GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idle = 0;
            this._render();
            return GLib.SOURCE_REMOVE;
        });
    }

    _unwatch() {
        this._watched.forEach(ws => ws.disconnectObject(this));
        this._watched = [];
    }

    _render() {
        this._unwatch();
        this._box.destroy_all_children();

        const wm = global.workspace_manager;
        const n = wm.n_workspaces;
        const active = wm.get_active_workspace_index();
        for (let i = 0; i < n; i++) {
            const ws = wm.get_workspace_by_index(i);
            ws.connectObject(
                'window-added', () => this._queue(),
                'window-removed', () => this._queue(),
                this);
            this._watched.push(ws);

            const occupied = ws.list_windows().some(w => !w.skip_taskbar);
            if (i === n - 1 && n > 1 && !occupied && i !== active)
                continue;

            const button = new St.Button({
                label: `${i + 1}`,
                style_class: 'rice-ws',
                y_align: Clutter.ActorAlign.CENTER,
            });
            if (occupied)
                button.add_style_class_name('occupied');
            if (i === active)
                button.add_style_class_name('active');
            button.connect('clicked', () => ws.activate(global.get_current_time()));
            this._box.add_child(button);
        }
    }

    _onScroll(event) {
        let direction;
        switch (event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP:
        case Clutter.ScrollDirection.LEFT:
            direction = Meta.MotionDirection.LEFT;
            break;
        case Clutter.ScrollDirection.DOWN:
        case Clutter.ScrollDirection.RIGHT:
            direction = Meta.MotionDirection.RIGHT;
            break;
        default:
            return Clutter.EVENT_PROPAGATE;
        }
        global.workspace_manager.get_active_workspace()
            .get_neighbor(direction)
            .activate(global.get_current_time());
        return Clutter.EVENT_STOP;
    }
});
