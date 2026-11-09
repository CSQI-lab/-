"""
make_icon.py — 生成 App 桌面图标（PNG）
============================================================
只用 Python 标准库（不需要安装 Pillow 等第三方库）。

画的是一个「单词卡片」：蓝底 + 白色卡片 + 三条文字线。
生成两个尺寸：
  icon-180.png  → iPhone「添加到主屏幕」用（apple-touch-icon）
  icon-512.png  → PWA manifest 用

运行：python tools/make_icon.py
"""

import os
import struct
import zlib

# 输出目录（相对项目根目录）
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'app', 'assets')

BLUE = (26, 115, 232, 255)      # #1A73E8 科技蓝
WHITE = (255, 255, 255, 255)
TRANSPARENT = (0, 0, 0, 0)


def inside_rounded(x, y, x0, y0, x1, y1, r):
    """判断像素 (x,y) 是否在圆角矩形内"""
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= r * r


def make_pixels(size):
    """生成 size×size 的 RGBA 像素数组（一维，按行排列）"""
    s = size
    px = [TRANSPARENT] * (s * s)

    # 1) 蓝色圆角底（整张图，圆角半径 22%）
    r_bg = int(s * 0.22)
    # 2) 白色圆角卡片（居中偏上）
    card = (int(s * 0.22), int(s * 0.24), int(s * 0.78), int(s * 0.76))
    r_card = int(s * 0.045)
    # 3) 卡片上的三条蓝色文字线
    lines = [
        (int(s * 0.30), int(s * 0.60), int(s * 0.365)),  # 短标题行
        (int(s * 0.30), int(s * 0.70), int(s * 0.495)),  # 长行
        (int(s * 0.30), int(s * 0.62), int(s * 0.625)),  # 中行
    ]
    line_h = max(2, int(s * 0.035))

    for y in range(s):
        for x in range(s):
            idx = y * s + x
            if not inside_rounded(x, y, 0, 0, s, s, r_bg):
                continue
            px[idx] = BLUE
            if inside_rounded(x, y, *card, r_card):
                px[idx] = WHITE
                for (lx0, lx1, ly) in lines:
                    if lx0 <= x <= lx1 and ly <= y <= ly + line_h:
                        px[idx] = BLUE
                        break
    return px


def chunk(tag, data):
    """组装一个 PNG 数据块（长度 + 类型 + 内容 + CRC 校验）"""
    return (struct.pack('>I', len(data)) + tag + data +
            struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))


def write_png(path, size):
    px = make_pixels(size)
    # 每行开头加一个 filter 字节 0（PNG 规定），再接 RGBA 像素
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            raw.extend(px[y * size + x])

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    png = (b'\x89PNG\r\n\x1a\n' +
           chunk(b'IHDR', ihdr) +
           chunk(b'IDAT', zlib.compress(bytes(raw), 9)) +
           chunk(b'IEND', b''))

    with open(path, 'wb') as f:
        f.write(png)
    print(f'已生成 {path}  ({size}x{size}, {len(png)} 字节)')


if __name__ == '__main__':
    os.makedirs(OUT_DIR, exist_ok=True)
    write_png(os.path.join(OUT_DIR, 'icon-180.png'), 180)
    write_png(os.path.join(OUT_DIR, 'icon-512.png'), 512)
