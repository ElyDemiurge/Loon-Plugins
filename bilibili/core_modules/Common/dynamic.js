// core_modules/Common: dynamic-page filtering and personalization shared by iOS and iPadOS.

// Compact display text by removing zero-width characters and links, then truncate when needed.
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

// Build a display summary for creator-promoted products on the dynamic page.
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

// Build a display summary for a dynamic item blocked by a keyword.
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

// Determine whether an entire dynamic item matches a configured keyword.
function findDynamicKeywordMatch(bytes, keywords) {
  return findContentKeywordMatch([
    decodeString(bytes),
    ...extractReadableStrings(bytes),
  ], keywords, "dynamicKeywords");
}

// Detect a creator-promotion module on the dynamic page.
function isDynamicUpRecommendationModule(bytes) {
  const fields = tryParseFields(bytes);
  if (!fields || varintField(fields, 1) !== 8) return false;

  const text = decodeString(bytes);
  return /UP主的推荐/.test(text) &&
    /(商品来自淘宝|schema_name":"淘宝|tbopen:|taobao|com\.taobao|\/bfs\/mall\/|去看看|is_ad_loc)/.test(text);
}

// Detect extended product information on the dynamic page.
function isDynamicUpRecommendationExtendGoods(bytes) {
  const text = decodeString(bytes);
  return /(商品来自淘宝|schema_name":"淘宝|tbopen:|taobao|com\.taobao|\/bfs\/mall\/|\/bfs\/sycp\/|is_ad_loc)/.test(text);
}

// Detect dynamic-page promotion details.
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

// Recursively remove embedded promotion details from a dynamic item.
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

// Remove promoted products from dynamic-page extension data.
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

// Remove promotion modules and extended products from one dynamic item.
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

// Locate promoted-product bytes within a dynamic protobuf message.
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

// Clean a dynamic list by applying the selected promotion mode and keyword rules.
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

// Clean the dynamic-page gRPC payload.
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

// Byte-size limit for frequent-creator sections; larger sections are treated as primary content.
const DYNAMIC_UP_LIST_MAX_SIZE = 4096;
// Live-state markers that preserve a frequent-creator section in auto mode.
const DYNAMIC_LIVE_MARKER_PATTERN = /live_status|"live"|直播中|live_play_info|live_room_id/;

// Detect a compact frequent-creator section containing short names but no dynamic-card markers.
function isDynamicUpListSection(bytes) {
  if (bytes.length > DYNAMIC_UP_LIST_MAX_SIZE) return false;
  const text = decodeString(bytes);
  if (/dyn_id_str|rid_str|"dynamic"/.test(text)) return false;
  const names = readableProtobufEntries(bytes, 5)
    .map((entry) => entry.value)
    .filter((value) => value.length >= 2 && value.length <= 12 && /^[一-鿿A-Za-z0-9_]+$/.test(value));
  return names.length >= 3;
}

// Hide frequent creators, or in auto mode preserve them only when live markers exist.
function sanitizeDynamicUpList(message, mode, summary) {
  summary.upListMode = mode;
  if (mode === "show") return message;
  let removedCount = 0;
  const result = transformProtobufFields(message, ({ field, depth }) => {
    // Inspect only top-level non-field-1 sections to avoid deleting the primary dynamic list.
    if (depth > 0 || field.no === 1) return null;
    if (!isProtobufMessageField(field) || !isDynamicUpListSection(field.value)) return null;
    if (mode === "auto" && DYNAMIC_LIVE_MARKER_PATTERN.test(decodeString(field.value))) return null;
    removedCount += 1;
    return { remove: true };
  }, { maxDepth: 1 });
  summary.upListRemoved = removedCount;
  return result.changed ? result.bytes : message;
}

// Build the notification body for dynamic-page creator promotions.
function dynamicUpRecommendationMessage(items) {
  if (!items.length) return "未命中动态页 UP 主推荐";
  return "移除-动态页 UP 主的推荐：\n" + items
    .slice(0, 5)
    .map((item, index) => `${index + 1}、标题：${item.title || "UP主的推荐"}${item.source ? "｜来源：" + item.source : ""}`)
    .join("\n");
}

// Build the complete dynamic-page notification payload.
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

// Build the dynamic-page notification message.
function dynamicNotifyMessage(summary, mode) {
  const messages = [];
  if (summary.upRecommendations.length) messages.push(dynamicUpRecommendationMessage(summary.upRecommendations));
  if (summary.blockedDynamics.length) messages.push(itemListMessage("屏蔽-关注页动态", summary.blockedDynamics));
  if (messages.length) return messages.join("\n\n");
  return mode === "off" ? "未命中动态页清理规则" : dynamicUpRecommendationMessage([]);
}

// Handle the dynamic-page DynAll gRPC response.
function handleDynamicAllResponse() {
  const dynamicKeywords = buildContentKeywords(arg.dynamicKeywords);
  const hasUpListAction = dynamicUpListMode !== "show";
  if (dynamicUpRecommendationMode === "off" && !hasContentKeywords(dynamicKeywords) && !hasUpListAction) {
    const notifyPayload = dynamicNotifyPayload({ kept: 0, upRecommendations: [], blockedDynamics: [] }, dynamicUpRecommendationMode, false);
    log("info", { page: "dynamic", endpoint: "DynAll", mode: dynamicUpRecommendationMode, cleaned: false });
    notify("remove", notifyPayload.title, notifyPayload.subtitle, notifyPayload.message);
    return finishResponse();
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
  finishResponse();
}
