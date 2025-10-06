import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: "esm",
  outDir: "dist",
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  platform: "node",
  target: ["node20"],
  tsconfig: "tsconfig.json"
});
