/*                                                                */
/*       Copyright (c) Project PRISM. All rights reserved.        */
/*         This software is licensed under the CC BY-NC           */
/*          Full text of the license can be found at              */
/*   https://creativecommons.org/licenses/by-nc/4.0/legalcode.en  */
/*                                                                */

const { St, GLib, Gio, Clutter } = imports.gi;
const Main = imports.ui.main;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

var NotificationManager = class NotificationManager {
    constructor() {
        this.notifications = [];

        // Conteneur de notifications temporaires (pop-up)
        this.notificationContainer = new St.BoxLayout({
            vertical: true,
            style_class: 'notification-container'
        });
        Main.layoutManager.addChrome(this.notificationContainer);
        this.notificationContainer.hide();

        // Positionner le conteneur de notifications en haut à gauche
        this.notificationContainer.set_position(20, 20);

        this._setupNotificationListener();

        // Ajouter l'icône de cloche en bas à gauche
        this._createNotificationIcon();
    }

    _createNotificationIcon() {
        // Créer l'icône de notification
        this.notificationIcon = new St.Icon({
            gicon: Gio.icon_new_for_string(`${Me.path}/icons/interface/notification/bell-white.png`),
            style_class: 'notification-icon',
            icon_size: 26
        });
    
        // Créer le bouton de notification
        this.notificationButton = new St.Button({
            child: this.notificationIcon,
            style_class: 'notification-button'
        });
    
        this.notificationButton.connect('clicked', () => {
            this._toggleNotificationHistory();
        });
    
        // Créer la boîte de notification
        this.notificationBox = new St.BoxLayout({
            vertical: false,
            style_class: 'notification-box-container',
            x_expand: true,
            y_expand: true
        });
    
        // Ajouter le bouton à la boîte
        this.notificationBox.add_child(this.notificationButton);

        // Ajouter le conteneur au groupe backgroundGroup
        Main.layoutManager._backgroundGroup.add_child(this.notificationBox);

        Main.layoutManager._backgroundGroup.set_child_below_sibling(this.notificationBox, null);
    
        this.notificationBox.connect('notify::width', () => {
            this._setPosition();
        });

        // Créer le conteneur pour l'historique des notifications
        this.historyContainer = new St.BoxLayout({
            vertical: true,
            style_class: 'notification-history-container'
        });
        Main.layoutManager.addChrome(this.historyContainer);
        this.historyContainer.hide();
    }

    _setPosition() {
        let monitor = Main.layoutManager.primaryMonitor;
        let topOffset = 23;
        let horizontalOffset = 10;
    
        let barReseau = global.barReseau; 
        
        if (!barReseau || !barReseau.container) {
             let posX = monitor.x + monitor.width - this.notificationBox.width - horizontalOffset;
             let posY = monitor.y + topOffset;
             this.notificationBox.set_position(posX, posY);
             return;
        }
        
        let barX = barReseau.container.x;
    
        let posX = barX - this.notificationBox.width - horizontalOffset;
        let posY = monitor.y + topOffset;
    
        this.notificationBox.set_position(posX, posY);
    }

    _toggleNotificationHistory() {
        if (this.historyContainer.visible) {
            this.historyContainer.hide();
        } else {
            this._updateHistoryContainer();
            this.historyContainer.show();
        }
    }

    _updateHistoryContainer() {
        // Vider le conteneur d'historique avant de le remplir
        this.historyContainer.remove_all_children();

        // Ajout du titre de l'historique
        let historyTitle = new St.Label({
            text: 'Historique des Notifications',
            style_class: 'notification-history-title'
        });
        this.historyContainer.add_child(historyTitle);

        // CORRECTION 1: Utiliser .slice().reverse() pour éviter de modifier le tableau this.notifications
        this.notifications.slice().reverse().forEach(notification => { 
            const { title, message, appName, iconUrl } = notification;

            let notificationBox = new St.BoxLayout({
                vertical: true,
                style_class: 'notification-box',
                style: 'width: 400px; padding: 5px; margin-bottom: 5px;' 
            });

            let headerBox = new St.BoxLayout({
                vertical: false,
                style_class: 'notification-header-box'
            });

            if (iconUrl) {
                try {
                    let appIcon = new St.Icon({
                        gicon: Gio.icon_new_for_string(iconUrl),
                        icon_size: 16,
                        style_class: 'notification-app-icon'
                    });
                    headerBox.add_child(appIcon);
                } catch (e) {
                    log(`Erreur lors du chargement de l'icône pour ${appName}: ${e.message}`);
                }
            }

            let appNameLabel = new St.Label({
                text: appName || 'Application Inconnue',
                style_class: 'notification-app-name'
            });
            headerBox.add_child(appNameLabel);
            notificationBox.add_child(headerBox);

            let notificationLabel = new St.Label({
                text: `${title}\n${message}`,
                style_class: 'notification-label'
            });
            notificationBox.add_child(notificationLabel);
            this.historyContainer.add_child(notificationBox);
        });
        
        // Définir les marges demandées
        const MARGIN_LEFT = 10;
        const MARGIN_TOP = 23;
        const HISTORY_MAX_WIDTH = 420;

        // 1. Forcer le calcul de la hauteur (inchangé)
        let [minHeight, natHeight] = this.historyContainer.get_preferred_height(HISTORY_MAX_WIDTH);
        let historyHeight = natHeight; 
        
        // 2. Appliquer la taille (inchangé)
        this.historyContainer.set_size(HISTORY_MAX_WIDTH, historyHeight); 
        
        // 3. Définir les nouvelles positions absolues par rapport au moniteur principal
        let monitor = Main.layoutManager.primaryMonitor;
        
        let posX = monitor.x + MARGIN_LEFT;
        let posY = monitor.y + MARGIN_TOP; 
        
        // Appliquer la position
        this.historyContainer.set_position(posX, posY);
    }

    /**
     * Affiche une notification temporaire et l'ajoute à l'historique.
     */
    showNotification(title, message, appName = 'Système', iconUrl = null) {
        log('une notification doit apparaitre');

        this.notifications.push({ title, message, appName, iconUrl });

        const boxWidth = 400; 

        let notificationBox = new St.BoxLayout({
            vertical: true,
            style_class: 'notification-box',
            style: `width: ${boxWidth}px;` // Fixer la largeur par style
        });

        let headerBox = new St.BoxLayout({
            vertical: false,
            style_class: 'notification-header-box'
        });

        if (iconUrl) {
            try {
                let appIcon = new St.Icon({
                    gicon: Gio.icon_new_for_string(iconUrl),
                    icon_size: 16,
                    style_class: 'notification-app-icon'
                });
                headerBox.add_child(appIcon);
            } catch (e) {
                log(`Erreur lors du chargement de l'icône pour ${appName} (temp): ${e.message}`);
            }
        }

        let appNameLabel = new St.Label({
            text: appName,
            style_class: 'notification-app-name'
        });
        headerBox.add_child(appNameLabel);
        
        notificationBox.add_child(headerBox);

        let notificationLabel = new St.Label({
            text: `${title}\n${message}`,
            style_class: 'notification-label'
        });

        notificationBox.add_child(notificationLabel);

        this.notificationContainer.add_child(notificationBox);
        this.notificationContainer.show();

        // Supprimer la boîte après 5 secondes
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
            this.notificationContainer.remove_child(notificationBox);
            if (this.notificationContainer.get_n_children() === 0) {
                this.notificationContainer.hide();
            }
            return GLib.SOURCE_REMOVE; 
        });
    }

    _setupNotificationListener() {
        log('setup ok');
        let source = new Clutter.Actor();
        // Si vous connectez un signal 'message' avec le format "Title::Message::AppName::IconUrl",
        // vous devrez adapter le code ici pour extraire les 4 arguments et appeler this.showNotification().
    }
    
};

function init() {
    // Code d'initialisation ici
}

function enable() {
    global.notificationManager = new NotificationManager();
}

function disable() {
    if (global.notificationManager) {
        // Nettoyage complet
        Main.layoutManager.removeChrome(global.notificationManager.notificationContainer);
        Main.layoutManager.removeChrome(global.notificationManager.historyContainer);
        if (global.notificationManager.notificationBox.get_parent()) {
             global.notificationManager.notificationBox.get_parent().remove_child(global.notificationManager.notificationBox);
        }
    }
    global.notificationManager = null;
}