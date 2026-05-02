/* */
/* Copyright (c) Project PRISM. All rights reserved.        */
/* This software is licensed under the CC BY-NC           */
/* Full text of the license can be found at              */
/* https://creativecommons.org/licenses/by-nc/4.0/legalcode.en  */
/* */

const { St, GObject, Gio, Clutter, GLib } = imports.gi;
const Main = imports.ui.main;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const SEARCH_TYPE = {
    ALL: 'all',
    APP: 'app',
    SETTING: 'setting',
    FILE: 'file',
    FOLDER: 'folder',
    WEB: 'web'
};

// --- ALGORITHME DE LEVENSHTEIN ---
function getLevenshteinDistance(a, b) {
    if (!a || !b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    let matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) matrix[i][j] = matrix[i - 1][j - 1];
            else matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
        }
    }
    return matrix[b.length][a.length];
}

var LocalSearchEngine = class {
    _calculateScore(query, target) {
        let distance = getLevenshteinDistance(query.toLowerCase(), target.toLowerCase());
        let maxLength = Math.max(query.length, target.length);
        let score = 1 - (distance / maxLength);
        if (target.toLowerCase().startsWith(query.toLowerCase())) score += 0.5;
        return score;
    }

    _searchDirectoryRecursively(dirFile, lowerQuery, localResults) {
        return new Promise((resolve) => {
            if (!dirFile.query_exists(null)) return resolve();
            
            const MAX_DEPTH = 4; 
            let stack = [{ file: dirFile, depth: 0 }];
            let activeScans = 0;
            
            const processNext = () => {
                if (stack.length === 0 && activeScans === 0) return resolve();
                
                let launchedScan = false;
                
                while (stack.length > 0 && activeScans < 3) { 
                    let { file: currentDir, depth } = stack.pop();
                    if (depth >= MAX_DEPTH) continue; 
                    
                    activeScans++;
                    launchedScan = true;

                    currentDir.enumerate_children_async(
                        'standard::*',
                        Gio.FileQueryInfoFlags.NONE,
                        GLib.PRIORITY_DEFAULT,
                        null,
                        (dir, res) => {
                            activeScans--;
                            try {
                                let enumerator = currentDir.enumerate_children_finish(res);
                                let info;
                                while ((info = enumerator.next_file(null)) !== null) {
                                    let name = info.get_name();
                                    if (!name) continue;

                                    let fileType = info.get_file_type();
                                    let filePath = currentDir.get_path() + '/' + name;
                                    let lowerName = name.toLowerCase();
                                    
                                    if (lowerName.includes(lowerQuery)) {
                                        let isDir = fileType === Gio.FileType.DIRECTORY;
                                        let contentType = isDir ? null : Gio.content_type_guess(filePath, null)[0];
                                        
                                        let safeIcon = null;
                                        if (isDir) safeIcon = Gio.icon_new_for_string('folder-symbolic');
                                        else if (contentType) safeIcon = Gio.content_type_get_icon(contentType);
                                        if (!safeIcon) safeIcon = Gio.icon_new_for_string('text-x-generic');

                                        localResults.push({
                                            type: isDir ? SEARCH_TYPE.FOLDER : SEARCH_TYPE.FILE,
                                            name: name,
                                            path: filePath,
                                            icon: safeIcon,
                                            score: lowerName.startsWith(lowerQuery) ? 0.8 : 0.5
                                        });
                                    }

                                    if (fileType === Gio.FileType.DIRECTORY && name !== '.' && name !== '..') {
                                        stack.push({ file: Gio.File.new_for_path(filePath), depth: depth + 1 });
                                    }
                                }
                                enumerator.close(null);
                            } catch (e) {}

                            if (stack.length > 0 || activeScans > 0) processNext();
                            else resolve();
                        }
                    );
                }
                
                if (!launchedScan && activeScans === 0) resolve();
            };
            processNext();
        });
    }

    search(query) {
        if (!query || query.trim().length < 2) return Promise.resolve([]);
        let lowerQuery = query.toLowerCase();
        let localResults = []; 

        Gio.AppInfo.get_all().forEach(app => {
            if (app.should_show()) {
                let name = app.get_name();
                if (!name) return;
                
                let score = this._calculateScore(lowerQuery, name);
                if (name.toLowerCase().includes(lowerQuery) || score > 0.5) {
                    
                    let categories = app.get_categories() || "";
                    let appId = app.get_id() || "";
                    let isSetting = categories.toLowerCase().includes('settings') || appId.toLowerCase().includes('settings');

                    localResults.push({
                        type: isSetting ? SEARCH_TYPE.SETTING : SEARCH_TYPE.APP,
                        name: name,
                        icon: app.get_icon() || Gio.icon_new_for_string('application-x-executable'),
                        appInfo: app,
                        score: score + 0.5
                    });
                }
            }
        });

        const homeDirs = ['Documents', 'Bureau', 'Downloads', 'Téléchargements'];
        let fileSearchPromises = homeDirs.map(folder => 
            this._searchDirectoryRecursively(Gio.File.new_for_path(`${GLib.get_home_dir()}/${folder}`), lowerQuery, localResults)
        );
        
        return Promise.all(fileSearchPromises).then(() => {
            localResults.push({
                type: SEARCH_TYPE.WEB,
                name: `Rechercher "${query}" sur le Web`,
                icon: Gio.icon_new_for_string("system-search-symbolic"),
                score: 0.1,
                action: () => Gio.AppInfo.launch_default_for_uri(`https://www.google.com/search?q=${encodeURIComponent(query)}`, null)
            });

            return localResults.sort((a, b) => b.score - a.score);
        });
    }
};

var AppLauncher = GObject.registerClass(
    class AppLauncher extends GObject.Object {
        _init() {
            super._init();
            this._overlayBox = null;
            this._searchTimeout = null; 
            this._searchEngine = new LocalSearchEngine();
            this._currentFilter = SEARCH_TYPE.ALL;
            
            this._currentPage = 0;
            this._appsPerPage = 24; 
            this._allApps = [];
        }

        toggle() {
            if (this._overlayBox) {
                this.hide();
            } else {
                this.show();
            }
        }

        show() {
            if (this._overlayBox) return;

            let monitor = Main.layoutManager.primaryMonitor;
            if (!monitor) return;

            this._overlayBox = new Clutter.Actor({ 
                reactive: true, 
                width: monitor.width,
                height: monitor.height,
                x: monitor.x,
                y: monitor.y
            });

            this.bgClicker = new St.Button({
                reactive: true,
                width: monitor.width,
                height: monitor.height,
                style: 'background-color: transparent;'
            });
            this.bgClicker.connect('clicked', () => this.hide());
            this._overlayBox.add_child(this.bgClicker);

            // TAILLES MISES À JOUR (760 de hauteur pour respirer)
            let panelWidth = 900;
            let panelHeight = 760;
            let posX = monitor.x + Math.floor((monitor.width - panelWidth) / 2);
            let posY = monitor.y + Math.floor((monitor.height - panelHeight) / 2);

            this.mainPanel = new St.BoxLayout({
                style_class: 'prism-launcher-dialog', 
                vertical: true,
                reactive: true,
                width: panelWidth,
                height: panelHeight,
                x: posX,
                y: posY
            });

            let contentLayout = new St.BoxLayout({
                vertical: true,
                style_class: 'prism-launcher-content',
                x_expand: true,
                y_expand: true
            });

            // --- BARRE DE RECHERCHE ---
            let searchBox = new St.BoxLayout({ style_class: 'prism-launcher-search-box', vertical: false });
            let searchIcon = new St.Icon({ gicon: Gio.icon_new_for_string('system-search-symbolic'), icon_size: 24, style_class: 'prism-launcher-icon' });
            
            this.searchEntry = new St.Entry({ 
                hint_text: "Rechercher une application, un fichier...", 
                style_class: 'prism-launcher-entry', 
                can_focus: true
            });
            this.searchEntry.set_width(800);
            
            searchBox.add_child(searchIcon);
            searchBox.add_child(this.searchEntry);
            contentLayout.add_child(searchBox);

            // --- BARRE DES FILTRES ---
            this.filterBox = new St.BoxLayout({ style_class: 'prism-launcher-filters', vertical: false });
            
            const createBtn = (label, type) => {
                let btn = new St.Button({ 
                    label: label, 
                    style_class: `prism-filter-btn ${type === this._currentFilter ? 'selected' : ''}`, 
                    reactive: true 
                });
                btn.connect('clicked', () => {
                    this._currentFilter = type;
                    this.filterBox.get_children().forEach(c => c.remove_style_class_name('selected'));
                    btn.add_style_class_name('selected');
                    if (this.searchEntry.get_text().length > 0) {
                        this._triggerSearch(this.searchEntry.get_text());
                    }
                });
                this.filterBox.add_child(btn);
            };
            
            createBtn("Tout", SEARCH_TYPE.ALL);
            createBtn("Apps", SEARCH_TYPE.APP);
            createBtn("Paramètres", SEARCH_TYPE.SETTING);
            createBtn("Fichiers", SEARCH_TYPE.FILE);
            createBtn("Dossiers", SEARCH_TYPE.FOLDER);
            createBtn("Web", SEARCH_TYPE.WEB);
            
            contentLayout.add_child(this.filterBox);
            this.filterBox.hide(); 

            // --- CONTENEUR CENTRAL : ESPACE AGRANDI À 580px ---
            this.innerBox = new St.BoxLayout({ vertical: true }); 
            this.innerBox.set_height(580); 
            contentLayout.add_child(this.innerBox);

            // --- BARRE DE NAVIGATION ---
            this.navBar = new St.BoxLayout({ style_class: 'prism-launcher-navbar', vertical: false, x_align: Clutter.ActorAlign.CENTER });
            
            this.btnPrev = new St.Button({ label: '◀ Précédent', style_class: 'prism-nav-btn', reactive: true });
            this.btnPrev.connect('clicked', () => {
                if (this._currentPage > 0) {
                    this._currentPage--;
                    this._showAppGrid();
                }
            });

            this.btnClose = new St.Button({ label: '✖ Fermer', style_class: 'prism-nav-btn close-btn', reactive: true });
            this.btnClose.connect('clicked', () => this.hide());

            this.btnNext = new St.Button({ label: 'Suivant ▶', style_class: 'prism-nav-btn', reactive: true });
            this.btnNext.connect('clicked', () => {
                let maxPage = Math.ceil(this._allApps.length / this._appsPerPage) - 1;
                if (this._currentPage < maxPage) {
                    this._currentPage++;
                    this._showAppGrid();
                }
            });

            this.navBar.add_child(this.btnPrev);
            this.navBar.add_child(this.btnClose);
            this.navBar.add_child(this.btnNext);
            contentLayout.add_child(this.navBar);

            // Assemblage Final
            this.mainPanel.add_child(contentLayout);
            this._overlayBox.add_child(this.mainPanel);
            
            Main.uiGroup.add_child(this._overlayBox);

            // ÉVÉNEMENTS
            this.searchEntry.clutter_text.connect('text-changed', () => this._onSearchChanged());
            this.searchEntry.clutter_text.connect('key-press-event', (a, e) => {
                if (e.get_key_symbol() === Clutter.KEY_Escape) this.hide();
            });

            this.searchEntry.set_text('');
            this._currentPage = 0;
            this._currentFilter = SEARCH_TYPE.ALL; 
            this.filterBox.get_children().forEach(c => c.remove_style_class_name('selected'));
            this.filterBox.get_children()[0].add_style_class_name('selected'); 

            this._allApps = Gio.AppInfo.get_all()
                .filter(a => a.should_show())
                .sort((a, b) => a.get_display_name().localeCompare(b.get_display_name()));

            this._showAppGrid();

            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                this.searchEntry.grab_key_focus();
                return GLib.SOURCE_REMOVE;
            });
        }

        _onSearchChanged() {
            if (this._searchTimeout) {
                GLib.source_remove(this._searchTimeout);
            }

            let text = this.searchEntry.get_text();
            
            if (text.length === 0) {
                this._showAppGrid();
                return;
            }

            this._searchTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
                this._triggerSearch(text);
                this._searchTimeout = null;
                return GLib.SOURCE_REMOVE;
            });
        }

        _updateNavButtons() {
            let maxPage = Math.ceil(this._allApps.length / this._appsPerPage) - 1;
            this.btnPrev.opacity = this._currentPage > 0 ? 255 : 100;
            this.btnPrev.reactive = this._currentPage > 0;
            this.btnNext.opacity = this._currentPage < maxPage ? 255 : 100;
            this.btnNext.reactive = this._currentPage < maxPage;
        }

        _showAppGrid() {
            this.filterBox.hide();
            this.navBar.show();
            this.innerBox.destroy_all_children();
            this._updateNavButtons();

            let maxCols = 6; 
            let currentRow = null;

            let startIndex = this._currentPage * this._appsPerPage;
            let pageApps = this._allApps.slice(startIndex, startIndex + this._appsPerPage);

            pageApps.forEach((app, index) => {
                if (index % maxCols === 0) {
                    currentRow = new St.BoxLayout({ 
                        vertical: false, 
                        style_class: 'prism-launcher-row',
                        height: 135, // Ligne légèrement plus haute
                        x_align: Clutter.ActorAlign.CENTER // LE FIX : Force la ligne et son contenu au centre de la fenêtre !
                    });
                    this.innerBox.add_child(currentRow);
                }

                let appBtn = new St.Button({ 
                    style_class: 'prism-launcher-card', 
                    reactive: true, 
                    can_focus: true 
                });
                appBtn.set_width(130);
                appBtn.set_height(125);

                let cardBox = new St.BoxLayout({ vertical: true });
                
                let icon = new St.Icon({ 
                    gicon: app.get_icon() || Gio.icon_new_for_string('application-x-executable'), 
                    icon_size: 72, 
                    style_class: 'prism-card-icon',
                    x_align: Clutter.ActorAlign.CENTER 
                });

                let name = app.get_display_name();
                let safeName = name.length > 15 ? name.substring(0, 13) + '...' : name;

                let nameLabel = new St.Label({ 
                    text: safeName, 
                    style_class: 'prism-card-label',
                    x_align: Clutter.ActorAlign.CENTER 
                });

                cardBox.add_child(icon);
                cardBox.add_child(nameLabel);
                appBtn.set_child(cardBox);

                appBtn.connect('clicked', () => {
                    app.launch([], null);
                    this.hide();
                });

                currentRow.add_child(appBtn);
            });
        }

        async _triggerSearch(text) {
            this.filterBox.show();
            this.navBar.hide(); 
            this.innerBox.destroy_all_children();
            
            try {
                let allResults = await this._searchEngine.search(text);
                
                if (!this._overlayBox || this.searchEntry.get_text() !== text) return;

                let filtered = allResults.filter(r => this._currentFilter === SEARCH_TYPE.ALL || r.type === this._currentFilter);

                if (filtered.length === 0) {
                    let empty = new St.Label({ text: "Aucun résultat", style_class: 'prism-launcher-empty', x_align: Clutter.ActorAlign.CENTER });
                    this.innerBox.add_child(empty);
                    return;
                }

                filtered.slice(0, 9).forEach(r => {
                    let btn = new St.Button({ 
                        style_class: 'prism-launcher-list-item', 
                        reactive: true,
                        x_align: Clutter.ActorAlign.CENTER // Centre les barres de résultats
                    });
                    btn.set_width(840);

                    let box = new St.BoxLayout({ vertical: false });
                    
                    let icon = new St.Icon({ gicon: r.icon, icon_size: 32, style_class: 'prism-list-icon' });
                    
                    let texts = new St.BoxLayout({ vertical: true });
                    
                    let name = r.name || "Inconnu";
                    let safeName = name.length > 60 ? name.substring(0, 57) + '...' : name;
                    
                    let title = new St.Label({ text: safeName, style_class: 'prism-list-title' });
                    
                    let typeText = "";
                    switch(r.type) {
                        case SEARCH_TYPE.APP: typeText = "Application"; break;
                        case SEARCH_TYPE.SETTING: typeText = "Paramètre"; break;
                        case SEARCH_TYPE.FILE: typeText = "Fichier"; break;
                        case SEARCH_TYPE.FOLDER: typeText = "Dossier"; break;
                        case SEARCH_TYPE.WEB: typeText = "Internet"; break;
                        default: typeText = "Inconnu";
                    }

                    let subtitle = new St.Label({ text: typeText, style_class: 'prism-list-subtitle' });
                    
                    texts.add_child(title);
                    texts.add_child(subtitle);
                    
                    box.add_child(icon);
                    box.add_child(texts);
                    btn.set_child(box);

                    btn.connect('clicked', () => {
                        if (r.type === SEARCH_TYPE.APP || r.type === SEARCH_TYPE.SETTING) r.appInfo.launch([], null);
                        else if (r.type === SEARCH_TYPE.FILE || r.type === SEARCH_TYPE.FOLDER) Gio.AppInfo.launch_default_for_uri(`file://${r.path}`, null);
                        else if (r.type === SEARCH_TYPE.WEB) r.action();
                        this.hide();
                    });

                    this.innerBox.add_child(btn);
                });
            } catch (e) {
                console.error("PRISM Erreur de recherche: " + e);
            }
        }

        hide() {
            if (this._overlayBox) {
                global.stage.set_key_focus(null);

                if (this._searchTimeout) {
                    GLib.source_remove(this._searchTimeout);
                    this._searchTimeout = null;
                }
                
                this._overlayBox.destroy();
                this._overlayBox = null;
            }
        }
    }
);