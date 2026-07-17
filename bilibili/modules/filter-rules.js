/* -------------------------------------------------------------------------- */
/* 屏蔽规则与关键词                                                           */
/* -------------------------------------------------------------------------- */

// 构建本次执行所需的屏蔽规则集合：标题关键词、UP 名称以及视频 Tag 正则，同时保留原始写法用于通知与日志展示。
function buildKeywords() {
  const videoTagPatterns = parseVideoTagPatterns(arg.videoTagKeywords);
  const displayTitleKeywords = mergeDisplayKeywords(parseDisplayKeywords(arg.titleKeywords));
  const displayBlockedUps = mergeDisplayKeywords(parseDisplayKeywords(arg.blockedUps));
  return {
    titleKeywords: parseKeywords(displayTitleKeywords),
    // UP 名称只在这里做一次标准化，避免每张卡片匹配时重复清理同一组关键词。
    blockedUps: parseKeywords(displayBlockedUps).map(normalizeUpName),
    videoTagKeywords: videoTagPatterns,
    videoTagRegexes: buildRegexRules(videoTagPatterns),
    displayTitleKeywords,
    displayBlockedUps,
    displayVideoTagKeywords: videoTagPatterns,
  };
}

// 构建动态页以及搜索结果等内容场景的通用关键词规则。
function buildContentKeywords(value) {
  const displayKeywords = parseDisplayKeywords(value);
  return {
    keywords: parseKeywords(displayKeywords),
    displayKeywords,
  };
}

// 判断给定内容场景是否配置了可用的关键词。
function hasContentKeywords(keywords) {
  return keywords.displayKeywords.length > 0;
}

// 在候选文本列表中查找内容关键词的命中项，命中后返回规则名、关键词以及命中的文本值。
function findContentKeywordMatch(values, keywords, rule = "contentContains") {
  if (!hasContentKeywords(keywords)) return null;
  const match = findContainsMatch(
    values,
    keywords.keywords,
    keywords.displayKeywords
  );
  return match ? { rule, keyword: match.keyword, value: match.value } : null;
}

// 判断视频 Tag 过滤功能是否启用，需要同时开启深度屏蔽开关并配置了 Tag 规则。
function hasVideoTagFilter(keywords) {
  return arg.deepFilter && keywords.videoTagKeywords.length > 0;
}

// 判断是否配置了任意一条屏蔽规则（标题关键词、UP 名称或视频 Tag）。
function hasAnyFilterRule(keywords) {
  return keywords.titleKeywords.length > 0 ||
    keywords.blockedUps.length > 0 ||
    hasVideoTagFilter(keywords);
}

// 将响应体文本解析为 JSON 对象。
function parseResponseJson() {
  return JSON.parse(getResponseBodyText());
}

// 汇总通用的过滤统计信息，供脚本日志统一输出时使用。
function filterSummary(page, kept, removed, keywords) {
  return {
    page,
    kept,
    removed,
    titleBlockKeywords: keywords.displayTitleKeywords,
    blockedUps: keywords.displayBlockedUps,
    deepFilter: arg.deepFilter,
    videoTagKeywords: keywords.displayVideoTagKeywords,
  };
}

// 构造统一的过滤行结构，同时承载标题、UP 名称、aid 以及内联视频 Tag。
function createFilterRow({ item = null, titles = [], upNames = [], aid = "", inlineTags = [] }) {
  return {
    item,
    titles,
    upNames,
    aid: String(aid || ""),
    inlineTags,
  };
}

// 从命中的过滤行中生成用于通知与日志展示的条目。
function matchedFilterItem(row) {
  return {
    title: firstNonEmpty(row.titles),
    up: firstNonEmpty(row.upNames),
    aid: row.aid,
    rule: row.match?.rule,
    keyword: row.match?.keyword,
    matchedValue: row.match?.value,
  };
}

// 依次按标题关键词与 UP 主名称进行匹配，返回首个命中的规则。
function findTextMatch(titles, upNames, keywords) {
  const titleMatch = findContainsMatch(titles, keywords.titleKeywords, keywords.displayTitleKeywords);
  if (titleMatch) {
    return { rule: "titleContains", keyword: titleMatch.keyword, value: titleMatch.value };
  }

  const upMatch = findExactMatch(upNames, keywords.blockedUps, keywords.displayBlockedUps);
  if (upMatch) {
    return { rule: "upExact", keyword: upMatch.keyword, value: upMatch.value };
  }

  return null;
}

// 按视频 Tag 正则进行匹配，返回首个命中的规则。
function findTagMatch(tags, keywords) {
  if (!hasVideoTagFilter(keywords)) return null;
  const tagMatch = findRegexMatch(
    tags || [],
    keywords.videoTagRegexes
  );
  return tagMatch ? { rule: "tagRegex", keyword: tagMatch.keyword, value: tagMatch.value } : null;
}

// 为一组过滤行依次填充 match 字段：先执行文本匹配，未命中的行再补充执行 Tag 匹配。
async function applyFilterMatches(rows, keywords) {
  for (const row of rows) {
    row.match = findTextMatch(row.titles, row.upNames, keywords);
  }
  await applyTagMatches(rows, keywords);
}

// 按照并发上限依次处理列表中的每一项，超出并发数的项目排队等待可用空位。
async function mapLimited(items, limit, worker) {
  const concurrency = Math.max(1, Math.min(Number(limit) || 1, items.length || 1));
  let index = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (index < items.length) {
      const current = items[index++];
      await worker(current);
    }
  }));
}

// 对尚未命中文本屏蔽规则的行尝试 Tag 匹配：优先用内联 Tag，其次查缓存，最后按需向远端拉取视频标签。
async function applyTagMatches(rows, keywords) {
  if (!hasVideoTagFilter(keywords)) return;

  const needsRemoteTags = [];
  for (const row of rows) {
    if (row.match) continue;

    const inlineTagMatch = findTagMatch(row.inlineTags || [], keywords);
    if (inlineTagMatch) {
      row.match = inlineTagMatch;
      continue;
    }

    const cachedTags = getCachedTags(row.aid);
    // 内联 Tag 已经检查过，不再创建合并数组重复匹配。
    const cachedTagMatch = findTagMatch(cachedTags, keywords);
    if (cachedTagMatch) {
      row.match = cachedTagMatch;
      continue;
    }

    if (row.aid) needsRemoteTags.push(row);
  }

  await mapLimited(needsRemoteTags, TAG_FETCH_CONCURRENCY_LIMIT, async (row) => {
    const tags = await ensureTagsForAid(row.aid, { deferCacheWrite: true });
    const tagMatch = findTagMatch(tags, keywords);
    if (tagMatch) row.match = tagMatch;
  });
  // 一次推荐流可能拉取几十个 Tag，统一在批次结束后裁剪并写入一次持久化缓存。
  flushTagCache();
}

// 在候选文本中查找包含关系命中（供标题关键词等使用，不区分大小写）。
function findContainsMatch(values, normalizedKeywords, displayKeywords) {
  if (!normalizedKeywords.length) return null;
  for (const value of values) {
    const text = String(value).toLowerCase();
    for (let i = 0; i < normalizedKeywords.length; i += 1) {
      if (text.includes(normalizedKeywords[i])) {
        return { keyword: displayKeywords[i] || normalizedKeywords[i], value: String(value) };
      }
    }
  }
  return null;
}

// 在候选文本中查找完全匹配命中（供 UP 名称等使用，不区分大小写）。
function findExactMatch(values, normalizedKeywords, displayKeywords) {
  if (!normalizedKeywords.length) return null;
  for (const value of values) {
    const text = normalizeUpName(String(value).toLowerCase());
    for (let i = 0; i < normalizedKeywords.length; i += 1) {
      if (text === normalizedKeywords[i]) {
        return { keyword: displayKeywords[i] || normalizedKeywords[i], value: String(value) };
      }
    }
  }
  return null;
}

// 在候选文本中查找正则命中（供视频 Tag 等正则规则使用）。
function findRegexMatch(values, regexRules) {
  if (!regexRules.length) return null;
  for (const value of values) {
    const text = String(value || "");
    for (let i = 0; i < regexRules.length; i += 1) {
      const rule = regexRules[i];
      rule.regex.lastIndex = 0;
      if (rule.regex.test(text)) {
        return { keyword: rule.pattern, value: text };
      }
    }
  }
  return null;
}

// 返回首个非空字符串。
function firstNonEmpty(values) {
  return values.find((value) => String(value || "").trim()) || "";
}

// 对字符串列表执行去空白与去重操作，并过滤掉空值。
function uniqueStrings(values) {
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}
