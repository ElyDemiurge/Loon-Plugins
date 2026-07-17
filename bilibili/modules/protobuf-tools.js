/* -------------------------------------------------------------------------- */
/* 请求参数与 protobuf 结构提取                                               */
/* -------------------------------------------------------------------------- */

// 读取指定字段编号下首个 varint 字段的数值。
function varintField(fields, no) {
  const field = fields.find((item) => item.no === no && item.wireType === 0);
  return field ? readVarint(field.value, 0).value : "";
}

// 从视频详情页（View）的 gRPC 请求体中提取视频 aid。
function extractViewAidFromRequest() {
  try {
    const bodyBytes = getRequestBodyBytesSafely();
    const requestBody = bodyBytes !== undefined ? bodyBytes : getRequestBodySafely();
    if (requestBody === undefined) return "";
    const message = decodeGrpcBody(toBytes(requestBody));
    return String(varintField(parseFields(message), 1) || "");
  } catch (error) {
    log("debug", "failed to extract view aid from request", error);
    return "";
  }
}

// 从视频详情页（View）的 gRPC 响应消息中提取视频 aid。
function extractViewAidFromMessage(message) {
  try {
    const viewFields = parseFields(firstMessage(parseFields(message), 2) || new Uint8Array());
    const aid = String(varintField(viewFields, 1) || "");
    if (aid) return aid;
    return String(firstNonEmpty(fieldStrings(viewFields, 1)).replace(/^#/, "") || "");
  } catch (error) {
    log("debug", "failed to extract view aid from response", error);
    return "";
  }
}

// 递归遍历整个 protobuf 消息树，收集所有带有话题链接的视频话题 Tag。
function collectTopicTags(messageBytes) {
  const tags = [];

  walkProtobufFields(messageBytes, ({ fields }) => {
    const names = fieldStrings(fields, 2);
    const links = fieldStrings(fields, 3);
    if (names.length && links.some((link) => /app_comment_topic|search\?keyword=/.test(link))) {
      tags.push(...names);
    }
    return null;
  }, { maxDepth: 12 });

  return uniqueStrings(tags);
}

// 将整数值编码为 protobuf varint 格式的字节数组。
function encodeVarint(value) {
  const bytes = [];
  let next = Number(value);
  do {
    let byte = next & 0x7f;
    next = Math.floor(next / 128);
    if (next) byte |= 0x80;
    bytes.push(byte);
  } while (next);
  return new Uint8Array(bytes);
}

// 编码单个 protobuf 字段，wire type 2 时会自动附上长度前缀。
function encodeField(no, wireType, value) {
  const tag = encodeVarint(no * 8 + wireType);
  if (wireType === 2) {
    return concat([tag, encodeVarint(value.length), value]);
  }
  return concat([tag, value]);
}

// 尝试将字节解析为 protobuf 字段列表，解析失败时返回 null。
function tryParseFields(bytes) {
  try {
    const fields = parseFields(bytes);
    return fields.length ? fields : null;
  } catch {
    return null;
  }
}

// 判断字段是否为可继续递归解析的嵌套消息（wire type 2 且值部分非空）。
function isProtobufMessageField(field) {
  return field.wireType === 2 && field.value.length > 0;
}

// 对 protobuf 消息树执行只读遍历。visitor 回调可以返回 { stop } 提前结束遍历，或者返回 { skipChildren } 跳过当前节点的子层级。
function walkProtobufFields(bytes, visitor, options = {}) {
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : 12;
  const visited = options.visited || new Set();

  function walk(part, depth, path) {
    if (depth > maxDepth) return false;
    const visitKey = `${part.byteOffset}:${part.byteLength}`;
    if (visited.has(visitKey)) return false;
    visited.add(visitKey);

    const fields = tryParseFields(part);
    if (!fields) return false;

    const decision = visitor({ bytes: part, fields, depth, path }) || {};
    if (decision.stop) return true;
    if (decision.skipChildren) return false;

    for (const field of fields) {
      if (!isProtobufMessageField(field)) continue;
      if (walk(field.value, depth + 1, path.concat(field.no))) return true;
    }
    return false;
  }

  return walk(bytes, 0, []);
}

// 按字段回调重写 protobuf 消息树。visitor 可以删除字段或改写字段的值；无任何变化时直接返回原字节数组，以保持引用稳定。
function transformProtobufFields(bytes, visitor, options = {}) {
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : 12;

  function transform(part, depth, path) {
    if (depth > maxDepth) return { bytes: part, changed: false };
    const fields = tryParseFields(part);
    if (!fields) return { bytes: part, changed: false };

    let changed = false;
    const chunks = [];
    for (const field of fields) {
      const childPath = path.concat(field.no);
      const action = visitor({ field, fields, depth, path, childPath }) || {};
      if (action.remove) {
        changed = true;
        continue;
      }

      let nextValue = field.value;
      let fieldChanged = false;
      if (Object.prototype.hasOwnProperty.call(action, "value")) {
        nextValue = toBytes(action.value);
        fieldChanged = true;
      } else if (isProtobufMessageField(field) && depth < maxDepth) {
        const nested = transform(field.value, depth + 1, childPath);
        if (nested.changed) {
          nextValue = nested.bytes;
          fieldChanged = true;
        }
      }

      if (fieldChanged) {
        chunks.push(encodeField(field.no, field.wireType, nextValue));
        changed = true;
      } else {
        chunks.push(field.raw);
      }
    }

    return changed ? { bytes: concat(chunks), changed: true } : { bytes: part, changed: false };
  }

  return transform(bytes, 0, []);
}
