// US ↔ UK popup: GNOME's own OSD (the volume/brightness box) with the
// keyboard layout, whenever the input source changes (layout-toggle,
// layout-sync at login, F75 hotplug). OSDs ignore Do Not Disturb, which hides
// notification banners; scripts can't show one (ShowOSD is shell-only), so
// the bar does.
import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const NAMES = {us: 'US', gb: 'UK'};

export class LayoutOsd {
    constructor() {
        this._settings = new Gio.Settings({schema_id: 'org.gnome.desktop.input-sources'});
        this._last = this._layout();
        this._settings.connectObject('changed::sources', () => this._changed(), this);
    }

    _layout() {
        const [, id] = this._settings.get_value('sources').deepUnpack()[0] ?? [];
        return id ?? '';
    }

    _changed() {
        const id = this._layout();
        // the login sync usually writes the layout that's already set
        if (id === this._last)
            return;
        this._last = id;
        const icon = Gio.ThemedIcon.new('input-keyboard-symbolic');
        Main.osdWindowManager.show(-1, icon, NAMES[id] ?? id);
    }

    destroy() {
        this._settings.disconnectObject(this);
        this._settings = null;
    }
}
