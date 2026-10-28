
import json
import re
import urllib.request
from pathlib import Path
from datetime import datetime, timezone
from bs4 import BeautifulSoup

SOURCES = {
    "men": {
        "name": "Férfi NB I/A",
        "url": "https://hunbasket.hu/menetrend/ferfi/x2627/hun",
    },
    "women": {
        "name": "Női NB I/A",
        "url": "https://hunbasket.hu/menetrend/noi/x2627/whun",
    },
}

DATE_PATTERN = re.compile(r"20\d{2}\.\s*\d{1,2}\.\s*\d{1,2}\.")
TIME_PATTERN = re.compile(r"^\d{1,2}:\d{2}$")
SCORE_PATTERN = re.compile(r"^\d+\s*[-–:]\s*\d+$")


def collect(competition):
    url = competition["url"]
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "BasketballDashboard/1.0"},
    )

    with urllib.request.urlopen(request, timeout=30) as response:
        html = response.read()

    soup = BeautifulSoup(html, "html.parser")
    matches = []

    for table in soup.find_all("table"):
        for row in table.find_all("tr"):
            cells = [
                cell.get_text(" ", strip=True)
                for cell in row.find_all(["th", "td"], recursive=False)
            ]

            if len(cells) < 8:
                continue

            round_text = cells[0]
            home = cells[2]
            result = cells[3]
            away = cells[4]
            date = cells[6]
            time = cells[7]

            if not re.fullmatch(r"\d+\.?", round_text):
                continue

            if not home or not away or home == away:
                continue

            if not DATE_PATTERN.fullmatch(date):
                continue

            if not TIME_PATTERN.fullmatch(time):
                continue

            if result != "Előzetes" and not SCORE_PATTERN.fullmatch(result):
                continue

            matches.append({
                "round": round_text,
                "home": home,
                "away": away,
                "result": result,
                "date": date,
                "time": time,
                "status": "scheduled" if result == "Előzetes" else "finished",
            })

    unique = {}
    for match in matches:
        key = (match["date"], match["home"], match["away"])
        unique[key] = match

    matches = sorted(
        unique.values(),
        key=lambda m: (m["date"], m["time"], m["home"])
    )

    if len(matches) < 5:
        raise RuntimeError(
            f"Too few valid matches: {competition['name']} ({len(matches)})"
        )

    return matches


def main():
    Path("data").mkdir(exist_ok=True)

    for key, competition in SOURCES.items():
        matches = collect(competition)
        path = Path(f"data/{key}.json")

        output = {
            "competition": competition["name"],
            "source": competition["url"],
            "matches": matches,
        }

        # Do not rewrite unchanged data.
        if path.exists():
            old = json.loads(path.read_text(encoding="utf-8"))
            if old.get("matches") == matches:
                print(f"{key}: unchanged ({len(matches)} matches)")
                continue

        output["updated_at"] = datetime.now(timezone.utc).isoformat()

        path.write_text(
            json.dumps(output, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        print(f"{key}: saved {len(matches)} matches")
        print(json.dumps(matches[:2], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
