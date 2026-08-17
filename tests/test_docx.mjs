import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DOMParser } from '@xmldom/xmldom';
import * as fflate from 'fflate';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'web', 'src');
const FIX = path.join(HERE, 'fixtures');
globalThis.DOMParser = DOMParser;
globalThis.fflate = fflate;

// app_pdf.js 에서 DOCX 파싱부만 잘라 실행 (실제 배포 코드 그대로)
const src = fs.readFileSync(path.join(SRC, 'app_pdf.js'), 'utf8');
const code = src.slice(src.indexOf('const NS = {'), src.indexOf('/* ── 캔버스 조판'));
const M = {};
new Function('exports', code + '\nObject.assign(exports,{docxQuestions,classify,paraLines});')(M);

// Node 의 Buffer 는 풀을 공유한다 — .buffer 를 그대로 넘기면 다른 파일까지 딸려온다
const load = (f) => { const b = fs.readFileSync(path.join(FIX, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };

let pass = 0, fail = 0;
const ck = (n, g, w) => {
  const ok = JSON.stringify(g) === JSON.stringify(w);
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}` + (ok ? '' : `\n   got =${JSON.stringify(g)}\n   want=${JSON.stringify(w)}`));
  ok ? pass++ : fail++;
};

/* ── 1. 합성 픽스처 (텍스트 상자·보기 상자) ─────────────────────── */
const qs = M.docxQuestions(load('t.docx'));
console.log('추출된 문제:', qs.map(q => q.num));
ck('문제 번호', qs.map(q => q.num), [1, 2]);
ck('1번 지문', qs[0].stem, '다음 중 옳은 것은?');
ck('1번 선지', qs[0].choices, ['보기 하나', '보기 둘', '보기 셋']);
ck('2번 지문', qs[1].stem, '두 번째 문제이다.');
const tb = [...qs[1].choices, ...qs[1].presented].filter(x => x.includes('TEXTBOX'));
ck('텍스트 상자 중복 없음', tb, ['TEXTBOX_CONTENT']);
ck('보기 항목은 제시문으로', qs[1].presented.filter(t => /^[가나]\./.test(t)), ['가. 첫째', '나. 둘째']);

/* ── 2. classify 단위 ─────────────────────────────────────────── */
ck('숫자 표기 선지 분리',
  M.classify([['1. 가', false], ['2. 나', false], ['안내문입니다', false]]),
  [['안내문입니다'], ['가', '나']]);
ck('동그라미 선지',
  M.classify([['① 가', false], ['② 나', false]]), [[], ['가', '나']]);
// 제시문에 "- " 한 줄이 섞여도 숫자 선지가 살아남아야 한다 (많이 쓰인 표기를 고름)
ck('섞인 표기 — 개수 많은 쪽이 선지',
  M.classify([['- 참고 자료', false], ['1) 가', false], ['2) 나', false], ['3) 다', false]]),
  [['- 참고 자료'], ['가', '나', '다']]);
// 선지 번호는 1부터 이어진다. 중간에 낀 큰 숫자는 제시문
ck('이어지지 않는 번호는 제시문',
  M.classify([['300. 균주가 보고되었다', false], ['1. 가', false], ['2. 나', false]]),
  [['300. 균주가 보고되었다'], ['가', '나']]);

/* ── 3. 실제 족보에서 나온 형태 (2022 기말 / 2023 기말) ────────── */
const r = M.docxQuestions(load('real2022.docx'));
const by = new Map(r.map(q => [q.num, q]));
console.log('real2022 추출:', r.map(q => q.num));
ck('실제 형태 — 문제 번호', r.map(q => q.num), [1, 2, 3, 4, 5, 106, 143, 144]);
ck('144: 구분점 없는 머리도 새 문제 (사용자 보고 버그)',
  by.get(144).stem, '다음 중 HIV의 진단 및 치료와 관련한 설명으로 옳지 않은 것은?');
ck('143: 144 선지가 섞여 들어가지 않음', by.get(143).choices.length, 5);
ck('1: 번호가 통째로 빠진 첫 문제 복구',
  by.get(1).stem, '다음 그림은 광견병 예방의 방침을 결정하는 알고리즘을 나타낸 것이다. 옳은 것은?');
ck('1: 선지 5개', by.get(1).choices.length, 5);
ck('2: 마침표 뒤 공백 없음', by.get(2).stem, '다음 도표는 백일해 발생률의 연도별 추이이다. 옳지 않은 것은?');
ck('3: 선지 4개짜리도 그대로', by.get(3).choices.length, 4);
ck('4: 닫는 괄호 표기', by.get(4).stem, '다음 중 옳은 것은?');
ck('5: <보기>는 제시문', by.get(5).presented, ['<보기>', 'a. 수면병', 'b. 옴', 'c. 개조충']);
ck('106: 선지 16개짜리도 쪼개지지 않음', by.get(106).choices.length, 16);
ck('143: 숫자로 시작하는 본문은 문제가 아님', by.get(143).presented, ['8개월간 추적 관찰한 결과를 정리한 것이다.']);
ck('"하나를 선택하세요"는 버림',
  r.flatMap(q => [...q.presented, ...q.choices]).filter(t => t.includes('선택하세요')), []);

const r3 = M.docxQuestions(load('real_2023.docx'));
console.log('real_2023 추출:', r3.map(q => q.num));
ck('2023: 띄엄띄엄한 번호 그대로', r3.map(q => q.num), [1, 22, 32, 66, 87, 110]);
ck('2023 87: 선지 16개', r3.find(q => q.num === 87).choices.length, 16);
ck('2023 66: "66번." 표기 + 번호 없는 선지', r3.find(q => q.num === 66).choices.length, 6);
ck('2023 110: 조합형 선지', r3.find(q => q.num === 110).choices, ['a, b, e', 'b, c, e', 'a, d, e', 'b, c, d', 'c, d, e']);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
