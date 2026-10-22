/** PWA 整组发布静态检查：缓存版本、资源一致性、无逐文件后台覆盖。 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

const cache = sw.match(/const CACHE = "([^"]+)"/)?.[1];
assert.ok(cache && /^kaoyan-vocab-v\d+$/.test(cache), "缓存名必须带应用前缀与版本号");
const assetsBlock = sw.match(/const ASSETS = \[([\s\S]*?)\];/)?.[1] || "";
const assets = [...assetsBlock.matchAll(/"([^"]+)"/g)].map(m => m[1]);
assert.ok(assets.length > 10, "缓存清单应包含应用壳与词库");
for (const asset of assets) {
  const file = path.join(ROOT, asset.replace(/^\.\//, "").split("?")[0]);
  if (asset === "./") continue;
  assert.ok(fs.existsSync(file), "缓存资源必须存在：" + asset);
}
for (const asset of ["css/app.css", "js/app.js"]) {
  const inHtml = html.match(new RegExp('(?:href|src)="(' + asset.replaceAll(".", "\\.") + '\\?v=[^"]+)"'))?.[1];
  assert.ok(inHtml, "index.html 使用版本化资源：" + asset);
  assert.ok(assets.includes("./" + inHtml), "SW 清单与 HTML 版本参数一致：" + inHtml);
}
assert.doesNotMatch(sw, /cache\.put\s*\(/, "不得在 fetch 中逐文件覆盖当前版本缓存");
const installBlock = sw.match(/addEventListener\("install"[\s\S]*?\n\}\);/)?.[0] || "";
assert.doesNotMatch(installBlock, /skipWaiting/, "安装阶段不跳过等待");
assert.match(sw, /message[\s\S]*SKIP_WAITING[\s\S]*skipWaiting/, "仅显式消息可跳过等待");
assert.match(sw, /cache\.match\("\.\/index\.html"\)/, "导航固定使用缓存壳");
assert.match(html, /serviceWorker\.register\("sw\.js"\)/, "页面注册 Service Worker");
console.log("PASS  PWA 整组缓存与版本清单一致");
