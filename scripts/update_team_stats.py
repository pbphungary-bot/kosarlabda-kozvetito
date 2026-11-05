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

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--league',choices=['men','women'],required=True);ap.add_argument('--hunbasket-export',help='Verified Hunbasket comparison graph JSON export')
 args=ap.parse_args()
 try:
  if args.league=='men':men()
  elif args.hunbasket_export:women(args.hunbasket_export)
  else:print('Women: no verified graph endpoint/export configured; retaining existing data (no fabricated stats)')
 except Exception as e:print(f'ERROR: {e}',file=sys.stderr);sys.exit(1)
