/** Execute the real service worker with CacheStorage/Fetch stubs. */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const origin = "https://vocab.test", base = origin + "/study/";
const handlers = new Map(), buckets = new Map(), installedRequests = [];
let skipCount = 0, claimCount = 0, writeGate = null, failWrites = false;
let fetcher = async req => new Response("installed " + req.url);
class WorkerRequest extends Request {
  constructor(input, options) { super(typeof input === "string" ? new URL(input, base) : input, options); }
}
const keyOf = req => typeof req === "string" ? new URL(req, base).href : req.url;
function bucket(name) {
  if (!buckets.has(name)) {
    const values = new Map();
    buckets.set(name, {
      values,
      async match(req) { return values.get(keyOf(req))?.clone(); },
      async put(req, res) {
        if (writeGate) await writeGate;
        if (failWrites) throw new Error("quota exceeded");
        values.set(keyOf(req), res.clone());
      },
      async addAll(requests) {
        installedRequests.push(...requests);
        const fetched = await Promise.all(requests.map(async req => {
          const res = await fetcher(req);
          if (!res.ok) throw new Error("failed install");
          return [req, res];
        }));
        for (const [req, res] of fetched) values.set(keyOf(req), res);
      }
    });
  }
  return buckets.get(name);
}
const self = {
  location: {origin}, clients: {async claim() { claimCount++; }},
  async skipWaiting() { skipCount++; },
  addEventListener(name, fn) { handlers.set(name, fn); }
};
vm.runInNewContext(fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8"), {
  self, URL, Request: WorkerRequest, fetch: req => fetcher(req),
  caches: {
    async open(name) { return bucket(name); },
    async keys() { return [...buckets.keys()]; },
    async delete(name) { return buckets.delete(name); }
  }
}, {filename: "sw.js"});
function emit(name, extra = {}) {
  const event = {waited: [], waitUntil(p) { this.waited.push(Promise.resolve(p)); },
    respondWith(p) { this.response = Promise.resolve(p); }, ...extra};
  handlers.get(name)(event);
  return event;
}
const lifecycle = event => Promise.all(event.waited);
const read = async (cache, path) => (await cache.match(new WorkerRequest(path)))?.text();

bucket("kaoyan-vocab-v6"); bucket("other-app-cache");
await lifecycle(emit("install"));
assert.equal(skipCount, 0, "安装完成只进入等待，不立即接管当前会话");
assert.ok(installedRequests.length > 10);
assert.ok(installedRequests.every(req => req.cache === "reload"), "安装绕过旧 HTTP 缓存");
const names = [...buckets.keys()];
const currentName = names.find(name => name.startsWith("kaoyan-vocab-") && name !== "kaoyan-vocab-v6");
assert.ok(currentName); const current = bucket(currentName);
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const versionedAssets = [];
for (const path of ["css/app.css", "js/app.js"]) {
  const asset = html.match(new RegExp('(?:href|src)="(' + path.replaceAll(".", "\\.") + '\\?v=[^"]+)"'))?.[1];
  assert.ok(asset, "HTML 中存在版本资源 " + path);
  versionedAssets.push(asset);
  assert.ok(await current.match(new WorkerRequest(asset)), "离线包含与 HTML 一致的版本资源");
}
await lifecycle(emit("activate"));
assert.equal(buckets.has("kaoyan-vocab-v6"), false, "清理本应用旧版缓存");
assert.equal(buckets.has("other-app-cache"), true, "保留同源其它应用缓存");
assert.equal(claimCount, 1);

const asset = versionedAssets[0], req = new WorkerRequest(asset);
await current.put(req, new Response("old stylesheet"));
let networkCalls = 0;
fetcher = async () => { networkCalls++; return new Response("new stylesheet"); };
const hit = emit("fetch", {request: req});
assert.equal(await (await hit.response).text(), "old stylesheet", "同版本缓存命中直接返回");
await lifecycle(hit);
assert.equal(networkCalls, 0, "缓存命中不后台覆盖，避免同一会话混用资源");
assert.equal(await read(current, asset), "old stylesheet", "当前版本资源保持不变");

fetcher = async () => { throw new Error("offline"); };
const offline = emit("fetch", {request: req});
assert.equal(await (await offline.response).text(), "old stylesheet", "离线回退到整组缓存");
await lifecycle(offline);

const fresh = new WorkerRequest("fresh-resource.js");
fetcher = async () => new Response("fresh resource");
const online = emit("fetch", {request: fresh});
assert.equal(await (await online.response).text(), "fresh resource", "未缓存请求从网络返回");
await lifecycle(online);
assert.equal(await current.match(fresh), undefined, "未预缓存资源不写入当前版本缓存");

const bad = new WorkerRequest("error.js");
fetcher = async () => new Response("unavailable", {status: 503});
const failed = emit("fetch", {request: bad});
assert.equal((await failed.response).status, 503);
await lifecycle(failed);

const foreign = new WorkerRequest("foreign.js");
await bucket("other-app-cache").put(foreign, new Response("foreign stale payload"));
fetcher = async () => { throw new Error("offline"); };
const isolated = emit("fetch", {request: foreign});
await assert.rejects(isolated.response, /offline/, "不从其它应用缓存读取内容");
await lifecycle(isolated);

const navigation = new WorkerRequest(base);
Object.defineProperty(navigation, "mode", { value: "navigate" });
const navHit = emit("fetch", {request: navigation});
assert.match(await (await navHit.response).text(), /index\.html/, "导航读取整组缓存中的 index.html");
await lifecycle(navHit);

const beforeFailure = skipCount;
await assert.rejects(lifecycle(emit("install")), /offline/);
assert.equal(skipCount, beforeFailure, "安装失败不跳过等待阶段");
handlers.get("message")({data: {type: "SKIP_WAITING"}});
assert.equal(skipCount, beforeFailure + 1, "仅显式更新消息才跳过等待");
for (const request of [new WorkerRequest("https://other.test/file.js"), new WorkerRequest("submit", {method: "POST"})]) {
  const untouched = emit("fetch", {request});
  assert.equal(untouched.response, undefined, "跨源和非 GET 请求不拦截");
  assert.equal(untouched.waited.length, 0);
}
console.log("PASS offline review: whole-group install, version cache, offline fallback, isolation");
