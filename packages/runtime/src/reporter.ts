import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

import { ensureWalkwrightDir, reportsDir } from "./paths.js";
import type { WalkwrightConfig } from "./project.js";
import {
  currentBranch,
  describeConfigPath,
  readWalkwrightConfig,
  repoName,
} from "./project.js";
import type { RecordedShots, ShotRecord } from "./recorder.js";
import { describeError, runDirVariable, shotsAttachment } from "./recorder.js";
import type { Manifest, State, Subject } from "./schema.js";
import { manifestSchema, manifestVersion } from "./schema.js";
import {
  blank,
  bold,
  box,
  columns,
  count,
  duration,
  failure,
  glyph,
  line,
  pad,
  paint,
  progress,
  status,
  transient,
  width,
} from "./ui.js";
import { uploadRun } from "./upload.js";

export interface ReporterOptions {
  appUrl: string;
  reportsDir?: string;
}

interface Recorded {
  test: string;
  lane: string;
  shots: RecordedShots;
}

interface WalkFailure {
  step: string;
  lane: string;
}

interface TreePage {
  name: string;
  group?: string[];
  shots: number;
}

interface Folder {
  name: string;
  folders: Folder[];
  pages: TreePage[];
}

export default class WalkwrightReporter implements Reporter {
  readonly #appUrl: string;
  readonly #startedAt = new Date();
  readonly #runDir: string;
  readonly #recorded: Recorded[] = [];
  readonly #failures = new Map<string, WalkFailure>();

  public constructor(options: ReporterOptions) {
    this.#appUrl = options.appUrl;

    if (options.reportsDir === undefined) {
      ensureWalkwrightDir();
    }

    this.#runDir = join(
      options.reportsDir ?? reportsDir(),
      `run-${this.#startedAt.toISOString().replace(/[:.]/g, "-")}`,
    );

    process.env[runDirVariable] = this.#runDir;
  }

  public onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status !== "passed") {
      if (result.status !== "skipped") {
        this.#failures.set(test.id, {
          step: test.title,
          lane: laneOf(test),
        });
      }

      return;
    }

    this.#failures.delete(test.id);

    for (const attachment of result.attachments) {
      if (
        attachment.name !== shotsAttachment ||
        attachment.body === undefined
      ) {
        continue;
      }

      this.#recorded.push({
        test: test.title,
        lane: laneOf(test),
        shots: JSON.parse(attachment.body.toString("utf8")) as RecordedShots,
      });
    }
  }

  public async onEnd(
    result: FullResult,
  ): Promise<{ status: FullResult["status"] } | undefined> {
    const failures = [...this.#failures.values()];

    if (this.#recorded.length === 0 && failures.length === 0) {
      blank();
      line(paint("dim", " no pages walked"));
      return undefined;
    }

    const elapsedMs = Date.now() - this.#startedAt.getTime();

    let manifest: Manifest;

    try {
      manifest = this.#manifest(elapsedMs);
    } catch (error) {
      blank();
      failure(
        describeError(error),
        "fix the lane and run walkwright walk again",
      );
      return { status: "failed" };
    }

    const branch = currentBranch();

    blank();

    for (const row of box(walkRows(treePages(this.#recorded), failures), {
      legend: "walk",
      title: `${repoName()} ${glyph.dot} ${branch}`,
      primary: true,
    })) {
      line(row);
    }

    const shots = manifest.subjects.reduce(
      (total, subject) =>
        total +
        subject.states.reduce(
          (stateTotal, state) => stateTotal + state.captures.length,
          0,
        ),
      0,
    );
    const summary = `${count(shots, "shot")} ${paint("dim", glyph.dot)} ${duration(elapsedMs)}`;
    const failed = result.status !== "passed";
    const walkFailed = paint("fail", `${glyph.fail} walk failed`);

    if (this.#recorded.length === 0) {
      line(status(summary, walkFailed, paint("dim", "nothing to upload")));
      return undefined;
    }

    mkdirSync(this.#runDir, { recursive: true });

    writeFileSync(
      join(this.#runDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );

    const runDir = paint("code", relative(process.cwd(), this.#runDir));

    if (shots === 0) {
      line(status(summary, paint("dim", "nothing to upload"), runDir));
      return undefined;
    }

    if (process.env["WALKWRIGHT_NO_UPLOAD"] === "1") {
      line(status(summary, paint("dim", "not uploaded (--no-upload)"), runDir));
      return undefined;
    }

    if (failed && process.env["WALKWRIGHT_UPLOAD_ON_FAIL"] !== "1") {
      line(status(summary, walkFailed, paint("dim", "not uploaded"), runDir));
      line(
        paint(
          "dim",
          "  walkwright walk --upload-on-fail uploads the passing lanes",
        ),
      );
      return undefined;
    }

    let config: WalkwrightConfig | undefined;

    try {
      config = readWalkwrightConfig();
    } catch (error) {
      line(
        status(
          summary,
          failed ? walkFailed : "",
          paint("dim", "not uploaded"),
          runDir,
        ),
      );
      failure(
        describeError(error),
        `fix ${describeConfigPath()} or delete it and run walkwright login`,
      );
      return { status: "failed" };
    }

    if (config === undefined) {
      line(
        status(
          summary,
          failed ? walkFailed : "",
          paint("dim", "not uploaded"),
          runDir,
        ),
      );
      line(
        paint(
          "dim",
          `  no ${describeConfigPath()} ${glyph.dot} walkwright login to upload`,
        ),
      );
      return undefined;
    }

    const kept = failed
      ? paint("warn", `${glyph.carried} kept ${this.#keptLanes().join(", ")}`)
      : "";

    if (!process.stdout.isTTY) {
      line(paint("dim", `  uploading ${count(shots, "shot")}`));
    }

    const files = [
      "manifest.json",
      ...manifest.subjects.flatMap((subject) =>
        subject.states.flatMap((state) =>
          state.captures.flatMap((capture) => Object.values(capture.files)),
        ),
      ),
    ];

    let uploaded: { url: string; number: number | undefined };

    try {
      uploaded = await uploadRun(
        config,
        branch,
        this.#runDir,
        files,
        uploadProgress,
      );
    } catch (error) {
      line(status(summary, failed ? walkFailed : "", kept));
      failure(
        describeError(error),
        "run walkwright walk again to retry the upload",
      );
      return { status: "failed" };
    }

    const as =
      uploaded.number === undefined
        ? "uploaded"
        : `uploaded as ${bold(`#${String(uploaded.number)}`)}`;
    const url = paint("accent", uploaded.url);
    const room = process.stdout.isTTY ? columns() - 1 : Infinity;

    for (const candidate of [
      status(summary, failed ? walkFailed : "", kept, as, url),
      status(summary, failed ? walkFailed : "", as, url),
    ]) {
      if (width(candidate) <= room) {
        line(candidate);
        return undefined;
      }
    }

    const head = status(summary, failed ? walkFailed : "", kept, as);

    line(
      width(head) <= room
        ? head
        : status(summary, failed ? walkFailed : "", as),
    );
    line(` ${url}`);

    return undefined;
  }

  #keptLanes(): string[] {
    return [
      ...new Set(
        this.#recorded
          .filter(({ shots }) => shots.shots.length > 0)
          .map(({ lane }) => lane),
      ),
    ];
  }

  #manifest(durationMs: number): Manifest {
    const subjects: Subject[] = [];
    const byPath = new Map<string, Subject>();
    const captured = new Map<string, string>();
    const files = new Map<string, string>();

    for (const { lane, shots } of this.#recorded) {
      for (const shot of shots.shots) {
        const path = [...(shot.group ?? []), shot.page];
        const pathKey = JSON.stringify(path);
        const name = shot.state === "" ? "default" : shot.state;
        const identityKey = `${pathKey}#${name}`;

        const identityLane = captured.get(identityKey);

        if (identityLane !== undefined) {
          if (identityLane !== lane) {
            throw new Error(
              `"${identityLane}" and "${lane}" both captured ${describeShot(shot)} — record it in one lane, or give one of them another state`,
            );
          }

          throw new Error(
            `"${lane}" captured ${describeShot(shot)} twice — record it once, or give one of them another state`,
          );
        }

        captured.set(identityKey, lane);

        const fileLane = files.get(shot.file);

        if (fileLane !== undefined && fileLane !== lane) {
          throw new Error(
            `"${fileLane}" and "${lane}" both wrote ${shot.file} — rename one of the "${shot.page}" pages`,
          );
        }

        files.set(shot.file, lane);

        let subject = byPath.get(pathKey);

        if (subject === undefined) {
          const url =
            shot.path !== undefined && !shot.path.includes(":")
              ? shot.path
              : undefined;

          subject = {
            path,
            ...(url === undefined ? {} : { url }),
            states: [],
          };

          byPath.set(pathKey, subject);
          subjects.push(subject);
        }

        const state: State = {
          name,
          captures: [{ files: { image: shot.file } }],
        };

        subject.states.push(state);
      }
    }

    return manifestSchema.parse({
      version: manifestVersion,
      tool: "walkwright",
      url: this.#appUrl,
      startedAt: this.#startedAt.toISOString(),
      runStats: {
        duration: duration(durationMs),
        lanes: this.#keptLanes().length,
      },
      subjects,
    });
  }
}

function describeShot(shot: ShotRecord): string {
  const page =
    shot.path === undefined
      ? `"${shot.page}"`
      : `"${shot.page}" (${shot.path})`;

  return shot.state === "" ? page : `the "${shot.state}" state of ${page}`;
}

function laneOf(test: TestCase): string {
  return basename(test.location.file).replace(/(\.\w+)?\.ts$/, "");
}

function treePages(recorded: Recorded[]): TreePage[] {
  const byKey = new Map<string, TreePage>();
  const pages: TreePage[] = [];

  const keyOf = (group: string[] | undefined, name: string): string =>
    JSON.stringify([...(group ?? []), name]);

  for (const { shots } of recorded) {
    for (const page of shots.pages) {
      const key = keyOf(page.group, page.name);

      if (!byKey.has(key)) {
        const entry: TreePage = {
          name: page.name,
          ...(page.group === undefined ? {} : { group: page.group }),
          shots: 0,
        };

        byKey.set(key, entry);
        pages.push(entry);
      }
    }
  }

  for (const { shots } of recorded) {
    for (const shot of shots.shots) {
      const key = keyOf(shot.group, shot.page);
      let entry = byKey.get(key);

      if (entry === undefined) {
        entry = {
          name: shot.page,
          ...(shot.group === undefined ? {} : { group: shot.group }),
          shots: 0,
        };

        byKey.set(key, entry);
        pages.push(entry);
      }

      entry.shots += 1;
    }
  }

  return pages;
}

function walkRows(pages: TreePage[], failures: WalkFailure[]): string[] {
  const root = buildTree(pages);
  const rows: [label: string, note: string][] = [];

  const walk = (folder: Folder, depth: number): void => {
    const indent = "  ".repeat(depth);
    const entries = folder.pages;

    for (const [index, page] of entries.entries()) {
      const last = index === entries.length - 1 && folder.folders.length === 0;

      rows.push([
        `${indent}${paint("faint", last ? glyph.last : glyph.branch)} ${paint("text", page.name)}`,
        page.shots === 0
          ? paint("dim", "no shots")
          : `${paint("ok", glyph.ok)} ${paint("dim", count(page.shots, "shot"))}`,
      ]);
    }

    for (const child of folder.folders) {
      rows.push([
        `${indent}${paint("accent", glyph.open)} ${bold(paint("text", child.name))}`,
        "",
      ]);
      walk(child, depth + 1);
    }
  };

  walk(root, 0);

  const labelWidth = rows.reduce(
    (max, [label]) => Math.max(max, width(label)),
    0,
  );
  const out = rows.map(([label, note]) =>
    note === "" ? label : `${pad(label, labelWidth)}  ${note}`,
  );

  if (failures.length > 0) {
    if (out.length > 0) {
      out.push("");
    }

    for (const failed of failures) {
      out.push(
        `${paint("fail", `${glyph.fail} ${failed.lane}`)} ${paint("dim", glyph.dot)} ${paint("text", `"${failed.step}"`)} ${paint("fail", "failed")}`,
      );
    }
  }

  return out;
}

function buildTree(pages: TreePage[]): Folder {
  const root: Folder = { name: "", folders: [], pages: [] };

  for (const page of pages) {
    let folder = root;

    for (const name of page.group ?? []) {
      let next = folder.folders.find((child) => child.name === name);

      if (next === undefined) {
        next = { name, folders: [], pages: [] };
        folder.folders.push(next);
      }

      folder = next;
    }

    folder.pages.push(page);
  }

  sortFolder(root);

  return root;
}

function sortFolder(folder: Folder): void {
  folder.pages.sort((a, b) => compare(a.name, b.name));
  folder.folders.sort((a, b) => compare(a.name, b.name));

  for (const child of folder.folders) {
    sortFolder(child);
  }
}

function compare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function uploadProgress(done: number, total: number, file: string): void {
  const clear = transient(
    ` ${progress(done, total)} ${paint("dim", `uploading ${String(done)}/${String(total)}`)} ${paint("code", file)}`,
  );

  if (done === total) {
    clear();
  }
}
