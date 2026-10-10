// 驾驶舱构建脚本（v2 指标体系升级版）：
// 双基准KPI（年度目标/同比/环比动量）、坏账拨备预估、账龄迁徙率、账套记分卡+火花线、
// Top客户双行明细（账龄结构/最老天数/业务员/账套）、智能行动工单、三级预警
// 数据源：jdy-data 本地同步库 → 注入 dashboard-template.html → designs/<COCKPIT_DIR>/index.html
import fs from "node:fs";
import path from "node:path";

const cfg = JSON.parse(fs.readFileSync("jdy-config.json", "utf8"));
const DB = cfg.dashboard || {};
const DATA_DIR = "jdy-data";
const OUT_DIR = path.join("designs", process.env.COCKPIT_DIR || "cockpit");
const excl = cfg.relatedPartyExclusion;
const relNames = excl.companies;

const NOW = new Date();
const pad = (n) => String(n).padStart(2, "0");
const TODAY = `${NOW.getFullYear()}-${pad(NOW.getMonth() + 1)}-${pad(NOW.getDate())}`;
const dISO = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
const D90 = dISO(new Date(NOW - 90 * 86400000));
const D30 = dISO(new Date(NOW - 30 * 86400000));
const M12 = dISO(new Date(NOW.getFullYear(), NOW.getMonth() - 11, 1));
const YTD = `${NOW.getFullYear()}-01-01`;
const LAST_Y = NOW.getFullYear() - 1;
const RECENT_FROM = `${LAST_Y}-01-01`;

const readJsonl = (f) => { try { return fs.readFileSync(path.join(DATA_DIR, f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const readSnap = (f) => { try { return Object.values(JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8")).docs || {}); } catch { return []; } };

// ---------- 加载与口径标记 ----------
const AC = {};
for (const acct of cfg.accounts) {
  const relIds = new Set((excl.matchedCustomerIds[acct.outerInstanceId] || []).map((m) => m.id));
  const isRel = (r) => relIds.has(r.customer_id) || relNames.includes(r.customer_name || "");
  AC[acct.shortName] = {
    meta: acct,
    sales: readJsonl(`${acct.shortName}-sales.jsonl`).map((r) => ({ date: r.bill_date, amount: +r.total_amount || 0, cust: r.customer_name, emp: r.emp_name || "", rel: isRel(r) })),
    returns: readJsonl(`${acct.shortName}-returns.jsonl`).map((r) => ({ date: r.bill_date, amount: +r.amount || 0, cust: r.customer_name, emp: r.emp_name || "", rel: isRel(r) })),
    receipts: readJsonl(`${acct.shortName}-receipts.jsonl`).map((r) => ({ date: r.bill_date, amount: +r.total_amount || 0, cust: r.customer_name, emp: r.emp_name || "", rel: isRel(r) })),
    openDocs: readSnap(`${acct.shortName}-openDocs.json`).map((r) => ({ ...r, rel: isRel(r) })),
  };
}
const all = (k) => Object.values(AC).flatMap((a) => a[k]);
const netSalesIn = (from, to = TODAY) => all("sales").filter((r) => !r.rel && r.date >= from && r.date <= to).reduce((s, r) => s + r.amount, 0)
  - all("returns").filter((r) => !r.rel && r.date >= from && r.date <= to).reduce((s, r) => s + r.amount, 0);
const bookSalesIn = (from, to = TODAY) => all("sales").filter((r) => r.date >= from && r.date <= to).reduce((s, r) => s + r.amount, 0)
  - all("returns").filter((r) => r.date >= from && r.date <= to).reduce((s, r) => s + r.amount, 0);
const receiptsIn = (from, to = TODAY) => all("receipts").filter((r) => !r.rel && r.date >= from && r.date <= to).reduce((s, r) => s + r.amount, 0);

// ---------- 账龄/超期分桶 + 坏账预估 ----------
const dayDiff = (d) => Math.round((new Date(TODAY) - new Date(d)) / 86400000);
const AGE_L = ["0-30天", "31-60天", "61-90天", "91-180天", "180天+"];
const OD_L = ["未到期", "超期1-30天", "超期31-90天", "超期91-180天", "超期180天+"];
const bucketOf = (d, edges) => (d <= edges[0] ? 0 : d <= edges[1] ? 1 : d <= edges[2] ? 2 : d <= edges[3] ? 3 : 4);
const ageVals = [0, 0, 0, 0, 0], odVals = [0, 0, 0, 0, 0];
let netAR = 0, bookAR = 0, od180 = 0, openDocsCount = 0, bd365 = 0, bd180 = 0, oldestDays = 0;
for (const d of all("openDocs")) {
  bookAR += +d.un_settle || 0;
  if (d.rel) continue;
  const amt = +d.un_settle || 0, age = dayDiff(d.bill_date);
  netAR += amt; openDocsCount++;
  ageVals[bucketOf(age, [30, 60, 90, 180])] += amt;
  odVals[d.due_date ? bucketOf(dayDiff(d.due_date), [0, 30, 90, 180]) : 3] += amt;
  if (age > 180) { od180 += amt; if (age > 365) bd365 += amt; else bd180 += amt; }
  if (age > oldestDays) oldestDays = age;
}
const rollAmt = ageVals[3]; // 91-180天段：未来90天将滑入180天+
const badDebtEst = Math.round(bd365 * 0.5 + bd180 * 0.2); // 坏账拨备预估：180-365天×20% + 365天+×50%

// ---------- KPI（双基准） ----------
const sales90 = netSalesIn(D90), sales30 = netSalesIn(D30), receipts30 = receiptsIn(D30);
const r12Sales = netSalesIn(M12), r12Receipts = receiptsIn(M12), r12Ratio = r12Sales > 0 ? r12Receipts / r12Sales : 0;
const annualTarget = +DB.annualTargetNetSales || 67000000, receiptTarget = +DB.targetReceiptRatio || 0.7;
const netSalesYTD = netSalesIn(YTD), bookSalesYTD = bookSalesIn(YTD);
const netSalesLYTD = netSalesIn(`${LAST_Y}-01-01`, dISO(new Date(LAST_Y, NOW.getMonth(), NOW.getDate())));
const yoyDelta = netSalesLYTD > 0 ? netSalesYTD / netSalesLYTD - 1 : null;
const dayOfYear = Math.floor((NOW - new Date(NOW.getFullYear(), 0, 0)) / 86400000);
const timeProgress = dayOfYear / ((NOW.getFullYear() % 4 === 0 && (NOW.getFullYear() % 100 !== 0 || NOW.getFullYear() % 400 === 0)) ? 366 : 365);
const achRate = netSalesYTD / annualTarget;
const arDelta30 = sales30 - receipts30; // 近30天应收净增（销售-回款）
const arSalesShare = netSalesYTD > 0 ? netAR / netSalesYTD : 0;

// ---------- 月度趋势 ----------
const trend = [];
{
  const from = new Date(LAST_Y, 0, 1), cur = new Date(NOW.getFullYear(), NOW.getMonth(), 1);
  for (let d = new Date(from); d <= cur; d.setMonth(d.getMonth() + 1)) {
    const ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const s = netSalesIn(`${ym}-01`, `${ym}-31`), r = receiptsIn(`${ym}-01`, `${ym}-31`);
    trend.push({ ym, sales: Math.round(s), receipts: Math.round(r), ratio: s > 0 ? r / s : 0, partial: ym === `${NOW.getFullYear()}-${pad(NOW.getMonth() + 1)}` });
  }
}

// ---------- 账套（记分卡 + 火花线） ----------
const accounts = cfg.accounts.map((a) => {
  const x = AC[a.shortName];
  const s90 = x.sales.filter((r) => !r.rel && r.date >= D90).reduce((s, r) => s + r.amount, 0)
    - x.returns.filter((r) => !r.rel && r.date >= D90).reduce((s, r) => s + r.amount, 0);
  const s30 = x.sales.filter((r) => !r.rel && r.date >= D30).reduce((s, r) => s + r.amount, 0)
    - x.returns.filter((r) => !r.rel && r.date >= D30).reduce((s, r) => s + r.amount, 0);
  const r30 = x.receipts.filter((r) => !r.rel && r.date >= D30).reduce((s, r) => s + r.amount, 0);
  const ar = x.openDocs.filter((d) => !d.rel).reduce((s, d) => s + (+d.un_settle || 0), 0);
  const od1 = x.openDocs.filter((d) => !d.rel && d.due_date && dayDiff(d.due_date) > 180).reduce((s, d) => s + (+d.un_settle || 0), 0);
  const ytd = x.sales.filter((r) => !r.rel && r.date >= YTD).reduce((s, r) => s + r.amount, 0)
    - x.returns.filter((r) => !r.rel && r.date >= YTD).reduce((s, r) => s + r.amount, 0);
  const spark = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(NOW.getFullYear(), NOW.getMonth() - i, 1), ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    spark.push(Math.round(x.sales.filter((r) => !r.rel && r.date.startsWith(ym)).reduce((s, r) => s + r.amount, 0)
      - x.returns.filter((r) => !r.rel && r.date.startsWith(ym)).reduce((s, r) => s + r.amount, 0)));
  }
  const share = ar > 0 ? od1 / ar : 0;
  const verdict = ar <= 1000 ? "正常运转" : s90 <= 0 ? "风险清算" : share >= 0.5 ? "重点管控" : ytd / Math.max(1, netSalesYTD) > 0.5 ? "核心增长" : "正常运转";
  return { short: a.shortName, name: a.name, verdict, netSalesYTD: ytd, netSales2025: 0, netAR: ar, od180: od1, od180Share: share,
    dso: s90 > 0 ? ar / (s90 / 90) : null, sales90: s90, arDelta30: s30 - r30, spark };
});

// ---------- Top 客户（双行明细，含账套归属） ----------
const custAR = {};
for (const [short, a] of Object.entries(AC)) for (const d of a.openDocs) {
  if (d.rel) continue;
  const c = (custAR[d.customer_name] ??= { ar: 0, docs: 0, ar180: 0, oldest: 0, accts: new Set(), emps: {} });
  const amt = +d.un_settle || 0, age = dayDiff(d.bill_date);
  c.ar += amt; c.docs++;
  if (age > 180) c.ar180 += amt;
  if (age > c.oldest) c.oldest = age;
  c.accts.add(short);
  const emp = d.emp_name || "";
  if (emp) c.emps[emp] = (c.emps[emp] || 0) + amt;
}
const topARFull = Object.entries(custAR).map(([name, c]) => {
  const emp = Object.entries(c.emps).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  return { name, ar: Math.round(c.ar), docs: c.docs, ar180: Math.round(c.ar180), ar180Share: c.ar > 0 ? c.ar180 / c.ar : 0,
    oldestDays: c.oldest, accts: [...c.accts].filter(Boolean).join("/"), emp,
    share: +(c.ar / netAR * 100).toFixed(1) };
}).sort((a, b) => b.ar - a.ar);
const topAR = topARFull.slice(0, 12);

const topSmap = {};
for (const s of all("sales")) if (!s.rel && s.date >= RECENT_FROM) topSmap[s.cust] = (topSmap[s.cust] || 0) + s.amount;
for (const r of all("returns")) if (!r.rel && r.date >= RECENT_FROM) topSmap[r.cust] = (topSmap[r.cust] || 0) - r.amount;
const totalRecent = Object.values(topSmap).reduce((s, v) => s + v, 0);
const topSales = Object.entries(topSmap).filter(([n]) => n && n !== "null").map(([name, v]) => ({ name, net: Math.round(v), share: +(v / totalRecent * 100).toFixed(1) }))
  .sort((a, b) => b.net - a.net).slice(0, 10);

// ---------- 业务员 ----------
const empMap = {};
for (const s of all("sales")) if (!s.rel && s.emp && s.date >= M12) (empMap[s.emp] ??= { sales: 0, receipts: 0, accts: new Set() }).sales += s.amount;
for (const r of all("returns")) if (!r.rel && r.emp && r.date >= M12) if (empMap[r.emp]) empMap[r.emp].sales -= r.amount;
for (const r of all("receipts")) if (!r.rel && r.emp && r.date >= M12) (empMap[r.emp] ??= { sales: 0, receipts: 0, accts: new Set() }).receipts += r.amount;
for (const [short, a] of Object.entries(AC)) for (const k of ["sales", "receipts"]) for (const r of a[k]) if (r.emp && empMap[r.emp]) empMap[r.emp].accts.add(short);
const emps = Object.entries(empMap).filter(([, v]) => v.receipts > 0 || v.sales > 0)
  .map(([name, v]) => ({ name, sales: Math.round(v.sales), receipts: Math.round(v.receipts), ratio: v.sales > 0 ? v.receipts / v.sales : 1, accts: [...v.accts].join("/") }))
  .sort((a, b) => b.receipts - a.receipts).slice(0, 12);

// ---------- 三级预警 ----------
const W = (n) => (n / 1e4).toFixed(0) + "万";
const pct = (x) => Math.round(x * 100) + "%";
const alerts = [];
for (const a of accounts) if (a.netAR > 500000 && (a.od180Share >= 0.8 || a.sales90 <= 0))
  alerts.push({ level: "red", text: `「${a.short}」净应收 ${W(a.netAR)}，${pct(a.od180Share)} 超期180天+${a.sales90 <= 0 ? "，且近90天净销售为负（业务停滞）" : ""}` });
if (topAR[0] && topAR[0].docs >= 40) alerts.push({ level: "yellow", text: `「${truncN(topAR[0].name)}」未收 ${W(topAR[0].ar)} 分散在 ${topAR[0].docs} 张单据，账龄结构碎片化` });
if (r12Ratio < receiptTarget) alerts.push({ level: "blue", text: `近12个月回款/销售比 ${pct(r12Ratio)}，低于目标基准 ${pct(receiptTarget)}，回款节奏持续滞后` });
function truncN(s) { return s && s.length > 14 ? s.slice(0, 14) + "…" : s; }

// ---------- 智能行动中心（工单） ----------
const actions = [];
const stalled = accounts.find((a) => a.sales90 <= 0 && a.netAR > 500000);
if (stalled) actions.push({ p: "P1", type: "冻结授信", target: stalled.name, acct: stalled.short, amount: Math.round(stalled.od180), docs: null, days: null,
  owner: "财务负责人", advice: `销售停滞且超期占比${pct(stalled.od180Share)}：冻结新增赊销额度，存量未收移交专项清收组/法务评估` });
for (const c of topARFull.filter((c) => c.ar180 > 300000).slice(0, 3))
  actions.push({ p: c.ar180 > 1000000 ? "P1" : "P2", type: "催收工单", target: c.name, acct: c.accts, amount: c.ar180, docs: c.docs, days: c.oldestDays,
    owner: c.emp || "销售负责人", advice: `老账占比${pct(c.ar180Share)}（最长${c.oldestDays}天）：7日内完成对账确认，制定分期回款计划` });
const frag = topARFull.find((c) => c.docs >= 40);
if (frag) actions.push({ p: "P2", type: "对账核销", target: frag.name, acct: frag.accts, amount: frag.ar, docs: frag.docs, days: frag.oldestDays,
  owner: frag.emp || "销售负责人", advice: `${frag.docs}张碎片单据：推送逐单核销清单，推动按月合并结算` });
if (r12Ratio < receiptTarget) actions.push({ p: "P3", type: "机制优化", target: "回款考核", acct: "集团", amount: null, docs: null, days: null,
  owner: "管理层", advice: `回款率纳入业务员月度绩效并与提成挂钩；当月开票当月推送对账单，缩短对账周期` });

// ---------- 图表洞察 ----------
const topSalesAcct = [...accounts].sort((a, b) => b.netSalesYTD - a.netSalesYTD)[0];
const riskAcct = [...accounts].filter((a) => a.netAR > 100000).sort((a, b) => b.od180Share - a.od180Share)[0];
const lowEmp = emps.filter((e) => e.sales >= 300000).sort((a, b) => a.ratio - b.ratio)[0];
const insights = {
  trend: {
    an: `近12个月净销售 <b>${W(r12Sales)}</b>、净回款 <b>${W(r12Receipts)}</b>，回款比 <b class="${r12Ratio < 0.45 ? "a" : "g"}">${pct(r12Ratio)}</b>（基准${pct(receiptTarget)}）；${NOW.getFullYear()} YTD <b class="s">${W(netSalesYTD)}</b>${yoyDelta == null ? "" : `，同比${yoyDelta >= 0 ? "增长" : "下滑"} <b class="${yoyDelta >= 0 ? "g" : "r"}">${Math.abs(Math.round(yoyDelta * 100))}%</b>`}。`,
    ad: `回款比低于50%预警线即应收滚动沉淀，建议按参考线逐月复盘：50%以下黄色预警、恢复80%视为健康。`,
  },
  aging: {
    an: `净应收 <b>${W(netAR)}</b> 中超期180天+ <b class="r">${W(od180)}（${pct(netAR > 0 ? od180 / netAR : 0)}）</b>，预估坏账拨备 <b class="r">${W(badDebtEst)}</b>（180-365天${W(bd180)}×20% + 365天+${W(bd365)}×50%）；<b class="a">迁徙提示：91-180天段 ${W(rollAmt)} 将于未来90天滑入180天+</b>。`,
    ad: `按梯级预警色推进：180天+专项清收并计提评估；91-180天段（${W(rollAmt)}）是阻止坏账扩大的最后窗口，优先跟进。`,
  },
  accts: {
    an: `${topSalesAcct.short} 贡献集团 YTD 净销售 <b class="s">${pct(topSalesAcct.netSalesYTD / Math.max(1, netSalesYTD))}</b>${riskAcct && riskAcct.od180Share >= 0.3 ? `；${riskAcct.short} 超期占比 <b class="r">${pct(riskAcct.od180Share)}</b> 为最大风险源` : ""}${stalled ? `；${stalled.short} 业务停滞仍有 ${W(stalled.netAR)} 未收` : ""}。`,
    ad: `授信与资源向「核心增长」倾斜；「风险清算」实体冻结额度、只清收不新增；「正常运转」维持现款现货节奏。`,
  },
  topAR: {
    an: topAR[0] ? `Top10 占净应收 <b class="a">${Math.round(topAR.slice(0, 10).reduce((s, c) => s + c.share, 0))}%</b>；${truncN(topAR[0].name)} ${W(topAR[0].ar)} 居首，其中180天+老账 ${W(topAR[0].ar180)}。` : "",
    ad: `优先处置"老化严重"标签客户；碎片单据客户推动合并对账，一次核销多张单。`,
  },
  topSales: {
    an: topSales[0] ? `第一大客户 ${truncN(topSales[0].name)} 占近期净销售 <b class="s">${topSales[0].share}%</b>，Top5 合计 ${topSales.slice(0, 5).reduce((s, c) => s + c.share, 0).toFixed(1)}%。` : "",
    ad: `集中度尚可，但需跟踪 Top 客户采购计划与回款条款变化，防单一客户波动冲击。`,
  },
  emps: {
    an: emps[0] ? `${emps[0].name} 近12月回款 <b class="s">${W(emps[0].receipts)}</b> 领跑${lowEmp ? `；${lowEmp.name} 回款比仅 <b class="r">${pct(lowEmp.ratio)}</b> 需干预` : ""}。` : "",
    ad: `回款比低于40%暂停新单赊销审批；标杆人员的对账节奏（周对账/月清账）团队内复制。`,
  },
};

// ---------- 汇总 ----------
const state = JSON.parse(fs.readFileSync("jdy-sync-state.json", "utf8"));
const data = {
  builtAt: NOW.toISOString().slice(0, 19).replace("T", " "),
  syncedAt: state.lastRun ? new Date(state.lastRun.at).toISOString().slice(0, 19).replace("T", " ") : "—",
  today: TODAY, ageMode: "age", netAR: Math.round(netAR), view: "m12",
  kpis: {
    netSalesYTD: Math.round(netSalesYTD), bookSalesYTD: Math.round(bookSalesYTD), internalSalesYTD: Math.round(bookSalesYTD - netSalesYTD),
    annualTarget, achRate, timeProgress, yoyDelta,
    netAR: Math.round(netAR), bookAR: Math.round(bookAR), internalAR: Math.round(bookAR - netAR),
    arSalesShare, arDelta30,
    od180: Math.round(od180), od180Share: netAR > 0 ? od180 / netAR : 0, badDebtEst, badDebtDetail: { d180: Math.round(bd180), d365: Math.round(bd365) },
    r12Sales: Math.round(r12Sales), r12Receipts: Math.round(r12Receipts), r12Ratio, receiptTarget, receiptGap: receiptTarget - r12Ratio,
    dso: sales90 > 0 ? netAR / (sales90 / 90) : null,
    dsoExStalled: (() => { const live = accounts.filter((a) => a.sales90 > 0);
      const ar = live.reduce((s, a) => s + a.netAR, 0), s = live.reduce((s, a) => s + a.sales90, 0);
      return s > 0 ? ar / (s / 90) : null; })(),
    openDocs: openDocsCount, oldestDays,
  },
  alerts, trend,
  ageBuckets: { labels: AGE_L, values: ageVals.map(Math.round) },
  overdueBuckets: { labels: OD_L, values: odVals.map(Math.round) },
  rollAmt: Math.round(rollAmt),
  accounts, topAR, topSales, emps, insights, actions,
};

// ---------- 注入模板 ----------
const MASK = process.argv.includes("--mask");
const OUT_FILE = MASK ? "index-masked.html" : "index.html";
let dataJson = JSON.stringify(data);
if (MASK) {
  // 脱敏映射：账套→主体A-D，客户（按未收排名）→客户A-Z，业务员（按回款排名）→业务员01+
  const map = new Map();
  const AZ = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  accounts.forEach((a, i) => { map.set(a.name, `某医疗器械集团（主体${AZ[i]}）`); map.set(a.short, `主体${AZ[i]}`); });
  if (DB.title) { const group = DB.title.split(" · ")[0]; if (group && group.length >= 2) map.set(group, "某医疗器械集团"); }
  topARFull.slice(0, 26).forEach((c, i) => map.set(c.name, `客户${AZ[i]}`));
  topSales.forEach((c) => { if (!map.has(c.name) && map.size < 40) map.set(c.name, `客户${AZ[map.size - 8] ?? "Z"}`); });
  emps.forEach((e, i) => map.set(e.name, `业务员${String(i + 1).padStart(2, "0")}`));
  // 长名优先替换，避免子串误伤
  for (const [k, v] of [...map.entries()].sort((a, b) => b[0].length - a[0].length)) dataJson = dataJson.split(k).join(v);
}
const echartsSrc = fs.readFileSync(path.join(OUT_DIR, "echarts.min.js"), "utf8");
let tpl = fs.readFileSync("dashboard-template.html", "utf8");
tpl = tpl.replace(/__TITLE__/g, MASK ? "医疗器械集团 · 经营数据驾驶舱（脱敏演示版）" : DB.title || "集团 · 经营数据驾驶舱");
const html = tpl.replace("__ECHARTS__", () => echartsSrc).replace("__DATA__", () => dataJson.replace(/<\//g, "<\\/"));
fs.writeFileSync(path.join(OUT_DIR, OUT_FILE), html, "utf8");
console.log(`构建完成 → ${path.join(OUT_DIR, OUT_FILE)}${MASK ? " [脱敏版]" : ""} (${(html.length / 1024 / 1024).toFixed(2)} MB)`);
if (MASK) {
  const group = DB.title ? DB.title.split(" · ")[0] : "";
  const leaks = [...accounts.flatMap((a) => [a.name, a.short]), ...(group && group.length >= 2 ? [group] : []), ...topARFull.slice(0, 26).map((c) => c.name), ...emps.map((e) => e.name)]
    .filter((n) => n && n.length >= 2 && html.includes(n));
  console.log(`脱敏泄漏检查: ${leaks.length === 0 ? "通过（0 个真实名称残留）" : "!!! 泄漏: " + leaks.join("、")}`);
  process.exit(leaks.length ? 1 : 0);
}
console.log(`核验: 净销售YTD ${W(netSalesYTD)}(达成${pct(achRate)}/时间${pct(timeProgress)} 同比${yoyDelta == null ? "-" : pct(yoyDelta)}) | 净应收 ${W(netAR)} | 坏账预估 ${W(badDebtEst)} | 迁徙 ${W(rollAmt)} | 预警${alerts.length} 工单${actions.length}`);
