import { z } from "zod";

import type { LocatorDescriptor, Text } from "./locator.js";
import { locatorDescriptorSchema, textSchema } from "./locator.js";

export interface ParamDecl {
  name: string;
}

export const paramDeclSchema: z.ZodType<ParamDecl> = z.object({
  name: z.string(),
});

export type ElementDescriptor =
  | { locator: LocatorDescriptor; params?: ParamDecl[] }
  | { surface: NestedSurfaceDescriptor }
  | { overlay: OverlayDescriptor; open?: OpaqueImpl }
  | { opaque: true; provenance: "hand" };

export interface OpaqueImpl {
  opaque: true;
  provenance: "hand";
}

const opaqueImplSchema: z.ZodType<OpaqueImpl> = z.object({
  opaque: z.literal(true),
  provenance: z.literal("hand"),
});

export const elementDescriptorSchema: z.ZodType<ElementDescriptor> = z.lazy(
  () =>
    z.union([
      z.object({
        locator: locatorDescriptorSchema,
        params: z.array(paramDeclSchema).optional(),
      }),
      z.object({ surface: nestedSurfaceDescriptorSchema }),
      z.object({
        overlay: overlayDescriptorSchema,
        open: opaqueImplSchema.optional(),
      }),
      z.object({ opaque: z.literal(true), provenance: z.literal("hand") }),
    ]),
);

export interface ActionDescriptor {
  name: string;
  impl: OpaqueImpl;
}

export const actionDescriptorSchema: z.ZodType<ActionDescriptor> = z.object({
  name: z.string(),
  impl: opaqueImplSchema,
});

export interface RegexDescriptor {
  pattern: string;
  flags?: string;
}

export const regexDescriptorSchema: z.ZodType<RegexDescriptor> = z.object({
  pattern: z.string(),
  flags: z.string().optional(),
});

export type CaptureRuleDescriptor =
  | { element: string[]; text: string; match?: RegexDescriptor }
  | { match: RegexDescriptor; text: string };

export const captureRuleDescriptorSchema: z.ZodType<CaptureRuleDescriptor> =
  z.union([
    z.object({
      element: z.array(z.string()),
      text: z.string(),
      match: regexDescriptorSchema.optional(),
    }),
    z.object({ match: regexDescriptorSchema, text: z.string() }),
  ]);

export interface CaptureDescriptor {
  rules: CaptureRuleDescriptor[];
}

export const captureDescriptorSchema: z.ZodType<CaptureDescriptor> = z.object({
  rules: z.array(captureRuleDescriptorSchema),
});

export interface SurfaceDescriptor {
  elements: Record<string, ElementDescriptor>;
  actions?: ActionDescriptor[];
  capture?: CaptureDescriptor;
}

const surfaceShape = {
  elements: z.record(
    z.string(),
    z.lazy((): z.ZodType<ElementDescriptor> => elementDescriptorSchema),
  ),
  actions: z.array(actionDescriptorSchema).optional(),
  capture: captureDescriptorSchema.optional(),
};

export interface NestedSurfaceDescriptor extends SurfaceDescriptor {
  root?: LocatorDescriptor;
}

export const nestedSurfaceDescriptorSchema: z.ZodType<NestedSurfaceDescriptor> =
  z.lazy(() =>
    z.object({
      root: locatorDescriptorSchema.optional(),
      ...surfaceShape,
    }),
  );

export interface OverlayDescriptor extends SurfaceDescriptor {
  root: LocatorDescriptor;
  name?: Text;
  recorder: { label: string };
  close: { esc: boolean; button?: LocatorDescriptor };
}

export const overlayDescriptorSchema: z.ZodType<OverlayDescriptor> = z.lazy(
  () =>
    z.object({
      root: locatorDescriptorSchema,
      name: textSchema.optional(),
      recorder: z.object({ label: z.string() }),
      close: z.object({
        esc: z.boolean(),
        button: locatorDescriptorSchema.optional(),
      }),
      ...surfaceShape,
    }),
);

export type ReadyDescriptor = { selector: string } | { opaque: true };

const readyDescriptorSchema: z.ZodType<ReadyDescriptor> = z.union([
  z.object({ selector: z.string() }),
  z.object({ opaque: z.literal(true) }),
]);

export interface PageDescriptor extends SurfaceDescriptor {
  path: string;
  name: string;
  recorder?: { group?: string[]; label?: string };
  ready?: ReadyDescriptor;
  header?: Text;
  anchor?: LocatorDescriptor | { opaque: true };
}

export const pageDescriptorSchema: z.ZodType<PageDescriptor> = z.object({
  path: z.string(),
  name: z.string(),
  recorder: z
    .object({
      group: z.array(z.string()).optional(),
      label: z.string().optional(),
    })
    .optional(),
  ready: readyDescriptorSchema.optional(),
  header: textSchema.optional(),
  anchor: z
    .union([locatorDescriptorSchema, z.object({ opaque: z.literal(true) })])
    .optional(),
  ...surfaceShape,
});

export interface AppDescriptor {
  ready?: ReadyDescriptor;
  pages: PageDescriptor[];
  capture?: CaptureDescriptor;
}

export const appDescriptorSchema: z.ZodType<AppDescriptor> = z.object({
  ready: readyDescriptorSchema.optional(),
  pages: z.array(pageDescriptorSchema),
  capture: captureDescriptorSchema.optional(),
});
