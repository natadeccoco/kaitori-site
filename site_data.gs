/**
 * site_data.gs — 買取サイト（kaitori.pokemon-card.shop）用データ配信
 *
 * 【組み込み方】既存の doGet(e) の先頭に次の1行を追加するだけ:
 *   if (e && e.parameter && e.parameter.action === 'sitedata') return siteData_();
 * 追加後、Webアプリを「新しいバージョン」でデプロイ（アクセス: 全員）。
 *
 * 取得URL: {WebアプリURL}?action=sitedata  → JSON
 *   { updated:"2026/10/27", tabs:[ {tab:"MEGA", cat:"ポケモン", rows:[{pack,name,exp,rarity,no,price,price2,img,note}, …]}, … ] }
 *
 * ・出す列は下の見出し名だけ（ラッシュ価格・coord・○・固定価格などの内部列は出さない）
 * ・非表示のタブ・非表示の行は出さない。価格が数字でない行（時価・ASK・ー）は出さない
 * ・SITE_TABS に無いタブは出さない（新しいタブを載せたいときはここに追加）
 */
var SITE_TABS = [
  // {tab: タブ名, cat: サイトのカテゴリー, headerless: 見出し行が無いタブ（A列=名前, B列=価格）}
  { tab: '強化買取',             cat: 'ポケモン' },
  { tab: '強化買取中',           cat: 'ポケモン' },
  { tab: '新弾　アビスアイ',     cat: 'ポケモン' },
  { tab: 'MEGA',                 cat: 'ポケモン' },
  { tab: 'SV',                   cat: 'ポケモン' },
  { tab: 'SS',                   cat: 'ポケモン' },
  { tab: 'SM',                   cat: 'ポケモン' },
  { tab: 'XY',                   cat: 'ポケモン' },
  { tab: 'BW以前',               cat: 'ポケモン' },
  { tab: 'PROMO',                cat: 'ポケモン' },
  { tab: 'PSA（閲覧専用）',      cat: 'PSA' },
  { tab: 'BOX',                  cat: 'BOX' },
  { tab: '旧裏(テスト中)',       cat: '旧裏' },
  { tab: '旧裏',                 cat: '旧裏' },
  { tab: 'eカード(テスト中)',    cat: '旧弾' },
  { tab: 'その他旧弾(テスト中)', cat: '旧弾' },
  { tab: '最低保証',             cat: '汎用' },
  { tab: '汎用買取表(サポート)', cat: '汎用', headerless: true },
  { tab: '汎用買取表(モンスター)', cat: '汎用', headerless: true }
];
var SITE_HEADERS = {
  name:   ['カード名', 'ボックス名', '商品名', '強化買取'],
  exp:    ['パック型番', 'パック'],
  rarity: ['レアリティ'],
  no:     ['型番'],
  price:  ['ナタデココ買取価格', '買取価格（シュリンク有）', '買取価格'],
  price2: ['買取価格（シュリンク無）'],
  img:    ['画像URL'],
  note:   ['備考']
};

function siteData_() {
  var out;
  try { out = siteBuildData_(); }
  catch (err) { out = { error: String(err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function siteBuildData_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tabs = [];
  SITE_TABS.forEach(function (def) {
    var sheet = ss.getSheetByName(def.tab);
    if (!sheet || sheet.isSheetHidden()) return;
    var vals = sheet.getDataRange().getDisplayValues();
    if (!vals.length) return;
    var rows = def.headerless ? siteReadHeaderless_(sheet, vals) : siteReadTable_(sheet, vals);
    if (rows.length) tabs.push({ tab: def.tab, cat: def.cat, rows: rows });
  });
  var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd');
  return { updated: now, tabs: tabs };
}

function siteFindCol_(head, names) {
  for (var i = 0; i < names.length; i++) { var k = head.indexOf(names[i]); if (k >= 0) return k; }
  return -1;
}
function sitePrice_(s) {
  var n = Number(String(s || '').replace(/[^\d]/g, ''));
  return (n > 0 && /\d/.test(String(s))) ? n : 0;
}

/** 見出し行のあるタブ（カード・BOX・PSA・旧裏など） */
function siteReadTable_(sheet, vals) {
  var hi = -1;
  for (var i = 0; i < Math.min(vals.length, 10); i++) {
    var h = vals[i].map(function (x) { return String(x).trim(); });
    if (siteFindCol_(h, SITE_HEADERS.price) >= 0) { hi = i; break; }
  }
  if (hi < 0) return [];
  var head = vals[hi].map(function (x) { return String(x).trim(); });
  var c = {};
  Object.keys(SITE_HEADERS).forEach(function (k) { c[k] = siteFindCol_(head, SITE_HEADERS[k]); });
  if (c.name < 0) c.name = 0;                 // 見出しが無ければA列が名前（強化買取タブなど）
  var packCol = (c.name !== 0) ? 0 : -1;      // 名前がB列以降ならA列はパック名/シリーズ
  var out = [];
  for (var r = hi + 1; r < vals.length; r++) {
    if (sheet.isRowHiddenByUser(r + 1)) continue;
    var row = vals[r];
    var name = String(row[c.name] || '').trim();
    var price = sitePrice_(row[c.price]);
    if (!name || !price) continue;
    var g = function (k) { return c[k] >= 0 ? String(row[c[k]] || '').trim().replace(/^[-ー－]$/, '') : ''; };
    out.push({ pack: packCol >= 0 ? String(row[packCol] || '').trim() : '', name: name, exp: g('exp'), rarity: g('rarity'), no: g('no'),
               price: price, price2: sitePrice_(c.price2 >= 0 ? row[c.price2] : ''), img: g('img'), note: g('note') });
  }
  return out;
}

/** 見出しの無い2列タブ（A=名前, B=価格） */
function siteReadHeaderless_(sheet, vals) {
  var out = [];
  for (var r = 0; r < vals.length; r++) {
    if (sheet.isRowHiddenByUser(r + 1)) continue;
    var name = String(vals[r][0] || '').trim(), price = sitePrice_(vals[r][1]);
    if (!name || !price) continue;
    out.push({ pack: '', name: name, exp: '', rarity: '', no: '', price: price, price2: 0, img: '', note: String(vals[r][2] || '').trim() });
  }
  return out;
}

/** 動作確認用：エディタから実行してログにタブごとの件数を出す */
function siteDataTest() {
  var d = siteBuildData_();
  d.tabs.forEach(function (t) { Logger.log(t.tab + ' (' + t.cat + '): ' + t.rows.length + ' 件'); });
  Logger.log('合計 ' + d.tabs.reduce(function (a, t) { return a + t.rows.length; }, 0) + ' 件 / ' + JSON.stringify(d).length + ' 文字');
}
