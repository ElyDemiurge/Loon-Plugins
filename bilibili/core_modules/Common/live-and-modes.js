/*
 * core_modules/Common: live, tracking, search-page, and mode handlers shared by both platforms.
 * Covers live pages, tracking parameters, home search, teenager mode, and interactive danmaku.
 */

/* -------------------------------------------------------------------------- */
/* Live-room advertisement cleanup                                            */
/* -------------------------------------------------------------------------- */

// Common field names that contain live-feed cards.
const LIVE_FEED_ARRAY_KEYS = ["card_list", "list", "items", "rooms"];
// Advertisement markers used by live cards.
const LIVE_AD_CARD_TYPE_PATTERN = /(?:^|_)ad(?:_|$)|banner_card|cm_v2/i;
// Advertisement fields removed from live-room responses.
const LIVE_ROOM_AD_KEYS = ["banner_info", "activity_banner_info", "shopping_card_info", "ad_banner_info"];

// Detect an advertisement card in the live feed.
function isLiveAdCard(card) {
  if (!card || typeof card !== "object") return false;
  const type = String(card.card_type || card.type || "");
  if (LIVE_AD_CARD_TYPE_PATTERN.test(type)) return true;
  return !!card.ad_info || card.is_ad === true || card.is_ad === 1;
}

// Create live-ad cleanup statistics.
function liveCleanupSummary() {
  return { feedAds: [], roomAdFields: [] };
}

// Build the live-ad notification subtitle.
function liveNotifySubtitle(summary) {
  const parts = [];
  if (summary.feedAds.length) parts.push(`清理信息流广告 ${summary.feedAds.length}`);
  if (summary.roomAdFields.length) parts.push(`清理房间广告字段 ${summary.roomAdFields.length}`);
  return parts.length ? parts.join(" / ") : "未命中";
}

// Build the live-ad notification message.
function liveNotifyMessage(summary) {
  if (!summary.feedAds.length && !summary.roomAdFields.length) return "未命中直播间广告";
  const lines = [];
  for (const item of summary.feedAds.slice(0, 5)) lines.push(`信息流广告：${item.title}`);
  for (const key of summary.roomAdFields) lines.push(`房间广告字段：${key}`);
  return lines.length ? lines.join("\n") : "未命中直播间广告";
}

// Remove advertisement cards from live feeds and advertisement fields from room responses.
function handleLiveAdsResponse() {
  if (!arg.cleanLiveAds) {
    log("info", { page: "live", message: "switch off" });
    return finishUnchanged();
  }

  const url = getRequestUrl();
  // Return the minimal rejection response for live-commerce shopping data.
  if (/\/xlive\/e-commerce-interface\/v1\/ecommerce-user\/get_shopping_info\?/.test(url)) {
    setResponseBodyText(REJECT_RESPONSE_BODY);
    log("info", { page: "live", endpoint: "shoppingInfo", rejected: true });
    notify("remove", "Bilibili 直播间广告清理", "清理直播电商购物信息", "移除-直播间广告：电商购物信息");
    return finishResponse();
  }

  const json = parseResponseJson();
  const data = json?.data;
  if (!data || typeof data !== "object") {
    log("info", { page: "live", message: "data not found" });
    return finishResponse();
  }

  const summary = liveCleanupSummary();
  if (/\/xlive\/app-interface\/v2\/index\/feed\?/.test(url)) {
    for (const key of LIVE_FEED_ARRAY_KEYS) {
      if (!Array.isArray(data[key])) continue;
      const kept = [];
      for (const card of data[key]) {
        if (isLiveAdCard(card)) {
          summary.feedAds.push({ title: String(card.card_type || card.type || "直播广告") });
          continue;
        }
        kept.push(card);
      }
      data[key] = kept;
    }
  } else {
    for (const key of LIVE_ROOM_AD_KEYS) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        summary.roomAdFields.push(key);
        delete data[key];
      }
    }
  }

  setResponseBodyText(JSON.stringify(json));
  log("info", { page: "live", ...summary });
  notify(
    "remove",
    "Bilibili 直播间广告清理",
    liveNotifySubtitle(summary),
    liveNotifyMessage(summary)
  );
  finishResponse();
}

/* -------------------------------------------------------------------------- */
/* Tracking parameters controlled by JavaScript switches                      */
/* -------------------------------------------------------------------------- */

// Disabled STUN and tracking endpoint used to rewrite pd-proxy/tracker data.
const PD_PROXY_DEAD_STUN = "stun.chat.bilibili.com:3478";

// Rewrite string values in pd-proxy/tracker arrays to disable WebRTC tracking.
function handlePdProxyTrackerResponse() {
  if (!arg.blockTrackers) {
    log("info", { page: "pdProxy", message: "switch off" });
    return finishUnchanged();
  }

  const json = parseResponseJson();
  const data = json?.data;
  if (!data || typeof data !== "object") {
    log("info", { page: "pdProxy", message: "data not found" });
    return finishResponse();
  }

  let rewritten = 0;
  for (const key of Object.keys(data)) {
    if (!Array.isArray(data[key])) continue;
    for (let index = 0; index < data[key].length; index += 1) {
      if (typeof data[key][index] === "string") {
        data[key][index] = PD_PROXY_DEAD_STUN;
        rewritten += 1;
      }
    }
  }

  setResponseBodyText(JSON.stringify(json));
  log("info", { page: "pdProxy", rewritten });
  notify(
    "remove",
    "Bilibili 追踪参数清理",
    rewritten ? `改写追踪服务器 ${rewritten}` : "未命中追踪参数",
    rewritten ? "屏蔽-追踪与数据上报：已改写 STUN/追踪服务器" : "未命中追踪参数"
  );
  finishResponse();
}

// Handle the home-search response and remove configured modules.
function handleSearchSquareResponse() {
  const json = parseResponseJson();
  if (!Array.isArray(json?.data)) {
    log("info", { page: "searchSquare", message: "data not found" });
    return finishResponse();
  }

  const removedModules = [];
  const nextModules = [];
  for (const module of json.data) {
    const type = searchSquareModuleType(module);
    const config = SEARCH_SQUARE_MODULES[type];
    if (config?.enabled()) {
      removedModules.push({ type, label: config.label, shortLabel: config.shortLabel });
      continue;
    }
    nextModules.push(module);
  }

  json.data = nextModules;
  setResponseBodyText(JSON.stringify(json));
  const notifyPayload = searchSquareNotifyPayload(nextModules, removedModules);
  log("info", {
    page: "searchSquare",
    kept: nextModules.length,
    removed: removedModules.map((item) => item.type),
  });
  notify(
    "remove",
    notifyPayload.title,
    notifyPayload.subtitle,
    notifyPayload.message
  );
  finishResponse();
}

// Build the complete default-search-word notification payload.
function searchDefaultWordsNotifyPayload(words, cleaned) {
  return {
    title: "Bilibili 搜索框推荐词移除",
    subtitle: cleaned ? `移除 ${words.length ? 1 : 0}` : "已关闭",
    message: cleaned ? "移除-首页搜索框里滚动的推荐词" : "搜索框推荐词移除开关已关闭",
  };
}

// Handle DefaultWords and clear its content when enabled.
function handleSearchDefaultWordsResponse() {
  if (!arg.cleanSearchDefaultWords) {
    log("info", { page: "searchDefaultWords", message: "switch off" });
    return finishUnchanged();
  }

  const message = decodeGrpcBody(getResponseBodyBytes());
  const fields = parseFields(message);
  const words = uniqueStrings([
    ...fieldStrings(fields, 3),
    ...fieldStrings(fields, 4),
  ]);

  setResponseBodyBytes(encodeGrpcBody(new Uint8Array()));

  const notifyPayload = searchDefaultWordsNotifyPayload(words, true);
  log("info", {
    page: "searchDefaultWords",
    cleaned: true,
    words,
  });
  notify(
    "remove",
    notifyPayload.title,
    notifyPayload.subtitle,
    notifyPayload.message
  );
  finishResponse();
}

// Mock Teenagers/ModeStatus as disabled when the corresponding switch is enabled.
function handleTeenagersResponse() {
  if (!arg.cleanTeenagersMode) {
    log("info", { page: "teenagers", message: "switch off" });
    return finishUnchanged();
  }

  setResponseBodyBytes(TEENAGERS_MODE_OFF_BYTES);
  log("info", { page: "teenagers", closed: true });
  notify("remove", "Bilibili 青少年模式", "已关闭青少年模式弹窗", "移除-青少年模式弹窗");
  finishResponse();
}

// Mock interactive-danmaku responses as an empty gRPC message when enabled.
function handleInteractiveDanmakuResponse() {
  if (!arg.cleanInteractiveDanmaku) {
    log("info", { page: "interactiveDanmaku", message: "switch off" });
    return finishUnchanged();
  }

  setResponseBodyBytes(INTERACTIVE_DANMAKU_EMPTY_BYTES);
  log("info", { page: "interactiveDanmaku", cleared: true });
  notify("remove", "Bilibili 交互式弹幕", "已移除交互式弹幕", "移除-交互式弹幕");
  finishResponse();
}
