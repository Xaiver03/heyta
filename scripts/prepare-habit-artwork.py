#!/usr/bin/env python3
"""Cut the generated habit icon atlas into transparent runtime PNGs.

The source atlas is kept intact in ``assets/illustrations/habits``.  This is an
asset-authoring script only: it removes the edge-connected white cell
background, crops each 256px cell to its artwork, normalizes it to a square,
and embeds the resulting small PNGs in the shared UI JSON module.
"""

from __future__ import annotations

import base64
import json
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets/illustrations/habits/habit-icons-atlas.png"
DEST = ROOT / "assets/illustrations/habits/icons"
GENERATED = ROOT / "packages/ui/src/habits/habit-artwork.generated.json"

# This order is the product order and matches the atlas left-to-right,
# top-to-bottom.  The first eight keys are the original persisted icon keys.
NAMES = (
    "drop",
    "activity",
    "book",
    "moon",
    "leaf",
    "pencil",
    "sun",
    "music",
    "heart",
    "strength",
    "meditation",
    "tea",
    "fruit",
    "cycling",
    "camera",
    "art",
    "code",
    "dental",
    "pet",
    "savings",
    "home",
    "language",
    "journal",
    "walking",
)


def remove_edge_white(image: Image.Image) -> Image.Image:
    """Make only edge-connected near-white pixels transparent.

    Enclosed white pixels, such as the laptop screen and tooth, are preserved.
    That distinction is the reason this is a flood fill rather than a global
    white-to-alpha replacement.
    """

    image = image.convert("RGBA")
    width, height = image.size
    pixels = image.load()
    seen = bytearray(width * height)
    queue = deque(
        [(x, y) for x in range(width) for y in (0, height - 1)]
        + [(x, y) for y in range(height) for x in (0, width - 1)]
    )
    while queue:
        x, y = queue.popleft()
        index = y * width + x
        if seen[index]:
            continue
        seen[index] = 1
        r, g, b, _ = pixels[x, y]
        if min(r, g, b) < 240 or max(r, g, b) - min(r, g, b) > 10:
            continue
        pixels[x, y] = (r, g, b, 0)
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height and not seen[ny * width + nx]:
                queue.append((nx, ny))
    return image


def prepare_cell(cell: Image.Image, target_y: int) -> Image.Image:
    image = remove_edge_white(cell)
    # A few generated badges sit a handful of pixels across a horizontal
    # 256px boundary (the row-4 badges visibly do this in the source atlas).
    # The caller gives us a 32px vertical bleed. Keep the connected artwork
    # component nearest the target cell center so the neighbouring row cannot
    # become part of the exported icon.
    width, height = image.size
    seen = bytearray(width * height)
    components: list[tuple[int, int, int, int, int]] = []
    pixels = image.load()
    for y in range(height):
        for x in range(width):
            index = y * width + x
            if seen[index] or pixels[x, y][3] == 0:
                continue
            queue = deque([(x, y)])
            seen[index] = 1
            points: list[tuple[int, int]] = []
            while queue:
                px, py = queue.popleft()
                points.append((px, py))
                for nx, ny in ((px - 1, py), (px + 1, py), (px, py - 1), (px, py + 1)):
                    if 0 <= nx < width and 0 <= ny < height:
                        nindex = ny * width + nx
                        if not seen[nindex] and pixels[nx, ny][3] != 0:
                            seen[nindex] = 1
                            queue.append((nx, ny))
            if len(points) < 20:
                continue
            xs = [point[0] for point in points]
            ys = [point[1] for point in points]
            components.append((len(points), min(xs), min(ys), max(xs), max(ys)))
    if not components:
        raise ValueError("habit atlas cell has no artwork component")
    _, left, top, right, bottom = min(
        components,
        key=lambda component: abs(((component[2] + component[4]) / 2) - target_y)
        + abs(((component[1] + component[3]) / 2) - width / 2),
    )
    keep = Image.new("RGBA", image.size)
    keep.alpha_composite(image.crop((left, top, right + 1, bottom + 1)), (left, top))
    image = keep
    bounds = image.getchannel("A").getbbox()
    if bounds is None:
        raise ValueError("habit atlas cell has no artwork")
    image = image.crop(bounds)
    # Keep a small transparent safety margin.  The atlas's pale badges are
    # occasionally tangent to a cell edge; resizing the tight crop directly
    # would make their circular silhouette look clipped at 32px.
    edge = max(image.size) + 16
    canvas = Image.new("RGBA", (edge, edge))
    canvas.alpha_composite(image, ((edge - image.width) // 2, (edge - image.height) // 2))
    return canvas.resize((128, 128), Image.Resampling.LANCZOS).quantize(
        colors=128,
        method=Image.Quantize.FASTOCTREE,
        dither=Image.Dither.NONE,
    ).convert("RGBA")


def main() -> None:
    atlas = Image.open(SOURCE).convert("RGB")
    if atlas.size != (1536, 1024):
        raise ValueError(f"expected a 1536x1024 atlas, got {atlas.size}")
    DEST.mkdir(parents=True, exist_ok=True)

    artwork: dict[str, str] = {}
    for index, name in enumerate(NAMES):
        x = (index % 6) * 256
        y = (index // 6) * 256
        bleed = 32
        crop_top = max(0, y - bleed)
        crop_bottom = min(atlas.height, y + 256 + bleed)
        output = prepare_cell(
            atlas.crop((x, crop_top, x + 256, crop_bottom)),
            target_y=(y + 128) - crop_top,
        )
        destination = DEST / f"{name}.png"
        output.save(destination, optimize=True)
        artwork[name] = "data:image/png;base64," + base64.b64encode(destination.read_bytes()).decode("ascii")

    GENERATED.write_text(json.dumps(artwork, indent=2) + "\n")
    print(json.dumps({"icons": len(artwork), "size": [128, 128], "generated": str(GENERATED)}))


if __name__ == "__main__":
    main()
