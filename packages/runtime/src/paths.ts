import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const walkwrightDirName = ".walkwright";

const ignoreFile = ["*", "!config.json", ""].join("\n");

export function tryGit(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

export function projectDir(cwd = process.cwd()): string {
  for (let dir = cwd; ; dir = dirname(dir)) {
    if (
      existsSync(join(dir, walkwrightDirName)) ||
      existsSync(join(dir, "package.json"))
    ) {
      return dir;
    }

    if (dirname(dir) === dir) {
      return cwd;
    }
  }
}

export function walkwrightDir(cwd = process.cwd()): string {
  return join(projectDir(cwd), walkwrightDirName);
}

export function ensureWalkwrightDir(cwd = process.cwd()): string {
  const dir = walkwrightDir(cwd);
  const ignore = join(dir, ".gitignore");

  mkdirSync(dir, { recursive: true });

  if (!existsSync(ignore)) {
    writeFileSync(ignore, ignoreFile);
  }

  return dir;
}

export function configPath(cwd = process.cwd()): string {
  return join(walkwrightDir(cwd), "config.json");
}

export function reportsDir(cwd = process.cwd()): string {
  return join(walkwrightDir(cwd), "reports");
}

export type StoreScope = "worker" | "project";

export function storeDir(
  scope: StoreScope = "worker",
  cwd = process.cwd(),
): string {
  return join(
    walkwrightDir(cwd),
    "store",
    scope === "project"
      ? "shared"
      : `worker-${process.env["TEST_PARALLEL_INDEX"] ?? "0"}`,
  );
}
