#!/usr/bin/env python3
"""Collect verified 2026/27 men's team stats; accept official Hunbasket graph export for women.
No invented numbers. On failure, retain the last successful JSON file.
"""
import argparse, datetime as dt, io, json, os, pathlib, re, sys, unicodedata
import pandas as pd
import requests

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = 'https://kosarstat.hu/seasons/team_stats/?season=2627'
FIELDS = {'PTS PG':'ppg','Opp. PTS PG':'opp_ppg','Pace':'pace','ORtg':'ortg','DRtg':'drtg',
 '2P%':'fg2_pct','3P%':'fg3_pct','FT%':'ft_pct','EFG%':'efg_pct','TS%':'ts_pct',
 'TRB PG':'reb','ORB PG':'oreb','DRB PG':'dreb','AST PG':'ast','TOV PG':'tov','STL PG':'stl','BLK PG':'blk'}
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
 tables=pd.read_html(io.StringIO(html), displayed_only=False)
 candidates=[]
 for frame in tables:
  frame.columns=[colname(c) for c in frame.columns]
  cols=list(frame.columns)
  if 'ORtg' in cols and 'PTS PG' in cols and '3P%' in cols and len(frame)>=10:
   candidates.append(frame)
 if not candidates: raise ValueError('Kosarstat team statistics table not found; site structure may have changed')
 frame=max(candidates,key=len)
 # The season page is requested with ?season=2627, but some tables contain multi-season data.
 if 'Szezon' in frame.columns:
  frame=frame[frame['Szezon'].astype(str).str.contains(r'2026\s*[-/]\s*2(?:027|7)|2026-27|2627',case=False,regex=True)]
 if len(frame)<10 or len(frame)>18: raise ValueError(f'Expected 14 current teams, got {len(frame)} rows; refusing to publish mixed seasons')
 teams=[]
 for _,row in frame.iterrows():
  name=str(row.iloc[0]).strip()
  if not name or name.lower() in ('nan','csapat'):continue
  values={}
  for source,target in FIELDS.items():
   if source not in frame.columns:continue
   val=number(row[source])
   if val is None:continue
   if target in PERCENT and 0<=val<=1: val*=100
   values[target]=round(val,3)
  if len(values)<10: raise ValueError('Missing too many statistical columns')
  teams.append({'name':name,'aliases':[str(row.iloc[1]).strip()] if len(row)>1 and str(row.iloc[1]).strip()!=name else [],'periods':{'season':values}})
 if len({clean(t['name']) for t in teams})!=len(teams):raise ValueError('Duplicate teams detected')
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
