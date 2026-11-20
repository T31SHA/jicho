#!/usr/bin/env python3
"""Apply the repeatable product identity mapping from rebrand-map.json."""
from __future__ import annotations
import argparse, base64, json, os, re, sys
from pathlib import Path

def decode(rule: dict[str, str]) -> tuple[str, str]:
    return base64.b64decode(rule['source_b64']).decode('utf-8'), rule['target']

def excluded(path: Path, root: Path, skip: set[str]) -> bool:
    rel = path.relative_to(root)
    if any(part in skip for part in rel.parts):
        return True
    name = path.name.upper()
    return name == 'NOTICE' or name == 'LICENSE-ASSETS.MD' or name.startswith('LICENSE')

def rename_paths(root: Path, rules: list[dict[str,str]], skip: set[str]) -> int:
    decoded = [decode(rule) for rule in rules]
    changed = 0
    for directory, dirs, files in os.walk(root, topdown=False):
        base = Path(directory)
        for name in files + dirs:
            current = base / name
            if not current.exists() or excluded(current, root, skip): continue
            rel = current.relative_to(root).as_posix()
            updated = name
            for source, target in decoded:
                if '/' in source:
                    if current.is_dir() and rel == source: updated = target; break
                else:
                    updated = updated.replace(source, target)
            if updated == name: continue
            dest = (root / updated) if '/' in updated else (base / updated)
            if dest.exists():
                if current.is_dir() and not any(current.iterdir()):
                    current.rmdir(); changed += 1; continue
                raise FileExistsError(f'refusing to merge {current} into {dest}')
            dest.parent.mkdir(parents=True, exist_ok=True)
            current.rename(dest); changed += 1
    return changed

def rewrite(root: Path, rules: list[dict[str,str]], skip: set[str]) -> int:
    decoded = [decode(rule) for rule in rules]
    changed = 0
    for directory, dirs, files in os.walk(root, topdown=True):
        dirs[:] = [d for d in dirs if d not in skip]
        base = Path(directory)
        for name in files:
            path = base / name
            if excluded(path, root, skip): continue
            try: lines = path.read_bytes().decode('utf-8').splitlines(keepends=True)
            except (UnicodeDecodeError, OSError): continue
            out=[]; touched=False
            for line in lines:
                if 'copyright' in line.lower() or '©' in line:
                    out.append(line); continue
                updated=line
                for source,target in decoded: updated=updated.replace(source,target)
                out.append(updated); touched |= updated != line
            if touched: path.write_bytes(''.join(out).encode()); changed += 1
    return changed

def main() -> int:
    parser=argparse.ArgumentParser(); parser.add_argument('--root',type=Path,default=Path.cwd()); args=parser.parse_args()
    root=args.root.resolve(); cfg=json.loads((Path(__file__).with_name('rebrand-map.json')).read_text())
    skip=set(cfg['skip_directories'])
    p=rename_paths(root,cfg['path_rules'],skip); f=rewrite(root,cfg['content_rules'],skip)
    print(f'Renamed {p} paths and rewrote {f} UTF-8 files.'); return 0
if __name__=='__main__': sys.exit(main())
