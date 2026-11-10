#!/usr/bin/env bash
# Install redline for the current user, or take it out again.
#
#   ./install.sh              copy the extension and scripts in and enable it
#                             (again: update them)
#   ./install.sh --link       symlink this clone instead, so a git pull here
#                             updates it (still only loads after logging out)
#   ./install.sh --uninstall  disable it and remove what was installed
#
# BIN=dir puts redline-osd and buds somewhere other than ~/.local/bin.
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"
UUID=redline@zain
BIN=${BIN:-$HOME/.local/bin}
EXT=${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID
SCRIPTS=(redline-osd buds)

# only remove an extension dir that is this one (a link, or our metadata)
clear_ext() {
  if [[ -L $EXT ]]; then
    rm "$EXT"
  elif [[ -d $EXT ]]; then
    grep -q "\"uuid\": \"$UUID\"" "$EXT/metadata.json" 2>/dev/null ||
      { echo "$EXT isn't redline; leaving it" >&2; exit 1; }
    rm -r "$EXT"
  fi
}

install_() {
  local link=$1 f
  mkdir -p "$BIN" "$(dirname "$EXT")"
  clear_ext
  if ((link)); then ln -s "$PWD/$UUID" "$EXT"; else cp -r "$UUID" "$EXT"; fi
  for f in "${SCRIPTS[@]}"; do
    rm -f "$BIN/$f"
    if ((link)); then ln -s "$PWD/bin/$f" "$BIN/$f"; else install -m755 "bin/$f" "$BIN/$f"; fi
  done
  # the shell only notices a new extension at login on Wayland; set the
  # key directly so it comes up enabled then
  if ! gnome-extensions enable "$UUID" 2>/dev/null; then
    python3 - "$UUID" <<'EOF'
import ast, subprocess, sys
key = ['org.gnome.shell', 'enabled-extensions']
cur = ast.literal_eval(subprocess.check_output(['gsettings', 'get', *key], text=True).replace('@as ', ''))
if sys.argv[1] not in cur:
    subprocess.check_call(['gsettings', 'set', *key, str(cur + [sys.argv[1]])])
EOF
  fi
  echo "installed to $EXT$( ((link)) && echo " (linked to $PWD)"); log out and back in to load it"
  [[ :$PATH: == *:$BIN:* ]] || echo "note: $BIN isn't on your PATH"
}

uninstall() {
  local f
  gnome-extensions disable "$UUID" 2>/dev/null || true
  clear_ext
  for f in "${SCRIPTS[@]}"; do
    # only ours: a link into this clone, or an unchanged copy
    if [[ $(readlink -f "$BIN/$f" 2>/dev/null) == "$PWD/bin/$f" ]] || cmp -s "bin/$f" "$BIN/$f"; then
      rm -f "$BIN/$f"
    fi
  done
  echo "uninstalled"
}

case ${1:-} in
'') install_ 0 ;;
--link) install_ 1 ;;
--uninstall) uninstall ;;
*) sed -n '2,10s/^# \{0,1\}//p' "$0" >&2; exit 2 ;;
esac
