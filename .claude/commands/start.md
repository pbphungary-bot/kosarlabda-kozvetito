---
description: Start a work session: read the project rules and state, restate the task in one sentence, then do it
argument-hint: <what you want, in a few words>
---
Start of a work session. Task from the owner: $ARGUMENTS

1. Read `CLAUDE.md`, `MANIFEST.md` and `DESIGN-SYSTEM.md`. Do not rework anything marked LOCKED.
2. Look in the repo for what already exists for this task (code, uploaded files, data) before asking for anything.
3. Restate the task and the rule you will follow **in one sentence** (and the sensible default for anything unclear), then build exactly that. Ask a question only if the answer changes what you build and cannot be decided from the files.
4. Check the open pull requests and CI state first, so you do not build on something unmerged or red.
5. Keep it small: one feature, one branch, one pull request. Put adjacent ideas into "Open items" in `MANIFEST.md`, do not build them.
6. When done, follow `/finish`.
