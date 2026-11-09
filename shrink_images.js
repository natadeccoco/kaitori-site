/* 公開用（dist/img/cards）のカード画像を軽くする。
   リポジトリ側の img/cards は元のまま（480px）で、公開するコピーだけ幅400px・品質72に再圧縮して
   GitHub Pages へのデプロイ時間（タイムアウト）を減らす。失敗した画像はそのまま残す。 */
const fs = require("fs"), path = require("path");
const sharp = require("sharp");
const DIR = path.join(__dirname, "dist", "img", "cards");
const WIDTH = Number(process.env.SHRINK_WIDTH || 400), Q = Number(process.env.SHRINK_Q || 72);
(async () => {
  if (!fs.existsSync(DIR)) { console.log("no dist/img/cards"); return; }
  const files = fs.readdirSync(DIR).filter(f => f.endsWith(".webp"));
  let before = 0, after = 0, n = 0;
  const CONC = 8; let i = 0;
  async function worker() {
    while (i < files.length) {
      const f = files[i++], p = path.join(DIR, f);
      try {
        const buf = fs.readFileSync(p); before += buf.length;
        const out = await sharp(buf).resize({ width: WIDTH, withoutEnlargement: true }).webp({ quality: Q }).toBuffer();
        if (out.length < buf.length) { fs.writeFileSync(p, out); after += out.length; } else after += buf.length;
        n++;
      } catch (e) { after += fs.statSync(p).size; }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  console.log(`shrink: ${n} files, ${(before / 1048576).toFixed(1)}MB -> ${(after / 1048576).toFixed(1)}MB`);
})();
