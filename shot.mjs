// CDP 精确截图：先量页面真实高度，再按内容精确出图（消灭固定窗口导致的底部空白）
// 用法：node shot.mjs <url> <输出.png> [宽=1700] [倍率=2] [截取高度=整页]
import { exec } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [url, out, W = "1700", SCALE = "2", CLIPH = "0"] = process.argv.slice(2);
const PORT = 9333 + Math.floor(Math.random() * 100);
const uddir = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-shot-"));
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const child = exec(`"${chrome}" --headless=new --remote-debugging-port=${PORT} --user-data-dir="${uddir}" --no-first-run --disable-gpu about:blank`, () => {});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function jrpc(ws, msg) {
  ws.send(JSON.stringify(msg));
  return new Promise((res) => {
    const on = (ev) => { const d = JSON.parse(ev.data); if (d.id === msg.id) { ws.removeEventListener("message", on); res(d); } };
    ws.addEventListener("message", on);
  });
}

// 等调试端口就绪
let ver;
for (let i = 0; i < 40; i++) {
  await sleep(500);
  try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch {}
}
if (!ver) { console.error("chrome 调试端口未就绪"); child.kill(); process.exit(1); }

const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

const { result: target } = await jrpc(ws, { id: 1, method: "Target.createTarget", params: { url } });
const { result: sess } = await jrpc(ws, { id: 2, method: "Target.attachToTarget", params: { targetId: target.targetId, flatten: true } });
const sid = sess.sessionId;
const call = (id, method, params = {}) => jrpc(ws, { id, method, params, sessionId: sid });

await call(3, "Page.enable");
await call(4, "Emulation.setDeviceMetricsOverride", { width: +W, height: 800, deviceScaleFactor: +SCALE, mobile: false });
await sleep(6000); // 图表渲染 + 字体

const h = await call(5, "Runtime.evaluate", { expression: "Math.ceil(document.documentElement.scrollHeight)", returnByValue: true });
if (!h.result || !h.result.result || h.result.result.value === undefined) { console.error("evaluate 失败:", JSON.stringify(h).slice(0, 500)); child.kill(); process.exit(1); }
const H = +CLIPH || h.result.result.value;
console.log(`页面真实高度 ${h.result.result.value}px → 截取 ${H}px @${SCALE}x`);

const shot = await call(6, "Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: +W, height: H, scale: 1 } });
fs.writeFileSync(out, Buffer.from(shot.result.data, "base64"));
console.log(`已保存 ${out} (${W * SCALE}x${H * SCALE}, ${(fs.statSync(out).size / 1024).toFixed(0)}KB)`);

ws.close(); child.kill();
process.exit(0);
