"""Original block-house icon, generated locally; Pillow is build tooling only."""
from pathlib import Path
from PIL import Image, ImageDraw
image = Image.new('RGBA', (64, 64), '#0b2946')
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((2, 2, 61, 61), radius=10, outline='#65b9ef', width=3)
draw.polygon([(12, 30), (31, 12), (51, 30)], fill='#ffac24')
draw.rectangle((17, 29, 46, 50), fill='#e5dfbe')
draw.rectangle((28, 36, 36, 50), fill='#123955')
draw.rectangle((20, 32, 25, 38), fill='#3785aa')
draw.rectangle((40, 19, 46, 29), fill='#fbc45d')
image.save(Path(__file__).resolve().parent.parent / 'public/favicon.ico', sizes=[(16,16),(32,32),(64,64)])
