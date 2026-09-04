# PrismUI — IUI : Documentation Technique Complète

**UUID :** `prism@dock.ui`  
**Version :** 1.3 (Pre-release Bêta)  
**Licence :** [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/legalcode.en)  
**Compatibilité GNOME Shell :** 43.9+

---

## Table des matières

1. [Vue d'ensemble de l'architecture](#1-vue-densemble-de-larchitecture)
2. [Arborescence du projet](#2-arborescence-du-projet)
3. [Dépendances et bibliothèques](#3-dépendances-et-bibliothèques)
4. [Cycle de vie : `enable()` et `disable()`](#4-cycle-de-vie--enable-et-disable)
5. [Module Dock — `MyDock`](#5-module-dock--mydock)
6. [Module Barre Système — `NetworkSetting`](#6-module-barre-système--networksetting)
7. [Module Horloge — `TimeMachine`](#7-module-horloge--timemachine)
8. [Module Lanceur — `AppLauncher` & `LocalSearchEngine`](#8-module-lanceur--applauncher--localsearchengine)
9. [Module Notifications — `NotificationManager`](#9-module-notifications--notificationmanager)
10. [Module Presse-papier — `ClipboardManager`](#10-module-presse-papier--clipboardmanager)
11. [Module Barre Home — `HomeBar`](#11-module-barre-home--homebar)
12. [Module Mises à jour OTA — `UpdateManager`](#12-module-mises-à-jour-ota--updatemanager)
13. [Utilitaire — `CustomPopup`](#13-utilitaire--custompopup)
14. [Utilitaire — `AboutDialog`](#14-utilitaire--aboutdialog)
15. [Moteur de rendu et gestion mémoire](#15-moteur-de-rendu-et-gestion-mémoire)
16. [Feuille de style CSS](#16-feuille-de-style-css)
17. [Installation et débogage](#17-installation-et-débogage)

---

## 1. Vue d'ensemble de l'architecture

IUI est un environnement de bureau complet implémenté sous forme d'extension GNOME Shell. Il **remplace** l'interface native (Panel, Dash, système de notifications) par ses propres composants, tous rendus dans le groupe d'arrière-plan (`Main.layoutManager._backgroundGroup`) ou dans le chrome GNOME (`Main.layoutManager.addChrome`).

L'extension repose sur **8 classes indépendantes** instanciées par `extension.js` lors de l'activation. Chaque classe gère son propre cycle de vie (signaux, timers, acteurs Clutter) et expose une méthode `destroy()` qui nettoie toutes ses ressources.

```
┌─────────────────────────────────────────────────────────────┐
│                      GNOME Shell Process                    │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                   _backgroundGroup                   │   │
│  │   MyDock   NetworkSetting   TimeMachine   NotifBox   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                  Chrome Layer                        │   │
│  │      NotifContainer   HistoryContainer   Tooltip     │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                    uiGroup                           │   │
│  │     AppLauncher Overlay    CustomPopup    AppChooser │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  Panel GNOME natif : MASQUÉ (Main.panel.hide())             │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Arborescence du projet

```
prism@dock.ui/
├── extension.js               # Chef d'orchestre : MyDock, NetworkSetting, HomeBar,
│                              #   UpdateManager, CustomPopup, AboutDialog, enable/disable
├── intelligentsearchbar.js    # LocalSearchEngine (Levenshtein + I/O asynchrone)
│                              #   + AppLauncher (UI du lanceur paginé)
├── notificationsys.js         # NotificationManager : interception des notifs GNOME,
│                              #   toasts PrismUI, panneau d'historique
├── time.js                    # TimeMachine : horloge + date en arrière-plan
├── clipboard.js               # ClipboardManager : polling + menu historique
├── stylesheet.css             # Styles St/Clutter (valeurs absolues uniquement)
├── metadata.json              # Déclaration GNOME Shell
├── schemas/
│   └── org.gnome.shell.extensions.pdock.gschema.xml
└── icons/
    ├── logo.png
    ├── dt.png
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
| `Clutter` | Animations (`ease`), alignements, layout managers, événements |
| `GLib` | Timers (`timeout_add`, `source_remove`), chemins de fichiers |
| `Gio` | Fichiers, icônes, `AppInfo`, `Settings`, sous-processus, réseau |
| `GObject` | Héritage GObject pour `AppLauncher` et `TimeMachine` (ancienne version) |
| `Meta` | Accès aux `Meta.Window` (maximisation, focus, minimisation) |
| `Shell` | `AppSystem`, `WindowTracker` |
| `NM` | Client NetworkManager — état Wi-Fi, connexions actives |
| `UPowerGlib` | Niveau de batterie, état de charge |
| `Gvc` | Contrôle du volume via `MixerControl` |
| `Soup` | Requêtes HTTP pour les mises à jour OTA |
| `Pango` | Ellipsis et retour à la ligne dans les labels de notifications |
| `ModalDialog` | Boîte de dialogue de téléchargement dans `UpdateManager` |

**Commandes système exécutées via sous-processus :**
- `bluetoothctl` — état et liste des périphériques Bluetooth
- `systemctl is-active bluetooth` — vérification du service
- `gnome-session-quit` — extinction / déconnexion

---

## 4. Cycle de vie : `enable()` et `disable()`

### `enable()`

```
enable()
 ├── new NetworkSetting()         → barre système droite (Wi-Fi, son, batterie)
 ├── new MyDock()                 → dock centré en bas
 ├── new TimeMachine()            → horloge en arrière-plan
 ├── new AppLauncher()            → lanceur d'applications (instantiation légère)
 ├── new NotificationManager()    → interception des notifications GNOME
 ├── notificationManager.showNotification(...)  → toast de démarrage
 ├── Gio.Settings('org.gnome.desktop.background')
 │    ├── sauvegarde originalWallpaperUri
 │    └── applique le fond d'écran PrismUI
 ├── Main.panel.hide()            → masque le panel GNOME natif
 ├── new Clipboard.ClipboardManager()  → démarre le polling du presse-papier
 ├── new UpdateManager().ensureIntegrity()  → vérifie les fichiers manquants
 ├── GLib.timeout_add(1000ms)     → ferme l'overview si ouvert au démarrage
 └── new HomeBar()                → barre invisible en bas (visible si fenêtre maximisée)
```

**Toutes les instances sont stockées sur `global.*`** (`global.myDock`, `global.networkSetting`, `global._timeMachine`, `global.appLauncher`, `global.clipboardManager`) sauf `notificationManager` et `homeBar` qui sont des variables de module.

### `disable()` — Politique de destruction complète

L'ordre de destruction est intentionnel : les éléments visuels sont détruits avant les services.

```
disable()
 ├── GLib.source_remove(closeOverviewTimeout)   → annule le timer si encore en attente
 ├── global.myDock.destroy()                    → retire le dock du backgroundGroup
 ├── notificationManager.destroy()              → déconnecte les signaux, retire les acteurs chrome
 ├── global.networkSetting.destroy()            → arrête les clients NM/UPower/Gvc
 ├── global._timeMachine.destroy()              → arrête le timer 60s, retire l'horloge
 ├── global.appLauncher.destroy()               → ferme le lanceur si ouvert
 ├── global.clipboardManager.destroy()          → arrête le polling 1s
 ├── homeBar.destroy()                          → déconnecte les signaux de fenêtres
 └── Main.panel.show()                          → restaure le panel GNOME natif
```

> ⚠️ Le fond d'écran d'origine (`originalWallpaperUri`) n'est pas restauré dans `disable()`. C'est un comportement voulu — l'extension remplace le fond définitivement tant qu'elle est active.

---

## 5. Module Dock — `MyDock`

**Fichier :** `extension.js` — classe `MyDock`  
**Rendu :** `Main.layoutManager._backgroundGroup`

### Construction

Le dock est un `St.BoxLayout` horizontal. Sa construction suit cet ordre fixe :
1. Icône logo PrismUI (`addCustomIconMenu`) — clic court = toggle du lanceur, clic long 3s = extinction
2. Icône DeskTools (`addCustomIcon`) — lance l'image de DeskTools officiel
3. Applications épinglées lues depuis GSettings (`dock-apps`) via `addAppIcon(desktopFile)`

Le positionnement est centré horizontalement et aligné 10px au-dessus du bas de l'écran. Il utilise un **guard de dimension** : `if (container.width <= 0) return` pour éviter le crash d'allocation Clutter.

### Icônes d'applications (`addAppIcon`)

Chaque icône d'application installe 4 écouteurs d'événements :

- **`enter-event`** (×2) : affiche le tooltip (nom de l'app) et démarre un timer de 1 seconde pour afficher la liste des fenêtres ouvertes.
- **`leave-event`** : annule le timer de hover et masque le tooltip.
- **`clicked`** : en mode normal → lance l'app via `appInfo.launch()`; en mode édition → appelle `_removeApp()`.

### Liste de fenêtres au survol (`_showWindowList`)

Déclenché après 1 seconde de survol. Filtre `global.get_window_actors()` en comparant la classe WM et le titre de la fenêtre avec le nom de l'application. Affiche un popup `St.BoxLayout` positionné au-dessus de l'icône avec la liste des fenêtres et un bouton de fermeture `✕` par ligne. Le popup reste visible tant que la souris est soit sur l'icône, soit sur le popup lui-même (grâce à un état partagé `insidePopup`/`insideIcon`).

### Mode édition (`_editMode`)

Activé depuis le menu contextuel. Toutes les icônes reçoivent la classe CSS `edit-mode-app`. Un clic sur une icône en mode édition appelle `_removeApp(desktopFile, icon)` qui met à jour GSettings et détruit l'acteur.

### Menu contextuel du dock (`_toggleContextMenu` → `CustomPopup`)

Accessible au clic droit sur l'icône logo. Ouvre un `CustomPopup` avec 4 entrées :
- **Ajuster la fenêtre** → `_fitWindowToDock()` sur `NetworkSetting`
- **Presse-papier** → `ClipboardManager.toggleMenu()`
- **Informations** → `AboutDialog`
- **Ajouter/modifier des logiciels** → `_openAppChooser()`

### Ajout d'application (`_openAppChooser`)

Ouvre un panneau scrollable centré sur l'écran affichant jusqu'à 150 applications (`Gio.AppInfo.get_all()`, triées alphabétiquement). Un clic sur une entrée appelle `_addApp(desktopFile)` qui persiste l'identifiant dans GSettings et appelle `addAppIcon()` à chaud pour mettre à jour le dock sans redémarrage.

---

## 6. Module Barre Système — `NetworkSetting`

**Fichier :** `extension.js` — classe `NetworkSetting`  
**Rendu :** `Main.layoutManager._backgroundGroup`, coin supérieur droit

La barre système est un `St.BoxLayout` horizontal contenant 3 boutons icônes : Wi-Fi, volume, batterie. Elle est positionnée 23px depuis le haut et 20px depuis le bord droit du moniteur.

L'initialisation des sous-systèmes matériels est **différée de 500ms** après la construction (`GLib.timeout_add`) pour éviter de bloquer le thread principal au démarrage.

### Réseau Wi-Fi (`_initNetwork` → `NM.Client`)

Instancie `NM.Client.new(null)` de manière synchrone. Écoute les signaux `notify::primary-connection` et `notify::connectivity` pour mettre à jour l'icône Wi-Fi parmi 5 états : pas de connexion, connexion filaire, Wi-Fi 0/1/2/3 barres.

Le menu Wi-Fi (`_wifimenu`) est asynchrone : il récupère l'état du Wi-Fi via `NM.Client`, liste les réseaux disponibles avec leur SSID et force du signal, et affiche un `PopupSwitchMenuItem` pour activer/désactiver le Wi-Fi.

### Audio (`_initAudio` → `Gvc.MixerControl`)

Instancie un `Gvc.MixerControl` nommé `PrismUI Volume Control`. Écoute `state-changed` pour détecter l'apparition du flux audio par défaut. Une fois le flux disponible, il s'abonne à `notify::volume` et `notify::is-muted` directement sur le stream (marqué `_prismConnected = true` pour éviter les connexions doubles). L'icône affiche 3 états : muet, volume < 50%, volume ≥ 50%.

### Batterie (`_initPower` → `UPowerGlib.Client`)

Instancie `UPowerGlib.Client.new_full(null)`. Écoute `notify::display-device` pour détecter les changements de périphérique d'affichage (déconnexion/connexion d'une batterie). Maintient un polling de secours toutes les 2 secondes via `GLib.timeout_add_seconds`. L'icône distingue 5 niveaux de charge (vide < 10%, quart < 35%, moitié < 60%, 3/4 < 85%, plein) et un suffixe `-ch` pour l'état en charge.

### Bluetooth (`_blemenu` → `Gio.Subprocess`)

N'utilise pas les API D-Bus Bluetooth. Dialogue directement avec `bluetoothctl` via `Gio.Subprocess` avec `STDOUT_PIPE | STDERR_PIPE`. Vérifie d'abord que le service `bluetooth` est actif via `systemctl is-active bluetooth`. Parse la sortie de `bluetoothctl devices` pour lister les appareils couplés et leur statut (connecté/non connecté).

### Menu principal (`_handleBarClick`)

Un clic sur n'importe lequel des 3 boutons ouvre le même menu principal (`menunet`) qui agit comme hub : il contient des boutons pour ouvrir le menu Wi-Fi, Bluetooth, volume et accessibilité. `_closeAllMenus()` est appelé avant chaque ouverture pour garantir qu'un seul menu est visible à la fois.

---

## 7. Module Horloge — `TimeMachine`

**Fichier :** `time.js` — classe `TimeMachine`  
**Rendu :** `Main.layoutManager._backgroundGroup`, centré horizontalement, 1/6 depuis le haut

### Positionnement

L'horloge utilise une stratégie à 3 niveaux pour garantir un centrage correct au démarrage :

1. **Immédiat** : `_updateClock()` peuple les labels au moment de la construction.
2. **Idle callback** : `GLib.idle_add` dans `_updateClock()` appelle `_setPosition()` à la prochaine frame libre (évite le crash d'allocation si la largeur n'est pas encore calculée).
3. **Timers différés** : deux timers à 500ms et 1500ms forcent un recalcul de position après que la police soit chargée et le layout stabilisé.

La fonction `_setPosition()` possède un guard : `if (clockContainer.width <= 0) return`. Elle utilise `monitor.x + monitor.y` comme base (compatible multi-moniteurs et VM).

### Mise à jour

Un timer `GLib.timeout_add_seconds(60)` tourne en boucle (`GLib.SOURCE_CONTINUE`). À chaque tick, il met à jour les deux labels et déclenche un `idle_add` pour repositionner si la largeur a changé (ex : passage de `09:59` à `10:00` qui change la largeur du texte). La date est formatée en français via `toLocaleString('fr-FR')`.

---

## 8. Module Lanceur — `AppLauncher` & `LocalSearchEngine`

**Fichier :** `intelligentsearchbar.js`  
**Rendu :** `Main.uiGroup` (overlay plein écran)

### `LocalSearchEngine`

Moteur de recherche local en deux phases :

**Phase 1 — Applications installées :** itère sur `Gio.AppInfo.get_all()` en filtrant `should_show()`. Pour chaque app, calcule un score via la distance de Levenshtein normalisée (1 − distance/maxLength). Ajoute un bonus de +0.5 si le nom commence par la requête. Un résultat est inclus si le nom contient la requête ou si le score dépasse 0.5.

**Phase 2 — Fichiers et dossiers :** scanne récursivement 4 dossiers utilisateur (`Documents`, `Bureau`, `Downloads`, `Téléchargements`). L'exploration est asynchrone via `Gio.File.enumerate_children_async` avec un maximum de 3 scans simultanés (`activeScans < 3`) et une profondeur maximale de 4 niveaux. Pour chaque fichier correspondant, `Gio.content_type_guess()` détermine le type MIME et l'icône associée.

**Phase 3 — Web :** ajoute systématiquement une entrée "Rechercher sur le Web" (score 0.1) qui ouvre `https://www.google.com/search?q=...` dans le navigateur par défaut.

Les résultats sont triés par score décroissant avant d'être retournés.

### `AppLauncher`

L'instanciation est légère (aucun acteur créé). L'overlay n'est construit que lors du premier appel à `toggle()` → `show()`.

**Construction de l'UI (`show()`) :**
- Un `Clutter.Actor` plein écran transparent est ajouté à `Main.uiGroup` comme couche de base.
- Un `St.Button` transparent couvrant tout l'écran capte les clics extérieurs et ferme le lanceur.
- Un panel central de 900×760px est centré sur l'écran.
- La barre de recherche (`St.Entry`) reçoit le focus clavier après 100ms via un timer.

**Mode grille (sans recherche) :** affiche les applications installées en grille de 6 colonnes, 24 apps par page. La pagination est gérée par `_currentPage` et des boutons ◀/▶.

**Mode liste (avec recherche) :** déclenché après un debounce de 400ms. Les résultats sont affichés sous forme de liste (max 9 entrées). Un clic sur un résultat lance l'app (`launch()`), ouvre le fichier (`launch_default_for_uri`) ou exécute une action web.

**Fermeture :** la touche Escape ou le clic sur le fond transparent appelle `hide()` qui détruit `_overlayBox` et annule le timer de debounce si en cours.

---

## 9. Module Notifications — `NotificationManager`

**Fichier :** `notificationsys.js`  
**Rendu :** Chrome GNOME (toast) + `_backgroundGroup` (icône cloche)

### Interception des notifications GNOME

S'abonne au signal `source-added` de `Main.messageTray`. À chaque nouvelle source, s'abonne à son signal `notification-added`. Quand une notification arrive, récupère `title`, `body`, `gicon` et tente de résoudre l'application source via `Shell.AppSystem`. Appelle `showNotification()` pour afficher le toast PrismUI, puis **détruit la notification GNOME native** via `notification.destroy()` dans un `GLib.idle_add` pour éviter les doublons.

### Toast de notification (`showNotification`)

Structure : `St.Widget` (layout `Clutter.BinLayout`) contenant deux enfants superposés :
- `notificationBox` : contenu visible (icône, nom de l'app, heure, texte)
- `overlayBtn` : bouton transparent avec icône de suppression `✕`, rendu visible au `enter-event` et invisible au `leave-event` (overlay de survol)

Le toast s'auto-détruit après 5 secondes via un `GLib.timeout_add`. Un clic sur l'overlay le supprime immédiatement. Le son de notification est joué via `global.display.get_sound_player().play_from_theme('message', ...)`.

Si le mode Ne Pas Déranger (`dndEnabled`) est actif, `showNotification()` retourne immédiatement sans rien afficher.

### Icône cloche et positionnement

L'icône cloche (`notificationBox`) est dans `_backgroundGroup`. Sa position est calculée dynamiquement : elle se place à gauche de `global.barReseau.container` si ce dernier est disponible, sinon à 10px du bord droit du moniteur. Ce calcul est déclenché à chaque changement d'allocation (`notify::allocation`) et à chaque changement de moniteur.

### Panneau d'historique

S'ouvre/se ferme via la cloche. Reconstruit entièrement son contenu à chaque ouverture (`_updateHistoryContainer`). Affiche les notifications en ordre chronologique inverse. Contient un bouton DND (mode concentration) et un bouton tout effacer. Se ferme automatiquement à tout clic extérieur via `global.stage.connect('captured-event')`.

---

## 10. Module Presse-papier — `ClipboardManager`

**Fichier :** `clipboard.js`  
**Rendu :** Chrome GNOME (menu flottant 300×400px)

### Polling

Un timer `GLib.timeout_add_seconds(1)` appelle `_checkClipboard()` toutes les secondes. Récupère le texte via `St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD, callback)`. Ignore les textes vides, identiques au précédent, ou composés uniquement d'espaces.

### Historique

Stocké en mémoire dans `this.history` (tableau, max 15 entrées). `_addToHistory()` filtre d'abord les doublons (`history.filter(item => item !== text)`), insère en tête du tableau, puis tronque si nécessaire. Si le menu est déjà ouvert, `_refreshMenuUI()` est appelé immédiatement pour mettre à jour l'affichage.

### Menu

Centré à 70% de la hauteur de l'écran. Chaque entrée tronque le texte à 40 caractères et remplace les sauts de ligne par des espaces. Un clic sur une entrée appelle `_restoreItem()` qui remet le texte dans le presse-papier via `St.Clipboard.set_text()` et affiche un OSD "Copié !". Le menu se ferme automatiquement à tout clic extérieur via `global.stage.connect('button-press-event')`.

---

## 11. Module Barre Home — `HomeBar`

**Fichier :** `extension.js` — classe `HomeBar`  
**Rendu :** Chrome GNOME (barre de 200×6px en bas d'écran)

### Visibilité conditionnelle

La `HomeBar` est **invisible par défaut** et ne s'affiche que lorsqu'au moins une fenêtre est maximisée (verticalement et horizontalement) dans le workspace actif. Trois signaux GNOME déclenchent une réévaluation de `_applyVisibility()` :

- `notify::focus-window` sur `global.display` — changement de fenêtre focalisée
- `workspace-switched` sur `global.workspace_manager` — changement de bureau
- `size-changed` et `notify::minimized` sur la fenêtre courante — redimensionnement ou minimisation

`_applyVisibility()` filtre `workspace.list_windows()` pour ignorer les fenêtres système et minimisées, puis cherche si l'une est maximisée dans les deux axes. L'affichage/masquage est animé avec un fondu de 200ms via `actor.ease()`.

### Interactions

La barre capte deux types d'actions :
- **Glissement vers le haut** (déplacement Y > 10px) : minimise toutes les fenêtres du workspace non-système (`_minimizeAll()`), puis réévalue la visibilité après 50ms.
- **Simple clic** : attend 300ms ; si aucun second clic n'arrive, minimise toutes les fenêtres.
- **Double clic** (< 300ms entre deux clics) : annule le timer du simple clic et ouvre/ferme l'overview GNOME (`Main.overview.toggle()`).

---

## 12. Module Mises à jour OTA — `UpdateManager`

**Fichier :** `extension.js` — classe `UpdateManager`  
**Serveur :** `https://projet-prism.fr/update/iui/last/`

### Vérification d'intégrité (`ensureIntegrity`)

Appelée à chaque activation. Vérifie que chaque fichier de la liste `filesToUpdate` existe localement. Si un fichier est manquant et que le réseau est disponible (`Gio.NetworkMonitor.get_default().network_available`), affiche une `ModalDialog` demandant à l'utilisateur de télécharger les fichiers manquants.

### Vérification de mise à jour (`checkUpdates`)

Télécharge `metadata.json` depuis le serveur via Soup. Compare le champ `version` (parsing `parseFloat`) avec la version locale. Compatible Soup 2 (`queue_message`) et Soup 3 (`send_and_read_async`).

### Téléchargement (`_downloadFile`, `updateAll`)

Chaque fichier est téléchargé via une requête HTTP GET Soup et écrit sur disque avec `Gio.File.replace_contents_async` (`REPLACE_DESTINATION`). Les dossiers parents sont créés si nécessaire. `updateAll()` lance tous les téléchargements en parallèle via `Promise.all()`. Après une mise à jour réussie, `gnome-session-quit --logout --no-prompt` est appelé après 5 secondes pour appliquer les changements.

---

## 13. Utilitaire — `CustomPopup`

**Fichier :** `extension.js` — classe `CustomPopup`  
**Rendu :** `Main.uiGroup`

Menu contextuel générique utilisé par le dock (clic droit sur le logo). S'ouvre vers le haut (`openUpwards`) en calculant sa hauteur réelle après rendu (`Mainloop.idle_add`) pour ne jamais sortir de l'écran. Se ferme automatiquement à tout clic extérieur via `global.stage.connect('button-press-event')`. L'icône source peut déclencher le menu programmatiquement — dans ce cas le clic sur elle-même (`anchorActor.contains(target)`) ne ferme pas le menu.

---

## 14. Utilitaire — `AboutDialog`

**Fichier :** `extension.js` — classe `AboutDialog` (extends `ModalDialog.ModalDialog`)  
Affiche le logo, le numéro de version lu depuis `Me.metadata.version`, et un bouton "Rechercher une mise à jour" qui instancie un `UpdateManager` à la demande et affiche l'état en temps réel via `this.statusLabel`.

---

## 15. Moteur de rendu et gestion mémoire

### Prévention des crashes d'allocation Clutter

Le moteur Clutter peut crasher si `set_position()` est appelé sur un acteur dont les dimensions ne sont pas encore calculées. IUI utilise 3 patterns pour l'éviter :

**Guard de dimension :** toutes les fonctions `_setPosition()` commencent par `if (!this.container || this.container.width <= 0) return;`

**Idle callbacks :** `GLib.idle_add(GLib.PRIORITY_DEFAULT, ...)` reporte le positionnement à la prochaine frame disponible, après que le layout pass soit terminé.

**Timers différés :** `TimeMachine` et `NetworkSetting` utilisent des timers à 500ms et 1500ms comme filet de sécurité pour forcer un repositionnement une fois le rendu stabilisé.

### Prévention des boucles de redessin

`_setPosition()` compare les positions actuelles (arrondies) avec les positions cibles avant d'appeler `set_position()`. Si les valeurs sont identiques, aucun appel n'est effectué, évitant les boucles infinies de `notify::allocation`.

### Déconnexion des signaux

Chaque signal connecté est stocké dans une propriété de l'instance (ex: `this._monitorId`, `this._focusId`, `this._sourceAddedSignal`). La méthode `destroy()` de chaque classe déconnecte tous ces signaux explicitement avant de détruire les acteurs.

### Règle de compatibilité GNOME Shell 45+

`Main.panel.actor` est déprécié depuis GNOME Shell 45. IUI utilise directement `Main.panel.hide()` et `Main.panel.show()`.

---

## 16. Feuille de style CSS

**Fichier :** `stylesheet.css`

Le moteur `St` de GNOME rejette les valeurs en pourcentage (%) pour les dimensions. Toutes les tailles sont exprimées en `px` ou `em`, ou déléguées au JavaScript via `x_expand: true` / `y_expand: true`.

Classes principales :

| Classe CSS | Composant |
|---|---|
| `.my-dock-container` | Dock principal |
| `.network-settings-container` | Barre Wi-Fi/son/batterie |
| `.notification-box-container` | Conteneur bouton cloche |
| `.notification-container` | Zone des toasts de notification |
| `.notification-history-container` | Panneau d'historique des notifications |
| `.clock-container`, `.clock-label`, `.date-label` | Horloge et date |
| `.prism-launcher-dialog` | Panel central du lanceur |
| `.prism-launcher-card` | Carte d'application en mode grille |
| `.prism-launcher-list-item` | Résultat de recherche en mode liste |
| `.clipboard-menu` | Menu du presse-papier |
| `.dock-context-menu` | Menu contextuel du dock |
| `.window-list-popup` | Popup liste des fenêtres au survol |

---

## 17. Installation et débogage

### Installation manuelle

Voir le [Wiki](https://wiki.projet-prism.fr/?article=iui-install.html#)  pour l'installation sur Debian

### Débogage en temps réel

```bash
# Logs de l'extension en direct
journalctl -f /usr/bin/gnome-shell | grep -i "prism\|PrismUI"

# Erreurs fatales et crashes d'allocation
journalctl -f /usr/bin/gnome-shell | grep -E "SyntaxError|needs an allocation|TypeError"

# Toutes les erreurs JS
journalctl -f /usr/bin/gnome-shell | grep "JS ERROR"
```

Toutes les erreurs gérées par l'extension sont loggées avec le préfixe `[PrismUI]`.

### GSettings

```bash
# Voir les applications épinglées sur le dock
gsettings --schemadir ~/.local/share/gnome-shell/extensions/prism@dock.ui/schemas \
  get org.gnome.shell.extensions.pdock dock-apps

# Modifier manuellement la liste
gsettings --schemadir ~/.local/share/gnome-shell/extensions/prism@dock.ui/schemas \
  set org.gnome.shell.extensions.pdock dock-apps "['firefox.desktop', 'org.gnome.Files.desktop']"
```