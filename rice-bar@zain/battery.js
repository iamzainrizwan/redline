// bat 87% 3:12 — UPower's display device. "bat" on battery (time to empty),
// "chg" while charging (time to full), "ac" when full on mains. Red-bright
// on battery at or below LOW_PERCENT. Hidden on machines with no battery.
// Replaces quick settings' battery icon (extension.js hides it).
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {addPair} from './stats.js';
import {isCancelled} from './util.js';

const LOW_PERCENT = 20;

// org.freedesktop.UPower.Device State
const CHARGING = 1;
const DISCHARGING = 2;
const PENDING_DISCHARGE = 6;

function hhmm(seconds) {
    const minutes = Math.round(seconds / 60);
    return `${Math.floor(minutes / 60)}:${`${minutes % 60}`.padStart(2, '0')}`;
}

export const Battery = GObject.registerClass(
class Battery extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'battery', true);
        this.add_style_class_name('rice-battery');
        this.setSensitive(false);
        this.hide();
        const box = new St.BoxLayout({style_class: 'rice-pairs'});
        this.add_child(box);
        [this._keyLabel, this._value] = addPair(box, 'bat');

        this._cancellable = new Gio.Cancellable();
        Gio.DBusProxy.new_for_bus(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE,
            null, 'org.freedesktop.UPower',
            '/org/freedesktop/UPower/devices/DisplayDevice',
            'org.freedesktop.UPower.Device', this._cancellable, (_source, res) => {
                try {
                    this._proxy = Gio.DBusProxy.new_for_bus_finish(res);
                } catch (e) {
                    if (!isCancelled(e))
                        logError(e, 'rice-bar: UPower');
                    return;
                }
                this._proxy.connectObject('g-properties-changed', () => this._update(), this);
                this._update();
            });
        this.connect('destroy', () => this._cancellable.cancel());
    }

    _get(name) {
        return this._proxy.get_cached_property(name)?.unpack();
    }

    _update() {
        if (!this._get('IsPresent')) {
            this.hide();
            return;
        }
        const percent = Math.round(this._get('Percentage') ?? 0);
        const state = this._get('State');
        const onBattery = state === DISCHARGING || state === PENDING_DISCHARGE;

        let key = 'ac';
        let seconds = 0;
        if (onBattery) {
            key = 'bat';
            seconds = this._get('TimeToEmpty') ?? 0;
        } else if (state === CHARGING) {
            key = 'chg';
            seconds = this._get('TimeToFull') ?? 0;
        }
        this._keyLabel.text = key;
        this._value.text = seconds > 0 ? `${percent}% ${hhmm(seconds)}` : `${percent}%`;
        if (onBattery && percent <= LOW_PERCENT)
            this._value.add_style_class_name('hot');
        else
            this._value.remove_style_class_name('hot');
        this.show();
    }
});
