# @walkwright/testbed

The workspace's walk target: "walkshop", a deliberately dumb react-router SPA,
plus a walk that exercises every SDK seam against it.

The app is a static build — no server, no network, all state in localStorage —
so every browser context starts identical and shots stay byte-stable. Login
accepts any credentials (still exercises the account store). Animations,
transitions and the caret are killed in CSS; the one nondeterministic element,
a render-time stamp in the footer, exists to prove `hideSelectors` works.

## Pages

`/login`, `/` (dashboard), `/items` (list + "New item" dialog + "Delete item"
alertdialog), `/items/:id`, `/settings` (profile form + "Reset data"
alertdialog). Dialogs are native `<dialog>` elements, so roles and Escape
dismissal come from the platform.

## The walk

Playwright projects, in `playwright.config.ts`:

- `walk account` (`src/walk/account.setup.ts`) — shoots the login page, signs in
  with the cached account, leaves the session for the walks
- `walk` — `items.walk.ts` (empty state, both dialogs, provisioned items,
  detail page) and `settings.walk.ts` (settings page, reset confirmation)

Seams covered: the recorder fixtures and the reporter, `definePage` with params
and anchors (`afterGoto` waits for `html[data-hydrated]`), `defineDialog` with
trigger / alertdialog role / button dismissal, `createProvisioner` (items made
and deleted through the UI), `createStore` (`.walkwright/store/`), and the `recording` option.

## Usage

```sh
pnpm --dir ../runtime build   # the walk runs the runtime's build/
pnpm build                    # react-router build → build/client
pnpm preview                  # serves build/client on :4173
pnpm testwalk                 # serves build/client and walks it, recording
WALK_RECORDING=1 playwright test --project=walk   # against a server already up
playwright test --project=walk                    # the same walk as a smoke run
```

`.env` supplies `APP_URL` (default `http://localhost:4173`); `pnpm dev` serves
on :5173 if you'd rather walk the dev server.
