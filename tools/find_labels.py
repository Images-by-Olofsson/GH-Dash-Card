"""Find the white label boxes (thin dark border) in a floor-plan image.

Usage: python tools/find_labels.py dist/plan.png [debug.png]
Prints a JSON list of {x, y, w, h} in percent of the image (1 decimal),
sorted top to bottom. With a second argument, writes a debug image with the
found boxes drawn in red.
"""
import json
import sys

from PIL import Image, ImageDraw


def find_boxes(img):
    rgb = img.convert("RGB")
    W, H = rgb.size
    px = rgb.load()

    def dark(x, y):
        r, g, b = px[x, y]
        return r < 90 and g < 90 and b < 90

    def white(x, y):
        r, g, b = px[x, y]
        return r > 235 and g > 235 and b > 235

    boxes = []
    seen = set()
    # A label's top border = a horizontal dark run 20..260 px long with white just below.
    for y in range(1, H - 2):
        x = 0
        while x < W:
            if not dark(x, y):
                x += 1
                continue
            x0 = x
            while x < W and dark(x, y):
                x += 1
            run = x - x0
            if not (20 <= run <= 260):
                continue
            x1 = x - 1
            if (x0, y) in seen or not white((x0 + x1) // 2, y + 2):
                continue
            # Follow the left border down to find the bottom border.
            y1 = y + 1
            while y1 < H and dark(x0, y1):
                y1 += 1
            y1 -= 1
            h = y1 - y
            if not (15 <= h <= 200):
                continue
            # Bottom and right borders must be dark too (allow 1 px slack).
            bottom = sum(dark(xx, y1) or dark(xx, y1 - 1) for xx in range(x0, x1 + 1)) / (x1 - x0 + 1)
            right = sum(dark(x1, yy) or dark(x1 - 1, yy) for yy in range(y, y1 + 1)) / (h + 1)
            if bottom < 0.8 or right < 0.8:
                continue
            inner = [(xx, yy) for xx in range(x0 + 3, x1 - 2, 3) for yy in range(y + 3, y1 - 2, 3)]
            if not inner or sum(white(*p) for p in inner) / len(inner) < 0.7:
                continue
            for yy in range(y, y1 + 1):
                seen.add((x0, yy))
            boxes.append((x0, y, x1, y1))
    # Drop boxes nested in another box.
    out = [b for b in boxes if not any(o != b and o[0] <= b[0] and o[1] <= b[1] and o[2] >= b[2] and o[3] >= b[3] for o in boxes)]
    return W, H, sorted(set(out), key=lambda b: (b[1], b[0]))


def main():
    img = Image.open(sys.argv[1])
    W, H, boxes = find_boxes(img)
    res = [
        {"x": round(x0 / W * 100, 1), "y": round(y0 / H * 100, 1),
         "w": round((x1 - x0 + 1) / W * 100, 1), "h": round((y1 - y0 + 1) / H * 100, 1),
         "px": [x0, y0, x1, y1]}
        for x0, y0, x1, y1 in boxes
    ]
    print(json.dumps(res, indent=1))
    if len(sys.argv) > 2:
        dbg = img.convert("RGB")
        d = ImageDraw.Draw(dbg)
        for i, (x0, y0, x1, y1) in enumerate(boxes):
            d.rectangle([x0 - 2, y0 - 2, x1 + 2, y1 + 2], outline=(255, 0, 0), width=3)
            d.text((x0, y0 - 14), str(i), fill=(255, 0, 0))
        dbg.save(sys.argv[2])


if __name__ == "__main__":
    main()
