const { St, GLib, Gio, Clutter } = imports.gi;
const Main = imports.ui.main;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

var NotificationManager = class NotificationManager {
    constructor() {
        this.notifications = [];

        // Conteneur de notifications temporaires
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

        // Réordonner les enfants pour placer le conteneur en arrière-plan
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
    
        // Supposons que tu as accès à la barre réseau
        let barReseau = global.barReseau; // À exposer depuis l'autre constructeur
        let barX = barReseau.container.x;
    
        // Position horizontale : à gauche de la barre réseau avec un offset
        let posX = barX - this.notificationBox.width - horizontalOffset;
    
        // Position verticale : même top offset que la barre réseau
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

        // Ajouter chaque notification de l'historique au conteneur
        this.notifications.forEach(notification => {

            let boxWidth = 400;
            let boxHeight = 55;

            // Créer la boîte de notification
            let notificationBox = new St.BoxLayout({
                vertical: true,
                style_class: 'notification-box'
            });

            notificationBox.set_size(boxWidth, boxHeight);

            let notificationLabel = new St.Label({
                text: `${notification.title}\n${notification.message}`,
                style_class: 'notification-label'
            });

            notificationBox.add_child(notificationLabel);

            this.historyContainer.add_child(notificationBox);
        });
    }

    showNotification(title, message) {
        log('une notification doit apparaitre');

        // Ajouter la notification à l'historique
        this.notifications.push({ title, message });

        let boxWidth = 400;
        let boxHeight = 55;

        // Créer la boîte de notification
        let notificationBox = new St.BoxLayout({
            vertical: true,
            style_class: 'notification-box'
        });

        notificationBox.set_size(boxWidth, boxHeight);

        // Créer le label avec le message
        let notificationLabel = new St.Label({
            text: `${title}\n${message}`,
            style_class: 'notification-label'
        });

        notificationBox.add_child(notificationLabel);

        // Ajouter la boîte au conteneur de notifications temporaires
        this.notificationContainer.add_child(notificationBox);
        this.notificationContainer.show();

        // Supprimer la boîte après 5 secondes
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
            this.notificationContainer.remove_child(notificationBox);
            if (this.notificationContainer.get_n_children() === 0) {
                this.notificationContainer.hide();
            }
            return GLib.SOURCE_REMOVE; // Arrêter la temporisation
        });
    }

    _setupNotificationListener() {
        log('setup ok');
        let source = new Clutter.Actor();
        source.connect('notify::message', (actor, property) => {
            log(`Notification received: ${property}`);
            let [summary, body] = property.split('\n');
            this.showNotification(summary, body);
        });
    }
    
};

function init() {
    // Code d'initialisation ici
}

function enable() {
    // Crée une instance de NotificationManager lorsque l'extension est activée
    global.notificationManager = new NotificationManager();
}

function disable() {
    // Code pour désactiver l'extension ici
    global.notificationManager = null;
}