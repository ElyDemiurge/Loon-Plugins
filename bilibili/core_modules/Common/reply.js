// core_modules/Common: reply-section cleanup shared by iOS and iPadOS.
/* -------------------------------------------------------------------------- */
/* Reply-section cleanup                                                      */
/* -------------------------------------------------------------------------- */

// Markers for pinned advertisement replies, including commercial links and ad payloads.
const REPLY_AD_MARKER_PATTERN = /ad_cb|cm\.bilibili\.com\/ldad|googleapis\.com\/bilibili\.ad\.v1|SourceContentDto|schema_name":"ad|"ad_info"|reply_control"[^"]*ad/;

// Detect whether protobuf bytes represent an advertisement reply.
function isReplyAd(bytes) {
  return REPLY_AD_MARKER_PATTERN.test(decodeString(bytes));
}

// Detect a structured reply by requiring multiple fields and a varint such as rpid.
// This distinguishes actual replies from strings and containers that must be preserved or traversed.
function isStructuredReplyMessage(bytes) {
  const fields = tryParseFields(bytes);
  if (!fields || fields.length < 2) return false;
  return fields.some((field) => field.wireType === 0);
}

// Create reply-ad cleanup statistics.
function replyCleanupSummary() {
  return { topAds: [] };
}

// Remove only structured advertisement replies without deleting containers or raw strings.
function sanitizeReplyMainList(message, summary) {
  const result = transformProtobufFields(message, ({ field }) => {
    if (!isProtobufMessageField(field) || !isReplyAd(field.value)) return null;
    if (!isStructuredReplyMessage(field.value)) return null;
    summary.topAds.push({ title: firstNonEmpty(extractReadableStrings(field.value)) || "置顶广告" });
    return { remove: true };
  }, { maxDepth: 12 });
  return result.changed ? result.bytes : message;
}

// Build the reply-ad notification message.
function replyNotifyMessage(items) {
  if (!items.length) return "未命中评论区置顶广告";
  return "移除-评论区置顶广告：\n" + items
    .slice(0, 5)
    .map((item, index) => `${index + 1}、${item.title}`)
    .join("\n");
}

// Handle Reply/MainList and remove pinned advertisement replies.
function handleReplyMainListResponse() {
  if (!arg.cleanReplyTopAds) {
    log("info", { page: "reply", message: "switch off" });
    return finishUnchanged();
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
  finishResponse();
}
