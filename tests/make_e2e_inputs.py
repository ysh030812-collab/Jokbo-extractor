# -*- coding: utf-8 -*-
"""브라우저 e2e 용 입력 파일 — 실제 족보/강의안 구조 그대로, 크기만 줄인 것."""
import os, shutil, pathlib

import pymupdf as fitz

HERE = pathlib.Path(__file__).parent
OUT = str(HERE / "fixtures" / "e2e")
os.makedirs(OUT, exist_ok=True)
FF = "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"

# ── 풀이 PDF: 표지 1장 + 문제당 슬라이드 3장 (실제 파일 구조) ─────────
SL = [
    ["2023 감면 기말 풀이\n인하대학교 의학과\n37기 족보"],
    ["김채균 교수님\n(1/3)\n6. 다음 중 역전사효소에 작용하지 않는 약물을 고르시오.\n"
     "1) Abacavir\n2) Didanosine\n3) Lamivudine\n4) Ibalizumab\n5) Tenofovir",
     "(2/3)\n답: 4) Ibalizumab\nIbalizumab를 뺀 나머지는 NRTI로 HIV의 역전사효소\n"
     "억제제로 작용하지만 Ibalizumab는 Entry inhibitor 입니다.",
     "(3/3)\n김채균 교수님_73. antiviral agents"],
    ["김채균 교수님\n7. 기관지 수축을 일으켜 천식과 COPD 환자에게\n사용하면 안되는 약물을 고르시오.\n"
     "1) lamivudine\n2) ibalizumab\n3) acyclovir\n4) cidofovir\n5) zanamivir\n(1/3)",
     "답: 5번\nZanamivir는 anti-influenza 약물로 흡입 형태로 사용되어\n기관지를 자극해 수축을 유발할 수 있습니다.\n(2/3)",
     "(3/3)\n김채균 교수님 73. Antiviral agents p52"],
    ["김채균 교수님\n8. Acyclovir의 작용 기전으로 옳은 것은?\n"
     "1) DNA polymerase 억제\n2) Neuraminidase 억제\n3) Protease 억제\n"
     "4) Integrase 억제\n5) Fusion 억제\n(1/3)",
     "답: 1번\nAcyclovir는 viral thymidine kinase로 인산화된 뒤\nDNA polymerase를 억제합니다.\n(2/3)",
     "(3/3)\n김채균 교수님 73. Antiviral agents p31"],
]
doc = fitz.open()
for grp in SL:
    for t in grp:
        pg = doc.new_page(width=720, height=540)          # 4:3 슬라이드
        pg.insert_textbox(fitz.Rect(40, 40, 680, 500), t, fontfile=FF, fontname="ko", fontsize=15)
doc.subset_fonts()
doc.save(f"{OUT}/2023 감면 기말 풀이.pdf", garbage=4, deflate=True)
doc.close()

# ── 강의안 PDF ────────────────────────────────────────────────────
LEC = [
    "73. Antiviral agents\n김채균",
    "Antiviral agents 개요\n바이러스 복제 단계별 표적\n부착/침입, 탈피, 유전자 복제, 조립, 방출",
    "역전사효소 억제제 (NRTI)\nAbacavir, Didanosine, Lamivudine, Tenofovir, Zidovudine\n"
    "핵산 유사체로 역전사효소에 의해 사슬에 끼어들어 신장을 종결시킨다.",
    "Entry inhibitor\nIbalizumab — CD4 에 결합하는 단클론항체\nMaraviroc — CCR5 길항제\n"
    "역전사효소에는 작용하지 않는다.",
    "Anti-herpes\nAcyclovir — viral thymidine kinase 로 인산화된 뒤\nDNA polymerase 를 억제한다.\n"
    "Ganciclovir, Cidofovir, Foscarnet",
    "Anti-influenza\nOseltamivir, Zanamivir — neuraminidase 억제제\n"
    "Zanamivir 는 흡입제로 기관지 수축을 유발할 수 있어\n천식·COPD 환자에게는 사용하지 않는다.",
]
doc = fitz.open()
for t in LEC:
    pg = doc.new_page(width=720, height=540)
    pg.insert_textbox(fitz.Rect(50, 60, 670, 480), t, fontfile=FF, fontname="ko", fontsize=17)
doc.subset_fonts()
doc.save(f"{OUT}/73. Antiviral agents (김채균).pdf", garbage=4, deflate=True)
doc.close()

# ── 시험지 PDF (A4 세로, 실제 시험지와 같은 배치) ────────────────
#    글자만 뽑아 조판하면 사라지는 것들(표·그림)을 일부러 넣는다.
EX = [
    "[1~4번 : 이훈재 교수님 출제]",
    "1. 다음 중 역전사효소에 작용하지 않는 약물은?  (4)",
    "1) Abacavir", "2) 15세 이상에서 쓰는 Didanosine", "3) Lamivudine",
    "4) Ibalizumab", "5) Tenofovir",
    None,
    "2. 아래 표에서 발병률이 가장 높은 무리는?  (1)",
    "TABLE",
    "1) 가", "2) 나", "3) 다", "4) 라", "5) 마",
    None,
    "3.100명을 두 군으로 나누어 관찰하였다. 옳은 것은?  (2)",
    "1) 가", "2) 나", "3) 다", "4) 라", "5) 마",
    None,
    "4. 아래 그림이 나타내는 것은?  (5)",
    "FIGURE",
]
doc = fitz.open()
pg = doc.new_page(width=595, height=842)
y = 100
for t in EX:
    if t is None:
        y += 16
        continue
    if t == "TABLE":
        for r in range(3):
            pg.draw_rect(fitz.Rect(85, y, 465, y + 22), color=(0, 0, 0), width=0.8)
            pg.insert_text((95, y + 15), f"row {r}", fontfile=FF, fontname="ko", fontsize=10)
            y += 22
        y += 10
        continue
    if t == "FIGURE":
        pg.draw_rect(fitz.Rect(85, y, 465, y + 170), color=(0, 0, 0), width=1.5)
        pg.insert_text((230, y + 90), "그림", fontfile=FF, fontname="ko", fontsize=22)
        y += 180
        continue
    if y > 700:                                   # 다음 쪽으로 넘긴다
        pg = doc.new_page(width=595, height=842); y = 100
    pg.insert_text((85, y), t, fontfile=FF, fontname="ko", fontsize=10)
    y += 16
doc.subset_fonts()
doc.save(f"{OUT}/2021 감면 기말.pdf", garbage=4, deflate=True)
doc.close()

shutil.copy(str(HERE / "fixtures" / "real_2023.docx"), f"{OUT}/2023 감면 기말.docx")
# 중간/기말 구분이 없는 시험 (블록 강의처럼 한 번만 보는 과목)
shutil.copy(str(HERE / "fixtures" / "real2022.docx"), f"{OUT}/2024 호흡기계.docx")
shutil.copy(str(HERE / "fixtures" / "real2022.docx"), f"{OUT}/2022 감면 기말.docx")
for f in sorted(os.listdir(OUT)):
    print(f"{os.path.getsize(f'{OUT}/{f}')/1024:8.0f} KB  {f}")
