// Loud red tags for things you shouldn't forget are on:
//   live      — the screen is being shared (a portal, a call). Click stops it.
//   rec 0:42  — GNOME's screen recorder is running. Click stops it.
//   mic off   — the default microphone is muted.
// They replace GNOME's own small sharing/recording icons (extension.js
// hides those with gateIcon and feeds their state here).
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {getMixerControl} from 'resource:///org/gnome/shell/ui/status/volume.js';

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
