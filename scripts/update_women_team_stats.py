#!/usr/bin/env python3
"""Collect verified 2026/27 men's team stats; accept official Hunbasket graph export for women.
No invented numbers. On failure, retain the last successful JSON file.
"""
import argparse, datetime as dt, io, json, os, pathlib, re, sys, unicodedata
import pandas as pd
import requests

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = 'https://kosarstat.hu/seasons/team_stats/?season=2627'
FIELDS = {'PTS /G':'ppg','Opp. PTS /G':'opp_ppg','Pace':'pace','ORtg':'ortg','DRtg':'drtg',
 '2P%':'fg2_pct','3P%':'fg3_pct','FT%':'ft_pct','EFG%':'efg_pct','TS%':'ts_pct',
 'TRB /G':'reb','ORB /G':'oreb','DRB /G':'dreb','AST /G':'ast','TOV /G':'tov','STL /G':'stl','BLK /G':'blk'}
PERCENT = {'fg2_pct','fg3_pct','ft_pct','efg_pct','ts_pct'}

def clean(s):
 s = unicodedata.normalize('NFKD', str(s)).lower()
 return re.sub(r'[^a-z0-9]','', ''.join(c for c in s if not unicodedata.combining(c)))

def colname(c):
 if isinstance(c,tuple): c=' '.join(str(x) for x in c if not str(x).startswith('Unnamed'))
 return re.sub(r'\s+',' ',str(c).replace('\n',' ')).strip()

def number(v):
 try:
  n=float(str(v).replace(',','.').replace('%','').strip())
  return n if pd.notna(n) else None
 except (ValueError,TypeError): return None

def extract_men(html):
 # Kosarstat publishes several tables (season, opponent, home and away),
 # with /G rather than PG in the column names. Select the season-wide
 # OWN-team table; never combine opponent/home/away statistics.
 from bs4 import BeautifulSoup
 soup=BeautifulSoup(html,'html.parser')
 candidates=[]
 for table in soup.select('table'):
  headings=[]
  for previous in table.find_all_previous(['h1','h2','h3','h4'],limit=3):
   headings.append(previous.get_text(' ',strip=True).lower())
  section=' '.join(headings)
  try: frame=pd.read_html(io.StringIO(str(table)),displayed_only=False)[0]
  except (ValueError,ImportError):continue
  frame.columns=[colname(c) for c in frame.columns]
  cols={clean(c):c for c in frame.columns}
  required=['csapat','ptsg','ortg','3p']
  if not all(x in cols for x in required) or len(frame)<10:continue
  # Prefer the overall season team statistics table, not opponents/venue splits.
  if any(x in section for x in ['ellenfél','hazai pályán','idegenben','utolsó 5']):continue
  candidates.append((frame,section))
 if not candidates:
  # Diagnostics useful in the GitHub Actions log, without leaking HTML.
  print('DEBUG: HTML bytes:',len(html),'tables:',len(soup.select('table')))
  for t in soup.select('table')[:6]:
   print('DEBUG: columns:',[th.get_text(' ',strip=True) for th in t.select('th')[:12]])
  raise ValueError('No season-wide Kosarstat team table found')
 frame,section=candidates[0]
 cols={clean(c):c for c in frame.columns}
 name_col=cols['csapat']
 teams=[]
 for _,row in frame.iterrows():
  name=str(row[name_col]).strip()
  if not name or name.lower() in ('nan','csapat') or 'ellenfelek' in name.lower():continue
  values={}
  for source,target in FIELDS.items():
   actual=cols.get(clean(source))
   if actual is None:continue
   val=number(row[actual])
   if val is None:continue
   if target in PERCENT and 0<=val<=1:val*=100
   values[target]=round(val,3)
  if len(values)<10:raise ValueError(f'Insufficient columns for {name}: {len(values)}')
  alias_col=cols.get('listname')
  alias=str(row[alias_col]).strip() if alias_col else ''
  teams.append({'name':name,'aliases':[alias] if alias and alias!=name and alias.lower()!='nan' else [],'periods':{'season':values}})
 if len(teams)!=14:raise ValueError(f'Expected 14 men teams, got {len(teams)}; refusing to publish')
 if len({clean(t['name']) for t in teams})!=14:raise ValueError('Duplicate teams detected')
 return teams

def write(league,source,teams,source_url):
 if not teams: raise ValueError('No verified team statistics to publish')
 target=ROOT/'data'/f'team_stats_{league}.json';target.parent.mkdir(parents=True,exist_ok=True)
 payload={'league':league,'source':source,'source_url':source_url,'updated_at':dt.datetime.now(dt.timezone.utc).isoformat(),'teams':teams}
 temp=target.with_suffix('.tmp');temp.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');temp.replace(target)
 print(f'{league}: saved {len(teams)} teams to {target}')

def men():
 r=requests.get(SOURCE,timeout=35,headers={'User-Agent':'Mozilla/5.0 (compatible; BasketballStatsUpdater/1.0)'})
 r.raise_for_status()
 write('men','kosarstat',extract_men(r.text),SOURCE)

def women(export):
 # The Hunbasket comparison chart endpoint is not publicly verified. Import only
 # a genuine structured export of that graph, never assume another endpoint.
 p=pathlib.Path(export); obj=json.loads(p.read_text(encoding='utf-8'))
 if not isinstance(obj,dict) or not isinstance(obj.get('teams'),list):raise ValueError('Export must contain teams array')
 allowed=set(FIELDS.values())|{'wins','losses','rank'}
 teams=[]
 for t in obj['teams']:
  if not isinstance(t,dict) or not t.get('name'):continue
  vals=t.get('stats',t.get('periods',{}).get('season',{}))
  if not isinstance(vals,dict):continue
  values={k:float(v) for k,v in vals.items() if k in allowed and isinstance(v,(int,float)) and not isinstance(v,bool)}
  if values:teams.append({'name':str(t['name']),'aliases':t.get('aliases',[]),'periods':{'season':values}})
 if len(teams)<8:raise ValueError('Insufficient verified Hunbasket teams')
 url=obj.get('source_url','')
 if not url.startswith('https://'):raise ValueError('Source URL required for traceability')
 write('women','hunbasket',teams,url)


# Official 2026/27 women's team-statistics pages, discovered from the league roster.
HUNBASKET_TEAMS = 'https://hunbasket.hu/csapatok'
HUNBASKET_BASE = 'https://hunbasket.hu'
WOMEN_STATS = {
 'dobottpont':'ppg', '2pontosdobo':'fg2_pct', '3pontosdobo':'fg3_pct',
 'buntetodobo':'ft_pct', 'vedolepattano':'dreb', 'tamadolepattano':'oreb',
 'osszeslepattano':'reb', 'golpassz':'ast', 'labdaszerzes':'stl',
 'eladottlabda':'tov', 'blokk':'blk', 'val':'val'
}

def parse_women_page(html, expected_name):
 from bs4 import BeautifulSoup
 soup=BeautifulSoup(html,'html.parser')
 heading=soup.find(['h1','h2'],string=lambda x: bool(x and '2026/2027' in x))
 heading_text=heading.get_text(' ',strip=True) if heading else soup.get_text(' ',strip=True)[:250]
 if clean(expected_name) not in clean(heading_text):
  raise ValueError(f'Unexpected Hunbasket team heading for {expected_name}: {heading_text[:100]}')
 values={}
 for table in soup.select('table'):
  headers=[clean(x.get_text(' ',strip=True)) for x in table.select('thead th')]
  if not ('atlag' in headers and 'kategoria' in headers):
   # Some versions use thead-less tables.
   first=table.find('tr')
   headers=[clean(x.get_text(' ',strip=True)) for x in first.find_all(['td','th'])] if first else []
  if 'atlag' not in headers or 'kategoria' not in headers:continue
  avg_i=headers.index('atlag');category_i=headers.index('kategoria')
  for row in table.select('tr'):
   cells=row.find_all(['td','th'],recursive=False)
   if len(cells)<=max(avg_i,category_i):continue
   label=clean(cells[category_i].get_text(' ',strip=True))
   # Labels include short and long display names; match the category prefix.
   for prefix,key in WOMEN_STATS.items():
    if label.startswith(prefix):
     value=number(cells[avg_i].get_text(' ',strip=True))
     if value is not None:values[key]=round(value,3)
     break
 if len(values)<9:raise ValueError(f'Only {len(values)} Hunbasket fields for {expected_name}: {list(values)}')
 return values

def women_live():
 from bs4 import BeautifulSoup
 from urllib.parse import urljoin
 session=requests.Session();session.headers.update({'User-Agent':'Mozilla/5.0 (compatible; BasketballStatsUpdater/1.0)'})
 response=session.get(HUNBASKET_TEAMS,timeout=35);response.raise_for_status()
 soup=BeautifulSoup(response.text,'html.parser')
 entries={}
 for a in soup.select('a[href]'):
  href=a.get('href','')
  match=re.search(r'/csapat/x2627/whun/(\d+)(?:/|$)',href)
  if match:
   name=a.get_text(' ',strip=True)
   if name:entries[match.group(1)]=name
 if len(entries)!=11:raise ValueError(f'Expected 11 women teams in Hunbasket roster, found {len(entries)}; refusing to publish')
 teams=[]
 for team_id,name in entries.items():
  url=f'{HUNBASKET_BASE}/csapatstatisztika/x2627/whun/{team_id}'
  r=session.get(url,timeout=35);r.raise_for_status()
  values=parse_women_page(r.text,name)
  teams.append({'name':name,'aliases':[],'periods':{'season':values},'source_url':url})
  print(f'Women: {name}: {len(values)} official metrics')
 if len({clean(t['name']) for t in teams})!=11:raise ValueError('Duplicate women teams')
 write('women','hunbasket',teams,HUNBASKET_TEAMS)

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--league',choices=['men','women'],required=True);ap.add_argument('--hunbasket-export',help='Verified Hunbasket comparison graph JSON export')
 args=ap.parse_args()
 try:
  if args.league=='men':men()
  elif args.hunbasket_export:women(args.hunbasket_export)
  else:women_live()
 except Exception as e:print(f'ERROR: {e}',file=sys.stderr);sys.exit(1)
