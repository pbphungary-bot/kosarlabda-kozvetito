# Instructions for the assistant (read first)

1. Read `MANIFEST.md` and `DESIGN-SYSTEM.md` before changing anything.
2. Anything marked **LOCKED** is finished and agreed: use it as it is, do **not** redo or restyle it unless the owner explicitly asks.
3. Keep `MANIFEST.md` (status, decisions, open items) and `DESIGN-SYSTEM.md` (look & feel) up to date in the same change as the work. When the owner says something is finished/approved, mark it LOCKED in the same commit.
4. Never invent data; men and women stay separate; League Gothic only; transparent 1920×1080 output.
5. Work on a branch and open pull requests; the owner merges. Run `node --test tests/*.test.mjs` and `node tests/e2e.mjs` before pushing; CI must be green.
6. Never run `tools/psd_extract.py` without `--only <id>`.
