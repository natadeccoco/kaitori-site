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
const write = (rel, s) => { const f = path.join(DIST, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };

/* ---------- 1. データ読み込み ---------- */
let items = [];
const base = lib.csvToItems(read(path.join(DATA, "data_data.csv")));
items = base;
for (const [file, cat] of Object.entries(CFG.sources)) {
  if (file === "data.csv") continue;
  const txt = read(path.join(DATA, "data_" + file)); if (!txt) continue;
  const extra = lib.sheetToItems(txt, cat); if (!extra.length) continue;
  lib.resolveImages(extra, base);
  items = items.filter(i => i.cat !== cat).concat(extra); // 同カテゴリはシートを正とする
}
// 画像なし(noimage)は空に
items.forEach(i => { if (/noimage/.test(i.img)) i.img = ""; });
const updated = (read(path.join(DATA, "data_updated.txt")).trim()) || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, "/");
console.log(`items: ${items.length}`, Object.fromEntries(CFG.categories.map(c => [c, items.filter(i => i.cat === c).length])), "updated", updated);

/* ---------- 2. 価格表ページ ---------- */
const clientCfg = { lineId: CFG.lineId, lineAddUrl: CFG.lineAddUrl, xUrl: CFG.xUrl, pageSize: CFG.pageSize, categories: CFG.categories, topRarities: CFG.topRarities, topSetsCount: CFG.topSetsCount, oldBackExpansions: null };
const slim = items.map(({ id, name, code, set, rarity, grade, type, cat, no, exp, price, img, imgAlt, note, order }) => ({ id, name, code, set, rarity, grade, type, cat, no, exp, price, img, imgAlt, note, order }));
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

/* ---------- 3. カード個別ページ ---------- */
const cardTpl = read(path.join(SRC, "card.html"));
const catLabel = c => c === "ポケモン" ? "シングルカード" : c === "PSA" ? "PSA10鑑定品" : c === "BOX" ? "未開封BOX" : c;
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
    .replace(/__PRICE__/g, esc(yen(it.price))).replace(/__UPDATED__/g, esc(updated))
    .replace(/__IMG__/g, it.img ? `<img src="${esc(it.img)}" alt="${esc(it.name)}" loading="eager" data-alt="${esc((it.imgAlt || []).join("|"))}" onerror="imgErr(this)">` : `<div class="ph"><span>${esc(it.name)}</span></div>`)
    .replace(/__PSABADGE__/g, /^PSA/i.test(it.grade) ? `<span class="badge"><span class="p">PSA</span><span class="g">${esc(it.grade.replace(/psa/i, ""))}</span></span>` : "")
    .replace(/__LINE_URL__/g, esc(lineUrl)).replace(/__LINE_ADD__/g, esc(CFG.lineAddUrl)).replace(/__ADD_URL__/g, `/#add=${encodeURIComponent(it.id)}`)
    .replace(/__RELATED__/g, related.map(r => `<a class="rc" href="/card/${encodeURIComponent(r.id)}/">${r.img ? `<img src="${esc(r.img)}" alt="" loading="lazy" onerror="this.remove()">` : ""}<b>${esc(r.name)}</b><span>${esc(r.code)}</span><em>${esc(yen(r.price))}</em></a>`).join(""))
    .replace(/__STORES_URL__/g, CFG.storesUrl).replace(/__XURL__/g, esc(CFG.xUrl)).replace(/__COMPANY__/g, esc(CFG.company));
  write(rel + "index.html", wrap(html));
  urls.push({ url, lastmod: updated.replace(/\//g, "-") });
}

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
write("404.html", `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/"><title>移動しました</title></head><body>ページが見つかりません。<a href="/">買取価格表へ</a></body></html>`);
write(".nojekyll", "");
write("CNAME", new URL(CFG.siteUrl).host);
write("data/items.json", dataJson);
for (const f of fs.readdirSync(ROOT)) { if (/\.(png|jpg|jpeg|svg|ico|webp)$/i.test(f)) fs.copyFileSync(path.join(ROOT, f), path.join(DIST, f)); }
if (fs.existsSync(path.join(ROOT, "img"))) fs.cpSync(path.join(ROOT, "img"), path.join(DIST, "img"), { recursive: true });
console.log(`built ${urls.length + 1} pages -> dist/`);
