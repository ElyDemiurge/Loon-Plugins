const {
  assert,
  notifyingArgument,
  runPlugin,
  assertNotification,
  test,
} = require("./test_context");

/* -------------------------------------------------------------------------- */
/* 直播电商 / 追踪参数 / 青少年模式 / 交互弹幕                               */
/* -------------------------------------------------------------------------- */

test("直播间：电商购物信息返回空响应", async () => {
  const result = await runPlugin({
    url: "https://api.live.bilibili.com/xlive/e-commerce-interface/v1/ecommerce-user/get_shopping_info?test=1",
    body: JSON.stringify({ code: 0, data: { items: [{ title: "商品A" }] } }),
    argument: notifyingArgument(),
  });
  assert.equal(JSON.parse(result.response.body).code, -1);
  assertNotification(result, "清理直播电商购物信息");
});

test("pd-proxy/tracker：改写 STUN 服务器为失效地址", async () => {
  const body = JSON.stringify({ code: 0, data: { stuns: ["1.2.3.4:3478", "5.6.7.8:3478"], trackers: ["a.example"], live_trackers: null } });
  const result = await runPlugin({
    url: "https://api.bilibili.com/x/pd-proxy/tracker?test=1",
    body,
    argument: notifyingArgument(),
  });
  const data = JSON.parse(result.response.body).data;
  assert.deepEqual(data.stuns, ["stun.chat.bilibili.com:3478", "stun.chat.bilibili.com:3478"]);
  assert.deepEqual(data.trackers, ["stun.chat.bilibili.com:3478"]);
  assert.equal(data.live_trackers, null);
  assertNotification(result, /改写追踪服务器 3/);
});

test("青少年模式：mock 为关闭态字节", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.app.interface.v1.Teenagers/ModeStatus",
    bodyBytes: Buffer.from([0x00, 0x00, 0x00, 0x00, 0x01, 0x0a]),
    argument: notifyingArgument(),
  });
  const out = Buffer.from(result.response.bodyBytes);
  assert.equal(out.length, 24);
  assert.equal(out[5], 0x0a);
});

test("交互式弹幕：mock 为空字节", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.app.viewunite.v1.View/PlayPause",
    bodyBytes: Buffer.from([0x00, 0x00, 0x00, 0x00, 0x02, 0x01, 0x02]),
    argument: notifyingArgument(),
  });
  assert.deepEqual([...Buffer.from(result.response.bodyBytes)], [0, 0, 0, 0, 0]);
});

test("开关关闭时：青少年模式与交互弹幕保留原响应", async () => {
  const original = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x02, 0xaa, 0xbb]);
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.app.interface.v1.Teenagers/ModeStatus",
    bodyBytes: original,
    argument: notifyingArgument({ cleanTeenagersMode: false }),
  });
  assert.deepEqual([...Buffer.from(result.response.bodyBytes)], [...original]);
});

test("路由：未知接口原样返回而不按首页热门解析", async () => {
  const original = JSON.stringify({ code: 0, data: { untouched: true } });
  const result = await runPlugin({
    url: "https://app.bilibili.com/x/unknown/endpoint?test=1",
    body: original,
    argument: notifyingArgument({ logLevel: "debug" }),
  });

  assert.equal(result.response.body, original);
  assert.equal(result.notifications.length, 0);
  assert.doesNotMatch(result.logs.join("\n"), /\[error\]/);
});
