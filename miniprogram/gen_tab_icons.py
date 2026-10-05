# -*- coding: utf-8 -*-
# 生成 tabBar 图标（81x81, 透明底, 两套配色：未选/已选）
import math
from PIL import Image, ImageDraw

SIZE = 81
INACTIVE = (122, 109, 88, 255)   # #7a6d58
ACTIVE = (155, 47, 37, 255)      # #9b2f25
BG = (0, 0, 0, 0)

OUT = "D:/不知道是啥/教员/weapp/miniprogram/assets"


def new_img():
    return Image.new("RGBA", (SIZE, SIZE), BG)


def draw_star(d, cx, cy, r_out, r_in, color, width=0):
    pts = []
    for i in range(10):
        ang = -math.pi / 2 + i * math.pi / 5
        r = r_out if i % 2 == 0 else r_in
        pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
    if width:
        d.line(pts + [pts[0]], fill=color, width=width, joint="curve")
    else:
        d.polygon(pts, fill=color)


def draw_sun(d, cx, cy, color):
    d.ellipse([cx - 11, cy - 11, cx + 11, cy + 11], fill=color)
    for i in range(8):
        ang = i * math.pi / 4
        x1 = cx + 16 * math.cos(ang)
        y1 = cy + 16 * math.sin(ang)
        x2 = cx + 25 * math.cos(ang)
        y2 = cy + 25 * math.sin(ang)
        d.line([(x1, y1), (x2, y2)], fill=color, width=4, joint="curve")


def draw_home(d, color):
    # 屋顶三角 + 房身 + 门（用透明色挖空）
    roof = [(40, 16), (15, 40), (65, 40)]
    d.polygon(roof, fill=color)
    d.rectangle([22, 40, 58, 66], fill=color)
    # 门：用背景透明色覆盖出一个矩形缺口
    d.rectangle([35, 50, 45, 66], fill=BG)


def make(name, drawer):
    for suffix, color in (("", INACTIVE), ("-active", ACTIVE)):
        img = new_img()
        d = ImageDraw.Draw(img)
        drawer(d, color)
        img.save(f"{OUT}/tab-{name}{suffix}.png")


make("home", lambda d, c: draw_home(d, c))
make("daily", lambda d, c: draw_sun(d, 40, 40, c))
make("fav", lambda d, c: draw_star(d, 40, 41, 26, 11, c))

print("icons generated")
