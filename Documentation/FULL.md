# IUI : Documentation Technique Complète

**UUID :** `prism@dock.ui`  
**Version :** 1.40 — *Wayland Edition* (Build K002)  
**Licence :** [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/legalcode.en)  
**Compatibilité GNOME Shell :** 48+

---

## Table des matières

1. [Vue d'ensemble de l'architecture](#1-vue-densemble-de-larchitecture)
2. [Migration vers GNOME Shell 48 (ESM)](#2-migration-vers-gnome-shell-48-esm)
3. [Arborescence du projet](#3-arborescence-du-projet)
4. [Dépendances et bibliothèques](#4-dépendances-et-bibliothèques)
5. [Registre des applications PRISM — `PRISM_APPS`](#5-registre-des-applications-prism--prism_apps)
6. [Cycle de vie — `PrismExtension`](#6-cycle-de-vie--prismextension)
7. [Module Dock — `MyDock`](#7-module-dock--mydock)
8. [Module Barre Système — `NetworkSetting`](#8-module-barre-système--networksetting)
9. [Module Lanceur — `AppLauncher` & `LocalSearchEngine`](#9-module-lanceur--applauncher--localsearchengine)
10. [Module Notifications — `NotificationManager`](#10-module-notifications--notificationmanager)
11. [Module Presse-papier — `ClipboardManager`](#11-module-presse-papier--clipboardmanager)
12. [Module Widgets Bureau — `PrismWidgets`](#12-module-widgets-bureau--prismwidgets)
13. [Module Barre Home — `HomeBar`](#13-module-barre-home--homebar)
14. [Module Mises à jour — `updater.js`](#14-module-mises-à-jour--updaterjs)
15. [Utilitaire — `CustomPopup`](#15-utilitaire--custompopup)
16. [Utilitaire — `_registerPrismApps`](#16-utilitaire--_registerpriSMapps)
17. [Utilitaire — `_launchOrDownloadApp`](#17-utilitaire--_launchordownloadapp)
18. [Moteur de rendu et gestion mémoire](#18-moteur-de-rendu-et-gestion-mémoire)
19. [Feuille de style CSS](#19-feuille-de-style-css)

---

## 1. Vue d'ensemble de l'architecture

IUI remplace entièrement l'interface native de GNOME Shell (Panel, Dash, notifications) par ses propres composants, répartis sur trois couches de rendu :

```
┌─────────────────────────────────────────────────────────────────────┐
│                         GNOME Shell Process                         │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                      _backgroundGroup                       │    │
│  │  MyDock  NetworkSetting  TimeMachine  PrismWidgets.desktop  │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                        Chrome Layer                         │    │
│  │  NotifContainer  HistoryContainer  HomeBar  WidgetMenu      │    │
│  │  Tooltip  ClipboardMenu  WindowMenu                         │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                          uiGroup                            │    │
│  │  AppLauncher  CustomPopup  AppManagerDialog  DragGhost      │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  Panel GNOME natif : MASQUÉ (Main.panel.hide())                     │
└─────────────────────────────────────────────────────────────────────┘
```

L'extension repose sur **9 classes indépendantes** instanciées par `PrismExtension`. Chaque classe gère son propre cycle de vie et expose une méthode `destroy()` qui nettoie toutes ses ressources.

---

## 2. Migration vers GNOME Shell 48 (ESM)

Cette version est une réécriture complète du système d'imports, alignée sur le nouveau modèle de modules ECMAScript natif (ESM) imposé par GNOME Shell 48.

### Avant (GNOME Shell 43, API CommonJS)
```javascript
const { St, GLib } = imports.gi;
const Main = imports.ui.main;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
// Accès au chemin : Me.path
// Accès aux settings : ExtensionUtils.getSettings()
```

### Après (GNOME Shell 48, ESM)
```javascript
import St from 'gi://St';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
// Accès au chemin : this.path (via l'instance Extension)
// Accès aux settings : this.getSettings('org.gnome.shell.extensions.pdock')
```

### Conséquences pratiques dans le code

**Chemins de fichiers :** `Me.path` est remplacé par `this._ext.path` (où `this._ext` est l'instance `PrismExtension` passée au constructeur) ou par `this.dir.get_child(...)` directement dans les méthodes de `PrismExtension`.

**Settings :** `ExtensionUtils.getSettings()` est remplacé par `this._ext.getSettings('org.gnome.shell.extensions.pdock')`, appelé dans le constructeur de `MyDock` et passé via `this._ext`.

**Feuille de style :** En ESM, le CSS n'est plus chargé automatiquement. `enable()` le charge manuellement via `St.ThemeContext.get_for_stage(global.stage).get_theme().load_stylesheet(this.dir.get_child('stylesheet.css'))` et `disable()` le décharge.

**Imports des modules internes :** Les autres fichiers JS de l'extension sont importés directement au niveau du module, sans `try/catch`. Si un fichier est absent, le moteur JS lève une erreur immédiatement avant même que `enable()` soit appelé.

**Soup :** Fixé à la version 3 via `import Soup from 'gi://Soup?version=3.0'`. La double-compatibilité Soup 2/3 des versions précédentes est supprimée.

---

## 3. Arborescence du projet

```
prism@dock.ui/
├── extension.js               # Chef d'orchestre : MyDock, NetworkSetting, HomeBar,
│                              #   CustomPopup, PRISM_APPS, _registerPrismApps,
│                              #   _launchOrDownloadApp, PrismExtension
├── intelligentsearchbar.js    # LocalSearchEngine + AppLauncher
├── notificationsys.js         # NotificationManager
├── desktopWidgets.js          # PrismWidgets : moteur de widgets + drag & drop
├── time.js                    # TimeMachine : horloge en arrière-plan
├── clipboard.js               # ClipboardManager : polling + menu historique
├── updater.js                 # Application GTK4 autonome de mise à jour/intégrité
├── stylesheet.css             # Styles (valeurs absolues uniquement)
├── metadata.json              # Déclaration GNOME Shell
├── schemas/
│   └── org.gnome.shell.extensions.pdock.gschema.xml
├── System/Program/            # Répertoire des binaires PRISM (créé à la demande)
└── icons/
    ├── logo.png, dt.png, vlogo.png
    └── interface/
        ├── wthicon/           # Wi-Fi, batterie, volume
        ├── notification/      # bell-white.png
        ├── toggle/            # toggle-button-on/off.png
        └── wallpaper/         # officiel-wallpaper-prismUI.png
```

---

## 4. Dépendances et bibliothèques

| Bibliothèque | Usage |
|---|---|
| `St` | Tous les widgets visuels |
| `Clutter` | Animations, `FixedLayout`, `FlowLayout`, `BinLayout`, événements tactiles |
| `GLib` | Timers, chemins de fichiers, lecture de `/proc`, spawn synchrone |
| `Gio` | Fichiers, icônes, `AppInfo`, `Settings`, D-Bus, réseau |
| `GObject` | Déclaration de l'extension (`Extension`) |
| `Meta` | Fenêtres (`Meta.Window`, maximisation, focus, minimisation) |
| `Shell` | `AppSystem`, `AppState`, tracking des applications en cours |
| `NM` | Client NetworkManager — Wi-Fi, connexions |
| `UPowerGlib` | Batterie et état de charge |
| `Gvc` | Volume audio via `MixerControl` |
| `Soup 3` | HTTP pour bindings de widgets et téléchargements OTA |
| `Pango` | Ellipsis dans les labels de notifications |
| `ModalDialog` | Boîte de dialogue pour le gestionnaire d'apps et les téléchargements |
| `Gtk 4` | Interface de `updater.js` (processus séparé) |

**Commandes système :**
- `uname -m` — détection architecture CPU (x86_64/aarch64)
- `gnome-session-quit` — déconnexion/redémarrage
- `systemctl suspend/reboot/poweroff`
- `bluetoothctl` — liste et état des périphériques Bluetooth
- `gjs -m updater.js` — lancement de l'updater dans un sous-processus isolé

---

## 5. Registre des applications PRISM — `PRISM_APPS`

Constante déclarée au sommet de `extension.js`. Décrit les applications de l'écosystème PRISM pouvant être téléchargées, installées et intégrées automatiquement.

```javascript
const PRISM_APPS = {
    'desktools': {
        name, version, tag, repo,  // Métadonnées GitHub Releases
        icon: "dt.png",
        getFileName(arch, version) // Retourne le nom du fichier selon l'architecture
    },
    'Velora explorer': {
        name, version, tag, repo,
        icon: "vlogo.png",
        desktopId: "velora-explorer",
        getFileName() // Retourne toujours "explorer.js" (runtime GJS)
    }
}
```

`getFileName(arch, version)` adapte le nom du fichier selon le CPU :
- DeskTools : `Desktools-2.1.0-arm64.AppImage` (aarch64) ou `Desktools-2.1.0.AppImage` (x86_64)
- Velora Explorer : `explorer.js` indépendamment de l'architecture

Ce registre est consommé par deux fonctions : `_registerPrismApps` (gestion des `.desktop`) et `_launchOrDownloadApp` (lancement ou téléchargement à la demande).

---

## 6. Cycle de vie — `PrismExtension`

La classe `PrismExtension extends Extension` est le point d'entrée unique déclaré dans `extension.js`. L'instance reçoit l'objet `metadata` et expose `this.path`, `this.dir`, `this.getSettings()`.

### `enable()`

```
PrismExtension.enable()
 │
 ├── Chargement CSS
 │    └── St.ThemeContext → theme.load_stylesheet(stylesheet.css)
 │
 ├── new NetworkSetting(this)       → barre Wi-Fi / son / batterie (coin supérieur droit)
 ├── new MyDock(this)               → dock + MPRIS + AppTracker + SleepTracker
 ├── new AppLauncher()              → instanciation légère (UI créée à la demande)
 ├── new NotificationManager(this)  → interception notifications GNOME
 ├── new PrismWidgets()             → moteur de widgets bureau
 │
 ├── Gio.Settings('org.gnome.desktop.background')
 │    ├── Sauvegarde de l'URI d'origine dans this._originalWallpaperUri
 │    └── Application du fond d'écran PrismUI (this.dir → icons/interface/wallpaper/)
 │
 ├── Main.panel.hide()              → masque le panel natif
 ├── new ClipboardManager()         → démarre le polling presse-papier (1s)
 ├── _registerPrismApps(this)       → crée/met à jour les fichiers .desktop PRISM
 └── new HomeBar()                  → barre de 200×6px (visible si fenêtre maximisée)
```

**Stockage des instances :** toutes les instances sont sur `global.*` (`global.myDock`, `global.networkSetting`, `global.appLauncher`, `global.notificationManager`, `global.prismWidgets`, `global.clipboardManager`) sauf `this._homeBar` stockée sur l'instance de l'extension.

### `disable()`

```
PrismExtension.disable()
 ├── theme.unload_stylesheet(stylesheet.css)   → décharge le CSS
 ├── global.myDock.destroy()                   → retire le dock, déconnecte MPRIS
 ├── global.notificationManager.destroy()      → signaux + acteurs chrome
 ├── global.networkSetting.destroy()           → arrête NM/UPower/Gvc
 ├── global.clipboardManager.destroy()         → arrête le polling 1s
 ├── global.appLauncher.destroy()              → ferme le lanceur si ouvert
 ├── this._homeBar.destroy()                   → déconnecte les signaux fenêtres
 ├── global.prismWidgets.destroy()             → arrête tous les timers de widgets
 └── Main.panel.show()                         → restaure le panel natif
```

> Le fond d'écran d'origine (`this._originalWallpaperUri`) n'est pas restauré dans `disable()`. C'est un comportement voulu — l'extension remplace le fond définitivement tant qu'elle est active.

---

## 7. Module Dock — `MyDock`

**Fichier :** `extension.js` — classe `MyDock`  
**Rendu :** `Main.layoutManager._backgroundGroup`, centré horizontalement, 10px au-dessus du bas

### Construction (`_constructbar`)

Le dock est un `St.BoxLayout` horizontal. L'ordre de construction est fixe :

1. **Logo PRISM** (`addCustomIconMenu`) — clic court = lance l'AppLauncher, clic long ≥1s = ouvre le menu contextuel
2. **DeskTools** (`addCustomIcon`) — affiché **seulement si le binaire est présent** dans `System/Program/`. L'architecture est détectée via `uname -m` pour trouver le nom de fichier exact selon `PRISM_APPS['desktools'].getFileName(arch, version)`
3. **Apps épinglées** lues depuis GSettings (`dock-apps`) via `addAppIcon(desktop, true)`
4. **Séparateur** (`St.Widget` semi-transparent 2×30px) — inséré avant les apps non-épinglées, caché si aucune n'est présente
5. **Trackers** : `_initMediaTracker()`, `_initAppTracker()`, `_initSleepTracker()`

Le positionnement utilise un système de **debounce** : `notify::width` et `notify::height` ne déclenchent pas directement `_setPosition()` mais arment un `GLib.idle_add` unique (`_posIdleId`). Si plusieurs signaux arrivent en rafale, un seul repositionnement est effectué à la prochaine frame libre.

### Icône logo — `addCustomIconMenu`

Gère trois types d'entrées :

| Entrée | Durée | Action |
|---|---|---|
| Clic souris (bouton 1) | < 1000ms | Toggle `AppLauncher` + ferme les menus réseau |
| Appui long souris | ≥ 1000ms | Ouvre le menu contextuel `_toggleContextMenu` |
| Clic droit (bouton 3) | — | Ouvre le menu contextuel directement |
| Touch begin/end | Même logique | Compatible écran tactile |

La durée de l'appui est mesurée entre `button-press-event` et `button-release-event` via `Date.now()`.

### Menu contextuel — `_toggleContextMenu`

`CustomPopup` ancré sur l'icône logo, ouverture vers le haut. Auto-réinitialisation de la variable via `actor.connect('destroy', ...)`. Contient 9 entrées :

| Entrée | Icône | Action |
|---|---|---|
| Gérer les widgets | `view-app-grid-symbolic` | `global.prismWidgets._toggleWidgetMenu()` |
| Fonctionnalités PRISM | `software-update-available-symbolic` | `_openNewFunc()` |
| *(séparateur)* | | |
| Afficher le bureau | `user-desktop-symbolic` | Minimise toutes les fenêtres |
| Ajuster la fenêtre | `view-restore-symbolic` | `networkSetting._fitWindowToDock()` |
| Presse-papier | `edit-paste-symbolic` | `clipboardManager.toggleMenu()` |
| *(séparateur)* | | |
| Ajouter/modifier des logiciels | `list-add-symbolic` | `_openAppChooser()` |
| Informations & Mises à jour | `software-update-available-symbolic` | Lance `updater.js` via `gjs -m` |
| *(séparateur)* | | |
| Mettre en veille | `weather-clear-night-symbolic` | `systemctl suspend` |
| Se déconnecter | `system-log-out-symbolic` | `gnome-session-quit --logout` |
| Redémarrer | `system-reboot-symbolic` | `gnome-session-quit --reboot` |
| Arrêter | `system-shutdown-symbolic` | `gnome-session-quit --power-off` |

**Lancement de l'updater :** `updater.js` est lancé comme processus GTK4 complètement séparé via `Gio.Subprocess.new(['gjs', '-m', updaterPath, this._ext.path], ...)`. Il reçoit le chemin de l'extension en argument CLI et tourne de manière totalement indépendante de GNOME Shell.

### Tracker de lecture média — `_initMediaTracker`

Au démarrage, scanne le bus D-Bus session en appelant `ListNames` de manière **synchrone** pour détecter un lecteur déjà actif. Simultanément, s'abonne au signal `NameOwnerChanged` pour détecter les lecteurs qui démarreront plus tard.

Quand un nom `org.mpris.MediaPlayer2.*` apparaît avec un nouveau propriétaire (`newOwner !== ''`), `_connectToPlayer(playerName)` crée un `Gio.DBusProxy` asynchrone sur l'interface `org.mpris.MediaPlayer2.Player`.

**`_connectToPlayer`** lie deux signaux sur le proxy :
- `g-properties-changed` → `updateUI()` mis à jour à chaque changement de propriété
- `notify::g-name-owner` → détecte la fermeture du lecteur (nom propriétaire passe à vide), appelle `_collapseAppIcon` et libère le proxy

`updateUI()` récupère `PlaybackStatus`, `Metadata` (titre, durée), `DesktopEntry` et `Position` depuis le cache D-Bus. Si le statut est `Playing` ou `Paused`, appelle `_expandAppIcon(targetApp, title, isPlaying, length, position)`.

**`_expandAppIcon`** localise l'icône correspondante dans le dock en comparant `_appId.toLowerCase()` avec `cleanAppName`. Elle :
1. Met à jour le label titre et l'icône play/pause
2. Ajoute la classe CSS `media-active-capsule` et affiche `_mediaBox` avec un fondu de 300ms
3. Lance une **animation de défilement** (`slideLeft` / `slideRight`) si le titre dépasse la largeur du conteneur. La vitesse est proportionnelle à la distance (`speed = distance * 100`ms). Un timer de 1500ms démarre le défilement initial, puis il alterne indéfiniment avec une pause de 1000ms entre chaque sens.
4. Lance un **timer de progression** (`_progressTimerId`) si la lecture est active : toutes les secondes, `simulatedPosition += 1_000_000` (microsecondes MPRIS) et recalcule la largeur de `_progressFill` selon `position / length * trackWidth`.

**`_collapseAppIcon`** annule `_progressTimerId`, puis anime `_mediaBox.opacity → 0` (200ms). Dans le callback `onComplete`, détruit l'icône si elle est temporaire ou si l'app n'est plus en état `RUNNING`.

### Tracker d'applications — `_initAppTracker`

Au démarrage, liste `Shell.AppSystem.get_default().get_running()` et crée une icône non-épinglée pour chaque app qui n'a pas déjà d'icône dans le dock. Puis connecte `app-state-changed` pour le suivi en temps réel.

Règles de gestion des icônes :

| État → | `RUNNING` | `STOPPED` |
|---|---|---|
| Icône existante | Met à jour les points (`_updateAppDots`) | Détruit si non-épinglée ET pas de capsule média visible |
| Pas d'icône | Crée `addAppIcon(id, false)` | — |
| Icône épinglée à l'arrêt | — | Met à jour les points (n'est pas détruite) |

### Tracker de veille — `_initSleepTracker`

S'abonne au signal `PrepareForSleep` du bus **système** D-Bus (`org.freedesktop.login1.Manager`). Quand `goingToSleep` repasse à `false` (réveil du PC), attend 2 secondes via un timer puis appelle `_refreshRunningApps()` pour resynchroniser le dock avec l'état réel des applications (certaines peuvent s'être fermées ou ouvertes pendant la veille).

### Points de présence — `_updateAppDots`

Chaque icône dispose d'un `_dotContainer` (`St.BoxLayout` avec `translation_y: 30`) superposé à l'image via un `St.Widget` avec `Clutter.BinLayout`. Affiche entre 1 et 4 points blancs (classe `app-dot`), un de plus par fenêtre visible (`!w.is_skip_taskbar()`). Si plus de 4 fenêtres, affiche `+` à la place du 5ème point. Reconstruit entièrement à chaque changement via `windows-changed` et `_updateAppDots`.

### Gestion des fenêtres — `_showWindowSelectMenu`

Ouvert quand un clic sur une icône trouve plusieurs fenêtres. Construit un `St.BoxLayout` avec un bouton par fenêtre (titre tronqué à 40 caractères) + un bouton "Nouvelle fenêtre". Positionné au-dessus de l'icône via `GLib.idle_add` après calcul de la hauteur réelle. Fermeture au clic extérieur via `global.stage.connect('captured-event')`.

### Gestionnaire d'apps — `_openAppChooser`

`ModalDialog` à deux colonnes de 350px chacune, haute de 80% de l'écran :

- **Gauche "Logiciels disponibles"** : toutes les apps `should_show()` non-épinglées, triées alphabétiquement. La liste est mise en cache dans `this._cachedAllApps` dès l'ouverture et libérée à la fermeture (`closed` signal). Le contenu est chargé de manière **asynchrone** via `GLib.idle_add` après l'ouverture de la boîte, pour éviter le freeze.
- **Droite "Dans le Dock"** : apps épinglées avec boutons ▲▼ (`_moveAppInDock`) et bouton de suppression rouge.

`_moveAppInDock(index, direction)` échange deux entrées dans le tableau GSettings puis appelle `_reloadDockIcons()` et `_refreshAppManagerUI()` immédiatement.

`_reloadDockIcons()` détruit uniquement les enfants du dock ayant un `_appId` (préserve le logo, DeskTools et le séparateur), puis recrée les icônes dans le nouvel ordre.

---

## 8. Module Barre Système — `NetworkSetting`

**Fichier :** `extension.js` — classe `NetworkSetting`  
**Rendu :** `Main.layoutManager._backgroundGroup`, 23px depuis le haut, 20px du bord droit

Barre horizontale de 3 boutons icônes (Wi-Fi, volume, batterie). Les sous-systèmes matériels sont initialisés **500ms après la construction** pour ne pas bloquer le démarrage.

### Wi-Fi (`_initNetwork` → `NM.Client`)

`NM.Client.new(null)` synchrone. Écoute `notify::primary-connection` et `notify::connectivity`. Icônes : 5 états (aucune connexion, filaire, Wi-Fi 0/1/2/3 barres).

### Audio (`_initAudio` → `Gvc.MixerControl`)

`Gvc.MixerControl` nommé `PrismUI Volume Control`. Écoute `state-changed` pour attendre l'apparition du stream par défaut. Marque le stream `_prismConnected = true` avant de connecter `notify::volume` et `notify::is-muted` pour éviter les connexions doubles. Icônes : muet, < 50%, ≥ 50%.

Le menu principal contient un **slider de volume** (classe `Slider.Slider`, contrôlé via `stream.volume` / `stream.push_volume()`) et un **slider de luminosité** connecté à `org.gnome.SettingsDaemon.Power.Screen` via D-Bus.

### Batterie (`_initPower` → `UPowerGlib.Client`)

`UPowerGlib.Client.new_full(null)`. Écoute `notify::display-device`. Polling de secours toutes les 2 secondes. 5 niveaux (< 10%, < 35%, < 60%, < 85%, plein) + suffixe `-ch` si en charge.

### Bluetooth (`_blemenu` → `Gio.Subprocess`)

Dialogue direct avec `bluetoothctl` (sans API D-Bus). Vérifie d'abord `systemctl is-active bluetooth`. Parse la sortie en texte brut pour lister les appareils couplés.

---

## 9. Module Lanceur — `AppLauncher` & `LocalSearchEngine`

**Fichier :** `intelligentsearchbar.js`  
**Rendu :** `Main.uiGroup` (overlay plein écran, créé uniquement à la première ouverture)

### `LocalSearchEngine`

**Phase 1 — Applications :** `Gio.AppInfo.get_all()` filtré par `should_show()`. Score : distance de Levenshtein normalisée (1 − distance/maxLength) + bonus +0.5 si début de chaîne. Apps avec "settings" dans l'ID ou les catégories → type `SEARCH_TYPE.SETTING`.

**Phase 2 — Fichiers :** scan asynchrone via `Gio.File.enumerate_children_async` sur `Documents`, `Bureau`, `Downloads`, `Téléchargements`. Max 3 scans simultanés (`activeScans < 3`), profondeur max 4. Type MIME détecté via `Gio.content_type_guess()`.

**Phase 3 — Web :** entrée systématique "Rechercher sur Google" (score 0.1) ouvrant `https://www.google.com/search?q=...`.

### `AppLauncher`

Overlay 900×760px centré dans `Main.uiGroup`. Fond transparent pour capturer les clics extérieurs. Focus clavier sur la barre de recherche après 100ms.

**Mode grille** (sans texte) : 24 apps/page en grille 6 colonnes, navigation ◀/▶.  
**Mode liste** (avec texte) : debounce 400ms, max 9 résultats, filtres par catégorie (Tout/Apps/Paramètres/Fichiers/Dossiers/Web).

---

## 10. Module Notifications — `NotificationManager`

**Fichier :** `notificationsys.js`  
**Rendu :** Chrome GNOME (toasts) + `_backgroundGroup` (icône cloche)

Écoute `Main.messageTray.connect('source-added')`. Pour chaque notification interceptée : affiche un toast PrismUI, puis **détruit la notification native** via `GLib.idle_add` pour éviter les doublons.

**Toast :** `St.Widget` + `Clutter.BinLayout` superposant le contenu et un overlay `✕` visible au survol. Auto-destruction après 5s. Son via `global.display.get_sound_player().play_from_theme('message')`.

**Mode Ne Pas Déranger :** `showNotification()` retourne immédiatement si `dndEnabled = true`.

**Icône cloche :** positionnement dynamique — à gauche de `global.barReseau.container` si disponible, sinon 10px du bord droit. Recalculé à chaque `notify::allocation` et `monitors-changed`.

---

## 11. Module Presse-papier — `ClipboardManager`

**Fichier :** `clipboard.js`  
**Rendu :** Chrome GNOME (menu 300×400px, centré à 70% de la hauteur)

**Polling** via `GLib.timeout_add_seconds(1)`. Ignore textes vides, identiques au précédent ou uniquement composés d'espaces. Historique de 15 entrées maximum, dédupliqué avant insertion.

**Détection de clic extérieur** : utilise `captured-event` sur `global.stage` avec détection par coordonnées transformées (`get_transformed_position` + `get_transformed_size`) — plus robuste que `contains()` car fonctionne même si l'acteur cible est dans une autre couche de rendu. Gère aussi les événements tactiles (`Clutter.EventType.TOUCH_BEGIN`).

`_restoreItem` restaure le texte via `St.Clipboard.set_text()` et affiche un OSD "Copié !".

---

## 12. Module Widgets Bureau — `PrismWidgets`

**Fichier :** `desktopWidgets.js` — classe `PrismWidgets`  
**Rendu :** `_backgroundGroup` (widgets) + Chrome GNOME (menu de sélection)

### Constantes

| Constante | Valeur | Usage |
|---|---|---|
| `LONG_PRESS_TIME` | 1500ms | Durée non utilisée directement (vestige) |
| `WIDGET_EDIT_TIME` | 800ms | Appui long pour activer le mode édition |
| `GRID_SIZE` | 25px | Pas de la grille de snapping |

### Registre — `BUILTIN_WIDGETS`

9 widgets disponibles (tableau de manifestes) :

| Widget | id | Grille | Source de données |
|---|---|---|---|
| Horloge | `clock-widget` | 14×8 | `js` (inline) |
| Raccourci | `shortcut-widget` | 4×4 | `shortcut` (sélecteur d'app) |
| Système (RAM/CPU) | `sys-widget` | 8×6 | `file` `/proc/meminfo`, `/proc/stat` |
| Batterie | `bat-widget` | 6×6 | `file` `/sys/class/power_supply/BAT0/*` |
| Météo compacte | `weather-widget` | 8×6 | `http` `wttr.in` (300s) |
| Météo grande | `weather-widget-big` | 10×8 | `http` `wttr.in` JSON (300s) |
| Crypto (BTC/ETH) | `crypto-widget` | 8×6 | `http` Binance API (60s) |
| Devises (EUR/USD/CHF) | `forex-widget` | 8×6 | `http` exchangerate-api.com (3600s) |
| Température CPU | `cpu-temp-widget` | 6×6 | `file` `/sys/class/thermal/thermal_zone0/temp` |

Chaque manifeste définit :
- **`ui`** : arbre JSON décrivant la structure visuelle (`box`, `label`, `icon`, `progress`)
- **`bindings`** : liaisons données → acteurs UI avec `targetId`, `targetProp`, `interval`, `sourceType`, `process`

### Moteur de binding — `_buildWidgetFromManifest`

Construit l'UI via `_buildUIFromSchema` (récursif). Maintient un dictionnaire `refs` (id → acteur).

Pour chaque binding, installe un `GLib.timeout_add_seconds(interval)` qui exécute `updateData()` :

- **`js`** : exécute `new Function(bind.process)()` directement dans le thread GJS
- **`file`** : lit le fichier via `GLib.file_get_contents()`, passe les données à `new Function('data', bind.process)(rawData)`
- **`cmd`** : `Gio.Subprocess` avec `STDOUT_PIPE`, `communicate_utf8_async` — résultat appliqué de manière asynchrone. En cas d'erreur, affiche `"Erreur ⚠️"`
- **`http`** : `this._httpSession.send_and_read_async()` (session Soup 3 partagée, user-agent `curl/7.81.0`). En cas d'erreur HTTP ou réseau, affiche le code d'erreur dans le widget

Le premier appel à `updateData()` est effectué **immédiatement** à la création du widget (avant le premier tick du timer). Tous les timer IDs sont stockés dans `box._timerIds` et annulés via `box.connect('destroy', ...)`.

**Widget CPU (calcul différentiel) :** utilise `globalThis.prevCpuTotal` / `globalThis.prevCpuIdle` pour stocker les valeurs du tick précédent entre les appels. Le premier appel retourne `'CPU : Calcul...'` et initialise les valeurs de référence.

**Widget raccourci (`shortcut`) :** logique spéciale. `setupShortcutBinding()` configure l'icône et le label de l'app. Un clic court sur le widget lance l'app (`Gio.DesktopAppInfo.launch()`). Si aucune app n'est encore choisie, ouvre `_openShortcutAppPicker`.

### Menu de sélection — `_buildWidgetMenu` / `_toggleWidgetMenu`

Menu créé dans le chrome GNOME. Utilise `Clutter.FlowLayout` (grille auto-renvoyante à la ligne). La largeur est fixée à 80% de l'écran ; la hauteur est calculée dynamiquement via `get_preferred_height(maxWidth)`. Positionné 100px au-dessus du bas du moniteur.

Ouverture avec `ease({ opacity: 255, duration: 250 })`, fermeture avec `ease({ opacity: 0, duration: 200 })`.

### Drag & drop depuis le menu — `_createDraggableMenuItem`

Chaque bouton du menu démarre un drag à `button-press-event` ou `TOUCH_BEGIN`. Un fantôme `St.BoxLayout` (classe `prism-widget-ghost-box`) est créé dans `Main.uiGroup` et suit le curseur via `global.stage.connect('captured-event')`.

**Détection de collision** : `_checkCollision(x, y, w, h)` vérifie si la zone cible chevauche l'AABB (axis-aligned bounding box) d'un widget existant. Si collision, le fantôme passe en rouge (`rgba(255, 50, 50, 0.4)` + bordure `#ff3333`). Au relâchement, si collision détectée → OSD d'erreur + annulation. Sinon → widget réel créé, positionné, rendu interactif, sauvegarde du layout.

**Protection contre le clic court :** si le relâchement intervient dans les 300ms suivant le `startDrag`, l'événement est propagé sans créer de widget (évite la création accidentelle au simple clic).

### Interactions sur les widgets — `_makeWidgetInteractive`

Chaque widget placé reçoit cet ensemble d'écouteurs :

| Entrée | Durée | Action |
|---|---|---|
| Clic court | < `WIDGET_EDIT_TIME` | Lance l'app (raccourci) ou sélectionne une app si non configuré |
| Appui long | ≥ 800ms | `_enableEditMode(widget)` |
| Drag en mode édition | — | `_startWidgetDrag(widget, x, y)` avec snapping à 25px |
| Mouvement > 10px pendant appui | — | `cancelPress()` — évite l'édition accidentelle |
| Clic sur fond du bureau | — | `_disableAllEditModes()` |

### Persistance — `_saveLayout` / `_loadLayout`

Fichier `~/.config/prism-widgets-layout.json`. Format :
```json
[
  { "type": "sys-widget", "x": 50, "y": 100 },
  { "type": "shortcut-widget", "x": 200, "y": 100, "appId": "org.gnome.Files.desktop" }
]
```
`_saveLayout()` est appelé après chaque dépôt ou suppression de widget. `_loadLayout()` est appelé dans le constructeur.

---

## 13. Module Barre Home — `HomeBar`

**Fichier :** `extension.js` — classe `HomeBar`  
**Rendu :** Chrome GNOME (barre 200×6px, centrée, 4px au-dessus du bas)

Barre **invisible par défaut** (`opacity: 0`). Apparaît uniquement quand une fenêtre est maximisée dans les deux axes sur le workspace actif.

### Suivi de fenêtres

`_setupWindowTracking` connecte :
- `notify::focus-window` sur `global.display` → `_evaluateState()`
- `workspace-switched` sur `global.workspace_manager` → `_evaluateState()`

`_evaluateState()` déconnecte les signaux de l'ancienne fenêtre focalisée, reconnecte `size-changed` et `notify::minimized` sur la nouvelle, puis appelle `_applyVisibility()`.

`_applyVisibility()` filtre `workspace.list_windows()` (exclut `is_skip_taskbar()` et `minimized`) et cherche si l'une est maximisée sur les deux axes. Affichage/masquage via `ease({ opacity, duration: 200 })`.

### Interactions — `_setupEvents`

La gestion des clics souris et tactile est unifiée dans `handleRelease(releaseY)` :

1. Si `pressY - releaseY > 10` → glissement vers le haut → `_minimizeAll()` immédiatement
2. Sinon, mesure le temps depuis le dernier clic :
   - < 300ms depuis le dernier clic → **double clic** → annule le timer du simple clic → `Main.overview.toggle()`
   - ≥ 300ms → **simple clic** → arme un timer de 300ms → si pas de 2ème clic → `_minimizeAll()`

---

## 14. Module Mises à jour — `updater.js`

**Fichier :** `updater.js` — application GTK4 autonome, lancée comme sous-processus séparé via `gjs -m updater.js <chemin_extension>`  
**Dépendances :** `Gtk 4`, `GLib`, `Gio`, `Soup 3`

L'updater est **complètement découplé** de GNOME Shell. Il reçoit le chemin de l'extension via `ARGV[0]` et accède directement au système de fichiers sans aucune API GNOME Shell.

### Fenêtre principale

Affiche la version locale lue depuis `<extension_path>/metadata.json` (champs `version`, `sub-version`, `title-version`). Deux boutons : "Vérifier l'intégrité" et "Vérifier les mises à jour".

### Machine à états

Le bouton principal change de libellé et d'action selon `appState` :

| État | Libellé | Action au clic |
|---|---|---|
| `CHECK` | "Vérifier les mises à jour" | `runCheck()` |
| `UPDATE` | "Télécharger et Installer" ou "Lancer la réparation" | `performUpdate()` |
| `CLOSE` | "Fermer" | `window.close()` |
| `REBOOT` | "Redémarrer la session" | `gnome-session-quit --logout --no-prompt` |

### Vérification d'intégrité

Exécuté dans `GLib.idle_add` pour ne pas geler l'UI. Parcourt `FILES_TO_UPDATE`, vérifie l'existence et la taille (`query_info('standard::size')`) de chaque fichier. Si des fichiers sont corrompus ou manquants → passe en état `UPDATE` avec le bouton en classe CSS `destructive-action`.

### Vérification de version (`runCheck`)

Télécharge `metadata.json` depuis `https://raw.githubusercontent.com/hugodev-teck/IUI/refs/heads/gnome-48-migration/`. Compare `version` (comparaison numérique stricte) et `sub-version` (comparaison de chaînes). Si mise à jour disponible → état `UPDATE`. Sinon → état `CLOSE`.

### Téléchargement et installation (`performUpdate` — async)

1. Nettoie `~/.cache/prism-update/` et recrée le dossier
2. Télécharge les fichiers **séquentiellement** avec feedback visuel (label mis à jour à chaque fichier)
3. Déplace chaque fichier du cache vers l'extension. Crée les sous-dossiers parents si nécessaires (`make_directory_with_parents`). Utilise `Gio.File.delete()` + `Gio.File.move()` (au lieu de `OVERWRITE` direct) pour un remplacement propre
4. Nettoie le cache
5. Passe en état `REBOOT`

`downloadFile(filename, tempDir)` retourne une `Promise`. Les fichiers sont téléchargés en séquentiel (boucle `for` + `await`) pour éviter de surcharger le réseau. La réponse HTTP est écrite directement avec `replace_contents(bytes.get_data(), ...)`.

---

## 15. Utilitaire — `CustomPopup`

**Fichier :** `extension.js` — classe `CustomPopup`  
**Rendu :** `Main.uiGroup`

Menu contextuel générique. Crée un `St.BoxLayout` vertical dans `Main.uiGroup`. Chaque item est un `St.Button` avec une icône et un label.

`openUpwards(open = true)` positionne le menu centré sur l'ancre et ajusté vers le haut. La hauteur réelle est calculée après un `Mainloop.idle_add` (après que le layout pass ait eu lieu). Protection contre les débordements d'écran.

Fermeture au clic extérieur via `global.stage.connect('captured-event')`, avec detection par coordonnées transformées. Un clic sur l'acteur ancre est ignoré pour éviter la fermeture immédiate à l'ouverture.

---

## 16. Utilitaire — `_registerPrismApps`

**Fichier :** `extension.js` — fonction autonome  

Génère les fichiers `.desktop` dans `~/.local/share/applications/` pour les apps du registre `PRISM_APPS` **effectivement installées** dans `System/Program/`.

Logique :
1. Détecte l'architecture via `uname -m`
2. Pour chaque app du registre, construit le chemin du binaire et vérifie son existence
3. Nettoie les anciens fichiers `.desktop` dont le nom (basé sur l'ancien ID) ne correspond plus au `desktopId` actuel
4. Si l'app n'est **pas** installée → supprime le `.desktop` existant et passe à la suivante
5. Si l'app **est** installée → génère le contenu du `.desktop`. Compare avec le fichier existant avant d'écrire : **n'écrit que si le contenu a changé** pour éviter de déclencher inutilement le rafraîchissement du menu d'applications GNOME

`Exec` est adapté au type de fichier : `"chemin/fichier.AppImage"` ou `gjs "chemin/explorer.js"`.

---

## 17. Utilitaire — `_launchOrDownloadApp`

**Fichier :** `extension.js` — fonction autonome  

Appelée depuis `_openNewFunc()` quand l'utilisateur veut accéder à une app PRISM.

1. Résout le nom du fichier via `PRISM_APPS[appId].getFileName(arch, version)`
2. Si le fichier existe localement → `checkAndLaunch()` vérifie les permissions d'exécution (`.AppImage` → `chmod +x` puis `Gio.Subprocess`), puis appelle `_registerPrismApps` avant de lancer
3. Si le fichier n'existe pas → ouvre une `ModalDialog` de progression et télécharge depuis `https://github.com/<repo>/releases/download/<tag>/<filename>` via `Soup.Session.send_and_read_async`. Le fichier est écrit avec `replace_contents`, puis `chmod +x` et lancement immédiat

---

## 18. Moteur de rendu et gestion mémoire

### Prévention des crashes d'allocation Clutter

Toutes les fonctions `_setPosition()` commencent par `if (!container || container.width <= 0) return`. Les positionnements initiaux passent par `GLib.idle_add` (prochaine frame libre, après le layout pass).

Le dock utilise un **debounce de repositionnement** : `notify::width` et `notify::height` ne déclenchent pas `_setPosition()` directement, mais arment un `idle_add` unique (`_posIdleId`) qui s'auto-annule.

### Protection contre les boucles de redessin

Les comparaisons de positions sont arrondies (`Math.round(x) !== targetX`) avant d'appeler `set_position()`. Si les positions sont identiques, aucun appel n'est effectué, évitant les boucles `notify::allocation → _setPosition → set_position → notify::allocation`.

### Déconnexion systématique des signaux

Chaque signal est stocké dans une propriété nommée (`_monitorId`, `_focusId`, `_nameOwnerChangedId`, `_appStateChangedId`, `_sleepSignalId`, `_mediaSignalId`, `_mediaOwnerId`). La méthode `destroy()` de chaque classe déconnecte tous ses signaux explicitement.

Chaque icône de dock connecte `destroy` sur elle-même pour nettoyer son timer de hover (`icon._hoverTimer`) et marquer `icon._prismDestroyed = true` pour que `_updateAppDots` ne tente pas de l'accéder après destruction.

### ESM et imports statiques

En ESM, les imports de modules internes (`notificationsys.js`, `intelligentsearchbar.js`, etc.) sont **statiques** et résolus au démarrage, avant `enable()`. Si un fichier est absent ou syntaxiquement invalide, GNOME Shell refuse de charger l'extension entièrement. C'est pour cette raison que l'updater (`updater.js`) est un processus GTK4 séparé : il peut réparer les fichiers sans être lui-même dépendant de leur existence.

---

## 19. Feuille de style CSS

**Fichier :** `stylesheet.css`  
**Chargement :** manuel via `St.ThemeContext.get_theme().load_stylesheet()` dans `enable()`, déchargé dans `disable()`

Le moteur St de GNOME rejette les valeurs en pourcentage. Toutes les dimensions sont en `px` ou déléguées au JavaScript.

| Module | Classes principales |
|---|---|
| Dock | `.my-dock-container`, `.app-icon`, `.dock-separator`, `.app-dot`, `.app-dot-container`, `.dock-tooltip`, `.media-dock-box`, `.media-control-btn`, `.media-play-btn`, `.media-progress-bar`, `.media-progress-fill`, `.media-active-capsule` |
| Barre système | `.network-settings-container`, `.feature-button-net`, `.net-box` |
| Notifications | `.notification-box-container`, `.notification-container`, `.notification-history-container`, `.notification-box`, `.notification-hover-overlay` |
| Horloge | `.clock-container`, `.clock-label`, `.date-label` |
| Lanceur | `.prism-launcher-dialog`, `.prism-launcher-card`, `.prism-launcher-list-item`, `.prism-filter-btn`, `.prism-launcher-navbar` |
| Presse-papier | `.clipboard-menu`, `.clipboard-item`, `.clipboard-clear-btn`, `.clipboard-empty` |
| Widgets | `.prism-widget-box`, `.prism-widget-df-meteo-box`, `.prism-widget-menu`, `.prism-widget-menu-btn`, `.prism-widget-editing`, `.prism-widget-delete-btn`, `.prism-widget-ghost-box` |
| Menus | `.dock-context-menu`, `.prism-app-manager-dialog`, `.prism-window-menu` |
| HomeBar | `.prism-home-bar` |