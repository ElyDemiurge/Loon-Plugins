/* -------------------------------------------------------------------------- */
/* 本地存储与 Tag 缓存                                                       */
/* -------------------------------------------------------------------------- */

// 从持久化存储中读取指定键名对应的值，运行环境不可用时返回 null。
function readStore(key) {
  try {
    if (typeof $persistentStore !== "undefined" && typeof $persistentStore.read === "function") {
      return $persistentStore.read(key);
    }
  } catch (error) {
    log("debug", "persistent read failed", error);
  }
  return null;
}

// 将指定值写入持久化存储，运行环境不可用时返回 false。
function writeStore(key, value) {
  try {
    if (typeof $persistentStore !== "undefined" && typeof $persistentStore.write === "function") {
      return $persistentStore.write(value, key);
    }
  } catch (error) {
    log("debug", "persistent write failed", error);
  }
  return false;
}

// 清理用于展示的关键词文本：去除零宽字符并合并多余的空白字符。
function cleanDisplayKeyword(value) {
  return String(value || "")
    .replace(/\u200b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// 合并多组关键词并去重，保留原始写法用于展示。
function mergeDisplayKeywords(...groups) {
  const result = [];
  const seen = new Set();
  for (const group of groups) {
    for (const value of group || []) {
      const keyword = cleanDisplayKeyword(value);
      if (!keyword) continue;
      const key = keyword.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(keyword);
    }
  }
  return result;
}


// 开屏创意缓存刷新入口（/splash/list）的 URL 特征。
// 该端点直接返回 "OK"（而非 JSON），让客户端解析失败从而不保留开屏创意缓存，
// 以此避免应用从后台切到前台时继续展示旧的开屏内容（与同一端点的最小响应策略保持一致）。
const SPLASH_LIST_URL_PATTERN = /\/x\/v2\/splash\/list\?/;
// /splash/show 与 /splash/event/list2 端点：只清空 show 或 event_list 字段，保留 splash_request_id 等其他字段不变。
const SPLASH_SHOW_EVENT_PATTERN = /\/x\/v2\/splash\/(?:show|event\/list2)\?/;

// 固定的 mock 响应字节（以十六进制硬编码，避免依赖 atob 或 Buffer）。
// 青少年模式关闭态：5 字节零前缀的 gRPC 帧，加上 ModeStatus（{mode: TEENAGERS, title: "teenagers", ...}）消息。
const TEENAGERS_MODE_OFF_BYTES = new Uint8Array([
  0x00, 0x00, 0x00, 0x00, 0x13, 0x0a, 0x11, 0x08, 0x02, 0x12, 0x09,
  0x74, 0x65, 0x65, 0x6e, 0x61, 0x67, 0x65, 0x72, 0x73, 0x20, 0x02, 0x2a, 0x00,
]);
// 交互式弹幕清空：空 gRPC 帧（5 字节均为零）。
const INTERACTIVE_DANMAKU_EMPTY_BYTES = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00]);
// 直播间电商购物信息的最小空 JSON 响应（code: -1 表示拒绝）。
const REJECT_RESPONSE_BODY = JSON.stringify({ code: -1, message: "", data: null });

// Tag 缓存的运行内存镜像，用于避免在同一次脚本执行过程中重复读取持久化存储。
let tagCacheMemo = null;
// 标记内存缓存是否有尚未写入持久化存储的变更。
let tagCacheDirty = false;

// 读取 Tag 缓存对象，首次访问时从持久化存储中加载并缓存到内存中。
function readTagCache() {
  if (tagCacheMemo) return tagCacheMemo;
  try {
    tagCacheMemo = JSON.parse(readStore(TAG_CACHE_KEY) || '{"items":{}}');
  } catch {
    tagCacheMemo = { items: {} };
  }
  return tagCacheMemo;
}

// 写入 Tag 缓存，同时更新运行内存中的镜像与持久化存储。
function writeTagCache(cache) {
  tagCacheMemo = cache;
  const written = writeStore(TAG_CACHE_KEY, JSON.stringify(cache));
  tagCacheDirty = false;
  return written;
}

// 淘汰过期与超限缓存：按更新时间保留最新的条目；批量抓取 Tag 时只在最终落盘前执行一次。
function pruneTagCache(cache, now = Date.now()) {
  const entries = Object.entries(cache.items || {})
    .filter(([, item]) => now - (item.updatedAt || 0) <= TAG_CACHE_TTL)
    .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
    .slice(0, TAG_CACHE_LIMIT);
  cache.items = Object.fromEntries(entries);
  return cache;
}

// 把本次执行中累积的 Tag 缓存变更合并写入持久化存储。
function flushTagCache(now = Date.now()) {
  if (!tagCacheDirty || !tagCacheMemo) return false;
  writeTagCache(pruneTagCache(tagCacheMemo, now));
  return true;
}

// 读取指定 aid 的缓存 Tag，缓存已过期或不存在时返回空数组。
function getCachedTags(aid) {
  if (!aid) return [];
  const cache = readTagCache();
  const item = cache.items?.[String(aid)];
  if (!item || Date.now() - (item.updatedAt || 0) > TAG_CACHE_TTL) return [];
  return Array.isArray(item.tags) ? item.tags : [];
}

// 保存指定 aid 的 Tag 缓存并返回缓存状态（新增、更新、未变更或跳过）；立即写入时会同步执行缓存裁剪。
function saveCachedTags(aid, tags, title, options = {}) {
  if (!aid || !tags.length) return { status: "skipped", tags: [] };
  const cache = readTagCache();
  const key = String(aid);
  const now = Date.now();
  const nextTags = uniqueStrings(tags);
  const previous = cache.items?.[key];
  const previousTags = Array.isArray(previous?.tags) ? previous.tags : [];
  const previousFresh = previous && now - (previous.updatedAt || 0) <= TAG_CACHE_TTL;
  const status = previousFresh
    ? (sameStringSet(previousTags, nextTags) ? "unchanged" : "updated")
    : "created";
  cache.items = cache.items || {};
  cache.items[key] = {
    tags: nextTags,
    title: title || cache.items[key]?.title || "",
    updatedAt: now,
  };
  tagCacheDirty = true;
  if (!options.deferCacheWrite) flushTagCache(now);
  return { status, tags: nextTags };
}

// 判断两个字符串集合所包含的元素是否完全一致。
function sameStringSet(left, right) {
  const a = uniqueStrings(left).sort();
  const b = uniqueStrings(right).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

// 同一次脚本执行内的 Tag 请求去重表，避免对同一 aid 重复发起远端接口请求。
const pendingTagRequests = {};

// 确保指定 aid 能够拿到可用的视频 Tag：优先读取缓存，缓存缺失时向远端发起请求并写入缓存。
async function ensureTagsForAid(aid, options = {}) {
  if (!aid || !arg.deepFilter) return [];
  const cachedTags = getCachedTags(aid);
  if (cachedTags.length) return cachedTags;
  if (!pendingTagRequests[aid]) {
    pendingTagRequests[aid] = fetchArchiveTags(aid)
      .then((tags) => {
        if (tags.length) saveCachedTags(aid, tags, "", { deferCacheWrite: true });
        return tags;
      })
      .catch((error) => {
        log("debug", "failed to fetch archive tags", aid, error);
        return [];
      })
      .finally(() => {
        delete pendingTagRequests[aid];
      });
  }
  const tags = await pendingTagRequests[aid];
  if (!options.deferCacheWrite) flushTagCache();
  return tags;
}

// 请求 Bilibili 远端视频标签接口，返回该视频的全部 Tag 列表。
async function fetchArchiveTags(aid) {
  const url = `https://api.bilibili.com/x/tag/archive/tags?aid=${encodeURIComponent(aid)}`;
  const text = await httpGetText(url);
  const json = JSON.parse(text);
  const data = Array.isArray(json?.data) ? json.data : [];
  const tags = uniqueStrings(data.map((item) => item?.tag_name || item?.name || item?.title));
  log("debug", "fetched archive tags", aid, tags);
  return tags;
}

// 发起一次文本 GET 请求，优先使用 Loon 运行时提供的 HTTP 客户端，其次回退到浏览器标准的 fetch API。
function httpGetText(url) {
  return new Promise((resolve, reject) => {
    if (typeof $httpClient !== "undefined" && typeof $httpClient.get === "function") {
      $httpClient.get({
        url,
        timeout: TAG_FETCH_TIMEOUT_MS,
        headers: {
          Accept: "application/json",
          "User-Agent": "bili-universal/89200100",
        },
      }, (error, response, body) => {
        if (error) return reject(error);
        const status = Number(response?.status || response?.statusCode || 200);
        if (status >= 400) return reject(new Error(`HTTP ${status}`));
        resolve(typeof body === "string" ? body : decoder.decode(toBytes(body)));
      });
      return;
    }

    if (typeof fetch === "function") {
      fetch(url, { headers: { Accept: "application/json" } })
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.text();
        })
        .then(resolve, reject);
      return;
    }

    reject(new Error("http client is unavailable"));
  });
}
