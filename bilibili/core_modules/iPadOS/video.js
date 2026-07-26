// core_modules/iPadOS: iPadOS-specific legacy View detail-page protobuf schema.

// Extract the current video aid from top-level field 1 of a legacy iPadOS View response.
function extractIpadViewAidFromMessage(message) {
  try {
    const archive = firstMessage(parseFields(message), 1);
    if (!archive) return "";
    return String(varintField(parseFields(archive), 1) || "");
  } catch (error) {
    log("debug", "failed to extract iPadOS View aid from response", error);
    return "";
  }
}

// Extract creator names from field 4 owner data in a legacy related card.
function extractIpadRelatedUpNames(fields) {
  const owner = firstMessage(fields, 4);
  if (!owner) return [];
  try {
    return uniqueStrings(fieldStrings(parseFields(owner), 2).map(normalizeUpName));
  } catch {
    return [];
  }
}

// Build a normalized filter row from stable legacy iPadOS View fields.
function ipadVideoRelatedFilterRow(bytes) {
  const fields = parseFields(bytes);
  const uriText = fieldStrings(fields, 9).join(" ");
  const aid = String(varintField(fields, 1) || extractAidFromText(uriText) || "");
  const titles = fieldStrings(fields, 3);
  return createFilterRow({
    item: bytes,
    titles: titles.length ? titles : extractReadableStrings(bytes).slice(0, 1),
    upNames: extractIpadRelatedUpNames(fields),
    aid,
    inlineTags: collectTopicTags(bytes),
  });
}

// Handle the iPadOS bilibili.app.view.v1.View/View response.
async function handleIpadViewResponse() {
  const message = decodeGrpcBody(getResponseBodyBytes());
  const fields = parseFields(message);
  const keywords = buildKeywords();
  const summary = videoCleanupSummary();
  const entries = [];
  const rows = [];

  for (const field of fields) {
    if (field.wireType === 2 && field.no === 10) {
      const cleanupType = videoRelatedCleanupType(field.value, "related");
      if (cleanupType) {
        pushCleanupItem(summary, cleanupType, field.value);
        continue;
      }
      const row = ipadVideoRelatedFilterRow(field.value);
      rows.push(row);
      entries.push({ field, row });
      continue;
    }

    // Top-level field 41 contains standalone commercial SourceContentDto data.
    if (field.wireType === 2 && field.no === 41) {
      const cleanupType = videoRelatedCleanupType(field.value, "related");
      if (cleanupType) {
        pushCleanupItem(summary, cleanupType, field.value);
        continue;
      }
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

  const nextMessage = concat(chunks);
  finishVideoViewResponse({
    platform: "iPadOS",
    endpoint: "legacyView",
    message: nextMessage,
    summary,
    extractResponseAid: extractIpadViewAidFromMessage,
    kept,
  });
}
