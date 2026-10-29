import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
await build({
  entryPoints: ["ui/vendor.mjs"],
  outfile: "web/ui-vendor.js",
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2020"],
  legalComments: "eof",
});
const files = [
  "node_modules/lucide/LICENSE",
  "node_modules/@floating-ui/dom/LICENSE",
  "node_modules/@floating-ui/core/LICENSE",
  "node_modules/@floating-ui/utils/LICENSE",
];
let notices =
  "# UI dependency notices\n\nBundled locally in web/ui-vendor.js. Runtime does not require npm or a CDN.\n";
for (const file of files) {
  notices +=
    "\n## " +
    file.replace("node_modules/", "") +
    "\n\n" +
    (await readFile(file, "utf8")) +
    "\n";
}
await writeFile("THIRD_PARTY_NOTICES.md", notices.trimEnd() + "\n");
