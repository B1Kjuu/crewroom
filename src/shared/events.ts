import { z } from 'zod';

export type HookEventName =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Notification'
  | 'Stop'
  | 'SubagentStop'
  | 'SessionEnd';

export const HOOK_EVENTS: readonly HookEventName[] = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'Stop',
  'SubagentStop',
  'SessionEnd',
];

const str = z.string().max(1000);

export const crewEventSchema = z.strictObject({
  event: z.enum(HOOK_EVENTS as [HookEventName, ...HookEventName[]]),
  session: z.string().min(1).max(1000),
  cwd: str.optional(),
  tool: str.optional(),
  skill: str.optional(),
  command: z.string().max(200).optional(),
  path: str.optional(),
});

export type CrewEvent = z.infer<typeof crewEventSchema>;

export type Anim = 'type' | 'read' | 'run' | 'think' | 'wait';
export const ANIMS: readonly Anim[] = ['type', 'read', 'run', 'think', 'wait'];

export type WorkerState = 'away' | 'idle' | 'working' | 'waiting';

export interface WorkerView {
  id: string;
  name: string;
  sprite: string;
  color: string;
  home: string;
  state: WorkerState;
  action?: string;
  label?: string;
  anim?: Anim;
  sessions: number;
  generic: boolean;
  /** Folder name of the project the driving session works in (for the shared accent ring in 3D). */
  project?: string;
  /** Skill in use right now, if any. */
  skill?: string;
}

export interface LogEntry {
  t: number;
  worker: string;
  event: HookEventName | 'Report';
  tool?: string;
  label?: string;
}

export type SnapshotMsg = {
  type: 'snapshot';
  office: { name: string; setting: string };
  workers: WorkerView[];
  log: LogEntry[];
  configError: string | null;
  /** Saved layout rows, or null for the built-in deck. Added by the bridge. */
  layout?: string[] | null;
};

export type ServerMsg =
  | SnapshotMsg
  | { type: 'worker'; worker: WorkerView }
  | { type: 'remove'; id: string }
  | { type: 'log'; entry: LogEntry };

// Phase 2: workers that report themselves (inbox, vault log, webhook).
export const REPORT_SOURCES = ['inbox', 'log', 'webhook'] as const;
export type ReportSource = (typeof REPORT_SOURCES)[number];
export const REPORT_STATUSES = ['start', 'done', 'note', 'waiting'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const reportEventSchema = z.strictObject({
  event: z.literal('Report'),
  session: z.string().min(1).max(200),
  source: z.enum(REPORT_SOURCES),
  worker: z.string().min(1).max(60).optional(),
  status: z.enum(REPORT_STATUSES),
  text: z.string().max(200).optional(),
  path: str.optional(),
});

export type ReportEvent = z.infer<typeof reportEventSchema>;
export type AnyEvent = CrewEvent | ReportEvent;
export type EventSource = 'claude' | ReportSource;
