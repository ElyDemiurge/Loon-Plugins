// core_modules/iOS: iOS-specific home-page top-tab filtering.

// Allowed iOS home-page top tabs: live, recommendations, and popular.
const IOS_HOME_TOP_TAB_KEEP_IDS = new Set([39, 40, 41]);
const IOS_HOME_TOP_TAB_KEEP_NAMES = new Set(["直播", "推荐", "热门"]);
const IOS_HOME_TOP_TAB_KEEP_URI_PATTERN = /^bilibili:\/\/(?:live\/home|pegasus\/(?:promo|hottopic))(?:[/?#]|$)/i;

// Check whether the current tab response belongs to iOS rather than iPadOS.
function isIosHomeTopTabsRequest(url) {
  return /\/x\/resource\/show\/tab\/v2\?/.test(url)
    && !/[?&]device=pad(?:&|$)/i.test(url);
}

// Check whether an iOS top tab is one of the allowed entries.
function isKeptIosHomeTopTab(item) {
  const id = Number(item?.id);
  const name = String(firstNonEmpty([item?.name, item?.tab_id]) || "").replace(/tab$/i, "").trim();
  const uri = String(item?.uri || "").trim();
  return IOS_HOME_TOP_TAB_KEEP_IDS.has(id)
    || IOS_HOME_TOP_TAB_KEEP_NAMES.has(name)
    || IOS_HOME_TOP_TAB_KEEP_URI_PATTERN.test(uri);
}

// Keep only live, recommendation, and popular tabs in the iOS response.
function cleanIosHomeTopTabsData(data, summary) {
  if (!Array.isArray(data?.tab)) return;
  const kept = [];
  for (const item of data.tab) {
    if (!isKeptIosHomeTopTab(item)) {
      summary.homeTopTabs.push(homeEntrySummary(item, "顶部分区"));
      continue;
    }
    kept.push(item);
  }
  data.tab = kept;
}
