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

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import NM from 'gi://NM';
import UPowerGlib from 'gi://UPowerGlib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Gvc from 'gi://Gvc';
import Soup from 'gi://Soup?version=3.0';
import Pango from 'gi://Pango';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { NotificationManager, getTopBarTooltipY } from './notificationsys.js';
import { AppLauncher } from './intelligentsearchbar.js';
import { PrismWidgets } from './desktopWidgets.js';
import { ClipboardManager } from './clipboard.js';
import { NetworkSetting } from './networksetting.js';


const Mainloop = {
    idle_add: callback => GLib.idle_add(GLib.PRIORITY_DEFAULT, callback),
    timeout_add: (interval, callback) => GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, callback)
};

const PRISM_APPS = {
    'desktools': {
        name: "DeskTools",
        autor: "PRISM",
        version: "2.1.6",
        tag: "DT5",
        repo: "hugodev-teck/DeskTools",
        icon: "dt.png",
        getFileName: (arch, version) => {
            return (arch === 'aarch64' || arch === 'arm64') 
                ? `Desktools-${version}-arm64.AppImage` 
                : `Desktools-${version}.AppImage`;
        }
    },
    'Velora explorer': {
        name: "Velora Explorer",
        autor: "PRISM",
        version: "0.1.1",
        tag: "V0.1.1",
        repo: "hugodev-teck/Velora-explorer",
        icon: "vlogo.png",
        desktopId: "velora-explorer",
        getFileName: (arch, version) => `explorer-${version}.js`
    }
};

let menu;
let _systemArchitecture = null;

function getSystemArchitecture() {
    if (_systemArchitecture) return _systemArchitecture;

    let [success, stdout, stderr, status] = GLib.spawn_command_line_sync('uname -m');
    if (!success) {
        let errorText = stderr ? new TextDecoder().decode(stderr).trim() : `code ${status}`;
        throw new Error(`Impossible de déterminer l’architecture système : ${errorText}`);
    }

    _systemArchitecture = new TextDecoder().decode(stdout).trim();
    if (!_systemArchitecture) {
        throw new Error('La commande uname -m a renvoyé une architecture vide.');
    }
    return _systemArchitecture;
}

class MyDock {
    constructor(ext) {
        this._ext = ext;
        this.settings = this._ext.getSettings('org.gnome.shell.extensions.pdock'); 
        this._constructbar();
    }
    _constructbar() {
        this.container = new St.BoxLayout({ 
            name: 'ConstrucBar',
            style_class: 'my-dock-container' 
        });
        this._editMode = false;
        this.addButton = null;

        this.addCustomIconMenu(`${this._ext.path}/icons/logo.png`, "Menu principal");
        let programDir = GLib.build_filenamev([this._ext.path, 'System', 'Program']);
        let arch = getSystemArchitecture();
        let dtConfig = PRISM_APPS['desktools'];
        
        if (dtConfig) {
            let dtFileName = dtConfig.getFileName(arch, dtConfig.version);
            let dtFilePath = GLib.build_filenamev([programDir, dtFileName]);
            if (Gio.File.new_for_path(dtFilePath).query_exists(null)) {
                this.addCustomIcon(`${this._ext.path}/icons/dt.png`, "DeskTools", 'desktools');
            }
        }

        let apps = this.settings.get_strv('dock-apps');

        this._separator = new St.Widget({
            style_class: 'dock-separator',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
            style: 'width: 2px; height: 30px; background-color: rgba(255, 255, 255, 0.2); margin: 0 10px; border-radius: 1px;'
        });

        for (let desktop of apps) {
            this.addAppIcon(desktop, true);
        }

        this.container.add_child(this._separator);

        Main.layoutManager._backgroundGroup.add_child(this.container);

        this._posIdleId = 0;
        let queuePositionUpdate = () => {
            if (this._posIdleId) return;
            this._posIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._posIdleId = 0;
                if (this.container) this._setPosition();
                return GLib.SOURCE_REMOVE;
            });
        };
        this.container.connect('notify::width', queuePositionUpdate);
        this.container.connect('notify::height', queuePositionUpdate);

        this.tooltip = new St.Label({
            style_class: 'dock-tooltip',
            text: '',
            opacity: 0,
            visible: false,
            reactive: false
        });

        Main.layoutManager.addChrome(this.tooltip);

        Mainloop.idle_add(() => {
            if (this.container) this._setPosition();
            return GLib.SOURCE_REMOVE;
        });

        this._dockMonitorId = Main.layoutManager.connect('monitors-changed', () => {
            this._setPosition();
        });

        this._initMediaTracker();
        this._initAppTracker()
        this._initSleepTracker();
    }

    _initMediaTracker() {
        
        let bus = Gio.bus_get_sync(Gio.BusType.SESSION, null);

        this._nameOwnerChangedId = bus.signal_subscribe(
            'org.freedesktop.DBus', 
            'org.freedesktop.DBus', 
            'NameOwnerChanged',     
            '/org/freedesktop/DBus', 
            null, 
            Gio.DBusSignalFlags.NONE,
            (connection, sender, path, iface, signal, params) => {
                let unpacked = params.deep_unpack();
                if (!unpacked || unpacked.length < 3) return;
                
                let [name, oldOwner, newOwner] = unpacked;
                
                if (typeof name !== 'string') return;

                if (name.startsWith('org.mpris.MediaPlayer2.') && oldOwner === '' && newOwner !== '') {
                    if (!this._mediaProxy) {
                        this._connectToPlayer(name);
                    }
                }
            }
        );

        let result = bus.call_sync(
            'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'ListNames', null, null, Gio.DBusCallFlags.NONE, -1, null
        );

        let names = result.deep_unpack()[0];
        let playerName = names.find(n => n.startsWith('org.mpris.MediaPlayer2.'));

        if (playerName) {
            this._connectToPlayer(playerName);
        }
    }

    _initSleepTracker() {
        try {
            let bus = Gio.bus_get_sync(Gio.BusType.SYSTEM, null);
            this._sleepSignalId = bus.signal_subscribe(
                'org.freedesktop.login1',
                'org.freedesktop.login1.Manager',
                'PrepareForSleep',
                '/org/freedesktop/login1',
                null,
                Gio.DBusSignalFlags.NONE,
                (connection, sender, path, iface, signal, params) => {
                    let [goingToSleep] = params.deep_unpack();
                    if (!goingToSleep) {
                        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
                            this._refreshRunningApps();
                            return GLib.SOURCE_REMOVE;
                        });
                    }
                }
            );
        } catch (e) {
            log(`[PrismUI] Impossible de suivre la mise en veille : ${e.message}`);
        }
    }

    _refreshRunningApps() {
        if (!this.container) return;

        let pinnedApps = this.settings.get_strv('dock-apps') || [];
        let runningApps = this._appSystem.get_running();
        let runningIds = runningApps.map(app => app.get_id());

        let children = [...this.container.get_children()];
        for (let child of children) {
            if (child._appId && !child._isPinned && !runningIds.includes(child._appId)) {
                if (!child._mediaBox || !child._mediaBox.visible) {
                    child.destroy();
                }
            }
        }

        for (let app of runningApps) {
            let appId = app.get_id();
            if (!pinnedApps.includes(appId) && !this._findIconByAppId(appId)) {
                this.addAppIcon(appId, false);
            }
        }

        this._updateSeparatorVisibility();
    }

    _connectToPlayer(playerName) {
        if (this._mediaProxy) return;

        let cleanAppName = playerName.replace('org.mpris.MediaPlayer2.', '').toLowerCase();
        cleanAppName = cleanAppName.split('.instance')[0];

        Gio.DBusProxy.new_for_bus(
            Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, null,
            playerName, '/org/mpris/MediaPlayer2', 'org.mpris.MediaPlayer2.Player', null,
            (source, result) => {
                try {
                    this._mediaProxy = Gio.DBusProxy.new_for_bus_finish(result);

                    const updateUI = () => {
                        if (!this._mediaProxy) return;
                        let statusProp = this._mediaProxy.get_cached_property('PlaybackStatus');
                        let metaProp = this._mediaProxy.get_cached_property('Metadata');
                        let desktopProp = this._mediaProxy.get_cached_property('DesktopEntry');

                        let status = statusProp ? statusProp.unpack() : 'Inconnu';
                        let targetApp = desktopProp ? desktopProp.unpack().toLowerCase() : cleanAppName;
                        targetApp = targetApp.split('.instance')[0];

                        if (status === 'Playing' || status === 'Paused') {
                            let metadata = metaProp ? metaProp.deep_unpack() : {};
                            let title = metadata['xesam:title'] ? metadata['xesam:title'].unpack() : 'Piste inconnue';
                            let length = metadata['mpris:length'] ? metadata['mpris:length'].unpack() : 0;
                            let posProp = this._mediaProxy.get_cached_property('Position');
                            let position = posProp ? posProp.unpack() : 0;
                            
                            this._expandAppIcon(targetApp, title, (status === 'Playing'), length, position);
                        } else {
                            this._collapseAppIcon(targetApp);
                        }
                    };

                    this._mediaSignalId = this._mediaProxy.connect('g-properties-changed', () => updateUI());
                    updateUI();

                    this._mediaOwnerId = this._mediaProxy.connect('notify::g-name-owner', () => {
                        if (!this._mediaProxy.get_name_owner()) {
                            this._collapseAppIcon(cleanAppName);
                            this._mediaProxy.disconnect(this._mediaSignalId);
                            this._mediaProxy.disconnect(this._mediaOwnerId);
                            this._mediaProxy = null; 
                        }
                    });
                } catch(e) {}
            }
        );
    }

    _initAppTracker() {
        this._appSystem = Shell.AppSystem.get_default();
        let pinnedApps = this.settings.get_strv('dock-apps') || [];

        let runningApps = this._appSystem.get_running();
        for (let app of runningApps) {
            let appId = app.get_id();
            if (!pinnedApps.includes(appId)) {
                this.addAppIcon(appId, false);
            }
        }
        this._updateSeparatorVisibility();

        this._appStateChangedId = this._appSystem.connect('app-state-changed', (sys, app) => {
            let state = app.get_state();
            let appId = app.get_id();
            
            let existingIcon = this._findIconByAppId(appId);

            if (state === Shell.AppState.RUNNING) {
                if (!existingIcon) {
                    this.addAppIcon(appId, false);
                    this._updateSeparatorVisibility();
                } else {
                    this._updateAppDots(existingIcon, appId);
                }
            } else if (state === Shell.AppState.STOPPED) {
                if (existingIcon && (!existingIcon._mediaBox || !existingIcon._mediaBox.visible)) {
                    if (!existingIcon._isPinned) {
                        existingIcon.destroy();
                        this._updateSeparatorVisibility();
                    } else {
                        this._updateAppDots(existingIcon, appId);
                    }
                }
            }
        });
    }

    _findIconByAppId(appId) {
        let children = this.container.get_children();
        for (let child of children) {
            if (child._appId === appId) return child;
        }
        return null;
    }

    _updateSeparatorVisibility() {
        if (!this._separator) return;
        let children = this.container.get_children();
        let sepIndex = children.indexOf(this._separator);
        
        if (sepIndex !== -1 && sepIndex < children.length - 1) {
            this._separator.show();
        } else {
            this._separator.hide();
        }
    }

    addCustomIconMenu(iconPath, labelText = '') {
        let icon = new St.Button({ style_class: 'app-icon' });
        let fileIcon = new Gio.FileIcon({ file: Gio.File.new_for_path(iconPath) });
        let iconImage = new St.Icon({ gicon: fileIcon, icon_size: 50 });
        icon.set_child(iconImage);

        let pressStartTime = null;
        const longPressDuration = 1000;

        icon.reactive = true;

        icon.connect('button-press-event', (actor, event) => {
            if (event.get_button() === 1) pressStartTime = Date.now();
        });

        icon.connect('button-release-event', (actor, event) => {
            if (event.get_button() === 1 && pressStartTime) {
                let pressDuration = Date.now() - pressStartTime;
                pressStartTime = null;
                if (pressDuration >= longPressDuration) {
                    this._toggleContextMenu(icon);
                } else {
                    if (global.appLauncher) {
                        global.appLauncher.toggle();
                    }
                    if (global.networkSetting && global.networkSetting._closeAllMenus) {
                        global.networkSetting._closeAllMenus();
                    }
                }
            }

            if (event.get_button() === 3) { 
                this._toggleContextMenu(icon);
            }
        });

        icon.connect('touch-event', (actor, event) => {
        let type = event.type();

        if (type === Clutter.EventType.TOUCH_BEGIN) {
            pressStartTime = Date.now();
            return Clutter.EVENT_PROPAGATE; 
        } 
        
        else if (type === Clutter.EventType.TOUCH_END) {
            if (pressStartTime) {
                let pressDuration = Date.now() - pressStartTime;
                pressStartTime = null;
                
                if (pressDuration >= longPressDuration) {
                    this._toggleContextMenu(icon);
                } 
                else {
                    if (global.appLauncher) {
                        global.appLauncher.toggle();
                    }
                    if (global.networkSetting && global.networkSetting._closeAllMenus) {
                        global.networkSetting._closeAllMenus();
                    }
                }
            }
            return Clutter.EVENT_PROPAGATE;
        }
        
        return Clutter.EVENT_PROPAGATE;
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
        let topY = iconY - 10;
        
        this.customDockMenu = new CustomPopup(centerX, topY, sourceActor);

        this.customDockMenu.actor.connect('destroy', () => {
            this.customDockMenu = null;
        });

        this.customDockMenu.addItem("Gérer les widgets", () => {
            if (menu) { menu.destroy(); menu = null; }
            if (global.networkSetting && typeof global.networkSetting._closeAllMenus === 'function') {
                global.networkSetting._closeAllMenus();
            }
            if (global.prismWidgets) {
                global.prismWidgets._toggleWidgetMenu();
            }
        }, "view-app-grid-symbolic");

        this.customDockMenu.addItem("Fonctionnalités PRISM", () => {
            if (menu) { menu.destroy(); menu = null; }
            if (global.networkSetting && global.networkSetting._closeAllMenus) {
                global.networkSetting._closeAllMenus();
            }
            this._openNewFunc();
        }, "software-update-available-symbolic");

        this._addSeparator(this.customDockMenu);

        this.customDockMenu.addItem("Afficher le bureau", () => {
            let workspace = global.workspace_manager.get_active_workspace();
            workspace.list_windows().forEach(window => {
                if (window.can_minimize()) {
                    window.minimize();
                }
            });
        }, "user-desktop-symbolic");

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
            } else {
                global.clipboardManager = new ClipboardManager();
                global.clipboardManager.toggleMenu(sourceActor);
            }
        }, "edit-paste-symbolic");

        this._addSeparator(this.customDockMenu);

        const iconName = this._editMode ? 'edit-delete-symbolic' : 'list-add-symbolic';
        this.customDockMenu.addItem("Ajouter/modifier des logiciels", () => {
            if (menu) { menu.destroy(); menu = null; }
            if (global.networkSetting && global.networkSetting._closeAllMenus) {
                global.networkSetting._closeAllMenus();
            }
            if (this._editMode) {
                this._editMode = false;
                this._updateAddIcon();
                return;
            }
            this._openAppChooser();
        }, iconName);

        this.customDockMenu.addItem("Informations & Mises à jour", () => {
            if (menu) { menu.destroy(); menu = null; }
            if (global.networkSetting && global.networkSetting._closeAllMenus) {
                global.networkSetting._closeAllMenus();
            }
            
            let updaterPath = GLib.build_filenamev([this._ext.path, 'updater.js']);
            
            try {
                GLib.spawn_command_line_sync(`chmod +x "${updaterPath}"`);
                
                Gio.Subprocess.new(['gjs', '-m', updaterPath, this._ext.path], Gio.SubprocessFlags.NONE);
            } catch (e) {
                log(`[PrismUI] Erreur lors du lancement de l'updater: ${e.message}`);
            }
        }, "software-update-available-symbolic");

        this._addSeparator(this.customDockMenu);

        this.customDockMenu.addItem("Mettre en veille", () => {
            GLib.spawn_command_line_async('systemctl suspend');
        }, "weather-clear-night-symbolic");

        this.customDockMenu.addItem("Se déconnecter", () => {
            GLib.spawn_command_line_async('gnome-session-quit --logout'); 
        }, "system-log-out-symbolic");

        this.customDockMenu.addItem("Redémarrer", () => {
            GLib.spawn_command_line_async('gnome-session-quit --reboot');
        }, "system-reboot-symbolic");

        this.customDockMenu.addItem("Arrêter", () => {
            GLib.spawn_command_line_async('gnome-session-quit --power-off');
        }, "system-shutdown-symbolic");

        this.customDockMenu.openUpwards(true);
    }

    _addSeparator(targetMenu) {
        let separator = new St.BoxLayout({
            style_class: 'popup-separator-menu-item',
            height: 1, 
            style: 'background-color: rgba(255, 255, 255, 0.2); margin-top: 5px; margin-bottom: 5px;',
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL
        });

        if (targetMenu.actor) {
            targetMenu.actor.add_child(separator);
        }
    }

    _showTooltip(text, icon) {
        this.tooltip.set_text(text);
        this.tooltip.show();

        let [x, y] = icon.get_transformed_position();
        let iconWidth = icon.width;
        let tooltipWidth = this.tooltip.width;
        let tooltipHeight = this.tooltip.height;

        let posX = x + (iconWidth / 2) - (tooltipWidth / 2);
        let posY = y - tooltipHeight - 20;

        this.tooltip.set_position(posX, posY);

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

    _updateAddIcon() {
        let children = this.container.get_children();
        for (let child of children) {
            if (this._editMode)
                child.add_style_class_name('edit-mode-app');
            else
                child.remove_style_class_name('edit-mode-app');
        }

        if (this.addButton) {
            const iconName = this._editMode ? 'edit-delete-symbolic' : 'list-add-symbolic';
            this.addButton.set_child(new St.Icon({ icon_name: iconName, icon_size: 40 }));
        }
    }

    _openAppChooser() {
        if (this.appManagerDialog) {
            this.appManagerDialog.close();
            this.appManagerDialog = null;
        }

        this._cachedAllApps = Gio.AppInfo.get_all().filter(a => a.should_show()).sort((a, b) => a.get_name().localeCompare(b.get_name()));

        this.appManagerDialog = new ModalDialog.ModalDialog({
            styleClass: 'prism-app-manager-dialog',
            destroyOnClose: true
        });

        let monitor = Main.layoutManager.primaryMonitor;
        let targetHeight = Math.floor(monitor.height * 0.8);

        let mainBox = new St.BoxLayout({ 
            vertical: false, 
            x_expand: true, 
            y_expand: true,
            height: targetHeight 
        });

        let leftCol = new St.BoxLayout({ vertical: true, width: 350, style: 'margin-right: 20px;' });
        leftCol.add_child(new St.Label({ text: "Logiciels disponibles", style: 'font-weight: bold; font-size: 18px; margin-bottom: 10px; color: #81D4FA;' }));
        
        let leftScroll = new St.ScrollView({ style_class: 'vfade', hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC, x_expand: true, y_expand: true });
        this._systemAppList = new St.BoxLayout({ vertical: true });
        leftScroll.set_child(this._systemAppList);
        leftCol.add_child(leftScroll);

        let rightCol = new St.BoxLayout({ vertical: true, width: 350 });
        rightCol.add_child(new St.Label({ text: "Dans le Dock", style: 'font-weight: bold; font-size: 18px; margin-bottom: 10px; color: #A5D6A7;' }));
        
        let rightScroll = new St.ScrollView({ style_class: 'vfade', hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC, x_expand: true, y_expand: true });
        this._dockAppList = new St.BoxLayout({ vertical: true });
        rightScroll.set_child(this._dockAppList);
        rightCol.add_child(rightScroll);

        mainBox.add_child(leftCol);
        mainBox.add_child(new St.Widget({ style: 'width: 2px; background-color: rgba(255,255,255,0.1); margin-right: 20px;' }));
        mainBox.add_child(rightCol);

        this.appManagerDialog.contentLayout.add_child(mainBox);

        this.appManagerDialog.addButton({
            label: 'Terminer',
            action: () => {
                this.appManagerDialog.close();
                this.appManagerDialog = null;
            },
            key: Clutter.KEY_Escape
        });

        this.appManagerDialog.open();

        this.appManagerDialog.connect('closed', () => {
            this.appManagerDialog = null;
            this._cachedAllApps = null;
        });

        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._refreshAppManagerUI();
            return GLib.SOURCE_REMOVE;
        });
    }

    _refreshAppManagerUI() {
        if (!this._systemAppList || !this._dockAppList || !this.appManagerDialog) return;

        this._systemAppList.destroy_all_children();
        this._dockAppList.destroy_all_children();

        let dockAppsIds = this.settings.get_strv('dock-apps') || [];
        let allApps = this._cachedAllApps || [];

        for (let i = 0; i < dockAppsIds.length; i++) {
            let appId = dockAppsIds[i];
            let appInfo = Gio.DesktopAppInfo.new(appId);
            if (!appInfo) continue;

            let row = new St.BoxLayout({ vertical: false, style: 'padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.05);' });
            let icon = new St.Icon({ gicon: appInfo.get_icon(), icon_size: 24, style: 'margin-right: 10px;' });
            let label = new St.Label({ text: appInfo.get_name(), y_align: Clutter.ActorAlign.CENTER, x_expand: true });
            
            let upBtn = new St.Button({ 
                child: new St.Icon({ icon_name: 'go-up-symbolic', icon_size: 16 }), 
                style_class: 'prism-widget-menu-btn', style: 'padding: 5px; margin-right: 5px;', reactive: true 
            });
            if (i === 0) upBtn.opacity = 0; 
            else upBtn.connect('clicked', () => this._moveAppInDock(i, -1));

            let downBtn = new St.Button({ 
                child: new St.Icon({ icon_name: 'go-down-symbolic', icon_size: 16 }), 
                style_class: 'prism-widget-menu-btn', style: 'padding: 5px; margin-right: 10px;', reactive: true 
            });
            if (i === dockAppsIds.length - 1) downBtn.opacity = 0; 
            else downBtn.connect('clicked', () => this._moveAppInDock(i, 1));

            let removeBtn = new St.Button({ 
                child: new St.Icon({ icon_name: 'list-remove-symbolic', icon_size: 16 }), 
                style_class: 'prism-widget-menu-btn', style: 'padding: 5px; color: #ff5555;', reactive: true 
            });
            
            removeBtn.connect('clicked', () => {
                let currentApps = this.settings.get_strv('dock-apps') || [];
                let newApps = currentApps.filter(a => a !== appId);
                this.settings.set_strv('dock-apps', newApps);
                this._reloadDockIcons();
                
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    this._refreshAppManagerUI();
                    return GLib.SOURCE_REMOVE;
                });
            });

            row.add_child(icon);
            row.add_child(label);
            row.add_child(upBtn);
            row.add_child(downBtn);
            row.add_child(removeBtn);
            this._dockAppList.add_child(row);
        }

        for (let app of allApps) {
            let appId = app.get_id();
            if (dockAppsIds.includes(appId)) continue; 

            let row = new St.BoxLayout({ vertical: false, style: 'padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.05);' });
            let icon = new St.Icon({ gicon: app.get_icon(), icon_size: 24, style: 'margin-right: 10px;' });
            let label = new St.Label({ text: app.get_name(), y_align: Clutter.ActorAlign.CENTER, x_expand: true });
            
            let addBtn = new St.Button({ 
                child: new St.Icon({ icon_name: 'list-add-symbolic', icon_size: 16 }), 
                style_class: 'prism-widget-menu-btn', style: 'padding: 5px; color: #81C784;', reactive: true 
            });
            
            addBtn.connect('clicked', () => {
                let currentApps = this.settings.get_strv('dock-apps') || [];
                if (!currentApps.includes(appId)) {
                    currentApps.push(appId);
                    this.settings.set_strv('dock-apps', currentApps);
                    this._reloadDockIcons();
                    
                    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                        this._refreshAppManagerUI();
                        return GLib.SOURCE_REMOVE;
                    });
                }
            });

            row.add_child(icon);
            row.add_child(label);
            row.add_child(addBtn);
            this._systemAppList.add_child(row);
        }
    }

    _moveAppInDock(index, direction) {
        let apps = this.settings.get_strv('dock-apps') || [];
        if (index + direction < 0 || index + direction >= apps.length) return;

        let temp = apps[index];
        apps[index] = apps[index + direction];
        apps[index + direction] = temp;

        this.settings.set_strv('dock-apps', apps);
        this._reloadDockIcons();
        this._refreshAppManagerUI();
    }

    _reloadDockIcons() {
        let children = this.container.get_children();
        for (let child of children) {
            if (child === this._separator) continue;
            if (child._appId) {
                child.destroy();
            }
        }

        let apps = this.settings.get_strv('dock-apps') || [];
        for (let desktop of apps) {
            this.addAppIcon(desktop, true);
        }
    }


    _addApp(desktopFile) {
        let apps = this.settings.get_strv('dock-apps');
        if (!apps.includes(desktopFile)) {
            apps.push(desktopFile);
            this.settings.set_strv('dock-apps', apps);
            this.addAppIcon(desktopFile, true);
        }
    }


    addAppIcon(desktopFile, isPinned = true) {
        let appInfo = Gio.DesktopAppInfo.new(desktopFile);
        if (!appInfo) {
            return;
        }

        let icon = new St.Button({ style_class: 'app-icon' });
        icon._prismDestroyed = false;
        icon.connect('destroy', () => {
            icon._prismDestroyed = true;
            icon._dotContainer = null;
        });
        
        let iconContainer = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER
        });

        let gicon = appInfo.get_icon();
        let iconImage = new St.Icon({ gicon: gicon, icon_size: 50 });
        
        let overlapWrapper = new St.Widget({
            layout_manager: new Clutter.BinLayout()
        });

        icon._dotContainer = new St.BoxLayout({
            vertical: false,
            style_class: 'app-dot-container',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.END,
            translation_y: 30
        });

        overlapWrapper.add_child(iconImage);
        overlapWrapper.add_child(icon._dotContainer);

        iconContainer.add_child(overlapWrapper);

        icon._mediaBox = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'media-dock-box',
            visible: false, 
            opacity: 0,
            style: 'margin-left: 10px;' 
        });

        let infoBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'margin-right: 12px; min-width: 120px; max-width: 150px;'
        });

        icon._titleContainer = new St.Widget({
            clip_to_allocation: true,
            x_expand: true,
            height: 20
        });

        icon._mediaLabel = new St.Label({
            text: '',
            style: 'font-weight: bold; font-size: 13px;'
        });
        
        icon._titleContainer.add_child(icon._mediaLabel);

        icon._progressTrack = new St.BoxLayout({
            style_class: 'media-progress-bar',
            y_align: Clutter.ActorAlign.END,
            x_expand: true,
            style: 'margin-top: 4px;'
        });

        icon._progressFill = new St.Widget({
            style_class: 'media-progress-fill',
            x_expand: false,
            width: 0
        });
        icon._progressTrack.add_child(icon._progressFill);

        infoBox.add_child(icon._titleContainer);
        infoBox.add_child(icon._progressTrack);

        let controlsBox = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER
        });

        icon._mediaPrevBtn = new St.Button({
            child: new St.Icon({ icon_name: 'media-skip-backward-symbolic', icon_size: 16 }),
            style_class: 'media-control-btn'
        });
        icon._mediaPrevBtn.connect('clicked', () => {
            if (this._mediaProxy) this._mediaProxy.call_sync('Previous', null, Gio.DBusCallFlags.NONE, -1, null);
        });

        icon._mediaPlayBtn = new St.Button({
            child: new St.Icon({ icon_name: 'media-playback-pause-symbolic', icon_size: 20 }),
            style_class: 'media-control-btn media-play-btn'
        });
        icon._mediaPlayBtn.connect('clicked', () => {
            if (this._mediaProxy) this._mediaProxy.call_sync('PlayPause', null, Gio.DBusCallFlags.NONE, -1, null);
        });

        icon._mediaNextBtn = new St.Button({
            child: new St.Icon({ icon_name: 'media-skip-forward-symbolic', icon_size: 16 }),
            style_class: 'media-control-btn'
        });
        icon._mediaNextBtn.connect('clicked', () => {
            if (this._mediaProxy) this._mediaProxy.call_sync('Next', null, Gio.DBusCallFlags.NONE, -1, null);
        });

        controlsBox.add_child(icon._mediaPrevBtn);
        controlsBox.add_child(icon._mediaPlayBtn);
        controlsBox.add_child(icon._mediaNextBtn);

        icon._mediaBox.add_child(infoBox);
        icon._mediaBox.add_child(controlsBox);
        
        iconContainer.add_child(icon._mediaBox);
        icon.set_child(iconContainer);
        icon._appId = desktopFile;

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

                let app = Shell.AppSystem.get_default().lookup_app(desktopFile);
                let windows = app ? app.get_windows() : [];

                if (windows.length === 0) {
                    appInfo.launch([], null);
                } else if (windows.length === 1) {
                    windows[0].activate(global.get_current_time());
                } else {
                    this._showWindowSelectMenu(icon, windows, appInfo);
                }
            }
        });

        let hoverTimer = null;
        icon.connect('enter-event', () => {
            if (this._editMode) return;

            if (icon._hoverTimer) {
                GLib.Source.remove(icon._hoverTimer);
                icon._hoverTimer = null;
            }

            icon._hoverTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                icon._hoverTimer = null;
                if (!icon._prismDestroyed)
                    this._showWindowList(appInfo, icon);
                return GLib.SOURCE_REMOVE;
            });
        });

        icon.connect('leave-event', () => {
            if (icon._hoverTimer) {
                GLib.Source.remove(icon._hoverTimer);
                icon._hoverTimer = null;
            }
        });

        icon.connect('destroy', () => {
            icon._prismDestroyed = true;
            icon._dotContainer = null;
            if (icon._hoverTimer) {
                GLib.Source.remove(icon._hoverTimer);
                icon._hoverTimer = null;
            }
        });

        let app = Shell.AppSystem.get_default().lookup_app(desktopFile);
        
        if (app) {
            icon._windowsChangedId = app.connect('windows-changed', () => {
                this._updateAppDots(icon, desktopFile);
            });
            this._updateAppDots(icon, desktopFile);
        }

        icon._isPinned = isPinned;

        if (isPinned && this._separator) {
            let sepIndex = this.container.get_children().indexOf(this._separator);
            if (sepIndex !== -1) {
                this.container.insert_child_at_index(icon, sepIndex);
            } else {
                this.container.add_child(icon);
            }
        } else {
            this.container.add_child(icon);
        }

        this._updateSeparatorVisibility();
    }

    _showWindowSelectMenu(sourceActor, windows, appInfo) {
        if (this._customWindowMenu) {
            this._customWindowMenu.destroy();
            this._customWindowMenu = null;
        }

        this._customWindowMenu = new St.BoxLayout({
            vertical: true,
            style_class: 'prism-window-menu',
            style: 'background-color: rgba(30, 30, 30, 0.95);; border-radius: 8px; padding: 5px; border: 1px solid rgba(255,255,255,0.1);',
            reactive: true
        });

        windows.forEach(win => {
            let title = win.get_title() || appInfo.get_name();
            if (title.length > 40) title = title.substring(0, 37) + '...';
            
            let btn = new St.Button({
                child: new St.Label({ text: title }),
                style: 'padding: 8px 12px; color: white; text-align: left; border-radius: 4px;',
                reactive: true,
                can_focus: true,
                track_hover: true
            });

            btn.connect('notify::hover', () => {
                btn.style = btn.hover ? 'padding: 8px 12px; color: white; text-align: left; border-radius: 4px; background-color: rgba(255,255,255,0.1);' 
                                      : 'padding: 8px 12px; color: white; text-align: left; border-radius: 4px;';
            });

            btn.connect('clicked', () => {
                win.activate(global.get_current_time());
                this._customWindowMenu.destroy();
                this._customWindowMenu = null;
            });

            this._customWindowMenu.add_child(btn);
        });

        let newBtn = new St.Button({
            child: new St.Label({ text: "Nouvelle fenêtre" }),
            style: 'padding: 8px 12px; color: #ffffff; text-align: center; font-weight: bold; margin-top: 4px;',
            reactive: true
        });
        newBtn.connect('clicked', () => {
            appInfo.launch([], null);
            this._customWindowMenu.destroy();
            this._customWindowMenu = null;
        });
        this._customWindowMenu.add_child(newBtn);

        Main.layoutManager.addChrome(this._customWindowMenu);
        
        let [iconX, iconY] = sourceActor.get_transformed_position();
        let [iconWidth, iconHeight] = sourceActor.get_transformed_size();
        
        this._customWindowMenu.clutter_text_direction = Clutter.TextDirection.LTR;
        this._customWindowMenu.queue_relayout();
        
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (this._customWindowMenu) {
                let menuWidth = this._customWindowMenu.width;
                let menuHeight = this._customWindowMenu.height;
                
                this._customWindowMenu.set_position(
                    iconX + (iconWidth / 2) - (menuWidth / 2),
                    iconY - menuHeight - 20 
                );
            }
            return GLib.SOURCE_REMOVE;
        });

        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._stageEventId = global.stage.connect('captured-event', (actor, event) => {
                if (event.type() === Clutter.EventType.BUTTON_PRESS) {
                    let target = event.get_source();
                    
                    if (this._customWindowMenu && !this._customWindowMenu.contains(target)) {
                        this._closeWindowSelectMenu();
                    }
                }

                return Clutter.EVENT_PROPAGATE; 
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    _closeWindowSelectMenu() {
        if (this._customWindowMenu) {
            Main.layoutManager.removeChrome(this._customWindowMenu); 
            this._customWindowMenu.destroy();
            this._customWindowMenu = null;
        }
        
        if (this._stageEventId) {
            global.stage.disconnect(this._stageEventId);
            this._stageEventId = null;
        }
    }

    _expandAppIcon(cleanAppName, title, isPlaying, length = 0, position = 0) {
        let targetIcon = null;
        let children = this.container.get_children();

        for (let child of children) {
            if (child._appId) {
                let dockAppId = child._appId.toLowerCase();
                if (dockAppId.includes(cleanAppName) || cleanAppName.includes(dockAppId.replace('.desktop', ''))) {
                    targetIcon = child;
                    break;
                }
            }
        }

        if (!targetIcon) {
            let allApps = Gio.AppInfo.get_all();
            
            let matchedApp = allApps.find(app => {
                let id = app.get_id() ? app.get_id().toLowerCase() : '';
                return id.includes(cleanAppName) || cleanAppName.includes(id.replace('.desktop', ''));
            });

            if (matchedApp) {
                let desktopId = matchedApp.get_id();
                this.addAppIcon(desktopId, false);
                
                let newChildren = this.container.get_children();
                for (let child of newChildren) {
                    if (child._appId === desktopId) {
                        targetIcon = child;
                        targetIcon._isTempMediaIcon = true; 
                        break;
                    }
                }
            } else {
                return;
            }
        }

        if (!targetIcon || !targetIcon._mediaBox) {
            return;
        }

        targetIcon._mediaLabel.set_text(title);
        let iconName = isPlaying ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        targetIcon._mediaPlayBtn.get_child().set_icon_name(iconName);

        if (!targetIcon._mediaBox.visible) {
            targetIcon.add_style_class_name('media-active-capsule');
            targetIcon._mediaBox.show(); 
            targetIcon._mediaBox.ease({
                opacity: 255,
                duration: 300,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD
            });
        }

        targetIcon._mediaLabel.translation_x = 0;
        targetIcon._mediaLabel.remove_all_transitions();
        
        Mainloop.idle_add(() => {
            if (!targetIcon || !targetIcon._mediaLabel) return GLib.SOURCE_REMOVE;
            
            let labelWidth = targetIcon._mediaLabel.get_width();
            let containerWidth = targetIcon._titleContainer.get_width();
            
            if (labelWidth > containerWidth && containerWidth > 0) {
                let distance = labelWidth - containerWidth + 5; 
                let speed = distance * 100;
                
                const slideLeft = () => {
                    if (!targetIcon || !targetIcon._mediaLabel) return GLib.SOURCE_REMOVE;
                    targetIcon._mediaLabel.ease({
                        translation_x: -distance,
                        duration: speed,
                        mode: Clutter.AnimationMode.LINEAR,
                        onComplete: () => {
                            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, slideRight);
                        }
                    });
                    return GLib.SOURCE_REMOVE;
                };
                
                const slideRight = () => {
                    if (!targetIcon || !targetIcon._mediaLabel) return GLib.SOURCE_REMOVE;
                    targetIcon._mediaLabel.ease({
                        translation_x: 0,
                        duration: Math.max(speed / 2, 500),
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        onComplete: () => {
                            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, slideLeft);
                        }
                    });
                    return GLib.SOURCE_REMOVE;
                };
                
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, slideLeft);
            }
            return GLib.SOURCE_REMOVE;
        });

        if (this._progressTimerId) {
            GLib.Source.remove(this._progressTimerId);
            this._progressTimerId = null;
        }

        const updateProgressBar = (currentPos) => {
            if (length > 0) {
                let percent = currentPos / length;
                if (percent > 1) percent = 1;
                let trackWidth = targetIcon._progressTrack.get_width();
                if (trackWidth > 0) {
                    targetIcon._progressFill.set_width(trackWidth * percent);
                }
            } else {
                targetIcon._progressFill.set_width(0);
            }
        };

        Mainloop.idle_add(() => {
            updateProgressBar(position);
            return GLib.SOURCE_REMOVE;
        });

        if (isPlaying && length > 0) {
            let simulatedPosition = position;
            this._progressTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                simulatedPosition += 1000000;
                updateProgressBar(simulatedPosition);
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    _collapseAppIcon(cleanAppName) {
        let children = this.container.get_children();

        if (this._progressTimerId) {
            GLib.Source.remove(this._progressTimerId);
            this._progressTimerId = null;
        }

        for (let child of children) {
            if (child._appId) {
                let dockAppId = child._appId.toLowerCase();
                
                if (dockAppId.includes(cleanAppName) || cleanAppName.includes(dockAppId.replace('.desktop', ''))) {
                    
                    if (child._mediaBox && child._mediaBox.visible) {
                        child._mediaBox.ease({
                            opacity: 0,
                            duration: 200,
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                            onComplete: () => {
                                child._mediaBox.hide(); 
                                child.remove_style_class_name('media-active-capsule');
                                
                                if (child._isTempMediaIcon) {
                                    child.destroy();
                                }

                                let appState = Shell.AppSystem.get_default().lookup_app(child._appId)?.get_state();

                                if (!child._isPinned && appState !== Shell.AppState.RUNNING) {
                                    child.destroy();
                                    this._updateSeparatorVisibility();
                                }
                            }
                        });
                    } else if (child._isTempMediaIcon) {
                        child.destroy();
                    }
                }
            }
        }
    }

    _updateAppDots(icon, desktopFile) {
        try {
            if (!icon || icon._prismDestroyed || !icon._dotContainer) return;
            icon._dotContainer.destroy_all_children();
            
            let app = Shell.AppSystem.get_default().lookup_app(desktopFile);
            
            if (app && app.get_state() === Shell.AppState.RUNNING) {
                let windows = app.get_windows().filter(w => !w.is_skip_taskbar());
                let windowCount = windows.length;
                
                let displayCount = Math.min(windowCount, 4); 
                
                for (let i = 0; i < displayCount; i++) {
                    let dot = new St.Widget({ style_class: 'app-dot' });
                    icon._dotContainer.add_child(dot);
                }
                
                if (windowCount > 4) {
                    let plus = new St.Label({ 
                        text: '+', 
                        style: 'font-size: 8px; font-weight: bold; margin-left: 1px; color: white;' 
                    });
                    icon._dotContainer.add_child(plus);
                }
            }
        } catch (e) {

        }
    }

    _removeApp(desktopFile, iconButton) {
        let apps = this.settings.get_strv('dock-apps') || [];
        apps = apps.filter(a => a !== desktopFile);
        this.settings.set_strv('dock-apps', apps);

        if (iconButton && iconButton.get_parent && iconButton.get_parent()) {
            try {
                let appState = Shell.AppSystem.get_default().lookup_app(desktopFile)?.get_state();
                iconButton.destroy();

                if (appState === Shell.AppState.RUNNING) {
                    this.addAppIcon(desktopFile, false);
                }
                this._updateSeparatorVisibility();
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

        let popup = new St.BoxLayout({
            name: 'pop-up-lyt',
            vertical: true,
            style_class: 'window-list-popup',
            reactive: true,
            can_focus: true,
            track_hover: true
        });

        for (let w of windows) {
            let row = new St.BoxLayout({ 
                vertical: false, 
                name: 'windows-row',
                style_class: 'window-list-item' 
            });

            let label = new St.Label({
                text: w.get_title() || 'Sans titre',
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true
            });

            row.connect('clicked', () => {
                try { w.activate(global.get_current_time()); } catch (e) {}
                this._hideWindowList();
            });

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

            closeBtn.connect('clicked', () => {
                try {
                    if (w.delete) w.delete(global.get_current_time());
                    else if (w.request_close) w.request_close();
                    else if (w.kill) w.kill(global.get_current_time());
                } catch (err) { logError(err, 'Erreur fermeture fenêtre'); }

                try { row.destroy(); } catch (e) {}

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

        Main.layoutManager.addChrome(popup);
        this.windowListPopup = popup;

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
                        try { 
                            Main.layoutManager.removeChrome(this.windowListPopup); // <-- AJOUT ICI
                            this.windowListPopup.destroy(); 
                        } catch (e) {}
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
        GLib.spawn_command_line_async('gnome-session-quit --power-off');
    }

    addCustomIcon(iconPath, labelText = '', appId = null) {
        let icon = new St.Button({ style_class: 'app-icon' });

        let fileIcon = new Gio.FileIcon({ file: Gio.File.new_for_path(iconPath) });
        let iconImage = new St.Icon({
            gicon: fileIcon,
            icon_size: 50
        });

        icon.set_child(iconImage);

        icon.connect('clicked', () => {
            if (menu) {
                menu.destroy();
                menu = null;
            }   
            if (global.networkSetting && global.networkSetting._closeAllMenus) {
                global.networkSetting._closeAllMenus();
            }
            
            // On lance l'application spécifique si un ID est fourni
            if (appId) {
                _launchOrDownloadApp(this._ext, appId);
            }
        });

        if (labelText) {
            icon.connect('enter-event', () => this._showTooltip(labelText, icon));
            icon.connect('leave-event', () => this._hideTooltip());
        }

        this.container.insert_child_at_index(icon, 1);
    }

    _openNewFunc() {
        if (this.storeDialog) {
            this.storeDialog.close();
            this.storeDialog = null;
        }

        this.storeDialog = new ModalDialog.ModalDialog({
            styleClass: 'prism-app-manager-dialog',
            destroyOnClose: true
        });

        let monitor = Main.layoutManager.primaryMonitor;
        let targetHeight = Math.floor(monitor.height * 0.7);

        let mainBox = new St.BoxLayout({ 
            vertical: true, 
            x_expand: true, 
            y_expand: true,
            width: 450,
            height: targetHeight 
        });

        let title = new St.Label({ 
            text: "Fonctionnalités PRISM", 
            style: 'font-weight: bold; font-size: 20px; margin-bottom: 20px; color: #ffffff; text-align: center;' 
        });
        mainBox.add_child(title);

        let scroll = new St.ScrollView({ 
            style_class: 'vfade', 
            hscrollbar_policy: St.PolicyType.NEVER, 
            vscrollbar_policy: St.PolicyType.AUTOMATIC, 
            x_expand: true, 
            y_expand: true 
        });
        
        let list = new St.BoxLayout({ vertical: true });
        scroll.set_child(list);
        mainBox.add_child(scroll);

        let extDir = this._ext.path;
        let programDir = GLib.build_filenamev([extDir, 'System', 'Program']);
        
        let arch = getSystemArchitecture();

        for (let id in PRISM_APPS) {
            let app = PRISM_APPS[id];
            let targetFileName = app.getFileName(arch, app.version);
            let targetFilePath = GLib.build_filenamev([programDir, targetFileName]);
            
            let isExactInstalled = Gio.File.new_for_path(targetFilePath).query_exists(null);
            let oldFilePath = null;

            let dir = Gio.File.new_for_path(programDir);
            if (dir.query_exists(null)) {
                let enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
                
                let searchKeyword = targetFileName.split('-')[0].replace('.js', '').replace('.AppImage', '').toLowerCase();

                while (true) {
                    let info = enumerator.next_file(null);
                    if (!info) break;
                    let name = info.get_name();
                    
                    if (name.toLowerCase().includes(searchKeyword) && (name.endsWith('.AppImage') || name.endsWith('.js'))) {
                        let fullPath = GLib.build_filenamev([programDir, name]);
                        
                        if (name !== targetFileName) {
                            oldFilePath = fullPath;
                        } else {
                            isExactInstalled = true;
                            oldFilePath = null;
                        }
                    }
                }
            }

            let row = new St.BoxLayout({ 
                vertical: false, 
                style: 'padding: 15px; border-bottom: 1px solid rgba(255,255,255,0.1);' 
            });
            
            let iconPath = GLib.build_filenamev([extDir, 'icons', app.icon]);
            let gicon = Gio.File.new_for_path(iconPath).query_exists(null) 
                ? Gio.icon_new_for_string(iconPath) 
                : Gio.icon_new_for_string('application-x-executable-symbolic');
                
            let icon = new St.Icon({ gicon: gicon, icon_size: 48, style: 'margin-right: 15px;' });
            
            let infoBox = new St.BoxLayout({ vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER });
            let nameLabel = new St.Label({ text: app.name, style: 'font-weight: bold; font-size: 16px;' });
            let versionLabel = new St.Label({ text: `Version ${app.version}`, style: 'font-size: 12px; color: #aaa;' });
            infoBox.add_child(nameLabel);
            infoBox.add_child(versionLabel);
            
            let btnBox = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER });
            
            if (isExactInstalled) {
                let removeBtn = new St.Button({ 
                    child: new St.Label({ text: "Désinstaller" }), 
                    style_class: 'prism-widget-menu-btn', 
                    style: 'padding: 8px 15px; color: #ff5555; font-weight: bold;', 
                    reactive: true 
                });
                removeBtn.connect('clicked', () => {
                    Gio.File.new_for_path(targetFilePath).delete(null);
                    _registerPrismApps(this._ext); 
                    this.storeDialog.close();
                });
                btnBox.add_child(removeBtn);
            } else if (oldFilePath) {
                let updateBtn = new St.Button({ 
                    child: new St.Label({ text: "Mettre à jour" }), 
                    style_class: 'prism-widget-menu-btn', 
                    style: 'padding: 8px 15px; color: #FFB74D; font-weight: bold;', 
                    reactive: true 
                });
                updateBtn.connect('clicked', () => {
                    this.storeDialog.close();
                    try { Gio.File.new_for_path(oldFilePath).delete(null); } catch(e) {}
                    this._confirmDownload(id);
                });
                btnBox.add_child(updateBtn);
            } else {
                let installBtn = new St.Button({ 
                    child: new St.Label({ text: "Installer" }), 
                    style_class: 'prism-widget-menu-btn', 
                    style: 'padding: 8px 15px; color: #81C784; font-weight: bold;', 
                    reactive: true 
                });
                installBtn.connect('clicked', () => {
                    this.storeDialog.close();
                    this._confirmDownload(id); 
                });
                btnBox.add_child(installBtn);
            }

            row.add_child(icon);
            row.add_child(infoBox);
            row.add_child(btnBox);
            list.add_child(row);
        }

        this.storeDialog.contentLayout.add_child(mainBox);

        this.storeDialog.addButton({
            label: 'Fermer',
            action: () => {
                this.storeDialog.close();
                this.storeDialog = null;
            },
            key: Clutter.KEY_Escape
        });

        this.storeDialog.open();
    }

    _confirmDownload(appId) {
        let appConfig = PRISM_APPS[appId];
        let arch = getSystemArchitecture();
        let fileName = appConfig.getFileName(arch, appConfig.version);
        let downloadUrl = `https://github.com/${appConfig.repo}/releases/download/${appConfig.tag}/${fileName}`;

        let confirmDialog = new ModalDialog.ModalDialog({ destroyOnClose: true });
        
        let mainBox = new St.BoxLayout({ vertical: true, style: 'padding: 20px;' });
        let title = new St.Label({ text: `Installation de ${appConfig.name}`, style: 'font-weight: bold; font-size: 18px; margin-bottom: 10px; color: #ffffff;' });
        let msgLabel = new St.Label({ text: "Calcul de la taille du fichier en cours...", style: 'margin-bottom: 20px;' });
        
        mainBox.add_child(title);
        mainBox.add_child(msgLabel);
        confirmDialog.contentLayout.add_child(mainBox);

        confirmDialog.addButton({
            label: 'Annuler',
            action: () => confirmDialog.close(),
            key: Clutter.KEY_Escape
        });

        let validateBtn = confirmDialog.addButton({
            label: 'Autoriser et Installer',
            action: () => {
                confirmDialog.close();
                _launchOrDownloadApp(this._ext, appId);
                if (appId === 'desktools') {
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
                        this._reloadDockIcons();
                        return GLib.SOURCE_REMOVE;
                    });
                }
            }
        });
        validateBtn.reactive = false;
        validateBtn.opacity = 128;

        confirmDialog.open();

        let session = new Soup.Session();
        let message = Soup.Message.new('HEAD', downloadUrl);
        
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (sess, result) => {
            try {
                sess.send_and_read_finish(result);
                let contentLength = message.response_headers.get_content_length();
                let sizeStr = "Taille inconnue";
                
                if (contentLength > 0) {
                    let sizeMb = (contentLength / (1024 * 1024)).toFixed(2);
                    sizeStr = `${sizeMb} Mo`;
                }

                msgLabel.set_text(`L'application ${appConfig.name} nécessite un téléchargement.\nTaille estimée : ${sizeStr}\n\nVoulez-vous autoriser cette installation ?`);
                validateBtn.reactive = true;
                validateBtn.opacity = 255;
            } catch (e) {
                msgLabel.set_text(`L'application ${appConfig.name} nécessite un téléchargement.\nTaille estimée : Indisponible (Erreur réseau)\n\nVoulez-vous forcer l'installation ?`);
                validateBtn.reactive = true;
                validateBtn.opacity = 255;
            }
        });
    }

    _setPosition() {
        let monitor = Main.layoutManager.primaryMonitor;
        if (!monitor || !this.container || this.container.width <= 0) return;
        
        let bottomOffset = 10;
        let targetX = Math.round((monitor.width / 2) - (this.container.width / 2));
        let targetY = Math.round(monitor.height - this.container.height - bottomOffset);

        let currentX = Math.round(this.container.x);
        let currentY = Math.round(this.container.y);

        if (currentX !== targetX || currentY !== targetY) {
            this.container.set_position(targetX, targetY);
        }
    }

    destroy() {
    this._closeWindowSelectMenu();

    if (this._sleepSignalId) {
        try {
            let bus = Gio.bus_get_sync(Gio.BusType.SYSTEM, null);
            bus.signal_unsubscribe(this._sleepSignalId);
        } catch (e) {}
        this._sleepSignalId = 0;
    }

    if (this._progressTimerId) {
        GLib.Source.remove(this._progressTimerId);
        this._progressTimerId = null;
    }

    if (this.appManagerDialog) {
        this.appManagerDialog.close();
        this.appManagerDialog = null;
    }

    if (this.storeDialog) {
        this.storeDialog.close();
        this.storeDialog = null;
    }

    if (this._mediaProxy) {
        if (this._mediaSignalId) {
            try { this._mediaProxy.disconnect(this._mediaSignalId); } catch (e) {}
            this._mediaSignalId = 0;
        }
        if (this._mediaOwnerId) {
            try { this._mediaProxy.disconnect(this._mediaOwnerId); } catch (e) {}
            this._mediaOwnerId = 0;
        }
        this._mediaProxy = null;
    }

    if (this._posIdleId) {
        GLib.Source.remove(this._posIdleId);
        this._posIdleId = 0;
    }

    if (this._dockMonitorId) {
        Main.layoutManager.disconnect(this._dockMonitorId);
        this._dockMonitorId = 0;
    }
    
    if (this.tooltip) {
        Main.layoutManager.removeChrome(this.tooltip);
        this.tooltip.destroy();
    }

    if (this._posIdleId) {
        GLib.Source.remove(this._posIdleId);
        this._posIdleId = 0;
    }
    
    if (this.container) {
        this.container.destroy();
    }

    if (this._nameOwnerChangedId) {
        let bus = Gio.bus_get_sync(Gio.BusType.SESSION, null);
        bus.signal_unsubscribe(this._nameOwnerChangedId);
        this._nameOwnerChangedId = 0;
    }

    if (this._appStateChangedId && this._appSystem) {
        this._appSystem.disconnect(this._appStateChangedId);
        this._appStateChangedId = 0;
    }

    if (this._windowMenu) {
        this._windowMenu.destroy();
        this._windowMenu = null;
    }

    if (this._menuManager) {
        this._menuManager = null;
    }

    if (this.customDockMenu) {
        this.customDockMenu.destroy();
        this.customDockMenu = null;
    }
}
}

class CustomPopup {
    constructor(x, y, sourceActor) {
        this.actor = new St.BoxLayout({
            name: 'dock-context-menu',
            style_class: 'dock-context-menu',
            vertical: true,
            reactive: true
        });
        
        this._x = x;
        this._y = y;
        this._sourceActor = sourceActor;
        this._isOpen = false;
        this._globalEvent = null;
        this._idleId = 0;

        Main.layoutManager.addChrome(this.actor);

        this.actor.connect('button-press-event', () => Clutter.EVENT_STOP);
        this.actor.connect('touch-event', () => Clutter.EVENT_STOP);
    }

    addItem(labelText, callback, iconName = null) {
        let button = new St.Button({
            style_class: 'popup-menu-item',
            reactive: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.CENTER,
            can_focus: true,
            track_hover: true
        });

        let box = new St.BoxLayout({ 
            name: 'box-item', 
            vertical: false, 
            style: 'padding: 8px;',
            x_expand: true,
            x_align: Clutter.ActorAlign.START
        });
        
        if (iconName) {
            let icon = new St.Icon({ icon_name: iconName, icon_size: 16, style: 'margin-right: 10px;' });
            box.add_child(icon);
        }

        let label = new St.Label({ text: labelText, y_align: Clutter.ActorAlign.CENTER });
        box.add_child(label);
        button.set_child(box);

        button.connect('clicked', () => {
            this.destroy(); 
            if (callback) callback();
        });

        this.actor.add_child(button);
    }

    openUpwards(isCentered = false) {
        this._isOpen = true;
        this.actor.opacity = 0;
        
        this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._idleId = 0;
            if (!this.actor) return GLib.SOURCE_REMOVE;

            let menuHeight = this.actor.height;
            let menuWidth = this.actor.width;

            let finalY = this._y - menuHeight - 10;
            let finalX = isCentered ? (this._x - (menuWidth / 2)) : this._x;

            let monitor = Main.layoutManager.primaryMonitor;
            
            if (finalX + menuWidth > monitor.width) finalX = monitor.width - menuWidth - 10;
            if (finalX < 10) finalX = 10;
            if (finalY < 10) finalY = 10;

            this.actor.set_position(finalX, finalY);
            this.actor.opacity = 255;
            
            this._setupClickOutside();
            return GLib.SOURCE_REMOVE;
        });
    }

    _setupClickOutside() {
        if (this._globalEvent) {
            global.stage.disconnect(this._globalEvent);
            this._globalEvent = null;
        }

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            if (!this.actor) return GLib.SOURCE_REMOVE;

            this._globalEvent = global.stage.connect('captured-event', (stage, event) => {
                let type = event.type();
                
                if (type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN) {
                    let coords = event.get_coords();
                    if (!coords) return Clutter.EVENT_PROPAGATE;
                    let [mouseX, mouseY] = coords;

                    let isInside = (targetActor, px, py) => {
                        if (!targetActor || !targetActor.visible) return false;
                        let [ax, ay] = targetActor.get_transformed_position();
                        let [aw, ah] = targetActor.get_transformed_size();
                        return px >= ax && px <= ax + aw && py >= ay && py <= ay + ah;
                    };

                    if (isInside(this.actor, mouseX, mouseY) || isInside(this._sourceActor, mouseX, mouseY)) {
                        return Clutter.EVENT_PROPAGATE;
                    }

                    this.destroy();
                    return Clutter.EVENT_STOP;
                }

                return Clutter.EVENT_PROPAGATE;
            });
            
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        if (this._idleId) {
            GLib.Source.remove(this._idleId);
            this._idleId = 0;
        }

        if (this._globalEvent) {
            global.stage.disconnect(this._globalEvent);
            this._globalEvent = null;
        }

        if (this.actor) {
            Main.layoutManager.removeChrome(this.actor);
            this.actor.destroy();
            this.actor = null;
        }
        
        this._isOpen = false;
    }
}

class HomeBar {
    constructor() {
        this.actor = new St.Button({
            style_class: 'prism-home-bar',
            reactive: true,
            opacity: 0
        });
        Main.layoutManager.addChrome(this.actor);

        this._windowSizeId = 0;
        this._windowMinId = 0;
        this._currentWindow = null;
        this._visibilityTimeoutId = 0;
        this._destroyed = false;

        this._setPosition();
        this._setupEvents();
        this._setupWindowTracking();

        this._monitorId = Main.layoutManager.connect('monitors-changed', () => this._setPosition());
    }

    _setupWindowTracking() {
        this._focusId = global.display.connect('notify::focus-window', () => this._evaluateState());
        this._workspaceId = global.workspace_manager.connect('workspace-switched', () => this._evaluateState());
        
        this._evaluateState();
    }

    _evaluateState() {
        let focusWindow = global.display.get_focus_window();

        if (this._currentWindow) {
            if (this._windowSizeId) this._currentWindow.disconnect(this._windowSizeId);
            if (this._windowMinId) this._currentWindow.disconnect(this._windowMinId);
            this._windowSizeId = 0;
            this._windowMinId = 0;
        }

        this._currentWindow = focusWindow;

        if (this._currentWindow) {
            this._windowSizeId = this._currentWindow.connect('size-changed', () => this._applyVisibility());
            this._windowMinId = this._currentWindow.connect('notify::minimized', () => this._applyVisibility());
        }

        this._applyVisibility();
    }

    _applyVisibility() {
        if (!this.actor || this._destroyed) return;
        let workspace = global.workspace_manager.get_active_workspace();
        let windows = workspace.list_windows().filter(w => !w.is_skip_taskbar() && !w.minimized);
        
        let isMaximized = windows.some(w => w.maximized_vertically && w.maximized_horizontally);

        if (isMaximized) {
            this._showBar();
        } else {
            this._hideBar();
        }
    }

    _showBar() {
        if (!this.actor || this._destroyed) return;
        this.actor.show();
        this.actor.ease({
            opacity: 255,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD
        });
    }

    _hideBar() {
        if (!this.actor || this._destroyed) return;
        this.actor.ease({
            opacity: 0,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (this.actor && !this._destroyed && this.actor.opacity === 0)
                    this.actor.hide();
            }
        });
    }

    _setPosition() {
        if (!this.actor || this._destroyed) return;
        let monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;

        let width = 200;
        let height = 6;
        let bottomMargin = 4;

        this.actor.set_size(width, height);
        this.actor.set_position(
            monitor.x + (monitor.width - width) / 2,
            monitor.y + monitor.height - height - bottomMargin
        );
    }

    _setupEvents() {
        let pressY = 0;
        this._singleClickTimeoutId = 0;
        this._lastClickTime = 0;

        this.actor.reactive = true;

        const handleRelease = (releaseY) => {
            if (pressY - releaseY > 10) { 
                this._lastClickTime = 0;
                this._minimizeAll();
                return;
            } 

            let now = Date.now();
            let timeSinceLastClick = now - this._lastClickTime;

            if (timeSinceLastClick < 300) {
                if (this._singleClickTimeoutId) {
                    GLib.Source.remove(this._singleClickTimeoutId);
                    this._singleClickTimeoutId = 0;
                }
                this._lastClickTime = 0;
                
                Main.overview.toggle();
            } else {
                this._lastClickTime = now;
                
                this._singleClickTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                    this._singleClickTimeoutId = 0;
                    this._minimizeAll();
                    return GLib.SOURCE_REMOVE;
                });
            }
        };

        this.actor.connect('button-press-event', (actor, event) => {
            pressY = event.get_coords()[1];
            return Clutter.EVENT_PROPAGATE;
        });

        this.actor.connect('button-release-event', (actor, event) => {
            handleRelease(event.get_coords()[1]);
            return Clutter.EVENT_PROPAGATE;
        });

        this.actor.connect('touch-event', (actor, event) => {
            let type = event.type();

            if (type === Clutter.EventType.TOUCH_BEGIN) {
                pressY = event.get_coords()[1];
            } 

            else if (type === Clutter.EventType.TOUCH_END) {
                handleRelease(event.get_coords()[1]);
            }
            
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _minimizeAll() {
        let workspace = global.workspace_manager.get_active_workspace();
        let windows = workspace.list_windows().filter(w => !w.is_skip_taskbar() && !w.minimized);
        
        for (let win of windows) {
            if (win.can_minimize()) {
                win.minimize();
            }
        }
        
        if (this._visibilityTimeoutId)
            GLib.Source.remove(this._visibilityTimeoutId);
        this._visibilityTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            this._visibilityTimeoutId = 0;
            this._applyVisibility();
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        this._destroyed = true;
        if (this._singleClickTimeoutId) {
            GLib.Source.remove(this._singleClickTimeoutId);
            this._singleClickTimeoutId = 0;
        }
        if (this._visibilityTimeoutId) {
            GLib.Source.remove(this._visibilityTimeoutId);
            this._visibilityTimeoutId = 0;
        }

        if (this._monitorId) Main.layoutManager.disconnect(this._monitorId);
        if (this._focusId) global.display.disconnect(this._focusId);
        if (this._workspaceId) global.workspace_manager.disconnect(this._workspaceId);
        
        if (this._currentWindow) {
            if (this._windowSizeId) this._currentWindow.disconnect(this._windowSizeId);
            if (this._windowMinId) this._currentWindow.disconnect(this._windowMinId);
        }

        if (this.actor) {
            Main.layoutManager.removeChrome(this.actor);
            this.actor.destroy();
            this.actor = null;
        }
    }
}

function _launchOrDownloadApp(ext, appId) {
    let appConfig = PRISM_APPS[appId];
    if (!appConfig) {
        log(`[PrismUI] Erreur : L'application ${appId} n'est pas répertoriée.`);
        return;
    }

    let arch = getSystemArchitecture();

    let fileName = appConfig.getFileName(arch, appConfig.version);
    let programDir = GLib.build_filenamev([ext.path, 'System', 'Program']);
    let appImagePath = GLib.build_filenamev([programDir, fileName]);
    
    let file = Gio.File.new_for_path(appImagePath);
    let isJavaScript = fileName.toLowerCase().endsWith('.js');
    let launchCommand = isJavaScript ? ['gjs', appImagePath] : [appImagePath];

    let checkAndLaunch = () => {
        if (!isJavaScript) {
            let arch = getSystemArchitecture();
            let fusePaths = [
                `/lib/${arch}-linux-gnu/libfuse.so.2`,
                `/usr/lib/${arch}-linux-gnu/libfuse.so.2`,
                '/lib/libfuse.so.2',
                '/usr/lib/libfuse.so.2',
                '/lib64/libfuse.so.2',
                '/usr/lib64/libfuse.so.2'
            ];
            let isFuseInstalled = fusePaths.some(path => Gio.File.new_for_path(path).query_exists(null));

            if (!isFuseInstalled) {
                let dialog = new ModalDialog.ModalDialog({ destroyOnClose: true });
                
                let mainBox = new St.BoxLayout({ vertical: true, style: 'padding: 20px;' });
                let title = new St.Label({ text: "Dépendance requise : FUSE", style: 'font-weight: bold; font-size: 18px; margin-bottom: 10px; color: #ffffff;' });
                let msg = new St.Label({ 
                    text: `L'application "${appConfig.name}" est au format AppImage et nécessite la bibliothèque 'libfuse2' pour s'exécuter.\n\nVoulez-vous l'installer maintenant ?\n\nCommande : pkexec apt install -y libfuse2`,
                    style: 'max-width: 420px; color: #ccc; line-height: 1.4;' 
                });
                msg.clutter_text.set_line_wrap(true);
                
                mainBox.add_child(title);
                mainBox.add_child(msg);
                dialog.contentLayout.add_child(mainBox);

                dialog.addButton({
                    label: 'Annuler',
                    action: () => {
                        dialog.close();
                        try { file.delete(null); } catch(e) {}
                        Main.notify("PrismUI", "Installation annulée (AppImage supprimé).");
                    },
                    key: Clutter.KEY_Escape
                });

                dialog.addButton({
                    label: 'Installer libfuse2',
                    action: () => {
                        dialog.close();
                        Main.notify("PrismUI", "Installation de libfuse2 en cours...");
                        
                        try {
                            let proc = Gio.Subprocess.new(['pkexec', 'apt', 'install', '-y', 'libfuse2'], Gio.SubprocessFlags.NONE);
                            proc.wait_check_async(null, (obj, res) => {
                                try {
                                    obj.wait_check_finish(res);
                                    Main.notify("PrismUI", "libfuse2 installé avec succès !");
                                    _registerPrismApps(ext);
                                    Gio.Subprocess.new(launchCommand, Gio.SubprocessFlags.NONE);
                                } catch (err) {
                                    try { file.delete(null); } catch(e) {}
                                    Main.notify("PrismUI - Erreur", "Échec des privilèges. AppImage supprimé.");
                                }
                            });
                        } catch (err) {
                            log(`[PrismUI] Erreur pkexec: ${err.message}`);
                        }
                    }
                });

                dialog.open();
                return;
            }
        }

        _registerPrismApps(ext);
        try {
            Gio.Subprocess.new(launchCommand, Gio.SubprocessFlags.NONE);
        } catch (e) {
            log(`[PrismUI] Échec du lancement de ${appConfig.name} : ${e.message}`);
        }
    };

    if (file.query_exists(null)) {
        checkAndLaunch();
        return;
    }

    let progressDialog = new ModalDialog.ModalDialog({ destroyOnClose: false });
    let progressBox = new St.BoxLayout({ vertical: true, style: 'padding: 20px; min-width: 320px;' });
    let progressTitle = new St.Label({ text: `Téléchargement de ${appConfig.name}`, style: 'font-weight: bold; font-size: 16px; margin-bottom: 15px; color: #ffffff;' });
    let statusLabel = new St.Label({ text: "Connexion au serveur GitHub...", style: 'margin-bottom: 10px; color: #ccc;' });

    progressBox.add_child(progressTitle);
    progressBox.add_child(statusLabel);
    progressDialog.contentLayout.add_child(progressBox);
    progressDialog.open();

    let downloadUrl = `https://github.com/${appConfig.repo}/releases/download/${appConfig.tag}/${fileName}`;
    let dirFile = Gio.File.new_for_path(programDir);
    if (!dirFile.query_exists(null)) {
        dirFile.make_directory_with_parents(null);
    }

    let session = new Soup.Session();
    let message = Soup.Message.new('GET', downloadUrl);

    session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (sess, result) => {
        try {
            let bytes = sess.send_and_read_finish(result);
            let status = message.get_status();
            
            if (status !== 200) {
                throw new Error(`Erreur serveur HTTP ${status}`);
            }

            statusLabel.set_text("Écriture du fichier sur le disque...");

            file.replace_contents(bytes.get_data(), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            GLib.spawn_command_line_sync(`chmod +x "${appImagePath}"`);

            progressDialog.close();

            Main.notify("PrismUI", `${appConfig.name} téléchargé avec succès !`);
            checkAndLaunch();

        } catch (e) {
            progressDialog.close();
            log(`[PrismUI] Échec du téléchargement pour ${appConfig.name} : ${e.message}`);
            Main.notify("PrismUI - Erreur", `Impossible de récupérer ${appConfig.name}.`);
        }
    });
}

function _registerPrismApps(ext) {
    let appsDir = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'share', 'applications']);
    let extDir = ext.path;
    let programDir = GLib.build_filenamev([extDir, 'System', 'Program']);
    
    let arch = getSystemArchitecture();

    GLib.mkdir_with_parents(appsDir, 0o755);
    GLib.mkdir_with_parents(programDir, 0o755);

    for (let id in PRISM_APPS) {
        let app = PRISM_APPS[id];
        let fileName = app.getFileName(arch, app.version);
        let filePath = GLib.build_filenamev([programDir, fileName]);
        let desktopId = app.desktopId || id.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
        let desktopFilePath = GLib.build_filenamev([appsDir, `prism-${desktopId}.desktop`]);
        let legacyDesktopFilePath = GLib.build_filenamev([appsDir, `prism-${id}.desktop`]);

        if (legacyDesktopFilePath !== desktopFilePath) {
            let legacyFile = Gio.File.new_for_path(legacyDesktopFilePath);
            if (legacyFile.query_exists(null)) {
                legacyFile.delete(null);
            }
        }

        let isInstalled = Gio.File.new_for_path(filePath).query_exists(null);

        if (!isInstalled) {
            let file = Gio.File.new_for_path(desktopFilePath);
            if (file.query_exists(null)) file.delete(null);
            continue; 
        }
        
        let iconPath = GLib.build_filenamev([extDir, 'icons', `${app.icon}`]); 
        let isJavaScript = fileName.toLowerCase().endsWith('.js');
        let execCommand = isJavaScript
            ? `gjs "${filePath}"`
            : `"${filePath}"`;

        let desktopContent = `[Desktop Entry]
Name=${app.name}
Exec=${execCommand}
Icon=${iconPath}
Type=Application
Categories=Utility;
Terminal=false
`;
        try {
            let file = Gio.File.new_for_path(desktopFilePath);
            let needsUpdate = true;

            if (file.query_exists(null)) {
                let [ok, contents] = file.load_contents(null);
                if (ok) {
                    let currentContent = new TextDecoder("utf-8").decode(contents);
                    if (currentContent === desktopContent) {
                        needsUpdate = false;
                    }
                }
            }

            if (needsUpdate) {
                file.replace_contents(desktopContent, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            }
        } catch (e) {
            log(`[PrismUI] Erreur lors de la gestion du raccourci pour ${app.name}`);
        }
    }
}

export default class PrismExtension extends Extension {
    constructor(metadata) {
        super(metadata);
    }

    enable() {
        this._stylesheet = this.dir.get_child('stylesheet.css');
        this._theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
        this._theme.load_stylesheet(this._stylesheet);
        this._interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        this._origEnableHotCorners = this._interfaceSettings.get_boolean('enable-hot-corners');
        this._interfaceSettings.set_boolean('enable-hot-corners', false);

        if (!global.networkSetting) global.networkSetting = new NetworkSetting(this);
        if (!global.myDock) global.myDock = new MyDock(this); 
        if (!global.appLauncher) global.appLauncher = new AppLauncher();
        if (!global.notificationManager) global.notificationManager = new NotificationManager(this);
        if (!global.prismWidgets) global.prismWidgets = new PrismWidgets();
        import('./windowmanager.js').then(module => {
            if (!this._windowManager) {
                this._windowManager = new module.WindowManager(global.myDock);
            }
        }).catch(err => {
            log(`WindowManager absent ou en attente d'installation : ${err.message}`);
        });

        this._originalOverviewToggle = Main.overview.toggle;
        this._originalOverviewShow = Main.overview.show;

        Main.overview.toggle = () => {
            if (Main.layoutManager && Main.layoutManager._startingUp) return;
            if (global.appLauncher) global.appLauncher.toggle();
        };
        
        Main.overview.show = () => {
            if (Main.layoutManager && Main.layoutManager._startingUp) return;
            if (global.appLauncher) global.appLauncher.show();
        };

        this._startupCompleteId = Main.layoutManager.connect('startup-complete', () => {
            if (this._originalOverviewToggle) {
                Main.overview.hide();
            }
        });

        let backgroundSettings = new Gio.Settings({ schema: 'org.gnome.desktop.background' });
        let wallpaperPath = this.dir.get_child('icons').get_child('interface').get_child('wallpaper').get_child('officiel-wallpaper-prismUI.png').get_path();
        let wallpaperUri = GLib.filename_to_uri(wallpaperPath, null);
        this._wallpaperSettings = backgroundSettings;
        this._originalWallpaperUri = backgroundSettings.get_string('picture-uri');
        this._appliedWallpaperUri = wallpaperUri;
        this._supportsDarkWallpaper = backgroundSettings.settings_schema.has_key('picture-uri-dark');
        if (this._supportsDarkWallpaper) {
            this._originalDarkWallpaperUri = backgroundSettings.get_string('picture-uri-dark');
            backgroundSettings.set_string('picture-uri-dark', wallpaperUri);
        }
        backgroundSettings.set_string('picture-uri', wallpaperUri);
        Main.panel.hide();

        global.clipboardManager = new ClipboardManager();
        _registerPrismApps(this);

        if (!this._homeBar) this._homeBar = new HomeBar();
    }

    disable() {
        if (this._wallpaperSettings && this._originalWallpaperUri !== undefined &&
            this._wallpaperSettings.get_string('picture-uri') === this._appliedWallpaperUri) {
            this._wallpaperSettings.set_string('picture-uri', this._originalWallpaperUri);
        }
        if (this._wallpaperSettings && this._supportsDarkWallpaper &&
            this._wallpaperSettings.get_string('picture-uri-dark') === this._appliedWallpaperUri) {
            this._wallpaperSettings.set_string('picture-uri-dark', this._originalDarkWallpaperUri);
        }
        this._wallpaperSettings = null;
        this._originalWallpaperUri = null;
        this._originalDarkWallpaperUri = null;
        this._appliedWallpaperUri = null;
        this._supportsDarkWallpaper = false;

        if (this._theme && this._stylesheet) {
            this._theme.unload_stylesheet(this._stylesheet);
            this._theme = null;
            this._stylesheet = null;
        }

        if (global.myDock) {
            global.myDock.destroy(); 
            global.myDock = null;
        }

        if (global.notificationManager) {
            global.notificationManager.destroy();
            global.notificationManager = null; 
        }

        if (this._windowManager) {
            this._windowManager.destroy();
            this._windowManager = null;
        }
        
        if (global.networkSetting) {
            global.networkSetting.destroy();
            global.networkSetting = null;
        }

        if (global.clipboardManager) {
            global.clipboardManager.destroy();
            global.clipboardManager = null;
        }

        if (global.appLauncher) {
            global.appLauncher.destroy();
            global.appLauncher = null;
        }

        if (this._homeBar) {
            this._homeBar.destroy();
            this._homeBar = null;
        }

        if (global.prismWidgets) {
            global.prismWidgets.destroy();
            global.prismWidgets = null;
        }

        if (this._closeOverviewTimeout) {
            GLib.Source.remove(this._closeOverviewTimeout);
            this._closeOverviewTimeout = null;
        }

        if (this._startupCompleteId) {
            Main.layoutManager.disconnect(this._startupCompleteId);
            this._startupCompleteId = null;
        }

        if (this._originalOverviewToggle) {
            Main.overview.toggle = this._originalOverviewToggle;
            this._originalOverviewToggle = null;
        }
        if (this._originalOverviewShow) {
            Main.overview.show = this._originalOverviewShow;
            this._originalOverviewShow = null;
        }

        if (this._interfaceSettings && this._origEnableHotCorners !== undefined) {
            this._interfaceSettings.set_boolean('enable-hot-corners', this._origEnableHotCorners);
            this._interfaceSettings = null;
        }

        Main.panel.show();
    }
}
