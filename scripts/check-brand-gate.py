#!/usr/bin/env python3
"""Reject upstream brand, owner, endpoint, and product identifiers in the working tree."""
from __future__ import annotations
import base64, os, re, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
TOKENS=[base64.b64decode(x).decode().lower() for x in (
'Y291Y291','bW9jaGk=','bm90Y2hidWRkeQ==','bmItaG9vaw==','bmIuc29jaw==',
'bG91aXNyYWlsbGU=','bG91aXMtY2Zt','ZnIubG91aXNyYWlsbGU=','X2NvdWNvdS5fdGNw',
'Y291Y291X2FnZW50','Y291Y291X2tpbmQ=','aUNsb3VkLmZyLmxvdWlzcmFpbGxlLkNvdWNvdQ==',
'aHR0cHM6Ly9idXkuc3RyaXBlLmNvbS9kUm02b0diZmE3S3FjcXMwaHhlczAwMw==',
'aHR0cHM6Ly9sb3Vpc3JhaWxsZS5mci9ib3Rhbg==','aHR0cHM6Ly90ZXN0ZmxpZ2h0LmFwcGxlLmNvbS9qb2luLzNHcGVIdjJi',
'aHR0cHM6Ly9jb3Vjb3UtcmVsYXkucmFpbGxlbG91aXMud29ya2Vycy5kZXY=',
'Z2l0aHViLmNvbS9UMzFTSEEvamljaG9ib3Q=')]
PATTERNS=[re.compile(re.escape(t),re.I) for t in TOKENS]
SKIP={'.git','node_modules','target','build','DerivedData','vendor','third_party','third-party','Pods','dist','release','.agents','.aws','.codex'}
def exempt(path:Path)->bool:
 name=path.name.upper()
 return name=='NOTICE' or name.startswith('LICENSE') or str(path.relative_to(ROOT))=='android/LICENSE'
def main()->int:
 hits=[]
 for directory,dirs,files in os.walk(ROOT):
  dirs[:]=[d for d in dirs if d not in SKIP]
  base=Path(directory)
  for name in files:
   path=base/name
   if exempt(path): continue
   try: lines=path.read_bytes().decode('utf-8').splitlines()
   except (UnicodeDecodeError,OSError): continue
   for i,line in enumerate(lines,1):
    matches=[p.pattern for p in PATTERNS if p.search(line.lower())]
    if matches and not ('copyright' in line.lower() or '©' in line or '(c)' in line.lower()): hits.append((path.relative_to(ROOT),i,line.strip()))
 if hits:
  for path,line,text in hits: print(f'{path}:{line}: {text}')
  print(f'FAIL: {len(hits)} forbidden non-copyright occurrence(s)'); return 1
 print('PASS: no upstream brand, owner, endpoint, or product identifier outside NOTICE, LICENSE files, and copyright lines.')
 return 0
if __name__=='__main__': raise SystemExit(main())
