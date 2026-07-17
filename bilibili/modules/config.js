/*
 * 比狸比狸过滤：Bilibili App 的 Loon 响应改写脚本。
 *
 * modules 下的源码按 build_bilibili_cleaner.js 中声明的顺序拼接，共享同一词法作用域；
 * 根目录 bilibili_cleaner.js 是生成产物，不应直接修改。
 */

/* -------------------------------------------------------------------------- */
/* 配置、参数与日志                                                           */
/* -------------------------------------------------------------------------- */

// 插件所有参数的默认值，未在 Loon 里配过的参数都会走这里的默认值。
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

// 日志等级到数值的映射，数值越大表示等级越高。
const LogLevel = { debug: 1, info: 2, warn: 3, error: 4, off: 5 };

// Tag 缓存在持久化存储中的键名。
const TAG_CACHE_KEY = "BilibiliFilter.tagCache.v1";

// 视频标签（Tag）缓存与远端请求的容量限制。
// 缓存最多保留 500 条，单条有效期 7 天；请求的并发线程数量上限为 24，单个请求的超时时间是 1.5 秒。
const TAG_CACHE_LIMIT = 500;
const TAG_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const TAG_FETCH_TIMEOUT_MS = 1500;
const TAG_FETCH_CONCURRENCY_LIMIT = 24;

// 首页推荐页中被视作普通视频卡片的 card_type 白名单。
const HOME_FEED_VIDEO_CARD_TYPES = ["small_cover_v2", "large_cover_single_v9", "large_cover_v1"];

// 规则内部名到用户可见文案的映射，通知、日志与测试统一引用，避免多处维护。
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

// SearchAll 搜索结果的移除类规则。数组中的顺序用于通知展示，priority 决定实际的判定优先级。
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
// 按 priority 升序排列的清理规则，数字越小的规则越优先判定。
const SEARCH_RESULT_CLEANUP_RULES_BY_PRIORITY = [...SEARCH_RESULT_CLEANUP_RULES]
  .sort((left, right) => left.priority - right.priority);

// 会被解析为布尔值的参数名集合。
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

// 合并默认值与 Loon 参数后得到的实际配置，后续所有逻辑统一从这里读取。
const arg = parseArgument(DEFAULTS);
applyBooleanArgs(arg, BOOLEAN_ARG_KEYS);

// 动态页 UP 主推荐清理模式，标准化为 off / module / dynamic 三种枚举值。
const dynamicUpRecommendationMode = normalizeDynamicUpRecommendationMode(arg.cleanDynamicUpRecommendations);

// 动态页「最常访问」UP 列表的显示模式，标准化为 show / hide / auto 三种枚举值。
const dynamicUpListMode = normalizeDynamicUpListMode(arg.dynamicUpListDisplay);

// 当前脚本生效的日志等级。
const logLevel = LogLevel[String(arg.logLevel || "warn").toLowerCase()] || LogLevel.warn;

// 按照当前日志等级输出脚本日志，低于设定等级的调用会被丢弃。
function log(level, ...items) {
  if ((LogLevel[level] || LogLevel.info) >= logLevel) {
    console.log(`[BilibiliFilter][${level}] ${items.map(stringify).join(" ")}`);
  }
}

// 将任意值序列化为适合日志输出的字符串，兼容错误对象以及无法被 JSON 序列化的数据结构。
function stringify(value) {
  if (value instanceof Error) return `${value.message} ${value.stack || ""}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// 解析 Loon 注入的脚本参数：优先使用对象形式，其次尝试按 JSON 解析，最后按分隔键值对的格式来解析。
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

// 将「true / 1 / yes / on」等常见布尔值写法统一转换为布尔值。
function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return /^(true|1|yes|on)$/i.test(value.trim());
  return false;
}

// 将指定参数集合中的值统一解析为布尔值。
function applyBooleanArgs(target, keys) {
  for (const key of keys) target[key] = parseBoolean(target[key]);
}

// 把动态页 UP 主推荐清理参数标准化为枚举值：off（关闭）、module（仅移除推荐模块）、dynamic（移除整条动态）。
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

// 把动态页「最常访问」UP 列表显示参数标准化为枚举值：show（始终显示）、hide（始终隐藏）、auto（仅当存在直播态时显示）。
// 兼容 select 控件的中文值与历史英文值。
function normalizeDynamicUpListMode(value) {
  if (typeof value === "boolean") return value ? "show" : "hide";
  const text = String(value || "").trim().toLowerCase();
  if (/^(hide|hidden|off|0|关闭|隐藏|始终隐藏|不显示)$/.test(text)) return "hide";
  if (/^(show|shown|on|1|显示|始终显示)$/.test(text)) return "show";
  if (/^(auto|仅存在直播时显示|仅直播时显示)$/.test(text)) return "auto";
  return "auto";
}

// 解析关键词列表，按分隔符拆分并去除空值；统一转为小写，方便不区分大小写进行匹配。
function parseKeywords(value) {
  const words = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[\n,，|｜;；]+/)
        .map((word) => word.trim());
  const normalized = words.filter(Boolean);
  return normalized.map((word) => word.toLowerCase());
}

// 解析用于通知与日志展示的关键词列表，保留原始大小写。
function parseDisplayKeywords(value) {
  return (Array.isArray(value) ? value : String(value || "").split(/[\n,，|｜;；]+/))
    .map((word) => String(word).trim())
    .filter(Boolean);
}

// 解析视频 Tag 的正则模式列表，全角竖线会被归一化为半角。
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

// 把正则模式字符串编译为可执行的 RegExp 对象（不区分大小写），非法模式会跳过并记录警告。
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
