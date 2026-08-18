# -*- coding: utf-8 -*-
"""실제 2020·2021 풀이 PDF 규모(문제당 슬라이드 3장, 약 500쪽)를 흉내낸 검증용 파일.

실물은 26~27MB 라 이 저장소로 가져올 수 없다. 대신 같은 구조·같은 쪽수로 만들어
'Project 색인' 변환이 32MB·100쪽 한도 안에 들어오는지 확인한다.
문제 5개마다 하나는 글자 없는 캡처 슬라이드로 둔다 — 그림 문제 재현.
"""
import pathlib, random
import pymupdf as fitz
from PIL import Image, ImageDraw

HERE = pathlib.Path(__file__).parent
OUT = HERE / "fixtures" / "e2e"
OUT.mkdir(parents=True, exist_ok=True)
FF = "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"
N_Q = 170
random.seed(7)

# 실제 족보는 슬라이드마다 다른 사진·도표가 박혀 있어 26MB 가 된다.
# 쪽마다 다른 그림을 넣어야 용량 기준 분할까지 검증된다.
TMP = HERE / "fixtures" / "_slides"
TMP.mkdir(exist_ok=True)
def make_img(tag, seed):
    rnd = random.Random(seed)
    im = Image.new("RGB", (1000, 750))
    px = im.load()
    for y in range(0, 750, 5):                      # 사진처럼 압축이 잘 안 되는 무늬
        for x in range(0, 1000, 5):
            c = (rnd.randrange(90, 255), rnd.randrange(90, 255), rnd.randrange(90, 255))
            for dy in range(5):
                for dx in range(5): px[x + dx, y + dy] = c
    d = ImageDraw.Draw(im)
    d.rectangle([20, 20, 980, 730], outline=(20, 40, 90), width=5)
    d.text((45, 45), tag, fill=(0, 0, 0))
    f = TMP / f"{tag.replace(' ', '_')}.jpg"
    im.save(f, quality=78)
    return f

doc = fitz.open()
def page(text=None, img=None):
    p = doc.new_page(width=720, height=540)
    if img: p.insert_image(fitz.Rect(0, 0, 720, 540), filename=str(img))
    if text: p.insert_textbox(fitz.Rect(40, 40, 680, 500), text, fontfile=FF, fontname="ko", fontsize=14)
    return p

page("2020 감면 기말 풀이\n인하대학교 의학과 족보")          # 표지
for n in range(1, N_Q + 1):
    if n % 5 == 0:
        page(img=make_img(f"Q{n} CAPTURE", n))              # 문제 화면이 통째로 그림
    else:
        page(f"김채균 교수님\n{n}. 다음 중 옳은 것을 고르시오. 문항 {n} 의 지문입니다.\n"
             f"1) 보기 하나\n2) 보기 둘\n3) 보기 셋\n4) 보기 넷\n5) 보기 다섯\n(1/3)",
             img=None)
        doc[-1].insert_image(fitz.Rect(360, 300, 700, 520), filename=str(make_img(f"Q{n} FIG", n + 900)))
    page(f"답: {random.randint(1,5)}번\n해설 본문입니다. 문항 {n}.\n(2/3)")
    page(f"(3/3)\n출처 슬라이드 p{random.randint(1,90)}")

doc.subset_fonts()
out = OUT / "2020 감면 기말 풀이.pdf"
doc.save(out, garbage=4, deflate=True); doc.close()
print(f"{out.name} — {out.stat().st_size/1048576:.1f} MB, {1 + N_Q*3} 쪽, 문제 {N_Q}개 "
      f"(그림 문제 {N_Q//5}개)")
