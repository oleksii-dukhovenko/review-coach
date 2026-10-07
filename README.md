# Review Coach

A local PR review inbox that coaches you through each review instead of reviewing for you.

## What it does

- **Inbox**: PRs where you are a requested reviewer, and your own PRs that are drafts or have open comments waiting on you.
- **Reviewing someone else's PR**:
  - story, then a flow diagram of the call chain;
  - guided tour of files in run order, with notes on tricky syntax and "Did you notice...?" questions;
  - type an answer to get feedback, or click "Show me";
  - click any line number to ask Claude about it;
  - confirmed problems become draft comments plus a suggested verdict, posted only when you click.
- **Your own PR**: each open comment gets a plain meaning, a valid/noise/unsure verdict, and a draft reply or a proposed fix.
- **Your own draft PR**: gets the same walkthrough and guide, below any open comments. Nothing gets posted as a review.
- **Ctrl+click a name**: shows where that exact thing is defined and used, split into "in this PR's changes" and "other uses".
  - Go uses `gopls`, Dart uses the Dart analyzer, TS/JS uses the TypeScript server. They follow scope, so a local variable only shows its own function.
  - Other files, and deleted lines, fall back to matching the name. The peek says which one you got.
  - A use outside the diff opens the whole file in a side panel. Ctrl+click works there too; Back and Esc work as expected.
- **Pictures first**: each walkthrough opens with a one-line summary, before/after, a diagram of the parts touched, and "hard ideas, simply" cards.
- **What got removed**: deleted functions, where they were mentioned before, and recent history. Checked with git, not AI.
- **Skim files**: tests, generated code, lockfiles, and renames are collapsed at the end.
- **Things you've learned**: "Got it" and "Still fuzzy" save notes as markdown files. See "Make it yours" for where.
- **Proof labels**: a "proven" claim whose `file:line` does not exist is relabeled as a guess.

## Install and run (Docker)

### What you need

- **Docker**: Docker Desktop on Mac or Windows, Docker Engine on Linux.
- **GitHub CLI**, logged in: install `gh`, then run `gh auth login`.
- **Claude Code** with a Claude subscription: `npm install -g @anthropic-ai/claude-code`, then run `claude` once to log in.
- On Windows, run the commands below in WSL or Git Bash.

### Steps

1. Get the code:
   ```bash
   git clone https://github.com/oleksii-dukhovenko/review-coach.git
   cd review-coach
   ```
2. Make a Claude token for the app, and copy what it prints:
   ```bash
   claude setup-token
   ```
3. Make your settings file and paste the token into `CLAUDE_CODE_OAUTH_TOKEN`:
   ```bash
   cp .env.example .env
   ```
   Optional: put one line about yourself in `REVIEW_COACH_ABOUT_ME`, so explanations fit your level.
4. Build and start it. This fills `GH_TOKEN` from `gh auth token` for you. The first build takes a few minutes.
   ```bash
   ./scripts/docker-start.sh
   ```
5. Open http://127.0.0.1:4477. Only your computer can reach it.

It checks GitHub right away. Walkthroughs for PRs waiting on your review start preparing in the background, one at a time. They use your Claude usage.

### Everyday commands

- **Update** to the latest version: `git pull && ./scripts/docker-start.sh`
- **Stop**: `docker compose down`. **Start again**: `docker compose up -d`
- **Logs**: `docker compose logs -f`
- **Wipe everything** (reviews, checkouts, chats): `docker compose down -v`

### If something goes wrong

- **"GH_TOKEN is missing" or "CLAUDE_CODE_OAUTH_TOKEN is missing"** in the logs: fill that line in `.env`, then run `./scripts/docker-start.sh` again.
- **"Could not reach GitHub"** on the page: your GitHub token expired. Empty the `GH_TOKEN=` line in `.env` and run `./scripts/docker-start.sh` again.
- **"Preparing is paused"**: Claude hit your usage limit. Click "Retry now" later.

### What is inside the image

- git, `gh`, the `claude` CLI, Go with `gopls`, and the Dart SDK.
- Flutter packages from pub.dev are not inside, so Ctrl+click in Flutter code follows the repo's own code only.

## Run it without Docker

You need Node 24 or newer, git, `gh` logged in, and `claude` logged in.
For exact Ctrl+click in Go and Dart, also install `gopls` and the Dart or Flutter SDK.

```bash
npm install
npm run build
npm start            # http://127.0.0.1:4477
```

- `npm run dev`: server with reload, plus Vite on port 4478.
- `npm test`: tests for the parts that do not use AI.
- `scripts/install-service.sh`: start it at login as a systemd user service.

## How it works

- Every 5 minutes it asks GitHub through `gh` for review requests and open comments on your PRs.
- Walkthroughs for review requests and your drafts, and triage for your comments, are prepared ahead, one at a time.
- Everything else waits until you click "Prepare".
- PRs are checked out into `~/.cache/review-coach/worktrees`, never your own clones.
- Claude runs as `claude -p` with read-only tools (`Read`, `Grep`, `Glob`), no MCP servers, and no hooks.
- A usage-limit error pauses preparing until you click "Retry now".
- A PR that gets new commits is marked "Out of date". Click "Update".
  - Or tick "Update on its own" on that PR, in the inbox or on its page. It is off by default for every PR.
  - When on, each GitHub check (every 5 minutes) updates that PR if it fell behind. A failed update waits for you.
- Update redoes only what changed:
  - files whose changes only shifted lines keep their notes and questions, moved to the new lines;
  - files with new changes go back to Claude, with their old stops, so still-valid questions keep their ids;
  - your answers, "Reviewed" checks, and draft comments carry over. Comments follow their line of code;
    if that code changed, the comment goes in the review summary instead;
  - comment triage looks only at threads that are new or got a reply.
- The page keeps showing your review while an update runs. A "Since you last looked" box says what changed.
- "Start over" at the top of a PR writes everything again from scratch.

## Make it yours

- **Who you are**: one line, so explanations fit your level.
  - Docker: `REVIEW_COACH_ABOUT_ME` in `.env`.
  - Without Docker: `~/.config/review-coach/profile.md`, or `REVIEW_COACH_PROFILE` pointing at a file.
- **How you like things explained**: sections of `~/AGENTS.md` (`REVIEW_COACH_RULES_FILE`) and `~/.claude/CLAUDE.md` (`REVIEW_COACH_GLOBAL_RULES_FILE`). Missing files are fine.
- **Learned concepts**: `REVIEW_COACH_CONCEPTS_DIR`. Default is the Obsidian folder `Documents/Obsidean/Round 2 POS/Code Reviews/Concepts` if it exists, else `~/.cache/review-coach/concepts`.
- **Faster first checkouts**: `REVIEW_COACH_PROJECTS_DIR`, a folder with your local clones. Default `~/ROUND_2_PROJECTS`.

## Settings

- `REVIEW_COACH_PORT`: default `4477`.
- `REVIEW_COACH_MODEL`: Claude model for walkthroughs and questions. Default is your Claude Code default.
- `FLUTTER_ROOT`, `PUB_CACHE`: where Dart packages live. Defaults are `~/flutter` and `~/.pub-cache`.
- Language servers need `gopls` and `dart` on the service's `PATH`. The TypeScript server ships with this project.
- Dart checkouts get a generated `.dart_tool/package_config.json` from the lockfile and pub cache, so no network `pub get` is needed.
