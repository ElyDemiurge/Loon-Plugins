// core_modules/iPadOS: iPadOS-specific premium-membership advertisement materials.

/* -------------------------------------------------------------------------- */
/* iPadOS premium advertisement materials                                    */
/* -------------------------------------------------------------------------- */

// Clear premium advertisement material lists and the login overlay under the shared startup-promotion switch.
function handleIpadVipAdsMaterialsResponse() {
  if (!arg.cleanStartupAds) {
    log("info", { platform: "iPadOS", page: "vipAds", message: "switch off" });
    return finishUnchanged();
  }

  const json = parseResponseJson();
  const data = json?.data;
  if (!data || typeof data !== "object") {
    log("info", { platform: "iPadOS", page: "vipAds", message: "data not found" });
    return finishResponse();
  }

  const summary = {
    list: 0,
    listV2: 0,
    loginLayers: 0,
  };

  if (Array.isArray(data.list)) {
    summary.list = data.list.length;
    data.list = [];
  }
  if (Array.isArray(data.list_v2)) {
    summary.listV2 = data.list_v2.length;
    data.list_v2 = [];
  }
  if (
    data.vip_login_coupon &&
    typeof data.vip_login_coupon === "object" &&
    data.vip_login_coupon.login_layer != null
  ) {
    summary.loginLayers = 1;
    data.vip_login_coupon.login_layer = null;
  }

  setResponseBodyText(JSON.stringify(json));
  const cleaned = summary.list + summary.listV2 + summary.loginLayers;
  const subtitle = `清理广告素材 ${cleaned}`;
  const message = [
    `list：${summary.list}`,
    `list_v2：${summary.listV2}`,
    `登录浮层：${summary.loginLayers}`,
  ].join("\n");
  log("info", {
    platform: "iPadOS",
    page: "vipAds",
    cleanStartupAds: arg.cleanStartupAds,
    cleaned,
    summary,
  });
  notify("remove", "Bilibili 大会员广告素材清理", subtitle, message);
  finishResponse();
}
