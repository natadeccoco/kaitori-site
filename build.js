#!/usr/bin/env node
/* ナタデココ かんたん郵送買取 — 静的サイト生成
   data/ の CSV（Myca商品マスタ形式 + 買取表シートの各タブ）を読み、dist/ に
   index.html（価格表アプリ）、card/<id>/（カード個別ページ）、stores/ legal/ privacy/、sitemap.xml、robots.txt を出力する。 */
const fs = require("fs"), path = require("path");
const lib = require("./lib.js");
const CFG = JSON.parse(fs.readFileSync("config.json", "utf8"));
lib.setConfig({ categories: CFG.categories });
const ROOT = __dirname, DATA = ROOT, DIST = path.join(ROOT, "dist"), SRC = ROOT;
const esc = lib.esc;
const yen = n => "¥" + Number(n).toLocaleString("ja-JP");
const read = f => fs.existsSync(f) ? fs.readFileSync(f, "utf8").replace(/^﻿/, "") : "";
// サイトのベースパス（独自ドメインなら "/"、github.io の仮公開なら "/kaitori-site/"）。HTML内の href="/..." をこれに置き換える
const BASE = (() => { let p = new URL(CFG.siteUrl).pathname; if (!p.endsWith("/")) p += "/"; return p; })();
const rebase = s => BASE === "/" ? s : s.replace(/(href|src)="\/(?!\/)/g, `$1="${BASE}`);
const write = (rel, s) => { const f = path.join(DIST, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, /\.html$/.test(rel) ? rebase(s) : s); };

/* ---------- 1. データ読み込み ---------- */
let items = [];
const sheetJson = read(path.join(DATA, "data_sheet.json"));
if (sheetJson) {
  // 買取表スプレッドシート（GAS sitedata）＋ Myca画像カタログ
  const sd = require("./sheetdata.js");
  const data = JSON.parse(sheetJson);
  items = sd.sheetToItems(data, CFG);
  const catalog = sd.loadCatalog(read(path.join(ROOT, "master_images.csv")));
  sd.resolveImages(items, catalog, sd.loadOverrides(read(path.join(ROOT, "image_overrides.csv"))));
  const noimg = items.filter(i => !i.img && i.cat !== "汎用");
  console.log(`sheet tabs: ${data.tabs.map(t => t.tab + "=" + t.rows.length).join(", ")} / 画像なし ${noimg.length} 件`);
  fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(path.join(DIST, "noimage.txt"), noimg.map(i => `${i.cat}\t${i.tab}\t${i.name}\t${i.code}\t${i.imgWhy || ""}`).join("\n"));
} else {
  // 旧方式: Myca CSV ＋ タブ別CSV
  const base = lib.csvToItems(read(path.join(DATA, "data_data.csv")));
  items = base;
  for (const [file, cat] of Object.entries(CFG.sources)) {
    if (file === "data.csv") continue;
    const txt = read(path.join(DATA, "data_" + file)); if (!txt) continue;
    const extra = lib.sheetToItems(txt, cat); if (!extra.length) continue;
    lib.resolveImages(extra, base);
    items = items.filter(i => i.cat !== cat).concat(extra);
  }
}
items.forEach(i => { if (/noimage/.test(i.img)) i.img = ""; });
// 自前に取り込んだ画像（img/cards/<hash>.webp）があればそちらを使う（出典URLを出さない）
{
  const crypto = require("crypto"), cdir = path.join(ROOT, "img", "cards");
  let local = 0;
  for (const i of items) {
    if (!/^https?:/.test(i.img)) continue;
    const f = crypto.createHash("md5").update(i.img).digest("hex").slice(0, 12) + ".webp";
    if (fs.existsSync(path.join(cdir, f))) { i.img = `${CFG.siteUrl}/img/cards/${f}`; i.imgAlt = []; local++; }
  }
  console.log(`自前画像 ${local} / 外部URLのまま ${items.filter(i => /^https?:\/\/static\.mycalinks/.test(i.img)).length}`);
}
const updated = (read(path.join(DATA, "data_updated.txt")).trim()) || (sheetJson && JSON.parse(sheetJson).updated) || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, "/");
console.log(`items: ${items.length}`, Object.fromEntries(CFG.categories.map(c => [c, items.filter(i => i.cat === c).length])), "updated", updated);

/* ---------- 2. 価格表ページ ---------- */
const clientCfg = { base: BASE, lineId: CFG.lineId, lineAddUrl: CFG.lineAddUrl, xUrl: CFG.xUrl, pageSize: CFG.pageSize, categories: CFG.categories, topRarities: CFG.topRarities, topSetsCount: CFG.topSetsCount, oldBackExpansions: null };
const slim = items.map(({ id, name, code, set, rarity, grade, type, cat, no, exp, price, price2, img, imgAlt, note, order }) => ({ id, name, code, set, rarity, grade, type, cat, no, exp, price, price2, img, imgAlt, note, order }));
const dataJson = JSON.stringify({ updated, items: slim }).replace(/</g, "\\u003c");
const headCommon = (title, desc, url, image) => `<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(CFG.siteName)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
${image ? `<meta property="og:image" content="${esc(image)}">` : ""}
<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">
<link rel="canonical" href="${esc(url)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">`;
let page = read(path.join(SRC, "page.html"));
page = page.replace("/*__CONFIG__*/{}", JSON.stringify(clientCfg))
  .replace("__DATA__", dataJson)
  .replace(/__STORES_URL__/g, CFG.storesUrl)
  .replace("<!--__HEAD__-->", headCommon(CFG.siteName + "｜ポケモンカード買取価格表", "ポケモンカードの買取価格表。シングル・PSA10・未開封BOX・旧裏を毎日更新。", CFG.siteUrl + "/", CFG.siteUrl + "/ogp.png") + `
<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Organization", name: CFG.company, url: CFG.siteUrl, sameAs: [CFG.xUrl, CFG.shopUrl] })}</script>`);
const wrap = (body, lang = "ja") => `<!DOCTYPE html>\n<html lang="${lang}">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n${body.slice(0, body.indexOf("</style>") + 8)}\n</head>\n<body>\n${body.slice(body.indexOf("</style>") + 8)}\n</body>\n</html>\n`;
write("index.html", wrap(page));

/* 収録弾→ページslug（カードページからのリンク用。本体は 3b で生成） */
const CAT_SLUG = { "ポケモン": "pk", PSA: "psa", BOX: "box", "旧裏": "old", "旧弾": "kyu", "汎用": "misc" };
const packSlugBySet = (() => { const m = new Map(); const g = new Map(); for (const it of items) { if (!it.set || it.cat === "汎用") continue; if (!g.has(it.set)) g.set(it.set, []); g.get(it.set).push(it); }
  for (const [set, a] of g) { if (a.length < 3) continue; const exps = [...new Set(a.map(x => x.exp).filter(e => /^[A-Za-z0-9+\-]+$/.test(e)))]; m.set(set, exps.length === 1 ? exps[0].toLowerCase().replace("+", "p") : "p-" + lib.hashId(set)); } return m; })();

/* ---------- 3. カード個別ページ ---------- */
const cardTpl = read(path.join(SRC, "card.html"));
const catLabel = c => c === "ポケモン" ? "シングルカード" : c === "PSA" ? "PSA10鑑定品" : c === "BOX" ? "未開封BOX" : c === "旧弾" ? "旧弾（eカード等）" : c === "汎用" ? "汎用・サプライ" : c;
const urls = [];
for (const it of items) {
  const rel = `card/${encodeURIComponent(it.id)}/`;
  const url = `${CFG.siteUrl}/${rel}`;
  const title = `${it.name}${it.code ? "（" + it.code + "）" : ""}${it.grade !== "素体" ? " " + it.grade : ""} 買取価格 ${yen(it.price)}`;
  const desc = `${it.name}${it.code ? " " + it.code : ""}${it.set ? "／" + it.set : ""}${it.rarity !== "-" ? "／" + it.rarity : ""} の買取価格は${yen(it.price)}（${updated}時点）。ナタデココのかんたん郵送買取ならLINEで申込・送料無料・最短当日入金。`;
  const lineText = `【郵送買取 申込】\n・${it.name}${it.code ? "（" + it.code + "）" : ""}${it.grade !== "素体" ? " " + it.grade : ""} ×1 … ${yen(it.price)}\n\n※美品の場合の価格です。\nお名前・枚数・発送予定日をご記入ください：`;
  const lineUrl = `https://line.me/R/oaMessage/${encodeURIComponent(CFG.lineId)}/?${encodeURIComponent(lineText)}`;
  const ld = { "@context": "https://schema.org", "@type": "Product", name: it.name, image: it.img || undefined, description: desc, brand: { "@type": "Brand", name: "ポケモンカードゲーム" }, sku: it.code || undefined,
    offers: { "@type": "Offer", url, priceCurrency: "JPY", price: it.price, availability: "https://schema.org/InStock", seller: { "@type": "Organization", name: CFG.company }, description: "買取価格（美品の場合）" } };
  const related = items.filter(x => x.cat === it.cat && x.id !== it.id && (x.set && x.set === it.set || x.name.split(/[（(\s]/)[0] === it.name.split(/[（(\s]/)[0])).slice(0, 8);
  const html = cardTpl
    .replace(/__TITLE__/g, esc(title + "｜" + CFG.siteName))
    .replace("__HEAD__", headCommon(title, desc, url, it.img) + `\n<script type="application/ld+json">${JSON.stringify(ld)}</script>`)
    .replace(/__NAME__/g, esc(it.name)).replace(/__CODE__/g, esc(it.code)).replace(/__SET__/g, esc(it.set)).replace(/__RARITY__/g, esc(it.rarity !== "-" ? it.rarity : ""))
    .replace(/__GRADE__/g, esc(it.grade !== "素体" ? it.grade : "")).replace(/__CAT__/g, esc(it.cat)).replace(/__CATLABEL__/g, esc(catLabel(it.cat)))
    .replace(/__PRICE__/g, esc(yen(it.price))).replace(/__PRICE2__/g, it.price2 ? `<div class="l" style="margin-top:8px">シュリンクなし（ぺりぺり付き）</div><div class="v" style="font-size:26px">${esc(yen(it.price2))}</div>` : "").replace(/__UPDATED__/g, esc(updated))
    .replace(/__IMG__/g, it.img ? `<img src="${esc(it.img)}" alt="${esc(it.name)}" loading="eager" data-alt="${esc((it.imgAlt || []).join("|"))}" onerror="imgErr(this)">` : `<div class="ph"><span>${esc(it.name)}</span></div>`)
    .replace(/__PSABADGE__/g, /^PSA\s*10$/i.test(it.grade) ? `<img class="badge img" src="/img/psa10.webp?v=2" alt="PSA10">` : /^PSA/i.test(it.grade) ? `<span class="badge"><span class="p">PSA</span><span class="g">${esc(it.grade.replace(/psa/i, ""))}</span></span>` : "")
    .replace(/__LINE_URL__/g, esc(lineUrl)).replace(/__LINE_ADD__/g, esc(CFG.lineAddUrl)).replace(/__ADD_URL__/g, `/#add=${encodeURIComponent(it.id)}`)
    .replace(/__RELATED__/g, related.map(r => `<a class="rc" href="/card/${encodeURIComponent(r.id)}/">${r.img ? `<img src="${esc(r.img)}" alt="" loading="lazy" onerror="this.remove()">` : ""}<b>${esc(r.name)}</b><span>${esc(r.code)}</span><em>${esc(yen(r.price))}</em></a>`).join(""))
    .replace(/__STORES_URL__/g, CFG.storesUrl).replace(/__XURL__/g, esc(CFG.xUrl)).replace(/__COMPANY__/g, esc(CFG.company))
    .replace(/__PACK_LINK__/g, it.set && packSlugBySet.has(it.set) ? `<a class="sec" href="/pack/${packSlugBySet.get(it.set)}/">${esc(it.set)}の買取価格一覧 ›</a>` : "")
    .replace(/__CAT_URL__/g, `/cat/${CAT_SLUG[it.cat] || "c"}/`);
  write(rel + "index.html", wrap(html));
  urls.push({ url, lastmod: updated.replace(/\//g, "-") });
}

/* ---------- 3b. 収録弾ごと・カテゴリごとの一覧ページ（検索対策） ---------- */
const packTpl = read(path.join(SRC, "pack.html"));
const CAT_TEXT = {
  "ポケモン": ["シングルカードの買取について", "<p>SV・MEGA・SM・XY・BW以前・プロモまで、ポケモンカードのシングルカードを型番つきで掲載しています。価格は美品（傷・白かけ・反りなし）の場合の金額で、相場に合わせて毎日更新しています。</p><p>掲載のないカードも買取できます。LINEでカードの写真（型番が見えるように）をお送りください。</p>"],
  PSA: ["PSA10鑑定品の買取について", "<p>PSA10（GEM MINT）のケース入りカードの買取価格です。ケースに割れ・大きな傷がないものが対象で、ラベルのグレードが確認できる写真をLINEでお送りいただければ、事前にお見積りします。</p><p>PSA9以下やBGSなど他社鑑定品もご相談ください。</p>"],
  BOX: ["未開封BOXの買取について", "<p>シュリンク付き未開封BOXの買取価格です。一部のBOXはシュリンクなし（ぺりぺり付き）の価格も併記しています。シュリンクの破れ・箱のへこみがある場合は減額となることがあります。</p><p>まとめて売る場合は、箱の数と状態をLINEでお知らせください。</p>"],
  "旧裏": ["旧裏（旧裏面カード）の買取について", "<p>1996〜2001年の旧裏面ポケモンカードの買取価格です。カード名の後ろにLV（レベル）や版（イントロパック・拡張シート・初版マークなし等）を記載しています。</p><p>旧裏は状態による価格差が大きいため、表面のスレ・裏面の白かけ・角の状態が分かる写真をLINEでお送りください。</p>"],
  "旧弾": ["旧弾（eカード・ADV/PCG・DP等）の買取について", "<p>ポケモンカードe、ADV・PCG、DPシリーズなど、現行レギュレーション以前のカードの買取価格です。1ED（初版）・アンリミ・キラ・ミラーの区別はカード名に記載しています。</p><p>該当するものが見当たらない場合もLINEでご相談ください。</p>"],
  "汎用": ["汎用カード・最低保証の買取について", "<p>サポート・モンスター等の汎用カードや最低保証価格の一覧です。</p>"]
};
const catSlugOf = c => CAT_SLUG[c] || "c";
const listCards = arr => arr.map(r => `<a class="rc" href="/card/${encodeURIComponent(r.id)}/">${r.img ? `<img src="${esc(r.img)}" alt="${esc(r.name)}" loading="lazy" onerror="this.outerHTML='<div class=ph>'+this.alt+'</div>'">` : `<div class="ph">${esc(r.name)}</div>`}${/^PSA\s*10$/i.test(r.grade) ? `<img class="g" src="/img/psa10.webp?v=2" alt="PSA10">` : ""}<b>${esc(r.name)}</b><span>${esc(r.code || "")}</span><em>${esc(yen(r.price))}</em></a>`).join("");
const packPage = (rel, o) => {
  const url = `${CFG.siteUrl}/${rel}`;
  const html = packTpl
    .replace(/__TITLE__/g, esc(o.title + "｜" + CFG.siteName))
    .replace("__HEAD__", headCommon(o.title, o.desc, url, o.image || CFG.siteUrl + "/ogp.png") + `\n<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "CollectionPage", name: o.title, description: o.desc, url })}</script>`)
    .replace(/__CRUMB__/g, o.crumb).replace(/__EYEBROW__/g, esc(o.eyebrow)).replace(/__H1__/g, esc(o.h1)).replace(/__LEDE__/g, o.lede).replace(/__STATS__/g, o.stats)
    .replace(/__LIST_URL__/g, esc(o.listUrl)).replace(/__CARDS__/g, listCards(o.cards)).replace(/__TEXT_TITLE__/g, esc(o.textTitle)).replace(/__TEXT__/g, o.text).replace(/__OTHERS__/g, o.others)
    .replace(/__LINE_ADD__/g, esc(CFG.lineAddUrl)).replace(/__STORES_URL__/g, CFG.storesUrl).replace(/__COMPANY__/g, esc(CFG.company));
  write(rel + "index.html", wrap(html));
  urls.push({ url, lastmod: updated.replace(/\//g, "-") });
};
// 収録弾（シートA列のパック名）ごと：3件以上あるもの
const bySet = new Map();
for (const it of items) { if (!it.set || it.cat === "汎用") continue; if (!bySet.has(it.set)) bySet.set(it.set, []); bySet.get(it.set).push(it); }
const packs = [...bySet].filter(([, a]) => a.length >= 3).map(([set, a]) => {
  const exps = [...new Set(a.map(x => x.exp).filter(e => /^[A-Za-z0-9+\-]+$/.test(e)))];
  const slug = exps.length === 1 ? exps[0].toLowerCase().replace("+", "p") : "p-" + lib.hashId(set);
  return { set, slug, items: a.sort((x, y) => y.price - x.price), exp: exps.length === 1 ? exps[0] : "" };
}).sort((a, b) => b.items.length - a.items.length);
const packLink = p => `<a href="/pack/${p.slug}/">${esc(p.set)}${p.exp ? "（" + esc(p.exp) + "）" : ""} <small>${p.items.length}</small></a>`;
const packIndexLinks = packs.map(packLink).join("");
for (const p of packs) {
  const cats = [...new Set(p.items.map(x => x.cat))];
  const top = p.items[0];
  const others = packs.filter(q => q !== p && q.items.some(x => cats.includes(x.cat))).slice(0, 12).map(packLink).join("") + `<a href="/pack/">収録弾の一覧をすべて見る ›</a>`;
  packPage(`pack/${p.slug}/`, {
    title: `${p.set}${p.exp ? "（" + p.exp + "）" : ""}の買取価格一覧 ${p.items.length}件`,
    desc: `${p.set}${p.exp ? "（" + p.exp + "）" : ""}収録カードの買取価格一覧。最高 ${yen(top.price)}（${top.name}）。${updated}更新。ナタデココのかんたん郵送買取は送料無料・最短当日入金。`,
    image: top.img, crumb: `<a href="/pack/">収録弾から探す</a><span>›</span><span>${esc(p.set)}</span>`, eyebrow: "収録弾ごとの買取価格", h1: `${p.set}${p.exp ? "（" + p.exp + "）" : ""} 買取価格一覧`,
    lede: `${esc(p.set)}に収録されているカードの買取価格です。<b>${esc(top.name)}</b> ${esc(yen(top.price))} など ${p.items.length}件を掲載（${esc(updated)}更新）。`,
    stats: `<span class="stat">${p.items.length}件</span><span class="stat">最高 ${esc(yen(top.price))}</span>${cats.map(c => `<span class="stat">${esc(catLabel(c))}</span>`).join("")}`,
    listUrl: `/?set=${encodeURIComponent(p.set)}`, cards: p.items, textTitle: `${p.set}のカードを売るなら`, text: `<p>価格表に載っているカードをタップして枚数を選び、「LINEで買取申込へ進む」から申込できます。箱に詰めて送るだけ、送料無料・最短当日入金です。</p>${CAT_TEXT[cats[0]] ? CAT_TEXT[cats[0]][1] : ""}`,
    others
  });
}
packPage("pack/", {
  title: "収録弾ごとの買取価格一覧", desc: `ポケモンカードを収録弾（パック）ごとにまとめた買取価格一覧。${packs.length}弾を掲載、毎日更新。`, crumb: `<span>収録弾から探す</span>`, eyebrow: "収録弾から探す", h1: "収録弾ごとの買取価格一覧",
  lede: `${packs.length}の収録弾を掲載しています。弾を選ぶとそのカードの買取価格一覧が開きます。`, stats: `<span class="stat">${packs.length}弾</span><span class="stat">${items.length}件</span>`, listUrl: "/", cards: packs.slice(0, 12).map(p => p.items[0]),
  textTitle: "収録弾の一覧", text: `<div class="links">${packIndexLinks}</div>`, others: CFG.categories.map(c => `<a href="/cat/${catSlugOf(c)}/">${esc(catLabel(c))}</a>`).join("")
});
// カテゴリごと
for (const c of CFG.categories) {
  const a = items.filter(x => x.cat === c).sort((x, y) => y.price - x.price); if (!a.length) continue;
  const top = a[0], t = CAT_TEXT[c] || [catLabel(c) + "の買取について", ""];
  const catPacks = packs.filter(p => p.items.some(x => x.cat === c)).slice(0, 20).map(packLink).join("");
  packPage(`cat/${catSlugOf(c)}/`, {
    title: `${catLabel(c)}の買取価格一覧 ${a.length}件`, desc: `${catLabel(c)}の買取価格一覧。最高 ${yen(top.price)}（${top.name}）。${updated}更新。ナタデココのかんたん郵送買取は送料無料・最短当日入金。`,
    image: top.img, crumb: `<span>${esc(catLabel(c))}</span>`, eyebrow: "カテゴリごとの買取価格", h1: `${catLabel(c)} 買取価格一覧`,
    lede: `${esc(catLabel(c))}の買取価格です。<b>${esc(top.name)}</b> ${esc(yen(top.price))} など ${a.length}件を掲載（${esc(updated)}更新）。`,
    stats: `<span class="stat">${a.length}件</span><span class="stat">最高 ${esc(yen(top.price))}</span>`, listUrl: `/?cat=${encodeURIComponent(c)}`, cards: a.slice(0, 60),
    textTitle: t[0], text: t[1] + (catPacks ? `<p><b>収録弾から探す</b></p><div class="links">${catPacks}</div>` : ""),
    others: CFG.categories.filter(x => x !== c).map(x => `<a href="/cat/${catSlugOf(x)}/">${esc(catLabel(x))}</a>`).join("") + `<a href="/pack/">収録弾から探す ›</a>`
  });
}
console.log(`pack pages: ${packs.length}, cat pages: ${CFG.categories.length}`);

/* ---------- 3c. 文章ページ（articles/*.json → /<slug>/） ---------- */
const artTpl = read(path.join(SRC, "article.html"));
const artDir = path.join(ROOT, "articles");
const arts = fs.existsSync(artDir) ? fs.readdirSync(artDir).filter(f => f.endsWith(".json")).map(f => JSON.parse(read(path.join(artDir, f)))) : [];
for (const a of arts) {
  const url = `${CFG.siteUrl}/${a.slug}/`;
  const more = arts.filter(x => x.slug !== a.slug).map(x => `<a href="/${x.slug}/">${esc(x.crumb)}</a>`).join("") + `<a href="/pack/">収録弾ごとの買取価格</a><a href="/cat/psa/">PSA10の買取価格</a><a href="/cat/old/">旧裏の買取価格</a>`;
  const ld = [{ "@context": "https://schema.org", "@type": "Article", headline: a.h1, description: a.desc, url, dateModified: updated.replace(/\//g, "-"), author: { "@type": "Organization", name: CFG.company }, publisher: { "@type": "Organization", name: CFG.company } }];
  if (a.faq) ld.push({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: a.faq.map(([q, ans]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: ans } })) });
  const html = artTpl
    .replace(/__TITLE__/g, esc(a.title + "｜" + CFG.siteName))
    .replace("__HEAD__", headCommon(a.title, a.desc, url, CFG.siteUrl + "/ogp.png") + ld.map(x => `\n<script type="application/ld+json">${JSON.stringify(x)}</script>`).join(""))
    .replace(/__CRUMB__/g, esc(a.crumb)).replace(/__H1__/g, esc(a.h1)).replace(/__LEDE__/g, esc(a.lede)).replace(/__MASCOT__/g, a.mascot || "chan1").replace("__BODY__", a.body).replace(/__MORE__/g, more)
    .replace(/__UPDATED__/g, esc(updated)).replace(/__LINE_ADD__/g, esc(CFG.lineAddUrl)).replace(/__STORES_URL__/g, CFG.storesUrl).replace(/__COMPANY__/g, esc(CFG.company));
  write(`${a.slug}/index.html`, wrap(html));
  urls.push({ url, lastmod: updated.replace(/\//g, "-") });
}
console.log(`article pages: ${arts.length}`);

/* ---------- 4. 固定ページ ---------- */
for (const name of ["stores", "legal", "privacy"]) {
  let html = read(path.join(SRC, name + ".html"));
  if (!html) continue;
  html = html.replace(/__COMPANY__/g, esc(CFG.company)).replace(/__LICENSE__/g, esc(CFG.antiqueLicense)).replace(/__LINE_ADD__/g, esc(CFG.lineAddUrl)).replace(/__XURL__/g, esc(CFG.xUrl)).replace(/__STORES_URL__/g, CFG.storesUrl)
    .replace("__HEAD__", headCommon(html.match(/<title>(.*?)<\/title>/)[1], "", `${CFG.siteUrl}/${name}/`, ""));
  write(`${name}/index.html`, wrap(html));
  urls.push({ url: `${CFG.siteUrl}/${name}/`, lastmod: updated.replace(/\//g, "-") });
}

/* ---------- 5. sitemap / robots / 404 / CNAME / assets ---------- */
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>${CFG.siteUrl}/</loc><lastmod>${updated.replace(/\//g, "-")}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>\n${urls.map(u => `<url><loc>${esc(u.url)}</loc><lastmod>${u.lastmod}</lastmod><changefreq>daily</changefreq></url>`).join("\n")}\n</urlset>\n`);
write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${CFG.siteUrl}/sitemap.xml\n`);
write("404.html", `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="4;url=/"><title>ページが見つかりません｜ナタデココ</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;font-family:"M PLUS Rounded 1c","Zen Kaku Gothic New",sans-serif;background:linear-gradient(135deg,#FFF6C9,#B8F4F4 50%,#DCCBFF);color:#173B5C}img{height:200px}h1{margin:12px 0 4px;font-size:22px}a{display:inline-block;margin-top:14px;background:#fff;border:2px solid #A9F3F4;border-radius:999px;padding:10px 22px;text-decoration:none;color:#173B5C;font-weight:700;box-shadow:0 3px 0 #A9F3F4}</style></head><body><div><img src="/img/chars/amery2.webp" alt=""><h1>ページが見つかりません</h1><p>数秒後に買取価格表へ移動します。</p><a href="/">買取価格表へ</a></div></body></html>`);
write(".nojekyll", "");
if (!/github\.io$/.test(new URL(CFG.siteUrl).host)) write("CNAME", new URL(CFG.siteUrl).host);
write("data/items.json", dataJson);
for (const f of fs.readdirSync(ROOT)) { if (/\.(png|jpg|jpeg|svg|ico|webp)$/i.test(f)) fs.copyFileSync(path.join(ROOT, f), path.join(DIST, f)); }
if (fs.existsSync(path.join(ROOT, "img"))) fs.cpSync(path.join(ROOT, "img"), path.join(DIST, "img"), { recursive: true, filter: f => !path.basename(f).startsWith("_") });   // _missing.txt 等は公開しない
console.log(`built ${urls.length + 1} pages -> dist/`);
