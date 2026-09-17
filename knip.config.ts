import type { KnipConfig } from "knip";

export default {
  exclude: ["binaries", "dependencies", "devDependencies", "unlisted"],
  ignoreExportsUsedInFile: { interface: true, type: true },
  includeEntryExports: false,
  workspaces: {
    ".": {
      project: ["*.js", "*.ts"],
    },
    "packages/runtime": {
      // every module in `src` is a package export (see `exports` in
      // package.json), so the whole surface is an entry
      entry: ["src/*.ts"],
      project: ["src/**/*.ts", "bin/*.js"],
    },
    "packages/testbed": {
      entry: [
        "src/app/routes/*.tsx",
        "src/walk/*.walk.ts",
        "src/walk/*.setup.ts",
      ],
      project: ["src/**/*.{ts,tsx}", "*.ts"],
    },
  },
} satisfies KnipConfig;
