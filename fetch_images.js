#!/usr/bin/env node
/* 商品画像を自前で持つ（出典URLを出さない）ための取り込み。
   build.js と同じ引き当てで各商品の画像URLを求め、まだ無いものだけダウンロードして
   img/cards/<hash>.webp（幅480px）に保存する。既にある画像は再取得しない。
   取得できなかったものは一覧 img/cards/_missing.txt に書く（サイト側は元URLのまま表示）。 */
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const sharp = require("sharp");
const sd = require("./sheetdata.js");
const ROOT = __dirname, OUT = path.join(ROOT, "img", "cards");
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
const read = f => fs.existsSync(f) ? fs.readFileSync(f, "utf8").replace(/^﻿/, "") : "";
const key = url => crypto.createHash("md5").update(url).digest("hex").slice(0, 12);
const WIDTH = 480, CONC = 6, LIMIT = Number(process.env.IMG_LIMIT || 400);   // 1回の実行で取る上限（毎朝少しずつ埋まる）

/* 薄い「natadecoco」の透かし（斜めに繰り返し） */
function watermark(w, h) {
  const fs = 34, step = 140, rows = [];
  for (let y = -h; y < h * 2; y += step) for (let x = -w; x < w * 2; x += 260) rows.push(`<text x="${x}" y="${y}" font-size="${fs}" font-family="Arial, Helvetica, sans-serif" font-weight="700" fill="#ffffff" fill-opacity="0.28" stroke="#000000" stroke-opacity="0.14" stroke-width="1">natadecoco</text>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><g transform="rotate(-30 ${w / 2} ${h / 2})">${rows.join("")}</g></svg>`;
  return Buffer.from(svg);
}
async function main() {
  const data = JSON.parse(read(path.join(ROOT, "data_sheet.json")));
  const items = sd.sheetToItems(data, CFG);
  sd.resolveImages(items, sd.loadCatalog(read(path.join(ROOT, "master_images.csv"))), sd.loadOverrides(read(path.join(ROOT, "image_overrides.csv"))));
  fs.mkdirSync(OUT, { recursive: true });
  const missFile = path.join(OUT, "_missing.txt");
  const missing = new Set(read(missFile).split("\n").filter(Boolean));
  const urls = [...new Set(items.map(i => i.img).filter(u => /^https?:/.test(u)))];
  const have = u => fs.existsSync(path.join(OUT, key(u) + ".webp"));
  const fresh = urls.filter(u => !have(u) && !missing.has(u)), retry = urls.filter(u => !have(u) && missing.has(u));
  const todo = [...fresh, ...retry].slice(0, LIMIT);   // 新しいものを優先し、余力があれば前回失敗分も再挑戦
  console.log(`画像URL ${urls.length} 件 / 取得済み ${urls.filter(have).length} / 今回取得 ${todo.length}（うち再挑戦 ${Math.max(0, todo.length - fresh.length)}）`);
  let ok = 0, ng = 0, i = 0;
  const alts = new Map(items.filter(x => x.imgAlt && x.imgAlt.length).map(x => [x.img, x.imgAlt]));
  async function worker() {
    while (i < todo.length) {
      const u = todo[i++];
      const cands = [u, ...(alts.get(u) || [])];
      let done = false;
      for (const c of cands) {
        try {
          const r = await fetch(c, { headers: { "User-Agent": "Mozilla/5.0 (kaitori-site image cache)", "Referer": "https://pos.mycalinks.com/" }, signal: AbortSignal.timeout(20000) });
          if (!r.ok) continue;
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length < 1000) continue;
          const base = sharp(buf).resize({ width: WIDTH, withoutEnlargement: true });
          const meta = await base.toBuffer({ resolveWithObject: true });
          await sharp(meta.data).composite([{ input: watermark(meta.info.width, meta.info.height), blend: "over" }]).webp({ quality: 82 }).toFile(path.join(OUT, key(u) + ".webp"));
          ok++; done = true; break;
        } catch (e) { /* 次の候補 */ }
      }
      if (!done) { ng++; missing.add(u); } else missing.delete(u);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  fs.writeFileSync(missFile, [...missing].join("\n"));
  console.log(`取得 ${ok} / 失敗 ${ng}`);
}
main().catch(e => { console.error(e); process.exit(0); });   // 画像取り込みの失敗でビルド全体は止めない
