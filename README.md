> [!NOTE]
> Documentation du code dans Documentation/FULL.md.

# Installation et débogage

### Prérequis

- GNOME Shell 48 (vérifier avec `gnome-shell --version`)
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