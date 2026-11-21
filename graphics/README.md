# NB I/A Grafika Stúdió

Böngészős műsorgrafika-készítő a Közvetítőhub adataiból és a saját PSD-sablonokból. A dashboardtól (`../index.html`)
független; ugyanazokat a `../data/*.json` fájlokat olvassa, és semmit nem módosít bennük.

## Telefonon és tableten

A stúdió telefonon is használható (iPhone, Android; 900 px alatti szélességnél): az előnézet fent marad, mozgás közben is látszik, a vezérlők alul öt fülön vannak
(**Sablon · Adatok · Mezők · Elrendezés · Export**). Sablonválasztás után magától az Adatok fülre ugrik. Az előnézet két ujjal nagyítható, dupla koppintásra 2,5×-esre ugrik (és vissza);
nagyítva egy ujjal görgethető. Az „Elrendezés” fülön a szerkesztés (húzás) ujjal is működik. Fekvő telefonon az előnézet balra, a vezérlők jobbra kerülnek.
Az Export fülön a **Megosztás / Mentés** gomb (ha az eszköz támogatja) a megosztó menüt nyitja – innen a Fotókba is menthető –, mellette a sima PNG-letöltés.
Az oldal a kezdőképernyőre is felvehető (a „Hozzáadás a kezdőképernyőhöz” menüponttal), akkor teljes képernyős alkalmazásként indul. Régebbi (iOS 16.4 előtti) iPhone-on is működik.
Excel- és fotófeltöltés telefonon a fájlválasztón át megy.

**Nézetváltó (biztonsági kapcsoló):** a felső sáv „Nézet: auto” gombja körbeváltja: *auto* (a képernyő szélessége dönt) → *mobil* (mobil elrendezés kényszerítve, akár nagy képernyőn is) → *asztali* (az asztali elrendezés kényszerítve; telefonon a teljes oldal kicsinyítve látszik). A választás megmarad ebben a böngészőben.
A dashboardon (főoldal) a fejlécben van egy hasonló „Nézet” gomb: *auto* vagy *asztali* (a mobil nézet kényszerítése nagy képernyőn ott nem lehetséges, mert az oldal mobil szabályai a képernyő szélességéhez kötődnek).

## Indítás

```bash
python3 tools/serve.py
```

Megnyitás: <http://localhost:8000/graphics/> (a repó gyökeréből indítsd; GitHub Pages alatt a `/graphics/` útvonal).

## Használat adás előtt

1. Válaszd a **Férfi / Női** bajnokságot, majd a **sablont**.
2. Válaszd ki a **mérkőzést** (összevetés, intro, játékvezetők) vagy a **csapatot** (eredmények, menetrend, játékos-táblázat).
3. A mezők automatikusan kitöltődnek. A hiányzó adat piros, a képen „—” jelenik meg – írd be kézzel.
4. **Betűméret és eltolás:** az intro csapatneveinél, a helyezés/mérleg soroknál (és a Következik, Játékvezetők, helyszín mezőknél) a „Betűméret (px)”
   és a „Fel / le (px)” mezővel kézzel állítható a méret és a függőleges hely. A megadott méretet a stúdió pontosan használja (nem kicsinyíti tovább);
   ha kilóg a keretből, jelzi. A **„Csapatnevek egyforma méretre”** gomb a két nevet egy kattintással azonos méretre állítja.
   A méret meccsenként érvényes: másik meccsnél újra automatikus.
5. Bármelyik szöveg, szín, logó felülírható; a pipával elrejthető. A ↺ gomb visszaállítja az automatikus értéket.
6. **PNG exportálása** – 1920×1080, átlátszó háttérrel (mint a PSD-k).

A **játékvezetők, az MKOSZ ellenőr és az intro helyszíne** automatikusan jön a Hunbasket teljes menetrendjéből
(`data/referees_men.json`, `data/referees_women.json`; a `referees.yml` workflow félóránként frissíti a `scripts/update_referees.py`-vel).
A játékvezetőket a szövetség a meccs előtt néhány nappal teszi közzé: ami még nincs kiírva, az piros „hiányzó adat”, kézzel írható be.
Kupa-/európai meccsek: lásd lent.

> A feltöltött Excel a **FullField.info** exportja (férfi és női): az „Efficiency” / „Val” oszlop az EFF érték, és ha van Excel-érték, a grafika alján a „FULLFIELD.INFO” felirat áll. Ha egy csapatnevet nem ismerek fel, vagy egy NB I/A csapat nem szerepel a fájlban, a feltöltés előnézetén piros figyelmeztetés mutatja; a Csapatok összevetése pedig megnevezi, melyik csapat nincs az Excelben.

## Fordulónkénti frissítés Excelből

*Adatok feltöltése Excelből / CSV-ből* → válaszd ki egyszerre az új fájlokat:

| Fájl | Mit tölt fel |
|---|---|
| `boxscore_team_avg*.xlsx` (FullField export) | csapatátlagok: PTS, 2P%, 3P%, FT%, REB, AST, STL, TOV, EFF → összevetés sablon, helyezések |
| `Férfi / Női Statalapok*.xlsx` (egy lap = egy csapat) | játékosátlagok + mezszámok → csapat-táblázat sablon |
| `minta-kupameccsek.xlsx` alapján kitöltött lap | kupa-/európai meccsek → bekerülnek az Eredmények és Menetrend listába, dátum szerint az NB I/A meccsek közé, sorozat-logóval |

* A bajnokságot a fájl tartalmából ismeri fel (férfi/női), nem a kiválasztott fülből.
* A csapatot **pontos névvel** egyezteti; nem egyeztethető név kimarad és jelezve van (nem találgat).
* A feltöltött érték előnyt élvez a dashboard adataival szemben („Excel” címke a mezőn); a feltöltés a böngészőben marad.
* A helyezések „(n.)” a feltöltött csapatok között számolódnak (TOV: kevesebb = jobb).

### Elrendezés: minden elem mozgatható, „alap” (benchmark)

Az előnézet fölötti **„Elrendezés”** dobozban:
* **Szerkesztés** bekapcsolva minden elem (szöveg, logó) **húzható** az előnézeten; a kijelölt elemet a nyilak mozgatják (1 px, Shift+nyíl 10 px).
  Az **Elem** sorban pontos értékek: balra/jobbra, fel/le, betűméret (szövegnél) vagy méret % (logónál). A szaggatott körvonal a PSD eredeti helyét mutatja.
* **Rögzítés:** húzás közben az elem a PSD (és az alap) helyéhez „odaragad” (Alt: ki). **Csoport együtt mozog:** egy sor, vagy a hazai/vendég elemek együtt.
* **Teljes grafika:** az egész grafika eltolható és átméretezhető.
* **Alap (benchmark):** *Mentés alapként* – a jelenlegi elrendezés lesz az alap, minden új meccs ebből indul (sablononként, a böngészőben tárolva).
  *Nem mentett módosítások eldobása* visszaáll az alapra, *Alap törlése* a PSD eredeti elrendezésére. *Mentés névvel* több elrendezést tárol
  (pl. „Hosszú nevek”), a *Betöltés* ezeket hozza vissza. Az Exportálás (JSON) gomb az elrendezéseket is menti.

### Következik (soron következő meccs)

A „Következik” sablon (a *Nex Match graph.psd* alapján) bal felső sarokban mutatja a „Következik” címet, a két logót és a kezdés időpontját
(„12.30”). Válaszd ki a mérkőzést – bármelyik NB I/A meccshez elkészíthető. A PSD rejtett „TOP keret” rétege kapcsolóként elérhető
(*Keret*). A PSD másik rejtett rétege („Az 5-8. helyért”) a címmel és a logókkal átfedésben van, ezért nincs benne.

A lábléc harmadik logója minden grafikán az **MKOSZ** logó (a Play By Play logó sehol nem jelenik meg).

### Játékos-különleges („Uros STAT” / „Kányási” design)

Sablon: *Játékos-különleges* (férfi: a Rosic-féle 3 oszlopos, női: a Kányási-féle 2 oszlopos elrendezés). Válassz csapatot és játékost; a **név**, az **idei átlagok**
(az utolsó oszlop) és a háttérben a **klublogó** az adatokból jön. Az alcímet (1–2 sor), a többi oszlop fejlécét és értékeit (pl. karrier, utolsó meccsek) te írod be,
mert az adatbázisban csak az idei átlag van meg; az üres mezők nem jelennek meg. A **fotót** (áttetsző PNG kivágás) a „Fotó” mezővel töltöd fel; csak a böngészőben marad,
a panel lekerekített keretén nem lóg túl, az Elrendezés dobozzal mozgatható/nagyítható. Az **Alapbeállítás „Grafika felépítése”** dobozában megadhatod az oszlopok (1–4) és sorok (1–8) számát, a soronkénti mutatót (pl. PTS/G, 3P%, vagy 2P/3P/FT „bedobott/dobott + %”),
melyik oszlop az idei átlag, a fotó magasságát (alapból a keret belsejéig a lehető legnagyobb) és X helyét, valamint a **rétegezést**: csoportonként (név, fejlécek, feliratok, oszlopok) eldöntheted, hogy a fotó előtt vagy mögött látszik-e.
Az Elrendezés doboz **„Tartalom a kereten belül”** sora az összes tartalmat együtt tolja/nagyítja, miközben a keret és a háttér nem mozdul (a fotó külön kikapcsolható); a keretbe lógó szöveget jelzi. Az „alapként” is menthető.
A „bedobott/dobott” sorokban a százalék kisebb betűvel, a számok magasságának közepén áll. A panel keretvonala érinthetetlen: a fotó és a logó a keret belső széléig vágódik, a keretbe lógó szöveget a stúdió jelzi.
A sor-feliratok átírhatók, a hozzájuk tartozó értékeket ilyenkor kézzel kell megadni.

**Sorok szerkesztése (Menetrend, Eredmények):** a „Sorok a grafikán” listában minden sor mellett ↑ ↓ ✕ gomb van: a törlés, a sorrend és a hozzáadás azonnal megjelenik a képen. A „+ Meccs hozzáadása” listából bármelyik meccs betehető (dátum szerinti helyére), az „Egyéni sor” pedig szabad szöveget enged (dátum, párosítás, eredmény). Csapatváltáskor minden visszaáll az új csapat saját, automatikus listájára; a korábbi csapat sorai, beírt szövegei és elrejtett sorai nem maradnak meg.

**Menetrend alapbeállítás:** a soron következő meccs általában az, amelyikhez a grafika készül, ezért a Menetrend sablon alapból a *következő meccs utáni* 6 meccset mutatja. A következő meccs nem tűnik el a listáról, a meccslistában bármikor kipipálható. Ha a következő meccs után 5-nél kevesebb meccs maradna, nem hagyja ki (mindig legalább 5 sor kell).

### Kupa- és európai meccsek – automatikusan

A `Európai / kupameccsek` forrás magától frissül: a `.github/workflows/cups.yml` naponta háromszor (kb. 7, 13 és 19 óra) lekéri a **hivatalos
FIBA és Bajnokok Ligája játéklistát** (EuroCup Women, EuroLeague Women, Bajnokok Ligája, FIBA Europe Cup), kiszűri a NB I/A klubok meccseit,
és a `data/cups_men.json` / `data/cups_women.json` fájlba írja. A stúdió ezeket automatikusan beteszi a Menetrend/Eredmények sablonokba
(„automatikus” címkével), a felső sávban pedig látszik a frissítés ideje. A kézzel/Excelből felvett meccs ugyanarra a dátumra és csapatokra
felülírja az automatikusat. Ha az oldal nem érhető el, a régi adat marad, üres eredmény sosem írja felül.
* A szezon azonosítója (`26-27`) a `scripts/update_cups.mjs` elején van; új szezonban ezt kell átírni.
* Nem lefedett: a Magyar Kupa és minden, ami nincs a FIBA oldalakon – ezekhez marad a kézi/Excel út.
* Figyelem: az oldal nem hivatalos API-ja; a FIBA használati feltételei szigorúbbak lehetnek, mint a Hunbasket-é, ezért ritkán és azonosítható User-Agenttel kérdez. Ha szeretnéd, kikapcsolható a workflow letiltásával.

### Kupa- és európai meccsek – kézzel / Excelből

A felső sávban lévő **„+ Kupa-/európai meccs”** gomb a Menetrend sablonon megnyitja a hozzáadás űrlapot (válaszd ki a csapatot, add meg a dátumot,
az ellenfelet és a sorozatot). Az Eredmények / Menetrend sablonokon a csapat alatt található ugyanez, és az alatta lévő lista dönti el, melyik
meccsek jelenjenek meg.

A dashboard adatai csak NB I/A meccseket tartalmaznak. Másold a meccseket (pl. az eredmenyek.com oldalról) a `minta-kupameccsek.xlsx`
**Kupameccsek** lapjára: `Dátum | Idő | Hazai | Vendég | Sorozat | Eredmény`, majd töltsd fel. A dátum bármilyen szokásos formában jó
(`2026.11.25.`, `25.11.2026`, Excel dátum). Az eredményt hagyd üresen a következő meccseknél.
* Legalább az egyik csapat NB I/A klub legyen (pontos névvel); a külföldi csapat neve úgy jelenik meg, ahogy beírod.
**Excel nélkül:** az eredmenyek.com csapatoldalának („Meccsek” fül) szövegét kijelölheted, kimásolhatod és beillesztheted a feltöltő doboz
szövegmezőjébe, majd *Beillesztett szöveg beolvasása*. A NB I meccseket kihagyja (azok a dashboard adataiban vannak), a kupa-/európai meccseket
felveszi. Évszám nélküli dátumnál az idényhez illő évet választja. A lejátszott meccsek eredményének formátumát még nem láttam
valódi mintán – ha nem olvassa be jól, másold ide egy ilyen oldal szövegét.
* Logó van: *EuroLeague Women*, *EuroCup Women* (női), *Basketball Champions League / BCL* (férfi). Más sorozat logó nélkül jelenik meg, és a feltöltéskor jelzi.
* Ugyanaz a meccs (dátum + csapatok) újrafeltöltéskor felülíródik. Az automatikus lekérés az oldalról szándékosan nincs: az Eredmenyek/Livesport használati feltételei tiltják.

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
