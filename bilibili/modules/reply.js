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
