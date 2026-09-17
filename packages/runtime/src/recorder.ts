import { mkdirSync } from "node:fs";

import type { Fixtures, Page, PlaywrightTestArgs } from "@playwright/test";

import type {
  AppDescriptor,
  ElementDescriptor,
  OverlayDescriptor,
  PageDescriptor,
  RegexDescriptor,
  SurfaceDescriptor,
} from "./descriptor.js";
import type {
  LocatorDescriptor,
  LocatorFilter,
  LocatorNode,
  Text as LocatorText,
  Refinement,
} from "./locator.js";
import { paramNamesOf, resolveLocator } from "./locator.js";
import type { PageMeta } from "./pom.js";

export interface ShotRecord {
  file: string;
  state: string;
  page: string;
  path?: string;
  group?: string[];
}

export interface Recorder {
  record: {
    <Target extends VisitablePage<never>>(
      target: PageOrFactory<Target>,
      state?: string,
      options?: ShotOptions,
    ): Promise<Target>;
    <Params, Target extends VisitablePage<Params>>(
      target: PageOrFactory<Target>,
      params: Params,
      state?: string,
      options?: ShotOptions,
    ): Promise<Target>;
    (dialog: OverlayDialog, options?: ShotOptions): Promise<void>;
    (
      state: string,
      dialog: OverlayDialog,
      options?: ShotOptions,
    ): Promise<void>;
    (state?: string, options?: ShotOptions): Promise<void>;
  };
  shots: () => ShotRecord[];
}

export interface ShotOptions {
  viewport?: { width?: number; height?: number };
  page?: string;
  group?: string[];
  state?: string;
}

export type PageFactory<Target> = (page: Page) => Target;

export type PageOrFactory<Target> = Target | PageFactory<Target>;

export interface VisitablePage<Params> {
  path: string;
  name: string;
  url: (params: Params) => string;
  goto: (params: Params) => Promise<void>;
}

export interface OverlayDialog {
  label?: string;
  waitFor: (state?: "visible" | "hidden") => Promise<unknown>;
  close: () => Promise<unknown>;
  descriptor?: OverlayDescriptor;
  self?: { chain: LocatorDescriptor };
}

interface Identity {
  page: string;
  path?: string;
  group?: string[];
  descriptor?: PageDescriptor;
}

interface CaptureOptions extends ShotOptions {
  path?: string;
}

interface RecorderOptions {
  enabled?: boolean;
}

const defaultTimeoutMs = 30_000;
const transitionSettleMs = 300;
const overlaySettleMs = 500;
const failedState = "failed";

function createRecorder(
  page: Page,
  runDir: string,
  descriptor: AppDescriptor,
  { enabled = true }: RecorderOptions = {},
): Recorder {
  page.setDefaultTimeout(defaultTimeoutMs);

  const pages = pageMetasOf(descriptor);
  const shots: ShotRecord[] = [];
  const usedNames = new Map<string, number>();

  const identityOf = (
    target: VisitablePage<never> | VisitablePage<unknown>,
    options?: ShotOptions,
  ): CaptureOptions => {
    const meta = pages.find((candidate) => candidate.path === target.path);
    const group = options?.group ?? meta?.group;

    return {
      ...options,
      page: options?.page ?? meta?.name ?? target.name,
      path: target.path,
      ...(group === undefined ? {} : { group }),
    };
  };

  const capture = async (
    state: string | undefined,
    options?: CaptureOptions,
    failure = false,
    dialog?: OverlayDialog,
  ): Promise<void> => {
    if (!enabled) {
      return;
    }

    const identity = identify(page.url(), descriptor.pages);
    const shotPage = options?.page ?? identity.page;
    const path =
      options?.path ??
      (options?.page === undefined ? identity.path : undefined);
    const group = options?.group ?? identity.group;
    const label = options?.state ?? state ?? "";

    const name = slugParts([group?.[0], shotPage, label]);

    const count = (usedNames.get(name) ?? 0) + 1;
    usedNames.set(name, count);

    const file = `${name}${count > 1 ? `-${String(count)}` : ""}.png`;

    if (!failure) {
      shots.push({
        file,
        state: label === "" ? "" : slugify(label),
        page: shotPage,
        ...(path === undefined ? {} : { path }),
        ...(group === undefined ? {} : { group }),
      });
    }

    const viewport = page.viewportSize();
    const resize = options?.viewport !== undefined && viewport !== null;
    if (resize) {
      await page.setViewportSize({
        width: options.viewport?.width ?? viewport.width,
        height: options.viewport?.height ?? viewport.height,
      });
    }

    try {
      await page.waitForTimeout(transitionSettleMs);

      const rules = collectRules(descriptor, identity.descriptor, dialog);

      try {
        if (rules.length > 0) {
          await applyCaptureRules(page, rules);
        }

        await page.screenshot({ path: `${runDir}/${file}`, fullPage: true });
      } finally {
        if (rules.length > 0) {
          await restoreCaptureRules(page).catch(() => undefined);
        }
      }
    } finally {
      if (resize) {
        await page.setViewportSize(viewport);
        await page.waitForTimeout(200);
      }
    }
  };

  const attempt = async <Result>(
    what: string,
    fn: () => Promise<Result>,
  ): Promise<Result> => {
    try {
      return await fn();
    } catch (error) {
      await capture(failedState, undefined, true).catch(() => undefined);

      throw new Error(`recording ${what}: ${describeError(error)}`, {
        cause: error,
      });
    }
  };

  const alreadyAt = (url: string): boolean => {
    try {
      return pathOf(page.url()) === pathOf(new URL(url, page.url()).href);
    } catch {
      return false;
    }
  };

  const visitPage = async <Params, Target extends VisitablePage<Params>>(
    target: PageOrFactory<Target>,
    params: Params,
    state?: string,
    options?: ShotOptions,
  ): Promise<Target> => {
    const visiting = instantiate(page, target);

    await attempt(describe(visiting.name, state), async () => {
      if (!alreadyAt(visiting.url(params))) {
        await visiting.goto(params);
      }

      await capture(state, identityOf(visiting, options));
    });

    return visiting;
  };

  const shootCurrentPage = async <Target extends VisitablePage<never>>(
    target: PageOrFactory<Target>,
    state?: string,
    options?: ShotOptions,
  ): Promise<Target> => {
    const shooting = instantiate(page, target);

    await attempt(describe(shooting.name, state), async () => {
      const path = pathOf(page.url());

      if (!patternFor(shooting.path).test(path)) {
        throw new Error(
          `the "${shooting.name}" page is at ${shooting.path}, but the browser is at ${path}`,
        );
      }

      await capture(state, identityOf(shooting, options));
    });

    return shooting;
  };

  const overlay = async (
    state: string,
    dialog: OverlayDialog,
    options?: ShotOptions,
  ): Promise<void> => {
    await attempt(`the "${state}" overlay`, async () => {
      await dialog.waitFor();
      await page.waitForTimeout(overlaySettleMs);
      await capture(state, options, false, dialog);
      await dialog.close();
      await page.waitForTimeout(overlaySettleMs);
    });
  };

  const record = (async (
    target?: string | PageOrFactory<VisitablePage<never>> | OverlayDialog,
    second?: unknown,
    third?: unknown,
    options?: ShotOptions,
  ) => {
    if (isPageTarget(target)) {
      if (second === undefined || typeof second === "string") {
        return await shootCurrentPage(
          target,
          second,
          third as ShotOptions | undefined,
        );
      }

      return await visitPage(
        target as PageOrFactory<VisitablePage<unknown>>,
        second,
        third as string | undefined,
        options,
      );
    }

    if (target !== undefined && typeof target !== "string") {
      await overlay(
        dialogState(target),
        target,
        second as ShotOptions | undefined,
      );

      return undefined;
    }

    if (isDialog(second)) {
      await overlay(
        target ?? dialogState(second),
        second,
        third as ShotOptions | undefined,
      );

      return undefined;
    }

    await capture(target, second as ShotOptions | undefined);
    return undefined;
  }) as Recorder["record"];

  return {
    record,
    shots: () => shots,
  };
}

export const runDirVariable = "WALKWRIGHT_RUN_DIR";

export const shotsAttachment = "walkwright-shots";

export interface RecordedShots {
  pages: PageMeta[];
  shots: ShotRecord[];
}

export interface RecorderFixtures {
  recording: boolean;
  runDir: string;
  record: Recorder["record"];
}

export interface RecordedApp {
  descriptor: AppDescriptor;
}

function pageMetasOf(descriptor: AppDescriptor): PageMeta[] {
  return descriptor.pages.map(({ name, path, recorder }) => ({
    name,
    path,
    ...(recorder?.group === undefined ? {} : { group: recorder.group }),
  }));
}

export function createRecorderFixtures(
  app: RecordedApp,
): Fixtures<RecorderFixtures, object, PlaywrightTestArgs> {
  return {
    recording: [false, { option: true }],

    runDir: async ({ recording }, use, testInfo): Promise<void> => {
      if (!recording) {
        await use(testInfo.outputDir);
        return;
      }

      const runDir = process.env[runDirVariable];

      if (runDir === undefined) {
        throw new Error(
          `no ${runDirVariable} in the environment — add walkwright's reporter to the Playwright config`,
        );
      }

      mkdirSync(runDir, { recursive: true });

      await use(runDir);
    },

    record: async (
      { page, runDir, recording },
      use,
      testInfo,
    ): Promise<void> => {
      const recorder = createRecorder(page, runDir, app.descriptor, {
        enabled: recording,
      });

      await use(recorder.record);

      if (!recording) {
        return;
      }

      const recorded: RecordedShots = {
        pages: pageMetasOf(app.descriptor),
        shots: recorder.shots(),
      };

      await testInfo.attach(shotsAttachment, {
        contentType: "application/json",
        body: Buffer.from(JSON.stringify(recorded)),
      });
    },
  };
}

function describe(name: string, state?: string): string {
  return state === undefined ? `the "${name}" page` : `"${name}" ${state}`;
}

function instantiate<Target>(
  page: Page,
  target: PageOrFactory<Target>,
): Target {
  return typeof target === "function"
    ? (target as PageFactory<Target>)(page)
    : target;
}

function isPageTarget(
  value: unknown,
): value is PageOrFactory<VisitablePage<never>> {
  if (typeof value === "function") {
    return true;
  }

  return (
    typeof value === "object" &&
    value !== null &&
    "goto" in value &&
    "path" in value
  );
}

function isDialog(value: unknown): value is OverlayDialog {
  return (
    typeof value === "object" &&
    value !== null &&
    "close" in value &&
    "waitFor" in value
  );
}

function dialogState(dialog: OverlayDialog): string {
  if (dialog.label === undefined) {
    throw new Error("the overlay needs an explicit state: it has no label");
  }

  return dialog.label;
}

function identify(url: string, pages: PageDescriptor[]): Identity {
  const path = pathOf(url);

  const matched = pages
    .filter((candidate) => patternFor(candidate.path).test(path))
    .sort(
      (a, b) =>
        paramCount(a.path) - paramCount(b.path) ||
        b.path.length - a.path.length,
    )
    .at(0);

  if (matched === undefined) {
    return { page: pathSlug(path) };
  }

  return {
    page: matched.name,
    path: matched.path,
    ...(matched.recorder?.group === undefined
      ? {}
      : { group: matched.recorder.group }),
    descriptor: matched,
  };
}

interface CollectedRule {
  scope: LocatorDescriptor;
  match?: RegexDescriptor;
  text: string;
}

function chainForElement(
  path: string[],
  root: LocatorDescriptor,
  elements: Record<string, ElementDescriptor>,
): LocatorDescriptor {
  let chain = root;
  let current = elements;

  for (const segment of path) {
    const found = current[segment];

    if (found === undefined) {
      throw new Error(`capture rule references unknown element "${segment}"`);
    }

    if ("locator" in found) {
      chain = [...chain, ...found.locator];
      continue;
    }

    if ("surface" in found) {
      chain = [...chain, ...(found.surface.root ?? [])];
      current = found.surface.elements;
      continue;
    }

    if ("overlay" in found) {
      chain = [...chain, ...found.overlay.root];
      current = found.overlay.elements;
      continue;
    }

    throw new Error(`capture rule targets "${segment}", which has no locator`);
  }

  return chain;
}

function collectAt(
  root: LocatorDescriptor,
  elements: Record<string, ElementDescriptor>,
  rule: { element?: string[]; match?: RegexDescriptor; text: string },
): CollectedRule {
  const chain =
    rule.element === undefined
      ? root
      : chainForElement(rule.element, root, elements);

  return {
    scope: widenChain(chain),
    ...(rule.match === undefined ? {} : { match: rule.match }),
    text: rule.text,
  };
}

function collectSurfaceRules(
  surface: SurfaceDescriptor,
  root: LocatorDescriptor,
  out: CollectedRule[],
): void {
  for (const element of Object.values(surface.elements)) {
    if ("surface" in element) {
      collectSurfaceRules(
        element.surface,
        [...root, ...(element.surface.root ?? [])],
        out,
      );
    } else if ("overlay" in element) {
      collectSurfaceRules(
        element.overlay,
        [...root, ...element.overlay.root],
        out,
      );
    }
  }

  for (const rule of surface.capture?.rules ?? []) {
    out.push(collectAt(root, surface.elements, rule));
  }
}

function collectRules(
  app: AppDescriptor,
  page: PageDescriptor | undefined,
  dialog: OverlayDialog | undefined,
): CollectedRule[] {
  const out: CollectedRule[] = [];

  if (dialog?.descriptor !== undefined && dialog.self !== undefined) {
    collectSurfaceRules(dialog.descriptor, dialog.self.chain, out);
  }

  if (page !== undefined) {
    collectSurfaceRules(page, [], out);
  }

  for (const rule of app.capture?.rules ?? []) {
    out.push({ scope: [], match: rule.match, text: rule.text });
  }

  return out;
}

function textCarriesParam(text: LocatorText | undefined): boolean {
  if (text === undefined) {
    return false;
  }

  return paramNamesOf([{ by: "text", text }]).length > 0;
}

function widenFilter(filter: LocatorFilter): LocatorFilter | undefined {
  const widened: LocatorFilter = {
    ...(filter.hasText === undefined || textCarriesParam(filter.hasText)
      ? {}
      : { hasText: filter.hasText }),
    ...(filter.has === undefined ? {} : { has: widenChain(filter.has) }),
    ...(filter.hasNot === undefined
      ? {}
      : { hasNot: widenChain(filter.hasNot) }),
  };

  return Object.keys(widened).length === 0 ? undefined : widened;
}

function widenRefinement(refinement: Refinement): Refinement | undefined {
  if ("nth" in refinement) {
    return refinement;
  }

  const filter = widenFilter(refinement.filter);
  return filter === undefined ? undefined : { filter };
}

function widenRefine(
  refine: Refinement[] | undefined,
): Refinement[] | undefined {
  if (refine === undefined) {
    return undefined;
  }

  const widened = refine
    .map(widenRefinement)
    .filter((refinement): refinement is Refinement => refinement !== undefined);

  return widened.length === 0 ? undefined : widened;
}

function widenNode(node: LocatorNode): LocatorNode | undefined {
  if ("or" in node) {
    return { or: node.or.map(widenChain) };
  }

  if ("and" in node) {
    return { and: node.and.map(widenChain) };
  }

  if (
    (node.by === "text" ||
      node.by === "label" ||
      node.by === "placeholder" ||
      node.by === "title") &&
    textCarriesParam(node.text)
  ) {
    return undefined;
  }

  const { refine, ...base } = node;
  const widenedRefine = widenRefine(refine);

  if (base.by === "role" && textCarriesParam(base.name)) {
    const { name, ...rest } = base;
    return {
      ...rest,
      ...(widenedRefine === undefined ? {} : { refine: widenedRefine }),
    };
  }

  return {
    ...base,
    ...(widenedRefine === undefined ? {} : { refine: widenedRefine }),
  };
}

function widenChain(chain: LocatorDescriptor): LocatorDescriptor {
  return chain
    .map(widenNode)
    .filter((node): node is LocatorNode => node !== undefined);
}

declare global {
  interface Window {
    __walkwrightRestore?: (() => void)[];
  }
}

function applyRule(
  nodes: (SVGElement | HTMLElement)[],
  rule: { text: string; match?: { pattern: string; flags: string } },
): void {
  function isField(
    node: Element,
  ): node is HTMLInputElement | HTMLTextAreaElement {
    return (
      node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
    );
  }

  function textNodesUnder(root: Node): Text[] {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (candidate) => {
        const parent = candidate.parentElement;
        return parent !== null &&
          (parent.tagName === "SCRIPT" || parent.tagName === "STYLE")
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT;
      },
    });

    const found: Text[] = [];
    for (
      let current = walker.nextNode();
      current !== null;
      current = walker.nextNode()
    ) {
      found.push(current as Text);
    }

    return found;
  }

  function pushRestore(undo: () => void): void {
    window.__walkwrightRestore ??= [];
    window.__walkwrightRestore.push(undo);
  }

  function write(
    get: () => string,
    set: (value: string) => void,
    value = rule.text,
  ): void {
    const previous = get();
    const next =
      rule.match === undefined
        ? value
        : previous.replace(
            new RegExp(rule.match.pattern, rule.match.flags),
            rule.text,
          );
    if (next === previous) {
      return;
    }
    set(next);
    pushRestore(() => {
      set(previous);
    });
  }

  function writeField(field: HTMLInputElement | HTMLTextAreaElement): void {
    write(
      () => field.value,
      (value) => {
        field.value = value;
      },
    );
  }

  function writeText(text: Text, value?: string): void {
    write(
      () => text.data,
      (next) => {
        text.data = next;
      },
      value,
    );
  }

  for (const node of nodes) {
    if (isField(node)) {
      writeField(node);
      continue;
    }

    const [first, ...rest] = textNodesUnder(node);

    if (rule.match !== undefined) {
      for (const text of first === undefined ? [] : [first, ...rest]) {
        writeText(text);
      }
      for (const field of node.querySelectorAll("input,textarea")) {
        writeField(field as HTMLInputElement | HTMLTextAreaElement);
      }
      continue;
    }

    if (first === undefined) {
      const created = document.createTextNode(rule.text);
      node.append(created);
      pushRestore(() => {
        created.remove();
      });
      continue;
    }

    writeText(first);
    for (const extra of rest) {
      writeText(extra, "");
    }
  }
}

function restoreAll(): void {
  const list = window.__walkwrightRestore ?? [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    list[index]?.();
  }
  window.__walkwrightRestore = [];
}

async function applyCaptureRules(
  page: Page,
  rules: CollectedRule[],
): Promise<void> {
  for (const rule of rules) {
    const locator =
      rule.scope.length === 0
        ? page.locator("body")
        : resolveLocator(page, rule.scope);

    await locator.evaluateAll(applyRule, {
      text: rule.text,
      ...(rule.match === undefined
        ? {}
        : {
            match: {
              pattern: rule.match.pattern,
              flags: rule.match.flags ?? "",
            },
          }),
    });
  }
}

async function restoreCaptureRules(page: Page): Promise<void> {
  await page.evaluate(restoreAll);
}

function patternFor(path: string): RegExp {
  return new RegExp(`^${path.replaceAll(/:[A-Za-z]+/g, "[^/]+")}/?$`);
}

function paramCount(path: string): number {
  return path.match(/:[A-Za-z]+/g)?.length ?? 0;
}

function pathOf(url: string): string {
  return url.replace(/^[a-z]+:\/\/[^/]+/, "").replace(/[?#].*$/, "");
}

const idSegment = /^(?:\d+|[\dA-Za-z_-]{12,})$/;

function pathSlug(path: string): string {
  const parts = path
    .split("/")
    .filter((part) => part !== "" && !idSegment.test(part));

  return parts.length === 0 ? "root" : slugify(parts.join("-"));
}

function slugParts(parts: (string | undefined)[]): string {
  return (
    parts
      .filter((part): part is string => part !== undefined && part !== "")
      .map(slugify)
      .join("-") || "shot"
  );
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "shot"
  );
}

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
