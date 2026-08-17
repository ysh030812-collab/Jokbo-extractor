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

shutil.copy(str(HERE / "fixtures" / "real_2023.docx"), f"{OUT}/2023 감면 기말.docx")
shutil.copy(str(HERE / "fixtures" / "real2022.docx"), f"{OUT}/2022 감면 기말.docx")
for f in sorted(os.listdir(OUT)):
    print(f"{os.path.getsize(f'{OUT}/{f}')/1024:8.0f} KB  {f}")
