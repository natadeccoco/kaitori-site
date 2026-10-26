#!/usr/bin/env bash
# GAS Webアプリ（site_data.gs）から当日の価格CSVを取得して data/ を更新する。
# 取得に失敗したファイルは前回の内容をそのまま使う（サイトが空になることはない）。
set -u
if [ -z "${SITE_DATA_URL:-}" ]; then echo "SITE_DATA_URL 未設定: 既存の data_*.csvで生成します"; exit 0; fi
ok=0
for f in data psa box kyuura; do
  tmp=$(mktemp)
  if curl -fsSL --max-time 120 "${SITE_DATA_URL}?action=sitecsv&file=${f}" -o "$tmp" && [ "$(wc -c < "$tmp")" -gt 200 ] && ! grep -qi "<html" "$tmp"; then
    mv "$tmp" "data_${f}.csv"; echo "updated data_${f}.csv ($(wc -l < data_${f}.csv) lines)"; ok=$((ok+1))
  else
    echo "WARN: ${f} の取得に失敗。前回のファイルを使います"; rm -f "$tmp"
  fi
done
if [ "$ok" -gt 0 ]; then TZ=Asia/Tokyo date +%Y/%m/%d > data_updated.txt; fi
