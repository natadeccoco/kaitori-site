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
const updated = (read(path.join(DATA, "data_updated.txt")).trim()) || (sheetJson && JSON.parse(sheetJson).updated) || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, "/");
console.log(`items: ${items.length}`, Object.fromEntries(CFG.categories.map(c => [c, items.filter(i => i.cat === c).length])), "updated", updated);

/* ---------- 2. 価格表ページ ---------- */
const clientCfg = { lineId: CFG.lineId, lineAddUrl: CFG.lineAddUrl, xUrl: CFG.xUrl, pageSize: CFG.pageSize, categories: CFG.categories, topRarities: CFG.topRarities, topSetsCount: CFG.topSetsCount, oldBackExpansions: null };
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
write("404.html", `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="4;url=/"><title>ページが見つかりません｜ナタデココ</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;font-family:"M PLUS Rounded 1c","Zen Kaku Gothic New",sans-serif;background:linear-gradient(135deg,#FFF6C9,#B8F4F4 50%,#DCCBFF);color:#173B5C}img{height:200px}h1{margin:12px 0 4px;font-size:22px}a{display:inline-block;margin-top:14px;background:#fff;border:2px solid #A9F3F4;border-radius:999px;padding:10px 22px;text-decoration:none;color:#173B5C;font-weight:700;box-shadow:0 3px 0 #A9F3F4}</style></head><body><div><img src="/img/chars/amery2.webp" alt=""><h1>ページが見つかりません</h1><p>数秒後に買取価格表へ移動します。</p><a href="/">買取価格表へ</a></div></body></html>`);
write(".nojekyll", "");
if (!/github\.io$/.test(new URL(CFG.siteUrl).host)) write("CNAME", new URL(CFG.siteUrl).host);
write("data/items.json", dataJson);
for (const f of fs.readdirSync(ROOT)) { if (/\.(png|jpg|jpeg|svg|ico|webp)$/i.test(f)) fs.copyFileSync(path.join(ROOT, f), path.join(DIST, f)); }
if (fs.existsSync(path.join(ROOT, "img"))) fs.cpSync(path.join(ROOT, "img"), path.join(DIST, "img"), { recursive: true });
console.log(`built ${urls.length + 1} pages -> dist/`);
