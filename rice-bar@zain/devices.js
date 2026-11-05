// hp 80%  ms 45% — batteries of connected devices (Bluetooth headphones,
// mice, keyboards, controllers...), whatever UPower reports: BlueZ feeds
// it Bluetooth batteries, the kernel feeds it wireless dongle ones. A
// device appears when it connects and goes when it disconnects. Red-bright
// at or below LOW_PERCENT. Hidden when none are connected. The laptop's
// own battery is battery.js.
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {addPair, isCancelled, UPOWER_BUS} from './util.js';

Gio._promisify(Gio.DBusProxy, 'new_for_bus');
Gio._promisify(Gio.DBusProxy.prototype, 'call');

const LOW_PERCENT = 20;

const UPOWER = 'org.freedesktop.UPower';
const DEVICE_IFACE = 'org.freedesktop.UPower.Device';

// UpDeviceKind → key; anything else reads "dev"
const KEYS = {
    5: 'ms', // mouse
    6: 'kb', // keyboard
    8: 'ph', // phone
    10: 'tab', // tablet
    12: 'pad', // gaming input
    13: 'pen',
    14: 'tp', // touchpad
    17: 'hs', // headset
    18: 'spk', // speakers
    19: 'hp', // headphones
    21: 'aud', // other audio
    22: 'rc', // remote control
    26: 'wear', // wearable (watch, band)
};

export const Devices = GObject.registerClass(
class Devices extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'device batteries', true);
        this.add_style_class_name('rice-devices');
        this.setSensitive(false);
        this.hide();
        this._box = new St.BoxLayout({style_class: 'rice-pairs'});
        this.add_child(this._box);

        this._devices = new Map(); // object path → Gio.DBusProxy
        this._cancellable = new Gio.Cancellable();
        this.connect('destroy', () => this._cancellable.cancel());
        this._watch();
    }

    async _watch() {
        try {
            this._upower = await Gio.DBusProxy.new_for_bus(UPOWER_BUS,
                Gio.DBusProxyFlags.DO_NOT_LOAD_PROPERTIES, null, UPOWER,
                '/org/freedesktop/UPower', UPOWER, this._cancellable);
            this._upower.connectObject('g-signal', (_proxy, _sender, signal, params) => {
                const [path] = params.deepUnpack();
                if (signal === 'DeviceAdded')
                    this._add(path);
                else if (signal === 'DeviceRemoved')
                    this._remove(path);
            }, this);
            const [paths] = (await this._upower.call('EnumerateDevices', null,
                Gio.DBusCallFlags.NONE, -1, this._cancellable)).deepUnpack();
            paths.forEach(path => this._add(path));
        } catch (e) {
            if (!isCancelled(e))
                logError(e, 'rice-bar: UPower devices');
        }
    }

    async _add(path) {
        if (this._devices.has(path))
            return;
        this._devices.set(path, null);
        try {
            const proxy = await Gio.DBusProxy.new_for_bus(UPOWER_BUS,
                Gio.DBusProxyFlags.NONE, null, UPOWER, path, DEVICE_IFACE,
                this._cancellable);
            if (!this._devices.has(path)) // removed while we waited
                return;
            this._devices.set(path, proxy);
            proxy.connectObject('g-properties-changed', () => this._update(), this);
            this._update();
        } catch (e) {
            if (!isCancelled(e))
                logError(e, `rice-bar: UPower device ${path}`);
        }
    }

    _remove(path) {
        this._devices.get(path)?.disconnectObject(this);
        this._devices.delete(path);
        this._update();
    }

    _update() {
        this._box.destroy_all_children();
        const counts = {};
        for (const proxy of this._devices.values()) {
            const get = name => proxy?.get_cached_property(name)?.unpack();
            if (!proxy || get('PowerSupply') || !get('IsPresent'))
                continue;
            const percent = Math.round(get('Percentage') ?? 0);
            if (percent <= 0)
                continue;
            let key = KEYS[get('Type')] ?? 'dev';
            counts[key] = (counts[key] ?? 0) + 1;
            if (counts[key] > 1)
                key += counts[key];
            const [, value] = addPair(this._box, key);
            value.text = `${percent}%`;
            if (percent <= LOW_PERCENT)
                value.add_style_class_name('hot');
        }
        this.visible = this._box.get_n_children() > 0;
    }
});
