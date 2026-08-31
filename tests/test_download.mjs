/* 내려받기 경로 — 아이패드는 공유 시트로 한 번에, 그 외는 링크로 */
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IN = path.join(HERE, 'fixtures', 'e2e');
const APP = 'file://' + path.join(HERE, '..', 'web', 'index.html');
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

let pass = 0, fail = 0;
const ck = (n, g, w) => {
  const ok = JSON.stringify(g) === JSON.stringify(w);
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}` + (ok ? '' : `\n   got =${JSON.stringify(g)}\n   want=${JSON.stringify(w)}`));
  ok ? pass++ : fail++;
};

const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});

async function run({ apple }) {
  const ctx = await b.newContext(apple ? { userAgent: IPAD, hasTouch: true, viewport: { width: 834, height: 1112 } } : {});
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto(APP);

  /* 공유 시트와 <a download> 를 둘 다 가로채 무엇이 불렸는지 기록한다 */
  await pg.evaluate(() => {
    window.__shared = null; window.__links = [];
    navigator.canShare = (d) => !!(d && d.files && d.files.length);
    navigator.share = async (d) => {
      window.__shared = {
        names: d.files.map((f) => f.name), sizes: d.files.map((f) => f.size),
        keys: Object.keys(d).sort(),          // files 말고 다른 것을 같이 넘겼는가
        types: [...new Set(d.files.map((f) => f.type))],
        active: !!(navigator.userActivation && navigator.userActivation.isActive),
      };
    };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.download) window.__links.push(this.download); else click.call(this); };
  });

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

  await put('#f1', ['2020 감면 기말 풀이.pdf']);
  await pg.waitForFunction(() => document.querySelectorAll('#fl .fi').length === 1, null, { timeout: 300000 });
  await pg.click('#mkidx');
  await pg.waitForFunction(() => document.getElementById('mkidx').textContent === '다시 만들기', null, { timeout: 600000 });

  const tag = apple ? '아이패드' : '데스크톱';
  ck(`${tag} — 한 번에 받기 버튼 보임`, !(await pg.$eval('#dlall', (e) => e.hidden)), true);
  console.log(`   버튼 문구 : ${await pg.$eval('#dlall', (e) => e.textContent)}`);
  ck(`${tag} — 안내문 표시`, !(await pg.$eval('#dlhint', (e) => e.hidden)), apple);

  const made = await pg.$$eval('#pf .fi .x', (ls) => ls.length);
  console.log(`   만들어진 조각 : ${made}개`);
  await pg.click('#dlall');                       // 실제 탭 → 사용자 제스처 유지
  await pg.waitForTimeout(2000);
  const shared = await pg.evaluate(() => window.__shared);
  const links = await pg.evaluate(() => window.__links);

  if (apple) {
    ck('아이패드 — 공유 시트로 넘김', !!shared, true);
    ck('아이패드 — 파일 전부 한 번에', shared && shared.names.length, made);
    ck('아이패드 — 사용자 제스처 유효', shared && shared.active, true);
    ck('아이패드 — 링크 방식은 안 씀', links.length, 0);
    /* title 이나 text 를 같이 넘기면 '파일에 저장' 때 .txt 가 하나 더 생긴다 */
    ck('아이패드 — files 만 넘긴다 (txt 가 딸려오지 않게)', shared && shared.keys, ['files']);
    ck('아이패드 — 전부 PDF 로 넘어간다', shared && shared.types, ['application/pdf']);
    console.log('   넘긴 파일 :', shared.names.map((n, i) => `${n} ${(shared.sizes[i] / 1048576).toFixed(1)}MB`).join(' / '));
    console.log('   합계 :', (shared.sizes.reduce((a, b) => a + b, 0) / 1048576).toFixed(1), 'MB');
  } else {
    ck('데스크톱 — 공유 시트 안 씀', shared, null);
    ck('데스크톱 — 파일 전부 내려받음', links.length, made);
    console.log('   내려받은 파일 :', links.join(' / '));
  }
  ck(`${tag} — 콘솔 오류 없음`, errs, []);
  await ctx.close();
}

await run({ apple: true });
console.log('');
await run({ apple: false });
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
