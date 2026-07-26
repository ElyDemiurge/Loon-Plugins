const {
  assert,
  notifyingArgument,
  runPlugin,
  assertNotification,
  grpcMessageBytes,
  stringField,
  messageField,
  varintField,
  encodeGrpc,
  normalDynamicItem,
  test,
} = require("./test_context");

/* -------------------------------------------------------------------------- */
/* Replies, live rooms, and frequent dynamic creators                         */
/* -------------------------------------------------------------------------- */

function replyMainListFixtureBody() {
  return encodeGrpc(Buffer.concat([
    messageField(5, [
      messageField(1, [
        varintField(1, 9001),
        stringField(2, "ad_cb=sample-ad-cb"),
        stringField(3, "置顶广告内容示例"),
      ]),
      messageField(1, [
        varintField(1, 9002),
        stringField(3, "普通评论内容示例"),
      ]),
    ]),
  ]));
}

test("评论区：移除置顶广告回复并保留普通回复", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.main.community.reply.v1.Reply/MainList",
    bodyBytes: replyMainListFixtureBody(),
    argument: notifyingArgument(),
  });
  const notification = assertNotification(result, "移除 1");
  const text = grpcMessageBytes(result.response.bodyBytes).toString("utf8");

  assert.doesNotMatch(text, /置顶广告内容示例/);
  assert.doesNotMatch(text, /ad_cb=sample-ad-cb/);
  assert.match(text, /普通评论内容示例/);
  assert.match(notification.message, /移除-评论区置顶广告/);
});

test("直播间：信息流移除广告卡片并保留普通卡片", async () => {
  const body = JSON.stringify({
    code: 0,
    data: {
      card_list: [
        { card_type: "banner_card", title: "直播横幅广告" },
        { card_type: "small_card_v1", is_ad: 1, title: "直播推广卡片" },
        { card_type: "small_card_v1", title: "普通直播卡片" },
      ],
    },
  });
  const result = await runPlugin({
    url: "https://api.live.bilibili.com/xlive/app-interface/v2/index/feed?test=1",
    body,
    argument: notifyingArgument(),
  });
  const notification = assertNotification(result, "清理信息流广告 2");
  const cards = JSON.parse(result.response.body).data.card_list;

  assert.equal(cards.length, 1);
  assert.equal(cards[0].title, "普通直播卡片");
  assert.match(notification.message, /信息流广告：banner_card/);
});

test("直播间：房间页删除 banner_info 等广告字段", async () => {
  const body = JSON.stringify({
    code: 0,
    data: {
      room_id: 12345,
      banner_info: { title: "房间横幅广告" },
      activity_banner_info: { title: "活动横幅广告" },
      shopping_card_info: { title: "购物卡片" },
    },
  });
  const result = await runPlugin({
    url: "https://api.live.bilibili.com/xlive/app-room/v1/index/getInfoByRoom?test=1",
    body,
    argument: notifyingArgument(),
  });
  const notification = assertNotification(result, "清理房间广告字段 3");
  const data = JSON.parse(result.response.body).data;

  assert.equal(data.room_id, 12345);
  assert.equal(data.banner_info, undefined);
  assert.equal(data.activity_banner_info, undefined);
  assert.equal(data.shopping_card_info, undefined);
  assert.match(notification.message, /房间广告字段：banner_info/);
});

function dynamicAllWithUpListBody() {
  const upList = messageField(5, [
    messageField(1, [varintField(1, 2001), stringField(2, "占位账号甲")]),
    messageField(1, [varintField(1, 2002), stringField(2, "占位账号乙")]),
    messageField(1, [varintField(1, 2003), stringField(2, "占位账号丙")]),
  ]);
  const dynList = messageField(1, [
    messageField(1, [normalDynamicItem("普通动态内容 A")]),
  ]);
  return encodeGrpc(Buffer.concat([upList, dynList]));
}

test("动态最常访问：hide 模式移除最常访问区段", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.app.dynamic.v2.Dynamic/DynAll",
    bodyBytes: dynamicAllWithUpListBody(),
    argument: notifyingArgument({ cleanDynamicUpRecommendations: "关闭", dynamicUpListDisplay: "hide" }),
  });
  const notification = assertNotification(result, /隐藏最常访问 1/);
  const text = grpcMessageBytes(result.response.bodyBytes).toString("utf8");

  assert.doesNotMatch(text, /占位账号甲/);
  assert.match(text, /普通动态内容 A/);
  assert.match(notification.subtitle, /保留 1/);
});

test("动态最常访问：show 模式保留最常访问区段", async () => {
  const result = await runPlugin({
    url: "https://grpc.biliapi.net/bilibili.app.dynamic.v2.Dynamic/DynAll",
    bodyBytes: dynamicAllWithUpListBody(),
    argument: notifyingArgument({ cleanDynamicUpRecommendations: "移除推荐模块", dynamicUpListDisplay: "show" }),
  });
  const notification = assertNotification(result, /保留 1/);
  const text = grpcMessageBytes(result.response.bodyBytes).toString("utf8");

  assert.match(text, /占位账号甲/);
  assert.match(text, /普通动态内容 A/);
  assert.doesNotMatch(notification.subtitle, /隐藏最常访问/);
});

test("动态最常访问：中文 select 值正确映射到显示模式", async () => {
  const cases = [["始终显示", "show"], ["仅存在直播时显示", "auto"], ["始终隐藏", "hide"]];
  for (const [value, mode] of cases) {
    const result = await runPlugin({
      url: "https://grpc.biliapi.net/bilibili.app.dynamic.v2.Dynamic/DynAll",
      bodyBytes: dynamicAllWithUpListBody(),
      argument: notifyingArgument({ cleanDynamicUpRecommendations: "移除推荐模块", dynamicUpListDisplay: value, logLevel: "info" }),
    });
    assert.match(result.logs.join("\n"), new RegExp(`"upListMode":"${mode}"`), `值 ${value} 应映射为 ${mode}`);
  }
});
