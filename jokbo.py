# -*- coding: utf-8 -*-
"""족보 도구 CLI — Claude Code 스킬(`/jokbo`)이 호출하는 백엔드.

서브커맨드
  index    자료실(기본 `자료/`)을 훑어 문제 은행 `bank.json` 을 만든다.
  search   강의안 PDF와 어휘가 겹치는 후보 문제를 BM25로 추려 낸다.
  build    선택한 문제들을 하나의 PDF로 묶는다. (extractor.build_pdf 재사용)

이 파일은 '판단'을 하지 않는다. 어떤 문제가 강의안으로 풀 수 있는지는
Claude 가 `search` 결과를 읽고 판정한다. 여기서는 재현 가능한 기계적 작업만
담당한다 — 그래야 결과가 매번 같고, 디버깅할 수 있다.
"""
import argparse
import json
import math
import os
import re
import sys
from collections import Counter

import extractor

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_LIB = os.path.join(BASE_DIR, "자료")
DEFAULT_BANK = os.path.join(BASE_DIR, "bank.json")


# ---------------------------------------------------------------------------
# index — 자료실을 문제 은행으로
# ---------------------------------------------------------------------------
def _solution_questions(path):
    """풀이 PDF에서 {문제번호: 블록 텍스트} 를 뽑는다."""
    blocks, _reader = extractor.map_solution_blocks(path)
    texts = extractor._solution_page_texts(path)
    out = []
    for qnum, (start, end) in sorted(blocks.items()):
        body = "\n".join(texts[start:end]).strip()
        out.append({
            "qnum": qnum, "source": "solution",
            "file": os.path.basename(path),
            "page_start": start, "page_end": end,
            "text": body,
        })
    return out


def _docx_questions(path):
    """시험 DOCX에서 {문제번호: 지문+선지 텍스트} 를 뽑는다."""
    qmap = extractor.parse_docx_questions(path)
    out = []
    for qnum, q in sorted(qmap.items()):
        parts = [q["stem"]]
        parts += [t for t, _is_bogi in q.get("presented", [])]
        parts += [f"{i}) {c}" for i, c in enumerate(q.get("choices", []), 1)]
        out.append({
            "qnum": qnum, "source": "docx",
            "file": os.path.basename(path),
            "page_start": None, "page_end": None,
            "text": "\n".join(p for p in parts if p).strip(),
        })
    return out


def cmd_index(args):
    lib = args.library
    if not os.path.isdir(lib):
        sys.exit(f"자료실 폴더가 없습니다: {lib}")

    sets = extractor.scan_library(lib)
    if not sets:
        sys.exit(f"자료실에 인식 가능한 족보가 없습니다: {lib}\n"
                 f"파일 이름은 '2023 감면 기말 풀이.pdf' / '2023 감면 기말.docx' 형식이어야 합니다.")

    questions, notes = [], []
    for rec in sets:
        tag = f"{rec['year']} {rec['subject']} {rec['term']}".strip()
        # 풀이 PDF 를 우선 쓰고, 없을 때만 DOCX 를 쓴다 (build_pdf 와 같은 우선순위)
        got = []
        if rec["solution"]:
            path = os.path.join(lib, rec["solution"])
            try:
                got = _solution_questions(path)
            except Exception as e:                      # noqa: BLE001
                notes.append(f"{tag}: 풀이 PDF 분석 실패 ({e})")
        if not got and rec["docx"]:
            path = os.path.join(lib, rec["docx"])
            try:
                got = _docx_questions(path)
            except Exception as e:                      # noqa: BLE001
                notes.append(f"{tag}: DOCX 분석 실패 ({e})")
        if not got:
            notes.append(f"{tag}: 문제를 하나도 추출하지 못했습니다.")
            continue

        for q in got:
            q.update(year=rec["year"], term=rec["term"], subject=rec["subject"])
            q["id"] = f"{rec['year']}-{rec['term']}-{rec['subject']}-{q['qnum']}"
            questions.append(q)
        notes.append(f"{tag}: {len(got)}문제 ({got[0]['source']})")

    bank = {"library": os.path.abspath(lib), "count": len(questions),
            "questions": questions}
    with open(args.bank, "w", encoding="utf-8") as f:
        json.dump(bank, f, ensure_ascii=False, indent=1)

    for n in notes:
        print("  " + n)
    print(f"\n문제 은행 저장: {args.bank}  (총 {len(questions)}문제)")


# ---------------------------------------------------------------------------
# search — 강의안과 어휘가 겹치는 후보 추리기 (BM25, LLM 없음)
# ---------------------------------------------------------------------------
_WORD_RE = re.compile(r"[A-Za-z][A-Za-z\-]{2,}|[가-힣]{2,}|\d{2,}")


def _tokens(text):
    """영문 단어 + 한글 2-gram + 숫자. 형태소 분석기 없이도 충분히 동작한다."""
    text = (text or "").lower()
    toks = []
    for w in _WORD_RE.findall(text):
        if w[0].isascii():
            toks.append(w)
        elif w.isdigit():
            toks.append(w)
        else:                                   # 한글은 2-gram 으로 쪼갠다
            toks += [w[i:i + 2] for i in range(len(w) - 1)] or [w]
    return toks


def _lecture_text(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == ".pdf":
        try:
            import pymupdf as fitz                       # PyMuPDF (신형 이름)
        except ImportError:
            try:
                import fitz                              # 구버전 호환
            except ImportError:
                sys.exit("PyMuPDF 가 필요합니다:  pip install pymupdf")
        with fitz.open(path) as doc:
            return "\n".join((pg.get_text() or "") for pg in doc), doc.page_count
    if ext == ".txt":
        return open(path, encoding="utf-8").read(), None
    sys.exit(f"지원하지 않는 강의안 형식입니다: {ext} (PDF 또는 TXT)")


def cmd_search(args):
    if not os.path.exists(args.bank):
        sys.exit(f"문제 은행이 없습니다: {args.bank}\n먼저 `python jokbo.py index` 를 실행하세요.")
    bank = json.load(open(args.bank, encoding="utf-8"))
    docs = bank["questions"]
    if args.subject:
        docs = [d for d in docs if d["subject"] == args.subject]
    if not docs:
        sys.exit("조건에 맞는 문제가 문제 은행에 없습니다.")

    lec_text, n_pages = _lecture_text(args.lecture)
    query = Counter(_tokens(lec_text))
    if not query:
        sys.exit("강의안에서 텍스트를 추출하지 못했습니다 (스캔 PDF일 수 있습니다).")

    # BM25
    doc_toks = [_tokens(d["text"]) for d in docs]
    dl = [len(t) for t in doc_toks]
    avgdl = sum(dl) / len(dl) if dl else 1.0
    df = Counter()
    for t in doc_toks:
        df.update(set(t))
    N = len(docs)
    k1, b = 1.5, 0.75

    scored = []
    for i, toks in enumerate(doc_toks):
        tf = Counter(toks)
        score = 0.0
        for term in query:
            f = tf.get(term)
            if not f:
                continue
            idf = math.log(1 + (N - df[term] + 0.5) / (df[term] + 0.5))
            score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * dl[i] / avgdl))
        if score > 0:
            scored.append((score, i))
    scored.sort(reverse=True)

    top = scored[: args.top]
    out = {
        "lecture": os.path.basename(args.lecture),
        "lecture_pages": n_pages,
        "bank_total": len(docs),
        "returned": len(top),
        "candidates": [],
    }
    for score, i in top:
        d = docs[i]
        text = d["text"]
        if args.max_chars and len(text) > args.max_chars:
            text = text[: args.max_chars] + " …(생략)"
        out["candidates"].append({
            "id": d["id"], "year": d["year"], "term": d["term"],
            "subject": d["subject"], "qnum": d["qnum"], "source": d["source"],
            "score": round(score, 2), "text": text,
        })
    json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
    print()


# ---------------------------------------------------------------------------
# build — 선택한 문제로 PDF 만들기
# ---------------------------------------------------------------------------
def cmd_build(args):
    sel = json.loads(args.select) if args.select else json.load(open(args.select_file, encoding="utf-8"))
    rows = []
    for item in sel:
        qs = sorted({int(q) for q in item["q"]})        # 중복 제거 + 정렬
        if qs:
            rows.append((int(item["year"]), item["term"], qs))
    if not rows:
        sys.exit("선택된 문제가 없습니다.")

    logs = []
    path, added, warnings = extractor.build_pdf(
        args.library, args.subject, rows, args.out, log=logs.append)
    for line in logs:
        print("  " + str(line))
    if warnings:
        print("\n경고:")
        for w in warnings:
            print("  ! " + w)
    print(f"\n완료: {added}문제 -> {path}")


# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="족보 추출 도구")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("index", help="자료실 -> bank.json")
    p.add_argument("--library", default=DEFAULT_LIB)
    p.add_argument("--bank", default=DEFAULT_BANK)
    p.set_defaults(func=cmd_index)

    p = sub.add_parser("search", help="강의안과 겹치는 후보 문제 추리기")
    p.add_argument("lecture", help="강의안 PDF 또는 TXT")
    p.add_argument("--bank", default=DEFAULT_BANK)
    p.add_argument("--subject", default=None)
    p.add_argument("--top", type=int, default=60)
    p.add_argument("--max-chars", type=int, default=1200,
                   help="후보별 본문 최대 길이 (0이면 제한 없음)")
    p.set_defaults(func=cmd_search)

    p = sub.add_parser("build", help="선택한 문제로 PDF 만들기")
    p.add_argument("--subject", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--library", default=DEFAULT_LIB)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--select", help='예: \'[{"year":2023,"term":"기말","q":[1,3,5]}]\'')
    g.add_argument("--select-file")
    p.set_defaults(func=cmd_build)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
