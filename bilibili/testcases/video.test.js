const {
  assert,
  TAG_CACHE_KEY,
  baseArgument,
  notifyingArgument,
  runPlugin,
  assertNotification,
  grpcMessageBytes,
  countTopLevelGrpcFields,
  viewFixtureBody,
  relatesFeedFixtureBody,
  videoFeedFixtureBody,
  test,
} = require("./test_context");

/* -------------------------------------------------------------------------- */
/* 视频页与推荐流                                                             */
/* -------------------------------------------------------------------------- */

test("视频页：清理推荐流推广内容、广告、直播、横幅和好物", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.app.viewunite.v1.View/View",
    bodyBytes: viewFixtureBody(),
    argument: notifyingArgument(),
  });
  const notification = assertNotification(result, "清理 5");
  const text = grpcMessageBytes(result.response.bodyBytes).toString("utf8");

  assert.doesNotMatch(text, /推广内容 A/);
  assert.doesNotMatch(text, /广告卡片 A/);
  assert.doesNotMatch(text, /直播推荐 A/);
  assert.doesNotMatch(text, /好物广告 A/);
  assert.doesNotMatch(text, /横幅广告 A/);
  assert.match(text, /普通相关推荐 B A/);
  assert.match(notification.message, /清理-视频页推荐流推广内容：\n1、标题：推广内容 A/);
  assert.match(notification.message, /\n\n清理-视频页推荐流广告卡片：\n1、标题：广告卡片 A/);
  assert.match(notification.message, /\n\n清理-视频页横幅广告：\n1、标题：横幅广告 A/);
  assert.match(notification.message, /\n\n清理-视频页推荐流直播卡片：\n1、标题：直播推荐 A/);
  assert.match(notification.message, /\n\n清理-视频页 UP 主推荐好物：\n1、标题：好物广告 A/);
});

test("视频页推荐流：清理广告卡片和直播推荐卡片", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.app.viewunite.v1.View/RelatesFeed",
    bodyBytes: relatesFeedFixtureBody(),
    argument: notifyingArgument(),
  });
  const notification = assertNotification(result, "保留 1 / 清理 3");
  const text = grpcMessageBytes(result.response.bodyBytes).toString("utf8");

  assert.equal(notification.title, "Bilibili 视频页推荐流清理");
  assert.equal(countTopLevelGrpcFields(result.response.bodyBytes, 1), 1);
  assert.doesNotMatch(text, /我为什么会看到此广告/);
  assert.doesNotMatch(text, /广告卡片 B/);
  assert.doesNotMatch(text, /广告卡片 A/);
  assert.doesNotMatch(text, /直播推荐 B/);
  assert.match(text, /普通相关推荐 B/);
  assert.match(notification.message, /清理-视频页推荐流广告卡片：\n1、标题：广告卡片 B/);
  assert.match(notification.message, /2、标题：广告卡片 A/);
  assert.match(notification.message, /\n\n清理-视频页推荐流直播卡片：\n1、标题：直播推荐 B/);
});

test("视频页推荐流：清理广告和直播但不误删普通直播标题", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/v2/feed/index/story?test=1",
    body: videoFeedFixtureBody(),
    argument: notifyingArgument(),
  });
  const notification = assertNotification(result, "保留 1 / 清理 2");
  const text = result.response.body;
  const items = JSON.parse(text).data.items;

  assert.equal(notification.title, "Bilibili 视频页推荐流清理");
  assert.equal(items.length, 1);
  assert.doesNotMatch(text, /信息流广告 A/);
  assert.doesNotMatch(text, /正在直播/);
  assert.match(text, /普通直播标题 A/);
  assert.match(notification.message, /清理-视频页推荐流广告卡片：\n1、标题：信息流广告 A/);
  assert.match(notification.message, /\n\n清理-视频页推荐流直播卡片：\n1、标题：正在直播｜UP：直播占位账号/);
});

test("视频页推荐流：视频标题关键词会屏蔽 gRPC 推荐卡片", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.app.viewunite.v1.View/RelatesFeed",
    bodyBytes: relatesFeedFixtureBody(),
    argument: notifyingArgument({ titleKeywords: "普通相关推荐" }),
  });
  const notification = assertNotification(result, "保留 0 / 屏蔽 1 / 清理 3");
  const text = grpcMessageBytes(result.response.bodyBytes).toString("utf8");

  assert.equal(countTopLevelGrpcFields(result.response.bodyBytes, 1), 0);
  assert.doesNotMatch(text, /普通相关推荐 B/);
  assert.match(notification.message, /屏蔽-视频页推荐流视频：\n1、标题：普通相关推荐 B｜UP：推荐流占位账号｜规则：屏蔽-视频（关键词）/);
});

test("视频页推荐流：JSON 入口 UP 主名称会屏蔽推荐卡片", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/v2/feed/index/story?test=1",
    body: videoFeedFixtureBody(),
    argument: notifyingArgument({ blockedUps: "普通占位账号" }),
  });
  const notification = assertNotification(result, "保留 0 / 屏蔽 1 / 清理 2");
  const text = result.response.body;
  const items = JSON.parse(text).data.items;

  assert.equal(items.length, 0);
  assert.doesNotMatch(text, /普通直播标题 A/);
  assert.match(notification.message, /屏蔽-视频页推荐流视频：\n1、标题：普通直播标题 A｜UP：普通占位账号｜规则：屏蔽-UP 主（名称）/);
});

test("视频页推荐流：深度 Tag 过滤会屏蔽推荐卡片", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.app.viewunite.v1.View/RelatesFeed",
    bodyBytes: relatesFeedFixtureBody(),
    argument: notifyingArgument({
      deepFilter: true,
      videoTagKeywords: "屏蔽Tag",
      cleanVideoRelatedAds: false,
      cleanVideoRelatedLiveRecommendations: false,
    }),
    httpClientGet(request, callback) {
      callback(null, { status: 200 }, JSON.stringify({
        code: 0,
        data: request.url.includes("aid=9001") ? [{ tag_name: "屏蔽Tag" }] : [],
      }));
    },
  });
  const notification = assertNotification(result, "保留 3 / 屏蔽 1 / 清理 0");
  const text = grpcMessageBytes(result.response.bodyBytes).toString("utf8");

  assert.equal(result.httpCalls.length, 1);
  assert.doesNotMatch(text, /普通相关推荐 B/);
  assert.match(notification.message, /屏蔽-视频页推荐流视频：\n1、标题：普通相关推荐 B｜UP：推荐流占位账号/);
});

test("视频页推荐流：JSON 入口深度 Tag 过滤会屏蔽推荐卡片", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/v2/feed/index/story?test=1",
    body: videoFeedFixtureBody(),
    argument: notifyingArgument({
      deepFilter: true,
      videoTagKeywords: "屏蔽Tag",
    }),
    httpClientGet(request, callback) {
      callback(null, { status: 200 }, JSON.stringify({
        code: 0,
        data: request.url.includes("aid=9101") ? [{ tag_name: "屏蔽Tag" }] : [],
      }));
    },
  });
  const notification = assertNotification(result, "保留 0 / 屏蔽 1 / 清理 2");
  const text = result.response.body;
  const items = JSON.parse(text).data.items;

  assert.equal(result.httpCalls.length, 1);
  assert.equal(items.length, 0);
  assert.doesNotMatch(text, /普通直播标题 A/);
  assert.match(notification.message, /屏蔽-视频页推荐流视频：\n1、标题：普通直播标题 A｜UP：普通占位账号/);
});

test("视频页：深度 Tag 过滤会屏蔽页面内推荐流卡片", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.app.viewunite.v1.View/View",
    bodyBytes: viewFixtureBody({ includeLive: false }),
    argument: notifyingArgument({
      deepFilter: true,
      videoTagKeywords: "屏蔽Tag",
      cleanVideoRelatedPromotedContent: false,
      cleanVideoRelatedAds: false,
      cleanVideoBannerAds: false,
      cleanVideoRelatedLiveRecommendations: false,
      cleanVideoUpGoodsAds: false,
    }),
    httpClientGet(request, callback) {
      callback(null, { status: 200 }, JSON.stringify({
        code: 0,
        data: request.url.includes("aid=9001") ? [{ tag_name: "屏蔽Tag" }] : [],
      }));
    },
  });
  const notification = assertNotification(result, /清理 0 \/ 屏蔽 1 \/ 新增缓存 aid 4001/);
  const text = grpcMessageBytes(result.response.bodyBytes).toString("utf8");

  assert.equal(result.httpCalls.length, 1);
  assert.doesNotMatch(text, /普通相关推荐 B A/);
  assert.match(notification.message, /屏蔽-视频页推荐流视频：\n1、标题：普通相关推荐 B A/);
});

test("视频页通知：不显示无结果清理项", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.app.viewunite.v1.View/View",
    bodyBytes: viewFixtureBody({ includeLive: false }),
    argument: notifyingArgument(),
  });
  const notification = assertNotification(result, "清理 4");

  assert.doesNotMatch(notification.message, /：无/);
  assert.doesNotMatch(notification.message, /清理-视频页推荐流直播卡片/);
});

test("视频页通知：无清理命中时提示未命中清理规则", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.app.viewunite.v1.View/View",
    bodyBytes: viewFixtureBody({ includeLive: false, includeUpGoods: false, includeTags: false }),
    argument: notifyingArgument({
      cleanVideoRelatedPromotedContent: false,
      cleanVideoRelatedAds: false,
      cleanVideoBannerAds: false,
      cleanVideoRelatedLiveRecommendations: false,
      cleanVideoUpGoodsAds: false,
    }),
  });
  const notification = assertNotification(result, "清理 0");

  assert.equal(notification.message, "未命中视频页清理规则");
});

test("视频页 Tag 缓存：通知不显示具体 Tag，日志保留 Tag", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.app.viewunite.v1.View/View",
    bodyBytes: viewFixtureBody({ includeLive: false }),
    argument: notifyingArgument({ deepFilter: true, videoTagKeywords: "不会命中", logLevel: "info" }),
  });
  const notification = assertNotification(result, /清理 4 \/ 新增缓存 aid 4001/);
  const logText = result.logs.join("\n");

  assert.doesNotMatch(notification.message, /测试Tag|未解析到 Tag/);
  assert.match(logText, /"tags":\["测试Tag"\]/);
});

test("视频页 Tag 缓存：关闭深度屏蔽时不写入缓存", async () => {
  const store = {};
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.app.viewunite.v1.View/View",
    bodyBytes: viewFixtureBody({ includeLive: false }),
    store,
    argument: baseArgument({
      deepFilter: false,
      videoTagKeywords: "测试Tag",
      cleanVideoRelatedPromotedContent: false,
      cleanVideoRelatedAds: false,
      cleanVideoBannerAds: false,
      cleanVideoRelatedLiveRecommendations: false,
      cleanVideoUpGoodsAds: false,
    }),
  });

  assert.equal(result.httpCalls.length, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(store, TAG_CACHE_KEY), false);
});
