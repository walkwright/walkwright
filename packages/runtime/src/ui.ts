export type Tone =
  | "accent"
  | "text"
  | "dim"
  | "faint"
  | "ok"
  | "warn"
  | "fail"
  | "code"
  | "border";

type Depth = "truecolor" | "256" | "none";

interface Swatch {
  hex: string;
  index: number;
}

const dark: Record<Tone, Swatch> = {
  accent: { hex: "#b8943a", index: 178 },
  text: { hex: "#bcac8f", index: 180 },
  dim: { hex: "#8d8972", index: 102 },
  faint: { hex: "#6b6858", index: 59 },
  ok: { hex: "#8fa85e", index: 107 },
  warn: { hex: "#e08542", index: 173 },
  fail: { hex: "#d66848", index: 167 },
  code: { hex: "#cc7f66", index: 173 },
  border: { hex: "#333333", index: 236 },
};

const light: Record<Tone, Swatch> = {
  accent: { hex: "#9a7820", index: 136 },
  text: { hex: "#3a3828", index: 237 },
  dim: { hex: "#625e55", index: 240 },
  faint: { hex: "#948e80", index: 246 },
  ok: { hex: "#5f8a3a", index: 64 },
  warn: { hex: "#c0741e", index: 172 },
  fail: { hex: "#b8442c", index: 130 },
  code: { hex: "#a85030", index: 130 },
  border: { hex: "#c9bfa6", index: 250 },
};

export const glyph = {
  ok: "✓",
  fail: "✗",
  carried: "↺",
  unseen: "●",
  open: "▾",
  closed: "▸",
  branch: "├",
  last: "└",
  cursor: "▌",
  prompt: ">",
  filled: "▰",
  empty: "▱",
  dot: "·",
  bar: "│",
} as const;

process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code !== "EPIPE") {
    throw error;
  }
});

const depth = detectDepth();
const palette = detectLight() ? light : dark;
const esc = "\u001b";
const escapePattern = new RegExp(`${esc}\\[[\\d;]*m`, "g");
const escapeSplit = new RegExp(`(${esc}\\[[\\d;]*m)`);
const escapeOnly = new RegExp(`^${esc}\\[[\\d;]*m$`);

function detectDepth(): Depth {
  const env = process.env;

  if ((env["NO_COLOR"] ?? "") !== "" || env["FORCE_COLOR"] === "0") {
    return "none";
  }

  const forced = (env["FORCE_COLOR"] ?? "") !== "";

  if (!forced && !process.stdout.isTTY) {
    return "none";
  }

  const colorterm = env["COLORTERM"] ?? "";

  if (colorterm === "truecolor" || colorterm === "24bit") {
    return "truecolor";
  }

  const term = env["TERM"] ?? "";

  if (term === "dumb" || (term === "" && !forced)) {
    return "none";
  }

  return "256";
}

function detectLight(): boolean {
  const theme = process.env["WALKWRIGHT_THEME"];

  if (theme === "light" || theme === "dark") {
    return theme === "light";
  }

  const fgbg = process.env["COLORFGBG"];

  if (fgbg === undefined) {
    return false;
  }

  const background = Number(fgbg.split(";").at(-1));

  return background === 7 || (background >= 9 && background <= 15);
}

function open(swatch: Swatch): string {
  if (depth === "truecolor") {
    const value = Number.parseInt(swatch.hex.slice(1), 16);

    return `\u001b[38;2;${String(value >> 16)};${String((value >> 8) & 255)};${String(value & 255)}m`;
  }

  return `\u001b[38;5;${String(swatch.index)}m`;
}

export function paint(tone: Tone, value: string): string {
  if (depth === "none" || value === "") {
    return value;
  }

  return `${open(palette[tone])}${value}\u001b[39m`;
}

export function bold(value: string): string {
  return depth === "none" ? value : `\u001b[1m${value}\u001b[22m`;
}

export function plain(value: string): string {
  return value.replace(escapePattern, "");
}

export function width(value: string): number {
  return plain(value).length;
}

export function columns(): number {
  return process.stdout.isTTY ? process.stdout.columns : 100;
}

export function pad(value: string, to: number): string {
  return value + " ".repeat(Math.max(0, to - width(value)));
}

export function clip(value: string, to: number): string {
  if (width(value) <= to) {
    return value;
  }

  let seen = 0;
  let out = "";

  for (const part of value.split(escapeSplit)) {
    if (escapeOnly.test(part)) {
      out += part;
      continue;
    }

    for (const char of part) {
      if (seen === to - 1) {
        return `${out}…${depth === "none" ? "" : "\u001b[0m"}`;
      }

      out += char;
      seen += 1;
    }
  }

  return out;
}

export function line(...parts: string[]): void {
  process.stdout.write(`${parts.join("")}\n`);
}

export function blank(): void {
  process.stdout.write("\n");
}

export function status(...segments: string[]): string {
  return ` ${segments.filter((segment) => segment !== "").join(paint("faint", ` ${glyph.bar} `))}`;
}

export function badge(count: number, tone: Tone = "dim"): string {
  return paint(tone, `[${String(count)}]`);
}

export function key(name: string): string {
  return paint("accent", `[${name}]`);
}

export function action(verb: string): string {
  return paint("accent", `[${verb}]`);
}

export function prompt(text: string): string {
  return `${paint("accent", glyph.prompt)} ${text}`;
}

export function dashed(inner: number): string {
  return paint("border", "╌".repeat(inner));
}

export interface BoxOptions {
  legend: string;
  title?: string;
  primary?: boolean;
  min?: number;
}

export function box(rows: string[], options: BoxOptions): string[] {
  const outer = Math.min(columns() - 1, 100);
  const min = Math.max(options.min ?? 44, width(options.legend) + 10);
  const widest = rows.reduce((max, row) => Math.max(max, width(row)), 0);
  const inner = Math.max(min - 4, Math.min(widest, outer - 4));

  const edge = (value: string): string => paint("border", value);

  const legend = paint(
    options.primary === true ? "accent" : "dim",
    options.legend.toUpperCase(),
  );
  const heading =
    options.title === undefined
      ? `${edge("─ ")}${legend}${edge(" ")}`
      : `${edge("─ ")}${legend}${edge(" ─ ")}${paint("text", options.title)}${edge(" ")}`;
  const top = `${edge("┌")}${clip(heading, inner + 2)}${edge("─".repeat(Math.max(0, inner + 2 - width(heading))))}${edge("┐")}`;
  const bottom = `${edge("└")}${edge("─".repeat(inner + 2))}${edge("┘")}`;

  const body = rows.map(
    (row) =>
      `${edge("│")} ${pad(clip(row === "" ? dashed(inner) : row, inner), inner)} ${edge("│")}`,
  );

  return [top, ...body, bottom];
}

export function progress(done: number, total: number, cells = 5): string {
  const filled = total === 0 ? cells : Math.round((done / total) * cells);

  return paint(
    "accent",
    glyph.filled.repeat(filled) + glyph.empty.repeat(cells - filled),
  );
}

export function duration(ms: number): string {
  if (ms < 1000) {
    return `${String(Math.round(ms))}ms`;
  }

  const seconds = Math.round(ms / 1000);

  if (seconds < 60) {
    return `${String(seconds)}s`;
  }

  return `${String(Math.floor(seconds / 60))}m${String(seconds % 60).padStart(2, "0")}s`;
}

export function count(value: number, noun: string): string {
  return `${String(value)} ${noun}${value === 1 ? "" : "s"}`;
}

export function failure(message: string, hint?: string): void {
  process.stderr.write(`${paint("fail", `${glyph.fail} ${message}`)}\n`);

  if (hint !== undefined) {
    process.stderr.write(`${paint("dim", `  ${hint}`)}\n`);
  }
}

export function transient(text: string): () => void {
  if (!process.stdout.isTTY) {
    return () => undefined;
  }

  process.stdout.write(`\r\u001b[2K${clip(text, columns() - 1)}`);

  return () => {
    process.stdout.write("\r\u001b[2K");
  };
}

export function pulse(text: string, intervalMs = 500): () => void {
  if (!process.stdout.isTTY) {
    line(text);
    return () => undefined;
  }

  let on = true;
  const draw = (): void => {
    process.stdout.write(
      `\r\u001b[2K${clip(`${text} ${on ? paint("accent", glyph.cursor) : " "}`, columns() - 1)}`,
    );
    on = !on;
  };

  draw();
  const timer = setInterval(draw, intervalMs);

  return () => {
    clearInterval(timer);
    process.stdout.write("\r\u001b[2K");
  };
}

export function wordmark(): string {
  return bold(`${paint("accent", "WALK")}${paint("text", "WRIGHT")}`);
}

export function logo(): string[] {
  const mark = (value: string): string => paint("accent", value);

  return [
    mark("     ■"),
    `${mark("   ┌─┼─┐")}    ${wordmark()}`,
    mark("   ■ ■ □"),
  ];
}
