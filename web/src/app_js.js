/* ── 족보 추출기 · 전부 브라우저 안에서 동작 ───────────────────────── */
(function () {
"use strict";
const $ = (id) => document.getElementById(id);
const TERM_ORD = { "기말": 0, "중간": 1 };

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

/* ── 문제 시작 슬라이드 찾기 (파이썬판과 동일 규칙) ──────────────── */
const RE_MARK = /\(\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\)/;
const RE_ANS = /^\s*(정답|답)\s*[:：）)]?/;
/* Safari 호환을 위해 lookbehind 대신 자릿수를 코드에서 검사한다.
   그래야 표지의 "2023"(4자리)이 202번 문제로 잘려 읽히지 않는다. */
const qnumRe = (strict) => strict
  ? /(?:^|\n)[ \t]*(?:[•·\-*]\s*)?(\d+)\s*[.)]\s*(\S[^\n]{3,})/g
  : /(?:^|\n)[ \t]*(?:[•·\-*]\s*)?(\d+)\s*[.)]?\s*(\S[^\n]{3,})/g;

function scanStarts(texts, strict) {
  const out = []; let last = 0;
  texts.forEach((t, i) => {
    const mk = RE_MARK.exec(t);
    if (mk && +mk[1] > 1) return;              // 이어지는 슬라이드
    if (RE_ANS.test(t.trim())) return;         // 해설 슬라이드
    const head = "\n" + t.split("\n").filter((l) => l.trim()).slice(0, 4).join("\n");
    const re = qnumRe(strict); let m, pick = null;
    while ((m = re.exec(head))) {
      if (m[1].length > 3) continue;           // 연도 등 4자리 이상은 문제번호 아님
      const n = +m[1];
      if (n > last && n <= 400) { pick = n; break; }
    }
    if (pick === null) return;
    out.push([i, pick]); last = pick;
  });
  return out;
}

function blocksOf(texts) {
  let st = scanStarts(texts, true);
  if (st.length < 2) {                          // 구분자 없는 족보 대비
    const lo = scanStarts(texts, false);
    if (lo.length > st.length) st = lo;
  }
  return st.map(([pg, num], i) => ({
    qnum: num, s: pg, e: i + 1 < st.length ? st[i + 1][0] : texts.length,
  }));
}

/* iOS·macOS 는 한글 파일명을 자모 분리(NFD)로 저장한다. 화면에는 "기말" 로
   똑같이 보이지만 코드포인트가 달라 includes("기말") 가 실패한다.
   반드시 NFC 로 정규화한 뒤에 비교해야 한다. */
const nfc = (s) => (s || "").normalize("NFC");

function parseName(raw) {
  const name = nfc(raw);
  const y = name.match(/(?:19|20)\d{2}/);
  if (!y) return null;
  const term = name.includes("중간") ? "중간" : name.includes("기말") ? "기말" : null;
  if (!term) return null;
  const s = name.match(/(?:19|20)\d{2}\s+(.+?)\s+(?:중간|기말)/);
  return { year: +y[0], term, subject: s ? s[1].trim() : "" };
}

function whyNoParse(raw) {
  const name = nfc(raw);
  if (!name.match(/(?:19|20)\d{2}/)) return "연도 4자리를 찾지 못함";
  if (!/중간|기말/.test(name)) return "'중간' 또는 '기말'을 찾지 못함";
  return "이름 형식을 알아보지 못함";
}

/* ── BM25 ─────────────────────────────────────────────────────── */
const WORD = /[A-Za-z][A-Za-z-]{2,}|[가-힣]{2,}|\d{2,}/g;
function toks(s) {
  const out = []; s = (s || "").toLowerCase(); WORD.lastIndex = 0; let m;
  while ((m = WORD.exec(s))) {
    const w = m[0];
    if (/^[a-z]/.test(w) || /^\d+$/.test(w)) out.push(w);
    else for (let i = 0; i < w.length - 1; i++) out.push(w.slice(i, i + 2));
  }
  return out;
}
function bm25(query, docs, top) {
  const dt = docs.map((d) => toks(d.text));
  const dl = dt.map((t) => t.length);
  const avg = dl.reduce((a, b) => a + b, 0) / (dl.length || 1) || 1;
  const df = new Map();
  dt.forEach((t) => new Set(t).forEach((w) => df.set(w, (df.get(w) || 0) + 1)));
  const N = docs.length, k1 = 1.5, b = 0.75;
  const q = new Set(toks(query));
  const scored = [];
  dt.forEach((t, i) => {
    const tf = new Map();
    t.forEach((w) => tf.set(w, (tf.get(w) || 0) + 1));
    let sc = 0;
    q.forEach((w) => {
      const f = tf.get(w); if (!f) return;
      const n = df.get(w) || 0;
      sc += Math.log(1 + (N - n + 0.5) / (n + 0.5)) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * dl[i] / avg));
    });
    if (sc > 0) scored.push([sc, i]);
  });
  scored.sort((a, b2) => b2[0] - a[0]);
  return scored.slice(0, top).map(([sc, i]) => ({ ...docs[i], score: +sc.toFixed(1) }));
}

/* ── 상태 ─────────────────────────────────────────────────────── */
/* RAW 는 파일별 원본 추출 결과, BANK 는 그것을 합쳐 중복을 정리한 것.
   파일 하나만 지워도 나머지가 정확히 복원되도록 원본을 따로 들고 있는다. */
let RAW = {}, BANK = [], CAND = [], VERDICTS = [], LECNAME = "";

const setStep = (n, state) => {
  const c = $("c" + n);
  c.classList.remove("locked", "active", "done");
  if (state) c.classList.add(state);
};
const err = (id, msg) => { $(id).textContent = msg || ""; };

/* ── 1. 족보 등록 ─────────────────────────────────────────────── */
/* 파서를 고쳐도 이미 등록된 파일은 예전 결과 그대로 남는다. 파일마다 어느 판으로
   읽었는지 적어 두고, 낡았으면 다시 올리라고 알려 준다. 올리기 전에는 지우지 않는다. */
const PARSER_VER = 2;
/* 같은 문제가 풀이와 시험지에 다 있으면 풀이 슬라이드를 쓴다 (원본이 그대로 들어가므로) */
function rebuild() {
  const best = new Map();
  for (const f of Object.values(RAW)) for (const q of f.items) {
    const prev = best.get(q.id);
    if (!prev || (prev.source === "docx" && q.source === "solution")) best.set(q.id, q);
  }
  BANK = [...best.values()];
}
const saveRaw = () => DB.put("meta", "raw", RAW);

async function loadBank() {
  RAW = (await DB.get("meta", "raw")) || null;
  if (!RAW) {                                   // 예전 판(meta.bank) 에서 올라온 경우
    RAW = {};
    for (const q of (await DB.get("meta", "bank")) || []) {
      const f = RAW[q.file] || (RAW[q.file] = { kind: q.source === "docx" ? "doc" : "sol", n: 0, items: [] });
      f.items.push(q); f.n++;
    }
    if (Object.keys(RAW).length) await saveRaw();
  }
  rebuild();
  renderBank();
}

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

function renderBank() {
  const s1 = $("s1"), fl = $("fl"), names = Object.keys(RAW);
  if (!names.length) {
    s1.innerHTML = ""; fl.innerHTML = ""; $("r1").hidden = true;
    setStep(1, "active"); setStep(2, "locked"); return;
  }
  const sol = BANK.filter((q) => q.source === "solution").length;
  const doc = BANK.length - sol;
  s1.innerHTML = `<span class="pill on">총 ${BANK.length}문제</span>` +
    (sol ? `<span class="pill">풀이 ${sol}문제</span>` : "") +
    (doc ? `<span class="pill">시험지 ${doc}문제</span>` : "");

  /* 파일마다 몇 문제가 실제로 쓰이는지 — 겹친 문제는 풀이 쪽으로 넘어간다 */
  const used = new Map();
  BANK.forEach((q) => used.set(q.file, (used.get(q.file) || 0) + 1));
  names.sort((a, b) => b.localeCompare(a, "ko"));
  fl.innerHTML = names.map((n) => {
    const f = RAW[n], u = used.get(n) || 0;
    const cnt = u === f.n ? `${f.n}문제` : `${f.n}문제 중 ${u}개`;
    return `<li class="fi">
      <span class="kind ${f.kind}">${f.kind === "sol" ? "풀이" : "시험지"}</span>
      <span class="nm" title="${esc(n)}">${esc(n)}</span>
      <span class="ct">${cnt}</span>
      <button class="x" data-f="${esc(n)}" aria-label="${esc(n)} 지우기" title="지우기">×</button>
    </li>`;
  }).join("");
  fl.querySelectorAll(".x").forEach((b) => { b.onclick = () => delFile(b.dataset.f); });
  $("r1").hidden = false;
  setStep(1, "done"); setStep(2, "active");

  const old = names.filter((n) => (RAW[n].v || 1) < PARSER_VER);
  $("old").hidden = !old.length;
  if (old.length) $("oldn").textContent = old.length + "개";
}

async function delFile(name) {
  const f = RAW[name];
  if (!f) return;
  delete RAW[name];
  if (f.kind === "sol") await DB.del("files", name);
  else for (const q of f.items) await DB.del("docx", q.id);
  rebuild();
  await saveRaw();
  err("e1", "");
  renderBank();
  if (!BANK.length) { CAND = []; VERDICTS = []; $("qs").innerHTML = ""; setStep(3, "locked"); setStep(4, "locked"); }
}

$("f1").onchange = async (ev) => {
  const files = [...ev.target.files]; ev.target.value = "";
  if (!files.length) return;
  err("e1", ""); $("b1").hidden = false;
  const bar = $("b1").firstElementChild;
  const skipped = [];

  for (let fi = 0; fi < files.length; fi++) {
    const f = files[fi];
    const name = nfc(f.name);                      // 자모 분리(NFD) 파일명 대응
    const meta = parseName(name);
    if (!meta) { skipped.push(`${name} — ${whyNoParse(name)}`); continue; }
    const buf = await f.arrayBuffer();

    if (/\.docx$/i.test(name)) {                   // 시험지 DOCX
      if (name.includes("풀이")) { skipped.push(name + " (풀이 DOCX는 지원하지 않음)"); continue; }
      let qs;
      try { qs = docxQuestions(buf); }
      catch (e) { skipped.push(name + " (DOCX 읽기 실패)"); continue; }
      if (!qs.length) { skipped.push(name + " (문제 0개)"); continue; }
      const items = [];
      for (const q of qs) {
        const id = `${meta.year}-${meta.term}-${meta.subject}-${q.num}`;
        await DB.put("docx", id, { stem: q.stem, presented: q.presented, choices: q.choices, images: q.images });
        items.push({
          id, year: meta.year, term: meta.term, subject: meta.subject, qnum: q.num,
          file: name, source: "docx", s: null, e: null,
          text: [q.stem, ...q.presented, ...q.choices.map((c, i) => `${i + 1}) ${c}`)].join("\n").slice(0, 1400),
        });
      }
      RAW[name] = { kind: "doc", v: PARSER_VER, n: items.length, items };
      bar.style.width = (((fi + 1) / files.length) * 100).toFixed(1) + "%";
      continue;
    }

    let texts;
    try {
      texts = await pageTexts(buf.slice(0), (p, n) => {
        bar.style.width = (((fi + p / n) / files.length) * 100).toFixed(1) + "%";
      });
    } catch (e) { skipped.push(name + " (읽기 실패)"); continue; }

    const blks = blocksOf(texts);
    if (!blks.length) { skipped.push(name + " (문제 0개)"); continue; }
    await DB.put("files", name, new Blob([buf], { type: "application/pdf" }));
    const items = blks.map((b) => ({
      id: `${meta.year}-${meta.term}-${meta.subject}-${b.qnum}`,
      year: meta.year, term: meta.term, subject: meta.subject, qnum: b.qnum,
      file: name, source: "solution", s: b.s, e: b.e,
      text: texts.slice(b.s, b.e).join("\n").trim().slice(0, 1400),
    }));
    RAW[name] = { kind: "sol", v: PARSER_VER, n: items.length, items };
  }
  bar.style.width = "100%";
  rebuild();
  await saveRaw();
  setTimeout(() => { $("b1").hidden = true; bar.style.width = "0"; }, 400);
  renderBank();
  if (skipped.length) err("e1", "건너뜀\n· " + skipped.join("\n· ") +
    "\n이름은 '2023 감면 기말 풀이.pdf' 또는 '2023 감면 기말.docx' 형식이어야 합니다.");
};

$("clr").onclick = async () => {
  await DB.clear("files"); await DB.clear("meta"); await DB.clear("docx");
  RAW = {}; BANK = []; CAND = []; VERDICTS = [];
  ["s2", "qs"].forEach((i) => ($(i).innerHTML = ""));
  ["e1", "e2", "e3", "e4"].forEach((i) => err(i, ""));
  $("ta").value = "";
  renderBank(); setStep(3, "locked"); setStep(4, "locked");
};

/* ── 2. 강의안 ────────────────────────────────────────────────── */
$("f2").onchange = async (ev) => {
  const f = ev.target.files[0]; ev.target.value = "";
  if (!f) return;
  err("e2", ""); LECNAME = nfc(f.name);
  $("s2").innerHTML = `<span class="pill">${LECNAME} 읽는 중…</span>`;
  let text;
  try {
    const buf = await f.arrayBuffer();
    text = (await pageTexts(buf)).join("\n");
  } catch (e) { err("e2", "PDF를 읽지 못했습니다."); $("s2").innerHTML = ""; return; }

  if (text.replace(/\s/g, "").length < 80) {
    err("e2", "텍스트가 거의 없는 강의안입니다(스캔 이미지). 아래 질문에는 후보가 덜 정확할 수 있으니, Claude 앱에서 강의안 첨부를 꼭 하세요.");
  }
  CAND = bm25(text, BANK, 80);
  $("s2").innerHTML = `<span class="pill on">${LECNAME}</span><span class="pill">후보 ${CAND.length}문제</span>`;
  setStep(2, "done"); setStep(3, "active");
  VERDICTS = []; $("qs").innerHTML = ""; setStep(4, "locked");
};

/* ── 3. 질문 만들기 / 답변 읽기 ───────────────────────────────── */
function buildPrompt() {
  const list = CAND.map((c) =>
    `### ${c.id}\n(${c.year} ${c.term} ${c.qnum}번)\n${c.text}`).join("\n\n");
  return `첨부한 강의안으로 **풀 수 있는** 기출문제만 골라 주세요.

판단 기준은 단어가 겹치는지가 아니라, **강의안 내용만으로 답을 고를 근거가 있는지**입니다.

각 문제를 셋 중 하나로 판정해 주세요.
- solvable : 강의안에 답을 고를 근거가 다 있음
- partial : 개념은 있으나 문제가 요구하는 세부(약제명·수치·예외)가 강의안에 없음
- unrelated : 무관하거나 다른 강의 범위

애매하면 partial 을 적극적으로 쓰세요. 억지로 둘로 가르지 마세요.
본문이 "복원실패"처럼 비어 있으면 unrelated 로 두세요.

답변 맨 마지막에 아래 형식의 JSON 배열 하나만 코드블록으로 넣어 주세요.
pages 는 근거가 된 강의안 쪽수, why 는 한 줄 이유입니다.

\`\`\`json
[{"id":"2023-기말-감면-6","verdict":"solvable","pages":"8-9","why":"역전사효소 억제제 목록이 강의안에 그대로 있음"}]
\`\`\`

---

## 후보 문제 ${CAND.length}개

${list}`;
}

$("cp").onclick = async () => {
  const t = buildPrompt();
  try { await navigator.clipboard.writeText(t); }
  catch (e) {
    const ta = document.createElement("textarea");
    ta.value = t; document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); ta.remove();
  }
  const b = $("cp"); const old = b.textContent;
  b.textContent = "복사됐습니다"; b.classList.add("ok");
  setTimeout(() => { b.textContent = old; b.classList.remove("ok"); }, 1600);
};

function grabJSON(s) {
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch (e) { /* fall through */ } }
  const i = s.indexOf("["), j = s.lastIndexOf("]");
  if (i >= 0 && j > i) { try { return JSON.parse(s.slice(i, j + 1)); } catch (e) { /* fall through */ } }
  return null;
}

$("rd").onclick = () => {
  err("e3", "");
  const raw = $("ta").value.trim();
  if (!raw) return err("e3", "붙여넣은 내용이 없습니다.");
  const arr = grabJSON(raw);
  if (!Array.isArray(arr)) return err("e3", "JSON을 찾지 못했습니다. Claude 답변 맨 아래의 코드블록을 통째로 복사해 주세요.");

  const byId = new Map(BANK.map((q) => [q.id, q]));
  VERDICTS = [];
  const miss = [];
  arr.forEach((v) => {
    const q = byId.get(v.id);
    if (!q) { miss.push(v.id); return; }
    const vd = ["solvable", "partial", "unrelated"].includes(v.verdict) ? v.verdict : "partial";
    VERDICTS.push({ ...q, verdict: vd, pages: v.pages || "", why: v.why || "" });
  });
  if (!VERDICTS.length) return err("e3", "일치하는 문제가 없습니다. 후보 목록과 다른 답변일 수 있습니다.");
  VERDICTS.sort((a, b) => b.year - a.year || TERM_ORD[a.term] - TERM_ORD[b.term] || a.qnum - b.qnum);
  if (miss.length) err("e3", `문제 은행에 없는 항목 ${miss.length}개는 건너뜁니다.`);
  renderVerdicts();
  setStep(3, "done"); setStep(4, "active");
  $("c4").scrollIntoView({ behavior: "smooth", block: "start" });
};

/* ── 4. 확인 & PDF ────────────────────────────────────────────── */
const LABEL = { solvable: "풀 수 있음", partial: "일부", unrelated: "무관" };
function renderVerdicts() {
  $("qs").innerHTML = VERDICTS.map((v, i) => `
    <li class="q ${v.verdict === "solvable" ? "sel" : ""}" data-i="${i}">
      <input type="checkbox" ${v.verdict === "solvable" ? "checked" : ""}>
      <div>
        <div class="meta">
          <span class="who">${v.year} ${v.term} ${v.qnum}번</span>
          <span class="kind ${v.source === "docx" ? "doc" : "sol"}">${v.source === "docx" ? "시험지" : "풀이"}</span>
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
  const doc = on.filter((li) => VERDICTS[+li.dataset.i].source === "docx").length;
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
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));

    // iOS 사파리는 <a download> 를 지원하지만, 샌드박스에 따라 막히기도 한다.
    // 그래서 '새 탭에서 열기' 버튼을 항상 함께 남겨 둔다 — 사파리가 PDF를 그려 주면
    // 공유 시트로 '파일에 저장' 할 수 있어 어느 환경에서든 통한다.
    try {
      const a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { /* 아래 열기 버튼으로 대체 */ }

    const open = $("op");
    open.hidden = false;
    open.onclick = () => window.open(url, "_blank");
    $("dl4").textContent = picks.length + "문제 · " + (bytes.length / 1048576).toFixed(1) + "MB";
    setTimeout(() => URL.revokeObjectURL(url), 600000);
    btn.textContent = "다시 만들기"; btn.disabled = false;
    setStep(4, "done");
  } catch (e) {
    err("e4", "만들지 못했습니다 — " + e.message);
    btn.textContent = "PDF 만들기"; btn.disabled = false;
  }
};

loadBank();
})();
