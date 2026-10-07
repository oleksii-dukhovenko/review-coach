#!/bin/sh
# Checks the two logins, then starts the server.
set -e

if [ -z "$GH_TOKEN" ]; then
  echo "GH_TOKEN is missing. Put the output of 'gh auth token' in .env." >&2
  exit 1
fi

if [ -z "$CLAUDE_CODE_OAUTH_TOKEN" ] && [ -z "$ANTHROPIC_API_KEY" ] && [ ! -f "$HOME/.claude/.credentials.json" ]; then
  echo "CLAUDE_CODE_OAUTH_TOKEN is missing. Run 'claude setup-token' and put the token in .env." >&2
  exit 1
fi

gh auth setup-git >/dev/null
exec /app/node_modules/.bin/tsx /app/server/index.ts
