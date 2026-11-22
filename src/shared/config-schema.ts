import { z } from 'zod';
import { ANIMS, type Anim } from './events.js';

const oneOrMany = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);

const SPRITES = ['crew-1', 'crew-2', 'crew-3', 'crew-4', 'crew-5', 'crew-6', 'crew-7', 'crew-8'] as const;
const CONSOLES = ['console-1', 'console-2', 'console-3', 'console-4', 'console-5', 'console-6', 'console-7', 'console-8'] as const;

const SOURCES = ['claude', 'inbox', 'log', 'webhook'] as const;

const sourcesSchema = z
  .strictObject({
    inbox: z
      .strictObject({ enabled: z.boolean().default(true), path: z.string().min(1).nullable().default(null) })
      .default({ enabled: true, path: null }),
    log: z.array(z.strictObject({ path: z.string().min(1) })).max(10).default([]),
    webhook: z.strictObject({ enabled: z.boolean().default(true) }).default({ enabled: true }),
  })
  .default({ inbox: { enabled: true, path: null }, log: [], webhook: { enabled: true } });

const workerSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/, 'use lowercase letters, digits and dashes'),
  name: z.string().min(1).max(40),
  sprite: z.union([z.enum(SPRITES), z.string().regex(/^custom:[a-z0-9-]{1,30}$/, 'use crew-1 to crew-8, or custom:<name> for ~/.crewroom/sprites/<name>.png')]),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, 'use a hex colour like #e8452c'),
  home: z.enum(CONSOLES),
});

const whenSchema = z
  .strictObject({
    skill: oneOrMany.optional(),
    tool: oneOrMany.optional(),
    command: oneOrMany.optional(),
    path: oneOrMany.optional(),
    cwd: oneOrMany.optional(),
    source: z.union([z.enum(SOURCES), z.array(z.enum(SOURCES)).min(1)]).optional(),
    text: oneOrMany.optional(),
  })
  .refine((w) => Object.keys(w).length > 0, 'a rule needs at least one "when" key');

const ruleSchema = z.strictObject({
  worker: z.string().min(1),
  when: whenSchema,
  action: z.string().min(1).optional(),
});

export const configSchema = z
  .strictObject({
    office: z.strictObject({ name: z.string().min(1).max(60), setting: z.literal('crew-deck') }),
    workers: z.array(workerSchema).min(1).max(8),
    rules: z.array(ruleSchema).default([]),
    fallback: z.string().min(1).default('per-session'),
    actions: z
      .record(z.string(), z.strictObject({ label: z.string().min(1).max(30), anim: z.enum(ANIMS as [Anim, ...Anim[]]) }))
      .default({}),
    layout: z.string().nullable().default(null),
    sources: sourcesSchema,
  })
  .superRefine((c, ctx) => {
    const ids = new Set<string>();
    const homes = new Set<string>();
    c.workers.forEach((w, i) => {
      if (ids.has(w.id)) ctx.addIssue({ code: 'custom', path: ['workers', i, 'id'], message: `duplicate worker id "${w.id}"` });
      if (homes.has(w.home)) ctx.addIssue({ code: 'custom', path: ['workers', i, 'home'], message: `two workers share home "${w.home}"` });
      ids.add(w.id);
      homes.add(w.home);
    });
    c.rules.forEach((r, i) => {
      if (!ids.has(r.worker)) ctx.addIssue({ code: 'custom', path: ['rules', i, 'worker'], message: `unknown worker "${r.worker}"` });
    });
    if (c.fallback !== 'per-session' && !ids.has(c.fallback)) {
      ctx.addIssue({ code: 'custom', path: ['fallback'], message: `fallback "${c.fallback}" is not a worker id (or use "per-session")` });
    }
  });

export type OfficeConfig = z.infer<typeof configSchema>;
export type Rule = OfficeConfig['rules'][number];

export function parseConfig(text: string): { ok: true; config: OfficeConfig } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
  const r = configSchema.safeParse(raw);
  if (!r.success) return { ok: false, error: z.prettifyError(r.error) };
  return { ok: true, config: r.data };
}
