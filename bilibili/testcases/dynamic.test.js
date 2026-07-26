const {
  assert,
  notifyingArgument,
  runPlugin,
  assertNotification,
  grpcMessageBytes,
  dynamicAllKeywordFixtureBody,
  dynamicAllFixtureBody,
  test,
} = require("./test_context");

/* -------------------------------------------------------------------------- */
/* Dynamic page                                                               */
/* -------------------------------------------------------------------------- */

test("动态页：移除 UP 主推荐商品模块但保留动态本身", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.app.dynamic.v2.Dynamic/DynAll",
    bodyBytes: dynamicAllFixtureBody(),
    argument: notifyingArgument({ cleanDynamicUpRecommendations: "移除推荐模块", logLevel: "info" }),
  });
  const notification = assertNotification(result, "保留 2 / 移除推荐模块 1");
  const text = grpcMessageBytes(result.response.bodyBytes).toString("utf8");
  const logText = result.logs.join("\n");

  assert.match(text, /普通动态内容 A/);
  assert.match(text, /普通动态正文/);
  assert.match(text, /普通扩展信息/);
  assert.doesNotMatch(text, /样例商品500g/);
  assert.doesNotMatch(text, /UP主的推荐/);
  assert.doesNotMatch(text, /is_ad_loc/);
  assert.doesNotMatch(text, /example-shop:\/\/example\.test/);
  assert.match(notification.message, /移除-动态页 UP 主的推荐：\n1、标题：样例商品500g/);
  assert.match(logText, /"title":"样例商品500g"/);
});

test("动态页：移除 UP 主推荐所在的整条动态", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.app.dynamic.v2.Dynamic/DynAll",
    bodyBytes: dynamicAllFixtureBody(),
    argument: notifyingArgument(),
  });
  const notification = assertNotification(result, "保留 1 / 移除推荐动态 1");
  const text = grpcMessageBytes(result.response.bodyBytes).toString("utf8");

  assert.match(text, /普通动态内容 A/);
  assert.doesNotMatch(text, /普通动态正文/);
  assert.doesNotMatch(text, /普通扩展信息/);
  assert.doesNotMatch(text, /样例商品500g/);
  assert.doesNotMatch(text, /UP主的推荐/);
  assert.match(notification.message, /移除-动态页 UP 主的推荐：\n1、标题：样例商品500g/);
});

test("动态页：关闭开关时保留 UP 主推荐商品模块", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.app.dynamic.v2.Dynamic/DynAll",
    bodyBytes: dynamicAllFixtureBody(),
    argument: notifyingArgument({ cleanDynamicUpRecommendations: false }),
  });
  const text = grpcMessageBytes(result.response.bodyBytes).toString("utf8");

  assert.match(text, /样例商品500g/);
  assert.match(text, /UP主的推荐/);
  assertNotification(result, "已关闭");
});

test("动态页：动态内容关键词会屏蔽整条动态", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.app.dynamic.v2.Dynamic/DynAll",
    bodyBytes: dynamicAllKeywordFixtureBody(),
    argument: notifyingArgument({
      cleanDynamicUpRecommendations: false,
      dynamicKeywords: "动态屏蔽词",
      logLevel: "info",
    }),
  });
  const notification = assertNotification(result, "保留 1 / 屏蔽动态 1");
  const text = grpcMessageBytes(result.response.bodyBytes).toString("utf8");
  const logText = result.logs.join("\n");

  assert.match(text, /普通动态内容 A/);
  assert.doesNotMatch(text, /动态屏蔽词内容 B/);
  assert.match(notification.message, /屏蔽-关注页动态：\n1、标题：动态屏蔽词内容 B｜UP：动态占位账号｜规则：屏蔽-关注页动态（关键词）/);
  assert.match(logText, /"title":"动态屏蔽词内容 B"/);
  assert.match(logText, /"up":"动态占位账号"/);
  assert.match(logText, /屏蔽-关注页动态（关键词）/);
  assert.doesNotMatch(logText, /"title":"5小时前"/);
  assert.doesNotMatch(logText, /内容关键词/);
});
