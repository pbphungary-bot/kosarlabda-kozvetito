---
description: Finish a task: tests, manifest, push, pull request, CI check, short report
---
Finish the current task:

1. Run all three local sets and show only failures / the last lines: `node --test tests/*.test.mjs`, `for t in tests/*.test.py; do python3 "$t"; done` and `node tests/e2e-parallel.mjs` (~3 min; the sequential `node tests/e2e.mjs` is what CI runs). Docs-only changes too. Fix failures; never skip or weaken a test.
2. Update `MANIFEST.md` (status of what changed, decisions, open items), `DESIGN-SYSTEM.md` if a look-and-feel rule changed, `CLAUDE.md` if a rule or command changed, and `graphics/README.md` (Hungarian). Mark LOCKED only what the owner said is finished.
3. Commit on the working branch, push (only after the tests pass) and open or update the pull request. Merge rule (owner decision 2026-11-23): you may merge it yourself only when everything in it was asked for by the owner, is finished, both local test sets pass and the GitHub CI is green; anything the owner did not ask for or approve is left for the owner to merge. Check the PR is not already merged before pushing to it.
4. Confirm the GitHub CI result for the pushed commit; if red, read only the failing lines, fix, push again.
5. Report in plain words (max ~10 lines): what changed, what the owner should check, what still needs their merge. Then say whether this session should end (suggest a fresh session when the conversation is long).
