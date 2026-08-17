#!/usr/bin/env python3
"""web/index.html 을 조립한다.

배포물은 파일 하나여야 한다 — 깃허브 페이지스 CSP 가 외부 스크립트를 막고,
아이패드 사파리에서 blob: 워커도 못 쓰기 때문에 라이브러리까지 전부 인라인이다.
그래서 편집은 여기 있는 조각들에 하고, 이 스크립트로 다시 붙인다.

    python3 web/src/build.py

  app_body.html  화면 구조 + CSS
  app_js.js      앱 로직 (IndexedDB, PDF 텍스트 추출, BM25, 화면 갱신)
  app_pdf.js     DOCX 파싱 + 결과 PDF 조판  (app_js.js 의 IIFE 안에 끼워 넣는다)
  vendor.html    pdf.js worker / pdf.js / pdf-lib / fflate 를 인라인한 <script> 묶음
"""
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent / "index.html"

body = (HERE / "app_body.html").read_text(encoding="utf-8")
vendor = (HERE / "vendor.html").read_text(encoding="utf-8")
js = (HERE / "app_js.js").read_text(encoding="utf-8")
pdf = (HERE / "app_pdf.js").read_text(encoding="utf-8")

# app_pdf.js 는 DB·$ 같은 것이 보이는 자리, 즉 IIFE 안에 들어가야 한다.
MARK = "\nloadBank();\n"
if js.count(MARK) != 1:
    raise SystemExit("app_js.js 에서 loadBank() 진입점을 찾지 못했습니다")
js = js.replace(MARK, "\n" + pdf + MARK)

html = (body.rstrip() + "\n\n" + vendor.strip() + "\n<script>" + js.strip() + "\n</script>\n")
OUT.write_text(html, encoding="utf-8")
print(f"{OUT} — {len(html.encode()) / 1048576:.2f} MB")
