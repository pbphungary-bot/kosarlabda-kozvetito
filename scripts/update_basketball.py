import json
import re
import urllib.request
from urllib.parse import urljoin, urlparse
from datetime import datetime, timezone
from pathlib import Path

from bs4 import BeautifulSoup

SOURCES = {
    "men": {
        "name": "Férfi NB I/A",
        "url": "https://hunbasket.hu/menetrend-teljes/ferfi/x2627/hun",
    },
    "women": {
        "name": "Női NB I/A",
        "url": "https://hunbasket.hu/menetrend-teljes/noi/x2627/whun",
    },
}

DATE_PATTERN = re.compile(r"20\d{2}\.\s*\d{1,2}\.\s*\d{1,2}\.")
TIME_PATTERN = re.compile(r"\b\d{1,2}:\d{2}\b")
SCORE_PATTERN = re.compile(r"\b(\d{1,3})\s*[-–:]\s*(\d{1,3})\b")

# Only official, match-specific Hunbasket URLs are stored.
MATCH_LINK_PATTERN = re.compile(
    r"/(?:merkozes|merkozesbeharangozo|merkozes-adatlap|merkozes-adatlapja)/", re.I
)

def official_match_link(row, status):
    """Prefer the score's match link; ignore team, preview-list and external links."""
    score_cell = row.select_one(".game-cell")
    candidates = []
    if score_cell is not None:
        candidates.extend(score_cell.select("a[href]"))
    candidates.extend(row.select("a[href]"))
    seen = set()
    candidates_result = []
    for anchor in candidates:
        href = (anchor.get("href") or "").strip()
        if not href or href.startswith(("#", "javascript:", "mailto:")):
            continue
        link = urljoin("https://hunbasket.hu", href)
        parsed = urlparse(link)
        if parsed.scheme != "https" or parsed.hostname not in {"hunbasket.hu", "www.hunbasket.hu"}:
            continue
        if not MATCH_LINK_PATTERN.search(parsed.path):
            continue
        if link in seen:
            continue
        seen.add(link)
        label = anchor.get_text(" ", strip=True).lower()
        # An actual match result is preferred over a preview link.
        score_in_anchor = SCORE_PATTERN.search(label) is not None
        is_preview = "beharangozo" in parsed.path.lower()
        priority = (0 if status == "finished" and score_in_anchor else 1,
                    1 if is_preview else 0)
        candidates_result.append((priority, link))
    return min(candidates_result)[1] if candidates_result else None


def collect(competition):
    request = urllib.request.Request(
        competition["url"],
        headers={"User-Agent": "Mozilla/5.0 BasketballDashboard/1.0"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        soup = BeautifulSoup(response.read(), "html.parser")

    matches = []
    counters = {"dated_rows": 0, "missing_team": 0, "missing_date": 0,
                "missing_time": 0, "missing_result": 0}
    examples = []

    for row in soup.select("table.desktop-only tbody tr"):
        date_group = row.select_one(".data-group.game-date")
        if date_group is None:
            continue
        counters["dated_rows"] += 1

        home_el = row.select_one(".home-team-name")
        away_el = row.select_one(".away-team-name")
        if home_el is None or away_el is None:
            counters["missing_team"] += 1
            continue
        home = home_el.get_text(" ", strip=True)
        away = away_el.get_text(" ", strip=True)
        if not home or not away or home == away:
            counters["missing_team"] += 1
            continue

        date_text = date_group.get_text(" ", strip=True)
        date_match = DATE_PATTERN.search(date_text)
        time_match = TIME_PATTERN.search(date_text)
        if date_match is None:
            counters["missing_date"] += 1
            if len(examples) < 3:
                examples.append({"problem": "date", "text": date_text})
            continue
        if time_match is None:
            counters["missing_time"] += 1
            if len(examples) < 3:
                examples.append({"problem": "time", "text": date_text})
            continue

        score_el = row.select_one(".game-cell")
        score_text = score_el.get_text(" ", strip=True) if score_el else ""
        score_match = SCORE_PATTERN.search(score_text)
        if score_match:
            result = f"{score_match.group(1)}–{score_match.group(2)}"
            status = "finished"
        elif "Előzetes" in score_text or not score_text or "-" in score_text:
            result = "Előzetes"
            status = "scheduled"
        else:
            counters["missing_result"] += 1
            if len(examples) < 3:
                examples.append({"problem": "result", "text": score_text})
            continue

        cells = row.find_all("td", recursive=False)
        round_text = cells[0].get_text(" ", strip=True) if cells else ""
        match_url = official_match_link(row, status)
        matches.append({
            "round": round_text,
            "home": home,
            "away": away,
            "result": result,
            "date": date_match.group(0),
            "time": time_match.group(0),
            "status": status,
            **({"url": match_url} if match_url else {}),
        })

    unique = {}
    for match in matches:
        key = (match["date"], match["home"], match["away"])
        previous = unique.get(key)
        if previous is None or (match.get("url") and not previous.get("url")):
            unique[key] = match
    matches = sorted(unique.values(), key=lambda m: (m["date"], m["time"], m["home"]))
    finished = sum(m["status"] == "finished" for m in matches)
    print(f"{competition['name']}: {len(matches)} matches, {finished} finished")
    print("Diagnostics:", counters)
    if examples:
        print("Rejected examples:", json.dumps(examples, ensure_ascii=False))
    if len(matches) < 20 or finished < 5:
        raise RuntimeError(
            f"Incomplete schedule for {competition['name']}: "
            f"{len(matches)} matches, {finished} finished. Existing data preserved."
        )
    return matches


def main():
    Path("data").mkdir(exist_ok=True)
    collected = {}
    for key, competition in SOURCES.items():
        collected[key] = collect(competition)

    # Only write after BOTH leagues have passed validation.
    for key, competition in SOURCES.items():
        matches = collected[key]
        path = Path(f"data/{key}.json")
        if path.exists():
            old = json.loads(path.read_text(encoding="utf-8"))
            # Preserve previously verified official links if the current markup omits them.
            old_by_key = {(m.get("date"), m.get("home"), m.get("away")): m
                          for m in old.get("matches", []) if isinstance(m, dict)}
            for match in matches:
                previous = old_by_key.get((match["date"], match["home"], match["away"]))
                if previous and not match.get("url"):
                    previous_url = previous.get("url", "")
                    parsed = urlparse(previous_url)
                    if (parsed.scheme == "https" and parsed.hostname in {"hunbasket.hu", "www.hunbasket.hu"}
                            and MATCH_LINK_PATTERN.search(parsed.path)):
                        match["url"] = previous_url
            if old.get("matches") == matches:
                print(f"{key}: unchanged ({len(matches)} matches)")
                continue
        output = {
            "competition": competition["name"],
            "source": competition["url"],
            "matches": matches,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"{key}: saved {len(matches)} matches")
        print("Sample:", json.dumps(matches[:2], ensure_ascii=False))


if __name__ == "__main__":
    main()
