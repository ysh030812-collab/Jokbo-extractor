/* Claude 없이 번호만 적어 목록을 만드는 길 */
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IN = path.join(HERE, 'fixtures', 'e2e');
const APP = 'file://' + path.join(HERE, '..', 'web', 'index.html');

let pass = 0, fail = 0;
const ck = (n, g, w) => {
  const ok = JSON.stringify(g) === JSON.stringify(w);
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}` + (ok ? '' : `\n   got =${JSON.stringify(g)}\n   want=${JSON.stringify(w)}`));
  ok ? pass++ : fail++;
};

const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const pg = await (await b.newContext({ viewport: { width: 834, height: 1112 } })).newPage();
const errs = [];
pg.on('pageerror', (e) => errs.push(e.message));
pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await pg.goto(APP);
await pg.evaluate(() => { const o = URL.createObjectURL; URL.createObjectURL = (x) => (window.__blob = x, o(x)); });

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
    el.files = dt.files; el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { sel, files });
};

/* 풀이 PDF 하나 + 시험지 두 개 (학기 없는 시험 포함) */
await put('#f1', ['2020 감면 기말 풀이.pdf', '2023 감면 기말.docx', '2024 호흡기계.docx']);
await pg.waitForFunction(() => document.querySelectorAll('#fl .fi').length === 3, null, { timeout: 300000 });

const rows = await pg.$$eval('#mx .fi', (ls) => ls.map((l) => l.querySelector('.nm').textContent));
console.log('■ 직접 입력 칸 :', rows.join(' / '));
ck('시험마다 칸이 하나씩 생긴다', rows, ['2024 호흡기계', '2023 감면 기말', '2020 감면 기말']);
ck('Claude 단계를 거치지 않아도 칸이 보인다', !(await pg.$eval('#man', (e) => e.hidden)), true);

/* 접혀 있는 칸을 펼친다 (실제로도 눌러서 연다) */
ck('처음에는 접혀 있다', await pg.$eval('#man', (e) => e.open), false);
await pg.click('#man summary');
ck('누르면 펼쳐진다', await pg.$eval('#man', (e) => e.open), true);

/* 번호를 적는다 — 낱개·범위·쪽·잘못된 표기·없는 번호를 섞는다 */
await pg.$$eval('#mx .mnum', (els) => {
  const v = { '2024 호흡기계': '106, 143', '2023 감면 기말': '87', '2020 감면 기말': '6-8, p14~16, 399, 어쩌구' };
  els.forEach((el) => { el.value = v[el.closest('.fi').querySelector('.nm').textContent] || ''; });
});
await pg.click('#mgo');
await pg.waitForSelector('#qs .q');

const list = await pg.$$eval('#qs .q', (ls) => ls.map((l) => l.innerText.replace(/\n/g, ' · ')));
console.log('■ 만들어진 목록');
list.forEach((r) => console.log('   ', r));
console.log('■ 안내 :', JSON.stringify(await pg.$eval('#e5', (e) => e.innerText)));

ck('낱개·범위·쪽이 모두 들어간다', list.length, 7);
ck('전부 체크되어 있다', await pg.$$eval('#qs .q input', (cs) => cs.filter((c) => c.checked).length), 7);
ck('직접 고름 표시', list.every((r) => r.includes('직접 고름')), true);
ck('학기 없는 시험도 잡힌다', list.some((r) => r.startsWith('2024 호흡기계 106번')), true);
ck('쪽으로 적은 것도 잡힌다', list.some((r) => r.includes('14~16쪽')), true);
ck('연도 최신순 정렬', [list[0].slice(0, 4), list[list.length - 1].slice(0, 4)], ['2024', '2020']);
const note = await pg.$eval('#e5', (e) => e.innerText);
ck('알아보지 못한 표기를 알려 준다', /알아보지 못한 표기 1개 — 어쩌구/.test(note), true);
ck('족보에 없는 번호를 알려 준다', /족보에 없는 번호 1개 — 399/.test(note), true);

/* 그대로 PDF 까지 */
await pg.click('#mk');
await pg.waitForFunction(() => !document.getElementById('op').hidden, null, { timeout: 300000 });
const info = await pg.evaluate(async () => {
  const ab = await window.__blob.arrayBuffer();
  const d = await PDFLib.PDFDocument.load(ab);
  return { pages: d.getPageCount(), size: ab.byteLength };
});
console.log('■ 결과 PDF :', info.pages, '쪽 ·', (info.size / 1048576).toFixed(2), 'MB');
ck('PDF 가 만들어진다', info.pages > 7, true);

/* ── 번호를 묶어 낸 문제 (43-45) — 가운데 번호로 불러도 찾아야 한다 ── */
await pg.evaluate(({ b64 }) => {
  const s = atob(b64), u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  const dt = new DataTransfer();
  dt.items.add(new File([u], '2024 묶음 기말.docx'));
  const el = document.getElementById('f1');
  el.files = dt.files; el.dispatchEvent(new Event('change', { bubbles: true }));
}, { b64: fs.readFileSync(path.join(HERE, 'fixtures', 'range.docx')).toString('base64') });
await pg.waitForFunction(() => [...document.querySelectorAll('#fl .fi .nm')]
  .some((l) => l.textContent.includes('묶음')), null, { timeout: 60000 });

const pickNums = async (v) => {
  await pg.$$eval('#mx .mnum', (els, o) => els.forEach((e) => {
    e.value = e.previousElementSibling.textContent.includes('묶음') ? o : '';
  }), v);
  await pg.click('#mgo');
  await pg.waitForTimeout(120);
  return pg.$$eval('#qs .q .who', (ls) => ls.map((l) => l.textContent.replace(/^.*기말 /, '')));
};
ck('가운데 번호로 불러도 묶음 문제가 나온다', await pickNums('44'), ['43~45번']);
ck('묶음의 번호를 다 적어도 한 번만 들어간다', await pickNums('43, 44, 45'), ['43~45번']);
ck('범위로 적어도 같다', await pickNums('43-45'), ['43~45번']);
ck('쉼표로 묶인 문제도 마찬가지', await pickNums('38'), ['37~38번']);
ck('보통 문제와 섞어도 된다', await pickNums('36, 45'), ['36번', '43~45번']);

ck('콘솔 오류 없음', errs, []);

await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
