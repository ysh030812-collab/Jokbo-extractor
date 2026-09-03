/* ── 족보 추출기 · 전부 브라우저 안에서 동작 ───────────────────────── */
(function () {
"use strict";
const $ = (id) => document.getElementById(id);

/* ── IndexedDB ────────────────────────────────────────────────── */
const DB = (() => {
  let p;
  const open = () => p || (p = new Promise((res, rej) => {
    const r = indexedDB.open("jokbo", 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains("files")) d.createObjectStore("files");
      if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta");
      if (!d.objectStoreNames.contains("docx")) d.createObjectStore("docx");
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (store, mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode), s = t.objectStore(store);
      const q = fn(s);
      t.oncomplete = () => res(q && q.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    get: (s, k) => tx(s, "readonly", (o) => o.get(k)),
    put: (s, k, v) => tx(s, "readwrite", (o) => o.put(v, k)),
    del: (s, k) => tx(s, "readwrite", (o) => o.delete(k)),
    clear: (s) => tx(s, "readwrite", (o) => o.clear()),
  };
})();

/* ── PDF 텍스트 추출 ──────────────────────────────────────────── */
async function pageTexts(buf, onPage) {
  const doc = await pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i);
    const tc = await pg.getTextContent();
    const lines = new Map();
    for (const it of tc.items) {
      if (!it.str) continue;
      const y = Math.round(it.transform[5]);
      if (!lines.has(y)) lines.set(y, []);
      lines.get(y).push([it.transform[4], it.str]);
    }
    const txt = [...lines.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, parts]) => parts.sort((a, b) => a[0] - b[0]).map((p) => p[1]).join("").trim())
      .filter(Boolean).join("\n");
    out.push(txt);
    pg.cleanup();
    if (onPage) onPage(i, doc.numPages);
  }
  await doc.destroy();
  return out;
}

/* 시험지 PDF 는 글자의 좌표까지 있어야 한다 — 어디서 오려낼지 정해야 하므로.
   PDF 좌표(좌하단 원점) 그대로 돌려준다. transform[4]=x, [5]=글줄 기준선 y.

   글자만으로는 오려낼 자리를 정확히 잡을 수 없다. 표·그림·수식은 글자가 아니라서
   "이 문제가 어디서 끝나는지"를 글줄로 재면 그림이 잘리거나, 반대로 빈 종이가
   잔뜩 딸려온다. 그래서 쪽을 아주 작게(1px=2pt) 한 번 그려 보고 실제로 잉크가
   묻은 줄·칸을 같이 재 둔다. 재는 데만 쓰고 결과물에는 원본 벡터가 들어간다. */
const INK_SCALE = 0.5, INK_MAX_PAGES = 200;

async function inkOf(pg) {
  const vp = pg.getViewport({ scale: INK_SCALE });
  const w = Math.max(1, Math.ceil(vp.width)), h = Math.max(1, Math.ceil(vp.height));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);
  await pg.render({ canvasContext: g, viewport: vp }).promise;
  const d = g.getImageData(0, 0, w, h).data;
  const row = new Uint8Array(h), lo = new Uint16Array(h), hi = new Uint16Array(h);
  for (let r = 0; r < h; r++) {
    let n = 0, a = w, b = -1;
    for (let x = 0; x < w; x++) {
      const i = (r * w + x) * 4;
      if (d[i + 3] > 8 && (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245)) {
        n++; if (x < a) a = x; b = x;
      }
    }
    /* 점 하나짜리는 얼룩으로 보고 무시한다 */
    row[r] = n >= 2 ? 1 : 0; lo[r] = a; hi[r] = b < 0 ? 0 : b;
  }
  return { row, lo, hi, s: INK_SCALE };
}

async function pageLines(buf, onPage) {
  const doc = await pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i);
    const vp = pg.getViewport({ scale: 1 });
    const items = (await pg.getTextContent()).items
      .filter((t) => t.str && t.str.trim())
      .sort((a, b) => b.transform[5] - a.transform[5]);
    /* 같은 줄이라도 기준선이 조금씩 흔들린다. 2pt 안이면 한 줄로 묶는다. */
    const lines = [];
    let row = null;
    for (const t of items) {
      const y = t.transform[5];
      if (!row || Math.abs(row.y - y) > 2) { row = { y, its: [] }; lines.push(row); }
      row.its.push(t);
    }
    let ink = null;
    /* 쪽마다 한 번씩 그려 보는 값이다. 시험지는 스무 쪽 안쪽이라 순식간이지만,
       풀이 파일이 이름을 잘못 달고 들어오면 수백 쪽이 된다. 그때는 재지 않는다
       — 없으면 글줄만으로 이어가고, 자르는 자리만 조금 헐거워진다. */
    if (doc.numPages <= INK_MAX_PAGES) {
      try { ink = await inkOf(pg); } catch (e) { /* 못 그려도 글줄만으로 이어간다 */ }
    }
    out.push({
      w: vp.width, h: vp.height, ink,
      lines: lines.map((r) => {
        r.its.sort((a, b) => a.transform[4] - b.transform[4]);
        return {
          y: r.y,
          x: r.its[0].transform[4],
          x2: Math.max(...r.its.map((t) => t.transform[4] + (t.width || 0))),
          h: Math.max(...r.its.map((t) => t.height || 0)) || 10,
          t: r.its.map((t) => t.str).join("").trim(),
        };
      }).filter((l) => l.t),
    });
    pg.cleanup();
    if (onPage) onPage(i, doc.numPages);
  }
  await doc.destroy();
  return out;
}

/* ── 문제 시작 슬라이드 찾기 (파이썬판과 동일 규칙) ──────────────── */
const RE_MARK = /\(\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\)/;
const RE_ANS = /^\s*(정답|답)\s*[:：）)]?/;
/* Safari 호환을 위해 lookbehind 대신 자릿수를 코드에서 검사한다.
   그래야 표지의 "2023"(4자리)이 202번 문제로 잘려 읽히지 않는다.
   번호를 묶어 낸 문제가 있다 — "43-45. 알코올성 간질환의 …", "37,38. 위에서 …".
   묶음을 못 읽으면 그 문제가 통째로 사라지고 앞 문제에 딸려 들어간다. */
const qnumRe = (strict) => strict
  ? /(?:^|\n)[ \t]*(?:[•·\-*]\s*)?(\d+)(?:\s*[-~–,]\s*(\d+))?\s*[.)]\s*(\S[^\n]{3,})/g
  : /(?:^|\n)[ \t]*(?:[•·\-*]\s*)?(\d+)(?:\s*[-~–,]\s*(\d+))?\s*[.)]?\s*(\S[^\n]{3,})/g;

/* 객관식이 끝나고 주관식이 1번부터 다시 시작하는 족보가 있다. 번호가 뒤로
   돌아가므로 그냥 두면 그 뒤가 통째로 번호 미상 한 덩어리가 된다. */
const RE_SUBJ = /주관식\s*(\d{1,3})/;
/* 강의록 쪽만 적어 둔 출처 슬라이드 — 문제도 해설도 아니다.
   ("신진욱교수님 레트로바이러스강의록2page", "신진욱교수님63. 오소믹소4p") */
const isSource = (t) => {
  const s = (t || "").replace(/\s/g, "");
  if (!s || s.length >= 60 || /[?？]/.test(s)) return false;   // 물음표가 있으면 문제다
  return /(강의록|강의안|교재)/.test(s) || /\d+p(age)?$/i.test(s);
};
/* 이어지는 장/해설 장/출처 장인가 — 문제 화면을 고를 때 계속 쓰는 판정 */
const isCont = (t) => {
  const mk = RE_MARK.exec(t || "");
  return (mk && +mk[1] > 1) || RE_ANS.test((t || "").trim()) || isSource(t);
};

function scanStarts(texts, strict) {
  const out = []; let last = 0, sec = "";
  texts.forEach((t, i) => {
    if (isCont(t)) return;                     // 이어지는 · 해설 · 출처 슬라이드
    const head = "\n" + t.split("\n").filter((l) => l.trim()).slice(0, 4).join("\n");
    /* '주관식 31' 을 만나면 그때부터 번호를 따로 센다. 뒤이어 접두어 없이
       32, 33 … 으로만 적힌 것도 이 계열로 이어진다. */
    const sm = RE_SUBJ.exec(head);
    if (sm && (sec !== "주" || +sm[1] > last)) {
      sec = "주"; last = +sm[1]; out.push([i, last, sec]); return;
    }
    const re = qnumRe(strict); let m, pick = null, to = 0;
    while ((m = re.exec(head))) {
      if (m[1].length > 3) continue;           // 연도 등 4자리 이상은 문제번호 아님
      const n = +m[1];
      /* 묶음의 끝 번호로 인정할 만한가 — 앞 번호보다 크고 열 개를 넘지 않아야 한다 */
      const e = m[2] && m[2].length <= 3 ? +m[2] : 0;
      if (n > last && n <= 400) { pick = n; to = e > n && e - n <= 10 ? e : 0; break; }
    }
    if (pick === null) {
      /* 번호를 못 읽었다. 문제 화면을 통째로 캡처한 슬라이드가 이렇다.
         바로 앞이 해설·출처 장이면 새 문제가 시작된 자리로 본다. 번호는
         억지로 추정하지 않고 쪽 번호로 식별한다 — 원본 슬라이드는 그 쪽을
         그대로 쓰므로 결과물은 온전하고, 잘못된 번호가 붙지 않는다. */
      if (out.length && t.replace(/\s/g, "").length < 20 && i > 0 && isCont(texts[i - 1]))
        out.push([i, null, sec]);
      return;
    }
    out.push([i, pick, sec, to]); last = to || pick;
  });
  return out;
}

/* 블록 안에서 '문제 화면'으로 볼 쪽만 (해설·출처 장을 뺀다) */
function questionPages(texts, s, e) {
  const out = [];
  for (let i = s; i < e; i++) if (!isCont(texts[i])) out.push(i);
  return out.length ? out : [s];
}

function blocksOf(texts) {
  let st = scanStarts(texts, true);
  const numbered = (a) => a.filter((x) => x[1] != null).length;
  if (numbered(st) < 2) {                       // 구분자 없는 족보 대비
    const lo = scanStarts(texts, false);
    if (numbered(lo) > numbered(st)) st = lo;
  }
  let lastNum = 0, i0 = 0;
  return st.map(([pg, num, sec, to], i) => {
    const e = i + 1 < st.length ? st[i + 1][0] : texts.length;
    /* 번호를 모르는 문제도 원래 자리에 오도록 정렬 키를 따로 둔다.
       주관식은 번호가 다시 작아지므로 객관식 뒤로 보낸다. */
    if (sec === "주" && !i0) { i0 = 1; lastNum = Math.max(lastNum, 400); }
    const ord = num != null ? (lastNum = (sec === "주" ? 400 + (to || num) : (to || num))) : lastNum + 0.5;
    return { qnum: num, qto: to || 0, sec: sec || "", page: pg + 1, ord, s: pg, e,
             qp: questionPages(texts, pg, e) };
  });
}

/* 문제 하나를 가리키는 열쇠와 사람이 읽는 이름 */
const qkey = (q) => (q.qnum != null ? `${q.sec || ""}${q.qnum}` : `p${q.page}`);
/* 화면·결과 PDF 에 쓰는 이름. 쪽 범위는 슬라이드를 찾기 위한 것일 뿐이므로
   Claude 가 슬라이드에서 읽어 준 문제 번호가 있으면 그걸 쓴다. */
const qlabel = (q) => (q.no ? `${q.no}번`
  : q.qnum != null
    ? `${q.sec === "주" ? "주관식 " : ""}${q.qnum}${q.qto > q.qnum ? "~" + q.qto : ""}번`
  : (q.to && q.to > q.page ? `${q.page}~${q.to}쪽` : `${q.page}쪽`));

/* iOS·macOS 는 한글 파일명을 자모 분리(NFD)로 저장한다. 화면에는 "기말" 로
   똑같이 보이지만 코드포인트가 달라 includes("기말") 가 실패한다.
   반드시 NFC 로 정규화한 뒤에 비교해야 한다. */
const nfc = (s) => (s || "").normalize("NFC");

/* 이름 규칙:  {연도} {과목} [{중간|기말}] [풀이]
     2023 감면 기말 풀이.pdf     2023 감면 기말.docx
     2023 호흡기계 풀이.pdf      2023 호흡기계.docx     ← 중간/기말이 없는 시험
   과목은 여러 낱말이어도 된다 (2023 감염과 면역 기말). */
const RE_YEAR = /(?:19|20)\d{2}/;

function parseName(raw) {
  const name = nfc(raw).replace(/\.[A-Za-z0-9]+$/, "").trim();
  const y = name.match(RE_YEAR);
  if (!y) return null;
  let rest = name.slice(name.indexOf(y[0]) + 4).replace(/\s*풀이\s*$/, "").trim();
  const tm = rest.match(/\s*(중간|기말)\s*$/);          // 없으면 단일 시험
  const term = tm ? tm[1] : "";
  const subject = (tm ? rest.slice(0, tm.index) : rest).trim();
  if (!subject) return null;
  return { year: +y[0], term, subject };
}

function whyNoParse(raw) {
  const name = nfc(raw);
  if (!RE_YEAR.test(name)) return "연도 4자리를 찾지 못함";
  return "연도 뒤에서 과목 이름을 찾지 못함";
}

/* 시험 하나를 가리키는 열쇠. 학기가 없는 시험도 있으므로 빈 칸은 건너뛴다.
   2023-기말-감면 / 2023-호흡기계 */
const examKey = (q) => [q.year, q.term, q.subject].filter(Boolean).join("-");
/* 화면에 쓰는 시험 이름: 2023 감면 기말 / 2023 호흡기계 */
const examName = (q) => [q.year, q.subject, q.term].filter(Boolean).join(" ");
/* 기말 → 중간 → N차 → 학기 없음 순 */
const termOrd = (t) => (t === "기말" ? 0 : t === "중간" ? 1 : t ? 2 : 3);

/* ── 만든 파일을 기기에 넘기기 ──────────────────────────────────
   아이패드·아이폰 사파리는 blob 에 붙은 <a download> 를 그냥 무시하는 일이 잦고,
   새 탭으로 여는 것도 팝업 차단에 걸린다. 확실한 길은 공유 시트뿐인데, 마침
   여러 파일을 한 번에 넘길 수 있어서 '파일에 저장' 한 번으로 끝난다.

   share() 는 사용자가 방금 누른 상태(transient activation)에서만 동작한다.
   앞에 await 를 두면 그 자격이 사라지므로, 만들기와 내려받기 버튼을 반드시
   나눠 둔다. 여기서는 바이트를 이미 들고 있으므로 동기로 넘긴다. */
const IS_APPLE = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function linkSave(list) {
  list.forEach((f, i) => setTimeout(() => {
    const url = URL.createObjectURL(new Blob([f.bytes], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url; a.download = f.name; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 300000);
  }, i * 350));
}

/* 넘긴 방식을 돌려준다 ("share" | "link"). 실패하면 링크 방식으로 되돌린다. */
function handOff(list, onNote) {
  if (!list.length) return null;
  const files = list.map((f) => new File([f.bytes], f.name, { type: "application/pdf" }));
  if (IS_APPLE && navigator.canShare && navigator.canShare({ files })) {
    /* files 만 넘긴다. title 이나 text 를 같이 넘기면 아이패드가 그것을 따로 된
       항목으로 보고 '파일에 저장' 때 .txt 를 하나 더 만든다. */
    navigator.share({ files })
      .then(() => onNote && onNote(""))          /* 공유가 끝났으면 안내를 지운다 */
      .catch((e) => {
        if (e && e.name === "AbortError") return;      // 사용자가 취소한 것
        /* 용량이 크면 한 번에 못 넘기는 기기가 있다. 목록의 ↓ 를 하나씩 누르면
           그때마다 새 제스처라 공유가 다시 열린다. */
        linkSave(list);
        onNote && onNote(list.length > 1
          ? "한 번에 넘기지 못했습니다. 위 목록의 ↓ 를 하나씩 눌러 주세요."
          : "공유가 막혀 있어 내려받기로 넘겼습니다.");
      });
    return "share";
  }
  linkSave(list);
  return "link";
}

/* ── 상태 ─────────────────────────────────────────────────────── */
/* RAW 는 파일별 원본 추출 결과, BANK 는 그것을 합쳐 중복을 정리한 것.
   파일 하나만 지워도 나머지가 정확히 복원되도록 원본을 따로 들고 있는다. */
let RAW = {}, BANK = [], VERDICTS = [], LECNAME = "", DONE = [];
/* 화면에 보일 과목. "" 이면 전체. 여러 과목을 한 기기에 등록해 두고 갈아탄다. */
let SUBJ = "";

const setStep = (n, state) => {
  const c = $("c" + n);
  c.classList.remove("locked", "active", "done");
  if (state) c.classList.add(state);
};
/* ── 1·2단계 접기 ─────────────────────────────────────────────
   등록과 Project 준비는 처음 한 번만 하고 그 뒤로는 안 쓴다. 머리줄만 남기고
   접어 두되, 손으로 한 번이라도 여닫았으면 그 뜻을 우선한다. */
const FOLD = {};
function setFold(n, shut, byUser) {
  if (!byUser && FOLD[n] != null) return;
  if (byUser) FOLD[n] = !!shut;
  $("c" + n).classList.toggle("shut", !!shut);
  const b = $("fd" + n);
  if (b) b.setAttribute("aria-expanded", shut ? "false" : "true");
}
["1", "2"].forEach((n) => {
  const c = $("c" + n);
  c.classList.add("can-fold");
  c.querySelector(".head").onclick = () => setFold(n, !c.classList.contains("shut"), true);
});

const err = (id, msg) => { $(id).textContent = msg || ""; $(id).classList.remove("info"); };
/* 오류가 아닌 안내 (내려받기 방식 설명 등) */
const info = (id, msg) => { $(id).textContent = msg || ""; $(id).classList.toggle("info", !!msg); };

/* ── 1. 족보 등록 ─────────────────────────────────────────────── */
/* 파서를 고쳐도 이미 등록된 파일은 예전 결과 그대로 남는다. 파일마다 어느 판으로
   읽었는지 적어 두고, 낡았으면 다시 올리라고 알려 준다. 올리기 전에는 지우지 않는다. */
const PARSER_VER = 5;
/* 같은 문제가 여러 파일에 있으면 원본이 가장 온전한 것을 쓴다.
   풀이 슬라이드(해설까지 있음) > 시험지 PDF(표·그림 그대로) > 시험지 DOCX(다시 조판) */
const SRANK = { solution: 3, exam: 2, docx: 1 };
function rebuild() {
  const best = new Map();
  for (const f of Object.values(RAW)) for (const q of f.items) {
    const prev = best.get(q.id);
    if (!prev || (SRANK[q.source] || 0) > (SRANK[prev.source] || 0)) best.set(q.id, q);
  }
  BANK = [...best.values()];
}
const saveRaw = () => DB.put("meta", "raw", RAW);

async function loadBank() {
  RAW = (await DB.get("meta", "raw")) || null;
  if (!RAW) {                                   // 예전 판(meta.bank) 에서 올라온 경우
    RAW = {};
    for (const q of (await DB.get("meta", "bank")) || []) {
      const f = RAW[q.file] || (RAW[q.file] = { kind: q.source === "solution" ? "sol" : "doc", n: 0, items: [] });
      f.items.push(q); f.n++;
    }
    if (Object.keys(RAW).length) await saveRaw();
  }
  rebuild();
  SUBJ = (await DB.get("meta", "subj")) || "";
  renderBank();
  /* 다시 들어왔을 때는 등록·준비가 이미 끝나 있다. 머리줄만 남기고 접어 둔다.
     아직 할 일이 남은 단계는 펴 둔다 — 접힌 안쪽에 눌러야 할 버튼이 숨으면 안 된다. */
  if (Object.keys(RAW).length) {
    const { redo, again } = staleFiles();
    setFold(1, !(redo.length + again.length));   // 다시 읽을 것이 있으면 펴 둔다
    setFold(2, !planProject().need.length);
  }
}

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

/* 등록된 과목과 그 문제 수. 겹친 문제를 정리한 뒤로 세야 '전체' 와 합이 맞는다. */
function subjects() {
  const m = new Map();
  for (const q of BANK) m.set(q.subject, (m.get(q.subject) || 0) + 1);
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "ko"));
}
/* 지금 고른 과목의 것인가. 과목을 안 골랐으면 전부 통과. */
const subjOf = (name) => { const q = RAW[name] && RAW[name].items[0]; return q ? q.subject : ""; };
const inSubj = (name) => !SUBJ || subjOf(name) === SUBJ;
const bankNow = () => (SUBJ ? BANK.filter((q) => q.subject === SUBJ) : BANK);

function renderSubjects() {
  const list = subjects(), sb = $("sb");
  if (SUBJ && !list.some(([n]) => n === SUBJ)) SUBJ = "";   // 과목이 통째로 지워졌다
  if (list.length < 2) { sb.hidden = true; sb.innerHTML = ""; return; }
  sb.hidden = false;
  sb.innerHTML = [["", "전체", BANK.length]]
    .concat(list.map(([n, c]) => [n, n, c]))
    .map(([v, label, n]) =>
      `<button class="chip ${v === SUBJ ? "on" : ""}" data-s="${esc(v)}">${esc(label)}<b>${n}</b></button>`)
    .join("");
  sb.querySelectorAll(".chip").forEach((b) => {
    b.onclick = async (ev) => {
      ev.stopPropagation();
      SUBJ = b.dataset.s;
      await DB.put("meta", "subj", SUBJ);
      MADE = [];                                  // 과목이 바뀌면 만들어 둔 조각도 다르다
      VERDICTS = []; $("qs").innerHTML = "";
      ["e2", "e3", "e5"].forEach((i) => err(i, ""));
      renderBank();
      setStep(3, "active"); setStep(4, "locked");
    };
  });
}

function renderBank() {
  const s1 = $("s1"), fl = $("fl");
  renderSubjects();
  const names = Object.keys(RAW).filter(inSubj);
  if (!names.length) {
    s1.innerHTML = ""; fl.innerHTML = ""; $("r1").hidden = true; $("k1").textContent = "";
    setStep(1, "active"); setStep(2, "locked");
    renderProject(); renderManual();
    return;
  }
  const shown = bankNow();
  const sol = shown.filter((q) => q.source === "solution").length;
  const doc = shown.length - sol;
  s1.innerHTML = `<span class="pill on">총 ${shown.length}문제</span>` +
    (sol ? `<span class="pill">풀이 ${sol}문제</span>` : "") +
    (doc ? `<span class="pill">시험지 ${doc}문제</span>` : "");
  $("k1").textContent = `${SUBJ ? SUBJ + " · " : ""}파일 ${names.length}개 · ${shown.length}문제`;

  /* 파일마다 몇 문제가 실제로 쓰이는지 — 겹친 문제는 풀이 쪽으로 넘어간다 */
  const used = new Map();
  BANK.forEach((q) => used.set(q.file, (used.get(q.file) || 0) + 1));
  names.sort((a, b) => b.localeCompare(a, "ko"));
  fl.innerHTML = names.map((n) => {
    const f = RAW[n], u = used.get(n) || 0;
    const cnt = u === f.n ? `${f.n}문제` : `${f.n}문제 중 ${u}개`;
    return `<li class="fi">
      <span class="kind ${f.kind === "sol" ? "sol" : "doc"}">${f.kind === "sol" ? "풀이" : "시험지"}</span>
      <span class="nm" title="${esc(n)}">${esc(n)}</span>
      <span class="ct">${cnt}</span>
      <button class="x" data-f="${esc(n)}" aria-label="${esc(n)} 지우기" title="지우기">×</button>
    </li>`;
  }).join("");
  fl.querySelectorAll(".x").forEach((b) => { b.onclick = () => delFile(b.dataset.f); });
  $("r1").hidden = false;
  setStep(1, "done"); setStep(3, "active");
  renderProject();
  renderManual();

  const { redo, again } = staleFiles();
  $("old").hidden = !(redo.length + again.length);
  $("redo").hidden = !redo.length;
  const say = [];
  if (redo.length) say.push(`파일 ${redo.length}개는 원본을 그대로 갖고 있어 여기서 바로 다시 읽을 수 있습니다.`);
  if (again.length) say.push(`시험지 DOCX ${again.length}개는 원본이 없어 같은 파일을 다시 골라 주세요 — 덮어쓰기만 하고 나머지는 그대로 둡니다.`);
  $("oldn").textContent = "문제를 읽는 방식이 개선되었습니다. 예전 방식으로 읽어 둔 결과라 "
    + "문제가 붙어 있거나 빠져 있을 수 있습니다. " + say.join(" ");
}

async function delFile(name) {
  const f = RAW[name];
  if (!f) return;
  delete RAW[name];
  MADE = [];
  if (f.kind === "doc") for (const q of f.items) await DB.del("docx", q.id);
  else await DB.del("files", name);            // 풀이·시험지 PDF 는 원본을 그대로 들고 있다
  rebuild();
  await saveRaw();
  err("e1", "");
  renderBank();
  if (!BANK.length) { VERDICTS = []; $("qs").innerHTML = ""; setStep(3, "locked"); setStep(4, "locked"); }
  renderManual();
}

/* 파일 하나를 읽어 RAW 항목으로 만든다. 처음 등록할 때와, 파서를 고친 뒤 원본으로
   다시 읽을 때 같은 길을 쓴다. 못 읽으면 까닭을 담아 던진다. */
async function parseFile(name, meta, buf, onProg) {
  const key = examKey(meta);

  if (/\.docx$/i.test(name)) {                    // 시험지 DOCX
    if (name.includes("풀이")) throw new Error("풀이 DOCX는 지원하지 않음");
    let qs;
    try { qs = docxQuestions(buf); } catch (e) { throw new Error("DOCX 읽기 실패"); }
    if (!qs.length) throw new Error("문제 0개");
    const items = [];
    for (const q of qs) {
      const id = `${key}-${q.num}`;
      await DB.put("docx", id, { stem: q.stem, presented: q.presented, choices: q.choices, images: q.images });
      items.push({
        id, year: meta.year, term: meta.term, subject: meta.subject,
        qnum: q.num, qto: q.to || 0, sec: "", page: null, ord: q.to || q.num,
        file: name, source: "docx", s: null, e: null,
        text: [q.stem, ...q.presented, ...q.choices.map((c, i) => `${i + 1}) ${c}`)].join("\n").slice(0, 1400),
      });
    }
    if (onProg) onProg(1);
    return { kind: "doc", v: PARSER_VER, n: items.length, items };
  }

  if (!name.includes("풀이")) {                    // 시험지 PDF — 문제 자리를 오려 쓴다
    let pages;
    try { pages = await pageLines(buf.slice(0), (p, n) => onProg && onProg(p / n)); }
    catch (e) { throw new Error("읽기 실패"); }
    const qs = pdfExamQuestions(pages);
    if (!qs.length) throw new Error("문제 0개 — 스캔한 시험지는 글자가 없어 읽지 못합니다");
    await DB.put("files", name, new Blob([buf], { type: "application/pdf" }));
    const items = qs.map((q) => ({
      id: `${key}-${q.sec}${q.num}`,
      year: meta.year, term: meta.term, subject: meta.subject,
      qnum: q.num, qto: q.to || 0, sec: q.sec, page: q.page,
      ord: (q.sec === "주" ? 400 : 0) + (q.to || q.num),
      file: name, source: "exam", crops: q.crops, text: q.text,
    }));
    return { kind: "exam", v: PARSER_VER, n: items.length, np: pages.length, items };
  }

  let texts;                                      // 풀이 슬라이드 PDF
  try { texts = await pageTexts(buf.slice(0), (p, n) => onProg && onProg(p / n)); }
  catch (e) { throw new Error("읽기 실패"); }
  const blks = blocksOf(texts);
  if (!blks.length) throw new Error("문제 0개");
  await DB.put("files", name, new Blob([buf], { type: "application/pdf" }));
  const items = blks.map((b) => ({
    id: `${key}-${qkey(b)}`,
    year: meta.year, term: meta.term, subject: meta.subject,
    qnum: b.qnum, qto: b.qto || 0, sec: b.sec, page: b.page, ord: b.ord,
    file: name, source: "solution", s: b.s, e: b.e, qp: b.qp,
    text: texts.slice(b.s, b.e).join("\n").trim().slice(0, 1400),
  }));
  return { kind: "sol", v: PARSER_VER, n: items.length, np: texts.length, items };
}

const NAME_HINT = "\n이름은 '2023 감면 기말 풀이.pdf' 또는 '2023 감면 기말.docx' 형식이어야 합니다." +
  "\n중간/기말 구분이 없는 시험은 '2023 호흡기계 풀이.pdf' 처럼 빼면 됩니다.";

$("f1").onchange = async (ev) => {
  const files = [...ev.target.files]; ev.target.value = "";
  if (!files.length) return;
  err("e1", ""); $("b1").hidden = false;
  setFold(1, false, true);                       // 접혀 있어도 결과가 보이게 편다
  const bar = $("b1").firstElementChild;
  const skipped = [], added = [];

  for (let fi = 0; fi < files.length; fi++) {
    const f = files[fi];
    const name = nfc(f.name);                      // 자모 분리(NFD) 파일명 대응
    const meta = parseName(name);
    if (!meta) { skipped.push(`${name} — ${whyNoParse(name)}`); continue; }
    try {
      RAW[name] = await parseFile(name, meta, await f.arrayBuffer(),
        (r) => { bar.style.width = (((fi + r) / files.length) * 100).toFixed(1) + "%"; });
      added.push(name);
    } catch (e) { skipped.push(`${name} (${e.message})`); }
  }
  bar.style.width = "100%";
  rebuild();
  MADE = [];                                     // 족보가 바뀌었으니 색인도 다시 만들어야 한다
  /* 다른 과목을 보고 있는데 파일을 올리면 그 파일이 목록에 안 보여 실패한 것처럼
     된다. 그럴 때만 방금 올린 쪽으로 옮겨 준다 (전체를 보고 있으면 그대로 둔다). */
  const got = [...new Set(added.map((n) => subjOf(n)))].filter(Boolean);
  if (SUBJ && got.length && !got.includes(SUBJ)) {
    SUBJ = got.length === 1 ? got[0] : "";
    await DB.put("meta", "subj", SUBJ);
  }
  await saveRaw();
  setTimeout(() => { $("b1").hidden = true; bar.style.width = "0"; }, 400);
  renderBank();
  if (skipped.length) err("e1", "건너뜀\n· " + skipped.join("\n· ") + NAME_HINT);
};

/* ── 파서를 고친 뒤 이미 등록된 파일 ─────────────────────────────
   PDF 는 원본을 그대로 들고 있으므로 여기서 다시 읽으면 된다. 시험지 DOCX 만
   원본이 없어(문제만 뽑아 뒀다) 같은 파일을 다시 골라 받아야 한다.
   과목을 걸러 보고 있어도 놓치지 않도록 등록된 파일 전체에서 센다. */
function staleFiles() {
  const all = Object.keys(RAW).filter((n) => (RAW[n].v || 1) < PARSER_VER);
  return { redo: all.filter((n) => RAW[n].kind !== "doc"),
           again: all.filter((n) => RAW[n].kind === "doc") };
}

$("redo").onclick = async () => {
  const { redo } = staleFiles();
  if (!redo.length) return;
  const btn = $("redo"); btn.disabled = true; btn.textContent = "다시 읽는 중…";
  err("e1", ""); $("b1").hidden = false;
  const bar = $("b1").firstElementChild;
  const failed = [];
  for (let i = 0; i < redo.length; i++) {
    const name = redo[i], q = RAW[name].items[0];
    const meta = q ? { year: q.year, term: q.term, subject: q.subject } : parseName(name);
    const blob = meta && await DB.get("files", name);
    if (!blob) { failed.push(`${name} (원본이 없습니다 — 다시 올려 주세요)`); continue; }
    try {
      RAW[name] = await parseFile(name, meta, await blob.arrayBuffer(),
        (r) => { bar.style.width = (((i + r) / redo.length) * 100).toFixed(1) + "%"; });
    } catch (e) { failed.push(`${name} (${e.message})`); }
  }
  bar.style.width = "100%";
  rebuild();
  MADE = [];
  /* 다시 읽으면 문제 id 가 달라질 수 있다. 앞서 뽑아 둔 목록은 버린다. */
  VERDICTS = []; $("qs").innerHTML = "";
  setStep(3, "active"); setStep(4, "locked");
  await saveRaw();
  setTimeout(() => { $("b1").hidden = true; bar.style.width = "0"; }, 400);
  btn.disabled = false; btn.textContent = "여기서 다시 읽기";
  renderBank();
  if (failed.length) err("e1", "다시 읽지 못한 파일\n· " + failed.join("\n· "));
};

$("clr").onclick = async () => {
  await DB.clear("files"); await DB.clear("meta"); await DB.clear("docx");
  RAW = {}; BANK = []; VERDICTS = []; MADE = []; SUBJ = "";
  ["s2", "s3", "pf", "mx", "qs"].forEach((i) => ($(i).innerHTML = ""));
  $("pn").hidden = true; $("cpins").hidden = true;
  ["e1", "e2", "e3", "e4"].forEach((i) => err(i, ""));
  $("ta").value = "";
  renderBank(); setStep(3, "locked"); setStep(4, "locked");
};

/* ── 2. Claude Project 준비 ──────────────────────────────────── */
/* 어느 연도가 시험지 DOCX 를 갖고 있는지. 그 연도는 원본을 그대로 올리면 되고,
   없는 연도(2020·2021 처럼)만 풀이 PDF 에서 문제 색인을 뽑아야 한다. */
function planProject() {
  const haveDocx = new Set(), sol = new Map();
  for (const [name, f] of Object.entries(RAW)) {
    const q = f.items[0]; if (!q || !inSubj(name)) continue;
    const key = examKey(q);
    if (f.kind !== "sol") haveDocx.add(key);
    else sol.set(name, { year: q.year, term: q.term, subject: q.subject, key });
  }
  const asis = Object.keys(RAW).filter((n) => RAW[n].kind !== "sol" && inSubj(n)).sort().reverse();
  const need = [...sol.entries()].filter(([, m]) => !haveDocx.has(m.key))
    .sort((a, b) => b[1].year - a[1].year);
  return { asis, need };
}

let MADE = [];                                   // 이번에 만든 색인 파일들

function renderProject() {
  const { asis, need } = planProject();
  const pf = $("pf"), s2 = $("s2");
  if (!asis.length && !need.length) {
    pf.innerHTML = ""; s2.innerHTML = ""; $("k2").textContent = "";
    $("pn").hidden = true; $("cpins").hidden = true; $("dlall").hidden = true;
    $("mkidx").hidden = true;
    return;
  }
  s2.innerHTML = `<span class="pill on">올릴 파일 ${asis.length + MADE.length}개</span>` +
    (need.length && !MADE.length ? `<span class="pill">쪼갤 연도 ${need.length}개</span>` : "");

  const rows = asis.map((n) => `<li class="fi">
      <span class="kind doc">그대로</span>
      <span class="nm" title="${esc(n)}">${esc(n)}</span>
      <span class="ct">${RAW[n].n}문제</span>
    </li>`);
  MADE.forEach((f, i) => rows.push(`<li class="fi">
      <span class="kind sol">조각</span>
      <span class="nm" title="${esc(f.name)}">${esc(f.name)}</span>
      <span class="ct">${f.pages}쪽 · 원본 ${f.from}~${f.to} · ${(f.bytes.length / 1048576).toFixed(1)}MB</span>
      <button class="x" data-i="${i}" aria-label="${esc(f.name)} 내려받기" title="내려받기">↓</button>
    </li>`));
  pf.innerHTML = rows.join("");
  pf.querySelectorAll(".x").forEach((b) => { b.onclick = () => handOff([MADE[+b.dataset.i]], (m) => info("e2", m)); });

  $("dlall").hidden = !MADE.length;
  $("dlhint").hidden = !MADE.length || !IS_APPLE;
  if (MADE.length) $("dlall").textContent =
    MADE.length > 1 ? `조각 ${MADE.length}개 한 번에 받기` : "조각 파일 받기";
  const ready = asis.length > 0 || MADE.length > 0;
  $("k2").textContent = need.length && !MADE.length
    ? `쪼갤 연도 ${need.length}개 남음`
    : ready ? `올릴 파일 ${asis.length + MADE.length}개` : "";
  $("pn").hidden = !ready;
  $("cpins").hidden = !ready;
  /* 색인을 만들 연도가 남아 있으면 아직 할 일이 있다는 뜻 */
  setStep(2, need.length && !MADE.length ? "active" : ready ? "done" : "active");
  $("mkidx").hidden = !need.length;
}

$("dlall").onclick = () => {
  info("e2", "");
  const how = handOff(MADE, (m) => info("e2", m));
  if (how === "link" && MADE.length > 1) info("e2", `${MADE.length}개를 차례로 내려받습니다.`);
};

$("mkidx").onclick = async () => {
  err("e2", "");
  const { need } = planProject();
  const btn = $("mkidx"); btn.disabled = true;
  if (!need.length) {
    MADE = [];
    btn.disabled = false; btn.textContent = "Project에 올릴 파일 만들기";
    renderProject();
    return info("e2", "시험지 파일이 모든 연도에 있어 따로 만들 것이 없습니다. 위 파일을 그대로 올리세요.");
  }
  btn.textContent = "만드는 중…";
  $("b2").hidden = false;
  const bar = $("b2").firstElementChild;
  MADE = [];
  try {
    for (let i = 0; i < need.length; i++) {
      const [name, meta] = need[i];
      const files = await buildProjectChunks(name, meta, (r) => {
        bar.style.width = (((i + r) / need.length) * 100).toFixed(1) + "%";
      });
      MADE.push(...files);
      renderProject();
    }
    bar.style.width = "100%";
    setTimeout(() => { $("b2").hidden = true; bar.style.width = "0"; }, 400);
    btn.textContent = "다시 만들기";
    await DB.put("meta", "prepared", true);
  } catch (e) {
    err("e2", "만들지 못했습니다 — " + e.message);
    $("b2").hidden = true;
    btn.textContent = "Project에 올릴 파일 만들기";
  }
  btn.disabled = false;
  renderProject();
};

$("cpins").onclick = async () => {
  const { asis } = planProject();
  const t = projectInstructions(asis, MADE.map((f) => f.name));
  try { await navigator.clipboard.writeText(t); }
  catch (e) {
    const ta = document.createElement("textarea");
    ta.value = t; document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); ta.remove();
  }
  const b = $("cpins"), old = b.textContent;
  b.textContent = "복사됐습니다"; b.classList.add("ok");
  setTimeout(() => { b.textContent = old; b.classList.remove("ok"); }, 1600);
};

/* ── 3. 판정 결과 붙여넣기 ────────────────────────────────────── */
/* 강의안은 표지 제목에만 쓴다 — 판정은 Project 가 하므로 내용을 읽을 필요가 없다 */
$("f2").onchange = (ev) => {
  const f = ev.target.files[0]; ev.target.value = "";
  if (!f) return;
  LECNAME = nfc(f.name);
  $("s3").innerHTML = `<span class="pill on">표지 제목 · ${esc(LECNAME.replace(/\.pdf$/i, ""))}</span>`;
};

/* ── 3-b. Claude 없이 번호로 직접 고르기 ──────────────────────── */
/* 등록된 시험 목록 (연도 최신순) */
function examsOf() {
  const m = new Map();
  for (const q of bankNow()) {
    const k = examKey(q);
    if (!m.has(k)) m.set(k, { year: q.year, term: q.term, subject: q.subject, n: 0 });
    m.get(k).n++;
  }
  return [...m.values()].sort((a, b) => b.year - a.year
    || termOrd(a.term) - termOrd(b.term) || a.subject.localeCompare(b.subject, "ko"));
}

let MEXAMS = [];

function renderManual() {
  MEXAMS = examsOf();
  const mx = $("mx");
  if (!MEXAMS.length) { mx.innerHTML = ""; $("man").hidden = true; return; }
  $("man").hidden = false;
  mx.innerHTML = MEXAMS.map((e, i) => `<li class="fi">
      <span class="nm" title="${esc(examName(e))}">${esc(examName(e))}</span>
      <input class="mnum" data-i="${i}" inputmode="text" autocomplete="off"
             aria-label="${esc(examName(e))} 문제 번호" placeholder="6, 7, 12-15">
    </li>`).join("");
}

/* "6, 7, 12-15, 주37, p442~444" → 문제 은행 id 목록 */
function parseNums(text, exam) {
  const key = examKey(exam), out = [], bad = [];
  for (const tok of String(text || "").split(/[,\s]+/).filter(Boolean)) {
    /* p442~444 : 번호를 모르는 그림 문제를 쪽으로 가리킨다 (한 문제) */
    let m = /^p(\d{1,4})(?:[~\-–]p?(\d{1,4}))?$/i.exec(tok);
    if (m) { out.push(`${key}-p${m[1]}${m[2] ? "~" + m[2] : ""}`); continue; }
    /* 12-15 : 문제 번호 범위 (네 문제) */
    m = /^(\d{1,3})[~\-–](\d{1,3})$/.exec(tok);
    if (m && +m[2] >= +m[1] && +m[2] - +m[1] <= 200) {
      for (let n = +m[1]; n <= +m[2]; n++) out.push(`${key}-${n}`);
      continue;
    }
    /* 37 · 주37 */
    m = /^(주)?(\d{1,3})$/.exec(tok);
    if (m) { out.push(`${key}-${m[1] || ""}${m[2]}`); continue; }
    bad.push(tok);
  }
  return [out, bad];
}

$("mgo").onclick = () => {
  err("e5", "");
  const ids = [], bad = [];
  $("mx").querySelectorAll(".mnum").forEach((el) => {
    const [got, no] = parseNums(el.value, MEXAMS[+el.dataset.i]);
    ids.push(...got); bad.push(...no);
  });
  if (!ids.length) return err("e5", "번호를 입력해 주세요.");

  const byId = bankIndex();
  const seen = new Set();
  VERDICTS = [];
  const miss = [];
  for (const id of ids) {
    const q = byId.get(id) || spanPick(id);
    if (!q) { miss.push(id.replace(/^.*?-(?=[^-]*$)/, "")); continue; }
    /* 43·44·45 를 다 적어도 묶음 문제는 한 번만 들어간다 */
    if (seen.has(q.id)) continue;
    seen.add(q.id);
    VERDICTS.push({ ...q, no: "", verdict: "picked", pages: "", why: "" });
  }
  if (!VERDICTS.length) {
    return err("e5", "적으신 번호가 등록된 족보에 없습니다.\n1단계 파일 목록의 문제 수를 확인해 주세요.");
  }
  VERDICTS.sort((a, b) => b.year - a.year || termOrd(a.term) - termOrd(b.term)
    || a.subject.localeCompare(b.subject, "ko") || (a.ord ?? a.qnum) - (b.ord ?? b.qnum));
  const notes = [];
  if (bad.length) notes.push(`알아보지 못한 표기 ${bad.length}개 — ${bad.slice(0, 5).join(", ")}`);
  if (miss.length) notes.push(`족보에 없는 번호 ${miss.length}개 — ${miss.slice(0, 8).join(", ")}${miss.length > 8 ? " …" : ""}`);
  err("e5", notes.join("\n"));
  renderVerdicts();
  setStep(3, "done"); setStep(4, "active");
  $("c4").scrollIntoView({ behavior: "smooth", block: "start" });
};

/* 문제 번호로 항목을 찾는 표. "43-45" 처럼 묶어 낸 문제는 44·45 로 찾아도
   같은 항목이 나와야 한다 — Claude 도 사람도 가운데 번호로 부르기 때문이다.
   진짜 그 번호를 가진 문제가 따로 있으면 그쪽이 이긴다. */
function bankIndex() {
  const m = new Map();
  for (const q of BANK) m.set(q.id, q);
  for (const q of BANK) {
    if (!(q.qto > q.qnum)) continue;
    const key = examKey(q);
    for (let n = q.qnum + 1; n <= q.qto; n++) {
      const alias = `${key}-${q.sec || ""}${n}`;
      if (!m.has(alias)) m.set(alias, q);
    }
  }
  return m;
}

/* Claude 가 pages 자리에 쪽 번호 대신 슬라이드 제목을 보내오는 일이 있다.
   그대로 두면 "강의안 Congenital Anomaly(날문협착)쪽" 처럼 찍힌다.
   쪽 번호로 읽히는 것만 받고, 아니면 버린다 (why 에 적힌 설명은 그대로 남는다). */
function cleanPages(v) {
  const t = String(v == null ? "" : v).replace(/\s/g, "")
    .replace(/(쪽|페이지|pages?|p\.)/gi, "")
    .replace(/^p(?=\d)/i, "");                  // 풀이 출처에 흔한 "p52" 도 받는다
  return /^\d{1,4}([-~–,]\d{1,4})*$/.test(t) ? t.replace(/,/g, ", ") : "";
}

function grabJSON(s) {
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch (e) { /* fall through */ } }
  const i = s.indexOf("["), j = s.lastIndexOf("]");
  if (i >= 0 && j > i) { try { return JSON.parse(s.slice(i, j + 1)); } catch (e) { /* fall through */ } }
  return null;
}

/* 시험지가 없는 연도는 Claude 가 쪽 범위로 답한다: 2020-기말-감면-p442~444.
   어느 슬라이드가 한 문제인지 코드가 추측하지 않으므로 어긋날 일이 없다.
   쪽번호 앞의 p 는 문제 번호와 헷갈리지 않기 위한 것이다 (…-29 는 29번 문제). */
const RE_SPAN = /^\s*(\d{4})-(?:(중간|기말|\d차)-)?(.+?)-p(\d{1,4})(?:\s*[~\-–]\s*p?(\d{1,4}))?\s*$/;

function solutionFileFor(year, term, subject) {
  for (const [name, f] of Object.entries(RAW)) {
    if (f.kind !== "sol") continue;
    const q = f.items[0];
    if (q && q.year === year && q.term === term && q.subject === subject) return [name, f.np || 0];
  }
  return null;
}

/* 쪽 범위 id 를 그대로 뽑아 쓸 수 있는 항목으로 바꾼다 */
function spanPick(rawId) {
  const m = RE_SPAN.exec(nfc(rawId || ""));
  if (!m) return null;
  const [, y, term0, subject, a, b] = m;
  const term = term0 || "";
  const hit = solutionFileFor(+y, term, subject.trim());
  if (!hit) return null;
  const [file, np] = hit;
  const from = +a, to = Math.max(from, +(b || a));
  if (to - from > 12) return null;                 // 한 문제가 열 장을 넘지는 않는다
  if (np && (from < 1 || from > np)) return null;  // 원본에 없는 쪽 — 조용히 빠지지 않게
  return {
    id: `${examKey({ year: +y, term, subject: subject.trim() })}-p${from}${to > from ? "~" + to : ""}`,
    year: +y, term, subject: subject.trim(),
    qnum: null, sec: "", page: from, to, ord: from,
    file, source: "solution", s: from - 1, e: to, text: "",
  };
}

$("rd").onclick = () => {
  err("e3", "");
  const raw = $("ta").value.trim();
  if (!raw) return err("e3", "붙여넣은 내용이 없습니다.");
  const arr = grabJSON(raw);
  if (!Array.isArray(arr)) return err("e3", "JSON을 찾지 못했습니다. Claude 답변 맨 아래의 코드블록을 통째로 복사해 주세요.");

  const byId = bankIndex();
  VERDICTS = [];
  const miss = [], seen = new Set();
  arr.forEach((v) => {
    const vd = ["solvable", "partial", "unrelated"].includes(v.verdict) ? v.verdict : "partial";
    const q = byId.get(nfc(v.id || "")) || spanPick(v.id);
    if (!q) { if (v.id) miss.push(v.id); return; }
    if (seen.has(q.id)) return;                  // 묶음 문제를 번호마다 답해 와도 한 번만
    seen.add(q.id);
    /* no 는 Claude 가 슬라이드에서 읽어 준 문제 번호 (표시용). 짧게 잘라 쓴다. */
    const no = String(v.no == null ? "" : v.no).trim().replace(/번\s*$/, "").slice(0, 12);
    VERDICTS.push({ ...q, no, verdict: vd, pages: cleanPages(v.pages), why: v.why || "" });
  });
  if (!VERDICTS.length) {
    return err("e3", "등록된 족보와 일치하는 문제가 없습니다." +
      (miss.length ? `\n받은 id: ${miss.slice(0, 3).join(", ")}${miss.length > 3 ? " …" : ""}` +
        "\n id 는 '2023-기말-감면-6' 이나 '2020-기말-감면-p442~444' 형식이어야 하고," +
        "\n 그 족보가 1단계에 등록돼 있어야 합니다." : ""));
  }
  VERDICTS.sort((a, b) => b.year - a.year || termOrd(a.term) - termOrd(b.term)
    || a.subject.localeCompare(b.subject, "ko") || (a.ord ?? a.qnum) - (b.ord ?? b.qnum));
  if (miss.length) err("e3", `문제 은행에 없는 항목 ${miss.length}개는 건너뜁니다 — ${miss.slice(0, 3).join(", ")}${miss.length > 3 ? " …" : ""}`);
  renderVerdicts();
  setStep(3, "done"); setStep(4, "active");
  $("c4").scrollIntoView({ behavior: "smooth", block: "start" });
};

/* ── 4. 확인 & PDF ────────────────────────────────────────────── */
const LABEL = { solvable: "풀 수 있음", partial: "일부", unrelated: "무관", picked: "직접 고름" };
function renderVerdicts() {
  $("qs").innerHTML = VERDICTS.map((v, i) => `
    <li class="q ${v.verdict === "unrelated" || v.verdict === "partial" ? "" : "sel"}" data-i="${i}">
      <input type="checkbox" ${v.verdict === "unrelated" || v.verdict === "partial" ? "" : "checked"}>
      <div>
        <div class="meta">
          <span class="who">${esc(examName(v))} ${qlabel(v)}</span>
          <span class="kind ${v.source === "solution" ? "sol" : "doc"}">${v.source === "solution" ? "풀이" : "시험지"}</span>
          <span class="tag ${v.verdict}">${LABEL[v.verdict]}</span>
          ${v.pages ? `<span class="tag pg">강의안 ${v.pages}쪽</span>` : ""}
        </div>
        ${v.why ? `<div class="why">${esc(v.why)}</div>` : ""}
      </div>
    </li>`).join("");
  $("qs").querySelectorAll(".q").forEach((li) => {
    const cb = li.querySelector("input");
    li.onclick = (e) => {
      if (e.target !== cb) cb.checked = !cb.checked;
      li.classList.toggle("sel", cb.checked);
      count();
    };
  });
  count();
}
function count() {
  const on = [...$("qs").querySelectorAll(".q")].filter((li) => li.querySelector("input").checked);
  const doc = on.filter((li) => VERDICTS[+li.dataset.i].source !== "solution").length;
  const sol = on.length - doc;
  $("s4").textContent = on.length
    ? `${on.length}문제가 들어갑니다` + (sol && doc ? ` — 풀이 ${sol} · 시험지 ${doc}.` : ".")
    : "체크된 문제만 들어갑니다.";
  $("mk").disabled = on.length === 0;
}

$("mk").onclick = async () => {
  err("e4", "");
  const btn = $("mk"); btn.disabled = true; btn.textContent = "만드는 중…";
  try {
    const picks = [...$("qs").querySelectorAll(".q")]
      .filter((li) => li.querySelector("input").checked)
      .map((li) => VERDICTS[+li.dataset.i]);

    const { bytes, warnings } = await buildPDF(picks, LECNAME.replace(/\.pdf$/i, ""));
    if (warnings.length) err("e4", warnings.join("\n"));
    const name = (LECNAME.replace(/\.pdf$/i, "") || "족보") + " 발췌.pdf";
    DONE = [{ name, bytes }];

    /* 만들기(오래 걸림)와 받기를 나눈다. 공유 시트는 방금 누른 버튼에서만 열린다. */
    const get = $("op");
    get.hidden = false;
    $("dlhint4").hidden = !IS_APPLE;
    get.onclick = () => { info("e4", ""); handOff(DONE, (m) => info("e4", m)); };
    $("dl4").textContent = picks.length + "문제 · " + (bytes.length / 1048576).toFixed(1) + "MB";
    if (!IS_APPLE) linkSave(DONE);              // 데스크톱은 바로 내려받아도 안전하다
    btn.textContent = "다시 만들기"; btn.disabled = false;
    setStep(4, "done");
  } catch (e) {
    err("e4", "만들지 못했습니다 — " + e.message);
    btn.textContent = "PDF 만들기"; btn.disabled = false;
  }
};

loadBank();
})();
