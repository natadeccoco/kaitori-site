// 初回だけエディタで実行：LINEへの送信を許可する
function setupAuth() {
  UrlFetchApp.fetch('https://api.line.me/v2/bot/info', { muteHttpExceptions: true });
}

/**
 * 宅配買取 サイト申込の受け口（テスト用シートに付ける）  v2（LINE連携）
 *  1) act=create … 買取サイトのカートを受け取り、見積書タブ（原本のコピー）と申込一覧の行を作る → 受付番号と合言葉(k)を返す
 *  2) act=link   … LINEの中継ページ（LIFF）から、受付番号・合言葉・LINEのアクセストークンを受け取り、
 *                  LINEの名前を記入し、公式LINEからお客さんへ受付内容をプッシュ送信する
 * スクリプトプロパティ：LINE_TOKEN（Messaging APIのチャネルアクセストークン）、LIFF_CHANNEL_ID（LINEログインのチャネルID）
 */
const TPL_NAME = '原本';
const LIST_NAME = '申込一覧（サイト）';
// 書き込み先：スクリプトプロパティ SHEET_ID があればそれ、なければ本番の「宅配買取ナタデココ🧊お見積りシート」
const SHEET_ID = '1BBESQZWxdsij1q8hIk_klPgw6RbYL4MonIV6CyKXWz8';
function ss_() { return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID') || SHEET_ID); }
const TPL_SLOTS = 31;
const FIRST_ROW = 2;
const COL = { date: 1, no: 2, name: 3, tel: 4, qty: 5, total: 6, code: 7, src: 8, lp: 9, tab: 10, recore: 11, memo: 12, lineName: 13, lineId: 14, items: 15, key: 16, arrived: 17, amount: 18, cancel: 19, won: 20, state: 21, remind: 22 };
const UNSENT_DAYS = 7;   // 申込から何日たっても届かなければ見積書タブを消す

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
    const ss = ss_();
    const list = ss.getSheetByName(LIST_NAME);
    const now = new Date();
    const md = Utilities.formatDate(now, 'Asia/Tokyo', 'M/d');
    const no = 'W' + Utilities.formatDate(now, 'Asia/Tokyo', 'MMdd') + '-' + ('000' + list.getLastRow()).slice(-3);
    const key = Utilities.getUuid().replace(/-/g, '').slice(0, 16);

    let title = '受付' + no + '（サイト）';
    const sh = ss.getSheetByName(TPL_NAME).copyTo(ss).setName(title);
    ss.setActiveSheet(sh); ss.moveActiveSheet(list.getIndex() + 1);   // 申込一覧のすぐ右（新しい順）
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
      ['申込日時', Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm')],
      ['受付コード', String(d.code || '').slice(0, 80) || '（なし）'],
      ['照合', 'RECOREの申込と「LINEの名前＋申込日」で照合']
    ]);
    sh.getRange('I1:I5').setFontWeight('bold');

    const qty = items.reduce(function (s, it) { return s + it.qty; }, 0);
    const total = items.reduce(function (s, it) { return s + it.price * it.qty; }, 0);
    const row = [now, no, '', '', qty, total, String(d.code || '') || '（直接）', String(d.src || ''), String(d.lp || ''),
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
  let items = [], already = false, r = 0, appliedAt = new Date();
  try {
    const ss = ss_();
    const list = ss.getSheetByName(LIST_NAME);
    const vals = list.getRange(2, 1, Math.max(1, list.getLastRow() - 1), COL.key).getValues();
    for (let i = vals.length - 1; i >= 0; i--) { if (vals[i][COL.no - 1] === no) { r = i + 2; break; } }
    if (!r || String(list.getRange(r, COL.key).getValue()) !== key) return out_({ ok: false, err: 'not_found' });
    already = !!list.getRange(r, COL.lineId).getValue();
    appliedAt = new Date(list.getRange(r, COL.date).getValue());
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
    let om = false;
    const lines = items.map(function (it) {
      if (!it.price) { om = true; return '・' + it.name + '（届いてから1枚ずつ査定）'; }   // おまかせ査定
      n += it.qty; t += it.price * it.qty; return '・' + it.name + ' ×' + it.qty + ' … ¥' + (it.price * it.qty).toLocaleString(); });
    const dl = new Date(appliedAt.getTime() + 3 * 86400000);   // 申込日の翌日から3日以内＝申込日+3日
    const dls = Utilities.formatDate(dl, 'Asia/Tokyo', 'M/d') + '（' + '日月火水木金土'.charAt(Number(Utilities.formatDate(dl, 'Asia/Tokyo', 'u')) % 7) + '）';
    const guard = n ? '🔒価格保証：申込日の翌日から3日以内（' + dls + 'まで）に届けば、申込日の金額で査定します（発送後に相場が下がっても下げません）。\n\n' : '📦' + dls + 'までの到着を目安にお送りください。\n\n';
    const text = '【宅配買取 受付】受付番号 ' + no + '\n\n' + guard + lines.join('\n') + (n ? '\n\n合計 ' + n + '点 ¥' + t.toLocaleString() + (om ? '＋おまかせ査定分' : '') : '\n\nカードはまとめてお送りください。届いてから査定してご連絡します。') +
      '\n\n※美品の場合の価格です。状態により減額の場合があります。\n※' + dls + 'を過ぎて届いた場合は、到着日の価格で査定します。\nこのあと開く申込フォームに住所などを入力して「申し込む」を押してください。';
    const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + lt, 'X-Line-Retry-Key': Utilities.getUuid() },
      payload: JSON.stringify({ to: p.userId, messages: [{ type: 'text', text: text.slice(0, 4900) }] })
    });
    pushed = res.getResponseCode() === 200;
    if (!pushed) ss_().getSheetByName(LIST_NAME).getRange(r, COL.memo).setValue('LINE送信失敗 ' + res.getResponseCode());
  }
  return out_({ ok: true, pushed: pushed });
}

function doGet() { return out_({ ok: true, ping: 'takuhai-apply-v2' }); }

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}


/* ===== 毎朝の見回り：着荷・査定額・成約を申込一覧に書き、届かない申込の見積書タブを消す =====
 * 着荷   … 見積書タブの「状態」(F列)に1つでも入力があれば「届いた」
 * 査定額 … 見積書タブの 金額×数量 の合計（スタッフが直した後の金額）
 * 全件キャンセル … スタッフがチェック（成約に数えない）
 * 成約   … 着荷 かつ 査定額>0 かつ 全件キャンセルでない
 * 申込から UNSENT_DAYS 日たっても着荷しない → 見積書タブを削除し「未着・削除」と記録（行は分析用に残す）
 */
function daily() {
  const ss = ss_(), list = ss.getSheetByName(LIST_NAME);
  const n = list.getLastRow() - 1; if (n < 1) return;
  const vals = list.getRange(2, 1, n, COL.remind).getValues();
  const lt = PropertiesService.getScriptProperties().getProperty('LINE_TOKEN');
  const ymd = function (d) { return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyyMMdd'); };
  const today = ymd(new Date()), reminds = [];
  const forms = list.getRange(2, COL.tab, n, 1).getFormulas();
  const byId = {}; ss.getSheets().forEach(function (sh) { byId[String(sh.getSheetId())] = sh; });
  const now = Date.now();
  const out = vals.map(function (v, i) {
    let arrived = v[COL.arrived - 1] === true, amount = v[COL.amount - 1], state = v[COL.state - 1];
    const cancel = v[COL.cancel - 1] === true;
    const m = String(forms[i][0]).match(/#gid=(\d+)/), sh = m && byId[m[1]];
    if (sh) {
      const last = Math.max(sh.getLastRow(), FIRST_ROW);
      const g = sh.getRange(FIRST_ROW, 2, last - FIRST_ROW + 1, 5).getValues();   // B:カード名 C:金額 D:数量 E:小計 F:状態
      let sum = 0, st = false;
      g.forEach(function (r) { if (!r[0] || /合計/.test(String(r[0]))) return; sum += (Number(r[1]) || 0) * (Number(r[2]) || 0); if (String(r[4]).trim()) st = true; });
      arrived = arrived || st; amount = sum;
      const age = (now - new Date(v[COL.date - 1]).getTime()) / 86400000;
      if (!arrived && age >= UNSENT_DAYS) { ss.deleteSheet(sh); state = '未着・削除'; amount = ''; }
      else state = arrived ? '着荷' : '到着待ち';
    }
    const won = arrived && !cancel && Number(amount) > 0;
    // 期限の前日（申込日+2日）に、まだ届いていない人へ公式LINEで1回だけお知らせ
    let remind = v[COL.remind - 1];
    const applied = new Date(v[COL.date - 1]), uid = String(v[COL.lineId - 1] || '');
    if (!remind && !arrived && sh && uid && lt && ymd(new Date(applied.getTime() + 2 * 86400000)) === today) {
      const dl = new Date(applied.getTime() + 3 * 86400000);
      const dls = Utilities.formatDate(dl, 'Asia/Tokyo', 'M/d') + '（' + '日月火水木金土'.charAt(Number(Utilities.formatDate(dl, 'Asia/Tokyo', 'u')) % 7) + '）';
      let priced = false; try { priced = JSON.parse(String(v[COL.items - 1] || '[]')).some(function (it) { return it.price > 0; }); } catch (e) {}
      const text = '【宅配買取】受付番号 ' + v[COL.no - 1] + '\n\nいつもナタデココをご利用いただきありがとうございます。\nお申込みいただいたお荷物のご発送はお済みでしょうか。\n\n' +
        (priced ? '明日 ' + dls + ' までに当店へ到着しましたら、お申込日の金額で査定いたします。' : '明日 ' + dls + ' までの到着を目安にお送りいただけますと幸いです。') +
        '\nまだお送りいただいていない場合は、お早めのご発送をお願いいたします。\n\n※すでにご発送いただいている場合は、行き違いとなり申し訳ございません。到着まで今しばらくお待ちくださいませ。';
      const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { Authorization: 'Bearer ' + lt, 'X-Line-Retry-Key': Utilities.getUuid() },
        payload: JSON.stringify({ to: uid, messages: [{ type: 'text', text: text }] })
      });
      remind = res.getResponseCode() === 200 ? Utilities.formatDate(new Date(), 'Asia/Tokyo', 'M/d') + ' 送信' : '送信失敗 ' + res.getResponseCode();
    }
    return [arrived, amount, cancel, won, state, remind];
  });
  list.getRange(2, COL.arrived, n, 6).setValues(out);
  list.getRange(2, COL.arrived, n, 1).insertCheckboxes(); list.getRange(2, COL.cancel, n, 1).insertCheckboxes(); list.getRange(2, COL.won, n, 1).insertCheckboxes();
}

// 初回だけエディタで実行：毎朝10時台に daily を動かす（お客さまへのお知らせが早朝にならないように）
function setupDaily() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'daily') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('daily').timeBased().everyDays(1).atHour(10).inTimezone('Asia/Tokyo').create();
  daily();
}
