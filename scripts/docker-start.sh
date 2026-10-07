#!/usr/bin/env bash
# Starts Review Coach in Docker. Run it again after pulling updates.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Made .env from .env.example."
fi

if ! grep -q '^GH_TOKEN=.\+' .env; then
  token="$(gh auth token)"
  sed -i.bak "s|^GH_TOKEN=.*|GH_TOKEN=${token}|" .env && rm -f .env.bak
  echo "Filled GH_TOKEN from 'gh auth token'."
fi

if ! grep -q '^CLAUDE_CODE_OAUTH_TOKEN=.\+' .env; then
  echo "Missing CLAUDE_CODE_OAUTH_TOKEN in .env."
  echo "Run 'claude setup-token', paste the token into .env, then run this again."
  exit 1
fi

docker compose up -d --build
port="$(grep '^REVIEW_COACH_PORT=' .env | cut -d= -f2)"
echo "Review Coach is starting at http://127.0.0.1:${port:-4477}"
