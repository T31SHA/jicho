#!/usr/bin/env python3
"""Generate the original JichoBot application and menu icons with Pillow."""
from __future__ import annotations
import argparse
from pathlib import Path
from PIL import Image, ImageDraw
ROOT=Path(__file__).resolve().parents[1]
SCALE=4
PALETTES={
 'default':('#24313B','#77A8B4','#FF776B'), 'Blue':('#25334B','#81A9C8','#FF8175'),
 'Graphite':('#292C33','#A1A5AD','#FF786C'), 'Green':('#213C37','#83B8A0','#FF806F'),
 'Pink':('#412B3B','#C298AA','#FF8175'), 'Purple':('#332B49','#A49AC6','#FF7D72'),
 'Orange':('#45332A','#C39B7D','#FF796B'), 'Dark':('#17212B','#697785','#FF7569'),
}
def icon(size:int,palette:str='default',menubar:bool=False)->Image.Image:
    bg,shell,eye=PALETTES.get(palette,PALETTES['default'])
    s=max(2,size*SCALE); im=Image.new('RGBA',(s,s),(0,0,0,0)); d=ImageDraw.Draw(im)
    q=lambda n:int(n*s/256)
    if not menubar:
        d.rounded_rectangle((q(3),q(3),q(253),q(253)),radius=q(57),fill=bg)
    # Compact shield silhouette with an asymmetric crest and jaw: a hard edged slate robot.
    pts=[(128,28),(166,38),(199,60),(218,91),(225,126),(217,162),(196,190),(166,208),(128,219),(91,212),(63,197),(43,170),(32,139),(35,105),(49,76),(74,53),(101,38)]
    d.polygon([(q(x),q(y)) for x,y in pts],fill=shell)
    d.line([(q(x),q(y)) for x,y in pts+[pts[0]]],fill='#C4CDD2',width=max(1,q(5)),joint='curve')
    # Lower shell bevel gives Kito a faceted silhouette without changing animation geometry.
    d.polygon([(q(45),q(154)),(q(83),q(178)),(q(128),q(185)),(q(174),q(177)),(q(210),q(153)),(q(196),q(190)),(q(166),q(208)),(q(128),q(219)),(q(91),q(212)),(q(63),q(197))],fill='#535D69')
    d.rounded_rectangle((q(43),q(91),q(213),q(165)),radius=q(31),fill='#1B2229',outline='#A6B0B8',width=max(1,q(4)))
    # Two coral lenses and their tiny warm highlights.
    for cx in (91,165):
        d.ellipse((q(cx-17),q(111),q(cx+17),q(145)),fill=eye)
        d.ellipse((q(cx-7),q(115),q(cx-1),q(121)),fill='#FFE0C8')
    d.rounded_rectangle((q(105),q(181),q(151),q(188)),radius=q(4),fill='#242B33')
    out=im.resize((size,size),Image.Resampling.LANCZOS)
    return out

def write(path:Path,size:int,palette:str='default',menubar=False,check=False):
    im=icon(size,palette,menubar)
    if check:
        if not path.exists() or Image.open(path).convert('RGBA').tobytes()!=im.tobytes(): raise RuntimeError(f'stale icon {path.relative_to(ROOT)}')
    else:
        path.parent.mkdir(parents=True,exist_ok=True); im.save(path)

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--check',action='store_true'); a=ap.parse_args(); check=a.check
    targets=[]
    app=ROOT/'JichoBot/Assets.xcassets/AppIcon.appiconset'
    for p in app.glob('*.png'):
        import re
        targets.append((p,Image.open(p).width,'default',False))
    menu=ROOT/'JichoBot/Assets.xcassets/MenuBarIcon.imageset'
    for p in menu.glob('*.png'):
        import re
        targets.append((p,Image.open(p).width,'default',True))
    phone=ROOT/'JichoBot/PhoneAssets.xcassets'
    for p in phone.rglob('*.png'):
        palette='default'
        for key in ('Blue','Graphite','Green','Pink','Purple','Orange'):
            if key in str(p): palette=key
        if 'dark' in p.name: palette='Dark'
        elif 'tinted' in p.name: palette='Graphite'
        import re
        size=Image.open(p).width
        targets.append((p,size,palette,False))
    targets += [(ROOT/'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png',192,'default',False),
      (ROOT/'windows/src-tauri/icons/icon.png',512,'default',False),
      (ROOT/'windows/src-tauri/icons/128x128.png',128,'default',False),
      (ROOT/'windows/src-tauri/icons/128x128@2x.png',256,'default',False),
      (ROOT/'windows/src-tauri/icons/32x32.png',32,'default',False),
      (ROOT/'docs/media/jichobot.png',512,'default',False)]
    for path,size,palette,menubar in targets: write(path,size,palette,menubar,check)
    ico=ROOT/'windows/src-tauri/icons/icon.ico'
    if check:
        if not ico.exists(): raise RuntimeError('missing windows icon.ico')
    else:
        icon(256).save(ico,format='ICO',sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
    print(f"{'Verified' if check else 'Generated'} {len(targets)+1} icon assets.")
if __name__=='__main__': main()
