const { St, GLib, Gio, Clutter, Shell } = imports.gi;
const Main = imports.ui.main;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

var ClipboardManager = class ClipboardManager {
    constructor() {
        this.history = [];
        this.MAX_HISTORY = 15;
        this.clipboard = St.Clipboard.get_default();
        this.currentText = "";
        
        this.menuBox = null;
        this.isOpen = false;
        this.clickBinder = null;

        this._startWatching();
    }

    _startWatching() {
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._checkClipboard();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _checkClipboard() {
        this.clipboard.get_text(St.ClipboardType.CLIPBOARD, (clipboard, text) => {
            if (!text || text === this.currentText || text.trim() === "") return;

            this.currentText = text;
            this._addToHistory(text);
        });
    }

    _addToHistory(text) {
        this.history = this.history.filter(item => item !== text);
        this.history.unshift(text);

        if (this.history.length > this.MAX_HISTORY) {
            this.history.pop();
        }

        if (this.isOpen) {
            this._refreshMenuUI();
        }
    }

    toggleMenu(anchorButton) {
        if (this.isOpen) {
            this.closeMenu();
        } else {
            this.openMenu(anchorButton);
        }
    }

    openMenu(anchorButton) {
        if (this.menuBox) this.menuBox.destroy();

        this.menuBox = new St.BoxLayout({
            style_class: 'clipboard-menu',
            vertical: true,
            reactive: true
        });

        let header = new St.BoxLayout({ style_class: 'clipboard-header' });
        let title = new St.Label({ text: "Presse-papier", style_class: 'clipboard-title', x_expand: true });
        let clearBtn = new St.Button({ style_class: 'clipboard-clear-btn', label: 'Effacer' });
        
        clearBtn.connect('clicked', () => {
            this.history = [];
            this._refreshMenuUI();
        });

        header.add_child(title);
        header.add_child(clearBtn);
        this.menuBox.add_child(header);

        this.scroll = new St.ScrollView({
            style_class: 'clipboard-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
            y_expand: true
        });
        
        this.historyList = new St.BoxLayout({ vertical: true, style_class: 'clipboard-list' });
        this.scroll.add_actor(this.historyList);
        this.menuBox.add_child(this.scroll);

        this._refreshMenuUI();

        Main.layoutManager.addChrome(this.menuBox);

        let monitor = Main.layoutManager.primaryMonitor;
        
        let menuWidth = 300;
        let menuHeight = 400;

        let menuX = monitor.x + Math.floor((monitor.width - menuWidth) / 2);

        let positionFromTop = monitor.height * 0.70; 
        let menuY = monitor.y + Math.floor(positionFromTop - (menuHeight / 2));

        this.menuBox.set_position(menuX, menuY);
        this.menuBox.set_size(menuWidth, menuHeight);
        
        this.isOpen = true;

        this.clickBinder = global.stage.connect('button-press-event', (actor, event) => {
            let target = event.get_source();
            let isClickOnButton = (anchorButton && (target === anchorButton || anchorButton.contains(target)));
            
            if (!isClickOnButton && !this.menuBox.contains(target)) {
                this.closeMenu();
            }
        });
    }

    _refreshMenuUI() {
        this.historyList.remove_all_children();

        if (this.history.length === 0) {
            let emptyLabel = new St.Label({ 
                text: "Historique vide", 
                style_class: 'clipboard-empty' 
            });
            this.historyList.add_child(emptyLabel);
            return;
        }

        this.history.forEach(text => {
            let btn = new St.Button({
                style_class: 'clipboard-item',
                reactive: true,
                can_focus: true
            });

            let display = text.replace(/\n/g, " ");
            if (display.length > 40) display = display.substring(0, 40) + "...";
            
            let label = new St.Label({ 
                text: display,
                y_align: Clutter.ActorAlign.CENTER
            });

            btn.set_child(label);

            btn.connect('clicked', () => {
                this._restoreItem(text);
            });

            this.historyList.add_child(btn);
        });
    }

    _restoreItem(text) {
        this.clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
        this.currentText = text;
        this.closeMenu();
        
        Main.osdWindowManager.show(0, Gio.icon_new_for_string("edit-paste-symbolic"), "Copié !", null);
    }

    closeMenu() {
        if (this.menuBox) {
            this.menuBox.destroy();
            this.menuBox = null;
        }
        if (this.clickBinder) {
            global.stage.disconnect(this.clickBinder);
            this.clickBinder = null;
        }
        this.isOpen = false;
    }

    destroy() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
        this.closeMenu();
    }
};