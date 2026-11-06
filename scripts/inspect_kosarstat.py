#!/usr/bin/env python3
"""Capture the public Kosarstat statistics page for accurate parser development."""
import json, pathlib, re
from urllib.parse import urljoin
import requests
from bs4 import BeautifulSoup

url = 'https://kosarstat.hu/seasons/team_stats/?season=2627'
out = pathlib.Path('kosarstat_diagnostic')
out.mkdir(exist_ok=True)
response = requests.get(url, timeout=40, headers={'User-Agent':'Mozilla/5.0','Accept-Language':'hu-HU,hu;q=0.9,en;q=0.8'})
(out / 'page.html').write_bytes(response.content)
soup = BeautifulSoup(response.content, 'html.parser')
report = {'url': response.url, 'status': response.status_code, 'title': soup.title.get_text(' ',strip=True) if soup.title else None, 'tables': [], 'forms': [], 'links': [], 'scripts': []}
for idx, table in enumerate(soup.select('table')):
    headings = [h.get_text(' ',strip=True) for h in table.select('thead th')]
    if not headings:
        row = table.find('tr')
        headings = [h.get_text(' ',strip=True) for h in row.find_all(['th','td'])] if row else []
    previous = table.find_previous(['h1','h2','h3','h4','h5'])
    report['tables'].append({'index':idx,'id':table.get('id'),'classes':table.get('class'),'previous_heading':previous.get_text(' ',strip=True) if previous else None,'headings':headings,'rows':len(table.select('tr'))})
for form in soup.select('form'):
    report['forms'].append({'action':urljoin(response.url,form.get('action','')),'method':form.get('method'),'inputs':[{'name':x.get('name'),'value':x.get('value')} for x in form.select('input,select')]})
for link in soup.select('a[href]'):
    href=link.get('href','')
    text=link.get_text(' ',strip=True)
    if re.search('ellenf|oppon|hazai|home|idegen|away|utols|last|team_stats|stat',href+' '+text,re.I):
        report['links'].append({'text':text[:100],'href':urljoin(response.url,href)})
for script in soup.select('script[src]'):
    report['scripts'].append(urljoin(response.url,script.get('src','')))
(out / 'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print('HTTP:',response.status_code,'Tables:',len(report['tables']),'Links:',len(report['links']))
for t in report['tables']:
    print('TABLE',t['index'],'rows',t['rows'],'heading',t['previous_heading'],'columns',t['headings'][:12])
print('Diagnostic saved; no existing data files modified.')
