const fs = require("fs");
const path = require("path");
const { tests } = require("./test_context");

const suiteFiles = fs.readdirSync(__dirname)
  .filter((name) => name.endsWith(".test.js"))
  .sort();
for (const file of suiteFiles) {
  require(path.join(__dirname, file));
}

async function main() {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok - ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`not ok - ${name}`);
      console.error(error.stack || error);
    }
  }

  if (failed) {
    console.error(`${failed}/${tests.length} test(s) failed`);
    process.exitCode = 1;
    return;
  }

  console.log(`${tests.length}/${tests.length} test(s) passed`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
