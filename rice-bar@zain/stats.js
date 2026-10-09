// cpu 12%  mem 41% — whole-system usage, every 2 s, from /proc.
// A value at or above HOT_PERCENT turns red-bright.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

const INTERVAL_SECONDS = 2;
const HOT_PERCENT = 85;

const decoder = new TextDecoder();

function readProc(path) {
    const [, bytes] = GLib.file_get_contents(path);
    return decoder.decode(bytes);
}

// key label (dim) + value label (bright); returns both
export function addPair(box, key) {
    const keyLabel = new St.Label({
        text: key,
        style_class: 'rice-key',
        y_align: Clutter.ActorAlign.CENTER,
    });
    box.add_child(keyLabel);
    const value = new St.Label({
        style_class: 'rice-val',
        y_align: Clutter.ActorAlign.CENTER,
    });
    box.add_child(value);
    return [keyLabel, value];
}

export const Stats = GObject.registerClass(
class Stats extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'system stats', true);
        this.add_style_class_name('rice-stats');
        this.setSensitive(false);
        const box = new St.BoxLayout({style_class: 'rice-pairs'});
        this.add_child(box);
        [, this._cpu] = addPair(box, 'cpu');
        [, this._mem] = addPair(box, 'mem');

        this._lastCpu = null;
        this._update();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, INTERVAL_SECONDS, () => {
            this._update();
            return GLib.SOURCE_CONTINUE;
        });
        this.connect('destroy', () => GLib.source_remove(this._timer));
    }

    _update() {
        try {
            this._show(this._cpu, this._cpuPercent());
            this._show(this._mem, this._memPercent());
        } catch (e) {
            logError(e, 'rice-bar: reading /proc');
        }
    }

    _show(label, percent) {
        label.text = percent === null ? '--%' : `${Math.round(percent)}%`;
        if (percent !== null && percent >= HOT_PERCENT)
            label.add_style_class_name('hot');
        else
            label.remove_style_class_name('hot');
    }

    // "cpu  user nice system idle iowait irq softirq steal ..." — busy share
    // of the jiffies since the last read
    _cpuPercent() {
        const fields = readProc('/proc/stat').split('\n', 1)[0]
            .trim().split(/\s+/).slice(1, 9).map(Number);
        const idle = fields[3] + fields[4];
        const total = fields.reduce((a, b) => a + b, 0);
        const last = this._lastCpu;
        this._lastCpu = {idle, total};
        if (!last || total === last.total)
            return null;
        return 100 * (1 - (idle - last.idle) / (total - last.total));
    }

    _memPercent() {
        const info = {};
        for (const line of readProc('/proc/meminfo').split('\n')) {
            const [key, value] = line.split(/:\s+/);
            info[key] = parseInt(value);
        }
        return 100 * (1 - info.MemAvailable / info.MemTotal);
    }
});
