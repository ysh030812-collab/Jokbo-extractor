/* Project 준비 흐름 — 색인 만들기 → 한도 확인 → 지시문 → 판정 붙여넣기 → PDF */
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IN = path.join(HERE, 'fixtures', 'e2e');
const APP = 'file://' + path.join(HERE, '..', 'web', 'index.html');
const MB = 1048576;

const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const pg = await (await b.newContext({ viewport: { width: 834, height: 1112 } })).newPage();
const errs = [];
pg.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
pg.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await pg.goto(APP);
await pg.evaluate(() => { const o = URL.createObjectURL; URL.createObjectURL = (x) => (window.__blob = x, o(x)); });

const txt = (s) => pg.$eval(s, (e) => e.innerText.trim());
const step = (n) => pg.$eval('#c' + n, (e) => e.className);
const put = async (sel, names) => {
  const files = names.map((n) => ({ name: n, b64: fs.readFileSync(path.join(IN, n)).toString('base64') }));
  await pg.evaluate(({ sel, files }) => {
    const dt = new DataTransfer();
    for (const f of files) {
      const s = atob(f.b64), u = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
      dt.items.add(new File([u], f.name));
    }
    const el = document.querySelector(sel);
    el.files = dt.files;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { sel, files });
};

/* ── 1. 족보 등록 : 시험지가 있는 연도 + 없는 연도(2020) 를 섞는다 ── */
const inputs = ['2020 감면 기말 풀이.pdf', '2023 감면 기말 풀이.pdf', '2023 감면 기말.docx', '2022 감면 기말.docx'];
console.log('■ 입력 :', inputs.map((n) => `${n} ${(fs.statSync(path.join(IN, n)).size / MB).toFixed(1)}MB`).join(' / '));
await put('#f1', inputs);
await pg.waitForFunction((n) => document.querySelectorAll('#fl .fi').length === n, inputs.length, { timeout: 300000 });
console.log('■ 등록 :', (await txt('#s1')).replace(/\n/g, ' | '));

/* ── 2. 파일 하나 삭제 → 나머지가 그대로 살아 있는가 ──────────── */
const before = await pg.evaluate(() => document.querySelector('#s1 .pill').innerText);
await pg.click('#fl .fi:has-text("2022 감면 기말.docx") .x');
await pg.waitForFunction(() => document.querySelectorAll('#fl .fi').length === 3);
console.log('\n■ 2022 삭제 :', before, '→', (await txt('#s1')).replace(/\n/g, ' | '));
for (const r of await pg.$$eval('#fl .fi', (ls) => ls.map((l) => l.innerText.replace(/\n/g, ' ')))) console.log('   ', r);

/* 되돌리기 — 다시 올리면 원상 복구되어야 한다 */
await put('#f1', ['2022 감면 기말.docx']);
await pg.waitForFunction(() => document.querySelectorAll('#fl .fi').length === 4);
console.log('■ 다시 등록 :', (await txt('#s1')).replace(/\n/g, ' | '));

/* 새로고침 후에도 남아 있는가 */
await pg.reload();
await pg.evaluate(() => { const o = URL.createObjectURL; URL.createObjectURL = (x) => (window.__blob = x, o(x)); });
await pg.waitForFunction(() => document.querySelectorAll('#fl .fi').length === 4);
console.log('■ 새로고침 후 :', (await txt('#s1')).replace(/\n/g, ' | '), '| 카드1', await pg.$eval('#c1', (e) => e.className));

/* ── 3. Project 준비 ─────────────────────────────────────────── */
console.log('\n■ 준비 전 :', (await txt('#s2')).replace(/\n/g, ' | '));
for (const r of await pg.$$eval('#pf .fi', (ls) => ls.map((l) => l.innerText.replace(/\n/g, ' ')))) console.log('   ', r);
console.log('   쪼개기 버튼 보임 :', !(await pg.$eval('#mkidx', (e) => e.hidden)));

const t0 = Date.now();
await pg.click('#mkidx');
await pg.waitForFunction(() => document.getElementById('mkidx').textContent === '다시 만들기'
  || document.getElementById('e2').innerText.length > 0, null, { timeout: 600000 });
console.log(`\n■ 색인 생성 ${((Date.now() - t0) / 1000).toFixed(0)}초 | 오류 ${JSON.stringify(await txt('#e2'))}`);
console.log('■ 준비 후 :', (await txt('#s2')).replace(/\n/g, ' | '));
const made = await pg.evaluate(() => []);
for (const r of await pg.$$eval('#pf .fi', (ls) => ls.map((l) => l.innerText.replace(/\n/g, ' ')))) console.log('   ', r);

/* 한도 검사 : 요청 32MB · 100쪽 */
const limits = await pg.evaluate(() => window.__made || null);
console.log('\n■ 한도 검사');
const rows = await pg.$$eval('#pf .fi .ct', (ls) => ls.map((l) => l.innerText));
let bad = 0;
for (const r of rows) {
  const m = r.match(/^(\d+)쪽 .*?([\d.]+)MB/);
  if (!m) continue;
  const pages = +m[1], mb = +m[2];
  const ok = pages <= 100 && mb <= 32;
  if (!ok) bad++;
  console.log(`   ${ok ? '✅' : '❌'} ${pages}쪽 (한도 100) · ${mb}MB (한도 32)`);
}

/* 색인 파일을 실제로 내려받는 경로는 test_download.mjs 가 따로 검사한다.
   (헤드리스에서 다운로드를 가로채면 실행 문맥이 날아가 매달린다) */

/* 지시문 */
const ins = await pg.evaluate(() => {
  let got = null;
  navigator.clipboard.writeText = async (t) => { got = t; };
  document.getElementById('cpins').click();
  return new Promise((r) => setTimeout(() => r(got), 200));
});
console.log('\n■ 지시문 :', ins ? `${ins.length}자` : '(복사 실패)');
if (ins) console.log(ins.split('\n').filter((l) => l.startsWith('- ')).map((l) => '   ' + l.slice(0, 110)).join('\n'));

/* ── 4. 판정 붙여넣기 : 실제 문제 은행의 그림 문제 id 를 그대로 쓴다 ── */
const bank = await pg.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('jokbo', 2);
  r.onsuccess = () => {
    const g = r.result.transaction('meta').objectStore('meta').get('raw');
    g.onsuccess = () => res(Object.values(g.result).flatMap((f) => f.items)
      .map((q) => ({ id: q.id, qnum: q.qnum, page: q.page, src: q.source, qp: (q.qp || []).length })));
  };
}));
console.log('\n■ 문제 은행 :', bank.length, '개');

await put('#f2', ['73. Antiviral agents (김채균).pdf']);
/* 시험지가 없는 2020 은 Claude 가 쪽 범위로 답한다 — 코드가 문제 경계를 추측하지 않는다 */
const answer = JSON.stringify([
  { id: '2020-기말-감면-p14~16', no: '5', verdict: 'solvable', pages: '3', why: '그림으로만 된 문제 — Project가 슬라이드를 보고 번호까지 읽었다' },
  { id: '2020-기말-감면-p29', verdict: 'solvable', pages: '4', why: '번호를 못 읽은 경우 (no 없음)' },
  { id: '2020-기말-감면-p20~22', no: '7번', verdict: 'partial', pages: '', why: '번호 뒤에 번을 붙여 보내도 된다' },
  { id: '2023-기말-감면-87', verdict: 'solvable', pages: '5', why: '시험지 DOCX 쪽' },
  { id: '2022-기말-감면-144', verdict: 'solvable', pages: '6', why: '시험지 DOCX 쪽' },
  { id: '9999-기말-감면-1', verdict: 'solvable', pages: '', why: '없는 연도' },
  { id: '2020-기말-감면-p9999', verdict: 'solvable', pages: '', why: '없는 쪽' },
]);
await pg.fill('#ta', '판정 결과입니다.\n\n```json\n' + answer + '\n```');
await pg.click('#rd');
await pg.waitForSelector('#qs .q');
console.log('\n■ 목록 :', await txt('#s4'), '| 안내 :', JSON.stringify(await txt('#e3')));
for (const r of await pg.$$eval('#qs .q', (ls) => ls.map((l) => l.innerText.replace(/\n/g, ' · ')))) console.log('   ', r);

await pg.click('#mk');
await pg.waitForFunction(() => !document.getElementById('op').hidden, null, { timeout: 300000 });
/* 만들기와 받기가 나뉘어 있다 — 받기 버튼을 실제로 눌러 파일이 나오는지 본다 */
console.log('\n■ 받기 버튼 :', (await pg.$eval('#op', (e) => e.textContent)).trim(), '| 안내 :',
  await pg.$eval('#dlhint4', (e) => (e.hidden ? '(숨김 — 애플 기기 아님)' : e.innerText.trim())));
await pg.waitForFunction(() => window.__blob, null, { timeout: 60000 });
const info = await pg.evaluate(async () => {
  const ab = await window.__blob.arrayBuffer();
  const d = await PDFLib.PDFDocument.load(ab);
  let s = ''; const u = new Uint8Array(ab);
  for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192));
  return { pages: d.getPageCount(), size: u.length, b64: btoa(s) };
});
fs.writeFileSync(path.join(HERE, 'e2e_project_out.pdf'), Buffer.from(info.b64, 'base64'));
console.log('\n■ 결과 PDF :', info.pages, '쪽 ·', (info.size / MB).toFixed(2), 'MB → tests/e2e_project_out.pdf');
console.log('■ 콘솔 오류 :', errs.length ? errs : '없음', '| 한도 위반', bad, '건');
await b.close();
process.exit(bad ? 1 : 0);
