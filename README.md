# Review Coach

A local PR review inbox that coaches you through each review instead of reviewing for you.

## What it does

- **Inbox**: PRs where you are a requested reviewer, and your own PRs with open comments waiting on you.
- **Reviewing someone else's PR**:
  - story, then a flow diagram of the call chain;
  - guided tour of files in run order, with notes on tricky syntax and "Did you notice...?" questions;
  - type an answer to get feedback, or click "Show me";
  - click any line number to ask Claude about it;
  - confirmed problems become draft comments plus a suggested verdict, posted only when you click.
- **Your own PR**: each open comment gets a plain meaning, a valid/noise/unsure verdict, and a draft reply or a proposed fix.
- **What got removed**: deleted functions, where they were mentioned before, and recent history. Checked with git, not AI.
- **Skim files**: tests, generated code, lockfiles, and renames are collapsed at the end.
- **Things you've learned**: "Got it" and "Still fuzzy" save notes to `Obsidean/Round 2 POS/Code Reviews/Concepts/`.
- **Proof labels**: a "proven" claim whose `file:line` does not exist is relabeled as a guess.

## Run it

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
- Walkthroughs for review requests and triage for your comments are prepared ahead, one at a time.
- Everything else waits until you click "Prepare".
- PRs are checked out into `~/.cache/review-coach/worktrees`, never your own clones.
- Claude runs as `claude -p` with read-only tools (`Read`, `Grep`, `Glob`), no MCP servers, and no hooks.
- A usage-limit error pauses preparing until you click "Retry now".
- A PR that gets new commits is marked "Out of date". It is not rebuilt on its own.

## Settings

- `REVIEW_COACH_PORT`: default `4477`.
- `REVIEW_COACH_MODEL`: Claude model for walkthroughs and questions. Default is your Claude Code default.
