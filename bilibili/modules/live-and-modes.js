/*
 * 处理直播页面、追踪参数、首页搜索页，以及青少年模式和交互式弹幕接口。
 */

/* -------------------------------------------------------------------------- */
/* 直播间广告清理                                                             */
/* -------------------------------------------------------------------------- */

// 直播信息流中承载卡片列表的常见字段名。
const LIVE_FEED_ARRAY_KEYS = ["card_list", "list", "items", "rooms"];
// 直播卡片中的广告标记：card_type 命中 ad、banner_card 或 cm_v2。
const LIVE_AD_CARD_TYPE_PATTERN = /(?:^|_)ad(?:_|$)|banner_card|cm_v2/i;
// 直播房间页中需要被删除的广告字段名。
const LIVE_ROOM_AD_KEYS = ["banner_info", "activity_banner_info", "shopping_card_info", "ad_banner_info"];

// 判断直播信息流中的卡片是否为广告。
function isLiveAdCard(card) {
  if (!card || typeof card !== "object") return false;
  const type = String(card.card_type || card.type || "");
  if (LIVE_AD_CARD_TYPE_PATTERN.test(type)) return true;
  return !!card.ad_info || card.is_ad === true || card.is_ad === 1;
}

// 创建直播间广告清理的统计对象。
function liveCleanupSummary() {
  return { feedAds: [], roomAdFields: [] };
}

// 生成直播间广告清理的系统通知副标题。
function liveNotifySubtitle(summary) {
  const parts = [];
  if (summary.feedAds.length) parts.push(`清理信息流广告 ${summary.feedAds.length}`);
  if (summary.roomAdFields.length) parts.push(`清理房间广告字段 ${summary.roomAdFields.length}`);
  return parts.length ? parts.join(" / ") : "未命中";
}

// 生成直播间广告清理的系统通知正文。
function liveNotifyMessage(summary) {
  if (!summary.feedAds.length && !summary.roomAdFields.length) return "未命中直播间广告";
  const lines = [];
  for (const item of summary.feedAds.slice(0, 5)) lines.push(`信息流广告：${item.title}`);
  for (const key of summary.roomAdFields) lines.push(`房间广告字段：${key}`);
  return lines.length ? lines.join("\n") : "未命中直播间广告";
}

// 处理直播间广告的 HTTP 响应：信息流响应中移除广告卡片，房间页响应中删除广告字段。
function handleLiveAdsResponse() {
  if (!arg.cleanLiveAds) {
    log("info", { page: "live", message: "switch off" });
    return $done({ response: $response });
  }

  const url = getRequestUrl();
  // 直播电商购物信息：直接返回空响应（reject）。
  if (/\/xlive\/e-commerce-interface\/v1\/ecommerce-user\/get_shopping_info\?/.test(url)) {
    setResponseBodyText(REJECT_RESPONSE_BODY);
    log("info", { page: "live", endpoint: "shoppingInfo", rejected: true });
    notify("remove", "Bilibili 直播间广告清理", "清理直播电商购物信息", "移除-直播间广告：电商购物信息");
    return $done({ response: $response });
  }

  const json = parseResponseJson();
  const data = json?.data;
  if (!data || typeof data !== "object") {
    log("info", { page: "live", message: "data not found" });
    return $done({ response: $response });
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
  $done({ response: $response });
}

/* -------------------------------------------------------------------------- */
/* 追踪参数（从声明式特性迁移为 JavaScript，支持开关控制）                   */
/* -------------------------------------------------------------------------- */

// pd-proxy/tracker 改写后的失效 STUN / 追踪服务器地址。
const PD_PROXY_DEAD_STUN = "stun.chat.bilibili.com:3478";

// 处理 pd-proxy/tracker 响应：将 data 下所有数组中的字符串元素改写为失效地址，阻断 WebRTC 追踪。
function handlePdProxyTrackerResponse() {
  if (!arg.blockTrackers) {
    log("info", { page: "pdProxy", message: "switch off" });
    return $done({ response: $response });
  }

  const json = parseResponseJson();
  const data = json?.data;
  if (!data || typeof data !== "object") {
    log("info", { page: "pdProxy", message: "data not found" });
    return $done({ response: $response });
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
  $done({ response: $response });
}

// 处理首页搜索页响应，移除热搜、搜索历史以及搜索发现等模块。
function handleSearchSquareResponse() {
  const json = parseResponseJson();
  if (!Array.isArray(json?.data)) {
    log("info", { page: "searchSquare", message: "data not found" });
    return $done({ response: $response });
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
  $done({ response: $response });
}

// 汇总搜索框推荐词的系统通知完整内容。
function searchDefaultWordsNotifyPayload(words, cleaned) {
  return {
    title: "Bilibili 搜索框推荐词移除",
    subtitle: cleaned ? `移除 ${words.length ? 1 : 0}` : "已关闭",
    message: cleaned ? "移除-首页搜索框里滚动的推荐词" : "搜索框推荐词移除开关已关闭",
  };
}

// 处理搜索框默认词（DefaultWords）的 gRPC 响应，根据功能开关清空默认词内容。
function handleSearchDefaultWordsResponse() {
  const message = decodeGrpcBody(getResponseBodyBytes());
  const fields = parseFields(message);
  const words = uniqueStrings([
    ...fieldStrings(fields, 3),
    ...fieldStrings(fields, 4),
  ]);

  if (arg.cleanSearchDefaultWords) {
    setResponseBodyBytes(encodeGrpcBody(new Uint8Array()));
  }

  const notifyPayload = searchDefaultWordsNotifyPayload(words, arg.cleanSearchDefaultWords);
  log("info", {
    page: "searchDefaultWords",
    cleaned: arg.cleanSearchDefaultWords,
    words,
  });
  notify(
    "remove",
    notifyPayload.title,
    notifyPayload.subtitle,
    notifyPayload.message
  );
  $done({ response: $response });
}

// 处理青少年模式（Teenagers/ModeStatus）的 gRPC 响应：开关开启时 mock 为关闭状态，避免出现青少年模式弹窗。
function handleTeenagersResponse() {
  if (!arg.cleanTeenagersMode) {
    log("info", { page: "teenagers", message: "switch off" });
    return $done({ response: $response });
  }

  setResponseBodyBytes(TEENAGERS_MODE_OFF_BYTES);
  log("info", { page: "teenagers", closed: true });
  notify("remove", "Bilibili 青少年模式", "已关闭青少年模式弹窗", "移除-青少年模式弹窗");
  $done({ response: $response });
}

// 处理交互式弹幕（TFInfo / PlayPause / ViewEndPage）的 gRPC 响应：开关开启时 mock 为空消息。
function handleInteractiveDanmakuResponse() {
  if (!arg.cleanInteractiveDanmaku) {
    log("info", { page: "interactiveDanmaku", message: "switch off" });
    return $done({ response: $response });
  }

  setResponseBodyBytes(INTERACTIVE_DANMAKU_EMPTY_BYTES);
  log("info", { page: "interactiveDanmaku", cleared: true });
  notify("remove", "Bilibili 交互式弹幕", "已移除交互式弹幕", "移除-交互式弹幕");
  $done({ response: $response });
}
