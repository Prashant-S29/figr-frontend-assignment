// Bundles the agent into the committed page-server asset; it never edits page HTML.
import { build, context } from "esbuild";

const options = {
  entryPoints: ["agent/src/index.ts"],
  outfile: "backend/pages/agent.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "none",
};

if (process.argv.includes("--watch")) {
  const watcher = await context(options);
  await watcher.watch();
} else {
  await build(options);
}
