#!/usr/bin/env bash
# Install a systemd user timer that runs update-genoffice.sh once a day
# (and at the next boot if a day was missed).
#
#   scripts/install-autoupdate.sh [path-to-genoffice]     (default: ~/genoffice)
#   scripts/install-autoupdate.sh --remove
set -euo pipefail

UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
NAME=genoffice-update

if [ "${1:-}" = --remove ]; then
  systemctl --user disable --now "$NAME.timer" 2>/dev/null || true
  rm -f "$UNIT_DIR/$NAME.service" "$UNIT_DIR/$NAME.timer"
  systemctl --user daemon-reload
  echo "Removed the GenOffice update timer."
  exit 0
fi

command -v systemctl >/dev/null || { echo "systemd not found; run scripts/update-genoffice.sh by hand instead." >&2; exit 1; }
SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/update-genoffice.sh"
GENOFFICE_DIR="$(cd "${1:-$HOME/genoffice}" && pwd)"
git -C "$GENOFFICE_DIR" rev-parse --git-dir >/dev/null 2>&1 || { echo "$GENOFFICE_DIR is not a GenOffice git checkout" >&2; exit 1; }
command -v npm >/dev/null || { echo "npm is not on PATH in this shell; open a shell where it is and run this again." >&2; exit 1; }

mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/$NAME.service" <<EOF
[Unit]
Description=Update GenOffice to its latest release and re-apply the Obsidian patch
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
# the PATH of the shell this was installed from, so node/npm/cargo from nvm or rustup are found
Environment=PATH=$PATH
ExecStart=$SCRIPT $GENOFFICE_DIR
EOF

cat > "$UNIT_DIR/$NAME.timer" <<EOF
[Unit]
Description=Daily GenOffice update

[Timer]
OnCalendar=daily
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now "$NAME.timer"
echo "Installed. GenOffice in $GENOFFICE_DIR will update daily."
echo "  run now:   systemctl --user start $NAME.service"
echo "  see log:   journalctl --user -u $NAME.service -n 50"
echo "  remove:    $0 --remove"
