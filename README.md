# 金蝶云星辰 · 集团经营数据驾驶舱

从金蝶云星辰开放平台实时同步多账套业务数据，在统计层完成**关联方内部交易抵销（净额口径）**，计算账龄、超期、坏账拨备、迁徙率、DSO、集中度等风控指标，最终产出**单文件 HTML 数据驾驶舱**——双击即开、无需数据库、无需前端工程化。

**零第三方依赖**：仅使用 Node.js 标准库（fetch / WebSocket / crypto），图表用内嵌的 ECharts。

- 📊 在线演示（脱敏版）：[腾讯云 EdgeOne CDN](https://data-d1g0rm7iwea98e9a9-1317260465.tcloudbaseapp.com/) ｜ [GitHub Pages 镜像](https://zhenyuanliu-pro.github.io/data-cockpit-portfolio/)
- 🎨 作品展示页（含方法论全景）：[data-cockpit-portfolio 仓库](https://github.com/zhenyuanliu-pro/data-cockpit-portfolio)

---

## 它解决什么问题

医疗器械流通集团通常由多家关联公司构成（异地资质、异地仓储），账面数据因此严重失真——本项目实际数据中，**集团账面应收的 86% 是四家公司之间的内部往来**。直接看账面数字，管理层看到的是虚增了数倍的"应收"和"销售"。

本项目的做法：**主数据不动金蝶一兵一卒，全部在统计层抵销**。

## 架构

```
金蝶云星辰开放平台（客户 / 销售出库 / 退货 / 收款 / 未结清单据）
        │
        ▼  jdy-sync.mjs —— 增量同步引擎
   修改时间水位线 + 5min 重叠窗 + 按单据ID幂等 Upsert
   未结清快照差分（仅新单调详情接口，省 90%+ 调用量）
        │
        ▼  jdy-data/*.jsonl —— 本地数据仓库（追加式，可回溯）
        │
        ▼  jdy-dashboard-build.mjs —— 指标引擎
   关联方抵销(净额口径) · 账龄/超期双基准 · 坏账拨备
   迁徙率预警 · DSO(滚动90天) · HHI集中度 · 双基准KPI
        │
        ▼  dashboard-template.html（占位符注入 ECharts + 数据）
        │
        ├── designs/cockpit/index.html        真实版驾驶舱（单文件）
        └── designs/cockpit/index-masked.html 脱敏演示版（泄漏门校验）
                 │
                 ▼  jdy-showcase-build.mjs + shot.mjs
            作品展示页（CDP 按页面真实高度精确截图，base64 内嵌单文件外发）
```

## 核心特性

| 模块 | 说明 |
|---|---|
| **认证链** | outerInstanceId → 主动授权换 appKey/appSecret（24h 自动刷新）→ app-token（24h，2次/分钟限流），全链路令牌缓存 |
| **双层签名** | 应用签名 SHA256 + 接口签名 HMAC-SHA256，参数整体 `"k=v"` 排序后签名（与官方 SDK 逐字节一致，含官方测试向量自检） |
| **增量同步** | 水位线 + 重叠窗防漏单；ID 幂等 upsert；快照差分只对新单取详情；全程限流感知（500次/分/账套） |
| **净额口径** | 配置化关联方清单（客户ID + 名称双匹配），四类单据全部抵销，仅统计层生效 |
| **账龄双基准** | 账龄（今天−单据日）与超期（今天−到期日）两套分桶并列，识别"未超期但已老化"的隐性风险 |
| **坏账拨备** | 180-365天 × 20% + 365天+ × 50% 计提预估 |
| **迁徙预警** | 91→180 天段滚动金额监控，捕捉坏账形成路径 |
| **DSO** | 滚动 90 天应收周转天数，含"剔除停滞账套"修正口径 |
| **双基准 KPI** | 年度达成率 vs 时间进度双轨对照（领先/落后一目了然）+ 同比/环比 |
| **脱敏外发** | `--mask` 一键生成脱敏版：账套→主体A-D、客户→客户A-Z、业务员→业务员01+，构建后强制泄漏门（残留真实名称即构建失败） |

## 快速开始

**前置**：Node.js 22+（需原生 fetch/WebSocket）；金蝶云星辰账号并已在[开放平台](https://open.jdy.com)创建应用。

```bash
# 1. 配置凭据（结构见 config.example.json）
cp config.example.json jdy-config.json   # 填入 clientId/clientSecret/各账套 outerInstanceId

# 2. 首次全量同步（之后日常增量，见下）
node jdy-sync.mjs --full

# 3. 构建驾驶舱（真实版 + 脱敏版）
node jdy-dashboard-build.mjs
node jdy-dashboard-build.mjs --mask      # 产出 index-masked.html，自动跑泄漏门

# 4. 本地常驻服务（固定链接 http://localhost:4311/）
node serve-designs.mjs
```

日常更新只需两步：`node jdy-sync.mjs && node jdy-dashboard-build.mjs`。

生成对外作品展示页（可选）：

```bash
# 需先启动 serve-designs.mjs，且 designs/cockpit/ 下已有 echarts.min.js 与已构建页面
node shot.mjs "http://localhost:4311/" designs/cockpit/cockpit-full.png 1700 2 0
node shot.mjs "http://localhost:4311/" designs/cockpit/cockpit-hero.png 1700 2 1120
node shot.mjs "http://localhost:4311/designs/cockpit/index-masked.html" designs/cockpit/masked-full.png 1700 2 0
node shot.mjs "http://localhost:4311/designs/cockpit/index-masked.html" designs/cockpit/masked-hero.png 1700 2 1120
node jdy-showcase-build.mjs --mask      # 产出单文件 作品展示-脱敏.html
```

`shot.mjs` 通过 Chrome DevTools 协议**先量页面真实高度再按内容精确出图**（2x 高清），不存在固定窗口截图的底部空白问题。

## 文件说明

| 文件 | 职责 |
|---|---|
| `jdy-client.mjs` | 开放平台 API 客户端：认证链、双层签名、限流重试、官方向量自检 |
| `jdy-sync.mjs` | 增量同步引擎：五类数据 → `jdy-data/*.jsonl` 本地仓库 |
| `jdy-dashboard-build.mjs` | 指标引擎 + 驾驶舱生成（`--mask` 脱敏 + 泄漏门） |
| `jdy-showcase-build.mjs` | 作品展示页生成（截图 base64 内嵌、口径引擎交互演示） |
| `shot.mjs` | CDP 精确截图（真实高度、2x、任意视口） |
| `serve-designs.mjs` | 本地静态服务（仅绑回环地址、首页不缓存） |
| `dashboard-template.html` | 驾驶舱模板（`__TITLE__`/`__ECHARTS__`/`__DATA__` 占位符注入） |
| `config.example.json` | 配置结构示例（真实配置 `jdy-config.json` 已被 gitignore） |

## 安全设计

- 密钥只存在于 `jdy-config.json`（`.gitignore` 排除），源码零硬编码凭据；
- 同步令牌缓存 `jdy-token-cache.json` 同样排除；
- 脱敏版构建后强制执行**泄漏门**：账套全称/简称、关联公司名、集团名、Top 客户名、业务员名任一残留即 `exit 1`；
- 页面标题、账套列表、抵销清单全部配置驱动，源码不含任何真实主体名称。

## 口径与理论速览

| 概念 | 口径 |
|---|---|
| 净销售 | 账面销售 − 账面退货 − 关联方内部往来 |
| 账龄 | 今天 − 单据日期；**超期** = 今天 − 到期日（双基准并列） |
| 坏账拨备 | Σ(180-365天段 × 20%) + Σ(365天+ × 50%) |
| DSO | 净应收 ÷ 滚动90天日均净销售 |
| HHI | Σ(客户净销售份额²) × 10000，>2500 视为高集中度 |
| 迁徙率 | M(i→j) = 期内从 i 段流入 j 段的金额 ÷ i 段期初余额 |

完整方法论（8 项工程手段 / 10 个分析方法 / 8 个理论模型）见[作品展示页](https://zhenyuanliu-pro.github.io/data-cockpit-portfolio/)。

## License

MIT
