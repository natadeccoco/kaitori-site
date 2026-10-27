# ナタデココ かんたん郵送買取 — サイト本体

`kaitori.pokemon-card.shop` で公開する買取価格表サイトの一式です。
毎朝、買取表スプレッドシート（GAS）から価格CSVを取り込み、サイト全体（価格表・カード個別ページ・サイトマップ）を自動で作り直して公開します。人の手は不要です。

## 仕組み

```
買取表スプレッドシート（毎朝2〜6時に自動更新）
   └ GAS doGet ?action=sitedata（全タブをJSONで配信）   ← site_data.gs
        └ GitHub Actions（毎朝06:30 JST）が取得 → node build.js → GitHub Pages に公開
```

- `data_sheet.json` … 最後に取得した買取表の全タブ（取得失敗時はこれで生成されるので、サイトが空になることはない）
- `master_images.csv` … Mycaの全商品カタログ（画像URL付き・約3.3万件）。カード画像はここから型番・名前で引き当てる。Mycaに新商品が増えたら全商品エクスポートから作り直す
- `sheetdata.js` … 買取表JSON→商品データ、画像引き当て
- `dist/noimage.txt` … 画像を引き当てられなかった行の一覧（ビルドごとに更新）
- `page.html` … 価格表アプリ（1ページ）
- `card.html` … カード個別ページの雛形（検索エンジン向け・1カード1ページ・OGP・構造化データ）
- `stores.html` `legal.html` `privacy.html` … 固定ページ
- `lib.js` … CSV→商品データ変換、画像URL引き当て（Myca型番一致→命名規則推定）
- `build.js` … 生成本体。`dist/` に出力
- `config.json` … サイトURL・LINE・X・会社情報・古物商許可番号
- `.github/workflows/build.yml` … 毎朝の自動更新と公開
- `site_data.gs` … スプレッドシート側に追加するスクリプト

## 初回セットアップ（1回だけ）

1. **GitHub** でリポジトリを作成（例 `natadecoco/kaitori-site`、Private でOK）し、このフォルダの中身をすべてアップロード（build.yml は `.github/workflows/build.yml` に置く）。
2. リポジトリの Settings → Pages → Build and deployment の Source を **GitHub Actions** にする。
3. Settings → Secrets and variables → Actions → New repository secret
   - Name: `SITE_DATA_URL`　Value: GASのWebアプリURL（`https://script.google.com/macros/s/…/exec`）
4. **GAS**：買取表スプレッドシートのApps Scriptに `site_data.gs` を追加し、既存の `doGet(e)` の先頭に
   `if (e && e.parameter && e.parameter.action === 'sitedata') return siteData_();`
   を1行追加 → 新しいバージョンでデプロイ。エディタで `siteDataTest` を実行してタブごとの件数が出ればOK。載せるタブは `site_data.gs` の `SITE_TABS` で管理。
5. **DNS**：`kaitori.pokemon-card.shop` の CNAME を `<GitHubユーザー名>.github.io` に向ける。
   GitHub の Settings → Pages → Custom domain に `kaitori.pokemon-card.shop` を入れ、Enforce HTTPS をON。
6. `config.json` の `lineId` / `lineAddUrl` / `xUrl` / `antiqueLicense` を実際の値にする。
7. 画像：リポジトリ直下に `logo.png`（720×180 透過PNG）、`banner.jpg`（1800×600）、`ogp.png`（1200×630）を置く。店舗写真は `img/stores/<id>.jpg`（kashiwa, matsudo, tsudanuma, chibachuo, nakano, odaiba, machida, yokohama）。
8. Actions タブ → build-and-deploy → Run workflow で初回公開。以後は毎朝自動。
9. Shopify のメニューに「買取価格表」として `https://kaitori.pokemon-card.shop/` を追加。

## 手元で確認するとき

```
node build.js        # dist/ に生成
npx serve dist       # ブラウザで確認（任意）
```
