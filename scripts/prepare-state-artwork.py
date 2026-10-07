#!/usr/bin/env python3
"""Prepare the six generated illustrations for offline RN/RNW consumption.

Requires Pillow only at asset-authoring time. Removes the edge-connected white
backdrop, retaining enclosed ivory paper, then embeds small PNGs in a JSON module.
No network calls or credentials. Originals and prompts remain in assets/.
"""
from pathlib import Path
from collections import deque
import base64
import json
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets/illustrations/ai'
NAMES = ('tasks', 'notes', 'habits', 'calendar', 'search', 'complete')
LOCALES = ('zh-CN', 'en')


def prepare(path):
    image = Image.open(path).convert('RGBA')
    width, height = image.size
    pixels = image.load()
    seen = bytearray(width * height)
    queue = deque([(x, y) for x in range(width) for y in (0, height - 1)] +
                  [(x, y) for y in range(height) for x in (0, width - 1)])
    while queue:
        x, y = queue.popleft()
        index = y * width + x
        if seen[index]:
            continue
        seen[index] = 1
        r, g, b, a = pixels[x, y]
        if min(r, g, b) < 240 or max(r, g, b) - min(r, g, b) > 10:
            continue
        pixels[x, y] = (r, g, b, 0)
        for nx, ny in ((x-1, y), (x+1, y), (x, y-1), (x, y+1)):
            if 0 <= nx < width and 0 <= ny < height and not seen[ny * width + nx]:
                queue.append((nx, ny))
    bounds = image.getchannel('A').getbbox()
    if bounds is None:
        raise ValueError(f'Empty artwork: {path.name}')
    image = image.crop(bounds)
    edge = max(image.size)
    canvas = Image.new('RGBA', (edge, edge))
    canvas.alpha_composite(image, ((edge-image.width)//2, (edge-image.height)//2))
    return canvas.resize((128, 128), Image.Resampling.LANCZOS).quantize(
        colors=128, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE
    ).convert("RGBA")


def main():
    artwork = {locale: {} for locale in LOCALES}
    # Preview labels are deliberately separate from the runtime artwork. The
    # six source images contain no text, so both locales can share the same
    # processed PNG while reviewers still get a native-language contact sheet.
    import os
    font_path = os.environ.get('HEYTA_ARTWORK_PREVIEW_FONT', '/System/Library/Fonts/Supplemental/Songti.ttc')
    font = ImageFont.truetype(font_path, 16)
    labels = {
        'zh-CN': dict(zip(NAMES, ('收集箱', '便签', '习惯', '日历', '搜索', '已完成'))),
        'en': dict(zip(NAMES, ('Inbox', 'Notes', 'Habits', 'Calendar', 'Search', 'Complete'))),
    }
    previews = {}
    for locale in LOCALES:
        image = Image.new('RGB', (900, 600), '#F8FAFC')
        previews[locale] = (image, ImageDraw.Draw(image))

    for i, name in enumerate(NAMES):
        image = prepare(SOURCE / f'{name}-original.png')
        dest = SOURCE / f'{name}.png'
        image.save(dest, optimize=True)
        data = base64.b64encode(dest.read_bytes()).decode('ascii')
        uri = f'data:image/png;base64,{data}'
        for locale in LOCALES:
            artwork[locale][name] = uri
            preview, draw = previews[locale]
            for row, background in enumerate(('#F8FAFC', '#0F172A')):
                x, y = (i % 3)*300, (i // 3)*150 + row*300
                draw.rectangle((x, y, x+300, y+150), fill=background)
                small = image.resize((96, 96), Image.Resampling.LANCZOS)
                preview.paste(small, (x+102, y+12), small)
                draw.text((x+150, y+124), labels[locale][name], anchor='mm', font=font, fill='#64748B' if row == 0 else '#CBD5E1')
        print(json.dumps({'variant':name,'pixels':image.size,'bytes':dest.stat().st_size}))
    (ROOT / 'packages/ui/src/empty-state/state-artwork.generated.json').write_text(json.dumps(artwork, indent=2) + '\n')
    for locale, (preview, _) in previews.items():
        preview.save(SOURCE / f'contact-sheet.{locale}.png')
    # Keep the original preview path as the Chinese preview for existing links.
    previews['zh-CN'][0].save(SOURCE / 'contact-sheet.png')


if __name__ == '__main__':
    main()
