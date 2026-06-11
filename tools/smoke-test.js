#!/usr/bin/env node
/* 煙霧測試（零依賴）：以 DOM stub 在 Node vm 內執行 index.html 整段 script，
   驗證搜尋、Enter 帶位、清除按鈕、URL 深連結、缺座標防呆、Service Worker 快取邏輯。
   用法：node tools/smoke-test.js   （全部通過 exit 0，否則 exit 1） */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log("  ✓ " + msg); } else { fail++; console.log("  ✗ " + msg); } };

/* ========== 1. 頁面邏輯（index.html inline script） ========== */
console.log("【index.html 頁面邏輯】");
{
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

  /* ---- 極簡 DOM stub ---- */
  function makeEl(id) {
    const listeners = {}, classes = new Set();
    const el = {
      id, attrs: {}, style: {}, children: [], classes,
      textContent: "", value: "", hidden: false, href: "", className: "",
      classList: {
        add: c => classes.add(c), remove: c => classes.delete(c),
        toggle: (c, f) => { if (f === undefined) f = !classes.has(c); f ? classes.add(c) : classes.delete(c); return f; },
        contains: c => classes.has(c),
      },
      setAttribute(k, v) { el.attrs[k] = String(v); },
      getAttribute(k) { return el.attrs[k]; },
      appendChild(ch) { el.children.push(ch); return ch; },
      addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
      _fire(t, ev) { (listeners[t] || []).forEach(f => f(ev || {})); },
      focus() {}, setPointerCapture() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 504, height: 262 }),
      getTotalLength: () => 350,
      getPointAtLength: () => ({ x: 0, y: 0 }),
    };
    let _html = "";
    Object.defineProperty(el, "innerHTML", { get: () => _html, set(v) { _html = v; if (v === "") el.children.length = 0; } });
    return el;
  }
  const ids = ["map", "q", "sugg", "greet", "tableNo", "tableName", "walkInfo", "seatInfo",
    "replayBtn", "backBtn", "lineBtn", "lineBtnResult", "clearBtn", "viewSearch", "viewResult"];
  const els = {}; ids.forEach(id => els[id] = makeEl(id));
  els.map.attrs.viewBox = "58 245 504 262";
  els.viewSearch.classes.add("view"); els.viewSearch.classes.add("active");
  els.viewResult.classes.add("view");

  const rafQ = [], timers = [], warns = [];
  const sandbox = {
    document: { getElementById: id => els[id] || null, createElementNS: (ns, tag) => makeEl(tag), createElement: tag => makeEl(tag) },
    window: { scrollTo() {} },
    location: { search: "" },
    navigator: {},
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: fn => rafQ.push(fn),
    cancelAnimationFrame: () => {},
    performance: { now: () => Date.now() },
    setTimeout: (fn, ms) => (timers.push(fn), timers.length),
    clearTimeout: id => { if (id) timers[id - 1] = null; },
    URLSearchParams,
    console: { warn: (...a) => warns.push(a.join(" ")), log: () => {}, error: () => {} },
    addEventListener: () => {},
  };
  const pump = () => rafQ.splice(0).forEach(fn => fn()); /* 只跑當下排入的 frame，不追隨後續排程 */

  let api;
  try {
    api = vm.runInNewContext(code + ";({search:search,norm:norm,GUESTS:GUESTS,go:go,handleDeepLink:handleDeepLink})", sandbox, { timeout: 5000 });
    ok(true, "整段 script 在 stub 環境下執行無錯誤");
  } catch (e) { ok(false, "script 執行失敗：" + e.message); process.exit(1); }

  /* 搜尋 */
  const r1 = api.search("Andy");
  ok(r1.length && r1[0].name === "謝曜陽 (Andy)" && r1[0].no === 7, "括號暱稱搜尋：Andy → 謝曜陽 (Andy)・第 7 桌");
  const r2 = api.search("5");
  ok(r2.some(r => r.type === "table" && r.no === 5), "桌號搜尋：5 → 第 5 桌");
  ok(api.search("查無此人zzz").length === 0, "查無資料回傳空陣列");
  const fred = api.GUESTS.find(g => g.name === "張文和 (Fred)");
  ok(fred && fred.seats === 2, "同名重複列＝保留 2 席（張文和 ×2）");

  /* Enter 帶第一筆（target goal：Enter 直接帶位） */
  els.q.value = "謝曜陽"; els.q._fire("keydown", { key: "Enter" }); pump();
  ok(els.viewResult.classes.has("active") && els.tableNo.textContent === "第 7 桌", "Enter → 進入結果頁・第 7 桌");
  ok(els.walkInfo.textContent.includes("公尺"), "正常路線：顯示步行公尺數（" + els.walkInfo.textContent + "）");

  /* 返回搜尋 */
  els.backBtn.onclick();
  ok(els.viewSearch.classes.has("active") && els.q.value === "" && els.clearBtn.hidden === true, "重新搜尋 → 清空輸入、清除鈕隱藏");

  /* 清除按鈕（target goal） */
  els.q.value = "林"; els.q._fire("input");
  ok(els.clearBtn.hidden === false, "輸入後清除鈕顯示");
  ok(els.sugg.children.length > 1, "輸入「林」顯示候選清單（" + (els.sugg.children.length - 1) + " 筆）");
  els.clearBtn.onclick();
  ok(els.q.value === "" && els.clearBtn.hidden === true, "點清除鈕 → 輸入清空、按鈕隱藏");

  /* 自動帶位（輸入完整姓名） */
  els.q.value = "林湘婷"; els.q._fire("input");
  const auto = timers.filter(Boolean).pop();
  ok(!!auto, "完整姓名唯一命中 → 排入自動帶位計時器");
  if (auto) { auto(); pump(); }
  ok(els.viewResult.classes.has("active") && els.tableNo.textContent === "第 2 桌", "自動帶位 → 第 2 桌");
  els.backBtn.onclick();

  /* URL 深連結（target goal） */
  ok(api.handleDeepLink("?q=林湘婷") === true && els.tableNo.textContent === "第 2 桌"
    && els.greet.innerHTML.includes("林湘婷"), "?q=林湘婷 → 直接帶到第 2 桌");
  pump(); els.backBtn.onclick();
  ok(api.handleDeepLink("?t=7") === true && els.tableNo.textContent === "第 7 桌"
    && els.greet.innerHTML.includes("您查詢的是"), "?t=7 → 直接帶到第 7 桌");
  pump(); els.backBtn.onclick();
  ok(api.handleDeepLink("?q=" + encodeURIComponent("陳")) === false && els.q.value === "陳"
    && els.sugg.children.length > 1, "?q=陳（多筆候選）→ 留在搜尋頁並列出清單");
  ok(api.handleDeepLink("?q=絕對查無此人") === false && !els.viewResult.classes.has("active"), "?q=查無此人 → 不誤入結果頁");
  ok(api.handleDeepLink("") === false, "無參數 → 不動作");

  /* 缺座標防呆（target goal）：名單有桌但 GEO 沒座標 → 優雅退場 */
  els.walkInfo.textContent = ""; warns.length = 0;
  api.go({ type: "table", no: 999, tname: "測試桌", name: "第 999 桌" }); pump();
  ok(els.viewResult.classes.has("active") && els.tableNo.textContent === "第 999 桌", "缺座標的桌：結果頁照常顯示桌號");
  ok(els.walkInfo.textContent.includes("服務人員"), "缺座標的桌：顯示請洽服務人員提示（不畫路線、不噴錯）");
  ok(warns.some(w => w.includes("999")), "缺座標的桌：console.warn 提醒維護者");
  ok(els.map.attrs.viewBox === "58 245 504 262", "缺座標的桌：地圖維持全景 viewBox");
}

/* ========== 2. Service Worker 快取邏輯（sw.js） ========== */
console.log("【sw.js 離線快取邏輯】");
(async () => {
  const code = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const handlers = {}, store = new Map();
  const keyOf = req => typeof req === "string" ? req : req.url;
  let netOK = true;
  const netFetch = req => netOK
    ? Promise.resolve({ ok: true, redirected: false, type: "basic", status: 200, url: keyOf(req), clone() { return this; } })
    : Promise.reject(new Error("offline"));
  const cacheObj = {
    add: req => netFetch(req).then(res => store.set(keyOf(req), res)),
    put: (req, res) => (store.set(keyOf(req), res), Promise.resolve()),
    match: req => Promise.resolve(store.get(keyOf(req))),
  };
  const sandbox = {
    self: { addEventListener: (t, f) => handlers[t] = f, skipWaiting: () => Promise.resolve(), clients: { claim: () => Promise.resolve() } },
    caches: { open: () => Promise.resolve(cacheObj), keys: () => Promise.resolve(["seat-v0", "seat-v1"]), delete: k => Promise.resolve(true), match: req => Promise.resolve(store.get(keyOf(req))) },
    fetch: netFetch,
  };
  sandbox.addEventListener = sandbox.self.addEventListener;
  vm.runInNewContext(code, sandbox, { timeout: 2000 });
  ok(handlers.install && handlers.activate && handlers.fetch, "install / activate / fetch 監聽都已註冊");

  let installed; handlers.install({ waitUntil: p => installed = p }); await installed;
  ok(store.has("./index.html"), "install：預快取 ./index.html");

  /* 非 GET 不攔截 */
  let responded = null;
  handlers.fetch({ request: { method: "POST", url: "x", mode: "navigate" }, respondWith: p => responded = p });
  ok(responded === null, "非 GET 請求不攔截");

  /* 線上導航：回網路並更新快取 */
  store.set("./index.html", "舊版");
  responded = null;
  handlers.fetch({ request: { method: "GET", url: "https://x/wedding-seat/?q=test", mode: "navigate" }, respondWith: p => responded = p });
  const onlineRes = await responded;
  ok(onlineRes && onlineRes.ok, "線上導航：回傳網路回應");
  await new Promise(r => setImmediate(r));
  ok(store.get("./index.html") !== "舊版", "線上導航：順手更新快取");

  /* 離線導航（含 ?q= 深連結）：退回快取的 index.html */
  netOK = false; store.set("./index.html", "快取頁");
  responded = null;
  handlers.fetch({ request: { method: "GET", url: "https://x/wedding-seat/?q=深連結", mode: "navigate" }, respondWith: p => responded = p });
  ok(await responded === "快取頁", "離線導航（深連結）：退回快取頁");

  /* 資源：快取優先 */
  store.set("https://fonts.googleapis.com/css2", "字型CSS快取");
  responded = null;
  handlers.fetch({ request: { method: "GET", url: "https://fonts.googleapis.com/css2", mode: "no-cors" }, respondWith: p => responded = p });
  ok(await responded === "字型CSS快取", "靜態資源：快取優先（離線仍可取字型）");

  console.log(`\n${pass} 項通過、${fail} 項失敗`);
  process.exit(fail ? 1 : 0);
})();
