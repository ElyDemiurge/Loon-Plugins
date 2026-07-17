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
