// core_modules/iPadOS: iPadOS-specific grouped-array schema for the mine page.

// Clear one iPadOS entry group and record its original size.
function cleanIpadMinePageGroup(data, key, title, target) {
  if (!Array.isArray(data?.[key])) return;
  target.push(minePageGroupSummary(title, data[key]));
  data[key] = [];
}

// Handle the iPadOS /x/v2/account/mine/ipad response.
function handleIpadMinePageResponse() {
  const json = parseResponseJson();
  const data = json?.data;
  if (!data || typeof data !== "object") {
    log("info", { platform: "iPadOS", page: "minePage", message: "data not found" });
    return finishResponse();
  }

  const summary = minePageSummary();
  if (arg.cleanMineCreationCenter) {
    cleanIpadMinePageGroup(
      data,
      "ipad_upper_sections",
      "创作中心",
      summary.creationCenters
    );
  }
  if (arg.cleanMineServices) {
    cleanIpadMinePageGroup(
      data,
      "ipad_recommend_sections",
      "我的服务",
      summary.services
    );
  }

  // ipad_sections and ipad_more_sections contain regular entries and remain unchanged.
  finishMinePageResponse(json, summary, "iPadOS");
}
