# ナタデココ かんたん郵送買取 — サイト本体（引き継ぎメモ兼README）

株式会社ナタデココのポケモンカード買取価格表サイトです。
公開URL（仮）: https://natadeccoco.github.io/kaitori-site/ → 独自ドメイン `kaitori.pokemon-card.shop` に切替予定。

このメモは、別の人（またはその人のClaude）がこのサイトの管理・編集を引き継げるように書いています。
**Claudeに「https://github.com/natadeccoco/kaitori-site のREADMEを読んで、買取サイトの編集を手伝って」と伝えれば、仕組みを把握できます。**

## 1. 仕組み（全体像）

```
Googleスプレッドシート「ナタデココ買取表」(ID 1gtUjjGDQvFAE2PR_QDe343wFHS48PbqcHuuLTmT-4YQ)
   └ Apps Script（site_data.gs）: Webアプリ ?action=sitedata → 価格データをJSONで配信
        └ GitHub Actions（毎朝 06:30 JST / pushのたび / 手動）
             fetch_data.sh で取得 → data_sheet.json → node build.js → dist/ → GitHub Pages に公開
```

- **価格・掲載カードの元は常にスプレッドシート**。サイト側のファイルに価格は書いていません。
- 画像は Myca（static.mycalinks.io）の商品画像を `master_images.csv`（Myca全商品カタログの抜粋）から引き当てます。
- 非表示にしたタブはサイトに出ません。非表示の行は BOXタブだけ除外されます（他タブは行の非表示は見ていません）。
- 価格が数字でない行（時価・ASK・ー）は出ません。

## 2. よくある作業と、どこを触るか

| やりたいこと | 触る場所 | 反映 |
|---|---|---|
| 価格を変える・カードを足す/消す | スプレッドシートの該当タブ | 翌朝6:30に自動（急ぐなら Actions → Run workflow） |
| 新しいタブをサイトに載せる | Apps Script `site_data.gs` の `SITE_TABS` に追加 → 新バージョンでデプロイ | 次回更新 |
| バナー画像を差し替える | `banner.jpg`（1800×600）を上書き | pushで自動 |
| 画像が違うカードを直す | `image_overrides.csv` に1行追加（カテゴリ,名前,画像パス。`-` で画像なし） | pushで自動 |
| 文言・デザイン | `page.html`（価格表）、`card.html`（カード個別）、`stores.html`（店舗）、`legal.html`、`privacy.html` | pushで自動 |
| LINE・X・古物商番号・会社名 | `config.json` | pushで自動 |
| 独自ドメイン切替 | `config.json` の `siteUrl` を `https://kaitori.pokemon-card.shop` に戻す ＋ GitHub Settings → Pages → Custom domain | pushで自動 |

ファイルの編集は GitHub のWeb画面（ファイルを開いて鉛筆アイコン、または「Add file → Upload files」で上書き）でできます。pushすると1〜2分で公開されます。

## 3. ファイル一覧

- `build.js` … 生成本体。`data_sheet.json` ＋ `master_images.csv` ＋ `image_overrides.csv` から `dist/` を出力
- `sheetdata.js` … スプレッドシートJSON→商品データ、画像の引き当て（型番一致 → 旧裏はカード名＋括弧内ヒントで採点 → 命名規則からの推定）
- `lib.js` … 共通関数（CSV読み込み、正規化、ID生成）
- `page.html` … 価格表アプリ（検索・カテゴリタブ・カート・LINE申込）
- `card.html` … カード個別ページの雛形（SEO用・OGP・構造化データ）
- `stores.html` `legal.html` `privacy.html` … 固定ページ
- `config.json` … サイトURL・LINE ID/友だち追加URL・X・古物商許可・会社名・カテゴリ
- `site_data.gs` … スプレッドシート側 Apps Script（既にインストール済み。同じ内容を置いてあるだけ）
- `fetch_data.sh` … GAS から JSON を取得（失敗時は前回のデータを使う）
- `.github/workflows/build.yml` … 自動更新と公開
- `data_sheet.json` `data_updated.txt` … 最後に取得した価格データ（Actionsが自動でコミット）
- `master_images.csv` … Myca画像カタログ（約33,000件）。新弾が出てカードが見つからないときは、Myca POSの商品エクスポートから作り直す
- `image_overrides.csv` … 画像の手動指定
- `logo.png` `ogp.png` `banner.jpg` `favicon.svg` … 画像
- `data_*.csv` … 旧方式の名残（未使用。消してよい）

## 4. 設定済みのもの

- GitHub Pages: Source = GitHub Actions
- Secrets: `SITE_DATA_URL`（GAS WebアプリURL）
- Apps Script: 買取表スプレッドシートに紐づくプロジェクト。`doGet` の先頭に `action=sitedata` の分岐あり

## 5. 残タスク（2026-10-27時点）

1. 公式LINEのIDと友だち追加URL → `config.json` の `lineId` / `lineAddUrl`（今は仮）
2. DNS: `kaitori.pokemon-card.shop` の CNAME を `natadeccoco.github.io` に向ける → GitHub Pages の Custom domain に設定 → `config.json` の `siteUrl` を戻す
3. 店舗写真 `img/stores/<id>.jpg`（kashiwa, matsudo, tsudanuma, chibachuo, nakano, odaiba, machida, yokohama）任意
4. Shopify のメニューに「買取価格表」のリンクを追加

## 6. 注意

- スプレッドシートはお客様も見るため、内部情報（仕入れ基準・他社価格など）の列は置かない
- `site_data.gs` が出す列は見出し名のホワイトリストだけ。列を増やしてもサイトには出ない
- リポジトリは公開（GitHub Pages 無料枠の条件）。パスワードや内部データはコミットしない

## 手元で確認するとき

```
node build.js        # dist/ に生成
npx serve dist       # ブラウザで確認（任意）
```
