#!/usr/bin/env bash
# Installs or updates Review Coach and opens it in the browser.
#   curl -fsSL https://raw.githubusercontent.com/oleksii-dukhovenko/review-coach/master/install.sh | bash
set -euo pipefail

REPO_URL="https://github.com/oleksii-dukhovenko/review-coach.git"
INSTALL_DIR="${REVIEW_COACH_DIR:-$HOME/review-coach}"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
ask() { local reply; read -r -p "$1" reply </dev/tty; printf '%s' "$reply"; }

need() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing $1. Install it first: $2"
}

check_tools() {
  need git "https://git-scm.com/downloads"
  need docker "https://docs.docker.com/get-docker/"
  need gh "https://cli.github.com"
  need claude "npm install -g @anthropic-ai/claude-code"
  docker info >/dev/null 2>&1 || fail "Docker is installed but not running. Start Docker, then run this again."
}

log_in_to_github() {
  gh auth status >/dev/null 2>&1 && return
  say "Log in to GitHub:"
  gh auth login </dev/tty
}

get_code() {
  if [ -d "$INSTALL_DIR/.git" ]; then
    say "Updating $INSTALL_DIR"
    git -C "$INSTALL_DIR" pull --ff-only --quiet
  else
    say "Downloading to $INSTALL_DIR"
    git clone --quiet "$REPO_URL" "$INSTALL_DIR"
  fi
}

# Sets KEY=value in .env, replacing any old value.
set_env() {
  local key="$1" value="$2" file="$INSTALL_DIR/.env"
  grep -v "^${key}=" "$file" > "$file.tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$file.tmp"
  mv "$file.tmp" "$file"
}

env_value() {
  grep "^$1=" "$INSTALL_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- || true
}

write_settings() {
  [ -f "$INSTALL_DIR/.env" ] || cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
  set_env GH_TOKEN "$(gh auth token)"
  if [ -z "$(env_value CLAUDE_CODE_OAUTH_TOKEN)" ]; then
    say "Review Coach needs a Claude token. A browser opens; log in, then copy the token it prints."
    claude setup-token </dev/tty || true
    set_env CLAUDE_CODE_OAUTH_TOKEN "$(ask 'Paste the token here: ')"
    set_env REVIEW_COACH_ABOUT_ME "$(ask 'One line about you, e.g. "Sam, backend dev, new to Flutter" (Enter to skip): ')"
  fi
  [ -n "$(env_value CLAUDE_CODE_OAUTH_TOKEN)" ] || fail "No Claude token. Run this again and paste it."
}

# Lets the app's Neovim button open a terminal on this computer (Linux only).
install_neovim_links() {
  command -v xdg-mime >/dev/null 2>&1 || return 0
  local bin="$HOME/.local/bin/review-coach-open" apps="$HOME/.local/share/applications"
  mkdir -p "$(dirname "$bin")" "$apps" "${XDG_CONFIG_HOME:-$HOME/.config}"
  install -m 755 "$INSTALL_DIR/host/review-coach-open" "$bin"
  sed "s|REVIEW_COACH_OPEN_PATH|$bin|" "$INSTALL_DIR/host/review-coach-open.desktop" > "$apps/review-coach-open.desktop"
  xdg-mime default review-coach-open.desktop x-scheme-handler/review-coach
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$apps" >/dev/null 2>&1 || true
  command -v nvim >/dev/null 2>&1 || say "Tip: install Neovim to use the app's Neovim button."
}

start_app() {
  say "Building and starting (the first time takes a few minutes)"
  (cd "$INSTALL_DIR" && docker compose up -d --build --quiet-pull)
}

wait_and_open() {
  local port url
  port="$(env_value REVIEW_COACH_PORT)"
  url="http://127.0.0.1:${port:-4477}"
  for _ in $(seq 1 90); do
    curl -fs "$url/api/inbox" >/dev/null 2>&1 && break
    sleep 2
  done
  curl -fs "$url/api/inbox" >/dev/null 2>&1 || fail "It did not start. See: cd $INSTALL_DIR && docker compose logs"
  say "Review Coach is running: $url"
  open_browser "$url"
}

open_browser() {
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" >/dev/null 2>&1 || true
  elif [ "$(uname)" = "Darwin" ]; then open "$1" || true
  fi
}

check_tools
log_in_to_github
get_code
write_settings
install_neovim_links
start_app
wait_and_open
