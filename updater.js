#!/usr/bin/env gjs

import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

const args = ARGV || [];
const EXTENSION_PATH = args[0] || GLib.get_current_dir();

const BASE_URL = "https://raw.githubusercontent.com/hugodev-teck/IUI/refs/heads/gnome-48-migration/";
const FILES_TO_UPDATE = [
    "desktopWidgets.js", "intelligentsearchbar.js", "notificationsys.js", 
    "stylesheet.css", "clipboard.js", "extension.js", "metadata.json",
    "icons/vlogo.png", "icons/logo.png", "updater.js"
];

const app = new Gtk.Application({ application_id: 'org.prism.Updater' });

app.connect('activate', () => {
    const window = new Gtk.ApplicationWindow({ 
        application: app, 
        title: 'IUI - Centre de mise à jour', 
        default_width: 480, 
        default_height: 380,
        modal: true
    });

    let localMetadata = {};
    try {
        let file = Gio.File.new_for_path(GLib.build_filenamev([EXTENSION_PATH, 'metadata.json']));
        let [, contents] = file.load_contents(null);
        localMetadata = JSON.parse(new TextDecoder("utf-8").decode(contents));
    } catch (e) {
        localMetadata = { version: "Inconnue", "sub-version": "Erreur", "title-version": "" };
    }

    let mainBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 20, margin_top: 30, margin_bottom: 30, margin_start: 30, margin_end: 30 });

    let titleLabel = new Gtk.Label({ label: `<span size="x-large" weight="bold">IUI ${localMetadata["title-version"] || ""}</span>`, use_markup: true });
    let versionLabel = new Gtk.Label({ label: `Version actuelle : ${localMetadata.version} (Build ${localMetadata["sub-version"] || "N/A"})` });
    
    let statusLabel = new Gtk.Label({ label: "Prêt à vérifier les mises à jour ou l'intégrité du système.", wrap: true, justify: Gtk.Justification.CENTER });
    statusLabel.add_css_class('dim-label');

    let btnBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 15, halign: Gtk.Align.CENTER });

    let integrityBtn = new Gtk.Button({ label: "Vérifier l'intégrité" });
    let checkBtn = new Gtk.Button({ label: 'Vérifier les mises à jour' });
    checkBtn.add_css_class('suggested-action');

    btnBox.append(integrityBtn);
    btnBox.append(checkBtn);

    mainBox.append(titleLabel);
    mainBox.append(versionLabel);
    mainBox.append(new Gtk.Separator());
    mainBox.append(statusLabel);
    mainBox.append(btnBox);

    window.set_child(mainBox);

    const session = new Soup.Session();
    session.user_agent = "Mozilla/5.0 (X11; Linux x86_64) PrismUI/1.0"; 

    let appState = 'CHECK'; 

    checkBtn.connect('clicked', () => {
        if (appState === 'CHECK') {
            runCheck();
        } else if (appState === 'UPDATE') {
            performUpdate();
        } else if (appState === 'CLOSE') {
            window.close();
        } else if (appState === 'REBOOT') {
            GLib.spawn_command_line_async('gnome-session-quit --logout --no-prompt');
            window.close();
        }
    });

    integrityBtn.connect('clicked', () => {
        integrityBtn.set_sensitive(false);
        checkBtn.set_sensitive(false);
        statusLabel.set_label("Analyse des fichiers locaux en cours...");
        
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            let missingOrCorrupted = 0;
            
            for (let filename of FILES_TO_UPDATE) {
                let file = Gio.File.new_for_path(GLib.build_filenamev([EXTENSION_PATH, filename]));
                
                if (!file.query_exists(null)) {
                    missingOrCorrupted++;
                    continue;
                }
                try {
                    let size = file.query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null).get_size();
                    if (size === 0) missingOrCorrupted++;
                } catch(e) { missingOrCorrupted++; }
            }
            
            if (missingOrCorrupted > 0) {
                statusLabel.set_markup(`<span color="#e67e22" weight="bold">Alerte : ${missingOrCorrupted} fichier(s) altéré(s) ou manquant(s).</span>\nUne réparation est fortement conseillée.`);
                checkBtn.set_label("Lancer la réparation");
                checkBtn.remove_css_class('suggested-action');
                checkBtn.add_css_class('destructive-action');
                appState = 'UPDATE'; 
            } else {
                statusLabel.set_markup(`<span color="#2ecc71" weight="bold">Intégrité validée.</span>\nTous les fichiers du système sont présents et intacts.`);
                checkBtn.set_label("Fermer");
                checkBtn.remove_css_class('suggested-action');
                appState = 'CLOSE';
            }
            
            integrityBtn.set_sensitive(true);
            checkBtn.set_sensitive(true);
            return GLib.SOURCE_REMOVE;
        });
    });

    const runCheck = () => {
        checkBtn.set_sensitive(false);
        integrityBtn.set_sensitive(false);
        statusLabel.set_label("Connexion au serveur GitHub...");

        let msg = Soup.Message.new('GET', BASE_URL + "metadata.json");

        session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (sess, res) => {
            try {
                let bytes = sess.send_and_read_finish(res);
                let status = msg.get_status();
                if (status !== 200) throw new Error("Code HTTP " + status);

                let remoteMetadata = JSON.parse(new TextDecoder("utf-8").decode(bytes.get_data()));
                
                let isNewVersion = (remoteMetadata.version > localMetadata.version);
                let isNewSubVersion = (remoteMetadata.version === localMetadata.version && remoteMetadata["sub-version"] !== localMetadata["sub-version"]);

                if (isNewVersion || isNewSubVersion) {
                    statusLabel.set_markup(`<span color="#2ecc71">Mise à jour disponible !</span>\nNouvelle version : ${remoteMetadata.version} (Build ${remoteMetadata["sub-version"]})`);
                    checkBtn.set_label("Télécharger et Installer");
                    appState = 'UPDATE';
                } else {
                    statusLabel.set_label("Votre système est à jour.");
                    checkBtn.set_label("Fermer");
                    checkBtn.remove_css_class('suggested-action');
                    appState = 'CLOSE';
                }
            } catch (e) {
                statusLabel.set_markup(`<span color="#e74c3c">Erreur réseau : ${e.message}</span>`);
                appState = 'CHECK'; 
            } finally {
                checkBtn.set_sensitive(true);
                integrityBtn.set_sensitive(true);
            }
        });
    };

    const performUpdate = async () => {
        checkBtn.set_sensitive(false);
        integrityBtn.set_sensitive(false);
        const tempDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'prism-update']);
        
        try {
            if (GLib.file_test(tempDir, GLib.FileTest.EXISTS)) GLib.spawn_command_line_sync(`rm -rf "${tempDir}"`);
            GLib.mkdir_with_parents(tempDir, 0o755);

            for (let i = 0; i < FILES_TO_UPDATE.length; i++) {
                let file = FILES_TO_UPDATE[i];
                statusLabel.set_label(`Téléchargement : ${file} (${i + 1}/${FILES_TO_UPDATE.length})`);
                await downloadFile(file, tempDir);
            }

            statusLabel.set_label("Installation des fichiers...");
            
            for (let file of FILES_TO_UPDATE) {
                let tempPath = Gio.File.new_for_path(GLib.build_filenamev([tempDir, file]));
                let destPath = Gio.File.new_for_path(GLib.build_filenamev([EXTENSION_PATH, file]));
                
                // Sécurité vitale pour les sous-dossiers (ex: /icons)
                let destParent = destPath.get_parent();
                if (!destParent.query_exists(null)) {
                    destParent.make_directory_with_parents(null);
                }

                if (tempPath.query_exists(null)) {
                    if (destPath.query_exists(null)) destPath.delete(null); // Nettoyage propre avant écrasement
                    tempPath.move(destPath, Gio.FileCopyFlags.OVERWRITE, null, null);
                }
            }

            GLib.spawn_command_line_sync(`rm -rf "${tempDir}"`);
            
            statusLabel.set_markup(`<span color="#2ecc71" weight="bold">Opération réussie !</span>`);
            checkBtn.set_label("Redémarrer la session");
            checkBtn.remove_css_class('suggested-action');
            checkBtn.add_css_class('destructive-action');
            appState = 'REBOOT';

        } catch (e) {
            statusLabel.set_markup(`<span color="#e74c3c">Échec de l'installation : ${e.message}</span>`);
            checkBtn.set_label("Fermer");
            checkBtn.remove_css_class('destructive-action');
            checkBtn.remove_css_class('suggested-action');
            appState = 'CLOSE';
        } finally {
            checkBtn.set_sensitive(true);
        }
    };

    const downloadFile = (filename, tempDir) => {
        return new Promise((resolve, reject) => {
            let msg = Soup.Message.new('GET', BASE_URL + filename);
            session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (sess, res) => {
                try {
                    let bytes = sess.send_and_read_finish(res);
                    let status = msg.get_status();
                    if (status !== 200) throw new Error(`HTTP ${status}`);
                    
                    let localPath = Gio.File.new_for_path(GLib.build_filenamev([tempDir, filename]));
                    let parentDir = localPath.get_parent();
                    if (!parentDir.query_exists(null)) parentDir.make_directory_with_parents(null);
                    
                    localPath.replace_contents(bytes.get_data(), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                    resolve();
                } catch (e) { reject(e); }
            });
        });
    };

    window.present();
});

app.run([]);