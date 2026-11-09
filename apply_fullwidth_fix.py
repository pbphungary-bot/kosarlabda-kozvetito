from pathlib import Path
import shutil, sys
ROOT = Path(__file__).resolve().parent
TARGET = Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path.cwd() / "index.html"
CSS = (ROOT / "player_stats_fullwidth.css").read_text(encoding="utf-8")
START = "<!-- player-stats-fullwidth-fix:start -->"
END = "<!-- player-stats-fullwidth-fix:end -->"
if not TARGET.is_file():
    raise SystemExit(f"ERROR: index.html not found: {TARGET}\nRun from the repository root, or pass path to index.html")
html = TARGET.read_text(encoding="utf-8")
if "player-modal" not in html or "player-report" not in html:
    raise SystemExit("ERROR: Player stats modal selectors not found; no changes made.")
if "</head>" not in html:
    raise SystemExit("ERROR: </head> not found; no changes made.")
block = START + "\n<style id=\"player-stats-fullwidth-fix\">\n" + CSS + "</style>\n" + END
if START in html:
    if END not in html: raise SystemExit("ERROR: Broken previous patch markers; no changes made.")
    html = html[:html.index(START)] + block + html[html.index(END)+len(END):]
else:
    html = html.replace("</head>", block + "\n</head>", 1)
backup = TARGET.with_name(TARGET.name + ".before-fullwidth.bak")
if not backup.exists(): shutil.copy2(TARGET, backup)
TARGET.write_text(html,encoding="utf-8")
print("SUCCESS: Updated",TARGET)
print("Backup:",backup)
print("Only player-statistics popup CSS was changed; data and workflows untouched.")
