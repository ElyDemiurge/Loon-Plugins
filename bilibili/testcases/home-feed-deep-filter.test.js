const {
  assert,
  TAG_CACHE_KEY,
  feedItems,
  manyFeedBody,
  nonPromotedAidsFromFixture,
  notifyingArgument,
  runPlugin,
  assertNotification,
  test,
} = require("./test_context");

/* -------------------------------------------------------------------------- */
/* 首页推荐页深度过滤                                                         */
/* -------------------------------------------------------------------------- */

test("首页推荐页：关闭推广视频清理开关时，带广告标记的视频推广卡片会保留", async () => {
  const result = await runPlugin({
    argument: notifyingArgument({ cleanFeedPromotedVideos: false }),
  });

  assert.equal(feedItems(result.response.body).length, 10);
  assertNotification(result, "保留 10 / 屏蔽 0 / 清理广告 0 / 清理推广 0");
});

test("首页推荐页：关闭清理时，标题关键词会同时屏蔽普通视频和推广视频", async () => {
  const result = await runPlugin({
    argument: notifyingArgument({
      titleKeywords: "目标词",
      cleanFeedAds: false,
      cleanFeedPromotedVideos: false,
    }),
  });
  const notification = assertNotification(result, "保留 8 / 屏蔽 2 / 清理广告 0 / 清理推广 0");

  assert.equal(feedItems(result.response.body).length, 8);
  assert.match(notification.message, /1、标题：目标词视频 A｜UP：占位账号A/);
  assert.match(notification.message, /2、标题：目标词推广视频｜UP：推广占位账号C/);
});

test("首页推荐页：开启清理时，推广视频先被清理，普通视频继续按标题屏蔽", async () => {
  const result = await runPlugin({
    argument: notifyingArgument({ titleKeywords: "目标词" }),
  });
  const notification = assertNotification(result, "保留 6 / 屏蔽 1 / 清理广告 0 / 清理推广 3");

  assert.equal(feedItems(result.response.body).length, 6);
  assert.match(notification.message, /屏蔽视频：\n1、标题：目标词视频 A｜UP：占位账号A/);
  assert.match(notification.message, /\n\n清理-首页推荐页推广视频：\n1、标题：推广视频 A/);
});

test("首页推荐页：深度 Tag 过滤会并发请求普通视频 Tag", async () => {
  const result = await runPlugin({
    argument: notifyingArgument({
      deepFilter: true,
      videoTagKeywords: "并发测试",
    }),
    httpClientGet(request, callback) {
      setTimeout(() => {
        callback(null, { status: 200 }, JSON.stringify({
          code: 0,
          data: [{ tag_name: "并发测试" }],
        }));
      }, 180);
    },
  });

  assert.equal(result.httpCalls.length, 7);
  assert.equal(feedItems(result.response.body).length, 0);
  assert.ok(
    result.elapsedMs < 900,
    `expected concurrent tag requests to finish under 900ms, got ${result.elapsedMs}ms`
  );
  assertNotification(result, "保留 0 / 屏蔽 7 / 清理广告 0 / 清理推广 3");
});

test("首页推荐页：深度 Tag 远端请求并发上限为 24", async () => {
  let active = 0;
  let maxActive = 0;
  const result = await runPlugin({
    body: manyFeedBody(30),
    argument: notifyingArgument({
      deepFilter: true,
      videoTagKeywords: "并发上限",
    }),
    httpClientGet(request, callback) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      setTimeout(() => {
        active -= 1;
        callback(null, { status: 200 }, JSON.stringify({
          code: 0,
          data: [{ tag_name: "并发上限" }],
        }));
      }, 80);
    },
  });

  assert.equal(result.httpCalls.length, 30);
  assert.equal(maxActive, 24);
  assert.equal(feedItems(result.response.body).length, 0);
  assertNotification(result, "保留 0 / 屏蔽 30 / 清理广告 0 / 清理推广 0");
});

test("首页推荐页：批量获取 Tag 时只写入一次持久化缓存", async () => {
  let cacheValue = JSON.stringify({ items: {} });
  let cacheWrites = 0;
  const store = {};
  Object.defineProperty(store, TAG_CACHE_KEY, {
    enumerable: true,
    get() {
      return cacheValue;
    },
    set(value) {
      cacheWrites += 1;
      cacheValue = value;
    },
  });

  const result = await runPlugin({
    body: manyFeedBody(30),
    argument: notifyingArgument({
      deepFilter: true,
      videoTagKeywords: "批量缓存",
    }),
    store,
    httpClientGet(_request, callback) {
      callback(null, { status: 200 }, JSON.stringify({
        code: 0,
        data: [{ tag_name: "普通标签" }],
      }));
    },
  });

  assert.equal(result.httpCalls.length, 30);
  assert.equal(cacheWrites, 1);
  assert.equal(Object.keys(JSON.parse(cacheValue).items).length, 30);
});

test("首页推荐页：深度 Tag 过滤按正则匹配视频 Tag", async () => {
  const result = await runPlugin({
    argument: notifyingArgument({
      deepFilter: true,
      videoTagKeywords: "测试Tag\\d+",
    }),
    httpClientGet(request, callback) {
      callback(null, { status: 200 }, JSON.stringify({
        code: 0,
        data: [{ tag_name: "测试Tag1234" }],
      }));
    },
  });

  assert.equal(result.httpCalls.length, 7);
  assert.equal(feedItems(result.response.body).length, 0);
  assertNotification(result, "保留 0 / 屏蔽 7 / 清理广告 0 / 清理推广 3");
});

test("首页推荐页：Tag 缓存命中时不再请求远端 Tag 接口", async () => {
  const cache = {
    items: Object.fromEntries(nonPromotedAidsFromFixture().map((aid) => [
      aid,
      {
        tags: ["缓存命中"],
        title: "",
        updatedAt: Date.now(),
      },
    ])),
  };
  const result = await runPlugin({
    argument: notifyingArgument({
      deepFilter: true,
      videoTagKeywords: "缓存命中",
    }),
    store: {
      [TAG_CACHE_KEY]: JSON.stringify(cache),
    },
  });

  assert.equal(result.httpCalls.length, 0);
  assert.equal(feedItems(result.response.body).length, 0);
  assertNotification(result, "保留 0 / 屏蔽 7 / 清理广告 0 / 清理推广 3");
});
