#!/usr/bin/env bash
#
# Installs Review Coach as a systemd user service that starts at login.
#
# Usage:
#   scripts/install-service.sh
#
set -euo pipefail

app_dir="$(cd "$(dirname "$0")/.." && pwd)"
unit_dir="$HOME/.config/systemd/user"
unit_file="$unit_dir/review-coach.service"

mkdir -p "$unit_dir"
npm --prefix "$app_dir" run build >/dev/null

cat > "$unit_file" <<UNIT
[Unit]
Description=Review Coach PR inbox

[Service]
WorkingDirectory=$app_dir
Environment=PATH=$PATH
ExecStart=$(command -v npx) tsx server/index.ts
Restart=on-failure

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now review-coach.service
echo "Review Coach runs at http://127.0.0.1:4477"
