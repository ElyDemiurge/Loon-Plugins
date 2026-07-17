const fs = require("fs");
const path = require("path");

// 构建脚本位于项目根目录，源码模块与生成文件都以此目录为基准定位。
const ROOT = __dirname;
const MODULES_DIR = path.join(ROOT, "modules");
const OUTPUT_PATH = path.join(ROOT, "bilibili_cleaner.js");
const GENERATED_BANNER = [
  "/*",
  " * 此文件由 build_bilibili_cleaner.js 从 modules 模块生成。",
  " * 请修改模块源码后重新构建，不要直接编辑此文件。",
  " */",
  "",
].join("\n");

// 模块按运行时依赖顺序拼接；新增模块时应同时更新 TECH.md 中的职责表。
const MODULE_FILES = [
  "config.js",
  "runtime-protobuf.js",
  "filter-rules.js",
  "tag-cache.js",
  "protobuf-tools.js",
  "video-search.js",
  "reply.js",
  "json-page-handlers.js",
  "live-and-modes.js",
  "dynamic.js",
  "home-feed.js",
  "entry.js",
];

// 生成 Loon 可直接执行的单文件源码，不插入模块加载器或额外作用域。
function buildCleanerSource() {
  return GENERATED_BANNER + MODULE_FILES
    .map((file) => fs.readFileSync(path.join(MODULES_DIR, file), "utf8"))
    .join("");
}

// 校验已提交的生成文件是否与当前模块源码逐字一致。
function checkCleanerBuild() {
  const generated = buildCleanerSource();
  const current = fs.readFileSync(OUTPUT_PATH, "utf8");
  if (current !== generated) {
    throw new Error(
      "bilibili_cleaner.js 与 modules 模块不同步，请运行 node build_bilibili_cleaner.js"
    );
  }
  return true;
}

// 将当前模块源码重新写入根目录生成文件。
function writeCleanerBuild() {
  const generated = buildCleanerSource();
  fs.writeFileSync(OUTPUT_PATH, generated);
  return generated;
}

if (require.main === module) {
  try {
    if (process.argv.includes("--check")) {
      checkCleanerBuild();
      console.log("bilibili_cleaner.js is up to date");
    } else {
      writeCleanerBuild();
      console.log(`built ${path.relative(ROOT, OUTPUT_PATH)}`);
    }
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = {
  MODULE_FILES,
  GENERATED_BANNER,
  OUTPUT_PATH,
  MODULES_DIR,
  buildCleanerSource,
  checkCleanerBuild,
  writeCleanerBuild,
};
