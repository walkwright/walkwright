import type { Page } from "@playwright/test";
import type { z } from "zod";

import { createStore } from "./store.js";

export type Use = <D extends AnyProvision>(
  provision: D,
  ...input: ProvisionArgs<InputOf<D>>
) => Promise<ResultOf<D>>;

export interface Provision<Name extends string, Input, Result> {
  name: Name;
  create: (page: Page, input: Input, use: Use) => Promise<Result>;
  dispose?: (page: Page, result: Result) => Promise<void>;
  schema?: z.ZodType<Result>;
}

export interface AnyProvision {
  name: string;
  create: (page: Page, input: never, use: Use) => Promise<unknown>;
  dispose?: (page: Page, result: never) => Promise<void>;
  schema?: z.ZodType;
}

export type InputOf<D extends AnyProvision> = D extends {
  create: (page: Page, input: infer Input, use: Use) => Promise<unknown>;
}
  ? Input
  : never;

export type ResultOf<D extends AnyProvision> = D extends {
  create: (page: Page, input: never, use: Use) => Promise<infer Result>;
}
  ? Result
  : never;

export function createProvision<Name extends string, Input, Result>(
  name: Name,
  create: (page: Page, input: Input, use: Use) => Promise<Result>,
  dispose?: (page: Page, result: Result) => Promise<void>,
): Provision<Name, Input, Result> {
  return {
    name,
    create,
    ...(dispose === undefined ? {} : { dispose }),
  };
}

export function createPersistentProvision<Name extends string, Input, Result>(
  name: Name,
  schema: z.ZodType<Result>,
  create: (page: Page, input: Input, use: Use) => Promise<Result>,
  dispose?: (page: Page, result: Result) => Promise<void>,
): Provision<Name, Input, Result> {
  return {
    name,
    create,
    schema,
    ...(dispose === undefined ? {} : { dispose }),
  };
}

export type ProvisionMap<Defs extends readonly AnyProvision[]> = {
  [D in Defs[number] as D["name"]]: (
    ...input: ProvisionArgs<InputOf<D>>
  ) => Promise<ResultOf<D>>;
};

export interface Provisioner<
  Defs extends readonly AnyProvision[],
> extends AsyncDisposable {
  provision: ProvisionMap<Defs>;
}

export function createProvisioner<Defs extends readonly AnyProvision[]>(
  page: Page,
  provisions: Defs,
): Provisioner<Defs> {
  const disposals: Disposal[] = [];
  const named = new Set<string>();

  for (const def of provisions) {
    if (named.has(def.name)) {
      throw new Error(`two provisions are both named "${def.name}"`);
    }
    named.add(def.name);
  }

  const pending = new Map<AnyProvision, Promise<unknown>>();

  const rawUse = async (
    def: AnyProvision,
    input: unknown,
  ): Promise<unknown> => {
    if (def.schema === undefined) {
      const result = await def.create(page, input as never, use);

      if (def.dispose !== undefined) {
        const dispose = def.dispose;
        disposals.push(async (): Promise<void> => {
          await dispose(page, result as never);
        });
      }

      return result;
    }

    const schema = def.schema;
    const cached = pending.get(def);
    if (cached !== undefined) {
      return await cached;
    }

    const promise = (async (): Promise<unknown> => {
      const store = createStore<unknown>(def.name, { schema });
      const cached = store.read();

      if (cached !== undefined) {
        return cached;
      }

      const result = await def.create(page, input as never, use);
      store.persist(result);
      return result;
    })();

    pending.set(def, promise);
    return await promise;
  };

  const use = (async (
    def: AnyProvision,
    ...input: unknown[]
  ): Promise<unknown> => await rawUse(def, input[0])) as Use;

  const provision: Record<string, (...input: unknown[]) => Promise<unknown>> =
    {};

  for (const def of provisions) {
    provision[def.name] = async (...input: unknown[]): Promise<unknown> =>
      await rawUse(def, input[0]);
  }

  return {
    provision: provision as unknown as ProvisionMap<Defs>,
    [Symbol.asyncDispose]: async (): Promise<void> => {
      await disposeAll(disposals);
    },
  };
}

type ProvisionArgs<Input> = undefined extends Input
  ? [input?: Input]
  : [input: Input];

type Disposal = () => Promise<void>;

async function disposeAll(disposals: Disposal[]): Promise<void> {
  const failures: unknown[] = [];

  for (const dispose of [...disposals].reverse()) {
    try {
      await dispose();
    } catch (error) {
      failures.push(error);
    }
  }

  disposals.length = 0;

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `provisioner clean-up failed: ${failures
        .map((failure) =>
          failure instanceof Error
            ? failure.message.split("\n")[0]
            : String(failure),
        )
        .join("; ")}`,
    );
  }
}
