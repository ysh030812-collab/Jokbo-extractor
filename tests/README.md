# 회귀 테스트

전부 `web/` 웹앱을 대상으로 한다. 실제 족보(2020·2022·2023 감면 기말)에서
파서가 걸려 넘어졌던 구간을 픽스처로 옮겨 두었다. 저작물이므로 문항 내용이
아니라 **번호·구분점·선지·슬라이드 구조**만 재현한다.

## 준비

```sh
npm install                          # @xmldom/xmldom, fflate, playwright
pip install python-docx pymupdf pillow
python3 tests/make_fixtures.py       # DOCX 픽스처
python3 tests/make_e2e_inputs.py     # 브라우저 e2e 입력 (풀이 PDF·강의안)
python3 tests/make_big_solution.py   # 실제 규모(511쪽) 풀이 PDF — 색인 변환 검증용
```

## 돌리기

```sh
node tests/test_js.mjs      # 풀이 PDF 블록 스캔 · 파일명(NFC/NFD) · JSON 파싱
node tests/test_docx.mjs    # 시험지 DOCX 파싱
node tests/e2e.mjs          # 브라우저 전 과정 (CHROME=<크로미움 경로> 로 지정 가능)
```

`e2e.mjs` 는 등록 → 파일 삭제 → 재등록 → 새로고침 → Project 색인 생성 →
지시문 → 판정 붙여넣기 → 결과 PDF 까지 실제 브라우저에서 돌린다. 색인 파일이
Claude 의 요청 한도(**32MB · 100쪽**) 안에 들어오는지 검사하고, 넘으면 실패한다.
결과물은 `tests/e2e_project_out.pdf`, 색인 예시는 `tests/e2e_index_out.pdf` 로 남는다.

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
| 2020 풀이의 캡처 슬라이드 | 문제 화면이 그림뿐이면 그 문제가 통째로 사라지고, 슬라이드가 앞 문제에 딸려 들어갔다 |
