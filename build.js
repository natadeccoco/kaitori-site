#!/usr/bin/env node
/* ナタデココ 買取表 — 静的サイト生成
   data/ の CSV（Myca商品マスタ形式 + 買取表シートの各タブ）を読み、dist/ に
   index.html（価格表アプリ）、card/<id>/（カード個別ページ）、stores/ legal/ privacy/、sitemap.xml、robots.txt を出力する。 */
const fs = require("fs"), path = require("path");
const lib = require("./lib.js");
const CFG = JSON.parse(fs.readFileSync("config.json", "utf8"));
const RAW_CATS = ["ポケモン", "PSA", "BOX", "旧裏", "旧弾", "汎用"];   // データ上のカテゴリ（表示のまとめ方は config.catGroups）
lib.setConfig({ categories: RAW_CATS });
const ROOT = __dirname, DATA = ROOT, DIST = path.join(ROOT, "dist"), SRC = ROOT;
const esc = lib.esc;
const yen = n => "¥" + (Math.round(Number(n) * 10) / 10).toLocaleString("ja-JP");
const read = f => fs.existsSync(f) ? fs.readFileSync(f, "utf8").replace(/^﻿/, "") : "";
// サイトのベースパス（独自ドメインなら "/"、github.io の仮公開なら "/kaitori-site/"）。HTML内の href="/..." をこれに置き換える
const BASE = (() => { let p = new URL(CFG.siteUrl).pathname; if (!p.endsWith("/")) p += "/"; return p; })();
const rebase = s => BASE === "/" ? s : s.replace(/(href|src|action)="\/(?!\/)/g, `$1="${BASE}`);
// 期間限定キャンペーンの帯（config.campaign）。ページのヘッダー直後に入れ、期間外はブラウザ側で自動的に隠す
const CAMP = CFG.campaign && CFG.campaign.on && CFG.campaign.banner !== false ? CFG.campaign : null;   // banner:false でバナーだけ消す（条件ページ・LINEはそのまま）
const CAMP_HTML = CAMP ? `<div id="ndCamp" data-s="${CAMP.start}" data-e="${CAMP.end}" style="display:none"><a href="/rules/#campaign" class="ndCampBar"><span class="ndCampTag">11/30まで</span><span class="ndCampMain">宅配買取 <b>買取金額5%UP</b></span><span class="ndCampSub">買取総額1万円以上が対象｜1回の上乗せ上限3万円まで｜期間中何回でもOK</span><span class="ndCampMore">条件を見る ›</span></a><style>#ndCamp{position:sticky;top:0;z-index:19}.ndCampBar{display:flex;align-items:center;justify-content:center;gap:20px;flex-wrap:wrap;box-sizing:border-box;min-height:96px;padding:12px 16px;background:linear-gradient(90deg,#ff4f8b,#ff7aa8 50%,#ff4f8b);border-top:3px solid #fff;border-bottom:3px solid #fff;color:#fff;text-decoration:none;font-family:"M PLUS Rounded 1c",sans-serif;font-weight:800;font-size:26px;line-height:1.3;text-align:center;box-shadow:0 4px 12px rgba(43,58,103,.12)}.ndCampBar:hover{filter:brightness(1.05)}.ndCampTag{background:#fff;color:#e8306f;border-radius:999px;padding:4px 18px;font-size:22px}.ndCampMain b{font-size:46px;color:#fff6a8;letter-spacing:.02em}.ndCampSub{font-size:21px}.ndCampMore{font-size:20px;background:#fff;color:#e8306f;border-radius:999px;padding:5px 16px}@media(max-width:1250px){.ndCampBar{font-size:20px;gap:14px}.ndCampTag{font-size:17px}.ndCampMain b{font-size:34px}.ndCampSub{font-size:16px}.ndCampMore{font-size:16px}}@media(max-width:600px){.ndCampBar{min-height:0!important;gap:2px 6px;font-size:13px;padding:6px 8px;border-width:2px}.ndCampTag{font-size:11px;padding:1px 8px}.ndCampMain b{font-size:15px}.ndCampSub{flex-basis:100%;order:3;font-size:11px}.ndCampMore{font-size:11px;padding:1px 8px;background:none;color:#fff;text-decoration:underline}}</style></div><script>(function(){var b=document.getElementById("ndCamp");if(!b)return;var n=Date.now(),s=Date.parse(b.dataset.s+"T00:00:00+09:00"),e=Date.parse(b.dataset.e+"T23:59:59+09:00");if(!(n>=s&&n<=e)){b.remove();return}b.style.display="block";var h=document.querySelector("header"),t=document.querySelector(".ticker");function fit(){if(h&&getComputedStyle(h).position=="sticky")b.style.top=h.offsetHeight+"px";if(t&&t.offsetHeight>40&&innerWidth>600)b.querySelector(".ndCampBar").style.minHeight=t.offsetHeight+"px";}fit();addEventListener("resize",fit);addEventListener("load",fit);setTimeout(fit,1500);})();</script>` : "";
const CAMP_SKIP = /^(liff|staff|recruit|company|privacy|legal)\//;
const CAMP_ONLY = /./;   // 2026-11-18 広告再開に合わせて全ページに表示（LP・買取表・カード個別・トップなど。CAMP_SKIP のページは除く）
// 2026-11-21 店頭の「対象カード5%UP」バナー（config.json の storeUp.on。対象カードが1枚以上ある時だけ。宅配5%UPの帯の代わりに出す。出すのは店頭の買取表（トップ）と店舗一覧だけ。宅配・LP・カード個別など、宅配につながるページには絶対に出さない）
let UP_COUNT = 0;   // 対象カードの枚数（下で数える）
const UP_ONLY = /^(index\.html$|stores\/)/;
const UP_START = String((CFG.storeUp || {}).start || "2000-01-01");   // この日（日本時間）の0時から出す。前の日までは今までどおり宅配5%UPの帯
// 2026-11-26 終了日時。"2026-11-27T21:00:00+09:00" のように時刻まで書けば、その時刻ちょうどで消える（日付だけなら その日の23:59:59）。
// 画面のJSが時計を見て消すので、サイトを作り直さなくてもピタリと終わる。空なら終わりなし。
const UP_END = String((CFG.storeUp || {}).end || "");
const UP_HTML = () => `<div id="ndUp" data-s="${UP_START}" data-e="${UP_END}" style="display:none"><style>#ndUp{position:sticky;top:0;z-index:19}.ndUpBar{display:flex;align-items:center;justify-content:center;gap:16px;flex-wrap:wrap;box-sizing:border-box;min-height:96px;padding:12px 16px;background:linear-gradient(90deg,#ffcf3a,#ffe27a 50%,#ffcf3a);border-top:3px solid #fff;border-bottom:3px solid #fff;color:#5b3a00;text-decoration:none;font-family:"M PLUS Rounded 1c",sans-serif;font-weight:800;font-size:22px;line-height:1.3;text-align:center;box-shadow:0 4px 12px rgba(43,58,103,.12)}.ndUpBar:hover{filter:brightness(1.04)}.ndUpTag{background:#E23B47;color:#fff;border-radius:999px;padding:4px 18px;font-size:19px}.ndUpEnd{background:#fff;color:#E23B47;border:3px solid #E23B47;border-radius:999px;padding:1px 14px;font-size:19px;white-space:nowrap}.ndUpEnd[hidden]{display:none}.ndUpMain b{font-size:40px;color:#E23B47;letter-spacing:.02em}.ndUpSub{font-size:17px}.ndUpMore{font-size:17px;background:#5b3a00;color:#fff;border-radius:999px;padding:5px 16px}@media(max-width:1250px){.ndUpBar{font-size:18px;gap:12px}.ndUpTag{font-size:15px}.ndUpEnd{font-size:15px;border-width:2px}.ndUpMain b{font-size:30px}.ndUpSub{font-size:14px}.ndUpMore{font-size:14px}}@media(max-width:600px){.ndUpBar{min-height:0;gap:2px 6px;font-size:13px;padding:6px 8px;border-width:2px}.ndUpTag{font-size:11px;padding:1px 8px}.ndUpEnd{font-size:11px;padding:0 8px;border-width:2px}.ndUpMain b{font-size:16px}.ndUpSub{flex-basis:100%;order:3;font-size:11px}.ndUpMore{font-size:11px;padding:1px 8px;background:none;color:#5b3a00;text-decoration:underline}}</style><a href="/?up=1#list" class="ndUpBar"><span class="ndUpTag">店頭買取</span><span class="ndUpEnd" id="ndUpEnd" hidden></span><span class="ndUpMain">対象カード <b>買取UPキャンペーン</b></span><span class="ndUpSub">対象カードは買取価格${String((CFG.storeUp || {}).label || "5%UP")}</span><span class="ndUpMore">対象カードを見る ›</span></a></div>`;
const UP_JS = `<script>(function(){var u=document.getElementById("ndUp");if(!u)return;var E=u.dataset.e||"",et=E?(E.length<=10?Date.parse(E+"T23:59:59+09:00"):Date.parse(E)):Infinity,n=Date.now();if(n<Date.parse(u.dataset.s+"T00:00:00+09:00")||n>et){u.remove();return}var c=document.getElementById("ndCamp");if(c)c.remove();u.style.display="block";var L=document.getElementById("ndUpEnd");if(L&&isFinite(et)){var J=32400000,de=new Date(et+J),dd=Math.floor((et+J)/86400000)-Math.floor((n+J)/86400000),T=E.length<=10?"":(de.getUTCHours()+(de.getUTCMinutes()?":"+("0"+de.getUTCMinutes()).slice(-2):"時"));L.textContent=dd<=0?"本日"+T+"まで！":dd===1?"明日"+T+"まで！":(de.getUTCMonth()+1)+"/"+de.getUTCDate()+(T?" "+T:"")+"まで";L.hidden=false;}var h=document.querySelector("header");function fit(){if(h&&getComputedStyle(h).position=="sticky")u.style.top=h.offsetHeight+"px";}fit();addEventListener("resize",fit);addEventListener("load",fit);})();</script>`;
// 店頭のお知らせ帯（例：BOXの店頭買取を一時ストップ）。店頭の買取表・店舗一覧だけに出す。宅配のページには出さない。config.json の storeNotice で文言と期間を決める
const NT_LIST = CFG.storeNotice && CFG.storeNotice.on ? (CFG.storeNotice.items || [CFG.storeNotice]) : [];   // items に並べると、期間ごとに文言を切り替えられる
const NT = NT_LIST.length ? NT_LIST : null;
const NT_ESC = t => String(t || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const NT_BAR = t => { const tag = t.href ? "a" : "div"; return `<${tag}${t.href ? ` href="${NT_ESC(t.href)}"` : ""} class="ndStopBar" data-s="${NT_ESC(t.start)}" data-e="${NT_ESC(t.end)}"><span class="ndStopTag">${NT_ESC(t.tag || "店頭買取")}</span><span class="ndStopMain"><b>${NT_ESC(t.main)}</b></span>${t.sub ? `<span class="ndStopSub">${NT_ESC(t.sub)}</span>` : ""}${t.more ? `<span class="ndStopMore">${NT_ESC(t.more)}</span>` : ""}</${tag}>`; };
const NT_HTML = NT ? `<div id="ndStop" style="display:none"><style>#ndStop.solo{position:sticky;top:0;z-index:19}.ndStopBar{display:flex;align-items:center;justify-content:center;gap:16px;flex-wrap:wrap;box-sizing:border-box;padding:12px 16px;background:#2b3a67;border-top:3px solid #fff;color:#fff;font-family:"M PLUS Rounded 1c",sans-serif;font-weight:800;font-size:24px;line-height:1.3;text-align:center}.ndStopTag{background:#fff;color:#2b3a67;border-radius:999px;padding:3px 16px;font-size:19px;white-space:nowrap}.ndStopMain b{color:#ffe27a;font-size:30px}.ndStopSub{background:#E23B47;border-radius:8px;padding:3px 14px;font-size:21px;white-space:nowrap}@media(max-width:1250px){.ndStopBar{font-size:19px;gap:10px}.ndStopTag{font-size:15px}.ndStopMain b{font-size:24px}.ndStopSub{font-size:17px}}@media(max-width:600px){.ndStopBar{font-size:13px;gap:3px 6px;padding:6px 8px;border-width:2px}.ndStopTag{font-size:11px;padding:1px 8px}.ndStopMain b{font-size:15px}.ndStopSub{font-size:12px;padding:1px 8px;border-radius:6px}}a.ndStopBar{text-decoration:none}a.ndStopBar:hover{filter:brightness(1.12)}.ndStopMore{background:#fff;color:#2b3a67;border-radius:999px;padding:3px 14px;font-size:18px;white-space:nowrap}@media(max-width:1250px){.ndStopMore{font-size:14px}}@media(max-width:600px){.ndStopMore{font-size:11px;padding:1px 8px}}</style>${NT.map(NT_BAR).join("")}</div>` : "";
const NT_JS = `<script>(function(){var b=document.getElementById("ndStop");if(!b)return;var n=Date.now(),k=0;[].slice.call(b.querySelectorAll(".ndStopBar")).forEach(function(x){var s=Date.parse(x.dataset.s),e=Date.parse(x.dataset.e);if(n>=s&&n<=e)k++;else x.remove();});if(!k){b.remove();return}b.style.display="block";var c=document.getElementById("ndCamp")||document.getElementById("ndUp");if(c){c.insertBefore(b,c.firstChild);return}b.className="solo";var h=document.querySelector("header");function fit(){if(h&&getComputedStyle(h).position=="sticky")b.style.top=h.offsetHeight+"px";}fit();addEventListener("resize",fit);addEventListener("load",fit);})();</script>`;
const addCamp = (rel, s) => {
  if (CAMP_SKIP.test(rel) || s.indexOf("</header>") < 0) return s;
  const camp = (CAMP && CAMP_ONLY.test(rel)) ? CAMP_HTML : "";   // 宅配5%UPの帯（宅配・LP・カード個別などは今までどおり）
  const up = (UP_COUNT > 0 && UP_ONLY.test(rel)) ? UP_HTML() : "";   // 店頭の買取表・店舗一覧だけ：開始日からは店頭キャンペーンのバナーに入れ替える
  const nt = (NT && UP_ONLY.test(rel)) ? NT_HTML : "";
  return (camp || up || nt) ? s.replace("</header>", "</header>" + up + nt + camp + (up ? UP_JS : "") + (nt ? NT_JS : "")) : s;
};
const write = (rel, s) => { if (/\.html$/.test(rel)) s = addCamp(rel, s); const f = path.join(DIST, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, /\.html$/.test(rel) ? rebase(s) : s); };

/* ---------- 1. データ読み込み ---------- */
let items = [];
const sheetJson = read(path.join(DATA, "data_sheet.json"));
if (sheetJson) {
  // 買取表スプレッドシート（GAS sitedata）＋ Myca画像カタログ
  const sd = require("./sheetdata.js");
  const data = JSON.parse(sheetJson);
  // おたちゅう価格だけで決まった行（ラッシュ欄が空。GAS が oonly:1 を付ける）はサイトに出さない（config.json の hideOtachuOnly。買取表スプレッドシートには残る）
  if (CFG.hideOtachuOnly) {
    const only = { ...data, tabs: data.tabs.map(t => ({ ...t, rows: t.rows.filter(r => r.oonly) })).filter(t => t.rows.length) };
    const gone = only.tabs.length ? sd.sheetToItems(only, CFG) : [];
    gone.forEach(i => { if (i.id && /^[\w-]+$/.test(i.id)) fs.rmSync(path.join(DIST, "card", i.id), { recursive: true, force: true }); });   // 以前つくった個別ページも消す
    data.tabs.forEach(t => { t.rows = t.rows.filter(r => !r.oonly); });
    console.log(`サイト非表示（おたちゅうのみ参照）: ${gone.length} 件`);
  }
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
// サイトに出さないカード（config.json の hideNames：名前にこの文字が入るものは載せない。買取表スプレッドシートはそのまま）
{
  const hn = (CFG.hideNames || []).filter(Boolean);
  if (hn.length) { const n0 = items.length; const isHide = i => hn.some(w => String(i.name || "").includes(w));
    // 以前つくった個別ページが残っていれば消す（URLを直接開いても出ないように）
    items.filter(isHide).forEach(i => { if (i.id && /^[\w-]+$/.test(i.id)) fs.rmSync(path.join(DIST, "card", i.id), { recursive: true, force: true }); });
    items = items.filter(i => !isHide(i)); console.log(`サイト非表示（hideNames）: ${n0 - items.length} 件`); }
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
// おすすめ順＝最新シリーズを上位に（MEGA → SV → ソード&シールド → サン&ムーン → XY → BW以前）。同じシリーズ内では価格の高い順
function seriesScore(i) {
  const e = String(i.exp || "").trim(), tab = i.tab || "", set = i.set || "";
  const num = (m) => 0;   // シリーズ単位でまとめ、シリーズ内は価格順（弾ごとに分けたい場合は m[1] を使う）
  let m;
  if ((m = e.match(/^M(\d+)?/)) && !/^MC|^MF/.test(e)) return 900 + num(m);
  if (/^M[CF]/.test(e)) return 900;
  if ((m = e.match(/^SV(\d+)?/i))) return 800 + num(m);
  if ((m = e.match(/^SM(\d+)?/i))) return 600 + num(m);
  if ((m = e.match(/^S(\d+)?/i))) return 700 + num(m);
  if ((m = e.match(/^XY(\d+)?/i)) || /^CP/.test(e)) return 500 + num(m);
  if (/^BW/i.test(e)) return 400;
  const byTab = { "MEGA": 900, "SV": 800, "SS": 700, "SM": 600, "XY": 500, "BW以前": 400 };
  if (byTab[tab]) return byTab[tab];
  if (i.cat === "BOX") { const bySet = { "MEGA": 900, "SV": 800, "SS": 700, "SM": 600, "XY": 500 }; return bySet[set] || 300; }
  return 0;
}
// 2026-11-21 店頭の対象カード5%UP：買取表スプレッドシートの「5%UP」列に印がある行（シングルだけ）に、店頭用の価格 sp を付ける
// 端数（2026-11-21 本人決定）：1万円未満は10円単位、1万円〜10万円未満は100円単位、10万円以上は1,000円単位で切り上げ（宅配の価格 price は変えない）
{ const SU = CFG.storeUp || {}, rate = Number(SU.rate) || 0;
  const up = p => { const v = Math.round(p * rate * 100) / 100, u = p < 10000 ? 10 : p < 100000 ? 100 : 1000; return Math.ceil(v / u - 1e-9) * u; };
  items.forEach(i => { i.sp = 0; if (SU.on && rate > 1 && i.up5 && i.cat === "ポケモン" && i.price > 0) { const s = up(i.price); if (s > i.price) { i.sp = s; UP_COUNT++; } } });
  console.log(`店頭5%UP: ${UP_COUNT} 件`); }
{ const idx = {}; items.forEach(i => { let sc = seriesScore(i); if (i.cat === "BOX") { idx[i.set] = (idx[i.set] || 0) + 1; sc -= idx[i.set] * 0.001; } i.order = sc; }); }
const updated = (read(path.join(DATA, "data_updated.txt")).trim()) || (sheetJson && JSON.parse(sheetJson).updated) || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, "/");
console.log(`items: ${items.length}`, Object.fromEntries(RAW_CATS.map(c => [c, items.filter(i => i.cat === c).length])), "updated", updated);

/* ---------- 2. 価格表ページ ---------- */
const clientCfg = { storeUpStart: UP_START, storeUpEnd: UP_END, base: BASE, catGroups: CFG.catGroups || {}, lineId: CFG.lineId, lineAddUrl: CFG.lineAddUrl, xUrl: CFG.xUrl, xTk: "https://x.com/" + (CFG.xTakuhai || "coco_netshop"), pageSize: CFG.pageSize, categories: CFG.categories, topRarities: CFG.topRarities, topSetsCount: CFG.topSetsCount, oldBackExpansions: null };
const slim = items.map(({ id, name, code, set, rarity, grade, type, cat, no, exp, price, price2, img, imgAlt, note, order, sp }) => Object.assign({ id, name, code, set, rarity, grade, type, cat, no, exp, price, price2, img, imgAlt, note, order }, sp ? { sp } : {}));   // sp = 店頭の5%UP価格（対象カードだけ）
const dataJson = JSON.stringify({ updated, items: slim }).replace(/</g, "\\u003c");
const headCommon = (title, desc, url, image) => `${desc ? `<meta name="description" content="${esc(desc)}">\n` : ""}<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(CFG.siteName)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
${image ? `<meta property="og:image" content="${esc(image)}">` : ""}
<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">
<link rel="canonical" href="${esc(url)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">`;
const pageTpl = read(path.join(SRC, "page.html"));
// 宅配買取店X（@coco_netshop）のフォロー案内。カード個別ページと宅配ページに出す（11/20 フォロワー1,000人に向けて）
const X_TK = CFG.xTakuhai || "coco_netshop";
const X_FOLLOW_HTML = `<aside class="xfol"><span class="xfol-ic" aria-hidden="true">𝕏</span><span class="xfol-tx"><b>買取強化・価格アップ情報をXで毎日配信中</b><small>ナタデココ宅配買取店 @${esc(X_TK)}</small></span><a class="xfol-btn" href="https://x.com/intent/follow?screen_name=${encodeURIComponent(X_TK)}" target="_blank" rel="noopener" onclick="window.gtag&&gtag('event','x_follow',{page_path:location.pathname})">フォローする</a><style>.xfol{display:flex;align-items:center;gap:12px;max-width:880px;margin:18px auto;padding:12px 16px;border-radius:16px;background:#14171a;color:#fff;box-sizing:border-box}.xfol-ic{font-size:26px;font-weight:800;line-height:1}.xfol-tx{flex:1;min-width:0;line-height:1.35}.xfol-tx b{display:block;font-size:15px}.xfol-tx small{font-size:12px;opacity:.75}.xfol-btn{flex:none;background:#fff;color:#14171a;border-radius:999px;padding:9px 18px;font-weight:800;font-size:14px;text-decoration:none}.xfol-btn:hover{opacity:.9}@media(max-width:600px){.xfol{margin:14px 12px;gap:10px;padding:10px 12px}.xfol-tx b{font-size:13px}.xfol-btn{padding:8px 14px;font-size:13px}}</style></aside>\n`;
// 宅配買取ページ：AI・検索向けの説明（サービス情報・申込の流れ・よくある質問）。答えは /faq/ と /rules/ の範囲内（11/20）
const TK_FAQ = [
  ["送料や手数料はかかりますか？", "かかりません。送料（佐川急便の着払い）・査定料・キャンセル料・返送料・振込手数料はすべて無料です。"],
  ["入金はいつですか？", "本査定にご納得いただき、本人確認（スマホで完結するeKYC）が完了したあと、最短で当日中にお振込みします。"],
  ["遠方からでも利用できますか？", "はい。全国どこからでもご利用いただけます。お手持ちの箱にカードを入れて、着払いでお送りください。"],
  ["査定額に納得できなかったら？", "キャンセルできます。返送料は当店が負担します。"],
  ["店頭買取と価格は違いますか？", "同じ価格です。千葉・東京・神奈川の8店舗の店頭買取と同じ買取価格表で査定します。申込日の翌日から3日以内にカードが届けば、申込時の価格で査定します。"],
];
const TK_FAQ_HTML = `<section class="tkfaq" aria-labelledby="tkfaqh"><h2 id="tkfaqh">宅配買取のよくある質問</h2>${TK_FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}<p class="tkfaqm"><a href="/faq/">よくある質問をもっと見る ›</a></p><style>.tkfaq{max-width:880px;margin:28px auto 30px;padding:0 16px;color:var(--navy)}.tkfaq h2{font-size:20px;margin:0 0 12px;text-align:center}.tkfaq details{background:#fff;border:2px solid #FFE2F1;border-radius:14px;margin:8px 0;padding:12px 16px}.tkfaq summary{font-weight:800;cursor:pointer}.tkfaq p{margin:8px 0 0;line-height:1.7}.tkfaq .tkfaqm{text-align:center;margin-top:12px}</style></section>\n`;
const TK_LD = `
<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Service", name: "ポケモンカード宅配買取（ナタデココ）", serviceType: "ポケモンカード買取", url: CFG.siteUrl + "/takuhai/", areaServed: { "@type": "Country", name: "日本" },
  provider: { "@type": "Organization", name: CFG.company, url: CFG.siteUrl + "/", sameAs: [CFG.xUrl, CFG.shopUrl] },
  description: "全国対応のポケモンカード宅配買取。送料・査定料・キャンセル料・返送料・振込手数料はすべて0円、最短当日入金。首都圏8店舗の店頭買取と同じ価格で買取。申込日の翌日から3日以内に届けば申込時の価格で査定。",
  offers: { "@type": "Offer", price: 0, priceCurrency: "JPY", description: "送料・査定料・キャンセル料・返送料・振込手数料はすべて無料" } })}</script>
<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "HowTo", name: "ナタデココでポケモンカードを宅配買取に出す方法", totalTime: "P3D", estimatedCost: { "@type": "MonetaryAmount", currency: "JPY", value: 0 }, step: [
  { "@type": "HowToStep", position: 1, name: "LINEで申込", text: "買取価格表でカードを選んで「LINEで買取申込へ進む」を押すか、LINEのリッチメニューから申込む。写真を送れば事前見積りも可能。", url: CFG.siteUrl + "/takuhai/" },
  { "@type": "HowToStep", position: 2, name: "着払いで発送", text: "お手持ちの箱にカードを入れ、佐川急便の着払いで送る（送料0円）。スリーブやファイルのままで可。" },
  { "@type": "HowToStep", position: 3, name: "本査定", text: "到着後に1枚ずつ検品し、最終金額をLINEで連絡。納得できなければキャンセル可（返送料は当店負担）。" },
  { "@type": "HowToStep", position: 4, name: "お振込み", text: "スマホで本人確認（eKYC・顔写真付き身分証）のあと、最短当日に振込。" }] })}</script>
<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: TK_FAQ.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) })}</script>`;
// 買取表は2つ：トップ＝店頭買取（カート・LINE申込なし）／ /takuhai/ ＝宅配買取（カート・LINE申込あり）
const makePage = (mode, tpl = pageTpl) => { const st = mode === "store";
return tpl.replace(/__SELLMODE__/g, mode)
  .replace("__PAGETITLE__", st ? "ナタデココ ポケカ買取価格表｜店頭買取" : "ナタデココ ポケカ買取価格表｜宅配買取")
  .replace("__MODELABEL__", st ? "店頭買取" : `宅配買取</small><small class="h1s same">店頭と同じ価格`)
  .replace("__MODELINK__", "")
  .replace("__MODEBNR__", st
    ? `<a class="tkbnr" href="/takuhai/" aria-label="宅配買取はコチラ"><span class="tk-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/></svg></span><span class="tk-tx"><small>お店に行けない方・遠方の方は</small><b>宅配買取は<em>コチラ</em></b><span class="tk-sub">店頭と同じ価格・返送料まで無料・最短当日入金</span></span><span class="tk-ar" aria-hidden="true">›</span></a>`
    : `<a class="tkbnr" href="/" aria-label="店頭買取はコチラ"><span class="tk-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 9l1-5h16l1 5M4 9v11h16V9M9 20v-6h6v6"/></svg></span><span class="tk-tx"><small>お店に持ち込んで売る方は</small><b>店頭買取は<em>コチラ</em></b><span class="tk-sub">千葉・東京・神奈川 8店舗</span></span><span class="tk-ar" aria-hidden="true">›</span></a>`)
  .replace('<footer id="stores">', st ? X_FOLLOW_HTML + '<footer id="stores">' : X_FOLLOW_HTML + TK_FAQ_HTML + '<footer id="stores">')
  .replace("/*__CONFIG__*/{}", JSON.stringify(clientCfg))
  .replace("__DATA__", dataJson)
  .replace(/__STORES_URL__/g, CFG.storesUrl)
  .replace("<!--__HEAD__-->", headCommon(st ? "ナタデココ｜ポケカ買取価格表（店頭買取）" : "ナタデココ｜ポケカ宅配買取 買取価格表", st ? "ポケモンカード専門店ナタデココの店頭買取価格表。千葉・東京・神奈川の8店舗で、シングル・PSA10・未開封BOX・旧裏を毎日更新の価格で買取。" : "全国対応・送料無料（キャンセル時の返送料も無料）・最短当日入金のポケモンカード宅配買取。首都圏8店舗の専門店ナタデココが店頭と同じ価格で買取。シングル・PSA10・未開封BOX・旧裏の買取価格表を毎日更新、カードを選んでLINEで申込。", CFG.siteUrl + (st ? "/" : "/takuhai/"), CFG.siteUrl + "/ogp.png") + `
<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Organization", name: CFG.company, url: CFG.siteUrl, sameAs: [CFG.xUrl, CFG.shopUrl] })}</script>` + (st ? "" : TK_LD) + (st ? `
<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "WebSite", name: CFG.siteName, alternateName: ["ナタデココ", "ナタデココ買取表"], url: CFG.siteUrl + "/" })}</script>` : "")) };
const SITE_FX = fs.existsSync(path.join(SRC, "site_fx.html")) ? read(path.join(SRC, "site_fx.html")) : "";   // 全ページ共通の仕上げ（LINEアイコン・進捗バー・キラキラ・キャラ反応）
// 流入元の記録（どのLP・どの広告から来たか）。全ページに常に入る（IDの設定とは無関係）
//   広告のリンク先URLに ?utm_source=google&utm_campaign=…&utm_content=広告番号 を付けておくと、
//   30日間ブラウザに覚え、LINE申込文の末尾に「受付コード：G-旧裏LP-g01」のように入る（店側で広告別の成約を数える用）
const ATTR_TAG = `<script>(function(){try{var K="nd_attr",q=new URLSearchParams(location.search),p=location.pathname,
lp=/\\/lp\\/old\\//.test(p)?"旧裏LP":/\\/lp\\/box\\//.test(p)?"BOXLP":/\\/lp\\/psa\\//.test(p)?"PSALP":/\\/lp\\/matome\\//.test(p)?"まとめLP":/\\/lp\\//.test(p)?"総合LP":"",
src=q.get("utm_source")||(q.get("gclid")?"google":""),now=Date.now(),old=null;
try{old=JSON.parse(localStorage.getItem(K)||"null");}catch(e){}
if(old&&now-old.t>2592e6)old=null;
if(src){old={src:src,camp:q.get("utm_campaign")||"",ad:q.get("utm_content")||"",lp:lp||"トップ",t:now};}
else if(lp&&!old){old={src:"",camp:"",ad:"",lp:lp,t:now};}
if(old)try{localStorage.setItem(K,JSON.stringify(old));}catch(e){}
window.ndAttr=function(){return old||{};};
window.ndAttrCode=function(){if(!old)return "";var s=old.src.toLowerCase(),L=/google|gclid/.test(s)?"G":/^(x|twitter)/.test(s)?"X":/line/.test(s)?"L":s?s.slice(0,3).toUpperCase():"自然";
return [L,old.lp,old.ad||old.camp].filter(Boolean).join("-");};}catch(e){window.ndAttrCode=function(){return ""};window.ndAttr=function(){return {}};}})();</script>
`;
// 計測タグ（config.tracking に ID を入れたときだけ全ページの <head> に入る。空なら何も出ない）
//   ga4 = GA4 の測定ID（G-XXXX） / ads = Google広告のタグID（AW-XXXX） / adsLabels = コンバージョンラベル
//   成果：LINE友だち追加ボタン → line_add、「LINEで買取申込へ進む」（oaMessage）→ line_apply
const TRK = CFG.tracking || {};
const X_TAG = TRK.xPixel ? `<script>!function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments);},s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');twq('config',${JSON.stringify(TRK.xPixel)});</script>
` : "";   // Xピクセル（11/18）
const TRACK_TAG = (TRK.ga4 || TRK.ads) ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${TRK.ga4 || TRK.ads}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag("js",new Date());${TRK.ga4 ? `gtag("config",${JSON.stringify(TRK.ga4)});` : ""}${TRK.ads ? `gtag("config",${JSON.stringify(TRK.ads)});` : ""}
(function(){var ADS=${JSON.stringify(TRK.ads || "")},LB=${JSON.stringify(TRK.adsLabels || {})};
document.addEventListener("click",function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href*="line.me"]');if(!a)return;
var k=/oaMessage/.test(a.href)?"apply":"line_add";gtag("event",k==="apply"?"line_apply":"line_add",{link_id:a.id||a.className||"",page_path:location.pathname,nd_lp:(window.ndAttr&&ndAttr().lp)||"",nd_ad:(window.ndAttrCode&&ndAttrCode())||""});
if(ADS&&LB[k]&&k!=="apply")gtag("event","conversion",{send_to:ADS+"/"+LB[k]});},true);
/* 申込が本当に受け付けられたとき（スプレッドシートに行ができたとき）に呼ぶ：GA4は apply_done、Google広告は adsLabels.apply */
window.ndConv=function(k,p){p=p||{};try{gtag("event",k==="apply"?"apply_done":k,Object.assign({nd_lp:(window.ndAttr&&ndAttr().lp)||"",nd_ad:(window.ndAttrCode&&ndAttrCode())||""},p));if(ADS&&LB[k])gtag("event","conversion",Object.assign({send_to:ADS+"/"+LB[k]},p));var XE=${JSON.stringify(TRK.xEvents || {})};if(window.twq&&XE[k])twq("event",XE[k],{value:p.value||0,currency:"JPY",conversion_id:String(p.transaction_id||"")});}catch(e){}};})();</script>
` : "";
const wrap = (body, lang = "ja") => `<!DOCTYPE html>\n<html lang="${lang}">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n${ATTR_TAG}${TRACK_TAG}${X_TAG}${body.slice(0, body.indexOf("</style>") + 8)}\n</head>\n<body>\n${body.slice(body.indexOf("</style>") + 8)}\n${(body.includes("id=\"sfx\"") || body.includes("id=\"runner\"")) ? "" : SITE_FX}\n</body>\n</html>\n`;
const AT = CFG.applyTest || {};
const noApply = s => s.replace(/__APPLY_URL__/g, "").replace(/__LIFF_URL__/g, "").replace(/__LINE_FORM_URL__/g, esc(AT.lineFormUrl || ""));
write("index.html", noApply(wrap(makePage("store"))));
const liveApply = s => AT.gasUrl && AT.live ? s.replace(/__APPLY_URL__/g, AT.gasUrl).replace(/__LIFF_URL__/g, AT.liffId ? "https://liff.line.me/" + AT.liffId : "").replace(/__LINE_FORM_URL__/g, esc(AT.lineFormUrl || "")) : noApply(s);
write("takuhai/index.html", liveApply(wrap(makePage("takuhai"))));   // applyTest.live=true で本番の宅配ページも新しい申込の流れに
// LINEの中継ページ（LIFF）：受付番号をLINEの名前と結びつけ、公式LINEから受付内容を送ってから RECORE の申込フォームへ
if (AT.gasUrl && AT.liffId) write("liff/index.html", fs.readFileSync("liff.html", "utf8").replace(/__LIFF_ID__/g, AT.liffId).replace(/__APPLY_URL__/g, AT.gasUrl).replace(/__LINE_FORM_URL__/g, AT.lineFormUrl || ""));
// テスト用：サイト申込（カート→スプレッドシート→LINE申込フォーム）。検索には出さない・どこからもリンクしない
// テスト用ページ（takuhai-test）は本番切り替え済みのため廃止（2026/11/14）
// （まとめ表示の確認用ページ /preview/ は不採用になったため出力しない。2026-11-14）

/* 収録弾→ページslug（カードページからのリンク用。本体は 3b で生成） */
const psaBadge = r => /^PSA\s*10$/i.test(r.grade || "") ? `<img class="g" src="/img/psa10.webp?v=3" alt="PSA10">` : "";
const CAT_SLUG = { "ポケモン": "pk", PSA: "psa", BOX: "box", "旧裏": "old", "旧弾": "kyu", "汎用": "misc" };
const packSlugBySet = (() => { const m = new Map(); const g = new Map(); for (const it of items) { if (!it.set || it.cat === "汎用") continue; if (!g.has(it.set)) g.set(it.set, []); g.get(it.set).push(it); }
  for (const [set, a] of g) { if (a.length < 3) continue; const exps = [...new Set(a.map(x => x.exp).filter(e => /^[A-Za-z0-9+\-]+$/.test(e)))]; m.set(set, exps.length === 1 ? exps[0].toLowerCase().replace("+", "p") : "p-" + lib.hashId(set)); } return m; })();


/* カード個別ページ用：説明文・別バージョン・FAQ（検索対策で本文を厚くする） */
const baseName = n => (n || "").split(/[（(\s／/]/)[0].replace(/\s+$/, "");
const byBase = new Map(); for (const it of items) { const b = baseName(it.name); if (!b) continue; if (!byBase.has(b)) byBase.set(b, []); byBase.get(b).push(it); }
const rankInSet = new Map(); { const g = new Map(); for (const it of items) { if (!it.set) continue; if (!g.has(it.set)) g.set(it.set, []); g.get(it.set).push(it); } for (const [, a] of g) { a.sort((x, y) => y.price - x.price); a.forEach((x, i) => rankInSet.set(x.id, [i + 1, a.length])); } }
const codeKey = it => (it.code || "").replace(/\s/g, "").toUpperCase();
function findPair(it) { // 素体↔PSA10 の相手
  const b = baseName(it.name), ck = codeKey(it); if (!ck) return null;
  const want = it.cat === "PSA" ? "ポケモン" : "PSA";
  return (byBase.get(b) || []).find(x => x.cat === want && codeKey(x) === ck && (want !== "PSA" || /^PSA\s*10$/i.test(x.grade))) || null;
}
function cardAbout(it) {
  const b = baseName(it.name), full = it.name + (it.code ? "（" + it.code + "）" : "");
  const p = [];
  let s1 = `<b>${esc(full)}</b>は`;
  if (it.set) s1 += `「${esc(it.set)}」収録の`;
  s1 += it.cat === "PSA" ? "PSA10（GEM MINT）鑑定済みカード" : it.cat === "BOX" ? "未開封BOX" : it.cat === "旧裏" ? "旧裏面ポケモンカード" : it.cat === "旧弾" ? "旧弾（ポケモンカードe・ADV・PCG・DPなど）のカード" : it.cat === "汎用" ? "商品" : "ポケモンカード";
  if (it.rarity && it.rarity !== "-") s1 += `で、レアリティは${esc(it.rarity)}`;
  s1 += `です。ナタデココの買取価格は<b>${esc(yen(it.price))}</b>（${esc(updated)}時点・美品の場合）。`;
  const r = rankInSet.get(it.id); if (r && r[1] >= 5) s1 += `${esc(it.set)}の掲載${r[1]}枚の中で${r[0]}番目に高い買取価格です。`;
  p.push(s1);
  { const sps = speciesOf(it); if (sps.length) p.push(sps.map(sp => `${esc(sp.ja)}は全国図鑑No.${sp.id}のポケモンで、英語名は<b>${esc(sp.en)}</b>（海外版カードでの表記）です。`).join("") + `海外からの買取のお問い合わせにも対応しています。`); }
  if (it.cat === "PSA") p.push("PSA純正ケース入りで、ケースに割れ・ヒビ・大きな傷がないものが対象です。ラベル（カード名・認証番号）が読める写真を添えてお申込みください。PSA9以下や他社鑑定品もご相談いただけます。");
  else if (it.cat === "BOX") p.push("価格はシュリンク付き未開封の場合です。" + (it.price2 ? `シュリンクなし（ぺりぺり付き）は${esc(yen(it.price2))}で買取しています。` : "") + "箱のつぶれ・シュリンクの破れは減額の対象になります。");
  else if (it.cat === "旧裏") p.push("旧裏は発売から20年以上たっているため、裏面の白かけ・スレ・反りで価格が大きく変わります。同名カードでもLV（レベル）や版（初版・マークなし等）で価格が異なるので、お手元のカードのLVと右下の番号をご確認ください。");
  else if (it.cat === "旧弾") p.push("1ED（初版）・アンリミ（通常版）・キラ・ミラーなどの区別はカード名に書いています。古いカードは状態による価格差が大きいので、写真でのご相談がおすすめです。");
  else if (it.cat === "ポケモン") p.push("価格表の金額は傷・白かけ・反りのない美品の場合です。状態によって減額となることがありますが、減額後の金額にご納得いただけない場合はキャンセルでき、返送料は当店が負担します。");
  const pair = findPair(it);
  if (pair) p.push(it.cat === "PSA" ? `鑑定なし（素体）の${esc(b)}は<a href="/card/${encodeURIComponent(pair.id)}/">${esc(yen(pair.price))}で買取</a>しています。` : `PSA10鑑定済みの${esc(b)}は<a href="/card/${encodeURIComponent(pair.id)}/">${esc(yen(pair.price))}で買取</a>しています。鑑定品をお持ちの方はそちらをご覧ください。`);
  const vs = (byBase.get(b) || []).filter(x => x.id !== it.id);
  if (vs.length) p.push(`${esc(b)}は別バージョン・別弾のカードも${vs.length}種類掲載しています（下の「同じ名前のカード」をご覧ください）。`);
  p.push("相場に合わせて価格表を毎日更新しています。宅配買取は、申込日の翌日から3日以内にカードが届けば申込時の価格で査定します。送料無料・最短当日入金です。");
  return p.map(x => `<p>${x}</p>`).join("");
}
function cardVariants(it) {
  const b = baseName(it.name);
  const vs = (byBase.get(b) || []).filter(x => x.id !== it.id).sort((x, y) => y.price - x.price).slice(0, 12);
  if (!vs.length) return "";
  return `<h2 class="rel">同じ名前のカード（別バージョン・別弾）</h2><div class="rels">` + vs.map(r => `<a class="rc" href="/card/${encodeURIComponent(r.id)}/">${r.img ? `<img src="${esc(r.img)}" alt="" loading="lazy" onerror="this.remove()">` : ""}${psaBadge(r)}<b>${esc(r.name)}</b><span>${esc([r.code, r.cat === "PSA" ? r.grade : r.cat === "BOX" ? "BOX" : ""].filter(Boolean).join(" "))}</span><em>${esc(yen(r.price))}</em></a>`).join("") + `</div>`;
}
function cardFaq(it) {
  const b = baseName(it.name), full = it.name + (it.code ? "（" + it.code + "）" : "");
  const q = [];
  q.push([`${full}の買取価格はいくらですか？`, `${updated}時点で${yen(it.price)}（美品の場合）です。相場に合わせて毎日更新しており、宅配買取は、申込日の翌日から3日以内にカードが届けば申込時の価格で査定します（3日を過ぎた場合は査定時の価格）。`]);
  q.push([`状態が良くない${b}も買い取ってもらえますか？`, it.cat === "PSA" ? "中のカードは鑑定済みなので、主にケースの状態を確認します。角の割れ・ヒビ・深い傷があると減額となる場合があります。気になる点は写真でお知らせください。" : it.cat === "BOX" ? "シュリンクなし・箱つぶれなどは減額となりますが買取できます。先に写真をお送りいただくと、お見積りの段階で金額をお伝えできます。" : "はい。白かけ・スレ・反りなどがある場合は減額となりますが買取できます。減額後の金額にご納得いただけない場合はキャンセルでき、返送料は当店が負担します。"]);
  const pair = findPair(it);
  if (pair) q.push([it.cat === "PSA" ? `鑑定なし（素体）の${b}の買取価格は？` : `PSA10鑑定済みの${b}の買取価格は？`, `${yen(pair.price)}（${updated}時点）で買取しています。詳しくは${pair.name}${pair.code ? "（" + pair.code + "）" : ""}のページをご覧ください。`]);
  q.push(["送料や手数料はかかりますか？", "かかりません。佐川急便の着払いでお送りください（レターパック・ヤマト運輸も可）。本査定のご承諾後、最短当日にお振込みします。"]);
  const html = `<section class="faqs"><h2>よくある質問</h2>` + q.map(([a, c]) => `<details><summary>${esc(a)}</summary><p>${esc(c)}</p></details>`).join("") + `</section>`;
  const ld = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: q.map(([a, c]) => ({ "@type": "Question", name: a, acceptedAnswer: { "@type": "Answer", text: c } })) };
  return { html, ld };
}


/* ポケモン図鑑（図鑑番号・英語名）：カード名からポケモンを判定して英語名・図鑑Noを載せる（検索対策） */
const DEX = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "pokedex.json"), "utf8")); } catch (e) { return []; } })();
const DEX_BY_LEN = [...DEX].sort((a, b) => b.ja.length - a.ja.length);
const speciesCache = new Map();
function speciesOf(it) {
  if (speciesCache.has(it.id)) return speciesCache.get(it.id);
  let n = it.name || ""; if (it.cat === "旧裏" || it.cat === "旧弾") n = n.replace(/\(.*$/, "");   // 旧裏の「(イントロパック/フシギダネ)」はデッキ名なので除外
  if (it.cat === "BOX" || it.cat === "汎用") { speciesCache.set(it.id, []); return []; }
  const hits = [];
  for (const sp of DEX_BY_LEN) { let i = n.indexOf(sp.ja); while (i >= 0) { if (!hits.some(h => i >= h.i && i + sp.ja.length <= h.i + h.len)) hits.push({ i, len: sp.ja.length, sp }); i = n.indexOf(sp.ja, i + 1); } }
  const out = []; for (const h of hits.sort((a, b) => a.i - b.i)) if (!out.some(x => x.id === h.sp.id)) out.push(h.sp);
  speciesCache.set(it.id, out); return out;
}
const bySpecies = new Map(); for (const it of items) for (const sp of speciesOf(it)) { if (!bySpecies.has(sp.id)) bySpecies.set(sp.id, []); bySpecies.get(sp.id).push(it); }
function speciesRows(it) {
  const sps = speciesOf(it); if (!sps.length) return "";
  return `<dl class="dex">` + sps.map(sp => `<div><dt>図鑑No.${String(sp.id).padStart(4, "0")}</dt><dd>${esc(sp.ja)}<span class="en">${esc(sp.en)}</span></dd><dd><a href="/?q=${encodeURIComponent(sp.ja)}">同じポケモンを探す ›</a></dd></div>`).join("") + `</dl>`;
}
function speciesCards(it) {
  const sps = speciesOf(it); if (!sps.length) return "";
  const vIds = new Set((byBase.get(baseName(it.name)) || []).map(x => x.id)); vIds.add(it.id);
  const seen = new Set(); const a = [];
  for (const sp of sps) for (const x of (bySpecies.get(sp.id) || [])) { if (vIds.has(x.id) || seen.has(x.id)) continue; seen.add(x.id); a.push(x); }
  if (!a.length) return "";
  a.sort((x, y) => y.price - x.price);
  const label = sps.map(sp => sp.ja).join("・");
  return `<h2 class="rel">${esc(label)}のほかのカード <a class="more" href="/?q=${encodeURIComponent(sps[0].ja)}">すべて見る（${a.length + vIds.size - 1}枚）›</a></h2><div class="rels">` + a.slice(0, 12).map(r => `<a class="rc" href="/card/${encodeURIComponent(r.id)}/">${r.img ? `<img src="${esc(r.img)}" alt="" loading="lazy" onerror="this.remove()">` : ""}${psaBadge(r)}<b>${esc(r.name)}</b><span>${esc([r.code, r.cat === "PSA" ? r.grade : ""].filter(Boolean).join(" "))}</span><em>${esc(yen(r.price))}</em></a>`).join("") + `</div>`;
}

/* ---------- 3. カード個別ページ ---------- */
const cardTpl = read(path.join(SRC, "card.html"));
const catLabel = c => c === "ポケモン" ? "シングルカード" : c === "PSA" ? "PSA10鑑定品" : c === "BOX" ? "未開封BOX" : c === "旧弾" ? "旧弾（eカード等）" : c === "汎用" ? "最低保証・サプライ" : c;
const urls = [];
for (const it of items) {
  const rel = `card/${encodeURIComponent(it.id)}/`;
  const url = `${CFG.siteUrl}/${rel}`;
  const title = `${it.name}${it.code ? "（" + it.code + "）" : ""}${it.grade !== "素体" ? " " + it.grade : ""} 買取価格 ${yen(it.price)}`;
  const sps = speciesOf(it); const enNames = sps.map(x => x.en).join(" & ");
  const desc = `${it.name}${it.code ? " " + it.code : ""}${enNames ? "（英語名：" + enNames + "）" : ""}${it.set ? "／" + it.set : ""}${it.rarity !== "-" ? "／" + it.rarity : ""} の買取価格は${yen(it.price)}（${updated}時点）。ナタデココのかんたん宅配買取ならLINEで申込・送料無料・最短当日入金。`;
  const lineText = `【宅配買取 申込】\n・${it.name}${it.code ? "（" + it.code + "）" : ""}${it.grade !== "素体" ? " " + it.grade : ""} ×1 … ${yen(it.price)}\n\n※美品の場合の価格です。\n※申込日の翌日から3日以内に到着した場合、上記の価格で査定します。\n※ご利用ルール（${CFG.siteUrl}/rules/）に同意のうえ申し込みます。\nお名前・枚数・発送予定日をご記入ください：`;
  const lineMsg = lineText.replace(yen(it.price), "{P}");   // 申込直前の最新価格チェック用（card.html のスクリプトが {P} に最新価格を入れる）
  const lineUrl = `https://line.me/R/oaMessage/${encodeURIComponent(CFG.lineId)}/?${encodeURIComponent(lineText)}`;
  const ld = { "@context": "https://schema.org", "@type": "Product", name: it.name, alternateName: enNames || undefined, image: it.img || undefined, description: desc, brand: { "@type": "Brand", name: "ポケモンカードゲーム" }, sku: it.code || undefined,
    offers: { "@type": "Offer", url, priceCurrency: "JPY", price: it.price, availability: "https://schema.org/InStock", seller: { "@type": "Organization", name: CFG.company }, description: "買取価格（美品の場合）" } };
  const vIds = new Set((byBase.get(baseName(it.name)) || []).map(x => x.id));
  let related = items.filter(x => x.cat === it.cat && x.id !== it.id && !vIds.has(x.id) && x.set && x.set === it.set).sort((x, y) => Math.abs(y.price - it.price) < Math.abs(x.price - it.price) ? 1 : -1).slice(0, 8);
  if (!related.length) related = items.filter(x => x.cat === it.cat && x.id !== it.id && !vIds.has(x.id) && x.rarity === it.rarity).slice(0, 8);
  const faq = cardFaq(it);
  const html = cardTpl
    .replace(/__TITLE__/g, esc(title + "｜" + CFG.siteName))
    .replace("__HEAD__", headCommon(title, desc, url, it.img) + `\n<script type="application/ld+json">${JSON.stringify(ld)}</script>\n<script type="application/ld+json">${JSON.stringify(faq.ld)}</script>`)
    .replace("__ABOUT__", cardAbout(it)).replace("__VARIANTS__", cardVariants(it) + speciesCards(it)).replace("__FAQ__", faq.html).replace("__DEX__", speciesRows(it)).replace("__EN__", enNames ? `<p class="en">${esc(enNames)}</p>` : "")
    .replace(/__NAME__/g, esc(it.name)).replace(/__CODE__/g, esc(it.code)).replace(/__SET__/g, esc(it.set)).replace(/__RARITY__/g, esc(it.rarity !== "-" ? it.rarity : ""))
    .replace(/__GRADE__/g, esc(it.grade !== "素体" ? it.grade : "")).replace(/__CAT__/g, esc(it.cat)).replace(/__CATLABEL__/g, esc(catLabel(it.cat)))
    .replace(/__PRICE__/g, esc(yen(it.price))).replace(/__PRICE2__/g, (it.price2 ? `<div class="l" style="margin-top:8px">シュリンクなし（ぺりぺり付き）</div><div class="v" id="px2" style="font-size:26px">${esc(yen(it.price2))}</div>` : "") + (it.note ? `<div style="margin-top:8px;font-size:13px;font-weight:700;color:var(--price)">${esc(it.note)}</div>` : "")).replace(/__UPDATED__/g, esc(updated))
    .replace(/__IMG__/g, it.img ? `<img src="${esc(it.img)}" alt="${esc(it.name)}" loading="eager" data-alt="${esc((it.imgAlt || []).join("|"))}" onerror="imgErr(this)">` : `<div class="ph"><span>${esc(it.name)}</span></div>`)
    .replace(/__PSABADGE__/g, /^PSA\s*10$/i.test(it.grade) ? `<img class="badge img" src="/img/psa10.webp?v=3" alt="PSA10">` : /^PSA/i.test(it.grade) ? `<span class="badge"><span class="p">PSA</span><span class="g">${esc(it.grade.replace(/psa/i, ""))}</span></span>` : "")
    .replace(/__LINE_URL__/g, esc(lineUrl)).replace(/__ID__/g, () => esc(it.id)).replace(/__PRICENUM__/g, String(it.price)).replace(/__LINEID__/g, () => esc(CFG.lineId)).replace(/__LINEMSG__/g, () => esc(lineMsg)).replace(/__LINE_ADD__/g, esc(CFG.lineAddUrl)).replace(/__ADD_URL__/g, `/takuhai/#add=${encodeURIComponent(it.id)}&back=1`)
    .replace(/__RELATED__/g, related.map(r => `<a class="rc" href="/card/${encodeURIComponent(r.id)}/">${r.img ? `<img src="${esc(r.img)}" alt="" loading="lazy" onerror="this.remove()">` : ""}${psaBadge(r)}<b>${esc(r.name)}</b><span>${esc(r.code)}</span><em>${esc(yen(r.price))}</em></a>`).join(""))
    .replace(/__STORES_URL__/g, CFG.storesUrl).replace(/__XURL__/g, esc(CFG.xUrl)).replace("<!--__XFOLLOW__-->", X_FOLLOW_HTML).replace(/__COMPANY__/g, esc(CFG.company))
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
const listCards = arr => arr.map(r => `<a class="rc" href="/card/${encodeURIComponent(r.id)}/">${r.img ? `<img src="${esc(r.img)}" alt="${esc(r.name)}" loading="lazy" onerror="this.outerHTML='<div class=ph>'+this.alt+'</div>'">` : `<div class="ph">${esc(r.name)}</div>`}${/^PSA\s*10$/i.test(r.grade) ? `<img class="g" src="/img/psa10.webp?v=3" alt="PSA10">` : ""}<b>${esc(r.name)}</b><span>${esc(r.code || "")}</span><em>${esc(yen(r.price))}</em></a>`).join("");
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
// 今は作っていない収録弾ページ（旧URL p-xxxx など）を消す：残ると古い文言のまま公開され続けるため（11/20）
{ const keep = new Set(packs.map(p => p.slug)), dir = path.join(DIST, "pack");
  if (fs.existsSync(dir)) for (const d of fs.readdirSync(dir)) if (!keep.has(d) && /^[\w-]+$/.test(d) && fs.statSync(path.join(dir, d)).isDirectory()) fs.rmSync(path.join(dir, d), { recursive: true, force: true }); }
for (const p of packs) {
  const cats = [...new Set(p.items.map(x => x.cat))];
  const top = p.items[0];
  const others = packs.filter(q => q !== p && q.items.some(x => cats.includes(x.cat))).slice(0, 12).map(packLink).join("") + `<a href="/pack/">収録弾の一覧をすべて見る ›</a>`;
  packPage(`pack/${p.slug}/`, {
    title: `${p.set}${p.exp ? "（" + p.exp + "）" : ""}の買取価格一覧 ${p.items.length}件`,
    desc: `${p.set}${p.exp ? "（" + p.exp + "）" : ""}収録カードの買取価格一覧。最高 ${yen(top.price)}（${top.name}）。${updated}更新。ナタデココの宅配買取は送料無料・最短当日入金。`,
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
  textTitle: "収録弾の一覧", text: `<div class="links">${packIndexLinks}</div>`, others: RAW_CATS.map(c => `<a href="/cat/${catSlugOf(c)}/">${esc(catLabel(c))}</a>`).join("")
});
// カテゴリごと
for (const c of RAW_CATS) {
  const a = items.filter(x => x.cat === c).sort((x, y) => y.price - x.price); if (!a.length) continue;
  const top = a[0], t = CAT_TEXT[c] || [catLabel(c) + "の買取について", ""];
  const catPacks = packs.filter(p => p.items.some(x => x.cat === c)).slice(0, 20).map(packLink).join("");
  packPage(`cat/${catSlugOf(c)}/`, {
    title: `${catLabel(c)}の買取価格一覧 ${a.length}件`, desc: `${catLabel(c)}の買取価格一覧。最高 ${yen(top.price)}（${top.name}）。${updated}更新。ナタデココの宅配買取は送料無料・最短当日入金。`,
    image: top.img, crumb: `<span>${esc(catLabel(c))}</span>`, eyebrow: "カテゴリごとの買取価格", h1: `${catLabel(c)} 買取価格一覧`,
    lede: `${esc(catLabel(c))}の買取価格です。<b>${esc(top.name)}</b> ${esc(yen(top.price))} など ${a.length}件を掲載（${esc(updated)}更新）。`,
    stats: `<span class="stat">${a.length}件</span><span class="stat">最高 ${esc(yen(top.price))}</span>`, listUrl: `/?cat=${encodeURIComponent(c)}`, cards: a.slice(0, 60),
    textTitle: t[0], text: t[1] + (catPacks ? `<p><b>収録弾から探す</b></p><div class="links">${catPacks}</div>` : ""),
    others: RAW_CATS.filter(x => x !== c).map(x => `<a href="/cat/${catSlugOf(x)}/">${esc(catLabel(x))}</a>`).join("") + `<a href="/pack/">収録弾から探す ›</a>`
  });
}
console.log(`pack pages: ${packs.length}, cat pages: ${RAW_CATS.length}`);

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

/* ---------- 3d. 誘導LP（/lp/ ・ /lp/box/ ・ /lp/old/）：広告・X・Shopifyからの着地ページ ---------- */
{
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const isSAR = x => /^SAR$/i.test(x.rarity || "");
  const isPsaItem = x => /^PSA/i.test(x.grade || "") || x.cat === "PSA";
  const imgTag = x => `<img src="${esc(x.img)}" alt="" loading="lazy" onerror="this.remove()">`;
  const byPrice = (a, b) => b.price - a.price;
  const uniq = (arr, n, key = x => x.name) => { const out = [], seen = new Set(); for (const x of arr) { const k = key(x); if (seen.has(k)) continue; seen.add(k); out.push(x); if (out.length >= n) break; } return out; };
  const withImg = c => items.filter(x => x.img && x.cat === c);
  const isOldMain = x => /拡張パック第1弾|ポケモンジャングル|化石の秘密|ロケット団|リーダーズスタジアム|闇からの挑戦|金銀新世界へ|遺跡をこえて|めざめる伝説|闇そして光へ/.test(x.set || "");
  const variants = [
    { key: "main", tpl: "lp.html", out: "lp/index.html", path: "/lp/",
      title: "ポケカ宅配買取｜箱に詰めて送るだけ・送料0円・最短当日入金",
      desc: `ポケモンカードを箱に詰めて送るだけ。送料無料・最短当日入金・${items.length.toLocaleString()}枚の買取価格を毎日公開。千葉・東京・神奈川8店舗のポケカ専門店ナタデココの宅配買取。LINEで無料査定。`,
      pool() {
        const top = items.filter(x => x.img && (x.cat === "ポケモン" || x.cat === "PSA")).sort(byPrice);
        let hp = items.filter(x => x.img && (/強化買取/.test(x.tab || "") || ((x.tab === "MEGA" || x.tab === "SV") && isSAR(x) && x.price >= 10000)));   // MEGA/SVのSAR・1万円以上
        if (hp.length < 20) hp = hp.concat(items.filter(x => x.img && (x.tab === "MEGA" || x.tab === "SV") && isSAR(x) && x.price < 10000 && !hp.includes(x)).sort(byPrice).slice(0, 20 - hp.length));
        let hot = shuffle(hp.slice()); if (hot.length < 8) hot = hot.concat(top.filter(x => !hp.includes(x)).slice(0, 8 - hot.length));
        const kyoka = items.filter(x => x.img && /強化買取/.test(x.tab || "")).sort(byPrice);
        const base = kyoka.length ? kyoka : hp.slice().sort(byPrice);
        // 続き（もっと見る）も強化買取の価格帯だけにする：強化買取のいちばん安い価格（最低3,000円）以上のカードを高い順に
        const floor = Math.max(3000, base.length ? Math.min.apply(null, base.map(x => x.price)) : 0);
        console.log("lp(main): 強化買取 " + base.length + "件 / 続きの下限 " + floor + "円");
        const ceil = base.length ? Math.max.apply(null, base.map(x => x.price)) : Infinity;
        const src = base.concat(top.filter(x => x.price >= floor && x.price <= ceil).sort((a, b) => (b.order - a.order) || (b.price - a.price)));   // 続きは新しいシリーズ優先
        const list = uniq(src.filter(x => !isPsaItem(x)), 90, x => baseName(x.name) + "|" + x.cat);   // LPの強化買取は素体のみ
        return { hot, list, k: r => isPsaItem(r) ? "psa" : "single" };
      }, vpics: {} },
    { key: "box", tpl: "lp_box.html", out: "lp/box/index.html", path: "/lp/box/",
      title: "ポケカBOX宅配買取｜未開封BOX・パックを送るだけ・送料0円・最短当日入金",
      desc: "未開封のポケモンカードBOX・パックを箱に詰めて送るだけ。送料無料・最短当日入金。最新弾から絶版BOXまで買取価格を毎日公開。千葉・東京・神奈川8店舗のポケカ専門店ナタデココの宅配買取。",
      pool() {
        const all = withImg("BOX").sort(byPrice);
        // BOX版LPの分類：box＝ふつうのBOX／sp＝スペシャルBOX・記念セットなど／pd＝未開封パック・デッキ
        // 買取表BOXタブの「種類」列（BOX／スペシャルBOX／パック／その他、またはシリーズ名）を優先して分ける
        const kind = r => /^(パック|その他)$/.test(r.set || "") ? "pd" : r.set === "スペシャルBOX" ? "sp" : "box";   // スプレッドシートA列の種類どおりに分ける
        const hot = shuffle(all.filter(r => kind(r) === "box").slice(0, 30));   // ファーストビューにはふつうのBOXだけ出す
        const cnt = { box: 0, sp: 0, pd: 0 }; all.forEach(r => cnt[kind(r)]++);
        console.log("lp(box): BOX " + cnt.box + "件 / スペシャルBOX " + cnt.sp + "件 / パック・デッキ " + cnt.pd + "件");
        return { hot, list: uniq(all, 120), k: kind };
      },
      vpics: {
        new: n => uniq(withImg("BOX").filter(x => /MEGA/.test(x.set) && !/デッキ|FUTURISTIC|デラックス|プレミアム/i.test(x.name)), n),
        sv: n => uniq(withImg("BOX").filter(x => x.set === "SV").sort(byPrice), n),
        zep: n => uniq(withImg("BOX").filter(x => x.set === "SM" || x.set === "SS").sort(byPrice), n),
        spb: n => uniq(["box-hilork", "box-753xbg"].map(k => withImg("BOX").find(x => x.id === k)).filter(Boolean).concat(withImg("BOX").filter(x => !/デッキ|スターター/.test(x.name) && /FUTURISTIC|スペシャル|プレミアム|デラックス|コレクション|セット|トレーナーボックス/i.test(x.name)).sort(byPrice)), n),   // スペシャルBOXの写真はポケモンセンタートウホク・ヒロシマを先に
        pd: n => uniq(withImg("BOX").filter(r => /^(パック|その他)$/.test(r.set || "")).sort(byPrice), n),   // 未開封パック・デッキ（実物の写真）
        sp: n => uniq(withImg("BOX").filter(x => /30th|151|シャイニー|ユニバース|イーブイ|25th|クライマックス|GXウルトラ|タッグオール|ドリームリーグ|テラスタルフェス/i.test(x.name)).sort(byPrice), n),
      } },
    { key: "old", tpl: "lp_old.html", out: "lp/old/index.html", path: "/lp/old/",
      title: "旧裏ポケカ宅配買取｜昔のポケモンカードを送るだけ・送料0円・最短当日入金",
      desc: "旧裏（1996年〜）やe・ADV・PCG・DPなど昔のポケモンカードを、ファイルのまま送るだけ。傷ありもOK。送料無料・最短当日入金。千葉・東京・神奈川8店舗のポケカ専門店ナタデココの宅配買取。",
      pool() {
        const old = withImg("旧裏").sort(byPrice), kyu = withImg("旧弾").sort(byPrice);
        const hot = shuffle(old.slice(0, 36));
        return { hot, list: uniq(old, 60).concat(uniq(kyu, 60)), k: r => r.cat === "旧裏" ? "old" : "kyu" };
      },
      vpics: {
        main: n => { const st = ["フシギバナ", "リザードン", "カメックス"].map(m => items.find(x => x.img && x.cat === "旧裏" && x.name.startsWith(m + " LV") && /マークあり/.test(x.name)) || items.find(x => x.img && x.cat === "旧裏" && x.name.startsWith(m + " LV"))).filter(Boolean); return st.length >= n ? st.slice(0, n) : uniq(withImg("旧裏").filter(isOldMain).sort(byPrice), n); },
        promo: n => uniq(withImg("旧裏").filter(x => /プロモ|通信交換|とりかえっこ|プレミアムファイル|サザン/.test(x.set)).sort(byPrice), n),
        kyu: n => uniq(withImg("旧弾").sort(byPrice), n, x => baseName(x.name)),
        sheet: n => uniq(withImg("旧裏").filter(x => /拡張シート|クイックスターター|イントロパック/.test(x.set)).sort(byPrice), n),
        tr: n => uniq(withImg("旧裏").filter(x => isOldMain(x)).sort(byPrice).slice(20), n, x => baseName(x.name)),
      } },
    { key: "psa", tpl: "lp_psa.html", out: "lp/psa/index.html", path: "/lp/psa/",
      title: "PSA鑑定品の宅配買取｜PSA10をケースのまま送るだけ・送料0円・最短当日入金",
      desc: "PSA10などの鑑定済みポケモンカードを、ケースのまま梱包して送るだけ。PSA9以下・BGS・ARSも相談OK。送料無料・最短当日入金。PSA10の買取価格を毎日公開。千葉・東京・神奈川8店舗のポケカ専門店ナタデココの宅配買取。",
      pool() {
        const all = items.filter(x => x.img && isPsaItem(x)).sort(byPrice);
        const ser = r => /^M\d/i.test(r.exp || "") ? "mega" : /^SV/i.test(r.exp || "") ? "sv" : "old";
        console.log("lp(psa): PSA " + all.length + "件");
        const key = x => x.name + "|" + (x.code || ""); const list = ["mega", "sv", "old"].map(g => uniq(all.filter(r => ser(r) === g), 40, key)).reduce((p, c) => p.concat(c), []).sort(byPrice);
        return { hot: shuffle(all.slice(0, 30)), list, k: ser };
      },
      vpics: {
        new: n => uniq(items.filter(x => x.img && isPsaItem(x) && /^M\d/i.test(x.exp || "")).sort(byPrice), n, x => baseName(x.name)),
        sv: n => uniq(items.filter(x => x.img && isPsaItem(x) && /^SV/i.test(x.exp || "")).sort(byPrice), n, x => baseName(x.name)),
        old: n => uniq(items.filter(x => x.img && isPsaItem(x) && !/^(M\d|SV)/i.test(x.exp || "")).sort(byPrice), n, x => baseName(x.name)),
        top: n => uniq(items.filter(x => x.img && isPsaItem(x)).sort(byPrice).slice(8), n, x => baseName(x.name)),
      } },
    { key: "matome", tpl: "lp_matome.html", out: "lp/matome/index.html", path: "/lp/matome/",
      title: "ポケカ大量・まとめ売りの宅配買取｜仕分け不要・段ボールで送るだけ・送料0円",
      desc: "大量のポケモンカードを、仕分けもリスト作りもせずに段ボールで送るだけ。カードを選ばない「おまかせ査定」で1枚ずつ査定。送料無料・最短当日入金。千葉・東京・神奈川8店舗のポケカ専門店ナタデココの宅配買取。",
      pool() { return variants[0].pool(); }, vpics: {} },
  ];
  const LP_PREVIEW = ["psa"];   // 11/18 雄司さんが手を入れるため、URLだけ出す（検索に出さない・サイトマップに入れない・どこからもリンクしない）
  for (const V of variants.filter(v => !["matome"].includes(v.key))) {   // まとめ売りLPは雄司さんのOKが出るまで公開しない（11/16）
    const lpTpl = read(path.join(SRC, V.tpl));
    if (!lpTpl) continue;
    const url = `${CFG.siteUrl}${V.path}`, title = V.title, desc = V.desc;
    const { hot, list: pick, k: kOf } = V.pool();
    if (!hot.length) { console.log(`lp(${V.key}): 画像付き商品がないためスキップ`); continue; }
    const hotAt = i => hot[i % hot.length];
    const hotJson = JSON.stringify(hot.map(r => ({ id: r.id, n: r.name, p: yen(r.price), img: r.img })));
    const cards = pick.map((r, i) => `<a class="pc${i >= 30 ? " xm" : ""}" data-k="${kOf(r)}" href="/card/${encodeURIComponent(r.id)}/"><span class="im"><img src="${esc(r.img)}" alt="${esc(r.name)}" loading="lazy" onerror="this.remove()">${/^PSA\s*10$/i.test(r.grade) ? `<img class="g" src="/img/psa10.webp?v=3" alt="PSA10">` : ""}</span><em>${esc(yen(r.price))}</em><b>${esc(r.name)}</b><span class="cd">${esc(r.code)}</span></a>`).join("");
    const shops = [["柏", "kashiwa"], ["松戸", "matsudo"], ["津田沼", "tsudanuma"], ["千葉中央", "chibachuo"], ["中野", "nakano"], ["お台場", "odaiba"], ["町田", "machida"], ["横浜", "yokohama"]].map(([n, id]) => `<a href="/stores/${id}/">${n}</a>`).join("");
    const ld = { "@context": "https://schema.org", "@type": "Service", name: title.split("｜")[0], provider: { "@type": "Organization", name: CFG.company, url: CFG.siteUrl }, areaServed: "JP", description: desc, url };
    const html = lpTpl
      .replace(/__TITLE__/g, esc(title + "｜" + CFG.siteName))
      .replace("__HEAD__", headCommon(title, desc, url, CFG.siteUrl + "/ogp.png") + `\n<script type="application/ld+json">${JSON.stringify(ld)}</script>`)
      .replace(/__TICKER__/g, Array.from({ length: 24 }, (_, i) => hotAt(i)).map(r => `<a class="tk" href="/card/${encodeURIComponent(r.id)}/"><img src="${esc(r.img)}" alt="" loading="lazy" onerror="this.remove()"><span><b>${esc(r.name)}</b><em>${esc(yen(r.price))}</em></span></a>`).join(""))
      .replace(/__HOTPOOL__/g, () => hotJson)
      .replace(/__PACKPOOL__/g, () => { const pk = items.filter(x => x.img && x.cat === "ポケモン");
        const hit = shuffle(pk.filter(x => /^(SAR|SR|AR|UR|HR|MUR|BWR)$/i.test(x.rarity || "") && x.price >= 3000).sort(byPrice).slice(0, 80)).slice(0, 40);
        const com = shuffle(pk.filter(x => x.price > 0 && x.price < 1500).slice()).slice(0, 40);
        const m = r => ({ n: r.name, p: yen(r.price), img: r.img });
        return JSON.stringify({ hit: hit.map(m), com: com.map(m) }); })
      .replace(/__FC([1-9]|1[0-5])__/g, (m, i) => esc(hotAt(Number(i) - 1).img))
      .replace(/__HOTIMG(\d+)__/g, (m, i) => esc(hotAt(Number(i)).img))
      .replace(/__VP_([a-z]+)_(\d)(_slab)?__/g, (m, key, n, slab) => { const f = V.vpics[key]; if (!f) return ""; const a = f(Number(n));
        if (slab) return a.map(x => `<span class="slab"><i>PSA 10</i><img src="${esc(x.img)}" alt="" loading="lazy" onerror="this.parentNode.remove()"></span>`).join("");
        return a.map(imgTag).join(""); })
      .replace(/__PICS_([a-z]+)_(\d)__/g, (m, cat, n) => { const map = { pk: "ポケモン", box: "BOX", psa: "PSA", old: "旧裏", kyu: "旧弾", misc: "汎用" };
        let a = items.filter(x => x.img && x.cat === map[cat]).sort(byPrice);
        if (cat === "box") { const nw = items.filter(x => x.img && x.cat === "BOX" && /MEGA/i.test(x.set || "") && !/デッキ|FUTURISTIC/i.test(x.name)); if (nw.length) a = nw; }   // BOXは最新シリーズ（シート順）
        if (cat === "pk") { const nw = a.filter(x => x.tab === "MEGA" && /^SAR$/i.test(x.rarity)); a = nw.length ? nw : a.filter(x => /^(SAR|SR|AR|UR|PROMO|P|HR)$/i.test(x.rarity)); }   // シングルは最新シリーズ（MEGA）
        if (cat === "psa") { const nw = a.filter(x => /^M\d/i.test(x.exp || "") && /^SAR$/i.test(x.rarity || "")); if (nw.length) a = nw; }   // 鑑定品も最新シリーズ
        if (cat === "old") { const st = V.key === "main" ? ["フシギバナ", "リザードン", "カメックス"].map(n => items.find(x => x.img && x.cat === "旧裏" && x.name.startsWith(n + " LV") && /マークあり/.test(x.name)) || items.find(x => x.img && x.cat === "旧裏" && x.name.startsWith(n + " LV"))).filter(Boolean) : []; if (st.length === 3) return st.map(imgTag).join(""); }   // 旧裏は御三家
        if (!a.length) a = items.filter(x => x.img && x.cat === map[cat]);
        const pk = uniq(a, Number(n), x => baseName(x.name));
        if (cat === "psa") return pk.map(x => `<span class="slab"><i>PSA 10</i><img src="${esc(x.img)}" alt="" loading="lazy" onerror="this.parentNode.remove()"></span>`).join("");   // 鑑定ケース風
        return pk.map(imgTag).join(""); })
      .replace(/__RANK3__/g, () => pick.filter(r => V.key !== "old" || r.cat === "旧裏").sort(byPrice).slice(0, 3).map((r, i) => `<a href="/card/${encodeURIComponent(r.id)}/"><span class="cr">No.${i + 1}</span><span class="im"><img src="${esc(r.img)}" alt="${esc(r.name)}" loading="lazy" onerror="this.remove()"></span><b>${esc(r.name)}</b><em>${esc(yen(r.price))}</em></a>`).join(""))
      .replace(/__TOP__/g, cards).replace(/__TOPN__/g, String(pick.length)).replace(/__SHOPS__/g, shops).replace(/__COUNT__/g, items.length.toLocaleString()).replace(/__UPDATED__/g, esc(updated))
      .replace(/__CATCOUNT_([a-z]+)__/g, (m, c) => ({ box: withImg("BOX").length, old: items.filter(x => x.cat === "旧裏").length, kyu: items.filter(x => x.cat === "旧弾").length }[c] || 0).toLocaleString())
      .replace(/__LICENSE__/g, esc(CFG.antiqueLicense)).replace(/__LINE_ADD__/g, esc(CFG.lineAddUrl)).replace(/__STORES_URL__/g, CFG.storesUrl).replace(/__COMPANY__/g, esc(CFG.company));
    const pv = LP_PREVIEW.includes(V.key);
    write(V.out, pv ? wrap(html).replace("</head>", '<meta name="robots" content="noindex,nofollow">\n</head>') : wrap(html));
    if (!pv) urls.push({ url, lastmod: updated.replace(/\//g, "-") });
    console.log(`lp(${V.key}): ok ${pick.length}件`);
  }
}

/* ---------- 4. 固定ページ ---------- */
// スタッフ専用の申告ページ（/staff/。検索に出さない・サイトマップにも入れない）
{ let h = read(path.join(SRC, "staff.html"));
  if (h) write("staff/index.html", wrap(h.replace("__STAFF_URL__", CFG.staffReportUrl || "").replace("__HEAD__", headCommon("スタッフ専用｜価格・画像の申告", "", `${CFG.siteUrl}/staff/`, "")))); }
// スタッフ専用：買取表の画像をつくるページ（/staff/slide/。検索に出さない・サイトマップにも入れない）
{ let h = read(path.join(SRC, "staff_slide.html"));
  if (h) write("staff/slide/index.html", wrap(h.replace("__STAFF_URL__", CFG.staffReportUrl || "").replace("__HEAD__", headCommon("スタッフ専用｜買取表の画像をつくる", "", `${CFG.siteUrl}/staff/slide/`, "")))); }
// 店舗ページ（/stores/ と 店舗ごとの /stores/<id>/）。JSを読まないAI・検索エンジンにも店舗情報が届くよう、中身をHTMLで書き出し、店舗データ（Store）も入れる（11/19）
{ const src = read(path.join(SRC, "stores.html"));
  const m = src && src.match(/var STORES=(\[[\s\S]*?\]);\n/);
  if (m) {
    const H = (o, c) => [o * 60, c * 60], every = (o, c) => Array.from({ length: 7 }, () => H(o, c));
    const STORES = new Function("H", "every", "return " + m[1])(H, every);
    const DAYS = ["日", "月", "火", "水", "木", "金", "土"], fmt = x => Math.floor(x / 60) + ":" + String(x % 60).padStart(2, "0"), rng = h => fmt(h[0]) + "〜" + fmt(h[1]);
    const week = hours => { const g = []; [1, 2, 3, 4, 5, 6, 0].forEach(d => { const k = rng(hours[d]), l = g[g.length - 1]; if (l && l.key === k) l.days.push(d); else g.push({ key: k, days: [d] }); }); if (g.length === 1) return ["毎日 " + g[0].key]; return g.map(x => { const n = x.days.length, a = DAYS[x.days[0]], b = DAYS[x.days[n - 1]]; return (n === 1 ? a : n === 2 ? a + "・" + b : a + "〜" + b) + " " + x.key; }); };
    const card = s => `<article class="store" id="s-${s.id}" data-pref="${s.pref}"><div class="photo"><img src="/img/stores/${s.id}.jpg" alt="${esc(s.name)}の外観" loading="lazy"><span class="floor">${esc(s.bldg)}</span></div><div class="body"><div class="head"><div><p class="where">${esc(s.city)}</p><h2>${esc(s.name)}</h2></div><span class="pill" data-pill></span></div><dl class="facts"><dt>住所</dt><dd>〒${s.zip}<br>${esc(s.addr)}</dd><dt>アクセス</dt><dd>${esc(s.access)}</dd><dt>電話</dt><dd><a href="tel:${s.tel.replace(/-/g, "")}">${s.tel}</a></dd><dt>営業時間</dt><dd>${(s.label || week(s.hours)).map(esc).join("<br>")}</dd>${s.kai ? `<dt>買取受付</dt><dd>${esc(s.kai)}</dd>` : ""}</dl><div class="links"><a href="/stores/${s.id}/">${esc(s.name)}の詳しい案内 ›</a><a href="https://maps.google.com/?cid=${s.cid}" target="_blank" rel="noopener">Googleマップで開く ↗</a><a href="https://x.com/${s.x}" target="_blank" rel="noopener">X @${s.x} ↗</a></div></div></article>`;
    const DN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const ld = s => ({ "@type": "Store", "@id": `${CFG.siteUrl}/stores/${s.id}/#store`, name: `ポケモンカード専門店ナタデココ ${s.name}`, url: `${CFG.siteUrl}/stores/${s.id}/`,
      description: `${s.city}のポケモンカード（ポケカ）専門店。シングルカード・BOX・PSA鑑定品の店頭買取と販売。買取価格は${CFG.siteUrl}/ で毎日更新。`,
      image: `${CFG.siteUrl}/img/stores/${s.id}.jpg`, telephone: s.tel, hasMap: `https://maps.google.com/?cid=${s.cid}`, sameAs: [`https://x.com/${s.x}`],
      address: { "@type": "PostalAddress", postalCode: s.zip, addressRegion: s.city.match(/^(.+?[都道府県])/)[1], addressLocality: s.addr.replace(/^.+?[都道府県]/, "").match(/^(.+?[市区町村])/)[1], streetAddress: s.addr.replace(/^.+?[都道府県].+?[市区町村]/, ""), addressCountry: "JP" },
      openingHoursSpecification: [0, 1, 2, 3, 4, 5, 6].map(d => ({ "@type": "OpeningHoursSpecification", dayOfWeek: DN[d], opens: fmt(s.hours[d]).padStart(5, "0"), closes: fmt(s.hours[d][1] === undefined ? 0 : s.hours[d][1]).padStart(5, "0") })).map((o, d) => ({ ...o, opens: fmt(s.hours[d][0]).padStart(5, "0"), closes: fmt(s.hours[d][1]).padStart(5, "0") })),
      priceRange: "¥", currenciesAccepted: "JPY", parentOrganization: { "@type": "Organization", name: CFG.company, url: CFG.siteUrl + "/" },
      makesOffer: { "@type": "Offer", name: "ポケモンカードの店頭買取", description: "シングルカード・BOX・PSA鑑定品を買取。宅配買取（送料無料・全国対応）も受付。" } });
    const fill = h => h.replace(/__COMPANY__/g, esc(CFG.company)).replace(/__LICENSE__/g, esc(CFG.antiqueLicense)).replace(/__LINE_ADD__/g, esc(CFG.lineAddUrl)).replace(/__XURL__/g, esc(CFG.xUrl)).replace(/__STORES_URL__/g, CFG.storesUrl);
    const oldLd = /<script type="application\/ld\+json">[\s\S]*?<\/script>/;
    // 一覧ページ
    let all = src.replace('<section class="stores" id="stores"></section>', `<section class="stores" id="stores">${STORES.map(card).join("")}</section>`)
      .replace(oldLd, `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "ItemList", name: "ポケモンカード専門店ナタデココ 店舗一覧（店頭買取）", itemListElement: STORES.map((s, i) => ({ "@type": "ListItem", position: i + 1, item: ld(s) })) })}</script>`)
      .replace("__HEAD__", headCommon(src.match(/<title>(.*?)<\/title>/)[1], "ポケモンカード（ポケカ）の店頭買取は千葉・東京・神奈川のナタデココ全8店舗（柏・松戸・津田沼・千葉中央・中野・お台場・町田・横浜）で。住所・営業時間・アクセス・買取受付時間の一覧。遠方の方は送料無料の宅配買取も。", `${CFG.siteUrl}/stores/`, ""));
    write("stores/index.html", wrap(fill(all)));
    urls.push({ url: `${CFG.siteUrl}/stores/`, lastmod: updated.replace(/\//g, "-") });
    // 店舗ごとのページ
    for (const s of STORES) {
      const area = s.name.replace(/本?店$/, "");
      const title = `${area}でポケカ買取なら｜ポケモンカード専門店ナタデココ ${s.name}`;
      const desc = `${s.access}。${s.city}のポケモンカード（ポケカ）専門店ナタデココ ${s.name}。シングル・BOX・PSA鑑定品を店頭買取。営業時間 ${(s.label || week(s.hours)).join("／")}${s.kai ? "、買取受付 " + s.kai : ""}。買取価格は毎日更新。`;
      let h = src.replace(/<title>.*?<\/title>/, `<title>${esc(title)}</title>`)
        .replace(/<p class="eyebrow">[\s\S]*?<div class="chips" id="chips"><\/div>/, `<p class="eyebrow">${esc(area)}でポケモンカード/ポケカを売るなら</p>\n  <h1>${esc(s.name)}（店頭買取）</h1>\n  <p class="lede">${esc(s.city)}のポケモンカード専門店 ナタデココ ${esc(s.name)}です。シングルカード・BOX・PSA鑑定品を<b>店頭で買取</b>しています。買取価格は<a href="/">買取価格表</a>で毎日更新中。お店に行けない方は<a href="/takuhai/">宅配買取</a>（送料無料・全国対応）もご利用ください。</p>\n  <a class="back" href="/">買取価格表はこちら ›</a> <a class="back" href="/stores/">全8店舗の一覧 ›</a>\n  <div class="chips" id="chips" style="display:none"></div>`)
        .replace('<section class="stores" id="stores"></section>', `<section class="stores" id="stores">${card(s)}</section>`)
        .replace("var list=document.getElementById('stores');", `STORES=STORES.filter(function(s){return s.id===${JSON.stringify(s.id)}});var list=document.getElementById('stores');`)
        .replace(oldLd, `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", ...ld(s) })}</script>`)
        .replace("__HEAD__", headCommon(title, desc, `${CFG.siteUrl}/stores/${s.id}/`, `${CFG.siteUrl}/img/stores/${s.id}.jpg`));
      write(`stores/${s.id}/index.html`, wrap(fill(h)));
      urls.push({ url: `${CFG.siteUrl}/stores/${s.id}/`, lastmod: updated.replace(/\//g, "-") });
    }
    console.log(`stores: 一覧＋${STORES.length}店舗ページ`);
  }
}
for (const name of ["legal", "privacy", "company"]) {   // 採用ページ（recruit）は準備中のため非公開
  let html = read(path.join(SRC, name + ".html"));
  if (!html) continue;
  html = html.replace(/__COMPANY__/g, esc(CFG.company)).replace(/__COUNT__/g, items.length.toLocaleString()).replace(/__LICENSE__/g, esc(CFG.antiqueLicense)).replace(/__LINE_ADD__/g, esc(CFG.lineAddUrl)).replace(/__XURL__/g, esc(CFG.xUrl)).replace(/__STORES_URL__/g, CFG.storesUrl)
    .replace("__HEAD__", headCommon(html.match(/<title>(.*?)<\/title>/)[1], "", `${CFG.siteUrl}/${name}/`, ""));
  write(`${name}/index.html`, wrap(html));
  urls.push({ url: `${CFG.siteUrl}/${name}/`, lastmod: updated.replace(/\//g, "-") });
}

/* ---------- 5. sitemap / robots / 404 / CNAME / assets ---------- */
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>${CFG.siteUrl}/</loc><lastmod>${updated.replace(/\//g, "-")}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>\n${urls.map(u => `<url><loc>${esc(u.url)}</loc><lastmod>${u.lastmod}</lastmod><changefreq>daily</changefreq></url>`).join("\n")}\n</urlset>\n`);
write("llms.txt", `# ナタデココ ポケモンカード買取
> 千葉・東京・神奈川に8店舗のポケモンカード（ポケカ）専門店「ナタデココ」（${CFG.company}）の公式買取サイト。シングルカード・BOX・PSA鑑定品の買取価格を毎日更新しています。

## 買取の方法
- 店頭買取：柏本店・松戸店・津田沼店・千葉中央店・中野店・お台場店・町田店・横浜店の全8店舗。住所・営業時間・買取受付時間は ${CFG.siteUrl}/stores/
- 宅配買取：全国対応。送料・査定料・キャンセル料・返送料・振込手数料はすべて0円、最短当日入金、店頭と同じ価格。申込は ${CFG.siteUrl}/takuhai/
- 宅配買取の流れ・ルール：${CFG.siteUrl}/rules/

## 主なページ
- 買取価格表（毎日更新）：${CFG.siteUrl}/
- BOX買取：${CFG.siteUrl}/lp/box/
- PSA鑑定品の買取：${CFG.siteUrl}/lp/psa/
- 店舗一覧：${CFG.siteUrl}/stores/
${[["柏本店", "kashiwa"], ["松戸店", "matsudo"], ["津田沼店", "tsudanuma"], ["千葉中央店", "chibachuo"], ["中野店", "nakano"], ["お台場店", "odaiba"], ["町田店", "machida"], ["横浜店", "yokohama"]].map(([n, id]) => `- ${n}：${CFG.siteUrl}/stores/${id}/`).join("\n")}
- 会社概要：${CFG.siteUrl}/company/
- 古物営業法に関する表示：${CFG.siteUrl}/legal/
`);
write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${CFG.siteUrl}/sitemap.xml\n`);
write("google6b85628da0df3843.html", "google-site-verification: google6b85628da0df3843.html");   // Search Consoleの所有権確認（消さない）
write("404.html", `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="4;url=/"><title>ページが見つかりません｜ナタデココ</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;font-family:"M PLUS Rounded 1c","Zen Kaku Gothic New",sans-serif;background:linear-gradient(135deg,#FFF6C9,#B8F4F4 50%,#DCCBFF);color:#173B5C}img{height:200px}h1{margin:12px 0 4px;font-size:22px}a{display:inline-block;margin-top:14px;background:#fff;border:2px solid #A9F3F4;border-radius:999px;padding:10px 22px;text-decoration:none;color:#173B5C;font-weight:700;box-shadow:0 3px 0 #A9F3F4}</style></head><body><div><img src="/img/chars/amery2.webp" alt=""><h1>ページが見つかりません</h1><p>数秒後に買取価格表へ移動します。</p><a href="/">買取価格表へ</a></div></body></html>`);
write(".nojekyll", "");
if (!/github\.io$/.test(new URL(CFG.siteUrl).host)) write("CNAME", new URL(CFG.siteUrl).host);
write("data/items.json", dataJson);
write("data/prices.json", JSON.stringify({ updated, p: Object.fromEntries(slim.map(i => [i.id, i.price]).concat(slim.filter(i => i.price2).map(i => [i.id + "~ns", i.price2]))), p2: Object.fromEntries(slim.filter(i => i.price2).map(i => [i.id, i.price2])), ps: Object.fromEntries(slim.filter(i => i.sp).map(i => [i.id, i.sp])) }));   // 申込直前の最新価格チェック用（page.html の pxCheck が読む）
for (const f of fs.readdirSync(ROOT)) { if (/\.(png|jpg|jpeg|svg|ico|webp)$/i.test(f)) fs.copyFileSync(path.join(ROOT, f), path.join(DIST, f)); }
if (fs.existsSync(path.join(ROOT, "img"))) fs.cpSync(path.join(ROOT, "img"), path.join(DIST, "img"), { recursive: true, filter: f => !path.basename(f).startsWith("_") });   // _missing.txt 等は公開しない
console.log(`built ${urls.length + 1} pages -> dist/`);

// 2026-11-17 急変ガード（役員グループ）用: PSA10画像に「PSA10」の帯を入れたJPEGを dist/img/psa_guard に作る（サイト表示には使わない・失敗しても止めない）
try { require("child_process").execFileSync(process.execPath, [path.join(ROOT, "psa_guard_images.js")], { stdio: "inherit" }); } catch (e) { console.log("psa_guard skipped: " + e.message); }
