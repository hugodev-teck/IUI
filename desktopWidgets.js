const { St, Clutter, GLib, Gio, Soup } = imports.gi;
const Main = imports.ui.main;

const LONG_PRESS_TIME = 1500;
const WIDGET_EDIT_TIME = 800;
const GRID_SIZE = 50;

const BUILTIN_WIDGETS = [
    {
        id: "clock-widget",
        name: "Horloge",
        gridW: 6,
        gridH: 3,
        ui: {
            type: 'box',
            vertical: true,
            style_class: 'prism-widget-box',
            children: [
                { type: 'label', id: 'clock-time', text: '--:--', style: 'text-align: center; font-size: 72px; font-weight: bold; color: white; margin-bottom: 4px;' },
                { type: 'label', id: 'clock-date', text: 'Chargement...', style: 'text-align: center; font-size: 20px; color: #dfe7ff;' }
            ]
        },
        bindings: [
            {
                targetId: 'clock-time',
                targetProp: 'text',
                interval: 60,
                sourceType: 'cmd',
                source: "date '+%H:%M'",
                process: 'return data.trim();'
            },
            {
                targetId: 'clock-date',
                targetProp: 'text',
                interval: 60,
                sourceType: 'cmd',
                source: "date '+%A %d %B %Y'",
                process: 'return data.trim();'
            }
        ]
    },
    {
        id: "shortcut-widget",
        name: "Raccourci",
        gridW: 2,
        gridH: 2,
        ui: {
            type: 'box',
            vertical: true,
            style_class: 'prism-widget-box',
            style: 'padding: 8px; spacing: 6px; border-radius: 16px; width: 100%; height: 100%; x-align: center; y-align: center; horizontal-align: center; vertical-align: middle;',
            children: [
                { type: 'icon', id: 'shortcut-icon', icon_name: 'application-x-executable', icon_size: 32, style: 'padding: 4px; x-align: center; y-align: center;' },
                { type: 'label', id: 'shortcut-label', text: 'Choisir', style: 'font-size: 14px; color: white; text-align: center; line-height: 1.1; width: 100%; max-width: 100%; x-align: center; y-align: center;' }
            ]
        },
        bindings: [
            { sourceType: 'shortcut', targetId: 'shortcut-icon', targetProp: 'icon' },
            { sourceType: 'shortcut', targetId: 'shortcut-label', targetProp: 'text' }
        ]
    },
    {
        id: "sys-widget",
        name: "Système",
        gridW: 4, gridH: 3,
        ui: {
            type: 'box', vertical: true, style_class: 'prism-widget-box',
            children: [
                { type: 'label', text: 'Information système', style: 'font-size: 16px; font-weight: bold; color: white; margin-bottom: 8px;' },

                { type: 'label', id: 'ram-text', text: 'RAM : Calcul...', style: 'font-size: 14px; color: #ddd; margin-bottom: 5px;' },
                { 
                    type: 'box', style: 'width: 150px; height: 6px; background-color: rgba(255,255,255,0.1); border-radius: 3px; margin-bottom: 15px;',
                    children: [ { type: 'progress', id: 'ram-bar', style: 'width: 0px; height: 6px; background-color: #0088ff; border-radius: 3px;' } ]
                },

                { type: 'label', id: 'cpu-text', text: 'CPU : Calcul...', style: 'font-size: 14px; color: #ddd; margin-bottom: 5px;' },
                { 
                    type: 'box', style: 'width: 150px; height: 6px; background-color: rgba(255,255,255,0.1); border-radius: 3px;',
                    children: [ { type: 'progress', id: 'cpu-bar', style: 'width: 0px; height: 6px; background-color: #0088ff; border-radius: 3px;' } ]
                }
            ]
        },
        bindings: [
            {
                targetId: "ram-text", targetProp: "text", interval: 3,
                sourceType: "file", source: "/proc/meminfo",
                process: `
                    let t = parseInt(data.match(/MemTotal:\\s+(\\d+)/)[1]);
                    let a = parseInt(data.match(/MemAvailable:\\s+(\\d+)/)[1]);
                    return 'RAM : ' + Math.round(((t-a)/t)*100) + '% (' + ((t-a)/1048576).toFixed(1) + ' Go)';
                `
            },
            {
                targetId: "ram-bar", targetProp: "style", interval: 3,
                sourceType: "file", source: "/proc/meminfo",
                process: `
                    let t = parseInt(data.match(/MemTotal:\\s+(\\d+)/)[1]);
                    let a = parseInt(data.match(/MemAvailable:\\s+(\\d+)/)[1]);
                    return 'width: ' + Math.round(((t-a)/t) * 150) + 'px; height: 6px; background-color: #0088ff; border-radius: 3px;';
                `
            },
            
            {
                targetId: "cpu-text", targetProp: "text", interval: 2,
                sourceType: "file", source: "/proc/stat",
                process: `
                    let parts = data.split('\\n')[0].match(/\\d+/g).map(Number);
                    let idle = parts[3] + parts[4];
                    let total = parts.reduce((a, b) => a + b, 0);
                    
                    // Si c'est le premier passage, on initialise la mémoire
                    if (!globalThis.prevCpuTotal) {
                        globalThis.prevCpuIdle = idle; globalThis.prevCpuTotal = total;
                        return 'CPU : Calcul...';
                    }
                    
                    let totalDiff = total - globalThis.prevCpuTotal;
                    let idleDiff = idle - globalThis.prevCpuIdle;
                    let cpuUsage = (totalDiff - idleDiff) / totalDiff;
                    
                    // On sauvegarde pour le prochain tour
                    globalThis.prevCpuIdle = idle; globalThis.prevCpuTotal = total;
                    
                    return 'CPU : ' + Math.round(cpuUsage * 100) + '%';
                `
            },
            {
                targetId: "cpu-bar", targetProp: "style", interval: 2,
                sourceType: "file", source: "/proc/stat",
                process: `
                    let parts = data.split('\\n')[0].match(/\\d+/g).map(Number);
                    let idle = parts[3] + parts[4];
                    let total = parts.reduce((a, b) => a + b, 0);
                    
                    if (!globalThis.prevCpuTotalBar) {
                        globalThis.prevCpuIdleBar = idle; globalThis.prevCpuTotalBar = total;
                        return 'width: 0px; height: 6px; background-color: #ff8800; border-radius: 3px;';
                    }
                    
                    let cpuUsage = 1 - ((idle - globalThis.prevCpuIdleBar) / (total - globalThis.prevCpuTotalBar));
                    
                    globalThis.prevCpuIdleBar = idle; globalThis.prevCpuTotalBar = total;
                    
                    return 'width: ' + Math.round(cpuUsage * 150) + 'px; height: 6px; background-color: #ff8800; border-radius: 3px;';
                `
            }
        ]
    },
    {
        id: "bat-widget",
        name: "Batterie",
        gridW: 3, gridH: 3,
        ui: {
            type: 'box', vertical: true, style_class: 'prism-widget-box',
            children: [
                { type: 'label', text: 'Batterie', style: 'font-size: 16px; font-weight: bold; color: white; margin-bottom: 8px;' },
                { type: 'label', id: 'bat-text', text: 'Calcul...', style: 'font-size: 32px; font-weight: bold; color: #1ece24;' },
                { type: 'label', id: 'bat-status', text: 'Mise à jour...', style: 'font-size: 12px; color: #ffffff;' }
            ]
        },
        bindings: [
            {
                targetId: "bat-text", targetProp: "text", interval: 10,
                sourceType: "file", source: "/sys/class/power_supply/BAT0/capacity",
                process: `return data + '%';`
            },
            {
                targetId: "bat-status", targetProp: "text", interval: 10,
                sourceType: "file", source: "/sys/class/power_supply/BAT0/status",
                process: `return data.includes('Charging') ? 'En charge' : 'En décharge';`
            }
        ]
    },
    {
        id: "weather-widget",
        name: "Météo",
        gridW: 4, gridH: 3,
        ui: {
            type: 'box', vertical: true, style_class: 'prism-widget-df-meteo-box',
            children: [
                { type: 'label', text: 'Météo', style: 'font-size: 16px; font-weight: bold; color: white; margin-bottom: 8px;' },
                { type: 'label', id: 'weather-data', text: '-- °C', style: 'font-size: 26px; font-weight: bold; color: #086b0c; margin-bottom: 10px;' },
                { type: 'label', id: 'weather-loc', text: 'Actualisation...', style: 'font-size: 14px; color: #888;' }
            ]
        },
        bindings: [
            {
                targetId: "weather-data", targetProp: "text", interval: 300,
                sourceType: "http", 
                source: "https://wttr.in/?format=%25c+%25t",
                process: `if (!data || data.startsWith('<') || data.includes('ERROR')) return 'Hors ligne'; return data;`
            },
            {
                targetId: "weather-loc", targetProp: "text", interval: 300,
                sourceType: "http", 
                source: "https://wttr.in/?format=%25l",
                process: `if (!data || data.startsWith('<') || data.includes('ERROR')) return 'Non trouvé'; return data;`
            }
        ]
    },
    {
        id: "weather-widget-big",
        name: "Météo (Grand)",
        gridW: 5, gridH: 4,
        ui: {
            type: 'box', vertical: true, style_class: 'prism-widget-df-meteo-box',
            children: [
                { type: 'label', text: '☁️ Météo', style: 'font-size: 16px; font-weight: bold; color: white; margin-bottom: 8px;' },
                { type: 'label', id: 'weather-data', text: '-- °C', style: 'font-size: 26px; font-weight: bold; color: #086b0c; margin-bottom: 10px;' },
                
                { type: 'label', id: 'weather-loc', text: 'Recherche GPS...', style: 'font-size: 11px; color: #888; font-family: monospace; margin-bottom: 12px;' },
                
                { 
                    type: 'box',
                    style: 'background-color: rgba(0, 0, 0, 0.2); border-radius: 6px; padding: 8px;',
                    children: [
                        { type: 'label', id: 'weather-forecast', text: 'Analyse...', style: 'font-size: 12px; color: #81D4FA; line-height: 1.6; font-family: monospace;' }
                    ]
                }
            ]
        },
        bindings: [
            {
                targetId: "weather-data", targetProp: "text", interval: 300,
                sourceType: "http", 
                source: "https://wttr.in/?format=%25c+%25t",
                process: `if (!data || data.startsWith('<') || data.includes('ERROR')) return 'Hors ligne'; return data;`
            },
            {
                targetId: "weather-loc", targetProp: "text", interval: 300,
                sourceType: "http", 
                source: "https://wttr.in/?format=%25l",
                process: `if (!data || data.startsWith('<') || data.includes('ERROR')) return 'GPS Inconnu'; return data;`
            },
            {
                targetId: "weather-forecast", targetProp: "text", interval: 300,
                sourceType: "http", 
                source: "https://wttr.in/?format=j1",
                process: `
                    if (!data || data.startsWith('<')) return 'Indisponible';
                    try {
                        let j = JSON.parse(data);
                        
                        // [0] = Aujourd'hui | [1] = Demain | [2] = J+2
                        let d1 = 'Auj. : ' + j.weather[0].mintempC + '° / ' + j.weather[0].maxtempC + '°';
                        let d2 = 'Dem. : ' + j.weather[1].mintempC + '° / ' + j.weather[1].maxtempC + '°';
                        
                        return d1 + '\n' + d2;
                    } catch(e) {
                        return 'Erreur JSON';
                    }
                `
            }
        ]
    },
    {
        id: "crypto-widget",
        name: "Crypto-monnaies",
        gridW: 4, gridH: 3,
        ui: {
            type: 'box', vertical: true, style_class: 'prism-widget-box',
            children: [
                { type: 'label', text: 'Crypto (EUR)', style: 'font-size: 16px; font-weight: bold; color: white; margin-bottom: 15px;' },
                // Police monospace pour que les chiffres soient bien alignés
                { type: 'label', id: 'btc-price', text: 'BTC : Chargement...', style: 'font-size: 16px; font-weight: bold; color: #ffffff; font-family: monospace; margin-bottom: 4px;' },
                { type: 'label', id: 'eth-price', text: 'ETH : Chargement...', style: 'font-size: 16px; font-weight: bold; color: #ffffff; font-family: monospace;' }
            ]
        },
        bindings: [
            {
                // Intervalle court : 60 secondes
                targetId: "btc-price", targetProp: "text", interval: 60,
                sourceType: "http", 
                source: "https://api.binance.com/api/v3/ticker/price?symbol=BTCEUR",
                process: `
                    try { 
                        let j = JSON.parse(data);
                        // parseFloat convertit le texte en nombre, toFixed(2) force l'affichage à 2 décimales
                        return 'BTC : ' + parseFloat(j.price).toFixed(2) + ' €'; 
                    } catch(e) { return 'BTC : Erreur API'; }
                `
            },
            {
                targetId: "eth-price", targetProp: "text", interval: 60,
                sourceType: "http", 
                source: "https://api.binance.com/api/v3/ticker/price?symbol=ETHEUR",
                process: `
                    try { 
                        let j = JSON.parse(data);
                        return 'ETH : ' + parseFloat(j.price).toFixed(2) + ' €'; 
                    } catch(e) { return 'ETH : Erreur API'; }
                `
            }
        ]
    },
    {
        id: "forex-widget",
        name: "Devises",
        gridW: 4, gridH: 3,
        ui: {
            type: 'box', vertical: true, style_class: 'prism-widget-box',
            children: [
                { type: 'label', text: 'Taux de change', style: 'font-size: 16px; font-weight: bold; color: white; margin-bottom: 15px;' },
                { type: 'label', id: 'eur-usd', text: '1 € = --- $', style: 'font-size: 16px; font-weight: bold; color: #ffffff; font-family: monospace; margin-bottom: 4px;' },
                { type: 'label', id: 'eur-chf', text: '1 € = --- CHF', style: 'font-size: 16px; font-weight: bold; color: #ffffff; font-family: monospace;' }
            ]
        },
        bindings: [
            {
                // Les monnaies bougent lentement, on actualise toutes les heures (3600 secondes)
                targetId: "eur-usd", targetProp: "text", interval: 3600,
                sourceType: "http", 
                source: "https://api.exchangerate-api.com/v4/latest/EUR",
                process: `
                    try { 
                        let j = JSON.parse(data);
                        return '1 € = ' + j.rates.USD.toFixed(3) + ' $'; 
                    } catch(e) { return 'Erreur réseau'; }
                `
            },
            {
                targetId: "eur-chf", targetProp: "text", interval: 3600,
                sourceType: "http", 
                source: "https://api.exchangerate-api.com/v4/latest/EUR",
                process: `
                    try { 
                        let j = JSON.parse(data);
                        return '1 € = ' + j.rates.CHF.toFixed(3) + ' CHF'; 
                    } catch(e) { return 'Erreur réseau'; }
                `
            }
        ]
    },
    {
        id: "net-monitor",
        name: "Réseau & IP",
        gridW: 4, gridH: 3,
        ui: {
            type: 'box', vertical: true, style_class: 'prism-widget-box',
            children: [
                { type: 'label', text: 'État du Réseau', style: 'font-size: 16px; font-weight: bold; color: white; margin-bottom: 8px;' },
                { type: 'label', id: 'public-ip', text: 'IP : Recherche...', style: 'font-weight: bold; font-size: 14px; color: #4DD0E1; font-family: monospace; margin-bottom: 5px;' },
                { type: 'label', id: 'net-status', text: 'Ping: ---', style: 'font-size: 14px; color: #ffffff; font-family: monospace;' }
            ]
        },
        bindings: [
            {
                // Vérifie l'IP publique toutes les 5 minutes
                targetId: "public-ip", targetProp: "text", interval: 300,
                sourceType: "http", 
                source: "https://api.ipify.org?format=json",
                process: `
                    try { 
                        return 'IP : ' + JSON.parse(data).ip; 
                    } catch(e) { return 'IP : Hors ligne'; }
                `
            }
        ]
    },
    {
        id: "cpu-temp-widget",
        name: "Température CPU",
        gridW: 3, gridH: 3,
        ui: {
            type: 'box', vertical: true, style_class: 'prism-widget-box',
            children: [
                { type: 'label', text: 'Système', style: 'font-size: 16px; font-weight: bold; color: white; margin-bottom: 8px;' },
                { type: 'label', id: 'temp-text', text: 'Calcul...', style: 'font-size: 32px; font-weight: bold; color: #ff9800;' },
                { type: 'label', id: 'temp-status', text: 'Mise à jour...', style: 'font-size: 12px; color: #ffffff;' }
            ]
        },
        bindings: [
            {
                targetId: "temp-text", targetProp: "text", interval: 5,
                sourceType: "file", source: "/sys/class/thermal/thermal_zone0/temp",
                process: `
                    try {
                        let tempC = (parseInt(data) / 1000).toFixed(1);
                        return tempC + ' °C';
                    } catch(e) { return 'Erreur'; }
                `
            },
            {
                targetId: "temp-status", targetProp: "text", interval: 5,
                sourceType: "file", source: "/sys/class/thermal/thermal_zone0/temp",
                process: `
                    try {
                        let t = parseInt(data) / 1000;
                        if (t >= 75) return 'Surchauffe !';
                        if (t >= 60) return 'Chaud';
                        return 'Normal';
                    } catch(e) { return '--'; }
                `
            },
            {
                targetId: "temp-text", targetProp: "style", interval: 5,
                sourceType: "file", source: "/sys/class/thermal/thermal_zone0/temp",
                process: `
                    try {
                        let t = parseInt(data) / 1000;
                        if (t >= 75) return 'font-size: 32px; font-weight: bold; color: #ff5555;'; // Rouge
                        if (t >= 60) return 'font-size: 32px; font-weight: bold; color: #ffaa00;'; // Orange
                        return 'font-size: 32px; font-weight: bold; color: #4CAF50;'; // Vert
                    } catch(e) { return 'font-size: 32px; font-weight: bold; color: #aaa;'; }
                `
            }
        ]
    },
];


var PrismWidgets = class PrismWidgets {
    constructor() {
        const monitor = Main.layoutManager.primaryMonitor || global.screen.get_primary_monitor();
        this.desktopContainer = new St.Widget({
            name: 'prism-desktop-widgets', layout_manager: new Clutter.FixedLayout(),
            x_expand: true, y_expand: true, reactive: false
        });
        this.desktopContainer.set_size(monitor.width, monitor.height);
        this.desktopContainer.set_position(monitor.x, monitor.y);

        Main.layoutManager._backgroundGroup.add_child(this.desktopContainer);
        
        this._widgets = []; 
        this._menuOpen = false;

        this._saveFile = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_config_dir(), 'prism-widgets-layout.json']));

        this._setupLongPress();
        this._buildWidgetMenu();
        this._loadLayout();
    }

    _snap(value) { return Math.round(value / GRID_SIZE) * GRID_SIZE; }

    _saveLayout() {
        let layout = [];
        for (let w of this._widgets) {
            if (w && w.get_parent() && w._prismType) {
                let item = { type: w._prismType, x: w.x, y: w.y };
                if (w._prismType === 'shortcut-widget' && w._shortcutAppId) item.appId = w._shortcutAppId;
                layout.push(item);
            }
        }
        try {
            this._saveFile.replace_contents(JSON.stringify(layout), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (e) {}
    }

    _loadLayout() {
        try {
            if (!this._saveFile.query_exists(null)) return;
            let [ok, contents] = this._saveFile.load_contents(null);
            if (ok) {
                let layout = JSON.parse(new TextDecoder("utf-8").decode(contents));
                for (let item of layout) {
                    let manifest = BUILTIN_WIDGETS.find(w => w.id === item.type);
                    if (manifest) {
                        let newWidget = this._buildWidgetFromManifest(manifest, item.appId);
                        newWidget.set_position(item.x, item.y);
                        this.desktopContainer.add_child(newWidget);
                        this._widgets.push(newWidget);
                        this._makeWidgetInteractive(newWidget);
                    }
                }
            }
        } catch (e) {}
    }

    _isEventInsideAnyWidget(event) {
        let source = event.get_source();
        if (!source) return false;

        for (let widget of this._widgets) {
            if (!widget) continue;
            let actor = source;
            while (actor) {
                if (actor === widget) return true;
                actor = actor.get_parent();
            }
        }

        return false;
    }

    _isEventInsideEditControls(event) {
        let source = event.get_source();
        if (!source) return false;

        for (let widget of this._widgets) {
            if (!widget) continue;

            for (let control of [widget._deleteBtn, widget._editBtn]) {
                if (!control) continue;
                let actor = source;
                while (actor) {
                    if (actor === control) return true;
                    actor = actor.get_parent();
                }
            }
        }

        return false;
    }

    _setupLongPress() {
        global.stage.connect('captured-event', (stage, event) => {
            let type = event.type();
            let editingActive = this._widgets.some(w => w && w._isEditing);

            if (this._draggingWidget) return Clutter.EVENT_PROPAGATE;

            if ((type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN) && editingActive && !this._isEventInsideAnyWidget(event) && !this._isEventInsideEditControls(event)) {
                this._disableAllEditModes();
            }

            return Clutter.EVENT_PROPAGATE;
        });
    }

    _buildWidgetMenu() {
        // 1. On crée un gestionnaire de grille (FlowLayout)
        let flowLayout = new Clutter.FlowLayout({ 
            orientation: Clutter.FlowOrientation.HORIZONTAL,
            column_spacing: 15, // Espace horizontal entre les boutons
            row_spacing: 15     // Espace vertical entre les lignes
        });

        // 2. On l'applique à un St.Widget générique (au lieu d'un BoxLayout)
        this.menuContainer = new St.Widget({
            name: 'prism-widget-menu', 
            style_class: 'prism-widget-menu',
            layout_manager: flowLayout,
            reactive: true
        });

        // 3. On ajoute les boutons comme avant
        for (let manifest of BUILTIN_WIDGETS) {
            let btn = this._createDraggableMenuItem(manifest.name, manifest, () => this._buildWidgetFromManifest(manifest));
            this.menuContainer.add_child(btn);
        }
        
        Main.layoutManager.addChrome(this.menuContainer);
        this.menuContainer.hide();
        this.menuContainer.opacity = 0;
    }

    _toggleWidgetMenu() {
        this._menuOpen = !this._menuOpen;
        if (this._menuOpen) {
            let monitor = Main.layoutManager.primaryMonitor;
            
            // 1. On limite la largeur maximale du menu à 80% de l'écran
            // C'est ce qui force les éléments à passer à la ligne !
            let maxWidth = monitor.width * 0.8;
            this.menuContainer.set_width(maxWidth);

            // 2. Magie de GNOME : On lui demande "Avec cette largeur, quelle hauteur te faut-il ?"
            let [minHeight, natHeight] = this.menuContainer.get_preferred_height(maxWidth);
            this.menuContainer.set_height(natHeight);

            // 3. On centre le menu en bas, en prenant en compte sa nouvelle hauteur dynamique
            this.menuContainer.set_position(
                (monitor.width - maxWidth) / 2, 
                monitor.height - natHeight - 100 // 100px de marge avec le bas de l'écran
            );

            this.menuContainer.show();
            this.menuContainer.ease({ opacity: 255, duration: 250, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
        } else {
            this.menuContainer.ease({ 
                opacity: 0, 
                duration: 200, 
                mode: Clutter.AnimationMode.EASE_IN_QUAD, 
                onComplete: () => this.menuContainer.hide() 
            });
        }
    }

    _buildUIFromSchema(schema, refs) {
        let widget;
        if (schema.type === 'box') widget = new St.BoxLayout({ vertical: schema.vertical || false, style_class: schema.style_class || '', style: schema.style || '' });
        else if (schema.type === 'label') widget = new St.Label({ text: schema.text || '', style_class: schema.style_class || '', style: schema.style || '' });
        else if (schema.type === 'icon') widget = new St.Icon({
            icon_name: schema.icon_name || 'application-x-executable',
            gicon: schema.gicon || null,
            icon_size: schema.icon_size || 24,
            style_class: schema.style_class || '',
            style: schema.style || ''
        });
        else if (schema.type === 'progress') widget = new St.Widget({ style_class: schema.style_class || '', style: schema.style || '' });

        if (!widget) return null;
        if (schema.id && refs) refs[schema.id] = widget;
        if (schema.children) for (let childSchema of schema.children) {
            let child = this._buildUIFromSchema(childSchema, refs);
            if (child) widget.add_child(child);
        }
        return widget;
    }

    _buildWidgetFromManifest(manifest, presetAppId = null) {
        let refs = {}; 
        let box = this._buildUIFromSchema(manifest.ui, refs);
        
        box.width = (manifest.gridW || 4) * GRID_SIZE;
        box.height = (manifest.gridH || 3) * GRID_SIZE;
        box._timerIds = [];
        box._prismType = manifest.id;

        const setupShortcutBinding = () => {
            if (box._shortcutBindingReady) return;
            box._shortcutBindingReady = true;
            box._shortcutAppId = null;

            if (refs['shortcut-icon']) {
                refs['shortcut-icon'].set_icon_size(32);
                refs['shortcut-icon'].x_expand = true;
                refs['shortcut-icon'].y_expand = true;
                refs['shortcut-icon'].set_x_align(Clutter.ActorAlign.CENTER);
                refs['shortcut-icon'].set_y_align(Clutter.ActorAlign.CENTER);
            }

            if (refs['shortcut-label']) {
                refs['shortcut-label'].x_expand = true;
                refs['shortcut-label'].y_expand = true;
                refs['shortcut-label'].set_width(Math.max(0, box.width - 12));
                refs['shortcut-label'].set_x_align(Clutter.ActorAlign.CENTER);
                refs['shortcut-label'].set_y_align(Clutter.ActorAlign.CENTER);
                if (refs['shortcut-label'].clutter_text) {
                    refs['shortcut-label'].clutter_text.set_line_wrap(true);
                    refs['shortcut-label'].clutter_text.set_ellipsize(0);
                }
            }

            const applyShortcut = (appInfo) => {
                if (!appInfo || !refs['shortcut-icon'] || !refs['shortcut-label']) return;
                box._shortcutAppId = appInfo.get_id();
                refs['shortcut-icon'].set_gicon(appInfo.get_icon());
                refs['shortcut-label'].set_text(appInfo.get_name());
                refs['shortcut-label'].x_expand = true;
                refs['shortcut-label'].y_expand = true;
                refs['shortcut-label'].set_width(Math.max(0, box.width - 12));
                refs['shortcut-label'].set_x_align(Clutter.ActorAlign.CENTER);
                refs['shortcut-label'].set_y_align(Clutter.ActorAlign.CENTER);
                if (refs['shortcut-label'].clutter_text) {
                    refs['shortcut-label'].clutter_text.set_line_wrap(true);
                    refs['shortcut-label'].clutter_text.set_ellipsize(0);
                }
            };

            let appInfo = null;
            if (presetAppId) appInfo = Gio.DesktopAppInfo.new(presetAppId);
            if (appInfo) applyShortcut(appInfo);

            if (!box._shortcutAppId) {
                refs['shortcut-icon'].set_icon_name('application-x-executable');
                refs['shortcut-label'].set_text('Choisir');
                refs['shortcut-label'].x_expand = true;
                refs['shortcut-label'].y_expand = true;
                refs['shortcut-label'].set_width(Math.max(0, box.width - 12));
                refs['shortcut-label'].set_x_align(Clutter.ActorAlign.CENTER);
                refs['shortcut-label'].set_y_align(Clutter.ActorAlign.CENTER);
                if (refs['shortcut-label'].clutter_text) {
                    refs['shortcut-label'].clutter_text.set_line_wrap(true);
                    refs['shortcut-label'].clutter_text.set_ellipsize(0);
                }
            }

            box.reactive = true;
            box._applyShortcut = applyShortcut;
        };

        if (manifest.bindings) {
            for (let bind of manifest.bindings) {
                if (bind.sourceType === 'shortcut') {
                    setupShortcutBinding();
                    continue;
                }

                const updateData = () => {
                    try {
                        if (bind.sourceType === 'file') {
                            let [ok, contents] = GLib.file_get_contents(bind.source);
                            if (ok) {
                                let rawData = new TextDecoder("utf-8").decode(contents).trim();
                                if (rawData) {
                                    let processor = new Function('data', bind.process);
                                    let finalValue = processor(rawData);
                                    if (refs[bind.targetId]) {
                                        if (bind.targetProp === 'text') refs[bind.targetId].set_text(finalValue);
                                        else if (bind.targetProp === 'style') refs[bind.targetId].set_style(finalValue);
                                    }
                                }
                            }
                        } 
                        
                        else if (bind.sourceType === 'cmd') {
                            let proc = Gio.Subprocess.new(
                                ['/bin/sh', '-c', bind.source], 
                                Gio.SubprocessFlags.STDOUT_PIPE
                            );

                            proc.communicate_utf8_async(null, null, (obj, res) => {
                                try {
                                    let [ok, stdout, stderr] = obj.communicate_utf8_finish(res);
                                    
                                    let rawData = stdout ? stdout.trim() : "";
                                    
                                    let processor = new Function('data', bind.process);
                                    let finalValue = processor(rawData);

                                    if (refs[bind.targetId]) {
                                        if (bind.targetProp === 'text') refs[bind.targetId].set_text(finalValue);
                                        else if (bind.targetProp === 'style') refs[bind.targetId].set_style(finalValue);
                                    }
                                } catch (e) {
                                    if (refs[bind.targetId] && bind.targetProp === 'text') {
                                        refs[bind.targetId].set_text("Erreur ⚠️");
                                    }
                                }
                            });
                        }

                        else if (bind.sourceType === 'http') {
                            try {
                                let isSoup3 = Soup.MAJOR_VERSION === 3;
                                let session = isSoup3 
                                    ? new Soup.Session({ user_agent: "curl/7.81.0" }) 
                                    : new Soup.SessionAsync({ user_agent: "curl/7.81.0" });

                                let message = Soup.Message.new('GET', bind.source);

                                const applyData = (rawData) => {
                                    if (rawData) {
                                        let processor = new Function('data', bind.process);
                                        let finalValue = processor(rawData.toString().trim());
                                        if (refs[bind.targetId]) {
                                            if (bind.targetProp === 'text') refs[bind.targetId].set_text(finalValue);
                                            else if (bind.targetProp === 'style') refs[bind.targetId].set_style(finalValue);
                                        }
                                    }
                                };

                                const showError = (errStr) => {
                                    if (refs[bind.targetId] && bind.targetProp === 'text') refs[bind.targetId].set_text(errStr);
                                };

                                if (isSoup3) {
                                    session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (sess, res) => {
                                        try {
                                            let bytes = sess.send_and_read_finish(res);
                                            let data = new TextDecoder("utf-8").decode(bytes.toArray());
                                            applyData(data);
                                        } catch (e) { showError("Err: Réseau"); }
                                    });
                                } else {
                                    session.queue_message(message, (sess, msg) => {
                                        try {
                                            if (msg.status_code === 200) applyData(msg.response_body.data);
                                            else showError("Err: " + msg.status_code);
                                        } catch (e) { showError("Err: Réseau"); }
                                    });
                                }
                            } catch (e) {
                                if (refs[bind.targetId] && bind.targetProp === 'text') {
                                    let shortError = e.message ? e.message.substring(0, 15) : "Crash";
                                    refs[bind.targetId].set_text("Err: " + shortError);
                                }
                            }
                        }
                    } catch (e) {
                    }
                    
                    return GLib.SOURCE_CONTINUE;
                };

                let tId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, bind.interval, updateData);
                box._timerIds.push(tId);
                updateData(); 
            }
        }

        box.connect('destroy', () => { for (let id of box._timerIds) if (id) GLib.Source.remove(id); });
        return box;
    }

    _createDraggableMenuItem(label, manifest, widgetCreatorFn) {
        let btn = new St.Button({ label: label, style_class: 'prism-widget-menu-btn', reactive: true });
        
        let dragActor = null, stageEventId = 0;
        
        let wWidth = (manifest.gridW || 4) * GRID_SIZE;
        let wHeight = (manifest.gridH || 3) * GRID_SIZE;
        let ghostX = 0, ghostY = 0;

        const updateGhostPosition = (x, y) => {
            ghostX = this._snap(x - (wWidth / 2)); 
            ghostY = this._snap(y - (wHeight / 2));
            if (dragActor) dragActor.set_position(ghostX, ghostY);
        };

        const startDrag = (x, y) => {
            dragActor = new St.BoxLayout({ style_class: 'prism-widget-ghost-box', width: wWidth, height: wHeight });
            dragActor.add_child(new St.Label({ text: label, style: 'color: white; font-weight: bold; font-size: 18px;', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, x_expand: true, y_expand: true }));
            Main.uiGroup.add_child(dragActor);
            
            updateGhostPosition(x, y);

            stageEventId = global.stage.connect('captured-event', (stage, event) => {
                let type = event.type();
                let [cx, cy] = event.get_coords();

                if (type === Clutter.EventType.MOTION || type === Clutter.EventType.TOUCH_UPDATE) {
                    updateGhostPosition(cx, cy);
                    return Clutter.EVENT_STOP;
                } 

                else if (type === Clutter.EventType.BUTTON_RELEASE || type === Clutter.EventType.TOUCH_END) {
                    endDrag();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
        };

        const endDrag = () => {
            if (stageEventId) { 
                global.stage.disconnect(stageEventId); 
                stageEventId = 0; 
            }

            if (dragActor) { dragActor.destroy(); dragActor = null; }
            this._toggleWidgetMenu();

            let newWidget = widgetCreatorFn();
            newWidget.set_position(ghostX, ghostY);
            this.desktopContainer.add_child(newWidget);
            this._widgets.push(newWidget);
            this._makeWidgetInteractive(newWidget);

            if (newWidget._prismType === 'shortcut-widget' && !newWidget._shortcutAppId) {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                    this._openShortcutAppPicker(newWidget);
                    return GLib.SOURCE_REMOVE;
                });
            }

            this._saveLayout();
        };

        btn.connect('button-press-event', (actor, event) => { 
            if (event.get_button() === 1) startDrag(...event.get_coords()); 
            return Clutter.EVENT_PROPAGATE; 
        });
        
        btn.connect('touch-event', (actor, event) => { 
            if (event.type() === Clutter.EventType.TOUCH_BEGIN) startDrag(...event.get_coords()); 
            return Clutter.EVENT_PROPAGATE; 
        });

        return btn;
    }

    _makeWidgetInteractive(widget) {
        widget.set_reactive(true);
        widget._isDragging = false;
        widget._dragListenerId = 0;
        let pressTimer = null, isPressing = false, startX = 0, startY = 0, pressStartTime = 0;

        const startPress = (x, y) => {
            if (isPressing || widget._isEditing) return;
            isPressing = true; startX = x; startY = y; pressStartTime = Date.now();

            pressTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, WIDGET_EDIT_TIME, () => {
                if (isPressing) {
                    this._enableEditMode(widget);
                    pressTimer = null;
                    isPressing = false;
                }
                return GLib.SOURCE_REMOVE;
            });
        };

        const cancelPress = () => {
            isPressing = false;
            if (pressTimer) {
                GLib.Source.remove(pressTimer);
                pressTimer = null;
            }
        };

        const handleMotion = (x, y) => {
            if (isPressing && (Math.abs(x - startX) > 10 || Math.abs(y - startY) > 10)) {
                cancelPress();
            }
        };

        const handleQuickAction = () => {
            if (!isPressing) return;
            let elapsed = Date.now() - pressStartTime;
            if (elapsed < WIDGET_EDIT_TIME) {
                if (widget._prismType === 'shortcut-widget') {
                    if (!widget._shortcutAppId) {
                        this._openShortcutAppPicker(widget);
                    } else {
                        let appInfo = Gio.DesktopAppInfo.new(widget._shortcutAppId);
                        if (appInfo) {
                            try { appInfo.launch([], null); } catch (e) {}
                        }
                    }
                }
            }
            cancelPress();
        };

        widget.connect('button-press-event', (a, e) => {
            if (e.get_button() === 1) {
                let [x, y] = e.get_coords();

                if (widget._isEditing) {
                    this._startWidgetDrag(widget, x, y);
                    return Clutter.EVENT_STOP;
                }
                startPress(x, y);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        widget.connect('motion-event', (a, e) => {
            handleMotion(...e.get_coords());
            return Clutter.EVENT_PROPAGATE;
        });

        widget.connect('button-release-event', () => {
            handleQuickAction();
            return Clutter.EVENT_PROPAGATE;
        });

        widget.connect('leave-event', () => {
            cancelPress();
            return Clutter.EVENT_PROPAGATE;
        });

        widget.connect('touch-event', (a, e) => {
            let type = e.type();
            let [x, y] = e.get_coords();

            if (type === Clutter.EventType.TOUCH_BEGIN) {
                if (widget._isEditing) {
                    this._startWidgetDrag(widget, x, y);
                    return Clutter.EVENT_STOP;
                }
                startPress(x, y);
                return Clutter.EVENT_STOP;
            }
            else if (type === Clutter.EventType.TOUCH_UPDATE) {
                if (widget._isDragging) return Clutter.EVENT_STOP;
                handleMotion(x, y);
            }
            else if (type === Clutter.EventType.TOUCH_END || type === Clutter.EventType.TOUCH_CANCEL) {
                if (widget._isDragging) return Clutter.EVENT_STOP;
                handleQuickAction();
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _openShortcutAppPicker(widget) {
        let apps = Gio.AppInfo.get_all().filter(app => app.should_show()).sort((a, b) => a.get_name().localeCompare(b.get_name()));
        if (!apps.length) return;

        let popupWidth = 280;
        let popupHeight = 360;
        let perPage = 7;
        let pageIndex = 0;

        let outer = new St.BoxLayout({
            vertical: true,
            reactive: true,
            style: 'background: rgba(16, 18, 24, 0.96); border-radius: 12px; padding: 8px; spacing: 8px;'
        });
        outer.set_size(popupWidth, popupHeight);

        let title = new St.Label({
            text: 'Choisir un logiciel',
            style: 'color: white; font-weight: bold; margin: 4px 6px;'
        });
        title.set_size(popupWidth - 20, 18);
        outer.add_child(title);

        let pageInfo = new St.Label({
            text: 'Page 1',
            style: 'color: #dfe7ff; text-align: center; margin: 0 6px;'
        });
        pageInfo.set_size(popupWidth - 20, 18);

        let nav = new St.BoxLayout({
            style: 'spacing: 8px; horizontal-align: center;'
        });
        nav.set_size(popupWidth - 20, 30);

        let prevBtn = new St.Button({ label: '<', reactive: true, style: 'padding: 4px 10px; border-radius: 8px; background: rgba(255,255,255,0.06); color: white;' });
        prevBtn.set_size(42, 24);
        prevBtn.x_expand = false;
        prevBtn.y_expand = false;

        let nextBtn = new St.Button({ label: '>', reactive: true, style: 'padding: 4px 10px; border-radius: 8px; background: rgba(255,255,255,0.06); color: white;' });
        nextBtn.set_size(42, 24);
        nextBtn.x_expand = false;
        nextBtn.y_expand = false;

        pageInfo.set_size(90, 18);
        pageInfo.x_expand = false;
        pageInfo.y_expand = false;

        nav.add_child(prevBtn);
        nav.add_child(pageInfo);
        nav.add_child(nextBtn);
        outer.add_child(nav);

        let list = new St.BoxLayout({ vertical: true, style: 'spacing: 6px;' });
        list.set_size(popupWidth - 24, popupHeight - 90);
        outer.add_child(list);

        const renderPage = () => {
            let totalPages = Math.max(1, Math.ceil(apps.length / perPage));
            let safeIndex = Math.min(pageIndex, totalPages - 1);
            pageIndex = safeIndex;

            pageInfo.set_text('Page ' + (pageIndex + 1) + ' / ' + totalPages);
            prevBtn.reactive = pageIndex > 0;
            nextBtn.reactive = pageIndex < totalPages - 1;

            for (let child of list.get_children()) {
                child.destroy();
            }

            let start = pageIndex * perPage;
            let end = Math.min(start + perPage, apps.length);

            for (let i = start; i < end; i++) {
                let app = apps[i];
                let row = new St.Button({
                    reactive: true,
                    style: 'padding: 6px 8px; border-radius: 8px; background: rgba(255,255,255,0.04);'
                });
                row.set_size(popupWidth - 28, 32);

                let content = new St.BoxLayout({ style: 'spacing: 8px; vertical-align: middle;' });
                content.set_size(popupWidth - 40, 24);

                let icon = new St.Icon({ gicon: app.get_icon(), icon_size: 18 });
                let label = new St.Label({ text: app.get_name(), style: 'color: white;' });
                if (label.clutter_text) label.clutter_text.set_line_wrap(false);

                content.add_child(icon);
                content.add_child(label);
                row.set_child(content);

                row.connect('button-press-event', () => {
                    if (widget && widget._applyShortcut) widget._applyShortcut(app);
                    this._saveLayout();
                    if (outer && outer.get_parent()) outer.destroy();
                    return Clutter.EVENT_STOP;
                });

                list.add_child(row);
            }
        };

        prevBtn.connect('button-press-event', (actor, event) => {
            if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
            if (pageIndex > 0) {
                pageIndex -= 1;
                renderPage();
            }
            return Clutter.EVENT_STOP;
        });

        nextBtn.connect('button-press-event', (actor, event) => {
            if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
            let totalPages = Math.max(1, Math.ceil(apps.length / perPage));
            if (pageIndex < totalPages - 1) {
                pageIndex += 1;
                renderPage();
            }
            return Clutter.EVENT_STOP;
        });

        renderPage();
        Main.uiGroup.add_child(outer);

        let monitor = Main.layoutManager.primaryMonitor || global.screen.get_primary_monitor();
        let x = monitor.x + Math.max(0, (monitor.width - popupWidth) / 2);
        let y = monitor.y + Math.max(0, (monitor.height - popupHeight) / 2);
        outer.set_position(x, y);
        outer.show();
    }

    _enableEditMode(widget) {
        if (widget._isEditing) return;
        widget._isEditing = true;
        widget.add_style_class_name('prism-widget-editing');

        let deleteBtn = new St.Button({ label: '✕', style_class: 'prism-widget-delete-btn', reactive: true });
        this.desktopContainer.add_child(deleteBtn);
        deleteBtn.set_position(widget.x - 10, widget.y - 10);
        widget._deleteBtn = deleteBtn;

        let editBtn = null;
        if (widget._prismType === 'shortcut-widget') {
            editBtn = new St.Button({ label: '⋯', style_class: 'prism-widget-delete-btn', reactive: true });
            this.desktopContainer.add_child(editBtn);
            editBtn.set_position(widget.x + widget.width - 8, widget.y - 10);
            widget._editBtn = editBtn;

            editBtn.connect('button-press-event', (a, e) => {
                if (e.get_button() === 1) {
                    this._openShortcutAppPicker(widget);
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
        }

        const closeAction = () => {
            try {
                if (widget && widget.get_parent()) widget.get_parent().remove_child(widget);
                if (deleteBtn && deleteBtn.get_parent()) deleteBtn.get_parent().remove_child(deleteBtn);
                if (editBtn && editBtn.get_parent()) editBtn.get_parent().remove_child(editBtn);

                if (widget) {
                    widget._isEditing = false;
                    widget.remove_style_class_name('prism-widget-editing');
                    widget.destroy();
                }
                if (deleteBtn) deleteBtn.destroy();
                if (editBtn) editBtn.destroy();
            } catch (e) {
            }

            this._widgets = this._widgets.filter(w => w !== widget);
            this._saveLayout();
            return Clutter.EVENT_STOP;
        };

        deleteBtn.connect('button-press-event', (a, e) => {
            if (e.get_button() === 1) return closeAction();
            return Clutter.EVENT_PROPAGATE;
        });
        deleteBtn.connect('touch-event', (a, e) => {
            if (e.type() === Clutter.EventType.TOUCH_BEGIN) return closeAction();
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _disableAllEditModes() {
        for (let widget of this._widgets) {
            if (widget && widget._isEditing) {
                widget._isDragging = false;
                if (widget._dragListenerId) {
                    global.stage.disconnect(widget._dragListenerId);
                    widget._dragListenerId = 0;
                }
                widget._isEditing = false; widget.remove_style_class_name('prism-widget-editing');
                if (widget._deleteBtn && widget._deleteBtn.get_parent()) widget._deleteBtn.get_parent().remove_child(widget._deleteBtn);
                if (widget._editBtn && widget._editBtn.get_parent()) widget._editBtn.get_parent().remove_child(widget._editBtn);
                if (widget._deleteBtn) { widget._deleteBtn.destroy(); widget._deleteBtn = null; }
                if (widget._editBtn) { widget._editBtn.destroy(); widget._editBtn = null; }
            }
        }
        this._widgets = this._widgets.filter(w => w !== null && w.get_parent() !== null);
    }

    _startWidgetDrag(widget, startX, startY) {
        if (widget._isDragging || this._draggingWidget === widget) return;

        widget._isDragging = true;
        this._draggingWidget = widget;
        widget._dragOffsetX = startX - widget.x;
        widget._dragOffsetY = startY - widget.y;

        const endDrag = () => {
            if (widget._dragListenerId) {
                global.stage.disconnect(widget._dragListenerId);
                widget._dragListenerId = 0;
            }
            widget._isDragging = false;
            if (this._draggingWidget === widget) this._draggingWidget = null;
            if (widget._deleteBtn) widget._deleteBtn.set_position(widget.x - 10, widget.y - 10);
            if (widget._editBtn) widget._editBtn.set_position(widget.x + widget.width - 8, widget.y - 10);
            this._saveLayout();
        };

        const updatePosition = (x, y) => {
            let snappedX = this._snap(x - widget._dragOffsetX);
            let snappedY = this._snap(y - widget._dragOffsetY);
            widget.set_position(snappedX, snappedY);
            if (widget._deleteBtn) widget._deleteBtn.set_position(snappedX - 10, snappedY - 10);
            if (widget._editBtn) widget._editBtn.set_position(snappedX + widget.width - 8, snappedY - 10);
        };

        widget._dragListenerId = global.stage.connect('captured-event', (stage, event) => {
            let type = event.type();
            let [cx, cy] = event.get_coords();

            if (type === Clutter.EventType.MOTION || type === Clutter.EventType.TOUCH_UPDATE) {
                if (widget._isDragging) {
                    updatePosition(cx, cy);
                    return Clutter.EVENT_STOP;
                }
            } else if (type === Clutter.EventType.BUTTON_RELEASE || type === Clutter.EventType.TOUCH_END || type === Clutter.EventType.BUTTON_RELEASE) {
                if (widget._isDragging) {
                    endDrag();
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    destroy() {
        this._disableAllEditModes();
        if (this.desktopContainer) { this.desktopContainer.destroy(); this.desktopContainer = null; }
        if (this.menuContainer) { this.menuContainer.destroy(); this.menuContainer = null; }
    }
};