import type { Locator, Page } from "@playwright/test";
import { z } from "zod";

export type Mount = Page | Locator;

export type Scope = Page | LazyLocator;

export function pageOf(mount: Mount): Page {
  return "goto" in mount ? mount : mount.page();
}

export type Text =
  | string
  | { pattern: string; flags?: string }
  | { param: string }
  | { template: (string | { param: string })[] };

export const textSchema: z.ZodType<Text> = z.union([
  z.string(),
  z.object({ pattern: z.string(), flags: z.string().optional() }),
  z.object({ param: z.string() }),
  z.object({
    template: z.array(z.union([z.string(), z.object({ param: z.string() })])),
  }),
]);

export type By =
  | {
      by: "role";
      role: string;
      name?: Text;
      exact?: true;
      checked?: boolean;
      expanded?: boolean;
      selected?: boolean;
      pressed?: boolean;
      disabled?: boolean;
    }
  | { by: "label" | "placeholder" | "text" | "title"; text: Text; exact?: true }
  | { by: "testid"; id: string };

const roleStepSchema = z.object({
  by: z.literal("role"),
  role: z.string(),
  name: textSchema.optional(),
  exact: z.literal(true).optional(),
  checked: z.boolean().optional(),
  expanded: z.boolean().optional(),
  selected: z.boolean().optional(),
  pressed: z.boolean().optional(),
  disabled: z.boolean().optional(),
});

const textStepSchema = z.object({
  by: z.enum(["label", "placeholder", "text", "title"]),
  text: textSchema,
  exact: z.literal(true).optional(),
});

const testIdStepSchema = z.object({
  by: z.literal("testid"),
  id: z.string(),
});

export interface LocatorFilter {
  hasText?: Text;
  has?: LocatorDescriptor;
  hasNot?: LocatorDescriptor;
}

export type Refinement = { filter: LocatorFilter } | { nth: number };

export interface Refined {
  refine?: Refinement[];
}

const filterSchema = z.object({
  hasText: textSchema.optional(),
  has: z
    .lazy((): z.ZodType<LocatorDescriptor> => locatorDescriptorSchema)
    .optional(),
  hasNot: z
    .lazy((): z.ZodType<LocatorDescriptor> => locatorDescriptorSchema)
    .optional(),
});

const refinementSchema: z.ZodType<Refinement> = z.union([
  z.object({ filter: filterSchema }),
  z.object({ nth: z.number() }),
]);

const refinementShape = {
  refine: z.array(refinementSchema).optional(),
};

const cssXpathStepSchema = z.object({
  by: z.enum(["css", "xpath"]),
  selector: z.string(),
});

export type LocatorNode =
  | (By & Refined)
  | ({ by: "css" | "xpath"; selector: string } & Refined)
  | { or: LocatorDescriptor[] }
  | { and: LocatorDescriptor[] };

const locatorNodeSchema: z.ZodType<LocatorNode> = z.lazy(() =>
  z.union([
    roleStepSchema.extend(refinementShape),
    textStepSchema.extend(refinementShape),
    testIdStepSchema.extend(refinementShape),
    cssXpathStepSchema.extend(refinementShape),
    z.object({ or: z.array(locatorDescriptorSchema) }),
    z.object({ and: z.array(locatorDescriptorSchema) }),
  ]),
);

export type LocatorDescriptor = LocatorNode[];

export const locatorDescriptorSchema: z.ZodType<LocatorDescriptor> =
  z.array(locatorNodeSchema);

export type Role = Parameters<Page["getByRole"]>[0];
type RoleQueryOptions = Parameters<Page["getByRole"]>[1];

function paramValueOf(name: string, params: Record<string, string>): string {
  const value = params[name];
  if (value === undefined) {
    throw new Error(`missing locator param "${name}"`);
  }

  return value;
}

function textOf(text: Text, params: Record<string, string>): string | RegExp {
  if (typeof text === "string") {
    return text;
  }

  if ("pattern" in text) {
    return new RegExp(text.pattern, text.flags);
  }

  if ("template" in text) {
    return text.template
      .map((part) =>
        typeof part === "string" ? part : paramValueOf(part.param, params),
      )
      .join("");
  }

  return paramValueOf(text.param, params);
}

function exactOptions(exact: true | undefined): { exact: true } | undefined {
  return exact === undefined ? undefined : { exact };
}

function roleOptions(
  node: Extract<By, { by: "role" }>,
  params: Record<string, string>,
): RoleQueryOptions {
  const { name, exact, checked, expanded, selected, pressed, disabled } = node;

  if (
    name === undefined &&
    exact === undefined &&
    checked === undefined &&
    expanded === undefined &&
    selected === undefined &&
    pressed === undefined &&
    disabled === undefined
  ) {
    return undefined;
  }

  return {
    ...(name === undefined ? {} : { name: textOf(name, params) }),
    ...(exact === undefined ? {} : { exact }),
    ...(checked === undefined ? {} : { checked }),
    ...(expanded === undefined ? {} : { expanded }),
    ...(selected === undefined ? {} : { selected }),
    ...(pressed === undefined ? {} : { pressed }),
    ...(disabled === undefined ? {} : { disabled }),
  };
}

function applyStep(
  current: Page | Locator,
  node: LocatorNode,
  params: Record<string, string>,
): Locator {
  if ("or" in node) {
    return orOf(current, node.or, params);
  }

  if ("and" in node) {
    return andOf(current, node.and, params);
  }

  switch (node.by) {
    case "role":
      return current.getByRole(node.role as Role, roleOptions(node, params));
    case "label":
      return current.getByLabel(
        textOf(node.text, params),
        exactOptions(node.exact),
      );
    case "placeholder":
      return current.getByPlaceholder(
        textOf(node.text, params),
        exactOptions(node.exact),
      );
    case "text":
      return current.getByText(
        textOf(node.text, params),
        exactOptions(node.exact),
      );
    case "title":
      return current.getByTitle(
        textOf(node.text, params),
        exactOptions(node.exact),
      );
    case "testid":
      return current.getByTestId(node.id);
    case "css":
      return current.locator(node.selector);
    case "xpath":
      return current.locator(`xpath=${node.selector}`);
    default: {
      const exhaustive: never = node;
      throw new Error(`unknown locator step: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function applyRefinement(
  located: Locator,
  current: Page | Locator,
  refinement: Refinement,
  params: Record<string, string>,
): Locator {
  if ("nth" in refinement) {
    return located.nth(refinement.nth);
  }

  const { hasText, has, hasNot } = refinement.filter;
  const page = pageOf(current);

  return located.filter({
    ...(hasText === undefined ? {} : { hasText: textOf(hasText, params) }),
    ...(has === undefined ? {} : { has: resolveLocator(page, has, params) }),
    ...(hasNot === undefined
      ? {}
      : { hasNot: resolveLocator(page, hasNot, params) }),
  });
}

function applyNode(
  current: Page | Locator,
  node: LocatorNode,
  params: Record<string, string>,
): Locator {
  const located = applyStep(current, node, params);
  const refine = "by" in node ? (node.refine ?? []) : [];

  return refine.reduce(
    (refined, refinement) =>
      applyRefinement(refined, current, refinement, params),
    located,
  );
}

function orOf(
  current: Page | Locator,
  branches: LocatorDescriptor[],
  params: Record<string, string>,
): Locator {
  const [first, ...rest] = branches;
  if (first === undefined) {
    throw new Error('locator descriptor\'s "or" has no branches');
  }

  return rest.reduce(
    (acc, branch) => acc.or(resolveLocator(current, branch, params)),
    resolveLocator(current, first, params),
  );
}

function andOf(
  current: Page | Locator,
  branches: LocatorDescriptor[],
  params: Record<string, string>,
): Locator {
  const [first, ...rest] = branches;
  if (first === undefined) {
    throw new Error('locator descriptor\'s "and" has no branches');
  }

  return rest.reduce(
    (acc, branch) => acc.and(resolveLocator(current, branch, params)),
    resolveLocator(current, first, params),
  );
}

export function resolveLocator(
  scope: Page | Locator,
  locator: LocatorDescriptor,
  params: Record<string, string> = {},
): Locator {
  const [first, ...rest] = locator;
  if (first === undefined) {
    throw new Error("locator descriptor has no nodes");
  }

  return rest.reduce<Locator>(
    (current, node) => applyNode(current, node, params),
    applyNode(scope, first, params),
  );
}

export interface FilterOptions {
  hasText?: string | RegExp | Text;
  has?: LazyLocator;
  hasNot?: LazyLocator;
}

export interface LazyLocator {
  (scope: LazyLocator): LazyLocator;
  (scope: Page): Locator;
  chain: LocatorDescriptor;
  params: readonly string[];
  getByRole: (
    role: Role,
    options?: RoleLeafOptions & { name?: string | RegExp },
  ) => LazyLocator;
  getByLabel: (text: string | RegExp, options?: NameOptions) => LazyLocator;
  getByPlaceholder: (
    text: string | RegExp,
    options?: NameOptions,
  ) => LazyLocator;
  getByText: (text: string | RegExp, options?: NameOptions) => LazyLocator;
  getByTitle: (text: string | RegExp, options?: NameOptions) => LazyLocator;
  getByTestId: (id: string) => LazyLocator;
  locator: (selector: string) => LazyLocator;
  filter: (options: FilterOptions) => LazyLocator;
  nth: (n: number) => LazyLocator;
  first: () => LazyLocator;
  last: () => LazyLocator;
  or: (other: LazyLocator) => LazyLocator;
  and: (other: LazyLocator) => LazyLocator;
  within: (parent: LazyLocator) => LazyLocator;
}

export function isLazyLocator(value: unknown): value is LazyLocator {
  return (
    typeof value === "function" &&
    Array.isArray((value as { chain?: unknown }).chain) &&
    Array.isArray((value as { params?: unknown }).params)
  );
}

export function textFrom(value: string | RegExp): Text {
  return typeof value === "string"
    ? value
    : { pattern: value.source, flags: value.flags };
}

export function plainTextOf(text: Text, what: string): string | RegExp {
  if (typeof text === "string") {
    return text;
  }

  if ("pattern" in text) {
    return new RegExp(text.pattern, text.flags);
  }

  throw new Error(`a ${what} cannot be a param placeholder`);
}

function hasTextOf(value: string | RegExp | Text): Text {
  return value instanceof RegExp ? textFrom(value) : value;
}

function lastNodeOf(locator: LocatorDescriptor): LocatorNode & Refined {
  const last = locator[locator.length - 1];
  if (last === undefined) {
    throw new Error("locator descriptor has no nodes");
  }

  if ("or" in last || "and" in last) {
    const kind = "or" in last ? "or" : "and";
    throw new Error(`cannot refine an ${kind} node`);
  }

  return last;
}

function mergeRefinement(
  locator: LocatorDescriptor,
  step: Refinement,
): LocatorDescriptor {
  const last = lastNodeOf(locator);
  return [
    ...locator.slice(0, -1),
    { ...last, refine: [...(last.refine ?? []), step] },
  ];
}

function filterDescriptorOf(options: FilterOptions): LocatorFilter {
  return {
    ...(options.hasText === undefined
      ? {}
      : { hasText: hasTextOf(options.hasText) }),
    ...(options.has === undefined ? {} : { has: options.has.chain }),
    ...(options.hasNot === undefined ? {} : { hasNot: options.hasNot.chain }),
  };
}

function collectParamNames(
  locator: LocatorDescriptor,
  seen: Set<string>,
  names: string[],
): void {
  const noteName = (name: string): void => {
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  };

  const noteText = (text: Text | undefined): void => {
    if (text === undefined || typeof text === "string") {
      return;
    }

    if ("param" in text) {
      noteName(text.param);
      return;
    }

    if ("template" in text) {
      for (const part of text.template) {
        if (typeof part !== "string") {
          noteName(part.param);
        }
      }
    }
  };

  for (const node of locator) {
    if ("or" in node || "and" in node) {
      for (const branch of "or" in node ? node.or : node.and) {
        collectParamNames(branch, seen, names);
      }
      continue;
    }

    if (node.by === "role") {
      noteText(node.name);
    } else if ("text" in node) {
      noteText(node.text);
    }

    for (const refinement of node.refine ?? []) {
      if ("filter" in refinement) {
        noteText(refinement.filter.hasText);
        if (refinement.filter.has !== undefined) {
          collectParamNames(refinement.filter.has, seen, names);
        }
        if (refinement.filter.hasNot !== undefined) {
          collectParamNames(refinement.filter.hasNot, seen, names);
        }
      }
    }
  }
}

export function paramNamesOf(locator: LocatorDescriptor): string[] {
  const names: string[] = [];
  collectParamNames(locator, new Set(), names);
  return names;
}

export function lazyLocatorOf(locator: LocatorDescriptor): LazyLocator {
  function call(scope: LazyLocator): LazyLocator;
  function call(scope: Page): Locator;
  function call(scope: Scope): LazyLocator | Locator {
    return isLazyLocator(scope)
      ? lazyLocatorOf([...scope.chain, ...locator])
      : resolveLocator(scope, locator);
  }

  return Object.assign(call, {
    chain: locator,
    params: paramNamesOf(locator),
    getByRole: (
      role: Role,
      options?: RoleLeafOptions & { name?: string | RegExp },
    ): LazyLocator =>
      lazyLocatorOf([...locator, roleNodeOf(role, options?.name, options)]),
    getByLabel: (text: string | RegExp, options?: NameOptions): LazyLocator =>
      lazyLocatorOf([...locator, textNodeOf("label", text, options?.exact)]),
    getByPlaceholder: (
      text: string | RegExp,
      options?: NameOptions,
    ): LazyLocator =>
      lazyLocatorOf([
        ...locator,
        textNodeOf("placeholder", text, options?.exact),
      ]),
    getByText: (text: string | RegExp, options?: NameOptions): LazyLocator =>
      lazyLocatorOf([...locator, textNodeOf("text", text, options?.exact)]),
    getByTitle: (text: string | RegExp, options?: NameOptions): LazyLocator =>
      lazyLocatorOf([...locator, textNodeOf("title", text, options?.exact)]),
    getByTestId: (id: string): LazyLocator =>
      lazyLocatorOf([...locator, { by: "testid", id }]),
    locator: (selector: string): LazyLocator =>
      lazyLocatorOf([...locator, { by: "css", selector }]),
    filter: (options: FilterOptions): LazyLocator =>
      lazyLocatorOf(
        mergeRefinement(locator, { filter: filterDescriptorOf(options) }),
      ),
    nth: (n: number): LazyLocator =>
      lazyLocatorOf(mergeRefinement(locator, { nth: n })),
    first: (): LazyLocator =>
      lazyLocatorOf(mergeRefinement(locator, { nth: 0 })),
    last: (): LazyLocator =>
      lazyLocatorOf(mergeRefinement(locator, { nth: -1 })),
    or: (other: LazyLocator): LazyLocator =>
      lazyLocatorOf([{ or: [locator, other.chain] }]),
    and: (other: LazyLocator): LazyLocator =>
      lazyLocatorOf([{ and: [locator, other.chain] }]),
    within: (parent: LazyLocator): LazyLocator =>
      lazyLocatorOf([...parent.chain, ...locator]),
  });
}

function stepLocator(by: By): LazyLocator {
  return lazyLocatorOf([by]);
}

export function css(selector: string): LazyLocator {
  return lazyLocatorOf([{ by: "css", selector }]);
}

export function xpath(selector: string): LazyLocator {
  return lazyLocatorOf([{ by: "xpath", selector }]);
}

export interface NameOptions {
  exact?: boolean;
}

export interface RoleLeafOptions extends NameOptions {
  checked?: boolean;
  expanded?: boolean;
  selected?: boolean;
  pressed?: boolean;
  disabled?: boolean;
}

type NamedLazyLocator = (
  name: string | RegExp,
  options?: RoleLeafOptions,
) => LazyLocator;

type OptionallyNamedLazyLocator = (
  name?: string | RegExp,
  options?: RoleLeafOptions,
) => LazyLocator;

function roleNodeOf(
  role: Role,
  name: string | RegExp | undefined,
  options: RoleLeafOptions | undefined,
): Extract<By, { by: "role" }> {
  return {
    by: "role",
    role,
    ...(name === undefined ? {} : { name: textFrom(name) }),
    ...(options?.exact === true ? { exact: true as const } : {}),
    ...(options?.checked === undefined ? {} : { checked: options.checked }),
    ...(options?.expanded === undefined ? {} : { expanded: options.expanded }),
    ...(options?.selected === undefined ? {} : { selected: options.selected }),
    ...(options?.pressed === undefined ? {} : { pressed: options.pressed }),
    ...(options?.disabled === undefined ? {} : { disabled: options.disabled }),
  };
}

function roleLeaf(
  role: Role,
  name: string | RegExp | undefined,
  options: RoleLeafOptions | undefined,
): LazyLocator {
  return stepLocator(roleNodeOf(role, name, options));
}

function textNodeOf(
  by: "label" | "placeholder" | "text" | "title",
  value: string | RegExp,
  exact: boolean | undefined,
): Extract<By, { by: "label" | "placeholder" | "text" | "title" }> {
  return {
    by,
    text: textFrom(value),
    ...(exact === true ? { exact: true as const } : {}),
  };
}

function textStepLeaf(
  by: "label" | "placeholder" | "text" | "title",
  value: string | RegExp,
  exact: boolean | undefined,
): LazyLocator {
  return stepLocator(textNodeOf(by, value, exact));
}

const named =
  (role: Role): NamedLazyLocator =>
  (name, ...rest: [RoleLeafOptions?]) =>
    roleLeaf(role, name, rest[0]);

const optionallyNamed =
  (role: Role): OptionallyNamedLazyLocator =>
  (name, ...rest: [RoleLeafOptions?]) =>
    roleLeaf(role, name, rest[0]);

export const button = named("button");
export const link = named("link");
export const heading = named("heading");
export const radio = named("radio");
export const tab = named("tab");
export const option = named("option");
export const menuitem = named("menuitem");
export const columnheader = named("columnheader");

export const textbox = optionallyNamed("textbox");
export const checkbox = optionallyNamed("checkbox");
export const combobox = optionallyNamed("combobox");
export const treeitem = optionallyNamed("treeitem");
export const table = optionallyNamed("table");
export const grid = optionallyNamed("grid");
export const tree = optionallyNamed("tree");
export const list = optionallyNamed("list");
export const listitem = optionallyNamed("listitem");
export const alert = optionallyNamed("alert");
export const main = optionallyNamed("main");
export const navigation = optionallyNamed("navigation");
export const tabpanel = optionallyNamed("tabpanel");
export const menu = optionallyNamed("menu");
export const row = optionallyNamed("row");
export const cell = optionallyNamed("cell");
export const listbox = optionallyNamed("listbox");
export const radiogroup = optionallyNamed("radiogroup");
export const dialog = optionallyNamed("dialog");
export const banner = optionallyNamed("banner");

export function label(
  value: string | RegExp,
  options?: NameOptions,
): LazyLocator {
  return textStepLeaf("label", value, options?.exact);
}

export function testId(id: string): LazyLocator {
  return stepLocator({ by: "testid", id });
}

export function text(
  value: string | RegExp,
  options?: NameOptions,
): LazyLocator {
  return textStepLeaf("text", value, options?.exact);
}

export function role(
  roleName: Role,
  name?: string | RegExp,
  options?: RoleLeafOptions,
): LazyLocator {
  return roleLeaf(roleName, name, options);
}
