// core_modules/Common: shared video, related-feed, and search-result foundations.

// Create video-page statistics grouped by cleanup type.
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

// Isolate cleanup or blocking statistics so combined results respect notification switches.
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

// Append a cleanup item and extract a readable display title.
function pushCleanupItem(summary, type, bytes) {
  const title = firstNonEmpty(extractReadableStrings(bytes));
  summary[type].push({ title });
}

// Extract readable protobuf text while excluding control characters and advertisement boilerplate.
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

// Classify enabled cleanup targets: banners, live cards, creator goods, promotions, and ads.
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

// Build the video-page cleanup notification message.
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

// Count non-blocking video-page cleanup results.
function videoPageCleanCount(summary) {
  return summary.promotedContent.length + summary.relatedAds.length + summary.bannerAds.length + summary.liveRecommendations.length + summary.upGoodsAds.length;
}

// Count video-page blocking results.
function videoPageBlockCount(summary) {
  return summary.blockedVideos.length;
}

// Build the related-feed notification subtitle.
function videoFeedFilterSubtitle(prefix, cleaned, blocked) {
  return prefix + (blocked ? ' / 屏蔽 ' + blocked : '') + ' / 清理 ' + cleaned;
}

// Build the complete related-feed notification payload.
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

// Build the video-detail notification subtitle.
function videoViewFilterSubtitle(cleaned, blocked) {
  return '清理 ' + cleaned + (blocked ? ' / 屏蔽 ' + blocked : '');
}

// Build the complete video-detail notification payload with optional tag-cache status.
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

// Finalize a platform video-detail response and optionally update its tag cache.
function finishVideoViewResponse({
  platform,
  endpoint = "",
  message,
  summary,
  extractResponseAid,
  kept,
}) {
  let aid = "";
  let tags = [];
  let cacheResult = null;
  let combinedPayload = videoViewNotifyPayload(summary);

  if (combinedPayload.cleaned || combinedPayload.blocked) {
    setResponseBodyBytes(encodeGrpcBody(message));
  }

  if (arg.deepFilter) {
    tags = collectTopicTags(message);
    aid = extractViewAidFromRequest() || extractResponseAid(message);
    cacheResult = saveCachedTags(aid, tags);
    combinedPayload = videoViewNotifyPayload(summary, cacheResult, aid);
  }

  const logPayload = {
    platform,
    page: "view",
  };
  if (endpoint) logPayload.endpoint = endpoint;
  if (kept !== undefined) logPayload.kept = kept;
  if (cacheResult) {
    logPayload.aid = aid;
    logPayload.tags = tags;
    logPayload.cacheStatus = cacheResult.status;
  }
  logPayload.cleaned = combinedPayload.cleaned;
  logPayload.blocked = combinedPayload.blocked;
  logPayload.summary = summary;
  log("info", logPayload);

  notifyCleanupAndFilter({
    cleaned: combinedPayload.cleaned,
    blocked: combinedPayload.blocked,
    combined: combinedPayload,
    cleanup: videoViewNotifyPayload(videoNotificationSummary(summary, "remove"), cacheResult, aid),
    filter: videoViewNotifyPayload(videoNotificationSummary(summary, "filter"), cacheResult, aid),
  });
  finishResponse();
}

// Append a blocked related-video item to the summary.
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

// Build the localized tag-cache status text.
function cacheStatusText(status, aid) {
  const suffix = aid ? ` aid ${aid}` : "";
  if (status === "created") return `新增缓存${suffix}`;
  if (status === "updated") return `更新缓存${suffix}`;
  if (status === "skipped") return aid ? `未缓存${suffix}` : "未解析到 aid";
  return `已有缓存${suffix}`;
}

// Build the blocking-result notification message.
function removedItemsMessage(removedItems, emptyMessage = "未命中屏蔽规则") {
  if (!removedItems.length) return emptyMessage;
  return itemListMessage("屏蔽视频", removedItems);
}

// Resolve a user-facing label from an internal blocking-rule name.
function blockRuleLabel(rule) {
  return BLOCK_RULE_LABELS[rule] || "";
}

// Build a list notification with at most five items.
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

// Remove HTML tags from notification display text.
function cleanNotifyText(value) {
  return compactDisplayText(String(value || "").replace(/<[^>]+>/g, ""));
}

// Detect binary fragments and advertisement type markers unsuitable for display.
function isDirtySummaryText(value) {
  const text = String(value || "");
  return /[\x00-\x08\x0e-\x1f\ufffd]/.test(text) ||
    /\b(?:picture_ad|cm_ad|banner_ad|inline_av|inline_pgc)\b/i.test(text);
}

// Extract readable strings with field paths as a structured summary fallback.
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

// Check whether a field path ends with a given sequence.
function pathEndsWith(path, suffix) {
  return path === suffix || path.endsWith(`.${suffix}`);
}

// Detect metadata such as view counts and timestamps that should not become titles.
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

// Select the first title candidate according to field-path priority.
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

// Derive a fallback title from readable fields and the matched keyword.
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

// Build a safe fallback title when no structured title can be parsed.
function fallbackKeywordTitle(match) {
  const keyword = cleanNotifyText(match?.keyword || "");
  const matchedValue = cleanNotifyText(match?.value || "");
  if (keyword) return `命中关键词：${keyword}`;
  return isSummaryMetaText(matchedValue) ? "命中关键词" : matchedValue;
}

// Extract creator names from candidate fields.
function firstSummaryUp(entries, suffixes) {
  const value = firstSummaryEntry(entries, suffixes);
  return normalizeUpName(value);
}

// Join multiple list sections while skipping empty groups.
function presentItemListMessages(groups, emptyMessage) {
  const messages = groups
    .filter(([, items]) => items.length)
    .map(([label, items]) => itemListMessage(label, items));
  return messages.length ? messages.join("\n\n") : emptyMessage;
}

// Extract titles and creator names from a JSON recommendation item.
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

// Detect a JSON advertisement recommendation.
function isVideoFeedAdItem(item) {
  if (!item) return false;
  const goto = String(item.card_goto || item.goto || item.card_type || "");
  return !!item.ad_info || /(^|_)ad(_|$)/.test(goto);
}

// Detect a JSON live recommendation by recursively checking known live markers.
function isVideoFeedLiveRecommendation(item) {
  if (!item) return false;
  const directType = String(item.card_goto || item.goto || item.card_type || item.type || "");
  if (/^(live|live_room|vertical_live|live_rcmd)$/.test(directType) || /(^|_)live(_|$)/.test(directType)) return true;

  let matched = false;
  // Traverse the current structure recursively.
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

// Extract the video aid from a JSON recommendation.
function videoFeedItemAid(item) {
  return String(item?.args?.aid || item?.player_args?.aid || item?.param || extractAidFromText(item?.uri) || "");
}

// Build a normalized filter row from a JSON recommendation.
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

// Handle the JSON feed/index/story related-video response.
async function handleVideoFeedIndex() {
  const json = parseResponseJson();
  if (!Array.isArray(json?.data?.items)) {
    log("info", { page: "videoFeed", endpoint: "feedIndex", message: "items not found" });
    return finishResponse();
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
  finishResponse();
}

// Build the home-feed notification message.
function homeFeedNotifyMessage(removedItems, cleanedAdItems, cleanedPromotedVideoItems) {
  return presentItemListMessages([
    ["屏蔽视频", removedItems],
    ["清理-首页推荐页广告", cleanedAdItems],
    ["清理-首页推荐页推广视频", cleanedPromotedVideoItems],
  ], "未命中屏蔽或清理规则");
}

// Build the home-feed notification subtitle.
function homeFeedNotifySubtitle(kept, removed, cleanedAds, cleanedPromotedVideos) {
  return `保留 ${kept} / 屏蔽 ${removed} / 清理广告 ${cleanedAds} / 清理推广 ${cleanedPromotedVideos}`;
}

// Clean search-result matching text by removing HTML and collapsing whitespace.
function cleanSearchResultMatchText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Extract readable search-result fields for content and creator matching.
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

// Collect all search-result text eligible for content-keyword matching.
function searchResultCandidateValues(bytes) {
  return uniqueStrings([
    ...searchResultReadableEntries(bytes).map((entry) => entry.value),
    ...extractReadableStrings(bytes),
  ]);
}

// Extract creator names from the distinct video, user, and dynamic-card paths.
function searchResultUpNames(bytes) {
  const upPaths = [
    "37.10",
    "23.1",
    "23.14",
    "23.14.2",
    "23.32",
  ];
  const entries = searchResultReadableEntries(bytes);
  return uniqueStrings(entries
    .filter((entry) =>
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

// Extract search-result titles and creator names for notifications.
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

// Build a display summary for a filtered search result.
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

// Read SearchAll type information from top-level and metadata fields.
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

// Detect regular SearchAll video results; only these participate in tag filtering.
function isVideoSearchResult(bytes) {
  const info = searchResultCardInfo(bytes);
  const types = [...info.metadataTypes, ...info.topLevelTypes];
  return types.includes("video") || types.includes("av");
}

// Build a search-result row; title and tag rules target videos while creator rules target all cards.
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

// Detect SearchAll advertisements while reserving video_ad for creator-promotion cleanup.
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

// Return the first SearchAll cleanup rule matched in priority order.
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

// Build a summary for a removed search-result card.
function searchResultCleanupSummary(bytes, rule) {
  const { title, up } = searchResultTextSummary(bytes);
  return {
    title: title || firstNonEmpty(extractReadableStrings(bytes)) || blockRuleLabel(rule),
    up,
    rule,
  };
}

// Create a search-result cleanup container grouped by rule.
function emptySearchResultCleanedItems() {
  const cleaned = {};
  for (const item of SEARCH_RESULT_CLEANUP_RULES) cleaned[item.key] = [];
  return cleaned;
}

// Count all search-result cleanup matches.
function searchResultCleanedCount(cleaned) {
  return SEARCH_RESULT_CLEANUP_RULES.reduce((sum, item) => sum + cleaned[item.key].length, 0);
}

// Build per-rule cleanup counts for structured logs.
function searchResultCleanedLogCounts(cleaned) {
  const counts = {};
  for (const item of SEARCH_RESULT_CLEANUP_RULES) counts[item.key] = cleaned[item.key].length;
  return counts;
}

// Group a cleaned SearchAll card by rule name.
function pushSearchResultCleanedItem(cleaned, item) {
  const cleanupRule = SEARCH_RESULT_CLEANUP_RULES.find((candidate) => candidate.rule === item.rule);
  if (cleanupRule) cleaned[cleanupRule.key].push(item);
}

// Check whether any search-result cleanup rule is enabled.
function hasSearchResultCleanupRule() {
  return SEARCH_RESULT_CLEANUP_RULES.some((item) => arg[item.argKey]);
}

// Build the search-result notification title.
function searchAllNotifyTitle(cleaned, blocked) {
  if (cleaned && blocked) return "Bilibili 搜索结果处理";
  if (cleaned) return "Bilibili 搜索结果清理";
  return "Bilibili 搜索结果屏蔽";
}

// Build the search-result notification subtitle.
function searchAllNotifySubtitle(kept, blocked, cleaned) {
  const parts = [`保留 ${kept}`, `屏蔽 ${blocked}`];
  const cleanedCount = searchResultCleanedCount(cleaned);
  if (cleanedCount) {
    parts.push(...SEARCH_RESULT_CLEANUP_RULES.map((item) => `${item.subtitle} ${cleaned[item.key].length}`));
  }
  return parts.join(" / ");
}

// Build the search-result notification message.
function searchAllNotifyMessage(blockedItems, cleaned, cleanupEnabled) {
  return presentItemListMessages([
    ["屏蔽搜索结果", blockedItems],
    ...SEARCH_RESULT_CLEANUP_RULES.map((item) => [blockRuleLabel(item.rule), cleaned[item.key]]),
  ], cleanupEnabled ? "未命中搜索结果清理或屏蔽规则" : "未命中搜索结果屏蔽规则");
}

// Collect all suggestion text eligible for keyword matching.
function searchSuggestCandidateValues(bytes) {
  const fields = tryParseFields(bytes) || [];
  return uniqueStrings([
    decodeString(bytes),
    ...fieldStrings(fields, 2),
    ...fieldStrings(fields, 3),
    ...extractReadableStrings(bytes),
  ]);
}

// Build a display summary for a filtered search suggestion.
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

// Handle the Suggest3 gRPC response.
function handleSearchSuggestResponse() {
  const keywords = buildContentKeywords(arg.searchResultKeywords);
  if (!hasContentKeywords(keywords)) {
    log("info", { page: "searchSuggest", message: "no search suggest keywords configured" });
    return finishResponse();
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
  finishResponse();
}

// Handle the SearchAll gRPC response.
async function handleSearchAllResponse() {
  const contentKeywords = buildContentKeywords(arg.searchResultKeywords);
  const videoKeywords = buildKeywords();
  const hasSearchResultKeywords = hasContentKeywords(contentKeywords);
  const hasSearchVideoFilter = hasAnyFilterRule(videoKeywords);
  const hasSearchCleanupRule = hasSearchResultCleanupRule();
  if (!hasSearchCleanupRule && !hasSearchResultKeywords && !hasSearchVideoFilter) {
    log("info", { page: "searchAll", message: "no search cleanup rules, video search result keywords, title/up rules or video tag rules configured" });
    return finishResponse();
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
  finishResponse();
}
