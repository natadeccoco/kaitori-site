/**
 * 宅配買取 サイト申込の受け口（テスト用シートに付ける）  v2（LINE連携）
 *  1) act=create … 買取サイトのカートを受け取り、見積書タブ（原本のコピー）と申込一覧の行を作る → 受付番号と合言葉(k)を返す
 *  2) act=link   … LINEの中継ページ（LIFF）から、受付番号・合言葉・LINEのアクセストークンを受け取り、
 *                  LINEの名前を記入し、公式LINEからお客さんへ受付内容をプッシュ送信する
 * スクリプトプロパティ：LINE_TOKEN（Messaging APIのチャネルアクセストークン）、LIFF_CHANNEL_ID（LINEログインのチャネルID）
 */
const TPL_NAME = '原本';
const LIST_NAME = '申込一覧';
const TPL_SLOTS = 31;
const FIRST_ROW = 2;
const COL = { date: 1, no: 2, name: 3, tel: 4, qty: 5, total: 6, code: 7, src: 8, lp: 9, tab: 10, recore: 11, memo: 12, lineName: 13, lineId: 14, items: 15, key: 16 };

function doPost(e) {
  let d = {};
  try { d = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return out_({ ok: false, err: 'bad_json' }); }
  if (d.hp) return out_({ ok: true, no: 'X' });
  try {
    if (d.act === 'link') return link_(d);
    return create_(d);
  } catch (err) {
    return out_({ ok: false, err: String(err).slice(0, 200) });
  }
}

function create_(d) {
  const items = (Array.isArray(d.items) ? d.items : []).slice(0, 300).map(function (it) {
    return {
      name: String(it.name || '').replace(/^[=+@-]+/, '').slice(0, 120),
      price: Math.max(0, Math.round(Number(it.price) || 0)),
      qty: Math.max(1, Math.min(999, Math.round(Number(it.qty) || 1)))
    };
  }).filter(function (it) { return it.name; });
  if (!items.length) return out_({ ok: false, err: 'empty' });

  // 連続送信の制限（同じ端末から10分に5回まで）
  const cache = CacheService.getScriptCache();
  const dev = String(d.dev || '').replace(/[^a-z0-9]/gi, '').slice(0, 40) || 'x';
  const ck = 'dev_' + dev, cnt = Number(cache.get(ck) || 0);
  if (cnt >= 5) return out_({ ok: false, err: 'rate' });
  cache.put(ck, String(cnt + 1), 600);

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const list = ss.getSheetByName(LIST_NAME);
    const now = new Date();
    const md = Utilities.formatDate(now, 'Asia/Tokyo', 'M/d');
    const no = 'W' + Utilities.formatDate(now, 'Asia/Tokyo', 'MMdd') + '-' + ('000' + list.getLastRow()).slice(-3);
    const key = Utilities.getUuid().replace(/-/g, '').slice(0, 16);

    let title = '受付' + no + '（サイト）';
    const sh = ss.getSheetByName(TPL_NAME).copyTo(ss).setName(title);
    ss.setActiveSheet(sh); ss.moveActiveSheet(3);
    if (items.length > TPL_SLOTS) {
      const extra = items.length - TPL_SLOTS;
      sh.insertRowsAfter(FIRST_ROW + TPL_SLOTS - 2, extra);
      const src = sh.getRange(FIRST_ROW + TPL_SLOTS - 2, 1, 1, 7);
      for (let i = 0; i < extra; i++) src.copyTo(sh.getRange(FIRST_ROW + TPL_SLOTS - 1 + i, 1, 1, 7));
      const last = FIRST_ROW + items.length - 1;
      for (let r = FIRST_ROW; r <= last; r++) { sh.getRange(r, 1).setValue(r - 1); sh.getRange(r, 5).setFormula('=SUM(C' + r + '*D' + r + ')'); }
    }
    sh.getRange(FIRST_ROW, 2, items.length, 3).setValues(items.map(function (it) { return [it.name, it.price, it.qty]; }));
    sh.getRange('I1:J5').setValues([
      ['申込番号', no],
      ['LINEの名前', '（LINEで開く前）'],
      ['電話番号', ''],
      ['受付コード', String(d.code || '').slice(0, 80) || '（なし）'],
      ['申込日時', Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm')]
    ]);
    sh.getRange('I1:I5').setFontWeight('bold');

    const qty = items.reduce(function (s, it) { return s + it.qty; }, 0);
    const total = items.reduce(function (s, it) { return s + it.price * it.qty; }, 0);
    const row = [now, no, '', '', qty, total, String(d.code || ''), String(d.src || ''), String(d.lp || ''),
      '=HYPERLINK("#gid=' + sh.getSheetId() + '","' + title + '")', '', String(d.device || ''), '', '', JSON.stringify(items).slice(0, 45000), key];
    list.appendRow(row);
    return out_({ ok: true, no: no, k: key });
  } finally {
    lock.releaseLock();
  }
}

function link_(d) {
  const no = String(d.no || ''), key = String(d.k || '');
  if (!/^W\d{4}-\d{3,}$/.test(no) || !key) return out_({ ok: false, err: 'bad_no' });
  const props = PropertiesService.getScriptProperties();

  // LINEのアクセストークンを確認して、本人のユーザーIDと名前を取る（なりすまし防止）
  const tok = String(d.token || '');
  const v = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify?access_token=' + encodeURIComponent(tok), { muteHttpExceptions: true });
  if (v.getResponseCode() !== 200) return out_({ ok: false, err: 'verify' });
  const vj = JSON.parse(v.getContentText());
  const cid = props.getProperty('LIFF_CHANNEL_ID') || '2012609296';
  if (cid && String(vj.client_id) !== String(cid)) return out_({ ok: false, err: 'client' });
  const pr = UrlFetchApp.fetch('https://api.line.me/v2/profile', { headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true });
  if (pr.getResponseCode() !== 200) return out_({ ok: false, err: 'profile' });
  const p = JSON.parse(pr.getContentText());

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let items = [], already = false, r = 0;
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const list = ss.getSheetByName(LIST_NAME);
    const vals = list.getRange(2, 1, Math.max(1, list.getLastRow() - 1), COL.key).getValues();
    for (let i = vals.length - 1; i >= 0; i--) { if (vals[i][COL.no - 1] === no) { r = i + 2; break; } }
    if (!r || String(list.getRange(r, COL.key).getValue()) !== key) return out_({ ok: false, err: 'not_found' });
    already = !!list.getRange(r, COL.lineId).getValue();
    const name = String(p.displayName || '').replace(/[=+@]/g, '').slice(0, 40);
    list.getRange(r, COL.lineName, 1, 2).setValues([[name, p.userId]]);
    if (!list.getRange(r, COL.name).getValue()) list.getRange(r, COL.name).setValue(name + '（LINE名）');
    try { items = JSON.parse(String(list.getRange(r, COL.items).getValue() || '[]')); } catch (e) { items = []; }
    // 見積書タブの名前を「LINE名様11/14（サイト）」に
    const f = String(list.getRange(r, COL.tab).getFormula());
    const m = f.match(/#gid=(\d+)/);
    if (m) {
      const sh = ss.getSheets().filter(function (s) { return String(s.getSheetId()) === m[1]; })[0];
      if (sh) {
        const md = Utilities.formatDate(list.getRange(r, COL.date).getValue(), 'Asia/Tokyo', 'M/d');
        let title = name + '様' + md + '（サイト）', n = 2;
        while (ss.getSheetByName(title) && ss.getSheetByName(title).getSheetId() !== sh.getSheetId()) title = name + '様' + md + '（サイト' + (n++) + '）';
        sh.setName(title); sh.getRange('J2').setValue(name);
        list.getRange(r, COL.tab).setFormula('=HYPERLINK("#gid=' + sh.getSheetId() + '","' + title.replace(/"/g, '') + '")');
      }
    }
  } finally {
    lock.releaseLock();
  }

  // 公式LINEから受付内容を送る（同じ受付番号では1回だけ）
  let pushed = false;
  const lt = props.getProperty('LINE_TOKEN');
  if (lt && !already) {
    let t = 0, n = 0;
    const lines = items.map(function (it) { n += it.qty; t += it.price * it.qty; return '・' + it.name + ' ×' + it.qty + ' … ¥' + (it.price * it.qty).toLocaleString(); });
    const text = '【宅配買取 受付】受付番号 ' + no + '\n\n' + lines.join('\n') + '\n\n合計 ' + n + '点 ¥' + t.toLocaleString() +
      '\n\n※表示は美品の場合の価格です。最終的な金額はカード到着日の価格で査定します。\nこのあと開く申込フォームに住所などを入力して「申し込む」を押してください。';
    const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + lt, 'X-Line-Retry-Key': Utilities.getUuid() },
      payload: JSON.stringify({ to: p.userId, messages: [{ type: 'text', text: text.slice(0, 4900) }] })
    });
    pushed = res.getResponseCode() === 200;
    if (!pushed) SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LIST_NAME).getRange(r, COL.memo).setValue('LINE送信失敗 ' + res.getResponseCode());
  }
  return out_({ ok: true, pushed: pushed });
}

function doGet() { return out_({ ok: true, ping: 'takuhai-apply-v2' }); }

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
