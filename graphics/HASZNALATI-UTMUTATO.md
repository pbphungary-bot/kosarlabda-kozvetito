# Gyors használati útmutató (közvetítőknek és grafikusoknak)

Két felület van, ugyanazon az oldalon:
* **Közvetítőhub** (főoldal): felkészülés – menetrend, tabella, csapatok, párharc, jegyzetek, hírek.
* **Grafika Stúdió** (`/graphics/`): adásgrafikák PNG-ben, az adatokból automatikusan kitöltve.

Telefonon és tableten mindkettő használható. Ha valami furcsán néz ki, a felső sávban a **„Nézet”** gombbal válthatsz automatikus, mobil és asztali nézet között.

## Meccs előtt (felkészülés)
1. **Bajnokságok** fül: a lista a legfrissebb eredménnyel kezd (utolsó 2 forduló), utána a következő 3 forduló. Csapatra szűrhetsz.
2. **Csapatok** fül: válassz csapatot → *Keret* (mezszám, nemzetiség, kor, poszt, magasság), *Statisztika* (minden Hunbasket-oszlop: átlag, összes, 40 perces; oszlopfejlécre kattintva rendezhető), *Rekordok és zónák*, *Mérkőzések*.
3. **Párharcelemző**: válaszd ki a két csapatot → **Meccslap** (egyoldalas, nyomtatható: összevetés, forma, kulcsjátékosok, sztori-javaslatok, játékvezetők ha már ki vannak írva). A közös **Jegyzetek** mezőbe a közvetítők közösen írhatnak.

## Grafikák (Stúdió)
1. Válaszd a bajnokságot (Férfi / Női).
2. **Adatok fül**: válaszd ki a meccset.
3. **Export fül → „Teljes csomag letöltése (ZIP)”**: a meccs minden grafikája egyben (intro, következik, összevetés, csillagjátékosok, mindkét csapat menetrendje, eredményei, statisztikája, játékvezetők ha vannak). A ZIP-ben van egy `_OLVASSEL.txt`: mi hiányzik, mennyire friss az adat, melyik képen van hiányzó érték.
4. Egyedi igény: **Sablon fül** → válassz sablont → **Mezők fül** → szöveg/szín/méret átírása, vagy **Elrendezés fül** → elemek húzása és „Mentés alapként”.
5. Játékos-különleges grafika: sablon *Játékos-különleges*, csapat és játékos kiválasztása, fotó feltöltése (áttetsző PNG), a sztori és a karrier-/egyéb oszlopok kézzel.

## Ha valami nem stimmel
| Jelenség | Mit jelent | Mit tegyél |
|---|---|---|
| „Régi adat” figyelmeztetés | a forrás 48 óránál régebbi | nézd meg a Hunbaskeren; szünet idején normális |
| „—” a grafikán | hiányzó adat | írd be kézzel a Mezők fülön, vagy hagyd üresen (ne találgass) |
| Nincsenek játékvezetők | még nem írták ki | a Hunbasket csak a meccs előtt publikálja őket |
| Európai meccs nincs a listán | a FIBA-oldalon még nincs, vagy nem FIBA-sorozat (pl. Magyar Kupa) | Adatok → „+ Kupa-/európai meccs” vagy Excel |
| Csapatnév nem ismerhető fel Excelben | nem egyezik egy NB I/A klubbal | az importálás előnézete piros listában mutatja, javítsd a nevet a fájlban |
| Furcsa elrendezés telefonon | | Nézet gomb → asztali |

Részletek: `graphics/README.md`.
