#!/usr/bin/env python3
"""Hunbasket player per-game stats collector; no synthetic data."""
import argparse, json, re, sys, urllib.request, unicodedata
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin
from bs4 import BeautifulSoup

ROOT=Path(__file__).resolve().parents[1]
SEASON='x2627'
LEAGUES={'men':('hun',14,'ferfi'),'women':('whun',11,'noi')}
COLS=['#','Játékos','M.','K.','P.','Idő','2P S','2P K','2P %','Középtáv S','Középtáv K','Középtáv %','3P S','3P K','3P %','BT S','BT K','BT %','VLP','TLP','ÖLP','SZL','EL','Fault','Kih. fault','GP','Blokk','Kapott blokk','VAL','O.RTG','D.RTG','TS%','ES%']
ROSTER={'men': ['Alba Fehérvár', 'Atomerőmű SE', 'Bp. Honvéd', 'DEAC', 'Falco KC', 'Kaposvár', 'Kecskemét', 'Körmend', 'Oroszlány', 'Sopron', 'Szedeák', 'Szolnok', 'NKA Pécs', 'Fót'], 'women': ['BKG-PRIMA Szigetszentmiklós', 'Csata TKK', 'DVTK HUNTHERM', 'ELTE BEAC Újbuda', 'ETO Basket', 'KSC Szekszárd', 'NKA Universitas Pécs', 'Sopron Basket', 'TFSE', 'Vasas Akadémia', 'VBW CEKK Cegléd']}
SEEDS={'men': {'9002': 'Falco-Vulcano Energia KC Szombathely', '9006': 'Sopron KC', '40000': 'DEAC', '9800': 'Duna Aszfalt-DTKH Kecskemét', '40067': 'PHOENIX Fóti Tigrisek'}, 'women': {'40058': 'BKG-PRIMA Szigetszentmiklós', '10097': 'Csata TKK', '10005': 'DVTK HUNTHERM', '51008': 'ELTE BEAC Újbuda', '51119': 'ETO Basket', '51006': 'KSC Szekszárd', '19006': 'NKA Universitas Pécs', '51001': 'Sopron Basket', '51142': 'TFSE', '51149': 'Vasas Akadémia', '51150': 'VBW CEKK Cegléd'}}

def norm(s):
 s=unicodedata.normalize('NFKD',s.casefold());return re.sub(r'[^a-z0-9]','', ''.join(c for c in s if not unicodedata.combining(c)))

def get(url):
 req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0','Accept-Language':'hu-HU,hu;q=0.9'})
 with urllib.request.urlopen(req,timeout=35) as r:return r.read().decode('utf-8','replace')

def parse(html, league, team_id):
 soup=BeautifulSoup(html,'html.parser')
 header=soup.select_one('.team-stat-header h1')
 if not header:raise ValueError('Missing team heading')
 name=header.get_text(' ',strip=True)
 table=soup.select_one('.player-stat-table table')
 if not table:raise ValueError('Missing player-stat-table')
 head=table.select('thead tr')
 if not head or 'átlag' not in head[0].get_text(' ',strip=True).lower():raise ValueError('Not per-game averages')
 players=[]
 for tr in table.select('tbody tr'):
  cells=tr.find_all('td',recursive=False)
  if len(cells)!=len(COLS):continue
  a=cells[1].select_one('a.player-link')
  if not a:continue
  row=[c.get_text(' ',strip=True) for c in cells]
  player_name=a.select_one('.player-link-name')
  if player_name:row[1]=player_name.get('title') or player_name.get_text(' ',strip=True)
  if not row[1] or not re.fullmatch(r'\d+',row[2]):continue
  players.append(row)
 if not players:raise ValueError('No player rows parsed')
 return {'club_id':str(team_id),'name':name,'aliases':[name],'source_url':f'https://hunbasket.hu/csapat-statisztika/{SEASON}/{LEAGUES[league][0]}/{team_id}/','columns':COLS,'players':players,'stat_type':'per_game'}

def extract_team_id(href, league):
 """Accept actual Hunbasket team links, including legacy csapat.php?id=... ."""
 from urllib.parse import urlparse, parse_qs
 code=LEAGUES[league][0]
 parsed=urlparse(href)
 if parsed.netloc and not parsed.netloc.endswith('hunbasket.hu'):return None
 path=parsed.path
 m=re.search(rf'/(?:csapat|csapat-statisztika|csapatstatisztika|csapat-musor|csapat-adatlap)/{SEASON}/{code}/(\d+)(?:/|$)',path,re.I)
 if m:return m.group(1)
 if path.endswith('/csapat.php') and parse_qs(parsed.query).get('year')==[SEASON] and parse_qs(parsed.query).get('nat')==[code]:
  return parse_qs(parsed.query).get('id',[None])[0]
 return None

def resolve_roster_name(label, league):
 """Only accept a name from the current 2026/27 competition roster."""
 key=norm(label)
 for name in ROSTER[league]:
  if key==norm(name):return name
 return None

def extract_links(html, league, base_url):
 soup=BeautifulSoup(html,'html.parser')
 found={}
 for a in soup.find_all('a',href=True):
  team_id=extract_team_id(urljoin(base_url,a['href']),league)
  if not team_id:continue
  name=resolve_roster_name(a.get_text(' ',strip=True),league)
  if name:found[team_id]=name
 return found

def discover(league):
 code,expected,division=LEAGUES[league]
 ids=dict(SEEDS[league])
 urls=[f'https://hunbasket.hu/csapatok?year={SEASON}',
       'https://hunbasket.hu/csapatok',
       f'https://hunbasket.hu/tabella/{division}',
       f'https://hunbasket.hu/menetrend-teljes/{division}/{SEASON}/{code}',
       f'https://hunbasket.hu/menetrend-teljes/{SEASON}/{code}']
 for url in urls:
  try:html=get(url)
  except Exception as e:
   print('Discovery failed:',url,str(e),flush=True);continue
  candidates=extract_links(html,league,url)
  for team_id,name in candidates.items():
   # A name can never resolve to two IDs in the same season.
   for old_id,old_name in list(ids.items()):
    if norm(old_name)==norm(name) and old_id!=team_id:
     raise ValueError(f'Conflicting IDs for {name}: {old_id} vs {team_id}')
   ids[team_id]=name
  if len(ids)>=expected:break
 # No stale-season teams or extra clubs may enter the dataset.
 ids={key:name for key,name in ids.items() if resolve_roster_name(name,league)}
 print(f'{league} discovered {len(ids)}/{expected} roster IDs',flush=True)
 return ids

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--sample-men');ap.add_argument('--sample-women');ap.add_argument('--offline',action='store_true');ap.add_argument('--require-complete',action='store_true',help='Do not write any JSON unless both leagues have exact expected team coverage');args=ap.parse_args()
 total=0
 staged={}
 failed=[]
 for league in LEAGUES:
  code,expected,_=LEAGUES[league];path=ROOT/'data'/f'player_stats_{league}.json'
  try:old=json.loads(path.read_text(encoding='utf-8'))
  except Exception:old={'league':league,'teams':[]}
  previous={t['club_id']:t for t in old.get('teams',[]) if t.get('club_id')}
  ids=dict(SEEDS[league]) if args.offline else discover(league)
  # Preserve previously identified clubs across runs.
  ids.update({key:value.get('name','') for key,value in previous.items() if resolve_roster_name(value.get('name',''),league)})
  new={key:value for key,value in previous.items() if resolve_roster_name(value.get('name',''),league)};errors=[]
  for team_id in ids:
   sample=args.sample_men if league=='men' else args.sample_women
   try:
    if args.offline and team_id not in SEEDS[league]:continue
    html=Path(sample).read_text(encoding='utf-8') if sample and team_id in SEEDS[league] else get(f'https://hunbasket.hu/csapat-statisztika/{SEASON}/{code}/{team_id}/')
    club=parse(html,league,team_id)
    expected_name=resolve_roster_name(ids[team_id],league)
    actual_name=resolve_roster_name(club['name'],league)
    if not expected_name or not actual_name or norm(expected_name)!=norm(actual_name):
     raise ValueError(f'Team identity mismatch: expected {ids[team_id]}, got {club["name"]}')
    new[team_id]=club
    print(league,team_id,club['name'],len(club['players']),'players',flush=True)
   except Exception as e:errors.append(f'{team_id}: {e}')
  if not new:
   print('ERROR: No verified player stats for',league,errors,file=sys.stderr)
   failed.append(league)
   continue
  teams=sorted(new.values(),key=lambda t:norm(t['name']))
  # Preserve timestamps when player data is unchanged, avoiding repeated commits.
  result={'league':league,'source':'hunbasket','season':'2026/27','stat_type':'per_game','updated_at':old.get('updated_at'),'teams':teams}
  comparable={k:v for k,v in result.items() if k!='updated_at'}
  old_comparable={k:v for k,v in old.items() if k!='updated_at'}
  if comparable!=old_comparable:
   result['updated_at']=datetime.now(timezone.utc).isoformat()
   staged[path]=result
  print(f'{league}: {len(teams)}/{expected} clubs with verified player data; {len(errors)} fetch errors',flush=True)
  for err in errors:print('  ',err,flush=True)
  total+=len(teams)
  if len(teams)!=expected or len({norm(t['name']) for t in teams})!=expected or errors:
   failed.append(f'{league}: {len(teams)}/{expected}, {len(errors)} fetch errors')
 if args.require_complete and failed:
  sys.exit('COVERAGE CHECK FAILED; no files changed: '+ '; '.join(failed))
 if not total:sys.exit('No verified player data collected')
 for path,result in staged.items():
  path.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print(f'COMMITTED DATASETS: {len(staged)}; total teams: {total}/25')

if __name__=='__main__':main()
