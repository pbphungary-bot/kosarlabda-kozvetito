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
 """Read every verified 14-team table, retaining its own source category."""
 from bs4 import BeautifulSoup
 soup=BeautifulSoup(html,'html.parser')
 candidates=[]
 def category_for(table,index):
  # Prefer explicit section headings, captions, and table-container attributes.
  evidence=[]
  for node in [table,table.parent,table.parent.parent if table.parent else None]:
   if node:
    evidence.extend([str(node.get(k,'')) for k in ('id','data-title','aria-label')])
    evidence.extend(node.get('class',[]))
  cap=table.find('caption')
  if cap:evidence.append(cap.get_text(' ',strip=True))
  previous=table.find_previous(['h1','h2','h3','h4','h5'])
  if previous:evidence.append(previous.get_text(' ',strip=True))
  label=' '.join(evidence)
  key=clean(label)
  if any(x in key for x in ('ellenfel','opponent')):return 'opponent','Ellenfél statisztikák'
  if any(x in key for x in ('hazai','home')):return 'home','Hazai pályán'
  if any(x in key for x in ('idegen','away','vendeg')):return 'away','Idegenben'
  if any(x in key for x in ('utolso5','last5','recent5')):return 'last5','Utolsó 5 mérkőzés'
  if any(x in key for x in ('osszes','overall','season','teljes')):return 'season','Összes mérkőzés'
  return ('season','Összes mérkőzés') if index==0 else (f'table_{index+1}',f'KosárStat – {index+1}. táblázat')
 for table in soup.select('table'):
  try:frame=pd.read_html(io.StringIO(str(table)),displayed_only=False)[0]
  except (ValueError,ImportError):continue
  frame.columns=[colname(c) for c in frame.columns]
  cols={clean(c):c for c in frame.columns}
  if not all(k in cols for k in ('csapat','ptsg','ortg','3p')):continue
  if len(frame)<10:continue
  candidates.append((table,frame,cols))
 if not candidates:raise ValueError('No Kosarstat 14-team statistics tables found')
 canonical={clean(k):v for k,v in FIELDS.items()}
 categories={};metrics={};teams_by_name={}
 for index,(table,frame,cols) in enumerate(candidates):
  category,label=category_for(table,index)
  if category in categories:
   category=f'{category}_{index+1}';label=f'{label} ({index+1})'
  category_teams={}
  for _,row in frame.iterrows():
   name=str(row[cols['csapat']]).strip()
   if not name or name.lower() in ('nan','csapat') or 'ellenfelek' in name.lower():continue
   values={}
   for original in frame.columns:
    norm=clean(original)
    if norm in ('csapat','listname','sorszam','rank','helyezes',''):continue
    raw=number(row[original])
    if raw is None:continue
    metric=canonical.get(norm) or 'ks_'+norm
    if metric in PERCENT and 0<=raw<=1:raw*=100
    values[metric]=round(raw,3)
    if metric not in metrics:metrics[metric]={'label':original,'group':'KosárStat – további mutatók','unit':'%' if '%' in original else ''}
   if len(values)<10:raise ValueError(f'Insufficient columns for {name} in {label}')
   category_teams[clean(name)]=(name,values)
  if len(category_teams)!=14:raise ValueError(f'Expected 14 teams in {label}, got {len(category_teams)}')
  if not teams_by_name:
   for norm,(name,_) in category_teams.items():teams_by_name[norm]={'name':name,'aliases':[],'periods':{}}
  if set(category_teams)!=set(teams_by_name):
   raise ValueError(f'Team list mismatch in {label}; refusing to mix categories')
  for norm,(_,values) in category_teams.items():teams_by_name[norm]['periods'][category]=values
  categories[category]=label
 if 'season' not in categories:raise ValueError('Overall season category missing')
 return list(teams_by_name.values()),categories,metrics

def write(league,source,teams,source_url,categories=None,metrics=None):
 if not teams: raise ValueError('No verified team statistics to publish')
 target=ROOT/'data'/f'team_stats_{league}.json';target.parent.mkdir(parents=True,exist_ok=True)
 payload={'league':league,'source':source,'source_url':source_url,'updated_at':dt.datetime.now(dt.timezone.utc).isoformat(),'teams':teams}
 if categories:payload['categories']=categories
 if metrics:payload['metrics']=metrics
 temp=target.with_suffix('.tmp');temp.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');temp.replace(target)
 print(f'{league}: saved {len(teams)} teams to {target}')

def men():
 r=requests.get(SOURCE,timeout=35,headers={'User-Agent':'Mozilla/5.0 (compatible; BasketballStatsUpdater/1.0)'})
 r.raise_for_status()
 teams,categories,metrics=extract_men(r.text)
 write('men','kosarstat',teams,SOURCE,categories,metrics)
 print('Kosarstat categories:',categories)

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
