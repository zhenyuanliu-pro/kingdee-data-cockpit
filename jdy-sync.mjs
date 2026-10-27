// 金蝶数据同步引擎（固化为可定时运行的同步任务）
// - token 生命周期：缓存23h，过期自动 主动获取授权(最新appSecret)→换app-token
// - 增量：按 modify_start_time/modify_end_time 窗口（带5分钟重叠防边界丢失），按 id upsert
// - 未结清单据（账龄源）：快照替换 + 明细差异拉取（只对新增单据调详情）
// 数据落库：jdy-data/<账套>-<类型>.jsonl
// 用法：node jdy-sync.mjs          → 增量（默认，可挂 Windows 计划任务/cron）
//       node jdy-sync.mjs full     → 全量重建
import fs from "node:fs";
import path from "node:path";
import { loadConfig, getAuthorization, getAppToken, callApi } from "./jdy-client.mjs";

const cfg = loadConfig();
const DATA_DIR = "jdy-data";
const STATE_FILE = "jdy-sync-state.json";
const TOKEN_FILE = "jdy-token-cache.json";
const OVERLAP_MS = 5 * 60_000;

fs.mkdirSync(DATA_DIR, { recursive: true });
const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : { accounts: {} };
const tokenCache = fs.existsSync(TOKEN_FILE) ? JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8")) : { entries: {} };

// token 生命周期管理：appSecret 24h 刷新 → 每次运行先取最新授权，再按需换 token
// 容灾：授权查询失败时，回退用 20h 内缓存过的 appKey/appSecret（实例ID失效/接口抖动不阻断同步）
async function ensureCtx(acct) {
  let auth = null;
  try {
    auth = await getAuthorization(cfg, acct.outerInstanceId);
  } catch (e) {
    const c = tokenCache.auths?.[acct.outerInstanceId];
    if (c && c.fetchedAt > Date.now() - 20 * 3600_000) {
      console.log(`  [容灾] 授权查询失败，改用 ${new Date(c.fetchedAt).toLocaleString()} 缓存的 appKey/appSecret`);
      auth = { appKey: c.appKey, appSecret: c.appSecret, domain: c.domain };
    } else throw e;
  }
  tokenCache.auths ??= {};
  tokenCache.auths[acct.outerInstanceId] = { ...auth, fetchedAt: Date.now() };
  let e = tokenCache.entries[auth.appKey];
  if (!e || !e.expiresAt || e.expiresAt < Date.now() + 60_000) {
    const token = await getAppToken(cfg, { appKey: auth.appKey, appSecret: auth.appSecret });
    e = { token, expiresAt: Date.now() + 23 * 3600_000 };
    tokenCache.entries[auth.appKey] = e;
  }
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokenCache, null, 2), "utf8");
  return { appToken: e.token, routerAddr: auth.domain };
}

async function paged(ctx, apiPath, params, onPage) {
  let page = 1, totalPages = 1;
  do {
    const r = await callApi(cfg, { ...ctx, method: "GET", path: apiPath,
      params: { ...params, page: String(page), page_size: "100" } });
    if (r.json.errcode !== 0) throw new Error(`${apiPath} 第${page}页失败: ${JSON.stringify(r.json).slice(0, 150)}`);
    totalPages = +r.json.data.total_page;
    onPage(r.json.data.rows || []);
    page++;
  } while (page <= totalPages);
}

const dataFile = (acctShort, type) => path.join(DATA_DIR, `${acctShort}-${type}.jsonl`);
function loadStore(acct, type) {
  try {
    return new Map(fs.readFileSync(dataFile(acct, type), "utf8").trim().split("\n").filter(Boolean)
      .map((l) => { const o = JSON.parse(l); return [o.id, o]; }));
  } catch { return new Map(); }
}
function saveStore(acct, type, map) {
  const arr = [...map.values()].sort((a, b) =>
    String(a.bill_date || a.create_time || "").localeCompare(String(b.bill_date || b.create_time || "")));
  fs.writeFileSync(dataFile(acct, type), arr.map((o) => JSON.stringify(o)).join("\n") + "\n", "utf8");
}

// 常规类型：列表接口 + 修改时间窗口
const TYPES = {
  customers: { path: "/jdy/v2/bd/customer" },
  sales:     { path: "/jdy/v2/scm/sal_out_bound" },
  returns:   { path: "/jdy/v2/scm/sal_in_bound", detailPath: "/jdy/v2/scm/sal_in_bound_detail" }, // 列表无金额，详情补
  receipts:  { path: "/jdy/v2/arap/ar_credit" },
};

const mode = process.argv[2] === "full" ? "full" : "incr";
const now = Date.now();
let totalCalls = 0;
const origCallApi = callApi; // 统计调用量（监控限流余量）

const failed = [];
for (const acct of cfg.accounts) {
  const st = (state.accounts[acct.shortName] ??= {});
  let ctx;
  try {
    ctx = await ensureCtx(acct);
  } catch (e) {
    failed.push(acct.shortName);
    console.log(`\n[${acct.shortName}] !!! 授权失败，本轮跳过（其余账套继续）: ${e.message.slice(0, 140)}`);
    continue;
  }
  console.log(`\n[${acct.shortName}] ${mode === "full" ? "全量" : "增量"}同步...`);

  for (const [type, def] of Object.entries(TYPES)) {
    const last = st[type]?.lastSyncAt;
    const params = mode === "incr" && last
      ? { modify_start_time: String(Math.max(0, last - OVERLAP_MS)), modify_end_time: String(now) }
      : {};
    const store = loadStore(acct.shortName, type);
    const before = store.size;
    let changed = 0;
    await paged(ctx, def.path, params, (rows) => {
      for (const row of rows) { store.set(row.id, { ...store.get(row.id), ...row }); changed++; }
    });
    if (def.detailPath) { // 退货：无金额的行逐单补详情
      for (const row of store.values()) {
        if (row.amount == null) {
          try {
            const d = await callApi(cfg, { ...ctx, method: "GET", path: def.detailPath, params: { id: row.id } });
            totalCalls++;
            if (d.json.errcode === 0) row.amount = +d.json.data.total_amount || 0;
          } catch { /* 下轮重试 */ }
        }
      }
    }
    saveStore(acct.shortName, type, store);
    st[type] = { lastSyncAt: now };
    console.log(`  ${type}: 变更 ${changed}，库内 ${store.size}（此前 ${before}）`);
  }

  // 未结清单据（账龄数据源）：当前快照 + 明细差异
  const snapFile = path.join(DATA_DIR, `${acct.shortName}-openDocs.json`);
  let oldSnap = { docs: {} };
  try { oldSnap = JSON.parse(fs.readFileSync(snapFile, "utf8")); } catch {}
  const openIds = new Set();
  await paged(ctx, "/jdy/v2/scm/sal_out_bound", { filter_zero: "totalunsettleamount" }, (rows) => rows.forEach((r) => openIds.add(r.id)));
  const newDocs = {}; let detailCalls = 0;
  for (const id of openIds) {
    if (oldSnap.docs?.[id]) { newDocs[id] = oldSnap.docs[id]; continue; }
    const d = await callApi(cfg, { ...ctx, method: "GET", path: "/jdy/v2/scm/sal_out_bound_detail", params: { id } });
    detailCalls++; totalCalls++;
    if (d.json.errcode === 0) {
      const x = d.json.data;
      newDocs[id] = { id, bill_no: x.bill_no, bill_date: x.bill_date, due_date: x.due_date || null,
        term: x.setting_term_name || null, customer_id: x.customer_id, customer_name: x.customer_name,
        emp_name: x.emp_name || null, total_amount: +x.total_amount, un_settle: +x.total_un_settle_amount };
    }
  }
  const settled = Object.keys(oldSnap.docs || {}).filter((id) => !openIds.has(id));
  fs.writeFileSync(snapFile, JSON.stringify({ syncedAt: now, docs: newDocs }), "utf8");
  st.openDocs = { lastSyncAt: now };
  console.log(`  openDocs: 当前未结清 ${openIds.size} 单（新取详情 ${detailCalls}，本期结清 ${settled.length}）`);
}

state.lastRun = { mode, at: now, totalCalls, failed };
fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
if (failed.length) {
  console.log(`\n同步完成，但以下账套本轮未同步（数据停留在上次成功时点）: ${failed.join("、")}`);
  console.log(`恢复方法：在金蝶开放平台重新授权该账套应用，用新的第三方实例ID更新 jdy-config.json`);
  if (failed.length === cfg.accounts.length) process.exit(1);
} else {
  console.log(`\n同步完成（API调用约 ${totalCalls} 次，限流500次/分/账套），状态 → ${STATE_FILE}`);
}
