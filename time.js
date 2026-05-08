/*                                                                */
/*       Copyright (c) Project PRISM. All rights reserved.        */
/*         This software is licensed under the CC BY-NC           */
/*          Full text of the license can be found at              */
/*   https://creativecommons.org/licenses/by-nc/4.0/legalcode.en  */
/*                                                                */

const { St, GObject, Gio, Clutter, GLib } = imports.gi;
const Main = imports.ui.main;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

var TimeMachine = class TimeMachine {
    constructor() {
        this.clockContainer = new St.BoxLayout({name: 'clk-cont', vertical: true, style_class: 'clock-container' });
        this.clockLabel = new St.Label({ text: this._getFormattedTime(), style_class: 'clock-label', y_align: Clutter.ActorAlign.CENTER, x_align: Clutter.ActorAlign.CENTER });
        this.dateLabel = new St.Label({ text: this._getFormattedDate(), style_class: 'date-label', y_align: Clutter.ActorAlign.CENTER, x_align: Clutter.ActorAlign.CENTER });
        
        this.clockContainer.add_child(this.clockLabel);
        this.clockContainer.add_child(this.dateLabel);

        Main.layoutManager._backgroundGroup.add_child(this.clockContainer);

        this._monitorId = Main.layoutManager.connect('monitors-changed', () => this._setPosition());

        this._updateClock();
        
        [500, 1500].forEach(delay => {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                if (this.clockContainer) this._setPosition();
                return GLib.SOURCE_REMOVE;
            });
        });
        
        this._clockTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            this._updateClock();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _getFormattedTime() {
        let now = new Date();
        let hours = String(now.getHours()).padStart(2, '0');
        let minutes = String(now.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
    }

    _getFormattedDate() {
        let now = new Date();
        let day = now.toLocaleString('fr-FR', { weekday: 'long' });
        let date = String(now.getDate()).padStart(2, '0');
        let month = now.toLocaleString('fr-FR', { month: 'long' });
        let year = now.getFullYear();
        return `${day} ${date} ${month} ${year}`;
    }

    _updateClock() {
        this.clockLabel.set_text(this._getFormattedTime());
        this.dateLabel.set_text(this._getFormattedDate());

        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (this.clockContainer) this._setPosition();
            return GLib.SOURCE_REMOVE;
        });
    }

    _setPosition() {
        let monitor = Main.layoutManager.primaryMonitor;
        if (!monitor || !this.clockContainer || this.clockContainer.width <= 0) return;
    
        let containerWidth = this.clockContainer.width;
        let containerHeight = this.clockContainer.height;
        
        let targetX = Math.round(monitor.x + (monitor.width - containerWidth) / 2);
        let targetY = Math.round(monitor.y + (monitor.height / 6)); 

        let currentX = Math.round(this.clockContainer.x);
        let currentY = Math.round(this.clockContainer.y);
    
        if (currentX !== targetX || currentY !== targetY) {
            this.clockContainer.set_position(targetX, targetY);
        }
    }

    destroy() {
        if (this._monitorId) {
            Main.layoutManager.disconnect(this._monitorId);
            this._monitorId = 0;
        }
        if (this._clockTimeoutId) {
            GLib.Source.remove(this._clockTimeoutId);
            this._clockTimeoutId = 0;
        }
        if (this.clockContainer) {
            this.clockContainer.destroy();
            this.clockContainer = null;
        }
    }
};