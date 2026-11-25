import { z } from "zod";

const selector = z.string().min(1);
const action = z.union([
  z.strictObject({ click: selector }),
  z.strictObject({ wait: selector }),
]);
const viewport = z.union([
  z.enum(["desktop", "mobile"]),
  z.strictObject({
    width: z.int().min(1).max(8192),
    height: z.int().min(1).max(8192),
    scale: z.number().min(0.5).max(4).default(1),
    mobile: z.boolean().default(false),
  }),
]);
export const recipeSchema = z.strictObject({
  version: z.literal(1),
  url: z.url(),
  steps: z.array(action).default([]),
  viewports: z.array(viewport).min(1).max(10).default(["desktop"]),
  themes: z
    .array(z.enum(["light", "dark"]))
    .min(1)
    .max(2)
    .default(["light"]),
  timeoutMs: z.int().min(1).max(300000).default(10000),
  screenshot: z
    .union([
      z.enum(["viewport", "full", "off"]),
      z.strictObject({ element: selector }),
    ])
    .default("viewport"),
  pdf: z
    .union([
      z.boolean(),
      z.strictObject({
        landscape: z.boolean().default(false),
        printBackground: z.boolean().default(true),
        preferCSSPageSize: z.boolean().default(true),
      }),
    ])
    .default(false),
  accessibility: z.boolean().default(false),
  heapComparison: z.boolean().default(false),
  performance: z.boolean().default(false),
  tracePreset: z.enum(["standard", "game"]).optional(),
  cpuProfile: z.boolean().default(false),
  sampleMs: z.int().min(100).max(30000).default(500),
  samples: z.int().min(1).max(10).default(1),
});
export type Recipe = z.infer<typeof recipeSchema>;
export function dimensions(v: Recipe["viewports"][number]) {
  if (v === "desktop")
    return { width: 1440, height: 900, scale: 1, mobile: false };
  if (v === "mobile")
    return { width: 390, height: 844, scale: 2, mobile: true };
  return v;
}
