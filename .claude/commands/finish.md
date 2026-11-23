---
description: Finish a task: tests, manifest, push, pull request, CI check, short report
---
Finish the current task:

1. Run `node --test tests/*.test.mjs` and `node tests/e2e.mjs` (show only failures / the last lines). Fix failures; never skip or weaken a test.
2. Update `MANIFEST.md` (status of what changed, decisions, open items), `DESIGN-SYSTEM.md` if a look-and-feel rule changed, and `graphics/README.md`. Mark LOCKED only what the owner said is finished.
3. Commit on the working branch, push, and open or update the pull request (the owner merges; never merge yourself).
4. Confirm the GitHub CI result for the pushed commit; if red, read only the failing lines, fix, push again.
5. Report in plain words (max ~10 lines): what changed, what the owner should check, what still needs their merge. Then say whether this session should end (suggest a fresh session when the conversation is long).
