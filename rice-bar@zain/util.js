import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export function truncate(text, max) {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function isCancelled(e) {
    return e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}
