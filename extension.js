/*     ######  ######  ###  #####  #     #      ### #     # ###   */
/*     #     # #     #  #  #     # ##   ##       #  #     #  #    */
/*     #     # #     #  #  #       # # # #       #  #     #  #    */
/*     ######  ######   #   #####  #  #  #       #  #     #  #    */
/*     #       #   #    #        # #     #       #  #     #  #    */
/*     #       #    #   #  #     # #     #       #  #     #  #    */
/*     #       #     # ###  #####  #     #      ###  #####  ###   */
/*                                                                */
/*       Copyright (c) Project PRISM. All rights reserved.        */
/*         This software is licensed under the CC BY-NC           */
/*          Full text of the license can be found at              */
/*   https://creativecommons.org/licenses/by-nc/4.0/legalcode.en  */
/*                                                                */

//----- TEMP --------
// Nouveau : Gestionnaire de presse papier
// Amélioration du gestionnaire de mise a jour
// Fix : Plus besoin de saisir le mot de passe pour la déconnetion


const NM = imports.gi.NM;
const UPowerGlib = imports.gi.UPowerGlib;
const { St, Clutter, GLib, GObject } = imports.gi;
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
const Slider = imports.ui.slider;
const Mainloop = imports.mainloop;
const BoxPointer = imports.ui.boxpointer;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const Gvc = imports.gi.Gvc;
const ModalDialog = imports.ui.modalDialog;
const Soup = imports.gi.Soup;
const Clipboard = Me.imports.clipboard;

const BINDING_NAME = 'toggle-overview';
const DUMMY_KEY = 'super-block';

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
let superBlock = null;
let closeOverviewTimeout = null;
let monitor;
let hoverTimer;

class MyDock {
    constructor() {
        this.settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.pdock');
        this._constructbar();
        
    }
    _constructbar(){
        this.container = new St.BoxLayout({ style_class: 'my-dock-container' });

        this.addCustomIconMenu(`${ExtensionUtils.getCurrentExtension().path}/icons/logo.png`, "Menu principal");
        this.addCustomIcon(`${ExtensionUtils.getCurrentExtension().path}/icons/dt.png`, "DeskTools");

        let apps = this.settings.get_strv('dock-apps');
        for (let desktop of apps) {
            this.addAppIcon(desktop);
        }
        
        this._addAddButton();
        Main.layoutManager._backgroundGroup.add_child(this.container);

        Main.layoutManager._backgroundGroup.set_child_below_sibling(this.container, null);
          this.container.connect('notify::allocation', () => {
            this._setPosition();
        });

        this.tooltip = new St.Label({
            style_class: 'dock-tooltip',
            text: '',
            opacity: 0,
            visible: false,
        });
        Main.layoutManager._backgroundGroup.add_child(this.tooltip);

        

        // Initialement positionner le conteneur
        this._setPosition();
    }

    addCustomIconMenu(iconPath, labelText = '') {
        let icon = new St.Button({ style_class: 'app-icon' });
        let fileIcon = new Gio.FileIcon({ file: Gio.File.new_for_path(iconPath) });
        let iconImage = new St.Icon({ gicon: fileIcon, icon_size: 50 });
        icon.set_child(iconImage);

        let pressStartTime = null;
        const longPressDuration = 3000;

        icon.connect('button-press-event', (actor, event) => {
            if (event.get_button() === 1) pressStartTime = Date.now();
        });

        icon.connect('button-release-event', (actor, event) => {
            if (event.get_button() === 1 && pressStartTime) {
                let pressDuration = Date.now() - pressStartTime;
                pressStartTime = null;
                if (pressDuration >= longPressDuration) {
                    this._shutdownPC();
                } else {
                    if (menu) {
                        menu.destroy();
                        menu = null;
                        if (global.networkSetting && global.networkSetting._closeAllMenus) {
                            global.networkSetting._closeAllMenus();
                        }
                    } else {
                        menu = this._openAppMenu();
                        if (global.networkSetting && global.networkSetting._closeAllMenus) {
                            global.networkSetting._closeAllMenus();
                        }
                    }
                }
            }

            // Clic Droit : Menu Déroulant
            if (event.get_button() === 3) { 
                this._toggleContextMenu(icon);
            }
        });

        if (labelText) {
            icon.connect('enter-event', () => this._showTooltip(labelText, icon));
            icon.connect('leave-event', () => this._hideTooltip());
        }

        this.container.add_child(icon);
    }

    _toggleContextMenu(sourceActor) {
        if (this.customDockMenu) {
            this.customDockMenu.destroy();
            this.customDockMenu = null;
            return;
        }
        let [iconX, iconY] = sourceActor.get_transformed_position();
        let iconWidth = sourceActor.width;
        let centerX = iconX + (iconWidth / 2);
        let topY = iconY + 10;
        this.customDockMenu = new CustomPopup(centerX, topY);

        this.customDockMenu.addItem("Ajuster la fenêtre", () => {
            if (global.networkSetting) global.networkSetting._fitWindowToDock();
        }, "view-restore-symbolic");

        this.customDockMenu.addItem("Presse-papier", () => {
            
            if (menu) { menu.destroy(); menu = null; }
            if (global.networkSetting && typeof global.networkSetting._closeAllMenus === 'function') {
                global.networkSetting._closeAllMenus();
            }

            if (global.clipboardManager) {
                global.clipboardManager.toggleMenu(sourceActor);
            } else if (Me.imports.clipboard) {
                global.clipboardManager = new Me.imports.clipboard.ClipboardManager();
                global.clipboardManager.toggleMenu(sourceActor);
            }
        }, "edit-paste-symbolic");

        this.customDockMenu.addItem("Informations", () => {
            let dialog = new AboutDialog();
            dialog.open();
        }, "dialog-information-symbolic");

        this.customDockMenu.openUpwards(true);

        let originalDestroy = this.customDockMenu.destroy.bind(this.customDockMenu);
        this.customDockMenu.destroy = () => {
            originalDestroy();
            this.customDockMenu = null;
        };
    }

    _showTooltip(text, icon) {
        this.tooltip.set_text(text);
        this.tooltip.show();

        let [x, y] = icon.get_transformed_position();
        let iconWidth = icon.width;
        let tooltipWidth = this.tooltip.width;
        let tooltipHeight = this.tooltip.height;

        let posX = x + (iconWidth / 2) - (tooltipWidth / 2);
        // juste au-dessus du bouton
        let posY = y - tooltipHeight - 20;

        this.tooltip.set_position(posX, posY);

        // petite animation d’apparition
        this.tooltip.opacity = 0;
        this.tooltip.ease({
            opacity: 255,
            duration: 150,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _hideTooltip() {
        if (!this.tooltip.visible)
            return;

        this.tooltip.ease({
            opacity: 0,
            duration: 100,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this.tooltip.hide();
            },
        });
    }

    _addAddButton() {
        let labelText = 'Ajouter/Supprimer des applications';
        this.addButton = new St.Button({ style_class: 'app-icon' });
        this._updateAddIcon();

        this.addButton.connect('clicked', () => this._onAddButtonClicked());

        if (labelText) {
            this.addButton.connect('enter-event', () => {
                this._showTooltip(labelText, this.addButton);
            });
            this.addButton.connect('leave-event', () => {
                this._hideTooltip();
            });
        }

        this.container.add_child(this.addButton);
    }

    _updateAddIcon() {
        const iconName = this._editMode ? 'edit-delete-symbolic' : 'list-add-symbolic';
        let icon = new St.Icon({ icon_name: iconName, icon_size: 40 });
        this.addButton.set_child(icon);

        let children = this.container.get_children();
        for (let child of children) {
            // Ne pas toucher le bouton "+"
            if (child === this.addButton)
                continue;

            if (this._editMode)
                child.add_style_class_name('edit-mode-app');
            else
                child.remove_style_class_name('edit-mode-app');
        }
    }

    _onAddButtonClicked() {
        if (menu) {
            menu.destroy();
            menu = null;
        }
        if (global.networkSetting && global.networkSetting._closeAllMenus) {
            global.networkSetting._closeAllMenus();
        }

        if (this._editMode) {
            this._editMode = false;
            this._updateAddIcon();
            return;
        }

        this._openAppChooser();
    }

    _openAppChooser() {
        if (this.popupMenu) {
            this.popupMenu.destroy();
            this.popupMenu = null;
            return;
        }

        this.popupMenu = new St.BoxLayout({
            vertical: true,
            style_class: 'app-chooser-menu',
            reactive: true,
            can_focus: true
        });
        Main.uiGroup.add_child(this.popupMenu);

        let [bx, by] = this.addButton.get_transformed_position();
        let buttonWidth = this.addButton.width;
        let buttonHeight = this.addButton.height;
        let menuWidth = 240;
        let menuHeight = 400;
        let margin = 20;

        let posX = bx + (buttonWidth / 2) - (menuWidth / 2);
        let posY = by - menuHeight - margin;

        if (posY < 10) posY = 10;

        this.popupMenu.set_position(posX, posY);
        this.popupMenu.set_size(menuWidth, menuHeight);

        let editItem = new St.Button({
            label: "🗑️ Supprimer des logiciels",
            style_class: 'app-chooser-item'
        });
        editItem.connect('clicked', () => {
            this._editMode = true;
            this._updateAddIcon();
            this.popupMenu.destroy();
            this.popupMenu = null;
        });
        this.popupMenu.add_child(editItem);

        let sep = new St.Label({ text: '───────────────────────' });
        this.popupMenu.add_child(sep);

        let scroll = new St.ScrollView({
            style_class: 'app-chooser-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC
        });
        let list = new St.BoxLayout({ vertical: true });
        scroll.add_actor(list);
        this.popupMenu.add_child(scroll);

        let allApps = Gio.AppInfo.get_all()
            .filter(a => a.should_show())
            .sort((a, b) => a.get_name().localeCompare(b.get_name()));

        for (let app of allApps.slice(0, 150)) {
            let item = new St.Button({ style_class: 'app-chooser-item' });
            let row = new St.BoxLayout({ vertical: false });

            let icon = new St.Icon({
                gicon: app.get_icon(),
                icon_size: 20,
                style_class: 'app-chooser-icon'
            });

            let label = new St.Label({
                text: app.get_name(),
                y_align: Clutter.ActorAlign.CENTER
            });

            row.add_child(icon);
            row.add_child(label);
            item.set_child(row);

            item.connect('clicked', () => {
                this._addApp(app.get_id());
                this.popupMenu.destroy();
                this.popupMenu = null;
            });

            list.add_child(item);
        }

        this._globalClickHandler = global.stage.connect('button-press-event', () => {
            if (this.popupMenu) {
                this.popupMenu.destroy();
                this.popupMenu = null;
            }
            if (this._globalClickHandler) {
                global.stage.disconnect(this._globalClickHandler);
                this._globalClickHandler = null;
            }
        });
    }


    _addApp(desktopFile) {
        let apps = this.settings.get_strv('dock-apps');
        if (!apps.includes(desktopFile)) {
            apps.push(desktopFile);
            this.settings.set_strv('dock-apps', apps);
            this.addAppIcon(desktopFile);
        }
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

        icon.connect('enter-event', () => {
            this._showTooltip(appInfo.get_name(), icon);
        });
        icon.connect('leave-event', () => {
            this._hideTooltip();
        });

        icon.connect('clicked', () => {
            this._hideTooltip();

            if (global.networkSetting && global.networkSetting._closeAllMenus) {
                global.networkSetting._closeAllMenus();
            }

            if (this._editMode) {
                this._removeApp(desktopFile, icon);
            } else {
                if (menu) {
                    menu.destroy();
                    menu = null;
                }
                appInfo.launch([], null);
            }
        });

        let hoverTimer = null;
        icon.connect('enter-event', () => {
            if (this._editMode) return;

            if (hoverTimer) {
                try { GLib.Source.remove(hoverTimer); } catch(e) {}
                hoverTimer = null;
            }

            hoverTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                this._showWindowList(appInfo, icon);
                hoverTimer = null;
                return GLib.SOURCE_REMOVE;
            });
        });

        icon.connect('leave-event', () => {
            if (hoverTimer) {
                try { GLib.Source.remove(hoverTimer); } catch(e) {}
                hoverTimer = null;
            }
        });

        if (this.addButton) {
            let index = this.container.get_children().indexOf(this.addButton);
            if (index === -1)
                this.container.add_child(icon);
            else
                this.container.insert_child_at_index(icon, index);
        } else {
            this.container.add_child(icon);
        }
    }

    _removeApp(desktopFile, iconButton) {
    let apps = this.settings.get_strv('dock-apps') || [];
    apps = apps.filter(a => a !== desktopFile);
    this.settings.set_strv('dock-apps', apps);

    if (iconButton && iconButton.get_parent && iconButton.get_parent()) {
        try {
            iconButton.destroy();
        } catch (e) {
            log('Erreur en détruisant l\'icône : ' + e);
        }
    } else {
        let children = this.container.get_children();
        for (let child of children) {
        }
    }
}

    _showWindowList(appInfo, iconActor) {
        if (this.windowListPopup) {
            try { this.windowListPopup.destroy(); } catch (e) {}
            this.windowListPopup = null;
        }

        if (!this._popupState) this._popupState = {};
        const appId = appInfo?.get_id?.() || appInfo?.get_name?.() || 'unknown';
        this._popupState[appId] = { insidePopup: false, insideIcon: true };

        let allWindows = global.get_window_actors().map(a => a.meta_window);
        let windows = allWindows.filter(w => {
            try {
                let wm = (w.get_wm_class && w.get_wm_class())?.toLowerCase?.() || '';
                let title = (w.get_title && w.get_title())?.toLowerCase?.() || '';
                let id = appId.toLowerCase();
                return wm.includes(id) || title.includes(appInfo.get_name().toLowerCase());
            } catch (e) { return false; }
        });

        if (windows.length === 0) return;

        // --- Créer le popup ---
        let popup = new St.BoxLayout({
            vertical: true,
            style_class: 'window-list-popup',
            reactive: true,
            can_focus: true,
            track_hover: true,
        });

        // --- Ajouter les fenêtres ---
        for (let w of windows) {
            let row = new St.BoxLayout({ vertical: false, style_class: 'window-list-item' });

            let label = new St.Label({
                text: w.get_title() || 'Sans titre',
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });

            row.connect('button-press-event', () => {
                try { w.activate(global.get_current_time()); } catch (e) {}
                this._hideWindowList();
            });

            // Bouton fermer
            let closeBtn = new St.Button({
                style_class: 'window-close-btn',
                reactive: true,
                can_focus: true,
                track_hover: true,
            });
            let closeIcon = new St.Label({
                text: '✕',
                style: 'font-size: 14px; font-weight: bold; color: #ff5555;',
            });
            closeBtn.set_child(closeIcon);

            closeBtn.connect('button-press-event', () => {
                try {
                    if (w.delete) w.delete(global.get_current_time());
                    else if (w.request_close) w.request_close();
                    else if (w.kill) w.kill(global.get_current_time());
                } catch (err) { logError(err, 'Erreur fermeture fenêtre'); }

                try { row.destroy(); } catch (e) {}

                // Si plus de lignes → fermer popup après un petit délai
                Mainloop.timeout_add(200, () => {
                    if (popup.get_n_children() === 0)
                        this._hideWindowList();
                    return false;
                });
            });

            row.add_child(label);
            row.add_child(closeBtn);
            popup.add_child(row);
        }

        Main.uiGroup.add_child(popup);
        this.windowListPopup = popup;

        // --- Position du popup ---
        Mainloop.idle_add(() => {
            try {
                let [bx, by] = iconActor.get_transformed_position();
                let bw = iconActor.width || 0;
                let pw = popup.width;
                let ph = popup.height;

                let posX = Math.floor(bx + (bw / 2) - (pw / 2));
                let posY = Math.floor(by - ph - 8);

                let m = Main.layoutManager.primaryMonitor;
                posX = Math.max(8, Math.min(m.width - pw - 8, posX));
                posY = Math.max(8, posY);

                popup.set_position(posX, posY);
                popup.raise_top();

                popup.opacity = 0;
                popup.ease({
                    opacity: 255,
                    duration: 150,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            } catch (e) { log('_showWindowList position error: ' + e); }
            return false;
        });

        // --- Garde le menu visible tant que la souris est dedans ---
        const state = this._popupState[appId];
        const hideIfOutside = () => {
            if (!state.insidePopup && !state.insideIcon)
                this._hideWindowList();
        };

        iconActor.connect('enter-event', () => state.insideIcon = true);
        iconActor.connect('leave-event', () => {
            state.insideIcon = false;
            Mainloop.timeout_add(150, hideIfOutside);
        });

        popup.connect('enter-event', () => state.insidePopup = true);
        popup.connect('leave-event', () => {
            state.insidePopup = false;
            Mainloop.timeout_add(150, hideIfOutside);
        });
    }

    _hideWindowList() {
        if (this.windowListPopup) {
            try {
                this.windowListPopup.ease({
                    opacity: 0,
                    duration: 120,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => {
                        try { this.windowListPopup.destroy(); } catch (e) {}
                        this.windowListPopup = null;
                    },
                });
            } catch (e) {
                try { this.windowListPopup.destroy(); } catch (e2) {}
                this.windowListPopup = null;
            }
        }
    }


    _shutdownPC() {
        // Commande pour éteindre le PC
        GLib.spawn_command_line_async('systemctl poweroff');
    }

    addCustomIcon(iconPath, labelText = '') {
        const GLib = imports.gi.GLib;
        const Gio = imports.gi.Gio;
        const St = imports.gi.St;

        let icon = new St.Button({ style_class: 'app-icon' });

        let fileIcon = new Gio.FileIcon({ file: Gio.File.new_for_path(iconPath) });
        let iconImage = new St.Icon({
            gicon: fileIcon,
            icon_size: 50
        });

        icon.set_child(iconImage);

        icon.connect('clicked', () => {
            let appImagePath = `${ExtensionUtils.getCurrentExtension().path}/System/Program(x64)/Desktools-1.6.6.AppImage`;
            if (menu) {
                menu.destroy();
                menu = null;
            }   
            if (global.networkSetting && global.networkSetting._closeAllMenus) {
                global.networkSetting._closeAllMenus();
            }
            try {
                GLib.spawn_command_line_async(`"${appImagePath}"`);
            } catch (e) {
                log(`Erreur lors du lancement de l'AppImage : ${e}`);
            }
        });

        if (labelText) {
            icon.connect('enter-event', () => {
                this._showTooltip(labelText, icon);
            });
            icon.connect('leave-event', () => {
                this._hideTooltip();
            });
        }

        this.container.insert_child_at_index(icon, 1);
    }

    _openAppMenu() {
        let menuWidth = Math.floor(Main.layoutManager.primaryMonitor.width * 0.35);
        let menuHeight = Math.floor(Main.layoutManager.primaryMonitor.height * 0.65);
        let menuX = Math.floor((Main.layoutManager.primaryMonitor.width - menuWidth) / 2);
        let menuY = Math.floor((Main.layoutManager.primaryMonitor.height - menuHeight) / 2);
    
        let menu = new St.BoxLayout({
            vertical: true,
            style_class: 'app-menu'
        });
    
        menu.set_position(menuX, menuY);
        menu.set_size(menuWidth, menuHeight);
    
        let searchEntry = new St.Entry({
            style_class: 'search-entry',
            hint_text: 'Rechercher...',
            can_focus: true,
            x_expand: true
        });
    
        menu.add_child(searchEntry);
    
        let headerLabel = new St.Label({
            text: "Liste des Applications",
            style_class: 'header-text'
        });
    
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
    
            if (firstLetter !== currentLetter) {
                currentLetter = firstLetter;
                let header = new St.Label({
                    text: currentLetter,
                    style_class: 'alphabet-header'
                });
                appList.add_child(header);
                appItems.push({ header, type: 'header', visible: true });
            }
    
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
    
        searchEntry.get_clutter_text().connect('text-changed', () => {
            let searchText = searchEntry.get_text().toLowerCase();
            appList.remove_all_children();
    
            let currentLetter = null;
            let anyAppsDisplayed = false;
    
            appItems.forEach(({ header, appBox, appInfo, type }) => {
                if (type === 'header') {
                    let hasMatchingApps = appItems.some(({ appInfo }) => appInfo && appInfo.get_display_name().toLowerCase().startsWith(header.text.toLowerCase()) && appInfo.get_display_name().toLowerCase().includes(searchText));
    
                    header.visible = hasMatchingApps;
                    if (hasMatchingApps) {
                        appList.add_child(header);
                        currentLetter = header.text;
                    }
                } else if (type === 'app' && appInfo.get_display_name().toLowerCase().includes(searchText)) {
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

        let bottomOffset = 10;

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
        this._iconsPath = `${ExtensionUtils.getCurrentExtension().path}/icons/interface/wthicon`;

        this.container = new St.BoxLayout({
            style_class: 'network-settings-container',
            vertical: false
        });

        let wifiObj = this.createDynamicButton('wifiwth0barre.png');
        this.wifiButton = wifiObj.button;
        this._wifiIcon = wifiObj.icon;
        this.container.add_child(this.wifiButton);

        let soundObj = this.createDynamicButton('volumewth.png');
        this.soundButton = soundObj.button;
        this._soundIcon = soundObj.icon;
        this.container.add_child(this.soundButton);

        let batObj = this.createDynamicButton('battery-fullwth.png');
        this.batteryButton = batObj.button;
        this._batteryIcon = batObj.icon;
        this.container.add_child(this.batteryButton);

        Main.layoutManager._backgroundGroup.add_child(this.container);
        Main.layoutManager._backgroundGroup.set_child_below_sibling(this.container, null);
        
        this.container.connect('notify::allocation', () => { this._setPosition(); });
        this._setPosition();

        global.barReseau = this;
        this.wifiMenu = null;
        this.bleMenu = null;

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._initAudio();
            this._initPower();
            this._initNetwork();
            return GLib.SOURCE_REMOVE;
        });
    }

    _updateIcon(iconActor, iconName) {
        if (iconActor && iconName) {
            let path = `${this._iconsPath}/${iconName}`;
            let file = Gio.File.new_for_path(path);
            
            if (file.query_exists(null)) {
                let gicon = new Gio.FileIcon({ file: file });
                iconActor.gicon = gicon;
            } else {
                log(`[PrismUI Erreur] Fichier icône introuvable : ${path}`);
            }
        }
    }

    createDynamicButton(defaultIconName) {
        let button = new St.Button({
            style_class: 'feature-button-net',
            reactive: true,
            track_hover: true,
            can_focus: true
        });

        let path = `${this._iconsPath}/${defaultIconName}`;
        let file = Gio.File.new_for_path(path);
        let gicon;

        if (file.query_exists(null)) {
            gicon = new Gio.FileIcon({ file: file });
        } else {
            log(`[PrismUI Erreur] Icône par défaut introuvable : ${path}`);
            gicon = Gio.icon_new_for_string('image-missing-symbolic');
        }

        let icon = new St.Icon({
            gicon: gicon,
            style_class: 'feature-icon-net',
            icon_size: 26
        });

        button.set_child(icon);
        
        button.connect('clicked', () => {
            if (menunet) {
                this._closeAllMenus();
            } else {
                menunet = this._handleBarClick();
            }
        });

        return { button, icon };
    }
    
    _closeAllMenus() {
        if (menunet) { menunet.destroy(); menunet = null; }
        if (wifiMenu) { wifiMenu.destroy(); wifiMenu = null; }
        if (bleMenu) { bleMenu.destroy(); bleMenu = null; }
        if (Volmenu) { Volmenu.destroy(); Volmenu = null; }
        if (Accesmenu) { Accesmenu.destroy(); Accesmenu = null; }
    }

    _initAudio() {
        try {
            this._mixerControl = new Gvc.MixerControl({ name: 'PrismUI Volume Control' });
            this._mixerControl.open();
            this._mixerControl.connect('state-changed', () => this._updateVolumeIcon());
            this._updateVolumeIcon();
        } catch (e) { log(`[PrismUI] Erreur Audio: ${e.message}`); }
    }

    _updateVolumeIcon() {
        if (!this._mixerControl) return;
        let stream = this._mixerControl.get_default_sink();
        let iconName = 'volumewth.png';

        if (stream) {
            if (!stream._prismConnected) {
                stream.connect('notify::volume', () => this._updateVolumeIcon());
                stream.connect('notify::is-muted', () => this._updateVolumeIcon());
                stream._prismConnected = true;
            }
            if (stream.is_muted) iconName = 'volume-slashwth.png';
            else {
                let vol = stream.volume / this._mixerControl.get_vol_max_norm();
                if (vol <= 0) iconName = 'volume-slashwth.png';
                else if (vol < 0.5) iconName = 'volumewth-50prc.png';
                else iconName = 'volumewth.png';
            }
        }
        this._updateIcon(this._soundIcon, iconName);
    }

    _getMixer() { return this._mixerControl; }

    _initPower() {
        this._batteryProxy = null;
        try {
            this._upClient = UPowerGlib.Client.new_full(null);
            
            this._upClient.connect('notify::display-device', () => {
                this._syncBattery();
            });
            
            this._syncBattery();

            this._powerTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
                this._updateBatteryIcon(this._batteryProxy);
                return GLib.SOURCE_CONTINUE;
            });

        } catch (e) { log(`[PrismUI] Erreur Power: ${e.message}`); }
    }

    _syncBattery() {
        let device = this._upClient.get_display_device();
        
        if (device !== this._batteryProxy) {
            this._batteryProxy = device;
            if (this._batteryProxy && !this._batteryProxy._prismConnected) {
                this._batteryProxy.connect('notify::percentage', () => this._updateBatteryIcon(this._batteryProxy));
                this._batteryProxy.connect('notify::state', () => this._updateBatteryIcon(this._batteryProxy));
                this._batteryProxy.connect('notify::is-present', () => this._updateBatteryIcon(this._batteryProxy));
                this._batteryProxy._prismConnected = true;
            }
        }
        
        this._updateBatteryIcon(this._batteryProxy);
    }

    _updateBatteryIcon(device) {
        let percentage = device ? device.percentage : 100;
        let state = device ? device.state : UPowerGlib.DeviceState.UNKNOWN; // 1=Charging

        let baseName = 'battery-fullwth';
        if (percentage < 10) baseName = 'battery-emptywth';
        else if (percentage < 35) baseName = 'battery-quarterwth';
        else if (percentage < 60) baseName = 'battery-halfwth';
        else if (percentage < 85) baseName = 'battery3s4wth';
        else baseName = 'battery-fullwth';

        let suffix = '';
        if (state === UPowerGlib.DeviceState.CHARGING) {
            suffix = '-ch';
        }

        let iconName = `${baseName}${suffix}.png`;
        
        this._updateIcon(this._batteryIcon, iconName);
    }

    _initNetwork() {
        try {
            this._nmClient = NM.Client.new(null);
            this._nmClient.connect('notify::primary-connection', () => this._updateNetworkIcon());
            this._nmClient.connect('notify::connectivity', () => this._updateNetworkIcon());
            this._updateNetworkIcon();
        } catch (e) { log(`[PrismUI] Erreur Network: ${e.message}`); }
    }

    _updateNetworkIcon() {
        if (!this._nmClient) return;
        let primary = this._nmClient.get_primary_connection();
        let iconName = 'pas-de-signal.png'; 
        if (primary) {
            let type = primary.get_connection_type();
            if (type.includes('ethernet')) iconName = 'ethernet.png';
            else if (type.includes('wireless')) {
                let devices = this._nmClient.get_devices();
                for (let device of devices) {
                    if (device.device_type === NM.DeviceType.WIFI && device.active_connection === primary) {
                        let ap = device.active_access_point;
                        if (ap) {
                            let strength = ap.strength;
                            if (strength < 25) iconName = 'wifiwth0barre.png';
                            else if (strength < 50) iconName = 'wifiwth1barre.png';
                            else if (strength < 75) iconName = 'wifiwth2barre.png';
                            else iconName = 'wifiwth.png';
                        }
                        break;
                    }
                }
            }
        }
        this._updateIcon(this._wifiIcon, iconName);
    }

    _fitWindowToDock() {
        let window = global.display.focus_window;
        if (!window) return;
        let monitorIndex = window.get_monitor();
        let monitor = Main.layoutManager.monitors[monitorIndex];
        let dockHeight = (global.myDock && global.myDock.container) ? global.myDock.container.height + 25 : 100;
        let topBarHeight = Main.panel.actor.visible ? Main.panel.actor.height : 0;
        let newX = monitor.x;
        let newY = monitor.y + topBarHeight;
        let newWidth = monitor.width;
        let newHeight = monitor.height - topBarHeight - dockHeight;
        if (window.maximized_vertically || window.maximized_horizontally) { window.unmaximize(Meta.MaximizeFlags.BOTH); }
        window.move_resize_frame(true, newX, newY, newWidth, newHeight);
        if (global.windowEffectManager) {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                global.windowEffectManager.applyClip(window);
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _setPosition() {
        let primaryMonitor = Main.layoutManager.primaryMonitor;
        let posX = primaryMonitor.x + primaryMonitor.width - this.container.width - 20;
        let posY = primaryMonitor.y + 23;
        this.container.set_position(posX, posY);
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
    
        let wifiSwitch = new PopupMenu.PopupSwitchMenuItem('', await this.getWifiState(), { reactive: true });
    
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
            const syslogo = "preferences-system"
            notificationManager.showNotification("Le service Bluetooth est inactif", "Veuillez activer le service Bluetooth pour continuer.", "Système", syslogo);
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

    
    _getSetting(schema, settingKey) {
        try {
            let settings = Gio.Settings.new(schema);
            return settings.get_value(settingKey).deep_unpack();
        } catch (e) {
            log(`Erreur lors de la récupération du paramètre ${settingKey}: ${e.message}`);
            return null;
        }
    }
    
    _setSetting(schema, settingKey, value) {
        try {
            let settings = Gio.Settings.new(schema);
            settings.set_value(settingKey, GLib.Variant.new_boolean(value));
        } catch (e) {
            log(`Erreur lors de la définition du paramètre ${settingKey}: ${e.message}`);
        }
    }

async _accessibilityMenu() {
        let menuWidth = 280;
        let menuHeight = 310;
        let menuX = Math.floor((Main.layoutManager.primaryMonitor.x + Main.layoutManager.primaryMonitor.width - menuWidth) - 20);

        let topOffset = 110;
        let menuY = Main.layoutManager.primaryMonitor.y + topOffset;
    
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
    
        let optionsList = new St.BoxLayout({
            vertical: true,
            style_class: 'options-list'
        });
    
        menu.add_child(optionsList);
    
        let settings = [
            { schema: 'org.gnome.desktop.a11y.applications', key: 'screen-keyboard-enabled', name: 'Clavier à l\'écran' },
            { schema: 'org.gnome.desktop.a11y.applications', key: 'screen-magnifier-enabled', name: 'Loupe d\'écran' },
            { schema: 'org.gnome.desktop.a11y.applications', key: 'screen-reader-enabled', name: 'Lecteur d\'écran' },
            { schema: 'org.gnome.desktop.a11y.interface', key: 'high-contrast', name: 'Contraste élevé' }
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

_handleBarClick() {
    let menunetWidth = 267;
    let menunetHeight = 375;
    let menunetX = Math.floor((Main.layoutManager.primaryMonitor.x + Main.layoutManager.primaryMonitor.width - menunetWidth) - 20);
    let topOffset = 110;
    let menunetY = Main.layoutManager.primaryMonitor.y + topOffset;

    let menunet = new St.BoxLayout({
        vertical: true,
        style_class: 'net-boxmn'
    });

    menunet.set_position(menunetX, menunetY);
    menunet.set_size(menunetWidth, menunetHeight);

    // === HEURE + DATE ===
    let now = new Date();
    let dateLabel = new St.Label({ text: now.toLocaleDateString(), style_class: 'date-labelmn' });
    let timeLabel = new St.Label({ text: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), style_class: 'time-labelmn' });
    let dateBox = new St.BoxLayout({ vertical: true, style_class: 'datetime-box' });
    dateBox.add_child(timeLabel);
    dateBox.add_child(dateLabel);

    // === LIGNES WIFI / BLE / ACCESSIBILITÉ ===
    function createToggleRow(iconName, title) {
        let row = new St.BoxLayout({ vertical: false, style_class: 'toggle-row' });
        let icon = new St.Icon({ icon_name: iconName, icon_size: 18, style_class: 'toggle-icon' });
        let label = new St.Label({ text: title, style_class: 'toggle-label' });

        row.add_child(icon);
        row.add_child(label);

        let btn = new St.Button({ style_class: 'toggle-btn' });
        btn.set_child(row);
        return btn;
    }

    let wifiBtn = createToggleRow('network-wireless-symbolic', 'Wi-Fi');
    let bleBtn = createToggleRow('bluetooth-symbolic', 'Bluetooth');
    let accBtn = createToggleRow('preferences-desktop-accessibility-symbolic', 'Accessibilité');

    let controlBox = new St.BoxLayout({
        vertical: true,
        style_class: 'control-box'
    });

    wifiBtn.connect('clicked', async () => {
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
                    menunet = null;
                }
            } catch (error) {
                log(`Error handling Wi-Fi button click: ${error}`);
            }
    });

    bleBtn.connect('clicked', async () => {
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
                    menunet = null;
                }
            } catch (error) {
                log(`Error handling Bluetooth button click: ${error}`);
            }
    });

    accBtn.connect('clicked', async () => {
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
                    menunet = null;
                }
            } catch (error) {
                log(`Error handling acces button click: ${error}`);
            }
    });

    controlBox.add_child(wifiBtn);
    controlBox.add_child(bleBtn);
    controlBox.add_child(accBtn);

    // === SLIDERS ===
    let volumeLabel = new St.Label({ text: "Volume", style_class: 'label' });
    let volumeSlider = new Slider.Slider(0.5);
    let volumeBox = new St.BoxLayout({ vertical: false, style_class: 'slider-box-vol' });
    volumeBox.add_child(volumeLabel);
    volumeBox.add_child(volumeSlider);

    let stream = this._mixerControl.get_default_sink();
        if (stream) {
            let currentVol = stream.volume / this._mixerControl.get_vol_max_norm();
            volumeSlider.value = Math.min(currentVol, 1);
        }

        volumeSlider.connect('notify::value', () => {
            if (stream) {
                let vol = volumeSlider.value * this._mixerControl.get_vol_max_norm();
                stream.volume = vol;
                stream.push_volume();
            }
        });

        let brightLabel = new St.Label({ text: "Luminosité", style_class: 'label' });
        let brightSlider = new Slider.Slider(0);
        let brightBox = new St.BoxLayout({ vertical: false, style_class: 'slider-box-brig' });
        brightBox.add_child(brightLabel);
        brightBox.add_child(brightSlider);

        try {
            let brightnessProxy = Gio.DBusProxy.new_for_bus_sync(
                Gio.BusType.SESSION,
                Gio.DBusProxyFlags.NONE,
                null,
                "org.gnome.SettingsDaemon.Power",
                "/org/gnome/SettingsDaemon/Power",
                "org.gnome.SettingsDaemon.Power.Screen",
                null
            );
            
            let currentBrightness = brightnessProxy.get_cached_property("Brightness");
            if (currentBrightness) {
                brightSlider.value = currentBrightness.unpack() / 100;
            }
            
            brightSlider.connect('notify::value', () => {
                let newPercent = Math.floor(brightSlider.value * 100);
                
                brightnessProxy.call_sync(
                    "org.freedesktop.DBus.Properties.Set",
                    new GLib.Variant("(ssv)", [
                        "org.gnome.SettingsDaemon.Power.Screen",
                        "Brightness",
                        new GLib.Variant("i", newPercent)
                    ]),
                    Gio.DBusCallFlags.NONE,
                    -1,
                    null
                );
            });

        } catch (e) {
            log("Erreur Luminosité DBus: " + e.message);
        }

    let bottomBox = new St.BoxLayout({ style_class: 'bottom-box', vertical: false }); // Assurez-vous que c'est horizontal

        // Conteneur pour les boutons d'alim (à gauche)
        let powerButtonsBox = new St.BoxLayout({ style_class: 'power-buttons-box' });
        
        let logoutBtn = new St.Button({ style_class: 'bottom-btn', child: new St.Icon({ icon_name: 'system-log-out-symbolic' }) });
        let rebootBtn = new St.Button({ style_class: 'bottom-btn', child: new St.Icon({ icon_name: 'system-reboot-symbolic' }) });
        let shutdownBtn = new St.Button({ style_class: 'bottom-btn', child: new St.Icon({ icon_name: 'system-shutdown-symbolic' }) });

        logoutBtn.connect('clicked', () => { menunet.destroy(); menunet = null; GLib.spawn_command_line_async('gnome-session-quit --logout'); });
        rebootBtn.connect('clicked', () => { menunet.destroy(); menunet = null; GLib.spawn_command_line_async('systemctl reboot'); });
        shutdownBtn.connect('clicked', () => { menunet.destroy(); menunet = null; GLib.spawn_command_line_async('systemctl poweroff'); });

        powerButtonsBox.add_child(logoutBtn);
        powerButtonsBox.add_child(rebootBtn);
        powerButtonsBox.add_child(shutdownBtn);

        bottomBox.add_child(powerButtonsBox);
        
        let spacer = new St.Widget({ x_expand: true });
        bottomBox.add_child(spacer);

        let batteryBox = new St.BoxLayout({ style_class: 'menu-battery-box', vertical: false });
        let batteryIcon = new St.Icon({ icon_size: 16, style_class: 'menu-battery-icon' });
        let batteryLabel = new St.Label({ text: "...", style_class: 'menu-battery-label', y_align: Clutter.ActorAlign.CENTER });

        const updateMenuBattery = () => {
            if (!this._upClient) return;
            let device = this._upClient.get_display_device();
            if (!device) return;

            let percentage = Math.round(device.percentage);
            let state = device.state;
            
            batteryLabel.text = `${percentage}%`;

            let baseName = 'battery-fullwth';
            if (percentage < 10) baseName = 'battery-emptywth';
            else if (percentage < 35) baseName = 'battery-quarterwth';
            else if (percentage < 60) baseName = 'battery-halfwth';
            else if (percentage < 85) baseName = 'battery3s4wth';
            else baseName = 'battery-fullwth';

            let suffix = '';
            if (state === UPowerGlib.DeviceState.CHARGING) suffix = '-ch';
            else if (state === UPowerGlib.DeviceState.FULLY_CHARGED) { baseName = 'battery-fullwth'; suffix = ''; }

            let iconName = `${baseName}${suffix}.png`;
            
            // Charger l'icône
            let path = `${this._iconsPath}/${iconName}`;
            let file = Gio.File.new_for_path(path);
            if (file.query_exists(null)) {
                batteryIcon.gicon = new Gio.FileIcon({ file: file });
            } else {
                batteryIcon.gicon = Gio.icon_new_for_string('battery-missing-symbolic');
            }
        };

    updateMenuBattery();

    batteryBox.add_child(batteryLabel);
    batteryBox.add_child(batteryIcon);

    bottomBox.add_child(batteryBox);

    menunet.add_child(dateBox);
    menunet.add_child(controlBox);
    menunet.add_child(volumeBox);
    menunet.add_child(brightBox);
    menunet.add_child(bottomBox);

    Mainloop.idle_add(() => {
        Main.uiGroup.add_child(menunet);
        return false;
    });

    global.stage.connect('button-press-event', () => menunet.destroy());
    return menunet;
}
}

var AboutDialog = GObject.registerClass(
    class AboutDialog extends ModalDialog.ModalDialog {
        _init() {
            super._init({ styleClass: 'prism-about-dialog', destroyOnClose: true });
            let contentBox = this.contentLayout;
            contentBox.style_class = 'prism-about-content';
            contentBox.vertical = true;
            let icon = new St.Icon({ gicon: Gio.icon_new_for_string(`${Me.path}/icons/logo.png`), icon_size: 96, style_class: 'prism-about-logo', x_align: Clutter.ActorAlign.CENTER });
            contentBox.add_child(icon);
            let title = new St.Label({ text: "IUI", style_class: 'prism-about-title', x_align: Clutter.ActorAlign.CENTER });
            contentBox.add_child(title);
            let version = new St.Label({ text: `Version ${Me.metadata.version || 'Bêta'}`, style_class: 'prism-about-version', x_align: Clutter.ActorAlign.CENTER });
            contentBox.add_child(version);
            this.statusLabel = new St.Label({ text: "", style: "color: #aaa; font-size: 12px; padding-top: 10px; text-align: center;", x_align: Clutter.ActorAlign.CENTER, visible: false });
            contentBox.add_child(this.statusLabel);
            this._updateBtn = this.addButton({ label: 'Rechercher une mise à jour', action: () => this._onUpdateClicked() });
            this.addButton({ label: 'Fermer', action: () => this.close(), key: Clutter.KEY_Escape });
        }

        _onUpdateClicked() {
            let button = this._updateBtn;
            if (button) { button.reactive = false; button.set_label("Vérification..."); }
            this.statusLabel.text = "Connexion au serveur...";
            this.statusLabel.show();
            this.statusLabel.style = "color: #aaa;";
            
            let updater = new UpdateManager();

            updater.checkUpdates().then((isUpdateAvailable) => {
                if (isUpdateAvailable) {
                    if (button) button.set_label("Téléchargement...");
                    this.statusLabel.text = "Mise à jour trouvée ! Téléchargement...";
                    
                    updater.updateAll().then(() => {
                        if (button) button.set_label("Redémarrage requis");
                        this.statusLabel.style = "color: #4CAF50; font-weight: bold;";
                        this.statusLabel.text = "Mise à jour installée ! Déconnexion dans 5 sec...";
                        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
                            GLib.spawn_command_line_async('gnome-session-quit --logout --no-prompt');
                            return GLib.SOURCE_REMOVE;
                        });
                    });
                } else {
                    if (button) {
                        button.reactive = true;
                        button.set_label("Rechercher une mise à jour");
                    }
                    this.statusLabel.style = "color: #4CAF50; font-weight: bold;";
                    this.statusLabel.text = "IUI est déjà à jour.";
                }
            }).catch((e) => {
                if (button) { button.reactive = true; button.set_label("Réessayer"); }
                this.statusLabel.style = "color: #FF5252; font-weight: bold;";
                this.statusLabel.text = "Erreur: " + e.message;
                log("Erreur update: " + e);
            });
        }
    }
);

const UpdateManager = class {
    constructor() {
        this.baseUrl = "https://projet-prism.fr/update/iui/last/";
        this.filesToUpdate = [
            "extension.js",
            "intelligentsearchbar.js",
            "notificationsys.js",
            "time.js",
            "stylesheet.css",
            "schemas/gschemas.compiled",
            "metadata.json",
            "clipboard.js"
        ];
        if (typeof Soup.Session.new === 'function') {
            this._session = new Soup.Session(); 
        } else {
            this._session = new Soup.SessionAsync(); 
        }
    }

    async ensureIntegrity() {
        let missingFiles = false;

        for (let filename of this.filesToUpdate) {
            let localPath = GLib.build_filenamev([Me.dir.get_path(), filename]);
            let file = Gio.File.new_for_path(localPath);
            
            if (!file.query_exists(null)) {
                missingFiles = true;
                break;
            }
        }

        if (!missingFiles) return;

        let monitor = Gio.NetworkMonitor.get_default();
        if (!monitor.network_available) return;

        let userAccepted = await this._askUserToDownload();

        if (userAccepted) {
            try {
                await this.updateAll();
                Main.notify("PrismUI", "Fichiers manquants téléchargés avec succès.");
            } catch (e) {
                log(e.message);
            }
        } else {
            const syslogo = "preferences-system"
            notificationManager.showNotification("IUI - Oh Oh !", "Votre installation est corrompu !", "Gestionnaire des mises à jour", syslogo);
        }
    }

    _askUserToDownload() {
        return new Promise((resolve) => {
            let dialog = new ModalDialog.ModalDialog({
                styleClass: 'prompt-dialog',
                destroyOnClose: true
            });

            let content = new St.BoxLayout({ vertical: true });
            
            let title = new St.Label({ 
                text: "Fichiers système manquants", 
                style_class: 'prompt-dialog-headline' 
            });
            let body = new St.Label({ 
                text: "Certains fichiers essentiels de PrismUI sont manquants. Voulez-vous les télécharger et réparer l'extension maintenant ? (Internet requis)",
                style_class: 'prompt-dialog-description' 
            });

            content.add_child(title);
            content.add_child(body);
            dialog.contentLayout.add_child(content);

            dialog.addButton({
                label: "Annuler",
                action: () => {
                    dialog.close();
                    resolve(false);
                },
                key: Clutter.KEY_Escape
            });

            dialog.addButton({
                label: "Télécharger et Réparer",
                action: () => {
                    dialog.close();
                    resolve(true);
                },
                default: true
            });

            dialog.open();
        });
    }

    checkUpdates() {
        return new Promise((resolve, reject) => {
            let remoteUrl = this.baseUrl + "metadata.json";
            let message = Soup.Message.new('GET', remoteUrl);

            const onResponse = (bytes) => {
                try {
                    let jsonContent = new TextDecoder().decode(bytes);
                    let remoteMetadata = JSON.parse(jsonContent);
                    
                    let currentVersion = parseFloat(Me.metadata.version);
                    let remoteVersion = parseFloat(remoteMetadata.version);

                    if (remoteVersion > currentVersion) {
                        resolve(true);
                    } else {
                        resolve(false);
                    }
                } catch (e) {
                    reject(new Error(e.message));
                }
            };

            if (this._session.send_and_read_async) {
                this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, res) => {
                    try {
                        let bytes = session.send_and_read_finish(res);
                        if (message.status_code !== 200) { reject(new Error(`${message.status_code}`)); return; }
                        onResponse(bytes.get_data());
                    } catch (e) { reject(e); }
                });
            } else {
                this._session.queue_message(message, (session, msg) => {
                    if (msg.status_code !== 200) { reject(new Error(`${msg.status_code}`)); return; }
                    let body = msg.response_body.data; 
                    onResponse(body);
                });
            }
        });
    }

    _downloadFile(filename) {
        return new Promise((resolve, reject) => {
            let remoteUrl = this.baseUrl + filename;
            let localPath = GLib.build_filenamev([Me.dir.get_path(), filename]);
            let file = Gio.File.new_for_path(localPath);
            let message = Soup.Message.new('GET', remoteUrl);

            let parent = file.get_parent();
            if (parent && !parent.query_exists(null)) {
                try {
                    parent.make_directory_with_parents(null);
                } catch (e) {}
            }

            const writeToFile = (bytes) => {
                file.replace_contents_async(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null, (f, r) => {
                    try {
                        f.replace_contents_finish(r);
                        resolve(file.get_basename());
                    } catch (err) { reject(err); }
                });
            };

            if (this._session.send_and_read_async) {
                this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, res) => {
                    try {
                        let bytes = session.send_and_read_finish(res);
                        if (message.status_code !== 200) { reject(new Error(`${message.status_code}`)); return; }
                        writeToFile(bytes);
                    } catch (e) { reject(e); }
                });
            } else {
                this._session.queue_message(message, (session, msg) => {
                    if (msg.status_code !== 200) { reject(new Error(`${msg.status_code}`)); return; }
                    writeToFile(msg.response_body.flatten());
                });
            }
        });
    }

    async updateAll() {
        let promises = [];
        for (let file of this.filesToUpdate) { promises.push(this._downloadFile(file)); }
        await Promise.all(promises);
    }
};

/* --- CLASSE UTILITAIRE GÉNÉRIQUE POUR MENU CONTEXTUEL DEROULANT --- */
class CustomPopup {
    constructor(x, y) {
        this.actor = new St.BoxLayout({
            style_class: 'dock-context-menu',
            vertical: true,
            reactive: true
        });
        
        this._x = x;
        this._y = y;
        this._isOpen = false;
        this._globalEvent = null;

        Main.uiGroup.add_child(this.actor);
    }

    addItem(labelText, callback, iconName = null) {
        let button = new St.Button({
            style_class: 'popup-menu-item',
            reactive: true,
            x_align: St.Align.START,
            y_align: St.Align.MIDDLE,
            can_focus: true,
            track_hover: true // Ajout pour le survol natif
        });

        let box = new St.BoxLayout({ vertical: false, style: 'padding: 8px;' });
        
        if (iconName) {
            let icon = new St.Icon({ icon_name: iconName, icon_size: 16, style: 'margin-right: 10px;' });
            box.add_child(icon);
        }

        let label = new St.Label({ text: labelText, y_align: Clutter.ActorAlign.CENTER });
        box.add_child(label);
        button.set_child(box);

        button.connect('button-press-event', () => {
            this.destroy(); 
            if (callback) callback();
            return Clutter.EVENT_STOP;
        });

        this.actor.add_child(button);
    }

    openUpwards(isCentered = false) {
        this._isOpen = true;
        this.actor.opacity = 0; // Invisible pendant le calcul
        
        Mainloop.idle_add(() => {
            if (!this.actor) return false;

            let menuHeight = this.actor.height;
            let menuWidth = this.actor.width;

            let finalY = this._y - menuHeight - 10;
            
            let finalX = this._x;
            if (isCentered) {
                finalX = this._x - (menuWidth / 2);
            }

            let monitor = Main.layoutManager.primaryMonitor;
            
            if (finalX + menuWidth > monitor.width) finalX = monitor.width - menuWidth - 10;
            if (finalX < 10) finalX = 10;
            if (finalY < 10) finalY = 10;

            this.actor.set_position(finalX, finalY);
            this.actor.opacity = 255; // On affiche
            
            this._setupClickOutside();
            return false;
        });
    }

    _setupClickOutside() {
        if (this._globalEvent) {
            global.stage.disconnect(this._globalEvent);
            this._globalEvent = null;
        }

        Mainloop.timeout_add(100, () => {
            if (!this.actor) return GLib.SOURCE_REMOVE;

            this._globalEvent = global.stage.connect('button-press-event', (actor, event) => {

                if (!this.actor) return Clutter.EVENT_PROPAGATE;

                let target = event.get_source();
                
                let insideMenu = this.actor.contains(target) || this.actor === target;

                if (!insideMenu) {
                    this.destroy();
                }

                return Clutter.EVENT_PROPAGATE;
            });
            
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        if (this._globalEvent) {
            global.stage.disconnect(this._globalEvent);
            this._globalEvent = null;
        }

        if (this.actor) {
            this.actor.destroy();
            this.actor = null;
        }
        
        this._isOpen = false;
    }
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
    const syslogo = "preferences-system"
    notificationManager.showNotification("IUI - Démarrage réussi", "Vous pouvez maintenant accéder à toutes les fonctionnalités de Prism.", "Système", syslogo);
    let backgroundSettings = new Gio.Settings({ schema: 'org.gnome.desktop.background' });
    originalWallpaperUri = backgroundSettings.get_string('picture-uri');
    let wallpaperPath = GLib.build_filenamev([Me.dir.get_path(), 'icons', 'interface', 'wallpaper', 'officiel-wallpaper-prismUI.png']);
    let wallpaperUri = GLib.filename_to_uri(wallpaperPath, null);
    backgroundSettings.set_string('picture-uri', wallpaperUri);
    Main.panel.actor.hide();

    global.clipboardManager = new Clipboard.ClipboardManager();

    let integrityManager = new UpdateManager();
    integrityManager.ensureIntegrity();

    closeOverviewTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
        if (Main.overview.visible) {
            Main.overview.hide();
        }
        return GLib.SOURCE_REMOVE;
    });
}

function disable() {

    let backgroundSettings = new Gio.Settings({ schema: 'org.gnome.desktop.background' });

    if (global.clipboardManager) {
        global.clipboardManager.destroy(); // Arrête la boucle de surveillance
        global.clipboardManager = null;
    }
    // Rétablissez le fond d'écran original
    if (originalWallpaperUri) {
        backgroundSettings.set_string('picture-uri', originalWallpaperUri);
    }
    if (monitor) {
        Main.screenShield.disconnect(monitor);
    }
    Main.panel.actor.show();
}