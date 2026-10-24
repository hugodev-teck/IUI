/*                                                                */
/*       Copyright (c) Project PRISM. All rights reserved.        */
/*         This software is licensed under the CC BY-NC           */
/*          Full text of the license can be found at              */
/*   https://creativecommons.org/licenses/by-nc/4.0/legalcode.en  */
/*                                                                */

import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import GnomeDesktop from 'gi://GnomeDesktop';
import GnomeBluetooth from 'gi://GnomeBluetooth?version=3.0';
import NM from 'gi://NM';
import UPowerGlib from 'gi://UPowerGlib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Gvc from 'gi://Gvc';
import Pango from 'gi://Pango';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';
import * as Rfkill from 'resource:///org/gnome/shell/ui/status/rfkill.js';

import { getTopBarTooltipY } from './notificationsys.js';

Gio._promisify(GnomeBluetooth.Client.prototype, 'connect_service');

const Mainloop = {
    idle_add: callback => GLib.idle_add(GLib.PRIORITY_DEFAULT, callback),
    timeout_add: (interval, callback) => GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, callback)
};

// Détection PC / Portable pour l'icône de batterie
let _isPC = false;
try {
    let upClient = UPowerGlib.Client.new_full(null);
    let devices = upClient.get_devices();
    _isPC = !devices.some(d => d.kind === UPowerGlib.DeviceKind.BATTERY);
} catch (e) {
    _isPC = false;
}

let menunet = null;

export class NetworkSetting {
        constructor(ext) {
        this._ext = ext;
        this._signalConnections = [];
        this._bluetoothInitialized = false;
        this._bluetoothClient = null;
        this._bluetoothRfkillProxy = null;
        this._bluetoothRfkillInitialized = false;
        this._wifiToggleCircle = null;
        this._bluetoothToggleCircle = null;
        this._quickShortcutButtons = {};
        this._hotspotSsid = null;
        this._hotspotPassword = null;
        this._hotspotOperationPending = false;
        this._interfaceSettings = null;
        this._nightLightSettings = null;
        this._powerProfilesProxy = null;
        this._powerProfilesInitialized = false;
        this._brightnessProxy = null;
        this._brightnessInitPending = false;
        this._rfkillManager = null;
        this._initTimeout = 0;
        this._iconsPath = `${this._ext.path}/icons/interface/wthicon`;

        this.container = new St.BoxLayout({
            style_class: 'network-settings-container',
            name: 'network-settings-container',
            vertical: false
        });

        this.clockContainer = new St.BoxLayout({
            style_class: 'clock-date-container',
            name: 'clock-date-container',
            vertical: false,
            reactive: true,
            track_hover: true
        });
        this.clockLabel = new St.Label({
            style_class: 'clock-date-label',
            y_align: Clutter.ActorAlign.CENTER
        });
        this.clockContainer.add_child(this.clockLabel);
        this.clockContainer.connect('enter-event', () => this._showStatusTooltip(this.clockContainer, 'clock'));
        this.clockContainer.connect('leave-event', () => this._hideStatusTooltip());

        let wifiObj = this.createDynamicButton('wifiwth0barre.png', 'wifi');
        this.wifiButton = wifiObj.button;
        this._wifiIcon = wifiObj.icon;
        this.container.add_child(this.wifiButton);

        let soundObj = this.createDynamicButton('volumewth.png', 'sound');
        this.soundButton = soundObj.button;
        this._soundIcon = soundObj.icon;
        this.container.add_child(this.soundButton);

        let defaultBatIcon = _isPC ? 'powerwth.png' : 'battery-fullwth.png';
        let batObj = this.createDynamicButton(defaultBatIcon, 'battery');
        this.batteryButton = batObj.button;
        this._batteryIcon = batObj.icon;
        this.container.add_child(this.batteryButton);

        Main.layoutManager._backgroundGroup.add_child(this.container);
        Main.layoutManager._backgroundGroup.add_child(this.clockContainer);

        this._wallClock = new GnomeDesktop.WallClock();
        this._wallClockSignalId = this._wallClock.connect('notify::clock', () => this._updateClock());
        this._updateClock();
        
        this._netPosIdleId = 0;
        let queueNetPositionUpdate = () => {
            if (this._netPosIdleId) return;
            this._netPosIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._netPosIdleId = 0;
                if (this.container || this.clockContainer) this._setPosition();
                return GLib.SOURCE_REMOVE;
            });
        };
        this.container.connect('notify::width', queueNetPositionUpdate);
        this.container.connect('notify::height', queueNetPositionUpdate);
        this.clockContainer.connect('notify::width', queueNetPositionUpdate);
        this.clockContainer.connect('notify::height', queueNetPositionUpdate);

        Mainloop.idle_add(() => {
            if (this.container) this._setPosition();
            return GLib.SOURCE_REMOVE;
        });

        global.barReseau = this;

        this._initTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._initTimeout = 0;
            if (!this.container) return GLib.SOURCE_REMOVE;
            this._initAudio();
            this._initPower();
            this._initNetwork();
            this._initBrightness();
            return GLib.SOURCE_REMOVE;
        });

        this._networkMonitorId = Main.layoutManager.connect('monitors-changed', () => {
            this._setPosition();
        });
    }

    _updateIcon(iconActor, iconName) {
        if (!this.container || !iconActor || !iconName) return;
        try {
            let path = `${this._iconsPath}/${iconName}`;
            let file = Gio.File.new_for_path(path);
            iconActor.gicon = new Gio.FileIcon({ file: file }); 
        } catch (e) {}
    }

    _getStatusTooltipText(type) {
        if (type === 'clock') return 'Horloge (Heure local)';

        if (type === 'sound') {
            let stream = this._mixerControl ? this._mixerControl.get_default_sink() : null;
            if (!stream) return 'Son indisponible';
            if (stream.is_muted) return 'Son coupe';
            let volume = Math.round((stream.volume / this._mixerControl.get_vol_max_norm()) * 100);
            return `Volume : ${volume}%`;
        }

        if (type === 'battery') {
            if (_isPC) return 'Eteindre le PC';
            let device = this._upClient ? this._upClient.get_display_device() : null;
            if (!device) return 'Batterie indisponible';
            let status = device.state === UPowerGlib.DeviceState.CHARGING ? 'En charge' : 'Sur batterie';
            if (device.state === UPowerGlib.DeviceState.FULLY_CHARGED) status = 'Chargee';
            return `Batterie : ${Math.round(device.percentage)}% (${status})`;
        }

        let primary = this._nmClient ? this._nmClient.get_primary_connection() : null;
        if (!primary) return 'Reseau deconnecte';
        let connectionType = primary.get_connection_type();
        if (connectionType.includes('wireless')) {
            let wifiDevice = this._nmClient.get_devices().find(device =>
                device.device_type === NM.DeviceType.WIFI && device.active_connection === primary
            );
            let accessPoint = wifiDevice ? wifiDevice.active_access_point : null;
            if (accessPoint) {
                let ssid = NM.utils_ssid_to_utf8(accessPoint.get_ssid().get_data());
                return `Wi-Fi : ${ssid || 'Réseau inconnu'} (${accessPoint.strength}%)`;
            }
            return 'Wi-Fi connecte';
        }
        if (connectionType.includes('ethernet')) return 'Ethernet connecte';
        return 'Reseau connecte';
    }

    _showStatusTooltip(button, type) {
        if (this._mainMenuOpen || this._tooltipsLocked || menunet) return;

        if (!this.statusTooltip) {
            this.statusTooltip = new St.Label({
                style_class: 'prism-status-tooltip',
                style: 'background-color: rgba(30, 30, 30, 0.9); color: white; padding: 6px 10px; border-radius: 5px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);'
            });
            Main.layoutManager.addChrome(this.statusTooltip);
        }

        this.statusTooltip.set_text(this._getStatusTooltipText(type));
        this.statusTooltip.show();
        let [x] = button.get_transformed_position();
        let [width] = button.get_transformed_size();
        let monitor = Main.layoutManager.primaryMonitor;
        let tooltipWidth = this.statusTooltip.width;
        let tooltipHeight = this.statusTooltip.height;
        let tooltipX = x + (width - tooltipWidth) / 2;
        let tooltipY = getTopBarTooltipY(monitor);
        let minX = monitor.x + 8;
        let maxX = monitor.x + monitor.width - tooltipWidth - 8;
        let maxY = monitor.y + monitor.height - tooltipHeight - 8;

        tooltipX = Math.max(minX, Math.min(maxX, tooltipX));
        if (tooltipY > maxY) tooltipY = monitor.y + 11 - tooltipHeight - 8;
        tooltipY = Math.max(monitor.y + 8, Math.min(maxY, tooltipY));
        this.statusTooltip.set_position(tooltipX, tooltipY);
    }

    _hideStatusTooltip() {
        if (this.statusTooltip) this.statusTooltip.hide();
    }

    _connectSignal(object, signal, callback) {
        if (!object) return 0;
        let id = object.connect(signal, callback);
        this._signalConnections.push({ object, id });
        return id;
    }

    createDynamicButton(defaultIconName, statusType) {
        let button = new St.Button({
            style_class: 'feature-button-net',
            reactive: true,
            track_hover: true,
            can_focus: true
        });

        let path = `${this._iconsPath}/${defaultIconName}`;
        let file = Gio.File.new_for_path(path);
        let gicon = new Gio.FileIcon({ file: file });

        let icon = new St.Icon({
            gicon: gicon,
            style_class: 'feature-icon-net',
            icon_size: 25
        });

        button.set_child(icon);
        
        button.connect('clicked', () => {
            this._hideStatusTooltip();
            this._tooltipsLocked = false;
            if (menunet) {
                this._closeAllMenus();
            } else {
                this._handleBarClick();
            }
        });

        button.connect('enter-event', () => this._showStatusTooltip(button, statusType));
        button.connect('leave-event', () => this._hideStatusTooltip());

        return { button, icon };
    }
    
    _closeAllMenus() {
        if (menunet) menunet.destroy();
    }

    _initBrightness() {
        if (_isPC || this._brightnessProxy || this._brightnessInitPending)
            return;

        this._brightnessInitPending = true;
        Gio.DBusProxy.new_for_bus(
            Gio.BusType.SESSION,
            Gio.DBusProxyFlags.NONE,
            null,
            'org.gnome.SettingsDaemon.Power',
            '/org/gnome/SettingsDaemon/Power',
            'org.gnome.SettingsDaemon.Power.Screen',
            null,
            (source, result) => {
                this._brightnessInitPending = false;
                try {
                    let proxy = Gio.DBusProxy.new_for_bus_finish(result);
                    if (!this.container) {
                        return;
                    }
                    this._brightnessProxy = proxy;
                    if (!this._brightnessProxy.get_name_owner()) {
                        log('[PrismUI] Le service de luminosité GNOME est indisponible.');
                        this._brightnessProxy = null;
                        if (menunet && menunet._brightnessSlider) {
                            this._notifyQuickSettingUnavailable(
                                'Luminosité indisponible',
                                'Le service GNOME de réglage de l’écran ne répond pas.'
                            );
                        }
                        return;
                    }

                    if (menunet && menunet._brightnessSlider)
                        this._connectBrightnessSlider(menunet, menunet._brightnessSlider);
                } catch (e) {
                    log(`[PrismUI] Erreur init luminosité : ${e.message}`);
                    if (menunet && menunet._brightnessSlider)
                        this._notifyQuickSettingUnavailable('Luminosité indisponible', e.message);
                }
            }
        );
    }

    _connectBrightnessSlider(menuActor, brightSlider) {
        let proxy = this._brightnessProxy;
        if (!proxy || !proxy.get_name_owner() || menuActor._brightnessSliderSignalId)
            return;

        let updatingFromSignal = false;
        let currentBrightness = proxy.get_cached_property('Brightness');
        if (currentBrightness) {
            brightSlider.value = Math.max(0, Math.min(100, currentBrightness.get_int32())) / 100;
        } else {
            log('[PrismUI] Le service de luminosité n’a pas fourni la valeur actuelle.');
            this._notifyQuickSettingUnavailable('Luminosité indisponible', 'Impossible de lire la luminosité actuelle.');
        }

        brightSlider.connect('notify::value', () => {
            if (updatingFromSignal || !this._brightnessProxy)
                return;
            let value = Math.round(brightSlider.value * 100);
            this._brightnessProxy.get_connection().call(
                'org.gnome.SettingsDaemon.Power',
                '/org/gnome/SettingsDaemon/Power',
                'org.freedesktop.DBus.Properties',
                'Set',
                new GLib.Variant('(ssv)', [
                    'org.gnome.SettingsDaemon.Power.Screen',
                    'Brightness',
                    new GLib.Variant('i', value)
                ]),
                null,
                Gio.DBusCallFlags.NONE,
                -1,
                null,
                (connection, result) => {
                    try {
                        connection.call_finish(result);
                    } catch (e) {
                        log(`[PrismUI] Erreur modification luminosité : ${e.message}`);
                        this._notifyQuickSettingUnavailable('Luminosité non modifiée', e.message);
                    }
                }
            );
        });

        menuActor._brightnessSliderSignalId = proxy.connect('g-properties-changed', (source, changed) => {
            let value = changed.lookup_value('Brightness', null);
            if (!value)
                return;
            updatingFromSignal = true;
            brightSlider.value = Math.max(0, Math.min(100, value.get_int32())) / 100;
            updatingFromSignal = false;
        });
    }

    _initAudio() {
        try {
            this._mixerControl = new Gvc.MixerControl({ name: 'PrismUI Volume Control' });
            this._mixerControl.open();
            
            this._connectSignal(this._mixerControl, 'state-changed', () => this._updateVolumeIcon());

            this._connectSignal(this._mixerControl, 'default-sink-changed', () => this._updateVolumeIcon());
            
            this._updateVolumeIcon();
        } catch (e) { log(`[PrismUI] Erreur Audio: ${e.message}`); }
    }

    _updateVolumeIcon() {
        if (!this._mixerControl) return;
        let stream = this._mixerControl.get_default_sink();
        let iconName = 'volumewth.png';

        if (stream) {
            if (stream !== this._audioStream) {
                this._connectSignal(stream, 'notify::volume', () => this._updateVolumeIcon());
                this._connectSignal(stream, 'notify::is-muted', () => this._updateVolumeIcon());
                this._audioStream = stream;
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
            
            this._connectSignal(this._upClient, 'notify::display-device', () => {
                this._syncBattery();
            });
            
            this._syncBattery();

        } catch (e) { log(`[PrismUI] Erreur Power: ${e.message}`); }
    }

    _syncBattery() {
        let device = this._upClient.get_display_device();
        
        if (device !== this._batteryProxy) {
            this._batteryProxy = device;
            if (this._batteryProxy && this._batteryProxy !== this._batterySignalDevice) {
                this._connectSignal(this._batteryProxy, 'notify::percentage', () => this._updateBatteryIcon(this._batteryProxy));
                this._connectSignal(this._batteryProxy, 'notify::state', () => this._updateBatteryIcon(this._batteryProxy));
                this._connectSignal(this._batteryProxy, 'notify::is-present', () => this._updateBatteryIcon(this._batteryProxy));
                this._batterySignalDevice = this._batteryProxy;
            }
        }
        
        this._updateBatteryIcon(this._batteryProxy);
    }

    _updateBatteryIcon(device) {
        if (_isPC) {
            this._updateIcon(this._batteryIcon, 'powerwth.png');
            return;
        }

        let percentage = device ? device.percentage : 100;
        let state = device ? device.state : UPowerGlib.DeviceState.UNKNOWN;

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
            this._connectSignal(this._nmClient, 'notify::primary-connection', () => this._updateNetworkIcon());
            this._connectSignal(this._nmClient, 'notify::connectivity', () => this._updateNetworkIcon());
            this._connectSignal(this._nmClient, 'notify::wireless-enabled', () => {
                this._updateNetworkIcon();
                this._updateQuickToggleStates();
                this._updateQuickShortcutStates();
            });
            this._connectSignal(this._nmClient, 'notify::wireless-hardware-enabled', () => {
                this._updateNetworkIcon();
                this._updateQuickToggleStates();
                this._updateQuickShortcutStates();
            });
            this._connectSignal(this._nmClient, 'notify::active-connections', () => this._updateQuickShortcutStates());
            this._updateNetworkIcon();
            this._updateQuickToggleStates();
        } catch (e) { log(`[PrismUI] Erreur Network: ${e.message}`); }
    }

    _initBluetooth() {
        if (this._bluetoothInitialized) return;
        this._bluetoothInitialized = true;
        try {
            this._bluetoothClient = new GnomeBluetooth.Client();
            for (let property of [
                'notify::default-adapter',
                'notify::default-adapter-powered',
                'notify::default-adapter-state'
            ]) {
                this._connectSignal(this._bluetoothClient, property, () => {
                    this._updateQuickToggleStates();
                });
            }
            this._updateQuickToggleStates();
            this._initBluetoothRfkill();
        } catch (e) {
            log(`[PrismUI] Impossible d'initialiser le client Bluetooth GNOME : ${e.message}`);
            this._bluetoothClient = null;
            this._bluetoothInitialized = false;
        }
    }

    _initBluetoothRfkill() {
        if (this._bluetoothRfkillInitialized) return;
        this._bluetoothRfkillInitialized = true;
        Gio.DBusProxy.new_for_bus(
            Gio.BusType.SESSION,
            Gio.DBusProxyFlags.DO_NOT_AUTO_START,
            null,
            'org.gnome.SettingsDaemon.Rfkill',
            '/org/gnome/SettingsDaemon/Rfkill',
            'org.gnome.SettingsDaemon.Rfkill',
            null,
            (source, result) => {
                try {
                    this._bluetoothRfkillProxy = Gio.DBusProxy.new_for_bus_finish(result);
                    this._connectSignal(this._bluetoothRfkillProxy, 'g-properties-changed', () => {
                        this._updateQuickToggleStates();
                    });
                } catch (e) {
                    this._bluetoothRfkillInitialized = false;
                    log(`[PrismUI] Impossible de se connecter au service RFKill de GNOME : ${e.message}`);
                }
            }
        );
    }

    _initQuickShortcutSettings() {
        if (!this._rfkillManager) {
            this._rfkillManager = Rfkill.getRfkillManager();
            this._connectSignal(this._rfkillManager, 'notify::airplane-mode', () => {
                this._updateQuickShortcutStates();
                this._updateQuickToggleStates();
                this._updateNetworkIcon();
            });
            this._connectSignal(this._rfkillManager, 'notify::show-airplane-mode', () => {
                this._updateQuickShortcutStates();
            });
        }

        let schemaSource = Gio.SettingsSchemaSource.get_default();
        if (!schemaSource) {
            log('[PrismUI] Impossible de charger les réglages des tuiles rapides : schémas GSettings indisponibles.');
            return;
        }

        let interfaceSchema = schemaSource.lookup('org.gnome.desktop.interface', true);
        if (!this._interfaceSettings && interfaceSchema && interfaceSchema.has_key('color-scheme')) {
            this._interfaceSettings = new Gio.Settings({ settings_schema: interfaceSchema });
            this._connectSignal(this._interfaceSettings, 'changed::color-scheme', () => this._updateQuickShortcutStates());
        } else if (!interfaceSchema || !interfaceSchema.has_key('color-scheme')) {
            log('[PrismUI] Le réglage GNOME « color-scheme » est indisponible.');
        }

        let nightLightSchema = schemaSource.lookup('org.gnome.settings-daemon.plugins.color', true);
        if (!this._nightLightSettings && nightLightSchema && nightLightSchema.has_key('night-light-enabled')) {
            this._nightLightSettings = new Gio.Settings({ settings_schema: nightLightSchema });
            this._connectSignal(this._nightLightSettings, 'changed::night-light-enabled', () => this._updateQuickShortcutStates());
        } else if (!nightLightSchema || !nightLightSchema.has_key('night-light-enabled')) {
            log('[PrismUI] Le réglage GNOME de l’éclairage nocturne est indisponible.');
        }

        this._initPowerProfiles();
        this._updateQuickShortcutStates();
    }

    _initPowerProfiles() {
        if (this._powerProfilesInitialized) return;
        this._powerProfilesInitialized = true;
        Gio.DBusProxy.new_for_bus(
            Gio.BusType.SYSTEM,
            Gio.DBusProxyFlags.NONE,
            null,
            'org.freedesktop.UPower.PowerProfiles',
            '/org/freedesktop/UPower/PowerProfiles',
            'org.freedesktop.UPower.PowerProfiles',
            null,
            (source, result) => {
                try {
                    this._powerProfilesProxy = Gio.DBusProxy.new_for_bus_finish(result);
                    this._connectSignal(this._powerProfilesProxy, 'g-properties-changed', () => this._updateQuickShortcutStates());
                    this._connectSignal(this._powerProfilesProxy, 'notify::g-name-owner', () => {
                        this._updateQuickShortcutStates();
                    });
                    if (!this._powerProfilesProxy.get_name_owner()) {
                        log('[PrismUI] Aucun service power-profiles-daemon ne possède le nom D-Bus attendu.');
                        this._powerProfilesInitialized = false;
                    }
                    this._updateQuickShortcutStates();
                } catch (e) {
                    log(`[PrismUI] Profils d’énergie indisponibles : ${e.message}`);
                    this._powerProfilesInitialized = false;
                }
            }
        );
    }

    _notifyQuickSettingUnavailable(title, message) {
        if (global.notificationManager) {
            global.notificationManager.showNotification(title, message, 'Système', 'preferences-system-symbolic');
        }
    }

    _isHotspotActive() {
        if (!this._nmClient) return false;
        try {
            return this._nmClient.get_active_connections().some(activeConnection => {
                let connection = activeConnection.get_connection();
                let wireless = connection ? connection.get_setting_wireless() : null;
                return wireless && wireless.mode === 'ap';
            });
        } catch (e) {
            log(`[PrismUI] Impossible de lire l’état du point d’accès : ${e.message}`);
            return false;
        }
    }

    _updateQuickShortcutStates() {
        let states = {
            airplane: !!(this._rfkillManager && this._rfkillManager.airplane_mode),
            darkTheme: !!(
                this._interfaceSettings &&
                this._interfaceSettings.get_string('color-scheme') === 'prefer-dark'
            ),
            powerSaver: !!(
                this._powerProfilesProxy &&
                this._powerProfilesProxy.get_cached_property('ActiveProfile') &&
                this._powerProfilesProxy.get_cached_property('ActiveProfile').get_string() === 'power-saver'
            ),
            hotspot: this._isHotspotActive(),
            nightLight: !!(
                this._nightLightSettings &&
                this._nightLightSettings.get_boolean('night-light-enabled')
            )
        };

        for (let [name, button] of Object.entries(this._quickShortcutButtons)) {
            if (states[name]) {
                button.add_style_class_name('active');
            } else {
                button.remove_style_class_name('active');
            }
        }
    }

    _setAirplaneMode(enabled) {
        if (!this._rfkillManager || !this._rfkillManager.show_airplane_mode) {
            log('[PrismUI] Impossible de modifier le mode avion système : GNOME ne le propose pas sur cet appareil.');
            this._notifyQuickSettingUnavailable(
                'Mode avion indisponible',
                'Le mode avion système n’est pas disponible sur cet appareil.'
            );
            return;
        }

        try {
            this._rfkillManager.airplane_mode = enabled;
        } catch (e) {
            log(`[PrismUI] Impossible de modifier le mode avion système : ${e.message}`);
            this._notifyQuickSettingUnavailable('Mode avion non modifié', e.message);
        }
    }

    _togglePowerSaver() {
        let activeProfile = this._powerProfilesProxy
            ? this._powerProfilesProxy.get_cached_property('ActiveProfile')
            : null;
        if (!this._powerProfilesProxy || !this._powerProfilesProxy.get_name_owner() || !activeProfile) {
            log('[PrismUI] Impossible de changer le profil : service des profils d’énergie indisponible.');
            this._powerProfilesProxy = null;
            this._powerProfilesInitialized = false;
            this._initPowerProfiles();
            this._notifyQuickSettingUnavailable(
                'Économie d’énergie indisponible',
                'Le service des profils d’énergie n’est pas prêt ou ne répond pas.'
            );
            return;
        }

        let profile = activeProfile.get_string() === 'power-saver' ? 'balanced' : 'power-saver';
        this._powerProfilesProxy.get_connection().call(
            'org.freedesktop.UPower.PowerProfiles',
            '/org/freedesktop/UPower/PowerProfiles',
            'org.freedesktop.DBus.Properties',
            'Set',
            new GLib.Variant('(ssv)', [
                'org.freedesktop.UPower.PowerProfiles',
                'ActiveProfile',
                new GLib.Variant('s', profile)
            ]),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (connection, result) => {
                try {
                    connection.call_finish(result);
                    this._updateQuickShortcutStates();
                } catch (e) {
                    log(`[PrismUI] Impossible de changer le profil d’énergie : ${e.message}`);
                    this._notifyQuickSettingUnavailable('Profil d’énergie non modifié', e.message);
                }
            }
        );
    }

    _getActiveHotspot() {
        if (!this._nmClient) return null;
        return this._nmClient.get_active_connections().find(activeConnection => {
            let connection = activeConnection.get_connection();
            let wireless = connection ? connection.get_setting_wireless() : null;
            return wireless && wireless.mode === 'ap';
        }) ?? null;
    }

    _ensureHotspotCredentials() {
        if (this._hotspotSsid && this._hotspotPassword) return;
        let hostname = GLib.get_host_name().replace(/[^a-zA-Z0-9-]/g, '').slice(0, 18) || 'Prism';
        this._hotspotSsid = `Prism-${hostname}`.slice(0, 32);
        this._hotspotPassword = GLib.uuid_string_random().replace(/-/g, '').slice(0, 16);
    }

    _runNmcli(args, callback) {
        try {
            let process = Gio.Subprocess.new(
                ['nmcli', ...args],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            process.communicate_utf8_async(null, null, (subprocess, result) => {
                try {
                    let [communicated, stdout, stderr] = subprocess.communicate_utf8_finish(result);
                    if (!communicated || !subprocess.get_successful()) {
                        callback(null, (stderr || stdout || 'NetworkManager n’a pas pu terminer l’opération.').trim());
                        return;
                    }
                    callback(stdout.trim(), null);
                } catch (e) {
                    callback(null, e.message);
                }
            });
        } catch (e) {
            callback(null, e.message);
        }
    }

    _getSavedHotspotConnection() {
        if (!this._nmClient) return null;
        return this._nmClient.get_connections().find(connection => {
            let wireless = connection.get_setting_wireless();
            return wireless &&
                wireless.mode === 'ap' &&
                connection.get_id() === 'PrismUI Hotspot';
        }) ?? null;
    }

    _toggleHotspot() {
        if (!this._nmClient) {
            log('[PrismUI] Impossible de gérer le point d’accès : NetworkManager est indisponible.');
            this._notifyQuickSettingUnavailable('Point d’accès indisponible', 'NetworkManager ne répond pas.');
            return;
        }
        if (this._hotspotOperationPending) return;

        let activeHotspot = this._getActiveHotspot();

        if (activeHotspot) {
            this._hotspotOperationPending = true;
            this._nmClient.deactivate_connection_async(activeHotspot, null, (client, result) => {
                this._hotspotOperationPending = false;
                try {
                    client.deactivate_connection_finish(result);
                    this._updateQuickShortcutStates();
                } catch (e) {
                    log(`[PrismUI] Impossible de désactiver le point d’accès : ${e.message}`);
                    this._notifyQuickSettingUnavailable('Point d’accès non désactivé', e.message);
                }
            });
            return;
        }

        if (!this._nmClient.wireless_hardware_enabled) {
            this._notifyQuickSettingUnavailable('Point d’accès indisponible', 'Le Wi-Fi est désactivé par un commutateur matériel.');
            return;
        }
        if (this._rfkillManager && this._rfkillManager.airplane_mode) {
            this._notifyQuickSettingUnavailable('Mode avion actif', 'Désactive le mode avion avant d’activer le point d’accès.');
            return;
        }

        let wifiDevice = this._nmClient.get_devices().find(device =>
            device.device_type === NM.DeviceType.WIFI && device.get_managed()
        );
        if (!wifiDevice) {
            this._notifyQuickSettingUnavailable('Point d’accès indisponible', 'Aucune interface Wi-Fi gérée par NetworkManager n’a été trouvée.');
            return;
        }

        this._ensureHotspotCredentials();
        this._hotspotOperationPending = true;
        let savedConnection = this._getSavedHotspotConnection();
        if (savedConnection) {
            let activateSavedHotspot = () => {
                this._nmClient.activate_connection_async(savedConnection, wifiDevice, null, null, (client, result) => {
                    this._hotspotOperationPending = false;
                    try {
                        client.activate_connection_finish(result);
                        this._updateQuickShortcutStates();
                    } catch (e) {
                        log(`[PrismUI] Impossible de réactiver le profil de point d’accès : ${e.message}`);
                        this._notifyQuickSettingUnavailable('Point d’accès non activé', e.message);
                    }
                });
            };
            let uuid = savedConnection.get_uuid();
            this._runNmcli([
                '--show-secrets',
                '-g',
                '802-11-wireless.ssid,802-11-wireless-security.psk',
                'connection', 'show', 'uuid', uuid
            ], (output, error) => {
                if (!error) {
                    let [ssid, password] = output.split(/\r?\n/);
                    this._hotspotSsid = ssid || this._hotspotSsid;
                    this._hotspotPassword = password || this._hotspotPassword;
                } else {
                    log(`[PrismUI] Impossible de lire le profil de point d’accès enregistré : ${error}`);
                }
                activateSavedHotspot();
            });
            return;
        }

        this._runNmcli([
            'device', 'wifi', 'hotspot',
            'ifname', wifiDevice.get_iface(),
            'con-name', 'PrismUI Hotspot',
            'ssid', this._hotspotSsid,
            'password', this._hotspotPassword
        ], (stdout, error) => {
            this._hotspotOperationPending = false;
            if (error) {
                log(`[PrismUI] Impossible d’activer le point d’accès : ${error}`);
                this._notifyQuickSettingUnavailable('Point d’accès non activé', error);
                return;
            }
            this._updateQuickShortcutStates();
        });
    }

    _showHotspotDetails() {
        this._ensureHotspotCredentials();
        this._showQuickSettingsPage('Point d’accès', 'network-wireless-hotspot-symbolic', () => {
            let details = new St.BoxLayout({
                vertical: true,
                style_class: 'quick-settings-details quick-hotspot-details',
                x_expand: true,
                y_expand: true
            });
            let credentialsCard = new St.BoxLayout({
                vertical: true,
                style_class: 'quick-info-card quick-hotspot-credentials',
                x_expand: true
            });
            let networkName = new St.Entry({
                text: this._hotspotSsid,
                hint_text: 'Nom du réseau (SSID)',
                style_class: 'quick-hotspot-entry',
                can_focus: true,
                x_expand: true
            });
            let password = new St.Entry({
                text: this._hotspotPassword,
                hint_text: 'Mot de passe',
                style_class: 'quick-hotspot-entry',
                can_focus: true,
                x_expand: true
            });
            credentialsCard.add_child(new St.Label({
                text: 'Nom du réseau',
                style_class: 'quick-field-label',
                x_expand: true
            }));
            credentialsCard.add_child(networkName);
            credentialsCard.add_child(new St.Label({
                text: 'Mot de passe',
                style_class: 'quick-field-label',
                x_expand: true
            }));
            credentialsCard.add_child(password);
            let bandLabel = new St.Label({
                text: 'Bande Wi-Fi : lecture…',
                style_class: 'quick-device-status',
                x_expand: true
            });
            credentialsCard.add_child(bandLabel);
            let saveButton = new St.Button({
                label: 'Enregistrer les identifiants',
                style_class: 'quick-device-action quick-hotspot-save',
                reactive: true,
                can_focus: true
            });
            credentialsCard.add_child(saveButton);
            let help = new St.Label({
                text: this._getActiveHotspot()
                    ? 'Partage ces identifiants pour connecter un appareil.'
                    : 'Ces identifiants seront utilisés au premier démarrage du point d’accès.',
                style_class: 'quick-connect-subtitle',
                x_expand: true
            });
            let saveStatus = new St.Label({
                text: '',
                style_class: 'quick-connect-subtitle',
                x_expand: true
            });
            let showQrButton = new St.Button({
                label: 'Afficher le QR code',
                style_class: 'quick-device-action quick-hotspot-save',
                reactive: true,
                can_focus: true
            });
            details.add_child(credentialsCard);
            details.add_child(help);
            details.add_child(saveStatus);
            details.add_child(showQrButton);

            let activeHotspot = this._getActiveHotspot();
            let updateCredentials = (ssid, psk) => {
                let storedCredentialsMatch = ssid && ssid === this._hotspotSsid;
                if (ssid) this._hotspotSsid = ssid;
                if (psk) {
                    this._hotspotPassword = psk;
                } else if (activeHotspot && !storedCredentialsMatch) {
                    this._hotspotPassword = null;
                }
                networkName.set_text(ssid || this._hotspotSsid || '');
                password.set_text(this._hotspotPassword || '');
                help.text = activeHotspot
                    ? 'Partage ces identifiants pour connecter un appareil.'
                    : 'Ces identifiants seront utilisés au premier démarrage du point d’accès.';
            };

            showQrButton.connect('clicked', () => {
                this._showHotspotQrPage(networkName.get_text(), password.get_text());
            });

            let currentConnection = activeHotspot
                ? activeHotspot.get_connection()
                : this._getSavedHotspotConnection();
            if (currentConnection) {
                this._runNmcli([
                    '-g',
                    '802-11-wireless.band,802-11-wireless.channel',
                    'connection', 'show', 'uuid', currentConnection.get_uuid()
                ], (output, error) => {
                    if (!menunet || !details.get_parent()) return;
                    if (error) {
                        bandLabel.text = 'Bande Wi-Fi : indisponible';
                        log(`[PrismUI] Impossible de lire la bande du point d’accès : ${error}`);
                        return;
                    }
                    let [band, channel] = output.split(/\r?\n/);
                    let bandName = band === 'bg' ? '2,4 GHz' : band === 'a' ? '5 GHz' : 'automatique';
                    let channelName = channel && channel !== '0' ? channel : '';
                    if (activeHotspot) {
                        let apDevice = this._nmClient.get_devices().find(device =>
                            device.device_type === NM.DeviceType.WIFI &&
                            device.active_connection === activeHotspot &&
                            device.active_access_point
                        );
                        let frequency = apDevice ? apDevice.active_access_point.get_frequency() : 0;
                        if (frequency >= 5925) {
                            bandName = '6 GHz';
                            channelName = frequency === 5935 ? '2' : String(Math.round((frequency - 5950) / 5));
                        } else if (frequency >= 4900) {
                            bandName = '5 GHz';
                            channelName = String(Math.round((frequency - 5000) / 5));
                        } else if (frequency >= 2400) {
                            bandName = '2,4 GHz';
                            channelName = frequency === 2484 ? '14' : String(Math.round((frequency - 2407) / 5));
                        }
                    }
                    bandLabel.text = `Bande Wi-Fi : ${bandName}${channelName ? ` · canal ${channelName}` : ''}`;
                });
            } else {
                bandLabel.text = 'Bande Wi-Fi : automatique (selon le matériel)';
            }

            saveButton.connect('clicked', () => {
                let ssid = networkName.get_text().trim();
                let psk = password.get_text();
                if (!ssid || ssid.length > 32) {
                    saveStatus.text = 'Le nom doit contenir entre 1 et 32 caractères.';
                    return;
                }
                if (psk.length < 8 || psk.length > 63) {
                    saveStatus.text = 'Le mot de passe doit contenir entre 8 et 63 caractères.';
                    return;
                }
                this._hotspotSsid = ssid;
                this._hotspotPassword = psk;
                let saved = activeHotspot
                    ? activeHotspot.get_connection()
                    : this._getSavedHotspotConnection();
                if (!saved) {
                    saveButton.reactive = false;
                    saveStatus.text = 'Création du profil point d’accès…';
                    this._runNmcli([
                        'connection', 'add',
                        'type', 'wifi',
                        'ifname', '*',
                        'con-name', 'PrismUI Hotspot',
                        '802-11-wireless.mode', 'ap',
                        '802-11-wireless.ssid', ssid,
                        '802-11-wireless-security.key-mgmt', 'wpa-psk',
                        '802-11-wireless-security.psk', psk,
                        'ipv4.method', 'shared',
                        'ipv6.method', 'ignore'
                    ], (output, error) => {
                        if (!menunet || !details.get_parent()) return;
                        saveButton.reactive = true;
                        if (error) {
                            saveStatus.text = 'Impossible de créer le profil du point d’accès.';
                            log(`[PrismUI] Impossible de créer le profil du point d’accès : ${error}`);
                            this._notifyQuickSettingUnavailable('Identifiants non enregistrés', error);
                            return;
                        }
                        saveStatus.text = 'Profil et identifiants enregistrés.';
                        this._updateQuickShortcutStates();
                    });
                    return;
                }

                saveButton.reactive = false;
                saveStatus.text = 'Enregistrement…';
                this._runNmcli([
                    'connection', 'modify', 'uuid', saved.get_uuid(),
                    '802-11-wireless.ssid', ssid,
                    '802-11-wireless-security.psk', psk
                ], (output, error) => {
                    if (!menunet || !details.get_parent()) return;
                    saveButton.reactive = true;
                    if (error) {
                        saveStatus.text = 'Impossible d’enregistrer les identifiants.';
                        log(`[PrismUI] Impossible de modifier les identifiants du point d’accès : ${error}`);
                        this._notifyQuickSettingUnavailable('Identifiants non enregistrés', error);
                        return;
                    }
                    saveStatus.text = activeHotspot
                        ? 'Identifiants enregistrés ; redémarrage du point d’accès…'
                        : 'Identifiants enregistrés.';
                    if (!activeHotspot) return;
                    this._nmClient.deactivate_connection_async(activeHotspot, null, (client, result) => {
                        try {
                            client.deactivate_connection_finish(result);
                            let wifiDevice = this._nmClient.get_devices().find(device =>
                                device.device_type === NM.DeviceType.WIFI && device.get_managed()
                            );
                            this._nmClient.activate_connection_async(
                                saved, wifiDevice, null, null,
                                (nmClient, activationResult) => {
                                    try {
                                        nmClient.activate_connection_finish(activationResult);
                                        if (menunet && details.get_parent())
                                            saveStatus.text = 'Point d’accès redémarré avec les nouveaux identifiants.';
                                    } catch (activationError) {
                                        log(`[PrismUI] Impossible de redémarrer le point d’accès après modification : ${activationError.message}`);
                                        if (menunet && details.get_parent())
                                            saveStatus.text = 'Identifiants enregistrés. Réactive le point d’accès pour appliquer les changements.';
                                    }
                                }
                            );
                        } catch (deactivationError) {
                            log(`[PrismUI] Impossible d’arrêter le point d’accès avant son redémarrage : ${deactivationError.message}`);
                            if (menunet && details.get_parent())
                                saveStatus.text = 'Identifiants enregistrés. Désactive puis réactive le point d’accès pour appliquer les changements.';
                        }
                    });
                });
            });

            if (activeHotspot) {
                let connection = activeHotspot.get_connection();
                let uuid = connection ? connection.get_uuid() : null;
                if (uuid) {
                    this._runNmcli([
                        '--show-secrets',
                        '-g',
                        '802-11-wireless.ssid,802-11-wireless-security.psk',
                        'connection', 'show', 'uuid', uuid
                    ], (output, error) => {
                        if (error) {
                            log(`[PrismUI] Impossible de lire les identifiants du point d’accès : ${error}`);
                            this._hotspotSsid = null;
                            this._hotspotPassword = null;
                            networkName.set_text('');
                            password.set_text('');
                            saveStatus.text = 'NetworkManager n’a pas communiqué les identifiants.';
                            return;
                        }
                        let [ssid, psk] = output.split(/\r?\n/);
                        updateCredentials(ssid || this._hotspotSsid, psk || this._hotspotPassword);
                    });
                } else {
                    updateCredentials(this._hotspotSsid, this._hotspotPassword);
                }
            } else {
                let savedConnection = this._getSavedHotspotConnection();
                if (savedConnection) {
                    this._runNmcli([
                        '--show-secrets',
                        '-g',
                        '802-11-wireless.ssid,802-11-wireless-security.psk',
                        'connection', 'show', 'uuid', savedConnection.get_uuid()
                    ], (output, error) => {
                        if (error) {
                            log(`[PrismUI] Impossible de lire le profil de point d’accès enregistré : ${error}`);
                            this._hotspotSsid = null;
                            this._hotspotPassword = null;
                            networkName.set_text('');
                            password.set_text('');
                            saveStatus.text = 'NetworkManager n’a pas communiqué les identifiants.';
                            return;
                        }
                        let [ssid, psk] = output.split(/\r?\n/);
                        updateCredentials(ssid || this._hotspotSsid, psk || this._hotspotPassword);
                    });
                } else {
                    updateCredentials(this._hotspotSsid, this._hotspotPassword);
                }
            }
            return details;
        });
    }

    _showHotspotQrPage(ssid, password) {
        this._showQuickSettingsPage('Code QR', 'network-wireless-hotspot-symbolic', () => {
            let qrPage = new St.BoxLayout({
                vertical: true,
                style_class: 'quick-settings-details quick-hotspot-qr-page',
                x_expand: true,
                y_expand: true
            });
            let status = new St.Label({
                text: '',
                style_class: 'quick-connect-subtitle',
                x_expand: true
            });
            let installButton = new St.Button({
                label: 'Installer qrencode',
                style_class: 'quick-hotspot-install-button',
                reactive: true,
                can_focus: true,
                visible: false
            });
            installButton.connect('clicked', () => {
                this._installQrencode(installButton, status, qrPage, ssid, password);
            });
            qrPage.add_child(status);
            qrPage.add_child(installButton);
            this._generateHotspotQrCode(ssid, password, qrPage, status, installButton);
            return qrPage;
        });
    }

    _generateHotspotQrCode(ssid, password, details, statusLabel, installButton) {
        if (details._hotspotQrImage) {
            details.remove_child(details._hotspotQrImage);
            details._hotspotQrImage.destroy();
            details._hotspotQrImage = null;
        }
        if (details._hotspotQrPath) {
            try {
                Gio.File.new_for_path(details._hotspotQrPath).delete(null);
            } catch (e) {
                log(`[PrismUI] Impossible de supprimer l’ancien QR temporaire : ${e.message}`);
            }
            if (menunet && menunet._hotspotQrPath === details._hotspotQrPath)
                menunet._hotspotQrPath = null;
            details._hotspotQrPath = null;
        }
        if (!password || !menunet) {
            statusLabel.text = 'QR indisponible : le mot de passe du réseau n’est pas connu.';
            return;
        }
        if (!GLib.find_program_in_path('qrencode')) {
            statusLabel.text = 'qrencode est requis. Son installation demandera une autorisation administrateur.';
            installButton.visible = true;
            return;
        }
        let escapeWifiValue = value => value.replace(/[\\;,":]/g, character => `\\${character}`);
        let payload = `WIFI:T:WPA;S:${escapeWifiValue(ssid)};P:${escapeWifiValue(password)};;`;
        let qrPath = GLib.build_filenamev([
            GLib.get_tmp_dir(),
            `prism-hotspot-${GLib.uuid_string_random()}.png`
        ]);
        try {
            let process = Gio.Subprocess.new(
                ['qrencode', '-o', qrPath, '-s', '5'],
                Gio.SubprocessFlags.STDIN_PIPE |
                    Gio.SubprocessFlags.STDOUT_PIPE |
                    Gio.SubprocessFlags.STDERR_PIPE
            );
            process.communicate_utf8_async(payload, null, (subprocess, result) => {
                try {
                    let [communicated, , stderr] = subprocess.communicate_utf8_finish(result);
                    if (!communicated || !subprocess.get_successful() || !menunet || !details.get_parent()) {
                        statusLabel.text = 'QR indisponible : échec de génération.';
                        if (stderr) log(`[PrismUI] Génération du QR code impossible : ${stderr.trim()}`);
                        try {
                            Gio.File.new_for_path(qrPath).delete(null);
                        } catch (e) {
                            if (Gio.File.new_for_path(qrPath).query_exists(null)) {
                                log(`[PrismUI] Impossible de supprimer le QR temporaire : ${e.message}`);
                            }
                        }
                        return;
                    }
                    let qrFile = Gio.File.new_for_path(qrPath);
                    let qrImage = new St.Icon({
                        gicon: new Gio.FileIcon({ file: qrFile }),
                        icon_size: 160,
                        style_class: 'quick-hotspot-qr'
                    });
                    details.insert_child_at_index(qrImage, Math.max(1, details.get_n_children() - 1));
                    details._hotspotQrImage = qrImage;
                    details._hotspotQrPath = qrPath;
                    statusLabel.text = 'Scanne ce code pour rejoindre le réseau.';
                    menunet._hotspotQrPath = qrPath;
                } catch (e) {
                    statusLabel.text = 'QR indisponible.';
                    log(`[PrismUI] Erreur de création de l’image QR : ${e.message}`);
                    try {
                        Gio.File.new_for_path(qrPath).delete(null);
                    } catch (deleteError) {
                        log(`[PrismUI] Impossible de supprimer le QR temporaire : ${deleteError.message}`);
                    }
                }
            });
        } catch (e) {
            statusLabel.text = `Impossible de lancer qrencode : ${e.message}`;
            log(`[PrismUI] Impossible de lancer qrencode : ${e.message}`);
        }
    }

    _installQrencode(button, statusLabel, details, ssid, password) {
        button.reactive = false;
        button.can_focus = false;
        statusLabel.text = 'Installation de qrencode : autorise la demande administrateur…';
        try {
            let process = Gio.Subprocess.new(
                ['pkexec', 'apt-get', 'install', '-y', 'qrencode'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            process.communicate_utf8_async(null, null, (subprocess, result) => {
                try {
                    let [communicated, stdout, stderr] = subprocess.communicate_utf8_finish(result);
                    button.reactive = true;
                    button.can_focus = true;
                    if (!communicated)
                        throw new Error('Impossible de lire la sortie du processus.');
                    if (!subprocess.get_successful()) {
                        let exitCode = subprocess.get_exit_status();
                        let output = (stderr || stdout || '').trim().split(/\r?\n/).slice(-3).join(' ').slice(-180);
                        let reason = output ? ` : ${output}` : '';
                        if (menunet && details.get_parent())
                            statusLabel.text = `Installation échouée (code ${exitCode})${reason}`;
                        log(`[PrismUI] Installation de qrencode échouée (code ${exitCode})${reason}`);
                        return;
                    }
                    if (!menunet || !details.get_parent())
                        return;
                    button.visible = false;
                    statusLabel.text = 'qrencode installé ; création du QR code…';
                    this._generateHotspotQrCode(ssid, password, details, statusLabel, button);
                } catch (e) {
                    button.reactive = true;
                    button.can_focus = true;
                    if (menunet && details.get_parent())
                        statusLabel.text = `Impossible de vérifier l’installation : ${e.message}`;
                    log(`[PrismUI] Impossible de vérifier l’installation de qrencode : ${e.message}`);
                }
            });
        } catch (e) {
            button.reactive = true;
            button.can_focus = true;
            statusLabel.text = 'Impossible de lancer l’installation de qrencode.';
            log(`[PrismUI] Impossible de lancer pkexec pour qrencode : ${e.message}`);
        }
    }

    _activateQuickShortcut(name) {
        switch (name) {
        case 'airplane':
            this._setAirplaneMode(!(
                this._rfkillManager && this._rfkillManager.airplane_mode
            ));
            break;
        case 'darkTheme':
            if (!this._interfaceSettings) {
                this._notifyQuickSettingUnavailable('Thème indisponible', 'Le réglage de thème GNOME n’est pas disponible.');
                return;
            }
            let themeChanged = this._interfaceSettings.set_string(
                'color-scheme',
                this._interfaceSettings.get_string('color-scheme') === 'prefer-dark' ? 'prefer-light' : 'prefer-dark'
            );
            if (!themeChanged) {
                this._notifyQuickSettingUnavailable('Thème non modifié', 'GNOME n’a pas accepté le changement de thème.');
            }
            break;
        case 'powerSaver':
            this._togglePowerSaver();
            break;
        case 'hotspot':
            this._toggleHotspot();
            break;
        case 'nightLight':
            if (!this._nightLightSettings) {
                this._notifyQuickSettingUnavailable('Éclairage nocturne indisponible', 'Le réglage GNOME de l’éclairage nocturne n’est pas disponible.');
                return;
            }
            let nightLightChanged = this._nightLightSettings.set_boolean(
                'night-light-enabled',
                !this._nightLightSettings.get_boolean('night-light-enabled')
            );
            if (!nightLightChanged) {
                this._notifyQuickSettingUnavailable('Éclairage nocturne non modifié', 'GNOME n’a pas accepté le changement de réglage.');
            }
            break;
        }
        this._updateQuickShortcutStates();
    }

    _setQuickToggleState(circle, enabled) {
        if (!circle) return;
        if (enabled) {
            circle.add_style_class_name('active');
        } else {
            circle.remove_style_class_name('active');
        }
    }

    _updateQuickToggleStates() {
        let wifiEnabled = !!(
            this._nmClient &&
            this._nmClient.wireless_enabled &&
            this._nmClient.wireless_hardware_enabled
        );
        let bluetoothAvailable = !!(
            this._bluetoothClient &&
            this._bluetoothClient.default_adapter
        );
        this._setQuickToggleState(this._wifiToggleCircle, wifiEnabled);
        this._setQuickToggleState(
            this._bluetoothToggleCircle,
            bluetoothAvailable && this._bluetoothClient.default_adapter_powered
        );
    }

    _toggleWifi() {
        if (!this._nmClient) {
            log('[PrismUI] Impossible de basculer le Wi-Fi : NetworkManager est indisponible.');
            return;
        }
        if (!this._nmClient.wireless_hardware_enabled) {
            log('[PrismUI] Impossible d’activer le Wi-Fi : le commutateur matériel le bloque.');
            return;
        }
        this._nmClient.wireless_enabled = !this._nmClient.wireless_enabled;
        this._updateQuickShortcutStates();
    }

    _toggleBluetooth() {
        if (!this._bluetoothClient || !this._bluetoothClient.default_adapter) {
            log('[PrismUI] Impossible de basculer Bluetooth : aucun adaptateur disponible.');
            this._notifyBluetoothUnavailable();
            return;
        }

        try {
            let powered = this._bluetoothClient.default_adapter_powered;
            if (this._bluetoothRfkillProxy) {
                this._bluetoothRfkillProxy.get_connection().call(
                    'org.gnome.SettingsDaemon.Rfkill',
                    '/org/gnome/SettingsDaemon/Rfkill',
                    'org.freedesktop.DBus.Properties',
                    'Set',
                    new GLib.Variant('(ssv)', [
                        'org.gnome.SettingsDaemon.Rfkill',
                        'BluetoothAirplaneMode',
                        new GLib.Variant('b', powered)
                    ]),
                    null,
                    Gio.DBusCallFlags.NONE,
                    -1,
                    null,
                    (connection, result) => {
                        try {
                            connection.call_finish(result);
                            if (!powered && this._bluetoothClient) {
                                this._bluetoothClient.default_adapter_powered = true;
                            }
                        } catch (e) {
                            log(`[PrismUI] Impossible de modifier Bluetooth via RFKill : ${e.message}`);
                            this._notifyQuickSettingUnavailable('Bluetooth non modifié', e.message);
                        }
                    }
                );
            } else {
                this._initBluetoothRfkill();
                this._bluetoothClient.default_adapter_powered = !powered;
            }
        } catch (e) {
            log(`[PrismUI] Impossible de basculer Bluetooth : ${e.message}`);
            this._notifyQuickSettingUnavailable('Bluetooth non modifié', e.message);
        }
    }

    _notifyBluetoothUnavailable() {
        if (global.notificationManager) {
            global.notificationManager.showNotification(
                'Bluetooth indisponible',
                'Aucun adaptateur Bluetooth n’est détecté sur cet appareil.',
                'Système',
                'bluetooth-symbolic'
            );
        }
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
        
        let workspace = global.workspace_manager.get_active_workspace();
        let workArea = workspace.get_work_area_for_monitor(monitorIndex);
        
        let dockHeight = (global.myDock && global.myDock.container) ? global.myDock.container.height + 25 : 100;
        
        let newX = workArea.x;
        let newY = workArea.y;
        let newWidth = workArea.width;
        let newHeight = workArea.height - dockHeight;

        const applyGeometry = () => {
            window.move_resize_frame(true, newX, newY, newWidth, newHeight);
            
            if (global.windowEffectManager && typeof global.windowEffectManager.applyClip === 'function') {
                try {
                    global.windowEffectManager.applyClip(window);
                } catch (e) {
                    log(`Erreur lors de l'application du clip à la fenêtre : ${e.message}`);
                }
            }
        };

        if (window.maximized_vertically || window.maximized_horizontally) { 
            window.unmaximize(Meta.MaximizeFlags.BOTH);
            
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                applyGeometry();
                return GLib.SOURCE_REMOVE;
            });
        } else {
            applyGeometry();
        }
    }

    _setPosition() {
        let monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;

        let targetY = Math.round(monitor.y + 11);

        if (this.container && this.container.width > 0) {
            let targetX = Math.round(monitor.x + monitor.width - this.container.width - 15);
            let currentX = Math.round(this.container.x);
            let currentY = Math.round(this.container.y);

            if (currentX !== targetX || currentY !== targetY) {
                this.container.set_position(targetX, targetY);
            }
        }

        if (this.clockContainer && this.clockContainer.width > 0) {
            let clockX = Math.round(monitor.x + 15);
            let currentClockX = Math.round(this.clockContainer.x);
            let currentClockY = Math.round(this.clockContainer.y);

            if (currentClockX !== clockX || currentClockY !== targetY) {
                this.clockContainer.set_position(clockX, targetY);
            }
        }
    }

    _updateClock() {
        if (!this.clockLabel) return;
        let now = new Date();
        let weekday = now.toLocaleDateString('fr-FR', {
            weekday: 'short'
        });
        let date = now.toLocaleDateString('fr-FR', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });
        let time = now.toLocaleTimeString('fr-FR', {
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23'
        });
        let formattedWeekday = weekday.charAt(0).toLocaleUpperCase('fr-FR') + weekday.slice(1);
        this.clockLabel.set_text(`${time}   ${formattedWeekday} ${date}`);
    }

    _showQuickSettingsPage(title, iconName, buildContent) {
        if (!menunet || !this._quickSettingsHome) return;

        if (this._quickSettingsPage) {
            if (menunet._hotspotQrPath) {
                try {
                    Gio.File.new_for_path(menunet._hotspotQrPath).delete(null);
                } catch (e) {
                    log(`[PrismUI] Impossible de supprimer le QR temporaire du point d’accès : ${e.message}`);
                }
                menunet._hotspotQrPath = null;
            }
            this._quickSettingsPage.destroy();
            this._quickSettingsPage = null;
        }

        let page = new St.BoxLayout({
            vertical: true,
            style_class: 'quick-settings-page',
            x_expand: true,
            y_expand: true
        });
        let header = new St.BoxLayout({
            vertical: false,
            style_class: 'quick-page-header',
            x_expand: true
        });
        let backButton = new St.Button({
            style_class: 'toggle-btn',
            child: new St.Icon({ icon_name: 'go-previous-symbolic', icon_size: 16 })
        });
        backButton.connect('clicked', () => this._showQuickSettingsHome());

        header.add_child(backButton);
        header.add_child(new St.Icon({
            icon_name: iconName,
            icon_size: 20,
            style_class: 'quick-page-header-icon'
        }));
        let pageTitle = new St.Label({
            text: title,
            style_class: 'quick-page-title',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true
        });
        header.add_child(pageTitle);
        page.add_child(header);
        page.add_child(buildContent());

        this._quickSettingsHome.hide();
        menunet.add_child(page);
        this._quickSettingsPage = page;
    }

    _showQuickSettingsHome() {
        if (this._quickSettingsPage) {
            this._quickSettingsPage.destroy();
            this._quickSettingsPage = null;
        }
        if (this._quickSettingsHome) this._quickSettingsHome.show();
    }

    _showAccessibilityPage() {
        let settings = [
            { schema: 'org.gnome.desktop.a11y.applications', key: 'screen-keyboard-enabled', name: 'Clavier à l\'écran' },
            { schema: 'org.gnome.desktop.a11y.applications', key: 'screen-magnifier-enabled', name: 'Loupe d\'écran' },
            { schema: 'org.gnome.desktop.a11y.applications', key: 'screen-reader-enabled', name: 'Lecteur d\'écran' },
            { schema: 'org.gnome.desktop.a11y.interface', key: 'high-contrast', name: 'Contraste élevé' }
        ];

        this._showQuickSettingsPage('Accessibilité', 'preferences-desktop-accessibility-symbolic', () => {
            let optionsList = new St.BoxLayout({
                vertical: true,
                style_class: 'options-list',
                x_expand: true,
                y_expand: true
            });
            let iconPathOn = `${this._ext.path}/icons/interface/toggle/toggle-button-on.png`;
            let iconPathOff = `${this._ext.path}/icons/interface/toggle/toggle-button-off.png`;

            settings.forEach(setting => {
                let item = new St.BoxLayout({
                    vertical: false,
                    style_class: 'option-item',
                    x_expand: true
                });
                let label = new St.Label({
                    text: setting.name,
                    style_class: 'option-label',
                    y_align: Clutter.ActorAlign.CENTER,
                    x_expand: true
                });
                let button = new St.Button({
                    style_class: 'option-button',
                    reactive: true
                });
                let icon = new St.Icon({
                    gicon: Gio.icon_new_for_string(this._getSetting(setting.schema, setting.key) ? iconPathOn : iconPathOff),
                    style_class: 'option-icon',
                    icon_size: 24
                });
                button.set_child(icon);
                button.connect('clicked', () => {
                    let newState = !this._getSetting(setting.schema, setting.key);
                    this._setSetting(setting.schema, setting.key, newState);
                    icon.gicon = Gio.icon_new_for_string(newState ? iconPathOn : iconPathOff);
                });

                item.add_child(label);
                item.add_child(button);
                optionsList.add_child(item);
            });
            return optionsList;
        });
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

    _handleBarClick() {
        if (menunet) {
            this._closeAllMenus();
            return null;
        }

        this._mainMenuOpen = true;
        this._tooltipsLocked = true;
        this._hideStatusTooltip();
        this._initBluetooth();
        this._initQuickShortcutSettings();

        let monitor = Main.layoutManager.primaryMonitor;
        let menunetWidth = Math.min(420, monitor.width - 32);
        let menunetHeight = Math.min(_isPC ? 400 : 485, monitor.height - 32);
        let menunetX = Math.floor((monitor.x + monitor.width - menunetWidth) - 20);
        let topBarBottom = this.container
            ? this.container.y + this.container.height
            : monitor.y + 65;
        let menunetY = Math.min(topBarBottom + 5, monitor.y + monitor.height - menunetHeight + 4);

        menunet = new St.BoxLayout({
            vertical: true,
            name: 'net-boxmn',
            style_class: 'net-boxmn'
        });
        this._quickSettingsHome = new St.BoxLayout({
            vertical: true,
            style_class: 'quick-settings-home',
            x_expand: true,
            y_expand: true
        });
        this._quickSettingsPage = null;

        menunet.set_position(menunetX, menunetY);

        menunet.set_size(menunetWidth, menunetHeight);
        
        let powerButtonsBox = new St.BoxLayout({
            vertical: false,
            style_class: 'quick-power-row',
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL
        });
        let quickSettingsTitle = new St.Label({
            text: 'Centre de contrôle',
            style_class: 'quick-power-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER
        });
        let logoutBtn = new St.Button({
            style_class: 'bottom-btn quick-power-btn',
            child: new St.Icon({ icon_name: 'system-log-out-symbolic' })
        });
        let rebootBtn = new St.Button({
            style_class: 'bottom-btn quick-power-btn',
            child: new St.Icon({ icon_name: 'system-reboot-symbolic' })
        });
        let shutdownBtn = new St.Button({
            style_class: 'bottom-btn quick-power-btn',
            child: new St.Icon({ icon_name: 'system-shutdown-symbolic' })
        });
        logoutBtn.connect('clicked', () => { this._closeAllMenus(); GLib.spawn_command_line_async('gnome-session-quit --logout'); });
        rebootBtn.connect('clicked', () => { this._closeAllMenus(); GLib.spawn_command_line_async('systemctl reboot'); });
        shutdownBtn.connect('clicked', () => { this._closeAllMenus(); GLib.spawn_command_line_async('systemctl poweroff'); });
        powerButtonsBox.add_child(quickSettingsTitle);
        powerButtonsBox.add_child(logoutBtn);
        powerButtonsBox.add_child(rebootBtn);
        powerButtonsBox.add_child(shutdownBtn);

        function createToggleTile(iconName, title, subtitle) {
            let tile = new St.BoxLayout({
                vertical: false,
                style_class: 'quick-connect-tile',
                x_expand: true
            });
            let icon = new St.Icon({
                icon_name: iconName,
                icon_size: 24,
                style_class: 'toggle-icon'
            });
            let iconCircle = new St.Bin({
                style_class: 'quick-connect-icon-circle',
                child: icon
            });
            let labels = new St.BoxLayout({
                vertical: true,
                style_class: 'quick-connect-labels',
                x_expand: true
            });
            labels.add_child(new St.Label({ text: title, style_class: 'toggle-label' }));
            labels.add_child(new St.Label({ text: subtitle, style_class: 'quick-connect-subtitle' }));
            tile.add_child(iconCircle);
            tile.add_child(labels);
            let button = new St.Button({
                style_class: 'toggle-btn quick-connect-btn',
                x_expand: true,
                x_align: Clutter.ActorAlign.FILL,
                child: tile
            });
            button.set_width(Math.floor((menunetWidth - 30 - 10) / 2));
            return { button, iconCircle };
        }

        let controlBox = new St.BoxLayout({
            vertical: false,
            name: 'control-box',
            style_class: 'quick-connect-row',
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL
        });
        controlBox.set_width(menunetWidth - 30);

        let wifiToggle = createToggleTile('network-wireless-symbolic', 'Wi-Fi', 'Gérer le réseau');
        let wifiBtn = wifiToggle.button;
        this._wifiToggleCircle = wifiToggle.iconCircle;
        let bluetoothToggle = createToggleTile('bluetooth-symbolic', 'Bluetooth', 'Appareils');
        let bleBtn = bluetoothToggle.button;
        this._bluetoothToggleCircle = bluetoothToggle.iconCircle;
        this._updateQuickToggleStates();

        let showWifiDetails = () => this._showQuickSettingsPage('Wi-Fi', 'network-wireless-symbolic', () => {
            let details = new St.BoxLayout({
                vertical: true,
                style_class: 'quick-settings-details quick-network-details',
                x_expand: true
            });
            let primaryConnection = this._nmClient
                ? this._nmClient.get_primary_connection()
                : null;
            let primaryType = primaryConnection
                ? primaryConnection.get_connection_type()
                : '';
            let accessPointDevice = this._nmClient
                ? this._nmClient.get_devices().find(device =>
                    device.device_type === NM.DeviceType.WIFI &&
                    device.active_connection === primaryConnection &&
                    device.active_access_point &&
                    !(device.active_connection &&
                        device.active_connection.get_connection() &&
                        device.active_connection.get_connection().get_setting_wireless() &&
                        device.active_connection.get_connection().get_setting_wireless().mode === 'ap')
                )
                : null;
            let hotspotActive = !!this._getActiveHotspot();

            if (hotspotActive && !accessPointDevice) {
                details.add_child(new St.Label({
                    text: 'Le Wi-Fi ne peut pas être utilisé en même temps que le point d’accès sur cette machine.',
                    style_class: 'quick-info-card quick-info-message',
                    x_expand: true
                }));
                return details;
            }

            if (!accessPointDevice || !primaryType.includes('wireless')) {
                details.add_child(new St.Label({
                    text: 'La connexion Wi-Fi n’est pas utilisée pour le moment.',
                    style_class: 'quick-info-card quick-info-message',
                    x_expand: true
                }));
                return details;
            }

            let currentNetwork = new St.BoxLayout({
                vertical: true,
                style_class: 'quick-info-section',
                x_expand: true
            });
            currentNetwork.add_child(new St.Label({
                text: 'Réseau actuel',
                style_class: 'quick-section-title',
                x_expand: true
            }));
            let networkCard = new St.BoxLayout({
                vertical: false,
                style_class: 'quick-device-card',
                x_expand: true
            });
            let networkLabels = new St.BoxLayout({
                vertical: true,
                style_class: 'quick-device-labels',
                x_expand: true
            });
            let ssidBytes = accessPointDevice.active_access_point.get_ssid();
            let currentSsid = ssidBytes
                ? NM.utils_ssid_to_utf8(ssidBytes.get_data())
                : '';
            networkLabels.add_child(new St.Label({
                text: currentSsid || 'Réseau Wi-Fi',
                style_class: 'quick-device-name',
                x_expand: true
            }));
            networkLabels.add_child(new St.Label({
                text: 'Connecté',
                style_class: 'quick-device-status',
                x_expand: true
            }));
            networkCard.add_child(networkLabels);
            let disconnectButton = new St.Button({
                label: 'Déconnecter',
                style_class: 'quick-device-action',
                reactive: true,
                can_focus: true
            });
            disconnectButton.connect('clicked', () => {
                let activeConnection = accessPointDevice.active_connection;
                if (!activeConnection || !this._nmClient) return;
                disconnectButton.reactive = false;
                this._nmClient.deactivate_connection_async(activeConnection, null, (client, result) => {
                    try {
                        client.deactivate_connection_finish(result);
                        showWifiDetails();
                    } catch (e) {
                        disconnectButton.reactive = true;
                        log(`[PrismUI] Impossible de déconnecter le réseau Wi-Fi : ${e.message}`);
                        this._notifyQuickSettingUnavailable('Wi-Fi non déconnecté', e.message);
                    }
                });
            });
            networkCard.add_child(disconnectButton);
            currentNetwork.add_child(networkCard);
            details.add_child(currentNetwork);
            return details;
        });

        let showBluetoothDetails = () => {
            if (!this._bluetoothClient || !this._bluetoothClient.default_adapter) {
                log('[PrismUI] Impossible d’ouvrir les détails Bluetooth : aucun adaptateur disponible.');
                this._notifyBluetoothUnavailable();
                return;
            }
            this._showQuickSettingsPage('Bluetooth', 'bluetooth-symbolic', () => {
                let details = new St.BoxLayout({
                    vertical: true,
                    style_class: 'quick-settings-details quick-network-details',
                    x_expand: true
                });
                let section = new St.BoxLayout({
                    vertical: true,
                    style_class: 'quick-info-section',
                    x_expand: true
                });
                section.add_child(new St.Label({
                    text: 'Appareils appairés',
                    style_class: 'quick-section-title',
                    x_expand: true
                }));
                let deviceList = new St.BoxLayout({
                    vertical: true,
                    style_class: 'quick-device-list',
                    x_expand: true
                });
                section.add_child(deviceList);
                details.add_child(section);
                let loading = new St.Label({
                    text: 'Chargement des appareils appairés…',
                    style_class: 'quick-info-card quick-info-message',
                    x_expand: true
                });
                details.add_child(loading);

                let deviceSignalIds = [];
                let trackedDevices = new Set();
                let refreshQueued = false;
                let refreshPairedDevices = () => {
                    if (!menunet || !details.get_parent()) return;
                    deviceList.destroy_all_children();
                    if (!this._bluetoothClient.default_adapter_powered) {
                        loading.text = 'Active le Bluetooth pour connecter les appareils appairés.';
                        loading.show();
                        return;
                    }
                    let store = this._bluetoothClient.get_devices();
                    let devices = [];
                    for (let index = 0; index < store.get_n_items(); index++) {
                        let device = store.get_item(index);
                        if (!device.paired && !device.trusted)
                            continue;
                        devices.push(device);

                        let objectPath = device.get_object_path();
                        if (!trackedDevices.has(objectPath)) {
                            trackedDevices.add(objectPath);
                            for (let property of ['alias', 'paired', 'trusted', 'connected']) {
                                let id = device.connect(`notify::${property}`, () => {
                                    if (refreshQueued || !menunet || !details.get_parent())
                                        return;
                                    refreshQueued = true;
                                    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                                        refreshQueued = false;
                                        refreshPairedDevices();
                                        return GLib.SOURCE_REMOVE;
                                    });
                                });
                                deviceSignalIds.push([device, id]);
                            }
                        }
                    }

                    if (!devices.length) {
                        loading.text = 'Aucun appareil appairé.';
                        loading.show();
                        return;
                    }

                    loading.hide();
                    for (let device of devices) {
                        let name = device.alias || device.name || device.address || 'Appareil Bluetooth';
                        let card = new St.BoxLayout({
                            vertical: false,
                            style_class: 'quick-device-card',
                            x_expand: true
                        });
                        let labels = new St.BoxLayout({
                            vertical: true,
                            style_class: 'quick-device-labels',
                            x_expand: true
                        });
                        labels.add_child(new St.Label({
                            text: name,
                            style_class: 'quick-device-name',
                            x_expand: true
                        }));
                        labels.add_child(new St.Label({
                            text: device.connected ? 'Connecté' : 'Appairé',
                            style_class: 'quick-device-status',
                            x_expand: true
                        }));
                        card.add_child(labels);

                        if (!device.connected) {
                            let connectButton = new St.Button({
                                label: 'Connecter',
                                style_class: 'quick-device-action',
                                reactive: true,
                                can_focus: true
                            });
                            connectButton.connect('clicked', () => {
                                connectButton.reactive = false;
                                this._bluetoothClient.connect_service(
                                    device.get_object_path(),
                                    true,
                                    null
                                ).then(() => {
                                    if (menunet && details.get_parent())
                                        refreshPairedDevices();
                                }).catch(e => {
                                    connectButton.reactive = true;
                                    log(`[PrismUI] Impossible de connecter ${name} : ${e.message}`);
                                    this._notifyQuickSettingUnavailable('Appareil Bluetooth non connecté', e.message);
                                });
                            });
                            card.add_child(connectButton);
                        }
                        deviceList.add_child(card);
                    }
                };
                let client = this._bluetoothClient;
                for (let signal of ['device-added', 'device-removed']) {
                    deviceSignalIds.push([client, client.connect(signal, () => refreshPairedDevices())]);
                }
                for (let signal of ['notify::default-adapter', 'notify::default-adapter-powered']) {
                    deviceSignalIds.push([client, client.connect(signal, () => refreshPairedDevices())]);
                }
                details.connect('destroy', () => {
                    for (let [object, id] of deviceSignalIds) {
                        try {
                            object.disconnect(id);
                        } catch (e) {
                            log(`[PrismUI] Impossible de déconnecter un signal Bluetooth : ${e.message}`);
                        }
                    }
                    deviceSignalIds = [];
                });
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    refreshPairedDevices();
                    return GLib.SOURCE_REMOVE;
                });
                return details;
            });
        };

        let connectQuickToggle = (button, toggle, showDetails) => {
            let pressStartedAt = 0;
            button.connect('button-press-event', () => {
                pressStartedAt = GLib.get_monotonic_time();
                return Clutter.EVENT_PROPAGATE;
            });
            button.connect('clicked', () => {
                let pressDuration = pressStartedAt
                    ? GLib.get_monotonic_time() - pressStartedAt
                    : 0;
                pressStartedAt = 0;
                if (pressDuration >= 750000) {
                    showDetails();
                } else {
                    toggle();
                }
            });
        };
        connectQuickToggle(wifiBtn, () => this._toggleWifi(), showWifiDetails);
        connectQuickToggle(bleBtn, () => this._toggleBluetooth(), showBluetoothDetails);

        controlBox.add_child(wifiBtn);
        controlBox.add_child(bleBtn);

        let shortcutsRow = new St.BoxLayout({
            vertical: false,
            style_class: 'quick-shortcuts-row',
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL
        });
        let shortcutsRowWidth = menunetWidth - 30;
        shortcutsRow.set_width(shortcutsRowWidth);
        let shortcuts = [
            { id: 'airplane', icon: 'airplane-mode-symbolic', title: 'Mode avion', label: 'Mode\navion' },
            { id: 'darkTheme', icon: 'weather-clear-night-symbolic', title: 'Thème sombre', label: 'Thème\nsombre' },
            { id: 'powerSaver', icon: 'battery-low-symbolic', title: 'Économie d’énergie', label: 'Économie\nd’énergie' },
            { id: 'hotspot', icon: 'network-wireless-hotspot-symbolic', title: 'Point d’accès', label: 'Point\nd’accès' },
            { id: 'nightLight', icon: 'night-light-symbolic', title: 'Éclairage nocturne', label: 'Éclairage\nnocturne' }
        ];
        let shortcutCellBaseWidth = Math.floor((shortcutsRowWidth - 32) / shortcuts.length);
        let shortcutCellExtraPixels = (shortcutsRowWidth - 32) % shortcuts.length;
        for (let [index, shortcut] of shortcuts.entries()) {
            let shortcutCellWidth = shortcutCellBaseWidth + (index < shortcutCellExtraPixels ? 1 : 0);
            let shortcutBox = new St.BoxLayout({
                vertical: true,
                style_class: 'quick-shortcut-item',
                x_expand: true,
                x_align: Clutter.ActorAlign.FILL
            });
            shortcutBox.set_width(shortcutCellWidth);
            let shortcutIcon = new St.Icon({ icon_name: shortcut.icon, icon_size: 18 });
            shortcutIcon.set_size(24, 24);
            let shortcutButton = new St.Button({
                style_class: 'quick-shortcut-button',
                x_expand: true,
                x_align: Clutter.ActorAlign.FILL,
                child: shortcutIcon
            });
            this._quickShortcutButtons[shortcut.id] = shortcutBox;
            if (shortcut.id === 'hotspot') {
                let pressStartedAt = 0;
                shortcutButton.connect('button-press-event', () => {
                    pressStartedAt = GLib.get_monotonic_time();
                    return Clutter.EVENT_PROPAGATE;
                });
                shortcutButton.connect('clicked', () => {
                    let pressDuration = pressStartedAt
                        ? GLib.get_monotonic_time() - pressStartedAt
                        : 0;
                    pressStartedAt = 0;
                    if (pressDuration >= 750000) {
                        this._showHotspotDetails();
                    } else {
                        this._activateQuickShortcut(shortcut.id);
                    }
                });
            } else {
                shortcutButton.connect('clicked', () => this._activateQuickShortcut(shortcut.id));
            }
            shortcutBox.add_child(shortcutButton);
            let shortcutLabel = new St.Label({
                text: shortcut.label,
                style_class: 'quick-shortcut-label',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true
            });
            shortcutLabel.set_width(shortcutCellWidth);
            shortcutLabel.clutter_text.set_line_wrap(false);
            shortcutLabel.clutter_text.set_line_alignment(Pango.Alignment.CENTER);
            shortcutBox.add_child(shortcutLabel);
            shortcutsRow.add_child(shortcutBox);
        }
        this._updateQuickShortcutStates();

        let sliderGroup = new St.BoxLayout({
            vertical: true,
            style_class: 'quick-slider-group',
            x_expand: true
        });
        let volumeSlider = new Slider.Slider(0.5);
        volumeSlider.x_expand = true;
        let volumeBox = new St.BoxLayout({ name: 'vlm-box', vertical: false, style_class: 'slider-box-vol' });
        volumeBox.add_child(new St.Icon({ icon_name: 'audio-volume-high-symbolic', icon_size: 22, style_class: 'toggle-icon' }));
        volumeBox.add_child(volumeSlider);

        let stream = this._mixerControl ? this._mixerControl.get_default_sink() : null;
        if (stream) {
            let currentVol = stream.volume / this._mixerControl.get_vol_max_norm();
            volumeSlider.value = Math.min(currentVol, 1);
        }

        volumeSlider.connect('notify::value', () => {
            if (stream && this._mixerControl) {
                let vol = volumeSlider.value * this._mixerControl.get_vol_max_norm();
                stream.volume = vol;
                stream.push_volume();
            }
        });

        let brightSlider = new Slider.Slider(0);
        brightSlider.x_expand = true;
        let brightBox = new St.BoxLayout({ name: 'brightbox', vertical: false, style_class: 'slider-box-brig' });
        brightBox.add_child(new St.Icon({ icon_name: 'display-brightness-symbolic', icon_size: 22, style_class: 'toggle-icon' }));
        brightBox.add_child(brightSlider);

        if (_isPC) {
            brightBox.hide();
        } else {
            menunet._brightnessSlider = brightSlider;
            this._initBrightness();
            this._connectBrightnessSlider(menunet, brightSlider);
        }

        sliderGroup.add_child(volumeBox);
        sliderGroup.add_child(brightBox);

        let bottomActions = new St.BoxLayout({
            vertical: false,
            style_class: 'quick-bottom-actions',
            x_expand: true
        });
        let accessibilityContent = new St.BoxLayout({
            vertical: false,
            style_class: 'quick-wide-button-content'
        });
        accessibilityContent.add_child(new St.Icon({
            icon_name: 'preferences-desktop-accessibility-symbolic',
            icon_size: 22
        }));
        accessibilityContent.add_child(new St.Label({ text: 'Accessibilité' }));
        let accessibilityButton = new St.Button({
            style_class: 'quick-wide-button',
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            child: accessibilityContent
        });
        accessibilityButton.connect('clicked', () => this._showAccessibilityPage());

        let projectorContent = new St.BoxLayout({
            vertical: false,
            style_class: 'quick-wide-button-content'
        });
        projectorContent.add_child(new St.Icon({ icon_name: 'video-display-symbolic', icon_size: 22 }));
        projectorContent.add_child(new St.Label({ text: 'Écran' }));
        let projectorButton = new St.Button({
            style_class: 'quick-wide-button',
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            child: projectorContent
        });
        projectorButton.connect('clicked', () => {
            this._closeAllMenus();
            try {
                GLib.spawn_command_line_async('gnome-control-center display');
            } catch (e) {
                log(`[PrismUI] Impossible d'ouvrir les paramètres d'affichage : ${e.message}`);
            }
        });
        bottomActions.add_child(accessibilityButton);
        bottomActions.add_child(projectorButton);

        let batteryBox = null;
        if (!_isPC) {
            batteryBox = new St.BoxLayout({
                name: 'mn-bat-box',
                style_class: 'menu-battery-box quick-battery-box',
                vertical: false,
                x_expand: true
            });
            let batteryIcon = new St.Icon({ icon_size: 24, style_class: 'menu-battery-icon' });
            let batteryLabel = new St.Label({
                text: 'Batterie indisponible',
                style_class: 'menu-battery-label',
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true
            });
            let batteryDevice = this._upClient ? this._upClient.get_display_device() : null;
            if (batteryDevice) {
                let charging = batteryDevice.state === UPowerGlib.DeviceState.CHARGING;
                batteryLabel.text = `${Math.round(batteryDevice.percentage)}%${charging ? ' - En charge' : ''}`;
                let baseName = batteryDevice.percentage < 10 ? 'battery-emptywth' : (batteryDevice.percentage < 35 ? 'battery-quarterwth' : (batteryDevice.percentage < 60 ? 'battery-halfwth' : (batteryDevice.percentage < 85 ? 'battery3s4wth' : 'battery-fullwth')));
                let batteryFile = Gio.File.new_for_path(`${this._iconsPath}/${baseName}${charging ? '-ch' : ''}.png`);
                if (batteryFile.query_exists(null)) batteryIcon.gicon = new Gio.FileIcon({ file: batteryFile });
            }
            batteryBox.add_child(batteryIcon);
            batteryBox.add_child(batteryLabel);
        }

        this._quickSettingsHome.add_child(powerButtonsBox);
        this._quickSettingsHome.add_child(controlBox);
        this._quickSettingsHome.add_child(shortcutsRow);
        this._quickSettingsHome.add_child(sliderGroup);
        this._quickSettingsHome.add_child(bottomActions);
        if (batteryBox) this._quickSettingsHome.add_child(batteryBox);
        menunet.add_child(this._quickSettingsHome);
        Main.layoutManager.addChrome(menunet);

        let stageEventId = global.stage.connect('captured-event', (stage, event) => {
            let type = event.type();
            
            if (type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN) {
                let target = event.get_source();
                
                try {
                    if (!menunet || !this.container) {
                        return Clutter.EVENT_PROPAGATE;
                    }

                    if (menunet === target || menunet.contains(target)) {
                        return Clutter.EVENT_PROPAGATE; 
                    }
                    
                    if (this.container === target || this.container.contains(target)) {
                        return Clutter.EVENT_PROPAGATE;
                    }
                    
                    this._closeAllMenus();
                } catch (e) {
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });

        menunet.connect('destroy', destroyedActor => {
            this._mainMenuOpen = false;
            this._tooltipsLocked = false;
            if (stageEventId) {
                global.stage.disconnect(stageEventId);
                stageEventId = 0;
            }
            
            if (this._brightnessProxy && destroyedActor._brightnessSliderSignalId) {
                this._brightnessProxy.disconnect(destroyedActor._brightnessSliderSignalId);
                destroyedActor._brightnessSliderSignalId = 0;
            }

            if (destroyedActor._hotspotQrPath) {
                try {
                    Gio.File.new_for_path(destroyedActor._hotspotQrPath).delete(null);
                } catch (e) {
                    log(`[PrismUI] Impossible de supprimer le QR temporaire du point d’accès : ${e.message}`);
                }
                destroyedActor._hotspotQrPath = null;
            }
            
            Main.layoutManager.removeChrome(destroyedActor);
            if (menunet === destroyedActor)
                menunet = null;
            this._quickSettingsHome = null;
            this._quickSettingsPage = null;
            this._wifiToggleCircle = null;
            this._bluetoothToggleCircle = null;
            this._quickShortcutButtons = {};
        });

        return menunet;
    }

    destroy() {
        this._bluetoothInitialized = false;
        this._bluetoothRfkillInitialized = false;
        this._powerProfilesInitialized = false;

        if (this._initTimeout) {
            GLib.Source.remove(this._initTimeout);
            this._initTimeout = 0;
        }

        if (this._wallClock && this._wallClockSignalId) {
            this._wallClock.disconnect(this._wallClockSignalId);
            this._wallClockSignalId = 0;
        }
        this._wallClock = null;

        for (let connection of this._signalConnections) {
            try { connection.object.disconnect(connection.id); } catch (e) {}
        }
        this._signalConnections = [];

        if (this._networkMonitorId) {
            Main.layoutManager.disconnect(this._networkMonitorId);
            this._networkMonitorId = 0;
        }

        if (this._netPosIdleId) {
            GLib.Source.remove(this._netPosIdleId);
            this._netPosIdleId = 0;
        }

        this._closeAllMenus();
        this._hideStatusTooltip();

        if (this.statusTooltip) {
            Main.layoutManager.removeChrome(this.statusTooltip);
            this.statusTooltip.destroy();
            this.statusTooltip = null;
        }

        if (this.container) {
            this.container.destroy();
            this.container = null;
        }

        if (this.clockContainer) {
            this.clockContainer.destroy();
            this.clockContainer = null;
            this.clockLabel = null;
        }

        this._mixerControl = null;
        this._audioStream = null;
        this._upClient = null;
        this._batteryProxy = null;
        this._batterySignalDevice = null;
        this._nmClient = null;
        this._bluetoothClient = null;
        this._bluetoothRfkillProxy = null;
        this._wifiToggleCircle = null;
        this._bluetoothToggleCircle = null;
        this._quickShortcutButtons = {};
        this._interfaceSettings = null;
        this._nightLightSettings = null;
        this._powerProfilesProxy = null;
        this._brightnessProxy = null;
        this._brightnessInitPending = false;
        this._rfkillManager = null;
    }
}