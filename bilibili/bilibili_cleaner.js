/*
 * 此文件由 build_bilibili_cleaner.js 从 modules 模块生成。
 * 请修改模块源码后重新构建，不要直接编辑此文件。
 */
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
/* -------------------------------------------------------------------------- */
/* 字节、gRPC 与 protobuf 基础工具                                            */
/* -------------------------------------------------------------------------- */

// 解压 gzip 编码的字节数据。优先使用 Loon 运行时提供的解压能力，不可用时回退到 Node.js 的 zlib 模块。
function gunzip(bytes) {
  bytes = toBytes(bytes);
  if (typeof $utils !== "undefined" && typeof $utils.ungzip === "function") {
    return toBytes($utils.ungzip(bytes));
  }
  if (typeof require === "function") {
    return new Uint8Array(require("zlib").gunzipSync(Buffer.from(bytes)));
  }
  throw new Error("gzip is unavailable in this runtime");
}

// 将多种二进制输入格式统一转换为 Uint8Array，包括 ArrayBuffer、TypedArray、普通数组与字符串。
function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return new Uint8Array(value);
  if (typeof value === "string") return new TextEncoder().encode(value);
  throw new Error(`unsupported bytes type: ${Object.prototype.toString.call(value)}`);
}

// 从 protobuf 编码的字节流中读取一个 varint，返回解析出的数值以及读取结束后的字节偏移位置。
function readVarint(buffer, offset) {
  let value = 0;
  let shift = 0;
  let pos = offset;
  while (pos < buffer.length) {
    const byte = buffer[pos++];
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, offset: pos };
    shift += 7;
    if (shift > 63) throw new Error("invalid varint");
  }
  throw new Error("truncated varint");
}

// 根据 wire type 跳过当前 protobuf 字段的值部分，返回下一个字段的起始偏移位置。
function skipValue(buffer, offset, wireType) {
  switch (wireType) {
    case 0:
      return readVarint(buffer, offset).offset;
    case 1:
      return offset + 8;
    case 2: {
      const length = readVarint(buffer, offset);
      return length.offset + length.value;
    }
    case 5:
      return offset + 4;
    default:
      throw new Error(`unsupported wire type ${wireType}`);
  }
}

// 将一段 protobuf 字节解析为字段列表，每个字段包含字段编号、wire type 以及原始字节范围。
function parseFields(buffer) {
  const fields = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    const tag = readVarint(buffer, offset);
    offset = tag.offset;
    const no = Math.floor(tag.value / 8);
    const wireType = tag.value & 7;
    let valueStart = offset;
    let valueEnd;
    if (wireType === 2) {
      const length = readVarint(buffer, offset);
      valueStart = length.offset;
      valueEnd = valueStart + length.value;
      offset = valueEnd;
    } else {
      offset = skipValue(buffer, offset, wireType);
      valueEnd = offset;
    }
    if (offset > buffer.length) throw new Error("protobuf field exceeds buffer");
    fields.push({
      no,
      wireType,
      raw: buffer.subarray(start, offset),
      value: buffer.subarray(valueStart, valueEnd),
    });
  }
  return fields;
}

// 将多个字节数组按顺序拼接为单一的 Uint8Array。
function concat(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

// 全局复用的 UTF-8 文本解码器实例。
const decoder = new TextDecoder("utf-8");

// 将字节按 UTF-8 解码为字符串，解码过程出错时返回空字符串以避免中断后续逻辑。
function decodeString(bytes) {
  try {
    return decoder.decode(bytes);
  } catch {
    return "";
  }
}

// 读取指定字段编号下所有 wire type 2 字段的字符串值，自动过滤掉空字符串。
function fieldStrings(fields, no) {
  return fields
    .filter((field) => field.no === no && field.wireType === 2)
    .map((field) => decodeString(field.value))
    .filter(Boolean);
}

// 返回指定字段编号下首个嵌套消息的原始字节，找不到时返回 null。
function firstMessage(fields, no) {
  return fields.find((field) => field.no === no && field.wireType === 2)?.value || null;
}

// 从首页热门卡片中提取标题、UP 名称与 aid，同时会补入分享元数据中的补充文本信息。
function extractCardText(cardBytes) {
  const result = { titles: [], upNames: [], aid: extractAidFromText(decodeString(cardBytes)) };

  const card = parseFields(cardBytes);
  const smallCoverBytes = firstMessage(card, 1);
  if (!smallCoverBytes) return result;

  const smallCover = parseFields(smallCoverBytes);
  result.upNames.push(...fieldStrings(smallCover, 5));

  const baseBytes = firstMessage(smallCover, 1);
  if (!baseBytes) return result;

  const base = parseFields(baseBytes);
  result.aid = extractAidFromText(fieldStrings(base, 2).join(" ")) || result.aid;
  result.titles.push(...fieldStrings(base, 6));

  // iOS 首页热门的分享元数据中同样带有标题与 UP，一并补入。
  for (const share of base.filter((field) => field.no === 18 && field.wireType === 2)) {
    try {
      const shareFields = parseFields(share.value);
      for (const shareItem of shareFields.filter((field) => field.no === 1 && field.wireType === 2)) {
        const itemFields = parseFields(shareItem.value);
        result.titles.push(...fieldStrings(itemFields, 1));
        result.upNames.push(...fieldStrings(itemFields, 8));
      }
    } catch (error) {
      log("debug", "failed to parse share metadata", error);
    }
  }

  return result;
}

// 从任意文本中提取视频 aid，兼容 Bilibili 内部链接、URL 查询参数以及 JSON 中的多种 aid 表示形式。
function extractAidFromText(text) {
  const value = String(text || "");
  const match = value.match(/bilibili:\/\/(?:video|story)\/(\d+)/)
    || value.match(/(?:^|[?&])aid=(\d+)/)
    || value.match(/"aid"\s*:\s*(\d+)/)
    || value.match(/\bav(\d{6,})\b/i);
  if (match) return match[1];

  const typedVideoIdMatch = value.match(/"id"\s*:\s*(\d+)\s*,\s*"type"\s*:\s*"video"/)
    || value.match(/"type"\s*:\s*"video"\s*,\s*"id"\s*:\s*(\d+)/);
  return typedVideoIdMatch ? typedVideoIdMatch[1] : "";
}

// 规范化 UP 主名称：去除 "UP主：" 或 "频道：" 等前缀，并将连续的空白字符合并为单个空格。
function normalizeUpName(value) {
  return String(value || "").replace(/^(UP主|频道)[:：]/, "").replace(/\s+/g, " ").trim();
}

// 判断指定类别的通知开关是否开启。传入数组时，只要数组中的任意一项对应的开关开启即返回 true。
function notificationEnabled(category) {
  if (Array.isArray(category)) return category.some((item) => notificationEnabled(item));
  if (category === "remove") return arg.notifyRemove;
  if (category === "filter") return arg.notifyFilter;
  if (category === "personalization") return arg.notifyPersonalization;
  return arg.notifyRemove || arg.notifyFilter || arg.notifyPersonalization;
}

// 将通知内容同步写入脚本的运行日志，便于在系统弹窗之外留存排查记录。
function logNotification(title, subtitle, message, attach) {
  const lines = [`[BilibiliFilter][notify] ${title || ""}`];
  if (subtitle) lines.push(String(subtitle));
  if (message) lines.push(String(message));
  if (attach) lines.push(`attach=${stringify(attach)}`);
  console.log(lines.join("\n"));
}

// 在对应类别的通知开关开启时发送系统通知，并同步记录到脚本日志中。
function notify(category, title, subtitle, message, attach) {
  if (!notificationEnabled(category)) return;
  logNotification(title, subtitle, message, attach);
  try {
    if (typeof $notification !== "undefined" && typeof $notification.post === "function") {
      $notification.post(title, subtitle, message, attach);
      return;
    }
    if (typeof $notify === "function") {
      $notify(title, subtitle, message);
    }
  } catch (error) {
    log("debug", "notification failed", error);
  }
}

// 对同时包含“清理”和“屏蔽”的处理结果按实际命中类别发送通知。
// 两类都命中且两类通知都开启时保留合并通知；只开启其中一类时仅展示该类别的结果。
function notifyCleanupAndFilter({
  cleaned,
  blocked,
  combined,
  cleanup,
  filter,
  empty = combined,
  emptyCategory = ["remove", "filter"],
}) {
  const hasCleanup = cleaned > 0;
  const hasFilter = blocked > 0;
  const post = (category, payload) => notify(
    category,
    payload.title,
    payload.subtitle,
    payload.message,
    payload.attach
  );

  if (hasCleanup && hasFilter) {
    const cleanupEnabled = notificationEnabled("remove");
    const filterEnabled = notificationEnabled("filter");
    if (cleanupEnabled && filterEnabled) return post(["remove", "filter"], combined);
    if (cleanupEnabled) return post("remove", cleanup);
    if (filterEnabled) return post("filter", filter);
    return;
  }

  if (hasCleanup) return post("remove", cleanup);
  if (hasFilter) return post("filter", filter);
  return post(emptyCategory, empty);
}

// 解码 gRPC 响应体：解析 5 字节帧头以获取消息长度与压缩标记，必要时对消息体执行 gzip 解压。
function decodeGrpcBody(bodyBytes) {
  bodyBytes = toBytes(bodyBytes);
  if (!bodyBytes || bodyBytes.length < 5) throw new Error("invalid grpc body");
  const compressed = bodyBytes[0] === 1;
  const length =
    bodyBytes[1] * 2 ** 24 + (bodyBytes[2] << 16) + (bodyBytes[3] << 8) + bodyBytes[4];
  const message = bodyBytes.subarray(5, 5 + length);
  return compressed ? gunzip(message) : message;
}

// 将消息体编码为 gRPC 帧格式：写入不压缩标记（0），后接 4 字节大端序消息长度。
function encodeGrpcBody(message) {
  const output = new Uint8Array(5 + message.length);
  output[0] = 0;
  output[1] = message.length >>> 24;
  output[2] = (message.length >>> 16) & 255;
  output[3] = (message.length >>> 8) & 255;
  output[4] = message.length & 255;
  output.set(message, 5);
  return output;
}

// 读取当前响应体并转换为字节数组，兼容 bodyBytes 与 body 两种字段名。
function getResponseBodyBytes() {
  if ($response.bodyBytes !== undefined) return toBytes($response.bodyBytes);
  if ($response.body !== undefined) return toBytes($response.body);
  throw new Error("response body is unavailable");
}

// 读取当前响应体文本。
function getResponseBodyText() {
  if (typeof $response.body === "string") return $response.body;
  return decoder.decode(getResponseBodyBytes());
}

// 安全地读取请求体字节，读取过程中遇到任何错误都返回 undefined 而不抛出异常。
function getRequestBodyBytesSafely() {
  if (typeof $request === "undefined" || !$request) return undefined;
  try {
    if ($request.bodyBytes !== undefined) return $request.bodyBytes;
  } catch (error) {
    log("debug", "failed to read request bodyBytes", error);
  }
  return undefined;
}

// 安全地读取请求体内容，读取失败时返回 undefined 而不中断流程。
function getRequestBodySafely() {
  if (typeof $request === "undefined" || !$request) return undefined;
  try {
    return $request.body;
  } catch (error) {
    log("debug", "failed to read request body", error);
    return undefined;
  }
}

// 将字节数据写回响应体，按照运行环境支持的字段名写入（优先 bodyBytes，否则 body）。
function setResponseBodyBytes(bytes) {
  if ($response.bodyBytes !== undefined) {
    $response.bodyBytes = bytes;
  } else {
    $response.body = bytes;
  }
}

// 将文本直接写回响应体 body 字段。
function setResponseBodyText(text) {
  $response.body = text;
}

// 读取当前请求的完整 URL，在没有请求上下文时返回空字符串。
function getRequestUrl() {
  return (typeof $request !== "undefined" && $request && $request.url) || "";
}
/* -------------------------------------------------------------------------- */
/* 屏蔽规则与关键词                                                           */
/* -------------------------------------------------------------------------- */

// 构建本次执行所需的屏蔽规则集合：标题关键词、UP 名称以及视频 Tag 正则，同时保留原始写法用于通知与日志展示。
function buildKeywords() {
  const videoTagPatterns = parseVideoTagPatterns(arg.videoTagKeywords);
  const displayTitleKeywords = mergeDisplayKeywords(parseDisplayKeywords(arg.titleKeywords));
  const displayBlockedUps = mergeDisplayKeywords(parseDisplayKeywords(arg.blockedUps));
  return {
    titleKeywords: parseKeywords(displayTitleKeywords),
    // UP 名称只在这里做一次标准化，避免每张卡片匹配时重复清理同一组关键词。
    blockedUps: parseKeywords(displayBlockedUps).map(normalizeUpName),
    videoTagKeywords: videoTagPatterns,
    videoTagRegexes: buildRegexRules(videoTagPatterns),
    displayTitleKeywords,
    displayBlockedUps,
    displayVideoTagKeywords: videoTagPatterns,
  };
}

// 构建动态页以及搜索结果等内容场景的通用关键词规则。
function buildContentKeywords(value) {
  const displayKeywords = parseDisplayKeywords(value);
  return {
    keywords: parseKeywords(displayKeywords),
    displayKeywords,
  };
}

// 判断给定内容场景是否配置了可用的关键词。
function hasContentKeywords(keywords) {
  return keywords.displayKeywords.length > 0;
}

// 在候选文本列表中查找内容关键词的命中项，命中后返回规则名、关键词以及命中的文本值。
function findContentKeywordMatch(values, keywords, rule = "contentContains") {
  if (!hasContentKeywords(keywords)) return null;
  const match = findContainsMatch(
    values,
    keywords.keywords,
    keywords.displayKeywords
  );
  return match ? { rule, keyword: match.keyword, value: match.value } : null;
}

// 判断视频 Tag 过滤功能是否启用，需要同时开启深度屏蔽开关并配置了 Tag 规则。
function hasVideoTagFilter(keywords) {
  return arg.deepFilter && keywords.videoTagKeywords.length > 0;
}

// 判断是否配置了任意一条屏蔽规则（标题关键词、UP 名称或视频 Tag）。
function hasAnyFilterRule(keywords) {
  return keywords.titleKeywords.length > 0 ||
    keywords.blockedUps.length > 0 ||
    hasVideoTagFilter(keywords);
}

// 将响应体文本解析为 JSON 对象。
function parseResponseJson() {
  return JSON.parse(getResponseBodyText());
}

// 汇总通用的过滤统计信息，供脚本日志统一输出时使用。
function filterSummary(page, kept, removed, keywords) {
  return {
    page,
    kept,
    removed,
    titleBlockKeywords: keywords.displayTitleKeywords,
    blockedUps: keywords.displayBlockedUps,
    deepFilter: arg.deepFilter,
    videoTagKeywords: keywords.displayVideoTagKeywords,
  };
}

// 构造统一的过滤行结构，同时承载标题、UP 名称、aid 以及内联视频 Tag。
function createFilterRow({ item = null, titles = [], upNames = [], aid = "", inlineTags = [] }) {
  return {
    item,
    titles,
    upNames,
    aid: String(aid || ""),
    inlineTags,
  };
}

// 从命中的过滤行中生成用于通知与日志展示的条目。
function matchedFilterItem(row) {
  return {
    title: firstNonEmpty(row.titles),
    up: firstNonEmpty(row.upNames),
    aid: row.aid,
    rule: row.match?.rule,
    keyword: row.match?.keyword,
    matchedValue: row.match?.value,
  };
}

// 依次按标题关键词与 UP 主名称进行匹配，返回首个命中的规则。
function findTextMatch(titles, upNames, keywords) {
  const titleMatch = findContainsMatch(titles, keywords.titleKeywords, keywords.displayTitleKeywords);
  if (titleMatch) {
    return { rule: "titleContains", keyword: titleMatch.keyword, value: titleMatch.value };
  }

  const upMatch = findExactMatch(upNames, keywords.blockedUps, keywords.displayBlockedUps);
  if (upMatch) {
    return { rule: "upExact", keyword: upMatch.keyword, value: upMatch.value };
  }

  return null;
}

// 按视频 Tag 正则进行匹配，返回首个命中的规则。
function findTagMatch(tags, keywords) {
  if (!hasVideoTagFilter(keywords)) return null;
  const tagMatch = findRegexMatch(
    tags || [],
    keywords.videoTagRegexes
  );
  return tagMatch ? { rule: "tagRegex", keyword: tagMatch.keyword, value: tagMatch.value } : null;
}

// 为一组过滤行依次填充 match 字段：先执行文本匹配，未命中的行再补充执行 Tag 匹配。
async function applyFilterMatches(rows, keywords) {
  for (const row of rows) {
    row.match = findTextMatch(row.titles, row.upNames, keywords);
  }
  await applyTagMatches(rows, keywords);
}

// 按照并发上限依次处理列表中的每一项，超出并发数的项目排队等待可用空位。
async function mapLimited(items, limit, worker) {
  const concurrency = Math.max(1, Math.min(Number(limit) || 1, items.length || 1));
  let index = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (index < items.length) {
      const current = items[index++];
      await worker(current);
    }
  }));
}

// 对尚未命中文本屏蔽规则的行尝试 Tag 匹配：优先用内联 Tag，其次查缓存，最后按需向远端拉取视频标签。
async function applyTagMatches(rows, keywords) {
  if (!hasVideoTagFilter(keywords)) return;

  const needsRemoteTags = [];
  for (const row of rows) {
    if (row.match) continue;

    const inlineTagMatch = findTagMatch(row.inlineTags || [], keywords);
    if (inlineTagMatch) {
      row.match = inlineTagMatch;
      continue;
    }

    const cachedTags = getCachedTags(row.aid);
    // 内联 Tag 已经检查过，不再创建合并数组重复匹配。
    const cachedTagMatch = findTagMatch(cachedTags, keywords);
    if (cachedTagMatch) {
      row.match = cachedTagMatch;
      continue;
    }

    if (row.aid) needsRemoteTags.push(row);
  }

  await mapLimited(needsRemoteTags, TAG_FETCH_CONCURRENCY_LIMIT, async (row) => {
    const tags = await ensureTagsForAid(row.aid, { deferCacheWrite: true });
    const tagMatch = findTagMatch(tags, keywords);
    if (tagMatch) row.match = tagMatch;
  });
  // 一次推荐流可能拉取几十个 Tag，统一在批次结束后裁剪并写入一次持久化缓存。
  flushTagCache();
}

// 在候选文本中查找包含关系命中（供标题关键词等使用，不区分大小写）。
function findContainsMatch(values, normalizedKeywords, displayKeywords) {
  if (!normalizedKeywords.length) return null;
  for (const value of values) {
    const text = String(value).toLowerCase();
    for (let i = 0; i < normalizedKeywords.length; i += 1) {
      if (text.includes(normalizedKeywords[i])) {
        return { keyword: displayKeywords[i] || normalizedKeywords[i], value: String(value) };
      }
    }
  }
  return null;
}

// 在候选文本中查找完全匹配命中（供 UP 名称等使用，不区分大小写）。
function findExactMatch(values, normalizedKeywords, displayKeywords) {
  if (!normalizedKeywords.length) return null;
  for (const value of values) {
    const text = normalizeUpName(String(value).toLowerCase());
    for (let i = 0; i < normalizedKeywords.length; i += 1) {
      if (text === normalizedKeywords[i]) {
        return { keyword: displayKeywords[i] || normalizedKeywords[i], value: String(value) };
      }
    }
  }
  return null;
}

// 在候选文本中查找正则命中（供视频 Tag 等正则规则使用）。
function findRegexMatch(values, regexRules) {
  if (!regexRules.length) return null;
  for (const value of values) {
    const text = String(value || "");
    for (let i = 0; i < regexRules.length; i += 1) {
      const rule = regexRules[i];
      rule.regex.lastIndex = 0;
      if (rule.regex.test(text)) {
        return { keyword: rule.pattern, value: text };
      }
    }
  }
  return null;
}

// 返回首个非空字符串。
function firstNonEmpty(values) {
  return values.find((value) => String(value || "").trim()) || "";
}

// 对字符串列表执行去空白与去重操作，并过滤掉空值。
function uniqueStrings(values) {
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}
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
/* -------------------------------------------------------------------------- */
/* 请求参数与 protobuf 结构提取                                               */
/* -------------------------------------------------------------------------- */

// 读取指定字段编号下首个 varint 字段的数值。
function varintField(fields, no) {
  const field = fields.find((item) => item.no === no && item.wireType === 0);
  return field ? readVarint(field.value, 0).value : "";
}

// 从视频详情页（View）的 gRPC 请求体中提取视频 aid。
function extractViewAidFromRequest() {
  try {
    const bodyBytes = getRequestBodyBytesSafely();
    const requestBody = bodyBytes !== undefined ? bodyBytes : getRequestBodySafely();
    if (requestBody === undefined) return "";
    const message = decodeGrpcBody(toBytes(requestBody));
    return String(varintField(parseFields(message), 1) || "");
  } catch (error) {
    log("debug", "failed to extract view aid from request", error);
    return "";
  }
}

// 从视频详情页（View）的 gRPC 响应消息中提取视频 aid。
function extractViewAidFromMessage(message) {
  try {
    const viewFields = parseFields(firstMessage(parseFields(message), 2) || new Uint8Array());
    const aid = String(varintField(viewFields, 1) || "");
    if (aid) return aid;
    return String(firstNonEmpty(fieldStrings(viewFields, 1)).replace(/^#/, "") || "");
  } catch (error) {
    log("debug", "failed to extract view aid from response", error);
    return "";
  }
}

// 递归遍历整个 protobuf 消息树，收集所有带有话题链接的视频话题 Tag。
function collectTopicTags(messageBytes) {
  const tags = [];

  walkProtobufFields(messageBytes, ({ fields }) => {
    const names = fieldStrings(fields, 2);
    const links = fieldStrings(fields, 3);
    if (names.length && links.some((link) => /app_comment_topic|search\?keyword=/.test(link))) {
      tags.push(...names);
    }
    return null;
  }, { maxDepth: 12 });

  return uniqueStrings(tags);
}

// 将整数值编码为 protobuf varint 格式的字节数组。
function encodeVarint(value) {
  const bytes = [];
  let next = Number(value);
  do {
    let byte = next & 0x7f;
    next = Math.floor(next / 128);
    if (next) byte |= 0x80;
    bytes.push(byte);
  } while (next);
  return new Uint8Array(bytes);
}

// 编码单个 protobuf 字段，wire type 2 时会自动附上长度前缀。
function encodeField(no, wireType, value) {
  const tag = encodeVarint(no * 8 + wireType);
  if (wireType === 2) {
    return concat([tag, encodeVarint(value.length), value]);
  }
  return concat([tag, value]);
}

// 尝试将字节解析为 protobuf 字段列表，解析失败时返回 null。
function tryParseFields(bytes) {
  try {
    const fields = parseFields(bytes);
    return fields.length ? fields : null;
  } catch {
    return null;
  }
}

// 判断字段是否为可继续递归解析的嵌套消息（wire type 2 且值部分非空）。
function isProtobufMessageField(field) {
  return field.wireType === 2 && field.value.length > 0;
}

// 对 protobuf 消息树执行只读遍历。visitor 回调可以返回 { stop } 提前结束遍历，或者返回 { skipChildren } 跳过当前节点的子层级。
function walkProtobufFields(bytes, visitor, options = {}) {
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : 12;
  const visited = options.visited || new Set();

  function walk(part, depth, path) {
    if (depth > maxDepth) return false;
    const visitKey = `${part.byteOffset}:${part.byteLength}`;
    if (visited.has(visitKey)) return false;
    visited.add(visitKey);

    const fields = tryParseFields(part);
    if (!fields) return false;

    const decision = visitor({ bytes: part, fields, depth, path }) || {};
    if (decision.stop) return true;
    if (decision.skipChildren) return false;

    for (const field of fields) {
      if (!isProtobufMessageField(field)) continue;
      if (walk(field.value, depth + 1, path.concat(field.no))) return true;
    }
    return false;
  }

  return walk(bytes, 0, []);
}

// 按字段回调重写 protobuf 消息树。visitor 可以删除字段或改写字段的值；无任何变化时直接返回原字节数组，以保持引用稳定。
function transformProtobufFields(bytes, visitor, options = {}) {
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : 12;

  function transform(part, depth, path) {
    if (depth > maxDepth) return { bytes: part, changed: false };
    const fields = tryParseFields(part);
    if (!fields) return { bytes: part, changed: false };

    let changed = false;
    const chunks = [];
    for (const field of fields) {
      const childPath = path.concat(field.no);
      const action = visitor({ field, fields, depth, path, childPath }) || {};
      if (action.remove) {
        changed = true;
        continue;
      }

      let nextValue = field.value;
      let fieldChanged = false;
      if (Object.prototype.hasOwnProperty.call(action, "value")) {
        nextValue = toBytes(action.value);
        fieldChanged = true;
      } else if (isProtobufMessageField(field) && depth < maxDepth) {
        const nested = transform(field.value, depth + 1, childPath);
        if (nested.changed) {
          nextValue = nested.bytes;
          fieldChanged = true;
        }
      }

      if (fieldChanged) {
        chunks.push(encodeField(field.no, field.wireType, nextValue));
        changed = true;
      } else {
        chunks.push(field.raw);
      }
    }

    return changed ? { bytes: concat(chunks), changed: true } : { bytes: part, changed: false };
  }

  return transform(bytes, 0, []);
}
/* -------------------------------------------------------------------------- */
/* 视频页、推荐流与搜索结果                                                   */
/* -------------------------------------------------------------------------- */

// 创建视频页清理的统计对象，按清理类型分组记录命中项。
function videoCleanupSummary() {
  return {
    blockedVideos: [],
    promotedContent: [],
    relatedAds: [],
    bannerAds: [],
    liveRecommendations: [],
    upGoodsAds: [],
  };
}

// 生成只包含清理结果或只包含屏蔽结果的通知统计，避免混合通知绕过单项通知开关。
function videoNotificationSummary(summary, category) {
  const next = videoCleanupSummary();
  if (category !== "remove") next.blockedVideos = summary.blockedVideos;
  if (category !== "filter") {
    next.promotedContent = summary.promotedContent;
    next.relatedAds = summary.relatedAds;
    next.bannerAds = summary.bannerAds;
    next.liveRecommendations = summary.liveRecommendations;
    next.upGoodsAds = summary.upGoodsAds;
  }
  return next;
}

// 向清理统计中追加一项，同时提取可读标题用于后续展示。
function pushCleanupItem(summary, type, bytes) {
  const title = firstNonEmpty(extractReadableStrings(bytes));
  summary[type].push({ title });
}

// 从 protobuf 消息中提取可读文本，同时过滤掉广告模板文案与控制字符等不适合展示的内容。
function extractReadableStrings(bytes) {
  const values = [];
  const text = decodeString(bytes);

  const encodedTitleMatch = text.match(/(?:title_encode|title)=([^&\s"]+)/);
  if (encodedTitleMatch) {
    try {
      values.push(decodeURIComponent(encodedTitleMatch[1]));
    } catch {
      values.push(encodedTitleMatch[1]);
    }
  }

  walkProtobufFields(bytes, ({ fields }) => {
    for (const field of fields) {
      if (!isProtobufMessageField(field)) continue;
      const value = decodeString(field.value).replace(/\s+/g, ' ').trim();
      if (value && /[\u4e00-\u9fff]/.test(value) && value.length <= 80 && !/[\x00-\x08\x0e-\x1f]/.test(value)) {
        values.push(value);
      }
    }
    return null;
  }, { maxDepth: 8 });

  return uniqueStrings(values.filter((value) =>
    !/^(广告|推荐了|操作成功|不感兴趣|反馈|我不想看|恐怖血腥|色情低俗|封面恶心|标题党\/封面党|引人不适|对立争议)$/.test(value) &&
    !/(选择后|将减少|将优化|相似推荐|相似广告|当前视频无关|开启个性化推荐|UP主：|分区：)/.test(value)
  ));
}

// 从视频页推荐流卡片中提取 UP 主名称。
function extractVideoRelatedUpNames(bytes) {
  const values = [];
  const text = decodeString(bytes);

  for (const match of text.matchAll(/UP主[:：]\s*([^\x00-\x1f\n\r]{1,40})/g)) {
    values.push(cleanVideoRelatedUpName(match[1]));
  }

  walkProtobufFields(bytes, ({ fields, path }) => {
    for (const field of fields) {
      if (!isProtobufMessageField(field)) continue;
      const nextPath = path.concat(field.no);
      const value = decodeString(field.value).replace(/\s+/g, ' ').trim();
      const upMatch = value.match(/^UP主[:：]\s*(.+)$/);
      if (upMatch) values.push(upMatch[1]);

      // 视频页推荐流卡片的 UP 名常见于 owner 字段。
      if (nextPath.slice(-3).join('.') === '12.11.3') values.push(value);
    }
    return null;
  }, { maxDepth: 8 });

  return uniqueStrings(values.map(normalizeUpName));
}

// 清理视频页推荐流 UP 名称中的无关后缀文本。
function cleanVideoRelatedUpName(value) {
  return normalizeUpName(value)
    .replace(/(?:和当前视频无关|不感兴趣|反馈|选择后|将减少|将优化).*$/, "")
    .replace(/([^0-9])2$/, "$1")
    .trim();
}

// 根据 protobuf 字节内容判断视频页推荐项所属的清理类型。仅当对应的功能开关开启时才返回类型名，否则返回空字符串。
// 类型包括：横幅广告、直播推荐、UP 主好物广告、推广内容以及普通广告。
function videoRelatedCleanupType(bytes, scope) {
  const text = decodeString(bytes);

  if (scope === 'banner' && /type\.googleapis\.com\/bilibili\.ad\.v1\.|\bads?\.|广告|ad-complain|ad-introduce/.test(text)) {
    return arg.cleanVideoBannerAds ? 'bannerAds' : '';
  }

  if (/bilibili:\/\/live|https?:\/\/live\.bilibili\.com\/|\/bfs\/live\/new_room_cover\/|live_room|直播中|直播间|看直播/.test(text)) {
    return arg.cleanVideoRelatedLiveRecommendations ? 'liveRecommendations' : '';
  }

  if (scope === 'upGoods' && /UP主(?:推荐|分享)好物|type\.googleapis\.com\/bilibili\.ad\.v1\.SourceContentDto|商品来自淘宝|来自淘宝|去看看/.test(text)) {
    return arg.cleanVideoUpGoodsAds ? 'upGoodsAds' : '';
  }

  const hasAdPayload = /type\.googleapis\.com\/bilibili\.ad\.v1\.|cm\.bilibili\.com\/ldad|ad-complain|ad-introduce|我为什么会看到此广告|屏蔽广告|广告质量差/.test(text);
  if (!hasAdPayload) return '';

  if (/title_encode=|image_material_id=|space\.bilibili\.com\/\d+ 推荐了| 推荐了/.test(text)) {
    return arg.cleanVideoRelatedPromotedContent ? 'promotedContent' : '';
  }

  return arg.cleanVideoRelatedAds ? 'relatedAds' : '';
}

// 清理视频页消息中的广告、直播卡片以及 UP 主好物等推荐项，并返回改写后的字节。
function sanitizeVideoPageMessage(message, summary, options = {}) {
  const result = transformProtobufFields(message, ({ field, depth, path }) => {
    if (!isProtobufMessageField(field)) return null;

    // View 消息中 field 22 是推荐流，顶层 field 7 是横幅，field 46 是 UP 主好物。
    const isRelatedContainer = path[path.length - 1] === 22;
    const scope = field.no === 46 ? 'upGoods' : (options.bannerFieldNo && depth === 0 && field.no === options.bannerFieldNo ? 'banner' : 'related');
    const cleanupType = ((isRelatedContainer && field.no === 1) || field.no === 46 || scope === 'banner' || options.topRelatedFieldNo === field.no)
      ? videoRelatedCleanupType(field.value, scope)
      : '';
    if (cleanupType) {
      pushCleanupItem(summary, cleanupType, field.value);
      return { remove: true };
    }
    return null;
  }, { maxDepth: 12 });

  return result.changed ? result.bytes : message;
}

// 汇总视频页清理结果的通知正文。
function videoPageNotifyMessage(summary) {
  return presentItemListMessages([
    ['屏蔽-视频页推荐流视频', summary.blockedVideos],
    ['清理-视频页推荐流推广内容', summary.promotedContent],
    ['清理-视频页推荐流广告卡片', summary.relatedAds],
    ['清理-视频页横幅广告', summary.bannerAds],
    ['清理-视频页推荐流直播卡片', summary.liveRecommendations],
    ['清理-视频页 UP 主推荐好物', summary.upGoodsAds],
  ], '未命中视频页清理规则');
}

// 统计视频页清理（非屏蔽类处理）的总数量。
function videoPageCleanCount(summary) {
  return summary.promotedContent.length + summary.relatedAds.length + summary.bannerAds.length + summary.liveRecommendations.length + summary.upGoodsAds.length;
}

// 统计视频页屏蔽类处理的总数量。
function videoPageBlockCount(summary) {
  return summary.blockedVideos.length;
}

// 生成视频页推荐流的通知副标题文本。
function videoFeedFilterSubtitle(prefix, cleaned, blocked) {
  return prefix + (blocked ? ' / 屏蔽 ' + blocked : '') + ' / 清理 ' + cleaned;
}

// 汇总视频页推荐流的完整通知内容。
function videoFeedNotifyPayload(summary, kept) {
  const cleaned = videoPageCleanCount(summary);
  const blocked = videoPageBlockCount(summary);
  return {
    title: "Bilibili 视频页推荐流清理",
    subtitle: videoFeedFilterSubtitle(`保留 ${kept}`, cleaned, blocked),
    message: videoPageNotifyMessage(summary),
    cleaned,
    blocked,
  };
}

// 生成视频详情页的通知副标题文本。
function videoViewFilterSubtitle(cleaned, blocked) {
  return '清理 ' + cleaned + (blocked ? ' / 屏蔽 ' + blocked : '');
}

// 汇总视频详情页的完整通知内容，可以附带 Tag 缓存状态信息。
function videoViewNotifyPayload(summary, cacheResult = null, aid = "") {
  const cleaned = videoPageCleanCount(summary);
  const blocked = videoPageBlockCount(summary);
  return {
    title: cacheResult ? "Bilibili 视频页清理 / Tag 缓存" : "Bilibili 视频页清理",
    subtitle: cacheResult
      ? `${videoViewFilterSubtitle(cleaned, blocked)} / ${cacheStatusText(cacheResult.status, aid)}`
      : videoViewFilterSubtitle(cleaned, blocked),
    message: videoPageNotifyMessage(summary),
    cleaned,
    blocked,
  };
}

// 从视频页推荐流卡片的 protobuf 字节中构建对应的过滤行结构。
function videoRelatedFilterRow(bytes) {
  const title = firstNonEmpty(extractReadableStrings(bytes));
  const text = decodeString(bytes);
  return {
    bytes,
    titles: title ? [title] : [],
    upNames: extractVideoRelatedUpNames(bytes),
    aid: extractAidFromText(text),
    inlineTags: collectTopicTags(bytes),
  };
}

// 将被屏蔽的视频推荐项追加到清理统计中。
function pushBlockedVideoFeedItem(summary, row) {
  summary.blockedVideos.push({
    title: firstNonEmpty(row.titles),
    up: firstNonEmpty(row.upNames),
    aid: row.aid,
    rule: row.match?.rule,
    keyword: row.match?.keyword,
    matchedValue: row.match?.value,
  });
}

// 递归过滤视频页内嵌的推荐流，对推荐卡片进行批量屏蔽规则匹配并删除命中项。
async function filterVideoRelatedMatchesPart(bytes, summary, keywords, depth, isRelatedContainer) {
  if (depth > 12) return null;
  const fields = tryParseFields(bytes);
  if (!fields) return null;

  let changed = false;
  const chunks = [];
  const relatedRows = [];
  const relatedIndexes = [];

  for (const field of fields) {
    if (field.wireType === 2 && field.value.length && isRelatedContainer && field.no === 1) {
      relatedIndexes.push(chunks.length);
      relatedRows.push(videoRelatedFilterRow(field.value));
      chunks.push(field.raw);
      continue;
    }

    if (field.wireType === 2 && field.value.length) {
      const nested = await filterVideoRelatedMatchesPart(field.value, summary, keywords, depth + 1, field.no === 22);
      if (nested) {
        chunks.push(encodeField(field.no, field.wireType, nested));
        changed = true;
        continue;
      }
    }
    chunks.push(field.raw);
  }

  if (relatedRows.length) {
    await applyFilterMatches(relatedRows, keywords);
    for (let i = relatedRows.length - 1; i >= 0; i -= 1) {
      const row = relatedRows[i];
      if (!row.match) continue;
      pushBlockedVideoFeedItem(summary, row);
      chunks.splice(relatedIndexes[i], 1);
      changed = true;
    }
  }

  return changed ? concat(chunks) : null;
}

// 过滤视频页内嵌的推荐流内容，未配置任何屏蔽规则时直接返回原始消息。
async function filterVideoRelatedMatches(message, summary, keywords) {
  if (!hasAnyFilterRule(keywords)) return message;
  const filtered = await filterVideoRelatedMatchesPart(message, summary, keywords, 0, false);
  return filtered || message;
}

// 处理视频页推荐流（RelatesFeed）的 gRPC 响应。
async function handleRelatesFeedResponse() {
  const message = decodeGrpcBody(getResponseBodyBytes());
  const fields = parseFields(message);
  const keywords = buildKeywords();
  const summary = videoCleanupSummary();
  const entries = [];
  const rows = [];

  for (const field of fields) {
    if (field.no === 1 && field.wireType === 2) {
      const cleanupType = videoRelatedCleanupType(field.value, 'related');
      if (cleanupType) {
        pushCleanupItem(summary, cleanupType, field.value);
        continue;
      }
      const row = videoRelatedFilterRow(field.value);
      rows.push(row);
      entries.push({ field, row });
      continue;
    }
    entries.push({ field });
  }

  await applyFilterMatches(rows, keywords);

  let kept = 0;
  const chunks = [];
  for (const entry of entries) {
    if (entry.row?.match) {
      pushBlockedVideoFeedItem(summary, entry.row);
      continue;
    }
    if (entry.row) kept += 1;
    chunks.push(entry.field.raw);
  }

  setResponseBodyBytes(encodeGrpcBody(concat(chunks)));
  const notifyPayload = videoFeedNotifyPayload(summary, kept);
  const cleanupPayload = videoFeedNotifyPayload(videoNotificationSummary(summary, "remove"), kept);
  const filterPayload = videoFeedNotifyPayload(videoNotificationSummary(summary, "filter"), kept);
  log('info', { page: 'videoFeed', endpoint: 'relatesFeed', kept, cleaned: notifyPayload.cleaned, blocked: notifyPayload.blocked, summary });
  notifyCleanupAndFilter({
    cleaned: notifyPayload.cleaned,
    blocked: notifyPayload.blocked,
    combined: notifyPayload,
    cleanup: cleanupPayload,
    filter: filterPayload,
  });
  $done({ response: $response });
}

// 处理视频详情页（View）的 gRPC 响应，清理推荐项并在需要时缓存视频 Tag。
async function handleViewResponse() {
  const message = decodeGrpcBody(getResponseBodyBytes());
  const keywords = buildKeywords();
  const summary = videoCleanupSummary();
  let nextMessage = sanitizeVideoPageMessage(message, summary, { bannerFieldNo: 7 });
  nextMessage = await filterVideoRelatedMatches(nextMessage, summary, keywords);
  const notifyPayload = videoViewNotifyPayload(summary);
  if (notifyPayload.cleaned || notifyPayload.blocked) {
    setResponseBodyBytes(encodeGrpcBody(nextMessage));
  }

  if (arg.deepFilter) {
    const tags = collectTopicTags(nextMessage);
    const aid = extractViewAidFromRequest() || extractViewAidFromMessage(nextMessage);
    const cacheResult = saveCachedTags(aid, tags, "");
    const cacheNotifyPayload = videoViewNotifyPayload(summary, cacheResult, aid);
    log("info", { page: "view", aid, tags, cacheStatus: cacheResult.status, cleaned: cacheNotifyPayload.cleaned, blocked: cacheNotifyPayload.blocked, summary });
    notifyCleanupAndFilter({
      cleaned: cacheNotifyPayload.cleaned,
      blocked: cacheNotifyPayload.blocked,
      combined: cacheNotifyPayload,
      cleanup: videoViewNotifyPayload(videoNotificationSummary(summary, "remove"), cacheResult, aid),
      filter: videoViewNotifyPayload(videoNotificationSummary(summary, "filter"), cacheResult, aid),
    });
  } else {
    log("info", { page: "view", cleaned: notifyPayload.cleaned, blocked: notifyPayload.blocked, summary });
    notifyCleanupAndFilter({
      cleaned: notifyPayload.cleaned,
      blocked: notifyPayload.blocked,
      combined: notifyPayload,
      cleanup: videoViewNotifyPayload(videoNotificationSummary(summary, "remove")),
      filter: videoViewNotifyPayload(videoNotificationSummary(summary, "filter")),
    });
  }
  $done({ response: $response });
}

// 生成 Tag 缓存状态的中文描述文案。
function cacheStatusText(status, aid) {
  const suffix = aid ? ` aid ${aid}` : "";
  if (status === "created") return `新增缓存${suffix}`;
  if (status === "updated") return `更新缓存${suffix}`;
  if (status === "skipped") return aid ? `未缓存${suffix}` : "未解析到 aid";
  return `已有缓存${suffix}`;
}

// 生成屏蔽结果的系统通知正文。
function removedItemsMessage(removedItems, emptyMessage = "未命中屏蔽规则") {
  if (!removedItems.length) return emptyMessage;
  return itemListMessage("屏蔽视频", removedItems);
}

// 根据屏蔽规则内部名返回对应的用户可见名称。
function blockRuleLabel(rule) {
  return BLOCK_RULE_LABELS[rule] || "";
}

// 生成列表型的通知正文，最多展示前 5 项。
function itemListMessage(label, items) {
  if (!items.length) return `${label}：无`;
  return `${label}：\n` + items
    .slice(0, 5)
    .map((item, index) => {
      const rule = blockRuleLabel(item.rule);
      return `${index + 1}、标题：${item.title || "-"}｜UP：${item.up || "-"}${rule ? `｜规则：${rule}` : ""}`;
    })
    .join("\n");
}

// 清理通知展示用途的文本，去除其中的 HTML 标签。
function cleanNotifyText(value) {
  return compactDisplayText(String(value || "").replace(/<[^>]+>/g, ""));
}

// 判断文本是否包含二进制残片或广告卡片的类型字段，这些内容不适合用于通知展示。
function isDirtySummaryText(value) {
  const text = String(value || "");
  return /[\x00-\x08\x0e-\x1f\ufffd]/.test(text) ||
    /\b(?:picture_ad|cm_ad|banner_ad|inline_av|inline_pgc)\b/i.test(text);
}

// 提取带有字段路径的可读字符串，作为通知摘要的结构化兜底来源。
function readableProtobufEntries(bytes, maxDepth = 8) {
  const entries = [];
  walkProtobufFields(bytes, ({ fields, path }) => {
    for (const field of fields) {
      if (field.wireType !== 2 || !field.value.length) continue;
      const value = cleanNotifyText(decodeString(field.value).replace(/\s+/g, " ").trim());
      if (!value || !/[\u4e00-\u9fff]/.test(value) || isDirtySummaryText(value)) continue;
      entries.push({ path: path.concat(field.no).join("."), value });
    }
    return null;
  }, { maxDepth });

  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry.path}\n${entry.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// 判断字段路径是否以指定的字段序列结尾。
function pathEndsWith(path, suffix) {
  return path === suffix || path.endsWith(`.${suffix}`);
}

// 判断文本是否为播放量、时间戳等元信息，这些信息不适合作为标题摘要展示。
function isSummaryMetaText(value) {
  const text = cleanNotifyText(value);
  if (!text) return true;
  return isDirtySummaryText(text) ||
    /^(\d+\s*(秒|分钟|小时|天)前|刚刚|昨天)(\s*·\s*.+)?$/.test(text) ||
    /^·?\s*\d{1,2}月\d{1,2}日(投递)?$/.test(text) ||
    /^\d+(\.\d+)?[万亿]?(播放|弹幕|粉丝|个视频|次|万次)$/.test(text) ||
    /^共\d+集\b/.test(text) ||
    /^\[[^\]]+\]$/.test(text) ||
    /^(已关注|关注|全文|分享|搜索反馈|添加至稍后再看|UP主的推荐|去看看|视频|综合|用户)$/.test(text) ||
    /^(与搜索词无关|不是我想找的up主|只想看视频|看后发现质量差|内容过时|我不想看该视频)$/.test(text) ||
    /^(这条动态已被封印|该专属内容暂不支持|还不能点赞|暂无权查看当前评论)/.test(text);
}

// 按字段路径优先级顺序，读取第一个可以作为标题使用的字段值。
function firstSummaryEntry(entries, suffixes, ignoredValues = []) {
  for (const suffix of suffixes) {
    const found = entries.find((entry) =>
      pathEndsWith(entry.path, suffix) &&
      !isSummaryMetaText(entry.value) &&
      !ignoredValues.includes(entry.value)
    );
    if (found) return found.value;
  }
  return "";
}

// 结合命中关键词从可读字段中兜底生成标题文本。
function firstKeywordSummaryEntry(entries, match, ignoredValues = []) {
  const keyword = String(match?.keyword || "");
  const matchedValue = cleanNotifyText(match?.value || "");
  return firstNonEmpty(entries
    .map((entry) => entry.value)
    .concat(matchedValue)
    .filter((value) =>
      value &&
      !isSummaryMetaText(value) &&
      !ignoredValues.includes(value) &&
      (!keyword || value.includes(keyword) || matchedValue.includes(value))
    ));
}

// 在无法解析到结构化标题时，生成一个安全的兜底标题文本。
function fallbackKeywordTitle(match) {
  const keyword = cleanNotifyText(match?.keyword || "");
  const matchedValue = cleanNotifyText(match?.value || "");
  if (keyword) return `命中关键词：${keyword}`;
  return isSummaryMetaText(matchedValue) ? "命中关键词" : matchedValue;
}

// 从候选字段中提取 UP 主名称。
function firstSummaryUp(entries, suffixes) {
  const value = firstSummaryEntry(entries, suffixes);
  return normalizeUpName(value);
}

// 拼接多组列表文案，遇到空组时自动跳过。
function presentItemListMessages(groups, emptyMessage) {
  const messages = groups
    .filter(([, items]) => items.length)
    .map(([label, items]) => itemListMessage(label, items));
  return messages.length ? messages.join("\n\n") : emptyMessage;
}

// 从 JSON 推荐项中提取标题与 UP 主名称。
function extractVideoFeedItemText(item) {
  const titles = [
    item?.title,
    item?.player_args?.title,
    item?.part,
    item?.ad_info?.creative_content?.title,
    item?.ad_info?.creative_content?.card?.title,
    item?.ad_info?.extra?.card?.title,
  ].filter(Boolean);
  const upNames = [
    item?.owner?.name,
    item?.args?.up_name,
    item?.desc_button?.text,
    item?.name,
    item?.ad_info?.extra?.card?.adver_name,
    item?.ad_info?.extra?.card?.adver?.adver_name,
  ].filter(Boolean);
  return { titles, upNames };
}

// 判断 JSON 推荐项是否为广告。
function isVideoFeedAdItem(item) {
  if (!item) return false;
  const goto = String(item.card_goto || item.goto || item.card_type || "");
  return !!item.ad_info || /(^|_)ad(_|$)/.test(goto);
}

// 判断 JSON 推荐项是否为直播推荐，递归检查对象中常见的直播相关字段。
function isVideoFeedLiveRecommendation(item) {
  if (!item) return false;
  const directType = String(item.card_goto || item.goto || item.card_type || item.type || "");
  if (/^(live|live_room|vertical_live|live_rcmd)$/.test(directType) || /(^|_)live(_|$)/.test(directType)) return true;

  let matched = false;
  // 递归遍历当前结构。
  function walk(value, key, depth) {
    if (matched || depth > 5 || value === null || value === undefined) return;

    if (typeof value === "string") {
      if (/^bilibili:\/\/live(?:\/|\?|$)/.test(value)) matched = true;
      return;
    }

    if (typeof value === "number") {
      if (value > 0 && /^(roomid|room_id|live_room_id|liveroom_id)$/.test(key)) matched = true;
      return;
    }

    if (typeof value === "boolean") return;

    if (Array.isArray(value)) {
      for (const item of value) walk(item, key, depth + 1);
      return;
    }

    if (typeof value === "object") {
      for (const [childKey, childValue] of Object.entries(value)) {
        if (/^(live_info|live_play_info|live_room_info)$/.test(childKey) && childValue && typeof childValue === "object") {
          matched = true;
          return;
        }
        walk(childValue, childKey, depth + 1);
      }
    }
  }

  walk(item, "", 0);
  return matched;
}

// 从 JSON 推荐项中提取视频 aid。
function videoFeedItemAid(item) {
  return String(item?.args?.aid || item?.player_args?.aid || item?.param || extractAidFromText(item?.uri) || "");
}

// 从 JSON 推荐项构建对应的过滤行结构。
function videoFeedFilterRow(item) {
  const { titles, upNames } = extractVideoFeedItemText(item);
  return {
    item,
    titles,
    upNames,
    aid: videoFeedItemAid(item),
    inlineTags: [],
  };
}

// 处理 JSON 格式视频推荐流（feed/index/story）的 HTTP 响应。
async function handleVideoFeedIndex() {
  const json = parseResponseJson();
  if (!Array.isArray(json?.data?.items)) {
    log("info", { page: "videoFeed", endpoint: "feedIndex", message: "items not found" });
    return $done({ response: $response });
  }
  const items = json.data.items;
  const keywords = buildKeywords();
  const summary = videoCleanupSummary();
  const rows = [];
  const nextItems = [];

  for (const item of items) {
    const { titles, upNames } = extractVideoFeedItemText(item);
    if (arg.cleanVideoRelatedLiveRecommendations && isVideoFeedLiveRecommendation(item)) {
      summary.liveRecommendations.push({ title: firstNonEmpty(titles), up: firstNonEmpty(upNames) });
      continue;
    }
    if (arg.cleanVideoRelatedAds && isVideoFeedAdItem(item)) {
      summary.relatedAds.push({ title: firstNonEmpty(titles), up: firstNonEmpty(upNames) });
      continue;
    }
    rows.push(videoFeedFilterRow(item));
  }

  await applyFilterMatches(rows, keywords);

  for (const row of rows) {
    if (row.match) {
      pushBlockedVideoFeedItem(summary, row);
      continue;
    }
    nextItems.push(row.item);
  }

  json.data.items = nextItems;
  setResponseBodyText(JSON.stringify(json));
  const notifyPayload = videoFeedNotifyPayload(summary, nextItems.length);
  const cleanupPayload = videoFeedNotifyPayload(videoNotificationSummary(summary, "remove"), nextItems.length);
  const filterPayload = videoFeedNotifyPayload(videoNotificationSummary(summary, "filter"), nextItems.length);
  log("info", { page: "videoFeed", endpoint: "feedIndex", kept: nextItems.length, cleaned: notifyPayload.cleaned, blocked: notifyPayload.blocked, summary });
  notifyCleanupAndFilter({
    cleaned: notifyPayload.cleaned,
    blocked: notifyPayload.blocked,
    combined: notifyPayload,
    cleanup: cleanupPayload,
    filter: filterPayload,
  });
  $done({ response: $response });
}

// 汇总首页推荐页的通知正文。
function homeFeedNotifyMessage(removedItems, cleanedAdItems, cleanedPromotedVideoItems) {
  return presentItemListMessages([
    ["屏蔽视频", removedItems],
    ["清理-首页推荐页广告", cleanedAdItems],
    ["清理-首页推荐页推广视频", cleanedPromotedVideoItems],
  ], "未命中屏蔽或清理规则");
}

// 生成首页推荐页的通知副标题文本。
function homeFeedNotifySubtitle(kept, removed, cleanedAds, cleanedPromotedVideos) {
  return `保留 ${kept} / 屏蔽 ${removed} / 清理广告 ${cleanedAds} / 清理推广 ${cleanedPromotedVideos}`;
}

// 清理搜索结果卡片中用于匹配的文本，去除 HTML 标签并合并空白，但保留完整的文本长度。
function cleanSearchResultMatchText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// 提取搜索结果卡片里的可读字段，供内容关键词与 UP 主名称进行匹配。
function searchResultReadableEntries(bytes, maxDepth = 8) {
  const entries = [];
  walkProtobufFields(bytes, ({ fields, path }) => {
    for (const field of fields) {
      if (field.wireType !== 2 || !field.value.length) continue;
      const value = cleanSearchResultMatchText(decodeString(field.value));
      if (!value || !/[\u4e00-\u9fff]/.test(value) || isDirtySummaryText(value)) continue;
      entries.push({ path: path.concat(field.no).join("."), value });
    }
    return null;
  }, { maxDepth });

  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry.path}\n${entry.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// 汇总搜索结果卡片中可以参与内容关键词匹配的全部文本。
function searchResultCandidateValues(bytes) {
  return uniqueStrings([
    ...searchResultReadableEntries(bytes).map((entry) => entry.value),
    ...extractReadableStrings(bytes),
  ]);
}

// 提取搜索结果卡片里的 UP 主名称。普通视频、用户卡片以及动态卡片的字段路径各不相同，需要分别处理。
function searchResultUpNames(bytes) {
  const upPaths = [
    "37.10",
    "23.1",
    "23.14",
    "23.14.2",
    "23.32",
  ];
  return uniqueStrings(searchResultReadableEntries(bytes)
    .filter((entry, _index, entries) =>
      upPaths.some((suffix) => pathEndsWith(entry.path, suffix)) ||
      (
        pathEndsWith(entry.path, "42.5.2") &&
        entries.some((candidate) =>
          pathEndsWith(candidate.path, "42.5.4") &&
          /^(\d+\s*(秒|分钟|小时|天)前|刚刚|昨天|·?\s*\d{1,2}月\d{1,2}日)/.test(candidate.value)
        )
      )
    )
    .map((entry) => normalizeUpName(cleanNotifyText(entry.value)))
    .filter((value) => value && !isSummaryMetaText(value)));
}

// 提取搜索结果卡片中用于通知展示的标题与 UP 主名称。
function searchResultTextSummary(bytes, match = null) {
  const entries = readableProtobufEntries(bytes, 8);
  const up = firstSummaryUp(entries, [
    "37.10",
    "23.1",
    "23.14",
    "23.14.2",
    "23.32",
  ]) || firstNonEmpty(searchResultUpNames(bytes));
  const ignoredValues = up ? [up] : [];
  const title = firstSummaryEntry(entries, [
    "37.1",
    "42.1",
    "10.1",
    "52.2.1",
    "23.14.2",
    "23.1",
    "23.8",
    "44.2.1",
    "23.21.1",
  ], ignoredValues) ||
    (match ? firstKeywordSummaryEntry(entries, match, ignoredValues) : "") ||
    (match?.rule === "upExact" ? firstNonEmpty(searchResultReadableEntries(bytes)
      .map((entry) => entry.value)
      .filter((value) => !isSummaryMetaText(value) && !ignoredValues.includes(value))) : "") ||
    (match ? fallbackKeywordTitle(match) : firstNonEmpty(entries
      .map((entry) => entry.value)
      .filter((value) => !isSummaryMetaText(value) && !ignoredValues.includes(value))));
  return { title, up };
}

// 生成搜索结果过滤项的展示摘要。
function searchResultSummary(bytes, match) {
  const { title, up } = searchResultTextSummary(bytes, match);
  return {
    title,
    up,
    rule: match?.rule || "searchResultKeywords",
    keyword: match?.keyword,
    matchedValue: cleanNotifyText(match?.value || ""),
  };
}

// 读取 SearchAll 卡片的类型信息，包括顶层类型与元数据类型。
function searchResultCardInfo(bytes) {
  const fields = tryParseFields(bytes) || [];
  const topLevelTypes = [
    ...fieldStrings(fields, 2),
    ...fieldStrings(fields, 3),
    ...fieldStrings(fields, 4),
  ].map((value) => String(value || "").trim().toLowerCase());
  const metadataTypes = fieldStrings(fields, 63)
    .map((value) => {
      try {
        return String(JSON.parse(value)?.type || "").trim().toLowerCase();
      } catch {
        return "";
      }
    })
    .filter(Boolean);
  return {
    fields,
    type: metadataTypes[0] || topLevelTypes.find(Boolean) || "",
    topLevelTypes,
    metadataTypes,
  };
}

// 判断 SearchAll 卡片是否为普通视频结果。只有普通视频才需要执行 Tag 过滤，其他类型跳过该步骤。
function isVideoSearchResult(bytes) {
  const info = searchResultCardInfo(bytes);
  const types = [...info.metadataTypes, ...info.topLevelTypes];
  return types.includes("video") || types.includes("av");
}

// 构建搜索结果过滤行。标题关键词与视频 Tag 仅作用于普通视频，UP 名称则可作用于所有类型的混合卡片。
function searchResultFilterRow(bytes, keywords, isVideo) {
  const summary = searchResultTextSummary(bytes);
  return createFilterRow({
    titles: isVideo && summary.title ? [summary.title] : [],
    upNames: uniqueStrings([
      summary.up,
      ...searchResultUpNames(bytes),
    ]),
    aid: isVideo ? extractAidFromText(decodeString(bytes)) : "",
    inlineTags: isVideo && hasVideoTagFilter(keywords) ? collectTopicTags(bytes) : [],
  });
}

// 判断 SearchAll 卡片是否为广告型卡片。video_ad 类型会被单独归入创作推广，以便通过对应的功能开关进行区分。
function isSearchResultAdType(type, topLevelTypes) {
  const values = [type, ...topLevelTypes]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  return values.some((value) =>
    value !== "video_ad" &&
    (/^(ad|ads|cm|commercial)$/.test(value) ||
      /(^|_)(ad|ads)($|_)/.test(value) ||
      /(^|_)cm(_|$)/.test(value))
  );
}

// 判断 SearchAll 卡片命中的移除类规则，按优先级顺序返回首个匹配的规则名。
function searchResultCleanupRule(bytes) {
  const info = searchResultCardInfo(bytes);
  const types = [info.type, ...info.metadataTypes, ...info.topLevelTypes]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  const context = { info, types };
  const cleanupRule = SEARCH_RESULT_CLEANUP_RULES_BY_PRIORITY.find((item) =>
    arg[item.argKey] && item.matches(context)
  );
  return cleanupRule?.rule || "";
}

// 生成被移除的搜索结果卡片的摘要信息。
function searchResultCleanupSummary(bytes, rule) {
  const { title, up } = searchResultTextSummary(bytes);
  return {
    title: title || firstNonEmpty(extractReadableStrings(bytes)) || blockRuleLabel(rule),
    up,
    rule,
  };
}

// 创建一个按规则分组的搜索结果清理结果的容器对象。
function emptySearchResultCleanedItems() {
  const cleaned = {};
  for (const item of SEARCH_RESULT_CLEANUP_RULES) cleaned[item.key] = [];
  return cleaned;
}

// 统计全部搜索结果移除规则的总命中数量。
function searchResultCleanedCount(cleaned) {
  return SEARCH_RESULT_CLEANUP_RULES.reduce((sum, item) => sum + cleaned[item.key].length, 0);
}

// 生成各清理规则命中数量的日志字段。
function searchResultCleanedLogCounts(cleaned) {
  const counts = {};
  for (const item of SEARCH_RESULT_CLEANUP_RULES) counts[item.key] = cleaned[item.key].length;
  return counts;
}

// 按规则名将被清理的 SearchAll 卡片条目归入对应的类别。
function pushSearchResultCleanedItem(cleaned, item) {
  const cleanupRule = SEARCH_RESULT_CLEANUP_RULES.find((candidate) => candidate.rule === item.rule);
  if (cleanupRule) cleaned[cleanupRule.key].push(item);
}

// 判断是否启用了任意一条搜索结果移除规则。
function hasSearchResultCleanupRule() {
  return SEARCH_RESULT_CLEANUP_RULES.some((item) => arg[item.argKey]);
}

// 生成搜索结果处理的系统通知标题。
function searchAllNotifyTitle(cleaned, blocked) {
  if (cleaned && blocked) return "Bilibili 搜索结果处理";
  if (cleaned) return "Bilibili 搜索结果清理";
  return "Bilibili 搜索结果屏蔽";
}

// 生成搜索结果处理的系统通知副标题。
function searchAllNotifySubtitle(kept, blocked, cleaned) {
  const parts = [`保留 ${kept}`, `屏蔽 ${blocked}`];
  const cleanedCount = searchResultCleanedCount(cleaned);
  if (cleanedCount) {
    parts.push(...SEARCH_RESULT_CLEANUP_RULES.map((item) => `${item.subtitle} ${cleaned[item.key].length}`));
  }
  return parts.join(" / ");
}

// 生成搜索结果处理的系统通知正文。
function searchAllNotifyMessage(blockedItems, cleaned, cleanupEnabled) {
  return presentItemListMessages([
    ["屏蔽搜索结果", blockedItems],
    ...SEARCH_RESULT_CLEANUP_RULES.map((item) => [blockRuleLabel(item.rule), cleaned[item.key]]),
  ], cleanupEnabled ? "未命中搜索结果清理或屏蔽规则" : "未命中搜索结果屏蔽规则");
}

// 汇总搜索候选词条中可以参与关键词匹配的全部文本。
function searchSuggestCandidateValues(bytes) {
  const fields = tryParseFields(bytes) || [];
  return uniqueStrings([
    decodeString(bytes),
    ...fieldStrings(fields, 2),
    ...fieldStrings(fields, 3),
    ...extractReadableStrings(bytes),
  ]);
}

// 生成搜索候选词条过滤项的展示摘要。
function searchSuggestSummary(bytes, match) {
  const entries = readableProtobufEntries(bytes, 4);
  const ignoredValues = ["search"];
  const title = firstSummaryEntry(entries, [
    "3",
    "2",
    "1",
  ], ignoredValues) ||
    firstKeywordSummaryEntry(entries, match, ignoredValues) ||
    fallbackKeywordTitle(match);
  return {
    title,
    up: "",
    rule: match?.rule || "searchResultKeywords",
    keyword: match?.keyword,
    matchedValue: cleanNotifyText(match?.value || ""),
  };
}

// 处理搜索候选词条（Suggest3）的 gRPC 响应。
function handleSearchSuggestResponse() {
  const keywords = buildContentKeywords(arg.searchResultKeywords);
  if (!hasContentKeywords(keywords)) {
    log("info", { page: "searchSuggest", message: "no search suggest keywords configured" });
    return $done({ response: $response });
  }

  const message = decodeGrpcBody(getResponseBodyBytes());
  const fields = parseFields(message);
  let kept = 0;
  let removed = 0;
  const removedItems = [];
  const chunks = [];

  for (const field of fields) {
    if (field.no === 2 && field.wireType === 2) {
      const match = findContentKeywordMatch(
        searchSuggestCandidateValues(field.value),
        keywords,
        "searchResultKeywords"
      );
      if (match) {
        removed += 1;
        removedItems.push(searchSuggestSummary(field.value, match));
        continue;
      }
      kept += 1;
    }
    chunks.push(field.raw);
  }

  if (removed) setResponseBodyBytes(encodeGrpcBody(concat(chunks)));
  log("info", {
    page: "searchSuggest",
    kept,
    removed,
    keywords: keywords.displayKeywords,
    removedItems,
  });
  notify(
    "filter",
    "Bilibili 搜索候选词条屏蔽",
    `保留 ${kept} / 屏蔽 ${removed}`,
    removedItems.length ? itemListMessage("屏蔽搜索候选词条", removedItems) : "未命中搜索候选词条屏蔽规则"
  );
  $done({ response: $response });
}

// 处理搜索结果（SearchAll）的 gRPC 响应。
async function handleSearchAllResponse() {
  const contentKeywords = buildContentKeywords(arg.searchResultKeywords);
  const videoKeywords = buildKeywords();
  const hasSearchResultKeywords = hasContentKeywords(contentKeywords);
  const hasSearchVideoFilter = hasAnyFilterRule(videoKeywords);
  const hasSearchCleanupRule = hasSearchResultCleanupRule();
  if (!hasSearchCleanupRule && !hasSearchResultKeywords && !hasSearchVideoFilter) {
    log("info", { page: "searchAll", message: "no search cleanup rules, video search result keywords, title/up rules or video tag rules configured" });
    return $done({ response: $response });
  }

  const message = decodeGrpcBody(getResponseBodyBytes());
  const fields = parseFields(message);
  const entries = [];
  const tagRows = [];

  for (const field of fields) {
    if (field.no === 4 && field.wireType === 2) {
      const cleanupRule = searchResultCleanupRule(field.value);
      if (cleanupRule) {
        entries.push({ field, row: null, isVideo: false, cleanupRule });
        continue;
      }
      const isVideo = isVideoSearchResult(field.value);
      const row = searchResultFilterRow(field.value, videoKeywords, isVideo);
      row.match = findTextMatch(row.titles, row.upNames, videoKeywords);
      const contentMatch = hasSearchResultKeywords
        ? findContentKeywordMatch(searchResultCandidateValues(field.value), contentKeywords, "searchResultKeywords")
        : null;
      if (!row.match && contentMatch) row.match = contentMatch;
      if (isVideo) tagRows.push(row);
      entries.push({ field, row, isSearchCard: true, cleanupRule: "" });
      continue;
    }
    entries.push({ field, row: null, isSearchCard: false, cleanupRule: "" });
  }

  await applyTagMatches(tagRows, videoKeywords);

  let kept = 0;
  let removed = 0;
  const removedItems = [];
  const cleanedItems = emptySearchResultCleanedItems();
  const chunks = [];
  for (const entry of entries) {
    const { field, row, isSearchCard, cleanupRule } = entry;
    if (cleanupRule) {
      const item = searchResultCleanupSummary(field.value, cleanupRule);
      pushSearchResultCleanedItem(cleanedItems, item);
      continue;
    }
    if (isSearchCard) {
      if (row?.match) {
        removed += 1;
        removedItems.push(searchResultSummary(field.value, row.match));
        continue;
      }
      kept += 1;
    }
    chunks.push(field.raw);
  }

  const cleanedCount = searchResultCleanedCount(cleanedItems);
  if (removed || cleanedCount) setResponseBodyBytes(encodeGrpcBody(concat(chunks)));
  log("info", {
    page: "searchAll",
    kept,
    removed,
    cleaned: searchResultCleanedLogCounts(cleanedItems),
    keywords: contentKeywords.displayKeywords,
    titleBlockKeywords: videoKeywords.displayTitleKeywords,
    blockedUps: videoKeywords.displayBlockedUps,
    deepFilter: arg.deepFilter,
    videoTagKeywords: videoKeywords.displayVideoTagKeywords,
    removedItems,
    cleanedItems,
  });
  const cleanupOnly = hasSearchCleanupRule && !hasSearchResultKeywords && !hasSearchVideoFilter;
  const notifyTitle = searchAllNotifyTitle(cleanedCount > 0 || cleanupOnly, removed > 0);
  const emptyCleanedItems = emptySearchResultCleanedItems();
  notifyCleanupAndFilter({
    cleaned: cleanedCount,
    blocked: removed,
    combined: {
      title: notifyTitle,
      subtitle: searchAllNotifySubtitle(kept, removed, cleanedItems),
      message: searchAllNotifyMessage(removedItems, cleanedItems, hasSearchCleanupRule),
    },
    cleanup: {
      title: searchAllNotifyTitle(true, false),
      subtitle: searchAllNotifySubtitle(kept, 0, cleanedItems),
      message: searchAllNotifyMessage([], cleanedItems, true),
    },
    filter: {
      title: searchAllNotifyTitle(false, true),
      subtitle: searchAllNotifySubtitle(kept, removed, emptyCleanedItems),
      message: searchAllNotifyMessage(removedItems, emptyCleanedItems, false),
    },
    emptyCategory: cleanupOnly ? "remove" : "filter",
  });
  $done({ response: $response });
}
/* -------------------------------------------------------------------------- */
/* 评论区清理                                                                 */
/* -------------------------------------------------------------------------- */

// 评论区置顶广告回复的特征标记：包括商业跳转链接、广告来源对象以及广告素材字段等。
const REPLY_AD_MARKER_PATTERN = /ad_cb|cm\.bilibili\.com\/ldad|googleapis\.com\/bilibili\.ad\.v1|SourceContentDto|schema_name":"ad|"ad_info"|reply_control"[^"]*ad/;

// 判断一段 protobuf 字节是否为广告回复。
function isReplyAd(bytes) {
  return REPLY_AD_MARKER_PATTERN.test(decodeString(bytes));
}

// 判断一段 protobuf 字节是否为「结构化回复条目」：需要能解析出多个字段且包含 varint（回复条目通常带有 rpid 等 varint 字段）。
// 该判断用于区分真正的回复消息与裸字符串或回复列表容器——后两者不应在此层级移除，而是下沉到子层级处理或原样保留。
function isStructuredReplyMessage(bytes) {
  const fields = tryParseFields(bytes);
  if (!fields || fields.length < 2) return false;
  return fields.some((field) => field.wireType === 0);
}

// 创建评论区广告清理的统计对象。
function replyCleanupSummary() {
  return { topAds: [] };
}

// 移除评论区中的广告回复（仅删除结构化的广告回复条目，避免误删整段回复列表或裸字符串），返回改写后的字节数组。
function sanitizeReplyMainList(message, summary) {
  const result = transformProtobufFields(message, ({ field }) => {
    if (!isProtobufMessageField(field) || !isReplyAd(field.value)) return null;
    if (!isStructuredReplyMessage(field.value)) return null;
    summary.topAds.push({ title: firstNonEmpty(extractReadableStrings(field.value)) || "置顶广告" });
    return { remove: true };
  }, { maxDepth: 12 });
  return result.changed ? result.bytes : message;
}

// 生成评论区广告清理的系统通知正文。
function replyNotifyMessage(items) {
  if (!items.length) return "未命中评论区置顶广告";
  return "移除-评论区置顶广告：\n" + items
    .slice(0, 5)
    .map((item, index) => `${index + 1}、${item.title}`)
    .join("\n");
}

// 处理评论区（Reply/MainList）的 gRPC 响应，移除其中的置顶广告回复。
function handleReplyMainListResponse() {
  if (!arg.cleanReplyTopAds) {
    log("info", { page: "reply", message: "switch off" });
    return $done({ response: $response });
  }

  const message = decodeGrpcBody(getResponseBodyBytes());
  const summary = replyCleanupSummary();
  const nextMessage = sanitizeReplyMainList(message, summary);
  if (summary.topAds.length) setResponseBodyBytes(encodeGrpcBody(nextMessage));

  log("info", { page: "reply", removed: summary.topAds.length, summary });
  notify(
    "remove",
    "Bilibili 评论区置顶广告清理",
    `移除 ${summary.topAds.length}`,
    replyNotifyMessage(summary.topAds)
  );
  $done({ response: $response });
}
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
/* -------------------------------------------------------------------------- */
/* 动态页过滤与个性化                                                         */
/* -------------------------------------------------------------------------- */

// 压缩展示文本：去除零宽字符与链接，超长时进行截断并附加省略号。
function compactDisplayText(value, maxLength = 48) {
  const text = String(value || "")
    .replace(/\u200b/g, "")
    .replace(/\ufffd/g, "")
    .replace(/https?:\/\/\S+|tbopen:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

// 汇总动态页 UP 主推荐商品的展示信息。
function dynamicUpRecommendationSummary(bytes) {
  const rawText = decodeString(bytes);
  const values = extractReadableStrings(bytes)
    .map((value) => compactDisplayText(value))
    .filter((value) => value && !/^(UP主的推荐|淘宝|商品来自淘宝|去看看)$/.test(value));
  return {
    title: firstNonEmpty(values) || "UP主的推荐",
    source: /商品来自淘宝/.test(rawText) ? "商品来自淘宝" : (/淘宝|taobao|tbopen:/.test(rawText) ? "淘宝" : ""),
  };
}

// 汇总被关键词屏蔽的整条动态的展示信息。
function dynamicKeywordBlockSummary(bytes, match) {
  const entries = readableProtobufEntries(bytes, 8);
  const up = firstSummaryUp(entries, [
    "3.2.3.2",
    "4.4",
    "4.30",
  ]);
  const ignoredValues = up ? [up] : [];
  const title = firstSummaryEntry(entries, [
    "4.6.1",
    "4.6.10",
    "3.5.2.1",
    "3.5.20.10",
    "3.8.9.2",
  ], ignoredValues) ||
    firstKeywordSummaryEntry(entries, match, ignoredValues) ||
    fallbackKeywordTitle(match);
  return {
    title,
    up,
    rule: "dynamicKeywords",
    keyword: match?.keyword,
    matchedValue: cleanNotifyText(match?.value || ""),
  };
}

// 判断整条动态是否命中动态页关键词。
function findDynamicKeywordMatch(bytes, keywords) {
  return findContentKeywordMatch([
    decodeString(bytes),
    ...extractReadableStrings(bytes),
  ], keywords, "dynamicKeywords");
}

// 判断是否为动态页 UP 主推荐模块。
function isDynamicUpRecommendationModule(bytes) {
  const fields = tryParseFields(bytes);
  if (!fields || varintField(fields, 1) !== 8) return false;

  const text = decodeString(bytes);
  return /UP主的推荐/.test(text) &&
    /(商品来自淘宝|schema_name":"淘宝|tbopen:|taobao|com\.taobao|\/bfs\/mall\/|去看看|is_ad_loc)/.test(text);
}

// 判断是否为动态页扩展商品信息。
function isDynamicUpRecommendationExtendGoods(bytes) {
  const text = decodeString(bytes);
  return /(商品来自淘宝|schema_name":"淘宝|tbopen:|taobao|com\.taobao|\/bfs\/mall\/|\/bfs\/sycp\/|is_ad_loc)/.test(text);
}

// 判断是否为动态页推荐详情。
function isDynamicUpRecommendationDetail(bytes) {
  const fields = tryParseFields(bytes);
  if (!fields) return false;

  const labels = [
    ...fieldStrings(fields, 7),
    ...fieldStrings(fields, 13),
  ];
  if (!labels.some((label) => /UP主的推荐/.test(label))) return false;

  return isDynamicUpRecommendationExtendGoods(bytes);
}

// 递归清理动态页中内嵌的推荐详情。
function sanitizeDynamicNestedRecommendations(bytes, summary, alreadyCounted) {
  const result = transformProtobufFields(bytes, ({ field }) => {
    if (isProtobufMessageField(field) && isDynamicUpRecommendationDetail(field.value)) {
      if (!alreadyCounted) summary.upRecommendations.push(dynamicUpRecommendationSummary(field.value));
      return { remove: true };
    }
    return null;
  }, { maxDepth: 10 });

  return result.changed ? result.bytes : bytes;
}

// 清理动态页扩展信息中的推荐商品。
function sanitizeDynamicExtend(extendBytes, summary, alreadyCounted) {
  const result = transformProtobufFields(extendBytes, ({ field, depth }) => {
    if (!isProtobufMessageField(field)) return null;

    const isTopExtendGoods = depth === 0 && field.no === 6 && isDynamicUpRecommendationExtendGoods(field.value);
    if (isTopExtendGoods || isDynamicUpRecommendationDetail(field.value)) {
      if (!alreadyCounted) summary.upRecommendations.push(dynamicUpRecommendationSummary(field.value));
      return { remove: true };
    }
    return null;
  }, { maxDepth: 10 });

  return result.changed ? result.bytes : extendBytes;
}

// 清理单条动态中的推荐模块以及其扩展商品。
function sanitizeDynamicItemModules(itemBytes, summary) {
  const fields = tryParseFields(itemBytes);
  if (!fields) return itemBytes;

  let changed = false;
  let removedRecommendation = false;
  const hasRecommendationModule = fields.some((field) =>
    field.no === 3 && field.wireType === 2 && isDynamicUpRecommendationModule(field.value)
  );
  const chunks = [];
  for (const field of fields) {
    if (field.no === 3 && field.wireType === 2 && isDynamicUpRecommendationModule(field.value)) {
      summary.upRecommendations.push(dynamicUpRecommendationSummary(field.value));
      removedRecommendation = true;
      changed = true;
      continue;
    }
    if (field.no === 4 && field.wireType === 2) {
      const nextExtend = sanitizeDynamicExtend(field.value, summary, hasRecommendationModule || removedRecommendation);
      if (nextExtend !== field.value) {
        chunks.push(encodeField(field.no, field.wireType, nextExtend));
        changed = true;
        continue;
      }
    }
    if (field.wireType === 2 && field.value.length) {
      const nextValue = sanitizeDynamicNestedRecommendations(field.value, summary, hasRecommendationModule || removedRecommendation);
      if (nextValue !== field.value) {
        chunks.push(encodeField(field.no, field.wireType, nextValue));
        changed = true;
        continue;
      }
    }
    chunks.push(field.raw);
  }

  return changed ? concat(chunks) : itemBytes;
}

// 在动态 protobuf 消息中查找推荐商品的字节片段。
function findDynamicUpRecommendationBytes(bytes) {
  let matched = null;
  walkProtobufFields(bytes, ({ fields }) => {
    for (const field of fields) {
      if (!isProtobufMessageField(field)) continue;
      if (isDynamicUpRecommendationModule(field.value) || isDynamicUpRecommendationDetail(field.value)) {
        matched = field.value;
        return { stop: true };
      }
    }
    return null;
  }, { maxDepth: 10 });
  return matched;
}

// 清理动态列表：按指定的模式移除 UP 主推荐项，并根据关键词屏蔽整条动态。
function sanitizeDynamicAllList(listBytes, summary, mode, dynamicKeywords) {
  const fields = tryParseFields(listBytes);
  if (!fields) return listBytes;

  let changed = false;
  const chunks = [];
  for (const field of fields) {
    if (field.no === 1 && field.wireType === 2) {
      summary.dynamicItems += 1;
      const dynamicMatch = findDynamicKeywordMatch(field.value, dynamicKeywords);
      if (dynamicMatch) {
        summary.blockedDynamics.push(dynamicKeywordBlockSummary(field.value, dynamicMatch));
        changed = true;
        continue;
      }

      if (mode === "dynamic") {
        const recommendationBytes = findDynamicUpRecommendationBytes(field.value);
        if (recommendationBytes) {
          summary.upRecommendations.push(dynamicUpRecommendationSummary(recommendationBytes));
          changed = true;
          continue;
        }
        summary.kept += 1;
        chunks.push(field.raw);
        continue;
      }

      const nextItem = sanitizeDynamicItemModules(field.value, summary);
      if (nextItem !== field.value) {
        chunks.push(encodeField(field.no, field.wireType, nextItem));
        changed = true;
        summary.kept += 1;
        continue;
      }
      summary.kept += 1;
    }
    chunks.push(field.raw);
  }

  return changed ? concat(chunks) : listBytes;
}

// 清理动态页的 gRPC 消息体。
function sanitizeDynamicAllMessage(messageBytes, summary, mode, dynamicKeywords) {
  const fields = parseFields(messageBytes);
  let changed = false;
  const chunks = [];
  for (const field of fields) {
    if (field.no === 1 && field.wireType === 2) {
      const nextList = sanitizeDynamicAllList(field.value, summary, mode, dynamicKeywords);
      if (nextList !== field.value) {
        chunks.push(encodeField(field.no, field.wireType, nextList));
        changed = true;
        continue;
      }
    }
    chunks.push(field.raw);
  }
  return changed ? concat(chunks) : messageBytes;
}

// 「最常访问」UP 列表区段的体积上限（字节数），超过该数值的区段将被视为主动态列表等大区段而跳过处理。
const DYNAMIC_UP_LIST_MAX_SIZE = 4096;
// 「最常访问」区段中的直播态标记。在 auto 模式下，命中该标记的区段将被保留而不删除。
const DYNAMIC_LIVE_MARKER_PATTERN = /live_status|"live"|直播中|live_play_info|live_room_id/;

// 判断一段 protobuf 字节是否像「最常访问」UP 列表区段：体积较小、包含多个短 UP 名并且不含动态卡片标记。
function isDynamicUpListSection(bytes) {
  if (bytes.length > DYNAMIC_UP_LIST_MAX_SIZE) return false;
  const text = decodeString(bytes);
  if (/dyn_id_str|rid_str|"dynamic"/.test(text)) return false;
  const names = readableProtobufEntries(bytes, 5)
    .map((entry) => entry.value)
    .filter((value) => value.length >= 2 && value.length <= 12 && /^[一-鿿A-Za-z0-9_]+$/.test(value));
  return names.length >= 3;
}

// 按照 dynamicUpListMode 处理「最常访问」UP 列表区段。
// hide 模式移除整段区段，auto 模式仅在没有直播态标记时才移除，show 模式不做任何改动。
function sanitizeDynamicUpList(message, mode, summary) {
  summary.upListMode = mode;
  if (mode === "show") return message;
  let removedCount = 0;
  const result = transformProtobufFields(message, ({ field, depth }) => {
    // 仅在顶层、且非动态列表（field 1）的字段中查找「最常访问」区段，避免误删动态列表。
    if (depth > 0 || field.no === 1) return null;
    if (!isProtobufMessageField(field) || !isDynamicUpListSection(field.value)) return null;
    if (mode === "auto" && DYNAMIC_LIVE_MARKER_PATTERN.test(decodeString(field.value))) return null;
    removedCount += 1;
    return { remove: true };
  }, { maxDepth: 1 });
  summary.upListRemoved = removedCount;
  return result.changed ? result.bytes : message;
}

// 生成动态页 UP 主推荐的系统通知正文。
function dynamicUpRecommendationMessage(items) {
  if (!items.length) return "未命中动态页 UP 主推荐";
  return "移除-动态页 UP 主的推荐：\n" + items
    .slice(0, 5)
    .map((item, index) => `${index + 1}、标题：${item.title || "UP主的推荐"}${item.source ? "｜来源：" + item.source : ""}`)
    .join("\n");
}

// 汇总动态页的系统通知完整内容。
function dynamicNotifyPayload(summary, mode, cleaned = true) {
  if (!cleaned) {
    return {
      title: "Bilibili 动态页清理",
      subtitle: "已关闭",
      message: "动态页 UP 主推荐清理开关已关闭",
    };
  }
  const actionParts = [];
  if (mode !== "off") actionParts.push(`${mode === "dynamic" ? "移除推荐动态" : "移除推荐模块"} ${summary.upRecommendations.length}`);
  if (summary.blockedDynamics.length) actionParts.push(`屏蔽动态 ${summary.blockedDynamics.length}`);
  if (summary.upListRemoved > 0) actionParts.push(`隐藏最常访问 ${summary.upListRemoved}`);
  return {
    title: "Bilibili 动态页清理",
    subtitle: `保留 ${summary.kept}${actionParts.length ? " / " + actionParts.join(" / ") : ""}`,
    message: dynamicNotifyMessage(summary, mode),
  };
}

// 生成动态页的系统通知正文。
function dynamicNotifyMessage(summary, mode) {
  const messages = [];
  if (summary.upRecommendations.length) messages.push(dynamicUpRecommendationMessage(summary.upRecommendations));
  if (summary.blockedDynamics.length) messages.push(itemListMessage("屏蔽-关注页动态", summary.blockedDynamics));
  if (messages.length) return messages.join("\n\n");
  return mode === "off" ? "未命中动态页清理规则" : dynamicUpRecommendationMessage([]);
}

// 处理动态页（DynAll）的 gRPC 响应。
function handleDynamicAllResponse() {
  const dynamicKeywords = buildContentKeywords(arg.dynamicKeywords);
  const hasUpListAction = dynamicUpListMode !== "show";
  if (dynamicUpRecommendationMode === "off" && !hasContentKeywords(dynamicKeywords) && !hasUpListAction) {
    const notifyPayload = dynamicNotifyPayload({ kept: 0, upRecommendations: [], blockedDynamics: [] }, dynamicUpRecommendationMode, false);
    log("info", { page: "dynamic", endpoint: "DynAll", mode: dynamicUpRecommendationMode, cleaned: false });
    notify("remove", notifyPayload.title, notifyPayload.subtitle, notifyPayload.message);
    return $done({ response: $response });
  }

  const message = decodeGrpcBody(getResponseBodyBytes());
  const summary = { dynamicItems: 0, kept: 0, upRecommendations: [], blockedDynamics: [], upListMode: dynamicUpListMode, upListRemoved: 0 };
  let nextMessage = sanitizeDynamicAllMessage(message, summary, dynamicUpRecommendationMode, dynamicKeywords);
  nextMessage = sanitizeDynamicUpList(nextMessage, dynamicUpListMode, summary);
  if (summary.upRecommendations.length || summary.blockedDynamics.length || summary.upListRemoved) {
    setResponseBodyBytes(encodeGrpcBody(nextMessage));
  }

  const notifyPayload = dynamicNotifyPayload(summary, dynamicUpRecommendationMode);
  const cleanedCount = summary.upRecommendations.length + summary.upListRemoved;
  const cleanupPayload = dynamicNotifyPayload({
    ...summary,
    blockedDynamics: [],
  }, dynamicUpRecommendationMode);
  const filterPayload = dynamicNotifyPayload({
    ...summary,
    upRecommendations: [],
    upListRemoved: 0,
  }, "off");
  log("info", {
    page: "dynamic",
    endpoint: "DynAll",
    mode: dynamicUpRecommendationMode,
    total: summary.dynamicItems,
    kept: summary.kept,
    removed: summary.upRecommendations.length,
    blocked: summary.blockedDynamics.length,
    upListMode: summary.upListMode,
    upListRemoved: summary.upListRemoved,
    dynamicKeywords: dynamicKeywords.displayKeywords,
    removedItems: summary.upRecommendations,
    blockedItems: summary.blockedDynamics,
  });
  notifyCleanupAndFilter({
    cleaned: cleanedCount,
    blocked: summary.blockedDynamics.length,
    combined: notifyPayload,
    cleanup: cleanupPayload,
    filter: filterPayload,
  });
  $done({ response: $response });
}
/* -------------------------------------------------------------------------- */
/* 首页推荐页与首页热门                                                       */
/* -------------------------------------------------------------------------- */

// 从首页推荐项中提取标题与 UP 主名称。
function extractHomeFeedItemText(item) {
  return {
    titles: [
      item?.title,
      item?.player_args?.title,
      item?.ad_info?.creative_content?.title,
      item?.ad_info?.creative_content?.card?.title,
      item?.ad_info?.extra?.card?.title,
    ].filter(Boolean),
    upNames: [
      item?.args?.up_name,
      item?.desc_button?.text,
      item?.desc,
      item?.name,
      item?.owner?.name,
      item?.ad_info?.extra?.card?.adver_name,
      item?.ad_info?.extra?.card?.adver?.adver_name,
    ].filter(Boolean),
  };
}

// 从首页推荐项构建过滤行结构。
function homeFeedFilterRow(item) {
  const { titles, upNames } = extractHomeFeedItemText(item);
  return createFilterRow({
    item,
    titles,
    upNames,
    aid: item?.args?.aid || item?.player_args?.aid || item?.param || extractAidFromText(item?.uri) || "",
    inlineTags: [],
  });
}

// 从首页热门卡片的 protobuf 字节中构建过滤行结构。
function extractPopularFilterRow(cardBytes, keywords) {
  try {
    const text = extractCardText(cardBytes);
    return createFilterRow({
      titles: text.titles,
      upNames: text.upNames,
      aid: text.aid,
      inlineTags: hasVideoTagFilter(keywords) ? collectTopicTags(cardBytes) : [],
    });
  } catch (error) {
    log("debug", "failed to extract card fields", error);
    return createFilterRow({});
  }
}

// 过滤首页推荐页（feed/index）的 HTTP 响应。
async function filterHomeFeedIndex() {
  const keywords = buildKeywords();
  const hasKeywordFilter = hasAnyFilterRule(keywords);
  if (!hasKeywordFilter) {
    log("info", "no keywords configured");
  }

  const json = parseResponseJson();
  if (!Array.isArray(json?.data?.items)) {
    log("info", { page: "homeFeed", message: "items not found" });
    return $done({ response: $response });
  }
  const items = json.data.items;
  let kept = 0;
  let removed = 0;
  let cleanedAds = 0;
  let cleanedPromotedVideos = 0;

  // removedItems / cleaned*Items 只用于通知和日志展示。
  const removedItems = [];
  const cleanedAdItems = [];
  const cleanedPromotedVideoItems = [];

  // rows 保存还需要继续跑屏蔽规则的普通视频项。
  const rows = [];
  const nextItems = [];
  for (const item of items) {
    const cleanupType = getHomeFeedCleanupType(item);
    if (cleanupType === "ad" && arg.cleanFeedAds) {
      const { titles, upNames } = extractHomeFeedItemText(item);
      cleanedAds += 1;
      cleanedAdItems.push({ title: firstNonEmpty(titles), up: firstNonEmpty(upNames) });
      continue;
    }
    if (cleanupType === "promotedVideo" && arg.cleanFeedPromotedVideos) {
      const { titles, upNames } = extractHomeFeedItemText(item);
      cleanedPromotedVideos += 1;
      cleanedPromotedVideoItems.push({ title: firstNonEmpty(titles), up: firstNonEmpty(upNames) });
      continue;
    }

    if (hasKeywordFilter) {
      rows.push(homeFeedFilterRow(item));
    } else {
      kept += 1;
      nextItems.push(item);
    }
  }

  if (hasKeywordFilter) await applyFilterMatches(rows, keywords);

  for (const row of rows) {
    if (row.match) {
      removed += 1;
      removedItems.push(matchedFilterItem(row));
      continue;
    }
    kept += 1;
    nextItems.push(row.item);
  }
  json.data.items = nextItems;

  setResponseBodyText(JSON.stringify(json));
  log("info", {
    ...filterSummary("homeFeed", kept, removed, keywords),
    cleanedAds,
    cleanedPromotedVideos,
    removedItems,
    cleanedAdItems,
    cleanedPromotedVideoItems,
  });
  const cleanedCount = cleanedAds + cleanedPromotedVideos;
  const combinedPayload = {
    title: "Bilibili 首页推荐页屏蔽",
    subtitle: homeFeedNotifySubtitle(kept, removed, cleanedAds, cleanedPromotedVideos),
    message: homeFeedNotifyMessage(removedItems, cleanedAdItems, cleanedPromotedVideoItems),
  };
  notifyCleanupAndFilter({
    cleaned: cleanedCount,
    blocked: removed,
    combined: combinedPayload,
    cleanup: {
      title: "Bilibili 首页推荐页清理",
      subtitle: homeFeedNotifySubtitle(kept, 0, cleanedAds, cleanedPromotedVideos),
      message: homeFeedNotifyMessage([], cleanedAdItems, cleanedPromotedVideoItems),
    },
    filter: {
      title: "Bilibili 首页推荐页屏蔽",
      subtitle: homeFeedNotifySubtitle(kept, removed, 0, 0),
      message: homeFeedNotifyMessage(removedItems, [], []),
    },
  });
  $done({ response: $response });
}

// 判断首页推荐项的清理类型：推广视频或普通广告。
function getHomeFeedCleanupType(item) {
  if (isHomeFeedVideoItem(item)) return "";
  if (isHomeFeedPromotedVideoItem(item)) return "promotedVideo";
  return "ad";
}

// 判断是否为普通的首页视频卡片。
function isHomeFeedVideoItem(item) {
  return !!item &&
    !item.banner_item &&
    !item.ad_info &&
    item.card_goto === "av" &&
    HOME_FEED_VIDEO_CARD_TYPES.includes(item.card_type);
}

// 判断是否为首页推广视频卡片。
function isHomeFeedPromotedVideoItem(item) {
  if (!item?.ad_info) return false;
  const goto = String(item.card_goto || item.goto || "");
  const aid = item?.args?.aid ||
    item?.player_args?.aid ||
    item?.param ||
    item?.ad_info?.creative_content?.video_id ||
    extractAidFromText(item?.uri) ||
    extractAidFromText(item?.ad_info?.creative_content?.url);
  if (!aid) return false;
  return goto === "av" ||
    goto === "ad_av" ||
    item.goto === "av" ||
    item.card_type === "cm_v2" ||
    HOME_FEED_VIDEO_CARD_TYPES.includes(item.card_type);
}

// 处理首页热门（Popular/Index）的 gRPC 响应。
async function handleHomePopularIndex() {
  const keywords = buildKeywords();
  // 默认未配置关键词时直接返回，避免解码与递归解析整份热门页 protobuf。
  if (!hasAnyFilterRule(keywords)) {
    log("info", { page: "homePopular", message: "no keywords configured" });
    notify("filter", "Bilibili 首页热门屏蔽", "未配置屏蔽规则", "请填写视频标题关键词、UP 主名称或视频 Tag");
    return $done({ response: $response });
  }

  const message = decodeGrpcBody(getResponseBodyBytes());
  const fields = parseFields(message);

  // rows 与顶层 field 1 一一对应，后面按原顺序决定保留或删除。
  const rows = [];
  for (const field of fields) {
    if (field.no === 1 && field.wireType === 2) {
      rows.push(extractPopularFilterRow(field.value, keywords));
    }
  }
  await applyFilterMatches(rows, keywords);

  let kept = 0;
  let removed = 0;
  const removedItems = [];
  const chunks = [];
  let rowIndex = 0;
  for (const field of fields) {
    if (field.no === 1 && field.wireType === 2) {
      const row = rows[rowIndex++] || createFilterRow({});
      log("debug", { titles: row.titles, upNames: row.upNames, inlineTags: row.inlineTags, matched: !!row.match });

      if (row.match) {
        removed += 1;
        removedItems.push(matchedFilterItem(row));
        continue;
      }
      kept += 1;
    }
    chunks.push(field.raw);
  }

  setResponseBodyBytes(encodeGrpcBody(concat(chunks)));
  log("info", { ...filterSummary("homePopular", kept, removed, keywords), removedItems });
  notify(
    "filter",
    "Bilibili 首页热门屏蔽",
    `保留 ${kept} / 屏蔽 ${removed}`,
    removedItemsMessage(removedItems)
  );
  $done({ response: $response });
}
/* -------------------------------------------------------------------------- */
/* 路由入口                                                                   */
/* -------------------------------------------------------------------------- */

// 主路由函数：根据请求 URL 将响应分发到对应的处理器。未能匹配特定路由时原样返回响应。
async function main() {
  const url = getRequestUrl();
  if (/\/x\/v2\/splash\/(?:show|list|brand\/list|brand\/show|event\/list|event\/list2|ad\/list|topview\/list)\?/.test(url)) {
    return handleSplashResponse();
  }

  if (/\/x\/resource\/(?:show\/tab\/v2|show\/skin|peak\/download)\?/.test(url)) {
    return handleStartupAdsResponse();
  }

  if (/\/x\/v2\/account\/mine\?/.test(url)) {
    return handleMinePageResponse();
  }

  if (/\/x\/v2\/search\/square\?/.test(url)) {
    return handleSearchSquareResponse();
  }

  if (/\/bilibili\.app\.interface\.v1\.Search\/DefaultWords$/.test(url)) {
    return handleSearchDefaultWordsResponse();
  }

  if (/\/bilibili\.app\.interface\.v1\.Search\/Suggest3$/.test(url)) {
    return handleSearchSuggestResponse();
  }

  if (/\/bilibili\.polymer\.app\.search\.v1\.Search\/SearchAll$/.test(url)) {
    return await handleSearchAllResponse();
  }

  if (/\/x\/v2\/feed\/index\/story\?/.test(url)) {
    return handleVideoFeedIndex();
  }

  if (/\/x\/v2\/feed\/index\?/.test(url)) {
    return await filterHomeFeedIndex();
  }

  if (/\/bilibili\.app\.viewunite\.v1\.View\/View$/.test(url)) {
    return handleViewResponse();
  }

  if (/\/bilibili\.app\.viewunite\.v1\.View\/RelatesFeed$/.test(url)) {
    return handleRelatesFeedResponse();
  }

  if (/\/bilibili\.app\.dynamic\.v2\.Dynamic\/DynAll$/.test(url)) {
    return handleDynamicAllResponse();
  }

  if (/\/bilibili\.main\.community\.reply\.v1\.Reply\/MainList$/.test(url)) {
    return handleReplyMainListResponse();
  }

  if (/api\.live\.bilibili\.com\/xlive\/(?:app-interface\/v2\/index\/feed|app-room\/v1\/index\/getInfoBy(?:Room|User)|e-commerce-interface\/v1\/ecommerce-user\/get_shopping_info)\?/.test(url)) {
    return handleLiveAdsResponse();
  }

  if (/api\.bilibili\.com\/x\/pd-proxy\/tracker\?/.test(url)) {
    return handlePdProxyTrackerResponse();
  }

  if (/\/bilibili\.app\.interface\.v1\.Teenagers\/ModeStatus$/.test(url)) {
    return handleTeenagersResponse();
  }

  if (/\/bilibili\.app\.(?:view\.v1\.View\/TFInfo|viewunite\.v1\.View\/(?:PlayPause|ViewEndPage))$/.test(url)) {
    return handleInteractiveDanmakuResponse();
  }

  if (/\/bilibili\.app\.show\.v1\.Popular\/Index$/.test(url)) {
    return await handleHomePopularIndex();
  }

  log("debug", { page: "router", message: "unmatched route", url });
  return $done(typeof $response !== "undefined" ? { response: $response } : {});
}

// 脚本执行入口：运行主流程，发生异常时输出错误通知，避免脚本崩溃后无任何响应。
Promise.resolve(main()).catch((error) => {
  const url = getRequestUrl();
  const pageName = (() => {
    if (/\/bilibili\.app\.viewunite\.v1\.View\//.test(url)) return "视频页";
    if (/\/bilibili\.app\.dynamic\.v2\.Dynamic\/DynAll$/.test(url)) return "动态页";
    if (/\/x\/v2\/splash\//.test(url)) return "开屏广告";
    if (/\/bilibili\.app\.interface\.v1\.Search\/Suggest3$/.test(url)) return "搜索候选词条";
    if (/\/bilibili\.polymer\.app\.search\.v1\.Search\/SearchAll$/.test(url)) return "搜索结果";
    if (/\/bilibili\.main\.community\.reply\.v1\.Reply\/MainList$/.test(url)) return "评论区";
    if (/api\.live\.bilibili\.com\/xlive\//.test(url)) return "直播间";
    if (/\/x\/pd-proxy\/tracker/.test(url)) return "追踪";
    if (/Teenagers\/ModeStatus/.test(url)) return "青少年模式";
    if (/View\/TFInfo|PlayPause|ViewEndPage/.test(url)) return "交互弹幕";
    if (/\/x\/v2\/account\/mine\?/.test(url)) return "我的页面";
    if (/\/x\/v2\/feed\/index/.test(url)) return "首页推荐页";
    return "首页热门";
  })();
  log("error", error);
  notify(["remove", "filter"], `Bilibili ${pageName}处理`, "脚本错误", stringify(error).slice(0, 180));
  $done(typeof $response !== "undefined" ? { response: $response } : {});
});
