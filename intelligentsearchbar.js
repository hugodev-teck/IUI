/*                                                                */
/*       Copyright (c) Project PRISM. All rights reserved.        */
/*         This software is licensed under the CC BY-NC           */
/*          Full text of the license can be found at              */
/*   https://creativecommons.org/licenses/by-nc/4.0/legalcode.en  */
/*                                                                */

import St from 'gi://St';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const SEARCH_TYPE = {
    ALL: 'all',
    APP: 'app',
    SETTING: 'setting',
    FILE: 'file',
    FOLDER: 'folder',
    WEB: 'web'
};

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
    constructor() {
        this._searchId = 0;
    }

    abort() {
        this._searchId++;
    }

    _calculateScore(query, target) {
        let distance = getLevenshteinDistance(query.toLowerCase(), target.toLowerCase());
        let maxLength = Math.max(query.length, target.length);
        let score = 1 - (distance / maxLength);
        if (target.toLowerCase().startsWith(query.toLowerCase())) score += 0.5;
        return score;
    }

    _searchDirectoryRecursively(dirFile, lowerQuery, localResults, currentId) {
        return new Promise((resolve) => {
            if (!dirFile.query_exists(null)) return resolve();
            
            const MAX_DEPTH = 4; 
            let stack = [{ file: dirFile, depth: 0 }];
            let activeScans = 0;
            
            const processNext = () => {
                if (this._searchId !== currentId) return resolve();
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
                            if (this._searchId !== currentId) return resolve();
                            
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

    search(query, allAppsCache) {
        this._searchId++;
        let currentId = this._searchId;

        if (!query || query.trim().length < 2) return Promise.resolve([]);
        let lowerQuery = query.toLowerCase();
        let localResults = []; 

        allAppsCache.forEach(app => {
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
        });

        const homeDirs = ['Documents', 'Bureau', 'Downloads', 'Téléchargements'];
        let fileSearchPromises = homeDirs.map(folder => 
            this._searchDirectoryRecursively(Gio.File.new_for_path(`${GLib.get_home_dir()}/${folder}`), lowerQuery, localResults, currentId)
        );
        
        return Promise.all(fileSearchPromises).then(() => {
            if (this._searchId !== currentId) return [];
            
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

export const AppLauncher = GObject.registerClass(
    class AppLauncher extends GObject.Object {
        _init() {
            super._init();
            this._overlayBox = null;
            this._searchTimeout = null; 
            this._searchGeneration = 0;
            this._searchEngine = new LocalSearchEngine();
            this._currentFilter = SEARCH_TYPE.ALL;
            
            this._currentPage = 0;
            this._appsPerPage = 24; 
            this._allApps = [];
            this._selectedIndex = -1;
            this._resultButtons = [];
            this._gridBuilt = false; // Évite de reconstruire la grille si déjà affichée

            // Cache dynamique des applications
            this._appMonitor = Gio.AppInfoMonitor.get();
            this._appMonitorId = this._appMonitor.connect('changed', () => {
                this._loadAppsCache();
                this._gridBuilt = false;
                if (this._overlayBox && this._overlayBox.visible && this.searchEntry.get_text().length === 0) {
                    this._showAppGrid(true);
                }
            });
            this._loadAppsCache();
        }

        _loadAppsCache() {
            this._allApps = Gio.AppInfo.get_all()
                .filter(a => a.should_show())
                .sort((a, b) => a.get_display_name().localeCompare(b.get_display_name()));
        }

        _buildUI() {
            if (this._overlayBox) return;

            let monitor = Main.layoutManager.primaryMonitor;
            if (!monitor) return;

            this._overlayBox = new St.Widget({ 
                reactive: true, 
                width: monitor.width,
                height: monitor.height,
                x: monitor.x,
                y: monitor.y,
                layout_manager: new Clutter.BinLayout(),
                visible: false
            });

            this.bgClicker = new St.Button({
                reactive: true,
                x_expand: true,
                y_expand: true,
                style: 'background-color: transparent;'
            });
            this._bgClickId = this.bgClicker.connect('clicked', () => this.hide());
            this._overlayBox.add_child(this.bgClicker);

            let panelWidth = 900;
            let panelHeight = 760;

            this.mainPanel = new St.BoxLayout({
                name: 'src-mn-panel',
                style_class: 'prism-launcher-dialog', 
                vertical: true,
                reactive: true,
                width: panelWidth,
                height: panelHeight,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER
            });

            let contentLayout = new St.BoxLayout({
                name: 'srv-mn-launcher',
                vertical: true,
                style_class: 'prism-launcher-content',
                x_expand: true,
                y_expand: true
            });

            let searchBox = new St.BoxLayout({name: 'search-box', style_class: 'prism-launcher-search-box', vertical: false });
            let searchIcon = new St.Icon({ gicon: Gio.icon_new_for_string('system-search-symbolic'), icon_size: 24, style_class: 'prism-launcher-icon' });
            
            this.searchEntry = new St.Entry({ 
                hint_text: "Rechercher une application, un fichier...", 
                style_class: 'prism-launcher-entry', 
                can_focus: true,
                x_expand: true
            });
            this.searchEntry.set_width(750);
            
            this.btnClear = new St.Button({
                child: new St.Icon({ gicon: Gio.icon_new_for_string('edit-clear-symbolic'), icon_size: 20 }),
                style_class: 'prism-launcher-clear-btn',
                reactive: true,
                opacity: 0
            });
            this.btnClear.connect('clicked', () => {
                this.searchEntry.set_text('');
                this.searchEntry.clutter_text.grab_key_focus();
            });

            searchBox.add_child(searchIcon);
            searchBox.add_child(this.searchEntry);
            searchBox.add_child(this.btnClear);
            contentLayout.add_child(searchBox);

            this.filterBox = new St.BoxLayout({name: 'src-filter', style_class: 'prism-launcher-filters', vertical: false });
            
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

            this.innerBox = new St.BoxLayout({name: 'central-contener', vertical: true }); 
            this.innerBox.set_height(580); 
            contentLayout.add_child(this.innerBox);

            this.navBar = new St.BoxLayout({name: 'prism-launcher-navbar', style_class: 'prism-launcher-navbar', vertical: false, x_align: Clutter.ActorAlign.CENTER });
            
            this.btnPrev = new St.Button({ child: new St.Icon({ icon_name: 'go-previous-symbolic', icon_size: 16 }), style_class: 'prism-nav-btn', reactive: true });
            this.btnPrev.connect('clicked', () => {
                if (this._currentPage > 0) {
                    this._currentPage--;
                    this._showAppGrid(true);
                }
            });

            this.pageIndicators = new St.BoxLayout({ vertical: false, style_class: 'prism-nav-dots', y_align: Clutter.ActorAlign.CENTER });

            this.btnNext = new St.Button({ child: new St.Icon({ icon_name: 'go-next-symbolic', icon_size: 16 }), style_class: 'prism-nav-btn', reactive: true });
            this.btnNext.connect('clicked', () => {
                let maxPage = Math.ceil(this._allApps.length / this._appsPerPage) - 1;
                if (this._currentPage < maxPage) {
                    this._currentPage++;
                    this._showAppGrid(true);
                }
            });

            this.navBar.add_child(this.btnPrev);
            this.navBar.add_child(this.pageIndicators);
            this.navBar.add_child(this.btnNext);
            contentLayout.add_child(this.navBar);

            this.mainPanel.add_child(contentLayout);
            this._overlayBox.add_child(this.mainPanel);
            
            Main.layoutManager.addChrome(this._overlayBox);

            // ÉVÉNEMENTS (Connectés une seule fois pour toute la vie de l'extension)
            this._searchTextChangedId = this.searchEntry.clutter_text.connect('text-changed', () => this._onSearchChanged());
            this._searchKeyPressId = this.searchEntry.clutter_text.connect('key-press-event', (actor, event) => this._onKeyPress(event));
        }

        toggle() {
            if (this._overlayBox && this._overlayBox.visible) {
                this.hide();
            } else {
                this.show();
            }
        }

        show() {
            this._buildUI();
            if (!this._overlayBox) return;

            let monitor = Main.layoutManager.primaryMonitor;
            if (monitor) {
                this._overlayBox.set_position(monitor.x, monitor.y);
                this._overlayBox.set_size(monitor.width, monitor.height);
            }

            let needsRebuild = (this._currentPage !== 0) || !this._gridBuilt;
            this._currentPage = 0;
            this._currentFilter = SEARCH_TYPE.ALL;
            
            let filterChildren = this.filterBox.get_children();
            filterChildren.forEach(c => c.remove_style_class_name('selected'));
            if (filterChildren.length > 0) filterChildren[0].add_style_class_name('selected');

            if (this.searchEntry.get_text().length > 0) {
                // Déclenche automatiquement _onSearchChanged -> _showAppGrid(true)
                this.searchEntry.set_text('');
            } else if (needsRebuild) {
                this._showAppGrid(true);
            }

            this._overlayBox.show();

            this.mainPanel.remove_all_transitions();
            this.mainPanel.set_scale(0.95, 0.95);
            this.mainPanel.set_opacity(0);
            this.mainPanel.ease({
                scale_x: 1.0,
                scale_y: 1.0,
                opacity: 255,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD
            });

            this.searchEntry.clutter_text.grab_key_focus();
        }

        _onKeyPress(event) {
            let symbol = event.get_key_symbol();
            
            if (symbol === Clutter.KEY_Escape) {
                this.hide();
                return Clutter.EVENT_STOP;
            }

            if (this._resultButtons.length > 0) {
                if (symbol === Clutter.KEY_Down) {
                    this._selectedIndex = Math.min(this._selectedIndex + 1, this._resultButtons.length - 1);
                    this._updateSelection();
                    return Clutter.EVENT_STOP;
                } else if (symbol === Clutter.KEY_Up) {
                    this._selectedIndex = Math.max(this._selectedIndex - 1, 0);
                    this._updateSelection();
                    return Clutter.EVENT_STOP;
                } else if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
                    if (this._selectedIndex >= 0 && this._selectedIndex < this._resultButtons.length) {
                        this._resultButtons[this._selectedIndex].emit('clicked', 0);
                    }
                    return Clutter.EVENT_STOP;
                }
            }

            return Clutter.EVENT_PROPAGATE;
        }

        _updateSelection() {
            this._resultButtons.forEach((btn, index) => {
                if (index === this._selectedIndex) {
                    btn.add_style_class_name('selected');
                } else {
                    btn.remove_style_class_name('selected');
                }
            });
        }

        _onSearchChanged() {
            if (this._searchTimeout) {
                GLib.source_remove(this._searchTimeout);
                this._searchTimeout = null;
            }

            let text = this.searchEntry.get_text();
            this.btnClear.opacity = text.length > 0 ? 255 : 0;
            this.btnClear.reactive = text.length > 0;
            
            if (text.length === 0) {
                this._showAppGrid(true);
                return;
            }

            this._searchTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                this._triggerSearch(text);
                this._searchTimeout = null;
                return GLib.SOURCE_REMOVE;
            });
        }

        _updateNavButtons() {
            let maxPage = Math.max(0, Math.ceil(this._allApps.length / this._appsPerPage) - 1);
            this.btnPrev.opacity = this._currentPage > 0 ? 255 : 100;
            this.btnPrev.reactive = this._currentPage > 0;
            this.btnNext.opacity = this._currentPage < maxPage ? 255 : 100;
            this.btnNext.reactive = this._currentPage < maxPage;

            this.pageIndicators.destroy_all_children();
            for (let i = 0; i <= maxPage; i++) {
                let dot = new St.Widget({
                    style_class: `prism-page-dot ${i === this._currentPage ? 'active' : ''}`
                });
                this.pageIndicators.add_child(dot);
            }
        }

        _showAppGrid(forceRebuild = false) {
            this._selectedIndex = -1;
            this._resultButtons = [];
            this.filterBox.hide();
            this.navBar.show();

            if (!forceRebuild && this._gridBuilt) return;

            this.innerBox.destroy_all_children();
            this._updateNavButtons();

            let maxCols = 6; 
            let currentRow = null;

            let startIndex = this._currentPage * this._appsPerPage;
            let pageApps = this._allApps.slice(startIndex, startIndex + this._appsPerPage);

            pageApps.forEach((app, index) => {
                if (index % maxCols === 0) {
                    currentRow = new St.BoxLayout({ 
                        name: 'src-c-row',
                        vertical: false, 
                        style_class: 'prism-launcher-row',
                        height: 135,
                        x_align: Clutter.ActorAlign.CENTER 
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

                let cardBox = new St.BoxLayout({name: 'src-c-box-2', vertical: true });
                
                let icon = new St.Icon({ 
                    gicon: app.get_icon() || Gio.icon_new_for_string('application-x-executable'), 
                    icon_size: 72, 
                    style_class: 'prism-card-icon',
                    x_align: Clutter.ActorAlign.CENTER 
                });

                let nameLabel = new St.Label({ 
                    text: app.get_display_name(), 
                    style_class: 'prism-card-label',
                    x_align: Clutter.ActorAlign.CENTER 
                });
                nameLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                nameLabel.set_width(110);

                cardBox.add_child(icon);
                cardBox.add_child(nameLabel);
                appBtn.set_child(cardBox);

                appBtn.connect('clicked', () => {
                    app.launch([], null);
                    this.hide();
                });

                currentRow.add_child(appBtn);
            });

            this._gridBuilt = true;
        }

        async _triggerSearch(text) {
            const searchGeneration = ++this._searchGeneration;
            this._gridBuilt = false; // On détruit la grille pour afficher la liste
            this.filterBox.show();
            this.navBar.hide(); 
            this.innerBox.destroy_all_children();
            this._resultButtons = [];
            this._selectedIndex = 0;
            
            try {
                let allResults = await this._searchEngine.search(text, this._allApps);
                
                if (searchGeneration !== this._searchGeneration ||
                    !this._overlayBox ||
                    !this._overlayBox.visible ||
                    !this.searchEntry ||
                    this.searchEntry.get_text() !== text) return;

                let filtered = allResults.filter(r => this._currentFilter === SEARCH_TYPE.ALL || r.type === this._currentFilter);

                if (filtered.length === 0) {
                    let empty = new St.Label({ text: "Aucun résultat", style_class: 'prism-launcher-empty', x_align: Clutter.ActorAlign.CENTER });
                    this.innerBox.add_child(empty);
                    return;
                }

                filtered.slice(0, 9).forEach((r, index) => {
                    let btn = new St.Button({ 
                        style_class: `prism-launcher-list-item ${index === 0 ? 'selected' : ''}`, 
                        reactive: true,
                        x_align: Clutter.ActorAlign.CENTER
                    });
                    btn.set_width(840);

                    let box = new St.BoxLayout({
                        name: 'src-c-box-3', 
                        vertical: false,
                        x_expand: true,
                        x_align: Clutter.ActorAlign.START,
                        y_align: Clutter.ActorAlign.CENTER
                    });
                    
                    let icon = new St.Icon({ gicon: r.icon, icon_size: 32, style_class: 'prism-list-icon' });
                    
                    let texts = new St.BoxLayout({name: 'src-c-box-4', vertical: true });
                    
                    let title = new St.Label({ text: r.name || "Inconnu", style_class: 'prism-list-title' });
                    title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                    title.set_width(750);
                    
                    let typeText = "";
                    switch(r.type) {
                        case SEARCH_TYPE.APP: 
                        case SEARCH_TYPE.SETTING:
                            typeText = (r.appInfo.get_description() || "Application").replace(/\n/g, ' '); 
                            break;
                        case SEARCH_TYPE.FILE: 
                        case SEARCH_TYPE.FOLDER:
                            typeText = r.type === SEARCH_TYPE.FILE ? "Fichier • " : "Dossier • ";
                            typeText += GLib.path_get_dirname(r.path).replace(GLib.get_home_dir(), '~');
                            break;
                        case SEARCH_TYPE.WEB: typeText = "Internet"; break;
                        default: typeText = "Inconnu";
                    }

                    let subtitle = new St.Label({ text: typeText, style_class: 'prism-list-subtitle' });
                    subtitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                    subtitle.set_width(750);
                    
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

                    btn.connect('notify::hover', () => {
                        if (btn.hover) {
                            this._selectedIndex = index;
                            this._updateSelection();
                        }
                    });

                    this.innerBox.add_child(btn);
                    this._resultButtons.push(btn);
                });
            } catch (e) {
                console.error("PRISM Erreur de recherche: " + e);
            }
        }

        hide() {
            if (!this._overlayBox || !this._overlayBox.visible) return;
            
            this._searchGeneration++;
            this._searchEngine.abort();

            if (this._searchTimeout) {
                GLib.source_remove(this._searchTimeout);
                this._searchTimeout = null;
            }

            global.stage.set_key_focus(null);

            this.mainPanel.remove_all_transitions();
            this.mainPanel.ease({
                scale_x: 0.95,
                scale_y: 0.95,
                opacity: 0,
                duration: 100,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    if (this._overlayBox) {
                        this._overlayBox.hide();
                    }
                }
            });
        }

        destroy() {
            this._searchGeneration++;
            if (this._searchEngine) {
                this._searchEngine.abort();
                this._searchEngine = null;
            }

            if (this._appMonitorId) {
                this._appMonitor.disconnect(this._appMonitorId);
                this._appMonitorId = null;
            }

            if (this._searchTimeout) {
                GLib.source_remove(this._searchTimeout);
                this._searchTimeout = null;
            }

            if (this.searchEntry && this.searchEntry.clutter_text) {
                if (this._searchTextChangedId) this.searchEntry.clutter_text.disconnect(this._searchTextChangedId);
                if (this._searchKeyPressId) this.searchEntry.clutter_text.disconnect(this._searchKeyPressId);
            }
            if (this.bgClicker && this._bgClickId) {
                this.bgClicker.disconnect(this._bgClickId);
            }

            if (this._overlayBox) {
                if (this.mainPanel) this.mainPanel.remove_all_transitions();
                Main.layoutManager.removeChrome(this._overlayBox);
                this._overlayBox.destroy();
                this._overlayBox = null;
            }

            this.mainPanel = null;
            this.bgClicker = null;
            this.searchEntry = null;
            this.btnClear = null;
            this.filterBox = null;
            this.innerBox = null;
            this.navBar = null;
            this.btnPrev = null;
            this.btnNext = null;
            this.pageIndicators = null;
            this._resultButtons = [];
        }
    }
);