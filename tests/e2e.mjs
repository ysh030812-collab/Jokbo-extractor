/* 실제 브라우저에서 전 과정을 돌린다 — 등록 → 파일 삭제 → 강의안 → 판정 → PDF */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IN = path.join(HERE, 'fixtures', 'e2e');
const APP = 'file://' + path.join(HERE, '..', 'web', 'index.html');
const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const pg = await (await b.newContext({ viewport: { width: 834, height: 1112 } })).newPage();  // iPad 세로
const errs = [];
pg.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
pg.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await pg.goto(APP);
await pg.evaluate(() => { const o = URL.createObjectURL; URL.createObjectURL = (x) => (window.__blob = x, o(x)); });

/* 이 환경의 playwright/chromium 조합에서 setInputFiles 가 먹지 않는다.
   DataTransfer 로 직접 넣고 change 를 쏘면 실제 선택과 똑같다. */
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

const step = (n) => pg.$eval('#c' + n, (e) => e.className);
const txt = (s) => pg.$eval(s, (e) => e.innerText.trim());

/* ── 1. 족보 등록 ─────────────────────────────────────────────── */
await put('#f1', ['2023 감면 기말 풀이.pdf', '2023 감면 기말.docx', '2022 감면 기말.docx']);
await pg.waitForFunction(() => document.querySelectorAll('#fl .fi').length === 3, null, { timeout: 60000 });
console.log('■ 등록 후 통계 :', (await txt('#s1')).replace(/\n/g, ' | '));
console.log('■ 파일 목록');
for (const r of await pg.$$eval('#fl .fi', (ls) => ls.map((l) => l.innerText.replace(/\n/g, ' ')))) console.log('   ', r);
console.log('■ 오류줄 :', JSON.stringify(await txt('#e1')));

/* ── 2. 파일 하나 삭제 → 나머지가 그대로 살아 있는가 ──────────── */
const before = await pg.evaluate(() => document.querySelector('#s1 .pill').innerText);
await pg.click('#fl .fi:has-text("2022") .x');
await pg.waitForFunction(() => document.querySelectorAll('#fl .fi').length === 2);
console.log('\n■ 2022 삭제 :', before, '→', (await txt('#s1')).replace(/\n/g, ' | '));
for (const r of await pg.$$eval('#fl .fi', (ls) => ls.map((l) => l.innerText.replace(/\n/g, ' ')))) console.log('   ', r);

/* 되돌리기 — 다시 올리면 원상 복구되어야 한다 */
await put('#f1', ['2022 감면 기말.docx']);
await pg.waitForFunction(() => document.querySelectorAll('#fl .fi').length === 3);
console.log('■ 다시 등록 :', (await txt('#s1')).replace(/\n/g, ' | '));

/* 새로고침 후에도 남아 있는가 */
await pg.reload();
await pg.evaluate(() => { const o = URL.createObjectURL; URL.createObjectURL = (x) => (window.__blob = x, o(x)); });
await pg.waitForFunction(() => document.querySelectorAll('#fl .fi').length === 3);
console.log('■ 새로고침 후 :', (await txt('#s1')).replace(/\n/g, ' | '), '| 카드1', await step(1));

/* ── 3. 강의안 ────────────────────────────────────────────────── */
await put('#f2', ['73. Antiviral agents (김채균).pdf']);
await pg.waitForFunction(() => /후보/.test(document.getElementById('s2').innerText), null, { timeout: 60000 });
console.log('\n■ 강의안 :', (await txt('#s2')).replace(/\n/g, ' | '), '| 카드3', await step(3));

/* ── 4. Claude 답변 붙여넣기 (실제 형식 그대로) ───────────────── */
const answer = JSON.stringify([
  { id: '2023-기말-감면-6', verdict: 'solvable', pages: '3-4', why: '역전사효소 억제제 목록과 Ibalizumab 이 강의안에 그대로 있음' },
  { id: '2023-기말-감면-7', verdict: 'solvable', pages: '6', why: 'Zanamivir 흡입제 기관지 수축 주의가 강의안에 있음' },
  { id: '2023-기말-감면-8', verdict: 'solvable', pages: '5', why: 'Acyclovir 작용기전 슬라이드' },
  { id: '2022-기말-감면-144', verdict: 'solvable', pages: '3', why: 'HIV 진단·치료 개괄' },
  { id: '2022-기말-감면-1', verdict: 'partial', pages: '', why: '광견병은 강의안 범위 밖' },
  { id: '2023-기말-감면-87', verdict: 'partial', pages: '', why: '종양 바이러스는 일부만 언급' },
]);
await pg.fill('#ta', '판정 결과입니다.\n\n```json\n' + answer + '\n```');
await pg.click('#rd');
await pg.waitForSelector('#qs .q');
console.log('\n■ 목록 :', await txt('#s4'));
for (const r of await pg.$$eval('#qs .q', (ls) => ls.map((l) => l.innerText.replace(/\n/g, ' · ')))) console.log('   ', r);
console.log('■ 오류줄 :', JSON.stringify(await txt('#e3')));

/* 전부 체크해서 시험지·풀이가 섞인 PDF 를 만든다 */
await pg.$$eval('#qs .q input', (cs) => cs.forEach((c) => { if (!c.checked) c.click(); }));
console.log('■ 전부 체크 :', await txt('#s4'));

/* ── 5. PDF ───────────────────────────────────────────────────── */
await pg.click('#mk');
await pg.waitForFunction(() => window.__blob, null, { timeout: 120000 });
const info = await pg.evaluate(async () => {
  const ab = await window.__blob.arrayBuffer();
  const d = await PDFLib.PDFDocument.load(ab);
  let s = ''; const u = new Uint8Array(ab);
  for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192));
  return { pages: d.getPageCount(), size: u.length, b64: btoa(s) };
});
fs.writeFileSync(path.join(HERE, 'e2e_out.pdf'), Buffer.from(info.b64, 'base64'));
console.log('\n■ PDF :', info.pages, '페이지 ·', (info.size / 1048576).toFixed(2), 'MB → tests/e2e_out.pdf');
console.log('■ 결과줄 :', await txt('#dl4'), '| 경고 :', JSON.stringify(await txt('#e4')));

/* ── 6. 화면 폭 확인 (기기에 꽉 차는가) ───────────────────────── */
for (const [w, h, n] of [[390, 844, 'iPhone'], [834, 1112, 'iPad 세로'], [1194, 834, 'iPad 가로']]) {
  await pg.setViewportSize({ width: w, height: h });
  const m = await pg.evaluate(() => {
    const wrp = document.querySelector('.wrap').getBoundingClientRect();
    return { wrap: Math.round(wrp.width), doc: document.documentElement.scrollWidth,
             cols: getComputedStyle(document.getElementById('qs')).gridTemplateColumns };
  });
  console.log(`■ ${n} ${w}px → .wrap ${m.wrap}px, 가로스크롤 ${m.doc > w ? '있음(문제!)' : '없음'}, 문제목록 ${m.cols}`);
}
await pg.setViewportSize({ width: 834, height: 1112 });
await pg.screenshot({ path: path.join(HERE, 'e2e_top.png'), clip: { x: 0, y: 0, width: 834, height: 1000 } });

console.log('\n■ 콘솔 오류 :', errs.length ? errs : '없음');
await b.close();
