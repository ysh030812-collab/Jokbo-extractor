/* 풀이 PDF 블록 스캔 — 2020 감면 기말 실물에서 나온 구조로 회귀 검증.
   문항 내용이 아니라 슬라이드 배치(문제/해설/출처, 주관식 번호 리셋)만 재현한다. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'src');
const src = fs.readFileSync(path.join(SRC, 'app_js.js'), 'utf8');
const cut = (a, b) => src.slice(src.indexOf(a), src.indexOf(b));
const M = {};
new Function('exports', cut('const RE_MARK', '/* iOS·macOS')
  + '\nObject.assign(exports,{blocksOf,scanStarts,isSource,qkey,qlabel});')(M);

let pass = 0, fail = 0;
const ck = (n, g, w) => {
  const ok = JSON.stringify(g) === JSON.stringify(w);
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}` + (ok ? '' : `\n   got =${JSON.stringify(g)}\n   want=${JSON.stringify(w)}`));
  ok ? pass++ : fail++;
};

const T = [];
const push = (...xs) => xs.forEach((x) => T.push(x));
push('2020 감면 기말 풀이\n인하대학교');
// 268 : 글자 있는 문제. 269~274 : 문제 화면이 통째로 그림
push('박윤규교수님\n268.  유구조충(Taenia solium)의생활사에서관찰할수없는구조물은?\n1) rostellum과hooklets\n(1/3)',
     '답: 2번\n해설\n(2/3)', '(3/3)\n박윤규교수님');
for (let k = 269; k <= 274; k++) push('박윤규교수님\n(1/3)', '답: 3번\n(2/3)', '(3/3)\n박윤규교수님');
for (let k = 275; k <= 298; k++) push(`${k}. 문제 지문입니다 무엇인가?\n①가\n②나\n③다`, '답: 1번\n(2/3)', '(3/3)\n박윤규교수님');
// 출처 슬라이드 (문제가 아니다)
push('신진욱교수님63. 오소믹소4p');
// 주관식 — 번호가 31부터 다시 시작한다
push('신진욱교수님\n주관식31. 코로나corona 바이러스\n(1/3)', '답: 코로나\n(2/3)', '(3/3)');
push('신진욱교수님\n주관식32. 레오reo 바이러스\n(1/3)', '답: 레오\n(2/3)', '(3/3)');
// 이 아래부터는 '주관식' 접두어 없이 번호만 이어진다
push('37. 레트로바이러스복제에필수적인바이러스유전자4개를유전자배열순서대로\n쓰세요.\n신진욱교수님',
     '신진욱교수님레트로바이러스강의록2page');
push('38. HIV에최초감염후치료제를투여받지않은경우무증상기간이2~15년\n이상지속된다.',
     '신진욱교수님레트로바이러스강의록8page');
push('42. 아래항체검사법을이용한B형간염바이러스진단표를완성하세요.\n신진욱교수님',
     '신진욱교수님간염바이러스강의록6page');

const blks = M.blocksOf(T);
const keys = blks.map((b) => M.qkey(b));

console.log('잡힌 문제 :', keys.join(', '), '\n');
ck('출처 슬라이드는 문제가 아니다', [
  M.isSource('신진욱교수님레트로바이러스강의록2page'),
  M.isSource('신진욱교수님63. 오소믹소4p'),
  M.isSource('268. 유구조충의 생활사에서 관찰할 수 없는 구조물은?'),
], [true, true, false]);

ck('객관식 번호를 다 읽는다',
  blks.filter((b) => b.qnum != null && !b.sec).map((b) => b.qnum),
  [268, ...Array.from({ length: 24 }, (_, i) => 275 + i)]);

ck('주관식은 번호가 되돌아가도 잡힌다',
  blks.filter((b) => b.sec === '주').map((b) => b.qnum), [31, 32, 37, 38, 42]);
ck('주관식 id 는 객관식과 겹치지 않는다', M.qkey(blks.find((b) => b.sec === '주' && b.qnum === 37)), '주37');
ck('주관식 이름', M.qlabel(blks.find((b) => b.sec === '주' && b.qnum === 37)), '주관식 37번');
ck('주관식은 객관식 뒤로 정렬된다',
  blks.find((b) => b.sec === '주').ord > Math.max(...blks.filter((b) => !b.sec && b.qnum != null).map((b) => b.ord)), true);

ck('그림뿐인 문제 6개를 쪽 번호로 잡는다', keys.filter((k) => k.startsWith('p')).length, 6);

/* 실제로 터졌던 것: 번호가 되돌아가는 바람에 마지막 블록이 파일 끝까지 뻗었다.
   Project 파일은 이제 통째로 쪼개 넣지만, 시험지가 있는 연도는 이 블록으로
   문제 번호 → 슬라이드를 찾으므로 그대로 지켜야 한다. */
const most = Math.max(...blks.map((b) => Math.min(b.qp.length, 2)));
ck('문제당 문제 화면이 2장을 넘지 않는다', most <= 2, true);
/* 증상: 마지막 블록이 파일 끝까지 뻗으면서 '문제 화면'으로 볼 쪽이 열몇 장이 됐다 */
const worst = blks.map((b) => [M.qkey(b), b.qp.length]).sort((a, b) => b[1] - a[1])[0];
console.log('   문제 화면이 가장 많은 블록 :', worst.join(' → '), '쪽');
ck('한 문제가 문제 화면을 여러 장 삼키지 않는다', worst[1] <= 2, true);

/* 번호를 묶어 낸 문제 — "43-45. 알코올성 간질환의 …", "37,38. 위에서 …".
   못 읽으면 그 문제가 통째로 사라지고 앞 문제 블록에 딸려 들어간다. */
const R = ['2023 소화기 기말 풀이\n인하대'];
const one = (h) => R.push('김준미 교수님 (1/3)\n' + h, '답: 1번\n(2/3)', '(3/3)\n출처');
one('36. 다음 중 옳은 것은?\n1) 가');
one('37,38. 위에서 점막하 종양이 보인다. 진단은?\n1) 가');
one('39. 그 다음 문제는?\n1) 가');
one('43-45. 알코올성 간질환의 3가지 질환 스펙트럼을 쓰고 각각의\n특징을 간략히 기술하시오.');
one('46. 마지막 문제는?\n1) 가');
const rb = M.blocksOf(R);
ck('묶음 번호도 저마다 한 블록', rb.map((b) => M.qkey(b)), ['36', '37', '39', '43', '46']);
ck('묶음 끝 번호', rb.map((b) => b.qto), [0, 38, 0, 45, 0]);
ck('묶음 이름표', rb.map((b) => M.qlabel(b)), ['36번', '37~38번', '39번', '43~45번', '46번']);
ck('묶음 뒤 번호가 되돌아가지 않는다', rb.map((b) => b.ord), [36, 38, 39, 45, 46]);
ck('묶음 문제가 뒤 블록을 삼키지 않는다', rb.map((b) => b.e - b.s), [3, 3, 3, 3, 3]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
