// core_modules/Common: splash, startup-resource, and JSON handlers shared by both platforms.
/* -------------------------------------------------------------------------- */
/* Splash, startup-resource, and personalization handlers                     */
/* -------------------------------------------------------------------------- */

// Array fields that must be cleared from splash-ad responses.
const SPLASH_ARRAY_KEYS = [
  "show",
  "list",
  "event_list",
  "keep_ids",
  "preload",
  "query_list",
  "brand_list",
  "splash_list",
  "ad_list",
  "card_list",
  "material_list",
  "force_list",
  "topview_list",
  "top_view_list",
];
// Numeric splash-ad fields reset to zero.
const SPLASH_NUMERIC_KEYS = [
  "max_time",
  "min_interval",
  "pull_interval",
  "list_update_time",
  "last_show_time",
  "cold_start_interval",
  "hot_start_interval",
  "show_interval",
  "force_show_times",
];
// String splash-ad fields reset to an empty string.
const SPLASH_STRING_KEYS = [
  "splash_request_id",
  "new_splash_hash",
  "show_hash",
];
// Boolean splash-ad fields reset to false.
const SPLASH_BOOLEAN_KEYS = [
  "has_new_splash_set",
  "forcibly",
];
// User-facing labels for splash-ad arrays used in cleanup summaries.
const SPLASH_ITEM_SOURCES = [
  ["show", "展示"],
  ["list", "素材"],
  ["event_list", "活动"],
  ["preload", "预加载"],
  ["query_list", "候选"],
  ["brand_list", "品牌"],
  ["splash_list", "开屏"],
  ["ad_list", "广告"],
  ["card_list", "卡片"],
  ["material_list", "素材"],
  ["force_list", "强制"],
  ["topview_list", "TopView"],
  ["top_view_list", "TopView"],
];

// Read splash_content when present, otherwise use the outer item.
function splashContent(item) {
  return item?.splash_content && typeof item.splash_content === "object" ? item.splash_content : item;
}

// Normalize and decode a splash advertisement target URL.
function splashTarget(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  try {
    const decoded = decodeURIComponent(text);
    return decoded || text;
  } catch {}

  return text;
}

// Summarize one splash item with its source, ID, title, and target.
function splashItemSummary(item, source) {
  const content = splashContent(item) || {};
  const guides = Array.isArray(content.guide_button_list)
    ? content.guide_button_list.map((guide) => guide?.guide_instructions_new || guide?.guide_instructions)
    : [];
  const downloadNames = Array.isArray(content.extra?.download_whitelist)
    ? content.extra.download_whitelist.map((download) => download?.display_name || download?.apk_name)
    : [];
  const title = firstNonEmpty([
    content.schema_title_new,
    content.schema_title,
    content.uri_title,
    ...downloadNames,
    ...guides,
  ]);
  const target = firstNonEmpty([
    content.schema_package_name,
    splashTarget(content.universal_app),
    splashTarget(content.schema),
    splashTarget(content.uri),
  ]);
  const id = content.id || item?.id || "-";
  return {
    source,
    id,
    title: title || "开屏广告",
    target,
    details: {
      schema_package_name: content.schema_package_name || "",
      universal_app: splashTarget(content.universal_app),
      schema: splashTarget(content.schema),
      uri: splashTarget(content.uri),
      ad_cb: content.ad_cb || item?.ad_cb || "",
    },
  };
}

// Build the splash-ad notification message.
function splashItemsMessage(items) {
  const lines = items
    .slice(0, 8)
    .map((item, index) => `${index + 1}、id ${item.id}：${item.title}`);
  if (items.length > 8) lines.push(`...另有 ${items.length - 8} 项`);
  return lines.length ? `移除-开屏广告：\n${lines.join("\n")}` : "未命中开屏广告";
}

// Build the complete splash-ad notification payload.
function splashNotifyPayload(summary, removedItems, cleaned) {
  const extra = [];
  if (summary.eventList) extra.push(`清理活动 ${summary.eventList}`);
  return {
    title: "Bilibili 开屏广告清理",
    subtitle: cleaned
      ? [`清理展示 ${summary.show} / 清理素材 ${summary.list}`, ...extra].join(" / ")
      : "已关闭",
    message: cleaned ? splashItemsMessage(removedItems) : "开屏广告清理开关已关闭",
  };
}

// Count items in one splash-ad array field.
function splashArrayCount(data, key) {
  return Array.isArray(data?.[key]) ? data[key].length : 0;
}

// Clear splash fields used for display, caching, and background wake-up.
function clearSplashData(data) {
  for (const key of SPLASH_ARRAY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(data, key)) data[key] = [];
  }
  for (const key of SPLASH_NUMERIC_KEYS) {
    if (Object.prototype.hasOwnProperty.call(data, key)) data[key] = 0;
  }
  for (const key of SPLASH_STRING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(data, key)) data[key] = "";
  }
  for (const key of SPLASH_BOOLEAN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(data, key)) data[key] = false;
  }
}

// Collect summaries for all splash materials about to be removed.
function splashRemovedItems(data) {
  return SPLASH_ITEM_SOURCES.flatMap(([key, source]) => {
    if (!Array.isArray(data?.[key])) return [];
    return data[key]
      .filter((item) => item && typeof item === "object")
      .map((item) => splashItemSummary(item, source));
  });
}

// Count splash materials by category, returning zeroes for missing structures.
function splashResponseSummary(data) {
  return {
    show: splashArrayCount(data, "show"),
    list: splashArrayCount(data, "list"),
    eventList: splashArrayCount(data, "event_list"),
    keepIds: splashArrayCount(data, "keep_ids"),
    preload: splashArrayCount(data, "preload"),
    queryList: splashArrayCount(data, "query_list"),
    brandList: splashArrayCount(data, "brand_list"),
    splashList: splashArrayCount(data, "splash_list"),
    adList: splashArrayCount(data, "ad_list"),
    cardList: splashArrayCount(data, "card_list"),
    materialList: splashArrayCount(data, "material_list"),
    forceList: splashArrayCount(data, "force_list"),
    topviewList: splashArrayCount(data, "topview_list") + splashArrayCount(data, "top_view_list"),
  };
}

// Handle splash-ad HTTP responses according to the cleanup switch.
function handleSplashResponse() {
  if (!arg.cleanSplashAds) {
    log("info", { page: "splash", message: "switch off" });
    return finishUnchanged();
  }

  const url = getRequestUrl();

  // Blocking /splash/list is independent of upstream format; parsing only enriches diagnostics.
  if (SPLASH_LIST_URL_PATTERN.test(url)) {
    let data = null;
    try {
      const json = parseResponseJson();
      if (json?.data && typeof json.data === "object") data = json.data;
    } catch (error) {
      log("debug", "failed to parse splash list response before blocking", error);
    }
    const summary = splashResponseSummary(data);
    const removedItems = data ? splashRemovedItems(data) : [];
    setResponseBodyText("OK");
    const notifyPayload = splashNotifyPayload(summary, removedItems, true);
    log("info", { page: "splash", endpoint: "list", cleaned: true, summary, removedItems });
    notify("remove", notifyPayload.title, notifyPayload.subtitle, notifyPayload.message);
    return finishResponse();
  }

  const json = parseResponseJson();
  const data = json?.data;
  if (!data || typeof data !== "object") {
    log("info", { page: "splash", message: "data not found" });
    return finishResponse();
  }

  const summary = splashResponseSummary(data);
  const removedItems = splashRemovedItems(data);

  if (SPLASH_SHOW_EVENT_PATTERN.test(url)) {
    // For /splash/show and /splash/event/list2, clear only show or event_list.
    // Preserve session fields so missing data does not trigger a local-cache fallback.
    if (Array.isArray(data.show)) data.show = [];
    if (Array.isArray(data.event_list)) data.event_list = [];
    setResponseBodyText(JSON.stringify(json));
  } else {
    clearSplashData(data);
    setResponseBodyText(JSON.stringify(json));
  }
  const notifyPayload = splashNotifyPayload(summary, removedItems, true);
  log("info", {
    page: "splash",
    cleaned: true,
    summary,
    removedItems,
  });
  notify(
    "remove",
    notifyPayload.title,
    notifyPayload.subtitle,
    notifyPayload.message
  );
  finishResponse();
}

// URI pattern for startup activity tabs.
const STARTUP_ACTIVITY_TAB_PATTERN = /\/home_activity_tab\//i;
// Preloaded promotion resource types removed during startup.
const STARTUP_PEAK_RESOURCE_TYPES = new Set(["brand_splash", "egg"]);
// Stable IDs and URI pattern for the home-page game-center button.
const HOME_GAME_BUTTON_IDS = new Set([3500]);
const HOME_GAME_BUTTON_URI_PATTERN = /^bilibili:\/\/(?:game_center|game)(?:\/|$)/i;
// Name pattern for removable bottom-bar buttons.
const BOTTOM_EXTRA_BUTTON_NAME_PATTERN = /^(?:\+|＋|加号|发布|投稿|会员购)$/;
// URI pattern for removable bottom-bar buttons.
const BOTTOM_EXTRA_BUTTON_URI_PATTERN = /(?:bilibili:\/\/(?:mall|shopping)|\/mall(?:\/|$)|bmall|会员购|add_archive|archive_selection|publish|creation\/center|uper\/user_center)/i;
// Create startup-resource cleanup statistics.
function startupAdsSummary() {
  return {
    activityTabs: [],
    homeGameButtons: [],
    homeTopTabs: [],
    bottomButtons: [],
    skinEquips: 0,
    peakResources: [],
  };
}

// Summarize one activity tab for display.
function startupTabSummary(item) {
  return {
    id: item?.id || "-",
    name: firstNonEmpty([item?.name, item?.tab_id, item?.uri]) || "活动入口",
    uri: item?.uri || "",
  };
}

// Summarize one bottom-bar button for display.
function bottomButtonSummary(item) {
  return {
    id: item?.id || "-",
    name: firstNonEmpty([item?.name, item?.tab_id, item?.uri]) || "底部按钮",
    uri: item?.uri || "",
  };
}

// Summarize one home-page top entry or tab.
function homeEntrySummary(item, fallbackName) {
  return {
    id: item?.id || "-",
    name: firstNonEmpty([item?.name, item?.tab_id, item?.uri]) || fallbackName,
    uri: item?.uri || "",
  };
}

// Detect the game-center button using stable captured IDs and URIs.
function isHomeGameButton(item) {
  const id = Number(item?.id);
  const name = String(firstNonEmpty([item?.name, item?.tab_id]) || "").trim();
  const uri = String(item?.uri || "").trim();
  return HOME_GAME_BUTTON_IDS.has(id)
    || HOME_GAME_BUTTON_URI_PATTERN.test(uri)
    || /^(?:游戏中心|游戏中心Top)$/.test(name);
}

// Detect a removable bottom-bar button.
function isBottomExtraButton(item) {
  const name = String(firstNonEmpty([item?.name, item?.tab_id]) || "").trim();
  const uri = String(item?.uri || "");
  return BOTTOM_EXTRA_BUTTON_NAME_PATTERN.test(name) || BOTTOM_EXTRA_BUTTON_URI_PATTERN.test(uri);
}

// Remove activity entries from the startup tab list.
function cleanStartupTabData(data, summary) {
  if (!Array.isArray(data?.tab)) return;
  const kept = [];
  for (const item of data.tab) {
    if (STARTUP_ACTIVITY_TAB_PATTERN.test(String(item?.uri || ""))) {
      summary.activityTabs.push(startupTabSummary(item));
      continue;
    }
    kept.push(item);
  }
  data.tab = kept;
}

// Remove the game-center entry next to the home-page message button.
function cleanHomeGameButtonData(data, summary) {
  if (!Array.isArray(data?.top)) return;
  const kept = [];
  for (const item of data.top) {
    if (isHomeGameButton(item)) {
      summary.homeGameButtons.push(homeEntrySummary(item, "游戏中心"));
      continue;
    }
    kept.push(item);
  }
  data.top = kept;
}

// Remove extra bottom-bar buttons.
function cleanBottomExtraButtonsData(data, summary) {
  if (!Array.isArray(data?.bottom)) return;
  const kept = [];
  for (const item of data.bottom) {
    if (isBottomExtraButton(item)) {
      summary.bottomButtons.push(bottomButtonSummary(item));
      continue;
    }
    kept.push(item);
  }
  data.bottom = kept;
}

// Remove startup skin fields.
function cleanStartupSkinData(data, summary) {
  if (!data || typeof data !== "object") return;
  if (Object.prototype.hasOwnProperty.call(data, "common_equip")) {
    const value = data.common_equip;
    summary.skinEquips += Array.isArray(value) ? value.length : (value ? 1 : 0);
    delete data.common_equip;
  }
}

// Clear preloaded startup promotion resources.
function cleanStartupPeakData(data, summary) {
  if (!Array.isArray(data?.resource)) return;
  for (const resource of data.resource) {
    const type = String(resource?.type || "");
    if (!STARTUP_PEAK_RESOURCE_TYPES.has(type)) continue;
    const removed = Array.isArray(resource.list) ? resource.list.length : 0;
    if (removed > 0) summary.peakResources.push({ type, count: removed });
    resource.list = [];
  }
}

// Build the startup-resource notification message.
function startupAdsMessage(summary, cleaned) {
  if (!cleaned) return "软件启动时推广资源清理开关已关闭";

  const lines = [];
  for (const item of summary.activityTabs.slice(0, 6)) {
    lines.push(`活动 Tab：${item.name}`);
  }
  if (summary.activityTabs.length > 6) lines.push(`活动 Tab：另有 ${summary.activityTabs.length - 6} 项`);
  if (summary.skinEquips) lines.push(`皮肤装扮：${summary.skinEquips} 项`);
  for (const item of summary.peakResources) {
    lines.push(`预加载资源 ${item.type}：${item.count} 项`);
  }
  return lines.length ? lines.join("\n") : "未命中软件启动时推广资源";
}

// Build the complete startup-resource notification payload.
function startupAdsNotifyPayload(summary, cleaned) {
  const peakCount = summary.peakResources.reduce((total, item) => total + item.count, 0);
  return {
    title: "Bilibili 软件启动时推广资源清理",
    subtitle: cleaned
      ? `清理活动 Tab ${summary.activityTabs.length} / 清理皮肤 ${summary.skinEquips} / 清理预加载资源 ${peakCount}`
      : "已关闭",
    message: startupAdsMessage(summary, cleaned),
  };
}

// Summarize home-entry removals while respecting separate activity and game-button switches.
function homeEntryRemoveNotifyPayload(summary, cleanStartupAds, cleanHomeGameButton) {
  const subtitle = [
    cleanStartupAds ? `清理活动 Tab ${summary.activityTabs.length}` : "活动 Tab 清理已关闭",
    cleanHomeGameButton ? `清理游戏按钮 ${summary.homeGameButtons.length}` : "游戏按钮清理已关闭",
  ].join(" / ");
  const lines = [];
  if (cleanStartupAds) {
    for (const item of summary.activityTabs) lines.push(`活动 Tab：${item.name}`);
  }
  if (cleanHomeGameButton) {
    for (const item of summary.homeGameButtons) lines.push(`游戏按钮：${item.name}`);
  }
  return {
    title: "Bilibili 首页入口清理",
    subtitle,
    message: lines.length
      ? lines.join("\n")
      : (cleanStartupAds || cleanHomeGameButton ? "未命中首页活动入口或游戏按钮" : "首页入口清理开关已关闭"),
  };
}

// Build the bottom-bar cleanup notification message.
function personalizationMessage(summary, cleanHomeTopTabs, cleanBottomExtraButtons) {
  if (!cleanHomeTopTabs && !cleanBottomExtraButtons) return "首页个性化清理开关已关闭";
  const lines = [];
  if (cleanHomeTopTabs && summary.homeTopTabs.length) {
    lines.push(`顶部分区：${summary.homeTopTabs.map((item) => item.name).join("、")}`);
  }
  if (cleanBottomExtraButtons && summary.bottomButtons.length) {
    lines.push(`底部按钮：${summary.bottomButtons.map((item) => item.name).join("、")}`);
  }
  return lines.length ? lines.join("\n") : "未命中首页个性化清理项";
}

// Build the top-tab and bottom-bar personalization notification payload.
function personalizationNotifyPayload(
  summary,
  cleanHomeTopTabs,
  cleanBottomExtraButtons,
  homeTopTabsSupported = true
) {
  return {
    title: "Bilibili 个性化清理",
    subtitle: [
      !homeTopTabsSupported
        ? "顶部分区仅适用于 iOS"
        : (cleanHomeTopTabs ? `清理顶部分区 ${summary.homeTopTabs.length}` : "顶部分区精简已关闭"),
      cleanBottomExtraButtons ? `清理底部按钮 ${summary.bottomButtons.length}` : "底部按钮清理已关闭",
    ].join(" / "),
    message: personalizationMessage(summary, cleanHomeTopTabs, cleanBottomExtraButtons),
  };
}

// Handle startup-resource HTTP responses according to URL-specific structures.
function handleStartupAdsResponse() {
  const json = parseResponseJson();
  const data = json?.data;
  if (!data || typeof data !== "object") {
    log("info", { page: "startupAds", message: "data not found" });
    return finishResponse();
  }

  const url = getRequestUrl();
  const summary = startupAdsSummary();
  const isTabResource = /\/x\/resource\/show\/tab\/v2\?/.test(url);
  const supportsIosHomeTopTabs = isIosHomeTopTabsRequest(url);
  const cleanIosHomeTopTabs = supportsIosHomeTopTabs && arg.cleanHomeTopTabs;
  if (arg.cleanStartupAds) {
    if (isTabResource) cleanStartupTabData(data, summary);
    if (/\/x\/resource\/show\/skin\?/.test(url)) cleanStartupSkinData(data, summary);
    if (/\/x\/resource\/peak\/download\?/.test(url)) cleanStartupPeakData(data, summary);
  }
  if (isTabResource && arg.cleanHomeGameButton) {
    cleanHomeGameButtonData(data, summary);
  }
  if (cleanIosHomeTopTabs) {
    cleanIosHomeTopTabsData(data, summary);
  }
  if (isTabResource && arg.cleanBottomExtraButtons) {
    cleanBottomExtraButtonsData(data, summary);
  }

  setResponseBodyText(JSON.stringify(json));
  const notifyPayload = isTabResource
    ? homeEntryRemoveNotifyPayload(summary, arg.cleanStartupAds, arg.cleanHomeGameButton)
    : startupAdsNotifyPayload(summary, arg.cleanStartupAds);
  log("info", {
    page: "startupAds",
    cleanStartupAds: arg.cleanStartupAds,
    cleanHomeGameButton: arg.cleanHomeGameButton,
    cleanHomeTopTabs: cleanIosHomeTopTabs,
    homeTopTabsSupported: supportsIosHomeTopTabs,
    cleanBottomExtraButtons: arg.cleanBottomExtraButtons,
    summary,
  });
  notify("remove", notifyPayload.title, notifyPayload.subtitle, notifyPayload.message);
  if (isTabResource) {
    const personalizationPayload = personalizationNotifyPayload(
      summary,
      cleanIosHomeTopTabs,
      arg.cleanBottomExtraButtons,
      supportsIosHomeTopTabs
    );
    notify(
      "personalization",
      personalizationPayload.title,
      personalizationPayload.subtitle,
      personalizationPayload.message
    );
  }
  finishResponse();
}

// Cleanup configuration for home-search modules, including switches and display labels.
const SEARCH_SQUARE_MODULES = {
  trending: {
    enabled: () => arg.cleanSearchTrending,
    label: "移除-首页搜索页的bilibili热搜",
    shortLabel: "bilibili热搜",
  },
  history: {
    enabled: () => arg.cleanSearchHistory,
    label: "移除-首页搜索页的搜索历史",
    shortLabel: "搜索历史",
  },
  recommend: {
    enabled: () => arg.cleanSearchDiscovery,
    label: "移除-首页搜索页的搜索发现",
    shortLabel: "搜索发现",
  },
};

// Identify a home-search module by its type field or localized title.
function searchSquareModuleType(module) {
  const type = String(module?.type || "");
  if (SEARCH_SQUARE_MODULES[type]) return type;

  const title = String(module?.title || "");
  if (title === "bilibili热搜") return "trending";
  if (title === "搜索历史") return "history";
  if (title === "搜索发现") return "recommend";
  return "";
}

// Build the home-search cleanup notification message.
function searchSquareMessage(removedModules) {
  if (!removedModules.length) return "未命中首页搜索页面模块";
  return removedModules
    .map((item, index) => `${index + 1}、${item.label}`)
    .join("\n");
}

// Build the complete home-search cleanup notification payload.
function searchSquareNotifyPayload(nextModules, removedModules) {
  return {
    title: "Bilibili 首页搜索页面移除",
    subtitle: `保留 ${nextModules.length} / 移除 ${removedModules.length}`,
    message: searchSquareMessage(removedModules),
  };
}
