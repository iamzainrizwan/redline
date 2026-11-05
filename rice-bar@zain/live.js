// Loud red tags for things you shouldn't forget are on:
//   live      — the screen is being shared (a portal, a call). Click stops it.
//   rec 0:42  — GNOME's screen recorder is running. Click stops it.
//   mic off   — the default microphone is muted.
// They replace GNOME's own small sharing/recording icons (extension.js
// hides those with gateIcon and feeds their state here).
//
// And a quieter pair, mic discord — which apps are listening to a
// microphone right now (red-bright names, no block); it replaces GNOME's
// orange mic privacy icon.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {getMixerControl} from 'resource:///org/gnome/shell/ui/status/volume.js';

import {addPair} from './util.js';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

// apps that show up as recording only because they draw an input meter
// (GNOME skips the same two)
const METER_APPS = ['org.gnome.VolumeControl', 'org.PulseAudio.pavucontrol',
    'pavucontrol', 'gnome-control-center'];
// streams start and stop on their own (a call connecting, a pause), with no
// mixer signal; re-check this often while any stream exists
const POLL_SECONDS = 5;

const Tag = GObject.registerClass(
class Tag extends PanelMenu.Button {
    _init(name, onClick = null) {
        super._init(0.0, name, true);
        this.add_style_class_name('rice-alert');
        this._label = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._label);
        this.hide();
        if (onClick) {
            this.connect('button-press-event', () => {
                onClick();
                return Clutter.EVENT_STOP;
            });
        } else {
            this.setSensitive(false);
        }
    }

    set text(text) {
        this._label.text = text ?? '';
        this.visible = !!text;
    }
});

// live / rec: extension.js calls setSharing/setRecording from GNOME's
// indicators; the recorder's elapsed time is read off its own label.
export const Live = GObject.registerClass(
class Live extends Tag {
    _init() {
        super._init('live', () => {
            if (this._recording)
                Main.screenshotUI.stopScreencast();
            if (this._sharing)
                Main.panel.statusArea.screenSharing?._stopSharing();
        });
        this._sharing = false;
        this._recording = false;
        Main.panel.statusArea.screenRecording?._label?.connectObject(
            'notify::text', () => this._sync(), this);
    }

    setSharing(sharing) {
        this._sharing = sharing;
        this._sync();
    }

    setRecording(recording) {
        this._recording = recording;
        this._sync();
    }

    _sync() {
        const elapsed = Main.panel.statusArea.screenRecording?._label?.text ?? '';
        const parts = [];
        if (this._sharing)
            parts.push('live');
        if (this._recording)
            parts.push(elapsed ? `rec ${elapsed}` : 'rec');
        this.text = parts.join(' ');
    }
});

export const MicOff = GObject.registerClass(
class MicOff extends Tag {
    _init() {
        super._init('mic off');
        this._control = getMixerControl();
        this._control.connectObject(
            'default-source-changed', () => this._track(),
            'state-changed', () => this._track(),
            this);
        this._track();
    }

    _track() {
        this._source?.disconnectObject(this);
        this._source = this._control.get_default_source();
        this._source?.connectObject('notify::is-muted', () => this._sync(), this);
        this._sync();
    }

    _sync() {
        this.text = this._source?.is_muted ? 'mic off' : '';
    }
});

// "Discord" → "discord", "zen-bin" → "zen"
function appName(binary) {
    return binary.toLowerCase().replace(/[-.]bin$/, '');
}

async function pactl(...args) {
    const proc = Gio.Subprocess.new(['pactl', '-f', 'json', ...args],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
    const [stdout] = await proc.communicate_utf8_async(null, null);
    if (!proc.get_successful())
        throw new Error(`pactl ${args.join(' ')} failed`);
    return JSON.parse(stdout);
}

export const MicInUse = GObject.registerClass(
class MicInUse extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'mic in use', true);
        this.add_style_class_name('rice-micuse');
        this.setSensitive(false);
        this.hide();
        const box = new St.BoxLayout({style_class: 'rice-pairs'});
        this.add_child(box);
        [, this._value] = addPair(box, 'mic');
        this._value.add_style_class_name('hot');

        this._control = getMixerControl();
        this._control.connectObject(
            'stream-added', () => this._queue(),
            'stream-removed', () => this._queue(),
            'state-changed', () => this._queue(),
            this);
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POLL_SECONDS, () => {
            if (this._control.get_source_outputs().length)
                this._queue();
            else
                this.hide();
            return GLib.SOURCE_CONTINUE;
        });
        this.connect('destroy', () => {
            GLib.source_remove(this._timer);
            if (this._idle)
                GLib.source_remove(this._idle);
            this._destroyed = true;
        });
        this._queue();
    }

    // a burst of stream signals → one check
    _queue() {
        this._idle ||= GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            this._idle = 0;
            this._check();
            return GLib.SOURCE_REMOVE;
        });
    }

    async _check() {
        let names;
        try {
            const [outputs, sources] = await Promise.all([
                pactl('list', 'source-outputs'), pactl('list', 'short', 'sources')]);
            const mics = new Set(sources
                .filter(s => !s.name.endsWith('.monitor')).map(s => s.index));
            names = outputs
                .filter(o => !o.corked && mics.has(o.source))
                .map(o => o.properties ?? {})
                .filter(p => !METER_APPS.includes(p['application.id']) &&
                    !METER_APPS.includes(p['application.process.binary']))
                .map(p => appName(p['application.process.binary'] ??
                    p['application.name'] ?? 'app'));
        } catch (e) {
            // no pactl: fall back to the mixer's own (vaguer) stream names
            names = this._control.get_source_outputs()
                .filter(o => !METER_APPS.includes(o.get_application_id()))
                .map(o => appName(o.get_name() ?? 'app'));
        }
        if (this._destroyed)
            return;
        const text = [...new Set(names)].sort().join(' ');
        this._value.text = text;
        this.visible = !!text;
    }
});
