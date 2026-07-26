const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Resolve the project root and primary script path.
const ROOT = path.resolve(__dirname, "..");
const SCRIPT_PATH = path.join(ROOT, "bilibili_cleaner.js");
const LPX_PATH = path.join(ROOT, "bilibili_cleaner.lpx");
const LAN_LPX_PATH = path.join(ROOT, "bilibili_cleaner.lan.lpx");

// Persistent-store key shared with the primary script.
const TAG_CACHE_KEY = "BilibiliFilter.tagCache.v1";

// Primary script source under test.
const source = fs.readFileSync(SCRIPT_PATH, "utf8");

/* -------------------------------------------------------------------------- */
/* Test fixtures and helpers                                                  */
/* -------------------------------------------------------------------------- */

function parseFeedBody(body) {
  return JSON.parse(body);
}

function feedItems(body) {
  return parseFeedBody(body).data.items;
}

function itemAid(item) {
  return String(item.args?.aid || item.player_args?.aid || item.param || "");
}

function feedVideo(aid, title, up) {
  return {
    card_goto: "av",
    card_type: "small_cover_v2",
    title,
    args: { aid, up_name: up },
    player_args: { aid, title },
  };
}

function feedPromotedVideo(aid, title, up) {
  return {
    ...feedVideo(aid, title, up),
    card_type: "cm_v2",
    ad_info: {
      creative_content: { video_id: aid, title },
      extra: { card: { adver_name: up } },
    },
  };
}

function feedFixture() {
  return {
    code: 0,
    data: {
      items: [
        feedVideo("1001", "普通视频 A", "UP-A"),
        feedVideo("1002", "目标词视频 A", "占位账号A"),
        feedVideo("1003", "普通视频 B", "UP-B"),
        feedVideo("1004", "普通视频 C", "UP-C"),
        feedVideo("1005", "普通视频 D", "UP-D"),
        feedVideo("1006", "普通视频 E", "UP-E"),
        feedVideo("1007", "普通视频 F", "UP-F"),
        feedPromotedVideo("2001", "推广视频 A", "推广占位账号A"),
        feedPromotedVideo("2002", "推广视频 B", "横幅广告 A"),
        feedPromotedVideo("2003", "目标词推广视频", "推广占位账号C"),
      ],
    },
  };
}

function feedFixtureBody() {
  return JSON.stringify(feedFixture());
}

function manyFeedBody(count) {
  return JSON.stringify({
    code: 0,
    data: {
      items: Array.from({ length: count }, (_, index) =>
        feedVideo(String(3000 + index), `并发视频 ${index + 1}`, `并发占位账号-${index + 1}`)
      ),
    },
  });
}

function nonPromotedAidsFromFixture() {
  return feedFixture().data.items
    .filter((item) => !item.ad_info)
    .map(itemAid)
    .filter(Boolean);
}

function baseArgument(overrides = {}) {
  return {
    blockedUps: "",
    titleKeywords: "",
    videoTagKeywords: "",
    dynamicKeywords: "",
    searchResultKeywords: "",
    deepFilter: false,
    cleanFeedAds: true,
    cleanFeedPromotedVideos: true,
    cleanVideoRelatedPromotedContent: true,
    cleanVideoRelatedAds: true,
    cleanVideoBannerAds: true,
    cleanVideoRelatedLiveRecommendations: true,
    cleanVideoUpGoodsAds: true,
    cleanSplashAds: true,
    cleanStartupAds: true,
    cleanSearchTrending: true,
    cleanSearchHistory: true,
    cleanSearchDiscovery: true,
    cleanSearchDefaultWords: true,
    cleanSearchResultAds: true,
    cleanSearchResultCreatorPromotions: true,
    cleanSearchResultLiveRooms: true,
    cleanSearchResultAggregationCards: true,
    cleanHomeGameButton: true,
    cleanHomeTopTabs: true,
    cleanBottomExtraButtons: true,
    cleanMineCreationCenter: true,
    cleanMineServices: true,
    cleanReplyTopAds: true,
    cleanLiveAds: true,
    blockTrackers: true,
    cleanTeenagersMode: true,
    cleanInteractiveDanmaku: true,
    cleanDynamicUpRecommendations: "移除推荐动态",
    dynamicUpListDisplay: "show",
    notifyRemove: false,
    notifyFilter: false,
    notifyPersonalization: false,
    logLevel: "off",
    ...overrides,
  };
}

function notifyingArgument(overrides = {}) {
  return baseArgument({
    notifyRemove: true,
    notifyFilter: true,
    notifyPersonalization: true,
    ...overrides,
  });
}

async function runPlugin({
  url = "https://app.bilibili.com/x/v2/feed/index?test=1",
  body,
  bodyBytes,
  omitResponseBody = false,
  requestOnly = false,
  argument = notifyingArgument(),
  store = {},
  httpClientGet,
} = {}) {
  // Capture script-side outputs for assertions.
  const notifications = [];
  const logs = [];
  const httpCalls = [];

  // Capture the final response returned by the script.
  let doneCalled = false;
  let doneResult;
  let donePatch;

  // Track the asynchronous lifecycle of the script under test.
  const donePromise = new Promise((resolve) => {
    const context = {
      console: {
        log: (...items) => logs.push(items.join(" ")),
      },
      require,
      Buffer,
      TextEncoder,
      TextDecoder,
      ArrayBuffer,
      Uint8Array,
      setTimeout,
      clearTimeout,
      $argument: argument,
      $request: {
        url,
      },
      $notification: {
        post(title, subtitle, message, attach) {
          notifications.push({ title, subtitle, message, attach });
        },
      },
      $persistentStore: {
        read(key) {
          return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
        },
        write(value, key) {
          store[key] = value;
          return true;
        },
      },
      $httpClient: {
        get(options, callback) {
          const request = typeof options === "string" ? { url: options } : options;
          httpCalls.push(request.url);
          if (!httpClientGet) {
            callback(new Error(`unexpected http call: ${request.url}`));
            return;
          }
          httpClientGet(request, callback);
        },
      },
      $done(result) {
        if (doneCalled) return;
        doneCalled = true;
        donePatch = result || {};
        if (requestOnly) {
          doneResult = result?.response ? result : { response: result?.response };
        } else {
          // Emulate Loon response patches: omitted fields preserve the original response.
          const responsePatch = result?.response || result || {};
          const response = { ...context.$response, ...responsePatch };
          // Keep bodyBytes as a test-only alias while exercising Loon's documented body field.
          if (ArrayBuffer.isView(response.body)) response.bodyBytes = response.body;
          doneResult = { response };
        }
        resolve(doneResult);
      },
    };
    if (!requestOnly) {
      context.$response = omitResponseBody
        ? {}
        : {
          body: bodyBytes === undefined
            ? (body === undefined ? feedFixtureBody() : body)
            : bodyBytes,
        };
    } else if (bodyBytes !== undefined) {
      context.$request.bodyBytes = bodyBytes;
    } else if (body !== undefined) {
      context.$request.body = body;
    }

    vm.runInNewContext(source, context, { filename: SCRIPT_PATH, timeout: 10000 });
  });

  // Prevent a stalled plugin from hanging the test suite.
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error("plugin did not call $done within timeout")), 5000);
  });

  // Record elapsed time so concurrency tests can verify parallel execution.
  const startedAt = Date.now();
  await Promise.race([donePromise, timeout]);

  return {
    result: doneResult,
    response: doneResult.response,
    notifications,
    logs,
    httpCalls,
    store,
    donePatch,
    elapsedMs: Date.now() - startedAt,
  };
}

function assertNotification(result, subtitle) {
  assert.equal(result.notifications.length, 1);
  if (subtitle instanceof RegExp) {
    assert.match(result.notifications[0].subtitle, subtitle);
  } else {
    assert.equal(result.notifications[0].subtitle, subtitle);
  }
  return result.notifications[0];
}

function assertUnchangedResponse(result) {
  assert.deepEqual(Object.keys(result.donePatch), []);
}

function assertBodyOnlyResponsePatch(result) {
  assert.deepEqual(Object.keys(result.donePatch), ["body"]);
}

function findNotification(result, subtitle) {
  const notification = result.notifications.find((item) => {
    if (subtitle instanceof RegExp) return subtitle.test(item.subtitle);
    return item.subtitle === subtitle;
  });
  assert.ok(notification, `notification not found: ${subtitle}`);
  return notification;
}

function readTestVarint(buffer, offset) {
  let value = 0;
  let shift = 0;
  let pos = offset;
  while (pos < buffer.length) {
    const byte = buffer[pos++];
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, offset: pos };
    shift += 7;
  }
  throw new Error("truncated test varint");
}

function grpcMessageBytes(bodyBytes) {
  const bytes = Buffer.from(bodyBytes);
  const length = bytes[1] * 2 ** 24 + (bytes[2] << 16) + (bytes[3] << 8) + bytes[4];
  const message = bytes.subarray(5, 5 + length);
  return bytes[0] === 1 ? require("zlib").gunzipSync(message) : message;
}

function countTopLevelGrpcFields(bodyBytes, no) {
  const buffer = grpcMessageBytes(bodyBytes);
  let offset = 0;
  let count = 0;
  while (offset < buffer.length) {
    const tag = readTestVarint(buffer, offset);
    offset = tag.offset;
    const fieldNo = Math.floor(tag.value / 8);
    const wireType = tag.value & 7;
    if (wireType === 2) {
      const length = readTestVarint(buffer, offset);
      offset = length.offset + length.value;
    } else if (wireType === 0) {
      offset = readTestVarint(buffer, offset).offset;
    } else if (wireType === 1) {
      offset += 8;
    } else if (wireType === 5) {
      offset += 4;
    } else {
      throw new Error(`unsupported test wire type ${wireType}`);
    }
    if (fieldNo === no) count += 1;
  }
  return count;
}

function encodeVarint(value) {
  const bytes = [];
  let next = Number(value);
  do {
    let byte = next & 0x7f;
    next = Math.floor(next / 128);
    if (next) byte |= 0x80;
    bytes.push(byte);
  } while (next);
  return Buffer.from(bytes);
}

function encodeField(no, wireType, value) {
  const tag = encodeVarint(no * 8 + wireType);
  if (wireType === 2) return Buffer.concat([tag, encodeVarint(value.length), Buffer.from(value)]);
  return Buffer.concat([tag, Buffer.from(value)]);
}

function stringField(no, value) {
  return encodeField(no, 2, Buffer.from(value));
}

function messageField(no, fields) {
  return encodeField(no, 2, Buffer.concat(fields));
}

function varintField(no, value) {
  return encodeField(no, 0, encodeVarint(value));
}

function encodeGrpc(payload) {
  const header = Buffer.alloc(5);
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

/* -------------------------------------------------------------------------- */
/* Protobuf and gRPC fixture generation                                       */
/* -------------------------------------------------------------------------- */

function homePopularCard({ title, up, aid }) {
  const base = Buffer.concat([
    stringField(2, `bilibili://video/${aid}`),
    stringField(6, title),
  ]);
  const smallCover = Buffer.concat([
    messageField(1, [base]),
    stringField(5, up),
  ]);
  return messageField(1, [smallCover]);
}

function homePopularFixtureBody() {
  return encodeGrpc(Buffer.concat([
    messageField(1, [homePopularCard({ aid: "3001", title: "首页热门普通视频", up: "普通占位账号" })]),
    messageField(1, [homePopularCard({ aid: "3002", title: "首页热门目标词视频", up: "占位账号B" })]),
    messageField(1, [homePopularCard({ aid: "3003", title: "首页热门UP屏蔽视频", up: "占位账号C" })]),
  ]));
}

function relatedItem(title, marker) {
  return Buffer.concat([
    stringField(1, title),
    stringField(2, marker),
  ]);
}

function promotedRelatedItem(title) {
  return relatedItem(
    title,
    `type.googleapis.com/bilibili.ad.v1.SourceContentDto title_encode=${encodeURIComponent(title)} image_material_id=1 推荐了`
  );
}

function adRelatedItem(title) {
  return relatedItem(title, "type.googleapis.com/bilibili.ad.v1.AdContentDto 我为什么会看到此广告 ad-complain");
}

function liveRelatedItem(title) {
  return relatedItem(title, "https://live.bilibili.com/12345 /bfs/live/new_room_cover/test.jpg 直播间 看直播");
}

function normalRelatedItem(title, up = "推荐流占位账号", aid = "9001") {
  return Buffer.concat([
    relatedItem(title, `bilibili://video/${aid}`),
    stringField(3, `UP主：${up}`),
  ]);
}

function bannerAdItem(title) {
  return relatedItem(title, "type.googleapis.com/bilibili.ad.v1.BannerAd 广告 ad-introduce");
}

function upGoodsItem(title) {
  return relatedItem(title, "好物广告 A UP主推荐好物 商品推广 去看看");
}

function tagTopicItem(tag) {
  return Buffer.concat([
    stringField(2, tag),
    stringField(3, `bilibili://search?keyword=${encodeURIComponent(tag)}`),
  ]);
}

function viewFixtureBody({ includeLive = true, includeUpGoods = true, includeTags = true } = {}) {
  const relatedFields = [
    messageField(1, [promotedRelatedItem("推广内容 A")]),
    messageField(1, [adRelatedItem("广告卡片 A")]),
    messageField(1, [normalRelatedItem("普通相关推荐 B A")]),
  ];
  if (includeLive) relatedFields.push(messageField(1, [liveRelatedItem("直播推荐 A")]));

  const fields = [
    messageField(1, [
      messageField(5, [
        messageField(6, [
          stringField(3, "样例详情页弹窗文案"),
        ]),
      ]),
    ]),
    messageField(2, [
      varintField(1, 4001),
      stringField(10, "样例详情页视频标题"),
    ]),
    messageField(22, relatedFields),
    messageField(7, [bannerAdItem("横幅广告 A")]),
  ];
  if (includeUpGoods) fields.push(messageField(46, [upGoodsItem("好物广告 A")]));
  if (includeTags) fields.push(messageField(90, [tagTopicItem("测试Tag")]));
  return encodeGrpc(Buffer.concat(fields));
}

function ipadLegacyRelatedItem({ aid, title, up, marker = "" }) {
  const fields = [
    varintField(1, aid),
    stringField(3, title),
    messageField(4, [stringField(2, up)]),
    stringField(9, `bilibili://video/${aid}`),
  ];
  if (marker) fields.push(stringField(50, marker));
  return fields;
}

function ipadLegacyViewFixtureBody() {
  return encodeGrpc(Buffer.concat([
    messageField(1, [
      varintField(1, 8001),
      stringField(3, "iPadOS 当前视频"),
    ]),
    messageField(5, [
      stringField(2, "iPad测试Tag"),
      stringField(7, "bilibili://search?keyword=iPad%E6%B5%8B%E8%AF%95Tag"),
    ]),
    messageField(10, ipadLegacyRelatedItem({
      aid: 8101,
      title: "iPadOS 普通相关推荐",
      up: "iPadOS 普通UP",
    })),
    messageField(10, ipadLegacyRelatedItem({
      aid: 8102,
      title: "iPadOS 广告相关推荐",
      up: "广告UP",
      marker: "type.googleapis.com/bilibili.ad.v1.AdContentDto 我为什么会看到此广告 ad-complain",
    })),
    messageField(10, ipadLegacyRelatedItem({
      aid: 8103,
      title: "iPadOS 直播相关推荐",
      up: "直播UP",
      marker: "bilibili://live/12345 /bfs/live/new_room_cover/ipad.jpg 直播间",
    })),
    messageField(41, [
      stringField(1, "type.googleapis.com/bilibili.ad.v1.SourceContentDto"),
      stringField(2, "iPadOS 独立广告素材"),
    ]),
  ]));
}

function relatesFeedFixtureBody() {
  return encodeGrpc(Buffer.concat([
    messageField(1, [adRelatedItem("广告卡片 B")]),
    messageField(1, [adRelatedItem("广告卡片 A")]),
    messageField(1, [liveRelatedItem("直播推荐 B")]),
    messageField(1, [normalRelatedItem("普通相关推荐 B")]),
  ]));
}

function videoFeedFixtureBody() {
  return JSON.stringify({
    code: 0,
    data: {
      items: [
        { card_goto: "ad_av", title: "信息流广告 A", ad_info: { creative_content: { title: "信息流广告 A" } } },
        { card_goto: "live", uri: "bilibili://live/12345", title: "正在直播", owner: { name: "直播占位账号" } },
        { card_goto: "av", uri: "bilibili://video/9101", title: "普通直播标题 A", owner: { name: "普通占位账号" }, args: { aid: "9101" } },
      ],
    },
  });
}

function ipadHomeFeedFixtureBody() {
  return JSON.stringify({
    code: 0,
    data: {
      items: [
        {
          card_type: "banner_ipad_v8",
          card_goto: "banner",
          title: "iPadOS Banner",
          banner_item: [{ id: 1 }],
        },
        {
          card_type: "large_cover_v1",
          card_goto: "av",
          title: "iPadOS 普通视频 A",
          args: { aid: "8201", up_name: "iPadOS UP-A" },
        },
        {
          card_type: "large_cover_v1",
          card_goto: "av",
          title: "iPadOS 普通视频 B",
          args: { aid: "8202", up_name: "iPadOS UP-B" },
        },
        {
          card_type: "cm_v1",
          card_goto: "ad_av",
          title: "iPadOS 推广视频",
          ad_info: {
            creative_content: { video_id: "8203", title: "iPadOS 推广视频" },
          },
        },
        {
          card_type: "cm_v1",
          card_goto: "ad_web_s",
          title: "iPadOS 网页广告",
          ad_info: {
            creative_content: { url: "https://ads.example.test/ipad" },
          },
        },
        {
          card_type: "small_cover_v9",
          card_goto: "live",
          title: "iPadOS 直播卡片",
          uri: "bilibili://live/8204",
        },
      ],
    },
  });
}

function splashShowFixtureBody() {
  return JSON.stringify({
    code: 0,
    message: "OK",
    data: {
      splash_request_id: "request-1",
      show: [
        { id: 100001, stime: 1778083200, etime: 1778169599, ad_cb: "sample-ad-cb" },
      ],
    },
  });
}

function splashListFixtureBody() {
  return JSON.stringify({
    code: 0,
    message: "OK",
    data: {
      max_time: 30,
      min_interval: 3600,
      pull_interval: 900,
      keep_ids: [100001],
      show: [
        { id: 100001, stime: 1778083200, etime: 1778169599, ad_cb: "sample-ad-cb" },
      ],
      list: [
        {
          id: 100001,
          uri: "https://ads.example.test/landing",
          schema_package_name: "com.example.splashapp",
          universal_app: "exampleapp://",
          is_ad: true,
        },
      ],
      preload: [
        { id: 100002, schema_title: "后台开屏 A", uri: "https://ads.example.test/preload" },
      ],
      query_list: [
        { id: 100003, schema_title: "候选开屏 A", uri: "https://ads.example.test/query" },
      ],
      ad_list: [
        { id: 100004, schema_title: "广告开屏 A", uri: "https://ads.example.test/ad" },
      ],
      force_list: [
        { id: 100005, schema_title: "强制开屏 A", uri: "https://ads.example.test/force" },
      ],
      topview_list: [
        { id: 100006, schema_title: "TopView 开屏 A", uri: "https://ads.example.test/topview" },
      ],
      has_new_splash_set: true,
      new_splash_hash: "hash-sample",
      show_hash: "show-hash-sample",
      force_show_times: 2,
      forcibly: true,
    },
  });
}

function splashBrandListFixtureBody() {
  return JSON.stringify({
    code: 0,
    message: "OK",
    data: {
      pull_interval: 1800,
      forcibly: true,
      list: [
        { id: 200001, schema_title: "品牌开屏 A", uri: "https://ads.example.test/brand-a" },
        { id: 200002, schema_title: "品牌开屏 B", uri: "https://ads.example.test/brand-b" },
      ],
      preload: [
        { id: 200001, url: "https://ads.example.test/preload-a" },
      ],
      query_list: [
        { id: 200001, selected: true },
      ],
      has_new_splash_set: true,
      new_splash_hash: "hash-sample",
      show_hash: "show-hash-sample",
      force_show_times: 2,
    },
  });
}

function splashShowFullFixtureBody() {
  return JSON.stringify({
    code: 0,
    message: "OK",
    ttl: 1,
    data: {
      show: [
        { id: 300001, stime: 1778000000, etime: 1778086400, ad_cb: "sample-show-cb-a" },
        { id: 300002, stime: 1778000000, etime: 1778086400, ad_cb: "sample-show-cb-b" },
      ],
      splash_request_id: "sample-request-id",
    },
  });
}

function splashListFullFixtureBody() {
  return JSON.stringify({
    code: 0,
    message: "OK",
    ttl: 1,
    data: {
      max_time: 30,
      min_interval: 180,
      pull_interval: 900,
      keep_ids: [3300736990051328, 4300203231158272],
      list: [
        {
          id: 300101,
          type: 4,
          card_type: 1,
          duration: 5,
          thumb: "https://ads.example.test/splash-a.webp",
          logo_url: "https://ads.example.test/logo-a.png",
          uri: "https://ads.example.test/landing-a",
          video_url: "https://ads.example.test/video-a.mp4",
          uri_title: "多字段开屏 A",
          ad_cb: "sample-list-cb-a",
          is_ad: true,
          is_ad_loc: true,
          schema_title: "多字段开屏 A",
          schema_callup_white_list: ["example.app"],
          extra: { download_whitelist: [{ display_name: "样例应用" }] },
          peak_download: { type: "brand_splash" },
          second_page: { title: "二跳页面" },
        },
      ],
      show: [
        { id: 300101, stime: 1778000000, etime: 1778086400, ad_cb: "sample-show-cb" },
      ],
      splash_request_id: "sample-list-request-id",
    },
  });
}

function splashEventFullFixtureBody() {
  return JSON.stringify({
    code: 0,
    message: "OK",
    ttl: 1,
    data: {
      event_list: [
        { id: 300201, schema_title: "活动开屏 A", uri: "https://ads.example.test/event-a" },
      ],
      account: {
        mid: 10000,
        uname: "占位用户",
        level: 6,
      },
    },
  });
}

function splashBrandFullFixtureBody() {
  return JSON.stringify({
    code: 0,
    message: "OK",
    ttl: 1,
    data: {
      pull_interval: 1800,
      forcibly: true,
      rule: "",
      list: [
        {
          id: 300301,
          thumb: "https://ads.example.test/brand-a.webp",
          logo_url: "https://ads.example.test/brand-logo-a.png",
          mode: "full",
          thumb_name: "品牌开屏 A",
          source: "sample",
          show_logo: true,
        },
      ],
      preload: [
        { id: 300301, thumb: "https://ads.example.test/preload-brand-a.webp" },
      ],
      has_new_splash_set: true,
      new_splash_hash: "sample-new-splash-hash",
      force_show_times: 2,
      show_hash: "sample-show-hash",
      badge_from: "sample",
      query_list: [
        { id: 300301, selected: true },
      ],
    },
  });
}

function startupTabFixtureBody() {
  return JSON.stringify({
    code: 0,
    message: "OK",
    data: {
      tab: [
        { id: 39, name: "直播", tab_id: "直播tab", uri: "bilibili://live/home", pos: 1 },
        { id: 40, name: "推荐", tab_id: "推荐tab", uri: "bilibili://pegasus/promo", pos: 2 },
        { id: 3983, name: "足球季", tab_id: "worldcup", uri: "bilibili://browser/?url=https%3A%2F%2Fexample.test%2Ffootball", pos: 3 },
        { id: 41, name: "热门", tab_id: "hottopic", uri: "bilibili://pegasus/hottopic", pos: 4 },
        { id: 3502, name: "动画", tab_id: "bangumi", uri: "bilibili://pgc/bangumi_v2", pos: 5 },
        { id: 3503, name: "影视", tab_id: "bilibili://pgc/cinema-tab", uri: "bilibili://pgc/cinema_v2", pos: 6 },
        { id: 409527, name: "活动入口 A", tab_id: "227", uri: "bilibili://following/home_activity_tab/409527", pos: 7 },
      ],
      top: [
        { id: 3500, name: "游戏中心", tab_id: "游戏中心Top", uri: "bilibili://game_center/home", pos: 1 },
        { id: 3510, name: "消息", tab_id: "消息Top", uri: "bilibili://link/im_home", pos: 2 },
      ],
      bottom: [
        { id: 177, name: "首页", tab_id: "home", uri: "bilibili://main/home/", pos: 1 },
        { id: 178, name: "动态", tab_id: "dynamic", uri: "bilibili://following/home/", pos: 2 },
        { id: 179, name: "发布", tab_id: "publish", uri: "bilibili://uper/user_center/add_archive/", pos: 3 },
        { id: 180, name: "会员购", tab_id: "mall", uri: "bilibili://mall/home", pos: 4 },
        { id: 181, name: "我的", tab_id: "user_center", uri: "bilibili://user_center/", pos: 5 },
      ],
      top_left: {
        bubbles: [{ id: 10000, text: "保留普通气泡" }],
      },
    },
  });
}

function ipadStartupTabFixtureBody() {
  return JSON.stringify({
    code: 0,
    message: "OK",
    data: {
      tab: [
        { id: 39, name: "直播", tab_id: "直播tab", uri: "bilibili://live/home", pos: 1 },
        { id: 40, name: "推荐", tab_id: "推荐tab", uri: "bilibili://pegasus/promo", pos: 2 },
        { id: 41, name: "热门", tab_id: "hottopic", uri: "bilibili://pegasus/hottopic", pos: 3 },
        { id: 3502, name: "追番", tab_id: "bangumi", uri: "bilibili://pgc/home", pos: 4 },
        { id: 3503, name: "影视", tab_id: "bilibili://pgc/cinema-tab", uri: "bilibili://pgc/cinema-tab", pos: 5 },
      ],
    },
  });
}

function startupSkinFixtureBody() {
  return JSON.stringify({
    code: 0,
    message: "OK",
    ttl: 1,
    data: {
      common_equip: {
        id: 1,
        name: "启动皮肤装扮 A",
        url: "https://ads.example.test/skin-a.png",
      },
      skin_colors: [
        { id: 8, name: "简洁白", is_free: true, color_name: "white" },
      ],
    },
  });
}

function startupPeakDownloadFixtureBody() {
  return JSON.stringify({
    code: 0,
    message: "OK",
    ttl: 1,
    data: {
      ver: "sample-version",
      resource: [
        {
          type: "egg",
          list: [
            { task_id: 1, type: "mov", url: "https://ads.example.test/startup-egg.mp4" },
          ],
          extra_value: "",
        },
        {
          type: "mod",
          list: [
            { task_id: 2, type: "json", url: "https://example.test/normal-mod.json" },
          ],
          extra_value: "",
        },
        {
          type: "brand_splash",
          list: [
            { task_id: 3, type: "thumb", url: "https://ads.example.test/brand-thumb.webp" },
            { task_id: 4, type: "logo", url: "https://ads.example.test/brand-logo.png" },
          ],
          extra_value: "",
        },
      ],
    },
  });
}

function minePageFixtureBody() {
  return JSON.stringify({
    code: 0,
    message: "OK",
    ttl: 1,
    data: {
      name: "占位用户",
      show_creative: 1,
      sections_v2: [
        {
          title: "常用功能",
          items: [
            { id: 396, title: "离线缓存", uri: "bilibili://user_center/download" },
            { id: 397, title: "历史记录", uri: "bilibili://user_center/history" },
          ],
          style: 1,
          button: {},
        },
        {
          title: "创作中心",
          items: [
            { id: 171, title: "创作中心", uri: "bilibili://uper/homevc" },
            { id: 172, title: "稿件管理", uri: "bilibili://uper/user_center/archive_list" },
            { id: 533, title: "数据中心", uri: "https://member.bilibili.com/york/data-center?from=profile" },
            { id: 174, title: "有奖活动", uri: "https://www.bilibili.com/blackboard/reward.html" },
          ],
          style: 1,
          button: {
            text: "发布",
            url: "bilibili://uper/user_center/archive_selection",
          },
          type: 1,
          up_title: "创作中心",
        },
        {
          title: "我的服务",
          items: [
            { id: 400, title: "我的课程", uri: "https://m.bilibili.com/cheese/mine" },
            { id: 401, title: "看视频免流量", uri: "bilibili://user_center/free_traffic" },
            { id: 3607, title: "会员购订单", uri: "bilibili://mall/home?bizType=mine" },
          ],
          style: 1,
          button: {},
          type: 4,
        },
        {
          title: "更多服务",
          items: [
            { id: 407, title: "联系客服", uri: "bilibili://user_center/feedback" },
            { id: 410, title: "设置", uri: "bilibili://user_center/setting" },
          ],
          style: 2,
          button: {},
        },
      ],
      rework_v1: {
        worst_creative: {
          title: "今天过得怎么样",
          button_text: "发布",
        },
      },
    },
  });
}

function ipadMinePageFixtureBody() {
  return JSON.stringify({
    code: 0,
    message: "OK",
    ttl: 1,
    data: {
      name: "iPadOS 占位用户",
      ipad_sections: [
        { id: 1, title: "离线缓存", uri: "bilibili://user_center/download" },
        { id: 2, title: "历史记录", uri: "bilibili://user_center/history" },
      ],
      ipad_upper_sections: [
        { id: 171, title: "投稿", uri: "bilibili://uper/user_center/archive_selection" },
        { id: 172, title: "创作首页", uri: "bilibili://uper/homevc" },
        { id: 173, title: "稿件管理", uri: "bilibili://uper/user_center/archive_list" },
        { id: 174, title: "有奖活动", uri: "https://www.bilibili.com/blackboard/reward.html" },
      ],
      ipad_recommend_sections: [
        { id: 301, title: "我的关注" },
        { id: 302, title: "我的消息" },
        { id: 303, title: "我的钱包" },
        { id: 304, title: "直播中心" },
        { id: 305, title: "大会员" },
        { id: 306, title: "我的游戏" },
        { id: 307, title: "我的课程" },
      ],
      ipad_more_sections: [
        { id: 401, title: "联系客服" },
        { id: 402, title: "设置" },
        { id: 403, title: "青少年模式" },
      ],
    },
  });
}

function ipadVipAdsFixtureBody() {
  return JSON.stringify({
    code: 0,
    message: "OK",
    ttl: 1,
    data: {
      list: [
        {
          id: 9001,
          position: "ipad_vip",
          title_list: ["大会员广告素材 A"],
          image_list: ["https://ads.example.test/vip-a.png"],
        },
      ],
      list_v2: [
        {
          id: 9002,
          position: "ipad_vip_v2",
          title_list: ["大会员广告素材 B"],
        },
      ],
      vip_login_coupon: {
        login_layer: {
          title: "登录领取优惠券",
          image: "https://ads.example.test/coupon.png",
        },
        exp: { group: "sample" },
        report: { event_id: "sample-report" },
      },
    },
  });
}

function searchSquareFixtureBody() {
  return JSON.stringify({
    code: 0,
    message: "OK",
    ttl: 1,
    data: [
      {
        type: "trending",
        title: "bilibili热搜",
        data: {
          list: [
            { keyword: "样例热搜词-A", show_name: "样例热搜词-A", position: 1 },
            { keyword: "样例热搜词-B", show_name: "样例热搜词-B", position: 2 },
          ],
        },
      },
      {
        type: "history",
        title: "搜索历史",
        data: {
          list: [
            { keyword: "样例历史词-A" },
            { keyword: "样例历史词-B" },
          ],
        },
      },
      {
        type: "recommend",
        title: "搜索发现",
        data: {
          list: [
            { title: "样例发现词-A", keyword: "样例发现词-A" },
            { title: "样例发现词-B", keyword: "样例发现词-B" },
          ],
        },
      },
      {
        type: "other",
        title: "普通模块",
        data: { list: [{ keyword: "保留词-A" }] },
      },
    ],
  });
}

function searchDefaultWordsFixtureBody() {
  return encodeGrpc(Buffer.concat([
    stringField(1, "track-id-sample"),
    stringField(2, "word-id-sample"),
    stringField(3, "样例搜索框推荐词"),
    stringField(4, "样例搜索框展示词"),
    varintField(5, 1),
    stringField(6, "exp-sample"),
  ]));
}

function searchSuggestFixtureBody() {
  return encodeGrpc(Buffer.concat([
    stringField(1, "suggest-meta"),
    messageField(2, [
      stringField(1, "search"),
      stringField(2, "普通候选词"),
      stringField(3, "普通候选词"),
      varintField(4, 1),
    ]),
    messageField(2, [
      stringField(1, "search"),
      stringField(2, "命中候选屏蔽词"),
      stringField(3, "命中候选屏蔽词"),
      varintField(4, 1),
    ]),
    stringField(3, "suggest-tail"),
  ]));
}

function dynamicModule(type, fields) {
  return messageField(3, [varintField(1, type), ...fields]);
}

function dynamicItem(fields) {
  return Buffer.concat([
    varintField(1, 7),
    ...fields,
  ]);
}

function normalDynamicItem(title) {
  return dynamicItem([
    dynamicModule(30, [stringField(30, title)]),
  ]);
}

function keywordDynamicItem(title, up) {
  return dynamicItem([
    dynamicModule(2, [
      messageField(2, [
        stringField(2, "5小时前"),
        messageField(3, [stringField(2, up)]),
        messageField(10, [stringField(4, "已关注")]),
      ]),
    ]),
    messageField(4, [
      stringField(4, up),
      messageField(6, [
        stringField(1, title),
        stringField(10, title),
      ]),
      stringField(30, up),
    ]),
  ]);
}

function dynamicItemWithUpRecommendation(title) {
  return dynamicItem([
    dynamicModule(30, [
      stringField(30, "普通动态正文"),
      messageField(9, [
        stringField(6, title),
        stringField(13, "UP主的推荐"),
        stringField(14, "示例商城"),
        stringField(16, '{"is_ad_loc":true,"product_source":"示例商城"}'),
      ]),
    ]),
    dynamicModule(8, [
      stringField(8, "UP主的推荐"),
      stringField(9, title),
      stringField(10, "示例商城"),
      stringField(11, "example-shop://example.test/item?id=sample"),
      stringField(12, "is_ad_loc"),
    ]),
    messageField(4, [
      stringField(6, "普通扩展信息"),
      stringField(6, `${title} is_ad_loc example-shop://example.test/item?id=sample`),
    ]),
  ]);
}

function dynamicAllKeywordFixtureBody() {
  return encodeGrpc(Buffer.concat([
    messageField(1, [
      messageField(1, [normalDynamicItem("普通动态内容 A")]),
      messageField(1, [keywordDynamicItem("动态屏蔽词内容 B", "动态占位账号")]),
      stringField(3, "offset-example"),
    ]),
  ]));
}

function searchAllFixtureBody() {
  return encodeGrpc(Buffer.concat([
    stringField(1, "样例搜索词"),
    messageField(3, [
      stringField(1, "视频"),
      varintField(4, 1),
    ]),
    messageField(4, [
      stringField(1, "搜索结果保留 A"),
      stringField(2, "video"),
      messageField(37, [
        stringField(1, "普通搜索结果标题"),
        stringField(2, "普通搜索结果简介"),
      ]),
    ]),
    messageField(4, [
      stringField(1, "搜索结果屏蔽 B"),
      stringField(2, "video"),
      messageField(37, [
        stringField(1, "命中搜索屏蔽词标题"),
        stringField(2, "普通搜索结果简介"),
        stringField(10, "搜索占位账号"),
        stringField(16, "· 5月2日"),
      ]),
    ]),
    messageField(6, [
      stringField(1, "next-page-cursor"),
    ]),
  ]));
}

function searchAllCleanupCard({ id, type, title, up = "" }) {
  return messageField(4, [
    stringField(1, `bilibili://search/sample/${id}`),
    stringField(2, String(id)),
    stringField(3, type),
    stringField(4, type),
    stringField(63, JSON.stringify({ id, type })),
    messageField(37, [
      stringField(1, title),
      ...(up ? [stringField(10, up)] : []),
    ]),
  ]);
}

function searchAllAggregationCard() {
  return messageField(4, [
    stringField(2, "138977"),
    stringField(3, "pedia_card_pic"),
    stringField(4, "pedia_card_pic"),
    stringField(63, '{"id":138977,"type":"pedia_card_pic"}'),
    messageField(44, [
      stringField(1, "https://assets.example.test/search-aggregation-cover.png"),
      messageField(2, [
        stringField(1, "样例聚合视频 A"),
        stringField(2, "bilibili://video/sample-aggregation-a"),
      ]),
      messageField(2, [
        stringField(1, "样例聚合视频 B"),
        stringField(2, "bilibili://video/sample-aggregation-b"),
      ]),
      messageField(2, [
        stringField(1, "官方动态"),
        stringField(2, "https://space.example.test/sample/dynamic"),
      ]),
    ]),
  ]);
}

function searchAllCleanupFixtureBody() {
  return encodeGrpc(Buffer.concat([
    stringField(1, "样例搜索词"),
    searchAllCleanupCard({ id: 9201, type: "video", title: "普通搜索结果视频", up: "普通搜索UP" }),
    searchAllCleanupCard({ id: 9202, type: "picture_ad", title: "搜索结果广告卡片" }),
    searchAllCleanupCard({ id: 9203, type: "video_ad", title: "搜索结果创作推广视频", up: "推广占位账号" }),
    searchAllCleanupCard({ id: 9204, type: "live_room", title: "搜索结果直播间", up: "直播占位账号" }),
    searchAllAggregationCard(),
    searchAllCleanupCard({ id: 9205, type: "ketang", title: "搜索结果课堂卡片", up: "课堂占位账号" }),
  ]));
}

function searchAllCleanupAndFilterFixtureBody() {
  return encodeGrpc(Buffer.concat([
    stringField(1, "样例搜索词"),
    searchAllCleanupCard({ id: 9251, type: "picture_ad", title: "搜索结果广告卡片" }),
    messageField(4, [
      stringField(1, "bilibili://video/9252"),
      stringField(2, "video"),
      stringField(63, '{"id":9252,"type":"video"}'),
      messageField(37, [
        stringField(1, "命中搜索屏蔽词标题"),
        stringField(10, "搜索占位账号"),
      ]),
    ]),
  ]));
}

function searchAllDirtySummaryFixtureBody() {
  return encodeGrpc(Buffer.concat([
    stringField(1, "样例搜索词"),
    messageField(4, [
      stringField(1, "普通搜索结果标题"),
      stringField(2, "video"),
    ]),
    messageField(4, [
      stringField(2, "picture_ad"),
      stringField(9, "\x12 1290926279\x1a picture_ad 搜索屏蔽词"),
    ]),
    messageField(4, [
      messageField(42, [
        stringField(1, "\ufffd #搜索屏蔽词# 正常搜索动态内容"),
        messageField(5, [stringField(2, "样例话题")]),
      ]),
    ]),
  ]));
}

function searchAllMixedResultFixtureBody() {
  return encodeGrpc(Buffer.concat([
    stringField(1, "样例搜索词"),
    messageField(4, [
      stringField(1, "普通搜索结果标题"),
      stringField(2, "video"),
      messageField(37, [
        stringField(1, "普通搜索结果标题"),
        stringField(10, "普通搜索UP"),
      ]),
      stringField(63, '{"id":9301,"type":"video"}'),
    ]),
    messageField(4, [
      stringField(2, "author_new"),
      stringField(3, "app_user"),
      stringField(63, '{"id":9302,"type":"bili_user"}'),
      messageField(23, [
        stringField(1, "目标占位账号"),
        stringField(8, "命中搜索屏蔽词用户简介"),
        stringField(14, "目标占位账号"),
      ]),
    ]),
    messageField(4, [
      stringField(2, "twitter_new_p"),
      stringField(3, "twitter"),
      stringField(63, '{"id":9303,"type":"twitter"}'),
      messageField(42, [
        stringField(1, "#样例话题# 命中搜索屏蔽词动态内容"),
        messageField(5, [
          stringField(2, "目标占位账号"),
          stringField(4, "刚刚"),
        ]),
        stringField(8, "动态"),
      ]),
    ]),
  ]));
}

function searchAllTagFixtureBody() {
  return encodeGrpc(Buffer.concat([
    stringField(1, "样例搜索词"),
    messageField(4, [
      stringField(1, "bilibili://video/9101"),
      stringField(2, "video"),
      messageField(37, [
        stringField(1, "命中样例Tag标题"),
        stringField(10, "搜索占位账号"),
      ]),
      stringField(63, '{"id":9101,"type":"video"}'),
    ]),
    messageField(4, [
      stringField(1, "bilibili://video/9102"),
      stringField(2, "video"),
      messageField(37, [
        stringField(1, "普通搜索结果标题"),
        stringField(10, "普通搜索UP"),
      ]),
      stringField(63, '{"id":9102,"type":"video"}'),
    ]),
  ]));
}

function dynamicAllFixtureBody() {
  return encodeGrpc(Buffer.concat([
    messageField(1, [
      messageField(1, [normalDynamicItem("普通动态内容 A")]),
      messageField(1, [dynamicItemWithUpRecommendation("样例商品500g")]),
      stringField(3, "offset-example"),
    ]),
  ]));
}

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function normalizeLpxForSync(text) {
  return String(text)
    .replace(/\r\n/g, "\n")
    .replace(/^#!name=.*$/m, "#!name=PLUGIN_NAME")
    .replace(
      /script-path=(?:https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/main\/bilibili\/bilibili_cleaner\.js|http:\/\/\d{1,3}(?:\.\d{1,3}){3}:\d+\/bilibili_cleaner\.js)\?v=\d{8}-\d+/g,
      "script-path=SCRIPT_PATH?v=VERSION"
    );
}


module.exports = {
  assert,
  fs,
  LPX_PATH,
  LAN_LPX_PATH,
  TAG_CACHE_KEY,
  feedItems,
  manyFeedBody,
  nonPromotedAidsFromFixture,
  baseArgument,
  notifyingArgument,
  runPlugin,
  assertNotification,
  assertUnchangedResponse,
  assertBodyOnlyResponsePatch,
  findNotification,
  grpcMessageBytes,
  countTopLevelGrpcFields,
  stringField,
  messageField,
  varintField,
  encodeGrpc,
  homePopularFixtureBody,
  normalRelatedItem,
  viewFixtureBody,
  ipadLegacyViewFixtureBody,
  relatesFeedFixtureBody,
  videoFeedFixtureBody,
  ipadHomeFeedFixtureBody,
  splashShowFixtureBody,
  splashListFixtureBody,
  splashBrandListFixtureBody,
  splashShowFullFixtureBody,
  splashListFullFixtureBody,
  splashEventFullFixtureBody,
  splashBrandFullFixtureBody,
  startupTabFixtureBody,
  ipadStartupTabFixtureBody,
  startupSkinFixtureBody,
  startupPeakDownloadFixtureBody,
  minePageFixtureBody,
  ipadMinePageFixtureBody,
  ipadVipAdsFixtureBody,
  searchSquareFixtureBody,
  searchDefaultWordsFixtureBody,
  searchSuggestFixtureBody,
  normalDynamicItem,
  dynamicAllKeywordFixtureBody,
  searchAllFixtureBody,
  searchAllCleanupFixtureBody,
  searchAllCleanupAndFilterFixtureBody,
  searchAllDirtySummaryFixtureBody,
  searchAllMixedResultFixtureBody,
  searchAllTagFixtureBody,
  dynamicAllFixtureBody,
  tests,
  test,
  normalizeLpxForSync,
};
