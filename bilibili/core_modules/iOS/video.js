// core_modules/iOS: iOS-specific ViewUnite detail and related-feed protobuf schema.

// Extract the current video aid from an iOS ViewUnite response.
function extractIosViewAidFromMessage(message) {
  try {
    const viewFields = parseFields(firstMessage(parseFields(message), 2) || new Uint8Array());
    const aid = String(varintField(viewFields, 1) || "");
    if (aid) return aid;
    return String(firstNonEmpty(fieldStrings(viewFields, 1)).replace(/^#/, "") || "");
  } catch (error) {
    log("debug", "failed to extract iOS ViewUnite aid from response", error);
    return "";
  }
}

// Extract creator names from an iOS ViewUnite related card.
function extractIosVideoRelatedUpNames(bytes) {
  const values = [];
  const text = decodeString(bytes);

  for (const match of text.matchAll(/UP主[:：]\s*([^\x00-\x1f\n\r]{1,40})/g)) {
    values.push(cleanIosVideoRelatedUpName(match[1]));
  }

  walkProtobufFields(bytes, ({ fields, path }) => {
    for (const field of fields) {
      if (!isProtobufMessageField(field)) continue;
      const nextPath = path.concat(field.no);
      const value = decodeString(field.value).replace(/\s+/g, " ").trim();
      const upMatch = value.match(/^UP主[:：]\s*(.+)$/);
      if (upMatch) values.push(upMatch[1]);

      // iOS ViewUnite related cards commonly store creator names in owner fields.
      if (nextPath.slice(-3).join(".") === "12.11.3") values.push(value);
    }
    return null;
  }, { maxDepth: 8 });

  return uniqueStrings(values.map(normalizeUpName));
}

// Remove unrelated suffix text from a ViewUnite creator name.
function cleanIosVideoRelatedUpName(value) {
  return normalizeUpName(value)
    .replace(/(?:和当前视频无关|不感兴趣|反馈|选择后|将减少|将优化).*$/, "")
    .replace(/([^0-9])2$/, "$1")
    .trim();
}

// Remove advertisements, live cards, and creator-goods recommendations from ViewUnite.
function sanitizeIosVideoPageMessage(message, summary, options = {}) {
  const result = transformProtobufFields(message, ({ field, depth, path }) => {
    if (!isProtobufMessageField(field)) return null;

    // ViewUnite uses field 22 for related cards, top-level field 7 for banners, and field 46 for goods.
    const isRelatedContainer = path[path.length - 1] === 22;
    const scope = field.no === 46
      ? "upGoods"
      : (options.bannerFieldNo && depth === 0 && field.no === options.bannerFieldNo ? "banner" : "related");
    const cleanupType = (
      (isRelatedContainer && field.no === 1) ||
      field.no === 46 ||
      scope === "banner" ||
      options.topRelatedFieldNo === field.no
    )
      ? videoRelatedCleanupType(field.value, scope)
      : "";
    if (cleanupType) {
      pushCleanupItem(summary, cleanupType, field.value);
      return { remove: true };
    }
    return null;
  }, { maxDepth: 12 });

  return result.changed ? result.bytes : message;
}

// Build a filter row from an iOS ViewUnite related card.
function iosVideoRelatedFilterRow(bytes) {
  const title = firstNonEmpty(extractReadableStrings(bytes));
  const text = decodeString(bytes);
  return createFilterRow({
    item: bytes,
    titles: title ? [title] : [],
    upNames: extractIosVideoRelatedUpNames(bytes),
    aid: extractAidFromText(text),
    inlineTags: collectTopicTags(bytes),
  });
}

// Recursively filter an embedded iOS ViewUnite related feed.
async function filterIosVideoRelatedMatchesPart(bytes, summary, keywords, depth, isRelatedContainer) {
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
      relatedRows.push(iosVideoRelatedFilterRow(field.value));
      chunks.push(field.raw);
      continue;
    }

    if (field.wireType === 2 && field.value.length) {
      const nested = await filterIosVideoRelatedMatchesPart(
        field.value,
        summary,
        keywords,
        depth + 1,
        field.no === 22
      );
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
    for (let index = relatedRows.length - 1; index >= 0; index -= 1) {
      const row = relatedRows[index];
      if (!row.match) continue;
      pushBlockedVideoFeedItem(summary, row);
      chunks.splice(relatedIndexes[index], 1);
      changed = true;
    }
  }

  return changed ? concat(chunks) : null;
}

// Skip recursive ViewUnite matching when no blocking rule is configured.
async function filterIosVideoRelatedMatches(message, summary, keywords) {
  if (!hasAnyFilterRule(keywords)) return message;
  const filtered = await filterIosVideoRelatedMatchesPart(message, summary, keywords, 0, false);
  return filtered || message;
}

// Handle the iOS ViewUnite RelatesFeed response.
async function handleIosRelatesFeedResponse() {
  const message = decodeGrpcBody(getResponseBodyBytes());
  const fields = parseFields(message);
  const keywords = buildKeywords();
  const summary = videoCleanupSummary();
  const entries = [];
  const rows = [];

  for (const field of fields) {
    if (field.no === 1 && field.wireType === 2) {
      const cleanupType = videoRelatedCleanupType(field.value, "related");
      if (cleanupType) {
        pushCleanupItem(summary, cleanupType, field.value);
        continue;
      }
      const row = iosVideoRelatedFilterRow(field.value);
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
  log("info", {
    platform: "iOS",
    page: "videoFeed",
    endpoint: "relatesFeed",
    kept,
    cleaned: notifyPayload.cleaned,
    blocked: notifyPayload.blocked,
    summary,
  });
  notifyCleanupAndFilter({
    cleaned: notifyPayload.cleaned,
    blocked: notifyPayload.blocked,
    combined: notifyPayload,
    cleanup: cleanupPayload,
    filter: filterPayload,
  });
  finishResponse();
}

// Handle the iOS ViewUnite detail page, clean recommendations, and cache current-video tags.
async function handleIosViewResponse() {
  const message = decodeGrpcBody(getResponseBodyBytes());
  const keywords = buildKeywords();
  const summary = videoCleanupSummary();
  let nextMessage = sanitizeIosVideoPageMessage(message, summary, { bannerFieldNo: 7 });
  nextMessage = await filterIosVideoRelatedMatches(nextMessage, summary, keywords);
  finishVideoViewResponse({
    platform: "iOS",
    message: nextMessage,
    summary,
    extractResponseAid: extractIosViewAidFromMessage,
  });
}
