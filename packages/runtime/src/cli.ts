#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";

import { ensureProject, login } from "./device-auth.js";
import {
  defaultReportsUrl,
  describeConfigPath,
  readWalkwrightConfig,
  repoName,
  writeWalkwrightConfig,
} from "./project.js";
import {
  blank,
  bold,
  failure,
  glyph,
  line,
  logo,
  paint,
  wordmark,
} from "./ui.js";

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "walk":
    await walkCommand(args);
    break;
  case "login":
    await loginCommand(args);
    break;
  case "--version":
  case "-v":
    banner();
    break;
  case undefined:
  case "--help":
  case "-h":
  case "?":
    help();
    break;
  default:
    fail(`unknown command ${command}`, "walkwright --help lists the commands");
}

function version(): string {
  const { version: value } = createRequire(import.meta.url)(
    "../package.json",
  ) as { version: string };

  return value;
}

function banner(): void {
  blank();

  for (const row of logo()) {
    line(row);
  }

  blank();
  line(paint("dim", `   walkwright ${version()}`));
  blank();
}

function help(): void {
  const flag = (name: string, text: string): string =>
    `  ${paint("code", name.padEnd(20))}${paint("dim", text)}`;
  const header = (text: string): string => paint("accent", text);

  blank();
  line(`${wordmark()} ${paint("dim", version())}`);
  blank();
  line(header("USAGE"));
  line(
    `  ${paint("text", "walkwright walk")} ${paint("dim", "[flags] [playwright args...]")}`,
  );
  line(
    `  ${paint("text", "walkwright login")} ${paint("dim", "[--force] [--url <server>]")}`,
  );
  blank();
  line(header("WALK"));
  line(
    flag(
      "--upload-on-fail",
      "upload the passing lanes even though the walk failed",
    ),
  );
  line(flag("--no-upload", "skip the upload"));
  line(flag("--branch <name>", "report under this branch instead of git's"));
  line(
    flag("--project <name>", "the playwright project to run (default walk)"),
  );
  line(flag("--", "everything after goes to playwright"));
  blank();
  line(header("LOGIN"));
  line(flag("--force", "log in again"));
  line(
    flag("--url <server>", `the review console (default ${defaultReportsUrl})`),
  );
  blank();
  line(header("ALSO"));
  line(flag("--version", "the banner"));
  line(flag("--help, -h, ?", "this"));
  blank();
}

async function loginCommand(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h") || args.includes("?")) {
    help();
    return;
  }

  const existing = readWalkwrightConfig();
  const configFile = describeConfigPath();

  if (existing !== undefined && !args.includes("--force")) {
    line(
      paint("ok", glyph.ok),
      ` already set up ${paint("dim", glyph.dot)} project ${bold(existing.project)}`,
    );
    line(paint("dim", `  ${configFile} ${glyph.dot} --force to log in again`));
    return;
  }

  const url = urlArg(args) ?? defaultReportsUrl;

  try {
    const sessionToken = await login(url);
    const project = await ensureProject(url, sessionToken, repoName());

    writeWalkwrightConfig({ url, ...project });
    line(
      paint("ok", glyph.ok),
      ` wrote ${paint("code", configFile)} ${paint("dim", glyph.dot)} project ${bold(project.project)}`,
    );
  } catch (error) {
    failure(describe(error), "run walkwright login again");
    process.exit(1);
  }
}

async function walkCommand(args: string[]): Promise<void> {
  let uploadOnFail = false;
  let noUpload = false;
  let branch: string | undefined;
  let project: string | undefined;
  const forwarded: string[] = [];

  let index = 0;
  let own = true;

  while (index < args.length) {
    const arg = args[index];

    if (arg === undefined) {
      break;
    }

    if (!own) {
      forwarded.push(arg);
      index += 1;
      continue;
    }

    switch (arg) {
      case "--":
        own = false;
        index += 1;
        break;
      case "--help":
      case "-h":
      case "?":
        help();
        return;
      case "--upload-on-fail":
        uploadOnFail = true;
        index += 1;
        break;
      case "--no-upload":
        noUpload = true;
        index += 1;
        break;
      case "--branch":
        branch = requiredValue(args, index, arg);
        index += 2;
        break;
      case "--project":
        project = requiredValue(args, index, arg);
        index += 2;
        break;
      default:
        forwarded.push(arg);
        index += 1;
    }
  }

  if (uploadOnFail && noUpload) {
    fail(
      "--upload-on-fail and --no-upload cannot be used together",
      "pick one",
    );
  }

  const resolver = createRequire(join(process.cwd(), "package.json"));

  let playwrightCli: string;

  try {
    playwrightCli = resolver.resolve("@playwright/test/cli");
  } catch {
    fail(
      "@playwright/test is not installed in this project",
      "pnpm add -D @playwright/test, then run walkwright walk again",
    );
  }

  const env: NodeJS.ProcessEnv = { ...process.env };
  env["WALK_RECORDING"] = "1";

  if (uploadOnFail) {
    env["WALKWRIGHT_UPLOAD_ON_FAIL"] = "1";
  }

  if (noUpload) {
    env["WALKWRIGHT_NO_UPLOAD"] = "1";
  }

  if (branch !== undefined) {
    env["WALKWRIGHT_BRANCH"] = branch;
  }

  const exitCode = await runPlaywright(playwrightCli, project, forwarded, env);
  process.exit(exitCode);
}

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];

  if (value === undefined || value.startsWith("--")) {
    fail(`${flag} needs a value`, `walkwright walk ${flag} <value>`);
  }

  return value;
}

async function runPlaywright(
  playwrightCli: string,
  project: string | undefined,
  forwarded: string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
  return await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [playwrightCli, "test", `--project=${project ?? "walk"}`, ...forwarded],
      { stdio: "inherit", env, cwd: process.cwd() },
    );

    child.on("error", (error) => {
      reject(error);
    });

    child.on("exit", (exitCode) => {
      resolve(exitCode ?? 1);
    });
  });
}

function urlArg(args: string[]): string | undefined {
  const index = args.indexOf("--url");

  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1];

  if (value === undefined || value.startsWith("--")) {
    fail("--url needs a value", "walkwright login --url https://…");
  }

  return value;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fail(message: string, hint: string): never {
  failure(message, hint);
  process.exit(1);
}
