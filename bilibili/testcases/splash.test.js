const {
  assert,
  notifyingArgument,
  runPlugin,
  assertNotification,
  splashShowFixtureBody,
  splashListFixtureBody,
  splashBrandListFixtureBody,
  splashShowFullFixtureBody,
  splashListFullFixtureBody,
  splashEventFullFixtureBody,
  splashBrandFullFixtureBody,
  test,
} = require("./test_context");

/* -------------------------------------------------------------------------- */
/* 开屏广告                                                                   */
/* -------------------------------------------------------------------------- */

test("开屏广告：show 入口会清空展示列表", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/v2/splash/show?test=1",
    body: splashShowFixtureBody(),
    argument: notifyingArgument(),
  });
  const body = JSON.parse(result.response.body);
  const notification = assertNotification(result, "清理展示 1 / 清理素材 0");

  assert.deepEqual(body.data.show, []);
  assert.equal(body.data.splash_request_id, "request-1");
  assert.equal(notification.title, "Bilibili 开屏广告清理");
  assert.match(notification.message, /移除-开屏广告：\n1、id 100001：开屏广告/);
  assert.doesNotMatch(notification.message, /展示|素材|时段|keep_ids|->/);
});

test("开屏广告：list 入口返回 OK 以阻断创意缓存刷新", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/v2/splash/list?test=1",
    body: splashListFixtureBody(),
    argument: notifyingArgument({ logLevel: "info" }),
  });
  const notification = assertNotification(result, "清理展示 1 / 清理素材 1");
  const logText = result.logs.join("\n");

  assert.equal(result.response.body, "OK");
  assert.match(notification.message, /1、id 100001：开屏广告/);
  assert.match(notification.message, /2、id 100001：开屏广告/);
  assert.doesNotMatch(notification.message, /展示|素材|时段|keep_ids|->/);
  assert.doesNotMatch(notification.message, /uri：|universal_app：|ad_cb：|ads\.example\.test/);
  assert.match(logText, /"target":"com\.example\.splashapp"/);
  assert.match(logText, /ads\.example\.test/);
});

test("开屏广告：list 入口在上游返回非 JSON 时仍返回 OK", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/v2/splash/list?test=1",
    body: "upstream response is unavailable",
    argument: notifyingArgument(),
  });

  assert.equal(result.response.body, "OK");
  assertNotification(result, "清理展示 0 / 清理素材 0");
});

test("开屏广告：show 多字段响应会清空展示列表", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/v2/splash/show?test=1",
    body: splashShowFullFixtureBody(),
    argument: notifyingArgument(),
  });
  const body = JSON.parse(result.response.body);

  assert.deepEqual(body.data.show, []);
  assert.equal(body.data.splash_request_id, "sample-request-id");
  assertNotification(result, "清理展示 2 / 清理素材 0");
});

test("开屏广告：list 多字段响应返回 OK", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/v2/splash/list?test=1",
    body: splashListFullFixtureBody(),
    argument: notifyingArgument(),
  });

  assert.equal(result.response.body, "OK");
  assertNotification(result, "清理展示 1 / 清理素材 1");
});

test("开屏广告：event 多字段响应只清空活动开屏", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/v2/splash/event/list2?test=1",
    body: splashEventFullFixtureBody(),
    argument: notifyingArgument(),
  });
  const body = JSON.parse(result.response.body);

  assert.deepEqual(body.data.event_list, []);
  assert.equal(body.data.account.uname, "占位用户");
  assertNotification(result, "清理展示 0 / 清理素材 0 / 清理活动 1");
});

test("开屏广告：brand 多字段响应会清空品牌开屏", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/v2/splash/brand/list?test=1",
    body: splashBrandFullFixtureBody(),
    argument: notifyingArgument(),
  });
  const body = JSON.parse(result.response.body);

  assert.deepEqual(body.data.list, []);
  assert.deepEqual(body.data.preload, []);
  assert.deepEqual(body.data.query_list, []);
  assert.equal(body.data.pull_interval, 0);
  assert.equal(body.data.has_new_splash_set, false);
  assert.equal(body.data.new_splash_hash, "");
  assert.equal(body.data.show_hash, "");
  assert.equal(body.data.force_show_times, 0);
  assert.equal(body.data.forcibly, false);
  assertNotification(result, "清理展示 0 / 清理素材 1");
});

test("开屏广告：brand list 入口会清空品牌开屏素材和强制展示字段", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/v2/splash/brand/list?test=1",
    body: splashBrandListFixtureBody(),
    argument: notifyingArgument(),
  });
  const body = JSON.parse(result.response.body);
  const notification = assertNotification(result, "清理展示 0 / 清理素材 2");

  assert.deepEqual(body.data.list, []);
  assert.deepEqual(body.data.preload, []);
  assert.deepEqual(body.data.query_list, []);
  assert.equal(body.data.has_new_splash_set, false);
  assert.equal(body.data.new_splash_hash, "");
  assert.equal(body.data.show_hash, "");
  assert.equal(body.data.force_show_times, 0);
  assert.equal(body.data.forcibly, false);
  assert.match(notification.message, /1、id 200001：品牌开屏 A/);
});

test("开屏广告：关闭开关时保留原响应", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/v2/splash/list?test=1",
    body: splashListFixtureBody(),
    argument: notifyingArgument({ cleanSplashAds: false }),
  });
  const body = JSON.parse(result.response.body);

  assert.equal(body.data.show.length, 1);
  assert.equal(body.data.list.length, 1);
  assert.deepEqual(body.data.keep_ids, [100001]);
  assertNotification(result, "已关闭");
});

test("弹窗开关：关闭移除弹窗不影响开屏广告清理", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/v2/splash/show?test=1",
    body: splashShowFixtureBody(),
    argument: notifyingArgument({ notifyRemove: false }),
  });
  const body = JSON.parse(result.response.body);

  assert.deepEqual(body.data.show, []);
  assert.equal(result.notifications.length, 0);
});

test("弹窗开关：未传通知参数时默认不弹窗", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/v2/splash/show?test=1",
    body: splashShowFixtureBody(),
    argument: { logLevel: "off" },
  });
  const body = JSON.parse(result.response.body);

  assert.deepEqual(body.data.show, []);
  assert.equal(result.notifications.length, 0);
});

test("弹窗日志：弹窗触发时会同步写入脚本日志", async () => {
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/v2/splash/show?test=1",
    body: splashShowFixtureBody(),
    argument: notifyingArgument({ logLevel: "off" }),
  });
  const notification = assertNotification(result, "清理展示 1 / 清理素材 0");
  const logText = result.logs.join("\n");

  assert.equal(result.logs.length, 1);
  assert.match(logText, /\[BilibiliFilter\]\[notify\] Bilibili 开屏广告清理/);
  assert.match(logText, new RegExp(notification.subtitle));
  assert.match(logText, /移除-开屏广告：\n1、id 100001：开屏广告/);
});
