// core_modules/Common: byte, gRPC, and protobuf runtime shared by iOS and iPadOS.
/* -------------------------------------------------------------------------- */
/* Byte, gRPC, and protobuf primitives                                        */
/* -------------------------------------------------------------------------- */

// Gunzip bytes with Loon utilities first and Node.js zlib as a test fallback.
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

// Normalize supported binary inputs to Uint8Array.
function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return new Uint8Array(value);
  if (typeof value === "string") return new TextEncoder().encode(value);
  throw new Error(`unsupported bytes type: ${Object.prototype.toString.call(value)}`);
}

// Read a protobuf varint and return its value and ending offset.
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

// Skip a protobuf value by wire type and return the next field offset.
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

// Parse protobuf bytes into fields with numbers, wire types, and raw byte ranges.
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

// Concatenate byte arrays into one Uint8Array.
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

// Shared UTF-8 decoder instance.
const decoder = new TextDecoder("utf-8");

// Decode UTF-8 bytes and return an empty string on failure.
function decodeString(bytes) {
  try {
    return decoder.decode(bytes);
  } catch {
    return "";
  }
}

// Read non-empty string values from wire-type-2 fields with a given number.
function fieldStrings(fields, no) {
  return fields
    .filter((field) => field.no === no && field.wireType === 2)
    .map((field) => decodeString(field.value))
    .filter(Boolean);
}

// Return the first nested-message value for a field number.
function firstMessage(fields, no) {
  return fields.find((field) => field.no === no && field.wireType === 2)?.value || null;
}

// Extract titles, creator names, and aid from a popular-page card and its share metadata.
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

  // iOS share metadata also carries titles and creator names.
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

// Extract a video aid from Bilibili URIs, query strings, or JSON text.
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

// Normalize creator names by removing known prefixes and collapsing whitespace.
function normalizeUpName(value) {
  return String(value || "").replace(/^(UP主|频道)[:：]/, "").replace(/\s+/g, " ").trim();
}

// Check whether a notification category is enabled; arrays use any-match semantics.
function notificationEnabled(category) {
  if (Array.isArray(category)) return category.some((item) => notificationEnabled(item));
  if (category === "remove") return arg.notifyRemove;
  if (category === "filter") return arg.notifyFilter;
  if (category === "personalization") return arg.notifyPersonalization;
  return arg.notifyRemove || arg.notifyFilter || arg.notifyPersonalization;
}

// Mirror notification content to the script log for diagnostics.
function logNotification(title, subtitle, message, attach) {
  const lines = [`[BilibiliFilter][notify] ${title || ""}`];
  if (subtitle) lines.push(String(subtitle));
  if (message) lines.push(String(message));
  if (attach) lines.push(`attach=${stringify(attach)}`);
  console.log(lines.join("\n"));
}

// Send a system notification and log it when its category is enabled.
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

// Route combined cleanup and blocking results according to the categories that actually matched.
// Keep a combined notification only when both categories matched and are enabled.
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

// Decode a five-byte gRPC frame header and gunzip compressed messages.
function decodeGrpcBody(bodyBytes) {
  bodyBytes = toBytes(bodyBytes);
  if (!bodyBytes || bodyBytes.length < 5) throw new Error("invalid grpc body");
  const compressed = bodyBytes[0] === 1;
  const length =
    bodyBytes[1] * 2 ** 24 + (bodyBytes[2] << 16) + (bodyBytes[3] << 8) + bodyBytes[4];
  const message = bodyBytes.subarray(5, 5 + length);
  return compressed ? gunzip(message) : message;
}

// Encode an uncompressed gRPC frame with a four-byte big-endian length.
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

// Read the current response body as bytes from bodyBytes or body.
function getResponseBodyBytes() {
  if ($response.bodyBytes !== undefined) return toBytes($response.bodyBytes);
  if ($response.body !== undefined) return toBytes($response.body);
  throw new Error("response body is unavailable");
}

// Read the current response body as text.
function getResponseBodyText() {
  if (typeof $response.body === "string") return $response.body;
  return decoder.decode(getResponseBodyBytes());
}

// Safely read request-body bytes and return undefined on failure.
function getRequestBodyBytesSafely() {
  if (typeof $request === "undefined" || !$request) return undefined;
  try {
    if ($request.bodyBytes !== undefined) return $request.bodyBytes;
  } catch (error) {
    log("debug", "failed to read request bodyBytes", error);
  }
  return undefined;
}

// Safely read the request body without interrupting the main flow.
function getRequestBodySafely() {
  if (typeof $request === "undefined" || !$request) return undefined;
  try {
    return $request.body;
  } catch (error) {
    log("debug", "failed to read request body", error);
    return undefined;
  }
}

// Hold a response-body patch until the handler finishes successfully.
let pendingResponseBody;
let hasPendingResponseBody = false;

// Compare a candidate body with the original response body.
function isOriginalResponseBody(body) {
  try {
    if (typeof body === "string" && typeof $response.body === "string") {
      return body === $response.body;
    }
    const candidate = toBytes(body);
    const original = getResponseBodyBytes();
    if (candidate.length !== original.length) return false;
    for (let index = 0; index < candidate.length; index += 1) {
      if (candidate[index] !== original[index]) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Stage a response body only when it differs from the original body.
function stageResponseBody(body) {
  if (isOriginalResponseBody(body)) {
    pendingResponseBody = undefined;
    hasPendingResponseBody = false;
    return;
  }
  pendingResponseBody = body;
  hasPendingResponseBody = true;
}

// Stage binary response bytes without mutating the original Loon response.
function setResponseBodyBytes(bytes) {
  stageResponseBody(toBytes(bytes));
}

// Stage a text response body without mutating the original Loon response.
function setResponseBodyText(text) {
  stageResponseBody(String(text));
}

// Continue with the original response unchanged.
function finishUnchanged() {
  return $done({});
}

// Return only the staged body patch and let Loon preserve other response fields.
function finishResponse() {
  if (!hasPendingResponseBody) return finishUnchanged();
  return $done({ body: pendingResponseBody });
}

// Return the current request URL or an empty string.
function getRequestUrl() {
  return (typeof $request !== "undefined" && $request && $request.url) || "";
}
