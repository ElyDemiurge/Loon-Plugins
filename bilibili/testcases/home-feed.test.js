const {
  assert,
  feedItems,
  notifyingArgument,
  runPlugin,
  assertNotification,
  test,
} = require("./test_context");

/* -------------------------------------------------------------------------- */
/* 首页推荐页                                                               */
/* -------------------------------------------------------------------------- */

test("首页推荐页：开启两个清理开关时，推广视频单独计入清理-首页推荐页推广视频", async () => {
  const result = await runPlugin();
  const items = feedItems(result.response.body);
  const notification = assertNotification(result, "保留 7 / 屏蔽 0 / 清理广告 0 / 清理推广 3");
  assert.equal(items.length, 7);
  assert.doesNotMatch(notification.message, /：无/);
  assert.match(notification.message, /清理-首页推荐页推广视频：\n1、标题：推广视频 A/);
  assert.match(notification.message, /2、标题：推广视频 B｜UP：横幅广告 A/);
  assert.match(notification.message, /3、标题：目标词推广视频｜UP：推广占位账号C/);
});

test("首页推荐页：响应缺少 items 时原样返回", async () => {
  const original = JSON.stringify({ code: -1, message: "upstream unavailable" });
  const result = await runPlugin({
    body: original,
    argument: notifyingArgument(),
  });

  assert.equal(result.response.body, original);
  assert.equal(result.notifications.length, 0);
});

test("首页推荐页通知：只有屏蔽命中时不会借用移除通知开关", async () => {
  const result = await runPlugin({
    argument: notifyingArgument({
      titleKeywords: "目标词",
      cleanFeedAds: false,
      cleanFeedPromotedVideos: false,
      notifyRemove: true,
      notifyFilter: false,
    }),
  });

  assert.equal(feedItems(result.response.body).length, 8);
  assert.equal(result.notifications.length, 0);
});

test("首页推荐页通知：只有清理命中时不会借用屏蔽通知开关", async () => {
  const result = await runPlugin({
    argument: notifyingArgument({
      notifyRemove: false,
      notifyFilter: true,
    }),
  });

  assert.equal(feedItems(result.response.body).length, 7);
  assert.equal(result.notifications.length, 0);
});

test("首页推荐页通知：同时命中时只展示已开启类别的结果", async () => {
  const result = await runPlugin({
    argument: notifyingArgument({
      titleKeywords: "目标词",
      notifyRemove: true,
      notifyFilter: false,
    }),
  });
  const notification = assertNotification(result, "保留 6 / 屏蔽 0 / 清理广告 0 / 清理推广 3");

  assert.equal(notification.title, "Bilibili 首页推荐页清理");
  assert.doesNotMatch(notification.message, /屏蔽视频/);
  assert.match(notification.message, /清理-首页推荐页推广视频/);
});
