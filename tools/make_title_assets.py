"""ロゴ画像から、サイトで使うタイトル用の2枚の画像を作ります。

  assets/title-sdf.png   … 文字の形（距離場）。伸ばす・膨らませる表現に使います
  assets/title-front.png … ケーブルより手前に描く文字のマスク

使い方（このフォルダの1つ上＝プロジェクト直下で実行）:
  python3 tools/make_title_assets.py tools/logo.webp

ロゴ画像の条件:
  - 背景が透明な PNG / WebP（文字部分だけが不透明）
  - 「まるめる ひっぱる」を1行で横に並べたもの

必要なもの: Python 3, numpy, scipy, Pillow
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

src = sys.argv[1] if len(sys.argv) > 1 else 'tools/logo.webp'

# 手前に出す文字。左から数えた「かたまり」の番号（0始まり）で指定します。
# 現在のロゴでは 0=ま 1=る 2=め 3=る 4=ひ 5=っ 6〜8=ぱ（縦棒・本体・丸） 9=る
FRONT = {0, 2, 5, 9}  # ま・め・っ・最後のる

R = 40.                                 # 距離場の幅（px）。main.js のシェーダーと合わせてある
CW, CH, CX, CY = 1850, 380, 90, 100     # ポスター上の切り出し枠（main.js の SDF_CROP と同じ）
INK_LEFT, INK_W, INK_CY = 124, 1781, 295  # ポスター上でロゴを置く位置と幅

A = np.asarray(Image.open(src).convert('RGBA'))[..., 3] > 127
k = INK_W / A.shape[1]
d = (ndi.distance_transform_edt(A) - ndi.distance_transform_edt(~A)) * k
W, H = round(A.shape[1] * k), round(A.shape[0] * k)
small = np.asarray(Image.fromarray(d.astype(np.float32)).resize((W, H), Image.BICUBIC))

canvas = np.full((CH, CW), -R, np.float32)
x0, y0 = INK_LEFT - CX, round(INK_CY - H / 2) - CY
canvas[y0:y0 + H, x0:x0 + W] = np.maximum(canvas[y0:y0 + H, x0:x0 + W], small)
sdf = np.clip(canvas / R * .5 + .5, 0, 1)
Image.fromarray((sdf * 255).astype(np.uint8)).save('assets/title-sdf.png', optimize=True)

# 手前マスク: 各ピクセルを一番近い文字に割り当て、選んだ文字の周り48pxまでを白にする
ink = sdf > .5
lab, n = ndi.label(ink)
order = sorted(range(1, n + 1), key=lambda i: ndi.find_objects(lab)[i - 1][1].start)
front_labels = [order[i] for i in FRONT if i < len(order)]
dist, (iy, ix) = ndi.distance_transform_edt(lab == 0, return_indices=True)
mask = np.isin(lab[iy, ix], front_labels) & (dist < 48)
mask = ndi.gaussian_filter(mask.astype(float), 1.0)
Image.fromarray((mask * 255).astype(np.uint8)).save('assets/title-front.png', optimize=True)

print(f'文字のかたまり {n} 個を検出。手前に出したのは {sorted(FRONT)} 番です。')
for i, lb in enumerate(order):
    sl = ndi.find_objects(lab)[lb - 1]
    print(f'  {i}: x {sl[1].start}-{sl[1].stop}')
