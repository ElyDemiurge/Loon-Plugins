const {
  assert,
  fs,
  LPX_PATH,
  LAN_LPX_PATH,
  test,
  normalizeLpxForSync,
} = require("./test_context");
const { checkCleanerBuild } = require("../build_bilibili_cleaner");

/* -------------------------------------------------------------------------- */
/* 插件配置                                                                   */
/* -------------------------------------------------------------------------- */

test("构建产物：bilibili_cleaner.js 与源码模块保持同步", () => {
  assert.equal(checkCleanerBuild(), true);
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

  assert.match(official, /script-path=[^,]*\?v=20260717-109,/);
  assert.match(lan, /script-path=[^,]*\?v=20260717-109,/);
  assert.match(official, /^cleanHomeGameButton=switch, true, false,/m);
  assert.match(official, /^cleanHomeTopTabs=switch, true, false,/m);
  assert.match(official, /^#!loon_version=3\.4\.0\(962\)$/m);
  assert.match(lan, /^#!loon_version=3\.4\.0\(962\)$/m);
});
