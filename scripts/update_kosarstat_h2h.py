#!/usr/bin/env python3
"""Collect all-time men's opponent records from KosarStat's opponent SUMMARY tables.
Never infer an all-time record from partial Hunbasket schedules.
"""
import json, re, sys, time, unicodedata
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urljoin, urlparse
import requests
from bs4 import BeautifulSoup

BASE='https://kosarstat.hu'
OUT=Path('data/kosarstat_h2h.json')
# KosarStat IDs verified by the supplied Sopron/Falco opponent links.
SEEDS={'sopron':163,'falco':127}
# Exact normalized KosarStat club names, without sponsors. The historical site
# has a few defunct clubs; those are intentionally excluded.
CLUBS={
 'sopron':['sopron kc','sopron'],
 'falco':['falco kc szombathely','falco kc','falco'],
 'alba':['alba fehervar','albacomp'],
 'atomeromu':['atomeromu se'],
 'honved':['budapesti honved','bp honved'],
 'deac':['deac'],
 'kaposvar':['kaposvari kk','kaposvar'],
 'kecskemet':['kecskemet'],
 'kormend':['kormend'],
 'oroszlany':['oroszlany','ose lions'],
 'szedeak':['szedeak'],
 'szolnok':['szolnoki olajbanyasz','szolnok'],
 'nka':['nka pecs','nka universitas pecs'],
 'fot':['fot']
}

def norm(s):
 s=unicodedata.normalize('NFD',str(s or ''))
 return re.sub(r'[^a-z0-9]+',' ',''.join(c for c in s if unicodedata.category(c)!='Mn').lower()).strip()

def club(s):
 n=norm(s)
 for k,aliases in CLUBS.items():
  if n in aliases:return k
 return None

def parse_page(html,team_id):
 soup=BeautifulSoup(html,'html.parser')
 result=[]
 for tr in soup.select('tr'):
  cells=tr.find_all('td',recursive=False)
  if len(cells)<7:continue
  name=cells[0].get_text(' ',strip=True)
  opponent=club(name)
  if not opponent:continue
  texts=[c.get_text(' ',strip=True).replace('\xa0',' ') for c in cells]
  # The summary table starts: opponent, first, last, total, W, L, W%.
  if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',texts[1]):continue
  if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',texts[2]):continue
  if not all(re.fullmatch(r'\d+',texts[i].replace(' ','')) for i in (3,4,5)):continue
  total,wins,losses=(int(texts[i].replace(' ','')) for i in (3,4,5))
  if total<1 or wins+losses!=total:continue
  opp_id=None
  for a in tr.select('a[href]'):
   q=parse_qs(urlparse(urljoin(BASE,a['href'])).query)
   if 'opp' in q and 'team' in q:
    try:
     t=int(q['team'][0]);o=int(q['opp'][0]);opp_id=o if t==team_id else t if o==team_id else None
    except (ValueError,IndexError):pass
    if opp_id:break
  result.append({'opponent':opponent,'opponent_name':name,'opponent_id':opp_id,'games':total,'wins':wins,'losses':losses,'first':texts[1],'last':texts[2]})
 return result

def collect(session):
 ids=dict(SEEDS);pages={};pending=list(SEEDS.values());seen=set()
 # Discover team IDs from the opponent links; never guess IDs.
 while pending and len(seen)<20:
  team_id=pending.pop(0)
  if team_id in seen:continue
  seen.add(team_id)
  url=f'{BASE}/teams/team/opponent/?team={team_id}'
  try:
   r=session.get(url,timeout=30);r.raise_for_status()
   rows=parse_page(r.text,team_id)
  except Exception as e:
   print(f'WARN: KosarStat team {team_id}: {e}',flush=True);continue
  if not rows:
   print(f'WARN: KosarStat team {team_id}: no verified summary rows',flush=True);continue
  print(f'KosarStat team {team_id}: {len(rows)} opponent records',flush=True)
  pages[team_id]=rows
  for row in rows:
   k=row['opponent'];oid=row['opponent_id']
   if oid and k not in ids:
    ids[k]=oid
    if oid not in seen:pending.append(oid)
  time.sleep(.3)
 # Map IDs back to the verified club names.
 reverse={v:k for k,v in ids.items()}
 pairs={};conflicts=[]
 for team_id,rows in pages.items():
  a=reverse.get(team_id)
  if not a:continue
  for row in rows:
   b=row['opponent']
   if a==b:continue
   key='|'.join(sorted((a,b)))
   rec={'teams':sorted((a,b)),'games':row['games'],'first':row['first'],'last':row['last'],
        'wins':{a:row['wins'],b:row['losses']},'source_url':f'{BASE}/teams/team/opponent/?team={team_id}'}
   if key in pairs:
    prior=pairs[key]
    if prior['games']!=rec['games'] or prior['wins']!=rec['wins']:
     conflicts.append(key)
    continue
   pairs[key]=rec
 for k in conflicts:pairs.pop(k,None)
 return ids,pairs,sorted(set(conflicts))

def main():
 s=requests.Session();s.headers.update({'User-Agent':'Mozilla/5.0 (compatible; BasketballDataUpdater/1.0)','Accept-Language':'hu-HU,hu;q=0.9,en;q=0.8'})
 ids,pairs,conflicts=collect(s)
 print(f'Discovered {len(ids)} team IDs, {len(pairs)} validated pairs, conflicts: {len(conflicts)}')
 if 'falco|sopron' not in pairs:
  sys.exit('ERROR: KosarStat Sopron-Falco control pairing not found; refusing to overwrite existing JSON')
 check=pairs['falco|sopron']
 if check['games']<50 or check['wins'].get('falco',0)<30:
  sys.exit('ERROR: KosarStat control pairing failed sanity check')
 if len(pairs)<20:
  sys.exit('ERROR: fewer than 20 verified pairs; refusing to overwrite existing JSON')
 payload={'source':'kosarstat','updated_at':datetime.now(timezone.utc).isoformat(),
          'team_ids':ids,'pairs':pairs,'conflicts':conflicts}
 OUT.parent.mkdir(parents=True,exist_ok=True)
 OUT.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print(f'Saved {OUT}: {len(pairs)} all-time opponent records')

if __name__=='__main__':main()
