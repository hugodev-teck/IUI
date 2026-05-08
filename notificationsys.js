/*                                                                */
/*       Copyright (c) Project PRISM. All rights reserved.        */
/*         This software is licensed under the CC BY-NC           */
/*          Full text of the license can be found at              */
/*   https://creativecommons.org/licenses/by-nc/4.0/legalcode.en  */
/*                                                                */

const { St, GLib, Gio, Clutter, Pango, Shell } = imports.gi;
const Main = imports.ui.main;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

var NotificationManager = class NotificationManager {
    constructor() {
        this.notifications = [];
        this.soundEnabled = true;
        this.dndEnabled = false;

        this.notificationContainer = new St.BoxLayout({
            vertical: true,
            style_class: 'notification-container'
        });
        Main.layoutManager.addChrome(this.notificationContainer);
        this.notificationContainer.hide();
        this.notificationContainer.set_position(20, 20);

        this._setupNotificationListener();
        this._createNotificationIcon();
    }

    _createNotificationIcon() {
        this.notificationIcon = new St.Icon({
            gicon: Gio.icon_new_for_string(`${Me.path}/icons/interface/notification/bell-white.png`),
            style_class: 'notification-icon',
            icon_size: 26
        });
    
        this.notificationButton = new St.Button({
            child: this.notificationIcon,
            style_class: 'notification-button'
        });
        this.notificationButton.connect('clicked', () => this._toggleNotificationHistory());
    
        this.notificationBox = new St.BoxLayout({
            vertical: false,
            style_class: 'notification-box-container'
        });
        this.notificationBox.add_child(this.notificationButton);

        Main.layoutManager._backgroundGroup.add_child(this.notificationBox);
        
        this.notificationBox.connect('notify::allocation', () => this._setPosition());

        const Mainloop = imports.mainloop;
        Mainloop.idle_add(() => {
            if (this.notificationBox) {
                this._setPosition();
            }
            return GLib.SOURCE_REMOVE;
        });

        this._notifMonitorId = Main.layoutManager.connect('monitors-changed', () => {
            this._setPosition();
        });

        this.historyContainer = new St.BoxLayout({
            vertical: true,
            name: 'notif-hst-cont',
            style_class: 'notification-history-container'
        });
        Main.layoutManager.addChrome(this.historyContainer);
        this.historyContainer.hide();
    }

    _setPosition() {
        let monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;
        
        let topOffset = 23;
        let horizontalOffset = 10;
        let barReseau = global.barReseau; 
        
        let newX, newY;
        
        if (!barReseau || !barReseau.container || barReseau.container.x === 0) {
             newX = monitor.x + monitor.width - this.notificationBox.width - horizontalOffset;
        } else {
             newX = barReseau.container.x - this.notificationBox.width - horizontalOffset;
        }
        newY = monitor.y + topOffset;

        if (this.notificationBox.x !== newX || this.notificationBox.y !== newY) {
            this.notificationBox.set_position(newX, newY);
        }
    }

    _toggleNotificationHistory() {
        if (this.historyContainer.visible) {
            if (this._stageEventId) {
                global.stage.disconnect(this._stageEventId);
                this._stageEventId = null;
            }
            this.historyContainer.hide();
        } else {
            this._updateHistoryContainer();
            this.historyContainer.show();
            
            if (!this._stageEventId) {
                this._stageEventId = global.stage.connect('captured-event', (actor, event) => {
                    if (event.type() === Clutter.EventType.BUTTON_PRESS) {
                        let target = event.get_source();
                        
                        if (target && (this.historyContainer.contains(target) || this.notificationBox.contains(target))) {
                            return Clutter.EVENT_PROPAGATE;
                        }
                        
                        this._toggleNotificationHistory();
                        
                        return Clutter.EVENT_PROPAGATE;
                    }
                    return Clutter.EVENT_PROPAGATE;
                });
            }
        }
    }

    _updateDndIcon() {
        if (!this.dndBtn) return;
        let iconName = this.dndEnabled ? 'notifications-disabled-symbolic' : 'preferences-system-notifications-symbolic';
        this.dndBtn.set_child(new St.Icon({ icon_name: iconName, icon_size: 16 }));
        if(this.dndEnabled) this.dndBtn.add_style_class_name('dnd-active');
        else this.dndBtn.remove_style_class_name('dnd-active');
    }

    _updateHistoryContainer() {
        this.historyContainer.remove_all_children();

        let monitor = Main.layoutManager.primaryMonitor;
        const MARGIN = 20;
        const PANEL_WIDTH = 420;
        
        this.historyContainer.set_size(PANEL_WIDTH, monitor.height - (MARGIN * 2));
        this.historyContainer.set_position(monitor.x + MARGIN, monitor.y + MARGIN);

        let headerBox = new St.BoxLayout({name: 'notif-hd-box', vertical: false, style_class: 'notification-history-header', style: 'margin-bottom: 15px;' });

        let historyTitle = new St.Label({
            text: 'Historique des Notifications',
            style_class: 'notification-history-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER
        });

        this.dndBtn = new St.Button({ style_class: 'notification-action-btn', y_align: Clutter.ActorAlign.CENTER });
        this._updateDndIcon();
        this.dndBtn.connect('clicked', () => {
            this.dndEnabled = !this.dndEnabled;
            this._updateDndIcon();
            Main.osdWindowManager.show(0, Gio.icon_new_for_string('preferences-system-notifications-symbolic'), this.dndEnabled ? "Mode concentration activé" : "Mode concentration désactivé", null);
        });

        let clearBtn = new St.Button({ style_class: 'notification-action-btn', y_align: Clutter.ActorAlign.CENTER });
        clearBtn.set_child(new St.Icon({ icon_name: 'edit-clear-all-symbolic', icon_size: 16 }));
        clearBtn.connect('clicked', () => {
            this.notifications = [];
            this._updateHistoryContainer();
        });

        headerBox.add_child(historyTitle);
        headerBox.add_child(this.dndBtn);
        headerBox.add_child(clearBtn);

        this.historyContainer.add_child(headerBox);

        if (this.notifications.length === 0) {
            let emptyLabel = new St.Label({ text: "Aucune notification", style: "color: #888; padding: 15px; text-align: center;" });
            this.historyContainer.add_child(emptyLabel);
        } else {
            this.notifications.slice().reverse().forEach(notification => { 
                const { id, title, message, appName, iconData, time, app } = notification;

                let notificationBox = new St.BoxLayout({
                    vertical: true,
                    name: 'notif-box-2',
                    style_class: 'notification-box',
                    style: 'padding: 8px; margin-bottom: 8px;',
                    reactive: true
                });

                let headerNotifBox = new St.BoxLayout({name: 'notif-box-3-bs', vertical: false, style_class: 'notification-header-box' });

                if (iconData) {
                    try {
                        let gicon = (typeof iconData === 'string') ? Gio.icon_new_for_string(iconData) : iconData;
                        headerNotifBox.add_child(new St.Icon({ gicon: gicon, icon_size: 16, style_class: 'notification-app-icon' }));
                    } catch (e) {}
                }

                let appNameLabel = new St.Label({
                    text: appName || 'Système',
                    style_class: 'notification-app-name',
                    x_expand: true
                });
                appNameLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                headerNotifBox.add_child(appNameLabel);
                
                let timeLabel = new St.Label({ text: time, style_class: 'notification-time-label' });
                headerNotifBox.add_child(timeLabel);
                
                notificationBox.add_child(headerNotifBox);

                let bodyText = message ? `${title}\n${message}` : title;
                let notificationLabel = new St.Label({ text: bodyText, style_class: 'notification-label' });
                notificationLabel.clutter_text.line_wrap = true;
                notificationLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
                notificationBox.add_child(notificationLabel);

                let actionBox = new St.BoxLayout({name: 'notif-itm-box-2', vertical: false, style_class: 'notification-item-action-box' });
                actionBox.hide();

                if (app) {
                    let openBtn = new St.Button({ label: 'Ouvrir', style_class: 'notification-item-btn', x_expand: true });
                    openBtn.connect('clicked', () => {

                        let isRunning = app.get_state() === Shell.AppState.RUNNING;

                        if (isRunning) {
                            let appNameStr = app.get_name() || "L'application";
                            Main.osdWindowManager.show(
                                0, 
                                Gio.icon_new_for_string('dialog-information-symbolic'), 
                                `${appNameStr} est déjà ouverte`, 
                                null
                            );
                        } else {

                            if (this._stageEventId) {
                                global.stage.disconnect(this._stageEventId);
                                this._stageEventId = null;
                            }
                            this.historyContainer.hide();

                            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                            if (app.activate) {
                                app.activate(); 
                            } else if (app.get_app_info) {
                                app.get_app_info().launch([], null); 
                            }
                            return GLib.SOURCE_REMOVE;
                        });
                        }
                        
                    });
                    actionBox.add_child(openBtn);
                }

                let deleteBtn = new St.Button({ label: 'Effacer', style_class: 'notification-item-btn', x_expand: true });
                deleteBtn.connect('clicked', () => {
                    this.notifications = this.notifications.filter(n => n.id !== id);
                    this._updateHistoryContainer();
                });
                actionBox.add_child(deleteBtn);

                notificationBox.add_child(actionBox);

                notificationBox.connect('button-release-event', () => {
                    if (actionBox.visible) {
                        actionBox.hide();
                        notificationBox.remove_style_class_name('notification-box-expanded');
                    } else {
                        actionBox.show();
                        notificationBox.add_style_class_name('notification-box-expanded');
                    }
                    return Clutter.EVENT_PROPAGATE;
                });

                this.historyContainer.add_child(notificationBox);
            });
        }
    }

    showNotification(title, message, appName = 'Système', iconData = null, app = null) {
        let now = new Date();
        let timeString = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
        let notifId = Date.now().toString() + Math.random().toString();

        this.notifications.push({ id: notifId, title, message, appName, iconData, time: timeString, app });
        
        if (this.notifications.length > 10) {
            this.notifications.shift(); 
        }

        if (this.historyContainer.visible) {
            this._updateHistoryContainer();
        }

        if (this.dndEnabled) return;

        if (this.soundEnabled) {
            try {
                let soundPlayer = global.display.get_sound_player();
                soundPlayer.play_from_theme('message', 'Notification PrismUI', null);
            } catch (e) {}
        }

        let notificationWrapper = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            reactive: true
        });

        let notificationBox = new St.BoxLayout({
            vertical: true,
            name: 'notif-box-5',
            style_class: 'notification-box',
            style: 'padding: 8px;'
        });
        notificationBox.set_width(400);

        let headerBox = new St.BoxLayout({name: 'notif-hd-box-2', vertical: false, style_class: 'notification-header-box' });

        if (iconData) {
            try {
                let gicon = (typeof iconData === 'string') ? Gio.icon_new_for_string(iconData) : iconData;
                headerBox.add_child(new St.Icon({ gicon: gicon, icon_size: 16, style_class: 'notification-app-icon' }));
            } catch (e) {}
        }

        let appNameLabel = new St.Label({
            text: appName,
            style_class: 'notification-app-name',
            x_expand: true
        });
        appNameLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        headerBox.add_child(appNameLabel);
        
        let timeLabel = new St.Label({ text: timeString, style_class: 'notification-time-label' });
        headerBox.add_child(timeLabel);

        notificationBox.add_child(headerBox);

        let bodyText = message ? `${title}\n${message}` : title;
        let notificationLabel = new St.Label({ text: bodyText, style_class: 'notification-label' });
        notificationLabel.clutter_text.line_wrap = true;
        notificationLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;

        notificationBox.add_child(notificationLabel);

        let overlayBtn = new St.Button({
            style_class: 'notification-hover-overlay',
            opacity: 0 
        });

        overlayBtn.add_constraint(new Clutter.BindConstraint({
            source: notificationBox,
            coordinate: Clutter.BindCoordinate.SIZE
        }));

        let deleteIcon = new St.Icon({
            icon_name: 'window-close-symbolic',
            icon_size: 48,
            style_class: 'notification-hover-icon',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER
        });
        
        overlayBtn.set_child(deleteIcon);

        notificationWrapper.add_child(notificationBox);
        notificationWrapper.add_child(overlayBtn);

        notificationWrapper.connect('enter-event', () => {
            overlayBtn.opacity = 255;
            return Clutter.EVENT_PROPAGATE;
        });

        notificationWrapper.connect('leave-event', () => {
            overlayBtn.opacity = 0;
            return Clutter.EVENT_PROPAGATE;
        });

        overlayBtn.connect('clicked', () => {
            if (notificationWrapper.get_parent() === this.notificationContainer) {
                this.notificationContainer.remove_child(notificationWrapper);
            }
            if (this.notificationContainer.get_n_children() === 0) {
                this.notificationContainer.hide();
            }
        });

        this.notificationContainer.add_child(notificationWrapper);
        this.notificationContainer.show();

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
            if (notificationWrapper.get_parent() === this.notificationContainer) {
                this.notificationContainer.remove_child(notificationWrapper);
            }
            if (this.notificationContainer.get_n_children() === 0) {
                this.notificationContainer.hide();
            }
            return GLib.SOURCE_REMOVE; 
        });
    }

    destroy() {
        if (this._stageEventId) {
            global.stage.disconnect(this._stageEventId);
            this._stageEventId = null;
        }

        if (this._notifMonitorId) {
            Main.layoutManager.disconnect(this._notifMonitorId);
            this._notifMonitorId = 0;
        }

        if (this._sourceAddedSignal) {
            Main.messageTray.disconnect(this._sourceAddedSignal);
            this._sourceAddedSignal = null;
        }

        if (this.notificationContainer) {
            Main.layoutManager.removeChrome(this.notificationContainer);
            this.notificationContainer.destroy();
            this.notificationContainer = null;
        }

        if (this.historyContainer) {
            Main.layoutManager.removeChrome(this.historyContainer);
            this.historyContainer.destroy();
            this.historyContainer = null;
        }

        if (this.notificationBox && this.notificationBox.get_parent()) {
            this.notificationBox.get_parent().remove_child(this.notificationBox);
            this.notificationBox.destroy();
            this.notificationBox = null;
        }
    }

    _setupNotificationListener() {
        this._sourceAddedSignal = Main.messageTray.connect('source-added', (tray, source) => {
            let notifAddedSignal = source.connect('notification-added', (source, notification) => {
                let title = notification.title || "Nouvelle notification";
                let message = notification.body || notification.bannerBodyText || "";
                let appName = source.title || "Système";
                let gicon = notification.gicon || source.icon || Gio.icon_new_for_string('dialog-information-symbolic');
                let app = source.app || null;

                if (!app) {
                    let appSys = Shell.AppSystem.get_default();
                    if (source.appInfo) {
                        app = appSys.lookup_app(source.appInfo.get_id());
                    } else if (source.id) {
                        app = appSys.lookup_app(source.id + '.desktop') || appSys.lookup_app(source.id);
                    }
                }

                this.showNotification(title, message, appName, gicon, app);

                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    try {
                        if (notification) notification.destroy();
                    } catch (e) {}
                    return GLib.SOURCE_REMOVE;
                });
            });

            source.connect('destroy', () => {
                try { source.disconnect(notifAddedSignal); } catch (e) {}
            });
        });
    }
};

function init() {}
function enable() { global.notificationManager = new NotificationManager(); }
function disable() {
    if (global.notificationManager) {
        global.notificationManager.destroy();
        global.notificationManager = null;
    }
}