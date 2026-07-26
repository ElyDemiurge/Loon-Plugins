const {
  assert,
  TAG_CACHE_KEY,
  baseArgument,
  notifyingArgument,
  runPlugin,
  assertNotification,
  assertUnchangedResponse,
  grpcMessageBytes,
  countTopLevelGrpcFields,
  ipadLegacyViewFixtureBody,
  ipadHomeFeedFixtureBody,
  ipadStartupTabFixtureBody,
  ipadMinePageFixtureBody,
  ipadVipAdsFixtureBody,
  test,
} = require("./test_context");

test("iPadOS 视频页：清理旧版 View 的广告、直播和独立广告字段", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.app.view.v1.View/View",
    bodyBytes: ipadLegacyViewFixtureBody(),
    argument: notifyingArgument(),
  });
  const notification = assertNotification(result, "清理 3");
  const text = grpcMessageBytes(result.response.bodyBytes).toString("utf8");

  assert.equal(countTopLevelGrpcFields(result.response.bodyBytes, 10), 1);
  assert.equal(countTopLevelGrpcFields(result.response.bodyBytes, 41), 0);
  assert.match(text, /iPadOS 普通相关推荐/);
  assert.doesNotMatch(text, /iPadOS 广告相关推荐|iPadOS 直播相关推荐|iPadOS 独立广告素材/);
  assert.match(notification.message, /清理-视频页推荐流广告卡片/);
  assert.match(notification.message, /清理-视频页推荐流直播卡片/);
});

test("iPadOS 视频页：按旧版 View 的标题字段屏蔽相关视频", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.app.view.v1.View/View",
    bodyBytes: ipadLegacyViewFixtureBody(),
    argument: notifyingArgument({ titleKeywords: "普通相关推荐" }),
  });
  const notification = assertNotification(result, "清理 3 / 屏蔽 1");
  const text = grpcMessageBytes(result.response.bodyBytes).toString("utf8");

  assert.equal(countTopLevelGrpcFields(result.response.bodyBytes, 10), 0);
  assert.doesNotMatch(text, /iPadOS 普通相关推荐/);
  assert.match(notification.message, /规则：屏蔽-视频（关键词）/);
});

test("iPadOS 视频页：按旧版 View owner 字段屏蔽 UP 主", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.app.view.v1.View/View",
    bodyBytes: ipadLegacyViewFixtureBody(),
    argument: notifyingArgument({ blockedUps: "iPadOS 普通UP" }),
  });
  const notification = assertNotification(result, "清理 3 / 屏蔽 1");

  assert.equal(countTopLevelGrpcFields(result.response.bodyBytes, 10), 0);
  assert.match(notification.message, /UP：iPadOS 普通UP｜规则：屏蔽-UP 主（名称）/);
});

test("iPadOS 视频页：从 field 7 话题链接缓存 Tag，并从响应回退解析 aid", async () => {
  const store = {};
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.app.view.v1.View/View",
    bodyBytes: ipadLegacyViewFixtureBody(),
    store,
    argument: notifyingArgument({ deepFilter: true }),
  });
  const cache = JSON.parse(store[TAG_CACHE_KEY]);

  assert.deepEqual(cache.items["8001"].tags, ["iPad测试Tag"]);
  assertNotification(result, /清理 3 \/ 新增缓存 aid 8001/);
});

test("iPadOS 首页推荐页：识别 iPad 卡片类型并只保留普通视频", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/v2/feed/index?device=pad",
    body: ipadHomeFeedFixtureBody(),
    argument: notifyingArgument(),
  });
  const body = JSON.parse(result.response.body);

  assert.deepEqual(body.data.items.map((item) => item.title), [
    "iPadOS 普通视频 A",
    "iPadOS 普通视频 B",
  ]);
  assertNotification(result, "保留 2 / 屏蔽 0 / 清理广告 3 / 清理推广 1");
});

test("iPadOS 首页顶部分区：不调用 iOS 顶部分区过滤代码", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/resource/show/tab/v2?device=pad",
    body: ipadStartupTabFixtureBody(),
    argument: baseArgument({
      cleanStartupAds: false,
      cleanHomeGameButton: false,
      cleanHomeTopTabs: true,
      cleanBottomExtraButtons: false,
    }),
  });
  const body = JSON.parse(result.response.body);

  assert.deepEqual(
    body.data.tab.map((item) => item.name),
    ["直播", "推荐", "热门", "追番", "影视"]
  );
  assertUnchangedResponse(result);
});

test("iPadOS 我的页面：清空创作中心与我的服务专属数组并保留普通数组", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/v2/account/mine/ipad?test=1",
    body: ipadMinePageFixtureBody(),
    argument: notifyingArgument({ notifyRemove: false, notifyFilter: false }),
  });
  const body = JSON.parse(result.response.body);
  const notification = assertNotification(result, "清理创作中心 1 / 清理我的服务 1");

  assert.deepEqual(body.data.ipad_upper_sections, []);
  assert.deepEqual(body.data.ipad_recommend_sections, []);
  assert.equal(body.data.ipad_sections.length, 2);
  assert.equal(body.data.ipad_more_sections.length, 3);
  assert.match(notification.message, /创作中心：4 个入口/);
  assert.match(notification.message, /我的服务：7 个入口/);
});

test("iPadOS 我的页面：单项开关互相独立", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/v2/account/mine/ipad?test=1",
    body: ipadMinePageFixtureBody(),
    argument: baseArgument({
      cleanMineCreationCenter: false,
      cleanMineServices: true,
    }),
  });
  const body = JSON.parse(result.response.body);

  assert.equal(body.data.ipad_upper_sections.length, 4);
  assert.deepEqual(body.data.ipad_recommend_sections, []);
  assert.equal(body.data.ipad_more_sections.length, 3);
});

test("iPadOS 大会员广告：清空素材列表与登录浮层并保留实验信息", async () => {
  const result = await runPlugin({
    url: "https://api.bilibili.com/x/vip/ads/materials?test=1",
    body: ipadVipAdsFixtureBody(),
    argument: notifyingArgument(),
  });
  const body = JSON.parse(result.response.body);

  assert.deepEqual(body.data.list, []);
  assert.deepEqual(body.data.list_v2, []);
  assert.equal(body.data.vip_login_coupon.login_layer, null);
  assert.equal(body.data.vip_login_coupon.exp.group, "sample");
  assert.equal(body.data.vip_login_coupon.report.event_id, "sample-report");
  assertNotification(result, "清理广告素材 3");
});

test("iPadOS 大会员广告：关闭共用的启动推广开关时完整保留素材", async () => {
  const original = JSON.parse(ipadVipAdsFixtureBody());
  const result = await runPlugin({
    url: "https://api.bilibili.com/x/vip/ads/materials?test=1",
    body: JSON.stringify(original),
    argument: notifyingArgument({ cleanStartupAds: false }),
  });
  const body = JSON.parse(result.response.body);

  assert.deepEqual(body, original);
  assertUnchangedResponse(result);
  assert.equal(result.notifications.length, 0);
});

test("iPadOS 大会员广告：无可清理素材时使用原样放行", async () => {
  const body = JSON.stringify({
    code: 0,
    data: {
      list: [],
      list_v2: [],
      vip_login_coupon: { login_layer: null },
    },
  });
  const result = await runPlugin({
    url: "https://api.bilibili.com/x/vip/ads/materials?test=1",
    body,
    argument: notifyingArgument(),
  });

  assert.equal(result.response.body, body);
  assertUnchangedResponse(result);
});
