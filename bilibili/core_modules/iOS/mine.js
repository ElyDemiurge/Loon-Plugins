// core_modules/iOS: iOS-specific mine-page sections_v2 and sections schema.

const IOS_MINE_PAGE_SECTION_ARRAY_KEYS = ["sections_v2", "sections"];
const IOS_MINE_CREATION_CENTER_TITLE = "创作中心";
const IOS_MINE_SERVICES_TITLE = "我的服务";

// Read an iOS mine-page text value, including object-wrapped titles.
function iosMinePageText(value) {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (value && typeof value === "object" && typeof value.text === "string") {
    return value.text.trim();
  }
  return "";
}

// Read an iOS mine-page section title.
function iosMinePageSectionTitle(section) {
  return firstNonEmpty([
    iosMinePageText(section?.title),
    iosMinePageText(section?.up_title),
    iosMinePageText(section?.module_title),
    iosMinePageText(section?.section_title),
    iosMinePageText(section?.name),
  ]);
}

// Summarize the number of entries in an iOS section.
function iosMinePageSectionSummary(section) {
  return minePageGroupSummary(
    iosMinePageSectionTitle(section) || "我的页面模块",
    section?.items
  );
}

// Check whether a section contains an entry matching a predicate.
function hasIosMinePageItem(section, predicate) {
  return Array.isArray(section?.items) && section.items.some((item) => predicate(item));
}

// Detect the iOS creation-center section.
function isIosMineCreationCenterSection(section) {
  const title = iosMinePageSectionTitle(section);
  if (title === IOS_MINE_CREATION_CENTER_TITLE) return true;
  return hasIosMinePageItem(section, (item) =>
    iosMinePageText(item?.title) === IOS_MINE_CREATION_CENTER_TITLE ||
    /bilibili:\/\/uper\/homevc|\/uper\/user_center\/archive_|member\.bilibili\.com\/york\/data-center/.test(String(item?.uri || ""))
  );
}

// Detect the iOS services section.
function isIosMineServicesSection(section) {
  return iosMinePageSectionTitle(section) === IOS_MINE_SERVICES_TITLE;
}

// Clean one iOS section array.
function cleanIosMinePageSectionArray(data, key, summary) {
  if (!Array.isArray(data?.[key])) return;
  const kept = [];
  for (const section of data[key]) {
    if (arg.cleanMineCreationCenter && isIosMineCreationCenterSection(section)) {
      summary.creationCenters.push(iosMinePageSectionSummary(section));
      continue;
    }
    if (arg.cleanMineServices && isIosMineServicesSection(section)) {
      summary.services.push(iosMinePageSectionSummary(section));
      continue;
    }
    kept.push(section);
  }
  data[key] = kept;
}

// Handle the iOS mine-page response.
function handleIosMinePageResponse() {
  const json = parseResponseJson();
  const data = json?.data;
  if (!data || typeof data !== "object") {
    log("info", { platform: "iOS", page: "minePage", message: "data not found" });
    return finishResponse();
  }

  const summary = minePageSummary();
  if (arg.cleanMineCreationCenter || arg.cleanMineServices) {
    for (const key of IOS_MINE_PAGE_SECTION_ARRAY_KEYS) {
      cleanIosMinePageSectionArray(data, key, summary);
    }
  }
  finishMinePageResponse(json, summary, "iOS");
}
