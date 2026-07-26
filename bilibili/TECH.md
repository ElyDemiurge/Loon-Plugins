# 技术文档

本文档面向维护者，主要介绍 `bilibili_cleaner.js` 的整体结构、关键模块以及实现要点。阅读之前建议先了解 [README.md](./README.md) 中的功能说明和参数说明。

## 目录

- [运行模型](#运行模型)
- [整体结构](#整体结构)
- [请求路由](#请求路由)
- [JSON 和 protobuf 两种响应](#json-和-protobuf-两种响应)
- [protobuf 工具层](#protobuf-工具层)
- [屏蔽规则引擎](#屏蔽规则引擎)
- [视频 Tag 缓存与深度屏蔽](#视频-tag-缓存与深度屏蔽)
- [清理规则](#清理规则)
- [通知与日志](#通知与日志)
- [错误处理](#错误处理)
- [接口与处理器对照表](#接口与处理器对照表)
- [测试](#测试)
- [局域网测试](#局域网测试)
- [配置同步](#配置同步)
- [发布前的检查清单](#发布前的检查清单)

## 运行模型

脚本以 Loon 响应脚本的形式注入，由 Loon 在命中 `http-response` 规则后执行。脚本运行时可以访问以下全局对象：

| 全局对象 | 用途 |
| --- | --- |
| `$request` | 当前请求，包含 `url` 和 `body`；兼容层也会尝试读取 `bodyBytes` 别名 |
| `$response` | 当前响应；文本和二进制响应均从 `body` 读取，兼容层也支持测试环境的 `bodyBytes` 别名 |
| `$argument` | 插件参数，可以是对象也可以是序列化字符串 |
| `$persistentStore` | 持久化键值存储，用来存放 Tag 缓存 |
| `$notification` / `$notify` | 发送系统通知 |
| `$httpClient` | 发起 HTTP 请求，用于拉取视频 Tag |
| `$utils.ungzip` | 解压 gzip（部分运行时会提供） |
| `$done` | 结束本次执行，可以传回改写后的请求或响应 |

维护源码位于 `core_modules`，按 `Common`、`iOS`、`iPadOS` 区分共用和平台专属代码。根目录的 `build_bilibili_cleaner.js` 按依赖顺序将模块拼接为 Loon 实际加载的 `bilibili_cleaner.js`。脚本入口在最后一个模块 `entry.js`：调用异步函数 `main()`，并通过 `.catch()` 兜底，保证任何异常都会调用 `$done()` 并返回响应，避免脚本崩溃后请求被挂起。

插件配置遵循 Loon 官方[插件手册](https://nsloon.app/docs/Plugin/)与[脚本手册](https://nsloon.app/docs/Script/)：`[Argument]` 中声明的参数按处理器需要通过每条规则的 `argument=[{...}]` 传入，未使用的参数不重复传递；需要读取 gRPC 响应的路由同时声明 `requires-body=true` 与 `binary-body-mode=true`；单一开关控制的路由通过 `enable={开关}` 在关闭时跳过脚本。固定输出字节且不读取上游响应的青少年模式和交互式弹幕路由不请求响应体。

响应体改写采用延迟提交：`setResponseBodyText()` 与 `setResponseBodyBytes()` 只暂存候选 body，并和原始 body 比较。没有变化时 `finishResponse()` 调用 `$done({})` 原样放行；存在变化时只调用 `$done({body: ...})`。顶层异常兜底同样使用 `$done({})`，不会返回可能只完成了一部分的候选改写。

## 整体结构

源码按职责拆分为构建模块；各模块共享最终单文件的词法作用域，以兼容 Loon 不提供 CommonJS / ESM 加载器的运行环境。文件职责与拼接顺序如下：

| 顺序 | 文件 | 职责 |
| ---: | --- | --- |
| 1 | `core_modules/Common/config.js` | 默认参数、参数标准化、日志等级与公共常量 |
| 2 | `core_modules/Common/runtime-protobuf.js` | Loon 运行时适配、通知、字节转换、gRPC 帧与 protobuf 基础解析 |
| 3 | `core_modules/Common/filter-rules.js` | 标题、UP 主、内容关键词与视频 Tag 的统一匹配流程 |
| 4 | `core_modules/Common/tag-cache.js` | 持久化 Tag 缓存、远端 Tag 请求、去重与淘汰 |
| 5 | `core_modules/Common/protobuf-tools.js` | aid、话题 Tag 与 protobuf 消息树的共用读取和改写工具 |
| 6 | `core_modules/Common/video-search.js` | 两端共用的视频统计、广告识别、详情页收尾、推荐流和搜索处理 |
| 7 | `core_modules/iOS/video.js` | iOS `ViewUnite` 视频详情页与 `RelatesFeed` 结构 |
| 8 | `core_modules/iPadOS/video.js` | iPadOS 旧版 `View` 视频详情页结构 |
| 9 | `core_modules/Common/reply.js` | 评论区置顶广告识别与清理 |
| 10 | `core_modules/Common/json-page-handlers.js` | 开屏、启动资源与共用 JSON 页面处理 |
| 11 | `core_modules/iOS/home-tabs.js` | iOS 首页顶部分区过滤与 iPadOS 隔离 |
| 12 | `core_modules/Common/mine.js` | 两端共用的「我的」页面统计与通知 |
| 13 | `core_modules/iOS/mine.js` | iOS `sections_v2 / sections` 我的页面结构 |
| 14 | `core_modules/iPadOS/mine.js` | iPadOS 独立入口数组的我的页面结构 |
| 15 | `core_modules/iPadOS/ads.js` | iPadOS 大会员广告素材列表与登录浮层接口 |
| 16 | `core_modules/Common/live-and-modes.js` | 直播广告、追踪参数、首页搜索页、青少年模式与交互式弹幕 |
| 17 | `core_modules/Common/dynamic.js` | 动态关键词、UP 主推荐商品与「最常访问」列表 |
| 18 | `core_modules/Common/home-feed.js` | iOS 与 iPadOS 共用的首页推荐页和首页热门过滤 |
| 19 | `core_modules/Common/entry.js` | `main()` URL 路由与顶层异常兜底 |

模块清单与构建顺序维护在 `build_bilibili_cleaner.js`。修改 `core_modules` 后必须执行：

```bash
node build_bilibili_cleaner.js
node build_bilibili_cleaner.js --check
```

构建产物带有生成文件提示，测试套件也会检查它是否与源码模块完全一致。

## 请求路由

`main()` 按照请求 URL 的特征依次匹配，命中之后交给对应处理器并返回。匹配顺序很关键：更具体的路由必须排在前面。首页热门（`Popular/Index`）也使用显式路由；未知 URL 会记录 debug 日志并原样返回，避免按错误的响应格式解析。

路由判定要点：

- 所有处理器都在响应阶段（`http-response`）执行；脚本通过 `$response` 读取响应体并改写。
- **JSON 接口**（`/x/...`）和 **gRPC 接口**（`grpc.biliapi.net`）由不同的处理器解析。gRPC 响应在 Loon 中以 `binary-body-mode=true` 捕获，官方运行时通过 `$response.body` 提供 `Uint8Array`；兼容层也支持部分测试环境的 `bodyBytes` 别名。
- 部分接口（比如首页热门 `Popular/Index`）会同时匹配 `grpc.biliapi.net` 与 `app.bilibili.com` 两个域名。

## JSON 和 protobuf 两种响应

### JSON 响应

首页推荐页、首页搜索页、开屏、启动资源、两端我的页面、iPadOS 大会员广告素材与登录浮层、视频推荐流（`feed/index/story`）等接口返回 JSON。具体步骤：

1. `parseResponseJson()` 将响应体解析为对象。
2. 遍历目标数组（比如 `data.items`、`data.tab`），按照规则标记哪些项要保留、哪些要移除。
3. 重新序列化并通过 `setResponseBodyText()` 写回。

### gRPC / protobuf 响应

首页热门、搜索结果、搜索候选词条、动态页、视频详情页、视频页推荐流等接口返回 protobuf gRPC。iOS 使用 `bilibili.app.viewunite.v1.View`，iPadOS 抓包使用 `bilibili.app.view.v1.View`；两种 schema 由平台目录中的独立处理器解析。脚本不依赖 `.proto` 定义，而是用通用解析器按照字段号与 wire type 来处理。具体步骤：

1. `decodeGrpcBody()` 去掉 5 字节 gRPC 帧头（1 字节压缩标记 + 4 字节大端长度），必要的时候解压 gzip。
2. 用 protobuf 工具层定位并改写字段。
3. `encodeGrpcBody()` 重新封装帧头，通过 `setResponseBodyBytes()` 写回。

## protobuf 工具层

由于缺少 schema，所有 protobuf 操作都建立在「字段号 + wire type」的基础上。

| 函数 | 作用 |
| --- | --- |
| `readVarint` / `encodeVarint` | 读写 protobuf varint |
| `parseFields` | 将一段字节解析为字段列表，每一项包含字段号 `no`、wire type、原始字节 `raw` 以及值字节 `value` |
| `tryParseFields` | `parseFields` 的安全版本，解析失败的时候返回 null |
| `fieldStrings` / `firstMessage` / `varintField` | 读取指定字段号的字符串、嵌套消息或者 varint |
| `walkProtobufFields` | 只读递归遍历消息树，支持最大深度和已访问去重，visitor 可以提前结束或者跳过子节点 |
| `transformProtobufFields` | 改写消息树，visitor 可以删除字段或者替换字段值；没有变化时返回原字节，以保持引用稳定 |
| `encodeField` / `concat` | 编码单个字段并拼接字节数组 |

`transformProtobufFields` 的设计目标是「只改该改的」：只有某个字段确实被删除或者替换时，才重新编码该分支，其余字节原样保留。这样既能精确删除目标卡片，又能避免无关字段的重新编码引入风险。

在提取字符串时，`extractReadableStrings` 和 `readableProtobufEntries` 负责从消息中找出可以作为标题或者摘要的可读文本，再交给 `isDirtySummaryText`、`isSummaryMetaText` 过滤掉二进制残片、广告模板文案以及播放量、时间等元信息，保证通知展示的内容干净。

## 屏蔽规则引擎

屏蔽规则由 `buildKeywords()` 一次性构建，包含四类：

- **标题关键词**（`titleContains`）：包含匹配，标题包含任一关键词即命中。
- **UP 主名称**（`upExact`）：完全匹配，名称与配置项完全一致才命中。
- **视频 Tag**（`tagRegex`）：正则匹配，只在深度屏蔽开启时参与。
- **内容关键词**（`contentContains`）：包含匹配，作用于关注页动态、搜索结果、搜索候选词条等页面。

整个匹配流程围绕「过滤行」来组织。`createFilterRow()` 把一个待判定项统一抽象为标题、UP 名称、aid 以及内联 Tag。`applyFilterMatches()` 负责为一批过滤行填充命中结果：

1. 先用 `findTextMatch()` 做标题和 UP 匹配（同步、无网络）。
2. 对仍然没有命中的行，用 `applyTagMatches()` 补充 Tag 匹配。

Tag 匹配分三级，优先复用已有数据来减少网络请求：

1. **内联 Tag**：从卡片自身提取的话题 Tag。
2. **缓存 Tag**：从本地 Tag 缓存读取。
3. **远端 Tag**：按需请求视频标签接口。

匹配完成后，调用方按照命中结果决定保留还是删除该行，并据此重新拼接响应字节或者 JSON 数组。

## 视频 Tag 缓存与深度屏蔽

深度屏蔽开启后，视频详情页（`View`）响应中的话题 Tag 会被收集并写入缓存，供首页热门、首页推荐页、视频页推荐流和搜索结果普通视频在后续匹配中复用。话题名称均读取 field 2；iOS `ViewUnite` 的话题链接常见于 field 3，iPadOS 旧版 `View` 的话题链接位于 field 7。

缓存用到的常量：

| 常量 | 值 | 含义 |
| --- | --- | --- |
| `TAG_CACHE_KEY` | `BilibiliFilter.tagCache.v1` | 持久化存储键名 |
| `TAG_CACHE_LIMIT` | 500 | 缓存条目上限 |
| `TAG_CACHE_TTL` | 7 天 | 单条缓存有效期 |
| `TAG_FETCH_TIMEOUT_MS` | 1500 | 单次远端请求的超时时间 |
| `TAG_FETCH_CONCURRENCY_LIMIT` | 24 | 远端请求的并发上限 |

关键设计：

- **内存缓存**：`readTagCache()` 首次访问时从持久化存储加载并缓存到 `tagCacheMemo`，同一次脚本执行中不会重复读取。
- **请求去重**：`pendingTagRequests` 在一次执行中对同一 aid 的请求做合并，避免并发重复拉取。
- **并发限制**：`mapLimited()` 按照并发上限依次处理待请求列表，超出部分排队等待空位。
- **淘汰策略**：写入持久化存储前过滤过期条目，并按更新时间倒序保留最新的 500 条；读取缓存不会刷新更新时间。
- **缓存状态**：写入返回 `created` / `updated` / `unchanged` / `skipped` 四种状态，用于通知展示。

## 清理规则

清理（移除广告、推广、直播等）和屏蔽（按关键词）是两类独立动作，分别统计、分别展示。

### 视频详情页与推荐流

`videoRelatedCleanupType()` 按照字段特征判断一个视频页目标属于哪类清理，返回类型之前会检查对应开关是否开启：

- `bannerAds`：横幅下载广告。
- `liveRecommendations`：直播推荐。
- `upGoodsAds`：UP 主推荐好物。
- `promotedContent`：商业推广内容。
- `relatedAds`：普通广告卡片。

iOS 的 `sanitizeIosVideoPageMessage()` 按 `ViewUnite` 字段位置（推荐流容器、横幅字段、UP 好物字段）调用上述判定；iPadOS 的 `handleIpadViewResponse()` 则处理顶层 field 10 相关推荐和 field 41 独立商业素材。两端最终都复用同一套标题、UP 主、Tag 屏蔽规则与通知统计。当前横幅字段和 UP 好物字段只存在于已适配的 iOS `ViewUnite` 结构，因此对应参数在插件界面标记为 `[iOS]`；广告卡片、推广内容与直播推荐仍为两端共用参数。

### 搜索结果

搜索结果的移除类规则定义在 `SEARCH_RESULT_CLEANUP_RULES` 中，每条规则带有一个 `priority` 字段。`SEARCH_RESULT_CLEANUP_RULES_BY_PRIORITY` 按照 priority 升序排列，判定时取首次命中，所以同一张卡片只会归入优先级最高的一类。当前优先级由高到低为：聚合卡片、直播、创作推广、广告。

注意 `video_ad` 类型被单独归入「创作推广」，和普通广告区分开，以便通过不同的开关分别控制。

## 通知与日志

通知按照类别受开关控制：

| 类别 | 开关 | 覆盖范围 |
| --- | --- | --- |
| `filter` | `notifyFilter` | 标题、UP、Tag 屏蔽结果 |
| `remove` | `notifyRemove` | 开屏、搜索、动态、广告等移除类结果 |
| `personalization` | `notifyPersonalization` | 首页顶部分区、底部按钮、我的页面等个性化清理结果 |

`notify()` 在发送之前先检查类别开关；开关开启时，通过 `logNotification()` 把即将弹出的通知内容同步写入脚本日志。关闭通知开关后不会生成对应的通知日志，常规诊断信息仍由 `log()` 按 `logLevel` 控制。

规则内部名到用户可见文案的对照表统一放在 `BLOCK_RULE_LABELS` 中，这样通知、日志、测试都从同一处取值，不必各维护一份。`itemListMessage()` 最多展示前 5 项；开屏和启动资源等专用通知由各自的展示函数限制条目数量。

日志由 `log()` 按照等级输出，具体的等级定义见 `LogLevel`。低于 `logLevel` 的调用会被丢弃，生产环境默认 `warn`。

## 错误处理

- **结构缺失**：各处理器在响应数据不符合预期（比如缺少 `data`）时记录 info 日志并原样返回，不抛错。
- **protobuf 解析**：`tryParseFields` 与多处 `try/catch` 保证局部解析失败不会中断整体流程。
- **顶层兜底**：`main()` 外层 `.catch()` 捕获所有未处理异常，根据 URL 推断页面名称；启用 `notifyRemove` 或 `notifyFilter` 时发送「脚本错误」通知，随后通过 `$done({})` 原样放行上游响应。

## 接口与处理器对照表

| URL 特征（正则片段） | 处理器 | 响应类型 | 说明 |
| --- | --- | --- | --- |
| `/x/v2/splash/(show\|list\|brand/list\|brand/show\|event/list\|event/list2\|ad/list\|topview/list)\?` | `handleSplashResponse` | JSON | `/splash/list` 返回 `"OK"`（非 JSON）以阻止创意缓存刷新；`/splash/show`、`/splash/event/list2` 只清空 `show`/`event_list`（保留会话字段）；其余开屏端点清空广告数组 |
| `/x/resource/(show/tab/v2\|show/skin\|peak/download)\?` | `handleStartupAdsResponse` | JSON | 清理启动活动 Tab、皮肤装扮和预加载资源；`show/tab/v2` 还分别处理游戏按钮与底部按钮，顶部分区过滤仅调用 iOS 模块 |
| `/x/v2/account/mine\?` | `handleIosMinePageResponse` | JSON | iOS 我的页面模块 |
| `/x/v2/account/mine/ipad\?` | `handleIpadMinePageResponse` | JSON | iPadOS 创作中心与我的服务入口组 |
| `/x/vip/ads/materials\?` | `handleIpadVipAdsMaterialsResponse` | JSON | iPadOS 专属处理器；与启动推广共用 `cleanStartupAds` 开关，清空 `data.list`、`data.list_v2` 并移除 `vip_login_coupon.login_layer`，保留其他字段 |
| `/x/v2/search/square\?` | `handleSearchSquareResponse` | JSON | 首页搜索页模块 |
| `bilibili.app.interface.v1.Search/DefaultWords` | `handleSearchDefaultWordsResponse` | gRPC | 搜索框滚动推荐词 |
| `bilibili.app.interface.v1.Search/Suggest3` | `handleSearchSuggestResponse` | gRPC | 搜索候选词条 |
| `bilibili.polymer.app.search.v1.Search/SearchAll` | `handleSearchAllResponse` | gRPC | 搜索结果 |
| `/x/v2/feed/index/story\?` | `handleVideoFeedIndex` | JSON | 视频推荐流（JSON 入口） |
| `/x/v2/feed/index\?` | `filterHomeFeedIndex` | JSON | 首页推荐页 |
| `bilibili.app.viewunite.v1.View/View` | `handleIosViewResponse` | gRPC | iOS 视频详情页；开启深度屏蔽后缓存 Tag |
| `bilibili.app.viewunite.v1.View/RelatesFeed` | `handleIosRelatesFeedResponse` | gRPC | iOS 视频页推荐流（gRPC 入口） |
| `bilibili.app.view.v1.View/View` | `handleIpadViewResponse` | gRPC | iPadOS 旧版视频详情页与相关推荐；开启深度屏蔽后缓存 Tag |
| `bilibili.app.dynamic.v2.Dynamic/DynAll` | `handleDynamicAllResponse` | gRPC | 动态页，同时控制「最常访问」列表是否显示 |
| `bilibili.main.community.reply.v1.Reply/MainList` | `handleReplyMainListResponse` | gRPC | 评论区置顶广告 |
| `api.live.bilibili.com/xlive/(.../feed\|getInfoByRoom\|getInfoByUser\|get_shopping_info)\?` | `handleLiveAdsResponse` | JSON | 直播间信息流、房间页广告以及电商购物信息 |
| `api.bilibili.com/x/pd-proxy/tracker\?` | `handlePdProxyTrackerResponse` | JSON | STUN/追踪服务器改写为失效地址 |
| `bilibili.app.interface.v1.Teenagers/ModeStatus` | `handleTeenagersResponse` | gRPC | 青少年模式关闭（mock 固定字节） |
| `bilibili.app.(view.v1.View/TFInfo|viewunite.v1.View/(PlayPause|ViewEndPage))` | `handleInteractiveDanmakuResponse` | gRPC | 交互式弹幕清空（mock 固定字节） |
| `bilibili.app.show.v1.Popular/Index` | `handleHomePopularIndex` | gRPC | 首页热门 |

### 常开 `[Rule]`

以下规则不进入 JS 处理，也不提供参数开关：

| 规则 | 作用 |
| --- | --- |
| `api/app.biliapi.com|net` REJECT | 拦截数据上报/追踪域名（不影响 `grpc.biliapi.net`） |
| `chat.bilibili.com` stun/tracker REJECT | 拦截 WebRTC stun 追踪请求 |

## 测试

测试按功能拆分为 `testcases/*.test.js`。`test_context.js` 提供轻量测试注册器、匿名化样本和 VM 运行环境，`run_bilibili_cleaner_tests.js` 自动发现测试套件并依次执行。VM 会注入模拟的 `$request`、`$response`、`$persistentStore`、`$httpClient` 等对象，对返回的响应和通知做断言，覆盖各接口的屏蔽、清理、缓存以及并发行为。`ipados.test.js` 另外覆盖旧版 View 字段、iPadOS 首页卡片类型、首页顶部分区平台隔离、`mine/ipad` 与大会员广告素材结构。

运行：

```bash
npm test
```

`npm test` 会检查生成文件同步状态、JavaScript 语法，并由 `testcases/run_bilibili_cleaner_tests.js` 自动发现和执行全部 `*.test.js`。修改脚本逻辑、参数或路由后应当运行完整测试。

## 局域网测试

在本目录启动 HTTP 服务：

```bash
python3 -m http.server 8787 --bind 0.0.0.0
```

局域网测试时使用 `bilibili` 项目根目录的 `bilibili_cleaner.lan.lpx`，该文件随仓库维护，保留本机 HTTP `script-path`，入口和参数必须与正式版保持同步。当前脚本地址示例（请把 `<局域网 IP>` 换成本机 IP）：

```text
http://<局域网 IP>:8787/bilibili_cleaner.js?v=<版本号>
```

如果本机局域网 IP 或测试端口变了，只改 LAN 版 `script-path` 的主机或端口部分即可；其他配置仍然和正式版保持一致。修改脚本后，需要确认正式版和 LAN 版脚本地址的版本号都已更新。

## 配置同步

正式版 `bilibili_cleaner.lpx` 使用 GitHub raw `script-path`，LAN 版 `bilibili_cleaner.lan.lpx` 使用本机 HTTP `script-path`。两份配置除了 `#!name` 和 `script-path` 之外必须保持一致，包括：

- `#!desc` 全文，包含 `注：` 之后的说明。
- `[Argument]` 参数定义。
- `[Script]` 入口、正则、按处理器裁剪的参数列表、`enable`、`requires-body` 和 `binary-body-mode`。
- `[MitM]` 域名列表。
- 脚本地址版本号。

`testcases/plugin-config.test.js` 会检查两份配置同步、各路由所需参数及参数顺序，并由测试入口自动加载。修改入口或参数时，必须同步更新两份配置和对应断言。

## 发布前的检查清单

发布或者提交代码之前，按顺序确认以下事项：

1. `npm test`
2. `bilibili_cleaner.lpx` 和 `bilibili_cleaner.lan.lpx` 版本号一致。
3. `[MitM]` 只保留实际脚本拦截的域名。
4. 测试样本不包含真实标题、UP 主名称、账号标识或设备标识。
