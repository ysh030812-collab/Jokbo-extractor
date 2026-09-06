/* 시험지 PDF — 문제 나누기와 오려내기.
   실물(2022·2023 소화기 시험지)에서 파서가 걸려 넘어졌던 자리를 그대로 재현한
   합성 시험지를 브라우저에서 만들어 검사한다. 저작물이므로 내용이 아니라
   번호·구분점·줄 간격·그림 배치만 옮긴다. */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'web', 'src');
const APP = 'file://' + path.join(HERE, '..', 'web', 'index.html');

/* 배포 코드에서 검사할 부분만 잘라 온다 — 앱에 테스트용 창구를 뚫지 않기 위해 */
const rd = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const cut = (s, a, b) => {
  const i = s.indexOf(a), j = s.indexOf(b);
  if (i < 0 || j < 0) throw new Error(`소스에서 ${a} ~ ${b} 구간을 못 찾았습니다`);
  return s.slice(i, j);
};
const JS = rd('app_js.js'), PD = rd('app_pdf.js');
const HOOK = cut(JS, '/* 시험지 PDF 는 글자의', '/* ── 문제 시작 슬라이드')
  + cut(PD, '/* 문제처럼 읽히는 줄인가', '/* ── 캔버스 조판')
  + 'const PW = 842, PH = 595;\n'
  + cut(PD, '/* ── 오려낸 조각 배치', '/* 슬라이드 n장을 한 페이지에 놓을 자리')
  + '\nwindow.__T = { pageLines, pdfExamQuestions, layoutCrops, placeCols };';

let pass = 0, fail = 0;
const ck = (n, g, w) => {
  const ok = JSON.stringify(g) === JSON.stringify(w);
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}` + (ok ? '' : `\n   got =${JSON.stringify(g)}\n   want=${JSON.stringify(w)}`));
  ok ? pass++ : fail++;
};
const ok = (n, cond, why) => ck(n, cond ? true : `false — ${why}`, true);

const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const pg = await (await b.newContext({ viewport: { width: 900, height: 1000 } })).newPage();
const errs = [];
pg.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
pg.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await pg.goto(APP);
await pg.evaluate((code) => { new Function(code)(); }, HOOK);

/* ── 합성 시험지 만들기 ───────────────────────────────────────────
   A4 세로, 왼쪽 여백 85, 줄 간격 16, 문제 사이 32 — 실물과 같은 배치. */
const FIXTURE = await pg.evaluate(async () => {
  const doc = await PDFLib.PDFDocument.create();
  const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  const L = 85, LH = 16, GAP = 32, TOP = 733;
  let page = null, y = 0;
  const newPage = () => { page = doc.addPage([595, 842]); y = TOP; };
  const line = (t, dx) => { page.drawText(t, { x: L + (dx || 0), y, size: 10, font }); y -= LH; };
  const gap = () => { y -= GAP - LH; };
  newPage();

  line('[1~7 : Prof. Kim]'); gap();
  /* 1번 — 선지 하나가 숫자로 시작한다 (소수로 오해하던 자리) */
  line('1. Which one is the most correct statement?  (4)');
  line('1) alpha'); line('2) 15 years of drinking'); line('3) beta');
  line('4) gamma'); line('5) delta'); gap();
  /* 2번 — 선지 다섯 개가 한 줄에 다 있다 */
  line('2. What is the value here?  (2)');
  line('1) 1/15  2) 2/15  3) 1/5  4) 2/5  5) 3/5'); gap();
  /* 3번 — 번호 바로 뒤에 숫자가 온다 */
  line('3.100 films were classified by two doctors. Which is right?  (1)');
  line('1) a'); line('2) b'); line('3) c'); line('4) d'); line('5) e'); gap();
  /* 4번 — 글 아래에 그림만 있다. 글줄만 보면 그림이 통째로 잘린다. */
  line('4. The figure below shows the study flow. Which is right?  (5)');
  const figTop = y - 6;
  page.drawRectangle({ x: L, y: figTop - 150, width: 380, height: 150,
                       borderWidth: 2, borderColor: PDFLib.rgb(0, 0, 0) });
  page.drawText('FIGURE', { x: L + 150, y: figTop - 80, size: 20, font });
  y = figTop - 150 - LH; gap();
  /* 5번 — 이 쪽 아래에서 시작해 다음 쪽으로 넘어간다 */
  y = 150;
  line('5. This question runs over the page break. Which is right?  (3)');
  line('1) first'); line('2) second');
  newPage();
  line('3) third'); line('4) fourth'); line('5) fifth'); gap();
  /* 6번 — 쪽 한 장을 거의 다 쓰는 긴 문제 (단으로 나뉘어야 한다) */
  line('6. A very long question that fills the page. Which is right?  (2)');
  for (let i = 0; i < 30; i++) line(`  line ${i} of the long stem text for question six`);
  line('1) one'); line('2) two'); line('3) three'); line('4) four'); line('5) five');
  newPage();
  /* 7번 */
  line('7. The last multiple choice question. Which is right?  (1)');
  line('1) p'); line('2) q'); line('3) r'); line('4) s'); line('5) t');

  const bytes = await doc.save();
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return { b64: btoa(s), figTop, figBot: figTop - 150 };
});

/* ── 파서 (배포 코드 원문을 그대로 잘라 실행) ──────────────────── */
const parsed = await pg.evaluate(async ({ b64 }) => {
  const s = atob(b64), u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  const pages = await window.__T.pageLines(u.buffer.slice(0));
  const qs = window.__T.pdfExamQuestions(pages);
  return { np: pages.length, qs, lay: qs.map((q) => window.__T.layoutCrops(q.crops)) };
}, FIXTURE).catch((e) => ({ err: String(e) }));

if (parsed.err) { console.log('파서를 돌리지 못했습니다:', parsed.err); process.exit(1); }

const key = (q) => (q.sec || '') + q.num;
ck('쪽 수', parsed.np, 3);
ck('문제 번호', parsed.qs.map(key), ['1', '2', '3', '4', '5', '6', '7']);
ck('숫자로 시작하는 선지를 새 문제로 읽지 않는다', parsed.qs.filter((q) => q.num === 15).length, 0);
ck('번호 뒤에 바로 숫자가 와도 문제로 읽는다', parsed.qs.some((q) => q.num === 3 && /100 films/.test(q.text)), true);
ck('한 줄에 몰린 선지를 문제로 읽지 않는다',
  parsed.qs.filter((q) => q.sec === '' && q.num > 7).length, 0);

const q4 = parsed.qs.find((q) => key(q) === '4');
const bot4 = Math.min(...q4.crops.map((c) => c.y));
ok('글 아래 그림까지 오려낸다', bot4 <= FIXTURE.figBot + 3,
  `조각 아래끝 ${bot4.toFixed(0)} > 그림 아래끝 ${FIXTURE.figBot.toFixed(0)}`);

const q1 = parsed.qs.find((q) => key(q) === '1');
ok('짧은 문제는 빈 종이까지 끌고 오지 않는다', q1.crops[0].h < 130,
  `조각 높이 ${q1.crops[0].h.toFixed(0)}pt`);

const q5 = parsed.qs.find((q) => key(q) === '5');
ck('쪽을 넘어간 문제는 조각이 둘', q5.crops.length, 2);
ck('두 조각이 이어지는 쪽', q5.crops.map((c) => c.p), [0, 1]);

/* ── 주관식·들여쓰기 (한글이 들어가므로 글줄만 손으로 만들어 검사한다) ── */
const synth = await pg.evaluate(() => {
  const L = (y, x, t) => ({ y, x, x2: x + 200, h: 10, t });
  const mk = (lines) => ({ w: 595, h: 842, ink: null, lines });
  const pages = [mk([
    L(733, 85, '1. 다음 중 옳은 것은?'),
    L(717, 85, '1) 가'), L(701, 85, '2) 나'), L(685, 85, '3) 다'),
    L(669, 85, '4) 라'), L(653, 85, '5) 마'),
    L(621, 85, '2. 다음 중 옳지 않은 것은?'),
    L(605, 85, '1) 가'), L(589, 85, '2) 나'),
    L(557, 120, '3. 들여쓴 줄은 문제가 아니다'),
    L(525, 85, '[주관식 1~2번 : 이훈재 교수님 출제]'),
    L(493, 85, '1) 조사망률을 산출하고 그 이유를 쓰시오'),
    L(461, 85, '2) 두 분석의 차이를 비교해 보시오'),
  ])];
  return window.__T.pdfExamQuestions(pages).map((q) => (q.sec || '') + q.num);
});
ck('주관식은 번호를 따로 세고, 들여쓴 줄은 건너뛴다', synth, ['1', '2', '주1', '주2']);

/* 번호를 묶어 낸 문제 — 구분점이 번호 바로 뒤에 없어 통째로 놓치던 자리 */
const rng = await pg.evaluate(() => {
  const L = (y, x, t) => ({ y, x, x2: x + 200, h: 10, t });
  const pages = [{ w: 595, h: 842, ink: null, lines: [
    L(733, 85, '36. 다음 중 옳은 것은?'), L(717, 85, '1) 가'), L(701, 85, '2) 나'),
    L(669, 85, '37,38. 위에서 점막하 종양이 보인다. 진단은?'), L(653, 85, '1) 가'),
    L(621, 85, '39. 그 다음 문제는?'), L(605, 85, '1) 가'),
    L(573, 85, '43-45. 알코올성 간질환의 3가지 질환 스펙트럼을 쓰고'),
    L(557, 85, '각각의 특징을 간략히 기술하시오.'),
    L(525, 85, '46. 마지막 문제는?'), L(509, 85, '1) 가'),
  ] }];
  return window.__T.pdfExamQuestions(pages).map((q) => [q.num, q.to || 0]);
});
ck('묶음 번호를 저마다 한 문제로 잡는다', rng, [[36, 0], [37, 38], [39, 0], [43, 45], [46, 0]]);

/* ── 배치 ─────────────────────────────────────────────────────── */
const lay1 = parsed.lay[parsed.qs.findIndex((q) => key(q) === '1')];
ck('짧은 문제는 한 단', lay1.cols.length, 1);
const lay6 = parsed.lay[parsed.qs.findIndex((q) => key(q) === '6')];
ok('쪽을 채우는 긴 문제는 여러 단으로 세운다', lay6.cols.length >= 2, `단 ${lay6.cols.length}개`);
const total6 = lay6.cols.flat().reduce((a, c) => a + c.h, 0);
const src6 = parsed.qs.find((q) => key(q) === '6').crops.reduce((a, c) => a + c.h, 0);
ok('단으로 나눠도 잘려 나가는 데가 없다', Math.abs(total6 - src6) < 1,
  `조각 합 ${total6.toFixed(1)} ≠ 원본 ${src6.toFixed(1)}`);

/* ── 등록부터 결과 PDF 까지 ───────────────────────────────────── */
const put = async (sel, list) => pg.evaluate(({ sel, list }) => {
  const dt = new DataTransfer();
  for (const f of list) {
    const s = atob(f.b64), u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    dt.items.add(new File([u], f.name));
  }
  const el = document.querySelector(sel);
  el.files = dt.files;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, { sel, list });

await pg.evaluate(() => { const o = URL.createObjectURL; URL.createObjectURL = (x) => (window.__blob = x, o(x)); });
await put('#f1', [{ name: '2024 시험과목 기말.pdf', b64: FIXTURE.b64 }]);
await pg.waitForFunction(() => document.querySelectorAll('#fl .fi').length === 1, null, { timeout: 60000 });
ck('등록 오류 없음', await pg.$eval('#e1', (e) => e.innerText.trim()), '');
ck('시험지로 등록된다', await pg.$eval('#fl .fi .kind', (e) => e.innerText), '시험지');
ck('문제 수', await pg.$eval('#s1', (e) => e.innerText.replace(/\n/g, ' ')), '총 7문제 시험지 7문제');

await pg.click('#man summary');
await pg.$$eval('#mx .mnum', (els) => els.forEach((e) => { e.value = '1, 4, 5, 6'; }));
await pg.click('#mgo');
await pg.waitForSelector('#qs .q');
ck('고른 문제', await pg.$$eval('#qs .q .who', (ls) => ls.map((l) => l.innerText.replace(/^.*기말 /, ''))),
  ['1번', '4번', '5번', '6번']);

/* ── 정답 표시 ─────────────────────────────────────────────────
   시험지에 답이 없는 해가 있어 Claude 가 풀어 준 것을 받아 찍는다.
   사람이 매긴 것이 아니므로 반드시 "정답(추정)" 으로 나가야 한다. */
await pg.fill('#ta', '```json\n' + JSON.stringify([
  { id: '2024-기말-시험과목-1', verdict: 'solvable', answer: '4', pages: '3', why: '선지 번호' },
  { id: '2024-기말-시험과목-4', verdict: 'partial', answer: '두 분석의 차이를 서술', pages: '4', why: '글로 온 답' },
  { id: '2024-기말-시험과목-5', verdict: 'solvable', pages: '5', why: '답을 모르면 빼도 된다' },
]) + '\n```');
await pg.click('#rd');
await pg.waitForSelector('#qs .q');
ck('정답 뱃지는 답이 온 문제에만',
  await pg.$$eval('#qs .q', (ls) => ls.map((l) => (l.querySelector('.tag.ans') || {}).textContent || '')),
  ['정답(추정) 4', '정답(추정) 두 분석의 차이를 서술', '']);

await pg.$$eval('#qs .q input', (cs) => cs.forEach((c) => { if (!c.checked) c.click(); }));
await pg.click('#mk');
await pg.waitForFunction(() => window.__blob, null, { timeout: 120000 });
const ansPdf = await pg.evaluate(async () => {
  const ab = await window.__blob.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: ab.slice(0), isEvalSupported: false }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++)
    out.push((await (await doc.getPage(i)).getTextContent()).items.map((t) => t.str).join(' '));
  await doc.destroy();
  return out.join(' ');
});
ok('오려 붙인 쪽에도 원문이 들어간다', /most correct statement/.test(ansPdf), '원문을 못 찾음');
await pg.evaluate(() => { window.__blob = null; });

await pg.$$eval('#mx .mnum', (els) => els.forEach((e) => { e.value = '1, 4, 5, 6'; }));
await pg.click('#mgo');
await pg.waitForSelector('#qs .q');
ck('번호로 직접 고르면 정답 뱃지는 없다',
  await pg.$$eval('#qs .q .tag.ans', (ls) => ls.length), 0);

await pg.click('#mk');
await pg.waitForFunction(() => window.__blob, null, { timeout: 120000 });
const out = await pg.evaluate(async () => {
  const ab = await window.__blob.arrayBuffer();
  const d = await PDFLib.PDFDocument.load(ab);
  const doc = await pdfjsLib.getDocument({ data: ab.slice(0), isEvalSupported: false }).promise;
  const txt = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    txt.push(tc.items.map((t) => t.str).join(' '));
  }
  await doc.destroy();
  return { pages: d.getPageCount(), size: ab.byteLength, txt };
});
ck('표지 + 구분 + 문제 4쪽', out.pages, 6);
ok('원본 글자가 벡터 그대로 들어간다', /most correct statement/.test(out.txt.join(' ')),
  '결과 PDF 에서 원문을 못 찾음');
ok('쪽을 넘어간 문제도 뒷부분이 들어간다', /fifth/.test(out.txt.join(' ')), '5번 뒷조각이 빠졌다');
ck('콘솔 오류', errs, []);

await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
