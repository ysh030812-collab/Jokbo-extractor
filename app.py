# -*- coding: utf-8 -*-
"""
족보 문제 추출기 (웹 버전 · Streamlit)

아이패드 등 브라우저에서 사용하는 버전입니다.
원본의 핵심 로직(extractor.py)은 그대로 사용하고, 화면(UI)만 웹으로 바꿨습니다.

로컬 실행:
    pip install -r requirements.txt
    streamlit run app.py

그 후 아이패드 사파리에서  http://{서버IP}:8501  로 접속합니다.
"""
import os
import re
import io
import zipfile
import tempfile
import traceback

import streamlit as st

import extractor


st.set_page_config(page_title="족보 문제 추출기", page_icon="📄", layout="centered")

st.title("📄 족보 문제 추출기")
st.caption("시험 문제·풀이 파일을 올리고, 원하는 문제만 하나의 PDF로 뽑아냅니다.")

with st.expander("사용법 보기", expanded=False):
    st.markdown(
        """
        1. 아래에 자료 파일들을 한꺼번에 올립니다. 다음 파일들이 필요합니다.
            - `{연도} {과목} {중간기말}.docx`  (예: `2023 감면 기말.docx`)
            - `{연도} {과목} {중간기말} 풀이.pdf`  (예: `2023 감면 기말 풀이.pdf`)
            - `{과목} {중간기말} 족보 정리.xlsx`  (예: `감면 기말 족보 정리.xlsx`)
        2. 과목명 · 강의안 번호를 입력합니다.
        3. 각 행에 연도 · 중간/기말 · 문제 번호(콤마 구분)를 입력합니다.
        4. **추출 실행**을 누르면 결과 PDF와, 강의안 번호가 기입된 엑셀을 내려받을 수 있습니다.
        """
    )

# ---------------------------------------------------------------------------
# 1) 파일 업로드
# ---------------------------------------------------------------------------
st.subheader("1. 자료 파일 올리기")
uploaded = st.file_uploader(
    "docx / pdf / xlsx 파일을 모두 선택하세요 (여러 개 가능)",
    type=["docx", "pdf", "xlsx"],
    accept_multiple_files=True,
)
if uploaded:
    st.success(f"{len(uploaded)}개 파일 업로드됨: " +
               ", ".join(f.name for f in uploaded))

# ---------------------------------------------------------------------------
# 2) 기본 정보
# ---------------------------------------------------------------------------
st.subheader("2. 과목 · 강의안")
c1, c2 = st.columns(2)
with c1:
    subject = st.text_input("과목명", value="감면")
with c2:
    lecture_no = st.text_input("강의안 번호 (자연수)", value="")

# ---------------------------------------------------------------------------
# 3) 문제 입력 표
# ---------------------------------------------------------------------------
st.subheader("3. 뽑을 문제 입력")
st.caption("입력한 행만 사용됩니다. 문제 번호는 콤마로 구분하세요. (예: 1, 3, 4, 5)")

ROWS = 7
rows_input = []
for i in range(ROWS):
    a, b, c = st.columns([1.1, 1, 2.4])
    with a:
        year = st.text_input("연도", key=f"y{i}", label_visibility="collapsed",
                             placeholder="연도")
    with b:
        term = st.selectbox("구분", ["기말", "중간"], key=f"t{i}",
                            label_visibility="collapsed")
    with c:
        qs = st.text_input("문제", key=f"q{i}", label_visibility="collapsed",
                          placeholder="문제 번호 (예: 1, 3, 4, 5)")
    rows_input.append((year, term, qs))

run = st.button("🚀 추출 실행", type="primary", use_container_width=True)


# ---------------------------------------------------------------------------
# 실행 처리
# ---------------------------------------------------------------------------
def parse_rows(rows_input):
    rows = []
    for ytxt, term, qtxt in rows_input:
        ytxt = (ytxt or "").strip()
        qtxt = (qtxt or "").strip()
        if not ytxt and not qtxt:
            continue
        if not ytxt or not qtxt:
            raise ValueError("연도와 문제 번호를 함께 입력하세요.")
        year = int(ytxt)
        qnums = [int(x) for x in re.split(r"[,\s]+", qtxt) if x.strip()]
        if not qnums:
            raise ValueError(f"{ytxt} 행의 문제 번호가 비어 있습니다.")
        rows.append((year, term.strip(), qnums))
    if not rows:
        raise ValueError("최소 한 행 이상 입력하세요.")
    return rows


if run:
    # 입력 검증
    try:
        if not uploaded:
            raise ValueError("자료 파일을 올려주세요.")
        if not subject.strip():
            raise ValueError("과목명을 입력하세요.")
        if not lecture_no.strip().isdigit():
            raise ValueError("강의안 번호는 자연수여야 합니다.")
        lec_no = int(lecture_no.strip())
        rows = parse_rows(rows_input)
    except Exception as e:
        st.error(f"입력 오류: {e}")
        st.stop()

    log_area = st.empty()
    logs = []

    def log(msg):
        logs.append(str(msg))
        log_area.code("\n".join(logs), language=None)

    try:
        # 업로드 파일을 임시 폴더에 풀어 원본 로직이 폴더처럼 다루게 함
        with tempfile.TemporaryDirectory() as folder:
            for f in uploaded:
                with open(os.path.join(folder, f.name), "wb") as out:
                    out.write(f.getbuffer())

            out_pdf = os.path.join(folder, f"{lec_no}.pdf")
            with st.spinner("추출 중입니다..."):
                path, updated, warnings = extractor.build_pdf(
                    folder, subject.strip(), lec_no, rows, out_pdf, log=log)

            # 결과 PDF 읽기
            with open(path, "rb") as fp:
                pdf_bytes = fp.read()

            # 강의안 번호가 기입된 엑셀들도 함께 회수
            xlsx_updated = []
            for name in os.listdir(folder):
                if name.lower().endswith(".xlsx") and not name.startswith("~$"):
                    with open(os.path.join(folder, name), "rb") as fp:
                        xlsx_updated.append((name, fp.read()))

        st.success(f"추출 완료! 강의안 번호 기입: {updated}행")

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

        # 엑셀은 여러 개일 수 있어 zip으로 묶어 제공 (기입 내용 반영본)
        if xlsx_updated:
            if len(xlsx_updated) == 1:
                name, data = xlsx_updated[0]
                st.download_button(
                    f"📥 엑셀 내려받기 ({name})",
                    data=data,
                    file_name=name,
                    mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    use_container_width=True,
                )
            else:
                zbuf = io.BytesIO()
                with zipfile.ZipFile(zbuf, "w", zipfile.ZIP_DEFLATED) as z:
                    for name, data in xlsx_updated:
                        z.writestr(name, data)
                zbuf.seek(0)
                st.download_button(
                    "📥 엑셀 전체 내려받기 (zip)",
                    data=zbuf.getvalue(),
                    file_name="족보정리_업데이트.zip",
                    mime="application/zip",
                    use_container_width=True,
                )
            st.caption("※ 엑셀을 내려받아 원본 파일에 덮어써 두면 강의안 번호 기입이 유지됩니다.")

    except Exception as e:
        st.error(f"오류: {e}")
        st.code(traceback.format_exc(), language=None)
