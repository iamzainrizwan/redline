// The buds card: hover the hp % of Nothing / CMF earbuds and a card drops
// under it with their noise modes, codec and dual connection; click to switch.
//
//   Nothing Ear (a)    L 100  R 100
//   nc  adaptive  trans  off
//   strength  high  mid  low
//   codec     ldac  aac
//   dual      on    off
//
// The live setting is red. A codec switch reboots the buds (~10 s). bin/buds does the talking (the buds' own Bluetooth
// protocol, no app); each hover re-reads the mode, since the stems change
// it too. Calls run one at a time, as the buds take one link at a time.
// REDLINE_BUDS points it at another script (the test's fake).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {placeUnder} from './util.js';

// bin/buds, as install.sh puts it on PATH (~/.local/bin)
const BUDS = GLib.getenv('REDLINE_BUDS') ??
    GLib.find_program_in_path('buds') ??
    GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'buds']);

// UPower's Model for buds bin/buds can drive
export const BUDS_MODEL = /^(nothing|cmf)\b/i;

const MODES = [['high', 'nc'], ['adaptive', 'adaptive'], ['trans', 'trans'], ['off', 'off']];
const STRENGTHS = [['high', 'high'], ['mid', 'mid'], ['low', 'low']];
const CODECS = [['ldac', 'ldac'], ['aac', 'aac']];
const DUAL = [['on', 'on'], ['off', 'off']];
const NC = new Set(['high', 'mid', 'low']);
// time to cross from the segment into the card before it hides
const HIDE_DELAY_MS = 300;

export class BudsCard {
    constructor(button) {
        this._button = button;
        this._enabled = false;
        this._queue = Promise.resolve();
        this._hideId = 0;
        this._mode = null;
        this._codec = null;
        this._dual = null;

        this.actor = new St.BoxLayout({
            style_class: 'redline-buds-card', vertical: true, visible: false,
            reactive: true, track_hover: true,
        });
        const head = new St.BoxLayout({style_class: 'redline-buds-head'});
        this._name = new St.Label({style_class: 'redline-buds-name', x_expand: true});
        this._battery = new St.Label({style_class: 'redline-buds-battery'});
        head.add_child(this._name);
        head.add_child(this._battery);
        this.actor.add_child(head);
        this._buttons = [];
        this.actor.add_child(this._row(null, MODES));
        this.actor.add_child(this._row('strength', STRENGTHS));
        // hidden for buds that don't answer the codec / dual reads
        this._codecRow = this._row('codec', CODECS);
        this._dualRow = this._row('dual', DUAL);
        this.actor.add_child(this._codecRow);
        this.actor.add_child(this._dualRow);

        // above the dock, like the tag's card
        Main.layoutManager.addTopChrome(this.actor);
        this.actor.connect('notify::hover', () => this._sync());
        button.connectObject(
            'notify::hover', () => this._sync(),
            'destroy', () => this._destroy(),
            this);
    }

    // shown at all only while the connected buds are ones bin/buds knows
    set enabled(on) {
        this._enabled = on;
        this._sync();
    }

    // key: null (noise modes), 'strength', 'codec' or 'dual'
    _row(key, modes) {
        const row = new St.BoxLayout({style_class: 'redline-buds-row'});
        if (key)
            row.add_child(new St.Label({text: key, style_class: 'redline-buds-key'}));
        for (const [mode, text] of modes) {
            const b = new St.Button({label: text, style_class: 'redline-buds-mode'});
            b._mode = mode;
            b._key = key;
            b.connect('clicked', () => this._run(key === 'dual' ? ['dual', mode] : [mode]));
            row.add_child(b);
            this._buttons.push(b);
        }
        return row;
    }

    _sync() {
        const want = this._enabled && (this._button.hover || this.actor.hover);
        if (want) {
            if (this._hideId) {
                GLib.source_remove(this._hideId);
                this._hideId = 0;
            }
            if (!this.actor.visible) {
                placeUnder(this._button, this.actor);
                this.actor.show();
                this._run([]);
            }
        } else if (this.actor.visible && !this._hideId) {
            this._hideId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HIDE_DELAY_MS, () => {
                this._hideId = 0;
                if (!this._enabled || !(this._button.hover || this.actor.hover))
                    this.actor.hide();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _paint() {
        for (const b of this._buttons) {
            const on = {
                strength: () => b._mode === this._mode,
                codec: () => b._mode === this._codec,
                dual: () => this._dual !== null && (b._mode === 'on') === this._dual,
            }[b._key]?.() ??
                (b._mode === this._mode || (b._mode === 'high' && NC.has(this._mode)));
            if (on)
                b.add_style_pseudo_class('checked');
            else
                b.remove_style_pseudo_class('checked');
            // strengths only mean something while noise cancelling is on
            b.opacity = b._key === 'strength' && !NC.has(this._mode) ? 110 : 255;
        }
    }

    // bin/buds --json [mode]; queued behind any call still running
    _run(args) {
        if (args.length) { // show the click at once; the reply confirms it
            if (args[0] === 'dual')
                this._dual = args[1] === 'on';
            else if (CODECS.some(([c]) => c === args[0]))
                this._codec = args[0];
            else
                this._mode = args[0];
            this._paint();
        }
        this._battery.add_style_pseudo_class('busy');
        this._queue = this._queue.then(() => this._call(args));
    }

    async _call(args) {
        try {
            const proc = Gio.Subprocess.new([BUDS, '--json', ...args],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            const [stdout, stderr] = await proc.communicate_utf8_async(null, null);
            if (!proc.get_successful())
                // last line only: a Python traceback ends with its error
                throw new Error(stderr.trim().split('\n').pop().replace(/^buds: /, '') || 'buds failed');
            const {name, mode, codec, dual, battery} = JSON.parse(stdout);
            this._name.text = name;
            this._battery.text = battery
                .map(({part, percent, charging}) => `${part} ${percent}${charging ? '+' : ''}`)
                .join('  ');
            this._mode = mode;
            this._codec = codec ?? null;
            this._dual = dual ?? null;
            this._codecRow.visible = this._codec !== null;
            this._dualRow.visible = this._dual !== null;
        } catch (e) {
            this._name.text = 'buds';
            this._battery.text = e.message;
            this._mode = this._codec = this._dual = null;
        }
        if (this._destroyed)
            return;
        if (this.actor.visible) // a wider battery line can shift the centre
            placeUnder(this._button, this.actor);
        this._battery.remove_style_pseudo_class('busy');
        this._paint();
    }

    _destroy() {
        this._destroyed = true;
        if (this._hideId)
            GLib.source_remove(this._hideId);
        Main.layoutManager.removeChrome(this.actor);
        this.actor.destroy();
    }
}
