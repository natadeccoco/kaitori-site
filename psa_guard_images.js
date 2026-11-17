#!/usr/bin/env node
/* 2026-11-17 急変ガード（LINE WORKS役員グループ）用: PSA10のカード画像に「PSA10」の帯を入れたJPEGを作る。
   サイトの取り込み済み画像（img/cards/<hash>.webp）から dist/img/psa_guard/<hash>.jpg を作り、
   対応表 dist/img/psa_guard/index.json（"型番|カード名" → 画像URL）を書く。リポジトリには保存しない（毎回作り直す）。
   サイトの表示には使わない（役員グループの通知だけで使う）。失敗してもビルドは止めない。 */
const fs = require("fs"), path = require("path"), crypto = require("crypto");
let sharp; try { sharp = require("sharp"); } catch (e) { console.log("psa_guard: sharpなし→スキップ"); process.exit(0); }
const sd = require("./sheetdata.js");
const ROOT = __dirname, SRC = path.join(ROOT, "img", "cards"), OUT = path.join(ROOT, "dist", "img", "psa_guard");
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
const read = f => fs.existsSync(f) ? fs.readFileSync(f, "utf8").replace(/^﻿/, "") : "";
const key = url => crypto.createHash("md5").update(url).digest("hex").slice(0, 12);
function band(w, h) {
  const bh = Math.round(h * 0.13), fsz = Math.round(bh * 0.72);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<rect x="0" y="0" width="${w}" height="${bh}" fill="#c8102e"/>` +
    `<text x="${w / 2}" y="${Math.round(bh * 0.76)}" text-anchor="middle" font-size="${fsz}" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-weight="700" fill="#ffffff" letter-spacing="2">PSA10</text>` +
    `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" fill="none" stroke="#c8102e" stroke-width="4"/></svg>`);
}
(async () => {
  try {
    const data = JSON.parse(read(path.join(ROOT, "data_sheet.json")));
    const items = sd.sheetToItems(data, CFG);
    sd.resolveImages(items, sd.loadCatalog(read(path.join(ROOT, "master_images.csv"))), sd.loadOverrides(read(path.join(ROOT, "image_overrides.csv"))));
    fs.mkdirSync(OUT, { recursive: true });
    const map = {}; let ok = 0, ng = 0;
    for (const it of items) {
      if (it.grade !== "PSA10" || !/^https?:/.test(it.img || "")) continue;
      if (!(Number(it.price) >= 20000)) continue;   // 急変ガードは5万円超が対象なので、安いカードは作らない（公開サイズを抑える）
      const h = key(it.img), src = path.join(SRC, h + ".webp");
      if (!fs.existsSync(src)) { ng++; continue; }
      const dst = path.join(OUT, h + ".jpg");
      try {
        if (!fs.existsSync(dst)) {
          const img = sharp(src).resize({ width: 320, withoutEnlargement: true });
          const m = await img.toBuffer({ resolveWithObject: true });
          await sharp(m.data).composite([{ input: band(m.info.width, m.info.height), blend: "over" }]).jpeg({ quality: 72 }).toFile(dst);
        }
        map[String(it.no || "").trim() + "|" + String(it.name || "").trim()] = `${CFG.siteUrl}/img/psa_guard/${h}.jpg`;
        ok++;
      } catch (e) { ng++; }
    }
    fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify({ updated: new Date().toISOString(), map }));
    console.log(`psa_guard: 作成 ${ok} / 画像なし ${ng}`);
  } catch (e) { console.log("psa_guard: 失敗（ビルドは続ける） " + e); }
})();
