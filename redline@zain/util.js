import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export function truncate(text, max) {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// The whole text under a segment while it's hovered, if the bar shows it
// cut off by truncate(). Placed like the dash's app-name labels: chrome on
// the stage, centred under the segment, kept on its monitor. Call sync()
// after changing the text so an open tooltip follows along.
export class FullTextTooltip {
    constructor(button, label) {
        this._button = button;
        this._label = label;
        this.text = '';
        this._tooltip = new St.Label({style_class: 'redline-tooltip', visible: false});
        Main.layoutManager.addChrome(this._tooltip);
        button.connectObject(
            'notify::hover', () => this.sync(),
            'destroy', () => this._destroy(),
            this);
    }

    sync() {
        if (!this._button.hover || !this.text || this.text === this._label.text) {
            this._tooltip.hide();
            return;
        }
        this._tooltip.text = this.text;
        placeUnder(this._button, this._tooltip);
        this._tooltip.show();
    }

    _destroy() {
        Main.layoutManager.removeChrome(this._tooltip);
        this._tooltip.destroy();
    }
}

// Centre a chrome actor under a panel button, kept on its monitor.
export function placeUnder(button, actor) {
    const [x, y] = button.get_transformed_position();
    const [width, height] = button.get_transformed_size();
    const [, tipWidth] = actor.get_preferred_width(-1);
    const monitor = Main.layoutManager.findMonitorForActor(button);
    const tipX = Math.min(
        Math.max(x + (width - tipWidth) / 2, monitor.x),
        monitor.x + monitor.width - tipWidth);
    actor.set_position(Math.floor(tipX), Math.floor(y + height));
}

export function isCancelled(e) {
    return e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

// key label (dim) + value label (bright); returns both
export function addPair(box, key) {
    const keyLabel = new St.Label({
        text: key,
        style_class: 'redline-key',
        y_align: Clutter.ActorAlign.CENTER,
    });
    box.add_child(keyLabel);
    const value = new St.Label({
        style_class: 'redline-val',
        y_align: Clutter.ActorAlign.CENTER,
    });
    box.add_child(value);
    return [keyLabel, value];
}

// UPower's bus. redline-test points it at its own session bus, where a
// fake UPower plays battery and Bluetooth states the test machine can't.
export const UPOWER_BUS = GLib.getenv('REDLINE_UPOWER_BUS') === 'session'
    ? Gio.BusType.SESSION : Gio.BusType.SYSTEM;

// Keeps a GNOME status icon hidden unless show(iconName) says otherwise,
// on top of GNOME's own visibility (remembered, so a hidden icon reappears
// when GNOME and show() both want it; onWanted(wanted) hears each change of
// GNOME's mind). Returns an undo for disable().
export function gateIcon(icon, show, onWanted = null) {
    let wanted = icon.visible;
    let ours = false;
    const apply = () => {
        const visible = wanted && show(icon.icon_name ?? '');
        if (icon.visible === visible)
            return;
        ours = true;
        icon.visible = visible;
        ours = false;
    };
    const ids = [
        icon.connect('notify::visible', () => {
            if (ours)
                return;
            wanted = icon.visible;
            onWanted?.(wanted);
            apply();
        }),
    ];
    if (icon instanceof St.Icon)
        ids.push(icon.connect('notify::icon-name', apply));
    onWanted?.(wanted);
    apply();
    return () => {
        ids.forEach(id => icon.disconnect(id));
        icon.visible = wanted;
    };
}
