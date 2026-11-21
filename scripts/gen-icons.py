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
    bg,_,eye=PALETTES.get(palette,PALETTES['default'])
    shell='#92959C'
    s=max(2,size*SCALE); im=Image.new('RGBA',(s,s),(0,0,0,0)); d=ImageDraw.Draw(im)
    q=lambda n:int(n*s/256)
    if not menubar:
        d.rounded_rectangle((q(3),q(3),q(253),q(253)),radius=q(57),fill=bg)
    # Smooth hood, inset visor, twin pill lenses and the peach neck seams from
    # legacy/electron/mascot/jicho-mascot.css and its shipped icon.
    d.rounded_rectangle((q(31),q(25),q(225),q(225)),radius=q(62),fill=shell,outline='#A7AAB0',width=max(1,q(4)))
    d.rounded_rectangle((q(44),q(143),q(212),q(221)),radius=q(36),fill='#646970')
    d.line((q(91),q(158),q(88),q(184)),fill='#E8B9A0',width=max(1,q(5)))
    d.line((q(165),q(158),q(168),q(184)),fill='#E8B9A0',width=max(1,q(5)))
    d.rounded_rectangle((q(38),q(67),q(218),q(151)),radius=q(36),fill='#0B0C0F',outline='#C2CDD3',width=max(1,q(4)))
    d.ellipse((q(58),q(73),q(92),q(81)),fill=(255,255,255,24))
    for cx in (91,165):
        d.rounded_rectangle((q(cx-15),q(83),q(cx+15),q(139)),radius=q(15),fill=eye)
        d.rounded_rectangle((q(cx-5),q(89),q(cx+1),q(108)),radius=q(3),fill='#FFE3DF')
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
