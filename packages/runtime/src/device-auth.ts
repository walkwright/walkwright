import { execFileSync } from "node:child_process";

import type { WalkwrightConfig } from "./project.js";
import { blank, bold, glyph, line, paint, prompt, pulse } from "./ui.js";

const clientId = "walk-cli";

interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

interface DeviceTokenResponse {
  error?: string;
  access_token?: string;
  session?: { token?: string };
}

export async function login(baseUrl: string): Promise<string> {
  const base = baseUrl.replace(/\/$/, "");

  const code = await postJson<DeviceCode>(`${base}/api/auth/device/code`, {
    client_id: clientId,
  });

  blank();
  line(
    prompt(
      `open ${paint("code", code.verification_uri)} and enter  ${bold(paint("accent", code.user_code))}`,
    ),
  );
  openBrowser(code.verification_uri_complete);

  const stop = pulse(paint("dim", "  waiting for approval"));

  let token: string;

  try {
    token = await poll(base, code);
  } catch (error) {
    stop();
    throw error;
  }

  stop();
  line(paint("ok", glyph.ok), ` approved${await approvedAs(base, token)}`);

  return token;
}

async function approvedAs(base: string, token: string): Promise<string> {
  try {
    const response = await fetch(`${base}/api/auth/get-session`, {
      headers: { authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      return "";
    }

    const body = (await response.json()) as { user?: { name?: string } } | null;
    const name = body?.user?.name;

    return name === undefined || name === "" ? "" : ` as ${bold(name)}`;
  } catch {
    return "";
  }
}

async function poll(base: string, code: DeviceCode): Promise<string> {
  const deadline = Date.now() + code.expires_in * 1000;
  let intervalMs = Math.max(1, code.interval) * 1000;

  while (Date.now() < deadline) {
    await sleep(intervalMs);

    const response = await fetch(`${base}/api/auth/device/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: code.device_code,
        client_id: clientId,
      }),
    });

    const body = (await response.json()) as DeviceTokenResponse;

    if (response.ok) {
      const token = body.session?.token ?? body.access_token;

      if (token === undefined) {
        throw new Error("device login succeeded but returned no session token");
      }

      return token;
    }

    if (body.error === "authorization_pending") {
      continue;
    }

    if (body.error === "slow_down") {
      intervalMs += 1000;
      continue;
    }

    throw new Error(
      body.error === "expired_token" || body.error === "access_denied"
        ? "that didn't work — the code may have expired. run walkwright login again."
        : `that didn't work — ${body.error ?? String(response.status)}. run walkwright login again.`,
    );
  }

  throw new Error(
    "that didn't work — the code expired. run walkwright login again.",
  );
}

export async function ensureProject(
  baseUrl: string,
  sessionToken: string,
  name: string,
): Promise<Pick<WalkwrightConfig, "project" | "token">> {
  const base = baseUrl.replace(/\/$/, "");

  const response = await fetch(`${base}/api/projects/ensure`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ name }),
  });

  if (!response.ok) {
    throw new Error(
      `project setup failed — ${String(response.status)} from ${base}`,
    );
  }

  return (await response.json()) as Pick<WalkwrightConfig, "project" | "token">;
}

async function postJson<Body>(url: string, payload: unknown): Promise<Body> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error(`can't reach ${new URL(url).origin}`);
  }

  if (!response.ok) {
    throw new Error(`${String(response.status)} from ${url}`);
  }

  return (await response.json()) as Body;
}

function openBrowser(url: string): void {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];

  try {
    execFileSync(command, args, { stdio: "ignore" });
  } catch {
    return;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
