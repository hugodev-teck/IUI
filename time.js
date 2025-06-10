const { St, GObject, Gio, Clutter, GLib } = imports.gi;
const Main = imports.ui.main;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

var TimeMachine = GObject.registerClass(
    class TimeMachine extends GObject.Object {
        _init() {
            super._init();

            // Créer un conteneur pour l'heure et la date
            this.clockContainer = new St.BoxLayout({
                vertical: true,
                style_class: 'clock-container'
            });

            // Créer un label pour l'heure (grand format)
            this.clockLabel = new St.Label({
                text: this._getFormattedTime(),
                style_class: 'clock-label',
                y_align: Clutter.ActorAlign.CENTER,
                x_align: Clutter.ActorAlign.CENTER
            });

            // Créer un label pour la date (plus petit)
            this.dateLabel = new St.Label({
                text: this._getFormattedDate(),
                style_class: 'date-label',
                y_align: Clutter.ActorAlign.CENTER,
                x_align: Clutter.ActorAlign.CENTER
            });

            // Ajouter les labels au conteneur
            this.clockContainer.add_child(this.clockLabel);
            this.clockContainer.add_child(this.dateLabel);

            // Ajouter le conteneur au groupe backgroundGroup
            Main.layoutManager._backgroundGroup.add_child(this.clockContainer);
            Main.layoutManager._backgroundGroup.set_child_below_sibling(this.clockContainer, null);

            // Positionner le conteneur initialement
            this.clockContainer.connect('notify::allocation', () => {
                this._setPosition();
            });

            // Mettre à jour l'heure et la date toutes les 60 secondes
            this._updateClock();
        }

        _getFormattedTime() {
            let now = new Date();

            // Récupérer l'heure et les minutes
            let hours = String(now.getHours()).padStart(2, '0');
            let minutes = String(now.getMinutes()).padStart(2, '0');

            // Retourner l'heure au format HH:MM
            return `${hours}:${minutes}`;
        }

        _getFormattedDate() {
            let now = new Date();

            // Récupérer les composantes de la date
            let day = now.toLocaleString('fr-FR', { weekday: 'long' });
            let date = String(now.getDate()).padStart(2, '0');
            let month = now.toLocaleString('fr-FR', { month: 'long' });
            let year = now.getFullYear();

            // Retourner la date au format JOUR:NOMBRE:MOIS:ANNEE
            return `${day} ${date} ${month} ${year}`;
        }

        _updateClock() {
            // Mettre à jour le texte de l'heure et de la date
            this.clockLabel.set_text(this._getFormattedTime());
            this.dateLabel.set_text(this._getFormattedDate());

            // Reprogrammer la mise à jour dans 60 secondes
            GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
                this._updateClock();
                return GLib.SOURCE_CONTINUE;
            });
        }

        _setPosition() {
            if (!this.clockContainer) return;
        
            let monitor = Main.layoutManager.primaryMonitor;
            if (!monitor) return;
        
            let containerWidth = this.clockContainer.width;
            let containerHeight = this.clockContainer.height;
        
            // ATTENTION : il arrive que width/height soient 0 au tout début
            if (containerWidth === 0 || containerHeight === 0)
                return; // on fait rien si pas encore prêt
        
            let centerX = Math.floor((monitor.width - containerWidth) / 2);
            let posY = Math.floor((monitor.height / 6)); // attention ici aussi : c'était height pas width
        
            this.clockContainer.set_position(centerX, posY);
        }        

        destroy() {
            this.clockContainer.destroy();
        }
    }
);