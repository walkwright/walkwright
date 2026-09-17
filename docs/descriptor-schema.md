# Descriptor schema

The JSON detail behind `docs/domain-model.md`, which is the source of truth
for the concepts. Every definition (`defineComponent`, `defineOverlay`,
`defineDialog`, `definePage`, `defineApp`) projects to data described here;
`app.descriptor` is the serialized map, and `loadApp(json)` reconstructs an
equivalent app from it. The zod schemas live in `walkwright/descriptor` and
`walkwright/locator`; the runtime validates on load, so drift shows up at the
boundary instead of hiding.

## Invariants

1. **Output = state.** The map is a projection of the definitions, never a
   second artifact edited independently.
2. **Deterministic round-trip.** `loadApp(app.descriptor).descriptor` is
   byte-identical (`JSON.stringify`) to `app.descriptor`. Opaque nodes survive
   as fences; nothing is invented on the way back.
3. **Complete opacity inventory.** The only things a map cannot show are
   action bodies, embedding `open()` bodies, and fenced opaque elements. Every
   other node is executable from data — locators, nested structure, overlay
   `close`, page arrival.
4. **Sticky identity.** Page `name` + `path`, element keys and action names
   are the identities patches key on; they never churn under regeneration.

## The locator algebra

Two tiers of data, one tier of fence. Tier 1 is the vocabulary a loop may
emit; tier 2 it verifies and preserves; tier 3 it may only call.

```ts
type Text =
  | string
  | { pattern: string; flags?: string } // RegExp, serialized
  | { param: string } // whole-string placeholder
  | { template: (string | { param: string })[] }; // interpolated placeholder

// tier 1 — the vocabulary the role builders (button(), textbox(), …) decode to
type By =
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

// tier 2 — still data, arbitrarily exotic
type LocatorNode =
  | (By & Refined)
  | ({ by: "css" | "xpath"; selector: string } & Refined)
  | { or: Locator[] }
  | { and: Locator[] };

interface Refined {
  refine?: Refinement[]; // ordered; .filter(a).nth(1).filter(b) applies in sequence
}

type Refinement =
  | { filter: { hasText?: Text; has?: Locator; hasNot?: Locator } }
  | { nth: number }; // -1 is last()

/** the chain itself, outermost first; resolves within the owner's mount */
type Locator = LocatorNode[];
```

In the runtime a chain lives on a `LazyLocator`'s `chain` member. A
`LazyLocator` called with a `Page` resolves the chain against it; called with
another `LazyLocator` it composes (`[...scope.chain, ...chain]`) and stays
data. A resolved Playwright `Locator` never scopes anything — resolution is a
one-way door at the leaves.

## Elements

```ts
type ElementDescriptor =
  | { locator: Locator; params?: ParamDecl[] } // leaf; params ⇒ mounts as a method
  | { surface: NestedSurfaceDescriptor } // nested surface, boundary kept
  | { overlay: OverlayDescriptor; open?: OpaqueImpl } // overlay embedding
  | { opaque: true; provenance: "hand" }; // fenced closure

interface ParamDecl {
  name: string;
}
interface OpaqueImpl {
  opaque: true;
  provenance: "hand";
}
```

**Leaves.** `button("Delete")` hand-written and
`{ by: "role", role: "button", name: "Delete" }` loop-emitted are the same
descriptor. A parametric leaf is authored as a curried builder from param
values to a `LazyLocator` (`(text) => listitem().filter({ hasText: text })`)
and projects with `params` in declaration order; `{ param }` and
`{ template }` in `Text` are the traced placeholders, never hand-placed.

**Nested surfaces.** A component used as an element value projects its own
`{ root?, elements, actions? }` under `surface`; nesting is visible, not
opaque, and the instance keeps its boundary (`host.elements.nav.elements.link`).
`root` is the component's own chain, pre-composition: a rootless component
pointed at a chain (`itemRow(listitem().filter({ hasText }))`) projects that
chain as its `root`.

**Overlay embeddings.** An overlay used as an element projects its
`OverlayDescriptor` under `overlay`. If the embedding declared how the overlay
opens (the inline `{ overlay, open() }` literal), the entry also carries
`open: { opaque: true, provenance: "hand" }` — the opener body is the one
piece of an embedding that is not data; the opener's target is expected to sit
beside it as an ordinary leaf.

**Opaque elements.** A closure `(mount) => unknown`, a parametric builder that
does not trace, or an uncalled parametric surface builder used as a value
projects as `{ opaque: true, provenance: "hand" }`. It still mounts and runs;
the map just cannot see inside.

### Tracing and honesty

The binder discovers a parametric builder by probing it: one random-tagged
sentinel string per declared parameter, in declaration order. If the result
is a `LazyLocator`, each sentinel found in a `name`, `text` or
`filter.hasText` position becomes `{ param }` (whole string) or splits the
surrounding literal into a `{ template }` (substring); several params in one
string compose into one template. Then every declared parameter must appear
in the traced chain — a builder that launders its argument through a lookup
table (`(kind) => button(labels[kind])`) projects opaque rather than as a
half-true `{ locator, params }`. A probe that throws, or returns something
other than a `LazyLocator` or a surface, is opaque too. A builder that returns
a surface (`(name) => itemRow(listitem().filter({ hasText: name }))`) mounts
as a parametric surface but projects opaque today; tracing it into
`{ surface, params }` is a candidate for a later round.

## Surfaces

```ts
interface SurfaceDescriptor {
  elements: Record<string, ElementDescriptor>;
  actions?: ActionDescriptor[]; // present iff the surface declares actions
  capture?: CaptureDescriptor; // present iff the surface declares capture rules
}

interface NestedSurfaceDescriptor extends SurfaceDescriptor {
  root?: Locator; // absent for rootless surfaces
}

interface ActionDescriptor {
  name: string; // identity; sticky
  impl: OpaqueImpl; // bodies are never data
}
```

`SurfaceDescriptor` is the kernel every other descriptor embeds. `include`
does not exist in the map: a merged surface's elements and actions appear
flat in the host, exactly as they would have been declared there. Element
keys and action names never collide with each other (elements are always
under `.elements` on the instance), so both sets are free.

## Overlays

```ts
interface OverlayDescriptor extends SurfaceDescriptor {
  root: Locator; // resolved against the PAGE — definitional
  name?: Text; // present when authored via defineDialog
  recorder: { label: string }; // capture config; defaults from a string name
  close: { esc: boolean; button?: Locator }; // derived close, executable from data
}
```

Overlays are openerless by definition, so there is no `trigger`: opening is
the embedder's knowledge (see Elements). `close` is always present and never
authored as an action — the runtime clicks `button` (resolved within `root`)
if declared, else presses Escape if `esc`, else throws; then waits hidden.
`esc` defaults to `true`; a declared `button` takes precedence at runtime and
`esc` is only consulted without one. A dialog's `root` is
`[{ by: "role", role: role ?? "dialog", name }]`; a pattern-named dialog
must declare `recorder.label` because the recorder names shots from it.

## Pages

```ts
interface PageDescriptor extends SurfaceDescriptor {
  path: string; // route pattern; identity with name
  name: string; // sticky map identity
  recorder?: { group?: string[]; label?: string };
  ready?: { selector: string } | { opaque: true }; // only when it overrides the app
  header?: Text; // sugar: elements.header + default anchor
  anchor?: Locator | { opaque: true }; // only when declared explicitly
}
```

Arrival is two-factor: the path pattern says "URL matches", the anchor says
"content arrived". `header` creates `elements.header` (a heading chain, also
listed in `elements`) and is the anchor default; an explicit `anchor` projects
the element's own chain (element key) or the given chain, or `{ opaque }` when
it points at a fenced element. Resolution is `anchor ?? header ?? none` and is
part of the schema, so the implicit default is not repeated in the map.
`recorder` is namespaced capture config; DOM and route truth stay top-level.
Layouts do not exist: shared prefixes, chrome and recorder config are
authoring-time presets that produce ordinary pages. `capture` (inherited from
`SurfaceDescriptor`) folds in the page's presets, inner preset first — see
[Capture rules](#capture-rules).

## App

```ts
interface AppDescriptor {
  ready?: { selector: string } | { opaque: true }; // the pages' default
  pages: PageDescriptor[]; // sorted by path
  capture?: CaptureDescriptor; // regex-only rules, applied on every page
}
```

## Capture rules

```ts
interface RegexDescriptor {
  pattern: string;
  flags?: string;
}

type CaptureRuleDescriptor =
  | { element: string[]; text: string; match?: RegexDescriptor } // dotted path, split into segments
  | { match: RegexDescriptor; text: string }; // whole surface, no element

interface CaptureDescriptor {
  rules: CaptureRuleDescriptor[];
}
```

Screenshots must be stable across walks, so the recorder rewrites dynamic
text — counters, relative times, ids, user names — in the live DOM right
before `page.screenshot` and restores it right after. Rules are declared
alongside a surface's elements and travel with it in the map.

`{ element, text }` replaces a leaf element's whole text (an `input` or
`textarea`'s `.value`, otherwise its text nodes). `{ element, match, text }`
runs `String.replace(match, text)` over the text inside the element's
subtree; `element` may also name a nested surface or overlay, scoping the
replace to that surface's root. `{ match, text }` with no `element` runs the
same replace over the whole surface — a component's root, a page's document,
or, on `AppDescriptor.capture`, every page. `element` is the dotted path
split into segments: each segment but the last must be a `surface` or
`overlay` element, walked by its root; the last must be a `locator` element
(its own locator extends the chain), or, with `match`, may itself be a
`surface`/`overlay`. Rootless surfaces merged by `include` expose their
elements at the host's top level, so a dotted path crosses them by bare name
— `"topbar.nav.link"` reaches `nav`'s `link` through a `topbar` merged into
the host.

**Widening.** A rule on a parametric element widens to match every instance,
not just the one it was written against: a `role` node keeps `by`/`role` and
drops `name` if the name carries a param; a `filter.hasText` drops the same
way; a `text`/`label`/`placeholder`/`title` node whose own text is a param
disappears entirely (there is no name-less form to fall back to); `or`/`and`
branches widen recursively. An empty chain scopes to the whole page.

**Order.** A nested surface's rules run before its host's own (deepest first,
in element order); a page's own rules run before its preset's (inner preset
before outer); the app's rules run last, over whichever page or dialog is on
screen. There is no precedence: every rule applies, in this order, and a
later rule sees an earlier rule's rewrite — so a narrower rule declared later
can undo or refine a wider one declared earlier.

## Loading

`loadApp(json)` validates against `appDescriptorSchema` and rebuilds pages,
nested surfaces and overlays from their data: chains, params, roots,
`close`, `recorder`, `ready` selectors, header anchors. What it cannot
rebuild it keeps as a fence and reports faithfully: opaque elements are
absent from the instance, actions and embedding `open()` throw as
"evoked elsewhere", an opaque `ready` falls back to the hydration default.
The descriptor of a loaded app is the input, verbatim.

## A worked example

The testbed's `topbar` component embedded on a page, as it appears in
`app.descriptor` (abridged):

```json
"topbar": {
  "surface": {
    "root": [{ "by": "role", "role": "banner" }],
    "elements": {
      "nav": {
        "surface": {
          "root": [{ "by": "role", "role": "navigation" }],
          "elements": {
            "link": {
              "locator": [{ "by": "role", "role": "link", "name": { "param": "name" } }],
              "params": [{ "name": "name" }]
            }
          }
        }
      },
      "signOutButton": { "locator": [{ "by": "role", "role": "button", "name": "sign out" }] },
      "moreButton": { "locator": [{ "by": "role", "role": "button", "name": "More" }] },
      "moreMenu": {
        "overlay": {
          "root": [{ "by": "role", "role": "menu", "name": "More" }],
          "recorder": { "label": "More" },
          "close": { "esc": true },
          "elements": {
            "item": {
              "locator": [{ "by": "role", "role": "menuitem", "name": { "param": "action" } }],
              "params": [{ "name": "action" }]
            }
          },
          "actions": [{ "name": "choose", "impl": { "opaque": true, "provenance": "hand" } }]
        },
        "open": { "opaque": true, "provenance": "hand" }
      }
    },
    "actions": [{ "name": "goTo", "impl": { "opaque": true, "provenance": "hand" } }]
  }
}
```

## Deferred

- **Recipes**: a step vocabulary (`click`, `press`, `fill`, `waitFor`) so
  simple action and `open()` bodies can be data. Overlay `close` is the pilot.
- **Parametric surface tracing**: `{ surface, params }` for builders that
  return a surface.
- **Parametric embeddings**: an embed literal for a parametric overlay
  builder (today such an overlay is embedded bare and opened by an action).
- **Action inputs**: a projectable input schema per action.
