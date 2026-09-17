# walkwright

The app-agnostic half of the walk: the recorder, the reporter that describes and
uploads a run, the provisioner mechanism, the account cache and the `walkwright`
command. Nothing in here knows about any particular app — the app supplies its
own config, tests and resources through the seams below.

## The walk

A walk is Playwright: spec files under a `walk` project, and this package's
reporter. `walkwright walk` is a thin wrapper around `playwright test` — there is no
separate runner.

```sh
walkwright walk
walkwright walk --workers 4 --headed
walkwright walk --upload-on-fail
walkwright walk --no-upload
walkwright walk --branch main
playwright test --project=walk    # the same lanes as a smoke run: no shots
```

| Flag                | Meaning                                               |
| ------------------- | ----------------------------------------------------- |
| `--upload-on-fail`  | upload the passing lanes' shots even though it failed |
| `--no-upload`       | skip the upload entirely                              |
| `--branch <name>`   | report under this branch instead of git's             |
| `--project <name>`  | the Playwright project to run (default `walk`)        |
| `--version`         | the banner                                            |
| `--help`, `-h`, `?` | keys and flags                                        |
| everything else     | forwarded to `playwright test` verbatim               |

```ts
// playwright.config.ts
import { walk } from "walkwright/config";

reporter: [["list"], ...walk.reporter({ appUrl })],

projects: [{ name: "walk", use: { ...use, ...walk.use } }],
```

The helper reads `WALK_RECORDING` — set by `walkwright walk`, unset for a plain
`playwright test` — and does the wiring above either way: on, it returns the
reporter and `recording: true`; off, an empty reporter list and
`recording: false`, so the same lanes double as smoke tests in an ordinary
`playwright test` run with no shots taken. `walk.recording` is the boolean on
its own, for anything else that needs to branch on it.

The reporter names the run's directory — `.walkwright/reports/run-<timestamp>` —
before the first worker is spawned, and hands it to them in `WALKWRIGHT_RUN_DIR`.
Every recording test shoots into that one directory.

A run always writes its directory and `manifest.json` locally, failed or not.
A failed run uploads nothing unless `--upload-on-fail` — with the override,
only the passing lanes' shots go up; the failing ones never made it into the
manifest. `--no-upload` skips the upload outright, pass or fail.

| Option       | Meaning                                                       |
| ------------ | ------------------------------------------------------------- |
| `appUrl`     | the app the run walked, as the report viewer names it         |
| `reportsDir` | where run directories are made (default `.walkwright/reports`) |

See `docs/run-manifest.md` for the manifest's shape.

What the CLI sets for the child process:

| Variable                   | Set by             | Meaning                                   |
| -------------------------- | ------------------ | ----------------------------------------- |
| `WALK_RECORDING`           | `walkwright walk`   | on for every run through the bin          |
| `WALKWRIGHT_UPLOAD_ON_FAIL` | `--upload-on-fail` | upload a failed run's passing shots       |
| `WALKWRIGHT_NO_UPLOAD`      | `--no-upload`      | skip the upload                           |
| `WALKWRIGHT_BRANCH`         | `--branch <name>`  | report under this branch instead of git's |
| `WALKWRIGHT_RUN_DIR`        | the reporter       | internal — hands each worker its run dir  |
| `WALKWRIGHT_THEME`          | you                | `light` or `dark`; otherwise `COLORFGBG`  |

Invoking Playwright directly instead of through `walkwright walk`, set the first four
yourself; `WALKWRIGHT_RUN_DIR` is the reporter's business.

## Recording

`walkwright/recorder` is a pair of Playwright fixtures the app extends its own
`test` with:

```ts
import type { RecorderFixtures } from "walkwright/recorder";
import { createRecorderFixtures } from "walkwright/recorder";

const walkTest = test.extend<RecorderFixtures>(createRecorderFixtures(app));

walkTest("items", async ({ page, record, runDir }) => {
  await record(itemsPage, {}, "empty");
});
```

`record` shoots into `runDir` and hands the reporter what it shot when the test
passes — when `recording` is on; off, `runDir` is empty and nothing is shot. A shot recorded with a page object is named after it; anything else is
attributed by the URL, matched against the pages `definePage` registered, and
`ShotOptions` (`category`, `page`, `state`) overrides any part of that.

`runDir` is also where a test writes artifacts that belong beside its shots.

## Logging in

`walkwright login [--force] [--url <server>]` sets a project's upload token up on its
own — the same device-authorization login and implicit project creation the
reporter's first upload needs. It writes `.walkwright/config.json`; without one,
a green run writes its manifest and skips the upload. `--url` picks the reports
server (default `https://app.walkwright.dev`) and is written into the config
next to the project id and token, so the reporter uploads to the same server
the login happened on. `--force --url` repoints a project.

`WALKWRIGHT_BRANCH` names the branch a run is reported under when git cannot
(a detached CI checkout).

## Files

Everything walkwright writes into a project lives under one folder:

```
.walkwright/
  config.json          walkwright login — project id, token, server; commit it
  reports/run-<ts>/    the reporter — shots and manifest.json
  store/worker-<n>/    walkwright/store — worker-scoped caches
  store/shared/        walkwright/store — project-scoped caches
  .gitignore           written by walkwright — ignores all but config.json
```

The project is the package the walk runs from: the nearest ancestor of the
cwd with a `package.json` (or an existing `.walkwright/`), never the git
toplevel — in a monorepo the e2e package is its own project. The folder's
`.gitignore` keeps everything but the config out of git, and is itself ignored,
so nothing under `.walkwright/` but the config ever shows up in a status.
walkwright only writes that file when it is missing: a project that must not
commit its token (a public repo) keeps a local `*`-only one.

## Stores

`walkwright/store` keeps a JSON value across runs so the app never touches the
file system itself:

```ts
import { createStore } from "walkwright/store";

const accounts = createStore("account", { schema: accountSchema });

const account = accounts.read() ?? (await signUp());
accounts.persist(account);
```

| Option   | Meaning                                                                                     |
| -------- | ------------------------------------------------------------------------------------------- |
| `scope`  | `worker` (default) — one file per parallel worker; `project` — one file for all             |
| `schema` | a zod schema: `read` decodes through it and ignores a file that does not, `persist` encodes |

A worker-scoped store lives under `store/worker-<n>/`, keyed by Playwright's
`TEST_PARALLEL_INDEX`; a project-scoped one under `store/shared/`. Writes go
through a temporary file and a rename, so a killed worker never leaves half a
file, and a project-scoped store that several workers save at once ends up with
whichever finished last, intact. A file that is missing, not JSON or fails its
schema reads as `undefined` and is reported, never thrown: the caller makes a
fresh value instead. `clear` removes the file; `path` is where it lives.

`walkwright/storage-state` is the same for a browser session:

```ts
import {
  createStorageStateStore,
  storageStateOf,
} from "walkwright/storage-state";

const session = createStorageStateStore("session");
const services = createStorageStateStore("services", { scope: "project" });
const github = createStorageStateStore("github", {
  scope: "project",
  cookies: (cookie) => cookie.domain.endsWith("github.com"),
});

test.extend({ storageState: storageStateOf(session, services) });

await session.save(page.context());
await github.restore(page.context());
```

`save` writes the context's storage state; with a `cookies` filter it keeps the
matching cookies only and no origins. `restore` adds the saved cookies to a
context that already exists, for a session picked up part-way through a test.
`storageStateOf` is for Playwright's `storageState` option: the path of the
first store that has a file, or `emptyStorageState` when none does.

## Modules

| Import                    | Role                                                       |
| ------------------------- | ---------------------------------------------------------- |
| `walkwright/reporter`      | the run directory, `manifest.json`, the upload             |
| `walkwright/recorder`      | the recorder, and the fixtures that bind it to a test      |
| `walkwright/pom`           | `definePage`: page objects, dialogs, fragments             |
| `walkwright/browser`       | `hideStyle`: an init script hiding chrome that would move  |
| `walkwright/provisioner`   | resources created through the app, disposed in reverse     |
| `walkwright/store`         | a JSON value cached across runs, per worker or per project |
| `walkwright/storage-state` | a browser session cached across runs, for `storageState`   |

## Page objects

`walkwright/pom` has one grammar for every definer:

```ts
defineX(definition).withActions(map); // a literal
defineX((...params) => definition).withActions(map); // a builder, params-first
```

| Definer           | Definition                                            | Instance                                       |
| ----------------- | ----------------------------------------------------- | ---------------------------------------------- |
| `defineComponent` | `{ root?, elements? }` — `root` present: rooted       | `{ root?, ...elements, ...actions }`           |
| `defineDialog`    | `{ name, role?, trigger?, dismiss?, elements? }`      | `{ root, open, close, waitFor, ... }`          |
| `definePage`      | `{ path, name, header?, fragments?, elements?, ... }` | `{ goto, url, waitFor, elements, ...actions }` |
| `defineLayout`    | `{ path, group?, chrome?, parent? }` — literal only   | shared by its pages                            |

Element entries take the context first, own params after; the annotation is
inferred:

| Entry                                           | Instantiates to                    |
| ----------------------------------------------- | ---------------------------------- |
| `back: link("Back")`                            | a value — a leaf, called           |
| `deployment: link`                              | a method — a leaf, mounted bare    |
| `email: ({ scope }) => scope.getByLabel(...)`   | a value — ≤ 1 parameter            |
| `member: ({ scope }, email: string) => ...`     | a method — ≥ 2 parameters          |
| `first(): Locator { return this.rows.first() }` | a value — `this` is the siblings   |
| `row: defineComponent((name) => ...)`           | a method — a builder, mounted bare |

The builder form comes back branded (`parameterized: true`): mounted under a
key it is a method, `elements.row("a")`, and its params reach the actions
context as `params`. `parameterized()` brands hand-written leaves the same
way; nothing else needs it.

`defineComponent`, `defineOverlay`, `defineDialog`, `definePage`, page
presets and `defineApp` all take a `capture: { rules }` option — declarative
rules that rewrite dynamic text (counters, relative times, ids, user names)
in the live DOM right before a screenshot and restore it right after, so
walks stay stable. See `docs/descriptor-schema.md#capture-rules`.

Actions (`withActions`) receive the context — `scope`, `page`, `elements`,
plus `root` for rooted components and dialogs, `params` for builders — then
their own params, and see sibling actions as `this`. Actions never mint
locators: locating is for `elements` and `root`. A page's actions orchestrate
its elements, including those its fragments spread in; a fragment's actions
are for callers.

Every `withActions` member and every top-level factory names its return type
(`explicit-function-return-type`); nothing else needs an annotation — a
`ReturnType<typeof page>` alias, or an explicit interface for a page that
navigates in a cycle with another, is the exception.

## Seams

| Seam                                       | The app supplies                                                  |
| ------------------------------------------ | ----------------------------------------------------------------- |
| the `walk` project                         | the walks themselves, and the session they run as                 |
| `["walkwright/reporter", { appUrl }]`       | the app the report is of                                          |
| `test.extend(createRecorderFixtures(app))` | the test the recorder shoots through, and the page inventory      |
| `definePage({ afterGoto })`                | the readiness a page object's `goto` waits out                    |
| `createProvisioner(page, kinds)`           | the resource kinds, how each is made, and how it is disposed      |
| `createStore(name, { scope, schema })`     | the value cached across runs, its shape, and how far it is shared |

## Building

Consumed as a built package — the reporter and the `walkwright` bin both run under
plain `node`, which resolves `walkwright` through `node_modules` to `build/`.
The bin is `bin/walkwright.js`, a checked-in launcher for `build/cli.js`, so it links
whether or not the package has been built yet. After changing anything here:

```sh
pnpm build
```

Consumers install it from the filesystem (`"walkwright": "link:…/packages/sdk"`)
and build it before they run, so a fresh build is automatic.
