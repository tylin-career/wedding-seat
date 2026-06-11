#!/usr/bin/env node
/* 名單（TABLES）與場地幾何（GEO）一致性檢查（零依賴）
   用法：node tools/validate.js [index.html路徑]
   全部通過 exit 0；有錯誤 exit 1（可接 CI 或在改名單後手動執行） */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");

const FILE = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, "..", "index.html");
const html = fs.readFileSync(FILE, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error("✗ 找不到 <script> 區塊"); process.exit(1); }
const cut = m[1].indexOf("/* ================= 搜尋");
if (cut < 0) { console.error("✗ 找不到『搜尋』區段註解標記，無法擷取資料區"); process.exit(1); }
const { CONFIG, TABLES, GEO } = vm.runInNewContext(m[1].slice(0, cut) + ";({CONFIG,TABLES,GEO})", {}, { timeout: 2000 });

const errors = [], warns = [];
const err = s => errors.push(s), warn = s => warns.push(s);

/* 1. 桌號唯一且為數字 */
const seen = new Set();
for (const t of TABLES) {
  if (seen.has(t.no)) err(`桌號 ${t.no} 在 TABLES 重複出現`);
  seen.add(t.no);
  if (typeof t.no !== "number") err(`桌號 ${JSON.stringify(t.no)} 不是數字`);
  if (!t.name) warn(`第 ${t.no} 桌沒有桌名`);
}

/* 2. 每桌都要有座標與進場路徑（缺了地圖不畫該桌、路線無法繪製） */
for (const t of TABLES) {
  if (!GEO.tables[t.no]) err(`第 ${t.no} 桌（${t.name}）缺 GEO.tables 座標 → 地圖不會畫出這一桌`);
  if (!GEO.approach[t.no]) err(`第 ${t.no} 桌（${t.name}）缺 GEO.approach → 無法繪製帶位路線`);
}

/* 3. 反向：孤兒座標（座標有、名單沒有 → 不會顯示，提醒清理） */
for (const no of Object.keys(GEO.tables)) if (!seen.has(+no)) warn(`GEO.tables 有第 ${no} 桌座標，但 TABLES 名單沒有這一桌（不會顯示）`);
for (const no of Object.keys(GEO.approach)) if (!seen.has(+no)) warn(`GEO.approach 有第 ${no} 桌路徑，但 TABLES 名單沒有這一桌`);

/* 4. approach 合法性：走廊代號存在、ax 在走廊範圍內（超出會被建圖時濾掉） */
for (const [no, a] of Object.entries(GEO.approach)) {
  const c = GEO.corridors[a.c];
  if (!c) { err(`第 ${no} 桌 approach 指到不存在的走廊「${a.c}」`); continue; }
  if (a.ax < c.x0 - 0.1 || a.ax > c.x1 + 0.1) err(`第 ${no} 桌 approach.ax=${a.ax} 超出走廊 ${a.c} 範圍 ${c.x0}–${c.x1} → 路徑節點會被濾掉`);
  if (!Array.isArray(a.tail) || !a.tail.length) warn(`第 ${no} 桌 approach.tail 是空的（路線會停在走廊上）`);
}

/* 5. links 接點要落在兩條走廊範圍內，否則該連接 silently 不生效 */
for (const [a, b, xs] of GEO.links) {
  for (const c of [a, b]) if (!GEO.corridors[c]) err(`links 引用不存在的走廊「${c}」`);
  if (GEO.corridors[a] && GEO.corridors[b]) for (const x of xs)
    for (const c of [a, b]) {
      const cc = GEO.corridors[c];
      if (x < cc.x0 - 0.1 || x > cc.x1 + 0.1) err(`links ${a}↔${b} 接點 x=${x} 超出走廊 ${c} 範圍 ${cc.x0}–${cc.x1} → 這條連接不會生效`);
    }
}

/* 6. 路線可達性：仿 index.html buildPath 建走廊圖，從入口跑 Dijkstra，每桌都要可達 */
try {
  const C = GEO.corridors;
  const nodeXs = {}; for (const k in C) nodeXs[k] = new Set();
  for (const [a, b, xs] of GEO.links) xs.forEach(x => { nodeXs[a] && nodeXs[a].add(x); nodeXs[b] && nodeXs[b].add(x); });
  Object.values(GEO.approach).forEach(a => nodeXs[a.c] && nodeXs[a.c].add(a.ax));
  nodeXs.B && nodeXs.B.add(GEO.entrance.x);
  const id = (c, x) => c + "@" + x, nodes = {}, edges = {};
  const addEdge = (u, v, w) => { (edges[u] = edges[u] || []).push([v, w]); (edges[v] = edges[v] || []).push([u, w]); };
  for (const c in nodeXs) {
    const xs = [...nodeXs[c]].filter(x => x >= C[c].x0 - 0.1 && x <= C[c].x1 + 0.1).sort((a, b) => a - b);
    xs.forEach((x, i) => { nodes[id(c, x)] = 1; if (i > 0) addEdge(id(c, xs[i - 1]), id(c, x), (x - xs[i - 1]) * (GEO.weights[c] || 1)); });
  }
  for (const [a, b, xs] of GEO.links) xs.forEach(x => { if (nodes[id(a, x)] && nodes[id(b, x)]) addEdge(id(a, x), id(b, x), Math.abs(C[a].y - C[b].y)); });
  nodes.ENT = 1; addEdge("ENT", id("B", GEO.entrance.x), GEO.entrance.y - GEO.entrance.joinY);
  const dist = {}; for (const n in nodes) dist[n] = Infinity; dist.ENT = 0;
  const Q = new Set(Object.keys(nodes));
  while (Q.size) {
    let u = null, du = Infinity; for (const n of Q) if (dist[n] < du) { du = dist[n]; u = n; }
    if (u === null) break; Q.delete(u);
    for (const [v, w] of (edges[u] || [])) if (Q.has(v) && du + w < dist[v]) dist[v] = du + w;
  }
  for (const t of TABLES) {
    const a = GEO.approach[t.no]; if (!a || !C[a.c]) continue; /* 缺漏已在前面報錯 */
    const g = id(a.c, a.ax);
    if (!(g in dist)) err(`第 ${t.no} 桌的路徑節點 ${g} 不在走廊圖中`);
    else if (!isFinite(dist[g])) err(`第 ${t.no} 桌從入口走不到（走廊圖不連通）`);
  }
} catch (e) { err("可達性檢查執行失敗：" + e.message); }

/* 7. 名單品質：空白姓名、前後空白、跨桌同名（搜尋會列出多筆，提醒確認） */
const byName = {};
for (const t of TABLES) for (const g of t.guests) {
  if (!g || !g.trim()) err(`第 ${t.no} 桌有空白姓名`);
  else {
    if (g !== g.trim()) warn(`第 ${t.no} 桌「${g}」前後有空白`);
    (byName[g] = byName[g] || new Set()).add(t.no);
  }
}
for (const [g, ts] of Object.entries(byName)) if (ts.size > 1) warn(`「${g}」同時出現在第 ${[...ts].join("、")} 桌（搜尋會列出多筆）`);

/* 8. CONFIG */
if (!(CONFIG.mPerPt > 0)) err("CONFIG.mPerPt 必須是正數");

/* 報告 */
const seats = TABLES.reduce((s, t) => s + t.guests.length, 0);
console.log(`共 ${TABLES.length} 桌（含預備桌 ${TABLES.filter(t => !t.guests.length).length} 桌）、賓客席位 ${seats} 位`);
warns.forEach(w => console.log("⚠ " + w));
errors.forEach(e => console.log("✗ " + e));
if (errors.length) { console.log(`\n${errors.length} 個錯誤、${warns.length} 個警告`); process.exit(1); }
console.log(`✓ 全部檢查通過${warns.length ? `（${warns.length} 個警告）` : ""}`);
