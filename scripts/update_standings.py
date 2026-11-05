  
import json
import urllib.request
from pathlib import Path
from datetime import datetime, timezone
from bs4 import BeautifulSoup

SOURCES = {
    "men": "https://hunbasket.hu/tabella/ferfi",
    "women": "https://hunbasket.hu/tabella/noi",
}

EXPECTED_TEAMS = {"men": 14, "women": 11}


def extract_standings(url):
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        html = response.read()

    soup = BeautifulSoup(html, "html.parser")
    teams = {}

    for table in soup.find_all("table"):
        for row in table.find_all("tr"):
            cells = [
                cell.get_text(" ", strip=True)
                for cell in row.find_all(["th", "td"], recursive=False)
            ]

            if len(cells) < 9:
                continue

            rank_text = cells[0].rstrip(".").strip()
            if not rank_text.isdigit():
                continue

            try:
                team = {
                    "rank": int(rank_text),
                    "name": cells[1],
                    "played": int(cells[2]),
                    "points": int(cells[4]),
                    "wins": int(cells[5]),
                    "losses": int(cells[6]),
                    "scored": int(cells[7]),
                    "conceded": int(cells[8]),
                }
            except (ValueError, IndexError):
                continue

            if team["played"] != team["wins"] + team["losses"]:
                continue

            teams[team["rank"]] = team

    return [teams[k] for k in sorted(teams)]


def main():
    Path("data").mkdir(exist_ok=True)

    for league, url in SOURCES.items():
        standings = extract_standings(url)
        print(f"{league}: extracted {len(standings)} teams")

        if len(standings) != EXPECTED_TEAMS[league]:
            raise RuntimeError(
                f"Unexpected team count for {league}: {len(standings)}"
            )

        if [t["rank"] for t in standings] != list(
            range(1, EXPECTED_TEAMS[league] + 1)
        ):
            raise RuntimeError(f"Invalid rankings for {league}")

        path = Path(f"data/standings_{league}.json")
        old = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        now = datetime.now(timezone.utc).isoformat()
        unchanged = old.get("standings") == standings

        output = {
            "competition": "Férfi NB I/A" if league == "men" else "Női NB I/A",
            "source": url,
            "updated_at": old.get("updated_at", now) if unchanged else now,
            "checked_at": now,
            "standings": standings,
        }

        path.write_text(
            json.dumps(output, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"{league}: {'unchanged; check timestamp saved' if unchanged else 'saved standings'}")


if __name__ == "__main__":
    main()

