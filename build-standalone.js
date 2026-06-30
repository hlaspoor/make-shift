const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
const game = fs.readFileSync(path.join(root, "src", "game.js"), "utf8");
const main = fs.readFileSync(path.join(root, "src", "main.js"), "utf8").replace('import "./game.js";\n\n', "");

let tablebase = "";
const tablebasePath = path.join(root, "tablebase-data.js");
if (fs.existsSync(tablebasePath)) tablebase = fs.readFileSync(tablebasePath, "utf8");

let html = index
  .replace('<link rel="icon" type="image/svg+xml" href="/favicon.svg">\n', "")
  .replace('  <link rel="stylesheet" href="/src/styles.css">\n', `  <style>\n${css}\n  </style>\n`)
  .replace('  <script src="/tablebase-data.js"></script>\n', `  <script>\n${tablebase || "self.MAKE_SHIFT_TABLEBASE=null;"}\n  </script>\n`)
  .replace('  <script type="module" src="/src/main.js"></script>\n', `  <script>\n${game}\n  </script>\n  <script type="module">\n${main}\n  </script>\n`);

html = html.replaceAll('href="/', 'href="');
html = html.replaceAll('src="/', 'src="');
html = html.replaceAll('url("/', 'url("');

fs.writeFileSync(path.join(root, "make-shift.html"), html);
console.log("Wrote make-shift.html");
