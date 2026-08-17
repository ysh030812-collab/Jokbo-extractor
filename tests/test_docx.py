# -*- coding: utf-8 -*-
"""파이썬판 DOCX 파서 — 웹판과 같은 픽스처로 회귀 검증."""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
FIX = os.path.join(HERE, "fixtures")
from extractor import parse_docx_questions

ok = bad = 0
def ck(name, got, want):
    global ok, bad
    if got == want:
        print(f"[PASS] {name}"); ok += 1
    else:
        print(f"[FAIL] {name}\n   got ={got!r}\n   want={want!r}"); bad += 1

q = parse_docx_questions(os.path.join(FIX, "real2022.docx"))
print("real2022 추출:", sorted(q))
ck("실제 형태 — 문제 번호", sorted(q), [1, 2, 3, 4, 5, 106, 143, 144])
ck("144: 구분점 없는 머리도 새 문제", q[144]["stem"],
   "다음 중 HIV의 진단 및 치료와 관련한 설명으로 옳지 않은 것은?")
ck("143: 144 선지가 섞이지 않음", len(q[143]["choices"]), 5)
ck("1: 번호 빠진 첫 문제 복구", q[1]["stem"],
   "다음 그림은 광견병 예방의 방침을 결정하는 알고리즘을 나타낸 것이다. 옳은 것은?")
ck("1: 선지 5개", len(q[1]["choices"]), 5)
ck("2: 마침표 뒤 공백 없음", q[2]["stem"], "다음 도표는 백일해 발생률의 연도별 추이이다. 옳지 않은 것은?")
ck("3: 선지 4개짜리", len(q[3]["choices"]), 4)
ck("5: <보기>는 제시문", [t for t, _ in q[5]["presented"]], ["<보기>", "a. 수면병", "b. 옴", "c. 개조충"])
ck("106: 선지 16개", len(q[106]["choices"]), 16)
ck("143: 숫자로 시작하는 본문은 문제 아님",
   [t for t, _ in q[143]["presented"]], ["8개월간 추적 관찰한 결과를 정리한 것이다."])
ck('"하나를 선택하세요"는 버림',
   [t for v in q.values() for t in [x for x, _ in v["presented"]] + v["choices"] if "선택하세요" in t], [])

q3 = parse_docx_questions(os.path.join(FIX, "real_2023.docx"))
print("real_2023 추출:", sorted(q3))
ck("2023: 띄엄띄엄한 번호 그대로", sorted(q3), [1, 22, 32, 66, 87, 110])
ck("2023 87: 선지 16개", len(q3[87]["choices"]), 16)
ck("2023 66: 번호 없는 선지 6개", len(q3[66]["choices"]), 6)
ck("2023 110: 조합형 선지", q3[110]["choices"], ["a, b, e", "b, c, e", "a, d, e", "b, c, d", "c, d, e"])

qt = parse_docx_questions(os.path.join(FIX, "t.docx"))
ck("합성 픽스처 번호", sorted(qt), [1, 2])
ck("합성 1번 선지", qt[1]["choices"], ["보기 하나", "보기 둘", "보기 셋"])
tb = [t for t in qt[2]["choices"] + [x for x, _ in qt[2]["presented"]] if "TEXTBOX" in t]
ck("텍스트 상자 중복 없음", tb, ["TEXTBOX_CONTENT"])

print(f"\n{ok} passed, {bad} failed")
sys.exit(1 if bad else 0)
