import type {
  Locator,
  Page,
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestType,
} from "@playwright/test";
import { test as playwrightTest } from "@playwright/test";

import type {
  ActionDescriptor,
  AppDescriptor,
  CaptureDescriptor,
  CaptureRuleDescriptor,
  ElementDescriptor,
  NestedSurfaceDescriptor,
  OverlayDescriptor,
  PageDescriptor,
  ParamDecl,
  RegexDescriptor,
} from "./descriptor.js";
import { appDescriptorSchema } from "./descriptor.js";
import type {
  LazyLocator,
  LocatorDescriptor,
  LocatorFilter,
  LocatorNode,
  Mount,
  Refinement,
  Scope,
  Text,
} from "./locator.js";
import {
  isLazyLocator,
  lazyLocatorOf,
  pageOf,
  paramNamesOf,
  plainTextOf,
  resolveLocator,
  textFrom,
} from "./locator.js";
import type { AnyProvision, ProvisionMap } from "./provisioner.js";
import { createProvisioner } from "./provisioner.js";
import type { RecorderFixtures } from "./recorder.js";
import { createRecorderFixtures } from "./recorder.js";

export type { Mount, Scope };
export { pageOf };

export type CaptureRule =
  | { element: string; text: string; match?: RegExp }
  | { match: RegExp; text: string };

export interface CaptureRules {
  rules: CaptureRule[];
}

type ElementPath<E> =
  Extract<keyof E, string> | `${Extract<keyof E, string>}.${string}`;

type TypedCaptureRule<E> =
  | { element: ElementPath<E>; text: string; match?: RegExp }
  | { match: RegExp; text: string };

interface TypedCaptureRules<E> {
  rules: TypedCaptureRule<E>[];
}

export type Factory<T> = (page: Page) => T;

export interface Rooted {
  self: LazyLocator;
  root: Locator;
}

export interface SurfaceInstance {
  page: Page;
  elements: object;
}

export interface Surface<I extends SurfaceInstance = SurfaceInstance> {
  (scope: LazyLocator): Surface<I & Rooted>;
  (scope: Page): I;
  readonly descriptor: NestedSurfaceDescriptor;
}

export type AnySurface = Surface;

export interface OverlayEmbed {
  overlay: OverlayFactory;
  open?: () => Promise<void>;
}

export type ElementMap = Record<
  string,
  | LazyLocator
  | ((...params: never[]) => LazyLocator)
  | AnySurface
  | ((...params: never[]) => AnySurface)
  | OverlayEmbed
  | ((scope: Mount) => unknown)
  | ((...params: never[]) => (scope: Mount) => unknown)
>;

type ThisElements<Self> = Record<
  string,
  ElementMap[string] | (OverlayEmbed & ThisType<Self>)
>;

export type Instantiated<M extends ElementMap> = {
  [Key in keyof M]: M[Key] extends { overlay: infer O extends AnySurface }
    ? SurfaceInstanceOf<O>
    : M[Key] extends LazyLocator
      ? Locator
      : M[Key] extends (...args: infer A) => LazyLocator
        ? (...args: A) => Locator
        : M[Key] extends {
              (...params: infer Params): infer S;
              parameterized: true;
            }
          ? S extends AnySurface
            ? (...params: Params) => SurfaceInstanceOf<S>
            : never
          : M[Key] extends AnySurface
            ? SurfaceInstanceOf<M[Key]>
            : M[Key] extends (...args: infer A) => infer S
              ? S extends AnySurface
                ? (...args: A) => SurfaceInstanceOf<S>
                : S extends (scope: never) => infer R
                  ? (...args: A) => R
                  : S
              : never;
};

export type ActionMap = Record<string, (...params: never[]) => unknown>;

export type Parameterized<Params extends unknown[], F> = ((
  ...params: Params
) => F) & { parameterized: true };

export type Component<
  E extends object,
  A extends object = Record<never, never>,
> = { page: Page; elements: E; self?: LazyLocator; root?: Locator } & A;

export type RootedComponent<
  E extends object,
  A extends object = Record<never, never>,
> = Component<E, A> & Rooted;

type SurfaceInstanceOf<S> = S extends (scope: Page) => infer I ? I : never;

type ActionsOf<I> = Omit<I, keyof SurfaceInstance | keyof Rooted>;

type IncludeShape<Inc extends readonly AnySurface[]> = Inc extends readonly [
  infer First,
  ...infer Rest,
]
  ? Rest extends readonly AnySurface[]
    ? SurfaceInstanceOf<First> extends infer I extends SurfaceInstance
      ? {
          elements: I["elements"] & IncludeShape<Rest>["elements"];
          actions: ActionsOf<I> & IncludeShape<Rest>["actions"];
        }
      : never
    : never
  : { elements: unknown; actions: unknown };

export type IncludeElements<Inc extends readonly AnySurface[]> =
  IncludeShape<Inc>["elements"];

export type IncludeActions<Inc extends readonly AnySurface[]> =
  IncludeShape<Inc>["actions"];

export function rootOf(instance: { root?: Locator }): Locator {
  if (instance.root === undefined) {
    throw new Error(
      "this surface is not mounted at a chain — scope it with a locator",
    );
  }

  return instance.root;
}

interface SurfaceCore {
  root: LocatorDescriptor;
  elements: BoundElements;
  actions: ActionMap;
  descriptor: NestedSurfaceDescriptor;
}

const coreKey = Symbol("walkwright.surface");

interface SurfaceBrand {
  [coreKey]: SurfaceCore;
}

function isSurface(value: unknown): value is AnySurface & SurfaceBrand {
  return typeof value === "function" && coreKey in value;
}

function isOverlayFactory(value: unknown): value is OverlayFactory {
  return (
    typeof value === "function" &&
    (value as { overlay?: unknown }).overlay === true
  );
}

interface AnyParameterizedFactory {
  (...params: never[]): unknown;
  parameterized: true;
}

const isParameterized = (value: unknown): value is AnyParameterizedFactory =>
  typeof value === "function" &&
  (value as Partial<AnyParameterizedFactory>).parameterized === true;

function definer<Def>(
  definition: Def | ((...params: never[]) => Def),
  factoryOf: (def: Def) => object,
): object {
  if (typeof definition !== "function") {
    return factoryOf(definition);
  }

  const build = definition as (...params: never[]) => Def;

  return Object.assign(
    (...params: never[]): object => factoryOf(build(...params)),
    { parameterized: true as const },
  );
}

const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;

function paramsSourceOf(source: string): string | undefined {
  const paren = /^\s*(?:async\s+)?\(([^)]*)\)\s*=>/.exec(source);
  if (paren !== null) {
    return paren[1] ?? "";
  }

  const bare = /^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/.exec(source);
  if (bare !== null) {
    return bare[1] ?? "";
  }

  const keyword =
    /^\s*(?:async\s+)?function\s*[A-Za-z_$][\w$]*?\s*\(([^)]*)\)/.exec(source);

  return keyword === null ? undefined : (keyword[1] ?? "");
}

function paramNamesFrom(source: string, arity: number): string[] {
  const fallback = Array.from({ length: arity }, (_, index) => `p${index}`);
  const params = paramsSourceOf(source);

  if (params === undefined) {
    return fallback;
  }

  const pieces =
    params.trim() === "" ? [] : params.split(",").map((piece) => piece.trim());

  if (pieces.length < arity) {
    return fallback;
  }

  const sliced = pieces.slice(0, arity);

  return sliced.every((piece) => IDENTIFIER_RE.test(piece)) ? sliced : fallback;
}

function sentinelFor(index: number, tag: string): string {
  return ` walkwright-param-${index}-${tag} `;
}

function tracedText(
  text: Text | undefined,
  sentinelToName: Map<string, string>,
): Text | undefined {
  if (text === undefined || typeof text !== "string") {
    return text;
  }

  const exact = sentinelToName.get(text);
  if (exact !== undefined) {
    return { param: exact };
  }

  const parts: (string | { param: string })[] = [];
  let remainder = text;

  for (;;) {
    let earliestIndex = -1;
    let earliestSentinel = "";
    let earliestName = "";

    for (const [sentinel, name] of sentinelToName) {
      const index = remainder.indexOf(sentinel);
      if (index !== -1 && (earliestIndex === -1 || index < earliestIndex)) {
        earliestIndex = index;
        earliestSentinel = sentinel;
        earliestName = name;
      }
    }

    if (earliestIndex === -1) {
      break;
    }

    const literal = remainder.slice(0, earliestIndex);
    if (literal !== "") {
      parts.push(literal);
    }
    parts.push({ param: earliestName });
    remainder = remainder.slice(earliestIndex + earliestSentinel.length);
  }

  if (remainder !== "") {
    parts.push(remainder);
  }

  if (parts.length === 0) {
    return text;
  }

  return parts.length === 1 && typeof parts[0] === "string"
    ? text
    : { template: parts };
}

function tracedFilter(
  filter: LocatorFilter,
  sentinelToName: Map<string, string>,
): LocatorFilter | null {
  const hasText = tracedText(filter.hasText, sentinelToName);

  let has: LocatorDescriptor | undefined;
  if (filter.has !== undefined) {
    const traced = tracedDescriptor(filter.has, sentinelToName);
    if (traced === undefined) {
      return null;
    }
    has = traced;
  }

  let hasNot: LocatorDescriptor | undefined;
  if (filter.hasNot !== undefined) {
    const traced = tracedDescriptor(filter.hasNot, sentinelToName);
    if (traced === undefined) {
      return null;
    }
    hasNot = traced;
  }

  return {
    ...(hasText === undefined ? {} : { hasText }),
    ...(has === undefined ? {} : { has }),
    ...(hasNot === undefined ? {} : { hasNot }),
  };
}

function tracedNode(
  node: LocatorNode,
  sentinelToName: Map<string, string>,
): LocatorNode | undefined {
  if ("or" in node) {
    const branches = tracedBranches(node.or, sentinelToName);
    return branches === undefined ? undefined : { or: branches };
  }

  if ("and" in node) {
    const branches = tracedBranches(node.and, sentinelToName);
    return branches === undefined ? undefined : { and: branches };
  }

  const name =
    "name" in node ? tracedText(node.name, sentinelToName) : undefined;

  const text =
    "text" in node ? tracedText(node.text, sentinelToName) : undefined;

  const refine = tracedRefine(node.refine, sentinelToName);
  if (refine === null) {
    return undefined;
  }

  return {
    ...node,
    ...(name === undefined ? {} : { name }),
    ...(text === undefined ? {} : { text }),
    ...(refine === undefined ? {} : { refine }),
  };
}

function tracedRefine(
  refine: Refinement[] | undefined,
  sentinelToName: Map<string, string>,
): Refinement[] | undefined | null {
  if (refine === undefined) {
    return undefined;
  }

  const traced: Refinement[] = [];
  for (const refinement of refine) {
    if ("nth" in refinement) {
      traced.push(refinement);
      continue;
    }

    const filter = tracedFilter(refinement.filter, sentinelToName);
    if (filter === null) {
      return null;
    }
    traced.push({ filter });
  }

  return traced;
}

function tracedBranches(
  branches: LocatorDescriptor[],
  sentinelToName: Map<string, string>,
): LocatorDescriptor[] | undefined {
  const traced: LocatorDescriptor[] = [];

  for (const branch of branches) {
    const next = tracedDescriptor(branch, sentinelToName);
    if (next === undefined) {
      return undefined;
    }
    traced.push(next);
  }

  return traced;
}

function tracedDescriptor(
  descriptor: LocatorDescriptor,
  sentinelToName: Map<string, string>,
): LocatorDescriptor | undefined {
  const traced: LocatorNode[] = [];

  for (const node of descriptor) {
    const next = tracedNode(node, sentinelToName);
    if (next === undefined) {
      return undefined;
    }
    traced.push(next);
  }

  return traced;
}

interface ParametricElement {
  build: (...values: string[]) => unknown;
  locator: LocatorDescriptor;
  params: ParamDecl[];
}

interface ParametricOpaqueElement {
  build: (...values: string[]) => unknown;
}

function probeParametric(value: unknown): BoundElement | undefined {
  if (typeof value !== "function") {
    return undefined;
  }

  const fn = value as (...args: string[]) => unknown;
  const names = paramNamesFrom(fn.toString(), fn.length);
  const tag = Math.random().toString(36).slice(2, 10);
  const sentinelToName = new Map(
    names.map((name, index) => [sentinelFor(index, tag), name] as const),
  );

  let result: unknown;
  try {
    result = fn(...sentinelToName.keys());
  } catch {
    return undefined;
  }

  if (isLazyLocator(result)) {
    const locator = tracedDescriptor(result.chain, sentinelToName);
    if (locator === undefined) {
      return { parametricOpaque: { build: fn } };
    }

    const used = new Set(paramNamesOf(locator));
    if (!names.every((name) => used.has(name))) {
      return { parametricOpaque: { build: fn } };
    }

    return {
      parametric: {
        build: fn,
        locator,
        params: names
          .filter((name) => used.has(name))
          .map((name) => ({ name })),
      },
    };
  }

  if (typeof result === "function") {
    return { parametricOpaque: { build: fn } };
  }

  return undefined;
}

interface NestedSurface {
  factory: AnySurface;
  descriptor: NestedSurfaceDescriptor;
}

interface NestedOverlay {
  factory: AnySurface;
  descriptor: Extract<ElementDescriptor, { overlay: OverlayDescriptor }>;
  open?: () => Promise<void>;
}

function isOverlayEmbed(value: unknown): value is OverlayEmbed {
  return (
    typeof value === "object" &&
    value !== null &&
    isOverlayFactory((value as { overlay?: unknown }).overlay)
  );
}

function embedOf(
  factory: OverlayFactory,
  open: (() => Promise<void>) | undefined,
): NestedOverlay {
  return {
    factory,
    descriptor: {
      overlay: factory.descriptor,
      ...(open === undefined
        ? {}
        : { open: { opaque: true as const, provenance: "hand" as const } }),
    },
    ...(open === undefined ? {} : { open }),
  };
}

type BoundElement =
  | { locator: LocatorDescriptor; params?: ParamDecl[] }
  | { parametric: ParametricElement }
  | { parametricOpaque: ParametricOpaqueElement }
  | { surface: NestedSurface }
  | { overlay: NestedOverlay }
  | { opaque: unknown; provenance: "hand" };

type BoundElements = Record<string, BoundElement>;

function bindElement(value: unknown): BoundElement {
  if (isLazyLocator(value)) {
    return value.params.length === 0
      ? { locator: value.chain }
      : {
          locator: value.chain,
          params: value.params.map((name) => ({ name })),
        };
  }

  if (isOverlayFactory(value)) {
    return { overlay: embedOf(value, undefined) };
  }

  if (isOverlayEmbed(value)) {
    return { overlay: embedOf(value.overlay, value.open) };
  }

  if (isSurface(value)) {
    return { surface: { factory: value, descriptor: value.descriptor } };
  }

  if (isParameterized(value)) {
    return { opaque: value, provenance: "hand" };
  }

  const parametric = probeParametric(value);
  if (parametric !== undefined) {
    return parametric;
  }

  return { opaque: value, provenance: "hand" };
}

function projectElement(bound: BoundElement): ElementDescriptor {
  if ("locator" in bound) {
    return bound.params === undefined
      ? { locator: bound.locator }
      : { locator: bound.locator, params: bound.params };
  }

  if ("parametric" in bound) {
    return bound.parametric.params.length === 0
      ? { locator: bound.parametric.locator }
      : {
          locator: bound.parametric.locator,
          params: bound.parametric.params,
        };
  }

  if ("parametricOpaque" in bound) {
    return { opaque: true, provenance: "hand" };
  }

  if ("surface" in bound) {
    return { surface: bound.surface.descriptor };
  }

  if ("overlay" in bound) {
    return bound.overlay.descriptor;
  }

  return { opaque: true, provenance: "hand" };
}

function projectElements(
  elements: BoundElements,
): Record<string, ElementDescriptor> {
  return Object.fromEntries(
    Object.entries(elements).map(([key, bound]) => [
      key,
      projectElement(bound),
    ]),
  );
}

function classifyActions(actions: ActionMap): ActionDescriptor[] | undefined {
  const names = Object.keys(actions);

  return names.length === 0
    ? undefined
    : names.map((name) => ({
        name,
        impl: { opaque: true as const, provenance: "hand" as const },
      }));
}

function regexDescriptorOf(re: RegExp): RegexDescriptor {
  return {
    pattern: re.source,
    ...(re.flags === "" ? {} : { flags: re.flags }),
  };
}

function captureRuleDescriptorOf(rule: CaptureRule): CaptureRuleDescriptor {
  if ("element" in rule) {
    return {
      element: rule.element.split("."),
      text: rule.text,
      ...(rule.match === undefined
        ? {}
        : { match: regexDescriptorOf(rule.match) }),
    };
  }

  return { match: regexDescriptorOf(rule.match), text: rule.text };
}

type CaptureLookup =
  | { kind: "opaque" }
  | { kind: "locator" }
  | { kind: "nested"; elements: Record<string, ElementDescriptor> };

function captureLookupOf(descriptor: ElementDescriptor): CaptureLookup {
  if ("opaque" in descriptor) {
    return { kind: "opaque" };
  }

  if ("locator" in descriptor) {
    return { kind: "locator" };
  }

  if ("surface" in descriptor) {
    return { kind: "nested", elements: descriptor.surface.elements };
  }

  return { kind: "nested", elements: descriptor.overlay.elements };
}

function validateCaptureElement(
  path: string,
  owner: string,
  elements: Record<string, ElementDescriptor>,
  hasMatch: boolean,
): void {
  const segments = path.split(".");
  let current = elements;
  let consumed: string[] = [];

  segments.forEach((segment, index) => {
    consumed = [...consumed, segment];
    const descriptor = current[segment];

    if (descriptor === undefined) {
      throw new Error(
        `capture rule "${path}" of ${owner} references unknown element "${consumed.join(".")}"`,
      );
    }

    const isFinal = index === segments.length - 1;
    const lookup = captureLookupOf(descriptor);

    if (lookup.kind === "opaque") {
      throw new Error(
        `capture rule "${path}" of ${owner} targets "${consumed.join(".")}", which has no locator to resolve`,
      );
    }

    if (lookup.kind === "locator") {
      if (!isFinal) {
        throw new Error(
          `capture rule "${path}" of ${owner} walks through "${consumed.join(".")}", which is not a surface`,
        );
      }
      return;
    }

    if (isFinal && !hasMatch) {
      throw new Error(
        `capture rule "${path}" of ${owner} targets "${consumed.join(".")}", a surface — give it match to scope a replace over its subtree`,
      );
    }

    current = lookup.elements;
  });
}

function captureRulesOf(
  rules: CaptureRule[] | undefined,
  owner: string,
  elements: Record<string, ElementDescriptor>,
): CaptureRuleDescriptor[] {
  return (rules ?? []).map((rule) => {
    if ("element" in rule) {
      validateCaptureElement(
        rule.element,
        owner,
        elements,
        rule.match !== undefined,
      );
    }

    return captureRuleDescriptorOf(rule);
  });
}

function captureDescriptorOf(
  rules: CaptureRuleDescriptor[],
): CaptureDescriptor | undefined {
  return rules.length === 0 ? undefined : { rules };
}

function projectSurface(
  root: LocatorDescriptor,
  elements: BoundElements,
  actions: ActionMap,
  captureRules: CaptureRuleDescriptor[],
): NestedSurfaceDescriptor {
  const projectedActions = classifyActions(actions);
  const capture = captureDescriptorOf(captureRules);

  return {
    ...(root.length === 0 ? {} : { root }),
    elements: projectElements(elements),
    ...(projectedActions === undefined ? {} : { actions: projectedActions }),
    ...(capture === undefined ? {} : { capture }),
  };
}

export interface SurfaceDefinition {
  elements?: ElementMap;
  actions?: ActionMap;
  include?: readonly AnySurface[];
  capture?: CaptureRules;
}

interface Assembled {
  elements: BoundElements;
  actions: ActionMap;
  capture: CaptureRuleDescriptor[];
}

function assemble(
  def: SurfaceDefinition,
  owner: string,
  reserved: readonly string[],
): Assembled {
  const elements: BoundElements = {};
  const actions: ActionMap = {};
  const capture: CaptureRuleDescriptor[] = [];
  const elementSources = new Map<string, string>();
  const actionSources = new Map<string, string>();

  const claim = (
    sources: Map<string, string>,
    key: string,
    source: string,
    what: string,
  ): void => {
    const holder = sources.get(key);
    if (holder !== undefined) {
      throw new Error(
        `${holder} and ${source} of ${owner} both define ${what} "${key}"`,
      );
    }
    sources.set(key, source);
  };

  for (const [index, included] of (def.include ?? []).entries()) {
    const source = `include[${String(index)}]`;

    if (!isSurface(included)) {
      throw new Error(`${source} of ${owner} is not a surface`);
    }

    const core = included[coreKey];
    if (core.root.length > 0) {
      throw new Error(
        `${source} of ${owner} has a root — embed it as an element to keep its boundary; only rootless surfaces can be merged`,
      );
    }

    for (const [key, bound] of Object.entries(core.elements)) {
      claim(elementSources, key, source, "element");
      elements[key] = bound;
    }

    for (const [key, action] of Object.entries(core.actions)) {
      claim(actionSources, key, source, "action");
      if (reserved.includes(key)) {
        throw new Error(
          `action "${key}" of ${source} of ${owner} shadows a built-in field of its instances`,
        );
      }
      actions[key] = action;
    }

    capture.push(...(core.descriptor.capture?.rules ?? []));
  }

  for (const [key, value] of Object.entries(def.elements ?? {})) {
    claim(elementSources, key, "the definition", "element");
    elements[key] = bindElement(value);
  }

  for (const [key, action] of Object.entries(def.actions ?? {})) {
    claim(actionSources, key, "the definition", "action");
    if (reserved.includes(key)) {
      throw new Error(
        `action "${key}" of ${owner} shadows a built-in field of its instances`,
      );
    }
    actions[key] = action;
  }

  return { elements, actions, capture };
}

interface MountContext {
  page: Page;
  chain: LocatorDescriptor;
  mount: Mount;
  instance: () => object;
}

function mountNested(factory: AnySurface, context: MountContext): unknown {
  return context.chain.length === 0
    ? factory(context.page)
    : factory(lazyLocatorOf(context.chain))(context.page);
}

function mountBuilt(built: unknown, context: MountContext): unknown {
  if (isSurface(built)) {
    return mountNested(built, context);
  }

  if (typeof built === "function") {
    return (built as (scope: Mount) => unknown).call(
      context.instance(),
      context.mount,
    );
  }

  return built;
}

function instantiateBoundElement(
  bound: BoundElement,
  context: MountContext,
): unknown {
  if ("locator" in bound) {
    const { locator, params } = bound;
    return params === undefined
      ? resolveLocator(context.mount, locator)
      : (...values: string[]): Locator =>
          resolveLocator(
            context.mount,
            locator,
            Object.fromEntries(
              params.flatMap((param, index) => {
                const value = values[index];
                return value === undefined
                  ? []
                  : [[param.name, value] as const];
              }),
            ),
          );
  }

  if ("parametric" in bound) {
    const { build } = bound.parametric;
    return (...values: string[]): Locator => {
      const built = build(...values);
      if (!isLazyLocator(built)) {
        throw new Error("parametric element did not build a lazy locator");
      }
      return resolveLocator(context.mount, built.chain);
    };
  }

  if ("parametricOpaque" in bound) {
    const { build } = bound.parametricOpaque;
    return (...values: string[]): unknown => {
      const built = build(...values);
      if (typeof built !== "function") {
        throw new Error("parametric element did not build a function");
      }
      return mountBuilt(built, context);
    };
  }

  if ("surface" in bound) {
    return mountNested(bound.surface.factory, context);
  }

  if ("overlay" in bound) {
    const mounted = mountNested(bound.overlay.factory, context) as object;
    const { open } = bound.overlay;

    return open === undefined
      ? mounted
      : Object.assign(mounted, {
          open: async (): Promise<void> => {
            await open.call(context.instance());
          },
        });
  }

  const factory = bound.opaque;
  return isParameterized(factory)
    ? (...params: never[]): unknown => mountBuilt(factory(...params), context)
    : mountBuilt(factory, context);
}

function instantiateBound(
  elements: BoundElements,
  context: MountContext,
): Record<string, unknown> {
  const instance = {} as Record<string, unknown>;
  const settled = new Map<string, unknown>();
  const resolving = new Set<string>();

  for (const [key, bound] of Object.entries(elements)) {
    Object.defineProperty(instance, key, {
      enumerable: true,
      configurable: true,
      get(): unknown {
        if (settled.has(key)) {
          return settled.get(key);
        }

        if (resolving.has(key)) {
          throw new Error(`element "${key}" is part of a reference cycle`);
        }

        resolving.add(key);
        try {
          const value = instantiateBoundElement(bound, context);
          settled.set(key, value);
          return value;
        } finally {
          resolving.delete(key);
        }
      },
    });
  }

  return instance;
}

interface Grounded {
  page: Page;
  chain: LocatorDescriptor;
  self?: LazyLocator;
  root?: Locator;
}

type Mounted<D extends object> = SurfaceInstance & Partial<Rooted> & D;

function instantiateSurface<D extends object>(
  core: SurfaceCore,
  page: Page,
  prefix: LocatorDescriptor,
  decorate: (grounded: Grounded) => D,
  mountOnly: BoundElements = {},
): Mounted<D> {
  const chain = [...prefix, ...core.root];
  const self = chain.length === 0 ? undefined : lazyLocatorOf(chain);
  const root = self === undefined ? undefined : resolveLocator(page, chain);

  const instance: SurfaceInstance & Partial<Rooted> & Record<string, unknown> =
    { page, elements: {} };
  const grounded: Grounded = {
    page,
    chain,
    ...(self === undefined ? {} : { self, root }),
  };

  instance.elements = instantiateBound(
    { ...core.elements, ...mountOnly },
    { page, chain, mount: root ?? page, instance: () => instance },
  );

  const decorated = Object.assign(
    instance,
    self === undefined ? {} : { self, root },
    decorate(grounded),
  );

  for (const [key, action] of Object.entries(core.actions)) {
    instance[key] = (...params: never[]): unknown =>
      action.call(instance, ...params);
  }

  return decorated;
}

type Branded<F, X, C extends SurfaceCore> = F &
  X & { descriptor: C["descriptor"] } & SurfaceBrand;

function surfaceOf<F extends object, X extends object, C extends SurfaceCore>(
  core: C,
  factory: F,
  extra: X,
): Branded<F, X, C> {
  return Object.assign(factory, extra, {
    descriptor: core.descriptor,
    [coreKey]: core,
  });
}

type PointedSurface = Surface<SurfaceInstance & Rooted>;

function rootedOf(grounded: Grounded): Rooted {
  if (grounded.self === undefined || grounded.root === undefined) {
    throw new Error("this surface is not mounted at a chain");
  }

  return { self: grounded.self, root: grounded.root };
}

function composedCore(core: SurfaceCore, scope: LazyLocator): SurfaceCore {
  const root = [...scope.chain, ...core.root];

  return { ...core, root, descriptor: { ...core.descriptor, root } };
}

function pointedFactoryOf(core: SurfaceCore): PointedSurface & SurfaceBrand {
  function factory(scope: LazyLocator): PointedSurface;
  function factory(scope: Page): SurfaceInstance & Rooted;
  function factory(scope: Scope): PointedSurface | (SurfaceInstance & Rooted) {
    return isLazyLocator(scope)
      ? pointedFactoryOf(composedCore(core, scope))
      : instantiateSurface(core, scope, [], rootedOf);
  }

  return surfaceOf(core, factory, {});
}

function componentFactoryOf(core: SurfaceCore): AnySurface & SurfaceBrand {
  function factory(scope: LazyLocator): PointedSurface;
  function factory(scope: Page): SurfaceInstance;
  function factory(scope: Scope): PointedSurface | SurfaceInstance {
    return isLazyLocator(scope)
      ? pointedFactoryOf(composedCore(core, scope))
      : instantiateSurface(core, scope, [], () => ({}));
  }

  return surfaceOf(core, factory, {});
}

const componentReserved = ["elements", "page", "self", "root", "pages"];

export interface ComponentDefinition<
  Inc extends readonly AnySurface[],
  M extends ElementMap,
  A extends ActionMap,
  Self,
> {
  include?: readonly [...Inc];
  elements?: M & ThisElements<Self> & ThisType<Self>;
  actions?: A & ActionMap & ThisType<Self>;
  capture?: TypedCaptureRules<IncludeElements<Inc> & Instantiated<M>>;
}

interface DefinitionShape {
  root?: LazyLocator;
}

type ComponentInstanceOf<
  Def extends DefinitionShape,
  Inc extends readonly AnySurface[],
  M extends ElementMap,
  A extends ActionMap,
> = Def extends { root: LazyLocator }
  ? RootedComponent<
      IncludeElements<Inc> & Instantiated<M>,
      IncludeActions<Inc> & A
    >
  : Component<IncludeElements<Inc> & Instantiated<M>, IncludeActions<Inc> & A>;

export function defineComponent<
  Params extends unknown[],
  Def extends DefinitionShape,
  Inc extends readonly AnySurface[] = [],
  M extends ElementMap = Record<never, never>,
  A extends ActionMap = Record<never, never>,
>(
  build: (
    ...params: Params
  ) => Def &
    ComponentDefinition<Inc, M, A, ComponentInstanceOf<Def, Inc, M, A>>,
): Parameterized<Params, Surface<ComponentInstanceOf<Def, Inc, M, A>>>;

export function defineComponent<
  Def extends DefinitionShape,
  Inc extends readonly AnySurface[] = [],
  M extends ElementMap = Record<never, never>,
  A extends ActionMap = Record<never, never>,
>(
  definition: Def &
    ComponentDefinition<Inc, M, A, ComponentInstanceOf<Def, Inc, M, A>>,
): Surface<ComponentInstanceOf<Def, Inc, M, A>>;

export function defineComponent(
  definition:
    | (DefinitionShape & SurfaceDefinition)
    | ((...params: never[]) => DefinitionShape & SurfaceDefinition),
): unknown {
  return definer(definition, (def) => {
    const root = def.root?.chain ?? [];
    const owner = "the component";
    const { elements, actions, capture } = assemble(
      def,
      owner,
      componentReserved,
    );

    const captureRules = [
      ...capture,
      ...captureRulesOf(def.capture?.rules, owner, projectElements(elements)),
    ];

    return componentFactoryOf({
      root,
      elements,
      actions,
      descriptor: projectSurface(root, elements, actions, captureRules),
    });
  });
}

export interface OverlayClose {
  esc?: boolean;
  button?: LazyLocator;
}

export interface OverlayRecorder {
  label: string;
}

export interface OverlayHandle {
  waitFor: (state?: "visible" | "hidden") => Promise<void>;
  open: () => Promise<void>;
  close: () => Promise<void>;
}

export type Overlay<E extends object> = {
  page: Page;
  elements: E;
  label: string;
} & Rooted &
  OverlayHandle;

export type Dialog<E extends object> = Overlay<E> & {
  name: string | RegExp;
};

type AnyOverlayInstance = SurfaceInstance &
  Rooted &
  OverlayHandle & { label: string };

export interface OverlayFactory<
  I extends AnyOverlayInstance = AnyOverlayInstance,
> extends Surface<I> {
  overlay: true;
  descriptor: OverlayDescriptor;
}

type OverlayInstanceOf<
  Inc extends readonly AnySurface[],
  M extends ElementMap,
  A extends ActionMap,
> = Overlay<IncludeElements<Inc> & Instantiated<M>> & IncludeActions<Inc> & A;

type DialogInstanceOf<
  Inc extends readonly AnySurface[],
  M extends ElementMap,
  A extends ActionMap,
> = Dialog<IncludeElements<Inc> & Instantiated<M>> & IncludeActions<Inc> & A;

export interface OverlayDefinition<
  Inc extends readonly AnySurface[] = [],
  M extends ElementMap = Record<never, never>,
  A extends ActionMap = Record<never, never>,
> extends ComponentDefinition<Inc, M, A, OverlayInstanceOf<Inc, M, A>> {
  root: LazyLocator;
  recorder: OverlayRecorder;
  close?: OverlayClose;
}

export interface DialogDefinition<
  Inc extends readonly AnySurface[] = [],
  M extends ElementMap = Record<never, never>,
  A extends ActionMap = Record<never, never>,
> extends ComponentDefinition<Inc, M, A, DialogInstanceOf<Inc, M, A>> {
  name: string | RegExp;
  role?: "dialog" | "alertdialog";
  recorder?: OverlayRecorder;
  close?: OverlayClose;
}

type AnyOverlayDefinition = OverlayDefinition<
  readonly AnySurface[],
  ElementMap,
  ActionMap
>;

type AnyDialogDefinition = DialogDefinition<
  readonly AnySurface[],
  ElementMap,
  ActionMap
>;

const overlayReserved = [
  ...componentReserved,
  "label",
  "name",
  "waitFor",
  "open",
  "close",
];

interface OverlayCore extends SurfaceCore {
  close: { esc: boolean; button?: (root: Locator) => Locator };
  descriptor: OverlayDescriptor;
}

function overlayDescriptorOf(
  root: LocatorDescriptor,
  name: Text | undefined,
  label: string,
  close: OverlayClose | undefined,
  elements: BoundElements,
  actions: ActionMap,
  captureRules: CaptureRuleDescriptor[],
): OverlayDescriptor {
  const projectedActions = classifyActions(actions);
  const capture = captureDescriptorOf(captureRules);

  return {
    root,
    ...(name === undefined ? {} : { name }),
    recorder: { label },
    close: {
      esc: close?.esc ?? true,
      ...(close?.button === undefined ? {} : { button: close.button.chain }),
    },
    elements: projectElements(elements),
    ...(projectedActions === undefined ? {} : { actions: projectedActions }),
    ...(capture === undefined ? {} : { capture }),
  };
}

function overlayFactoryOf(core: OverlayCore): OverlayFactory {
  const name =
    core.descriptor.name === undefined
      ? undefined
      : plainTextOf(core.descriptor.name, "overlay name");
  const { label } = core.descriptor.recorder;

  function factory(scope: LazyLocator): OverlayFactory;
  function factory(scope: Page): AnyOverlayInstance;
  function factory(scope: Scope): OverlayFactory | AnyOverlayInstance {
    if (isLazyLocator(scope)) {
      return overlay;
    }

    const instance = instantiateSurface(core, scope, [], (grounded) => {
      const { root, self } = grounded;
      if (root === undefined || self === undefined) {
        throw new Error("an overlay needs a root");
      }

      const waitFor = async (
        state: "visible" | "hidden" = "visible",
      ): Promise<void> => {
        await root.waitFor({ state });
      };

      const open = async (): Promise<void> => {
        await Promise.resolve();
        throw new Error(
          `the "${label}" overlay is evoked elsewhere — await waitFor() instead of open()`,
        );
      };

      const close = async (): Promise<void> => {
        if (core.close.button !== undefined) {
          await core.close.button(root).click();
        } else if (core.close.esc) {
          await grounded.page.keyboard.press("Escape");
        } else {
          throw new Error(
            `declare how the "${label}" overlay closes: a close button or esc`,
          );
        }

        await root.waitFor({ state: "hidden" });
      };

      return {
        ...(name === undefined ? {} : { name }),
        label,
        self,
        root,
        waitFor,
        open,
        close,
      };
    });

    Object.defineProperty(instance, "descriptor", {
      value: core.descriptor,
      enumerable: false,
    });

    return instance;
  }

  const overlay: OverlayFactory = surfaceOf(core, factory, {
    overlay: true as const,
  });

  return overlay;
}

function closeOf(close: OverlayClose | undefined): OverlayCore["close"] {
  const button = close?.button;

  return {
    esc: close?.esc ?? true,
    ...(button === undefined
      ? {}
      : {
          button: (root: Locator): Locator =>
            resolveLocator(root, button.chain),
        }),
  };
}

function overlayOf(
  def: AnyOverlayDefinition | AnyDialogDefinition,
  root: LocatorDescriptor,
  name: Text | undefined,
  label: string,
  owner: string,
): OverlayFactory {
  const { elements, actions, capture } = assemble(def, owner, overlayReserved);

  const captureRules = [
    ...capture,
    ...captureRulesOf(def.capture?.rules, owner, projectElements(elements)),
  ];

  return overlayFactoryOf({
    root,
    elements,
    actions,
    close: closeOf(def.close),
    descriptor: overlayDescriptorOf(
      root,
      name,
      label,
      def.close,
      elements,
      actions,
      captureRules,
    ),
  });
}

export function defineOverlay<
  Params extends unknown[],
  Inc extends readonly AnySurface[] = [],
  M extends ElementMap = Record<never, never>,
  A extends ActionMap = Record<never, never>,
>(
  build: (...params: Params) => OverlayDefinition<Inc, M, A>,
): Parameterized<Params, OverlayFactory<OverlayInstanceOf<Inc, M, A>>>;

export function defineOverlay<
  Inc extends readonly AnySurface[] = [],
  M extends ElementMap = Record<never, never>,
  A extends ActionMap = Record<never, never>,
>(
  definition: OverlayDefinition<Inc, M, A>,
): OverlayFactory<OverlayInstanceOf<Inc, M, A>>;

export function defineOverlay(
  definition:
    AnyOverlayDefinition | ((...params: never[]) => AnyOverlayDefinition),
): unknown {
  return definer(definition, (def) =>
    overlayOf(
      def,
      def.root.chain,
      undefined,
      def.recorder.label,
      `the "${def.recorder.label}" overlay`,
    ),
  );
}

export function defineDialog<
  Params extends unknown[],
  Inc extends readonly AnySurface[] = [],
  M extends ElementMap = Record<never, never>,
  A extends ActionMap = Record<never, never>,
>(
  build: (...params: Params) => DialogDefinition<Inc, M, A>,
): Parameterized<Params, OverlayFactory<DialogInstanceOf<Inc, M, A>>>;

export function defineDialog<
  Inc extends readonly AnySurface[] = [],
  M extends ElementMap = Record<never, never>,
  A extends ActionMap = Record<never, never>,
>(
  definition: DialogDefinition<Inc, M, A>,
): OverlayFactory<DialogInstanceOf<Inc, M, A>>;

export function defineDialog(
  definition:
    AnyDialogDefinition | ((...params: never[]) => AnyDialogDefinition),
): unknown {
  return definer(definition, (def) => {
    const name = textFrom(def.name);
    const root: LocatorDescriptor = [
      { by: "role", role: def.role ?? "dialog", name },
    ];

    const owner = `the ${typeof def.name === "string" ? `"${def.name}"` : def.name.source} dialog`;
    const label = def.recorder?.label ?? def.name;
    if (typeof label !== "string") {
      throw new Error(`${owner} needs recorder.label: its name is a pattern`);
    }

    return overlayOf(def, root, name, label, owner);
  });
}

export type PathParams<Path extends string> =
  Path extends `${string}:${infer Param}/${infer Rest}`
    ? Record<Param, string> & PathParams<Rest>
    : Path extends `${string}:${infer Param}`
      ? Record<Param, string>
      : unknown;

export interface PageMeta {
  name: string;
  path: string;
  group?: string[];
}

export interface PageRecorder {
  group?: string[];
  label?: string;
}

export interface Register {}

export type RegisteredPages = Register extends {
  app: { pages: infer P extends AnyPages };
}
  ? BoundPages<P>
  : Record<string, never>;

export interface PageObject<Path extends string, E> {
  page: Page;
  path: Path;
  name: string;
  goto: (params: PathParams<Path>) => Promise<void>;
  url: (params: PathParams<Path>) => string;
  params: () => PathParams<Path>;
  waitFor: () => Promise<void>;
  elements: E;
  pages: RegisteredPages;
}

export interface PageFactory<Path extends string, E, A> {
  (page: Page): PageObject<Path, E> & A;
  descriptor: PageDescriptor;
}

export type InstanceOf<T> = T extends (...args: never[]) => infer R
  ? R extends (...args: never[]) => infer R2
    ? R2
    : R
  : never;

export type HeaderElement<H extends string | undefined> = H extends string
  ? { header: Locator }
  : unknown;

export interface PageContext<E> {
  page: Page;
  elements: E;
  pages: RegisteredPages;
}

type PageThis<
  Inc extends readonly AnySurface[],
  M extends ElementMap,
  H extends string | undefined,
  A extends ActionMap,
> = PageContext<IncludeElements<Inc> & Instantiated<M> & HeaderElement<H>> &
  IncludeActions<Inc> &
  A;

export interface PageDefinition<
  Path extends string,
  Inc extends readonly AnySurface[] = [],
  M extends ElementMap = Record<never, never>,
  H extends string | undefined = undefined,
  A extends ActionMap = Record<never, never>,
  Ambient extends readonly AnySurface[] = [],
> {
  path: Path;
  name: string;
  recorder?: PageRecorder;
  ready?: AppReady;
  header?: H;
  include?: readonly [...Inc];
  elements?: M &
    ThisElements<PageThis<[...Ambient, ...Inc], M, H, A>> &
    ThisType<PageThis<[...Ambient, ...Inc], M, H, A>>;
  anchor?: string | LazyLocator;
  actions?: A & ActionMap & ThisType<PageThis<[...Ambient, ...Inc], M, H, A>>;
  capture?: TypedCaptureRules<
    IncludeElements<Inc> & Instantiated<M> & HeaderElement<H>
  >;
}

export interface PagePresetDefinition<
  Prefix extends string,
  Inc extends readonly AnySurface[] = [],
> {
  path: Prefix;
  include?: readonly [...Inc];
  recorder?: { group?: string[] };
  ready?: AppReady;
  capture?: TypedCaptureRules<IncludeElements<Inc>>;
}

export interface PagePreset<
  Prefix extends string,
  Inc extends readonly AnySurface[],
> {
  readonly path: Prefix;
  readonly include: Inc;

  <
    Params extends unknown[],
    Sub extends string,
    Own extends readonly AnySurface[] = [],
    M extends ElementMap = Record<never, never>,
    H extends string | undefined = undefined,
    A extends ActionMap = Record<never, never>,
  >(
    build: (...params: Params) => PageDefinition<Sub, Own, M, H, A, Inc>,
  ): Parameterized<
    Params,
    PageFactory<
      `${Prefix}${Sub}`,
      IncludeElements<[...Inc, ...Own]> & Instantiated<M> & HeaderElement<H>,
      IncludeActions<[...Inc, ...Own]> & A
    >
  >;

  <
    Sub extends string,
    Own extends readonly AnySurface[] = [],
    M extends ElementMap = Record<never, never>,
    H extends string | undefined = undefined,
    A extends ActionMap = Record<never, never>,
  >(
    def: PageDefinition<Sub, Own, M, H, A, Inc>,
  ): PageFactory<
    `${Prefix}${Sub}`,
    IncludeElements<[...Inc, ...Own]> & Instantiated<M> & HeaderElement<H>,
    IncludeActions<[...Inc, ...Own]> & A
  >;

  preset<SubPrefix extends string, SubInc extends readonly AnySurface[] = []>(
    base: PagePresetDefinition<SubPrefix, SubInc>,
  ): PagePreset<`${Prefix}${SubPrefix}`, [...Inc, ...SubInc]>;
}

export type PresetPage<
  P extends PagePreset<string, readonly AnySurface[]>,
  Sub extends string,
  M extends ElementMap = Record<never, never>,
  H extends string | undefined = undefined,
  A extends ActionMap = Record<never, never>,
  Own extends readonly AnySurface[] = [],
> = PageFactory<
  `${P["path"]}${Sub}`,
  IncludeElements<[...P["include"], ...Own]> &
    Instantiated<M> &
    HeaderElement<H>,
  IncludeActions<[...P["include"], ...Own]> & A
>;

export interface DefinePage {
  <
    Params extends unknown[],
    Path extends string,
    Inc extends readonly AnySurface[] = [],
    M extends ElementMap = Record<never, never>,
    H extends string | undefined = undefined,
    A extends ActionMap = Record<never, never>,
  >(
    build: (...params: Params) => PageDefinition<Path, Inc, M, H, A>,
  ): Parameterized<
    Params,
    PageFactory<
      Path,
      IncludeElements<Inc> & Instantiated<M> & HeaderElement<H>,
      IncludeActions<Inc> & A
    >
  >;

  <
    Path extends string,
    Inc extends readonly AnySurface[] = [],
    M extends ElementMap = Record<never, never>,
    H extends string | undefined = undefined,
    A extends ActionMap = Record<never, never>,
  >(
    def: PageDefinition<Path, Inc, M, H, A>,
  ): PageFactory<
    Path,
    IncludeElements<Inc> & Instantiated<M> & HeaderElement<H>,
    IncludeActions<Inc> & A
  >;

  preset<Prefix extends string, Inc extends readonly AnySurface[] = []>(
    base: PagePresetDefinition<Prefix, Inc>,
  ): PagePreset<Prefix, Inc>;
}

export type AppReady = { selector: string } | ((page: Page) => Promise<void>);

function readyOf(ready: AppReady | undefined): (page: Page) => Promise<void> {
  if (ready === undefined) {
    return waitForHydration;
  }

  if (typeof ready === "function") {
    return ready;
  }

  return async (page): Promise<void> => {
    await page.locator(ready.selector).waitFor({ state: "attached" });
  };
}

function readyDescriptorOf(
  ready: AppReady | undefined,
): { selector: string } | { opaque: true } | undefined {
  if (ready === undefined) {
    return undefined;
  }

  return typeof ready === "function" ? { opaque: true } : ready;
}

type AnyPageDefinition = PageDefinition<
  string,
  readonly AnySurface[],
  ElementMap,
  string | undefined,
  ActionMap
>;

type PageAnchor = { key: string } | { chain: LocatorDescriptor };

function classifyAnchor(
  pageName: string,
  anchor: string | LazyLocator | undefined,
  elements: BoundElements,
  hasHeader: boolean,
): { descriptor?: LocatorDescriptor | { opaque: true }; anchor?: PageAnchor } {
  if (anchor === undefined) {
    return hasHeader ? { anchor: { key: "header" } } : {};
  }

  if (isLazyLocator(anchor)) {
    return { descriptor: anchor.chain, anchor: { chain: anchor.chain } };
  }

  const bound = elements[anchor];
  if (bound === undefined) {
    throw new Error(
      `the "${pageName}" page's anchor references unknown element "${anchor}"`,
    );
  }

  if ("locator" in bound && bound.params === undefined) {
    return { descriptor: bound.locator, anchor: { key: anchor } };
  }

  if ("opaque" in bound) {
    return { descriptor: { opaque: true }, anchor: { key: anchor } };
  }

  throw new Error(
    `the "${pageName}" page's anchor "${anchor}" must be a plain locator element`,
  );
}

function anchorElement(
  pageName: string,
  key: string,
  elements: object,
): Locator {
  const candidate = (elements as Record<string, Partial<Locator> | undefined>)[
    key
  ];
  if (candidate === undefined || typeof candidate.waitFor !== "function") {
    throw new Error(
      `the "${pageName}" page's anchor "${key}" did not produce a locator`,
    );
  }

  return candidate as Locator;
}

const pageReserved = [
  ...componentReserved,
  "path",
  "name",
  "goto",
  "url",
  "params",
  "waitFor",
];

interface PageCore extends SurfaceCore {
  anchor?: PageAnchor;
  ready?: AppReady;
  descriptor: PageDescriptor;
}

interface AppBinding {
  ready?: AppReady;
  pages: (page: Page) => Record<string, unknown>;
}

const bindKey = Symbol("walkwright.bind");

export interface AnyPageFactory {
  (page: Page): unknown;
  descriptor: PageDescriptor;
}

interface BindablePage extends AnyPageFactory {
  [bindKey]: (binding: AppBinding) => BindablePage;
}

function isBindable(value: unknown): value is BindablePage {
  return typeof value === "function" && bindKey in value;
}

type PageDecorations = Omit<
  PageObject<string, object>,
  "page" | "elements" | "pages"
>;

function pageFactoryOf(core: PageCore, binding?: AppBinding): BindablePage {
  const { path, name } = core.descriptor;
  const ready = readyOf(core.ready ?? binding?.ready);

  const anchorOf = (page: Page, elements: object): Locator | undefined => {
    const anchor = core.anchor;
    if (anchor === undefined) {
      return undefined;
    }

    return "chain" in anchor
      ? resolveLocator(page, anchor.chain)
      : anchorElement(name, anchor.key, elements);
  };

  const factory = (page: Page): PageObject<string, object> => {
    const url = (params: PathParams<string>): string =>
      fillPath(path, params as Record<string, string>);

    const instance = instantiateSurface<PageDecorations>(
      core,
      page,
      [],
      () => ({
        path,
        name,
        async goto(
          this: PageObject<string, object>,
          params: PathParams<string>,
        ): Promise<void> {
          await page.goto(url(params));
          await ready(page);
          await anchorOf(page, this.elements)?.waitFor();
        },
        url,
        params: (): PathParams<string> => matchPath(path, page.url()),
        async waitFor(this: PageObject<string, object>): Promise<void> {
          await anchorOf(page, this.elements)?.waitFor();
        },
      }),
    );

    let pages: Record<string, unknown> | undefined;
    Object.defineProperty(instance, "pages", {
      enumerable: true,
      get(): Record<string, unknown> {
        if (binding === undefined) {
          throw new Error(
            `the "${name}" page is not app-bound — access this page through the app`,
          );
        }

        pages ??= binding.pages(page);
        return pages;
      },
    });

    return instance as PageObject<string, object>;
  };

  return Object.assign(factory, {
    descriptor: core.descriptor,
    [bindKey]: (next: AppBinding): BindablePage => pageFactoryOf(core, next),
  });
}

function recorderOf(
  recorder: PageRecorder | undefined,
): PageRecorder | undefined {
  if (recorder === undefined) {
    return undefined;
  }

  const projected: PageRecorder = {
    ...(recorder.group === undefined ? {} : { group: recorder.group }),
    ...(recorder.label === undefined ? {} : { label: recorder.label }),
  };

  return Object.keys(projected).length === 0 ? undefined : projected;
}

function pageFactoryFrom(def: AnyPageDefinition): BindablePage {
  const owner = `the "${def.name}" page`;
  const assembled = assemble(def, owner, pageReserved);

  if (def.header !== undefined && "header" in assembled.elements) {
    throw new Error(`${owner} declares both header and elements.header`);
  }

  const elements: BoundElements = {
    ...(def.header === undefined
      ? {}
      : {
          header: {
            locator: [
              { by: "role", role: "heading", name: textFrom(def.header) },
            ],
          },
        }),
    ...assembled.elements,
  };
  const { actions } = assembled;

  const anchor = classifyAnchor(
    def.name,
    def.anchor,
    elements,
    def.header !== undefined,
  );
  const recorder = recorderOf(def.recorder);
  const ready = readyDescriptorOf(def.ready);
  const projectedActions = classifyActions(actions);

  const captureRules = [
    ...assembled.capture,
    ...captureRulesOf(def.capture?.rules, owner, projectElements(elements)),
  ];
  const capture = captureDescriptorOf(captureRules);

  const descriptor: PageDescriptor = {
    path: def.path,
    name: def.name,
    ...(recorder === undefined ? {} : { recorder }),
    ...(ready === undefined ? {} : { ready }),
    ...(def.header === undefined ? {} : { header: textFrom(def.header) }),
    ...(anchor.descriptor === undefined ? {} : { anchor: anchor.descriptor }),
    elements: projectElements(elements),
    ...(projectedActions === undefined ? {} : { actions: projectedActions }),
    ...(capture === undefined ? {} : { capture }),
  };

  return pageFactoryOf({
    root: [],
    ...(anchor.anchor === undefined ? {} : { anchor: anchor.anchor }),
    ...(def.ready === undefined ? {} : { ready: def.ready }),
    elements,
    actions,
    descriptor,
  });
}

interface PresetBase {
  path: string;
  include: readonly AnySurface[];
  group: string[];
  ready?: AppReady;
  capture: CaptureRule[];
}

function presetBaseOf(
  outer: PresetBase | undefined,
  base: PagePresetDefinition<string, readonly AnySurface[]>,
): PresetBase {
  const ready = base.ready ?? outer?.ready;

  return {
    path: `${outer?.path ?? ""}${base.path}`,
    include: [...(outer?.include ?? []), ...(base.include ?? [])],
    group: [...(outer?.group ?? []), ...(base.recorder?.group ?? [])],
    capture: [...(base.capture?.rules ?? []), ...(outer?.capture ?? [])],
    ...(ready === undefined ? {} : { ready }),
  };
}

function presetOf(base: PresetBase): PagePreset<string, readonly AnySurface[]> {
  const apply = (def: AnyPageDefinition): AnyPageDefinition => {
    const group = [...base.group, ...(def.recorder?.group ?? [])];
    const recorder: PageRecorder = {
      ...def.recorder,
      ...(group.length === 0 ? {} : { group }),
    };
    const ready = def.ready ?? base.ready;
    const capture = [...(def.capture?.rules ?? []), ...base.capture];

    return {
      ...def,
      path: `${base.path}${def.path}`,
      include: [...base.include, ...(def.include ?? [])],
      recorder,
      ...(capture.length === 0 ? {} : { capture: { rules: capture } }),
      ...(ready === undefined ? {} : { ready }),
    };
  };

  const preset = (
    definition: AnyPageDefinition | ((...params: never[]) => AnyPageDefinition),
  ): unknown => definer(definition, (def) => pageFactoryFrom(apply(def)));

  return Object.assign(preset, {
    path: base.path,
    include: base.include,
    preset: (
      sub: PagePresetDefinition<string, readonly AnySurface[]>,
    ): PagePreset<string, readonly AnySurface[]> =>
      presetOf(presetBaseOf(base, sub)),
  }) as unknown as PagePreset<string, readonly AnySurface[]>;
}

export const definePage = Object.assign(
  (
    definition: AnyPageDefinition | ((...params: never[]) => AnyPageDefinition),
  ): unknown => definer(definition, pageFactoryFrom),
  {
    preset: (
      base: PagePresetDefinition<string, readonly AnySurface[]>,
    ): PagePreset<string, readonly AnySurface[]> =>
      presetOf(presetBaseOf(undefined, base)),
  },
) as unknown as DefinePage;

export type AnyPages = Record<string, AnyPageFactory>;

export interface AppDefinition<P extends AnyPages> {
  pages: P;
  ready?: AppReady;
  capture?: { rules: { match: RegExp; text: string }[] };
}

export type BoundPages<P extends AnyPages> = {
  [K in keyof P]: P[K] extends (page: Page) => infer Instance
    ? Instance
    : never;
};

export interface AppFixtures<P extends AnyPages> extends RecorderFixtures {
  pages: BoundPages<P>;
}

type DefaultTestArgs<P extends AnyPages> = PlaywrightTestArgs &
  PlaywrightTestOptions &
  AppFixtures<P>;

type DefaultWorkerArgs = PlaywrightWorkerArgs & PlaywrightWorkerOptions;

export interface AppFixtureOptions {
  base?: TestType<PlaywrightTestArgs, NonNullable<unknown>>;
}

export interface AppFixture<P extends AnyPages> {
  <
    Defs extends readonly AnyProvision[],
    T extends PlaywrightTestArgs,
    W extends NonNullable<unknown>,
  >(
    provisions: Defs,
    options: AppFixtureOptions & { base: TestType<T, W> },
  ): TestType<T & AppFixtures<P> & { provision: ProvisionMap<Defs> }, W>;
  <Defs extends readonly AnyProvision[]>(
    provisions: Defs,
    options?: AppFixtureOptions,
  ): TestType<
    DefaultTestArgs<P> & { provision: ProvisionMap<Defs> },
    DefaultWorkerArgs
  >;
  <T extends PlaywrightTestArgs, W extends NonNullable<unknown>>(
    provisions: undefined,
    options: AppFixtureOptions & { base: TestType<T, W> },
  ): TestType<T & AppFixtures<P>, W>;
  (
    provisions?: undefined,
    options?: AppFixtureOptions,
  ): TestType<DefaultTestArgs<P>, DefaultWorkerArgs>;
}

export interface App<P extends AnyPages = AnyPages> {
  pages: P;
  fixture: AppFixture<P>;
  descriptor: AppDescriptor;
}

function boundPagesOf(pages: AnyPages, page: Page): Record<string, unknown> {
  const bound: Record<string, unknown> = {};
  const settled = new Map<string, unknown>();

  for (const [key, factory] of Object.entries(pages)) {
    Object.defineProperty(bound, key, {
      enumerable: true,
      get(): unknown {
        if (!settled.has(key)) {
          settled.set(key, factory(page));
        }

        return settled.get(key);
      },
    });
  }

  return bound;
}

function appOf<P extends AnyPages>(
  def: AppDefinition<P>,
  descriptor: AppDescriptor,
): App<P> {
  const byPath = new Map<string, string>();
  for (const page of descriptor.pages) {
    const holder = byPath.get(page.path);
    if (holder !== undefined) {
      throw new Error(
        `pages "${holder}" and "${page.name}" both claim the path ${page.path}`,
      );
    }
    byPath.set(page.path, page.name);
  }

  const bound: Record<string, AnyPageFactory> = {};
  const binding: AppBinding = {
    ...(def.ready === undefined ? {} : { ready: def.ready }),
    pages: (page) => boundPagesOf(bound, page),
  };

  for (const [key, factory] of Object.entries<AnyPageFactory>(def.pages)) {
    if (!isBindable(factory)) {
      throw new Error(`"${key}" is not a page defined with definePage`);
    }
    bound[key] = factory[bindKey](binding);
  }

  const app: App<P> = {
    pages: bound as P,
    descriptor,
    fixture: ((
      provisions?: readonly AnyProvision[],
      options?: AppFixtureOptions,
    ) => {
      const test = (options?.base ?? playwrightTest).extend<
        AppFixtures<AnyPages>
      >({
        ...createRecorderFixtures(app),
        pages: async ({ page }, use): Promise<void> => {
          await use(boundPagesOf(bound, page));
        },
      });

      return provisions === undefined
        ? test
        : test.extend<{ provision: ProvisionMap<readonly AnyProvision[]> }>({
            provision: async ({ page }, use): Promise<void> => {
              await using provisioner = createProvisioner(page, provisions);

              await use(provisioner.provision);
            },
          });
    }) as AppFixture<P>,
  };

  return app;
}

export function defineApp<P extends AnyPages>(def: AppDefinition<P>): App<P> {
  const ready = readyDescriptorOf(def.ready);
  const captureRules = (def.capture?.rules ?? []).map(
    (rule): CaptureRuleDescriptor => ({
      match: regexDescriptorOf(rule.match),
      text: rule.text,
    }),
  );
  const capture = captureDescriptorOf(captureRules);

  return appOf(def, {
    ...(ready === undefined ? {} : { ready }),
    pages: Object.values<AnyPageFactory>(def.pages)
      .map((page) => page.descriptor)
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    ...(capture === undefined ? {} : { capture }),
  });
}

function loadElement(descriptor: ElementDescriptor): BoundElement | undefined {
  if ("locator" in descriptor) {
    return descriptor.params === undefined
      ? { locator: descriptor.locator }
      : { locator: descriptor.locator, params: descriptor.params };
  }

  if ("surface" in descriptor) {
    return { surface: loadSurface(descriptor.surface) };
  }

  if ("overlay" in descriptor) {
    return { overlay: loadOverlay(descriptor) };
  }

  return undefined;
}

function loadElements(
  elements: Record<string, ElementDescriptor>,
): BoundElements {
  const bound: BoundElements = {};

  for (const [key, descriptor] of Object.entries(elements)) {
    const loaded = loadElement(descriptor);
    if (loaded !== undefined) {
      bound[key] = loaded;
    }
  }

  return bound;
}

function loadSurface(descriptor: NestedSurfaceDescriptor): NestedSurface {
  return {
    factory: componentFactoryOf({
      root: descriptor.root ?? [],
      elements: loadElements(descriptor.elements),
      actions: {},
      descriptor,
    }),
    descriptor,
  };
}

function loadOverlay(
  descriptor: Extract<ElementDescriptor, { overlay: OverlayDescriptor }>,
): NestedOverlay {
  const { overlay } = descriptor;
  const button = overlay.close.button;

  return {
    factory: overlayFactoryOf({
      root: overlay.root,
      elements: loadElements(overlay.elements),
      actions: {},
      close: {
        esc: overlay.close.esc,
        ...(button === undefined
          ? {}
          : {
              button: (root: Locator): Locator => resolveLocator(root, button),
            }),
      },
      descriptor: overlay,
    }),
    descriptor,
  };
}

export function loadPage(
  descriptor: PageDescriptor,
): PageFactory<string, Record<string, unknown>, Record<never, never>> {
  const ready =
    descriptor.ready !== undefined && "selector" in descriptor.ready
      ? descriptor.ready
      : undefined;
  const anchor: PageAnchor | undefined = Array.isArray(descriptor.anchor)
    ? { chain: descriptor.anchor }
    : descriptor.header === undefined
      ? undefined
      : { key: "header" };

  return pageFactoryOf({
    root: [],
    ...(anchor === undefined ? {} : { anchor }),
    ...(ready === undefined ? {} : { ready }),
    elements: loadElements(descriptor.elements),
    actions: {},
    descriptor,
  }) as PageFactory<string, Record<string, unknown>, Record<never, never>>;
}

export function loadApp(raw: unknown): App {
  const parsed = appDescriptorSchema.parse(raw);
  const pages = Object.fromEntries(
    parsed.pages.map((page) => [page.name, loadPage(page)]),
  );

  const ready =
    parsed.ready !== undefined && "selector" in parsed.ready
      ? parsed.ready
      : undefined;

  return appOf(
    {
      pages,
      ...(ready === undefined ? {} : { ready }),
    },
    parsed,
  );
}

export async function arriveAt<T extends { waitFor: () => Promise<void> }>(
  destination: Factory<T>,
  page: Page,
): Promise<T> {
  const arrived = destination(page);
  await arrived.waitFor();
  return arrived;
}

export async function waitForHydration(
  page: Page,
  timeoutMs = 60_000,
): Promise<void> {
  const marker = page.locator('html[data-hydrated="true"]');
  const attached = await marker
    .waitFor({ state: "attached", timeout: timeoutMs })
    .then(
      () => true,
      () => false,
    );

  if (!attached) {
    await page.reload();
    await marker.waitFor({ state: "attached", timeout: timeoutMs });
  }
}

export function pathParams<Path extends string>(
  path: Path,
  url: string,
): PathParams<Path> {
  return matchPath(path, url) as PathParams<Path>;
}

function matchPath(path: string, url: string): PathParams<string> {
  const pattern = new RegExp(
    `^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:[A-Za-z]+/g, "([^/]+)")}(?:/|$)`,
  );
  const names = [...path.matchAll(/:([A-Za-z]+)/g)].map(([, name]) => name);
  const pathname = new URL(url).pathname;
  const match = pattern.exec(pathname);

  if (match === null) {
    throw new Error(`${pathname} does not match ${path}`);
  }

  return Object.fromEntries(
    names.map((name, index) => [
      name,
      decodeURIComponent(match[index + 1] ?? ""),
    ]),
  ) as PathParams<string>;
}

function fillPath(path: string, params: Record<string, string>): string {
  return path.replace(/:([A-Za-z]+)/g, (match, name: string) => {
    const value = params[name];
    if (value === undefined) {
      throw new Error(`missing path param ${match}`);
    }

    return encodeURIComponent(value);
  });
}
