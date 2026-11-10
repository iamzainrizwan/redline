// redline-osd: scripts pop GNOME's OSD box by writing "stamp<TAB>icon<TAB>text"
// to $XDG_RUNTIME_DIR/redline-osd (bin/redline-osd does). Only new writes show;
// whatever is in the file at login is ignored. REDLINE_OSD_FILE overrides the
// path (redline-test uses that to stay off the real session's file).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class Osd {
    constructor() {
        const path = GLib.getenv('REDLINE_OSD_FILE') ??
            GLib.build_filenamev([GLib.get_user_runtime_dir(), 'redline-osd']);
        this._file = Gio.File.new_for_path(path);
        this._monitor = this._file.monitor_file(Gio.FileMonitorFlags.NONE, null);
        this._monitor.connectObject('changed', (_m, _f, _o, event) => {
            if (event === Gio.FileMonitorEvent.CHANGES_DONE_HINT)
                this._show();
        }, this);
    }

    _show() {
        let text;
        try {
            const [, bytes] = this._file.load_contents(null);
            text = new TextDecoder().decode(bytes).trim();
        } catch {
            return;
        }
        const [, icon, label] = text.split('\t');
        if (!label)
            return;
        Main.osdWindowManager.show(-1, Gio.ThemedIcon.new(icon || 'dialog-information-symbolic'), label);
    }

    destroy() {
        this._monitor.disconnectObject(this);
        this._monitor.cancel();
        this._monitor = null;
    }
}
