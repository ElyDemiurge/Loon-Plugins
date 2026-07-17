/* -------------------------------------------------------------------------- */
/* 开屏、启动资源与个性化页面处理器                                           */
/* -------------------------------------------------------------------------- */

// 开屏广告响应中以数组形式承载、需要被清空的字段名列表。
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
// 开屏广告响应中的数值型字段，清理时统一置为 0。
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
// 开屏广告响应中的字符串字段，清理时统一置为空字符串。
const SPLASH_STRING_KEYS = [
  "splash_request_id",
  "new_splash_hash",
  "show_hash",
];
// 开屏广告响应中的布尔字段，清理时统一置为 false。
const SPLASH_BOOLEAN_KEYS = [
  "has_new_splash_set",
  "forcibly",
];
// 开屏广告各数组字段到展示名称的映射，用于汇总被清理的开屏素材。
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

// 读取开屏广告的内容对象，当 splash_content 字段缺失时回退到外层对象本身。
function splashContent(item) {
  return item?.splash_content && typeof item.splash_content === "object" ? item.splash_content : item;
}

// 规范化开屏广告的目标跳转地址，并对 URL 编码的内容进行解码。
function splashTarget(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  try {
    const decoded = decodeURIComponent(text);
    return decoded || text;
  } catch {}

  return text;
}

// 汇总单条开屏广告的展示信息，包括来源、ID、标题以及跳转目标。
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

// 生成开屏广告的系统通知正文。
function splashItemsMessage(items) {
  const lines = items
    .slice(0, 8)
    .map((item, index) => `${index + 1}、id ${item.id}：${item.title}`);
  if (items.length > 8) lines.push(`...另有 ${items.length - 8} 项`);
  return lines.length ? `移除-开屏广告：\n${lines.join("\n")}` : "未命中开屏广告";
}

// 汇总开屏广告的系统通知完整内容。
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

// 统计开屏广告响应中某个数组字段的元素数量。
function splashArrayCount(data, key) {
  return Array.isArray(data?.[key]) ? data[key].length : 0;
}

// 清空开屏广告响应中所有参与展示、缓存与后台唤醒相关的字段。
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

// 汇总即将被清理的所有开屏广告素材。
function splashRemovedItems(data) {
  return SPLASH_ITEM_SOURCES.flatMap(([key, source]) => {
    if (!Array.isArray(data?.[key])) return [];
    return data[key]
      .filter((item) => item && typeof item === "object")
      .map((item) => splashItemSummary(item, source));
  });
}

// 汇总开屏响应中的各类素材数量；结构缺失时返回全零统计。
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

// 处理开屏广告的 HTTP 响应，按功能开关清空对应的素材字段。
function handleSplashResponse() {
  const url = getRequestUrl();

  // /splash/list 的阻断不依赖上游响应格式；解析只用于尽量保留通知和日志中的素材摘要。
  if (arg.cleanSplashAds && SPLASH_LIST_URL_PATTERN.test(url)) {
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
    return $done({ response: $response });
  }

  const json = parseResponseJson();
  const data = json?.data;
  if (!data || typeof data !== "object") {
    log("info", { page: "splash", message: "data not found" });
    return $done({ response: $response });
  }

  const summary = splashResponseSummary(data);
  const removedItems = splashRemovedItems(data);

  if (arg.cleanSplashAds) {
    if (SPLASH_SHOW_EVENT_PATTERN.test(url)) {
      // /splash/show、/splash/event/list2：只清空 show / event_list，
      // 保留 splash_request_id 等会话字段，避免客户端因字段缺失回退到本地缓存开屏。
      if (Array.isArray(data.show)) data.show = [];
      if (Array.isArray(data.event_list)) data.event_list = [];
      setResponseBodyText(JSON.stringify(json));
    } else {
      clearSplashData(data);
      setResponseBodyText(JSON.stringify(json));
    }
  } else {
    setResponseBodyText(JSON.stringify(json));
  }
  const notifyPayload = splashNotifyPayload(summary, removedItems, arg.cleanSplashAds);
  log("info", {
    page: "splash",
    cleaned: arg.cleanSplashAds,
    summary,
    removedItems: arg.cleanSplashAds ? removedItems : [],
  });
  notify(
    "remove",
    notifyPayload.title,
    notifyPayload.subtitle,
    notifyPayload.message
  );
  $done({ response: $response });
}

// 启动期活动 Tab 的 URI 特征模式。
const STARTUP_ACTIVITY_TAB_PATTERN = /\/home_activity_tab\//i;
// 需要在启动阶段清理的预加载推广资源类型集合。
const STARTUP_PEAK_RESOURCE_TYPES = new Set(["brand_splash", "egg"]);
// 首页右上角游戏中心按钮的稳定 ID 与 URI 特征。
const HOME_GAME_BUTTON_IDS = new Set([3500]);
const HOME_GAME_BUTTON_URI_PATTERN = /^bilibili:\/\/(?:game_center|game)(?:\/|$)/i;
// 首页顶部允许保留的分区：直播、推荐、热门。
const HOME_TOP_TAB_KEEP_IDS = new Set([39, 40, 41]);
const HOME_TOP_TAB_KEEP_NAMES = new Set(["直播", "推荐", "热门"]);
const HOME_TOP_TAB_KEEP_URI_PATTERN = /^bilibili:\/\/(?:live\/home|pegasus\/(?:promo|hottopic))(?:[/?#]|$)/i;
// 底部多余按钮的名称特征模式。
const BOTTOM_EXTRA_BUTTON_NAME_PATTERN = /^(?:\+|＋|加号|发布|投稿|会员购)$/;
// 底部多余按钮的 URI 特征模式。
const BOTTOM_EXTRA_BUTTON_URI_PATTERN = /(?:bilibili:\/\/(?:mall|shopping)|\/mall(?:\/|$)|bmall|会员购|add_archive|archive_selection|publish|creation\/center|uper\/user_center)/i;
// 我的页面中承载模块列表的字段名。
const MINE_PAGE_SECTION_ARRAY_KEYS = ["sections_v2", "sections"];
// 创作中心模块的标题。
const MINE_CREATION_CENTER_TITLE = "创作中心";
// 我的服务模块的标题。
const MINE_SERVICES_TITLE = "我的服务";

// 创建软件启动时推广资源的清理统计对象。
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

// 汇总单个活动 Tab 的展示信息。
function startupTabSummary(item) {
  return {
    id: item?.id || "-",
    name: firstNonEmpty([item?.name, item?.tab_id, item?.uri]) || "活动入口",
    uri: item?.uri || "",
  };
}

// 汇总单个底部按钮的展示信息。
function bottomButtonSummary(item) {
  return {
    id: item?.id || "-",
    name: firstNonEmpty([item?.name, item?.tab_id, item?.uri]) || "底部按钮",
    uri: item?.uri || "",
  };
}

// 汇总首页顶部入口或分区的展示信息。
function homeEntrySummary(item, fallbackName) {
  return {
    id: item?.id || "-",
    name: firstNonEmpty([item?.name, item?.tab_id, item?.uri]) || fallbackName,
    uri: item?.uri || "",
  };
}

// 判断首页右上角入口是否为游戏中心按钮，优先使用抓包中的稳定 ID 与 URI。
function isHomeGameButton(item) {
  const id = Number(item?.id);
  const name = String(firstNonEmpty([item?.name, item?.tab_id]) || "").trim();
  const uri = String(item?.uri || "").trim();
  return HOME_GAME_BUTTON_IDS.has(id)
    || HOME_GAME_BUTTON_URI_PATTERN.test(uri)
    || /^(?:游戏中心|游戏中心Top)$/.test(name);
}

// 判断首页顶部分区是否属于允许保留的直播、推荐或热门入口。
function isKeptHomeTopTab(item) {
  const id = Number(item?.id);
  const name = String(firstNonEmpty([item?.name, item?.tab_id]) || "").replace(/tab$/i, "").trim();
  const uri = String(item?.uri || "").trim();
  return HOME_TOP_TAB_KEEP_IDS.has(id)
    || HOME_TOP_TAB_KEEP_NAMES.has(name)
    || HOME_TOP_TAB_KEEP_URI_PATTERN.test(uri);
}

// 判断底部按钮是否为需要删除的多余按钮。
function isBottomExtraButton(item) {
  const name = String(firstNonEmpty([item?.name, item?.tab_id]) || "").trim();
  const uri = String(item?.uri || "");
  return BOTTOM_EXTRA_BUTTON_NAME_PATTERN.test(name) || BOTTOM_EXTRA_BUTTON_URI_PATTERN.test(uri);
}

// 从启动时的 Tab 列表中移除活动类 Tab。
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

// 移除首页右上角、消息按钮左侧的游戏中心入口。
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

// 精简首页顶部分区，只保留直播、推荐和热门。
function cleanHomeTopTabsData(data, summary) {
  if (!Array.isArray(data?.tab)) return;
  const kept = [];
  for (const item of data.tab) {
    if (!isKeptHomeTopTab(item)) {
      summary.homeTopTabs.push(homeEntrySummary(item, "顶部分区"));
      continue;
    }
    kept.push(item);
  }
  data.tab = kept;
}

// 从底部按钮列表中移除多余按钮。
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

// 移除启动时的皮肤装扮字段。
function cleanStartupSkinData(data, summary) {
  if (!data || typeof data !== "object") return;
  if (Object.prototype.hasOwnProperty.call(data, "common_equip")) {
    const value = data.common_equip;
    summary.skinEquips += Array.isArray(value) ? value.length : (value ? 1 : 0);
    delete data.common_equip;
  }
}

// 清空启动时的预加载推广资源列表。
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

// 生成软件启动时推广资源的系统通知正文。
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

// 汇总软件启动时推广资源的系统通知完整内容。
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

// 汇总首页入口移除结果；活动 Tab 与游戏按钮使用各自独立的功能开关。
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

// 生成底部按钮删除的系统通知正文。
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

// 汇总首页顶部分区精简与底部按钮删除的系统通知完整内容。
function personalizationNotifyPayload(summary, cleanHomeTopTabs, cleanBottomExtraButtons) {
  return {
    title: "Bilibili 个性化清理",
    subtitle: [
      cleanHomeTopTabs ? `清理顶部分区 ${summary.homeTopTabs.length}` : "顶部分区精简已关闭",
      cleanBottomExtraButtons ? `清理底部按钮 ${summary.bottomButtons.length}` : "底部按钮清理已关闭",
    ].join(" / "),
    message: personalizationMessage(summary, cleanHomeTopTabs, cleanBottomExtraButtons),
  };
}

// 处理软件启动时推广资源的 HTTP 响应，按 URL 特征清理对应的字段。
function handleStartupAdsResponse() {
  const json = parseResponseJson();
  const data = json?.data;
  if (!data || typeof data !== "object") {
    log("info", { page: "startupAds", message: "data not found" });
    return $done({ response: $response });
  }

  const url = getRequestUrl();
  const summary = startupAdsSummary();
  const isTabResource = /\/x\/resource\/show\/tab\/v2\?/.test(url);
  if (arg.cleanStartupAds) {
    if (isTabResource) cleanStartupTabData(data, summary);
    if (/\/x\/resource\/show\/skin\?/.test(url)) cleanStartupSkinData(data, summary);
    if (/\/x\/resource\/peak\/download\?/.test(url)) cleanStartupPeakData(data, summary);
  }
  if (isTabResource && arg.cleanHomeGameButton) {
    cleanHomeGameButtonData(data, summary);
  }
  if (isTabResource && arg.cleanHomeTopTabs) {
    cleanHomeTopTabsData(data, summary);
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
    cleanHomeTopTabs: arg.cleanHomeTopTabs,
    cleanBottomExtraButtons: arg.cleanBottomExtraButtons,
    summary,
  });
  notify("remove", notifyPayload.title, notifyPayload.subtitle, notifyPayload.message);
  if (isTabResource) {
    const personalizationPayload = personalizationNotifyPayload(
      summary,
      arg.cleanHomeTopTabs,
      arg.cleanBottomExtraButtons
    );
    notify(
      "personalization",
      personalizationPayload.title,
      personalizationPayload.subtitle,
      personalizationPayload.message
    );
  }
  $done({ response: $response });
}

// 创建「我的」页面清理的统计对象。
function minePageSummary() {
  return {
    creationCenters: [],
    services: [],
  };
}

// 读取「我的」页面字段的文本值，兼容字符串、数字以及对象包裹的形式。
function minePageText(value) {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (value && typeof value === "object" && typeof value.text === "string") {
    return value.text.trim();
  }
  return "";
}

// 读取「我的」页面模块的标题文本。
function minePageSectionTitle(section) {
  return firstNonEmpty([
    minePageText(section?.title),
    minePageText(section?.up_title),
    minePageText(section?.module_title),
    minePageText(section?.section_title),
    minePageText(section?.name),
  ]);
}

// 统计「我的」页面模块所包含的入口数量。
function minePageSectionItemCount(section) {
  return Array.isArray(section?.items) ? section.items.length : 0;
}

// 汇总单个「我的」页面模块的展示信息。
function minePageSectionSummary(section) {
  return {
    title: minePageSectionTitle(section) || "我的页面模块",
    itemCount: minePageSectionItemCount(section),
  };
}

// 判断「我的」页面模块是否包含满足指定条件的入口。
function hasMinePageItem(section, predicate) {
  return Array.isArray(section?.items) && section.items.some((item) => predicate(item));
}

// 判断模块是否为创作中心。
function isMineCreationCenterSection(section) {
  const title = minePageSectionTitle(section);
  if (title === MINE_CREATION_CENTER_TITLE) return true;
  return hasMinePageItem(section, (item) =>
    minePageText(item?.title) === MINE_CREATION_CENTER_TITLE ||
    /bilibili:\/\/uper\/homevc|\/uper\/user_center\/archive_|member\.bilibili\.com\/york\/data-center/.test(String(item?.uri || ""))
  );
}

// 判断模块是否为「我的服务」。
function isMineServicesSection(section) {
  return minePageSectionTitle(section) === MINE_SERVICES_TITLE;
}

// 根据功能开关从模块列表中移除创作中心与「我的服务」模块。
function cleanMinePageSectionArray(data, key, summary) {
  if (!Array.isArray(data?.[key])) return;
  const kept = [];
  for (const section of data[key]) {
    if (arg.cleanMineCreationCenter && isMineCreationCenterSection(section)) {
      summary.creationCenters.push(minePageSectionSummary(section));
      continue;
    }
    if (arg.cleanMineServices && isMineServicesSection(section)) {
      summary.services.push(minePageSectionSummary(section));
      continue;
    }
    kept.push(section);
  }
  data[key] = kept;
}

// 清理「我的」页面中的各模块数组。
function cleanMinePageData(data, summary) {
  if (!data || typeof data !== "object") return;
  for (const key of MINE_PAGE_SECTION_ARRAY_KEYS) {
    cleanMinePageSectionArray(data, key, summary);
  }
}

// 生成「我的」页面清理的系统通知正文。
function minePagePersonalizationMessage(summary, cleaned) {
  if (!cleaned) return "我的页面个性化清理开关已关闭";
  const lines = [];
  for (const item of summary.creationCenters) {
    lines.push(`创作中心：${item.itemCount} 个入口`);
  }
  for (const item of summary.services) {
    lines.push(`我的服务：${item.itemCount} 个入口`);
  }
  return lines.length ? lines.join("\n") : "未命中我的页面个性化模块";
}

// 汇总「我的」页面清理的系统通知完整内容。
function minePagePersonalizationNotifyPayload(summary, cleaned) {
  return {
    title: "Bilibili 个性化清理",
    subtitle: cleaned
      ? `清理创作中心 ${summary.creationCenters.length} / 清理我的服务 ${summary.services.length}`
      : "已关闭",
    message: minePagePersonalizationMessage(summary, cleaned),
  };
}

// 处理「我的」页面响应，根据功能开关移除对应的模块。
function handleMinePageResponse() {
  const json = parseResponseJson();
  const data = json?.data;
  if (!data || typeof data !== "object") {
    log("info", { page: "minePage", message: "data not found" });
    return $done({ response: $response });
  }

  const summary = minePageSummary();
  const cleaned = arg.cleanMineCreationCenter || arg.cleanMineServices;
  if (cleaned) cleanMinePageData(data, summary);

  setResponseBodyText(JSON.stringify(json));
  log("info", {
    page: "minePage",
    cleanMineCreationCenter: arg.cleanMineCreationCenter,
    cleanMineServices: arg.cleanMineServices,
    summary,
  });
  const notifyPayload = minePagePersonalizationNotifyPayload(summary, cleaned);
  notify(
    "personalization",
    notifyPayload.title,
    notifyPayload.subtitle,
    notifyPayload.message
  );
  $done({ response: $response });
}

// 首页搜索页中可清理模块的配置表，包含功能开关、展示名称以及简称。
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

// 识别首页搜索模块的类型，兼容按 type 字段以及按标题文案进行判断。
function searchSquareModuleType(module) {
  const type = String(module?.type || "");
  if (SEARCH_SQUARE_MODULES[type]) return type;

  const title = String(module?.title || "");
  if (title === "bilibili热搜") return "trending";
  if (title === "搜索历史") return "history";
  if (title === "搜索发现") return "recommend";
  return "";
}

// 生成首页搜索模块清理的系统通知正文。
function searchSquareMessage(removedModules) {
  if (!removedModules.length) return "未命中首页搜索页面模块";
  return removedModules
    .map((item, index) => `${index + 1}、${item.label}`)
    .join("\n");
}

// 汇总首页搜索模块清理的系统通知完整内容。
function searchSquareNotifyPayload(nextModules, removedModules) {
  return {
    title: "Bilibili 首页搜索页面移除",
    subtitle: `保留 ${nextModules.length} / 移除 ${removedModules.length}`,
    message: searchSquareMessage(removedModules),
  };
}
