/* 화면 — 1·2단계 접기, 과목 나눠 등록하고 갈아타기.
   여러 과목을 한 기기에 등록해 두면 목록·Project 준비·번호 입력이 모두 지금
   고른 과목만 보여야 한다. 새로고침해도 고른 과목이 남아야 한다. */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures');
const APP = 'file://' + path.join(HERE, '..', 'web', 'index.html');

let pass = 0, fail = 0;
const ck = (n, g, w) => {
  const okk = JSON.stringify(g) === JSON.stringify(w);
  console.log(`[${okk ? 'PASS' : 'FAIL'}] ${n}` + (okk ? '' : `\n   got =${JSON.stringify(g)}\n   want=${JSON.stringify(w)}`));
  okk ? pass++ : fail++;
};

const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const pg = await (await b.newContext({ viewport: { width: 900, height: 1100 } })).newPage();
const errs = [];
pg.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
pg.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await pg.goto(APP);

const put = async (names) => {
  const list = names.map(([name, file]) => ({ name, b64: fs.readFileSync(path.join(FIX, file)).toString('base64') }));
  await pg.evaluate((list) => {
    const dt = new DataTransfer();
    for (const f of list) {
      const s = atob(f.b64), u = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
      dt.items.add(new File([u], f.name));
    }
    const el = document.getElementById('f1');
    el.files = dt.files;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, list);
};
const shut = (n) => pg.$eval('#c' + n, (e) => e.classList.contains('shut'));
const files = () => pg.$$eval('#fl .fi .nm', (ls) => ls.map((l) => l.innerText));
/* 접이식 칸 안이라 innerText 는 빈 문자열이 된다 — textContent 로 읽는다 */
const exams = () => pg.$$eval('#mx .nm', (ls) => ls.map((l) => l.textContent));
const pick = async (nth, want) => {
  await pg.click(`#sb .chip:nth-child(${nth})`);
  await pg.waitForFunction((w) => {
    const on = document.querySelector('#sb .chip.on');
    return on && on.textContent.replace(/\d+$/, '').trim() === w;
  }, want, { timeout: 10000 });
};

/* ── 과목 하나만 있을 때는 고를 것이 없다 ─────────────────────── */
await put([['2023 감면 기말.docx', 'real_2023.docx']]);
await pg.waitForFunction(() => document.querySelectorAll('#fl .fi').length === 1, null, { timeout: 60000 });
ck('과목이 하나면 고르는 줄이 없다', await pg.$eval('#sb', (e) => e.hidden), true);

/* ── 과목이 둘이면 칩이 나온다 ────────────────────────────────── */
await put([['2022 소화기 기말.docx', 'real2022sohwa.docx']]);
await pg.waitForFunction(() => document.querySelectorAll('#sb .chip').length > 0, null, { timeout: 60000 });
const cs = await pg.$$eval('#sb .chip', (ls) => ls.map((l) => l.textContent.replace(/\s+/g, ' ').trim()));
ck('전체 + 과목별 칩', cs.map((c) => c.replace(/\d+$/, '').trim()), ['전체', '감면', '소화기']);
ck('전체를 보고 있었으면 그대로 둔다',
  await pg.$eval('#sb .chip.on', (e) => e.textContent.replace(/\d+$/, '').trim()), '전체');
ck('둘 다 보인다', (await files()).length, 2);

/* ── 갈아타기 ─────────────────────────────────────────────────── */
await pick(2, '감면');
ck('감면으로 갈아탄다', await files(), ['2023 감면 기말.docx']);
ck('번호 입력칸도 따라간다', await exams(), ['2023 감면 기말']);
ck('Project 에 올릴 파일도 그 과목만',
  await pg.$$eval('#pf .fi .nm', (ls) => ls.map((l) => l.innerText)), ['2023 감면 기말.docx']);

/* 다른 과목을 보는 중에 올리면, 올린 파일이 안 보이지 않도록 그쪽으로 옮겨 간다 */
await put([['2021 소화기 기말.docx', 'real2022sohwa.docx']]);
await pg.waitForFunction(() => {
  const on = document.querySelector('#sb .chip.on');
  return on && on.textContent.replace(/\d+$/, '').trim() === '소화기';
}, null, { timeout: 60000 });
ck('올린 과목으로 옮겨 간다', (await files()).sort(),
  ['2021 소화기 기말.docx', '2022 소화기 기말.docx']);
ck('번호 입력칸도 그 과목만', (await exams()).sort(), ['2021 소화기 기말', '2022 소화기 기말']);

await pick(1, '전체');
ck('전체로 돌아온다', (await files()).length, 3);

/* ── 접기 ─────────────────────────────────────────────────────── */
ck('올린 직후에는 펼쳐져 있다', await shut(1), false);
await pg.click('#c1 .head');
ck('머리줄을 누르면 접힌다', await shut(1), true);
ck('접혀도 요약은 남는다', /파일 3개 · \d+문제/.test(await pg.$eval('#k1', (e) => e.innerText)), true);
ck('접히면 본문이 사라진다', await pg.$eval('#c1 .body', (e) => e.offsetParent === null), true);
await pg.click('#c2 .head');
ck('2단계도 접힌다', await shut(2), true);
await pg.click('#c1 .head');
ck('다시 누르면 펴진다', await shut(1), false);

/* ── 새로고침 ─────────────────────────────────────────────────── */
await pick(3, '소화기');
await pg.reload();
await pg.waitForFunction(() => document.querySelectorAll('#fl .fi').length === 2, null, { timeout: 30000 });
ck('고른 과목이 남는다', await pg.$eval('#sb .chip.on', (e) => e.textContent.replace(/\d+$/, '').trim()), '소화기');
ck('다시 들어오면 1단계는 접혀 있다', await shut(1), true);
ck('2단계도 접혀 있다', await shut(2), true);

/* ── 과목을 지우면 고르는 줄도 사라진다 ───────────────────────── */
await pg.click('#c1 .head');                                  // 편다
await pick(1, '전체');
for (const [n, left] of [['2022 소화기 기말.docx', 2], ['2021 소화기 기말.docx', 1]]) {
  await pg.click(`#fl .fi:has-text("${n}") .x`);
  await pg.waitForFunction((k) => document.querySelectorAll('#fl .fi').length === k, left, { timeout: 10000 });
}
ck('과목이 하나 남으면 칩이 사라지고 전체가 보인다', await files(), ['2023 감면 기말.docx']);
ck('고르는 줄도 사라진다', await pg.$eval('#sb', (e) => e.hidden), true);

ck('콘솔 오류', errs, []);
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
