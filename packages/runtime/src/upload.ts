import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

import type { WalkwrightConfig } from "./project.js";

const uploadConcurrency = 8;

export type UploadProgress = (
  done: number,
  total: number,
  file: string,
) => void;

export interface Uploaded {
  url: string;
  number: number | undefined;
}

export async function uploadRun(
  config: WalkwrightConfig,
  branch: string,
  runDir: string,
  files: string[],
  onProgress?: UploadProgress,
): Promise<Uploaded> {
  const base = config.url.replace(/\/$/, "");
  const auth = { authorization: `Bearer ${config.token}` };

  const { id } = await request<{ id: string }>(`${base}/api/reports`, {
    method: "POST",
    headers: auth,
  });

  let next = 0;
  let done = 0;

  await Promise.all(
    Array.from(
      { length: Math.min(uploadConcurrency, files.length) },
      async () => {
        while (next < files.length) {
          const file = files[next++];

          if (file === undefined) {
            return;
          }

          await request(
            `${base}/api/reports/${id}/files/${encodeURIComponent(file)}`,
            {
              method: "PUT",
              headers: auth,
              body: readFileSync(join(runDir, file)),
            },
          );
          onProgress?.(++done, files.length, file);
        }
      },
    ),
  );

  const { url, number } = await request<{ url: string; number?: number }>(
    `${base}/api/reports/${id}/finalize`,
    {
      method: "POST",
      headers: { ...auth, "x-walkwright-branch": encodeURIComponent(branch) },
    },
  );

  return { url, number: number ?? numberFromUrl(url) };
}

function numberFromUrl(url: string): number | undefined {
  const last = Number(url.replace(/\/$/, "").split("/").at(-1));

  return Number.isInteger(last) ? last : undefined;
}

async function errorDetail(response: Response): Promise<string | undefined> {
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    return undefined;
  }

  if (typeof body !== "object" || body === null) {
    return undefined;
  }

  const error = (body as Record<string, unknown>)["error"];

  return typeof error === "string" ? error : undefined;
}

async function request<Body>(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: Buffer },
): Promise<Body> {
  const response = await fetch(url, {
    method: init.method,
    headers: init.headers,
    ...(init.body === undefined ? {} : { body: new Uint8Array(init.body) }),
  });

  if (!response.ok) {
    const detail = await errorDetail(response);

    throw new Error(
      `upload failed — ${String(response.status)} on ${init.method} ${basename(url)}${detail === undefined ? "" : `: ${detail}`}`,
    );
  }

  return (await response.json()) as Body;
}
