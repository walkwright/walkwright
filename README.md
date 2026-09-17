# walkwright

Walk your app with Playwright and record a browsable report.

| Package                                | What it is                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| [`packages/runtime`](packages/runtime) | `walkwright` — the `walkwright` command, POM definers, and the run data's schema  |
| [`packages/testbed`](packages/testbed) | `@walkwright/testbed` — a small app + walk that exercises the runtime end to end |

The runtime writes run data, validates it against its own schema on emit, and
uploads it; the hosted viewer validates on read, so drift between the two shows
up instead of hiding. The schema module (`walkwright/schema`) is the
whole contract.

## Developing

```sh
pnpm install
pnpm run typecheck
pnpm run lint
pnpm run testwalk   # build the runtime + testbed, walk the testbed
```
