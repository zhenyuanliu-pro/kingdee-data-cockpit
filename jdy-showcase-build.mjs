// 作品展示页构建 v2（高清+交互版）：
// 深色英雄区+浏览器框展示、滚动进度条、入场动画、数字滚动、
// 可交互「口径引擎」演示（账面/净额切换，亲眼看86%虚增被抵销）、卡片悬浮反馈
// 用法：node jdy-showcase-build.mjs [--mask]
import fs from "node:fs";
import path from "node:path";

const MASK = process.argv.includes("--mask");
const OUT = MASK ? "作品展示-脱敏.html" : "作品展示.html";
const PRE = MASK ? "masked" : "cockpit";
const DIR = path.join("designs", process.env.COCKPIT_DIR || "cockpit");
const hero = fs.readFileSync(path.join(DIR, `${PRE}-hero.png`)).toString("base64");
const full = fs.readFileSync(path.join(DIR, `${PRE}-full.png`)).toString("base64");

// ---- 真实数字 ----
const readJsonl = (f) => { try { return fs.readFileSync(path.join("jdy-data", f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const cfg = JSON.parse(fs.readFileSync("jdy-config.json", "utf8"));
const accts = cfg.accounts.map((a) => a.shortName);
const TODAY = new Date();
const dayDiff = (d) => Math.round((TODAY - new Date(d)) / 86400000);
const relNames = cfg.relatedPartyExclusion.companies;
const acctCfg = Object.fromEntries(cfg.accounts.map((a) => [a.shortName, a]));
const isRel = (short, d) => {
  const relIds = new Set((cfg.relatedPartyExclusion.matchedCustomerIds[acctCfg[short].outerInstanceId] || []).map((m) => m.id));
  return relIds.has(d.customer_id) || relNames.includes(d.customer_name || "");
};
let docs = 0, internalAR = 0, bookAR = 0, netAR = 0, oldest = 0, openCnt = 0, bookSales = 0, netSales = 0;
const YTD = `${TODAY.getFullYear()}-`;
const T0 = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, "0")}-${String(TODAY.getDate()).padStart(2, "0")}`; // YTD 上限=今天，与驾驶舱口径一致（排除未来日期单据）
for (const a of accts) {
  for (const r of readJsonl(`${a}-sales.jsonl`)) { docs++; if (r.bill_date >= YTD && r.bill_date <= T0) { bookSales += +r.total_amount || 0; if (!isRel(a, r)) netSales += +r.total_amount || 0; } }
  for (const r of readJsonl(`${a}-returns.jsonl`)) { docs++; if (r.bill_date >= YTD && r.bill_date <= T0) { const amt = +r.amount || 0; bookSales -= amt; if (!isRel(a, r)) netSales -= amt; } }
  docs += readJsonl(`${a}-receipts.jsonl`).length;
  let snap = {};
  try { snap = JSON.parse(fs.readFileSync(path.join("jdy-data", `${a}-openDocs.json`), "utf8")).docs || {}; } catch {}
  for (const d of Object.values(snap)) {
    bookAR += +d.un_settle || 0;
    if (isRel(a, d)) internalAR += +d.un_settle || 0;
    else { netAR += +d.un_settle || 0; openCnt++; const age = dayDiff(d.bill_date); if (age > oldest) oldest = age; }
  }
}
const internalPct = Math.round(internalAR / bookAR * 100);
const today = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, "0")}-${String(TODAY.getDate()).padStart(2, "0")}`;
const fmtW = (n) => { const w = n / 1e4; return (w >= 10000 ? (w / 10000).toFixed(2) + "亿" : Math.round(w).toLocaleString("zh-CN") + "万"); };

const S = { docsWan: +(docs / 10000).toFixed(1), internalPct, oldest, bookAR, netAR, bookSales, netSales };

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>作品展示 · 医疗器械集团经营数据驾驶舱${MASK ? "（脱敏版）" : ""}</title>
<style>
  :root{--ink:#111827;--sub:#4b5563;--faint:#8b95a7;--bg:#f5f6f8;--card:#fff;--line:#e5e8ee;--blue:#0e7490;--teal:#0d9488;--red:#b91c1c;--amber:#b45309;--dark:#0a1120}
  *{box-sizing:border-box;margin:0;padding:0}
  html{scroll-behavior:smooth}
  body{background:var(--bg);color:var(--ink);font-family:-apple-system,"SF Pro Text","Segoe UI","PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;font-variant-numeric:tabular-nums;line-height:1.7;overflow-x:hidden}
  .progress{position:fixed;top:0;left:0;right:0;height:3px;z-index:99;background:transparent}
  .progress i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--teal),var(--blue))}
  .wrap{max-width:1100px;margin:0 auto;padding:0 28px}

  /* 英雄区（深色） */
  .hero{background:var(--dark);color:#e8eef9;padding:64px 0 88px;position:relative;overflow:hidden}
  .hero::before{content:"";position:absolute;inset:0;
    background-image:linear-gradient(rgba(148,163,184,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,.05) 1px,transparent 1px);
    background-size:44px 44px;pointer-events:none}
  .hero::after{content:"";position:absolute;top:-220px;right:-160px;width:560px;height:560px;border-radius:50%;
    background:radial-gradient(closest-side,rgba(45,212,191,.13),transparent);pointer-events:none}
  .hero .wrap{position:relative;z-index:1}
  .badge{display:inline-flex;align-items:center;gap:8px;font-size:12px;letter-spacing:4px;color:#5eead4;
    border:1px solid rgba(94,234,212,.35);padding:5px 16px;border-radius:999px;margin-bottom:22px}
  .badge::before{content:"";width:6px;height:6px;border-radius:50%;background:#5eead4}
  h1{font-size:clamp(28px,4.6vw,44px);font-weight:800;letter-spacing:1px;line-height:1.25}
  .pitch{margin-top:16px;font-size:16px;color:#9db0c9;max-width:860px;line-height:1.85}
  .pitch b{color:#e8eef9;font-weight:650}
  .pills{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:30px 0 44px}
  .pill{border:1px solid rgba(148,163,184,.18);background:rgba(148,163,184,.06);border-radius:14px;padding:16px 18px}
  .pill .v{font-size:28px;font-weight:800;color:#5eead4}
  .pill .v.x2{color:#fbbf24}.pill .v.x3{color:#f87171}.pill .v.x4{color:#7dd3fc}
  .pill .v small{font-size:13px;font-weight:600;color:#7c8ba3;margin-left:3px}
  .pill .l{font-size:12px;color:#9db0c9;margin-top:3px}

  /* 浏览器框 */
  .frame{background:#0d1526;border:1px solid rgba(148,163,184,.22);border-radius:16px;overflow:hidden;
    box-shadow:0 40px 90px -30px rgba(0,0,0,.65),0 0 0 1px rgba(255,255,255,.02) inset}
  .frame .bar{display:flex;align-items:center;gap:10px;padding:11px 16px;background:#101a2e;border-bottom:1px solid rgba(148,163,184,.14)}
  .frame .dots{display:flex;gap:6px}
  .frame .dots i{width:11px;height:11px;border-radius:50%}
  .frame .dots i:nth-child(1){background:#f87171}.frame .dots i:nth-child(2){background:#fbbf24}.frame .dots i:nth-child(3){background:#34d399}
  .frame .url{flex:1;max-width:340px;margin:0 auto;background:rgba(148,163,184,.1);border-radius:8px;font-size:12px;color:#8ea0b8;
    padding:4px 14px;text-align:center;letter-spacing:.5px}
  .frame img{display:block;width:100%}

  /* 主体 */
  section{padding:64px 0 8px}
  h2{font-size:24px;font-weight:800;letter-spacing:.5px}
  .h2sub{margin-top:8px;font-size:14.5px;color:var(--sub)}
  .knum{font-size:12px;font-weight:700;color:var(--teal);letter-spacing:3px}

  /* 口径引擎交互演示 */
  .demo{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:34px 36px;margin-top:26px;
    display:grid;grid-template-columns:1.15fr 1fr;gap:38px;align-items:center}
  .sw{display:inline-flex;background:#eef1f5;border-radius:10px;padding:4px;margin-bottom:22px}
  .sw button{cursor:pointer;border:none;background:transparent;color:var(--sub);font-size:13.5px;font-weight:600;
    padding:9px 22px;border-radius:8px;font-family:inherit;transition:all .22s}
  .sw button.on{background:var(--dark);color:#fff;box-shadow:0 4px 14px -4px rgba(10,17,32,.5)}
  .bignum{font-size:clamp(36px,4.4vw,52px);font-weight:800;letter-spacing:.5px;line-height:1.1;transition:color .3s}
  .bignum.net{color:var(--teal)}.bignum.book{color:var(--ink)}
  .bigl{font-size:13px;color:var(--sub);margin-top:6px}
  .duo{display:grid;grid-template-columns:1fr 1fr;gap:26px}
  .seg{height:16px;border-radius:8px;overflow:hidden;display:flex;margin-top:18px;background:#eef1f5}
  .seg .internal{background:linear-gradient(90deg,#f87171,#ef4444);width:0;transition:width .7s cubic-bezier(.22,1,.36,1)}
  .seg .netbar{background:linear-gradient(90deg,#14b8a6,#0d9488);flex:1}
  .segcap{display:flex;justify-content:space-between;font-size:12px;color:var(--sub);margin-top:8px}
  .segcap b.r{color:var(--red)}.segcap b.g{color:var(--teal)}
  .democap{margin-top:20px;font-size:13.5px;color:var(--sub);line-height:1.8;padding:14px 18px;background:#f5faf9;
    border:1px solid #d8ece8;border-radius:12px}
  .democap b{color:var(--ink)}

  /* 亮点卡片 */
  .feats{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:26px}
  .feat{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px 22px 20px;
    transition:transform .25s cubic-bezier(.22,1,.36,1),box-shadow .25s,border-color .25s}
  .feat:hover{transform:translateY(-5px);box-shadow:0 18px 40px -18px rgba(15,30,60,.22);border-color:#b8e4de}
  .feat .no{font-size:12px;font-weight:700;color:var(--teal);letter-spacing:2px}
  .feat b{display:block;font-size:15.5px;margin:8px 0 8px;font-weight:700}
  .feat p{font-size:13px;color:var(--sub);line-height:1.8;text-align:justify}

  /* 方法论板块 v2：统计带 + 编号工程卡 + 方法图鉴 + 公式墙 */
  .mband{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:26px 0 8px;
    background:var(--dark);color:#e8eef9;border-radius:16px;padding:20px 34px}
  .mband>div{display:flex;align-items:baseline;gap:10px}
  .mband b{font-size:30px;font-weight:800;color:#5eead4}
  .mband div:first-child b{color:#7dd3fc}.mband div:last-child b{color:#fbbf24}
  .mband span{font-size:12.5px;color:#9db0c9}
  .mband i{width:1px;height:30px;background:rgba(148,163,184,.25)}
  .sec-sub{display:flex;align-items:center;gap:12px;margin:40px 0 16px;font-size:13px;font-weight:800;letter-spacing:2px;color:var(--blue)}
  .sec-sub::after{content:"";flex:1;height:1px;background:var(--line)}

  .engrid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
  .eng{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;position:relative;overflow:hidden;
    transition:transform .25s cubic-bezier(.22,1,.36,1),box-shadow .25s,border-color .25s}
  .eng:hover{transform:translateY(-4px);box-shadow:0 14px 34px -16px rgba(15,30,60,.22);border-color:#b8e4de}
  .eng .eno{position:absolute;right:12px;top:6px;font-size:34px;font-weight:800;color:#eef1f5;letter-spacing:-1px;user-select:none}
  .eng b{display:block;font-size:13.5px;font-weight:750;max-width:82%}
  .eng p{font-size:11.5px;color:var(--sub);line-height:1.65;margin:6px 0 10px;min-height:52px}
  .eng .tags{display:flex;flex-wrap:wrap;gap:5px}
  .eng .tags i{font-style:normal;font-family:ui-monospace,Consolas,monospace;font-size:10px;font-weight:600;
    color:var(--blue);background:#e8f4f8;border-radius:5px;padding:2px 7px}

  .mgal{display:grid;grid-template-columns:repeat(5,1fr);gap:14px}
  .mg{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 16px 14px;
    transition:transform .25s cubic-bezier(.22,1,.36,1),box-shadow .25s,border-color .25s}
  .mg:hover{transform:translateY(-4px);box-shadow:0 14px 34px -16px rgba(15,30,60,.22);border-color:#b8e4de}
  .mg .viz{height:52px;display:flex;align-items:center;gap:6px;margin-bottom:10px}
  .mg b{display:block;font-size:13px;font-weight:750}
  .mg p{font-size:11px;color:var(--sub);line-height:1.6;margin-top:4px}
  .v-bar{width:100%;height:16px;border-radius:8px;overflow:hidden;display:flex}
  .v-bar .r{background:linear-gradient(90deg,#f87171,#ef4444)}
  .v-bar .g{flex:1;background:linear-gradient(90deg,#14b8a6,#0d9488)}
  .v-seg{width:100%;height:16px;border-radius:8px;overflow:hidden;display:flex;gap:2px}
  .v-seg i{border-radius:2px}
  .v-2b{width:100%;display:flex;flex-direction:column;gap:5px}
  .v-2b div{height:11px;border-radius:6px;background:#eef1f5;overflow:hidden;position:relative}
  .v-2b i{display:block;height:100%;border-radius:6px;background:linear-gradient(90deg,#fbbf24,#f59e0b)}
  .v-2b i.t{background:linear-gradient(90deg,#14b8a6,#0d9488)}
  .v-gauge{width:50px;height:50px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;
    background:conic-gradient(#0d9488 var(--p,45%),#e8ecf2 0);font-size:12.5px;font-weight:800;position:relative}
  .v-gauge::after{content:"";position:absolute;inset:5px;border-radius:50%;background:var(--card)}
  .v-gauge span{position:relative;z-index:1}
  .v-flow{display:flex;align-items:center;gap:5px;font-size:10px;font-weight:700;flex-wrap:wrap}
  .v-flow i{font-style:normal;border-radius:6px;padding:4px 8px;background:#fdf3e3;color:var(--amber)}
  .v-flow i.red{background:#fdeaea;color:var(--red)}
  .v-flow em{font-style:normal;color:var(--faint)}
  .v-prog{width:100%;height:14px;border-radius:7px;background:#eef1f5;position:relative;overflow:visible}
  .v-prog i{position:absolute;left:0;top:0;bottom:0;border-radius:7px;background:linear-gradient(90deg,#0ea5e9,#0d9488)}
  .v-prog em{position:absolute;top:-3px;width:2px;height:20px;background:var(--ink)}
  .v-chips{display:flex;flex-wrap:wrap;gap:5px}
  .v-chips i{font-style:normal;font-size:10px;font-weight:700;border-radius:6px;padding:4px 8px}
  .v-chips .ok{background:#e6f7f1;color:#059669}.v-chips .bad{background:#fdeaea;color:var(--red)}.v-chips .na{background:#eef1f5;color:var(--sub)}
  .v-pareto{display:flex;align-items:flex-end;gap:3px;height:44px;flex:1}
  .v-pareto i{flex:1;border-radius:3px 3px 0 0;background:linear-gradient(180deg,#38bdf8,#0e7490)}
  .v-pareto i:last-child{background:#eef1f5}
  .v-pareto b{font-size:10.5px;color:var(--sub);font-weight:700;align-self:flex-end;white-space:nowrap;margin-left:2px}

  .thygrid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
  .thy{background:var(--dark);border:1px solid rgba(148,163,184,.2);border-radius:14px;padding:18px;
    transition:transform .25s cubic-bezier(.22,1,.36,1),box-shadow .25s}
  .thy:hover{transform:translateY(-4px);box-shadow:0 14px 34px -14px rgba(10,17,32,.45)}
  .thy code{display:block;font-family:ui-monospace,Consolas,monospace;font-size:12px;font-weight:600;color:#5eead4;
    background:rgba(94,234,212,.1);border-radius:7px;padding:7px 11px;margin-bottom:10px;letter-spacing:.3px}
  .thy b{display:block;font-size:13px;font-weight:750;color:#e8eef9}
  .thy p{font-size:11px;color:#9db0c9;line-height:1.65;margin-top:4px}

  /* 架构 */
  .flow{display:flex;flex-wrap:wrap;gap:0;margin-top:26px;align-items:stretch}
  .step{flex:1;min-width:150px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 18px;position:relative}
  .step:not(:last-child){margin-right:32px}
  .step:not(:last-child)::after{content:"→";position:absolute;right:-26px;top:50%;transform:translateY(-50%);color:var(--faint);font-size:18px}
  .step b{display:block;font-size:14px;margin-bottom:5px}
  .step span{font-size:12px;color:var(--sub);line-height:1.7;display:block}

  .cap{font-size:12.5px;color:var(--faint);text-align:center;margin-top:14px}
  footer{margin-top:64px;padding:22px 0 46px;border-top:1px solid var(--line);font-size:12.5px;color:var(--faint);
    display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}

  /* 入场动画 */
  .rv{opacity:0;transform:translateY(26px);transition:opacity .7s cubic-bezier(.22,1,.36,1),transform .7s cubic-bezier(.22,1,.36,1)}
  .rv.in{opacity:1;transform:none}
  @media (prefers-reduced-motion:reduce){.rv{opacity:1;transform:none;transition:none}}
  @media (max-width:900px){.pills{grid-template-columns:repeat(2,1fr)}.feats{grid-template-columns:1fr}.methods{grid-template-columns:1fr}
    .demo{grid-template-columns:1fr;padding:26px 22px}
    .step:not(:last-child){margin-right:0;margin-bottom:32px}
    .step:not(:last-child)::after{content:"↓";right:50%;top:auto;bottom:-27px;transform:translateX(50%)}}
</style>
</head>
<body>
<div class="progress"><i id="pbar"></i></div>

<header class="hero">
  <div class="wrap">
    <span class="badge rv">作 品 展 示 · DATA COCKPIT</span>
    <h1 class="rv">医疗器械集团<br>经营数据驾驶舱</h1>
    <p class="pitch rv">为一家多主体医疗器械销售集团（4 家关联公司）打造的<b>经营决策看板</b>：直连金蝶云星辰开放平台，自动同步四账套业务数据，独创<b>净额口径引擎</b>剔除集团内部交易虚增，聚焦「卖了多少、钱什么时候回来、哪些账有风险」三个经营核心问题。</p>
    <div class="pills rv">
      <div class="pill"><div class="v x4" data-cu="4">0</div><div class="l">金蝶账套全量打通</div></div>
      <div class="pill"><div class="v x4" data-cu="${S.docsWan}" data-dec="1">0</div><div class="l">入库业务单据（万张）</div></div>
      <div class="pill"><div class="v x3" data-cu="${S.internalPct}">0</div><div class="l">账面应收为内部虚增（%）</div></div>
      <div class="pill"><div class="v x2" data-cu="${S.oldest}">0</div><div class="l">系统挖出最老账龄（天）</div></div>
    </div>
    <div class="frame rv"><div class="bar"><div class="dots"><i></i><i></i><i></i></div><div class="url">某集团 · 经营数据驾驶舱 · 实时净额口径</div></div><img src="data:image/png;base64,${hero}" alt="驾驶舱首屏"></div>
  </div>
</header>

<div class="wrap">
  <section id="engine">
    <div class="rv"><span class="knum">INTERACTIVE · 点击切换</span>
      <h2>口径引擎：亲眼看 86% 的应收"虚增"被抵销</h2>
      <p class="h2sub">四家关联公司之间互相开票销售，账面应收近九成是"自己欠自己"。点击开关，感受净额口径引擎带来的数据修正。</p>
    </div>
    <div class="demo rv">
      <div>
        <div class="sw"><button id="btnBook" class="on">账面口径</button><button id="btnNet">净额口径（真实）</button></div>
        <div class="duo">
          <div><div class="bignum book" id="numAR">—</div><div class="bigl">应收账款余额</div></div>
          <div><div class="bignum book" id="numSales">—</div><div class="bigl">净销售额（YTD）</div></div>
        </div>
        <div class="seg"><div class="internal" id="segIn"></div><div class="netbar"></div></div>
        <div class="segcap"><b class="r" id="capIn">内部交易 ${S.internalPct}%</b><b class="g">真实对外应收</b></div>
      </div>
      <div class="democap" id="demoCap">账面应收中 <b>${fmtW(internalAR)}</b> 来自四家关联公司之间的内部往来——不做抵销，管理层看到的"应收"近九成是虚增的纸面数字。</div>
    </div>
  </section>

  <section>
    <div class="rv"><span class="knum">DESIGN HIGHLIGHTS</span><h2>核心设计亮点</h2></div>
    <div class="feats">
      <div class="feat rv"><div class="no">01 口径引擎</div><b>净额口径 · 内部交易自动抵销</b><p>关联公司之间的进货/出货、应收在统计层自动剔除——不改动生产系统，但让管理层看到的销售与应收全部是真实对外口径。上方的交互演示正是它的效果。</p></div>
      <div class="feat rv"><div class="no">02 账龄双口径</div><b>账龄 × 超期 × 坏账拨备预估</b><p>不止看"欠了多久"（账龄），更看"超过约定账期多久"（超期，基于单据到期日），并按梯级比例预估坏账拨备、标注账龄迁徙预警——91-180 天段金额将滑入坏账区间。</p></div>
      <div class="feat rv"><div class="no">03 双基准 KPI</div><b>每个数字都有参照系</b><p>净销售对齐年度目标达成率与时间进度刻度线，回款比对齐行业基准，DSO 提供剔除停滞业务后的对照口径——绝对值 + 相对进度 + 状态灯三重表达。</p></div>
      <div class="feat rv"><div class="no">04 数据链路</div><b>增量同步 · 全自动刷新</b><p>自研同步引擎对接金蝶开放平台签名鉴权体系（appSecret 24h 自动轮换、token 生命周期管理），按修改时间增量拉取，日常刷新仅数次 API 调用，远低于平台限流。</p></div>
      <div class="feat rv"><div class="no">05 风险闭环</div><b>三级预警 → 处置工单</b><p>高危/关注/监控三级预警自动生成，一键产出带责任人、金额、账龄、处置建议的催收/对账工单，可直接粘贴至企微或 OA 跟进，预警与行动不再脱节。</p></div>
      <div class="feat rv"><div class="no">06 实体记分卡</div><b>四账套健康度裁决</b><p>每个经营实体自动给出「核心增长 / 风险清算 / 正常运转」裁决标签，附营收贡献、应收占比、超期占比与近 12 个月销售火花线，一眼定位资源该给谁、额度该冻谁。</p></div>
    </div>
  </section>

  <section id="methods">
    <div class="rv"><span class="knum">METHODOLOGY</span><h2>技术手段 · 分析方法 · 理论基础</h2>
      <p class="h2sub">从开放平台协议逆向到坏账拨备模型——26 项方法体系，每项都在真实数据上落地</p></div>

    <div class="mband rv">
      <div><b>8</b><span>工程技术手段</span></div><i></i>
      <div><b>10</b><span>数据分析方法</span></div><i></i>
      <div><b>8</b><span>理论与模型</span></div><i></i>
      <div><b>26</b><span>方法体系总量</span></div>
    </div>

    <div class="sec-sub rv">ENGINEERING · 工程技术手段</div>
    <div class="engrid">
      <div class="eng rv"><span class="eno">01</span><b>协议逆向与签名复现</b><p>开放平台网关 HMAC-SHA256 双层签名，按官方示例向量自校验通过</p><div class="tags"><i>HMAC-SHA256</i><i>Base64</i><i>SDK对齐</i></div></div>
      <div class="eng rv"><span class="eno">02</span><b>全链路鉴权自动化</b><p>appSecret 24h 轮换热更新 + app-token 23h 缓存，自动规避换票限流</p><div class="tags"><i>Token生命周期</i><i>限流规避</i></div></div>
      <div class="eng rv"><span class="eno">03</span><b>增量同步引擎</b><p>修改时间水位线 + 重叠窗口 + 单据 ID 幂等合并，未结清走快照差异</p><div class="tags"><i>Watermark</i><i>Upsert</i><i>Snapshot Diff</i></div></div>
      <div class="eng rv"><span class="eno">04</span><b>轻量级数仓</b><p>JSONL 按账套分域，日常增量仅数次 API 调用，零外部数据库依赖</p><div class="tags"><i>JSONL</i><i>零依赖</i></div></div>
      <div class="eng rv"><span class="eno">05</span><b>无头浏览器流水线</b><p>Chrome Headless 2 倍 Retina 截图 → 构建 → CDN 发布，一条命令重制</p><div class="tags"><i>Headless</i><i>2x Retina</i><i>CI</i></div></div>
      <div class="eng rv"><span class="eno">06</span><b>单文件交付工程</b><p>图表与数据全量内嵌，产物离线可开、直发即看，刷新即最新</p><div class="tags"><i>Self-contained</i><i>no-store</i></div></div>
      <div class="eng rv"><span class="eno">07</span><b>自动化脱敏</b><p>构建期名称→代号映射 + 真实名称泄漏扫描门禁，0 残留方可发布</p><div class="tags"><i>Masking</i><i>泄漏门禁</i></div></div>
      <div class="eng rv"><span class="eno">08</span><b>安全边界设计</b><p>对外仅暴露脱敏单文件，其余路径一律 404，凭证不出本机</p><div class="tags"><i>404防护</i><i>回环绑定</i></div></div>
    </div>

    <div class="sec-sub rv">ANALYTICS · 数据分析方法图鉴</div>
    <div class="mgal">
      <div class="mg rv"><div class="viz"><div class="v-bar"><i class="r" style="width:${S.internalPct}%"></i><i class="g"></i></div></div><b>关联方交易抵销</b><p>内部往来统计层全额抵销，输出并表净额口径</p></div>
      <div class="mg rv"><div class="viz"><div class="v-seg"><i style="width:9%;background:#34d399"></i><i style="width:9%;background:#a3e635"></i><i style="width:5%;background:#facc15"></i><i style="width:9%;background:#fb923c"></i><i style="width:66%;background:#ef4444"></i></div></div><b>账龄分桶分析</b><p>0-30 / 31-60 / 61-90 / 91-180 / 180+ 天五档梯级</p></div>
      <div class="mg rv"><div class="viz"><div class="v-2b"><div><i style="width:35%"></i></div><div><i class="t" style="width:70%"></i></div></div></div><b>回款率 vs 基准</b><p>近 12 月回款/销售比对标 70% 基准，辅以 30 天净增动量</p></div>
      <div class="mg rv"><div class="viz"><div class="v-flow"><i>单据日</i><em>→</em><i>到期日</i><em>→</em><i class="red">超期天数</i></div></div><b>账期对照（超期）</b><p>超期 = 今天 − 到期日，区分「欠多久」与「逾期多久」</p></div>
      <div class="mg rv"><div class="viz"><div class="v-gauge" style="--p:46%"><span>46天</span></div><em style="font-size:10.5px;color:var(--sub);font-style:normal">滚动90天</em></div><b>DSO 周转天数</b><p>另提供剔除停滞业务的对照口径</p></div>
      <div class="mg rv"><div class="viz"><div class="v-flow"><i>180-365天</i><em>×20%</em><i class="red">365天+</i><em>×50%</em></div></div><b>坏账拨备梯级预估</b><p>按账龄段差异化计提比例</p></div>
      <div class="mg rv"><div class="viz"><div class="v-flow"><i>91-180天</i><em>→ 64万 →</em><i class="red">180天+</i></div></div><b>账龄迁徙预警</b><p>Roll Rate：滑入坏账区间的前置信号</p></div>
      <div class="mg rv"><div class="viz"><div class="v-pareto"><i style="height:88%"></i><i style="height:38%"></i><i style="height:21%"></i><i style="height:15%"></i><i style="height:11%"></i><b>HHI 282</b></div></div><b>集中度分析</b><p>Top-N 客户占比 + 赫芬达尔指数</p></div>
      <div class="mg rv"><div class="viz"><div class="v-prog"><i style="width:77%"></i><em style="left:75%"></em></div></div><b>双基准进度</b><p>目标达成率 77% 对标时间进度刻度 75%</p></div>
      <div class="mg rv"><div class="viz"><div class="v-chips"><i class="ok">核心增长</i><i class="bad">风险清算</i><i class="na">正常运转</i><i class="na">正常运转</i></div></div><b>实体健康记分卡</b><p>多维裁决标签 + 12 个月销售火花线</p></div>
    </div>

    <div class="sec-sub rv">THEORY · 理论与模型</div>
    <div class="thygrid">
      <div class="thy rv"><code>Σ AR_intra → 0</code><b>合并报表抵销理论</b><p>内部交易抵销（Consolidation Elimination）用于管理口径</p></div>
      <div class="thy rv"><code>DSO = AR ÷ (Sales/90)</code><b>应收账款管理理论</b><p>账龄分析法、DSO 与现金转换周期 CCC 框架</p></div>
      <div class="thy rv"><code>Provision = Σ ARᵢ × rᵢ</code><b>备抵法坏账准备</b><p>账龄比例法计提模型（Ageing Schedule）</p></div>
      <div class="thy rv"><code>M(i→j) = Flowᵢ ÷ Balᵢ</code><b>迁徙率模型</b><p>信贷风控 Roll Rate，余额跨风险等级迁移</p></div>
      <div class="thy rv"><code>HHI = Σ sᵢ²</code><b>赫芬达尔指数</b><p>产业组织经济学经典集中度测度</p></div>
      <div class="thy rv"><code>Pareto 80 / 20</code><b>帕累托法则</b><p>Top 客户贡献结构分析</p></div>
      <div class="thy rv"><code>ETL · Upsert · Snapshot</code><b>数据仓库方法论</b><p>Kimball 思想的轻量实现：增量、幂等、快照事实表</p></div>
      <div class="thy rv"><code>Overview → Drill → Action</code><b>决策支持系统 DSS</b><p>驾驶舱分层信息架构与行动闭环</p></div>
    </div>
  </section>

  <section>
    <div class="rv"><span class="knum">FULL VIEW</span><h2>完整页面</h2>
      <p class="h2sub">账龄雷达 · 实体记分卡 · 高风险客户榜 · 业务员回款榜 · 全模块洞察与建议（随数据自动重算）</p></div>
    <div class="frame rv" style="margin-top:26px"><div class="bar"><div class="dots"><i></i><i></i><i></i></div><div class="url">驾驶舱完整页面 · 数据截至 ${today}</div></div><img src="data:image/png;base64,${full}" alt="驾驶舱完整页面"></div>
    <div class="cap rv">图为系统自动生成的实时页面截图（脱敏演示版）</div>
  </section>

  <section>
    <div class="rv"><span class="knum">ARCHITECTURE</span><h2>技术架构</h2></div>
    <div class="flow rv">
      <div class="step"><b>金蝶云星辰开放平台</b><span>4 账套 · 签名鉴权 · 增量拉取（客户/销售/退货/收款/未结清）</span></div>
      <div class="step"><b>本地数据层</b><span>JSONL 轻量数仓 · 单据级去重合并 · 未结清快照差异更新</span></div>
      <div class="step"><b>指标计算层</b><span>净额口径引擎 · 账龄/超期分桶 · 坏账预估 · 双基准 KPI</span></div>
      <div class="step"><b>构建层</b><span>ECharts 内嵌 · 单文件产物 · 一条命令重建</span></div>
      <div class="step"><b>展示层</b><span>深/浅双主题 · 三级预警工单 · 常驻固定链接</span></div>
    </div>
  </section>

  <footer class="rv">
    <span>数据截至 ${today} · 净额口径（已剔除关联方内部交易）${MASK ? " · 脱敏演示版" : ""}</span>
    <span>展示页数据由同步库实时统计生成 · 仅供作品演示</span>
  </footer>
</div>

<script>
var S = ${JSON.stringify(S)};
/* 滚动进度条 */
addEventListener("scroll", function(){ var h = document.documentElement;
  document.getElementById("pbar").style.width = (h.scrollTop / (h.scrollHeight - h.clientHeight) * 100) + "%"; }, {passive:true});
/* 入场动画（交错延迟） */
var io = new IntersectionObserver(function(es){ es.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add("in"); io.unobserve(e.target); } }); }, {threshold:.12});
document.querySelectorAll(".rv").forEach(function(el, i){ el.style.transitionDelay = (i % 6) * 60 + "ms"; io.observe(el); });
/* 数字滚动 */
var cu = new IntersectionObserver(function(es){ es.forEach(function(e){ if(!e.isIntersecting) return; cu.unobserve(e.target);
  var el = e.target, t = parseFloat(el.dataset.cu), dec = +(el.dataset.dec || 0), st = null;
  function tick(ts){ if(!st) st = ts; var p = Math.min(1, (ts - st) / 1100); p = 1 - Math.pow(1 - p, 3);
    el.textContent = (t * p).toFixed(dec); if(p < 1) requestAnimationFrame(tick); }
  requestAnimationFrame(tick); }); }, {threshold:.6});
document.querySelectorAll("[data-cu]").forEach(function(el){ cu.observe(el); });
/* 口径引擎演示 */
var fmt = function(n){ var w = n / 1e4; return Math.round(w).toLocaleString("zh-CN") + "万"; };
function tween(el, from, to){ var st = null;
  function tick(ts){ if(!st) st = ts; var p = Math.min(1, (ts - st) / 650); p = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(from + (to - from) * p); if(p < 1) requestAnimationFrame(tick); }
  requestAnimationFrame(tick); }
var mode = "book", cur = { ar: S.bookAR, sales: S.bookSales };
function setMode(m){
  mode = m;
  document.getElementById("btnBook").classList.toggle("on", m === "book");
  document.getElementById("btnNet").classList.toggle("on", m === "net");
  var tarAR = m === "book" ? S.bookAR : S.netAR, tarS = m === "book" ? S.bookSales : S.netSales;
  tween(document.getElementById("numAR"), cur.ar, tarAR); cur.ar = tarAR;
  tween(document.getElementById("numSales"), cur.sales, tarS); cur.sales = tarS;
  document.getElementById("segIn").style.width = (m === "book" ? S.internalPct : 0) + "%";
  document.getElementById("capIn").textContent = "内部交易 " + (m === "book" ? S.internalPct + "%" : "已抵销");
  document.querySelectorAll(".bignum").forEach(function(el){ el.classList.toggle("net", m === "net"); el.classList.toggle("book", m === "book"); });
  document.getElementById("demoCap").innerHTML = m === "book"
    ? "账面应收中 <b>${fmtW(internalAR)}</b> 来自四家关联公司之间的内部往来——不做抵销，管理层看到的「应收」近九成是虚增的纸面数字。"
    : "抵销后：<b>${fmtW(netAR)}</b> 才是真实对外应收。驾驶舱所有模块默认采用净额口径，每张 KPI 卡同步展示账面值与剔除值，口径完全透明。";
}
document.getElementById("btnBook").addEventListener("click", function(){ setMode("book"); });
document.getElementById("btnNet").addEventListener("click", function(){ setMode("net"); });
setMode("book");
</script>
</body>
</html>`;

fs.writeFileSync(path.join(DIR, OUT), html, "utf8");
console.log(`作品展示页(v2交互版)构建完成 → ${path.join(DIR, OUT)}${MASK ? " [脱敏版]" : ""} (${(html.length / 1024 / 1024).toFixed(2)} MB, 2x高清图内嵌)`);
if (MASK) {
  // 泄漏门：账套全称/简称、关联公司名、集团名（取自配置标题前缀）均不得残留
  const group = (cfg.dashboard?.title || "").split(" · ")[0];
  const leakNames = [...new Set([...cfg.accounts.flatMap((a) => [a.name, a.shortName]), ...relNames, ...(group.length >= 2 ? [group] : [])])];
  const leaks = leakNames.filter((n) => n && n.length >= 2 && html.includes(n));
  console.log(`脱敏泄漏检查: ${leaks.length === 0 ? "通过" : "!!! 泄漏: " + leaks.join("、")}`);
  process.exit(leaks.length ? 1 : 0);
}
