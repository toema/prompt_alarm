"""Draws the PromptAlarm icon (an alarm clock on a night-indigo tile) at the sizes Chrome needs.
Run: python3 scripts/make-icons.py
No brand marks or third-party logos are used."""
from PIL import Image, ImageDraw
import os

NIGHT = (26, 33, 80, 255)
FACE = (38, 47, 112, 255)
DAWN = (242, 162, 75, 255)
HAND = (240, 243, 255, 255)
SS = 8  # supersampling

def draw(size, pad_ratio):
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = int(S * pad_ratio)
    box = S - 2 * pad

    def P(x, y):
        return (pad + x * box, pad + y * box)

    def circle(cx, cy, r, fill=None, outline=None, width=0):
        x, y = P(cx, cy)
        r = r * box
        d.ellipse([x - r, y - r, x + r, y + r], fill=fill, outline=outline, width=int(width * box))

    d.rounded_rectangle([pad, pad, S - pad, S - pad], radius=int(box * 0.22), fill=NIGHT)
    # bells
    circle(0.27, 0.27, 0.115, fill=DAWN)
    circle(0.73, 0.27, 0.115, fill=DAWN)
    # clock face
    circle(0.5, 0.55, 0.31, fill=DAWN)
    circle(0.5, 0.55, 0.235, fill=FACE)
    # hands
    cx, cy = P(0.5, 0.55)
    w = int(box * 0.06)
    for (tx, ty) in [(0.5, 0.39), (0.61, 0.60)]:
        x, y = P(tx, ty)
        d.line([cx, cy, x, y], fill=HAND, width=w)
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=HAND)
    d.ellipse([cx - w / 2, cy - w / 2, cx + w / 2, cy + w / 2], fill=HAND)
    return img.resize((size, size), Image.LANCZOS)

out = os.path.join(os.path.dirname(__file__), "..", "extension", "icons")
os.makedirs(out, exist_ok=True)
for size, pad in [(16, 0.0), (32, 0.0), (48, 0.02), (128, 0.125)]:
    draw(size, pad).save(os.path.join(out, f"icon{size}.png"))
print("icons written")
