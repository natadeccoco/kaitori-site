// 買取表スプレッドシート（GAS sitedata JSON）→ 商品データ、Myca画像カタログ（master_images.csv）での画像引き当て
const { parseCSV, norm, hashId, CARD_PREFIX, THUMB_PREFIX } = require("./lib.js");

const strip = s => (s || "").replace(/＆/g, "&").replace(/[\s　・･\-－—「」]/g, "").toLowerCase();
const stripBox = s => strip(s).replace(/box/g, "").replace(/ボックス/g, "").replace(/[（）()［］\[\]]/g, "");
const baseName = s => strip(s.replace(/[（(].*?[)）]/g, "").replace(/LV\.?\s*\d+/gi, ""));
const hints = s => [...(s.match(/[（(](.*?)[)）]/g) || []).map(h => strip(h.slice(1, -1))), ...s.split(/[\s　]+/).slice(1).map(strip)].filter(Boolean);
const dedupeKey = r => norm(r.name).replace(/[（）()［］\[\]「」【】、,.．。!！?？]/g, "") + "|" + norm(r.no) + "|" + norm(r.exp);

/** master_images.csv を読み込んで索引を作る */
function loadCatalog(csvText) {
  const rows = parseCSV(csvText.replace(/^﻿/, ""));
  const head = rows[0]; const ix = Object.fromEntries(head.map((h, i) => [h, i]));
  const all = rows.slice(1).filter(r => r.length >= head.length).map(r => ({
    id: r[ix.id], name: r[ix.display_name], exp: r[ix.expansion], no: r[ix.cardnumber], rarity: r[ix.rarity], pack: r[ix.pack_name],
    old: r[ix.keyword] === "旧裏", category: r[ix.category_display_name], img: THUMB_PREFIX + r[ix.image_url]
  }));
  const cards = all.filter(x => x.category === "カード");
  const byExpNo = new Map(), byExpNoList = new Map(), byNoAll = new Map(), byNoList = new Map();
  for (const c of cards) {
    if (!c.no) continue;
    const k = (c.exp + "|" + c.no).toLowerCase();
    if (!byExpNo.has(k)) byExpNo.set(k, c.img);
    if (!byExpNoList.has(k)) byExpNoList.set(k, []); byExpNoList.get(k).push(c);
    if (!byNoAll.has(c.no)) byNoAll.set(c.no, new Set()); byNoAll.get(c.no).add(c.img);
    if (!byNoList.has(c.no)) byNoList.set(c.no, []); byNoList.get(c.no).push(c);
  }
  const byNo = new Map([...byNoAll].filter(([, s]) => s.size === 1).map(([k, s]) => [k, [...s][0]]));
  const boxes = all.filter(x => x.category === "ボックス").map(x => ({ ...x, key: stripBox(x.name) }));
  const old = cards.filter(x => x.old).map(x => ({ ...x, key: strip(x.name), base: baseName(x.name) }));
  return { byExpNo, byExpNoList, byNo, byNoList, boxes, old, cardsByName: groupBy(cards, c => strip(c.name)) };
}
function groupBy(arr, f) { const m = new Map(); for (const x of arr) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; }

/** GAS の sitedata JSON → 商品配列（タブの順で重複を除く） */
function sheetToItems(data, cfg) {
  const seen = new Set(), out = [];
  for (const t of data.tabs || []) {
    for (const r of t.rows || []) {
      const key = t.cat + "|" + dedupeKey(r);
      if (seen.has(key)) continue; seen.add(key);
      const exp = (r.exp || "").replace(/^(その他|-)$/, ""), no = r.no || "";
      const code = no ? (/[A-Za-z]/.test(no) ? no : [exp, no].filter(Boolean).join(" ")) : "";
      out.push({
        id: `${t.cat}-${hashId(t.cat + "|" + norm(r.name) + "|" + norm(no) + "|" + norm(exp))}`,
        name: r.name, code, set: r.pack || "", rarity: r.rarity || "-", grade: t.cat === "PSA" ? "PSA10" : "素体",
        type: t.cat === "BOX" ? "ボックス" : "シングル", cat: t.cat, no, exp, price: r.price, price2: r.price2 || 0,
        img: r.img || "", note: r.note || "", kw: "", order: 0, tab: t.tab
      });
    }
  }
  return out;
}

/** 画像の引き当て */
/** image_overrides.csv（カテゴリ,名前,画像パス）— 自動引き当てが違うときに手で指定する */
function loadOverrides(csvText) {
  const m = new Map();
  if (!csvText) return m;
  for (const r of parseCSV(csvText.replace(/^﻿/, "")).slice(1)) { if (r.length >= 3 && r[1]) m.set(r[0] + "|" + norm(r[1]), r[2].trim()); }
  return m;
}
function resolveImages(items, cat, overrides = new Map()) {
  for (const it of items) {
    const ov = overrides.get(it.cat + "|" + norm(it.name));
    if (ov) { it.img = ov === "-" ? "" : /^https?:/.test(ov) ? ov : THUMB_PREFIX + ov; it.imgCands = 1; continue; }
    if (it.img) continue;
    if (it.cat === "汎用") continue;
    if (it.cat === "BOX") { it.img = matchBox(it, cat); continue; }
    if (it.cat === "旧裏" || it.cat === "旧弾") { it.img = matchOld(it, cat) || matchCard(it, cat) || ""; continue; }
    it.img = matchCard(it, cat) || "";
  }
}
function matchCard(it, cat) {
  if (it.no) {
    if (it.no.includes("+")) { const first = { ...it, no: it.no.split("+")[0].trim() }; const r = matchCard(first, cat); if (r) { it.imgAlt = first.imgAlt; return r; } }
    const k = (it.exp + "|" + it.no).toLowerCase();
    if (cat.byExpNo.has(k)) return cat.byExpNo.get(k);
    // 「XY11青」「BW1白」のような表記 → 英数字だけにして探し、色（青=B 赤=R 緑=G 白=W 黒=K 黄=Y）で版を選ぶ
    const expAlnum = it.exp.replace(/[^A-Za-z0-9+\-]/g, ""), color = { 青: "B", 赤: "R", 緑: "G", 白: "W", 黒: "K", 黄: "Y", 銀: "S", 金: "G" }[(it.exp.match(/[青赤緑白黒黄銀金]/) || [])[0]];
    const list = cat.byExpNoList.get((expAlnum + "|" + it.no).toLowerCase()) || [];
    if (list.length) {
      let c = list.filter(x => strip(x.name) === strip(it.name)); if (!c.length) c = list;
      if (color && c.length > 1) { const f = c.filter(x => new RegExp("_" + color + "[_/]").test(x.img)); if (f.length) c = f; }
      return c[0].img;
    }
    if (cat.byNo.has(it.no)) return cat.byNo.get(it.no);
    // 番号が複数弾にある場合は名前（括弧内のヒント含む）で絞る
    const base = strip(it.name.replace(/[（(].*?[)）]/g, "")), hs = hints(it.name);
    let cand = (cat.byNoList.get(it.no) || []).filter(x => strip(x.name).includes(base));
    if (cand.length > 1 && hs.length) { const f = cand.filter(x => hs.some(h => strip(x.name).includes(h) || strip(x.pack).includes(h))); if (f.length) cand = f; }
    if (cand.length) return cand[0].img;
    // 命名規則からの推定（読めなければ onerror で次の候補、最後は仮表示）
    let m, c = [];
    if ((m = it.no.match(/^(\d+)\/([A-Za-z]+-P)$/))) c = [`${m[2]}/${m[2]}_${m[1]}.jpg`, `${m[2]}/${m[2].toLowerCase()}${m[1]}.jpg`];
    else if (/^[A-Za-z0-9+]+$/.test(it.exp) && (m = it.no.match(/^(\d+)\/\d+$/))) {
      const e = it.exp.replace("+", "p"), E2 = e.slice(0, 2).toUpperCase() + e.slice(2);
      c = [...new Set([`${e}/${e}_${m[1]}.jpg`, `${e}/${e.toUpperCase()}_${m[1]}.jpg`, `${e.toLowerCase()}/${e}_${m[1]}.jpg`, `${e.toLowerCase()}/${e.toLowerCase()}_${m[1]}.jpg`, `${E2}/${E2}_${m[1]}.jpg`])];
    }
    if (c.length) { it.imgAlt = c.slice(1).map(x => CARD_PREFIX + x); return CARD_PREFIX + c[0]; }
  }
  // 型番なし：名前一致（1件に絞れたときだけ）
  const same = cat.cardsByName.get(strip(it.name)) || [];
  const r = it.rarity && it.rarity !== "-" ? same.filter(x => x.rarity === it.rarity) : same;
  return (r.length === 1 ? r[0].img : same.length === 1 ? same[0].img : "");
}
function matchBox(it, cat) {
  const k = stripBox(it.name); if (!k) return "";
  const ex = cat.boxes.filter(b => b.key === k);
  const c = ex.length ? ex : cat.boxes.filter(b => b.key.includes(k));
  return c.length ? c[0].img : "";
}
/* 旧裏：シートの「名前 LV.xx(ヒント/ヒント)」を Myca の 旧裏カード（名前（補足）, パック名）に当てる。
   候補＝括弧を除いた名前が同じもの。括弧内のヒント（/ ・ で区切り）がパック名か補足に含まれるほど高得点。
   シートにないのに補足が付いている候補（マークなし等）は減点。同点ならカタログ順の先頭。 */
const OLD_HINT_ALIAS = { 初版: ["初版"], マークなし: ["マークなし"], マークあり: ["第1弾拡張パック"], 拡張シート: ["拡張シート"], クイックスターター: ["クイックスターター"],
  イントロパック: ["イントロパック"], サザンアイランド: ["サザンアイランド"], ジムマーク問わず: ["ポケモンジム"], 通信交換: ["通信進化"], トレーナーズ: ["トレーナーズ"],
  ファンクラブ: ["ファンクラブ"], とりかえっこ: ["とりかえっこ"], GB: ["ポケモンカードGB"], コロコロ付録: ["コロコロ"], 未開封: [], 英語表記: [], 光沢なし: [] };
const oldHints = s => [...(s.match(/[（(](.*?)[)）]/g) || [])].flatMap(h => h.slice(1, -1).split(/[\/／・,、]/)).map(x => x.trim()).filter(Boolean);
function matchOld(it, cat) {
  const b = baseName(it.name); if (!b) return "";
  let c = cat.old.filter(x => x.base === b); if (!c.length) c = cat.old.filter(x => x.key.includes(b));
  if (!c.length) return "";
  const rr = it.rarity;
  if (rr && rr !== "-" && rr !== "P") { const f = c.filter(x => x.rarity === rr); if (f.length) c = f; }
  if (rr === "P") { const f = c.filter(x => /PROMO/i.test(x.rarity)); if (f.length) c = f; }
  const hs = oldHints(it.name);
  const wantsNoMark = hs.includes("マークなし");
  const scored = c.map(x => {
    const hay = strip(x.pack) + "|" + strip(x.name);
    let s = 0;
    for (const h of hs) {
      const keys = OLD_HINT_ALIAS[h] || [h];
      if (keys.some(k => hay.includes(strip(k)))) s += 2;
      else if (strip(h).length >= 4 && hay.includes(strip(h).slice(0, 4))) s += 1;   // 「チャンピオンロード2000金箔押し」→パック名「チャンピオンロード2000 来場記念」など前方一致
    }
    if (hs.includes("マークあり") && /初版/.test(x.pack)) s -= 3;
    if (!wantsNoMark && /マークなし/.test(x.name)) s -= 3;
    if (hs.includes("プレミアムファイル") && x.pack.trim() === "プレミアムファイル") s += 1;
    if (!hs.length && /拡張パック|ジム拡張|ポケモンジム/.test(x.pack)) s += 1;   // ヒント無しなら通常パック優先
    return { x, s };
  }).sort((a, b) => b.s - a.s);
  const tied = scored.filter(z => z.s === scored[0].s); it.imgCands = tied.length; it.imgCandList = tied.map(z => ({ img: z.x.img, pack: z.x.pack, name: z.x.name }));
  return scored[0].x.img;
}

module.exports = { loadCatalog, sheetToItems, resolveImages, loadOverrides };
