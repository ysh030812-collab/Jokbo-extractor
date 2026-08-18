import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'src');
const src = fs.readFileSync(path.join(SRC, 'app_js.js'), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b); if (i<0||j<0) throw Error('cut fail '+a); return src.slice(i, j); };
const code = cut('const RE_MARK', '/* ── 상태')
           + cut('function grabJSON', '\n$("rd")');
const M = {};
new Function('exports', code + '\nObject.assign(exports,{scanStarts,blocksOf,parseName,grabJSON});')(M);

// 실제 2023 풀이 텍스트 (드라이브에서 읽은 구조 그대로)
const P2023 = [
 "김진주교수님 > 신민혜교수님\n1. 세균배양용 검체 보관시 냉장보관하지 않고 실온에 보관하여\n야 하는 검체는 무엇인가?\n1) 농양\n2) 뇌척수액\n3) 소변\n(1/3)",
 "정답: 2번\n중추신경계 배양 후 검사 지연 후 실온 보관\n(2/3)\n신민혜교수님 진단검사의학 26p.",
 "(3/3)\n김진주교수님 > 신민혜교수님",
 "김진주교수님 > 신민혜교수님\n2. 임상미생물검사에 대한 기술 중 맞지 않는 것은?\n1) 세균의 항균제감수성 시험방법에는 희석법과 디스크 확산법이\n(1/3)",
 "정답: 1번\n(2/3)\n신민혜교수님 감염의 진단 45p.",
 "(3/3)\n김진주교수님 > 신민혜교수님",
 "김채균 교수님\n(1/3)\n4. 다음 중 분선충증의 치료제로 적절한 약물을 고르시오.\n1) Thiabendazole\n2) Ivermectin",
 "(2/3)\n답: 2) Ivermectin\n김채균 교수님_53. anti-helminthic/ 2023: 김채균",
 "(3/3)\n김채균 교수님_53. anti-helminthic",
 "김채균 교수님\n7. 기관지 수축을 일으켜 천식과 COPD 환자에게 사용하면 안되는 약물을\n고르시오.\n1) lamivudine\n5) zanamivir\n(1/3)",
 "답: 5번\nZanamivir는 anti-influenza 약물\n(2/3)\n김채균 교수님 73. Antiviral agents p52",
 "(3/3)\n김채균 교수님 73. Antiviral agents p52",
];
const COVERS = [
 "2023 감면 기말 풀이\n인하대학교 의과대학\n35기 족보",
 "2023학년도 감염과 면역 기말고사 해설\n35기 학술부",
 "감염과 면역 Ⅰ\n2026 기말 족보\n제작: 37기",
];
const nums = t => M.blocksOf(t).map(b => b.qnum);
let pass = 0, fail = 0;
const ck = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}` + (ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
};

ck('실제 2023 (표지 없음)', nums(P2023), [1,2,4,7]);
COVERS.forEach((c,i) => ck(`표지 ${i+1} 붙여도 동일`, nums([c, ...P2023]), [1,2,4,7]));
ck('구분자 없는 족보 loose 폴백',
   nums(["김교수님\n41 인체감염진균의 분류로 옳은 것은?\n1) A\n(1/3)","정답: 2번\n(2/3)",
         "김교수님\n42 진균 세포벽 성분은?\n1) A\n(1/3)","정답: 1번\n(2/3)",
         "김교수님\n43 항진균제 기전은?\n1) A\n(1/3)"]), [41,42,43]);
ck('블록 페이지 범위', M.blocksOf(P2023).slice(0,2).map(b=>[b.s,b.e]), [[0,3],[3,6]]);

ck('파일명 파싱', M.parseName('2023 감면 기말 풀이.pdf'), {year:2023,term:'기말',subject:'감면'});
ck('파일명 파싱(중간)', M.parseName('2021 병리 중간.docx'), {year:2021,term:'중간',subject:'병리'});
ck('파일명 파싱(불가)', M.parseName('강의안 73.pdf'), null);

ck('JSON 코드블록 추출',
   M.grabJSON('설명입니다\n```json\n[{"id":"x","verdict":"solvable"}]\n```\n끝'),
   [{id:'x',verdict:'solvable'}]);
ck('JSON 맨몸 추출',
   M.grabJSON('앞말 [{"id":"y","verdict":"partial"}] 뒷말'),
   [{id:'y',verdict:'partial'}]);
ck('JSON 없음', M.grabJSON('그냥 문장'), null);

// ── NFD(자모 분리) 파일명 회귀 테스트 ──────────────────────────
const src2 = fs.readFileSync(path.join(SRC, 'app_js.js'), 'utf8');
const N = {};
new Function('exports', src2.slice(src2.indexOf('const nfc ='), src2.indexOf('/* ── 상태')) +
  '\nObject.assign(exports,{parseName,whyNoParse,nfc});')(N);
console.log('\n--- NFD 파일명 ---');
for (const base of ['2020 감면 기말 풀이.pdf','2023 감면 기말.docx','2021 병리 중간 풀이.pdf']) {
  const nfd = base.normalize('NFD');
  const a = N.parseName(base), b = N.parseName(nfd);
  const ok = JSON.stringify(a) === JSON.stringify(b) && a !== null;
  console.log(`[${ok?'PASS':'FAIL'}] ${base}  NFC=${JSON.stringify(a)} NFD=${JSON.stringify(b)}`);
  if(!ok) process.exitCode = 1;
}
console.log(`[${N.parseName('강의안 73.pdf')===null?'PASS':'FAIL'}] 형식 아닌 이름은 여전히 null`);
console.log('  사유 안내:', N.whyNoParse('강의안 73.pdf'), '/', N.whyNoParse('감면 기말 풀이.pdf'));


console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
