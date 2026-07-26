const {
  assert,
  fs,
  LPX_PATH,
  LAN_LPX_PATH,
  test,
  normalizeLpxForSync,
} = require("./test_context");
const path = require("path");
const {
  CORE_MODULE_FILES,
  CORE_MODULES_DIR,
  checkCleanerBuild,
} = require("../build_bilibili_cleaner");

/* -------------------------------------------------------------------------- */
/* Plugin configuration                                                       */
/* -------------------------------------------------------------------------- */

test("构建产物：bilibili_cleaner.js 与源码模块保持同步", () => {
  assert.equal(checkCleanerBuild(), true);
});

test("模块结构：共用、iOS 与 iPadOS 代码位于指定目录", () => {
  assert.equal(path.basename(CORE_MODULES_DIR), "core_modules");
  assert.equal(fs.existsSync(path.join(CORE_MODULES_DIR, "Common")), true);
  assert.equal(fs.existsSync(path.join(CORE_MODULES_DIR, "iOS")), true);
  assert.equal(fs.existsSync(path.join(CORE_MODULES_DIR, "iPadOS")), true);
  assert.equal(fs.existsSync(path.resolve(__dirname, "..", "modules")), false);
  assert.ok(CORE_MODULE_FILES.some((file) => file.startsWith("Common/")));
  assert.ok(CORE_MODULE_FILES.some((file) => file.startsWith("iOS/")));
  assert.ok(CORE_MODULE_FILES.some((file) => file.startsWith("iPadOS/")));
});

test("插件配置：正式版和 LAN 版除名称与脚本地址外保持同步", () => {
  const official = fs.readFileSync(LPX_PATH, "utf8");
  const lan = fs.readFileSync(LAN_LPX_PATH, "utf8");
  const removedFeaturePattern = /PlayHalf|PlayView|dataflow|data\.bilibili|log\/mobile/;

  assert.equal(normalizeLpxForSync(lan), normalizeLpxForSync(official));
  assert.doesNotMatch(official, removedFeaturePattern);
  assert.doesNotMatch(lan, removedFeaturePattern);

  assert.match(official, /^hostname=grpc\.biliapi\.net, app\.bilibili\.com, api\.bilibili\.com, api\.live\.bilibili\.com$/m);
  assert.match(lan, /^hostname=grpc\.biliapi\.net, app\.bilibili\.com, api\.bilibili\.com, api\.live\.bilibili\.com$/m);

  assert.match(official, /\[Rule\][\s\S]*DOMAIN, api\.biliapi\.com, REJECT[\s\S]*chat\.bilibili\.com[\s\S]*stun[\s\S]*\[Script\]/);
  assert.doesNotMatch(official, /\[Rewrite\]/);
  assert.doesNotMatch(lan, /\[Rewrite\]/);

  assert.match(official, /pd-proxy[^\n]*tracker[^\n]*argument=/);
  assert.match(official, /Teenagers[^\n]*ModeStatus[^\n]*argument=/);
  assert.match(official, /TFInfo[^\n]*argument=/);
  assert.match(official, /get_shopping_info/);
  assert.match(official, /^#!system=iOS, iPadOS$/m);
  assert.match(official, /^#!date=2026-07-26$/m);
  assert.doesNotMatch(official, /^cleanVipAds=/m);
  assert.doesNotMatch(lan, /^cleanVipAds=/m);

  const scriptLines = official.split("\n").filter((line) => line.startsWith("http-response "));
  assert.equal(scriptLines.length, 21);
  for (const line of scriptLines) {
    const argumentList = line.match(/argument=\[([^\]]*)\]/)?.[1] || "";
    assert.equal((argumentList.match(/\{[^}]+\}/g) || []).length, 39);
    assert.match(argumentList, /\{cleanStartupAds\}/);
    assert.doesNotMatch(argumentList, /\{cleanVipAds\}/);
  }

  const scriptByTag = Object.fromEntries(scriptLines.map((line) => [
    line.match(/, tag=(.+)$/)?.[1],
    line,
  ]));
  const enabledRoutes = {
    "开屏广告移除": "cleanSplashAds",
    "iPadOS 大会员广告素材清理": "cleanStartupAds",
    "搜索框推荐词移除": "cleanSearchDefaultWords",
    "评论区置顶广告移除": "cleanReplyTopAds",
    "直播间广告移除": "cleanLiveAds",
    "追踪参数清理": "blockTrackers",
    "青少年模式关闭": "cleanTeenagersMode",
    "交互式弹幕移除": "cleanInteractiveDanmaku",
  };
  assert.equal(scriptLines.filter((line) => /enable=\{[^}]+\}/.test(line)).length, 8);
  for (const [tag, switchName] of Object.entries(enabledRoutes)) {
    assert.match(scriptByTag[tag], new RegExp(`enable=\\{${switchName}\\}`));
  }
  assert.doesNotMatch(scriptByTag["青少年模式关闭"], /requires-body|binary-body-mode/);
  assert.doesNotMatch(scriptByTag["交互式弹幕移除"], /requires-body|binary-body-mode/);

  assert.match(official, /account\\\/mine\\\/ipad\\\?[^\n]*requires-body=true, tag=iPadOS 我的页面个性化清理/);
  assert.match(official, /vip\\\/ads\\\/materials\\\?[^\n]*requires-body=true, enable=\{cleanStartupAds\}, tag=iPadOS 大会员广告素材清理/);
  assert.match(official, /bilibili\\\.app\\\.view\\\.v1\\\.View\\\/View\$[^\n]*requires-body=true, binary-body-mode=true, tag=iPadOS 视频页移除与 Tag 缓存/);

  assert.match(official, /script-path=[^,]*\?v=20260726-112,/);
  assert.match(lan, /script-path=[^,]*\?v=20260726-112,/);
  assert.match(official, /^cleanHomeGameButton=switch, true, false,/m);
  assert.match(official, /^cleanHomeTopTabs=switch, true, false,/m);
  assert.match(official, /^#!loon_version=3\.4\.0\(962\)$/m);
  assert.match(lan, /^#!loon_version=3\.4\.0\(962\)$/m);
});
