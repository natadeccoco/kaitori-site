/**
 * site_data.gs — 買取サイト（kaitori.pokemon-card.shop）用の価格CSV配信
 *
 * 【組み込み方】既存の doGet(e) の先頭に次の1行を追加するだけ:
 *   if (e && e.parameter && e.parameter.action === 'sitecsv') return siteCsv_(e.parameter.file);
 * 追加後、Webアプリを「新しいバージョン」でデプロイ（アクセス: 全員）。
 *
 * 取得URL: {WebアプリURL}?action=sitecsv&file=data | psa | box | kyuura
 *   data   … 当日の Myca用販売買取価格CSV（シングル＋BOX。画像URL付き）
 *   psa    … 「PSA（閲覧専用）」タブ（お客様に見せている列だけ）
 *   box    … 「BOX」タブ（DF／ボックス名／買取価格／画像URL だけ）
 *   kyuura … 「旧裏(テスト中)」または「旧裏」タブ
 * ※ 内部情報の列（ラッシュ価格・固定価格・スライド位置・マイカ用coord 等）は絶対に出さない。
 *   出す列は下の SITE_COLS の見出し名だけ。非表示の行は出さない。
 */
var SITE_COLS = {
  psa:    ['パック名', 'カード名', 'パック型番', 'レアリティ', '型番', '買取価格', '画像URL'],
  box:    ['DF', 'ボックス名', '買取価格', '画像URL'],
  kyuura: ['パック名', 'カード名', 'パック型番', 'レアリティ', '型番', '買取価格', '画像URL']
};
var SITE_TABS = {
  psa:    ['PSA（閲覧専用）', 'PSA'],
  box:    ['BOX'],
  kyuura: ['旧裏(テスト中)', '旧裏']
};

function siteCsv_(file) {
  var csv;
  try {
    if (file === 'data') csv = siteMycaCsv_();
    else if (SITE_TABS[file]) csv = siteTabCsv_(file);
    else return ContentService.createTextOutput('unknown file').setMimeType(ContentService.MimeType.TEXT);
  } catch (err) {
    return ContentService.createTextOutput('error: ' + err).setMimeType(ContentService.MimeType.TEXT);
  }
  return ContentService.createTextOutput(csv).setMimeType(ContentService.MimeType.CSV);
}

/** 当日分フォルダの最新「Myca用販売買取価格CSV_*.csv」をそのまま返す（image_url 列が無ければマスタから補う） */
function siteMycaCsv_() {
  var folder = mycaOutFolder_();   // myca_csv.gs にある既存関数（当日分フォルダ）
  var files = folder.getFiles(), latest = null;
  while (files.hasNext()) {
    var f = files.next();
    if (/^Myca用販売買取価格CSV_\d{8}\.csv$/.test(f.getName()) && (!latest || f.getLastUpdated() > latest.getLastUpdated())) latest = f;
  }
  if (!latest) throw new Error('当日分のMyca用CSVが見つかりません');
  var text = latest.getBlob().getDataAsString('UTF-8').replace(/^﻿/, '');
  if (text.indexOf('image_url') >= 0) return text;
  // image_url 列が無い形式なら、マスタ（Myca連携/01_マスタ の最新エクスポート）の画像URLを id で補う
  return siteMergeImages_(text);
}

function siteMergeImages_(text) {
  var rows = Utilities.parseCsv(text);
  var hi = -1; for (var i = 0; i < rows.length; i++) if (rows[i].indexOf('buy_price') >= 0) { hi = i; break; }
  if (hi < 0) return text;
  var master = siteMasterRows_(); // {id: {image_url, expansion, cardnumber, rarity, pack_name, keyword, display_name, genre, category}}
  var head = rows[hi];
  var add = ['image_url', 'expansion', 'cardnumber', 'rarity', 'pack_name', 'keyword', 'genre_display_name', 'category_display_name', 'display_name'].filter(function (c) { return head.indexOf(c) < 0; });
  var idCol = head.indexOf('id');
  var out = rows.map(function (r, i) {
    if (i < hi) return r;
    if (i === hi) return r.concat(add);
    var m = master[r[idCol]] || {};
    return r.concat(add.map(function (c) { return m[c] || ''; }));
  });
  return out.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
}

function siteMasterRows_() {
  var it = DriveApp.getFoldersByName('01_マスタ');
  if (!it.hasNext()) throw new Error('01_マスタ フォルダが見つかりません');
  var files = it.next().getFiles(), latest = null;
  while (files.hasNext()) { var f = files.next(); if (/\.csv$/i.test(f.getName()) && (!latest || f.getLastUpdated() > latest.getLastUpdated())) latest = f; }
  var rows = Utilities.parseCsv(latest.getBlob().getDataAsString('UTF-8').replace(/^﻿/, ''));
  var hi = -1; for (var i = 0; i < rows.length; i++) if (rows[i].indexOf('buy_price') >= 0) { hi = i; break; }
  var head = rows[hi], idx = {}; head.forEach(function (h, i) { idx[h] = i; });
  var map = {};
  for (var r = hi + 1; r < rows.length; r++) {
    var row = rows[r]; if (!row[idx.id]) continue;
    var o = {}; Object.keys(idx).forEach(function (k) { o[k] = row[idx[k]] || ''; });
    map[row[idx.id]] = o;
  }
  return map;
}

/** シートのタブを、許可した見出しの列だけ・非表示行を除いてCSV化 */
function siteTabCsv_(file) {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sheet = null;
  SITE_TABS[file].forEach(function (n) { if (!sheet) sheet = ss.getSheetByName(n); });
  if (!sheet) throw new Error('タブが見つかりません: ' + SITE_TABS[file].join('/'));
  var vals = sheet.getDataRange().getDisplayValues();
  var hi = -1;
  for (var i = 0; i < Math.min(vals.length, 10); i++) { if (vals[i].indexOf('買取価格') >= 0) { hi = i; break; } }
  if (hi < 0) throw new Error('見出し行が見つかりません');
  var head = vals[hi].map(function (h) { return String(h).trim(); });
  var cols = SITE_COLS[file].map(function (name) { return head.indexOf(name); });
  // 1列目（パック名/DF）は見出しが空のことがあるので、見出し名で見つからなければA列を使う
  if (cols[0] < 0) cols[0] = 0;
  var lines = [SITE_COLS[file]];
  for (var r = hi + 1; r < vals.length; r++) {
    if (sheet.isRowHiddenByUser(r + 1)) continue;
    var row = cols.map(function (c) { return c >= 0 ? vals[r][c] : ''; });
    if (!row.join('').trim()) continue;
    lines.push(row);
  }
  return lines.map(function (r) { return r.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
}

/** 動作確認用：エディタから実行してログに件数を出す */
function siteCsvTest() {
  ['data', 'psa', 'box', 'kyuura'].forEach(function (f) {
    try { var t = siteCsv_(f).getContent(); Logger.log(f + ': ' + t.split('\n').length + ' 行 / ' + t.length + ' 文字'); }
    catch (e) { Logger.log(f + ': ERROR ' + e); }
  });
}
