// 金蝶云星辰开放平台 API 客户端
// 链路：outerInstanceId →(主动获取授权)→ appKey/appSecret/domain →(换取app-token)→ app-token → 业务接口
// 依据官方文档：
//   - X-Api-Signature加密 doc_b5c26557da9d11ed8e36f9799578d2e1
//   - 换取app-token      doc_9076d1a6da9d11ed8e36874bed64e0be
//   - 主动获取授权       doc_801d558dda9d11edbfb2d572de04f9ce
import crypto from "node:crypto";
import fs from "node:fs";

const enc = encodeURIComponent; // encodeURIComponent 输出大写 HEX，符合文档要求

// ---------- 签名 ----------

// app_signature = Base64( Hex( HMAC-SHA256(key=appSecret, msg=app_key) ) )
export function appSignature(appKey, appSecret) {
  const hex = crypto.createHmac("sha256", appSecret).update(appKey).digest("hex");
  return Buffer.from(hex).toString("base64");
}

// X-Api-Signature = Base64( Hex( HMAC-SHA256(key=clientSecret, msg=签名原文) ) )
// 签名原文（每段换行符结尾）：
//   METHOD\n
//   urlencode(path)\n
//   params行(按key ASCII升序, value双重URL编码, k=v&k=v; 无参数则空行)\n
//   x-api-nonce:<nonce>\n
//   x-api-timestamp:<ts>\n
// 构造实际查询串的键值对（单次URL编码；数组展开为重复键），顺序与请求URL一致
function buildQsParts(params = {}) {
  const parts = [];
  for (const k of Object.keys(params)) {
    const v = params[k];
    if (Array.isArray(v)) v.forEach((x) => parts.push([k, enc(String(x))]));
    else parts.push([k, enc(String(v))]);
  }
  return parts; // [[key, encodedValue], ...]
}

// X-Api-Signature = Base64( Hex( HMAC-SHA256(key=clientSecret, msg=签名原文) ) )
// 签名原文（官方SDK getSignature 逻辑）：
//   METHOD\n
//   urlencode(path)\n
//   查询串（整个 k=v 对按字符串排序，value 再编码一次=双重编码；无参数则空行）\n
//   x-api-nonce:<nonce>\n
//   x-api-timestamp:<ts>\n
export function xApiSignature({ method, path, params = {}, nonce, timestamp, clientSecret }) {
  const pairStrs = buildQsParts(params).map(([k, v]) => `${k}=${v}`).sort(); // 对整个 k=v 字符串排序
  const paramsLine = pairStrs
    .map((p) => {
      const i = p.indexOf("=");
      return `${enc(p.slice(0, i))}=${enc(p.slice(i + 1))}`; // value 二次编码
    })
    .join("&");
  const raw = [
    method.toUpperCase(),
    enc(path),
    paramsLine,
    `x-api-nonce:${nonce}`,
    `x-api-timestamp:${timestamp}`,
    "",
  ].join("\n");
  const hex = crypto.createHmac("sha256", clientSecret).update(raw).digest("hex");
  return Buffer.from(hex).toString("base64");
}

// 构造带签名的公共 headers
function signedHeaders({ clientId, clientSecret, method, path, params }) {
  const timestamp = Date.now();
  const nonce = Date.now() + Math.floor(Math.random() * 100000);
  return {
    "Content-Type": "application/json",
    "X-Api-ClientID": clientId,
    "X-Api-Auth-Version": "2.0",
    "X-Api-TimeStamp": String(timestamp),
    "X-Api-Nonce": String(nonce),
    "X-Api-SignHeaders": "X-Api-TimeStamp,X-Api-Nonce",
    "X-Api-Signature": xApiSignature({ method, path, params, nonce, timestamp, clientSecret }),
  };
}

// ---------- 接口 ----------

async function httpJson(url, { method, headers, params, body }) {
  const parts = buildQsParts(params);
  const qs = parts.length ? "?" + parts.map(([k, v]) => `${k}=${v}`).join("&") : "";
  const res = await fetch(url + qs, {
    method,
    headers,
    body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { errcode: res.status, description: text.slice(0, 500) }; }
  return { httpStatus: res.status, json };
}

// 主动获取授权：outerInstanceId → 最新 appKey/appSecret/domain
export async function getAuthorization(cfg, outerInstanceId) {
  const path = "/jdyconnector/app_management/push_app_authorize";
  const params = { outerInstanceId };
  const headers = signedHeaders({ ...cfg, method: "POST", path, params });
  const r = await httpJson(cfg.gateway + path, { method: "POST", headers, params });
  if (r.json.code === 200 || r.json.errcode === 0) {
    const d = (r.json.data || [])[0];
    if (!d) throw new Error(`主动获取授权成功但 data 为空: ${JSON.stringify(r.json).slice(0, 300)}`);
    return d; // {appKey, appSecret, domain, accountId, accountName, agreementCompanyName, status, ...}
  }
  throw new Error(`主动获取授权失败: ${JSON.stringify(r.json).slice(0, 300)}`);
}

// 换取 app-token（同参数限 2 次/分钟，token 24h 有效）
export async function getAppToken(cfg, { appKey, appSecret }) {
  const path = "/jdyconnector/app_management/kingdee_auth_token";
  const params = { app_key: appKey, app_signature: appSignature(appKey, appSecret) };
  const headers = signedHeaders({ ...cfg, method: "GET", path, params });
  const r = await httpJson(cfg.gateway + path, { method: "GET", headers, params });
  if (r.json.errcode === 0 && r.json.data?.["app-token"]) {
    return r.json.data["app-token"];
  }
  throw new Error(`换取app-token失败: ${JSON.stringify(r.json).slice(0, 300)}`);
}

// 业务接口调用（自动带 app-token 与 IDC 路由）
export async function callApi(cfg, { appToken, routerAddr, method = "POST", path, params = {}, body = {} }) {
  const headers = {
    ...signedHeaders({ ...cfg, method, path, params }),
    "app-token": appToken,
    "X-GW-Router-Addr": routerAddr,
  };
  return httpJson(cfg.gateway + path, { method, headers, params, body });
}

// token 缓存（避免触发 2 次/分钟限制）
export function loadTokenCache(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    if (j.expiresAt > Date.now() + 60_000) return j;
  } catch {}
  return null;
}
export function saveTokenCache(file, appKey, token) {
  fs.writeFileSync(file, JSON.stringify({ appKey, token, expiresAt: Date.now() + 23 * 3600_000 }, null, 2), "utf8");
}

// ---------- 官方文档示例自校验 ----------
export function selfTest() {
  const results = [];
  // 示例1: app_signature — app_key=abc, appSecret=abc123
  const s1 = appSignature("abc", "abc123");
  results.push({
    name: "app_signature(abc/abc123)",
    expect: "ZDljMTI3NGIyNTE1MTRkYzlkNjc1MDNhYjUzMzgzNWMyY2M4YTdjMzdmNmM3YTVlNDkxMTkzNjdiOTFjNzUyZQ==",
    actual: s1,
    pass: s1 === "ZDljMTI3NGIyNTE1MTRkYzlkNjc1MDNhYjUzMzgzNWMyY2M4YTdjMzdmNmM3YTVlNDkxMTkzNjdiOTFjNzUyZQ==",
  });
  // 示例2: X-Api-Signature — clientId 200421 / clientSecret f2adcfef73369bfc4e1384677d38a0ff
  const s2 = xApiSignature({
    method: "GET",
    path: "/jdyconnector/app_management/kingdee_auth_token",
    params: {
      app_key: "bVZgAZOv1",
      app_signature: "MzZlYTk0ODk4MWZlNjdiODNmNWU4YzViNzYxNGM5MTFlOGJkN2NjMzk0MTJkZGNhZGM0NzZhN2YxZDJmOTlkZA==",
    },
    nonce: 4427456950,
    timestamp: 1670305063559,
    clientSecret: "f2adcfef73369bfc4e1384677d38a0ff",
  });
  results.push({
    name: "X-Api-Signature(官方示例)",
    expect: "OTFiZTliNDFiMjNkYTI3YzVhNzg4MDI4ZGU3MWY1ZTA5ZTk1NjVlNGM1YTI1ZjIxY2Y5YTA3ZGY2OGI1MGQ1MQ==",
    actual: s2,
    pass: s2 === "OTFiZTliNDFiMjNkYTI3YzVhNzg4MDI4ZGU3MWY1ZTA5ZTk1NjVlNGM1YTI1ZjIxY2Y5YTA3ZGY2OGI1MGQ1MQ==",
  });
  return results;
}

export function loadConfig(file = "./jdy-config.json") {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
