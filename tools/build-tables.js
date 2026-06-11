#!/usr/bin/env node
/* 名單 CSV ↔ index.html TABLES 轉換工具（零依賴）
   匯出現有名單：node tools/build-tables.js --export > guests.csv  （可貼回 Google Sheet）
   由 CSV 產生：  node tools/build-tables.js guests.csv            （印出 TABLES 行）
   直接回寫：    node tools/build-tables.js guests.csv --write     （更新 index.html，建議接著跑 validate.js）

   CSV 格式（UTF-8，Google Sheet「下載為 CSV」即可）：
     桌號,桌名,賓客
     7,ASUS堅若磐石,謝曜陽 (Andy)
     7,ASUS堅若磐石,安安
     31,預備桌,            ← 賓客留空＝預備桌
   一位賓客一列；同名重複列＝同桌保留多個座位（頁面會顯示 ×N）。 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const FILE = path.join(__dirname, "..", "index.html");

function readTables() {
  const html = fs.readFileSync(FILE, "utf8");
  const m = html.match(/const TABLES = (\[[\s\S]*?\]);/);
  if (!m) { console.error("✗ index.html 找不到 const TABLES"); process.exit(1); }
  return { html, json: m[1], tables: vm.runInNewContext("(" + m[1] + ")") };
}
const csvEsc = s => /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
function parseCSV(text) {
  const rows = []; let row = [], cell = "", inQ = false;
  text = text.replace(/^\uFEFF/, ""); /* 去除 Excel/Sheets 匯出的 BOM */
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += ch; }
    else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); if (row.some(c => c !== "")) rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  row.push(cell); if (row.some(c => c !== "")) rows.push(row);
  return rows;
}

const args = process.argv.slice(2);

if (args[0] === "--export") {
  const { tables } = readTables();
  const out = ["桌號,桌名,賓客"];
  for (const t of tables) {
    if (!t.guests.length) out.push(`${t.no},${csvEsc(t.name)},`);
    for (const g of t.guests) out.push(`${t.no},${csvEsc(t.name)},${csvEsc(g)}`);
  }
  process.stdout.write(out.join("\n") + "\n");
  process.exit(0);
}

const csvPath = args.find(a => !a.startsWith("--"));
if (!csvPath) { console.error("用法：build-tables.js --export ｜ build-tables.js <csv檔> [--write]"); process.exit(1); }

const rows = parseCSV(fs.readFileSync(csvPath, "utf8"));
const head = (rows.shift() || []).map(s => s.trim());
const iNo = head.indexOf("桌號"), iName = head.indexOf("桌名"), iGuest = head.indexOf("賓客");
if (iNo < 0 || iName < 0 || iGuest < 0) { console.error("✗ CSV 需要表頭：桌號,桌名,賓客"); process.exit(1); }

const order = [], byNo = new Map();
for (const [ri, r] of rows.entries()) {
  const no = Number((r[iNo] || "").trim());
  const name = (r[iName] || "").trim(), g = (r[iGuest] || "").trim();
  if (!Number.isInteger(no) || no <= 0) { console.error(`✗ 第 ${ri + 2} 列桌號「${r[iNo]}」不是正整數`); process.exit(1); }
  if (!byNo.has(no)) { byNo.set(no, { no, name, guests: [] }); order.push(no); }
  const t = byNo.get(no);
  if (name && t.name && name !== t.name) { console.error(`✗ 第 ${ri + 2} 列：第 ${no} 桌桌名不一致（「${t.name}」vs「${name}」）`); process.exit(1); }
  if (name && !t.name) t.name = name;
  if (g) t.guests.push(g);
}
const tables = order.map(no => byNo.get(no));
const line = `const TABLES = ${JSON.stringify(tables)};`;

if (args.includes("--write")) {
  const { html } = readTables();
  fs.writeFileSync(FILE, html.replace(/const TABLES = \[[\s\S]*?\];/, () => line));
  console.log(`✓ 已寫入 index.html：${tables.length} 桌、${tables.reduce((s, t) => s + t.guests.length, 0)} 位賓客`);
  console.log("建議接著執行：node tools/validate.js");
} else process.stdout.write(line + "\n");
