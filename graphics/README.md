# NB I/A Grafika Stúdió

Böngészős műsorgrafika-készítő a Közvetítőhub adataiból és a saját PSD-sablonokból. A dashboardtól (`../index.html`)
független; ugyanazokat a `../data/*.json` fájlokat olvassa, és semmit nem módosít bennük.

## Egy meccs teljes grafikai csomagja (ZIP)

Az **Export** fülön a „Teljes csomag letöltése (ZIP)” gomb a kiválasztott meccshez (Adatok fül) legyárt minden grafikát: Intro, Következik, Csapatok összevetése, Kulcsjátékosok összehasonlítása, Játékvezetők (ha már ki vannak írva), mindkét csapat Menetrendje, Eredményei és Csapatstatisztikája.
Minden kép 1920×1080, átlátszó PNG, sorszámozott fájlnévvel (`01_Intro_Falco-Alba_2026-12-05.png`). A csomagban van egy **`_OLVASSEL.txt`**: mi van benne, mi maradt ki és miért, mennyire friss az adat, és melyik képen van hiányzó adat. A kipipálható listával kiválaszthatod, mi kerüljön bele.
A csomag az automatikus adatokból és a mentett „alap” elrendezésekből készül (a kézi felülírásokat nem viszi), és közben a képernyőn lévő grafikához nem nyúl. RAR nem készíthető böngészőben, a ZIP mindenhol megnyílik.

## Forma (két sablon)

Kompakt sarokgrafika (legfeljebb a kép negyede: egy csapatnál 960×263, két csapatnál 960×478 px, a bal felső sarokban; az Elrendezés fülön mozgatható). Meccsenként **zöld „GY” / piros „V” jelvény**, alatta az ellenfél logója (ha nincs logó, a neve), majd az eredmény a csapat saját pontjával elöl; idegenbeli meccsnél az eredmény előtt **@** áll. A legutóbbi meccs jobb oldalon.
*Forma* = egy kiválasztott csapat utolsó 5 lejátszott meccse (NB I/A és európai); *Forma (két csapat)* = a kiválasztott meccs két csapata egymás alatt. Szöveges összegzés nincs rajta. A csomag-ZIP-be a két csapatos változat kerül. A jelvények és a panel a `tools/make_form_assets.py`-vel újragenerálhatók.

## Keret (két sablon)

A **Keret (tábla)** a FALCO / DVTK keret PSD-k kinézete, a **Keret (fotókkal)** kártyás változat játékosfotókkal. Mindkettő a Hunbasket csapatoldalából töltődik: mezszám szerinti sorrend, név, poszt, magasság, születési év, a külföldi játékosoknál zászló (a magyarnál nincs), a vezető- és a segédedző, a klublogó.
A sorok / kártyák a játékosok tényleges számához igazodnak (9–24 fő). A hosszú, többkeresztnevű nevek 3 szóra rövidülnek; a kapitány-jelölés (©) az adatokban nincs, kézzel írható a név mögé.
**Fotók:** a Hunbasket fotói (`graphics/players/`) a „Player photos” workflow-val töltődnek le és kicsinyítődnek (kézzel indítható az Actions fülön). A fotókat másik szerverről a PNG-export nem tudná használni (nincs CORS-engedély), ezért kell letölteni őket – **a fotók az MKOSZ-é / a fotósoké; a használatukra az MKOSZ engedélyt adott. A repó publikus, ezért a letöltött fotók is publikusak: ne tegyél fel olyat, amire nincs engedély.** Ahol nincs fotó, helyőrző jelenik meg.

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
* **Három külön kapcsoló** van a feltöltő dobozban: **Csapatstatisztika (Excel)** (Csapatok összevetése), **Játékosstatisztika (Excel)** (Csapatstatisztika-táblázat, Kulcsjátékosok, Játékos-különleges) és **Kupameccsek (Excel + kézzel)**. Mindegyik külön ki-be kapcsolható, a többit nem érinti (pl. a csapat-Excel kikapcsolva marad a játékos-Excel). Egy új feltöltés csak azokat a részeket kapcsolja be, amiket a fájl hoz; a felső sávban látszik, mi van kikapcsolva („kikapcsolva: csapatstatisztika”). Egy kapcsoló inaktív, ha abból a fajtából nincs feltöltött adat.
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

Minden oszlophoz külön forrás választható: **Kézi**, **Idei átlag**, **Karrier** vagy **Utolsó N meccs** (a Hunbasket játékososzlopairól, `data/player_pages_*.json`, naponta frissül). A nagy fájl csak e sablon megnyitásakor töltődik be.

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

**Mezszámok mérete (Keret):** a kép feletti *Méretek* sávban a *Mezszámok (%)* mező az összes játékos mezszámát egyszerre méretezi (50–250%).
**Zászlók mérete (Keret fotókkal):** a *Zászlók (%)* mező az összes zászlót egyszerre méretezi; a zászló jobb széle és a mezszám középvonala nem mozdul.

**Sorok mozgatása (Keret fotókkal):** a *Méretek* sávban minden sor (felső, középső, alsó) külön eltolható: ↔ vízszintesen, ↕ függőlegesen (pixel, ±300). A *Sorok alaphelyzet* gomb visszaállítja. A csapat váltásakor az eltolások megmaradnak.

### Extra (MKOSZ) – fotókeret és QR-keret

Sablon: *Extra (MKOSZ)* (az „Background for extra graphics + QR code outliner.psd” alapján; a két keret **alakzat**, nem kép, ezért szabadon mozgatható és méretezhető).
- **Fotókeret** (álló): tölts fel egy képet; a keretbe illeszkedik (a szegélyen belül marad). *Illesztés*: kitölti a keretet (levágva) vagy egészben belefér; nagyítás, eltolás, belső margó, a keret háttere (barna / fehér / fekete / átlátszó).
- **QR-keret** (négyzet): a QR-kód feltöltése külön mezőből; alapból egészben, 14 px margóval; ha a kód átlátszó hátterű, válassz fehér keret-hátteret.
- **Mozgatás / méretezés:** kattints a keretre az előnézeten (a szerkesztés itt mindig be van kapcsolva) – húzással mozgatható, a sarok-fogantyúkkal méretezhető. A *Arány rögzítve* jelölőnégyzet: bekapcsolva a keret mindkét irányban ugyanúgy nő/fogy (Alt lenyomva: szabad húzás), kikapcsolva szabadon húzható. Számmal is megadható (szélesség/magasság), és az Elrendezés „alap”-ként menthető.

### Egymás ellen (head to head)

Sablon: *Egymás ellen* – a kiválasztott mérkőzés két csapatának **utolsó legfeljebb 6 egymás elleni meccse**, legfrissebb felül (a **panel magassága pontosan a meccsek számához igazodik**; ha kevesebb meccs van az adatokban, kisebb a panel): dátum · hazai címer · eredmény · vendég címer (a sorban a meccs tényleges hazai csapata áll balra). A **playoff és a Magyar Kupa meccsek is** szerepelnek: ezeknél a dátum alatt, a dátum méretének felében zárójelben áll a sorozat neve – *(Playoff)*, *(Magyar Kupa)*; az alapszakasz meccseknél nincs felirat. Forrás: a Hunbasket 2020/21-től összegyűjtött meccsei (`data/h2h_hunbasket.json`, a dashboard is ezt használja) + az idei menetrend; a klubok **korábbi (szponzoros) nevei** is ugyanannak a klubnak számítanak (pl. „Aluinvent DVTK” = DVTK, „UNI Győr” = ETO Basket), különben a régebbi meccsek kimaradnának (de a PVSK-VEOLIA, a PINKK Pécsi 424 és a Dávid Kornél Akadémia **másik klub**, azok meccsei nem számítanak bele); ami nincs az adatokban, az üres marad (nincs kitalált meccs). Része a meccs ZIP-csomagjának. Bal felső sarok, 680 px széles, az Elrendezés fülön mozgatható.

**Oszlopok együtt mozgatása (Játékos-különleges):** a „Grafika felépítése” dobozban az *Együtt mozgatás* sorban jelöld ki, mit mozgass egyben (oszlop = fejléc + az összes száma; a sorfeliratok és a név külön egység), állítsd be a lépést (px), és a nyilakkal mozgasd. Az egység elemei külön-külön is állíthatók maradnak; a *Kijelöltek helye: alap* gomb visszateszi a kijelölteket a PSD helyére. A mozgatás a megszokott elrendezésbe kerül, így „Mentés alapként” megőrzi.

### Háttér eltávolítása (AI)

A Játékos-különleges fotómezője és az Extra (MKOSZ) fotókerete alatt a **Háttér eltávolítása (AI)** gomb a feltöltött fotó hátterét eltünteti (átlátszó PNG lesz belőle). Teljesen a böngészőben fut: nincs szerver, fiók vagy díj, a kép nem hagyja el a gépet. Az első használatkor betölti a modellt (`models/silueta.onnx`, 44 MB, utána a böngésző gyorsítótárazza), egy fotó pár másodperc. A **Vágás erőssége** csúszka a szél keménységét állítja (nem kell újra futtatni), az **Eredeti kép vissza** gomb visszaadja a feltöltött képet. Egyszínű / stúdióháttéren a legpontosabb; nagyon zsúfolt háttérnél a haj körül kézi utómunka kellhet. A modell és a futtató licence: `models/README.md`.

## Fejlesztői jegyzet (kód szerkezete)
- `js/app.js` – a stúdió fő vezérlője (állapot, mezők, renderelés, elrendezés-szerkesztő, mobil nézet); `js/panels.js` – az önálló oldalpanelek (Játékos-különleges beállítások + oszlopok együtt mozgatása, AI háttéreltávolítás, Extra keretek); `js/bgremove.js` – a háttéreltávolító motor.
- A dashboard stílusai a `css/dashboard.css`-ben vannak (korábban 18 beágyazott `<style>` blokk, ugyanabban a sorrendben összefűzve; a megjelenés pixelre azonos). Új szabály a fájl végére kerül.

**Átméretezhető panelek (Forma, Forma két csapat, Egymás ellen):** a panel (pályatextúrás háttér + szegély) alakzat, nem kép, ezért szabadon méretezhető: Elrendezés fül → *Szerkesztés* bekapcsolva → kattints a panel szélére, és húzd a sarkait (alapból szabadon; Shift = arányosan), vagy írd be a szélességet / magasságot a kijelölt elem mezőibe. A tartalom (sorok, címerek) nem méreteződik vele – azt a *Tartalom mozgatása / nagyítása* mozgatja. A panel követi az „Alap átlátszósága” csúszkát. Az Extra (MKOSZ) kereteihez hasonlóan.

### Minden keret átméretezhető (PSD-s grafikák is)
A grafikák kerete (pályatextúra + szegély) mostantól alakzat: Elrendezés fül → *Szerkesztés* → kattints a keret szélére (az elemek nélküli részre), és húzd a sarkait – szabadon, Shift = arányosan; számmal is megadható. A keret a PSD-ből kinyert **teljes pályaképet** (`assets/court/court.png`, a PSD „Háttér nb1a – kosárpályával” objektuma) a keret **középtengelyére illesztve** mutatja: a pálya felső és alsó széle a keret felső és alsó szegélyére esik (ha a keret ennél szélesebb, a pálya – az arányát megtartva – akkor is kitölti). A pálya a kerettel egy egység: együtt mozog és méreteződik, a körök kerekek maradnak. (A PSD-kben a pálya néhol eltolt volt; most mindenhol ugyanez a szabály érvényes.) A fix feliratok / logók (`templates/<id>/statics.png`) a keret fölött maradnak; a fotók a keret belső szélén belül maradnak. Érintett: Forma, Egymás ellen, Keret (táblás és fotós), Csapatok összevetése, Csapatstatisztika, Eredmények, Menetrend, Eredmények (színes sorok), Intro, Játékos-különleges. Nem: Következik (saját keretkép), Játékvezetők (ebben nincs pályás keret); a Kulcsjátékosok összehasonlítása is alakzat-keretet kapott, a sorok számához igazodó magassággal.
Előállítás: `python3 tools/psd_frames.py` (a PSD-kből: keret-adatok → `js/frames.js`, fix rétegek → `statics.png`, pályakép; a megjelenést a régi háttérrel hasonlítottam össze: <0,4 % eltérő képpont, a vonalak 1–2 px-es átmintázása).

### Kulcsjátékosok összehasonlítása / szemtől szemben: kategóriák, fotók, színek, sorok
- **Adat:** a két csapat játékosai a *Játékosstatisztikából* jönnek (Hunbasket idei átlagok, vagy a feltöltött FullField.info Excel, ha van); alapból a legjobb pontszerző, de a legördülőkkel bármelyik játékos választható. A zárójeles helyezés a liga játékosai között értendő (min. meccsszám).
- **Fotó a logó helyett:** a *Középen* választóval a játékosok Hunbasket-fotója jelenik meg a klublogó helyén (ha egy játékosnak nincs fotója, a klubja logója marad); a fotó átlátszatlansága állítható, mozgatása / nagyítása az Elrendezésben.
- **Neve:** *Kulcsjátékosok összehasonlítása / szemtől szemben* (korábban Csillagjátékosok).
- **Statisztikai kategóriák:** a *Statisztikai kategóriák* jelölőnégyzeteivel (PTS, 2P%, 3P%, FT%, REB, AST, STL, TOV, EFF) bármelyik sor kiválasztható; legalább egynek maradnia kell. A sorok a fix sorrendben, egyenletes közzel jelennek meg, **a háttér (pálya + keret) pontosan a sorok számához igazodik**, a fotók / logók a sorok közepére kerülnek, és a Hunbasket · Tippmix · MKOSZ logósor a keret alá kerül. A sorfeliratok (PTS stb.) szerkeszthető szövegek.
- **Saját fotó:** a feltöltött fotó alapból **900 px magas**, és a keret alsó szélén áll (a lába a kereten marad). Az Elrendezésben kijelölve a sarkait húzva arányosan átméretezhető (felfelé nő), húzással mozgatható, a *Méret (%)* mezővel számmal is.
- **Hiányzó százalékok:** ha az Excelben nincs 2P % / 3P % / BT % oszlop (a FullField csapat-/játékosexport nem mindig tartalmazza), az érték a játékos Hunbasket-soráról pótlódik (név alapján); a mező forrás-címkéje jelzi. Ha egyik forrásban sincs, marad a „–” (nincs kitalált adat).
- **Forrás-felirat színe:** a *Forrás-felirat színe* választóval a „FULLFIELD.INFO / HUNBASKET.HU” felirat színe állítható (ez a Csapatok összevetése grafikán is működik); az *Alap* a kék.
- **Sorok:** a helyezés-sorok mostantól ugyanazon az alapvonalon vannak, mint az értékek (a PSD-ben 1–9 px-et csúsztak), és az értékek / helyezések / fotók a felirat-oszlop közepére szimmetrikusak.

**Oldalsáv szélessége (asztali nézet):** a bal oldalsáv és az előnézet közti függőleges sávot (a vékony vonalat) megfogva az oldalsáv szélessége szabadon húzható (320–1000 px); a böngésző megjegyzi, dupla kattintás vagy a *Home* billentyű az alaphelyzetre (480 px) állítja, a ←/→ nyilak 24 px-et lépnek. A mezők „Betűméret / Balra-jobbra / Fel-le” sora keskeny oldalsávban új sorba tör, nem lóg ki.


## Élő statisztika (játékos)
Időkérésnél / negyedszünetben egy játékos élő statisztikája, a hivatalos keretfotóval (ugyanaz, mint a Keret fotókkal grafikán). Vékony sáv: *Alap* 606 × 150 px, *Dobások* 606 × 140 px, *Teljes sor* 1032 × 130 px, átlátszó PNG. Balról jobbra: a játékos hivatalos fotója, a **név a számsor közepére igazítva** (alatta a számok és a kategória-feliratok), a **klublogó (100 px)** a jobb szélen. **Színek:** a név és a kategória-felirat fehér, a **számok arany** (`#ffc929`). A név alatt nincs állás-sor (az adás saját eredményjelzője mutatja az állást és a negyedet). Alapból **az eredményjelző szintjén, a kép bal széle és az eredményjelző közti rés közepén** jelenik meg (*Hely a képen*: *Alul…* vagy *Bal felül*): az **ETO Basket és Falco** adásain (nagy eredményjelző; ők kézi kamerával, nem automatizáltan közvetítenek) a közép x = 600, **mindenhol máshol** (kis eredményjelző) x = 712. A grafika az eredményjelzőt sosem takarja. Az előnézetben a *Zóna mutatása* jelölőnégyzet satírozott sávot mutat ott (csak az előnézetben látszik, az exportban nem).

**Adat:** az MKOSZ élő boxscore-ja (`https://netcasting4.webpont.com/?whun_135563` – a `whun_` a női, a `hun_` a férfi mérkőzés). A stúdió a hírcsatorna eseménylistájából számolja a statisztikát (pont, 2P/3P/BT dobások, lepattanó, gólpassz, szerzett és eladott labda, blokk, fault, játékperc, EFF); a pontok egyeznek a hivatalos állással. A hírcsatorna kb. 5 másodpercenként frissül.

**Használat:**
1. Válaszd az *Élő statisztika (játékos)* sablont (a megfelelő Férfi / Női fülön).
2. A *Meccs* mezőbe írd a netcasting linket vagy a kódot (pl. `whun_135563`), majd *Betöltés*. Az *Automatikus frissítés* 5 másodpercenként hozza az újat.
3. Válassz csapatot és játékost (a lista pontszerzés szerint rendezett). A **statisztikákat te pipálod be** (PERC, PTS, REB, AST, STL, BLK, TOV, FAULT, VAL, FG, 2P, 3P, BT); a sáv szélessége a pipák számától függ (legfeljebb 1040 px), a sorrend fix. A *kész csomag* lista (**Alap**, **Dobások**, **Teljes sor**) csak előre kipipál egy válogatást. A **dobásoknál** (FG, 2P, 3P, BT) a *betalált/kísérlet* áll nagyban, utána zárójelben a **százalék** a nagy szám 2/3-os méretében, függőlegesen középen, pl. `4/5 (80%)`.
4. Exportálás mint a többi grafika (a fájlnévben a játékos és a csapat).

**Fontos – az élő lekérés a helyi szerverrel működik:** a hírcsatorna szervere nem engedi, hogy egy weboldal (pl. a GitHub Pages) közvetlenül olvassa, és a felhős szolgáltatások (pl. Supabase) hálózatát elutasítja. Ezért indítsd a stúdiót a gépeden: `python3 tools/serve.py`, majd nyisd meg a `http://localhost:8000/graphics/` címet – a szerver `/live` címen továbbítja a hírcsatornát (csak ezt az egy URL-formát kéri le). Ha ez nem megy, a *Beillesztés* ágon kézzel is használható: a stúdió a megadott kódból **kész hivatkozást** ad („A hírcsatorna megnyitása új lapon”, pl. `https://netcasting4.webpont.com/storage/fullwhun_135563.html` – a `full` és a kód egybe van írva, `.html` a végén). A megnyíló lapon egyetlen hosszú szöveg látszik: Ctrl+A, Ctrl+C, majd illeszd be a stúdió mezőjébe és *Beillesztett adat használata*. Ha mást illesztesz be (pl. a netcasting oldal szövegét, vagy csonka szöveget), a stúdió megmondja, mi a baj, és mit tegyél.

A név írásmódja a Hunbasket-keret szerint (magyar: VEZETÉKNÉV Keresztnév, külföldi: Keresztnév VEZETÉKNÉV); ahol nincs letöltött fotó, a Hunbasket szürke „ismeretlen játékos” helyőrzője jelenik meg. Hiányzó adatot a stúdió nem talál ki.


## Eredményjelző (az adás jobb alsó sarkában)
Az adásban a közvetítő saját eredményjelzője a **jobb alsó sarokban** van, két méretben: a **nagy** az **ETO Basket és a Falco** adásain, a **kicsi** az összes többi partnernél. A grafikák nem takarhatják.

* **Beállítás:** az előnézet felett az *Eredményjelző* választó: **automatikus** (a kiválasztott mérkőzés / élő meccs hazai csapata szerint: ETO Basket vagy Falco = nagy, különben kicsi; ha nincs mérkőzés kiválasztva, a nagy zónával dolgozik, mert az tartalmazza a kicsit), **nagy**, **kicsi**, **nincs** (nem tér ki). A beállítást a böngésző megjegyzi.
* **Automatikus kitérés:** ahol egy grafika panelje belelógna a zónába, a stúdió a lehető legkisebb változtatással elmozgatja: feljebb vagy balra tolja, vagy egészen kicsit kicsinyíti (a bal felső sarka körül). Néhány példa a nagy eredményjelzőnél: Csapatok összevetése / Kulcsjátékosok ~0,3% (a női 40 px-szel balra), Eredmények / Menetrend / Színes sorok 4,4%, Intro 2,3%, Játékvezetők 51 px-szel feljebb, Játékos-különleges (női) 6,7%. A Keret, Csapatstatisztika, Forma és Egymás ellen nem érinti a zónát, azok nem változnak. A változtatást az előnézet alatti sor kiírja („Az adásbeli eredményjelző miatt …”); a kézi Elrendezés (mozgatás / méret) ezen felül is használható, és a ZIP csomag is ugyanígy kitér.
* **Zóna mutatása:** a *Zóna mutatása* jelölőnégyzet satírozott sávot rajzol az előnézetre ott, ahol az eredményjelző van (csak az előnézetben látszik, az exportban nem).
* Az *Élő statisztika* sáv saját magát az eredményjelző szintjére, a kép bal széle és az eredményjelző közti rés közepére teszi (nagy eredményjelzőnél x = 600, kicsinél x = 712).


## Vezetőedző nyilatkozata (edzői interjú)
Meccs előtti (vagy utáni) edzői nyilatkozat nagy grafikán, a *Hegedűs ITW BEAC előtt* PSD alapján (női és férfi külön; a férfi ugyanaz az elrendezés a férfi keretszínnel). Átlátszó 1920×1080 PNG.

1. Válaszd a *Vezetőedző nyilatkozata* sablont, és a **Csapat** listában a csapatot. Az **edző neve** (Hunbasket vezetőedző) és a **klublogó** az adatokból jön; ha a Hunbasket másképp írja a nevet (pl. „Hegedüs” a „Hegedűs” helyett), a Mezők között átírható.
2. **Alcím:** javaslat a csapat következő mérkőzéséből („<ellenfél> elleni mérkőzés előtt”); az *Ellenfél* listával váltható, vagy a Mezők között szabadon átírható.
3. **Nyilatkozat:** a *Gyűjtött előzetes-nyilatkozatok (BB1.hu)* lista a kiválasztott csapat edzőinek meccs előtti nyilatkozatait mutatja (a hub a BB1 „A – B” előzetes-cikkeit gyűjti 15 percenként; most a férfi bajnokságra). Egy kattintás a szöveget a *Nyilatkozat* mezőbe, **a mondó nevét** (pl. Sztojan Ivkovics) a grafika nevébe teszi; a név a *Vissza a Hunbasket-névre* gombbal visszaállítható, a szöveg szabadon szerkeszthető, és a forrás (a cikk címe és linkje) a mező forrás-címkéjén látszik. Ha nincs gyűjtött nyilatkozat (pl. női mérkőzés), másold be a szöveget kézzel (új bekezdés = új sor). Üresen nem jelenik meg semmi. A betűméret a szöveg hosszához igazodik (a PSD mérete 13 sorig, hosszabb szövegnél automatikusan kisebb, hogy elférjen). A **szöveg stílusa**: *Kiskapitális (mint a PSD-ben)* vagy *Nagybetű (egyforma méret)* – mindkettő választható.
4. **Fotó:** tölts fel egy áttetsző PNG kivágást az edzőről (vagy használd a *Háttér eltávolítása (AI)* gombot); a fotó a keret alsó szélén áll, mozgatása / nagyítása az Elrendezés dobozban. Fotó nélkül a grafika fotó nélkül jelenik meg (figyelmeztetéssel).
5. Exportálás mint a többi grafika. A nagy panel az **adásbeli eredményjelzőt** is kikerüli (lásd az Eredményjelző részt: nagyon kicsit, ~2%-kal kisebb lesz, ahol kell). A csomag (ZIP) listájában ott van *Vezetőedző nyilatkozata – hazai / vendég csapat* néven, de **alapból nincs kipipálva**; kipipálva a csapat legutóbbi gyűjtött előzetes-nyilatkozatával készül (a fotó csak annál a csapatnál kerül rá, amelyiknek feltöltötted), és a csomag _OLVASSEL.txt-je jelzi, ha nincs fotó vagy szöveg.

A logósor (Hunbasket · Tippmix · Play by Play) fix, a PSD-ből.

## Élő statisztika (csapat-összevetés)
Az adás saját eredményjelzőjének (a sötét, fényes sáv, fehér pontdobozokkal) stílusában: felül a **két csapat logója** és mellettük a **fehér dobozban az állás**, középen a **negyed és a hátralévő játékidő** („2. NEGYED / 4:32”; **VÉGE** csak a lefújt meccsnél – az idő az utolsó esemény ideje, néhány másodperc késés lehet), alatta **soronként egy pipálható statisztika (közvetlenül a pályán, sötét sáv nélkül)**: bal oldalon a hazai, jobb oldalon a vendég értéke fehér dobozban, középen a név. A **jobb érték zöld, a rosszabb piros** dobozt kap, fehér számokkal (egyenlőnél fehér marad; az eladott labdánál és a faultnál a kevesebb a jobb). A dobásoknál (FG, 2P, 3P, BT) *betalált/kísérlet* áll nagyban, zárójelben a százalék a 2/3-os méretben, függőlegesen középen. Pipálható: FG, 2P, 3P, BT, REB, TÁMADÓ REB, AST, STL, BLK, TOV, FAULT, EFF (csapat-EFF: a játékosok és a csapatnak írt lepattanók / eladott labdák összege). A grafika kb. **kétszer akkora**, mint az első változat (legfeljebb 6 statisztikánál; több pipánál a sorok összébb húzódnak, hogy beférjen a képbe), az oszlopok és az eredmények közel vannak a középhez. Ugyanaz az élő meccs-kód és az Automatikus frissítés, mint a játékos-sávnál; a panel ugyanott áll, ahol a **Csapatok összevetése** (bal felül), így nem takarja az eredményjelzőt.

## Élő statisztika (három vezető)
Mindkét csapatból **a három legjobb VAL-értékű játékos** jelenik meg (a **neveik a statisztika-sor közepére** igazodnak) (a VAL csak a kiválasztás szabálya, **nem a főszám**; ha kipipálod, ugyanakkora, mint a többi statisztika). A keret ugyanaz, mint a csapat-összevetésnél; a fejlécben középen a fix, kétsoros **TOP / TELJESÍTMÉNYEK** cím áll (nem a játékidő), mellette két oldalt a két csapat **150 px-es logója**, a cím szélétől fix távolságra (40 px); **nagy eredmény nincs** (az adás saját eredményjelzője mutatja). **Színek:** három színt választhatsz **hex-kóddal** (pl. `#ff8800`): a nevek, a statisztika-nevek (PTS, REB…) és a számok színét; mindenhol egyformán érvényes, nem játékosonként (alapból fehér, a „Színek visszaállítása” gomb ezt hozza vissza). A **játékosfotók mögött 3 px-es körvonal** van (a kép alakját követi; a színe hex-kóddal választható, alapból fehér, kikapcsolható) és egy **lágy árnyék** (kikapcsolható, a **mérete csúszkával állítható**, 0–40 px); a logókon nincs körvonal. Bal oldalon a hazai, jobb oldalon a vendég csapat három játékosa, soronként: a hivatalos fotó, a név, alatta a **pipált statisztikák** felirattal és fehér értékdobozzal (alapból PTS · REB · AST; pipálható: PERC, PTS, REB, AST, STL, BLK, TOV, FAULT, EFF, FG, 2P, 3P, BT). Az értékdobozok **mind fehérek** (nincs jó / rossz színezés). A dobásoknál *betalált/kísérlet (százalék)*, a százalék 2/3 méretben. Ugyanaz a meccs-kód és az Automatikus frissítés, mint a többi élő grafikánál. Ez az első változat: a végleges kinézetet te döntöd el.

**Emlékezés:** az élő grafikák beállításait (pipált statisztikák, kész csomag, hely, színek, körvonal, árnyék és mérete) a stúdió megjegyzi a böngészőben, és a Férfi és a Női fül **közösen használja** – amit egyszer beállítasz, az marad (újratöltés után is). A meccs maga (kód, csapat, játékos, automatikus frissítés) fülenként külön marad.

### Élő grafikák az OBS-ben (minden meccs egyszerre, egy állandó link meccsenként)
A közvetítők **nem a Stúdiót használják adás közben**. Minden meccsnek **egy állandó linkje** van, amit az OBS-ben egyszer kell *Böngésző* forrásként felvenni (1920×1080, átlátszó), és utána soha nem kell cserélni. Hogy melyik grafika látszik, azt az **adásvezérlő oldalon** kattintod ki; az OBS-ben csak a forrást kell láthatóvá / láthatatlanná tenni.
1. Nyisd meg a központi gép `…/graphics/live.html` oldalát (az **adásvezérlő**): válassz a mai és közelgő NB I/A meccsek közül, vagy illeszd be a meccs linkjét (a netcasting, az mkosz.hu és a Hunbasket linkben **ugyanaz a meccskód** van, pl. `whun_135579`, utánpótlásnál `hunu18_142733`).
2. Másold ki a meccs **állandó linkjét** (*Link másolása*), és vedd fel az OBS-ben: Források → + → Böngésző → URL, szélesség 1920, magasság 1080. Egy meccs = egy forrás, a link nem változik.
3. Az **Adásban** gombokkal válaszd ki a grafikát: *Csapatok összevetése*, *Három vezető*, *Játékos-betét* vagy *Nincs adásban* (átlátszó kép). A kattintás azonnal érvényes, az OBS-ben egy-két másodpercen belül vált. A pipákat (statisztikák), a játékost és a helyet is itt állítod; mindegyik grafika megjegyzi a saját pipáit. Az alsó **előnézet ugyanaz a link, mint az OBS-ben**: pontosan azt látod, amit a szerver ad.
4. Az OBS „oldal gyorsítótárának frissítése” gombja (vagy bármilyen újratöltés) nem okoz gondot: a választás a szerveren van, az oldal újratöltés után ugyanazt mutatja. Ha a hírcsatorna egy pillanatra nem érhető el, az utolsó jó kép marad (hibaüzenet soha nem kerül adásba; a link végére írt `&debug=1` állapotsort mutat). Ha egy játékos nevében `?` lett volna (a hírcsatorna az ő / ű betűket elveszíti), a helyes írásmódot az mkosz.hu meccs-oldaláról veszi a szerver, játékos-szám alapján.
* **Egy gép szolgál ki mindenkit:** a központi gépen egyetlen parancs indítja a szervert és az alagutat: `python3 tools/live_server.py` (a Cloudflare-alagúthoz egyszer telepíteni kell a `cloudflared` programot). Indításkor magától frissíti a mappát (`git pull`), ha az git-másolat (nem letöltött ZIP) – ehhez egyszer telepíteni kell a Git-et és `git clone`-nal letölteni a projektet. A parancs kiírja a közvetítőknek adandó címet a kulccsal együtt. Az ingyenes alagút címe minden újraindításkor új (ilyenkor új linkek kellenek), saját állandó címhez Cloudflare-fiók és domain kell. A szerver minden meccs hírcsatornáját **csak egyszer kéri le** és megosztja (nem forrásonként); a `--token` nélkül senki más nem használhatja átjátszónak. A kulcs a linkben van (`&token=`).
* **Régi, grafikához kötött linkek** (`overlay.html?game=…&g=liveteam…`) tovább működnek, ha valaki egy konkrét grafikát akar rögzíteni.
* A grafikák az élő grafikák **alapelrendezését** használják (a Stúdióban elmentett egyéni elrendezés még nem megy át), a kiválasztott statisztikák viszont igen.

## Csapatstatisztika (játékos-táblázat)
A táblázatban **legfeljebb 20 játékos** jeleníthető meg (nincs már a PSD 12 / 13 soros korlátja); alapból a csapat összes játékosa látszik, a listában (Megjelenő játékosok) kipipálhatod / kivehetsz játékosokat. A PSD sorainak száma fölött a sorok **összébb húzódnak és a szöveg kisebb lesz** (az első és az utolsó sor helye nem változik, a keret ugyanaz; a keretet kézzel nagyíthatod az Elrendezés dobozban). A **külföldi játékosok neve „Keresztnév VEZETÉKNÉV”** sorrendben jelenik meg (a nemzetiséget a csapatoldal kerete adja), a magyaroké és azoké, akik nincsenek a keretben, úgy, ahogy a statisztikában szerepel.

**VAL az élő grafikákon (2026-11-25):** az élő grafikák VAL-ja pontosan az MKOSZ netcasting oldal számítása: pont + lepattanó + gólpassz + szerelés + blokk + **kiharcolt fault** − hibás dobás − eladott labda (a szabálytalanságot és a kapott blokkot nem vonja le). A FullField EFF-je ugyanez a kiharcolt fault nélkül; a meccs előtti *Csapatok összevetése* grafika az EFF-et használja.
