# Walkwright domain model

Walkwright describes an app as deferred, serializable locator structure. One
philosophy runs through every type: **primary nouns name descriptions awaiting
scope; instances exist only at the moment of use.** Everything is data except
action bodies and explicitly fenced opaque closures — and the data half is the
app map the agent loop reads, writes, and round-trips.

## Scope

```ts
type Scope = Page | LazyLocator;
```

Where a description gets grounded. A `Page` is the ground; a `LazyLocator` is a
description, so scoping by one _composes_ (chain concatenation) rather than
resolves. A resolved Playwright `Locator` never scopes anything — resolution is
a one-way door taken only at the leaves.

```ts
itemRow(listitem().filter({ hasText: name })); // composes — still data
itemsPage(page); // grounds — produces an instance
```

## LazyLocator

```ts
type LazyLocator = ((scope: Scope) => Locator) & {
  chain: LocatorDescriptor;
  params: readonly string[];
  // Playwright-mirror: getByRole, getByLabel, getByText, getByTestId, locator,
  // filter, nth, first, last, or, and, within — each returns a LazyLocator
};
```

The atom. A locator _description_ wearing a callable: a serializable chain that
becomes a real `Locator` only when handed a scope. Built from the role
vocabulary (`button("Save")`, `listitem()`, `css(".x")`, …) and combinators.
Parametric forms are curried builders whose interpolations trace into template
data:

```ts
statusHeading: (id: string, status: string) => heading(`Build ${id} ${status}`),
```

## Element

```ts
type LeafElement = LazyLocator | ((...params) => LazyLocator);
type Element =
  | LeafElement
  | Surface
  | ((...params) => Surface) // nested structure
  | { overlay: Overlay; open?(): Promise<void> } // overlay embed
  | ((scope) => unknown); // opaque, fenced
```

What a surface's `elements` map may hold. Leaves and surfaces project as data;
opaque closures project as `{ opaque }` holes with provenance. The honesty
rules apply: a parametric leaf whose params don't all appear in its traced
chain projects opaque (it still executes correctly).

- **Element = nest.** A surface used as an element keeps its boundary:
  `shell.elements.banner`.
- **Include = merge** (see Surface): a rootless surface's contents dissolve
  into the host.

## Surface

```ts
// definition
{ elements?: ElementMap; actions?: ActionMap; include?: RootlessSurface[] }

// the surface itself — deferred, optionally parametric
type Surface           = (scope: Scope) => SurfaceInstance;
type ParametricSurface = (...params) => Surface;

// instance
{ elements: {...},        // always nested under .elements
  ...actions,             // top-level methods
  self: LazyLocator,      // my grounded chain
  root?: Locator }        // resolved self, when mounted at a chain
```

The kernel. A named collection of elements and actions, lazy in its scope.
Component, overlay, dialog, and page are all Surface plus one decoration.
`include` merges rootless surfaces (elements and actions, flat, collisions
throw) — the concept formerly known as fragments, now a kernel capability.
Actions are `this`-based methods; `this` carries `elements`, `self`, `root`,
`page`, and (app-bound) `pages`. An action may not shadow a decorator field —
checked with a throw at define time. Elements are always accessed via
`.elements`; there are no reserved element names.

## Component

```ts
defineComponent({ root?: LazyLocator, elements, actions, include? })
```

Surface + placement. `root` is a chain meaning "find my boundary inside my
scope" — the only form (no closures, no `self` keyword). Rootless components
are pure groupings. `instance.root` derives from the mount: present whenever
the surface was grounded through a nonempty chain.

```ts
const itemRow = defineComponent({
  elements: { titleLink: role("link"), deleteButton: button("Delete") },
});
row: (name: string) => itemRow(listitem().filter({ hasText: name })),
// row(name).root is the row — the boundary is the chain you pointed with
```

## Overlay

```ts
defineOverlay({
  root: LazyLocator,                       // resolved against the PAGE — definitional
  recorder: { label: string },             // capture config, required
  close?: { esc?: boolean; button?: LazyLocator },   // default { esc: true }
  elements?, actions?,
  include?: RootlessSurface[],
})
```

Surface for content that floats over the page (menus, dialogs, listboxes,
tooltips). Its root discards the incoming scope; inner elements resolve within
the root. Overlays are **openerless by definition** — how one appears is the
embedder's knowledge, declared at the embedding as an inline embed literal
whose `open` method is fully typed against the host (`this` is the embedding
surface's instance — no annotations):

```ts
elements: {
  savedKeyDialog: {
    overlay: savedKeyDialog,
    async open() {
      await this.elements.saveButton.click();
      await this.elements.savedKeyDialog.waitFor();
    },
  },
}
```

`open()` exists only where the embedding declared one; otherwise it throws
("evoked elsewhere — await `waitFor()`"). `close()` is **derived data, never
authored**: click `close.button` if declared, else Escape if `esc`, then wait
hidden. `waitFor(state?)` always exists. Symmetry: _how you get in depends on
where you are; how you get out is a property of the thing itself._

### Dialog

```ts
defineDialog({ name: string | RegExp, role?, ... })
```

Sugar: an overlay whose root is `role(role ?? "dialog", name)` and whose
`recorder.label` defaults from a string name.

## Page

```ts
definePage({
  path: "/items/:id",
  name: "item",                       // sticky map identity
  ready?: AppReady,                   // overrides the app default
  header?: string | RegExp,           // sugar: elements.header + default anchor
  anchor?: string | LazyLocator,      // element key or chain; ?? header
  recorder?: { group?: string[]; label?: string },
  elements?, actions?,
  include?: RootlessSurface[],        // merge shared surfaces (chrome, shared panels)
})
```

Surface grounded at `Page` + route identity. Derived on the instance: `goto`,
`url`, `params`, `waitFor`. Arrival detection is two-factor: the path pattern
says "URL matches," the anchor says "content arrived." `recorder` is namespaced
capture config — DOM/route truth stays top-level.

There is no layout concept. Shared path prefixes, chrome and recorder config
live in a **page preset**: `definePage.preset({ path, include?, recorder?,
ready? })` returns a function called exactly like `definePage` (object or
parametric builder form). The preset prepends its path (param typing is
preserved), puts its `include` surfaces first, and nests its recorder group in
front of the page's; a preset `ready` is the page default. Presets nest through
`.preset(...)`. Inside a preset page, `this` sees the preset's chrome. A preset
is sugar over `definePage` — nothing about it reaches the descriptor.

```ts
const workspacePage = definePage.preset({
  path: workspacePath,
  include: [appShellChrome],
  recorder: { group: ["workspace"] },
});
const auditLogsPage = workspacePage.preset({
  path: "/audit-logs",
  recorder: { group: ["audit logs"] },
});
const accessLogsPage = auditLogsPage({ path: "/access", name: "access", ... });
// path "/app/workspaces/:workspaceId/audit-logs/access", group ["workspace", "audit logs"]
```

`PresetPage<typeof preset, Sub, M?, H?, A?>` names a preset page's factory type
for helpers that wrap a preset in their own function.

## App

```ts
const app = defineApp({
  pages: { loginPage, itemsPage, itemPage },   // named record
  ready?: AppReady,                            // default for all pages
});
```

The aggregation point and the access point. `app.pages` is the typed record of
**app-bound** page surfaces: binding injects the ready default and the
cross-page record — there is no adopt step and no factory mutation; raw
factories stay app-independent. `app.fixture(provisions?, { base? })` yields a
Playwright test with the recorder fixtures and a lazily bound, per-test
`pages` fixture. `app.descriptor` is the serialized map; `loadApp(json)`
reconstructs an equivalent app.

```ts
test("rename", async ({ pages, record }) => {
  await record(pages.itemsPage, {});
  await pages.itemsPage.openItem("Hammer");
  await pages.itemPage.waitFor();
});
```

## Cross-page navigation

The default idiom: navigation actions return nothing; the spec composes the
arrival through the typed `pages` fixture. The supported convenience: actions
on app-bound instances have `this.pages` (bound to `this.page`) and may return
a destination — typed globally via a one-line, handwritten registration, no
codegen:

```ts
declare module "walkwright/pom" {
  interface Register {
    app: typeof app;
  }
}
```

Pages never import each other for navigation; the app record is the only
cross-page channel. `this.pages` is for navigation results, not for reaching
into other pages' elements mid-action.

## Descriptors (output = state)

Every definition projects to data. `SurfaceDescriptor { elements, actions }`
embeds everywhere: pages carry one plus route identity and `recorder`;
overlays carry one plus `root`, `recorder.label`, `close`; a surface used as
an element embeds one in the host's map — nested structure is visible, not
opaque. Locator data uses the existing algebra (role/text/testid/css/xpath
nodes, ordered refinements, template Text, `or`/`and`). Actions project as
named opaque entries — except an overlay's derived `close`, which is fully
executable from data. The complete opacity inventory of a map: action bodies,
fenced opaque elements, and nothing else.

## Dropped concepts

`fragments` (→ `include`), `defineLayout`/`Layout` (→ `definePage.preset`),
`root: self` and closure roots (→ chain roots + derived `instance.root`),
`trigger`/`dismiss` (→ `withOpen` + `close` data), `adopt` (→ app-binding),
element flattening and reserved element keys (→ `.elements` nesting),
`withActions` (→ inline `this`-based actions), `param()` and hand branding
(→ trace probing).

## Deferred rounds

- **Recipes**: a minimal step vocabulary (`click`, `press`, `fill`,
  `waitFor`) so simple actions — including `withOpen` bodies — can be declared
  as data. Overlay `close` is the existing pilot.
- **Typed anchors**: restore `keyof`-typed element-key anchors when the
  TypeScript 6 overload-inference interaction settles.
- **Registry return-type inference**: spike whether cross-page action returns
  can drop their explicit annotations.
