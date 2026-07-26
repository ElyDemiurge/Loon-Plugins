// core_modules/Common: persistent video-tag cache shared by iOS and iPadOS.

// Read a persistent value and return null when storage is unavailable.
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

// Write a persistent value and return false when storage is unavailable.
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

// Clean display keywords by removing zero-width characters and collapsing whitespace.
function cleanDisplayKeyword(value) {
  return String(value || "")
    .replace(/\u200b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Merge and deduplicate keyword groups while preserving display spelling.
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
// Returning plain "OK" for /splash/list prevents stale splash creatives from being retained.
const SPLASH_LIST_URL_PATTERN = /\/x\/v2\/splash\/list\?/;
// For /splash/show and /splash/event/list2, clear only the target list and preserve session fields.
const SPLASH_SHOW_EVENT_PATTERN = /\/x\/v2\/splash\/(?:show|event\/list2)\?/;

// Fixed hexadecimal mock bytes avoid relying on atob or Buffer.
// Teenager mode disabled: a five-byte gRPC prefix followed by a ModeStatus message.
const TEENAGERS_MODE_OFF_BYTES = new Uint8Array([
  0x00, 0x00, 0x00, 0x00, 0x13, 0x0a, 0x11, 0x08, 0x02, 0x12, 0x09,
  0x74, 0x65, 0x65, 0x6e, 0x61, 0x67, 0x65, 0x72, 0x73, 0x20, 0x02, 0x2a, 0x00,
]);
// Interactive danmaku disabled: an empty five-byte gRPC frame.
const INTERACTIVE_DANMAKU_EMPTY_BYTES = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00]);
// Minimal live-commerce rejection response.
const REJECT_RESPONSE_BODY = JSON.stringify({ code: -1, message: "", data: null });

// In-memory tag-cache mirror that avoids repeated persistent reads in one invocation.
let tagCacheMemo = null;
// Tracks whether the in-memory cache has unpersisted changes.
let tagCacheDirty = false;

// Load the tag cache from persistent storage on first access.
function readTagCache() {
  if (tagCacheMemo) return tagCacheMemo;
  try {
    tagCacheMemo = JSON.parse(readStore(TAG_CACHE_KEY) || '{"items":{}}');
  } catch {
    tagCacheMemo = { items: {} };
  }
  return tagCacheMemo;
}

// Update both the in-memory mirror and persistent tag cache.
function writeTagCache(cache) {
  tagCacheMemo = cache;
  const written = writeStore(TAG_CACHE_KEY, JSON.stringify(cache));
  tagCacheDirty = false;
  return written;
}

// Prune expired and excess entries, keeping the most recently updated values.
function pruneTagCache(cache, now = Date.now()) {
  const entries = Object.entries(cache.items || {})
    .filter(([, item]) => now - (item.updatedAt || 0) <= TAG_CACHE_TTL)
    .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
    .slice(0, TAG_CACHE_LIMIT);
  cache.items = Object.fromEntries(entries);
  return cache;
}

// Flush accumulated cache changes to persistent storage once.
function flushTagCache(now = Date.now()) {
  if (!tagCacheDirty || !tagCacheMemo) return false;
  writeTagCache(pruneTagCache(tagCacheMemo, now));
  return true;
}

// Read cached tags for an aid, returning an empty list when absent or expired.
function getCachedTags(aid) {
  if (!aid) return [];
  const cache = readTagCache();
  const item = cache.items?.[String(aid)];
  if (!item || Date.now() - (item.updatedAt || 0) > TAG_CACHE_TTL) return [];
  return Array.isArray(item.tags) ? item.tags : [];
}

// Save tags for an aid and return created, updated, unchanged, or skipped status.
function saveCachedTags(aid, tags, options = {}) {
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
    updatedAt: now,
  };
  tagCacheDirty = true;
  if (!options.deferCacheWrite) flushTagCache(now);
  return { status, tags: nextTags };
}

// Compare two string sets for exact equality.
function sameStringSet(left, right) {
  const a = uniqueStrings(left).sort();
  const b = uniqueStrings(right).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

// Deduplicate concurrent tag requests for the same aid.
const pendingTagRequests = {};

// Resolve tags from cache first, then fetch and cache them when missing.
async function ensureTagsForAid(aid, options = {}) {
  if (!aid || !arg.deepFilter) return [];
  const cachedTags = getCachedTags(aid);
  if (cachedTags.length) return cachedTags;
  if (!pendingTagRequests[aid]) {
    pendingTagRequests[aid] = fetchArchiveTags(aid)
      .then((tags) => {
        if (tags.length) saveCachedTags(aid, tags, { deferCacheWrite: true });
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

// Fetch all tags for a video from the Bilibili tag endpoint.
async function fetchArchiveTags(aid) {
  const url = `https://api.bilibili.com/x/tag/archive/tags?aid=${encodeURIComponent(aid)}`;
  const text = await httpGetText(url);
  const json = JSON.parse(text);
  const data = Array.isArray(json?.data) ? json.data : [];
  const tags = uniqueStrings(data.map((item) => item?.tag_name || item?.name || item?.title));
  log("debug", "fetched archive tags", aid, tags);
  return tags;
}

// Perform a text GET with Loon's client first and fetch as a fallback.
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
