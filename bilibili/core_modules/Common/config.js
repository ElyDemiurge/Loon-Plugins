/*
 * core_modules/Common: configuration, arguments, and logging shared by iOS and iPadOS.
 * Bilibili Cleaner: a Loon response-rewrite script for the Bilibili app.
 *
 * Sources under core_modules are concatenated in the order declared by
 * build_bilibili_cleaner.js and share one lexical scope. Do not edit the generated
 * root-level bilibili_cleaner.js directly.
 */

/* -------------------------------------------------------------------------- */
/* Configuration, arguments, and logging                                      */
/* -------------------------------------------------------------------------- */

// Default values for every plugin argument not explicitly supplied by Loon.
const DEFAULTS = {
  titleKeywords: "",
  blockedUps: "",
  deepFilter: false,
  videoTagKeywords: "",
  dynamicKeywords: "",
  searchResultKeywords: "",
  cleanFeedAds: true,
  cleanFeedPromotedVideos: true,
  cleanVideoRelatedPromotedContent: true,
  cleanVideoRelatedAds: true,
  cleanVideoBannerAds: true,
  cleanVideoRelatedLiveRecommendations: true,
  cleanVideoUpGoodsAds: true,
  cleanReplyTopAds: true,
  cleanLiveAds: true,
  blockTrackers: true,
  cleanTeenagersMode: true,
  cleanInteractiveDanmaku: true,
  cleanSplashAds: true,
  cleanStartupAds: true,
  cleanSearchTrending: true,
  cleanSearchHistory: true,
  cleanSearchDiscovery: true,
  cleanSearchDefaultWords: true,
  cleanSearchResultAds: true,
  cleanSearchResultCreatorPromotions: true,
  cleanSearchResultLiveRooms: true,
  cleanSearchResultAggregationCards: true,
  cleanHomeGameButton: true,
  cleanHomeTopTabs: true,
  cleanBottomExtraButtons: true,
  cleanMineCreationCenter: true,
  cleanMineServices: true,
  cleanDynamicUpRecommendations: "移除推荐动态",
  dynamicUpListDisplay: "show",
  notifyRemove: false,
  notifyFilter: false,
  notifyPersonalization: false,
  logLevel: "warn",
};

// Numeric log-level mapping; larger values represent higher severity.
const LogLevel = { debug: 1, info: 2, warn: 3, error: 4, off: 5 };

// Persistent-store key used by the video tag cache.
const TAG_CACHE_KEY = "BilibiliFilter.tagCache.v1";

// Capacity and network limits for tag caching and remote tag lookups.
// Keep at most 500 entries for seven days, with 24 concurrent requests and a 1.5-second timeout.
const TAG_CACHE_LIMIT = 500;
const TAG_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const TAG_FETCH_TIMEOUT_MS = 1500;
const TAG_FETCH_CONCURRENCY_LIMIT = 24;

// card_type values treated as regular videos in the home feed.
const HOME_FEED_VIDEO_CARD_TYPES = ["small_cover_v2", "large_cover_single_v9", "large_cover_v1"];

// Map internal rule names to user-facing labels shared by notifications, logs, and tests.
const BLOCK_RULE_LABELS = {
  titleContains: "屏蔽-视频（关键词）",
  upExact: "屏蔽-UP 主（名称）",
  tagRegex: "深度屏蔽-视频 Tag（可正则）",
  dynamicKeywords: "屏蔽-关注页动态（关键词）",
  searchResultKeywords: "屏蔽-搜索结果与候选词条（关键词）",
  searchResultAds: "移除-搜索结果的广告",
  searchResultCreatorPromotions: "移除-搜索结果的创作推广",
  searchResultLiveRooms: "移除-搜索结果的直播",
  searchResultAggregationCards: "移除-搜索结果聚合卡片",
  contentContains: "关键词",
};

// SearchAll cleanup rules; array order controls display and priority controls matching.
const SEARCH_RESULT_CLEANUP_RULES = [
  {
    rule: "searchResultAds",
    key: "ads",
    argKey: "cleanSearchResultAds",
    subtitle: "清理广告",
    priority: 40,
    matches: ({ info }) => isSearchResultAdType(info.type, info.topLevelTypes),
  },
  {
    rule: "searchResultCreatorPromotions",
    key: "creatorPromotions",
    argKey: "cleanSearchResultCreatorPromotions",
    subtitle: "清理创作推广",
    priority: 30,
    matches: ({ types }) => types.includes("video_ad"),
  },
  {
    rule: "searchResultLiveRooms",
    key: "liveRooms",
    argKey: "cleanSearchResultLiveRooms",
    subtitle: "清理直播",
    priority: 20,
    matches: ({ types }) => types.some((type) => type === "live_room" || type === "live"),
  },
  {
    rule: "searchResultAggregationCards",
    key: "aggregationCards",
    argKey: "cleanSearchResultAggregationCards",
    subtitle: "清理聚合卡片",
    priority: 10,
    matches: ({ types }) => types.includes("pedia_card_pic"),
  },
];
// Match lower numeric priorities first.
const SEARCH_RESULT_CLEANUP_RULES_BY_PRIORITY = [...SEARCH_RESULT_CLEANUP_RULES]
  .sort((left, right) => left.priority - right.priority);

// Argument names normalized as booleans.
const BOOLEAN_ARG_KEYS = [
  "deepFilter",
  "cleanFeedAds",
  "cleanFeedPromotedVideos",
  "cleanVideoRelatedPromotedContent",
  "cleanVideoRelatedAds",
  "cleanVideoBannerAds",
  "cleanVideoRelatedLiveRecommendations",
  "cleanVideoUpGoodsAds",
  "cleanReplyTopAds",
  "cleanLiveAds",
  "blockTrackers",
  "cleanTeenagersMode",
  "cleanInteractiveDanmaku",
  "cleanSplashAds",
  "cleanStartupAds",
  "cleanSearchTrending",
  "cleanSearchHistory",
  "cleanSearchDiscovery",
  "cleanSearchDefaultWords",
  "cleanSearchResultAds",
  "cleanSearchResultCreatorPromotions",
  "cleanSearchResultLiveRooms",
  "cleanSearchResultAggregationCards",
  "cleanHomeGameButton",
  "cleanHomeTopTabs",
  "cleanBottomExtraButtons",
  "cleanMineCreationCenter",
  "cleanMineServices",
  "notifyRemove",
  "notifyFilter",
  "notifyPersonalization",
];

// Merge defaults with Loon arguments into the configuration used by all handlers.
const arg = parseArgument(DEFAULTS);
applyBooleanArgs(arg, BOOLEAN_ARG_KEYS);

// Normalized dynamic-page creator-promotion mode: off, module, or dynamic.
const dynamicUpRecommendationMode = normalizeDynamicUpRecommendationMode(arg.cleanDynamicUpRecommendations);

// Normalized display mode for the dynamic-page frequent-creator list.
const dynamicUpListMode = normalizeDynamicUpListMode(arg.dynamicUpListDisplay);

// Active log threshold for this script invocation.
const logLevel = LogLevel[String(arg.logLevel || "warn").toLowerCase()] || LogLevel.warn;

// Emit log entries at or above the configured threshold.
function log(level, ...items) {
  if ((LogLevel[level] || LogLevel.info) >= logLevel) {
    console.log(`[BilibiliFilter][${level}] ${items.map(stringify).join(" ")}`);
  }
}

// Serialize arbitrary values for logging, including errors and non-JSON values.
function stringify(value) {
  if (value instanceof Error) return `${value.message} ${value.stack || ""}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// Parse Loon arguments from an object, JSON text, or a delimited key-value string.
function parseArgument(defaults) {
  const result = { ...defaults };
  if (typeof $argument === "object" && $argument) {
    return { ...result, ...$argument };
  }
  if (typeof $argument === "string" && $argument.trim()) {
    try {
      return { ...result, ...JSON.parse($argument) };
    } catch {
      for (const part of $argument.split(/[,&]/)) {
        const index = part.indexOf("=");
        if (index > 0) {
          result[part.slice(0, index).trim()] = part.slice(index + 1).trim();
        }
      }
    }
  }
  return result;
}

// Normalize common boolean spellings such as true, 1, yes, and on.
function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return /^(true|1|yes|on)$/i.test(value.trim());
  return false;
}

// Normalize the selected argument values as booleans.
function applyBooleanArgs(target, keys) {
  for (const key of keys) target[key] = parseBoolean(target[key]);
}

// Normalize the dynamic creator-promotion option to off, module, or dynamic.
function normalizeDynamicUpRecommendationMode(value) {
  if (typeof value === "boolean") return value ? "module" : "off";
  if (typeof value === "number") return value ? "module" : "off";

  const text = String(value || "").trim();
  const normalized = text.toLowerCase();
  if (!text || /^(false|0|no|off|关闭|不处理)$/.test(normalized)) return "off";
  if (/^(removedynamic|remove_dynamic|dynamic|item|all|移除推荐动态|移除整条推荐动态|移除整条动态|整条动态)$/.test(normalized)) return "dynamic";
  if (/^(true|1|yes|on|removemodule|remove_module|module|移除推荐模块|移除模块|推荐模块)$/.test(normalized)) return "module";
  return parseBoolean(text) ? "module" : "off";
}

// Normalize the frequent-creator display option to show, hide, or auto.
// Accept both localized select values and legacy English values.
function normalizeDynamicUpListMode(value) {
  if (typeof value === "boolean") return value ? "show" : "hide";
  const text = String(value || "").trim().toLowerCase();
  if (/^(hide|hidden|off|0|关闭|隐藏|始终隐藏|不显示)$/.test(text)) return "hide";
  if (/^(show|shown|on|1|显示|始终显示)$/.test(text)) return "show";
  if (/^(auto|仅存在直播时显示|仅直播时显示)$/.test(text)) return "auto";
  return "auto";
}

// Parse, trim, and lowercase a delimited keyword list for case-insensitive matching.
function parseKeywords(value) {
  const words = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[\n,，|｜;；]+/)
        .map((word) => word.trim());
  const normalized = words.filter(Boolean);
  return normalized.map((word) => word.toLowerCase());
}

// Parse display keywords while preserving their original case.
function parseDisplayKeywords(value) {
  return (Array.isArray(value) ? value : String(value || "").split(/[\n,，|｜;；]+/))
    .map((word) => String(word).trim())
    .filter(Boolean);
}

// Parse video-tag regex patterns and normalize full-width pipe characters.
function parseVideoTagPatterns(value) {
  const words = Array.isArray(value)
    ? value
    : String(value || "")
        .replace(/｜/g, "|")
        .split(/[\n,，;；]+/);
  return words
    .map((word) => String(word).trim())
    .filter(Boolean);
}

// Compile case-insensitive regex patterns, skipping and warning about invalid entries.
function buildRegexRules(patterns) {
  return patterns
    .map((pattern) => {
      try {
        return { pattern, regex: new RegExp(pattern, "i") };
      } catch (error) {
        log("warn", "invalid video tag regex", pattern, error);
        return null;
      }
    })
    .filter(Boolean);
}
