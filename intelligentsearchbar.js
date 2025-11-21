/*                                                                */
/*       Copyright (c) Project PRISM. All rights reserved.        */
/*         This software is licensed under the CC BY-NC           */
/*          Full text of the license can be found at              */
/*   https://creativecommons.org/licenses/by-nc/4.0/legalcode.en  */
/*                                                                */

const { St, GObject, Gio, Clutter } = imports.gi;
const Main = imports.ui.main;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const GLib = imports.gi.GLib;
const Util = imports.misc.util; // Ajout de Util pour simplifier les appels async

// Définition des constantes de filtre (inchangées)
const SEARCH_TYPE = {
    ALL: 'all',
    APP: 'app',
    FILE: 'file'
};

var LocalSearchEngine = class {
    constructor() {
        this.results = [];
    }
    
    /**
     * Recherche récursive ASYNCHRONE de fichiers et dossiers dans un répertoire donné.
     * Utilise une approche itérative (pile) pour éviter les débordements de pile.
     * @param {Gio.File} dirFile - Le répertoire à parcourir.
     * @param {string} query - La requête de recherche en minuscules.
     * @param {function} callback - Fonction appelée à chaque résultat trouvé (pour l'affichage progressif)
     */
    _searchDirectoryRecursively(dirFile, query) {
        return new Promise((resolve) => {
            if (!dirFile.query_exists(null))
                return resolve();
            
            const MAX_DEPTH = 5; 
            let stack = [{ file: dirFile, depth: 0 }];
            let finishedCount = 0;
            let activeScans = 0;
            
            const processNext = () => {
                if (stack.length === 0 && activeScans === 0) {
                    resolve();
                    return;
                }
                
                while (stack.length > 0 && activeScans < 2) { 
                    let { file: currentDir, depth } = stack.pop();

                    if (depth >= MAX_DEPTH) continue;
                    
                    activeScans++;

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
                                    let fileType = info.get_file_type();
                                    let filePath = currentDir.get_path() + '/' + name;
                                    
                                    if (name.toLowerCase().includes(query)) {
                                        let isDir = fileType === Gio.FileType.DIRECTORY;
                                        let contentType = isDir ? null : Gio.content_type_guess(filePath, null)[0];
                                        let icon = isDir ? Gio.icon_new_for_string('folder-symbolic') : Gio.content_type_get_icon(contentType);

                                        this.results.push({
                                            type: SEARCH_TYPE.FILE,
                                            name: name,
                                            path: filePath,
                                            icon: icon
                                        });
                                    }

                                    if (fileType === Gio.FileType.DIRECTORY) {
                                        let subDir = Gio.File.new_for_path(filePath);
                                        if (name !== '.' && name !== '..') {
                                            stack.push({ file: subDir, depth: depth + 1 });
                                        }
                                    }
                                }
                                enumerator.close(null);
                            } catch (e) {
                            }
                            
                            if (stack.length > 0 || activeScans > 0) {
                                GLib.idle_add(GLib.PRIORITY_DEFAULT, processNext);
                            } else {
                                resolve();
                            }
                        }
                    );
                }
                return GLib.SOURCE_REMOVE;
            };
            
            processNext();
        });
    }

    /**
     * Effectue la recherche d'applications (synchrone) et lance la recherche de fichiers (asynchrone).
     * @returns {Promise<Array>}
     */
    search(query) {
        if (!query || query.trim().length < 2)
            return Promise.resolve([]);

        query = query.toLowerCase();
        this.results = [];

        const appDirs = [
            '/usr/share/applications',
            `${GLib.get_home_dir()}/.local/share/applications`
        ];

        for (let dir of appDirs) {
            try {
                let folder = Gio.File.new_for_path(dir);
                let enumerator = folder.enumerate_children(
                    'standard::*',
                    Gio.FileQueryInfoFlags.NONE,
                    null
                );

                let info;
                while ((info = enumerator.next_file(null)) !== null) {
                    let name = info.get_name();
                    if (name.endsWith('.desktop')) {
                        let appInfo = Gio.DesktopAppInfo.new_from_filename(`${dir}/${name}`);
                        if (appInfo && appInfo.should_show()) {
                            let appName = appInfo.get_name().toLowerCase();
                            if (appName.includes(query)) {
                                this.results.push({
                                    type: SEARCH_TYPE.APP,
                                    name: appInfo.get_name(),
                                    icon: appInfo.get_icon(),
                                    appInfo
                                });
                            }
                        }
                    }
                }
                enumerator.close(null);
            } catch (e) {
                logError(e);
            }
        }

        const homeDirs = ['Documents', 'Bureau', 'Downloads', 'Téléchargements'];
        let fileSearchPromises = [];
        
        for (let folderName of homeDirs) {
            let dirPath = `${GLib.get_home_dir()}/${folderName}`;
            let dirFile = Gio.File.new_for_path(dirPath);
            
            fileSearchPromises.push(this._searchDirectoryRecursively(dirFile, query));
        }
        
        return Promise.all(fileSearchPromises).then(() => {
            return this.results;
        });
    }
};

// ... (Début de SearchBar) ...
var SearchBar = GObject.registerClass(
    class SearchBar extends GObject.Object {
        // ... (Méthodes _init, _center, getWidget, show, hide, toggle - INCHANGÉES) ...

        _init() {
            super._init();

            this._overlayBox = null;
            this._globalClickHandler = null;
            this._searchEngine = new LocalSearchEngine();
            this._currentFilter = SEARCH_TYPE.ALL; // Filtre par défaut

            this._container = new St.BoxLayout({
                style_class: 'searchbar-container',
                vertical: false,
                x_expand: true,
                y_expand: true
            });
    
            let contentContainer = new St.BoxLayout({
                style_class: 'searchbar-content',
                vertical: false,
                x_expand: true,
                y_expand: true,
                reactive: true,
                can_focus: true
            });

            contentContainer.connect('button-press-event', () => {
                this._showOverlay();
            });
    
            let searchIcon = new St.Icon({
                gicon: Gio.icon_new_for_string(`${Me.path}/icons/interface/blcicon/search.png`),
                style_class: 'searchbar-icon',
                y_align: St.Align.MIDDLE
            });
            contentContainer.add_child(searchIcon);
    
            // Ajouter le texte au centre
            let searchText = new St.Label({
                text: 'Cliquez pour rechercher',
                style_class: 'searchbar-text',
                y_align: St.Align.MIDDLE
            });
            contentContainer.add_child(searchText);
    
            // Ajouter le logo de génema à droite
            let genemaIcon = new St.Icon({
                gicon: Gio.icon_new_for_string(`${Me.path}/icons/GENAIMA-logo.png`),
                style_class: 'searchbar-icon',
                y_align: St.Align.MIDDLE
            });
            contentContainer.add_child(genemaIcon);
    
            // Ajouter le conteneur de contenu à la barre de recherche
            this._container.add_child(contentContainer);
    
            // Ajouter la barre de recherche au stage
            if (!this._container.get_parent()) {
                // Ajouter le conteneur au groupe backgroundGroup
                Main.layoutManager._backgroundGroup.add_child(this._container);

                // Réordonner les enfants pour placer le conteneur en arrière-plan
                Main.layoutManager._backgroundGroup.set_child_below_sibling(this._container, null);
            }
    
            this.show();
    
            // Positionner la barre de recherche au centre de l'écran
            this._container.connect('notify::allocation', () => {
                this._center();
            });
        }
    
        _center() {
            let monitor = Main.layoutManager.primaryMonitor;
            let container = this._container;
    
            container.set_position(
                Math.floor(((monitor.width - container.width) / 2)),
                Math.floor(((monitor.height - container.height) / 2) - (monitor.height / 8))
            );
        }
        
        getWidget() {
            return this._container;
        }
    
        show() {
            this._container.show();
        }
    
        hide() {
            this._container.hide();
        }
    
        toggle() {
            if (this._container.visible) {
                this.hide();
            } else {
                this.show();
            }
        }


        _showOverlay() {
            if (this._overlayBox) return;

            this._overlayBox = new St.Widget({
                style_class: 'search-overlay',
                layout_manager: new Clutter.BinLayout(),
                reactive: true,
                can_focus: true,
                x_expand: true,
                y_expand: true,
            });

            Main.layoutManager._backgroundGroup.add_child(this._overlayBox);

            let [x, y] = this._container.get_transformed_position();
            let [width, height] = this._container.get_transformed_size();

            const RESULTS_HEIGHT = 345; 
            const PADDING_FOR_FILTERS = 70; 
            const OVERLAY_HEIGHT = height + PADDING_FOR_FILTERS + RESULTS_HEIGHT; 

            this._overlayBox.set_position(x - 10, y - 10);
            this._overlayBox.set_size(width + 20, OVERLAY_HEIGHT);

            const entry = new St.Entry({
                hint_text: "Tapez votre recherche...",
                style_class: 'searchbar-entry',
                can_focus: true,
                reactive: true,
            });
            this._overlayBox.add_child(entry);
            entry.set_position(10, 10);
            entry.set_size(width, height);

            // --- Boîte de Filtres ---
            const filterBox = new St.BoxLayout({
                style_class: 'search-filter-box', 
                vertical: false,
            });
            this._overlayBox.add_child(filterBox);
            filterBox.set_position(10, height + 20); 
            filterBox.set_size(width, 35); 

            // --- Création des boutons de filtre ---
            const filterButtons = {};
            const createFilterButton = (label, type) => {
                let button = new St.Button({
                    label: label,
                    style_class: `search-filter-btn ${type === this._currentFilter ? 'selected' : ''}`,
                    reactive: true, 
                    can_focus: true, 
                    track_hover: true 
                });
                button.connect('clicked', () => {
                    this._currentFilter = type;
                    // Mise à jour visuelle
                    Object.values(filterButtons).forEach(btn => btn.remove_style_class_name('selected'));
                    button.add_style_class_name('selected');
                    refreshResults();
                });
                filterButtons[type] = button;
                filterBox.add_child(button);
            };

            createFilterButton("Tout", SEARCH_TYPE.ALL);
            createFilterButton("Applications", SEARCH_TYPE.APP);
            createFilterButton("Fichiers & Dossiers", SEARCH_TYPE.FILE);


            // --- Boîte de Résultats ---
            const resultsBox = new St.BoxLayout({
                style_class: 'searchbar-results',
                vertical: true,
                x_expand: true,
                y_expand: true,
            });
            this._overlayBox.add_child(resultsBox);
            resultsBox.set_position(10, height + 60); 
            resultsBox.set_size(width, RESULTS_HEIGHT);

            entry.grab_key_focus();

            // --- NOUVEAU: Gestionnaire de clic en dehors ---
            this._globalClickHandler = global.stage.connect('button-press-event', (actor, event) => {
                // Vérifier si l'événement provient de l'overlay ou de la barre de recherche originale
                if (!this._overlayBox.contains(event.get_source()) &&
                    !this._container.contains(event.get_source())) {
                    
                    this._hideOverlay();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });

            // --- Moteur de Recherche ---
            const engine = this._searchEngine;
            
            // Fonction de rafraîchissement des résultats
            const refreshResults = () => {
                const text = entry.get_text();
                if (!text || text.trim().length < 2) {
                    resultsBox.destroy_all_children();
                    return;
                }
                
                // Vider les résultats et afficher un indicateur de chargement
                resultsBox.destroy_all_children();
                let loadingLabel = new St.Label({
                    text: 'Recherche en cours...',
                    style: 'color: #999; padding: 10px;'
                });
                resultsBox.add_child(loadingLabel);


                // 🚨 UTILISATION DE ASYNC/AWAIT
                engine.search(text).then((allResults) => {
                    
                    resultsBox.destroy_all_children(); // Effacer l'indicateur de chargement
                    
                    // Filtrer les résultats selon le filtre actif
                    let filteredResults = allResults.filter(r => 
                        this._currentFilter === SEARCH_TYPE.ALL || r.type === this._currentFilter
                    );

                    for (let r of filteredResults.slice(0, 9)) {
                        // Création de la ligne de résultat
                        let row = new St.BoxLayout({ 
                            style_class: 'search-result-row',
                            reactive: true,       
                            can_focus: true,      
                            track_hover: true     
                        });

                        let icon = new St.Icon({
                            gicon: r.icon,
                            icon_size: 24,
                            style_class: 'search-result-icon'
                        });

                        let label = new St.Label({
                            text: `${r.name}`,
                            y_align: Clutter.ActorAlign.CENTER
                        });

                        row.add_child(icon);
                        row.add_child(label);

                        row.connect('button-press-event', () => {
                            try {
                                if (r.type === SEARCH_TYPE.APP && r.appInfo)
                                    r.appInfo.launch([], null);
                                else if (r.type === SEARCH_TYPE.FILE)
                                    Gio.AppInfo.launch_default_for_uri(`file://${r.path}`, null); 
                            } catch (e) { logError(e); }

                            this._hideOverlay();
                        });

                        resultsBox.add_child(row);
                    }
                    
                    if (filteredResults.length === 0) {
                         let noResultsLabel = new St.Label({
                            text: 'Aucun résultat trouvé.',
                            style: 'color: #999; padding: 10px;'
                        });
                        resultsBox.add_child(noResultsLabel);
                    }

                }).catch(e => {
                    logError(e, 'Erreur lors de la recherche asynchrone');
                    resultsBox.destroy_all_children();
                    let errorLabel = new St.Label({
                        text: 'Erreur lors de la recherche.',
                        style: 'color: red; padding: 10px;'
                    });
                    resultsBox.add_child(errorLabel);
                });
            };

            // écoute du texte tapé
            entry.clutter_text.connect('text-changed', refreshResults);

            entry.clutter_text.connect('key-press-event', (actor, event) => {
                if (event.get_key_symbol() === Clutter.KEY_Escape) {
                    this._hideOverlay();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
        }

        _hideOverlay() {
            if (this._overlayBox) {
                if (this._globalClickHandler) {
                    global.stage.disconnect(this._globalClickHandler);
                    this._globalClickHandler = null;
                }
                
                Main.layoutManager._backgroundGroup.remove_child(this._overlayBox);
                this._overlayBox = null;
                this._currentFilter = SEARCH_TYPE.ALL;
            }
        }
    });