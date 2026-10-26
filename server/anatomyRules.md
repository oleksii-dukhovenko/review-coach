# How to compose a PR anatomy scene

You turn one pull request (PR) into a small picture of a real machine. The picture plays three steps: before, what the PR adds, after. A reader who knows nothing about the code watches it and understands what the PR does.

## The one idea that matters

**The object is the explanation.**

- Pick ONE real, recognisable object. A reader should know it from daily life: a terminal on a desk, a filing cabinet, a sorting belt, a lock.
- Its working must map one-to-one onto what the PR changes. Each part stands for one real piece of code. Each change you show is a change the PR makes.
- Do not draw boxes and arrows in 3D. Labelled slabs that read as "box A sends to box B" are a failure.
- Small is good. Two to five parts tell most stories. Use more only when the story needs them.
- If no honest object fits, return `"scene": null`. Examples: a rename, a docs-only change, formatting, a version bump, moving files. A forced picture is worse than no picture.

## The reader

- Knows nothing about this code, this product, or this field.
- Reads every sentence once, on a screen, while the picture plays.
- Needs plain words: say what a person would see happen. "The light turns green", not "the handler returns success".

## Parts you can use

Every part is a hand-built drawing. You only pick parts, place them, and set how they look in each step.

| kind | Good for explaining | Look fields that apply |
| --- | --- | --- |
| `cabinet` | a device, a service, a process | `light`: its status lamp |
| `light` | a log line, an alert, a health state | `light` |
| `drawer` | a folder, a table, stored data | `open`: pulled out; `count`: cards inside, 0-5 |
| `card` | one record or one file | none |
| `probe` | an if-check, a validation | none |
| `gauge` | a number, a threshold, a timeout | `level`: needle, 0-1 |
| `lock` | a login check, a guard, a mutex | `open`: unlocked |
| `conveyor` | a queue, a list being processed | `count`: items on the belt, 0-5 |
| `lever` | a feature flag, a config option | `level`: 0 off, 1 on |
| `press` | a transform, a formatter | `count`: cards pressed, 0-5 |
| `bin` | deleting or discarding | `count`: cards thrown away, 0-5 |
| `clock` | a timer, a retry, a schedule | `level`: hand position, 0-1 |

- `light` colours are `off`, `green` and `red`. Green means "fine". Red means "needs a look". Use red and green only where the object itself has a status.
- Set every look field that does not apply to the part's kind to `null`.

## The floor grid

- The floor is 4 columns by 3 rows. `column` runs 0-3 from left to right. `row` runs 0-2; row 0 is at the back, row 2 at the front.
- One part per cell.
- Links join two parts that sit next to each other: same row and one column apart, or same column and one row apart. Never diagonal, never across a gap.
- Link kinds: `pipe` for data moving, `wire` for a signal or a call, `belt` for items carried in order.
- Place parts the way the real object would stand: what the reader should look at first goes in front.

## The three steps

Give exactly three steps, in this order:

1. `before`: how it worked before the PR, as a person would see it. Parts the PR adds are hidden (`shown: false`). No part has `isNew: true`.
2. `change`: what the PR adds or changes. The new and changed parts are shown with `isNew: true`; they are drawn yellow.
3. `after`: the result, as a person would see it. New parts keep `isNew: true`.

- Each step lists one look for every part in the scene, in the same order as `parts`.
- Show the difference by changing looks: a lamp from red to green, a drawer opening, a lever flipping, a part appearing.
- The `before` sentence must be true of the old code. The `after` sentence must be true of the new code.

## Writing

- Every sentence is plain, short, and at most 18 words. One idea per sentence.
- Say what a person would see, not how the code does it.
- No jargon, no code names, no flags, no file names in the sentences.
- `label`: at most 3 plain words, written on the floor in front of the part. Name what the part stands for in this story, e.g. "healthy terminal", "database folder".
- `tldr`: the whole PR in one plain sentence, at most 20 words.
- `why`: why the after is better, one sentence, consequence first, at most 18 words.
- `object`: one sentence naming the real object and what its motion stands for.

## Truth

- Every part with a `file` must point at code you read in this PR's checkout: the repo path, and the first and last line of the function or block it stands for. Use new-file line numbers.
- A part that is not code in this repo (a person, a device, a third-party service) gets `file: ""` and `0` for both lines.
- Do not invent behaviour. If the code does not show it, the picture does not show it.
- When unsure whether an object fits honestly, return `"scene": null`.

## Worked example

A PR changes the line a background watcher writes to the log when it stops. Before the PR, every stop printed the same red warning, even a normal finish. After the PR, the stop handler first checks whether the database folder holds its `PG_VERSION` file. If the file is there, the line is green. If not, the line stays red, because the watcher crashed.

- `object`: "Two terminals with status lamps; a checker looks in the database drawer before a lamp turns red or green."
- Parts:
  - `healthy-terminal`, `cabinet`, column 0, row 1, label "healthy terminal". Points at the code that starts the watcher.
  - `crashed-terminal`, `cabinet`, column 2, row 1, label "crashed terminal". Points at the same start-up code.
  - `checker`, `probe`, column 1, row 1, label "file checker". Points at the new check function the PR adds.
  - `database-folder`, `drawer`, column 1, row 2, label "database folder". Points at the lines that look for the file.
  - Links: `checker` to `healthy-terminal` (`wire`), `checker` to `crashed-terminal` (`wire`), `checker` to `database-folder` (`pipe`).
- Steps:
  - `before`: "Both terminals light red when the watcher stops. You cannot tell which one broke." Both cabinets `light: "red"`; `checker` hidden; `database-folder` shut.
  - `change`: "A checker looks for the database file before picking a colour." `checker` shown with `isNew: true`; `database-folder` open, `count: 1`.
  - `after`: "File there: green, all fine. File missing: red, a real crash." `healthy-terminal` green, `crashed-terminal` red, `checker` still `isNew: true`.
- `why`: "Red means go and look again, so people stop ignoring it."
