import { defineConfig } from "tsup";

// eslint-disable-next-line import/no-default-export -- tsup reads the default export
export default defineConfig({
  entry: ["src/*.ts"],
  format: "esm",
  outDir: "build",
  platform: "node",
  target: "es2024",
  dts: true,
  sourcemap: true,
  // shared chunks instead of duplicating modules into every entry
  splitting: true,
  clean: true,
});
