# Run manifest

The contract between anything that takes screenshots and Walkwright cloud. A
**run** is one version of a capture set: a folder of PNGs plus a
`manifest.json` that says what each file is. Cloud keeps runs per project and
branch and lets you compare any run with the one before it. The producer does
not have to be Walkwright; the walk CLI is one producer among others. The zod
schema lives in `walkwright/schema`.

## Shape

```ts
interface Manifest {
  version: 5;
  tool?: string; // "walkwright", "playwright", "storybook", …
  url?: string; // where the captures came from
  startedAt?: string; // ISO 8601; the run's timestamp in the console
  runStats?: Record<string, string | number>; // shown as chips in the run header, in order
  subjects: Subject[];
}

interface Subject {
  path: string[]; // identity; folders first, name last; unique in the run
  url?: string; // link back to the subject, absolute or relative to the run url
  states: State[]; // one or more; names unique within the subject
}

interface State {
  name: string; // non-empty; "default" when the subject has one state
  captures: Capture[]; // one or more; variant bags unique within the state
}

interface Capture {
  variant?: Record<string, string>; // { theme: "dark", viewport: "mobile", browser: "webkit" }
  files: { image: string; [kind: string]: string }; // image required; other kinds are extras
}
```

## Vocabulary

- A **subject** is anything you capture in more than one state: a page, a
  component, a story, a route, a dialog. Its path places it in the sidebar
  tree; the last element is what the console shows as its name.
- A **state** is one way that subject can look: hover, open, dark, mobile,
  empty.
- A **capture** is one rendering of a subject in a state: an image plus any
  extra files under a kind, such as an aria tree or html. A state has one
  capture unless it was rendered in several **variants**.
- A **variant** is a bag of free-form keys that tells captures of the same
  state apart: theme, viewport, browser. Conventional keys, so the cloud can
  grow features on them without a manifest change: `theme` with `light` or
  `dark`.

How other tools map onto it:

| Tool                   | path                   | state         |
| ---------------------- | ---------------------- | ------------- |
| Walkwright walk         | page group + page name | state         |
| Storybook              | title path + component | story         |
| Playwright screenshots | test file + test title | snapshot name |

## Rules

1. **Path, state name, and variant are the identity.** Threads, pins, and
   comparison across runs key on all three. A capture without a variant keys
   on path and state alone. Renaming or regrouping a subject starts a new
   history; there is no rename or move hint in the manifest.
2. **Files are storage only.** Any file name works as long as it is unique
   within the run. Nothing reads meaning from it. The cloud reads
   `files.image`; other kinds are stored and served but not interpreted.
3. **Every file needs an entry.** Finalize rejects a run whose uploaded files
   are not all referenced by some capture, and a manifest that references a
   file that was not uploaded.
4. **Uniqueness is checked at finalize.** Duplicate subject paths, duplicate
   state names within a subject, or two captures in a state with the same
   variant bag reject the run.
5. **Only `version` and `subjects` are required.** Start time falls back to
   the finalize time; stats and urls are simply absent.
6. **Presentation lives in the cloud.** Order, pinning, and hiding of folders
   and subjects are a per-project layout configured in the console, keyed by
   path. The manifest carries no ordering.
7. **No failures.** A run describes what was captured. What went wrong is the
   producer's own output.

## Uploading

```
POST /api/reports                      -> { id }
PUT  /api/reports/:id/files/:name      body: file bytes, one call per file
POST /api/reports/:id/finalize         header x-walkwright-branch: <url-encoded branch>
                                       -> { number, url }
```

Authenticate every call with `authorization: Bearer <api key>`; `walkwright
login` mints one. Finalize validates the manifest against the uploaded files,
indexes the captures, and returns the run's number on the branch and the
console URL.

## Versions

- **5** (current). Generic: subjects with paths, states with captures,
  variants and extra files per capture, files as storage, everything but the
  subjects optional, no ordering, no failures.
- **4**. Walk-specific: `appUrl`, `pages` with `shots`, `groups` and `order`,
  failures with lane and step. Runs already in storage are rewritten to 5 by
  a one-off migration per environment; the schema does not read 4.

## Deferred

- History linking after a regroup or rename: a cloud-side move record with a
  pairing UI, or a `movedFrom` hint for producers that can emit one.
- Display labels separate from identity.
- Captures without an image (tree or html only).
- Cloud features on variants beyond showing them: theme toggle, viewport
  switcher, per-kind viewers for extra files.
