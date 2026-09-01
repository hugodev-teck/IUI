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

        this._saveFile = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_config_dir(), 'prism-notifications.json']));
        this._loadHistory();

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

    _saveHistory() {
        let dataToSave = this.notifications.map(n => {
            // Aplatissement de l'icône et de l'application pour le JSON
            let iconStr = null;
            if (n.iconData) {
                if (typeof n.iconData === 'string') iconStr = n.iconData;
                else if (typeof n.iconData.to_string === 'function') iconStr = n.iconData.to_string();
            }

            let appId = null;
            if (n.app && typeof n.app.get_id === 'function') {
                appId = n.app.get_id();
            }

            return {
                id: n.id,
                title: n.title,
                message: n.message,
                appName: n.appName,
                time: n.time,
                timestamp: n.timestamp,
                iconStr: iconStr,
                appId: appId
            };
        });

        try {
            this._saveFile.replace_contents(JSON.stringify(dataToSave), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (e) {
            log(`[PrismUI] Erreur de sauvegarde des notifications : ${e.message}`);
        }
    }

    _loadHistory() {
        try {
            if (!this._saveFile.query_exists(null)) return;
            let [ok, contents] = this._saveFile.load_contents(null);
            if (ok) {
                let rawData = JSON.parse(new TextDecoder("utf-8").decode(contents));
                let now = Date.now();
                const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000; // ~1 mois en millisecondes

                const Shell = imports.gi.Shell;
                let appSys = Shell.AppSystem.get_default();

                this.notifications = [];
                for (let n of rawData) {
                    // Expiration : On ignore les messages vieux de plus d'un mois
                    if (now - n.timestamp > ONE_MONTH_MS) continue;

                    // Reconstruction des objets GNOME
                    let gicon = n.iconStr ? Gio.icon_new_for_string(n.iconStr) : null;
                    let app = n.appId ? appSys.lookup_app(n.appId) : null;

                    this.notifications.push({
                        id: n.id,
                        title: n.title,
                        message: n.message,
                        appName: n.appName,
                        time: n.time,
                        timestamp: n.timestamp,
                        iconData: gicon,
                        app: app
                    });
                }
            }
        } catch (e) {
            log(`[PrismUI] Erreur de chargement des notifications : ${e.message}`);
        }
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
        this.notificationButton.connect('enter-event', () => this._showNotificationTooltip());
        this.notificationButton.connect('leave-event', () => this._hideNotificationTooltip());
    
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

    _showNotificationTooltip() {
        if (!this.notificationTooltip) {
            this.notificationTooltip = new St.Label({
                style_class: 'prism-status-tooltip',
                text: 'Notifications',
                style: 'background-color: rgba(30, 30, 30, 0.9); color: white; padding: 6px 10px; border-radius: 5px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);'
            });
            Main.layoutManager.addChrome(this.notificationTooltip);
        }

        this.notificationTooltip.show();
        let [x, y] = this.notificationButton.get_transformed_position();
        let [width, height] = this.notificationButton.get_transformed_size();
        let monitor = Main.layoutManager.primaryMonitor;
        let tooltipWidth = this.notificationTooltip.width;
        let tooltipHeight = this.notificationTooltip.height;
        let tooltipX = x + (width - tooltipWidth) / 2;
        let tooltipY = y + height + 13;
        let minX = monitor.x + 8;
        let maxX = monitor.x + monitor.width - tooltipWidth - 8;
        let maxY = monitor.y + monitor.height - tooltipHeight - 8;

        tooltipX = Math.max(minX, Math.min(maxX, tooltipX));
        if (tooltipY > maxY) tooltipY = y - tooltipHeight - 8;
        tooltipY = Math.max(monitor.y + 8, Math.min(maxY, tooltipY));
        this.notificationTooltip.set_position(tooltipX, tooltipY);
    }

    _hideNotificationTooltip() {
        if (this.notificationTooltip) this.notificationTooltip.hide();
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

    _formatNotificationTime(notification) {
        if (!notification || typeof notification.timestamp !== 'number') {
            return notification && notification.time ? notification.time : 'Aujourd’hui';
        }

        const now = new Date();
        const notifDate = new Date(notification.timestamp);

        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const notifDay = new Date(notifDate.getFullYear(), notifDate.getMonth(), notifDate.getDate());
        const diffDays = Math.round((today - notifDay) / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            return notifDate.getHours().toString().padStart(2, '0') + ':' + notifDate.getMinutes().toString().padStart(2, '0');
        }

        if (diffDays === 1) {
            return 'Hier à ' + notifDate.getHours().toString().padStart(2, '0') + ':' + notifDate.getMinutes().toString().padStart(2, '0');
        }

        if (diffDays === 2) {
            return 'Avant-hier à ' + notifDate.getHours().toString().padStart(2, '0') + ':' + notifDate.getMinutes().toString().padStart(2, '0');
        }

        const day = notifDate.getDate().toString().padStart(2, '0');
        const months = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
        return `${day} ${months[notifDate.getMonth()]}`;
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
            this._saveHistory(); // NOUVEAU
            this._updateHistoryContainer();
        });

        headerBox.add_child(historyTitle);
        headerBox.add_child(this.dndBtn);
        headerBox.add_child(clearBtn);

        this.historyContainer.add_child(headerBox);

        // --- NOUVEAU : LA ZONE DÉFILANTE ---
        let scrollArea = new St.ScrollView({
            style_class: 'vfade',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
            y_expand: true
        });
        scrollArea.set_height(Math.max(260, monitor.height - 140));
        
        let listContainer = new St.BoxLayout({ 
            vertical: true,
            style: 'padding-right: 10px; padding-bottom: 7px; spacing: 3px;',
            y_align: Clutter.ActorAlign.START
        });
        listContainer.set_width(PANEL_WIDTH - 30);
        
        scrollArea.add_actor(listContainer);
        this.historyContainer.add_child(scrollArea);

        if (this.notifications.length === 0) {
            let emptyLabel = new St.Label({ text: "Aucune notification", style: "color: #888; padding: 15px; text-align: center;" });
            listContainer.add_child(emptyLabel);
        } else {
            this.notifications.slice().reverse().forEach(notification => { 
                const { id, title, message, appName, iconData, time, app } = notification;

                let notificationBox = new St.BoxLayout({
                    vertical: true,
                    name: 'notif-box-2',
                    style_class: 'notification-box',
                    style: 'padding: 7px;',
                    reactive: true,
                    y_align: Clutter.ActorAlign.START
                });
                notificationBox.set_width(PANEL_WIDTH - 60);

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
                
                const displayTime = this._formatNotificationTime(notification);
                let timeLabel = new St.Label({ text: displayTime, style_class: 'notification-time-label' });
                headerNotifBox.add_child(timeLabel);
                
                notificationBox.add_child(headerNotifBox);

                // --- 2. LE TEXTE COURT (Quand c'est fermé - 2 lignes max) ---
                let titleLabel = new St.Label({ 
                    text: title, 
                    style_class: 'notification-label',
                    style: 'font-weight: bold;' 
                });
                notificationBox.add_child(titleLabel);

                // --- 2. LE MESSAGE (Séparé, dynamique et légèrement plus clair) ---
                let messageLabel = null;
                let shortMsg = "";
                let needsTwoLines = false;
                
                if (message && message.trim() !== "") {
                    shortMsg = message.replace(/\n/g, ' ');
                    if (shortMsg.length > 80) {
                        shortMsg = shortMsg.substring(0, 80).trim() + '…';
                    }
                    needsTwoLines = shortMsg.length > 42;

                    messageLabel = new St.Label({ 
                        text: shortMsg, 
                        style_class: 'notification-label',
                        style: 'margin-top: 2px; margin-bottom: 4px; color: #dddddd; font-size: 13px;' 
                    });
                    messageLabel.set_width(PANEL_WIDTH - 50);
                    messageLabel.set_height(needsTwoLines ? 32 : 18);
                    messageLabel.clutter_text.line_wrap = true;
                    messageLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
                    messageLabel.clutter_text.lines = needsTwoLines ? 2 : 1;
                    messageLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                    notificationBox.add_child(messageLabel);
                }

                const baseBoxHeight = needsTwoLines ? 88 : 74;
                const expandedBoxHeight = baseBoxHeight + 39;
                notificationBox.set_height(baseBoxHeight);
                notificationBox._prismBaseHeight = baseBoxHeight;
                notificationBox._prismExpandedHeight = expandedBoxHeight;

                let actionBox = new St.BoxLayout({
                    name: 'notif-itm-box-2', 
                    vertical: false, 
                    style_class: 'notification-item-action-box',
                    style: 'margin-top: 2px; spacing: 8px; height: 22px; opacity: 0; visibility: hidden;'
                });
                actionBox.hide();

                if (app) {
                    let openBtn = new St.Button({
                        label: 'Ouvrir',
                        style_class: 'notification-item-btn',
                        x_expand: false,
                        y_align: Clutter.ActorAlign.CENTER,
                        style: 'padding: 2px 8px; height: 22px; font-size: 10px;'
                    });
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

                let deleteBtn = new St.Button({
                    label: 'Effacer',
                    style_class: 'notification-item-btn',
                    x_expand: false,
                    y_align: Clutter.ActorAlign.CENTER,
                    style: 'padding: 2px 8px; height: 22px; font-size: 10px;'
                });
                deleteBtn.connect('clicked', () => {
                    this.notifications = this.notifications.filter(n => n.id !== id);
                    this._saveHistory();
                    this._updateHistoryContainer();
                });
                actionBox.add_child(deleteBtn);

                notificationBox.add_child(actionBox);

                notificationBox.connect('button-release-event', (actor, event) => {
                    if (actionBox.contains(event.get_source())) return Clutter.EVENT_PROPAGATE;

                    let wasVisible = actionBox.visible;
                    listContainer.get_children().forEach(child => {
                        if (child !== notificationBox) {
                            if (child._prismActionsVisible) {
                                child._prismActionsVisible = false;
                                child.remove_style_class_name('notification-box-expanded');
                                child.set_height(child._prismBaseHeight || 74);
                                child.queue_relayout();
                            }

                            if (child.get_children) {
                                let actionChild = child.get_children().find(c => c.has_style_class_name && c.has_style_class_name('notification-item-action-box'));
                                if (actionChild) {
                                    actionChild.hide();
                                    actionChild.set_opacity(0);
                                }
                            }
                        }
                    });

                    if (wasVisible) {
                        actionBox.hide();
                        actionBox.set_opacity(0);
                        notificationBox.remove_style_class_name('notification-box-expanded');
                        notificationBox.set_height(notificationBox._prismBaseHeight || 74);
                        notificationBox.queue_relayout();
                        listContainer.queue_relayout();
                        notificationBox._prismActionsVisible = false;
                    } else {
                        actionBox.set_opacity(255);
                        actionBox.show();
                        notificationBox.add_style_class_name('notification-box-expanded');
                        notificationBox.set_height(notificationBox._prismExpandedHeight || 102);
                        notificationBox.queue_relayout();
                        listContainer.queue_relayout();
                        notificationBox._prismActionsVisible = true;
                    }

                    return Clutter.EVENT_PROPAGATE;
                });

                listContainer.add_child(notificationBox);
            });
        }
    }

    showNotification(title, message, appName = 'Système', iconData = null, app = null) {
        let now = new Date();
        let timeString = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
        let notifId = Date.now().toString() + Math.random().toString();
        let timestamp = Date.now();

        this.notifications.push({ 
            id: notifId, title, message, appName, iconData, time: timeString, app,
            timestamp: timestamp
        });
        
        // MODIFIÉ : On passe la limite à 100 pour laisser à l'expiration de 1 mois le temps d'agir
        if (this.notifications.length > 100) {
            this.notifications.shift(); 
        }

        this._saveHistory(); // Sauvegarde immédiate sur le disque

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
        
        let timeLabel = new St.Label({ text: this._formatNotificationTime({ timestamp: timestamp, time: timeString }), style_class: 'notification-time-label' });
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
        this._hideNotificationTooltip();

        if (this.notificationTooltip) {
            Main.layoutManager.removeChrome(this.notificationTooltip);
            this.notificationTooltip.destroy();
            this.notificationTooltip = null;
        }

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
                let rawMessage = notification.body || notification.bannerBodyText || "";
                let cleanMessage = rawMessage.replace(/<[^>]+>/g, '');
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

                this.showNotification(title, cleanMessage, appName, gicon, app);

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