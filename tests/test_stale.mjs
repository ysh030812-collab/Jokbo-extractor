/* 파서를 고친 뒤 이미 등록해 둔 파일.
   PARSER_VER 을 안 올리면 앱은 예전 결과를 그대로 쓰고 알려 주지도 않는다.
   실제로 "43-45." 수정을 하고도 사용자 화면에서는 그대로 안 잡혔다.
   여기서는 옛 판으로 저장된 상태를 만들어 두고, 안내가 뜨는지·원본으로 다시
   읽어 고쳐지는지·시험지 DOCX 는 다시 올리라고 하는지를 본다. */
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

/* 묶음 번호가 든 시험지 PDF 를 브라우저에서 만든다 (한글이 필요 없는 배치) */
const EXAM = await pg.evaluate(async () => {
  const doc = await PDFLib.PDFDocument.create();
  const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  let y = 733;
  const line = (t) => { page.drawText(t, { x: 85, y, size: 10, font }); y -= 16; };
  line('1. Which one is right?'); line('1) a'); line('2) b'); y -= 16;
  line('2-4. Write the three types and describe each.'); y -= 16;
  line('5. The last one. Which is right?'); line('1) a'); line('2) b');
  const u = await doc.save();
  let s = '';
  for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192));
  return btoa(s);
});

const put = async (list) => pg.evaluate((list) => {
  const dt = new DataTransfer();
  for (const f of list) {
    const s = atob(f.b64), u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    dt.items.add(new File([u], f.name));
  }
  const el = document.getElementById('f1');
  el.files = dt.files; el.dispatchEvent(new Event('change', { bubbles: true }));
}, list);

await put([
  { name: '2023 확인 기말.pdf', b64: EXAM },
  { name: '2023 확인 기말.docx', b64: fs.readFileSync(path.join(FIX, 'range.docx')).toString('base64') },
]);
await pg.waitForFunction(() => document.querySelectorAll('#fl .fi').length === 2, null, { timeout: 60000 });

/* 파일별 문제 수 — 이름으로 읽는다 (목록 차례에 기대지 않는다) */
const counts = () => pg.$$eval('#fl .fi', (ls) => Object.fromEntries(
  ls.map((l) => [l.querySelector('.nm').textContent, l.querySelector('.ct').textContent])));
const PDF = '2023 확인 기말.pdf', DOCX = '2023 확인 기말.docx';
const FULL = await counts();
console.log('■ 처음 :', FULL);
ck('시험지 PDF 의 묶음 번호(2-4)를 읽는다', FULL[PDF], '3문제');
ck('시험지 DOCX 의 묶음 번호를 읽는다', FULL[DOCX], '5문제');
ck('처음에는 안내가 없다', await pg.$eval('#old', (e) => e.hidden), true);

/* ── 옛 판으로 저장된 상태를 만든다 (파서를 고치기 전에 등록해 둔 셈) ── */
await pg.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('jokbo', 2);
  r.onsuccess = () => {
    const st = r.result.transaction('meta', 'readwrite').objectStore('meta');
    const g = st.get('raw');
    g.onsuccess = () => {
      const raw = g.result;
      for (const n of Object.keys(raw)) {
        raw[n].v = 1;
        /* 예전 파서가 묶음 번호를 통째로 놓쳤던 상태를 흉내 낸다 */
        raw[n].items = raw[n].items.filter((q) => q.qnum !== 2 && q.qnum !== 37 && q.qnum !== 43);
        raw[n].n = raw[n].items.length;
      }
      st.put(raw, 'raw').onsuccess = () => res();
    };
  };
}));
await pg.reload();
await pg.waitForFunction(() => document.querySelectorAll('#fl .fi').length === 2, null, { timeout: 30000 });

ck('낡은 결과를 알려 준다', await pg.$eval('#old', (e) => e.hidden), false);
ck('안내가 접혀 숨지 않는다', await pg.$eval('#c1', (e) => e.classList.contains('shut')), false);
ck('원본이 있는 파일은 다시 읽기 단추를 준다', await pg.$eval('#redo', (e) => e.hidden), false);
const msg = await pg.$eval('#oldn', (e) => e.textContent);
ck('PDF 는 여기서 다시 읽는다고 알린다', /파일 1개는 원본을 그대로 갖고 있어/.test(msg), true);
ck('DOCX 는 다시 올리라고 알린다', /시험지 DOCX 1개는 원본이 없어/.test(msg), true);
const BROKEN = await counts();
console.log('■ 낡은 결과 :', BROKEN);
ck('낡은 상태에서는 묶음 문제가 빠져 있다',
  [BROKEN[PDF] !== FULL[PDF], BROKEN[DOCX] !== FULL[DOCX]], [true, true]);

/* ── 여기서 다시 읽기 ── */
await pg.click('#redo');
await pg.waitForFunction(() => document.getElementById('redo').hidden, null, { timeout: 60000 });
const AFTER = await counts();
console.log('■ 다시 읽은 뒤 :', AFTER);
ck('원본으로 다시 읽어 PDF 의 묶음 문제가 살아난다', AFTER[PDF], FULL[PDF]);
ck('원본이 없는 DOCX 는 그대로다', AFTER[DOCX], BROKEN[DOCX]);
ck('다시 읽은 뒤에도 DOCX 안내는 남는다', await pg.$eval('#old', (e) => e.hidden), false);
ck('다시 읽을 것이 없으면 단추는 사라진다', await pg.$eval('#redo', (e) => e.hidden), true);

/* 같은 DOCX 를 다시 올리면 안내가 사라진다 */
await put([{ name: '2023 확인 기말.docx', b64: fs.readFileSync(path.join(FIX, 'range.docx')).toString('base64') }]);
await pg.waitForFunction(() => document.getElementById('old').hidden, null, { timeout: 60000 });
ck('다시 올리면 안내가 사라지고 원래대로 돌아온다', await counts(), FULL);

ck('콘솔 오류', errs, []);
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
