// core_modules/Common: home-feed and popular-page handling shared by iOS and iPadOS.
/* -------------------------------------------------------------------------- */
/* Home feed and popular page                                                 */
/* -------------------------------------------------------------------------- */

// Extract titles and creator names from a home-feed item.
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

// Build a normalized filter row from a home-feed item.
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

// Build a filter row from a popular-page protobuf card.
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

// Filter the home feed/index HTTP response.
async function filterHomeFeedIndex() {
  const keywords = buildKeywords();
  const hasKeywordFilter = hasAnyFilterRule(keywords);
  if (!hasKeywordFilter) {
    log("info", "no keywords configured");
  }

  const json = parseResponseJson();
  if (!Array.isArray(json?.data?.items)) {
    log("info", { page: "homeFeed", message: "items not found" });
    return finishResponse();
  }
  const items = json.data.items;
  let kept = 0;
  let removed = 0;
  let cleanedAds = 0;
  let cleanedPromotedVideos = 0;

  // These collections are used only for notifications and logs.
  const removedItems = [];
  const cleanedAdItems = [];
  const cleanedPromotedVideoItems = [];

  // Rows contains regular videos that still need blocking-rule evaluation.
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
  finishResponse();
}

// Classify a home-feed item as a promoted video, regular advertisement, or normal item.
function getHomeFeedCleanupType(item) {
  if (isHomeFeedVideoItem(item)) return "";
  if (isHomeFeedPromotedVideoItem(item)) return "promotedVideo";
  return "ad";
}

// Detect a regular home-feed video card.
function isHomeFeedVideoItem(item) {
  return !!item &&
    !item.banner_item &&
    !item.ad_info &&
    item.card_goto === "av" &&
    HOME_FEED_VIDEO_CARD_TYPES.includes(item.card_type);
}

// Detect a promoted home-feed video card.
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

// Handle the Popular/Index gRPC response.
async function handleHomePopularIndex() {
  const keywords = buildKeywords();
  // Skip decoding the full protobuf response when no blocking rules are configured.
  if (!hasAnyFilterRule(keywords)) {
    log("info", { page: "homePopular", message: "no keywords configured" });
    notify("filter", "Bilibili 首页热门屏蔽", "未配置屏蔽规则", "请填写视频标题关键词、UP 主名称或视频 Tag");
    return finishResponse();
  }

  const message = decodeGrpcBody(getResponseBodyBytes());
  const fields = parseFields(message);

  // Rows correspond one-to-one with top-level field 1 cards and preserve source order.
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
  finishResponse();
}
