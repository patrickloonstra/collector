"""Maakt eigen voorbeeldbeelden voor de schermopnames in de README (geen werk van anderen).
Gebruik: python3 docs/maak-voorbeelden.py <doelmap>"""
import sys, os, math, random
from PIL import Image, ImageDraw, ImageFilter
out = sys.argv[1]; os.makedirs(out, exist_ok=True); random.seed(7)
PAL = [('#0b3d2e','#f4efe4','#e8553a'),('#101820','#f2aa4c','#f7f3ea'),('#f6d8e0','#d7263d','#1b1b1e'),('#1d3557','#a8dadc','#f1faee'),('#fdf0d5','#c1121f','#003049'),
       ('#2b2d42','#8d99ae','#ef233c'),('#e9edc9','#606c38','#283618'),('#ffb703','#023047','#fb8500'),('#f8f9fa','#212529','#6c757d'),('#3a0ca3','#f72585','#4cc9f0'),
       ('#fefae0','#bc6c25','#283618'),('#0d1b2a','#e0e1dd','#778da9'),('#f4f1de','#e07a5f','#3d405b'),('#d8f3dc','#2d6a4f','#081c15'),('#ffe5ec','#fb6f92','#3c1642')]
SIZES = [(900,1200),(1200,800),(1000,1000),(800,1100),(1400,900),(1080,1350),(1200,1200),(1300,860)]
def rgb(h): return tuple(int(h[i:i+2],16) for i in (1,3,5))
def gradient(im, a, b, vertical=True):
    d = ImageDraw.Draw(im); w, h = im.size; a, b = rgb(a), rgb(b)
    n = h if vertical else w
    for i in range(n):
        t = i / n; c = tuple(int(a[k] + (b[k]-a[k])*t) for k in range(3))
        d.line([(0,i),(w,i)] if vertical else [(i,0),(i,h)], fill=c)
def stripes(d, w, h, c, n, diag):
    s = (w + h) / n
    for i in range(0, n*2, 2):
        x = i * s - h
        d.polygon([(x,0),(x+s,0),(x+s+(h if diag else 0),h),(x+(h if diag else 0),h)], fill=c)
def dots(d, w, h, c, n):
    s = w / n
    for y in range(int(h/s)+1):
        for x in range(n+1):
            d.ellipse([x*s+s*.2+(s/2 if y%2 else 0)-s/2, y*s+s*.2, x*s+s*.8+(s/2 if y%2 else 0)-s/2, y*s+s*.8], fill=c)
def blocks(d, w, h, cols):
    y = h*.12
    for i in range(random.randint(4,7)):
        bh = h*random.uniform(.05,.14); bw = w*random.uniform(.3,.8)
        d.rounded_rectangle([w*.1, y, w*.1+bw, y+bh], radius=bh*.2, fill=cols[i%2]); y += bh + h*.035
        if y > h*.85: break
def arcs(d, w, h, cols):
    for i in range(6, 0, -1):
        r = min(w,h)*.13*i; d.ellipse([w*.5-r, h*.62-r, w*.5+r, h*.62+r], fill=cols[i%2])
def grid(d, w, h, cols):
    n = random.randint(3,5); s = w/n
    for y in range(int(h/s)+1):
        for x in range(n):
            if random.random() < .55: d.rectangle([x*s+6, y*s+6, (x+1)*s-6, (y+1)*s-6], fill=cols[(x+y)%2])
            elif random.random() < .5: d.ellipse([x*s+10, y*s+10, (x+1)*s-10, (y+1)*s-10], fill=cols[(x+y+1)%2])
def blob(im, w, h, cols):
    layer = Image.new('RGB', (w,h), rgb(cols[0])); d = ImageDraw.Draw(layer)
    for i in range(7):
        r = min(w,h)*random.uniform(.18,.42); x = random.uniform(0,w); y = random.uniform(0,h)
        d.ellipse([x-r,y-r,x+r,y+r], fill=rgb(cols[1+i%2]))
    im.paste(layer.filter(ImageFilter.GaussianBlur(min(w,h)*.09)))
def poster(d, w, h, cols):
    d.ellipse([w*.42, h*.12, w*.92, h*.12+w*.5], fill=cols[0])
    d.rectangle([w*.08, h*.58, w*.6, h*.86], fill=cols[1])
    for i in range(3): d.rectangle([w*.08, h*(.1+i*.045), w*.3, h*(.1+i*.045)+h*.018], fill=cols[1])
names = ['Poster', 'Patroon', 'Verpakking', 'Typografie', 'Landschap', 'Raster', 'Kleurstudie', 'Affiche', 'Stippen', 'Strepen', 'Bogen', 'Vlakken']
for i in range(30):
    a, b, c = PAL[i % len(PAL)] if i < len(PAL) else random.sample(PAL[random.randrange(len(PAL))], 3)
    w, h = SIZES[i % len(SIZES)]; im = Image.new('RGB', (w,h), rgb(a)); d = ImageDraw.Draw(im)
    kind = i % 8
    if kind == 0: poster(d, w, h, (b, c))
    elif kind == 1: stripes(d, w, h, b, random.randint(7,14), True)
    elif kind == 2: blob(im, w, h, (a, b, c))
    elif kind == 3: blocks(d, w, h, (b, c))
    elif kind == 4: gradient(im, a, b); ImageDraw.Draw(im).ellipse([w*.55, h*.15, w*.55+min(w,h)*.3, h*.15+min(w,h)*.3], fill=c)
    elif kind == 5: grid(d, w, h, (b, c))
    elif kind == 6: dots(d, w, h, b, random.randint(5,9))
    else: arcs(d, w, h, (b, c))
    im.save(os.path.join(out, f'{names[i % len(names)]} {i+1:02d}.jpg'), quality=86)
print('30 voorbeelden in', out)
