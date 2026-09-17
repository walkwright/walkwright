import type { ReporterDescription } from "@playwright/test";

import type { RecorderFixtures } from "./recorder.js";
import type { ReporterOptions } from "./reporter.js";

const recording = process.env["WALK_RECORDING"] === "1";

export const walk = {
  recording,

  reporter(options: ReporterOptions): ReporterDescription[] {
    return recording ? [["walkwright/reporter", options]] : [];
  },

  use: { recording } satisfies Pick<RecorderFixtures, "recording">,
};
