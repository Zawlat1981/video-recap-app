from __future__ import annotations

import math
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont


_STICKER_COLORS = {
    "heart": "#ef476f",
    "star": "#ffd166",
    "sparkle": "#8ecae6",
    "happy": "#06d6a0",
    "sad": "#4895ef",
    "angry": "#f15bb5",
    "shock": "#fee440",
    "laugh": "#ff9f1c",
    "tractor": "#ff6600",
}


def _font(size: int, font_path: str | None) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    if font_path and Path(font_path).is_file():
        return ImageFont.truetype(font_path, size)
    return ImageFont.load_default()


def render_element(
    element: dict[str, Any],
    path: Path,
    *,
    font_path: str | None = None,
    primary_color: str = "#FF6600",
) -> None:
    kind = element["kind"]
    image = Image.new("RGBA", (256, 160), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    color = _STICKER_COLORS.get(kind, primary_color)
    text = str(element.get("text", ""))[:100]

    if kind == "lower-third":
        draw.rounded_rectangle((8, 24, 248, 136), radius=20, fill="#172a3a")
        draw.rounded_rectangle((8, 24, 24, 136), radius=8, fill=color)
        draw.text((40, 50), text or "Name", fill="white", font=_font(30, font_path))
        subtitle = str(element.get("subtitle", ""))[:100]
        if subtitle:
            draw.text((40, 92), subtitle, fill="#dbeafe", font=_font(20, font_path))
    elif kind == "bubble":
        draw.rounded_rectangle((12, 12, 244, 126), radius=30, fill="white", outline=color, width=8)
        draw.polygon(((52, 124), (80, 124), (42, 154)), fill="white")
        draw.line(((52, 124), (42, 154), (80, 124)), fill=color, width=6)
        draw.text((32, 45), text or "မင်္ဂလာပါ", fill="#172a3a", font=_font(24, font_path))
    elif kind == "tractor":
        draw.ellipse((34, 96, 104, 158), fill="#263238")
        draw.ellipse((48, 110, 90, 152), fill="#cbd5e1")
        draw.ellipse((150, 112, 208, 164), fill="#263238")
        draw.ellipse((162, 124, 196, 158), fill="#cbd5e1")
        draw.rounded_rectangle((62, 58, 174, 122), radius=10, fill=color)
        draw.rectangle((118, 34, 172, 80), fill="#fb8500")
        draw.rectangle((130, 42, 160, 68), fill="#bde0fe")
        draw.rectangle((46, 84, 76, 110), fill="#ffd166")
    else:
        draw.ellipse((38, 12, 218, 150), fill=color, outline="white", width=6)
        if kind == "heart":
            draw.polygon(((128, 120), (74, 72), (75, 48), (93, 34), (111, 38), (128, 56),
                          (145, 38), (164, 34), (182, 48), (183, 72)), fill="white")
        elif kind == "star":
            points = []
            for index in range(10):
                angle = -math.pi / 2 + index * math.pi / 5
                radius = 52 if index % 2 == 0 else 24
                points.append((128 + math.cos(angle) * radius, 80 + math.sin(angle) * radius))
            draw.polygon(points, fill="white")
        elif kind == "sparkle":
            draw.polygon(((128, 28), (143, 66), (182, 80), (143, 94), (128, 132),
                          (113, 94), (74, 80), (113, 66)), fill="white")
        else:
            draw.ellipse((86, 54, 100, 70), fill="#172a3a")
            draw.ellipse((156, 54, 170, 70), fill="#172a3a")
            if kind == "sad":
                draw.arc((92, 82, 166, 138), 200, 340, fill="#172a3a", width=8)
            elif kind == "angry":
                draw.line((84, 48, 105, 58), fill="#172a3a", width=8)
                draw.line((172, 48, 151, 58), fill="#172a3a", width=8)
                draw.line((100, 116, 156, 116), fill="#172a3a", width=8)
            elif kind == "shock":
                draw.ellipse((112, 88, 144, 126), fill="#172a3a")
            else:
                draw.arc((92, 76, 166, 134), 10, 170, fill="#172a3a", width=8)

    rotation = int(element.get("rotation", 0))
    if rotation:
        image = image.rotate(-rotation, resample=Image.Resampling.BICUBIC, expand=False)
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG")
