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
