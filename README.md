# Installation et débogage

### Prérequis

- GNOME Shell 43.9 (vérifier avec `gnome-shell --version`)
- `git` installé (`sudo apt install git` / `sudo dnf install git`)
- `glib-compile-schemas` installé — généralement inclus dans le paquet `libglib2.0-bin` (Debian/Ubuntu) ou `glib2-devel` (Fedora/Arch)

---

### Étape 1 — Obtenir le code source depuis Git

Cloner le dépôt directement dans le dossier des extensions GNOME Shell :

```bash
git clone https://github.com/hugodev-teck/IUI.git \
    ~/.local/share/gnome-shell/extensions/prism@dock.ui
```

> Le nom du dossier **doit** correspondre exactement à l'UUID déclaré dans `metadata.json`, soit `prism@dock.ui`. GNOME Shell refuse de charger une extension si le dossier et l'UUID ne correspondent pas.

Pour mettre à jour une installation existante :

```bash
cd ~/.local/share/gnome-shell/extensions/prism@dock.ui
git pull
```

---

### Étape 2 — Compiler les schémas GSettings

L'extension utilise GSettings pour persister les applications épinglées dans le dock. Le fichier de schéma XML doit être compilé en binaire avant que GNOME Shell puisse le lire :

```bash
glib-compile-schemas \
    ~/.local/share/gnome-shell/extensions/prism@dock.ui/schemas/
```

Cette commande génère le fichier `schemas/gschemas.compiled`. Elle doit être relancée après chaque `git pull` si le fichier `.gschema.xml` a été modifié.

Pour vérifier que le schéma est bien reconnu :

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/prism@dock.ui/schemas \
    list-keys org.gnome.shell.extensions.pdock
```

La commande doit afficher `dock-apps` sans erreur.

---

### Étape 3 — Redémarrer GNOME Shell

GNOME Shell doit être redémarré pour découvrir la nouvelle extension.

**Sur X11** (session classique) — rechargement à chaud sans déconnexion :

```bash
# Via le lanceur de commandes intégré
# Appuyer sur Alt+F2, taper r, puis Entrée

# Ou depuis un terminal (lance en arrière-plan, la session reste active)
nohup gnome-shell --replace &
```

**Sur Wayland** — rechargement à chaud impossible, déconnexion requise :

```bash
# Quitter la session via le menu système, puis se reconnecter
# Ou depuis un terminal (ferme la session immédiatement)
gnome-session-quit --logout
```

---

### Étape 4 — Activer l'extension

Après le redémarrage de GNOME Shell, l'extension est connue mais pas encore activée.

**Via GNOME Extensions (interface graphique) :**

Ouvrir l'application "Extensions" (paquet `gnome-shell-extension-prefs` ou `gnome-extensions-app`) et activer le commutateur en face de "IUI Bêta".

**Via le terminal :**

```bash
gnome-extensions enable prism@dock.ui
```

Pour vérifier que l'extension est bien activée :

```bash
gnome-extensions list --enabled | grep prism
```

Pour la désactiver sans désinstaller :

```bash
gnome-extensions disable prism@dock.ui
```

---

### Désinstallation complète

```bash
# 1. Désactiver l'extension
gnome-extensions disable prism@dock.ui

# 2. Supprimer les fichiers de l'extension
rm -rf ~/.local/share/gnome-shell/extensions/prism@dock.ui

# 3. Supprimer les données générées
rm -f  ~/.config/prism-widgets-layout.json
rm -rf ~/.cache/prism-update/
rm -f  ~/.local/share/applications/prism-*.desktop

# 4. Redémarrer GNOME Shell (voir Étape 3)
```

---

### Débogage en temps réel

Ouvrir un terminal et lancer le suivi des logs GNOME Shell avant d'activer l'extension :

```bash
# Logs filtrés sur PrismUI uniquement
journalctl -f /usr/bin/gnome-shell | grep -i "\[PrismUI\]"

# Erreurs JavaScript fatales et crashes d'allocation Clutter
journalctl -f /usr/bin/gnome-shell | grep -E "SyntaxError|needs an allocation|TypeError"

# Tous les JS ERROR (toutes extensions confondues)
journalctl -f /usr/bin/gnome-shell | grep "JS ERROR"

# Vue complète sans filtre (verbeux)
journalctl -f /usr/bin/gnome-shell
```

---

### GSettings — gestion du dock manuellement

```bash
SCHEMA_DIR=~/.local/share/gnome-shell/extensions/prism@dock.ui/schemas

# Lire les apps épinglées
gsettings --schemadir $SCHEMA_DIR get org.gnome.shell.extensions.pdock dock-apps

# Définir manuellement la liste (utile pour corriger un dock cassé)
gsettings --schemadir $SCHEMA_DIR \
  set org.gnome.shell.extensions.pdock dock-apps \
  "['firefox.desktop', 'org.gnome.Nautilus.desktop', 'org.gnome.Terminal.desktop']"

# Réinitialiser à la valeur par défaut
gsettings --schemadir $SCHEMA_DIR reset org.gnome.shell.extensions.pdock dock-apps
```

---



# Documentation Technique Complète



---

## Table des matières

1. [Vue d'ensemble de l'architecture](#1-vue-densemble-de-larchitecture)
2. [Arborescence du projet](#2-arborescence-du-projet)
3. [Dépendances et bibliothèques](#3-dépendances-et-bibliothèques)
4. [Registre des applications PRISM — `PRISM_APPS`](#4-registre-des-applications-prism--prism_apps)
5. [Cycle de vie : `enable()` et `disable()`](#5-cycle-de-vie--enable-et-disable)
6. [Module Dock — `MyDock`](#6-module-dock--mydock)
7. [Module Barre Système — `NetworkSetting`](#7-module-barre-système--networksetting)
8. [Module Horloge — `TimeMachine`](#8-module-horloge--timemachine)
9. [Module Lanceur — `AppLauncher` & `LocalSearchEngine`](#9-module-lanceur--applauncher--localsearchengine)
10. [Module Notifications — `NotificationManager`](#10-module-notifications--notificationmanager)
11. [Module Presse-papier — `ClipboardManager`](#11-module-presse-papier--clipboardmanager)
12. [Module Widgets Bureau — `PrismWidgets`](#12-module-widgets-bureau--prismwidgets)
13. [Module Barre Home — `HomeBar`](#13-module-barre-home--homebar)
14. [Module Mises à jour OTA — `UpdateManager`](#14-module-mises-à-jour-ota--updatemanager)
15. [Utilitaire — `CustomPopup`](#15-utilitaire--custompopup)
16. [Utilitaire — `AboutDialog`](#16-utilitaire--aboutdialog)
17. [Registre des raccourcis — `_registerPrismApps`](#17-registre-des-raccourcis--_registerpriSMapps)
18. [Moteur de rendu et gestion mémoire](#18-moteur-de-rendu-et-gestion-mémoire)
19. [Feuille de style CSS](#19-feuille-de-style-css)

---

## 1. Vue d'ensemble de l'architecture

IUI est un environnement de bureau complet implémenté sous forme d'extension GNOME Shell. Il **remplace** l'interface native (Panel, Dash, notifications) par ses propres composants, répartis sur trois couches de rendu GNOME :

```
┌─────────────────────────────────────────────────────────────────────┐
│                         GNOME Shell Process                         │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                      _backgroundGroup                       │    │
│  │  MyDock  NetworkSetting  TimeMachine  NotifBox  PrismWidgets│    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                        Chrome Layer                         │    │
│  │  NotifContainer  HistoryContainer  Tooltip  WidgetMenu  HomeBar  │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                          uiGroup                            │    │
│  │  AppLauncher  CustomPopup  AppManagerDialog  WindowMenu     │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  Panel GNOME natif : MASQUÉ (Main.panel.hide())                     │
└─────────────────────────────────────────────────────────────────────┘
```

L'extension repose sur **9 classes indépendantes** instanciées lors de l'activation. Chaque classe gère son propre cycle de vie et expose une méthode `destroy()` qui nettoie toutes ses ressources (signaux, timers, acteurs Clutter).

---

## 2. Arborescence du projet

```
prism@dock.ui/
├── extension.js               # Chef d'orchestre : MyDock, NetworkSetting, HomeBar,
│                              #   UpdateManager, CustomPopup, AboutDialog,
│                              #   PRISM_APPS, _registerPrismApps, enable/disable
├── intelligentsearchbar.js    # LocalSearchEngine (Levenshtein + I/O asynchrone)
│                              #   + AppLauncher (UI du lanceur paginé)
├── notificationsys.js         # NotificationManager : interception des notifs GNOME,
│                              #   toasts PrismUI, panneau d'historique
├── desktopWidgets.js          # PrismWidgets : moteur de widgets configurables,
│                              #   drag & drop, persistance JSON, binding de données
├── time.js                    # TimeMachine : horloge + date en arrière-plan
├── clipboard.js               # ClipboardManager : polling + menu historique
├── stylesheet.css             # Styles St/Clutter (valeurs absolues uniquement)
├── metadata.json              # Déclaration GNOME Shell
├── schemas/
│   └── org.gnome.shell.extensions.pdock.gschema.xml
└── icons/
    ├── logo.png
    ├── dt.png
    ├── vlogo.png              # Icône Velora Explorer
    └── interface/
        ├── wthicon/           # Icônes Wi-Fi, batterie, volume (PNG)
        ├── notification/      # bell-white.png
        ├── toggle/            # toggle-button-on/off.png
        └── wallpaper/         # officiel-wallpaper-prismUI.png
```

---

## 3. Dépendances et bibliothèques

| Bibliothèque | Usage dans IUI |
|---|---|
| `St` | Tous les widgets visuels (boutons, labels, icônes, layouts) |
| `Clutter` | Animations (`ease`), alignements, `FixedLayout`, `FlowLayout`, événements tactiles |
| `GLib` | Timers, chemins de fichiers, lecture de `/proc`, spawn synchrone |
| `Gio` | Fichiers, icônes, `AppInfo`, `Settings`, sous-processus, D-Bus, réseau |
| `GObject` | Héritage pour `AboutDialog` |
| `Meta` | Accès aux `Meta.Window` (maximisation, focus, minimisation) |
| `Shell` | `AppSystem`, `AppState`, tracking des applications en cours |
| `NM` | Client NetworkManager — état Wi-Fi, connexions actives |
| `UPowerGlib` | Niveau de batterie, état de charge |
| `Gvc` | Contrôle du volume via `MixerControl` |
| `Soup` | Requêtes HTTP pour les mises à jour OTA et les bindings de widgets |
| `Pango` | Ellipsis et retour à la ligne dans les labels de notifications |
| `ModalDialog` | Boîte de dialogue pour `AboutDialog` et `_openAppChooser` |

**Commandes système exécutées via sous-processus :**
- `bluetoothctl` — état et liste des périphériques Bluetooth
- `systemctl is-active bluetooth` / `reboot` / `poweroff`
- `gnome-session-quit` — extinction / déconnexion
- `uname -m` — détection de l'architecture CPU (x86_64 vs aarch64)
- `wget` — téléchargement des apps PRISM (DeskTools, Velora Explorer)

---

## 4. Registre des applications PRISM — `PRISM_APPS`

Constante globale déclarée au sommet de `extension.js`. Définit les applications de l'écosystème PRISM pouvant être installées et gérées automatiquement.

```
PRISM_APPS = {
  'desktools':        { version, tag, repo GitHub, icône, getFileName(arch, version) }
  'Velora explorer':  { version, tag, repo GitHub, icône, desktopId, getFileName() }
}
```

**`getFileName(arch, version)`** retourne le nom du fichier binaire à télécharger selon l'architecture. Pour DeskTools, cela distingue les versions `aarch64`/`arm64` et x86_64. Pour Velora Explorer (application JavaScript), retourne toujours `explorer.js`.

Ce registre est utilisé par deux fonctions distinctes :
- `_registerPrismApps()` — crée les fichiers `.desktop` pour les apps installées
- `_launchOrDownloadPrismApp(appId)` — lance ou télécharge une app à la demande

---

## 5. Cycle de vie : `enable()` et `disable()`

### `enable()`

`enable()` effectue d'abord une **vérification d'intégrité bloquante** avant d'initialiser quoi que ce soit.

```
enable()
 ├── new UpdateManager().ensureIntegrity()
 │    ├── Si des fichiers sont manquants ou vides → _repairSystem() + return false
 │    └── Si tout est OK → return true (on continue)
 │
 ├── [IMPORT DYNAMIQUE] dans un try/catch
 │    ├── NotificationManager  ← notificationsys.js
 │    ├── AppLauncher          ← intelligentsearchbar.js
 │    ├── TimeMachine          ← time.js
 │    ├── PrismWidgets         ← desktopWidgets.js
 │    └── Clipboard            ← clipboard.js
 │    (Si l'import échoue → ensureIntegrity() + return)
 │
 ├── new NetworkSetting()      → barre système (Wi-Fi, son, batterie)
 ├── new MyDock()              → dock + trackers MPRIS et AppState
 ├── new TimeMachine()         → horloge en arrière-plan
 ├── new AppLauncher()         → instanciation légère (UI créée à la demande)
 ├── new NotificationManager() → interception notifications GNOME
 ├── new PrismWidgets()        → moteur de widgets bureau
 ├── Gio.Settings background   → sauvegarde + application du fond d'écran PrismUI
 ├── Main.panel.hide()         → masque le panel GNOME natif
 ├── new Clipboard.ClipboardManager() → démarre le polling presse-papier
 ├── _registerPrismApps()      → crée/met à jour les fichiers .desktop PRISM
 ├── GLib.timeout_add(2000ms)  → ferme l'overview si ouvert au démarrage
 └── new HomeBar()             → barre invisible (visible si fenêtre maximisée)
```

Les imports de modules sont **intentionnellement différés** dans `enable()` (et non déclarés en haut de fichier). Cela permet à `UpdateManager.ensureIntegrity()` de réparer les fichiers manquants avant que JavaScript ne tente de les parser.

### `disable()` — Destruction complète

```
disable()
 ├── global.myDock :
 │    ├── bus.signal_unsubscribe(_nameOwnerChangedId)  → débranche le watcher MPRIS D-Bus
 │    ├── _mediaProxy.disconnect(_mediaSignalId)       → débranche les changements de track
 │    └── myDock.destroy()                             → retire le dock du backgroundGroup
 │
 ├── notificationManager.destroy()    → signaux + acteurs chrome
 ├── global.networkSetting.destroy()  → arrête NM/UPower/Gvc + menus
 ├── global._timeMachine.destroy()    → arrête le timer 60s
 ├── global.clipboardManager.destroy()→ arrête le polling 1s
 ├── homeBar.destroy()                → déconnecte les signaux fenêtres
 ├── global.prismWidgets.destroy()    → arrête tous les timers de widgets
 └── Main.panel.show()                → restaure le panel GNOME natif
```

---

## 6. Module Dock — `MyDock`

**Fichier :** `extension.js` — classe `MyDock`  
**Rendu :** `Main.layoutManager._backgroundGroup`, centré horizontalement, 10px au-dessus du bas

### Construction (`_constructbar`)

Le dock est un `St.BoxLayout` horizontal. Sa construction suit cet ordre fixe :

1. **Icône logo** (`addCustomIconMenu`) — fixe, toujours présente
2. **Icône DeskTools** (`addCustomIcon`) — affichée **uniquement si le binaire existe** sur le disque. L'architecture CPU est détectée via `uname -m` pour trouver le bon nom de fichier selon `PRISM_APPS['desktools'].getFileName(arch, version)`.
3. **Apps épinglées** lues depuis GSettings (`dock-apps`) via `addAppIcon(desktop, true)`
4. **Séparateur visuel** (`St.Widget` semi-transparent de 2×30px) — visible uniquement si des apps non-épinglées sont présentes
5. **Tracker MPRIS** (`_initMediaTracker`) et **Tracker d'apps** (`_initAppTracker`) initialisés

### Interactions sur l'icône logo

L'icône logo gère trois types d'entrées (souris et tactile) :

- **Clic court** (< 1000ms) : toggle du lanceur `AppLauncher` + ferme tous les menus réseau
- **Appui long** (≥ 1000ms) : ouvre le menu contextuel du dock (`_toggleContextMenu`)
- **Clic droit** : ouvre directement le menu contextuel
- **Touch begin/end** : reproduit la même logique long press pour les écrans tactiles

### Menu contextuel (`_toggleContextMenu`)

`CustomPopup` avec 5 entrées + 1 séparateur :

| Entrée | Action |
|---|---|
| Gérer les widgets | `global.prismWidgets._toggleWidgetMenu()` |
| Fonctionnalités PRISM | `_openNewFunc()` — accès aux apps PRISM et mises à jour |
| *(séparateur)* | |
| Afficher le bureau | Minimise toutes les fenêtres du workspace actif |
| Presse-papier | `ClipboardManager.toggleMenu()` |

### Tracker de lecture média — `_initMediaTracker`

Le dock s'abonne au bus D-Bus session via `Gio.bus_get_sync` et écoute le signal `NameOwnerChanged` sur `org.freedesktop.DBus`. Dès qu'un processus prenant un nom `org.mpris.MediaPlayer2.*` apparaît, `_connectToPlayer(playerName)` est appelé.

**`_connectToPlayer`** crée un `Gio.DBusProxy` sur l'interface `org.mpris.MediaPlayer2.Player`. Il écoute le signal `g-properties-changed` pour mettre à jour l'icône du dock en temps réel, et `notify::g-name-owner` pour détecter quand le lecteur se ferme.

Lorsqu'une lecture est détectée (`Playing` ou `Paused`), l'icône de l'application correspondante dans le dock **s'élargit en une capsule musicale** (`_expandAppIcon`) affichant :
- Le **titre de la piste** (avec animation de défilement si trop long)
- Une **barre de progression** qui avance en temps réel
- Des **boutons de contrôle** : précédent ⏮, play/pause ⏯, suivant ⏭

Les boutons envoient des commandes MPRIS via `_mediaProxy.call_sync('PlayPause' / 'Previous' / 'Next', ...)`.

Quand la lecture s'arrête, `_collapseAppIcon` rétrécit la capsule via une animation `ease`.

### Tracker d'applications — `_initAppTracker`

Écoute `Shell.AppSystem.get_default().connect('app-state-changed')`. Quand une app passe à l'état `RUNNING`, si elle n'a pas d'icône dans le dock, une icône temporaire est ajoutée après le séparateur. Quand elle passe à `STOPPED`, l'icône est retirée **sauf** si l'app est épinglée (`_isPinned = true`) ou si sa capsule média est encore visible.

Chaque icône dispose d'un `_dotContainer` (point de présence) aligné en bas de l'icône via `translation_y: 30` et un `Clutter.BinLayout` qui superpose le point sur l'icône.

### Gestionnaire d'applications — `_openAppChooser`

Remplace le vieux menu scrollable. Ouvre maintenant une `ModalDialog.ModalDialog` pleine hauteur (80% de l'écran) avec **deux colonnes** :

- **Colonne gauche** ("Logiciels disponibles") — toutes les apps installées non épinglées, avec bouton `+` vert
- **Colonne droite** ("Dans le Dock") — apps épinglées, avec boutons de réordering ▲▼ et bouton de suppression rouge

L'ajout/retrait/réordonnancement appelle `this.settings.set_strv('dock-apps', ...)` puis `_reloadDockIcons()` pour reconstruire le dock à chaud, et `_refreshAppManagerUI()` pour rafraîchir les deux listes.

### Menu de fenêtres au clic sur une icône

Un clic sur une icône d'app (en dehors du mode édition) ouvre un menu flottant (`_customWindowMenu`) listant les fenêtres ouvertes de cette application, filtrées par classe WM et titre. Chaque entrée active la fenêtre correspondante. Un bouton "Nouvelle fenêtre" est toujours présent en bas. Le menu se positionne au-dessus de l'icône via `GLib.idle_add` (après que le layout soit calculé) et se ferme au clic extérieur via `global.stage.connect('captured-event')`.

---

## 7. Module Barre Système — `NetworkSetting`

**Fichier :** `extension.js` — classe `NetworkSetting`  
**Rendu :** `Main.layoutManager._backgroundGroup`, coin supérieur droit (20px du bord, 23px du haut)

Barre horizontale de 3 boutons icônes : Wi-Fi, volume, batterie. L'initialisation des sous-systèmes matériels est **différée de 500ms** pour ne pas bloquer le démarrage.

### Réseau Wi-Fi (`_initNetwork` → `NM.Client`)

`NM.Client.new(null)`. Écoute `notify::primary-connection` et `notify::connectivity`. L'icône affiche 5 états (aucune connexion, filaire, Wi-Fi 0/1/2/3 barres).

Le menu Wi-Fi (`_wifimenu`) récupère l'état du Wi-Fi via `NM.Client` et liste les réseaux disponibles avec SSID et force de signal. Un `PopupSwitchMenuItem` permet d'activer/désactiver le Wi-Fi.

### Audio (`_initAudio` → `Gvc.MixerControl`)

`Gvc.MixerControl` nommé `PrismUI Volume Control`. Marque le stream par défaut avec `_prismConnected = true` pour éviter les connexions doubles sur `notify::volume` et `notify::is-muted`. Icône en 3 états : muet, volume < 50%, volume ≥ 50%.

Le menu principal (`_handleBarClick`) contient un **slider de volume** (`Slider.Slider`) directement contrôlé via `stream.volume` / `stream.push_volume()`, et un **slider de luminosité** connecté à `org.gnome.SettingsDaemon.Power.Screen` via D-Bus (affiché uniquement si le service est disponible).

### Batterie (`_initPower` → `UPowerGlib.Client`)

`UPowerGlib.Client.new_full(null)`. Écoute `notify::display-device`. Polling de secours toutes les 2 secondes. 5 niveaux d'icône (< 10%, < 35%, < 60%, < 85%, plein) avec suffixe `-ch` si en charge, et état `FULLY_CHARGED` spécifique.

### Bluetooth (`_blemenu` → `Gio.Subprocess`)

Dialogue avec `bluetoothctl` via subprocess. Vérifie d'abord `systemctl is-active bluetooth`. Parse la sortie pour lister les appareils couplés.

### Menu principal

Contient en bas (`bottomBox`) : 3 boutons d'alimentation (déconnexion, redémarrage, extinction) via `gnome-session-quit` / `systemctl`, et un affichage batterie dynamique (même logique que les icônes).

---

## 8. Module Horloge — `TimeMachine`

**Fichier :** `time.js` — classe `TimeMachine`  
**Rendu :** `Main.layoutManager._backgroundGroup`, centré, à hauteur/6 depuis le haut

Deux labels superposés dans un `St.BoxLayout` vertical : heure au format `HH:MM` et date en français via `toLocaleString('fr-FR')`.

**Stratégie de positionnement à 3 niveaux** pour survivre au délai de chargement des polices :
1. `_updateClock()` immédiat au constructeur
2. `GLib.idle_add` dans `_updateClock()` → repositionne à la prochaine frame libre
3. Timers à **500ms** et **1500ms** → repositionnements forcés après stabilisation

Guard de dimension : `if (clockContainer.width <= 0) return`. Un timer `GLib.timeout_add_seconds(60)` met à jour l'heure toutes les minutes.

---

## 9. Module Lanceur — `AppLauncher` & `LocalSearchEngine`

**Fichier :** `intelligentsearchbar.js`  
**Rendu :** `Main.uiGroup` (overlay plein écran, créé uniquement à la demande)

### `LocalSearchEngine`

**Phase 1 — Applications :** itère `Gio.AppInfo.get_all()`. Score via distance de Levenshtein normalisée (1 − distance/maxLength) + bonus +0.5 si début de chaîne. Les apps dont les catégories ou l'ID contiennent "settings" sont taguées `SEARCH_TYPE.SETTING`.

**Phase 2 — Fichiers :** scan asynchrone de `Documents`, `Bureau`, `Downloads`, `Téléchargements` via `Gio.File.enumerate_children_async`. Maximum 3 scans simultanés, profondeur maximale 4. Types détectés via `Gio.content_type_guess()`.

**Phase 3 — Web :** entrée systématique `Rechercher sur Google` (score 0.1).

### `AppLauncher`

L'overlay (900×760px) est centré et ajouté à `Main.uiGroup`. Un fond transparent capture les clics extérieurs pour fermer le lanceur. La barre de recherche reçoit le focus après 100ms.

**Mode grille** (sans recherche) : grille 6 colonnes, 24 apps/page, navigation ◀/▶.  
**Mode liste** (avec recherche) : debounce 400ms, max 9 résultats, filtres par catégorie (Tout/Apps/Paramètres/Fichiers/Dossiers/Web).

---

## 10. Module Notifications — `NotificationManager`

**Fichier :** `notificationsys.js`  
**Rendu :** Chrome GNOME (toasts + panneau historique) + `_backgroundGroup` (icône cloche)

S'abonne à `Main.messageTray.connect('source-added')`. Pour chaque notification GNOME interceptée, affiche un toast PrismUI puis **détruit la notification native** via `idle_add` pour éviter les doublons.

**Toast :** `St.Widget` avec `Clutter.BinLayout` superposant le contenu et un overlay de suppression `✕` (visible au survol). Auto-destruction après 5 secondes. Son via `global.display.get_sound_player().play_from_theme('message')`.

**Mode Ne Pas Déranger** : `showNotification()` retourne immédiatement si `dndEnabled = true`.

**Panneau d'historique :** reconstruit à chaque ouverture, liste les notifications en ordre inverse. Se ferme au clic extérieur via `global.stage.connect('captured-event')`.

**Positionnement de l'icône cloche :** calculé dynamiquement — à gauche de `global.barReseau.container` si disponible, sinon 10px du bord droit. Recalculé à chaque `notify::allocation` et `monitors-changed`.

---

## 11. Module Presse-papier — `ClipboardManager`

**Fichier :** `clipboard.js`  
**Rendu :** Chrome GNOME (menu flottant 300×400px, centré à 70% de la hauteur)

**Polling** toutes les secondes via `GLib.timeout_add_seconds(1)`. Ignore textes vides, identiques au précédent ou composés uniquement d'espaces. Historique limité à 15 entrées stockées en mémoire. Les doublons sont filtrés avant insertion (`history.filter(item => item !== text)`).

Chaque entrée tronque le texte à 40 caractères. Un clic restaure le texte dans le presse-papier via `St.Clipboard.set_text()` et affiche un OSD "Copié !".

---

## 12. Module Widgets Bureau — `PrismWidgets`

**Fichier :** `desktopWidgets.js` — classe `PrismWidgets`  
**Rendu :** `Main.layoutManager._backgroundGroup` (widgets) + Chrome GNOME (menu de sélection)

Module entièrement nouveau dans cette version. Permet de placer des **widgets d'information configurables** sur le bureau.

### Registre des widgets — `BUILTIN_WIDGETS`

Tableau de manifestes décrivant les 7 widgets disponibles :

| Widget | id | Taille (grille) | Sources de données |
|---|---|---|---|
| Système (RAM/CPU) | `sys-widget` | 4×3 | `/proc/meminfo`, `/proc/stat` |
| Batterie | `bat-widget` | 3×3 | `/sys/class/power_supply/BAT0/*` |
| Météo (compact) | `weather-widget` | 4×3 | `wttr.in` (HTTP) |
| Météo (grand) + prévisions | `weather-widget-big` | 5×4 | `wttr.in` JSON (HTTP) |
| Crypto (BTC/ETH en €) | `crypto-widget` | 4×3 | Binance API (HTTP, 60s) |
| Devises (EUR/USD/CHF) | `forex-widget` | 4×3 | exchangerate-api.com (HTTP, 3600s) |
| Réseau & IP publique | `net-monitor` | 4×3 | ipify.org (HTTP, 300s) |
| Température CPU | `cpu-temp-widget` | 3×3 | `/sys/class/thermal/thermal_zone0/temp` |

Chaque manifeste définit :
- **`ui`** : arbre d'objets (`box`, `label`, `progress`) décrivant la structure visuelle
- **`bindings`** : tableau de liaisons données → UI avec `targetId`, `targetProp` (`text` ou `style`), `interval` (en secondes), `sourceType` (`file`, `cmd`, `http`) et `process` (code JavaScript à exécuter sur les données brutes)

### Moteur de binding — `_buildWidgetFromManifest`

Construit l'UI via `_buildUIFromSchema` (récursif, crée les acteurs St à partir du manifeste). Maintient un dictionnaire `refs` reliant les `id` des éléments aux acteurs créés.

Pour chaque binding, installe un timer `GLib.timeout_add_seconds(interval)` qui :
- **`file`** : lit le fichier via `GLib.file_get_contents`, passe les données à `new Function('data', process)`, applique le résultat à l'acteur cible
- **`cmd`** : lance une commande shell via `Gio.Subprocess` avec `STDOUT_PIPE`, applique le résultat de manière asynchrone
- **`http`** : crée une `Soup.Session` (compatible Soup 2 et 3), effectue un GET, applique le résultat. User-agent `curl/7.81.0` pour éviter les blocages des API

À la destruction du widget, tous ses timers sont annulés via `box.connect('destroy')`.

### Grille et positionnement

Grille de 50px (`GRID_SIZE = 50`). `_snap(value)` arrondit à la case de grille la plus proche. Le conteneur desktop utilise `Clutter.FixedLayout` pour le positionnement libre.

### Menu de sélection — `_buildWidgetMenu` / `_toggleWidgetMenu`

Menu créé dans le chrome GNOME avec `Clutter.FlowLayout` (grille de boutons, passage à la ligne automatique). Largeur maximale 80% de l'écran. Hauteur calculée dynamiquement via `get_preferred_height(maxWidth)`. Positionné à 100px du bas de l'écran.

### Drag & drop depuis le menu

Chaque bouton du menu supporte le drag (souris et tactile). Au début du drag, un fantôme semi-transparent (`prism-widget-ghost-box`) suit le curseur via `global.stage.connect('captured-event')`. Au relâchement, le widget réel est créé et positionné à la case de grille la plus proche.

### Mode édition et déplacement

Un appui long de **800ms** sur un widget existant active son mode édition (`_isEditing = true`, classe CSS `prism-widget-editing`). Un bouton de suppression `✕` apparaît en coin supérieur gauche. En mode édition, un drag déplace le widget avec snapping sur la grille (même mécanisme de `captured-event`). Un clic sur le fond du desktop quitte tous les modes édition.

### Persistance — `_saveLayout` / `_loadLayout`

Le layout est sauvegardé dans `~/.config/prism-widgets-layout.json` sous forme de tableau `[{type, x, y}]`. `_saveLayout()` est appelé après chaque déplacement ou suppression. `_loadLayout()` recrée les widgets au démarrage.

---

## 13. Module Barre Home — `HomeBar`

**Fichier :** `extension.js` — classe `HomeBar`  
**Rendu :** Chrome GNOME (barre de 200×6px, centrée, 4px au-dessus du bas)

Barre **invisible par défaut**, apparaît uniquement quand une fenêtre est maximisée dans les deux axes sur le workspace actif.

Trois signaux déclenchent `_applyVisibility()` :
- `notify::focus-window` sur `global.display`
- `workspace-switched` sur `global.workspace_manager`
- `size-changed` et `notify::minimized` sur la fenêtre courante

Affichage/masquage animé via `actor.ease()` avec fondu de 200ms.

**Interactions :**
- **Glissement vers le haut** (déplacement Y > 10px) → `_minimizeAll()` puis réévaluation de visibilité après 50ms
- **Simple clic** → attend 300ms, si pas de second clic → `_minimizeAll()`
- **Double clic** (< 300ms) → annule le timer du simple clic → `Main.overview.toggle()`

---

## 14. Module Mises à jour OTA — `UpdateManager`

**Fichier :** `extension.js` — classe `UpdateManager`  
**Serveur :** `https://projet-prism.fr/update/iui/last/`  
**Répertoire temporaire :** `~/.cache/prism-update/`

### Vérification d'intégrité — `ensureIntegrity()` (synchrone)

Appelée **en premier** dans `enable()`, retourne un booléen. Vérifie que chaque fichier de `filesToUpdate` existe ET a une taille non nulle. Si des fichiers sont manquants, appelle `_repairSystem(files)` (asynchrone) et retourne `false`, ce qui **stoppe le `enable()`** pour ne pas charger de code corrompu.

### Réparation — `_repairSystem(files)` (asynchrone)

Télécharge les fichiers manquants dans le répertoire temporaire, puis les déplace à leur emplacement final. **Ne redémarre que si tous les téléchargements ont réussi** (le `try` ne doit pas avoir levé d'exception) pour éviter un bootloop en cas d'absence de réseau.

### Téléchargement atomique — `_downloadFile` + `updateAll()`

`_downloadFile` télécharge dans `~/.cache/prism-update/`. `updateAll()` :
1. Nettoie le répertoire temporaire
2. Télécharge tous les fichiers en parallèle (`Promise.all`)
3. **Swap atomique** : déplace chaque fichier du cache vers le répertoire de l'extension via `Gio.File.move(OVERWRITE)` — si un téléchargement a échoué, le fichier n'existe pas dans le cache et n'est pas swappé
4. Nettoie le cache

Après une mise à jour réussie, une `ModalDialog` propose à l'utilisateur de redémarrer la session (`gnome-session-quit --logout --no-prompt`).

### Vérification de version — `checkUpdates()`

Télécharge `metadata.json` depuis le serveur. Compare `parseFloat(version)` local vs distant. Résout `true` si une mise à jour est disponible.

---

## 15. Utilitaire — `CustomPopup`

**Fichier :** `extension.js` — classe `CustomPopup`  
**Rendu :** `Main.uiGroup`

Menu contextuel générique. S'ouvre vers le haut (`openUpwards`) en calculant sa hauteur réelle après rendu via `Mainloop.idle_add`. Protège contre les débordements d'écran. Se ferme au clic extérieur. Un séparateur visuel peut être inséré via `_addSeparator(targetMenu)`.

---

## 16. Utilitaire — `AboutDialog`

**Fichier :** `extension.js` — classe `AboutDialog` (extends `ModalDialog.ModalDialog`)

Reçoit une instance `UpdateManager` en paramètre. Affiche logo, version depuis `Me.metadata.version`. Le bouton "Rechercher une mise à jour" appelle directement `updater.runUpdateProcess()` qui déclenche le processus de mise à jour complet avec feedback en temps réel via `statusLabel`.

---

## 17. Registre des raccourcis — `_registerPrismApps`

**Fichier :** `extension.js` — fonction globale

Génère automatiquement des fichiers `.desktop` dans `~/.local/share/applications/` pour chaque app du registre `PRISM_APPS` qui est **effectivement installée** (binaire présent dans `System/Program/`).

Le fichier `.desktop` est créé avec `Exec` adapté au type de fichier :
- AppImage → `"$filePath"` (exécution directe)
- JavaScript → `gjs "$filePath"` (via le runtime GJS)

**Optimisation :** compare le contenu du fichier `.desktop` existant avant d'écrire. N'écrit que si le contenu a changé, pour ne pas déclencher inutilement le rafraîchissement du menu d'applications GNOME.

**Nettoyage :** supprime les anciens fichiers `.desktop` dont le nom n'est plus valide (migration d'ID).

Appelée dans `enable()` et après chaque installation réussie d'une app PRISM.

---

## 18. Moteur de rendu et gestion mémoire

### Prévention des crashes d'allocation Clutter

Toutes les fonctions `_setPosition()` commencent par `if (!this.container || this.container.width <= 0) return`. Les positionnements initiaux passent par `GLib.idle_add` (prochaine frame libre) et des timers différés (500ms, 1500ms pour l'horloge).

Les comparaisons arrondies (`Math.round(x) !== targetX`) empêchent les boucles infinies de `notify::allocation`.

### Déconnexion systématique des signaux

Chaque signal est stocké dans une propriété de l'instance (ex. `_monitorId`, `_focusId`, `_nameOwnerChangedId`, `_appStateChangedId`, `_mediaSignalId`). La méthode `destroy()` déconnecte explicitement chaque signal avant de détruire les acteurs.

### Imports différés

Les modules secondaires (`notificationsys`, `intelligentsearchbar`, `time`, `desktopWidgets`, `clipboard`) ne sont importés que dans `enable()`, dans un `try/catch`. Cela garantit que `UpdateManager.ensureIntegrity()` peut d'abord réparer les fichiers avant que JavaScript ne les parse.

### Compatibilité GNOME Shell 45+

`Main.panel.actor` est déprécié. IUI utilise directement `Main.panel.hide()` et `Main.panel.show()`.

### Compatibilité Soup 2 / Soup 3

Le moteur de bindings HTTP de `desktopWidgets.js` détecte la version de Soup via `Soup.MAJOR_VERSION === 3` et choisit entre `Soup.Session.send_and_read_async` (v3) et `Soup.SessionAsync.queue_message` (v2).

---

## 19. Feuille de style CSS

**Fichier :** `stylesheet.css`

Le moteur `St` rejette les valeurs en pourcentage (%). Toutes les tailles sont en `px` ou déléguées au JavaScript via `x_expand`/`y_expand`.

Classes principales par module :

| Module | Classes CSS |
|---|---|
| Dock | `.my-dock-container`, `.app-icon`, `.dock-tooltip`, `.dock-separator`, `.media-dock-box`, `.media-control-btn`, `.media-progress-bar`, `.media-progress-fill` |
| Barre système | `.network-settings-container`, `.feature-button-net`, `.net-box` |
| Notifications | `.notification-box-container`, `.notification-container`, `.notification-history-container`, `.notification-box`, `.notification-hover-overlay` |
| Horloge | `.clock-container`, `.clock-label`, `.date-label` |
| Lanceur | `.prism-launcher-dialog`, `.prism-launcher-card`, `.prism-launcher-list-item`, `.prism-filter-btn`, `.prism-launcher-navbar` |
| Presse-papier | `.clipboard-menu`, `.clipboard-item`, `.clipboard-clear-btn` |
| Widgets | `.prism-widget-box`, `.prism-widget-df-meteo-box`, `.prism-widget-menu`, `.prism-widget-menu-btn`, `.prism-widget-editing`, `.prism-widget-delete-btn`, `.prism-widget-ghost-box` |
| Menus | `.dock-context-menu`, `.popup-menu-item`, `.prism-app-manager-dialog` |



### Fichiers de données générés par l'extension

| Fichier | Contenu | Supprimable ? |
|---|---|---|
| `~/.config/prism-widgets-layout.json` | Positions et types des widgets bureau | Oui — réinitialise le bureau |
| `~/.cache/prism-update/` | Répertoire temporaire pendant les mises à jour | Oui — supprimé automatiquement |
| `~/.local/share/applications/prism-*.desktop` | Raccourcis des apps PRISM installées | Oui — recréés au prochain `enable()` |
