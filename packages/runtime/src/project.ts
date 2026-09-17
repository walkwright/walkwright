import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, relative } from "node:path";

import { configPath, ensureWalkwrightDir, projectDir, tryGit } from "./paths.js";

export const defaultReportsUrl = "https://app.walkwright.dev";

export interface WalkwrightConfig {
  url: string;
  project: string;
  token: string;
}

export function describeConfigPath(cwd = process.cwd()): string {
  return relative(cwd, configPath(cwd)) || configPath(cwd);
}

export function readWalkwrightConfig(
  cwd = process.cwd(),
): WalkwrightConfig | undefined {
  const path = configPath(cwd);

  if (!existsSync(path)) {
    return undefined;
  }

  const raw = JSON.parse(
    readFileSync(path, "utf8"),
  ) as Partial<WalkwrightConfig>;

  if (typeof raw.project !== "string" || typeof raw.token !== "string") {
    throw new Error(`${path} is missing "project" or "token"`);
  }

  if (raw.url !== undefined && typeof raw.url !== "string") {
    throw new Error(`${path} has a non-string "url"`);
  }

  return {
    url: raw.url ?? defaultReportsUrl,
    project: raw.project,
    token: raw.token,
  };
}

export function writeWalkwrightConfig(
  config: WalkwrightConfig,
  cwd = process.cwd(),
): string {
  ensureWalkwrightDir(cwd);

  const path = configPath(cwd);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);

  return path;
}

export function currentBranch(cwd = process.cwd()): string {
  const override = process.env["WALKWRIGHT_BRANCH"];

  if (override !== undefined && override !== "") {
    return override;
  }

  const branch = tryGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);

  return branch === undefined || branch === "HEAD" ? "unknown" : branch;
}

export function repoName(cwd = process.cwd()): string {
  const url = tryGit(cwd, ["remote", "get-url", "origin"]);
  const match = url === undefined ? null : /([^/:]+?)(\.git)?\/?$/.exec(url);

  return match?.[1] !== undefined && match[1] !== ""
    ? match[1]
    : basename(projectDir(cwd));
}
