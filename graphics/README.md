# NB I/A Grafika Stúdió

Böngészős műsorgrafika-készítő a Közvetítőhub adataiból és a saját PSD-sablonokból. A dashboardtól (`../index.html`)
független; ugyanazokat a `../data/*.json` fájlokat olvassa, és semmit nem módosít bennük.

## Indítás

```bash
python3 tools/serve.py
```

Megnyitás: <http://localhost:8000/graphics/> (a repó gyökeréből indítsd; GitHub Pages alatt a `/graphics/` útvonal).

## Használat adás előtt

1. Válaszd a **Férfi / Női** bajnokságot, majd a **sablont**.
2. Válaszd ki a **mérkőzést** (összevetés, intro, játékvezetők) vagy a **csapatot** (eredmények, menetrend, játékos-táblázat).
3. A mezők automatikusan kitöltődnek. A hiányzó adat piros, a képen „—” jelenik meg – írd be kézzel.
4. Bármelyik szöveg, szín, logó felülírható; a pipával elrejthető. A ↺ gomb visszaállítja az automatikus értéket.
5. **PNG exportálása** – 1920×1080, átlátszó háttérrel (mint a PSD-k).

Az intro helyszínét egyszer kell beírni, a stúdió a hazai csapathoz jegyzi. Játékvezetők és európai kupameccsek kézi adatok.

## Fordulónkénti frissítés Excelből

*Adatok feltöltése Excelből / CSV-ből* → válaszd ki egyszerre az új fájlokat:

| Fájl | Mit tölt fel |
|---|---|
| `boxscore_team_avg*.xlsx` (FullField export) | csapatátlagok: PTS, 2P%, 3P%, FT%, REB, AST, STL, TOV, EFF → összevetés sablon, helyezések |
| `Férfi / Női Statalapok*.xlsx` (egy lap = egy csapat) | játékosátlagok + mezszámok → csapat-táblázat sablon |

* A bajnokságot a fájl tartalmából ismeri fel (férfi/női), nem a kiválasztott fülből.
* A csapatot **pontos névvel** egyezteti; nem egyeztethető név kimarad és jelezve van (nem találgat).
* A feltöltött érték előnyt élvez a dashboard adataival szemben („Excel” címke a mezőn); a feltöltés a böngészőben marad.
* A helyezések „(n.)” a feltöltött csapatok között számolódnak (TOV: kevesebb = jobb).

## Eszközök és tesztek

```bash
python3 tools/psd_extract.py        # PSD-kből háttér, referencia, logók újragenerálása (psd-tools[composite] kell)
python3 tools/calibrate_text.py     # szövegszélesség-kalibráció a PSD-khez
node --test tests/*.test.mjs        # azonosítás, kötések, Excel-import (valós adatokon)
node tests/visual.mjs               # minden sablon a PSD saját mintaszövegével, összevetés a Photoshop-képpel
node tests/e2e.mjs                  # böngészős végigpróbálás: export, felülírás, presetek, Excel-feltöltés
```

Az eredeti PSD-k a `BROADCAST GRAPHICS/` mappában vannak, ezeket a stúdió sosem módosítja.
Betűtípus: League Gothic Regular + Italic (SIL OFL, `fonts/`).
