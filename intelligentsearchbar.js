const { St, GObject, Gio } = imports.gi;
const Main = imports.ui.main;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

var SearchBar = GObject.registerClass(
    class SearchBar extends GObject.Object {
        _init() {
            super._init();
    
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
            this._center();
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
        
    });