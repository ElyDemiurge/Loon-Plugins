// core_modules/Common: mine-page statistics and notifications shared by iOS and iPadOS.

// Create mine-page statistics while platform handlers identify their own schemas.
function minePageSummary() {
  return {
    creationCenters: [],
    services: [],
  };
}

// Convert an entry group into a normalized notification item.
function minePageGroupSummary(title, items) {
  return {
    title,
    itemCount: Array.isArray(items) ? items.length : 0,
  };
}

// Build the mine-page personalization notification message.
function minePagePersonalizationMessage(summary, cleaned) {
  if (!cleaned) return "我的页面个性化清理开关已关闭";
  const lines = [];
  for (const item of summary.creationCenters) {
    lines.push(`创作中心：${item.itemCount} 个入口`);
  }
  for (const item of summary.services) {
    lines.push(`我的服务：${item.itemCount} 个入口`);
  }
  return lines.length ? lines.join("\n") : "未命中我的页面个性化模块";
}

// Build the complete mine-page personalization notification payload.
function minePagePersonalizationNotifyPayload(summary, cleaned) {
  return {
    title: "Bilibili 个性化清理",
    subtitle: cleaned
      ? `清理创作中心 ${summary.creationCenters.length} / 清理我的服务 ${summary.services.length}`
      : "已关闭",
    message: minePagePersonalizationMessage(summary, cleaned),
  };
}

// Write the response, log platform context, and send the personalization notification.
function finishMinePageResponse(json, summary, platform) {
  const cleaned = arg.cleanMineCreationCenter || arg.cleanMineServices;
  setResponseBodyText(JSON.stringify(json));
  log("info", {
    platform,
    page: "minePage",
    cleanMineCreationCenter: arg.cleanMineCreationCenter,
    cleanMineServices: arg.cleanMineServices,
    summary,
  });
  const notifyPayload = minePagePersonalizationNotifyPayload(summary, cleaned);
  notify(
    "personalization",
    notifyPayload.title,
    notifyPayload.subtitle,
    notifyPayload.message
  );
  finishResponse();
}
