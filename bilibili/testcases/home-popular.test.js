const {
  assert,
  notifyingArgument,
  runPlugin,
  assertNotification,
  countTopLevelGrpcFields,
  homePopularFixtureBody,
  test,
} = require("./test_context");

/* -------------------------------------------------------------------------- */
/* Popular page                                                               */
/* -------------------------------------------------------------------------- */

test("首页热门：未配置屏蔽规则时跳过 protobuf 解析并原样返回", async () => {
  const original = new Uint8Array([1, 2, 3]);
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.app.show.v1.Popular/Index",
    bodyBytes: original,
    argument: notifyingArgument(),
  });

  assert.deepEqual(Array.from(result.response.bodyBytes), [1, 2, 3]);
  assertNotification(result, "未配置屏蔽规则");
});

test("首页热门：视频标题关键词按包含规则屏蔽", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.app.show.v1.Popular/Index",
    bodyBytes: homePopularFixtureBody(),
    argument: notifyingArgument({ titleKeywords: "目标词" }),
  });
  const notification = assertNotification(result, "保留 2 / 屏蔽 1");

  assert.match(notification.message, /屏蔽视频：\n1、标题：首页热门目标词视频/);
  assert.match(notification.message, /UP：占位账号B/);
  assert.equal(countTopLevelGrpcFields(result.response.bodyBytes, 1), 2);
});

test("弹窗开关：关闭屏蔽弹窗不影响首页热门关键词屏蔽", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.app.show.v1.Popular/Index",
    bodyBytes: homePopularFixtureBody(),
    argument: notifyingArgument({ titleKeywords: "目标词", notifyFilter: false }),
  });

  assert.equal(result.notifications.length, 0);
  assert.equal(countTopLevelGrpcFields(result.response.bodyBytes, 1), 2);
});

test("首页热门：屏蔽-UP 主（名称）按完全匹配规则命中", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.app.show.v1.Popular/Index",
    bodyBytes: homePopularFixtureBody(),
    argument: notifyingArgument({ blockedUps: "占位账号C" }),
  });
  const notification = assertNotification(result, "保留 2 / 屏蔽 1");

  assert.match(notification.message, /屏蔽视频：\n1、标题：首页热门UP屏蔽视频｜UP：占位账号C/);
  assert.equal(countTopLevelGrpcFields(result.response.bodyBytes, 1), 2);
});
