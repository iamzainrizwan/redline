// cpu 93%  mem 88% — an alert, not a readout: whole-system usage from
// /proc every 2 s, shown (red-bright) only while at or above HOT_PERCENT
// (cpu: for CPU_HOT_READS reads in a row).
// Each pair hides on its own; the segment hides when both are calm.
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {addPair} from './util.js';

const INTERVAL_SECONDS = 2;
// redline-test sets it to 0 to draw the alerts
const HOT_PERCENT = Number(GLib.getenv('REDLINE_HOT_PERCENT') ?? 85);
// cpu must stay hot this many reads in a row (6 s), so a build or a page
// load doesn't flash it up for a moment; memory doesn't spike like that
const CPU_HOT_READS = 3;

const decoder = new TextDecoder();

function readProc(path) {
    const [, bytes] = GLib.file_get_contents(path);
    return decoder.decode(bytes);
}

export const Stats = GObject.registerClass(
class Stats extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'system stats', true);
        this.add_style_class_name('redline-stats');
        this.setSensitive(false);
        const box = new St.BoxLayout({style_class: 'redline-pairs'});
        this.add_child(box);
        this._cpu = addPair(box, 'cpu');
        this._mem = addPair(box, 'mem');
        this._cpu[1].add_style_class_name('hot');
        this._mem[1].add_style_class_name('hot');
        this.hide();

        this._lastCpu = null;
        this._cpuHotReads = 0;
        this._update();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, INTERVAL_SECONDS, () => {
            this._update();
            return GLib.SOURCE_CONTINUE;
        });
        this.connect('destroy', () => GLib.source_remove(this._timer));
    }

    _update() {
        try {
            const cpuPercent = this._cpuPercent();
            this._cpuHotReads = cpuPercent !== null && cpuPercent >= HOT_PERCENT
                ? this._cpuHotReads + 1 : 0;
            const cpu = this._show(this._cpu, cpuPercent, this._cpuHotReads >= CPU_HOT_READS);
            const memPercent = this._memPercent();
            const mem = this._show(this._mem, memPercent, memPercent >= HOT_PERCENT);
            // cpu's value carries the gap to the next pair; drop it alone
            this._cpu[1].style = mem ? null : 'padding-right: 0;';
            this.visible = cpu || mem;
        } catch (e) {
            logError(e, 'redline: reading /proc');
        }
    }

    // returns whether the pair is showing
    _show([key, value], percent, hot) {
        key.visible = value.visible = hot;
        if (hot)
            value.text = `${Math.round(percent)}%`;
        return hot;
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
