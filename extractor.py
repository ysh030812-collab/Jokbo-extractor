# -*- coding: utf-8 -*-
"""
족보 문제 추출 핵심 모듈
- 엑셀(족보 정리)에 강의안 번호 기입
- 선택한 문제만 추출하여 하나의 PDF로 병합
- 풀이 있는 문제: 풀이 PDF에서 (문제+해설) 페이지 블록 추출
- 풀이 없는 문제: 시험 DOCX를 PDF로 변환 후 해당 문제 페이지 추출
- 연도 최신 -> 오래된 순 정렬
"""
import os
import re
import glob
from io import BytesIO

import openpyxl
from pypdf import PdfReader, PdfWriter


# ---------------------------------------------------------------------------
# 폰트: 깔끔한 산세리프(고딕) 우선. 시스템에 설치된 TTF를 찾고, 없으면 내장 고딕 사용.
# ---------------------------------------------------------------------------
_FONTS = None  # (regular, bold)

# (패밀리이름, 일반 TTF 경로, 볼드 TTF 경로) — 위에서부터 먼저 발견되는 것을 사용
_FONT_CANDIDATES = [
    # Windows - 맑은 고딕
    ("KoreanUI", r"C:\Windows\Fonts\malgun.ttf", r"C:\Windows\Fonts\malgunbd.ttf"),
    # Windows - 나눔고딕(설치된 경우)
    ("KoreanUI", r"C:\Windows\Fonts\NanumGothic.ttf", r"C:\Windows\Fonts\NanumGothicBold.ttf"),
    # macOS - Apple SD 산돌고딕 Neo
    ("KoreanUI", "/System/Library/Fonts/AppleSDGothicNeo.ttc", None),
    ("KoreanUI", "/Library/Fonts/AppleSDGothicNeo.ttc", None),
    # Linux - 나눔고딕
    ("KoreanUI", "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
     "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf"),
    ("KoreanUI", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
     "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"),
]


def _ensure_fonts():
    """(일반, 볼드) 폰트 이름을 반환. 깔끔한 고딕 계열을 우선 사용."""
    global _FONTS
    if _FONTS is not None:
        return _FONTS
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont

    for name, reg, bold in _FONT_CANDIDATES:
        try:
            if not reg or not os.path.exists(reg):
                continue
            sub = 0 if reg.lower().endswith(".ttc") else None
            pdfmetrics.registerFont(TTFont(name, reg, subfontIndex=sub) if sub is not None
                                    else TTFont(name, reg))
            bold_name = name
            if bold and os.path.exists(bold):
                bsub = 0 if bold.lower().endswith(".ttc") else None
                pdfmetrics.registerFont(TTFont(name + "-Bold", bold, subfontIndex=bsub)
                                        if bsub is not None else TTFont(name + "-Bold", bold))
                bold_name = name + "-Bold"
            pdfmetrics.registerFontFamily(
                name, normal=name, bold=bold_name, italic=name, boldItalic=bold_name)
            _FONTS = (name, bold_name)
            return _FONTS
        except Exception:
            continue

    # 폴백: reportlab 내장 한국어 고딕(산세리프). 별도 파일 불필요.
    try:
        pdfmetrics.registerFont(UnicodeCIDFont("HYGothic-Medium"))
        _FONTS = ("HYGothic-Medium", "HYGothic-Medium")
    except Exception:
        _FONTS = ("Helvetica", "Helvetica-Bold")
    return _FONTS


def _ensure_title_font():
    return _ensure_fonts()[0]


def make_title_page(title, subtitle=""):
    """연도 구분 표지. 가로로 긴(레터박스) 비율의 깔끔한 배너 1장을 반환."""
    from reportlab.pdfgen import canvas
    from reportlab.lib.colors import HexColor

    font, font_bold = _ensure_fonts()

    # 가로로 긴 비율 (약 2.4 : 1)
    w, h = 900.0, 380.0
    # 색상 팔레트
    bg = HexColor("#F4F7FB")       # 아주 옅은 배경
    card = HexColor("#FFFFFF")     # 카드
    accent = HexColor("#2E6CA4")   # 포인트 남색
    accent2 = HexColor("#8FB4D6")  # 옅은 남색
    ink = HexColor("#1F2933")      # 제목 글자
    muted = HexColor("#7B8794")    # 부제 글자

    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=(w, h))

    # 배경
    c.setFillColor(bg)
    c.rect(0, 0, w, h, stroke=0, fill=1)

    # 가운데 카드 (은은한 테두리)
    m = 34
    c.setFillColor(card)
    c.setStrokeColor(HexColor("#E1E7EF"))
    c.setLineWidth(1)
    c.roundRect(m, m, w - 2 * m, h - 2 * m, 18, stroke=1, fill=1)

    # 왼쪽 세로 포인트 바
    barx = m + 40
    c.setFillColor(accent)
    c.roundRect(barx, m + 46, 8, h - 2 * m - 92, 4, stroke=0, fill=1)

    # 텍스트 왼쪽 정렬 기준선
    tx = barx + 34
    mid = h / 2

    # 상단 작은 라벨 (부제)
    if subtitle:
        c.setFillColor(accent)
        c.setFont(font, 16)
        c.drawString(tx, mid + 66, subtitle)

    # 연도 (크게, 볼드)
    c.setFillColor(ink)
    c.setFont(font_bold, 96)
    c.drawString(tx - 4, mid - 34, str(title))

    # 연도 아래 포인트 밑줄 (두 톤)
    uy = mid - 58
    c.setFillColor(accent)
    c.roundRect(tx, uy, 118, 5, 2.5, stroke=0, fill=1)
    c.setFillColor(accent2)
    c.roundRect(tx + 124, uy, 40, 5, 2.5, stroke=0, fill=1)

    # 오른쪽 아래 작은 문구
    c.setFillColor(muted)
    c.setFont(font, 12)
    c.drawRightString(w - m - 40, m + 34, "기출 문제 발췌")

    c.showPage()
    c.save()
    buf.seek(0)
    return PdfReader(buf).pages[0]


# ---------------------------------------------------------------------------
# 파일 이름 규칙
#   시험 문제 :  "{연도} {과목} {중간기말}.docx"          (예: 2023 감면 기말.docx)
#   풀이       :  "{연도} {과목} {중간기말} 풀이.pdf"      (예: 2023 감면 기말 풀이.pdf)
#   족보 정리  :  "{과목} {중간기말} 족보 정리.xlsx"       (예: 감면 기말 족보 정리.xlsx)
# ---------------------------------------------------------------------------


def _c(v):
    return "" if v is None else str(v).strip()


def _norm_term(v):
    s = str(v).strip()
    if "중간" in s:
        return "중간"
    if "기말" in s:
        return "기말"
    return s


def find_xlsx(folder, subject, term):
    """족보 정리 엑셀 파일 경로를 찾는다."""
    exact = os.path.join(folder, f"{subject} {term} 족보 정리.xlsx")
    if os.path.exists(exact):
        return exact
    cands = [p for p in glob.glob(os.path.join(folder, "*.xlsx"))
             if "족보" in os.path.basename(p) and not os.path.basename(p).startswith("~$")]
    if cands:
        return cands[0]
    raise FileNotFoundError("족보 정리 엑셀 파일을 찾지 못했습니다.")


def find_source(folder, year, subject, term, kind):
    """kind='풀이'(pdf) 또는 '문제'(docx) 원본 파일 경로를 찾는다."""
    if kind == "풀이":
        exact = os.path.join(folder, f"{year} {subject} {term} 풀이.pdf")
        if os.path.exists(exact):
            return exact
        for p in glob.glob(os.path.join(folder, "*.pdf")):
            b = os.path.basename(p)
            if str(year) in b and term in b and "풀이" in b:
                return p
        return None
    else:  # 문제 docx
        for ext in (".docx", ".DOCX"):
            exact = os.path.join(folder, f"{year} {subject} {term}{ext}")
            if os.path.exists(exact):
                return exact
        for p in glob.glob(os.path.join(folder, "*.docx")):
            b = os.path.basename(p)
            if b.startswith("~$"):
                continue
            if str(year) in b and term in b and "풀이" not in b:
                return p
        return None


# ---------------------------------------------------------------------------
# 엑셀 처리
# ---------------------------------------------------------------------------
def _locate_columns(ws):
    header = [_c(c.value) for c in ws[1]]
    col = {}
    for i, h in enumerate(header):
        if "강의안" in h:
            col["lec"] = i
        elif "년도" in h or "연도" in h:
            col.setdefault("year", i)
        elif "중간" in h or "기말" in h:
            col.setdefault("term", i)
        elif "문제" in h:
            col.setdefault("qnum", i)
        elif "풀이" in h:
            col.setdefault("sol", i)
    return col


def load_index(xlsx_path):
    """엑셀을 읽어 {(year, term, qnum): 풀이유무('O'/'X')} 딕셔너리를 반환."""
    wb = openpyxl.load_workbook(xlsx_path)
    ws = wb.active
    col = _locate_columns(ws)
    index = {}
    for row in ws.iter_rows(min_row=2):
        yv = row[col["year"]].value
        if yv is None or str(yv).strip() == "":
            continue
        try:
            year = int(str(yv).strip())
            qnum = int(str(row[col["qnum"]].value).strip())
        except (ValueError, TypeError):
            continue
        term = _norm_term(row[col["term"]].value)
        raw = _c(row[col["sol"]].value).upper() if "sol" in col else ""
        sol = "O" if raw.startswith("O") else "X"
        index[(year, term, qnum)] = sol
    wb.close()
    return index


def write_lecture_numbers(xlsx_path, selections, lecture_no):
    """selections=[(year, term, qnum), ...] 행의 강의안 번호 칸에 lecture_no 기입 후 저장."""
    wb = openpyxl.load_workbook(xlsx_path)
    ws = wb.active
    col = _locate_columns(ws)
    want = set(selections)
    updated = 0
    for row in ws.iter_rows(min_row=2):
        yv = row[col["year"]].value
        if yv is None or str(yv).strip() == "":
            continue
        try:
            year = int(str(yv).strip())
            qnum = int(str(row[col["qnum"]].value).strip())
        except (ValueError, TypeError):
            continue
        term = _norm_term(row[col["term"]].value)
        if (year, term, qnum) in want:
            row[col["lec"]].value = lecture_no
            updated += 1
    wb.save(xlsx_path)
    wb.close()
    return updated


# ---------------------------------------------------------------------------
# 풀이 PDF: 문제별 페이지 블록 매핑
# ---------------------------------------------------------------------------
def _parse_qnum(text):
    for line in text.split("\n"):
        line = line.strip()
        m = re.match(r"(\d{1,3})\s*[.．]", line)
        if m:
            v = int(m.group(1))
            if 1 <= v <= 400:
                return v
    return None


def map_solution_blocks(pdf_path):
    """풀이 PDF에서 {문제번호: (start_page, end_page_exclusive)} 반환.
    각 문제는 '(1/k) ... (k/k)' 슬라이드로 구성되므로 '(1/' 마커로 블록을 구분한다.
    번호는 페이지의 'N.' 패턴으로 파싱, 실패 시 직전 번호+1로 보정한다."""
    reader = PdfReader(pdf_path)
    n = len(reader.pages)
    start_pages = []
    for i in range(n):
        t = reader.pages[i].extract_text() or ""
        if "(1/" in t or "( 1/" in t:
            start_pages.append([i, _parse_qnum(t)])

    blocks = {}
    last = None
    for idx, (pg, num) in enumerate(start_pages):
        end = start_pages[idx + 1][0] if idx + 1 < len(start_pages) else n
        if num is None:
            num = (last + 1) if last is not None else None
        if num is None:
            continue
        blocks.setdefault(num, (pg, end))
        last = num
    return blocks, reader


# ---------------------------------------------------------------------------
# 시험 DOCX 파싱 (풀이 없는 문제) -> 문제별로 직접 파싱 후 깔끔하게 재렌더링
# ---------------------------------------------------------------------------
# 숫자 표기 줄:  "12." / "3)" / "91번."  ->  (번호, 나머지 텍스트)
_NUMBERED_RE = re.compile(r"^\s*(\d{1,3})\s*번?\s*[.)．]\s*(.*)$")
_DASH_RE = re.compile(r"^\s*[-–—•*·]\s*(.+)$")
_CIRC_RE = re.compile(r"^\s*([①②③④⑤⑥⑦⑧⑨⑩])\s*(.+)$")
# <보기> 항목 표기:  가. 나. ... / ㄱ. ㄴ. ...  (모두 고른 것 유형의 '보기')
_KOX_RE = re.compile(r"^\s*[가나다라마바사아자차]\s*[.)]\s*(.+)$")
_JAMO_RE = re.compile(r"^\s*[ㄱ-ㅎ]\s*[.)]\s*(.+)$")
_MAX_CHOICES = 5   # 선지는 최대 5개(1~5)로 가정 -> 문제번호와의 혼동 방지


def _is_bogi_header(line):
    """'<보기>', '(보기 ...)', '[보기]', '보기)' 등 보기 상자 시작 줄인지."""
    s = line.replace(" ", "")
    return (s.startswith("<보기") or s.startswith("(보기") or s.startswith("[보기")
            or s.startswith("보기>") or s.startswith("보기]") or s.startswith("<보 기"))


def _is_bogi_item(line):
    """'가.' '나.' … / 'ㄱ.' 'ㄴ.' … 처럼 '보기 항목'(단일 라벨)인지."""
    return bool(_KOX_RE.match(line) or _JAMO_RE.match(line))


def _strip_marker(line):
    """줄 앞의 선지/보기 기호(-, 1., 3), ①, 가., ㄱ.)를 떼고 본문만 반환."""
    for rx in (_DASH_RE, _CIRC_RE, _NUMBERED_RE, _KOX_RE, _JAMO_RE):
        m = rx.match(line)
        if m:
            return m.group(m.lastindex).strip()
    return line


def _classify_body(lines):
    """지문 이후 줄들을 (제시문 줄, 실제 선지) 로 분리한다.

    방침: '선지'를 양성적으로 인식해서 그 줄만 번호를 매긴다.
      나머지(보기·안내문·지문 연장 등 제시문)는 형태를 추측하지 않고 그대로 둔다.

    1) 선지 표기가 있으면(대시 '-', 동그라미 '①', 숫자 '1.'/'1)') 그 표기의 줄만 선지.
       -> 표기 없는 줄(보기 상자, '하나를 선택하세요' 등)은 모두 제시문.
    2) 어떤 선지 표기도 없으면('모두 고른 것' 조합형):
       -> 보기 항목(가./ㄱ.)·보기 상자는 제시문, 나머지 줄이 선지.
       -> 단, 보기 항목만 있으면(가/나/다 단일선택) 그 자체가 선지.

    반환: (presented, choices)
      presented = [(줄 텍스트, is_bogi_bool), ...]   # 번호 없이 그대로 표시
      choices   = [선지 텍스트, ...]                 # 렌더 시 1) 2) 3) ...
    """
    lines = [l for l in lines if l]
    if not lines:
        return [], []

    # 선지에 쓰인 표기를 감지 (대시 > 동그라미 > 숫자 순)
    if any(_DASH_RE.match(l) for l in lines):
        marker_rx = _DASH_RE
    elif any(_CIRC_RE.match(l) for l in lines):
        marker_rx = _CIRC_RE
    elif any(_NUMBERED_RE.match(l) for l in lines):
        marker_rx = _NUMBERED_RE
    else:
        marker_rx = None

    presented, choices = [], []

    if marker_rx is not None:
        for l in lines:
            m = marker_rx.match(l)
            if m:
                choices.append(m.group(m.lastindex).strip())   # 표기 있는 줄 = 선지
            else:
                presented.append((l, _is_bogi_header(l) or _is_bogi_item(l)))
        return presented, choices

    # 표기가 전혀 없는 경우 ('모두 고른 것' 조합형 등)
    others_exist = any(
        (not _is_bogi_item(l) and not _is_bogi_header(l)) for l in lines
    )
    for l in lines:
        if others_exist and (_is_bogi_item(l) or _is_bogi_header(l)):
            presented.append((l, True))          # 조합 선지가 따로 있으니 이건 보기
        else:
            choices.append(_strip_marker(l))
    return presented, choices


def _para_images(para):
    """문단(paragraph)에 포함된 이미지 blob 리스트를 반환."""
    from docx.oxml.ns import qn
    imgs = []
    for blip in para._element.findall(".//" + qn("a:blip")):
        rid = blip.get(qn("r:embed")) or blip.get(qn("r:link"))
        if not rid:
            continue
        try:
            part = para.part.related_parts[rid]
            imgs.append(part.blob)
        except Exception:
            pass
    return imgs


def _para_lines(para):
    """문단을 '물리적 줄' 단위로 분해. 한 문단 안의 줄바꿈(<w:br/>)·탭도 반영한다.
    (python-docx의 paragraph.text 는 문단 내 줄바꿈을 무시하므로 직접 처리)"""
    from docx.oxml.ns import qn
    t_tag, br_tag, cr_tag, tab_tag = (
        qn("w:t"), qn("w:br"), qn("w:cr"), qn("w:tab"))
    parts = []
    for node in para._element.iter():
        if node.tag == t_tag:
            parts.append(node.text or "")
        elif node.tag in (br_tag, cr_tag):
            parts.append("\n")
        elif node.tag == tab_tag:
            parts.append(" ")
    text = "".join(parts)
    return [ln.strip() for ln in text.split("\n")]


def parse_docx_questions(docx_path):
    """DOCX를 파싱해 {문제번호: {'num','stem','choices':[...],'images':[blob,...]}} 반환.

    핵심 난점: 선지도 '1.' '2.' 처럼 문제 번호와 똑같은 '숫자.' 형식일 수 있어,
    선지를 새 문제로 오인하기 쉽다. 그래서 상태 기계로 구분한다.
      - 지문 뒤에서 1,2,3,... 로 이어지는 '숫자.' 는 선지(최대 5개)
      - 그 외의 '숫자.' 는 새 문제 번호
      - 숫자 없는 기호(-, ①, ㄱ.)나 표시가 전혀 없는 줄도 선지로 인식
    """
    import docx
    d = docx.Document(docx_path)
    questions = {}
    cur = None
    expect = 1        # 현재 문제에서 다음에 올 '숫자.' 선지 번호(1부터)
    max_num = 0       # 지금까지 등장한 최대 문제 번호(문제 번호는 문서 내에서 증가)

    def start_question(num, stem):
        nonlocal cur, expect, max_num
        cur = {"num": num, "stem": stem.strip(), "_body": [], "images": []}
        questions[num] = cur
        expect = 1
        max_num = max(max_num, num)

    for para in d.paragraphs:
        lines = _para_lines(para)
        imgs = _para_images(para)
        if not any(lines) and not imgs:
            continue
        for ln in lines:
            if not ln:
                continue
            nm = _NUMBERED_RE.match(ln)
            if nm:
                num = int(nm.group(1))
                if cur is not None and num == expect and expect <= _MAX_CHOICES:
                    # 지문 뒤에서 1,2,3.. 로 이어지는 숫자 -> 선지(본문에 원문 그대로 보관)
                    cur["_body"].append(ln)
                    expect += 1
                elif (cur is None or num > max_num) and 1 <= num <= 400:
                    # 문제 번호는 문서 내에서 커지기만 한다 -> 그럴 때만 새 문제
                    start_question(num, nm.group(2).strip())
                elif cur is not None:
                    cur["_body"].append(ln)
                continue
            # 숫자 없는 줄
            if cur is None:
                continue
            cur["_body"].append(ln)
        if cur is not None and imgs:
            cur["images"].extend(imgs)

    # 본문을 제시문(보기·안내문 등)과 실제 선지로 분리
    for q in questions.values():
        q["presented"], q["choices"] = _classify_body(q.pop("_body"))
    return questions


def render_docx_questions_to_pages(qdatas, header):
    """선택된 문제(qdatas: 파싱된 dict 리스트)를 가독성 있게 재렌더링한 PDF의 페이지들을 반환.
    - 선지는 1) 2) 3) 형식
    - 문제 사이에 넉넉한 줄바꿈
    - 그림(있으면) 지문 아래 삽입"""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Image, HRFlowable, KeepTogether,
    )
    from reportlab.lib.utils import ImageReader

    font, font_bold = _ensure_fonts()
    stem_style = ParagraphStyle(
        "stem", fontName=font, fontSize=13, leading=21, spaceAfter=7, textColor="#1F2933")
    choice_style = ParagraphStyle(
        "choice", fontName=font, fontSize=12, leading=20, leftIndent=16, textColor="#333F4B")
    bogi_style = ParagraphStyle(
        "bogi", fontName=font, fontSize=11.5, leading=18, leftIndent=16, rightIndent=6,
        textColor="#333F4B", backColor="#F1F4F8", borderPadding=6, spaceBefore=2, spaceAfter=6)
    note_style = ParagraphStyle(
        "note", fontName=font, fontSize=12, leading=19, spaceBefore=1, spaceAfter=4,
        textColor="#1F2933")
    head_style = ParagraphStyle(
        "head", fontName=font_bold, fontSize=11, leading=15, textColor="#2E6CA4")

    def esc(s):
        return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=20 * mm, rightMargin=20 * mm,
        topMargin=18 * mm, bottomMargin=18 * mm)
    avail_w = doc.width
    story = []
    if header:
        story.append(Paragraph(esc(header), head_style))
        story.append(HRFlowable(width="100%", thickness=0.5, color="#cccccc",
                                 spaceBefore=2, spaceAfter=10))

    for qd in qdatas:
        block = [Paragraph(
            f"<font name='{font_bold}' color='#2E6CA4'>{qd['num']}.</font> {esc(qd['stem'])}",
            stem_style)]
        for blob in qd.get("images", []):
            try:
                ir = ImageReader(BytesIO(blob))
                iw, ih = ir.getSize()
                w = min(avail_w, iw * 0.75)
                h = w * ih / iw
                max_h = 150 * mm
                if h > max_h:
                    h = max_h
                    w = h * iw / ih
                block.append(Spacer(1, 4))
                block.append(Image(BytesIO(blob), width=w, height=h))
            except Exception:
                pass
        # 제시문(보기·안내문 등) — 선지 위에 그대로 표시(번호 없음)
        # 연속된 보기 항목은 하나의 회색 상자로 묶고, 그 외 안내문은 일반 문단으로.
        presented = qd.get("presented", [])
        bogi_buf = []

        def flush_bogi():
            if bogi_buf:
                block.append(Paragraph("<br/>".join(esc(b) for b in bogi_buf), bogi_style))
                bogi_buf.clear()

        for text, is_bogi in presented:
            if is_bogi:
                bogi_buf.append(text)
            else:
                flush_bogi()
                block.append(Paragraph(esc(text), note_style))
        flush_bogi()

        for i, ch in enumerate(qd.get("choices", []), start=1):
            # 요청 형식: 1) 2) 3) ...
            block.append(Paragraph(f"{i}) {esc(ch)}", choice_style))
        # 문제 사이 여백 (요청: 줄바꿈 한 번 더)
        block.append(Spacer(1, 16))
        story.append(KeepTogether(block))

    doc.build(story)
    buf.seek(0)
    return list(PdfReader(buf).pages)


# ---------------------------------------------------------------------------
# 메인 추출 파이프라인
# ---------------------------------------------------------------------------
# 같은 연도 안에서 학기 정렬 순서 (기말 -> 중간)
_TERM_ORDER = {"기말": 0, "중간": 1}


def build_pdf(folder, subject, lecture_no, rows, out_path, log=print):
    """
    rows: [(year, term, [qnum, ...]), ...]  (줄마다 중간/기말 지정, 최대 7행)
    반환: (출력 PDF 경로, 강의안번호 기입 개수, 경고 리스트)
    """
    warnings = []

    # 학기별 엑셀 인덱스 캐시 (중간/기말 엑셀이 따로 있을 수 있음)
    xlsx_cache = {}   # term -> (xlsx_path, index)

    def get_xlsx(term):
        if term not in xlsx_cache:
            path = find_xlsx(folder, subject, term)
            xlsx_cache[term] = (path, load_index(path))
            log(f"엑셀 파일({term}): {os.path.basename(path)}")
        return xlsx_cache[term]

    # 선택 항목 정리
    selections = []   # (year, term, qnum, 풀이유무)
    for year, term, qnums in rows:
        try:
            _path, index = get_xlsx(term)
        except FileNotFoundError:
            index = {}
            warnings.append(f"{subject} {term} 족보 엑셀을 찾지 못함")
        for q in qnums:
            key = (year, term, q)
            if key in index:
                selections.append((year, term, q, index[key]))
            else:
                selections.append((year, term, q, None))
                warnings.append(f"엑셀에 없음: {year} {term} {q}번 (풀이유무 미상 → 풀이 우선 시도)")

    # 1) 엑셀에 강의안 번호 기입 (학기별 엑셀에 각각 기록)
    updated = 0
    by_term = {}
    for (y, t, q, _s) in selections:
        by_term.setdefault(t, []).append((y, t, q))
    for term, sels in by_term.items():
        if term in xlsx_cache:
            path, _idx = xlsx_cache[term]
            updated += write_lecture_numbers(path, sels, lecture_no)
    log(f"엑셀에 강의안 번호 {lecture_no} 기입: {updated}개 행")

    # 2) 연도 최신 -> 오래된 순. 같은 연도는 기말 -> 중간, 그 안에서 문제번호 오름차순
    selections.sort(key=lambda x: (-x[0], _TERM_ORDER.get(x[1], 9), x[2]))

    # 3) 원본별 캐시
    sol_cache = {}    # (year, term) -> (blocks, reader)
    doc_cache = {}    # (year, term) -> qmap

    writer = PdfWriter()
    stats = {"added": 0}
    cur_key = None    # (year, term)
    pending = []      # 현재 구간의 재렌더링 대기 docx 문제

    def flush_pending():
        if not pending:
            return
        y, t = cur_key
        pages = render_docx_questions_to_pages(
            list(pending), f"{y} {subject} {t}")
        for p in pages:
            writer.add_page(p)
        stats["added"] += len(pending)
        pending.clear()

    for (year, term, q, sol) in selections:
        key = (year, term)
        # 새로운 (연도, 학기) 구간이 시작되면: 이전 대기분 출력 -> 표지 삽입
        if key != cur_key:
            flush_pending()
            cur_key = key
            writer.add_page(make_title_page(f"{year}", f"{subject} {term}"))
        use_solution = (sol == "O") or (sol is None)
        placed = False

        if use_solution:
            src = find_source(folder, year, subject, term, "풀이")
            if src:
                if key not in sol_cache:
                    log(f"풀이 PDF 분석: {os.path.basename(src)}")
                    sol_cache[key] = map_solution_blocks(src)
                blocks, reader = sol_cache[key]
                if q in blocks:
                    flush_pending()   # 순서 유지를 위해 대기 중 docx 먼저 출력
                    s, e = blocks[q]
                    for p in range(s, e):
                        writer.add_page(reader.pages[p])
                    stats["added"] += 1
                    placed = True
                    log(f"  ✓ {year} {term} {q}번 (풀이 {e - s}p)")
                else:
                    warnings.append(f"{year} {term} 풀이 PDF에서 {q}번 블록을 찾지 못함")
            elif sol == "O":
                warnings.append(f"{year} {term} 풀이 PDF 파일이 없음")

        if not placed:
            docx = find_source(folder, year, subject, term, "문제")
            if docx:
                if key not in doc_cache:
                    log(f"시험 DOCX 파싱: {os.path.basename(docx)}")
                    doc_cache[key] = parse_docx_questions(docx)
                qmap = doc_cache[key]
                if q in qmap:
                    pending.append(qmap[q])
                    placed = True
                    log(f"  ✓ {year} {term} {q}번 (문제 재렌더링 대기)")
                else:
                    warnings.append(f"{year} {term} 시험 DOCX에서 {q}번을 찾지 못함")
            else:
                warnings.append(f"{year} {term} 시험 DOCX 파일이 없음")

    flush_pending()   # 마지막 구간 대기분 출력
    added = stats["added"]

    if added == 0:
        raise RuntimeError("추출된 문제가 없습니다. 파일 이름/입력을 확인하세요.")

    with open(out_path, "wb") as f:
        writer.write(f)
    log(f"완료: {added}개 문제 → {os.path.basename(out_path)}")
    return out_path, updated, warnings
