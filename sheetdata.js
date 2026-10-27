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
  const old = cards.filter(x => x.old).map(x => ({ ...x, key: strip(x.name) }));
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
function resolveImages(items, cat) {
  for (const it of items) {
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
function matchOld(it, cat) {
  const b = baseName(it.name); if (!b) return "";
  let c = cat.old.filter(x => x.key === b); if (!c.length) c = cat.old.filter(x => x.key.includes(b));
  if (!c.length) return "";
  const rr = it.rarity;
  if (rr && rr !== "-" && rr !== "P") { const f = c.filter(x => x.rarity === rr); if (f.length) c = f; }
  if (rr === "P") { const f = c.filter(x => /PROMO/i.test(x.rarity)); if (f.length) c = f; }
  const hs = hints(it.name);
  if (c.length > 1 && hs.length) { const f = c.filter(x => hs.some(h => strip(x.pack).includes(h) || strip(x.name).includes(h))); if (f.length) c = f; }
  return c[0].img;
}

module.exports = { loadCatalog, sheetToItems, resolveImages };
