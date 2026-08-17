# 회귀 테스트

실제 족보(2022·2023 감면 기말)에서 파서가 걸려 넘어졌던 구간을 픽스처로 옮겨 두었다.
저작물이므로 문항 내용 자체가 아니라 **번호·구분점·선지 구조**만 재현한다.

## 준비

```sh
npm install                       # @xmldom/xmldom, fflate, playwright
pip install python-docx pymupdf   # 픽스처 생성용
python3 tests/make_fixtures.py    # tests/fixtures/*.docx
```

## 돌리기

```sh
node tests/test_js.mjs      # 풀이 PDF 블록 스캔 · 파일명(NFC/NFD) · BM25 · JSON 파싱
node tests/test_docx.mjs    # 시험지 DOCX 파싱 (웹판, web/src/app_pdf.js)
python3 tests/test_docx.py  # 시험지 DOCX 파싱 (파이썬판, extractor.py)
```

두 파서는 같은 픽스처로 같은 결과를 내야 한다. 한쪽만 고치면 이 테스트가 어긋난다.

## 브라우저 전 과정 (선택)

```sh
python3 tests/make_e2e_inputs.py
node tests/e2e.mjs          # CHROME=<크로미움 경로> 로 실행 파일 지정 가능
```

등록 → 파일 삭제 → 재등록 → 새로고침 → 강의안 → 판정 붙여넣기 → PDF 까지
실제 브라우저에서 돌리고, 아이폰/아이패드 폭에서 가로 스크롤이 생기지 않는지 확인한다.
결과물은 `tests/e2e_out.pdf`, 화면은 `tests/e2e_top.png` 로 남는다.

## 픽스처가 잡아내는 것

| 픽스처 | 실제로 있었던 문제 |
|---|---|
| 2022 144번 `144다음 중 …` | 구분점이 없어 143번 뒤에 붙고, 144번 선지가 143번 선지 6\~10번이 되었다 |
| 2022 1번 (번호 없음) | 첫 문제가 통째로 빠지고 선지가 각각 1\~5번 문제가 되었다 |
| 2023 87번 (선지 16개) | 6번째 선지부터 새 문제로 잘려 빈 문제가 11개 생겼다 |
| 2023 66번 `66번.` | 번호 없는 선지 6개 |
| `2.다음 도표는` | 마침표 뒤 공백 없음 |
| `8개월간 …` / `300. …` | 숫자로 시작하는 본문이 문제·선지로 오인되던 것 |
| `하나를 선택하세요.` | 워드 설문 안내문이 선지로 들어가던 것 |
| 텍스트 상자 | `mc:Fallback` + `w:txbxContent` 를 둘 다 읽어 내용이 2\~3번 중복되던 것 |
