const {
  assert,
  notifyingArgument,
  runPlugin,
  assertNotification,
  findNotification,
  startupTabFixtureBody,
  startupSkinFixtureBody,
  startupPeakDownloadFixtureBody,
  minePageFixtureBody,
  test,
} = require("./test_context");

test("软件启动时推广资源：移除启动活动 Tab 并保留普通 Tab", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/resource/show/tab/v2?test=1",
    body: startupTabFixtureBody(),
    argument: notifyingArgument(),
  });
  const body = JSON.parse(result.response.body);
  assert.equal(result.notifications.length, 2);
  const removeNotification = findNotification(result, "清理活动 Tab 1 / 清理游戏按钮 1");
  const personalizationNotification = findNotification(result, "清理顶部分区 3 / 清理底部按钮 2");

  assert.deepEqual(body.data.tab.map((item) => item.name), ["直播", "推荐", "热门"]);
  assert.deepEqual(body.data.top.map((item) => item.name), ["消息"]);
  assert.deepEqual(body.data.bottom.map((item) => item.name), ["首页", "动态", "我的"]);
  assert.match(removeNotification.message, /活动 Tab：活动入口 A/);
  assert.match(removeNotification.message, /游戏按钮：游戏中心/);
  assert.match(personalizationNotification.message, /顶部分区：足球季、动画、影视/);
  assert.match(personalizationNotification.message, /底部按钮：发布、会员购/);
});

test("软件启动时推广资源：移除启动皮肤装扮字段", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/resource/show/skin?test=1",
    body: startupSkinFixtureBody(),
    argument: notifyingArgument(),
  });
  const body = JSON.parse(result.response.body);

  assert.equal(Object.prototype.hasOwnProperty.call(body.data, "common_equip"), false);
  assert.equal(body.data.skin_colors.length, 1);
  assertNotification(result, "清理活动 Tab 0 / 清理皮肤 1 / 清理预加载资源 0");
});

test("软件启动时推广资源：清空启动预加载推广资源并保留普通资源", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/resource/peak/download?test=1",
    body: startupPeakDownloadFixtureBody(),
    argument: notifyingArgument(),
  });
  const body = JSON.parse(result.response.body);
  const resources = Object.fromEntries(body.data.resource.map((item) => [item.type, item]));
  const notification = assertNotification(result, "清理活动 Tab 0 / 清理皮肤 0 / 清理预加载资源 3");

  assert.deepEqual(resources.egg.list, []);
  assert.equal(resources.mod.list.length, 1);
  assert.deepEqual(resources.brand_splash.list, []);
  assert.match(notification.message, /预加载资源 egg：1 项/);
  assert.match(notification.message, /预加载资源 brand_splash：2 项/);
});

test("软件启动时推广资源：关闭开关时保留启动期资源", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/resource/peak/download?test=1",
    body: startupPeakDownloadFixtureBody(),
    argument: notifyingArgument({ cleanStartupAds: false }),
  });
  const body = JSON.parse(result.response.body);
  const resources = Object.fromEntries(body.data.resource.map((item) => [item.type, item]));

  assert.equal(resources.egg.list.length, 1);
  assert.equal(resources.mod.list.length, 1);
  assert.equal(resources.brand_splash.list.length, 2);
  assertNotification(result, "已关闭");
});

test("首页入口：游戏按钮、顶部分区和底部按钮清理独立于启动推广开关", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/resource/show/tab/v2?test=1",
    body: startupTabFixtureBody(),
    argument: notifyingArgument({ cleanStartupAds: false, notifyRemove: false }),
  });
  const body = JSON.parse(result.response.body);
  const notification = assertNotification(result, "清理顶部分区 4 / 清理底部按钮 2");

  assert.deepEqual(body.data.tab.map((item) => item.name), ["直播", "推荐", "热门"]);
  assert.deepEqual(body.data.top.map((item) => item.name), ["消息"]);
  assert.deepEqual(body.data.bottom.map((item) => item.name), ["首页", "动态", "我的"]);
  assert.match(notification.message, /顶部分区：足球季、动画、影视、活动入口 A/);
  assert.match(notification.message, /底部按钮：发布、会员购/);
});

test("移除：首页右上角游戏按钮开关关闭时保留游戏中心和消息按钮", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/resource/show/tab/v2?test=1",
    body: startupTabFixtureBody(),
    argument: notifyingArgument({ cleanHomeGameButton: false }),
  });
  const body = JSON.parse(result.response.body);

  assert.deepEqual(body.data.top.map((item) => item.name), ["游戏中心", "消息"]);
  assert.deepEqual(body.data.tab.map((item) => item.name), ["直播", "推荐", "热门"]);
  findNotification(result, "清理活动 Tab 1 / 游戏按钮清理已关闭");
});

test("个性化：首页顶部分区精简关闭时保留足球季、动画和影视", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/resource/show/tab/v2?test=1",
    body: startupTabFixtureBody(),
    argument: notifyingArgument({ cleanHomeTopTabs: false }),
  });
  const body = JSON.parse(result.response.body);

  assert.deepEqual(body.data.tab.map((item) => item.name), ["直播", "推荐", "足球季", "热门", "动画", "影视"]);
  assert.deepEqual(body.data.top.map((item) => item.name), ["消息"]);
  findNotification(result, "顶部分区精简已关闭 / 清理底部按钮 2");
});

test("个性化：关闭底部多余按钮删除时保留加号和会员购", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/resource/show/tab/v2?test=1",
    body: startupTabFixtureBody(),
    argument: notifyingArgument({ cleanStartupAds: false, cleanBottomExtraButtons: false, notifyRemove: false }),
  });
  const body = JSON.parse(result.response.body);

  assert.deepEqual(body.data.tab.map((item) => item.name), ["直播", "推荐", "热门"]);
  assert.deepEqual(body.data.top.map((item) => item.name), ["消息"]);
  assert.deepEqual(body.data.bottom.map((item) => item.name), ["首页", "动态", "发布", "会员购", "我的"]);
  assertNotification(result, "清理顶部分区 4 / 底部按钮清理已关闭");
});

test("个性化：关闭个性化弹窗不影响底部多余按钮删除", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/resource/show/tab/v2?test=1",
    body: startupTabFixtureBody(),
    argument: notifyingArgument({
      cleanStartupAds: false,
      notifyRemove: false,
      notifyPersonalization: false,
    }),
  });
  const body = JSON.parse(result.response.body);

  assert.deepEqual(body.data.bottom.map((item) => item.name), ["首页", "动态", "我的"]);
  assert.equal(result.notifications.length, 0);
});

test("个性化：默认删除我的页面里的创作中心和我的服务", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/v2/account/mine?test=1",
    body: minePageFixtureBody(),
    argument: notifyingArgument({ notifyRemove: false, notifyFilter: false }),
  });
  const body = JSON.parse(result.response.body);
  const notification = assertNotification(result, "清理创作中心 1 / 清理我的服务 1");

  assert.deepEqual(body.data.sections_v2.map((item) => item.title), ["常用功能", "更多服务"]);
  assert.equal(body.data.name, "占位用户");
  assert.equal(body.data.rework_v1.worst_creative.button_text, "发布");
  assert.doesNotMatch(result.response.body, /"title":"创作中心"|"title":"我的服务"/);
  assert.match(notification.message, /创作中心：4 个入口/);
  assert.match(notification.message, /我的服务：3 个入口/);
});

test("个性化：关闭我的页面单项开关时保留对应模块", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/v2/account/mine?test=1",
    body: minePageFixtureBody(),
    argument: notifyingArgument({
      cleanMineCreationCenter: false,
      notifyRemove: false,
      notifyFilter: false,
    }),
  });
  const body = JSON.parse(result.response.body);

  assert.deepEqual(body.data.sections_v2.map((item) => item.title), ["常用功能", "创作中心", "更多服务"]);
  assert.match(result.response.body, /"title":"创作中心"/);
  assert.doesNotMatch(result.response.body, /"title":"我的服务"/);
  assertNotification(result, "清理创作中心 0 / 清理我的服务 1");
});

test("个性化：关闭个性化弹窗不影响我的页面模块删除", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/v2/account/mine?test=1",
    body: minePageFixtureBody(),
    argument: notifyingArgument({
      notifyRemove: false,
      notifyFilter: false,
      notifyPersonalization: false,
    }),
  });
  const body = JSON.parse(result.response.body);

  assert.deepEqual(body.data.sections_v2.map((item) => item.title), ["常用功能", "更多服务"]);
  assert.equal(result.notifications.length, 0);
});
