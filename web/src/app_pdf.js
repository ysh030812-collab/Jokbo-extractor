/* ── DOCX 파싱 + PDF 조판 ──────────────────────────────────────────
   한글 텍스트는 캔버스로 그려 PNG 로 얹는다. 한글 TTF(수 MB)를 인라인하지
   않고도 조판을 완전히 통제할 수 있고, 슬라이드 원본은 벡터 그대로 남는다. */

const NS = {
  w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  mc: "http://schemas.openxmlformats.org/markup-compatibility/2006",
};
const NUMBERED = /^\s*(\d{1,3})\s*번?\s*[.)．]\s*(.*)$/;
const DASH = /^\s*[-–—•*·]\s*(.+)$/;
const CIRC = /^\s*([①②③④⑤⑥⑦⑧⑨⑩])\s*(.+)$/;
const KOX = /^\s*[가나다라마바사아자차]\s*[.)]\s*(.+)$/;
const JAMO = /^\s*[ㄱ-ㅎ]\s*[.)]\s*(.+)$/;

/* 구분점을 빠뜨린 문제 머리 — 실제 족보에 "144다음 중 …" 처럼 나온다.
   바로 다음 번호일 때만 인정하고, 숫자 뒤에 단위·조사가 붙으면 거른다. */
const LOOSE_NUM = /^\s*(\d{1,3})\s*([가-힣A-Za-z][^\n]{5,})$/;
const COUNTER = /^(개월|가지|시간|단계|퍼센트|개|명|번|째|쪽|장|년|월|일|주|시|분|초|차|회|배|종|세|도|형|군|위|대|층|등|인|병|살|kg|mg|ml|cm|mm|%)/;
/* Word 설문 서식이 문제마다 끼워 넣는 안내문 — 선지도 제시문도 아니다 */
const NOISE = /^\s*하나를\s*(선택|고르)/;
/* 질문 끝맺음. 번호가 통째로 빠진 1번 문제를 되살릴 때만 쓴다. */
const isStem = (l) => /\?\s*$/.test(l);

/* 문단 → 물리적 줄. mc:Fallback 과 w:txbxContent 하위는 건너뛴다.
   둘 다 내려가면 텍스트 상자 내용이 2~3번 중복된다 (파이썬판과 같은 수정). */
function paraLines(p) {
  const parts = [];
  (function walk(el) {
    for (const n of el.childNodes) {
      if (n.nodeType !== 1) continue;
      const ln = n.localName, ns = n.namespaceURI;
      if (ns === NS.mc && ln === "Fallback") continue;
      if (ns === NS.w && ln === "txbxContent") continue;
      if (ns === NS.w && ln === "t") { parts.push(n.textContent || ""); continue; }
      if (ns === NS.w && (ln === "br" || ln === "cr")) { parts.push("\n"); continue; }
      if (ns === NS.w && ln === "tab") { parts.push(" "); continue; }
      walk(n);
    }
  })(p);
  return parts.join("").split("\n").map((s) => s.trim());
}

function paraImages(p, rels, files) {
  const out = [], seen = new Set();
  for (const b of p.getElementsByTagNameNS(NS.a, "blip")) {
    const id = b.getAttributeNS(NS.r, "embed") || b.getAttributeNS(NS.r, "link");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const t = rels[id]; if (!t) continue;
    const path = "word/" + String(t).replace(/^\/?word\//, "");
    if (files[path]) out.push(files[path]);
  }
  return out;
}

const stripMark = (l) => {
  for (const rx of [DASH, CIRC, NUMBERED, KOX, JAMO]) {
    const m = rx.exec(l); if (m) return m[m.length - 1].trim();
  }
  return l;
};
const isAnno = (l) => {
  const s = l.trim();
  return s.length >= 2 && "(([".includes(s[0]) && "))]".includes(s[s.length - 1])
    && !KOX.test(s) && !JAMO.test(s);
};
const isBogiHead = (l) => {
  const s = l.replace(/\s/g, "");
  return ["<보기", "(보기", "[보기", "보기>", "보기]"].some((p) => s.startsWith(p));
};

/* 어느 표기가 선지인지 — 가장 많이 쓰인 쪽을 고른다. 우선순위 고정으로 하면
   제시문에 "- " 한 줄이 섞였을 때 정작 1)~5) 선지가 통째로 제시문이 된다. */
function pickRx(lines) {
  let rx = null, best = 0;
  for (const c of [CIRC, NUMBERED, DASH]) {
    const n = lines.filter((l) => c.test(l)).length;
    if (n > best) { best = n; rx = c; }
  }
  return rx;
}

function classify(items) {
  const lines = items.map((i) => i[0]).filter(Boolean);
  if (!lines.length) return [[], []];
  const rx = pickRx(lines);
  const pres = [], ch = [];
  if (rx === NUMBERED) {
    /* 숫자 선지는 1부터 연달아 붙는다. 본문에 섞인 "300." 같은 줄이
       선지 사이에 끼어들지 않도록 이어지는 번호만 선지로 본다. */
    let want = null;
    for (const l of lines) {
      const m = rx.exec(l), n = m ? +m[1] : 0;
      if (m && want === null && n <= 5) want = n;
      if (m && n === want) { ch.push(m[2].trim()); want++; } else pres.push(l);
    }
    return [pres, ch];
  }
  if (rx) {
    for (const l of lines) {
      const m = rx.exec(l);
      if (m) ch.push(m[m.length - 1].trim()); else pres.push(l);
    }
    return [pres, ch];
  }
  if (items.some((i) => i[1])) {
    for (const [t, isL] of items) (isL ? ch : pres).push(isL ? stripMark(t) : t);
    return [pres, ch];
  }
  for (const l of lines) {
    if (isAnno(l) || KOX.test(l) || JAMO.test(l) || isBogiHead(l)) pres.push(l);
    else ch.push(stripMark(l));
  }
  return [pres, ch];
}

/* DOCX → [{num, stem, presented, choices, images}] */
function docxQuestions(buf) {
  const files = fflate.unzipSync(new Uint8Array(buf));
  const dec = new TextDecoder();
  const rels = {};
  if (files["word/_rels/document.xml.rels"]) {
    const rd = new DOMParser().parseFromString(dec.decode(files["word/_rels/document.xml.rels"]), "application/xml");
    for (const r of rd.getElementsByTagName("Relationship")) rels[r.getAttribute("Id")] = r.getAttribute("Target");
  }
  const doc = new DOMParser().parseFromString(dec.decode(files["word/document.xml"]), "application/xml");
  const body = doc.getElementsByTagNameNS(NS.w, "body")[0];
  if (!body) return [];

  const paras = [...body.getElementsByTagNameNS(NS.w, "p")].filter((p) => {
    for (let a = p.parentNode; a && a !== body; a = a.parentNode)
      if (a.namespaceURI === NS.mc && a.localName === "Fallback") return false;
    return true;
  });

  const qs = new Map();
  let cur = null, expect = 1, maxNum = 0;
  const pre = [], preImgs = [];        // 첫 문제 번호가 나오기 전에 지나간 것들

  const startQ = (n, stem) => {
    cur = { num: n, stem: (stem || "").trim(), _body: [], images: [] };
    qs.set(n, cur); expect = 1; maxNum = Math.max(maxNum, n);
    return cur;
  };
  const isNew = (n) => n >= 1 && n <= 400 && (!cur || n > maxNum);
  /* 이어지는 선지인가. 문제 번호는 항상 커지므로 지금까지 나온 최대 번호보다
     작으면 새 문제일 수 없다 — 선지가 6개를 넘는 문제(실제 족보에 16개짜리가
     있다)도 이 규칙이면 끝까지 선지로 남는다. 앞쪽 문제라 그 판정이 안 되는
     구간에서만 "선지는 다섯 개까지"라는 통념을 쓴다. */
  const isChoice = (n) => cur && n === expect && (expect <= 5 || n <= maxNum);
  /* 번호가 통째로 빠진 1번 문제 — 앞서 버려지던 줄에서 되살린다 */
  const stemAt = () => pre.findIndex(([t]) => isStem(t));
  const adoptPre = (from) => {
    const rest = pre.slice(from);
    startQ(1, rest[0][0]);
    for (const it of rest.slice(1)) cur._body.push(it);
    cur.images.push(...preImgs);
  };

  for (const p of paras) {
    const lines = paraLines(p);
    const imgs = paraImages(p, rels, files);
    const isList = p.getElementsByTagNameNS(NS.w, "numPr").length > 0;
    for (const ln of lines) {
      if (!ln || NOISE.test(ln)) continue;
      const m = NUMBERED.exec(ln);
      if (m) {
        const n = +m[1];
        if (isChoice(n)) { cur._body.push([ln, isList]); expect++; continue; }
        /* 1번 문제만 번호 없이 시작하고 선지부터 "1." 로 매겨진 족보가 있다.
           앞에 물음표로 끝나는 줄이 남아 있으면 그 줄이 진짜 1번 지문이다. */
        if (!cur && n === 1 && !isStem(m[2] || "")) {
          const at = stemAt();
          if (at >= 0) { adoptPre(at); cur._body.push([ln, isList]); expect = 2; continue; }
        }
        if (isNew(n)) { startQ(n, m[2]); continue; }
        if (cur) cur._body.push([ln, isList]);
        continue;
      }
      const lm = LOOSE_NUM.exec(ln);
      if (lm && +lm[1] === maxNum + 1 && !COUNTER.test(lm[2])) { startQ(+lm[1], lm[2]); continue; }
      if (cur) cur._body.push([ln, isList]);
      else pre.push([ln, isList]);
    }
    if (imgs.length) (cur ? cur.images : preImgs).push(...imgs);
  }
  /* 선지까지 Word 목록(numPr)이라 "1." 이 글자로 안 남은 경우의 1번 복구 */
  if (!qs.has(1) && qs.size && Math.min(...qs.keys()) === 2) {
    const at = stemAt();
    if (at >= 0) adoptPre(at);
  }
  for (const q of qs.values()) {
    const [pres, ch] = classify(q._body);
    q.presented = pres; q.choices = ch; delete q._body;
  }
  return [...qs.values()].sort((a, b) => a.num - b.num);
}

/* ── 캔버스 조판 ─────────────────────────────────────────────────── */
const PW = 842, PH = 595;                       // A4 가로 — 문서 전체 통일
const INK = "#191F28", MUTE = "#8B95A1", ACC = "#3182F6";
const FONT = '-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif';

async function decorPng(draw, w = PW, h = PH, scale = 2.5) {
  const c = document.createElement("canvas");
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  const g = c.getContext("2d");
  g.scale(scale, scale);
  draw(g, w, h);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r); g.closePath();
}

/* 한글은 글자 단위, 영문은 단어 단위로 끊어 줄바꿈 */
function wrapText(g, text, maxW) {
  const toks = String(text).match(/[A-Za-z0-9][A-Za-z0-9'’\-.()/]*|\s+|[^\s]/g) || [];
  const out = []; let line = "";
  for (const t of toks) {
    const next = line + t;
    if (g.measureText(next).width > maxW && line.trim()) {
      out.push(line.trimEnd()); line = /^\s+$/.test(t) ? "" : t;
    } else line = next;
  }
  if (line.trim()) out.push(line.trimEnd());
  return out;
}

const VLABEL = { solvable: ["풀 수 있음", "#00A661", "#E4F7EF"], partial: ["일부", "#C77700", "#FDF3E3"], unrelated: ["참고", "#6B7684", "#F1F3F5"] };

/* 문제 페이지의 배경·라벨·카드 테두리 (슬라이드는 이 위에 벡터로 얹는다) */
function decorQuestion(q, slots, pageNo, part) {
  return (g) => {
    g.fillStyle = "#F7F8FA"; g.fillRect(0, 0, PW, PH);
    for (const [x, yb, w, h] of slots) {
      const y = PH - yb - h;                      // PDF(하단원점) → 캔버스(상단원점)
      g.fillStyle = "#FFFFFF"; roundRect(g, x, y, w, h, 8); g.fill();
      g.strokeStyle = "#E5E8EB"; g.lineWidth = 1; g.stroke();
    }
    g.fillStyle = ACC; roundRect(g, 18, 15, 3, 15, 1.5); g.fill();
    g.font = `700 13.5px ${FONT}`; g.fillStyle = INK; g.textBaseline = "middle";
    const head = `${examName(q)}  ${qlabel(q)}`;
    g.fillText(head, 29, 23);
    let x = 29 + g.measureText(head).width + 9;
    const [txt, fg, bg] = VLABEL[q.verdict] || VLABEL.partial;
    g.font = `700 10.5px ${FONT}`;
    const cw = g.measureText(txt).width + 13;
    g.fillStyle = bg; roundRect(g, x, 16, cw, 15, 4); g.fill();
    g.fillStyle = fg; g.fillText(txt, x + 6.5, 23.5);
    x += cw + 7;
    if (q.pages) {
      const p = `강의안 ${q.pages}쪽`;
      const pw = g.measureText(p).width + 13;
      g.fillStyle = "#E8F2FE"; roundRect(g, x, 16, pw, 15, 4); g.fill();
      g.fillStyle = "#1B64DA"; g.fillText(p, x + 6.5, 23.5);
    }
    if (part) {
      g.font = `600 10.5px ${FONT}`; g.fillStyle = MUTE;
      g.textAlign = "right"; g.fillText(part, PW - 18, 23); g.textAlign = "left";
    }
    g.font = `500 9.5px ${FONT}`; g.fillStyle = MUTE;
    g.textAlign = "right"; g.fillText(String(pageNo), PW - 18, PH - 12); g.textAlign = "left";
  };
}

/* DOCX 문제 — 텍스트를 직접 조판한 한 페이지 */
function decorDocx(q, data, pageNo, imgBoxes) {
  return (g) => {
    g.fillStyle = "#F7F8FA"; g.fillRect(0, 0, PW, PH);
    const M = 56, CW = PW - M * 2;
    g.fillStyle = "#FFFFFF"; roundRect(g, 30, 44, PW - 60, PH - 76, 12); g.fill();
    g.strokeStyle = "#E5E8EB"; g.lineWidth = 1; g.stroke();

    g.textBaseline = "middle";
    g.fillStyle = ACC; roundRect(g, 18, 15, 3, 15, 1.5); g.fill();
    g.font = `700 13.5px ${FONT}`; g.fillStyle = INK;
    const head = `${examName(q)}  ${qlabel(q)}`;
    g.fillText(head, 29, 23);
    let hx = 29 + g.measureText(head).width + 9;
    const [txt, fg, bg] = VLABEL[q.verdict] || VLABEL.partial;
    g.font = `700 10.5px ${FONT}`;
    const cw = g.measureText(txt).width + 13;
    g.fillStyle = bg; roundRect(g, hx, 16, cw, 15, 4); g.fill();
    g.fillStyle = fg; g.fillText(txt, hx + 6.5, 23.5);
    hx += cw + 7;
    if (q.pages) {
      const pg = `강의안 ${q.pages}쪽`;
      const pw = g.measureText(pg).width + 13;
      g.fillStyle = "#E8F2FE"; roundRect(g, hx, 16, pw, 15, 4); g.fill();
      g.fillStyle = "#1B64DA"; g.fillText(pg, hx + 6.5, 23.5);
    }
    g.font = `600 10.5px ${FONT}`; g.fillStyle = MUTE; g.textAlign = "right";
    g.fillText("시험지 재구성", PW - 18, 23); g.textAlign = "left";

    g.textBaseline = "alphabetic";
    let y = 78;
    const numTxt = q.qnum + ".";
    g.font = `700 14px ${FONT}`; g.fillStyle = ACC;
    g.fillText(numTxt, M, y);
    const indent = Math.max(26, g.measureText(numTxt).width + 9);
    g.font = `400 13.5px ${FONT}`; g.fillStyle = INK;
    for (const l of wrapText(g, data.stem || "", CW - indent)) { g.fillText(l, M + indent, y); y += 21; }
    y += 5;

    if (imgBoxes) for (const b of imgBoxes) { b.y = y; y += b.h + 10; }

    g.font = `400 12.5px ${FONT}`; g.fillStyle = "#4E5968";
    for (const t of (data.presented || [])) {
      for (const l of wrapText(g, t, CW - indent)) { g.fillText(l, M + indent, y); y += 19; }
    }
    if ((data.choices || []).length) y += 6;
    (data.choices || []).forEach((c, i) => {
      g.font = `600 12.5px ${FONT}`; g.fillStyle = "#6B8CAD";
      g.fillText(`${i + 1})`, M + indent, y);
      g.font = `400 12.5px ${FONT}`; g.fillStyle = INK;
      for (const l of wrapText(g, c, CW - indent - 24)) { g.fillText(l, M + indent + 24, y); y += 19; }
      y += 2;
    });

    g.font = `500 9.5px ${FONT}`; g.fillStyle = MUTE; g.textAlign = "right";
    g.fillText(String(pageNo), PW - 18, PH - 12); g.textAlign = "left";
  };
}

function decorCover(title, n, years) {
  return (g) => {
    g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, PW, PH);
    g.fillStyle = "#F2F6FC"; g.beginPath(); g.arc(PW - 90, 90, 190, 0, 7); g.fill();
    g.fillStyle = ACC; roundRect(g, 64, 196, 46, 5, 2.5); g.fill();
    g.textBaseline = "alphabetic";
    g.font = `800 15px ${FONT}`; g.fillStyle = ACC;
    g.fillText("기출 발췌", 64, 182);
    g.font = `800 34px ${FONT}`; g.fillStyle = INK;
    let y = 248;
    for (const l of wrapText(g, title, PW - 210).slice(0, 3)) { g.fillText(l, 64, y); y += 44; }
    g.font = `500 14px ${FONT}`; g.fillStyle = MUTE;
    g.fillText(`문제 ${n}개  ·  ${years}`, 64, y + 12);
    g.font = `500 11.5px ${FONT}`;
    g.fillText(new Date().toLocaleDateString("ko-KR"), 64, PH - 48);
  };
}

function decorDivider(year, rest) {
  return (g) => {
    g.fillStyle = "#F7F8FA"; g.fillRect(0, 0, PW, PH);
    g.textBaseline = "alphabetic";
    g.font = `800 92px ${FONT}`; g.fillStyle = INK;
    g.fillText(String(year), 64, PH / 2 + 12);
    const w = g.measureText(String(year)).width;
    g.fillStyle = ACC; roundRect(g, 66, PH / 2 + 34, 92, 6, 3); g.fill();
    g.fillStyle = "#C6CDD6"; roundRect(g, 166, PH / 2 + 34, 34, 6, 3); g.fill();
    g.font = `600 19px ${FONT}`; g.fillStyle = MUTE;
    if (rest) g.fillText(rest, 70 + w + 16, PH / 2 + 12);   // 학기가 없는 시험도 있다
  };
}

/* 슬라이드 n장을 한 페이지에 놓을 자리 (PDF 좌표: 좌하단 원점) */
function slotsFor(n) {
  const m = 18, top = 34, gap = 10;
  const x0 = m, y0 = m, w = PW - m * 2, h = PH - m - top - m;
  if (n <= 1) return [[x0, y0, w, h]];
  const cw = (w - gap) / 2, ch = (h - gap) / 2;
  if (n === 2) return [[x0, y0, cw, h], [x0 + cw + gap, y0, cw, h]];
  if (n === 3) {
    /* 강의 슬라이드는 가로가 길다(4:3, 16:9). 세로로 긴 칸에 넣으면 폭이 아니라
       높이에 걸려 오히려 작아지고 위아래가 빈다. 문제 슬라이드에 폭을 통째로
       주는 편이 실제로 더 크게 나온다. */
    const h1 = Math.round(h * 0.63), h2 = h - h1 - gap;
    return [[x0, y0 + h2 + gap, w, h1], [x0, y0, cw, h2], [x0 + cw + gap, y0, cw, h2]];
  }
  return [[x0, y0 + ch + gap, cw, ch], [x0 + cw + gap, y0 + ch + gap, cw, ch],
          [x0, y0, cw, ch], [x0 + cw + gap, y0, cw, ch]];
}

/* 회전(/Rotate)을 반영해 슬롯에 맞춰 그린다 */
function placePage(page, emb, srcPage, slot) {
  const [x, y, sw, sh] = slot;
  const rot = ((srcPage.getRotation().angle % 360) + 360) % 360;
  let ew = emb.width, eh = emb.height;
  if (rot === 90 || rot === 270) { const t = ew; ew = eh; eh = t; }
  const s = Math.min(sw / ew, sh / eh) * 0.985;
  const dw = ew * s, dh = eh * s;
  const bx = x + (sw - dw) / 2, by = y + (sh - dh) / 2;
  const d = PDFLib.degrees;
  if (rot === 90) page.drawPage(emb, { x: bx + dw, y: by, xScale: s, yScale: s, rotate: d(90) });
  else if (rot === 180) page.drawPage(emb, { x: bx + dw, y: by + dh, xScale: s, yScale: s, rotate: d(180) });
  else if (rot === 270) page.drawPage(emb, { x: bx, y: by + dh, xScale: s, yScale: s, rotate: d(270) });
  else page.drawPage(emb, { x: bx, y: by, xScale: s, yScale: s });
}

const addDecor = async (out, draw, w = PW, h = PH) => {
  const page = out.addPage([w, h]);
  page.drawImage(await out.embedPng(await decorPng(draw, w, h)), { x: 0, y: 0, width: w, height: h });
  return page;
};

/* ── 최종 PDF 조립 ───────────────────────────────────────────────── */
async function buildPDF(picks, title) {
  const out = await PDFLib.PDFDocument.create();
  const warnings = [];
  const years = [...new Set(picks.map((p) => `${p.year} ${p.term}`))].join(" · ");
  await addDecor(out, decorCover(title || "기출 발췌", picks.length, years));

  /* 필요한 페이지를 파일별로 모아 embedPages 를 딱 한 번씩만 부른다.
     문제마다 부르면 원본의 폰트·이미지가 매번 복사돼 결과가 3배로 커진다. */
  const need = new Map();
  for (const q of picks) {
    if (q.source === "docx") continue;
    if (!need.has(q.file)) need.set(q.file, new Set());
    const set = need.get(q.file);
    for (let i = q.s; i < q.e; i++) set.add(i);
  }
  const embMap = new Map();
  for (const [file, set] of need) {
    const blob = await DB.get("files", file);
    if (!blob) throw new Error(`원본 파일이 없습니다: ${file}`);
    const src = await PDFLib.PDFDocument.load(await blob.arrayBuffer());
    const idx = [...set].sort((a, b) => a - b).filter((i) => i < src.getPageCount());
    const pages = idx.map((i) => src.getPage(i));
    let annots = 0;
    for (const pg of pages) {
      try { const a = pg.node.Annots(); if (a && a.size && a.size()) annots += a.size(); } catch (e) { /* 없으면 무시 */ }
    }
    if (annots) warnings.push(`${file}: 원본의 형광펜·메모 ${annots}개는 옮겨지지 않습니다 (슬라이드 내용은 그대로 들어갑니다).`);
    const embs = pages.length ? await out.embedPages(pages) : [];
    const m = new Map();
    idx.forEach((i, k) => m.set(i, { emb: embs[k], src: pages[k] }));
    embMap.set(file, m);
  }

  const docxCache = new Map();
  let lastKey = null, pageNo = 1;

  for (const q of picks) {
    const key = examKey(q);
    if (key !== lastKey) {
      await addDecor(out, decorDivider(q.year, [q.subject, q.term].filter(Boolean).join(" ")));
      lastKey = key;
    }

    if (q.source === "docx") {
      if (!docxCache.has(q.id)) docxCache.set(q.id, await DB.get("docx", q.id));
      const data = docxCache.get(q.id);
      if (!data) continue;
      const imgs = [];
      for (const raw of (data.images || []).slice(0, 2)) {
        try {
          const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
          const img = bytes[0] === 0x89 ? await out.embedPng(bytes) : await out.embedJpg(bytes);
          const w = Math.min(420, img.width * 0.75), h = w * img.height / img.width;
          imgs.push({ img, w, h: Math.min(h, 210) });
        } catch (e) { /* 지원하지 않는 이미지 형식은 건너뛴다 */ }
      }
      const page = await addDecor(out, decorDocx(q, data, pageNo, imgs));
      for (const b of imgs) if (b.y != null) page.drawImage(b.img, { x: 82, y: PH - b.y - b.h, width: b.w, height: b.h });
      pageNo++;
      continue;
    }

    const m = embMap.get(q.file);
    if (!m) continue;
    const idx = [];
    for (let i = q.s; i < q.e; i++) if (m.has(i)) idx.push(i);
    if (!idx.length) continue;

    for (let c = 0; c < idx.length; c += 4) {
      const chunk = idx.slice(c, c + 4);
      const part = idx.length > 4 ? `${c / 4 + 1} / ${Math.ceil(idx.length / 4)}` : "";
      const slots = slotsFor(chunk.length);
      const page = await addDecor(out, decorQuestion(q, slots, pageNo, part));
      chunk.forEach((i, k) => { const e = m.get(i); placePage(page, e.emb, e.src, slots[k]); });
      pageNo++;
    }
  }
  return { bytes: await out.save(), warnings };
}

/* ── Claude Project 지식용 분할 ────────────────────────────────
   시험지 DOCX 가 없는 연도는 풀이 PDF 밖에 없다. 26~37MB · 500쪽이라 Project 에
   통째로는 못 올린다 (요청 32MB · 100쪽 한도).

   예전에는 '문제 화면'만 골라 색인을 만들었는데, 어느 슬라이드가 문제이고 어느
   것이 해설·출처인지 코드가 추측해야 했다. 추측이 빗나갈 때마다 엉뚱한 id 가
   찍히거나 문제가 통째로 사라졌다 (실제로 p513 이 열여섯 장 찍혔다).

   그래서 추측을 그만두고 **원본을 그대로 쪼개기만** 한다. 쪽마다 원본 쪽번호를
   찍어 두면, 어느 슬라이드가 한 문제인지는 Claude 가 직접 보고 판단해 쪽 범위로
   답한다. 이쪽이 규칙보다 훨씬 정확하고, 틀려도 화면에서 바로 보인다. */
const IDX_BAND = 26;                       // 쪽마다 얹는 쪽번호 띠의 높이(pt)
const IDX_MAX_PAGES = 90;                  // 요청당 100쪽 한도 아래로
const IDX_MAX_BYTES = 20 * 1024 * 1024;    // Project 업로드 여유분

/* 쪽 위에 얹는 쪽번호 띠 */
function decorStamp(human, id, w) {
  return (g) => {
    g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, w, IDX_BAND);
    g.fillStyle = ACC; g.fillRect(0, IDX_BAND - 1.6, w, 1.6);
    g.textBaseline = "middle";
    g.font = `700 12.5px ${FONT}`; g.fillStyle = INK;
    g.fillText(human, 13, IDX_BAND / 2 - 1);
    const x = 13 + g.measureText(human).width + 11;
    g.font = `600 11.5px ${FONT}`; g.fillStyle = "#1B64DA";
    g.fillText(id, x, IDX_BAND / 2 - 1);
  };
}

/* 조각 표지 — Claude 가 이 파일이 무엇이고 어떻게 답해야 하는지 알 수 있게 */
function decorIdxCover(meta, from, to, part, total) {
  const key = examKey(meta);
  return (g) => {
    g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, PW, PH);
    g.fillStyle = "#F2F6FC"; g.beginPath(); g.arc(PW - 90, 90, 190, 0, 7); g.fill();
    g.textBaseline = "alphabetic";
    g.font = `800 14px ${FONT}`; g.fillStyle = ACC;
    g.fillText("기출 풀이 슬라이드", 64, 96);
    g.font = `800 30px ${FONT}`; g.fillStyle = INK;
    g.fillText(examName(meta), 64, 140);
    g.font = `500 13px ${FONT}`; g.fillStyle = "#4E5968";
    const lines = [
      `${part} / ${total} 번째 조각 · 원본 ${from}~${to}쪽`,
      "원본 풀이 파일을 자르기만 한 것입니다. 문제·해설·출처 슬라이드가 모두 그대로 있습니다.",
      "한 문제는 보통 슬라이드 두세 장으로 이어집니다.",
      "",
      "각 쪽 위에 쪽번호가 찍혀 있습니다. 문제를 고를 때는 그 문제의 슬라이드가",
      `시작하는 쪽과 끝나는 쪽을 ~ 로 이어 적으세요. 예: ${key}-p${from}~${from + 2}`,
    ];
    let y = 176;
    for (const l of lines) {
      if (!l) { y += 8; continue; }
      for (const t of wrapText(g, l, PW - 150)) { g.fillText(t, 64, y); y += 19; }
    }
  };
}

/* 쪽 묶음을 한도에 맞춰 여러 파일로 나눠 만든다 */
async function composeChunks(src, meta, pages, perFile) {
  const chunks = [];
  for (let i = 0; i < pages.length; i += perFile) chunks.push(pages.slice(i, i + perFile));
  const key = examKey(meta);
  const out = [];
  for (let c = 0; c < chunks.length; c++) {
    const chunk = chunks[c];
    const doc = await PDFLib.PDFDocument.create();
    await addDecor(doc, decorIdxCover(meta, chunk[0] + 1, chunk[chunk.length - 1] + 1, c + 1, chunks.length));

    const srcPages = chunk.map((i) => src.getPage(i));
    const embs = await doc.embedPages(srcPages);
    for (let i = 0; i < chunk.length; i++) {
      const sp = srcPages[i], emb = embs[i], no = chunk[i] + 1;
      const rot = ((sp.getRotation().angle % 360) + 360) % 360;
      let w = emb.width, h = emb.height;
      if (rot === 90 || rot === 270) { const t = w; w = h; h = t; }
      const page = doc.addPage([w, h + IDX_BAND]);
      placePage(page, emb, sp, [0, 0, w, h]);
      const png = await decorPng(
        decorStamp(`${examName(meta)} ${no}쪽`, `${key}-p${no}`, w), w, IDX_BAND, 3);
      page.drawImage(await doc.embedPng(png), { x: 0, y: h, width: w, height: IDX_BAND });
    }
    out.push({ bytes: await doc.save(), pages: doc.getPageCount(),
               from: chunk[0] + 1, to: chunk[chunk.length - 1] + 1 });
  }
  return out;
}

/* 풀이 PDF 한 개 → Project 에 올릴 조각들. 내용은 손대지 않는다. */
async function buildProjectChunks(fileName, meta, onProgress) {
  const blob = await DB.get("files", fileName);
  if (!blob) throw new Error(`원본 파일이 없습니다: ${fileName}`);
  const src = await PDFLib.PDFDocument.load(await blob.arrayBuffer());
  const pages = [...Array(src.getPageCount()).keys()];
  if (!pages.length) throw new Error(`${fileName}: 쪽이 없습니다`);

  /* 쪽수 한도부터 맞추고, 그래도 파일이 크면 반씩 줄여 다시 나눈다 */
  let perFile = IDX_MAX_PAGES, made = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    made = await composeChunks(src, meta, pages, perFile);
    onProgress && onProgress((attempt + 1) / 4);
    if (made.every((m) => m.bytes.length <= IDX_MAX_BYTES) || perFile <= 12) break;
    perFile = Math.max(12, Math.floor(perFile / 2));
  }
  const base = `${examName(meta)} 풀이`;
  return made.map((m, i) => ({
    name: `${base} ${i + 1}.pdf`, bytes: m.bytes, pages: m.pages,
    from: m.from, to: m.to,
  }));
}

/* Project 커스텀 지시문 — 판정 기준과 답변 형식을 여기에 둔다 */
function projectInstructions(docxFiles, chunkFiles) {
  const lines = [];
  if (docxFiles.length) lines.push(
`- 시험지 파일 (${docxFiles.join(", ")})
  문제 전문이 들어 있습니다. id 는 파일 이름에서 만듭니다 — 연도-학기-과목-문제번호
  예: 2023-기말-감면-6
  중간/기말 구분이 없는 시험은 학기 칸을 빼고 연도-과목-문제번호 로 씁니다
  예: 2023-호흡기계-12`);
  if (chunkFiles.length) lines.push(
`- 풀이 슬라이드 조각 (${chunkFiles.join(", ")})
  시험지가 없는 연도라 풀이 파일을 자르기만 한 것입니다. 문제·해설·출처 슬라이드가
  모두 그대로 있고, 각 쪽 위에 쪽번호가 찍혀 있습니다.
  한 문제는 보통 슬라이드 두세 장으로 이어집니다. 그 문제의 슬라이드가 **시작하는 쪽과
  끝나는 쪽**을 ~ 로 이어 적으세요 — 연도-학기-과목-p시작쪽~끝쪽 (쪽번호 앞에 p 를 붙입니다)
  예: 2020-기말-감면-p442~444  (한 장뿐이면 2020-기말-감면-p442)
  중간/기말 구분이 없는 시험은 학기 칸을 뺍니다 — 예: 2023-호흡기계-p88~90
  id 에는 쪽 위에 찍힌 번호만 쓰고, 슬라이드 안에 보이는 문제 번호로 바꾸지 마세요.
  대신 슬라이드에 보이는 문제 번호를 no 항목에 따로 적어 주세요 (예: "no": "268").
  그림뿐이라 번호가 안 보이면 no 는 생략하면 됩니다.`);

  return `이 Project 에는 의과대학 기출 족보가 들어 있습니다.
대화마다 강의안 PDF 한 개가 첨부됩니다. 그 강의안으로 **풀 수 있는** 기출문제만 골라 주세요.

## 지식 파일
${lines.join("\n")}

## 판단 기준
단어가 겹치는지가 아니라, **강의안 내용만으로 답을 고를 근거가 있는지**로 판단합니다.

- solvable : 강의안에 답을 고를 근거가 다 있음
- partial : 개념은 있으나 문제가 요구하는 세부(약제명·수치·예외)가 강의안에 없음
- unrelated : 무관하거나 다른 강의 범위

애매하면 partial 을 적극적으로 쓰세요. 억지로 둘로 가르지 마세요.

## 그림으로 된 문제
글자가 거의 없고 그림·사진·도표뿐인 문제도 **반드시 같이 검토하세요.**
그림을 직접 보고 판단하고, 글이 없다는 이유로 건너뛰거나 unrelated 로 두지 마세요.
강의안에 같은 그림이나 비슷한 그림이 있으면 solvable 의 강한 근거입니다.

## 답변 형식
고른 이유를 간단히 설명한 뒤, **맨 마지막에** 아래 형식의 JSON 배열 하나만 코드블록으로 넣어 주세요.
solvable 과 partial 을 모두 넣고 unrelated 는 넣지 마세요.
pages 는 근거가 된 **강의안** 쪽수, why 는 한 줄 이유입니다.
no 는 슬라이드에 보이는 문제 번호로, 결과물에 그대로 찍힙니다 (모르면 빼세요).

\`\`\`json
[{"id":"2023-기말-감면-6","verdict":"solvable","pages":"8-9","why":"역전사효소 억제제 목록이 강의안에 그대로 있음"},
 {"id":"2020-기말-감면-p442~444","no":"268","verdict":"partial","pages":"12","why":"광견병 알고리즘은 강의안에 일부만 있음"}]
\`\`\``;
}
