"""Derive broadcast-studio assets from the original PSDs (read-only on the PSDs).

Usage:  python3 tools/psd_extract.py            (from the repository root)
Needs:  pip install 'psd-tools[composite]' numpy pillow

For every template listed in TEMPLATES it writes into graphics/templates/<id>/:
  reference.png   Photoshop's own flattened composite stored in the PSD (exact)
  background.png  the design with the dynamic layers removed. Pixels no dynamic
                  layer touches are copied 1:1 from Photoshop's composite; only
                  the pixels under dynamic layers come from a psd-tools re-render
                  of the remaining static layers.
  layers.json     geometry, fonts, colours, style runs and effects of every layer
It also extracts the club logos (from the "logók" sheets) and the competition
marks used in the result/schedule designs.  Nothing in BROADCAST GRAPHICS/ is
modified.
"""
import json
import os
import sys
import warnings

import numpy as np
from PIL import Image, ImageFilter

warnings.filterwarnings('ignore')
from psd_tools import PSDImage  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'BROADCAST GRAPHICS')
OUT = os.path.join(ROOT, 'graphics')

# Layers that are part of the fixed design (kept in the background).
STATIC_NAMES = {
    'Téglalap 1', 'Háttér nb1a - kosárpályával', '50633_mkosz_horizontalbigger',
    '74641_HUNBASKET_profil új(1)', 'tippmix_CMYK_outline',
    'CSAPATOK ÖSSZEVETÉSE', 'PTS 2P% 3P% FT% REB AST STL TOV EFF ',
    'FÉRFI NB I. A CSOPORT', 'NŐI NB I. A CSOPORT',
}
STATIC_PREFIXES = ('hand-drawn-illustration-of-a-classic-referee-whistle',)

TEMPLATES = {
    'comparison-men': ('Falco - Alba statösszevetés 1111 előtt.psd', {'static_pixel': False}),
    'comparison-women': ('DVTK - CSATA statösszevetés 1122 előtt.psd', {}),
    # player specials: photo, club logo, name, texts and numbers are dynamic
    'playerspecial-men': ('Uros STAT.psd', {'static_pixel': False}),
    'playerspecial-women': ('Kányási - 324 vs idei 7 meccs.psd', {'static_pixel': False}),
    'teamstats-men': ('Falco csapatstat 9. ford után 1114.psd', {}),
    'teamstats-women': ('DVTK csapatstat 7. ford után 1122.psd', {}),
    'results-men': ('Falco  LAST Games Graph 1111.psd', {}),
    'results-women': ('DVTK Last Games - 1025.psd', {}),
    'schedule-men': ('Falco  Next Games Graph 1111.psd', {}),
    # 6-row panel (the DVTK Next Games PSD only holds 4 rows; the schedule must show at least 5)
    'schedule-women': ('Női Next Games Graph.psd', {}),
    'resultrows-men': ('Férfi Next Games Graph.psd', {}),
    'resultrows-women': ('Női Next Games Graph.psd', {}),
    'intro-men': ('Férfi Intro Graph 26-27.psd', {}),
    'intro-women': ('Női Intro Graph 26-27.psd', {}),
    'referees-men': ('Sporik ffi alap.psd', {}),
    'referees-women': ('Sporik női alap.psd', {}),
}

# Logo-sheet layer name -> (league, club id used by the dashboard's logo files)
LOGO_SHEETS = {
    'Férfi logók 26-27.psd': ('men', {
        'Sopron KC_kék-fehér_átlátszó szegéllyel': 'sopron',
        '707827677_1744577086998875_3756147844167689831_n': 'falcokc',
        'deac_cimer_vilagos_hattere': 'deac',
        'Réteg 3': 'albafehervar',
        'KTE log': 'kecskemet',
        '298784155_486303590163351_1138511388597255352_n': 'atomermomuse',
        'Szolnoki_Olajbányász_KK_logo': 'szolnok',
        '769182816_1751304319797877_4649982038652522199_n': 'fot',
        'logo_0005_04': 'bphonved',
        'Körmendi_KC_logo': 'kormend',
        'szedeak logo': 'szedeak',
        'Kaposvári_KK': 'kaposvar',
        'MVM_OSE_Lions_logo': 'oroszlany',
        '375048273_892049032445448_8495367556296081544_n': 'nkapecs',
    }),
    'Női logók 26-27.psd': ('women', {
        'DVTK_cimer': 'dvtkhuntherm',
        '375048273_892049032445448_8495367556296081544_n': 'nkauniversitaspecs',
        'BEAC Logo': 'eltebeacujbuda',
        'ksc_szekszárd_logo_szines': 'tarrkscszekszard',
        '734488838_1327264879025947_6430803759669777128_n': 'sercounigyor',
        'Vasas_logo': 'vasasakademia',
        'Sopron_Basket': 'sopronbasket',
        'csata tkk logo': 'csatattk',
        '514359459_1311919607047822_1373282653064184459_n': 'tfse',
        'PNGStroke': 'bkgprimaszigetszentmiklos',
        'vbw cekk cegléd logo': 'davidkornelka',
    }),
}

# Competition marks used next to European/cup rows: (psd, layer name) -> id
COMPETITION_MARKS = {
    ('DVTK Last Games - 1025.psd', 'EuroCup_Women_logo_white_BG_portrait_positive_RGB'): 'eurocup-women',
    ('DVTK Last Games - 1025.psd', 'EuroLeague_Women_Logo'): 'euroleague-women',
    ('Falco  LAST Games Graph 1111.psd', 'Screenshot 2026-01-16 at 10-05-55 (1) Instagram(1)'): 'bcl',
}


def is_static(layer, opts):
    if layer.name in STATIC_NAMES or layer.name.startswith(STATIC_PREFIXES):
        return True
    if layer.name == 'Réteg 1' and layer.kind == 'pixel':
        # "Réteg 1" is the VS mark (intro) / name panel (referees); in the
        # men's comparison it is the Alba logo, which is dynamic.
        return opts.get('static_pixel', True)
    if layer.name.startswith('A mérkőző felek'):
        return False  # subtitle names a data source -> editable
    return False


def rgb(values):
    return '#%02x%02x%02x' % tuple(max(0, min(255, round(v * 255))) for v in values[1:4])


def effect_info(layer):
    out = []
    if not layer.has_effects():
        return out
    for e in layer.effects:
        if not e.enabled:
            continue
        d = {'type': e.__class__.__name__}
        v = getattr(e, 'value', {}) or {}
        for a, k in (('size', b'blur'), ('spread', b'Ckmt'), ('distance', b'Dstn'), ('opacity', b'Opct'), ('angle', b'lagl')):
            if k in v:
                try:
                    d[a] = float(v[k])
                except Exception:
                    pass
        if b'uglg' in v:
            d['useGlobalAngle'] = bool(v[b'uglg'])
        try:
            c = e.color
            vals = [float(c[k]) for k in (b'Rd  ', b'Grn ', b'Bl  ')]
            d['color'] = '#%02x%02x%02x' % tuple(round(v) for v in vals)
        except Exception:
            pass
        out.append({k: (str(v) if not isinstance(v, (int, float, str, list)) else v) for k, v in d.items()})
    return out


def text_info(layer):
    ed, rd = layer.engine_dict, layer.resource_dict
    fonts = rd['FontSet']
    txt = layer.text
    runs, pos = [], 0
    for r, n in zip(ed['StyleRun']['RunArray'], ed['StyleRun']['RunLengthArray']):
        ss = r['StyleSheet']['StyleSheetData']
        fill = ss.get('FillColor', {}).get('Values')
        runs.append({
            'text': txt[pos:pos + n],
            'font': str(fonts[ss['Font']]['Name']).strip("'") if 'Font' in ss else None,
            'size': float(ss.get('FontSize', 0)),
            'color': rgb(fill) if fill else None,
            'tracking': float(ss.get('Tracking', 0)),
            'leading': float(ss['Leading']) if 'Leading' in ss else None,
            'autoLeading': bool(ss.get('AutoLeading', True)),
            'caps': int(ss.get('FontCaps', 0)),
        })
        pos += n
    para = ed['ParagraphRun']['RunArray'][0]['ParagraphSheet']['Properties']
    t = [float(x) for x in layer.transform]
    j = int(para.get('Justification', 0))
    return {
        'text': txt, 'runs': runs, 'justification': {0: 'left', 1: 'right', 2: 'center'}.get(j, j),
        'transform': t, 'scale': t[0],
    }


def layer_record(layer, opts):
    rec = {
        'name': layer.name, 'kind': layer.kind, 'visible': layer.visible,
        'bbox': list(layer.bbox), 'opacity': round(layer.opacity / 255, 4),
        'static': is_static(layer, opts), 'effects': effect_info(layer),
    }
    if layer.kind == 'type':
        rec['typography'] = text_info(layer)
    return rec


def hybrid_background(psd, dynamic_ids):
    ps = np.asarray(psd.topil().convert('RGBA')).astype(np.int16)
    full = np.asarray(psd.composite(force=True).convert('RGBA')).astype(np.int16)
    static = psd.composite(force=True, layer_filter=lambda l: l.is_visible() and id(l) not in dynamic_ids)
    static_a = np.asarray(static.convert('RGBA')).astype(np.int16)
    mask = (np.abs(full - static_a).max(-1) > 1).astype(np.uint8) * 255
    mask_img = Image.fromarray(mask).filter(ImageFilter.MaxFilter(5))
    m = (np.asarray(mask_img) > 0)[..., None]
    out = np.where(m, static_a, ps).astype(np.uint8)
    return Image.fromarray(out, 'RGBA'), float(m.mean())


def repair_panel_border(bg, ref, band=6):
    """The photo of a player special overlaps the panel's right / bottom border: Photoshop clips it to the panel, but the
    photo-less static render loses pieces of that border. The full composite (ref) has the border intact there, so the
    border band of the right and bottom edge (and the pixels just outside it) are copied from it."""
    r = np.asarray(ref)
    a = np.asarray(bg).copy()
    al = r[..., 3] > 128
    xr = np.array([np.where(row)[0].max() if row.any() else -1 for row in al])
    ex = int(np.bincount(xr[xr >= 0]).argmax())
    yb = np.array([np.where(col)[0].max() if col.any() else -1 for col in al.T])
    ey = int(np.bincount(yb[yb >= 0]).argmax())
    a[:, ex - band:ex + 12] = r[:, ex - band:ex + 12]
    a[ey - band:ey + 12, :ex + 12] = r[ey - band:ey + 12, :ex + 12]
    bg.paste(Image.fromarray(a, 'RGBA'))


def save_smart_object_png(layer, path):
    so = layer.smart_object
    if so.kind == 'data' and so.filetype in ('png', 'jpeg', 'jpg'):
        import io
        im = Image.open(io.BytesIO(so.data))
        im.load()
    else:
        im = layer.topil()
    im = im.convert('RGBA')
    bb = im.getbbox()
    if bb:
        im = im.crop(bb)
    return save_logo(im, path)


MAX_LOGO = 800


def save_logo(im, path):
    if max(im.size) > MAX_LOGO:
        f = MAX_LOGO / max(im.size)
        im = im.resize((round(im.width * f), round(im.height * f)), Image.LANCZOS)
    im.save(path, optimize=True)
    return im.size


def make_thumb(ref, path):
    bg = Image.new('RGBA', ref.size, (43, 58, 46, 255))
    Image.alpha_composite(bg, ref).convert('RGB').resize((384, 216), Image.LANCZOS).save(path, quality=85)


MKOSZ_ASSET = os.path.join(OUT, 'assets', 'mkosz-strip.png')
MKOSZ_GAP = 40  # px between the Tippmix mark and the MKOSZ logo, as in the comparison / team-stat designs


def ensure_mkosz_asset():
    """The MKOSZ logo of the bottom strip, as rendered in the 'Falco - Alba' comparison design (116 x 60 px)."""
    psd = PSDImage.open(os.path.join(SRC, TEMPLATES['comparison-men'][0]))
    layer = next(l for l in psd.descendants() if l.name == '50633_mkosz_horizontalbigger')
    os.makedirs(os.path.dirname(MKOSZ_ASSET), exist_ok=True)
    layer.topil().convert('RGBA').save(MKOSZ_ASSET, optimize=True)


def swap_pbp_for_mkosz(layers, bg, ref):
    """The designs with a 'Play by Play' logo in the strip show the MKOSZ logo instead (it must never be visible).
    The logo is placed like in the comparison / team-stat designs: 40 px right of the Tippmix mark,
    vertically centred on the Hunbasket mark. Returns True if a swap was made."""
    pbp = next((l for l in layers if l.name == 'pbp_logo'), None)
    if pbp is None:
        return False
    hb = next(l for l in layers if l.name.startswith('74641_HUNBASKET'))
    tp = next(l for l in layers if l.name.startswith('tippmix'))
    mk = Image.open(MKOSZ_ASSET).convert('RGBA')
    x0 = tp.bbox[2] + MKOSZ_GAP
    y0 = round((hb.bbox[1] + hb.bbox[3]) / 2 - mk.height / 2)
    m = 14  # margin for the logo's bevel / glow
    box = (pbp.bbox[0] - m, pbp.bbox[1] - m, pbp.bbox[2] + m, pbp.bbox[3] + m)
    ref.paste(bg.crop(box), box)  # the background has the area cleared (the logo is not part of it)
    bg.alpha_composite(mk, (x0, y0))
    ref.alpha_composite(mk, (x0, y0))
    return True


NEXTMATCH_PSD = 'Nex Match graph.psd'


def extract_nextmatch():
    """The "Következik" corner graphic: reference composite, the optional (hidden) frame layer, layer dump, thumbnail.
    Everything else in the design is dynamic (title, kick-off time, both logos), so there is no background image."""
    psd = PSDImage.open(os.path.join(SRC, NEXTMATCH_PSD))
    d = os.path.join(OUT, 'templates', 'nextmatch')
    os.makedirs(d, exist_ok=True)
    layers = list(psd.descendants())
    ref = psd.topil().convert('RGBA')
    ref.save(os.path.join(d, 'reference.png'), optimize=True)
    visibility = {id(l): l.visible for l in layers}
    for l in layers:  # render the hidden frame layer on its own
        l.visible = l.name == 'TOP keret'
    frame = psd.composite(force=True).convert('RGBA')
    for l in layers:
        l.visible = visibility[id(l)]
    frame.save(os.path.join(d, 'frame.png'), optimize=True)
    bg = Image.new('RGBA', ref.size, (43, 58, 46, 255))
    Image.alpha_composite(bg, ref).convert('RGB').crop((0, 0, 480, 270)).resize((384, 216), Image.LANCZOS).save(os.path.join(d, 'thumb.jpg'), quality=85)
    recs = [layer_record(l, {}) for l in layers]
    with open(os.path.join(d, 'layers.json'), 'w', encoding='utf-8') as fh:
        json.dump({'source_psd': NEXTMATCH_PSD, 'width': psd.width, 'height': psd.height, 'layers': recs}, fh, ensure_ascii=False, indent=1)
    print(f'nextmatch          {NEXTMATCH_PSD}: frame bbox {frame.getbbox()}')


# "Csillagjátékosok": the team comparison design with its baked-in title removed (the title becomes editable text).
PLAYERCOMPARE = {'playercompare-men': 'comparison-men', 'playercompare-women': 'comparison-women'}


def extract_playercompare(tid):
    fname, opts = TEMPLATES[PLAYERCOMPARE[tid]]
    psd = PSDImage.open(os.path.join(SRC, fname))
    d = os.path.join(OUT, 'templates', tid)
    os.makedirs(d, exist_ok=True)
    layers = list(psd.descendants())
    dynamic = {id(l) for l in layers if l.is_visible() and (not is_static(l, opts) or l.name.startswith('CSAPATOK'))}
    ref = psd.topil().convert('RGBA')
    bg, frac = hybrid_background(psd, dynamic)
    swap_pbp_for_mkosz(layers, bg, ref)
    ref.save(os.path.join(d, 'reference.png'), optimize=True)
    make_thumb(ref, os.path.join(d, 'thumb.jpg'))
    bg.save(os.path.join(d, 'background.png'), optimize=True)
    print(f'{tid:20} from {fname}: re-rendered {frac*100:.2f}%')


def main():
    only = None
    if '--only' in sys.argv:
        only = set(sys.argv[sys.argv.index('--only') + 1].split(','))
    ensure_mkosz_asset()
    for tid in PLAYERCOMPARE:
        if only and tid in only:
            extract_playercompare(tid)
            only.discard(tid)
    if only is not None and not only:
        return 0
    if only and 'nextmatch' in only:
        extract_nextmatch()
        only.discard('nextmatch')
        if not only:
            return 0
    report = {'templates': {}, 'logos': {}, 'competitions': {}}
    for tid, (fname, opts) in TEMPLATES.items():
        if only and tid not in only:
            continue
        psd = PSDImage.open(os.path.join(SRC, fname))
        d = os.path.join(OUT, 'templates', tid)
        os.makedirs(d, exist_ok=True)
        layers = [l for l in psd.descendants()]
        dynamic = {id(l) for l in layers if l.is_visible() and not is_static(l, opts)}
        ref = psd.topil().convert('RGBA')
        bg, frac = hybrid_background(psd, dynamic)
        swapped = swap_pbp_for_mkosz(layers, bg, ref)
        if tid.startswith('playerspecial'):
            repair_panel_border(bg, ref)
        ref.save(os.path.join(d, 'reference.png'), optimize=True)
        make_thumb(ref, os.path.join(d, 'thumb.jpg'))
        bg.save(os.path.join(d, 'background.png'), optimize=True)
        recs = [layer_record(l, opts) for l in layers]
        with open(os.path.join(d, 'layers.json'), 'w', encoding='utf-8') as fh:
            json.dump({'source_psd': fname, 'width': psd.width, 'height': psd.height, 'layers': recs},
                      fh, ensure_ascii=False, indent=1)
        fonts = sorted({r['font'] for rec in recs if rec['visible'] and rec.get('typography')
                        for r in rec['typography']['runs'] if r['text'].strip()})
        report['templates'][tid] = {
            'psd': fname, 'size': [psd.width, psd.height],
            'dynamic_layers': [l.name for l in layers if id(l) in dynamic],
            'pixels_rerendered_pct': round(frac * 100, 2), 'fonts_in_visible_text': fonts,
            'pbp_swapped_for_mkosz': swapped,
        }
        print(f'{tid:18} {fname:45} re-rendered {frac*100:5.2f}%  mkosz-swap={swapped}')
    if only:
        return 0

    extract_nextmatch()

    for fname, (league, mapping) in LOGO_SHEETS.items():
        psd = PSDImage.open(os.path.join(SRC, fname))
        d = os.path.join(OUT, 'logos', league)
        os.makedirs(d, exist_ok=True)
        done = set()
        # largest instance of each logo first (pixel layers have no embedded original)
        for l in sorted(psd.descendants(), key=lambda l: -(l.width * l.height)):
            club = mapping.get(l.name)
            if not club or club in done:
                continue
            p = os.path.join(d, club + '.png')
            if l.kind == 'smartobject':
                size = save_smart_object_png(l, p)
            else:
                im = l.topil().convert('RGBA')
                size = save_logo(im.crop(im.getbbox()), p)
            done.add(club)
            outline = next((e for e in effect_info(l) if e['type'] == 'DropShadow'), None)
            report['logos'][f'{league}/{club}'] = {'layer': l.name, 'size': list(size), 'outline': outline}
        missing = set(mapping.values()) - done
        if missing:
            print('MISSING logos', league, missing)

    d = os.path.join(OUT, 'assets', 'competitions')
    os.makedirs(d, exist_ok=True)
    for (fname, lname), cid in COMPETITION_MARKS.items():
        psd = PSDImage.open(os.path.join(SRC, fname))
        layer = next(l for l in psd.descendants() if l.name == lname)
        # rendered as it appears in the design (e.g. white colour overlay), effects excluded
        im = layer.composite(layer_filter=lambda x: True)
        if layer.has_effects() and any(e.__class__.__name__ == 'ColorOverlay' and e.enabled for e in layer.effects):
            src = layer.topil().convert('RGBA')
            col = next(e for e in layer.effects if e.__class__.__name__ == 'ColorOverlay').color
            c = tuple(round(float(col[k])) for k in (b'Rd  ', b'Grn ', b'Bl  '))
            solid = Image.new('RGBA', src.size, c + (255,))
            solid.putalpha(src.getchannel('A'))
            im = solid
        else:
            im = layer.topil().convert('RGBA')
        im.save(os.path.join(d, cid + '.png'), optimize=True)
        report['competitions'][cid] = {'psd': fname, 'layer': lname, 'size': list(im.size)}

    with open(os.path.join(OUT, 'logos', 'logos.json'), 'w', encoding='utf-8') as fh:
        json.dump({k: {'outline': v['outline']} for k, v in report['logos'].items()}, fh, ensure_ascii=False, indent=1)
    with open(os.path.join(OUT, 'templates', 'extraction_report.json'), 'w', encoding='utf-8') as fh:
        json.dump(report, fh, ensure_ascii=False, indent=1)
    print('logos:', len(report['logos']), 'competition marks:', len(report['competitions']))


if __name__ == '__main__':
    sys.exit(main())
