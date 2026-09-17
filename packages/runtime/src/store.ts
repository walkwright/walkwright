import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { z } from "zod";

import type { StoreScope } from "./paths.js";
import { ensureWalkwrightDir, storeDir } from "./paths.js";

export interface StoreOptions<Value> {
  scope?: StoreScope;
  schema?: z.ZodType<Value>;
}

export interface Store<Value> {
  readonly path: string;
  exists: () => boolean;
  read: () => Value | undefined;
  persist: (value: Value) => void;
  clear: () => void;
}

export function createStore<Value>(
  name: string,
  { scope = "worker", schema }: StoreOptions<Value> = {},
): Store<Value> {
  const path = (): string => join(storeDir(scope), `${name}.json`);

  return {
    get path(): string {
      return path();
    },

    exists: (): boolean => existsSync(path()),

    read: (): Value | undefined => {
      const file = path();

      if (!existsSync(file)) {
        return undefined;
      }

      let parsed: unknown;

      try {
        parsed = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        console.log(`${file} is not valid JSON — ignoring the cached ${name}`);
        return undefined;
      }

      if (parsed === null || typeof parsed !== "object") {
        console.log(`${file} is not a ${name} — ignoring the cached ${name}`);
        return undefined;
      }

      if (schema === undefined) {
        return parsed as Value;
      }

      const decoded = z.safeDecode(schema, parsed);

      if (!decoded.success) {
        console.log(
          `${file} did not decode as a ${name} — ignoring the cached ${name}`,
        );
        return undefined;
      }

      return decoded.data;
    },

    persist: (value): void => {
      ensureWalkwrightDir();
      writeJson(path(), schema === undefined ? value : z.encode(schema, value));
    },

    clear: (): void => {
      rmSync(path(), { force: true });
    },
  };
}

function writeJson(file: string, value: unknown): void {
  const temporary = `${file}.${String(process.pid)}.tmp`;

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, file);
}
