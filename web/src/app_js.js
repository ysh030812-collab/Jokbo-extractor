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

/* 이어지는 장/해설 장인가 — 문제 화면을 고를 때 계속 쓰는 판정 */
const isCont = (t) => {
  const mk = RE_MARK.exec(t || "");
  return (mk && +mk[1] > 1) || RE_ANS.test((t || "").trim());
};

function scanStarts(texts, strict) {
  const out = []; let last = 0;
  texts.forEach((t, i) => {
    if (isCont(t)) return;                     // 이어지는 슬라이드 · 해설 슬라이드
    const head = "\n" + t.split("\n").filter((l) => l.trim()).slice(0, 4).join("\n");
    const re = qnumRe(strict); let m, pick = null;
    while ((m = re.exec(head))) {
      if (m[1].length > 3) continue;           // 연도 등 4자리 이상은 문제번호 아님
      const n = +m[1];
      if (n > last && n <= 400) { pick = n; break; }
    }
    if (pick === null) {
      /* 번호를 못 읽었다. 문제 화면을 통째로 캡처한 슬라이드가 이렇다.
         바로 앞이 해설·출처 장이면 새 문제가 시작된 자리로 본다. 번호는
         억지로 추정하지 않고 쪽 번호로 식별한다 — 원본 슬라이드는 그 쪽을
         그대로 쓰므로 결과물은 온전하고, 잘못된 번호가 붙지 않는다. */
      if (out.length && t.replace(/\s/g, "").length < 20 && i > 0 && isCont(texts[i - 1]))
        out.push([i, null]);
      return;
    }
    out.push([i, pick]); last = pick;
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
  let lastNum = 0;
  return st.map(([pg, num], i) => {
    const e = i + 1 < st.length ? st[i + 1][0] : texts.length;
    /* 번호를 모르는 문제도 원래 자리에 오도록 정렬 키를 따로 둔다 */
    const ord = num != null ? (lastNum = num) : lastNum + 0.5;
    return { qnum: num, page: pg + 1, ord, s: pg, e, qp: questionPages(texts, pg, e) };
  });
}

/* 화면·PDF에 쓰는 문제 이름. 번호를 못 읽은 그림 문제는 쪽으로 부른다. */
const qlabel = (q) => (q.qnum != null ? `${q.qnum}번` : `${q.page}쪽`);

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

/* ── 상태 ─────────────────────────────────────────────────────── */
/* RAW 는 파일별 원본 추출 결과, BANK 는 그것을 합쳐 중복을 정리한 것.
   파일 하나만 지워도 나머지가 정확히 복원되도록 원본을 따로 들고 있는다. */
let RAW = {}, BANK = [], VERDICTS = [], LECNAME = "";

const setStep = (n, state) => {
  const c = $("c" + n);
  c.classList.remove("locked", "active", "done");
  if (state) c.classList.add(state);
};
const err = (id, msg) => { $(id).textContent = msg || ""; };

/* ── 1. 족보 등록 ─────────────────────────────────────────────── */
/* 파서를 고쳐도 이미 등록된 파일은 예전 결과 그대로 남는다. 파일마다 어느 판으로
   읽었는지 적어 두고, 낡았으면 다시 올리라고 알려 준다. 올리기 전에는 지우지 않는다. */
const PARSER_VER = 3;
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
  setStep(1, "done"); setStep(3, "active");
  renderProject();

  const old = names.filter((n) => (RAW[n].v || 1) < PARSER_VER);
  $("old").hidden = !old.length;
  if (old.length) $("oldn").textContent = old.length + "개";
}

async function delFile(name) {
  const f = RAW[name];
  if (!f) return;
  delete RAW[name];
  MADE = [];
  if (f.kind === "sol") await DB.del("files", name);
  else for (const q of f.items) await DB.del("docx", q.id);
  rebuild();
  await saveRaw();
  err("e1", "");
  renderBank();
  if (!BANK.length) { VERDICTS = []; $("qs").innerHTML = ""; setStep(3, "locked"); setStep(4, "locked"); }
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
          id, year: meta.year, term: meta.term, subject: meta.subject,
          qnum: q.num, page: null, ord: q.num,
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
      id: `${meta.year}-${meta.term}-${meta.subject}-${b.qnum != null ? b.qnum : "p" + b.page}`,
      year: meta.year, term: meta.term, subject: meta.subject,
      qnum: b.qnum, page: b.page, ord: b.ord,
      file: name, source: "solution", s: b.s, e: b.e, qp: b.qp,
      text: texts.slice(b.s, b.e).join("\n").trim().slice(0, 1400),
    }));
    RAW[name] = { kind: "sol", v: PARSER_VER, n: items.length, items };
  }
  bar.style.width = "100%";
  rebuild();
  MADE = [];                                     // 족보가 바뀌었으니 색인도 다시 만들어야 한다
  await saveRaw();
  setTimeout(() => { $("b1").hidden = true; bar.style.width = "0"; }, 400);
  renderBank();
  if (skipped.length) err("e1", "건너뜀\n· " + skipped.join("\n· ") +
    "\n이름은 '2023 감면 기말 풀이.pdf' 또는 '2023 감면 기말.docx' 형식이어야 합니다.");
};

$("clr").onclick = async () => {
  await DB.clear("files"); await DB.clear("meta"); await DB.clear("docx");
  RAW = {}; BANK = []; VERDICTS = []; MADE = [];
  ["s2", "s3", "pf", "qs"].forEach((i) => ($(i).innerHTML = ""));
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
    const q = f.items[0]; if (!q) continue;
    const key = `${q.year}-${q.term}-${q.subject}`;
    if (f.kind === "doc") haveDocx.add(key);
    else sol.set(name, { year: q.year, term: q.term, subject: q.subject, key });
  }
  const asis = Object.keys(RAW).filter((n) => RAW[n].kind === "doc").sort().reverse();
  const need = [...sol.entries()].filter(([, m]) => !haveDocx.has(m.key))
    .sort((a, b) => b[1].year - a[1].year);
  return { asis, need };
}

let MADE = [];                                   // 이번에 만든 색인 파일들

function renderProject() {
  const { asis, need } = planProject();
  const pf = $("pf"), s2 = $("s2");
  if (!asis.length && !need.length) { pf.innerHTML = ""; s2.innerHTML = ""; return; }
  s2.innerHTML = `<span class="pill on">올릴 파일 ${asis.length + MADE.length}개</span>` +
    (need.length && !MADE.length ? `<span class="pill">색인 만들 연도 ${need.length}개</span>` : "");

  const rows = asis.map((n) => `<li class="fi">
      <span class="kind doc">그대로</span>
      <span class="nm" title="${esc(n)}">${esc(n)}</span>
      <span class="ct">${RAW[n].n}문제</span>
    </li>`);
  MADE.forEach((f, i) => rows.push(`<li class="fi">
      <span class="kind sol">색인</span>
      <span class="nm" title="${esc(f.name)}">${esc(f.name)}</span>
      <span class="ct">${f.count}문제 · ${f.pages}쪽 · ${(f.bytes.length / 1048576).toFixed(1)}MB</span>
      <button class="x" data-i="${i}" aria-label="${esc(f.name)} 내려받기" title="내려받기">↓</button>
    </li>`));
  pf.innerHTML = rows.join("");
  pf.querySelectorAll(".x").forEach((b) => { b.onclick = () => saveMade(+b.dataset.i); });

  const ready = asis.length > 0 || MADE.length > 0;
  $("pn").hidden = !ready;
  $("cpins").hidden = !ready;
  /* 색인을 만들 연도가 남아 있으면 아직 할 일이 있다는 뜻 */
  setStep(2, need.length && !MADE.length ? "active" : ready ? "done" : "active");
  $("mkidx").hidden = !need.length;
}

function saveMade(i) {
  const f = MADE[i]; if (!f) return;
  const url = URL.createObjectURL(new Blob([f.bytes], { type: "application/pdf" }));
  try {
    const a = document.createElement("a");
    a.href = url; a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { /* 아래 새 탭으로 대체 */ }
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 600000);
}

$("mkidx").onclick = async () => {
  err("e2", "");
  const { need } = planProject();
  const btn = $("mkidx"); btn.disabled = true;
  if (!need.length) {
    MADE = [];
    btn.disabled = false; btn.textContent = "Project에 올릴 파일 만들기";
    renderProject();
    return err("e2", "시험지 파일이 모든 연도에 있어 따로 만들 것이 없습니다. 위 파일을 그대로 올리세요.");
  }
  btn.textContent = "만드는 중…";
  $("b2").hidden = false;
  const bar = $("b2").firstElementChild;
  MADE = [];
  try {
    for (let i = 0; i < need.length; i++) {
      const [name] = need[i];
      const files = await buildProjectIndex(name, RAW[name].items, (r) => {
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
    const q = byId.get(nfc(v.id || ""));
    if (!q) { if (v.id) miss.push(v.id); return; }
    const vd = ["solvable", "partial", "unrelated"].includes(v.verdict) ? v.verdict : "partial";
    VERDICTS.push({ ...q, verdict: vd, pages: v.pages || "", why: v.why || "" });
  });
  if (!VERDICTS.length) {
    return err("e3", "등록된 족보와 일치하는 문제가 없습니다." +
      (miss.length ? `\n받은 id: ${miss.slice(0, 3).join(", ")}${miss.length > 3 ? " …" : ""}` +
        "\n id 는 '2023-기말-감면-6' 형식이어야 하고, 그 족보가 1단계에 등록돼 있어야 합니다." : ""));
  }
  VERDICTS.sort((a, b) => b.year - a.year || TERM_ORD[a.term] - TERM_ORD[b.term] || (a.ord ?? a.qnum) - (b.ord ?? b.qnum));
  if (miss.length) err("e3", `문제 은행에 없는 항목 ${miss.length}개는 건너뜁니다 — ${miss.slice(0, 3).join(", ")}${miss.length > 3 ? " …" : ""}`);
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
          <span class="who">${v.year} ${v.term} ${qlabel(v)}</span>
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
