// 共有ライブラリ：build.js（Node）から使う。CSV→商品データの変換と画像URLの引き当て
const THUMB_PREFIX="https://static.mycalinks.io/app/item/image/";const CARD_PREFIX=THUMB_PREFIX+"card/";
const norm=s=>(s||"").toLowerCase().replace(/[\s\-\/_・]/g,"").replace(/[Ａ-Ｚａ-ｚ０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60));
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function hashId(s){let h=5381;for(const ch of s)h=((h*33)^ch.codePointAt(0))>>>0;return h.toString(36);}
let CONFIG={categories:["ポケモン","PSA","BOX","旧裏"],oldBackExpansions:/^(puromo0\d|sheet\d*|pmcg\d*|neo\d*|e\d|vs|web|1st|jungle|fossil|rocket|gym|old)$/i};
function setConfig(c){CONFIG=Object.assign(CONFIG,c);}

function parseCSV(text){
  const rows=[];let row=[],cell="",q=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(q){ if(ch==='"'){ if(text[i+1]==='"'){cell+='"';i++;} else q=false; } else cell+=ch; }
    else if(ch==='"') q=true;
    else if(ch===','){row.push(cell);cell="";}
    else if(ch==='\n'||ch==='\r'){ if(ch==='\r'&&text[i+1]==='\n') i++; row.push(cell);rows.push(row);row=[];cell=""; }
    else cell+=ch;
  }
  if(cell!==""||row.length){row.push(cell);rows.push(row);}
  return rows;
}
/* Myca商品マスタ形式・簡易形式（商品名,型番,...）どちらも読む */
function csvToItems(text){
  const rows=parseCSV(text.replace(/^﻿/,""));
  let hi=rows.findIndex(r=>r.includes("buy_price")); if(hi<0) hi=rows.findIndex(r=>r.includes("買取価格"));
  if(hi<0) return [];
  const head=rows[hi].map(h=>h.trim());
  let start=hi+1;
  const marker=rows.findIndex((r,i)=>i>hi&&/データ開始/.test(r[0]||""));
  if(marker>=0) start=marker+1;
  const g=(r,...keys)=>{for(const k of keys){const i=head.indexOf(k);if(i>=0&&r[i]!==undefined&&r[i].trim()!=="")return r[i].trim();}return "";};
  const out=[];
  rows.slice(start).forEach((r,idx)=>{
    if(!r.some(c=>c&&c.trim()))return;
    const name=g(r,"buy_display_name","display_name","商品名"); if(!name)return;
    const price=Number(String(g(r,"buy_price","買取価格")).replace(/[^\d]/g,""))||0; if(price<=0)return;
    if(g(r,"hidden")==="1")return;
    const exp=g(r,"expansion"), no_=g(r,"cardnumber");
    // 表示用カード番号： "067/SV-P" のように番号側にコードがあればそのまま、無ければ "M5 118/081"
    const code=g(r,"型番")||(no_&&/[A-Za-z]/.test(no_)?no_:[exp,no_].filter(Boolean).join(" "));
    let grade=g(r,"グレード"); const m=name.match(/PSA\s?(10|9|8)/i); if(!grade) grade=m?("PSA"+m[1]):"素体";
    const catCol=g(r,"category_display_name"), genreCol=g(r,"genre_display_name"), kw=g(r,"keyword"), explicit=g(r,"カテゴリー","カテゴリ");
    const type=g(r,"種別")||(/ボックス|BOX|パック/i.test(catCol+name)&&!/カード/.test(catCol)?"ボックス":"シングル");
    const hay=[explicit,genreCol,catCol].join(" ");
    let cat;
    if(/PSA/i.test(hay)) cat="PSA";
    else if(/BOX|ボックス/i.test(hay)) cat="BOX";
    else if(/旧裏/.test(hay)) cat="旧裏";
    else if(/PSA\s?\d/i.test(name+" "+kw)||/^PSA/i.test(grade)) cat="PSA";
    else if(type==="ボックス"||/BOX|ボックス|未開封/i.test(name)) cat="BOX";
    else if(/旧裏/.test(name+" "+kw)||CONFIG.oldBackExpansions.test(exp)) cat="旧裏";
    else cat=CONFIG.categories[0];
    const no=no_||"";
    out.push({ id:g(r,"id","myca_item_id")||String(idx), name, code, set:g(r,"pack_name","収録弾"), rarity:g(r,"rarity","レアリティ")||"-",
      grade, type, cat, no, exp, price, img:g(r,"image_url","画像URL"), note:g(r,"備考"),
      kw, order:Number(g(r,"order_number"))||0, idx });
  });
  return out;
}

/* 買取表スプレッドシート形式（パック名,カード名,パック型番,レアリティ,型番,…,買取価格 / DF,ボックス名,…,買取価格）を読む */
function sheetToItems(text,cat){
  const rows=parseCSV(text.replace(/^\uFEFF/,""));
  const hi=rows.findIndex(r=>r.includes("カード名")||r.includes("ボックス名")); if(hi<0)return [];
  const head=rows[hi].map(h=>h.trim()); const col=n=>head.indexOf(n);
  const cName=col("カード名")>=0?col("カード名"):col("ボックス名"), cExp=col("パック型番"), cNo=col("型番"), cRar=col("レアリティ"), cPrice=col("買取価格"), cImg=col("画像URL");
  const out=[], seen=new Set();
  rows.slice(hi+1).forEach((r,i)=>{
    const name=(r[cName]||"").trim(); const price=Number(String(r[cPrice]||"").replace(/[^\d]/g,""))||0;
    if(!name||price<=0)return;
    const exp=cExp>=0?(r[cExp]||"").trim().replace(/^-$/,""):"", no=cNo>=0?(r[cNo]||"").trim().replace(/^-$/,""):"";
    const rarity=cRar>=0?((r[cRar]||"").trim().replace(/^-$/,"")||"-"):"-";
    const code=no?(/[A-Za-z]/.test(no)?no:[exp,no].filter(Boolean).join(" ")):"";
    const dk=norm(name).replace(/[（）()［］\[\]「」【】、,.．。!！?？]/g,"")+"|"+norm(no)+"|"+price; if(seen.has(dk))return; seen.add(dk); // シート内の重複行（全角/半角違い等）は1件にまとめる
    out.push({ id:`${cat}-${hashId(cat+"|"+norm(name)+"|"+norm(no)+"|"+norm(exp))}`, name, code, set:(r[0]||"").trim(), rarity, grade:cat==="PSA"?"PSA10":"素体",
      type:cat==="BOX"?"ボックス":"シングル", cat, no, exp, price, img:cImg>=0?(r[cImg]||"").trim():"", note:"", kw:"", order:0, idx:i });
  });
  return out;
}
/* 画像URLの引き当て：Mycaデータの型番と一致すれば同じ画像、なければMycaの命名規則から推定（読めなければ仮表示） */
function resolveImages(items,base){
  const byNo={}, byExpNo={};
  const noCount={};
  base.forEach(b=>{ if(!b.img||/noimage/.test(b.img))return; if(b.no){noCount[b.no]=(noCount[b.no]||0)+1; byNo[b.no]=b.img; byExpNo[(b.exp+"|"+b.no).toLowerCase()]=b.img;} });
  Object.keys(noCount).forEach(k=>{if(noCount[k]>1)delete byNo[k];}); // 同じ番号が複数弾にある場合は番号だけでの引き当てはしない
  items.forEach(it=>{
    if(it.img)return;
    const k=(it.exp+"|"+it.no).toLowerCase();
    if(it.no&&byExpNo[k]) it.img=byExpNo[k];
    else if(it.no&&byNo[it.no]) it.img=byNo[it.no];
    else { let m, c=[];
      if((m=it.no.match(/^(\d+)\/([A-Za-z]+-P)$/))) c=[`${m[2]}/${m[2]}_${m[1]}.jpg`,`${m[2]}/${m[2].toLowerCase()}${m[1]}.jpg`];
      else if(/^[A-Za-z0-9+]+$/.test(it.exp)&&(m=it.no.match(/^(\d+)\/\d+$/))){const e=it.exp.replace("+","p");c=[...new Set([`${e}/${e}_${m[1]}.jpg`,`${e}/${e.toUpperCase()}_${m[1]}.jpg`,`${e.toLowerCase()}/${e}_${m[1]}.jpg`,`${e.toLowerCase()}/${e.toLowerCase()}_${m[1]}.jpg`,`${e}/${e[0]+e.slice(1,2).toUpperCase()+e.slice(2)}_${m[1]}.jpg`,`${e.slice(0,2).toUpperCase()+e.slice(2)}/${e.slice(0,2).toUpperCase()+e.slice(2)}_${m[1]}.jpg`])];}
      if(c.length){it.img=CARD_PREFIX+c[0];it.imgAlt=c.slice(1).map(x=>CARD_PREFIX+x);}
    }
  });
}


module.exports={parseCSV,csvToItems,sheetToItems,resolveImages,norm,esc,hashId,setConfig,THUMB_PREFIX,CARD_PREFIX};
