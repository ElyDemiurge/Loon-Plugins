// core_modules/Common: protobuf message-tree utilities shared by iOS and iPadOS.

// Read the first varint value for a field number.
function varintField(fields, no) {
  const field = fields.find((item) => item.no === no && item.wireType === 0);
  return field ? readVarint(field.value, 0).value : "";
}

// Extract the video aid from a View gRPC request body.
function extractViewAidFromRequest() {
  try {
    const requestBody = getRequestBodySafely();
    if (requestBody === undefined) return "";
    const message = decodeGrpcBody(toBytes(requestBody));
    return String(varintField(parseFields(message), 1) || "");
  } catch (error) {
    log("debug", "failed to extract view aid from request", error);
    return "";
  }
}

// Recursively collect video-topic tags that include a recognized topic link.
function collectTopicTags(messageBytes) {
  const tags = [];

  walkProtobufFields(messageBytes, ({ fields }) => {
    const names = fieldStrings(fields, 2);
    // ViewUnite stores topic links in field 3; the legacy iPadOS View uses field 7.
    const links = fieldStrings(fields, 3).concat(fieldStrings(fields, 7));
    if (names.length && links.some((link) => /app_comment_topic|search\?keyword=/.test(link))) {
      tags.push(...names);
    }
    return null;
  }, { maxDepth: 12 });

  return uniqueStrings(tags);
}

// Encode an integer as protobuf varint bytes.
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

// Encode one protobuf field, including a length prefix for wire type 2.
function encodeField(no, wireType, value) {
  const tag = encodeVarint(no * 8 + wireType);
  if (wireType === 2) {
    return concat([tag, encodeVarint(value.length), value]);
  }
  return concat([tag, value]);
}

// Parse protobuf fields and return null on failure.
function tryParseFields(bytes) {
  try {
    const fields = parseFields(bytes);
    return fields.length ? fields : null;
  } catch {
    return null;
  }
}

// Check whether a field can contain a nested message.
function isProtobufMessageField(field) {
  return field.wireType === 2 && field.value.length > 0;
}

// Walk a protobuf tree; visitors may stop traversal or skip child nodes.
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

// Transform a protobuf tree while preserving original bytes when nothing changes.
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
