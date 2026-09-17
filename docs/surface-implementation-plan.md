# Surface redesign — implementation plan

Hand-off document for a clean session. Read `docs/domain-model.md` first — it is
the authoritative target design; this document is the route to it. The current
code implements the _previous_ model (flattened instances, fragments, layouts,
adopt, trigger/dismiss overlays, `root: self`); every delta between the code
and the domain model is intentional work listed below.

## Repos and roles

- `~/dev/h7n/walkwright/public` — the monorepo. `packages/runtime` (the
  library, published as `walkwright`), `packages/testbed` (showcase app + POM +
  walks; the acceptance harness). All design work happens here.
- `~/dev/cerbos/spitfire/frontend/packages/e2e-tests` — the real consumer.
  Migrates ONCE, in R4. Uses TypeScript 6.0 (preview, intentional — do not
  touch its TS setup); walkwright itself builds with TS 5.9. Any type-level
  runtime change must be validated against spitfire's compiler before it
  counts as done.
- Spitfire consumes the npm package. During development, refresh its installed
  build in place:
  `cd ~/dev/cerbos/spitfire/frontend/packages/e2e-tests/node_modules && MW=$(readlink -f walkwright) && rm -rf "$MW/build" && cp -R ~/dev/h7n/walkwright/public/packages/runtime/build "$MW/build"`
  (remove-then-copy — never overwrite in place, pnpm store is hardlinked).

## Ground rules

- packages/runtime and packages/testbed are **comment-free** (no `//` or
  `/* */` anywhere, including eslint directives — restructure instead).
  Spitfire keeps its own style (comments allowed there).
- Do not commit or publish unless the user asks.
- Verification battery, walkwright side (run from repo root; all must pass):
  `pnpm --filter walkwright typecheck && pnpm --filter testbed typecheck`,
  `pnpm lint` (delete `packages/testbed/.react-router` before linting and
  after any testwalk — it is a build artifact eslint chokes on),
  `pnpm run knip`, `pnpm --filter walkwright build`, `pnpm testwalk` (must end
  "4 passed"; shot count currently 18).
- Census discipline: dump `app.descriptor` before/after each round with a
  scratch script — `node --experimental-strip-types <script>` importing
  `packages/testbed/src/walk/pom.ts`, printing
  `JSON.stringify(app.descriptor, null, 2)`. NOTE: the workspace resolves
  `walkwright/*` to `build/`, so rebuild before dumping. Every census diff must
  be justified line-by-line; in R1 the only acceptable direction is
  opaque→data.
- Spitfire gates (from `~/dev/cerbos/spitfire/frontend`):
  `pnpm exec tsc --build --force packages/e2e-tests` → 0 errors;
  `pnpm run eslint:run packages/e2e-tests` → 0 problems;
  `cd packages/e2e-tests && pnpm run test --list` → 29 tests in 20 files.
- Recommended working style (proven in prior rounds): delegate implementation
  to a subagent with a precise spec, then independently re-run every gate and
  read the load-bearing diffs before accepting. Behavior probes in scratch
  files (`/tmp`-equivalent scratchpad), deleted after use.

## Facts the implementer must not rediscover the hard way

- **The `parameterized: true` brand is load-bearing.** Uncalled parametric
  builders used as element values exist in both codebases (testbed
  `card: overviewCard`; spitfire `promoteBuildDialog`, `entry`, `testCase`,
  `filterCard`, `freezeDeploymentDialog`, `rule`). The definer brands builders
  internally; keep that. (The public `parameterized()` export is already
  deleted.)
- **Trace honesty rules exist and must survive**: random-tagged sentinels,
  template splitting into `{template: [...]}` Text, all-declared-params-used-
  or-parametric-opaque, untraceable-lazy → parametric-opaque mount.
- **Page `anchor` is `string | LazyLocator`, deliberately untyped-keyed**:
  any `keyof E` dependence in that slot collapses `definePage` overload
  inference under spitfire's TS 6.0 (verified empirically; three formulations
  tried). Do not "improve" it back to `keyof` — it's a deferred round.
- **`instantiateBound` elements are lazy getters with cycle detection** —
  preserve that behavior through the kernel rewrite.
- **Overlay roots resolve against the page; elements within the root.**
  The recorder names dialog shots from the instance's name/label; nameless
  overlays require an explicit state string.
- **`loadApp`/`loadPage` reconstruct from JSON** and must keep round-tripping
  (`JSON.stringify` equality) through every schema change.
- Element-map `ThisType` fixpoints are fragile: one explicit return-type
  annotation is the accepted fix for cross-surface returns (see
  `itemsPage.openItem` pattern). Never fix inference with `as` casts.

---

## R1 — Surface kernel & Scope (runtime + testbed)

The largest round. Target state per domain-model.md sections Scope, Element,
Surface, Component.

1. **Kernel**: one internal surface core — bind elements, mount, project —
   used by component/overlay/page assembly and the loader. Definitions are
   `{elements?, actions?, include?}` plus decorator fields.
2. **Scope**: `Scope = Page | LazyLocator` for all surface instantiation.
   Called with a `LazyLocator` → returns a composed (still-deferred) surface;
   called with a `Page` → grounds to an instance. Resolved-`Locator` scoping
   is removed from every public signature. Opaque element closures (tier 3)
   still receive resolved reality at mount — laziness governs instantiation
   and the data path, not closure inputs.
3. **Instance shape**: `elements` nested under `.elements` everywhere; actions
   as top-level methods; `self: LazyLocator` (grounded chain) on every
   chain-scoped instance; `root: Locator` derived (present iff the combined
   chain is nonempty). Define-time throw if an action name shadows a decorator
   field. Delete `OverlaySafeKeys`/flattening machinery.
4. **Component**: `root?: LazyLocator` only — no closure roots, no `self`
   keyword (delete the export). `root` semantics: pre-composition ("what I
   look like"); scope is "where to look".
5. **`include`**: kernel-level merge of rootless surfaces (elements AND
   actions; any collision throws naming both sources — including
   action-vs-action, which today merges silently). Including a rooted surface
   throws: "X has a root — embed it as an element to keep its boundary; only
   rootless surfaces can be merged." Delete the fragments machinery
   (`.fragment` statics, `FragmentsShape`/`FragmentsElements`/
   `FragmentsDerived`, the page-only merge path). Type-level rooted/rootless
   distinction may stay if TypeScript is graceful about it; otherwise type
   loose and rely on the runtime throw.
6. **Descriptors**: `SurfaceDescriptor {elements, actions}` embedded in page
   and overlay descriptors; ElementDescriptor gains a nested-surface variant
   `{surface: {root?: LocatorDescriptor, elements, actions}}` so components
   used as elements project as data instead of `{opaque}`. Loader
   reconstructs nested surfaces. Zod schemas updated.
7. **Testbed migration**: `.elements.` call sites, root conversions
   (`overviewCard` root closure → `listitem().filter({hasText: title})`;
   `mainRegion` → `main()`; `root: self` deletions), walks green.

Acceptance: full walkwright battery; census diff shows formerly-opaque nested
components (e.g. `topbar`, and `moreMenu` inside it) appearing as
`{surface: ...}` data and NOTHING moving data→opaque; loadApp round-trip on
the new census; probes for: include collision throw (elements and actions),
rooted-include throw, `instance.self`/`root` derivation for pointed-at
components, deferred composition (`itemRow(chain)` then `(page)`).

## R2 — Overlay redesign (runtime + testbed)

Target: domain-model.md Overlay/Dialog sections.

1. Delete `trigger` and `dismiss` from definitions, descriptor, and machinery.
2. `recorder: {label: string}` required on overlays; `defineDialog` defaults
   it from a string `name` (RegExp-named dialogs must declare it). Recorder
   shot naming reads the label.
3. `close?: {esc?: boolean, button?: LazyLocator}` (default `{esc: true}`);
   `close()` derived only: click button else Escape (else throw "declare how
   this overlay closes"), then wait hidden. Not overridable as an action.
4. `withOpen(fn)` on overlay surfaces: returns a derived overlay carrying the
   open implementation; must compose with the parametric builder form
   (`confirmDelete({...}).withOpen(...)`). `fn` is a function expression
   (this-based): `this` = the EMBEDDING surface's instance, first parameter =
   the overlay instance. `open()` without a withOpen throws ("evoked
   elsewhere — await waitFor()"). SPIKE: `this` typing needs the embedder's
   instance in the element-map ThisType (today it carries only sibling
   elements); prove the fixpoint holds, fall back to elements-only `this` if
   it doesn't, and report which.
5. Descriptor: overlay node carries `recorder.label` and `close` (both data);
   an embedding with `withOpen` records an `open` action (opaque) on that
   embedding's entry.
6. Testbed: `moreMenu` re-showcased (withOpen at the topbar embedding); aria
   `menu` pattern updated (its `choose` uses `open()`; menus get labels);
   walks and the `record("more-menu", ...)` shot stay green.

Acceptance: battery + census (trigger nodes disappear, close/label appear —
justify each) + probes: open-throw without a declared open, close derivation
order, embed-literal `this` typing (elements + sibling actions + the mounted
overlay itself) under both compilers.

## R3 — Page & App (runtime + testbed)

Target: domain-model.md Page/App/Cross-page sections.

1. **Recorder namespacing**: page `recorder?: {group?, order?, label?}`
   replaces top-level `group`/`order`; `defineApp` takes
   `recorder?: {groups?}`. Descriptors mirror the nesting; the recorder's
   meta derivation reads the namespaced node; manifest/viewer shapes stay
   unchanged (metas are derived).
2. **Ready cascade**: page `ready?` overrides the app default; page
   descriptor carries `ready?: {selector} | {opaque: true}` when set.
3. **Header/anchor**: `header` = sugar creating `elements.header` (heading
   chain) + anchor default; resolution `anchor ?? header ?? none`; anchor
   stays `string | LazyLocator` (see TS6 fact above).
4. **Layouts deleted**: `defineLayout`, `Layout`, `LayoutPath`,
   `LayoutPageDefinition`, and the layout overloads of `DefinePage` (roughly
   half the overload block). Testbed replaces its two layouts with
   `definePage.preset` presets (path prefix, chrome `include`, nested recorder
   group; presets nest through `.preset`). Superseded note: the first pass
   used userland wrapper functions, which hid chrome from `this` typing.
5. **App-binding replaces `adopt`**: `defineApp` wraps each page factory into
   an app-bound version (injecting the ready default and the bound
   `this.pages` record) instead of mutating factories. Delete `adopt`, the
   adoption conflict throw, and the mutable slot. Raw factories stay
   app-independent (own ready or hydration default; `this.pages` on a
   non-app-bound instance throws "not app-bound — access this page through
   the app").
6. **`this.pages`** on app-bound instances: lazily bound to `this.page`,
   cached per key. Typing via registry: runtime exports
   `interface Register {}`; a consumer augments
   `declare module "walkwright/pom" { interface Register { app: typeof app } }`
   and `this.pages` types from it (falls back to `Record<string, never>` when
   not registered). SPIKE RESOLVED (verified under TS 5.9 and spitfire's
   TS 6.0): the registry model typechecks including the page→app→registry→page
   cycle, and cross-page action returns are FULLY INFERRED — no explicit
   return annotations needed; `@ts-expect-error` probes confirm real types,
   not `any`. Side condition: the augmenting app module must be part of the
   compilation (it always is, via fixtures/app imports).
   Document the idiom: navigation actions returning nothing + spec-side
   arrival through the `pages` fixture is the default; returning
   `this.pages.x` is the supported convenience.
7. Testbed: `definePage.preset`, recorder namespacing, one navigation action
   converted to each idiom, `Register` augmentation added.

Acceptance: battery + census (group/order move under recorder; ready
overrides appear) + probes: cascade order, this.pages typing with and without
registration, raw-factory throw.

## R4 — Spitfire migration (single pass)

Everything at once against the final API. Refresh the installed build first.

- `.elements.` normalization at all component call sites.
- Layout trees (`workspace`, `organization`, `account`, `deployment`, store
  roots) → `definePage.preset` presets. NOTE: provisioners call `workspace.params(page)`
  on layout objects today — migrate to a page instance's `params()`, or if
  that reads badly at the call sites, expose the internal `matchPath` as a
  small util in the runtime first (decide when the call sites are in view).
- Overlay conversions: dialogs gain labels where names are RegExp; triggers
  become `withOpen` at embeddings or ordinary opener actions; `dismiss`
  becomes `close.button` (confirm-delete's `cancelLabel` maps to
  `close.button`).
- Recorder namespacing on all pages + the app; ready cascade if any page
  needs it; fragments keys → `include`.
- aria patterns updated in lockstep (they live in the runtime and are
  consumers of the kernel; most of this lands in R1–R2, but spitfire's typed
  skins may shrink further).
- Gates as listed under Ground rules. Spitfire source edits are expected and
  in-scope for this round (unlike R1–R3).

## R5 — Close-out

- Rewrite `docs/descriptor-schema.md` around the element grammar and
  SurfaceDescriptor (domain-model.md is the source of truth; the schema doc
  carries the JSON detail).
- Re-run the API-usage inventory (exports vs spitfire imports) and report
  unused surface.
- Hand the user the publish checklist: commit on walkwright `main`,
  `pnpm version prerelease && pnpm publish --tag pre` from packages/runtime,
  bump spitfire's `walkwright` dependency, real `pnpm install` (replaces the
  build overlay), re-run spitfire gates.

## Risk register

- Both design spikes are resolved (see R2 item 4 and R3 item 6) — no open
  type-system questions remain in the plan.
- TS 6.0 divergence: after every runtime type-surface change, run spitfire's
  `tsc` even in R1–R3 (build refresh + `tsc --build --force`) — its compiler
  has rejected formulations 5.9 accepts before.
- Census regressions: any data→opaque movement in any round is a stop-and-
  report, never an accept.
