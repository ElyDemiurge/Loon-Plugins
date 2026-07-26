// core_modules/Common: keyword and tag blocking rules shared by iOS and iPadOS.

// Build title, creator, and tag rules while preserving display values for logs and notifications.
function buildKeywords() {
  const videoTagPatterns = parseVideoTagPatterns(arg.videoTagKeywords);
  const displayTitleKeywords = mergeDisplayKeywords(parseDisplayKeywords(arg.titleKeywords));
  const displayBlockedUps = mergeDisplayKeywords(parseDisplayKeywords(arg.blockedUps));
  return {
    titleKeywords: parseKeywords(displayTitleKeywords),
    // Normalize creator names once instead of repeating the work for every card.
    blockedUps: parseKeywords(displayBlockedUps).map(normalizeUpName),
    videoTagKeywords: videoTagPatterns,
    videoTagRegexes: buildRegexRules(videoTagPatterns),
    displayTitleKeywords,
    displayBlockedUps,
    displayVideoTagKeywords: videoTagPatterns,
  };
}

// Build generic content-keyword rules for dynamic and search-result pages.
function buildContentKeywords(value) {
  const displayKeywords = parseDisplayKeywords(value);
  return {
    keywords: parseKeywords(displayKeywords),
    displayKeywords,
  };
}

// Check whether usable content keywords are configured.
function hasContentKeywords(keywords) {
  return keywords.displayKeywords.length > 0;
}

// Find the first content-keyword match and return its rule, keyword, and matched value.
function findContentKeywordMatch(values, keywords, rule = "contentContains") {
  if (!hasContentKeywords(keywords)) return null;
  const match = findContainsMatch(
    values,
    keywords.keywords,
    keywords.displayKeywords
  );
  return match ? { rule, keyword: match.keyword, value: match.value } : null;
}

// Enable tag filtering only when deep filtering and tag rules are both configured.
function hasVideoTagFilter(keywords) {
  return arg.deepFilter && keywords.videoTagKeywords.length > 0;
}

// Check whether any title, creator, or tag blocking rule is active.
function hasAnyFilterRule(keywords) {
  return keywords.titleKeywords.length > 0 ||
    keywords.blockedUps.length > 0 ||
    hasVideoTagFilter(keywords);
}

// Parse the response body as JSON.
function parseResponseJson() {
  return JSON.parse(getResponseBodyText());
}

// Build common filter statistics for structured logging.
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

// Create a normalized filter row containing titles, creators, aid, and inline tags.
function createFilterRow({ item = null, titles = [], upNames = [], aid = "", inlineTags = [] }) {
  return {
    item,
    titles,
    upNames,
    aid: String(aid || ""),
    inlineTags,
  };
}

// Convert a matched filter row into a notification and log item.
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

// Match title keywords first and exact creator names second.
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

// Return the first matching video-tag regex rule.
function findTagMatch(tags, keywords) {
  if (!hasVideoTagFilter(keywords)) return null;
  const tagMatch = findRegexMatch(
    tags || [],
    keywords.videoTagRegexes
  );
  return tagMatch ? { rule: "tagRegex", keyword: tagMatch.keyword, value: tagMatch.value } : null;
}

// Populate row matches with text rules first, then tag rules for unmatched rows.
async function applyFilterMatches(rows, keywords) {
  for (const row of rows) {
    row.match = findTextMatch(row.titles, row.upNames, keywords);
  }
  await applyTagMatches(rows, keywords);
}

// Process items with a fixed concurrency limit and queue the remainder.
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

// Match tags for remaining rows using inline data, cache entries, then remote lookups.
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
    // Inline tags were already checked, so avoid allocating a merged array.
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
  // Prune and persist once after a batch that may fetch dozens of tag sets.
  flushTagCache();
}

// Find a case-insensitive substring match in candidate values.
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

// Find a case-insensitive exact match in candidate values.
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

// Find the first regular-expression match in candidate values.
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

// Return the first non-empty string.
function firstNonEmpty(values) {
  return values.find((value) => String(value || "").trim()) || "";
}

// Trim, deduplicate, and remove empty strings from a list.
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
