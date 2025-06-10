const NM = imports.gi.NM;
const { St, Clutter, GLib } = imports.gi;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Lang = imports.lang;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const NotificationManager = Me.imports.notificationsys.NotificationManager;
const SearchBar = Me.imports.intelligentsearchbar.SearchBar;
const TimeMachine = Me.imports.time.TimeMachine;
const Util = imports.misc.util;
const { ByteArray } = imports.byteArray;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Gdk = imports.gi.Gdk;

let searchBar;
let pollingId;
let previousWindow = null;
let notificationManager = new NotificationManager();
let myDock;
let menu = null;
let networkSetting;
let menunet = null;
let wifiMenu = null;
let bleMenu = null;
let Volmenu = null;
let Accesmenu = null;
let monitor;

class MyDock {
    constructor() {
        this._constructbar();
        
    }
    _constructbar(){
        this.container = new St.BoxLayout({ style_class: 'my-dock-container' });

        this.addCustomIconMenu(`${ExtensionUtils.getCurrentExtension().path}/icons/logo.png`);
        this.addCustomIcon(`${ExtensionUtils.getCurrentExtension().path}/icons/dw.png`);
        this.addCustomIcon(`${ExtensionUtils.getCurrentExtension().path}/icons/bt.png`);
        this.addCustomIcon(`${ExtensionUtils.getCurrentExtension().path}/icons/dc.png`);
        this.addAppIcon('firefox.desktop');
        this.addAppIcon('org.gnome.Terminal.desktop');
        this.addAppIcon('org.gnome.Nautilus.desktop');
        // Ajouter le conteneur au groupe backgroundGroup
        Main.layoutManager._backgroundGroup.add_child(this.container);

        // Réordonner les enfants pour placer le conteneur en arrière-plan
        Main.layoutManager._backgroundGroup.set_child_below_sibling(this.container, null);

          // Se connecter au signal "notify::width" pour ajuster la position après que la taille soit définie
          this.container.connect('notify::allocation', () => {
            this._setPosition();
        });

        // Initialement positionner le conteneur
        this._setPosition();
    }

    addAppIcon(desktopFile) {
        let appInfo = Gio.DesktopAppInfo.new(desktopFile);
        if (!appInfo) {
            log(`App not found: ${desktopFile}`);
            return;
        }

        let icon = new St.Button({ style_class: 'app-icon' });
        let gicon = appInfo.get_icon();
        let iconImage = new St.Icon({ gicon: gicon, icon_size: 50 });

        icon.set_child(iconImage);

        icon.connect('clicked', () => {
            appInfo.launch([], null);
        });

        this.container.add_child(icon);
    }

    addCustomIconMenu(iconPath) {
        let icon = new St.Button({
            style_class: 'app-icon'
        });

        let fileIcon = new Gio.FileIcon({ file: Gio.File.new_for_path(iconPath) });
        let iconImage = new St.Icon({
            gicon: fileIcon,
            icon_size: 50
        });

        icon.set_child(iconImage);

        let pressStartTime = null;
        const longPressDuration = 3000; // 3 secondes en millisecondes

        icon.connect('button-press-event', (actor, event) => {
            if (event.get_button() === 1) { // Vérifie si le bouton gauche est pressé
                pressStartTime = Date.now(); // Marquer le début de l'appui
            }
        });

        icon.connect('button-release-event', (actor, event) => {
            if (event.get_button() === 1 && pressStartTime) {
                let pressDuration = Date.now() - pressStartTime; // Calculer la durée de l'appui
                pressStartTime = null; // Réinitialiser le temps d'appui

                if (pressDuration >= longPressDuration) {
                    // Éteindre le PC après un appui prolongé
                    this._shutdownPC();
                } else {
                    // Exécuter l'action normale si l'appui est court
                    if (menu) {
                        menu.destroy();
                        menu = null;
                    } else {
                        menu = this._openAppMenu();
                    }
                }
            }
        });

        this.container.add_child(icon);
    }

    _shutdownPC() {
        // Commande pour éteindre le PC
        GLib.spawn_command_line_async('systemctl poweroff');
    }

    addCustomIcon(iconPath) {
        let icon = new St.Button({ style_class: 'app-icon' });

        // Utiliser un chemin d'accès pour charger l'image PNG
        let fileIcon = new Gio.FileIcon({ file: Gio.File.new_for_path(iconPath) });
        let iconImage = new St.Icon({
            gicon: fileIcon,
            icon_size: 50
        });

        icon.set_child(iconImage);

        // Ajouter une action ouvrir un menu par exemple
        icon.connect('clicked', () => {
            // Implémenter l'action souhaitée ici
        });

        // Insérer au début du container
        this.container.insert_child_at_index(icon, 1);
    }

    _openAppMenu() {
        let menuWidth = Math.floor(Main.layoutManager.primaryMonitor.width * 0.25);
        let menuHeight = Math.floor(Main.layoutManager.primaryMonitor.height * 0.75);
        let menuX = Math.floor((Main.layoutManager.primaryMonitor.width - menuWidth) / 2);
        let menuY = Math.floor((Main.layoutManager.primaryMonitor.height - menuHeight) / 2);
    
        let menu = new St.BoxLayout({
            vertical: true,
            style_class: 'app-menu'
        });
    
        menu.set_position(menuX, menuY);
        menu.set_size(menuWidth, menuHeight);
    
        // Créer la barre de recherche
        let searchEntry = new St.Entry({
            style_class: 'search-entry',
            hint_text: 'Rechercher...',
            can_focus: true,
            x_expand: true
        });
    
        menu.add_child(searchEntry);
    
        // Créer un label pour le texte en haut de la liste
        let headerLabel = new St.Label({
            text: "Liste des Applications",
            style_class: 'header-text'
        });
    
        // Ajouter le label en haut du menu
        menu.add_child(headerLabel);
    
        let scrollView = new St.ScrollView({
            style_class: 'app-menu-scrollview',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC
        });
    
        let appList = new St.BoxLayout({
            vertical: true,
            style_class: 'app-list'
        });
    
        let appInfos = Gio.AppInfo.get_all();
        let sortedAppInfos = appInfos.sort((a, b) => {
            return a.get_display_name().localeCompare(b.get_display_name());
        });
    
        let currentLetter = null;
        let appItems = []; // Stocker les éléments d'application pour filtrage
    
        sortedAppInfos.forEach((appInfo) => {
            let appName = appInfo.get_display_name();
            let firstLetter = appName[0].toUpperCase();
    
            // Ajouter un en-tête pour chaque nouvelle lettre
            if (firstLetter !== currentLetter) {
                currentLetter = firstLetter;
                let header = new St.Label({
                    text: currentLetter,
                    style_class: 'alphabet-header'
                });
                appList.add_child(header);
                appItems.push({ header, type: 'header', visible: true }); // Ajouter l'en-tête à la liste d'éléments
            }
    
            // Créer un conteneur pour chaque application
            let appBox = new St.BoxLayout({
                style_class: 'app-box',
                reactive: true,
                can_focus: true,
                visible: true
            });
    
            let gicon = appInfo.get_icon();
            let icon = new St.Icon({
                gicon: gicon,
                icon_size: 32,
                style_class: 'app-icon'
            });
    
            let label = new St.Label({
                text: appName,
                y_align: Clutter.ActorAlign.CENTER
            });
    
            appBox.add_child(icon);
            appBox.add_child(label);
    
            appBox.connect('button-press-event', () => {
                appInfo.launch([], null);
                menu.destroy();
                menu = null;
            });
    
            appList.add_child(appBox);
            appItems.push({ appBox, appInfo, type: 'app', visible: true }); // Ajouter l'application à la liste d'éléments
        });
    
        // Filtrer les applications en fonction de la recherche
        searchEntry.get_clutter_text().connect('text-changed', () => {
            let searchText = searchEntry.get_text().toLowerCase();
            appList.remove_all_children();
    
            let currentLetter = null;
            let anyAppsDisplayed = false; // Vérifier si des applications sont affichées après le filtrage
    
            appItems.forEach(({ header, appBox, appInfo, type }) => {
                if (type === 'header') {
                    // Ajouter l'en-tête si nécessaire et si des applications correspondantes sont trouvées
                    let hasMatchingApps = appItems.some(({ appInfo }) => appInfo && appInfo.get_display_name().toLowerCase().startsWith(header.text.toLowerCase()) && appInfo.get_display_name().toLowerCase().includes(searchText));
    
                    header.visible = hasMatchingApps;
                    if (hasMatchingApps) {
                        appList.add_child(header);
                        currentLetter = header.text;
                    }
                } else if (type === 'app' && appInfo.get_display_name().toLowerCase().includes(searchText)) {
                    // Ajouter l'application filtrée
                    let appName = appInfo.get_display_name();
                    let firstLetter = appName[0].toUpperCase();
    
                    if (firstLetter !== currentLetter) {
                        currentLetter = firstLetter;
                        let newHeader = new St.Label({
                            text: currentLetter,
                            style_class: 'alphabet-header'
                        });
                        appList.add_child(newHeader);
                        currentLetter = firstLetter;
                    }
    
                    appList.add_child(appBox);
                    appBox.visible = true;
                    anyAppsDisplayed = true;
                } else {
                    appBox.visible = false; // Masquer les applications qui ne correspondent pas
                }
            });
    
            // Masquer les en-têtes sans applications correspondantes après le filtrage
            appItems.filter(item => item.type === 'header' && item.visible).forEach(({ header }) => {
                if (!appList.get_children().includes(header)) {
                    header.visible = false;
                }
            });
    
            // Afficher un message si aucune application n'est trouvée
            if (!anyAppsDisplayed) {
                let noResultsLabel = new St.Label({
                    text: "Aucune application trouvée",
                    style_class: 'no-results-label'
                });
                appList.add_child(noResultsLabel);
            }
        });
    
        scrollView.add_actor(appList);
        menu.add_child(scrollView);
    
        Main.layoutManager.addChrome(menu);
    
        menu.connect('destroy', () => {
            Main.layoutManager.removeChrome(menu);
        });
    
        return menu;
    }
    

    _setPosition() {
        let monitor = Main.layoutManager.primaryMonitor;

        let bottomOffset = 25;

        // Calculer la position horizontale centrale
        let centerX = Math.floor((monitor.width / 2) - (this.container.width / 2));
        let posY = monitor.height - this.container.height - bottomOffset;

        // Ajuster la position du conteneur
        this.container.set_position(centerX, posY);
    }

    destroy() {
        this.container.destroy();
    }
}

class NetworkSetting {
    constructor() {
        // Définir les chemins des icônes
        let wifiButtonPath = `${ExtensionUtils.getCurrentExtension().path}/icons/interface/wthicon/wifiwth.png`;
        let soundButtonPath = `${ExtensionUtils.getCurrentExtension().path}/icons/interface/wthicon/volumewth.png`;
        let batteryButtonPath = `${ExtensionUtils.getCurrentExtension().path}/icons/interface/wthicon/battery-fullwth.png`;

        global.barReseau = this;

        this.wifiMenu = null;
        this.bleMenu = null;

        // Créer le conteneur principal
        this.container = new St.BoxLayout({
            style_class: 'network-settings-container',
            vertical: false // Horizontal alignment
        });

        // Créer des boutons avec les icônes spécifiées
        this.wifiButton = this.createButtons(wifiButtonPath);
        this.soundButton = this.createButtons(soundButtonPath);
        this.batteryButton = this.createButtons(batteryButtonPath);
        this.keybtn = this.createButtonsKey()

        // Ajouter les boutons au conteneur principal
        this.container.add_child(this.keybtn);
        this.container.add_child(this.wifiButton);
        this.container.add_child(this.soundButton);
        this.container.add_child(this.batteryButton);

        // Ajouter le conteneur au groupe backgroundGroup
        Main.layoutManager._backgroundGroup.add_child(this.container);

        // Réordonner les enfants pour placer le conteneur en arrière-plan
        Main.layoutManager._backgroundGroup.set_child_below_sibling(this.container, null);

        // Se connecter au signal "notify::width" pour ajuster la position après que la taille soit définie
        this.container.connect('notify::allocation', () => {
            this._setPosition();
        });

        // Initialement positionner le conteneur
        this._setPosition();
    }

    createButtons(iconPath) {
        let button = new St.Button({
            style_class: 'feature-button-net',
            reactive: true,
            track_hover: true,
            can_focus: true
        });

        let icon = new St.Icon({
            gicon: Gio.icon_new_for_string(iconPath),
            style_class: 'feature-icon-net',
            icon_size: 20
        });

        button.set_child(icon);
        
        // Connecter l'événement de clic sur le bouton
        button.connect('clicked', () => {
            if (menunet) {
                // Le menu est déjà ouvert, donc on le ferme
                menunet.destroy();
                menunet = null; // Réinitialiser la référence du menu
                if (wifiMenu) {
                    // Le menu Wi-Fi est déjà ouvert, donc on le ferme
                    wifiMenu.destroy();
                    wifiMenu = null; // Réinitialiser la référence du menu Wi-Fi
                }
                if (Volmenu) {
                    log('Destroying existing sound menu');
                    Volmenu.destroy();
                    Volmenu = null;
                }
                if (bleMenu) {
                    log('Destroying existing Bluetooth menu');
                    bleMenu.destroy();
                    bleMenu = null;
                }
            } else {
                menunet = this._handleBarClick(); // Stocker la référence du menu ouvert
                log('open');
            }
        });

        return button;
    }

    createButtonsKey() {
        let button = new St.Button({
            style_class: 'feature-button-net',
            reactive: true,
            track_hover: true,
            can_focus: true
        });
    
        let icon = new St.Icon({
            gicon: Gio.icon_new_for_string(`${ExtensionUtils.getCurrentExtension().path}/icons/interface/key/keyboardw.png`),
            style_class: 'feature-icon-net',
            icon_size: 20
        });
    
        button.set_child(icon);
        
        // Connecter l'événement de clic sur le bouton
        button.connect('clicked', () => {
            
        });
    
        return button;
    }

    _setPosition() {
        let primaryMonitor = Main.layoutManager.primaryMonitor;
        let containerWidth = this.container.width;
        let containerHeight = this.container.height;
    
        let topOffset = 23;
    
        let posX = primaryMonitor.x + primaryMonitor.width - containerWidth - 20;
        let posY = primaryMonitor.y + topOffset;
    
        this.container.set_position(posX, posY);
    }

    createFeatureButton(iconPath, labelText) {
        let button = new St.Button({
            style_class: 'feature-button',
            reactive: true
        });

        let icon = new St.Icon({
            gicon: Gio.icon_new_for_string(iconPath),
            style_class: 'feature-icon',
            icon_size: 32
        });

        let label = new St.Label({
            text: labelText,
            style_class: 'feature-label'
        });

        let box = new St.BoxLayout({
            vertical: true,
            style_class: 'feature-box'
        });

        box.add_child(icon);
        box.add_child(label);
        button.set_child(box);

        return button;
    }

    async _wifimenu() {
        let menuwfWidth = 280;
        let menuwfHeight = 310;
        let menuwfX = Math.floor((Main.layoutManager.primaryMonitor.x + Main.layoutManager.primaryMonitor.width - menuwfWidth) - 20);
        
        let topOffset = 110;
        let menuwfY = Main.layoutManager.primaryMonitor.y + topOffset;
    
        let menuwf = new St.BoxLayout({
            vertical: true,
            style_class: 'net-box'
        });
    
        let header = new St.BoxLayout({
            vertical: false,
            style_class: 'header-wifi'
        });
    
        let title = new St.Label({
            text: 'Wi-Fi et connexion',
            style_class: 'label-title'
        });
    
        // Créer un bouton bascule pour le Wi-Fi
        let wifiSwitch = new PopupMenu.PopupSwitchMenuItem('', await this.getWifiState(), { reactive: true });
    
        // Gérez l'événement de changement d'état de l'interrupteur
        wifiSwitch.connect('toggled', async (item, state) => {
            await this.setWifiState(state);
        });
    
        header.add_child(title);
        header.add_child(wifiSwitch.actor);
    
        menuwf.add_child(header);
    
        let networkList = new St.BoxLayout({
            vertical: true,
            style_class: 'network-list'
        });
    
        menuwf.add_child(networkList);
    
        let networks = await this.getAvailableNetworks();
        networks.forEach(network => {
            let networkItem = new St.BoxLayout({
                vertical: false,
                style_class: 'network-item'
            });
    
            let ssidLabel = new St.Label({
                text: network.ssid,
                style_class: 'network-ssid'
            });
    
            let strengthLabel = new St.Label({
                text: `${network.strength}%`,
                style_class: 'network-strength'
            });
    
            let connectedLabel = new St.Label({
                text: network.active ? 'Connecté' : '',
                style_class: 'network-connected'
            });
    
            networkItem.add_child(ssidLabel);
            networkItem.add_child(strengthLabel);
            networkItem.add_child(connectedLabel);
    
            networkList.add_child(networkItem);
        });
    
        menuwf.set_position(menuwfX, menuwfY);
        menuwf.set_size(menuwfWidth, menuwfHeight);
    
        Main.layoutManager.addChrome(menuwf);
    
        menuwf.connect('destroy', () => {
            Main.layoutManager.removeChrome(menuwf);
        });
    
        return menuwf;
    }
    
    async _blemenu() {
        let menubleWidth = 280;
        let menubleHeight = 310;
        let menubleX = Math.floor((Main.layoutManager.primaryMonitor.x + Main.layoutManager.primaryMonitor.width - menubleWidth) - 20);
        
        let topOffset = 110;
        let menubleY = Main.layoutManager.primaryMonitor.y + topOffset;
        
    
        // Vérifier l'état du service Bluetooth
        let serviceActive = await this.isBluetoothServiceActive();
        
        if (!serviceActive) {
            notificationManager.showNotification("Le service Bluetooth est inactif", "Veuillez activer le service Bluetooth pour continuer.");
            return null;
        }
    
        // Création du menu Bluetooth
        let menuble = new St.BoxLayout({
            vertical: true,
            style_class: 'net-box'
        });
    
        let header = new St.BoxLayout({
            vertical: false,
            style_class: 'header-bluetooth'
        });
    
        let title = new St.Label({
            text: 'Bluetooth et connexion',
            style_class: 'label-title'
        });
    
        let onoffbutton = new St.Button({
            style_class: 'feature-bluetooth',
            reactive: true
        });
    
        let bluetoothEnabled = await this.getBluetoothState();
        let bluetoothOnIconPath = `${ExtensionUtils.getCurrentExtension().path}/icons/interface/toggle/toggle-button-off.png`;
        let bluetoothOffIconPath = `${ExtensionUtils.getCurrentExtension().path}/icons/interface/toggle/toggle-button-on.png`;
        let bluetoothIconPath = bluetoothEnabled ? bluetoothOffIconPath : bluetoothOnIconPath;
    
        let icon = new St.Icon({
            gicon: Gio.icon_new_for_string(bluetoothIconPath),
            style_class: 'feature-icon',
            icon_size: 32
        });
    
        header.add_child(title);
        header.add_child(onoffbutton);
        onoffbutton.set_child(icon);
    
        menuble.add_child(header);
    
        let deviceList = new St.BoxLayout({
            vertical: true,
            style_class: 'device-list'
        });
    
        menuble.add_child(deviceList);
    
        let devices = await this.getBluetoothDevices();
        devices.forEach(device => {
            let deviceItem = new St.BoxLayout({
                vertical: false,
                style_class: 'device-item'
            });
    
            let deviceNameLabel = new St.Label({
                text: device.name,
                style_class: 'device-name'
            });
    
            let deviceStatusLabel = new St.Label({
                text: device.connected ? 'Connecté' : 'Non connecté',
                style_class: 'device-status'
            });
    
            deviceItem.add_child(deviceNameLabel);
            deviceItem.add_child(deviceStatusLabel);
    
            deviceList.add_child(deviceItem);
        });
    
        menuble.set_position(menubleX, menubleY);
        menuble.set_size(menubleWidth, menubleHeight);
    
        Main.layoutManager.addChrome(menuble);
    
        menuble.connect('destroy', () => {
            Main.layoutManager.removeChrome(menuble);
        });
    
        return menuble;
    }
    
    async isBluetoothServiceActive() {
        try {
            let subprocess = new Gio.Subprocess({
                argv: ['systemctl', 'is-active', 'bluetooth'],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
    
            subprocess.init(null);
    
            let result = await new Promise((resolve, reject) => {
                subprocess.communicate_utf8_async(null, null, (proc, res) => {
                    try {
                        let [ok, stdout, stderr] = proc.communicate_utf8_finish(res);
                        if (!ok) {
                            reject(new Error('Failed to execute systemctl'));
                            return;
                        }
                        resolve(stdout.toString().trim() === 'active');
                    } catch (error) {
                        reject(error);
                    }
                });
            });
    
            return result;
        } catch (error) {
            logError(error, 'Failed to check Bluetooth service status');
            return false;
        }
    }

    async getWifiState() {
        let client = NM.Client.new(null);
        try {
            let wifiDevices = client.get_devices();
            for (let i = 0; i < wifiDevices.length; i++) {
                let device = wifiDevices[i];
                if (device.device_type === NM.DeviceType.WIFI) {
                    return device.state === NM.DeviceState.ACTIVATED;
                }
            }
            return false;
        } catch (error) {
            logError(error, 'Failed to get Wi-Fi state');
            return false;
        }
    }
    
    async getAvailableNetworks() {
        let client = NM.Client.new(null);
        let networks = [];
    
        try {
            let wifiDevices = client.get_devices();
            for (let i = 0; i < wifiDevices.length; i++) {
                let device = wifiDevices[i];
                if (device.device_type === NM.DeviceType.WIFI) {
                    let wirelessDevice = device;
                    let accessPoints = wirelessDevice.get_access_points();
                    for (let j = 0; j < accessPoints.length; j++) {
                        let ap = accessPoints[j];
                        networks.push({
                            ssid: ap.get_ssid().to_string(),
                            strength: ap.get_strength(),
                            active: device.get_active_access_point() === ap
                        });
                    }
                    break;
                }
            }
        } catch (error) {
            logError(error, 'Failed to get available networks');
        }
    
        return networks;
    }

    async getBluetoothState() {
        try {
            let subprocess = new Gio.Subprocess({
                argv: ['bluetoothctl', 'show'],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
    
            subprocess.init(null);
    
            let result = await new Promise((resolve, reject) => {
                subprocess.communicate_utf8_async(null, null, (proc, res) => {
                    try {
                        let [ok, stdout, stderr] = proc.communicate_utf8_finish(res);
                        if (!ok) {
                            reject(new Error('Failed to execute bluetoothctl'));
                            return;
                        }
                        resolve(stdout.toString());
                    } catch (error) {
                        reject(error);
                    }
                });
            });
    
            return result.includes('Powered: yes');
        } catch (error) {
            logError(error, 'Failed to retrieve Bluetooth state');
            return false;
        }
    }
    
    async getBluetoothState() {
        log('Attempting to get Bluetooth state');
    
        try {
            let subprocess = new Gio.Subprocess({
                argv: ['bluetoothctl', 'show'],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
    
            subprocess.init(null);
    
            log('Subprocess created, running bluetoothctl');
    
            let result = await new Promise((resolve, reject) => {
                subprocess.communicate_utf8_async(null, null, (proc, res) => {
                    try {
                        let [ok, stdout, stderr] = proc.communicate_utf8_finish(res);
                        if (!ok) {
                            log('Failed to execute bluetoothctl');
                            reject(new Error('Failed to execute bluetoothctl'));
                            return;
                        }
                        if (stderr) {
                            log('Error output from bluetoothctl: ' + stderr);
                        }
                        resolve(stdout.toString());
                    } catch (error) {
                        logError(error, 'Failed to finish communication with subprocess');
                        reject(error);
                    }
                });
            });
    
            log('bluetoothctl output: ' + result);
    
            return result.includes('Powered: yes');
        } catch (error) {
            logError(error, 'Failed to retrieve Bluetooth state');
            return false;
        }
    }

    async _volumeMenu() {
        // Dimensions et positions
        let menuWidth = 280;
        let menuHeight = 310;
        let menuX = Math.floor((Main.layoutManager.primaryMonitor.x + Main.layoutManager.primaryMonitor.width - menuWidth) - 20);

        let topOffset = 110;
        let menuY = Main.layoutManager.primaryMonitor.y + topOffset;
    
        // Création du menu Volume
        let volumeMenu = new St.BoxLayout({
            vertical: true,
            style_class: 'net-box'
        });
    
        let header = new St.BoxLayout({
            vertical: false,
            style_class: 'header-volume'
        });
    
        let title = new St.Label({
            text: 'Contrôle du Volume',
            style_class: 'label-title-2'
        });
    
        header.add_child(title);
        volumeMenu.add_child(header);

        let title2b = new St.Label({
            text: 'Volume principale :',
            style_class: 'vol-text'
        });

        volumeMenu.add_child(title2b);
    
        // Création de la barre de volume
        let volumeSliderContainer = new St.BoxLayout({
            style_class: 'volume-slider-container',
            reactive: true,
            track_hover: true,
            width: menuWidth,
            height: 30 // Ajuster la hauteur si nécessaire
        });
    
        let volumeIndicator = new St.Widget({
            style_class: 'volume-indicator',
            reactive: true,
            width: 0 // Initialement 0, mis à jour dynamiquement
        });
    
        volumeSliderContainer.add_child(volumeIndicator);
        volumeMenu.add_child(volumeSliderContainer);
    
        // Initialiser la barre de volume
        try {
            let volume = await this._getCurrentVolume();
            if (volume !== null) {
                volumeIndicator.set_width((volume / 100) * menuWidth);
            }
        } catch (error) {
            log("Erreur lors de l'initialisation du contrôle du volume : " + error.message);
        }
    
        volumeSliderContainer.connect('button-press-event', (actor, event) => {
            this._handleVolumeChange(event, volumeSliderContainer);
        });
    
        volumeSliderContainer.connect('motion-event', (actor, event) => {
            this._handleVolumeChange(event, volumeSliderContainer);
        });
    
        volumeMenu.set_position(menuX, menuY);
        volumeMenu.set_size(menuWidth, menuHeight);
    
        Main.layoutManager.addChrome(volumeMenu);
    
        volumeMenu.connect('destroy', () => {
            Main.layoutManager.removeChrome(volumeMenu);
        });
    
        return volumeMenu;
    }
    
    _handleVolumeChange(event, volumeSliderContainer) {
        let [x, y] = event.get_coords();
    
        // Obtenir la position et les dimensions du conteneur
        let [containerX, containerY] = volumeSliderContainer.get_transformed_position();
        let containerWidth = volumeSliderContainer.width;
        
        if (containerWidth > 0) {
            let relativeX = x - containerX;
    
            // Calculer le volume en pourcentage
            let newVolume = Math.round((relativeX / containerWidth) * 100);
            newVolume = Math.min(Math.max(newVolume, 0), 100);
    
            this._setVolume(newVolume);
            this._updateVolumeIndicator(newVolume, volumeSliderContainer);
        } else {
            log("Erreur : La largeur du conteneur est nulle ou invalide.");
        }
    }
    
    _updateVolumeIndicator(volume, volumeSliderContainer) {
        let containerWidth = volumeSliderContainer.width;
        let volumeWidth = (volume / 100) * containerWidth;
    
        let volumeIndicator = volumeSliderContainer.get_children()[0];
        if (volumeIndicator) {
            volumeIndicator.set_width(volumeWidth);
        }
    }
        
    
    async _getCurrentVolume() {
        try {
            // Exécute une commande système pour obtenir le volume actuel via `pactl`
            let [success, output] = GLib.spawn_command_line_sync('pactl get-sink-volume @DEFAULT_SINK@');
    
            if (!success) {
                throw new Error('Erreur lors de l\'exécution de pactl.');
            }
    
            // Convertir la sortie en chaîne de caractères
            let outputStr = new TextDecoder().decode(output);
    
            log('Sortie brute de pactl : ' + outputStr); // Ajout du log pour le débogage
    
            // Cherche le volume en pourcentage après '100%' dans la sortie
            let match = outputStr.match(/(\d+)% /); // Il y a un espace après le pourcentage
    
            if (!match) {
                throw new Error('Impossible de trouver le volume dans la sortie de pactl.');
            }
    
            // Convertir le pourcentage en nombre
            let volume = parseInt(match[1], 10);
    
            if (isNaN(volume)) {
                throw new Error('Le volume récupéré n\'est pas un nombre.');
            }
            log('sortie est de ' + volume);
            // Retourner le volume comme un nombre entre 0 et 100
            return volume;
    
        } catch (e) {
            log("Erreur lors de la récupération du volume : " + e.message);
            return null; // Retourne null ou une valeur par défaut en cas d'erreur
        }
    }
    
    _setVolume(volume) {
        // Utiliser `pactl` pour définir le volume
        GLib.spawn_command_line_async(`pactl set-sink-volume @DEFAULT_SINK@ ${volume}%`);
    }

    async _accessibilityMenu() {
        // Dimensions et positions
        let menuWidth = 280;
        let menuHeight = 310;
        let menuX = Math.floor((Main.layoutManager.primaryMonitor.x + Main.layoutManager.primaryMonitor.width - menuWidth) - 20);

        let topOffset = 110;
        let menuY = Main.layoutManager.primaryMonitor.y + topOffset;
    
        // Création du menu d'accessibilité
        let menu = new St.BoxLayout({
            vertical: true,
            style_class: 'net-box'
        });
    
        let header = new St.BoxLayout({
            vertical: false,
            style_class: 'header-accessibility'
        });
    
        let title = new St.Label({
            text: 'Options d\'accessibilité',
            style_class: 'label-title'
        });
    
        header.add_child(title);
        menu.add_child(header);
    
        // Liste des options d'accessibilité
        let optionsList = new St.BoxLayout({
            vertical: true,
            style_class: 'options-list'
        });
    
        menu.add_child(optionsList);
    
        // Liste des paramètres d'accessibilité avec leurs clés et schémas
        let settings = [
            { schema: 'org.gnome.desktop.a11y.applications', key: 'screen-keyboard-enabled', name: 'Clavier à l\'écran' },
            { schema: 'org.gnome.desktop.a11y.applications', key: 'screen-magnifier-enabled', name: 'Loupe d\'écran' },
            { schema: 'org.gnome.desktop.a11y.applications', key: 'screen-reader-enabled', name: 'Lecteur d\'écran' },
            { schema: 'org.gnome.desktop.a11y.interface', key: 'high-contrast', name: 'Contraste élevé' }
            // Ajouter d'autres paramètres selon vos besoins
        ];
    
        settings.forEach(setting => {
            let item = new St.BoxLayout({
                vertical: false,
                style_class: 'option-item'
            });
    
            let label = new St.Label({
                text: setting.name,
                style_class: 'option-label'
            });
    
            // Crée un bouton pour activer/désactiver
            let button = new St.Button({
                style_class: 'option-button',
                reactive: true
            });
    
            let iconPathOn = `${ExtensionUtils.getCurrentExtension().path}/icons/interface/toggle/toggle-button-on.png`; // Chemin de l'icône pour l'état activé
            let iconPathOff = `${ExtensionUtils.getCurrentExtension().path}/icons/interface/toggle/toggle-button-off.png`; // Chemin de l'icône pour l'état désactivé
    
            let icon = new St.Icon({
                gicon: Gio.icon_new_for_string(this._getSetting(setting.schema, setting.key) ? iconPathOn : iconPathOff),
                style_class: 'option-icon',
                icon_size: 24
            });
    
            button.set_child(icon);
    
            button.connect('button-press-event', () => {
                let currentState = this._getSetting(setting.schema, setting.key);
                let newState = !currentState;
                this._setSetting(setting.schema, setting.key, newState);
    
                // Mettre à jour l'icône en fonction de l'état
                icon.gicon = Gio.icon_new_for_string(newState ? iconPathOn : iconPathOff);
            });
    
            item.add_child(label);
            item.add_child(button);
    
            optionsList.add_child(item);
        });
    
        menu.set_position(menuX, menuY);
        menu.set_size(menuWidth, menuHeight);
    
        Main.layoutManager.addChrome(menu);
    
        menu.connect('destroy', () => {
            Main.layoutManager.removeChrome(menu);
        });
    
        return menu;
    }
    
    _getSetting(schema, settingKey) {
        try {
            // Crée un objet Gio.Settings pour le schéma donné
            let settings = Gio.Settings.new(schema);
            // Retourne la valeur de la clé demandée
            return settings.get_value(settingKey).deep_unpack();
        } catch (e) {
            log(`Erreur lors de la récupération du paramètre ${settingKey}: ${e.message}`);
            return null; // Retourne null en cas d'erreur
        }
    }
    
    _setSetting(schema, settingKey, value) {
        try {
            // Crée un objet Gio.Settings pour le schéma donné
            let settings = Gio.Settings.new(schema);
            // Définit la valeur de la clé demandée
            settings.set_value(settingKey, GLib.Variant.new_boolean(value));
        } catch (e) {
            log(`Erreur lors de la définition du paramètre ${settingKey}: ${e.message}`);
        }
    }

    _handleBarClick() {
        let menunetWidth = 267;
        let menunetHeight = 420;
        let menunetX = Math.floor((Main.layoutManager.primaryMonitor.x + Main.layoutManager.primaryMonitor.width - menunetWidth) - 20);
    
        let topOffset = 110;
        let menunetY = Main.layoutManager.primaryMonitor.y + topOffset;
    
        let menunet = new St.BoxLayout({
            vertical: true,
            style_class: 'net-box'
        });
    
        menunet.set_position(menunetX, menunetY);
        menunet.set_size(menunetWidth, menunetHeight);
    
        // Create labels for time and date
        let timeLabel = new St.Label({
            style_class: 'time-label'
        });
    
        let dateLabel = new St.Label({
            style_class: 'date-label'
        });
    
        // Update time and date every second
        let updateTimeDate = () => {
            let now = new Date();
            let timeString = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            let dateString = now.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    
            timeLabel.set_text(timeString);
            dateLabel.set_text(dateString);
        };
    
        updateTimeDate();
        let timeUpdateInterval = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            updateTimeDate();
            return GLib.SOURCE_CONTINUE;
        });
    
        // Create a "Connexion" button
        let connexionButton = new St.Button({
            label: 'Connexion à PrismID',
            style_class: 'connexion-button'
        });
    
        connexionButton.connect('clicked', () => {
            openConnectionPopup();
        });
    
        // Add timeLabel, dateLabel, and connexionButton to menunet
        menunet.add_child(timeLabel);
        menunet.add_child(dateLabel);
        menunet.add_child(connexionButton);
    
        // Create two columns for the feature buttons
        let column1 = new St.BoxLayout({
            vertical: true,
            style_class: 'feature-column'
        });
    
        let column2 = new St.BoxLayout({
            vertical: true,
            style_class: 'feature-column'
        });
    
        // Add feature buttons to the columns
        let wifiButton = this.createFeatureButton(`${ExtensionUtils.getCurrentExtension().path}/icons/interface/blcicon/wifiblc.png`, 'Wi-Fi');
        let bluetoothButton = this.createFeatureButton(`${ExtensionUtils.getCurrentExtension().path}/icons/interface/blcicon/bluetoothblc.png`, 'Bluetooth');
        let soundButton = this.createFeatureButton(`${ExtensionUtils.getCurrentExtension().path}/icons/interface/blcicon/volumeblc.png`, 'Son');
        let batteryButton = this.createFeatureButton(`${ExtensionUtils.getCurrentExtension().path}/icons/interface/blcicon/battery-fullblc.png`, 'Batterie');
        let airplaneButton = this.createFeatureButton(`${ExtensionUtils.getCurrentExtension().path}/icons/interface/blcicon/plane-altblc.png`, 'Mode Avion');
        let accessibilityButton = this.createFeatureButton(`${ExtensionUtils.getCurrentExtension().path}/icons/interface/blcicon/universal-accessblc.png`, 'Accessibilité');
    
        // Connect click events for the buttons
        wifiButton.connect('clicked', async () => {
            try {
                log('Wi-Fi button clicked');
                if (wifiMenu) {
                    log('Destroying existing Wi-Fi menu');
                    wifiMenu.destroy();
                    wifiMenu = null;
                } else {
                    log('Creating new Wi-Fi menu');
                    wifiMenu = await this._wifimenu();
                    menunet.destroy();
                    menunet = null; // Réinitialiser la référence du menu
                }
            } catch (error) {
                log(`Error handling Wi-Fi button click: ${error}`);
            }
        });

        airplaneButton.connect('clicked', async () => {
            GLib.spawn_command_line_async('gnome-control-center network');
        });

        batteryButton.connect('clicked', async () => {
            GLib.spawn_command_line_async('gnome-control-center power');
        });
    
        bluetoothButton.connect('clicked', async () => {
            try {
                log('Bluetooth button clicked');
                if (bleMenu) {
                    log('Destroying existing Bluetooth menu');
                    bleMenu.destroy();
                    bleMenu = null;
                } else {
                    log('Creating new Bluetooth menu');
                    bleMenu = await this._blemenu();
                    menunet.destroy();
                    menunet = null; // Réinitialiser la référence du menu
                }
            } catch (error) {
                log(`Error handling Bluetooth button click: ${error}`);
            }
        });

        soundButton.connect('clicked', async () => {
            try {
                log('sound button clicked');
                if (Volmenu) {
                    log('Destroying existing sound menu');
                    Volmenu.destroy();
                    Volmenu = null;
                } else {
                    log('Creating new sound menu');
                    Volmenu = await this._volumeMenu();
                    menunet.destroy();
                    menunet = null; // Réinitialiser la référence du menu
                }
            } catch (error) {
                log(`Error handling sound button click: ${error}`);
            }
        });
        
        accessibilityButton.connect('clicked', async () => {
            try {
                log('acces button clicked');
                if (Accesmenu) {
                    log('Destroying existing acces menu');
                    Accesmenu.destroy();
                    Accesmenu = null;
                } else {
                    log('Creating new acces menu');
                    Accesmenu = await this._accessibilityMenu();
                    menunet.destroy();
                    menunet = null; // Réinitialiser la référence du menu
                }
            } catch (error) {
                log(`Error handling acces button click: ${error}`);
            }
        });
    
        column1.add_child(wifiButton);
        column1.add_child(soundButton);
        column1.add_child(airplaneButton);
    
        column2.add_child(bluetoothButton);
        column2.add_child(batteryButton);
        column2.add_child(accessibilityButton);
    
        // Add columns to the menunet
        let columnsContainer = new St.BoxLayout({
            vertical: false,
            style_class: 'columns-container'
        });
    
        columnsContainer.add_child(column1);
        columnsContainer.add_child(column2);
    
        menunet.add_child(columnsContainer);
    
        Main.layoutManager.addChrome(menunet);
    
        menunet.connect('destroy', () => {
            GLib.source_remove(timeUpdateInterval); // Remove the time update interval
            menunet = null; // Reset the menu reference
            Main.layoutManager.removeChrome(menunet);
        });
    
        return menunet;
    }
}    

function openConnectionPopup() {
    let url = 'https://live-prism.web.app/auth/1/Connection.html';
    Util.spawn(['xdg-open', url]);


    // methode a définir pour la récupération de l'UUID et de l'email.
}

function init() {
    if (global.myDock) {
        global.myDock.destroy();
        global.myDock = null;
    }
    if (global.networkSetting) {
        global.networkSetting.container.destroy();
        global.networkSetting = null;
    }
    if (global.searchBar) {
        global.searchBar.hide();
    }
    global._timeMachine = new TimeMachine();
    global.searchBar = new SearchBar();
    global.networkSetting = new NetworkSetting();
    global.myDock = new MyDock();
    
}

function enable() {
    notificationManager.showNotification("PrismUI - Démarrage réussi", "Vous pouvez maintenant accéder à toutes les fonctionnalités de Prism.");
    // Créez une instance des paramètres de fond d'écran
    let backgroundSettings = new Gio.Settings({ schema: 'org.gnome.desktop.background' });
    // Sauvegardez l'URI du fond d'écran actuel
    originalWallpaperUri = backgroundSettings.get_string('picture-uri');
    // Définissez le chemin vers l'image de fond d'écran personnalisée
    let wallpaperPath = GLib.build_filenamev([Me.dir.get_path(), 'icons', 'interface', 'wallpaper', 'officiel-wallpaper-prismUI.png']);
    let wallpaperUri = GLib.filename_to_uri(wallpaperPath, null);
    backgroundSettings.set_string('picture-uri', wallpaperUri);
    Main.panel.actor.hide();
}

function disable() {

    let backgroundSettings = new Gio.Settings({ schema: 'org.gnome.desktop.background' });
    // Rétablissez le fond d'écran original
    if (originalWallpaperUri) {
        backgroundSettings.set_string('picture-uri', originalWallpaperUri);
    }
    if (monitor) {
        Main.screenShield.disconnect(monitor);
    }
    Main.panel.actor.show();
}