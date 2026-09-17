import { z } from "zod";

export const manifestVersion = 5;

export const captureSchema = z.object({
  variant: z.record(z.string().min(1), z.string()).optional(),
  files: z
    .record(z.string().min(1), z.string().min(1))
    .refine((files) => typeof files["image"] === "string", {
      message: "files.image is required",
    }),
});

export const stateSchema = z.object({
  name: z.string().min(1),
  captures: z.array(captureSchema).min(1),
});

export const subjectSchema = z.object({
  path: z.array(z.string().min(1)).min(1),
  url: z.string().optional(),
  states: z.array(stateSchema).min(1),
});

export const manifestSchema = z.object({
  version: z.literal(manifestVersion),
  tool: z.string().optional(),
  url: z.string().optional(),
  startedAt: z.iso.datetime().optional(),
  runStats: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  subjects: z.array(subjectSchema),
});

export type Capture = z.infer<typeof captureSchema>;
export type State = z.infer<typeof stateSchema>;
export type Subject = z.infer<typeof subjectSchema>;
export type Manifest = z.infer<typeof manifestSchema>;
