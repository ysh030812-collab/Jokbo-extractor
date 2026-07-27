# -*- coding: utf-8 -*-
"""
족보 문제 추출기 (웹 버전 · 엑셀 불필요)

특징
  - 엑셀(족보 정리) 파일 없이 동작한다.
  - 기출문제 파일을 한 번 등록하면 '자료실'에 보관되어 다음에도 그대로 쓴다.
  - 중간/기말은 줄마다 개별 지정 + 전체 일괄 변경 버튼 제공.
  - 과목명 / 강의안 번호 / 연도 입력을 기억해 다음 실행 때 미리 채워둔다.

로컬 실행:
    pip install -r requirements.txt
    streamlit run app.py
"""
import os
import re
import json
import traceback

import streamlit as st

import extractor


# ---------------------------------------------------------------------------
# 저장 위치
#   LIB_DIR      : 등록된 기출문제 파일 보관 (자료실)
#   SETTINGS     : 과목명·강의안번호·연도·학기 등 마지막 입력값 기억
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LIB_DIR = os.path.join(BASE_DIR, "자료")
SETTINGS = os.path.join(BASE_DIR, "settings.json")
ROWS = 7

os.makedirs(LIB_DIR, exist_ok=True)


def load_settings():
    try:
        with open(SETTINGS, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_settings(data):
    try:
        with open(SETTINGS, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception:
        pass   # 쓰기 불가 환경이어도 앱 동작은 계속


# ---------------------------------------------------------------------------
# 초기 상태: 저장된 설정을 세션에 한 번만 주입 (연도 미리 채우기)
# ---------------------------------------------------------------------------
if "_init" not in st.session_state:
    cfg = load_settings()
    saved_years = cfg.get("years", [])
    saved_terms = cfg.get("terms", [])
    saved_qs = cfg.get("questions", [])

    st.session_state["subject"] = cfg.get("subject", "감면")
    st.session_state["lecture_no"] = cfg.get("lecture_no", "")
    for i in range(ROWS):
        st.session_state[f"y{i}"] = saved_years[i] if i < len(saved_years) else ""
        st.session_state[f"t{i}"] = saved_terms[i] if i < len(saved_terms) else "기말"
        # 문제 번호는 강의안마다 바뀌므로 기본은 비워둔다 (기억 옵션이 켜져 있으면 복원)
        if cfg.get("remember_questions"):
            st.session_state[f"q{i}"] = saved_qs[i] if i < len(saved_qs) else ""
        else:
            st.session_state[f"q{i}"] = ""
    st.session_state["remember_questions"] = cfg.get("remember_questions", False)
    st.session_state["_init"] = True


st.set_page_config(page_title="족보 문제 추출기", page_icon="📄", layout="centered")
st.title("📄 족보 문제 추출기")
st.caption("등록해 둔 기출문제에서 원하는 문제만 골라 하나의 PDF로 만듭니다. (엑셀 불필요)")


# ===========================================================================
# 1. 자료실 — 한 번 등록하면 계속 보관
# ===========================================================================
st.subheader("1. 자료실")

lib = extractor.scan_library(LIB_DIR)

if lib:
    st.write(f"**등록된 시험 {len(lib)}개**")
    for r in lib:
        bits = []
        if r["solution"]:
            bits.append("풀이 PDF ✅")
        if r["docx"]:
            bits.append("문제 DOCX ✅")
        if not bits:
            bits.append("파일 확인 필요 ⚠️")
        subj = f" · {r['subject']}" if r["subject"] else ""
        st.markdown(f"- **{r['year']} {r['term']}**{subj} — {' / '.join(bits)}")
else:
    st.info("아직 등록된 기출문제가 없습니다. 아래에서 파일을 등록하세요.")

with st.expander("➕ 기출문제 등록 / 관리", expanded=not lib):
    st.markdown(
        """
        **파일 이름 규칙** (이대로 맞춰야 자동 인식됩니다)
        - 문제: `{연도} {과목} {중간기말}.docx` → 예: `2023 감면 기말.docx`
        - 풀이: `{연도} {과목} {중간기말} 풀이.pdf` → 예: `2023 감면 기말 풀이.pdf`

        풀이 PDF가 있으면 풀이를, 없으면 문제 DOCX를 자동으로 사용합니다.
        """
    )
    up = st.file_uploader(
        "등록할 파일 선택 (여러 개 가능)", type=["docx", "pdf"],
        accept_multiple_files=True, key="uploader")
    if up and st.button("자료실에 등록", use_container_width=True):
        saved = []
        for f in up:
            with open(os.path.join(LIB_DIR, f.name), "wb") as out:
                out.write(f.getbuffer())
            saved.append(f.name)
        st.success(f"{len(saved)}개 등록됨: " + ", ".join(saved))
        st.rerun()

    if lib:
        st.divider()
        st.caption("등록된 파일 삭제")
        files = sorted(
            n for n in os.listdir(LIB_DIR)
            if not n.startswith(("~$", ".")) and
            os.path.splitext(n)[1].lower() in (".pdf", ".docx")
        )
        to_del = st.multiselect("삭제할 파일", files, key="del_sel")
        if to_del and st.button("선택 파일 삭제", type="secondary"):
            for n in to_del:
                try:
                    os.remove(os.path.join(LIB_DIR, n))
                except OSError:
                    pass
            st.warning(f"{len(to_del)}개 삭제됨")
            st.rerun()


# ===========================================================================
# 2. 과목 · 강의안
# ===========================================================================
st.subheader("2. 과목 · 강의안")

# 자료실에서 과목명을 자동 추정해 기본값으로 제안
auto_subject = next((r["subject"] for r in lib if r["subject"]), "")
c1, c2 = st.columns(2)
with c1:
    subject = st.text_input("과목명", key="subject",
                            help=f"자료실 추정: {auto_subject}" if auto_subject else None)
with c2:
    lecture_no = st.text_input("강의안 번호 (자연수)", key="lecture_no",
                               help="결과 PDF 파일명으로 쓰입니다.")


# ===========================================================================
# 3. 문제 입력 — 학기 일괄 변경 + 연도 기억
# ===========================================================================
st.subheader("3. 뽑을 문제 입력")

# --- 학기 일괄 변경 버튼 ---
b1, b2, b3 = st.columns([1, 1, 2])
with b1:
    if st.button("전체 기말로", use_container_width=True):
        for i in range(ROWS):
            st.session_state[f"t{i}"] = "기말"
        st.rerun()
with b2:
    if st.button("전체 중간으로", use_container_width=True):
        for i in range(ROWS):
            st.session_state[f"t{i}"] = "중간"
        st.rerun()
with b3:
    if st.button("연도 자동 채우기 (자료실 기준)", use_container_width=True):
        for i, r in enumerate(lib[:ROWS]):
            st.session_state[f"y{i}"] = str(r["year"])
            st.session_state[f"t{i}"] = r["term"]
        for i in range(len(lib), ROWS):
            st.session_state[f"y{i}"] = ""
        st.rerun()

st.caption("입력한 행만 사용됩니다. 문제 번호는 콤마로 구분하세요. (예: 1, 3, 4, 5)")

h1, h2, h3 = st.columns([1.1, 1, 2.4])
h1.markdown("**연도**")
h2.markdown("**구분**")
h3.markdown("**문제 번호**")

for i in range(ROWS):
    a, b, c = st.columns([1.1, 1, 2.4])
    with a:
        st.text_input("연도", key=f"y{i}", label_visibility="collapsed",
                      placeholder="연도")
    with b:
        st.selectbox("구분", ["기말", "중간"], key=f"t{i}",
                     label_visibility="collapsed")
    with c:
        st.text_input("문제", key=f"q{i}", label_visibility="collapsed",
                      placeholder="예: 1, 3, 4, 5")

st.checkbox("문제 번호도 기억하기", key="remember_questions",
            help="끄면 다음 실행 때 문제 번호만 비워집니다. 연도·학기·과목은 항상 기억합니다.")

run = st.button("🚀 추출 실행", type="primary", use_container_width=True)


# ===========================================================================
# 실행
# ===========================================================================
def parse_rows():
    rows = []
    for i in range(ROWS):
        ytxt = (st.session_state.get(f"y{i}") or "").strip()
        qtxt = (st.session_state.get(f"q{i}") or "").strip()
        term = st.session_state.get(f"t{i}", "기말")
        if not ytxt and not qtxt:
            continue
        if not ytxt or not qtxt:
            raise ValueError(f"{i + 1}번째 줄: 연도와 문제 번호를 함께 입력하세요.")
        if not re.fullmatch(r"\d{4}", ytxt):
            raise ValueError(f"{i + 1}번째 줄: 연도는 네 자리 숫자여야 합니다.")
        qnums = [int(x) for x in re.split(r"[,\s]+", qtxt) if x.strip().isdigit()]
        if not qnums:
            raise ValueError(f"{i + 1}번째 줄: 문제 번호를 숫자로 입력하세요.")
        rows.append((int(ytxt), term, qnums))
    if not rows:
        raise ValueError("최소 한 줄 이상 입력하세요.")
    return rows


if run:
    # 입력값 기억 (실행 시점에 저장)
    save_settings({
        "subject": st.session_state.get("subject", ""),
        "lecture_no": st.session_state.get("lecture_no", ""),
        "years": [st.session_state.get(f"y{i}", "") for i in range(ROWS)],
        "terms": [st.session_state.get(f"t{i}", "기말") for i in range(ROWS)],
        "questions": [st.session_state.get(f"q{i}", "") for i in range(ROWS)],
        "remember_questions": st.session_state.get("remember_questions", False),
    })

    try:
        if not lib:
            raise ValueError("자료실에 등록된 기출문제가 없습니다. 먼저 파일을 등록하세요.")
        if not subject.strip():
            raise ValueError("과목명을 입력하세요.")
        if not lecture_no.strip().isdigit():
            raise ValueError("강의안 번호는 자연수여야 합니다.")
        lec_no = int(lecture_no.strip())
        rows = parse_rows()
    except Exception as e:
        st.error(f"입력 오류: {e}")
        st.stop()

    logs = []
    log_area = st.empty()

    def log(msg):
        logs.append(str(msg))
        log_area.code("\n".join(logs), language=None)

    try:
        out_pdf = os.path.join(BASE_DIR, f"{lec_no}.pdf")
        with st.spinner("추출 중입니다..."):
            path, added, warnings = extractor.build_pdf(
                LIB_DIR, subject.strip(), rows, out_pdf, log=log)

        with open(path, "rb") as fp:
            pdf_bytes = fp.read()
        try:
            os.remove(path)
        except OSError:
            pass

        st.success(f"추출 완료! 문제 {added}개")
        if warnings:
            with st.expander(f"⚠️ 경고 {len(warnings)}건", expanded=True):
                for w in warnings:
                    st.write("• " + w)

        st.download_button(
            "📥 결과 PDF 내려받기",
            data=pdf_bytes,
            file_name=f"{lec_no}.pdf",
            mime="application/pdf",
            use_container_width=True,
        )
    except Exception as e:
        st.error(f"오류: {e}")
        st.code(traceback.format_exc(), language=None)
