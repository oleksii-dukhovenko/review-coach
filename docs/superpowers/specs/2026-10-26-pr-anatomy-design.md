# PR anatomy: a small machine that plays the story of a PR

Status: draft for review. Date: 2026-10-26. No Linear ticket yet.

## Why

- The reviewer is assumed to know nothing about the code or the domain.
- The current big picture (Mermaid boxes and arrows) does not help with that. In the owner's words, it falls short on "probably every PR".
- The goal: one picture per PR that shows
  - what happened before,
  - what the PR adds,
  - what happens after,
  - and why that is better.
- The picture style comes from the `anatomy` skill (`~/.claude/skills/anatomy`). Anatomy draws an idea as a real, recognisable object in isometric view (a 3D-looking drawing with no perspective). The reader understands the idea because they recognise the machine.

## What the reader sees

Picked by the owner from mockups (option 2, "one drawing that plays the story").

- **Where:** at the top of the PR's front page. It goes inside `LedePage`, above the "In one line" card (`web/src/essay/LedePage.tsx:164`). The Mermaid big picture stays where it is, lower down.
- **Layout:** one card, with two columns on wide screens and one column on a phone.
  - Left: one small isometric drawing of a real object. It should be about 190 px tall on desktop. The first mockup was "way too large", so keep it small.
  - Right: three story steps, stacked:
    1. **Before:** one plain sentence.
    2. **What the PR adds:** one plain sentence.
    3. **After:** one plain sentence.
  - Above them: the one-line summary. Below them: one "Why it's better" line.
- **Motion:**
  - The steps play on their own, about 3 seconds each. A thin bar fills under the active step.
  - The drawing changes in place. New parts slide in, and lights and gauges change.
  - Clicking a step stops autoplay and shows that step.
  - Under reduced motion there is no autoplay and changes are instant. The card shows step 1 and the steps can still be clicked.
  - Autoplay stops while the card is off screen.
- **Colours:**
  - Parts this PR adds or changes are drawn yellow (amber in review-coach's palette).
  - Red and green appear only where the object itself has a status (a light, a gauge zone). Green means "fine" and red means "needs a look".
  - It works in light and dark themes. The colours come from review-coach's tokens (`web/src/tokens.css`).
- **Labels:** each part may carry a short label of up to 3 words, because the reader knows nothing. Labels sit on the floor in front of the part, never floating with leader lines.
- **Click a part to see its code.** This reuses the zoom panel from the big picture (`web/src/essay/PictureZoom.tsx`). Its internals (`ZoomPanel`, `NodeCode`, `growPanel`, `moveCamera`, `zoomOut`) need lifting out and exporting.
- **Mockup:** `/tmp/claude-1001/-home-r000026/97547290-e4e0-4dd0-b7db-917f43285894/scratchpad/.superpowers/brainstorm/91516-1793019997/content/directions-v2.html`, option 2. It uses hyperion POS-4637 ("Watch exit says which exit") as the example.

## PR trains

A train is a set of PRs stacked on each other's branches.

- **A train PR gets two pictures, stacked at the top.**
  1. **The whole train:** one machine for the whole effort, where each PR is one part.
     - The part this PR builds is yellow.
     - Parts from PRs that already merged are drawn solid.
     - Parts from later PRs are faint outlines.
     - This picture does not play.
     - Clicking a part opens that PR in review-coach if review-coach has it. Otherwise it opens the PR on GitHub (my call).
  2. **This PR:** the playing story described above.
     - My call: the two pictures are made separately, and this one does not wait for the train picture.
     - When the train picture already exists, this PR's prompt gets this PR's part from it, so the two can share an object. It is not required.
- **How a train is found:** from GitHub, not from the PR description (the owner's decision). A PR is in a train if either is true:
  - its base branch is not the repo's main branch (`develop` in Round2POS repos), or
  - another open PR uses this PR's branch as its base.
  - Walk those links down and up to list the train in order.
- **What GitHub returns today** (checked read-only on hyperion#1753):
  - Repo main branch: `defaultBranchRef`. Base and head branch: `baseRefName`, `headRefName`. One link up or down: `pullRequests(headRefName:)` and `pullRequests(baseRefName:)`.
  - Review-coach fetches `baseRefName` today but not `headRefName` or `defaultBranchRef` (`server/github.ts:14`). Both need adding.
  - For long trains, it is cheaper to make one call per repo and walk the links in memory: `gh pr list --state open --limit 2000 --json number,baseRefName,headRefName,isCrossRepository,title`.
  - **The walk is much bigger than the hand-picked train.** From hyperion#1753:
    - Going down: 25 PRs to `develop`.
    - Going up: a tree of about 110 more PRs, with 2 forks.
    - The `## PR Train` table in that PR's own description lists 38.
  - See "Open questions".
- **Edge cases the walk must handle:**
  - **A merged PR at the bottom.** GitHub keeps the later PR pointed at the merged branch, because these repos do not delete branches on merge. Treat a base branch whose PR is merged as part of the train.
  - **Release branches** (`*-release`) are end points, like `develop` and `main`.
  - **A closed PR in the middle** is skipped.
  - **Fork PRs:** links from forks are ignored (filter on `isCrossRepository=false`).
  - **Trains across repos:** GitHub has no link between repos, so these are out of scope.
- **Saving work:** the train picture is made once and shared by every PR in the train. It is redone only when the train's member list changes.

## The skill, and running it outside review-coach

- **New skill:** `pr-anatomy`, in `~/.claude/skills/pr-anatomy/` (the name is my call).
- **What the skill holds:**
  - the method: truth first, pick an object, write the story;
  - the parts catalogue, with what each part is good at explaining;
  - the scene format;
  - rules for plain words.
- **In a normal Claude Code chat:** `/pr-anatomy <PR>` makes the same playing picture as a private web page (an Artifact), and links it.
- **For a GitHub PR description** (my call): GitHub cannot play the page, so the skill records a short GIF of it playing and uploads it with the `gh-image` skill.
  - By default the skill hands back the image markdown and does not touch the PR.
  - It edits a PR description only when asked, and only on the owner's own PR.
- **Inside review-coach,** the skill is not loaded. Review-coach runs `claude -p` with `--setting-sources ""` (`server/claude.ts:24-32`), so the rules must travel in review-coach's own prompt.
- **One copy of the drawing code** (my call): the parts library, the scene format and the renderer live in review-coach. The skill renders its standalone page with a script from the review-coach checkout. The skill and the review-coach prompt both quote the same rules file, so the rules exist in one place.

## How a picture gets made

### Claude composes; it does not draw

- Anatomy figures are hand-built and take hours. Review-coach makes walkthroughs on its own, so Claude cannot hand-build a machine for each PR.
- Instead, review-coach ships a **library of hand-built, detailed parts**. Each part has bevels, seams, screws and its own small details. Claude picks parts, places them, and writes the story.
- **Starting catalogue** (my call; the builder may adjust):

  | Part | Good for explaining |
  | --- | --- |
  | Terminal or server cabinet | a device, a service, a process |
  | Status light | a log line, an alert, a health state |
  | Drawer with files | a folder, a table, stored data |
  | File card | one record or file |
  | Checker probe | an if-check, a validation |
  | Dial gauge | a number, a threshold, a timeout |
  | Lock | auth, a guard, a mutex |
  | Conveyor | a queue, a list being processed |
  | Pipe | data moving between parts |
  | Lever or switch | a flag, a config option |
  | Stamp press | a transform, a formatter |
  | Bin | delete or discard |
  | Clock | a timer, a retry, a schedule |

- **Each part takes a few settings,** such as a light's colour, a gauge's value, a drawer open or shut, or a file present or missing. The story steps change these settings.

### The scene format (sketch; the builder may refine it)

```
scene: {
  object:  one sentence -- what the machine is, and what its motion means
  parts:   [{ id, kind, slot: [column, row], label (<= 3 words),
              settings, code: { file, startLine, endLine } }]
  links:   [{ from, to, kind: "pipe" | "wire" | "belt" }]   -- kept on the floor
  steps:   [ before, change, after ], each
           { say: one sentence, parts: { id: { shown, new, settings } } }
  why:     one sentence
}
```

### Drawing rules

- **Painting order** (which part is drawn on top) follows the safe rule found in the anatomy kit:
  - The floor is a grid of equal cells. The base is drawn first.
  - Cells are sorted by depth at floor level.
  - Each part draws its own pieces bottom to top.
  - Links stay flat on the floor.
  - Generated placement therefore cannot put a far part in front of a near one.
- **Kit code:** copy `kit/iso-kit.ts`, `kit/iso.css` and `kit/react/*.tsx` from the anatomy skill into review-coach (MIT licence, keep the notice). The kit's tokens map onto review-coach's theme. Its tone set has no yellow, so add a yellow tone for parts the PR adds or changes.
- **Motion** follows anatomy's rules (`references/motion.md`): time-based easing, one animation loop that writes attributes directly, stop when settled or off screen, and respect reduced motion.

### Truth

- Every part points at real lines, like the big picture's boxes do (my call):
  - Each part has one code link, which stays the same in every step.
  - The link points at the new code. The zoom panel already shows a side-by-side diff when the PR touched those lines, so the old code is visible there.
  - A part that exists only in the old code (deleted code) has no code link for now. Reading old files is later work.
  - The `side` field is dropped from the scene format.
- Line ranges are checked and clamped the way `checkedNode` does it (`server/pictureMap.ts:24-29`). A part whose file does not exist loses its code link.
- **No machine fits** (a rename, a docs-only PR): Claude returns no scene, and the card is hidden. A forced picture is worse than none.

### Where it runs in review-coach

- **This PR's picture:** a new job kind, `anatomy`, works like `guide`.
  - It is queued after the walkthrough is saved.
  - Its `builtFor` is copied from the walkthrough.
  - Like `guide`, it is queued after every walkthrough build, whether the walkthrough was started by "Prepare on its own" or by a Prepare click (my call). So no new button is needed.
  - Input: the walkthrough's story and picture, plus the diff.
  - Being separate means a failure or retry here never holds up the walkthrough.
  - It costs one extra Claude call per PR.
- **The train picture:** a separate job, shared by every PR in the train and keyed by the train.
  - Input: each member PR's title, description and changed file list, plus its walkthrough summary when one exists. Not full diffs.
  - It is queued when the first member's walkthrough is built, and follows the same rule as `anatomy` (my call).
- **When new commits arrive:** redo the `anatomy` job only when the walkthrough's story or picture changed. Otherwise keep it and move its code links the way flow steps are moved (`server/walkthroughMerge.ts:98-103`).

## Goals

- A reader who knows nothing can say what the PR does after watching three steps.
- Every PR that changes behaviour gets a picture with no clicks, subject to the "Prepare on its own" setting.
- Every sentence and part in the picture is true and traceable to lines of code.

## Non-goals

- Replacing the Mermaid big picture.
- Hand-built, Hero-sized anatomy figures per PR.
- Trains that span several repos.

## Anti-goals (a failure even if it works)

- **Too abstract:** plain labelled slabs that read as boxes and arrows in 3D. The parts must look like real, well-made objects.
- **Too big:** the drawing takes over the page.
- **A pretty picture that says something the code does not do.**
- **A forced metaphor** on a PR that has no story.
- **Jargon in the step sentences.** They follow the "Write so anyone can read it" rule.

## Left to the builder

- The exact zod schema, the prompt wording, and the parts' geometry.
- How to share the drawing code between review-coach and the skill's standalone page, within the one-copy rule.
- Tests follow the repo's habits: Vitest, pure functions only. Cover scene validation, painting order, the train walk (with fixtures), and code-link clamping.

## Calls made after the owner said "just finish it"

- **Where a train stops:**
  - Follow only the single line that runs through this PR.
  - Going down, include merged PRs, and stop at the main branch, `main`, `master` or a `*-release` branch.
  - Going up, include open PRs only, and stop where the line splits into two.
  - Stop after 40 PRs either way.
- **Grouping:** Claude sorts the train's PRs into 2-8 groups, one part each. Hovering a part lists its PRs.
- **Where the code lives:**
  - Scene format and train types: `server/sceneSchema.ts`.
  - Drawing code: `web/src/anatomy/`. The geometry is plain TS; the player is React.
  - Standalone page for the skill: `scripts/anatomy-page.ts`, run with `npm run anatomy:page`.
  - The rules Claude follows: `server/anatomyRules.md`. Review-coach's prompt and the skill both read this file.
