// core_modules/Common: shared router dispatching to Common, iOS, and iPadOS handlers.
/* -------------------------------------------------------------------------- */
/* Route entry point                                                          */
/* -------------------------------------------------------------------------- */

// Dispatch a response by request URL and preserve unmatched responses unchanged.
async function main() {
  const url = getRequestUrl();
  if (/\/x\/v2\/splash\/(?:show|list|brand\/list|brand\/show|event\/list|event\/list2|ad\/list|topview\/list)\?/.test(url)) {
    return handleSplashResponse();
  }

  if (/\/x\/resource\/(?:show\/tab\/v2|show\/skin|peak\/download)\?/.test(url)) {
    return handleStartupAdsResponse();
  }

  if (/\/x\/v2\/account\/mine\/ipad\?/.test(url)) {
    return handleIpadMinePageResponse();
  }

  if (/\/x\/v2\/account\/mine\?/.test(url)) {
    return handleIosMinePageResponse();
  }

  if (/\/x\/vip\/ads\/materials\?/.test(url)) {
    return handleIpadVipAdsMaterialsResponse();
  }

  if (/\/x\/v2\/search\/square\?/.test(url)) {
    return handleSearchSquareResponse();
  }

  if (/\/bilibili\.app\.interface\.v1\.Search\/DefaultWords$/.test(url)) {
    return handleSearchDefaultWordsResponse();
  }

  if (/\/bilibili\.app\.interface\.v1\.Search\/Suggest3$/.test(url)) {
    return handleSearchSuggestResponse();
  }

  if (/\/bilibili\.polymer\.app\.search\.v1\.Search\/SearchAll$/.test(url)) {
    return await handleSearchAllResponse();
  }

  if (/\/x\/v2\/feed\/index\/story\?/.test(url)) {
    return handleVideoFeedIndex();
  }

  if (/\/x\/v2\/feed\/index\?/.test(url)) {
    return await filterHomeFeedIndex();
  }

  if (/\/bilibili\.app\.viewunite\.v1\.View\/View$/.test(url)) {
    return handleIosViewResponse();
  }

  if (/\/bilibili\.app\.viewunite\.v1\.View\/RelatesFeed$/.test(url)) {
    return handleIosRelatesFeedResponse();
  }

  if (/\/bilibili\.app\.view\.v1\.View\/View$/.test(url)) {
    return handleIpadViewResponse();
  }

  if (/\/bilibili\.app\.dynamic\.v2\.Dynamic\/DynAll$/.test(url)) {
    return handleDynamicAllResponse();
  }

  if (/\/bilibili\.main\.community\.reply\.v1\.Reply\/MainList$/.test(url)) {
    return handleReplyMainListResponse();
  }

  if (/api\.live\.bilibili\.com\/xlive\/(?:app-interface\/v2\/index\/feed|app-room\/v1\/index\/getInfoBy(?:Room|User)|e-commerce-interface\/v1\/ecommerce-user\/get_shopping_info)\?/.test(url)) {
    return handleLiveAdsResponse();
  }

  if (/api\.bilibili\.com\/x\/pd-proxy\/tracker\?/.test(url)) {
    return handlePdProxyTrackerResponse();
  }

  if (/\/bilibili\.app\.interface\.v1\.Teenagers\/ModeStatus$/.test(url)) {
    return handleTeenagersResponse();
  }

  if (/\/bilibili\.app\.(?:view\.v1\.View\/TFInfo|viewunite\.v1\.View\/(?:PlayPause|ViewEndPage))$/.test(url)) {
    return handleInteractiveDanmakuResponse();
  }

  if (/\/bilibili\.app\.show\.v1\.Popular\/Index$/.test(url)) {
    return await handleHomePopularIndex();
  }

  log("debug", { page: "router", message: "unmatched route", url });
  return finishUnchanged();
}

// Run the main flow and always release the response after reporting an unexpected error.
Promise.resolve(main()).catch((error) => {
  const url = getRequestUrl();
  const pageName = (() => {
    if (/\/bilibili\.app\.(?:view|viewunite)\.v1\.View\//.test(url)) return "视频页";
    if (/\/bilibili\.app\.dynamic\.v2\.Dynamic\/DynAll$/.test(url)) return "动态页";
    if (/\/x\/v2\/splash\//.test(url)) return "开屏广告";
    if (/\/bilibili\.app\.interface\.v1\.Search\/Suggest3$/.test(url)) return "搜索候选词条";
    if (/\/bilibili\.polymer\.app\.search\.v1\.Search\/SearchAll$/.test(url)) return "搜索结果";
    if (/\/bilibili\.main\.community\.reply\.v1\.Reply\/MainList$/.test(url)) return "评论区";
    if (/api\.live\.bilibili\.com\/xlive\//.test(url)) return "直播间";
    if (/\/x\/pd-proxy\/tracker/.test(url)) return "追踪";
    if (/Teenagers\/ModeStatus/.test(url)) return "青少年模式";
    if (/View\/TFInfo|PlayPause|ViewEndPage/.test(url)) return "交互弹幕";
    if (/\/x\/v2\/account\/mine(?:\/ipad)?\?/.test(url)) return "我的页面";
    if (/\/x\/vip\/ads\/materials\?/.test(url)) return "大会员广告素材";
    if (/\/x\/v2\/feed\/index/.test(url)) return "首页推荐页";
    return "首页热门";
  })();
  log("error", error);
  notify(["remove", "filter"], `Bilibili ${pageName}处理`, "脚本错误", stringify(error).slice(0, 180));
  finishUnchanged();
});
