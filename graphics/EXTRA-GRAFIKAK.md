# Extra grafikai ötletek a PlayByPlay csomaghoz

Szempontok: a meglévő PSD-k arculatát (panel, League Gothic, klublogók, MKOSZ logó) használják újra, a Közvetítőhub adataiból
automatikusan kitölthetők legyenek, és ne kelljen hozzájuk új adatforrás. Az ötletek a nemzetközi kosárlabda-közvetítések
(NBA, EuroLeague, FIBA) és a hazai sportközvetítések megszokott grafikai elemeiből származnak; konkrét weboldalakat itt nem idézek,
mert a gyűjtést nem tudtam ellenőrizhető forráshivatkozásokkal alátámasztani. Az „Adat” oszlop azt mutatja, van-e hozzá adat a repóban.

| # | Grafika | Mit mutat | Adat | Munka |
|---|---------|-----------|------|-------|
| 1 | **Győzelmi / vereségi széria** (alsó sáv) | „4 meccse veretlen”, „3 vereség egymás után” | fixtures: van | kicsi |
| 2 | **Lejátszott forma-sáv** | utolsó 5 meccs W/L körökkel az intró alatt | fixtures: van | kicsi |
| 3 | **Tabella-részlet** (a csapat +/- 2 hely) | rangsor a két hazai/vendég csapat körül | standings: van | közepes |
| 4 | **Félidei / negyedek közötti statlap** | 3 legjobb játékos átlaga a mérkőzés előtt | player_stats: van | közepes |
| 5 | **Egymás elleni mérleg** (H2H sáv) | az idényben/korábban lejátszott meccsek | H2H adat: van | közepes |
| 6 | **Hónap/forduló műsorlap** | az egész forduló 6–7 meccse egy képen | fixtures: van | közepes |
| 7 | **Meccs napja kártya** (közösségi 1080×1080 / 1080×1920) | Következik grafika négyzet- és álló formátumban | van | közepes |
| 8 | **Játékos-összehasonlítás** ✅ *megépítve: „Csillagjátékosok” sablon* | két kulcsjátékos átlagai egymás mellett | player_stats: van | közepes |
| 9 | **Idény-rekordok / mérföldkövek** | „A 3000. pontja” – kézi szöveggel | nincs (kézi) | kicsi |
| 10 | **Nézőszám / helyszín kártya** | csarnok, nézők | helyszín: van, nézőszám: nincs | kicsi |

Javasolt sorrend: 2 (forma-sáv), 1 (széria), 6 (forduló műsorlap), 3 (tabella-részlet), 7 (közösségi formátum). Ezek adatai mind megvannak,
és ugyanazt a sablonrendszert használják: új sablon = új PSD-részlet + egy bind függvény + a koordináták a `templates.js`-ben.
A 4–5. a meglévő Csapatstat/Összehasonlítás sablonok kiegészítése, nem új arculat.

Nem javaslom (jelenleg): élő állás / negyederedmény grafika (nincs élő adatforrás), játékos-fotós kártyák (nincs engedélyezett fotóadatbázis).

Megvalósítás: a prototípusok nem készültek el, hogy a jóváhagyott arculat érintetlen maradjon; ha választasz 2–3 ötletet, azokat
megépítem a PSD-k mintájára, „Kísérleti” jelöléssel, amíg jóvá nem hagyod.
