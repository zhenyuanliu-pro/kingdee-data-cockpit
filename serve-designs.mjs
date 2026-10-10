// 驾驶舱常驻服务（固定链接 http://localhost:4311/）
// - 仅绑定本机回环地址，不触发防火墙弹窗
// - index.html 不缓存：数据更新后刷新页面即最新
// - 端口被占用时静默退出（计划任务重复启动不会报错堆积）
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.dirname(path.resolve(decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1")));
const port = +(process.argv[2] || 4311);
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const file = path.join(ROOT, url === "/" ? path.join("designs", process.env.COCKPIT_DIR || "cockpit", "index.html") : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end("404"); return;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(file).pipe(res);
});

server.on("error", (e) => { if (e.code === "EADDRINUSE") { console.log("port in use, exit"); process.exit(0); } throw e; });
server.listen(port, "127.0.0.1", () => console.log(`cockpit: http://localhost:${port}/`));
