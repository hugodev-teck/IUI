const { St, GObject, Gio } = imports.gi;
const Main = imports.ui.main;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Clutter = imports.gi.Clutter;



var SearchBar = GObject.registerClass(
    class SearchBar extends GObject.Object {
        _init() {
            super._init();

            this._overlayBox = null;
    
            // Créez un conteneur pour la barre de recherche
            this._container = new St.BoxLayout({
                style_class: 'searchbar-container',
                vertical: false,
                x_expand: true,
                y_expand: true
            });
    
            // Créez le conteneur pour le contenu de la barre de recherche
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
    
            // Ajouter le logo de recherche à gauche
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
                layout_manager: new Clutter.BinLayout(), // Permet positionnement libre
                reactive: true,
                can_focus: true,
                x_expand: true,
                y_expand: true,
            });
        
            Main.layoutManager._backgroundGroup.add_child(this._overlayBox);
        
            // Position réelle de la barre de base
            let [x, y] = this._container.get_transformed_position();
            let [width, height] = this._container.get_transformed_size();
        
            // Positionne l'overlay un peu plus grand autour de la barre
            this._overlayBox.set_position(x - 10, y - 10);
            this._overlayBox.set_size(width + 20, height + 120);
        
            // Crée le champ de recherche à superposer
            const entry = new St.Entry({
                hint_text: "Tapez votre recherche...",
                style_class: 'searchbar-entry',
                can_focus: true,
                reactive: true,
            });
        
            // Positionne précisément l'entry au même endroit que la barre de base
            this._overlayBox.add_child(entry);
            entry.set_position(10, 10); // décalé de +10 pour compenser le -10 de l'overlay
            entry.set_size(width, height); // même taille que la barre
        
            // Zone de résultats en dessous
            const resultsBox = new St.BoxLayout({
                style_class: 'searchbar-results',
                vertical: true,
                x_expand: true,
                y_expand: true,
            });
        
            this._overlayBox.add_child(resultsBox);
            resultsBox.set_position(10, height + 20); // position sous la barre
            resultsBox.set_size(width, 100); // hauteur fixe ici, sinon tu peux ajuster dynamiquement
        
            // Focus auto + fermeture sur Échap
            entry.grab_key_focus();
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
                Main.layoutManager._backgroundGroup.remove_child(this._overlayBox);
                this._overlayBox = null;
            }
        }
        
        
    });