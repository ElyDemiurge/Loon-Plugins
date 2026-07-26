const {
  assert,
  notifyingArgument,
  runPlugin,
  assertNotification,
  assertUnchangedResponse,
  grpcMessageBytes,
  countTopLevelGrpcFields,
  searchSquareFixtureBody,
  searchDefaultWordsFixtureBody,
  searchSuggestFixtureBody,
  searchAllFixtureBody,
  searchAllCleanupFixtureBody,
  searchAllCleanupAndFilterFixtureBody,
  searchAllDirtySummaryFixtureBody,
  searchAllMixedResultFixtureBody,
  searchAllTagFixtureBody,
  test,
} = require("./test_context");

/* -------------------------------------------------------------------------- */
/* Home search                                                                */
/* -------------------------------------------------------------------------- */

test("首页搜索页面：默认移除热搜、搜索历史和搜索发现模块", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/v2/search/square?test=1",
    body: searchSquareFixtureBody(),
  });
  const body = JSON.parse(result.response.body);
  const notification = assertNotification(result, "保留 1 / 移除 3");

  assert.deepEqual(body.data.map((item) => item.type), ["other"]);
  assert.doesNotMatch(result.response.body, /样例热搜词|样例历史词|样例发现词/);
  assert.match(result.response.body, /保留词-A/);
  assert.match(notification.message, /移除-首页搜索页的bilibili热搜/);
  assert.match(notification.message, /移除-首页搜索页的搜索历史/);
  assert.match(notification.message, /移除-首页搜索页的搜索发现/);
});

test("首页搜索页面：关闭单项开关时保留对应模块", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/v2/search/square?test=1",
    body: searchSquareFixtureBody(),
    argument: notifyingArgument({ cleanSearchHistory: false }),
  });
  const body = JSON.parse(result.response.body);

  assert.deepEqual(body.data.map((item) => item.type), ["history", "other"]);
  assert.match(result.response.body, /样例历史词-A/);
  assert.doesNotMatch(result.response.body, /样例热搜词|样例发现词/);
  assertNotification(result, "保留 2 / 移除 2");
});

test("搜索框：默认移除滚动的推荐词", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.app.interface.v1.Search/DefaultWords",
    bodyBytes: searchDefaultWordsFixtureBody(),
  });
  const text = grpcMessageBytes(result.response.bodyBytes).toString("utf8");
  const notification = assertNotification(result, "移除 1");

  assert.equal(countTopLevelGrpcFields(result.response.bodyBytes, 1), 0);
  assert.doesNotMatch(text, /样例搜索框推荐词|样例搜索框展示词|track-id-sample/);
  assert.equal(notification.message, "移除-首页搜索框里滚动的推荐词");
});

test("搜索框：关闭开关时保留滚动的推荐词", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.app.interface.v1.Search/DefaultWords",
    bodyBytes: searchDefaultWordsFixtureBody(),
    argument: notifyingArgument({ cleanSearchDefaultWords: false }),
  });
  const text = grpcMessageBytes(result.response.bodyBytes).toString("utf8");

  assert.match(text, /样例搜索框推荐词/);
  assert.match(text, /样例搜索框展示词/);
  assertUnchangedResponse(result);
  assert.equal(result.notifications.length, 0);
});

test("搜索候选词条：关键词会屏蔽输入联想候选项", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.app.interface.v1.Search/Suggest3",
    bodyBytes: searchSuggestFixtureBody(),
    argument: notifyingArgument({ searchResultKeywords: "候选屏蔽词" }),
  });
  const notification = assertNotification(result, "保留 1 / 屏蔽 1");
  const text = grpcMessageBytes(result.response.bodyBytes).toString("utf8");
  const logText = result.logs.join("\n");

  assert.equal(countTopLevelGrpcFields(result.response.bodyBytes, 2), 1);
  assert.match(text, /普通候选词/);
  assert.doesNotMatch(text, /命中候选屏蔽词/);
  assert.equal(notification.title, "Bilibili 搜索候选词条屏蔽");
  assert.match(notification.message, /屏蔽搜索候选词条：\n1、标题：命中候选屏蔽词｜UP：-｜规则：屏蔽-搜索结果与候选词条（关键词）/);
  assert.match(logText, /屏蔽-搜索结果与候选词条（关键词）/);
  assert.doesNotMatch(logText, /内容关键词/);
});

test("搜索结果：内容关键词会屏蔽命中的搜索结果", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.polymer.app.search.v1.Search/SearchAll",
    bodyBytes: searchAllFixtureBody(),
    argument: notifyingArgument({ searchResultKeywords: "搜索屏蔽词", logLevel: "info" }),
  });
  const notification = assertNotification(result, "保留 1 / 屏蔽 1");
  const text = grpcMessageBytes(result.response.bodyBytes).toString("utf8");
  const logText = result.logs.join("\n");

  assert.equal(notification.title, "Bilibili 搜索结果屏蔽");
  assert.match(text, /普通搜索结果标题/);
  assert.doesNotMatch(text, /命中搜索屏蔽词标题/);
  assert.match(notification.message, /屏蔽搜索结果：\n1、标题：命中搜索屏蔽词标题｜UP：搜索占位账号｜规则：屏蔽-搜索结果与候选词条（关键词）/);
  assert.match(logText, /"title":"命中搜索屏蔽词标题"/);
  assert.match(logText, /"up":"搜索占位账号"/);
  assert.match(logText, /屏蔽-搜索结果与候选词条（关键词）/);
  assert.doesNotMatch(logText, /"title":"搜索占位账号"/);
  assert.doesNotMatch(logText, /内容关键词/);
});

test("搜索结果：内容关键词会屏蔽用户和动态搜索卡片", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.polymer.app.search.v1.Search/SearchAll",
    bodyBytes: searchAllMixedResultFixtureBody(),
    argument: notifyingArgument({
      cleanSearchResultAds: false,
      cleanSearchResultCreatorPromotions: false,
      cleanSearchResultLiveRooms: false,
      searchResultKeywords: "搜索屏蔽词",
    }),
  });
  const notification = assertNotification(result, "保留 1 / 屏蔽 2");
  const text = grpcMessageBytes(result.response.bodyBytes).toString("utf8");

  assert.equal(notification.title, "Bilibili 搜索结果屏蔽");
  assert.match(text, /普通搜索结果标题/);
  assert.doesNotMatch(text, /命中搜索屏蔽词用户简介/);
  assert.doesNotMatch(text, /命中搜索屏蔽词动态内容/);
  assert.match(notification.message, /屏蔽搜索结果：\n1、标题：命中搜索屏蔽词用户简介｜UP：目标占位账号｜规则：屏蔽-搜索结果与候选词条（关键词）/);
  assert.match(notification.message, /2、标题：#样例话题# 命中搜索屏蔽词动态内容｜UP：目标占位账号｜规则：屏蔽-搜索结果与候选词条（关键词）/);
});

test("搜索结果：默认移除广告、创作推广、直播和聚合卡片", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.polymer.app.search.v1.Search/SearchAll",
    bodyBytes: searchAllCleanupFixtureBody(),
    argument: notifyingArgument(),
  });
  const notification = assertNotification(result, "保留 2 / 屏蔽 0 / 清理广告 1 / 清理创作推广 1 / 清理直播 1 / 清理聚合卡片 1");
  const text = grpcMessageBytes(result.response.bodyBytes).toString("utf8");

  assert.equal(notification.title, "Bilibili 搜索结果清理");
  assert.equal(countTopLevelGrpcFields(result.response.bodyBytes, 4), 2);
  assert.match(text, /普通搜索结果视频/);
  assert.match(text, /搜索结果课堂卡片/);
  assert.doesNotMatch(text, /搜索结果广告卡片/);
  assert.doesNotMatch(text, /搜索结果创作推广视频/);
  assert.doesNotMatch(text, /搜索结果直播间/);
  assert.doesNotMatch(text, /样例聚合视频 A/);
  assert.doesNotMatch(text, /样例聚合视频 B/);
  assert.match(notification.message, /移除-搜索结果的广告：\n1、标题：搜索结果广告卡片｜UP：-｜规则：移除-搜索结果的广告/);
  assert.match(notification.message, /移除-搜索结果的创作推广：\n1、标题：搜索结果创作推广视频｜UP：推广占位账号｜规则：移除-搜索结果的创作推广/);
  assert.match(notification.message, /移除-搜索结果的直播：\n1、标题：搜索结果直播间｜UP：直播占位账号｜规则：移除-搜索结果的直播/);
  assert.match(notification.message, /移除-搜索结果聚合卡片：\n1、标题：样例聚合视频 A｜UP：-｜规则：移除-搜索结果聚合卡片/);
});

test("搜索结果通知：清理和屏蔽同时命中时只展示已开启类别", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.polymer.app.search.v1.Search/SearchAll",
    bodyBytes: searchAllCleanupAndFilterFixtureBody(),
    argument: notifyingArgument({
      searchResultKeywords: "搜索屏蔽词",
      notifyRemove: true,
      notifyFilter: false,
    }),
  });
  const notification = assertNotification(
    result,
    "保留 0 / 屏蔽 0 / 清理广告 1 / 清理创作推广 0 / 清理直播 0 / 清理聚合卡片 0"
  );

  assert.equal(notification.title, "Bilibili 搜索结果清理");
  assert.match(notification.message, /移除-搜索结果的广告/);
  assert.doesNotMatch(notification.message, /屏蔽搜索结果/);
});

test("搜索结果：关闭单项开关时保留对应清理卡片", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.polymer.app.search.v1.Search/SearchAll",
    bodyBytes: searchAllCleanupFixtureBody(),
    argument: notifyingArgument({
      cleanSearchResultAds: false,
      cleanSearchResultCreatorPromotions: false,
      cleanSearchResultLiveRooms: false,
      cleanSearchResultAggregationCards: false,
      searchResultKeywords: "不会命中的搜索词",
    }),
  });
  const notification = assertNotification(result, "保留 6 / 屏蔽 0");
  const text = grpcMessageBytes(result.response.bodyBytes).toString("utf8");

  assert.equal(notification.title, "Bilibili 搜索结果屏蔽");
  assert.equal(countTopLevelGrpcFields(result.response.bodyBytes, 4), 6);
  assert.match(text, /搜索结果广告卡片/);
  assert.match(text, /搜索结果创作推广视频/);
  assert.match(text, /搜索结果直播间/);
  assert.match(text, /样例聚合视频 A/);
  assert.match(text, /样例聚合视频 B/);
  assert.equal(notification.message, "未命中搜索结果屏蔽规则");
});

test("搜索结果：脏广告字段里的关键词不会触发搜索结果屏蔽", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.polymer.app.search.v1.Search/SearchAll",
    bodyBytes: searchAllDirtySummaryFixtureBody(),
    argument: notifyingArgument({
      cleanSearchResultAds: false,
      cleanSearchResultCreatorPromotions: false,
      cleanSearchResultLiveRooms: false,
      searchResultKeywords: "搜索屏蔽词",
    }),
  });
  const notification = assertNotification(result, "保留 2 / 屏蔽 1");
  const text = grpcMessageBytes(result.response.bodyBytes).toString("utf8");
  const logText = result.logs.join("\n");

  assert.equal(countTopLevelGrpcFields(result.response.bodyBytes, 4), 2);
  assert.match(text, /picture_ad/);
  assert.doesNotMatch(text, /#搜索屏蔽词# 正常搜索动态内容/);
  assert.match(notification.message, /屏蔽搜索结果：\n1、标题：#搜索屏蔽词# 正常搜索动态内容｜UP：-｜规则：屏蔽-搜索结果与候选词条（关键词）/);
  assert.doesNotMatch(logText, /picture_ad|1290926279|\ufffd|\x12/);
});

test("搜索结果：视频 Tag 规则会接入搜索结果屏蔽", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.polymer.app.search.v1.Search/SearchAll",
    bodyBytes: searchAllTagFixtureBody(),
    argument: notifyingArgument({ deepFilter: true, videoTagKeywords: "^样例Tag$" }),
    httpClientGet(request, callback) {
      callback(null, { status: 200 }, JSON.stringify({
        code: 0,
        data: request.url.includes("aid=9101") ? [{ tag_name: "样例Tag" }] : [],
      }));
    },
  });
  const notification = assertNotification(result, "保留 1 / 屏蔽 1");
  const text = grpcMessageBytes(result.response.bodyBytes).toString("utf8");
  const logText = result.logs.join("\n");

  assert.equal(result.httpCalls.length, 2);
  assert.match(result.httpCalls.join("\n"), /aid=9101/);
  assert.match(result.httpCalls.join("\n"), /aid=9102/);
  assert.equal(notification.title, "Bilibili 搜索结果屏蔽");
  assert.match(text, /普通搜索结果标题/);
  assert.doesNotMatch(text, /命中样例Tag标题/);
  assert.match(notification.message, /屏蔽搜索结果：\n1、标题：命中样例Tag标题｜UP：搜索占位账号｜规则：深度屏蔽-视频 Tag（可正则）/);
  assert.match(logText, /深度屏蔽-视频 Tag（可正则）/);
  assert.doesNotMatch(logText, /内容关键词/);
});

test("搜索结果：视频标题关键词会屏蔽搜索结果视频", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.polymer.app.search.v1.Search/SearchAll",
    bodyBytes: searchAllFixtureBody(),
    argument: notifyingArgument({ titleKeywords: "搜索屏蔽词", logLevel: "info" }),
  });
  const notification = assertNotification(result, "保留 1 / 屏蔽 1");
  const text = grpcMessageBytes(result.response.bodyBytes).toString("utf8");
  const logText = result.logs.join("\n");

  assert.equal(notification.title, "Bilibili 搜索结果屏蔽");
  assert.match(text, /普通搜索结果标题/);
  assert.doesNotMatch(text, /命中搜索屏蔽词标题/);
  assert.match(notification.message, /屏蔽搜索结果：\n1、标题：命中搜索屏蔽词标题｜UP：搜索占位账号｜规则：屏蔽-视频（关键词）/);
  assert.match(logText, /屏蔽-视频（关键词）/);
  assert.match(logText, /"titleBlockKeywords":\["搜索屏蔽词"\]/);
});

test("搜索结果：UP 主名称会屏蔽搜索结果视频", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.polymer.app.search.v1.Search/SearchAll",
    bodyBytes: searchAllFixtureBody(),
    argument: notifyingArgument({ blockedUps: "搜索占位账号", logLevel: "info" }),
  });
  const notification = assertNotification(result, "保留 1 / 屏蔽 1");
  const text = grpcMessageBytes(result.response.bodyBytes).toString("utf8");
  const logText = result.logs.join("\n");

  assert.equal(notification.title, "Bilibili 搜索结果屏蔽");
  assert.match(text, /普通搜索结果标题/);
  assert.doesNotMatch(text, /命中搜索屏蔽词标题/);
  assert.match(notification.message, /屏蔽搜索结果：\n1、标题：命中搜索屏蔽词标题｜UP：搜索占位账号｜规则：屏蔽-UP 主（名称）/);
  assert.match(logText, /屏蔽-UP 主（名称）/);
  assert.match(logText, /"blockedUps":\["搜索占位账号"\]/);
});

test("搜索结果：UP 主名称会屏蔽用户和动态搜索卡片", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.polymer.app.search.v1.Search/SearchAll",
    bodyBytes: searchAllMixedResultFixtureBody(),
    argument: notifyingArgument({
      cleanSearchResultAds: false,
      cleanSearchResultCreatorPromotions: false,
      cleanSearchResultLiveRooms: false,
      blockedUps: "目标占位账号",
    }),
  });
  const notification = assertNotification(result, "保留 1 / 屏蔽 2");
  const text = grpcMessageBytes(result.response.bodyBytes).toString("utf8");

  assert.equal(notification.title, "Bilibili 搜索结果屏蔽");
  assert.match(text, /普通搜索结果标题/);
  assert.doesNotMatch(text, /命中搜索屏蔽词用户简介/);
  assert.doesNotMatch(text, /命中搜索屏蔽词动态内容/);
  assert.match(notification.message, /1、标题：命中搜索屏蔽词用户简介｜UP：目标占位账号｜规则：屏蔽-UP 主（名称）/);
  assert.match(notification.message, /2、标题：#样例话题# 命中搜索屏蔽词动态内容｜UP：目标占位账号｜规则：屏蔽-UP 主（名称）/);
});
