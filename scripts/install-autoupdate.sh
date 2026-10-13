#!/usr/bin/env bash
# Run update-genoffice.sh automatically, one of two ways:
#
#   scripts/install-autoupdate.sh [path-to-genoffice]            daily systemd user timer
#   scripts/install-autoupdate.sh --omarchy [path-to-genoffice]  after every `omarchy-update`
#   scripts/install-autoupdate.sh --remove                       remove both
#
# path-to-genoffice defaults to ~/genoffice.
set -euo pipefail

UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
NAME=genoffice-update
OMARCHY_HOOK="$HOME/.config/omarchy/hooks/post-update.d/genoffice-obsidian"

if [ "${1:-}" = --remove ]; then
  if command -v systemctl >/dev/null; then
    systemctl --user disable --now "$NAME.timer" 2>/dev/null || true
    rm -f "$UNIT_DIR/$NAME.service" "$UNIT_DIR/$NAME.timer"
    systemctl --user daemon-reload
  fi
  rm -f "$OMARCHY_HOOK"
  echo "Removed the GenOffice auto-update (timer and Omarchy hook)."
  exit 0
fi

MODE=timer
if [ "${1:-}" = --omarchy ]; then
  MODE=omarchy
  shift
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELF="$HERE/$(basename "${BASH_SOURCE[0]}")"
SCRIPT="$HERE/update-genoffice.sh"
GENOFFICE_DIR="$(cd "${1:-$HOME/genoffice}" && pwd)"
git -C "$GENOFFICE_DIR" rev-parse --git-dir >/dev/null 2>&1 || {
  echo "$GENOFFICE_DIR is not a GenOffice git checkout" >&2
  exit 1
}

if [ "$MODE" = omarchy ]; then
  # omarchy-update runs every file in post-update.d with bash, as this user,
  # with the user's PATH, after the system packages are updated
  mkdir -p "$(dirname "$OMARCHY_HOOK")"
  {
    echo '#!/bin/bash'
    echo '# GenOffice: move to the latest release and re-apply the Obsidian patch.'
    echo "# Installed by $SELF; remove with: $SELF --remove"
    echo 'echo "Updating GenOffice with the Obsidian patch..."'
    printf '%q %q\n' "$SCRIPT" "$GENOFFICE_DIR"
  } > "$OMARCHY_HOOK"
  chmod 755 "$OMARCHY_HOOK"
  echo "Installed. GenOffice in $GENOFFICE_DIR now updates at the end of every omarchy-update."
  echo "  hook:    $OMARCHY_HOOK"
  echo "  remove:  $SELF --remove"
  exit 0
fi

command -v systemctl >/dev/null || {
  echo "systemd not found; run scripts/update-genoffice.sh by hand instead." >&2
  exit 1
}
command -v npm >/dev/null || {
  echo "npm is not on PATH in this shell; open a shell where it is and run this again." >&2
  exit 1
}

mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/$NAME.service" <<UNIT
[Unit]
Description=Update GenOffice to its latest release and re-apply the Obsidian patch
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
# the PATH of the shell this was installed from, so node/npm/cargo from nvm or rustup are found
Environment=PATH=$PATH
ExecStart=$SCRIPT $GENOFFICE_DIR
UNIT

cat > "$UNIT_DIR/$NAME.timer" <<UNIT
[Unit]
Description=Daily GenOffice update

[Timer]
OnCalendar=daily
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now "$NAME.timer"
echo "Installed. GenOffice in $GENOFFICE_DIR will update daily."
echo "  run now:   systemctl --user start $NAME.service"
echo "  see log:   journalctl --user -u $NAME.service -n 50"
echo "  remove:    $SELF --remove"
