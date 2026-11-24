# DESIGN SYSTEM – NB I/A graphics (and dashboard branding)

The source of truth for look & feel is the owner's PSDs (`BROADCAST GRAPHICS/`). This file lists the rules that were agreed. **LOCKED** rules are not reworked unless the owner asks. Update this file whenever a design decision is made.

## Typography (LOCKED)
- **League Gothic Regular + Italic only, in every graphic** (`graphics/fonts`) – no exceptions, not even where a PSD uses another font (men's referee graphic: Satoshi in the PSD, League Gothic in the studio). Italic for labels/names in the roster and player-special designs, as in the PSDs.
- Text sits on a baseline/anchor taken from the PSD; digits are 0.743 em tall (used to centre flags on jersey numbers).

## Colour tokens (LOCKED)
| Token | Value | Use |
|---|---|---|
| Men outline / better value | `#0b9444` | frame border (men), "better" stat |
| Women outline | `#ef4036` | frame border (women) |
| Win | `#1fbf1b` | win badge, win scores |
| Loss / worse value | `#ec4036` | loss badge, worse stat |
| Text | `#fefefe` with black outline | standard on-graphic text |
| Labels in light areas | `#000000` with white outline | italic labels |
| Source name (FULLFIELD.INFO / HUNBASKET.HU) | default `#37b3fd`, changeable per graphic | subtitle run |
| Frame fill (Extra) | `#2d0909`, border `#b58d41`, 6 px, radius 18 | Extra (MKOSZ) frames |
Text outlines: 3–4 px (PSD stroke), club logos carry the white outline stored in `logos/logos.json`.

## Frames (LOCKED)
- Shape = rounded rectangle (*Téglalap*): stroke 7 px (8 px on comparison/roster), radius 25 px (10 px roster), outline colour per league (table above), layer opacity as in the PSD; the "Alap átlátszósága" slider (default 96.5 %) overrides it.
- Fill = the **court** (`graphics/assets/court/court.png`, red→green basketball with court lines), locked aspect ratio, upper/lower edge on the frame's upper/lower border, centred on both axes, grown to cover when the frame is wider.
- Everything fixed that sits on top of the frame (titles, logo strip) is `statics.png` per template; the logo strip (Hunbasket · Tippmix · MKOSZ) stays below the frame.
- Photos/content stay inside the frame's inner edge.

## Components (LOCKED where marked)
- **Form badge (LOCKED):** circle with a dark rim, white 6 px ring, "GY" on green / "V" on red, League Gothic letters; opponent logo (or name) under it; own score first; **@** before the score for away games; latest game on the right; no text caption.
- **Compact graphics (LOCKED):** top-left corner, at most ¼ of 1920×1080 (one team 960×263, two teams 960×478, head-to-head 680 × up to 564).
- **Head to head (LOCKED look):** rows of date · home badge · score · away badge, newest first, up to 6 rows; the frame height follows the number of rows; the score is green (`#1fbf1b`) when the match's home team won that meeting, red (`#ec4036`) when it lost.
- **Broadcast score bug zone (LOCKED, owner 2026-11-24):** the live feed we commentate on carries the broadcaster's score bug in the **bottom-right** corner, in two versions: the **large** one (x 1211–1886 / y 931–1044) is used on the broadcasts of **ETO Basket and Falco only**, every other partner has the **small** one (x 1425–1876 / y 956–1034); a credit line sits below both. Our graphics must not cover it: keep-out zones `BUG.large` x ≥ 1200, y ≥ 925 and `BUG.small` x ≥ 1410, y ≥ 945 (`templates.js`; the large zone contains the small one, so it is used when the host is unknown). The studio picks the size from the host club of the chosen match / live game (setting *Eredményjelző*: automatikus / nagy / kicsi / nincs) and **fits every graphic out of the zone automatically** (`safeFit` in `layout.js`, applied by the engine through the global transform): the smallest visual change wins – shift up, shift left, or a slight shrink about the panel's top-left corner (currently ≤ 6.7 %, most graphics ≤ 2.5 % or untouched). The preview can show the zone as a hatched guide (never exported). Graphics that do not reach the zone (roster, team statistics, form, head to head, …) are not changed.
- **Live player insert (pop-up strip, owner 2026-11-24):** a thin strip, 480 × 150 px (shooting 480 × 140, full row 900 × 130): court frame with 3 px outline, official roster photo on the left, name (surname in capitals) with the small club logo, and the figures in one row, each with its label under it (shooting: made/attempted with the percentage on the label line). **No status line under the name** (the broadcast's own score bug shows score and period). Placement: on the score bug's level and **centred in the gap between the left edge of the picture and the score bug**: large bug → centre x = 600, y ≈ 988; small bug → centre x = 705, y ≈ 995; alternative: top-left.
- **Player cards (photo roster):** photo, jersey number top-left, flag top-right on the number's centre line, surname in capitals, position · height line in red; name order rule in MANIFEST.md.
- **Key players:** values and ranks mirrored around the label column, rank rows on the value baseline, photo (or club logo) behind the numbers.
- **Extra (MKOSZ) (LOCKED):** tall photo frame + square QR frame, brown fill / gold border, free or proportional resize, QR frame white fill option.

## Output
Transparent PNG 1920×1080, deterministic render, no browser-side fonts other than League Gothic; mobile layout of the studio is a CSS-only variant (`graphics/css/mobile.css`) with a manual auto/desktop switch.

## Dashboard (Közvetítőhub)
**Logo line (crest rail):** crests only, no club names (agreed). One white rounded tile per club (equal size, max 96 px, radius 24 %), the clean transparent crest from `graphics/logos/<league>/<id>.png` centred and optically normalised (equal visual area for wide / tall / round crests, max 84 % of the tile); league label with accent dot (men `#0b9444`, women `#ef4036`) and team count on the left; hover/focus lifts the tile, ring + underline in the club's colour; staggered fade-in; phones: one swipeable row of 68 px tiles with edge fade. Rail background is a soft white→`#f3f7fb` gradient with a league-coloured top line.
Light editorial theme with club-branding header, dark-mode overrides, mobile rules inside media queries only; all styles live in `css/dashboard.css` (new rules go to the end of the file).
