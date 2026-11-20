"""Print a compact layer report for each PSD (read-only)."""
import sys, glob, os, warnings
warnings.filterwarnings('ignore')
from psd_tools import PSDImage

def style(l):
    ss = l.engine_dict['StyleRun']['RunArray'][0]['StyleSheet']['StyleSheetData']
    font = l.resource_dict['FontSet'][ss['Font']]['Name']
    para = l.engine_dict['ParagraphRun']['RunArray'][0]['ParagraphSheet']['Properties']
    fill = ss.get('FillColor', {}).get('Values')
    rgb = '#%02x%02x%02x' % tuple(round(v*255) for v in fill[1:]) if fill else None
    return dict(font=str(font), size=round(float(ss.get('FontSize', 0)), 2), color=rgb,
                tracking=ss.get('Tracking'), lead=ss.get('Leading'), autolead=ss.get('AutoLeading'),
                just=para.get('Justification'), caps=ss.get('FontCaps'))

def fx(l):
    out = []
    if not l.has_effects(): return out
    for e in l.effects:
        if not e.enabled: continue
        d = {'t': e.__class__.__name__}
        for a in ('size', 'distance', 'angle', 'opacity', 'position'):
            if hasattr(e, a):
                try: d[a] = getattr(e, a)
                except Exception: pass
        try:
            c = e.color
            d['color'] = {k: float(v) for k, v in c.items()} if hasattr(c, 'items') else str(c)
        except Exception: pass
        out.append(d)
    return out

for f in sorted(sys.argv[1:]):
    psd = PSDImage.open(f)
    print('=====', os.path.basename(f), psd.size)
    for l in psd.descendants():
        s = f"{l.kind:11} v={int(l.visible)} {l.bbox} op={l.opacity} {l.name[:60]!r}"
        if l.kind == 'type':
            try: s += f" {style(l)} tr={tuple(round(x,1) for x in l.transform)}"
            except Exception as e: s += f' styleERR {e}'
            s += ' txt=' + repr(l.text[:200])
        e = fx(l)
        if e: s += f' fx={e}'
        print('  ' + s)
