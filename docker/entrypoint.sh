#!/bin/sh
# Checks the two logins, picks the app copy to run, then starts the server.
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

# The Update button builds a newer copy in $HOME/app. It runs only on the image it was built on;
# a rebuilt image (the install command) wins, and a copy that fails to start 3 times is set aside.
IMAGE_SHA="$(node -p "require('/app/version.json').sha" 2>/dev/null || true)"
export REVIEW_COACH_IMAGE_SHA="$IMAGE_SHA"
UPDATED="$HOME/app"
APP=/app
if [ -n "$IMAGE_SHA" ] && [ -f "$UPDATED/.built-on" ] && [ "$(cat "$UPDATED/.built-on")" = "$IMAGE_SHA" ]; then
  if [ -f "$UPDATED/.confirmed" ]; then
    APP="$UPDATED"
  else
    TRIES=$(( $(cat "$UPDATED/.tries" 2>/dev/null || echo 0) + 1 ))
    echo "$TRIES" > "$UPDATED/.tries"
    if [ "$TRIES" -le 3 ]; then
      APP="$UPDATED"
    else
      echo "The updated app did not start; going back to the installed one." >&2
      rm -rf "$HOME/app-updates/broken" && mkdir -p "$HOME/app-updates" && mv "$UPDATED" "$HOME/app-updates/broken"
    fi
  fi
elif [ -d "$UPDATED" ]; then
  rm -rf "$UPDATED"
fi

cd "$APP"
exec "$APP/node_modules/.bin/tsx" "$APP/server/index.ts"
