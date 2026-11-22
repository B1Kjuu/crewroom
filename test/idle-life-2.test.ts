import { describe, expect, it } from 'vitest';
import { createCrewMotion } from '../src/office/crew-motion.js';
import { lighting } from '../src/office/lighting.js';
import { CrewState } from '../src/bridge/state.js';
import { BUILTIN_LAYOUT, deriveMap } from '../src/shared/layout.js';
import type { OfficeConfig } from '../src/shared/config-schema.js';
import type { WorkerView } from '../src/shared/events.js';

const map = deriveMap(BUILTIN_LAYOUT);
const w = (over: Partial<WorkerView>): WorkerView => ({
  id: 'editor', name: 'Editor', sprite: 'crew-2', color: '#3aa7ff', home: 'console-2', state: 'away', sessions: 0, generic: false, ...over,
});
const run = (m: ReturnType<typeof createCrewMotion>, seconds: number) => {
  for (let i = 0; i < seconds * 10; i++) m.step(0.1);
};

describe('skill drones (bridge side)', () => {
  const config: OfficeConfig = {
    office: { name: 'D', setting: 'crew-deck' },
    workers: [{ id: 'editor', name: 'Editor', sprite: 'crew-2', color: '#3aa7ff', home: 'console-2' }],
    rules: [{ worker: 'editor', when: { skill: 'b1kjuu-editor' } }],
    fallback: 'per-session',
    actions: {},
    layout: null,
    sources: { inbox: { enabled: true, path: null }, log: [], webhook: { enabled: true } },
  };
  const last = (msgs: ReturnType<CrewState['apply']>) => msgs.flatMap((m) => (m.type === 'worker' ? [m.worker] : [])).at(-1);

  it('a worker carries the skill in use until the session stops', () => {
    const s = new CrewState(config);
    expect(last(s.apply({ event: 'PreToolUse', session: 's', tool: 'Skill', skill: 'b1kjuu-editor' }, 0))?.skill).toBe('b1kjuu-editor');
    expect(last(s.apply({ event: 'PreToolUse', session: 's', tool: 'Bash', command: 'ffmpeg -i a' }, 1))?.skill).toBe('b1kjuu-editor');
    s.apply({ event: 'Stop', session: 's' }, 2);
    const idle = s.tick(10_000).flatMap((m) => (m.type === 'worker' ? [m.worker] : []));
    expect(idle.at(-1)?.skill).toBeUndefined();
  });
});

describe('the ship drone', () => {
  it('is always aboard, and follows a busy crewmember', () => {
    const m = createCrewMotion(map, { rand: () => 0.5, hour: () => 12 });
    m.update([w({ state: 'working', sessions: 1 })]);
    run(m, 30);
    const crew = m.ents.get('editor')!;
    expect(Math.abs(m.drone.x - crew.x) + Math.abs(m.drone.y - crew.y)).toBeLessThanOrEqual(2);
  });

  it('roams when nobody is busy, and docks at night', () => {
    const day = createCrewMotion(map, { rand: () => 0.3, hour: () => 12 });
    day.update([w({})]);
    run(day, 30);
    expect(day.drone.mode).toBe('roam');
    const night = createCrewMotion(map, { rand: () => 0.3, hour: () => 2 });
    night.update([w({})]);
    run(night, 30);
    expect(night.drone.mode).toBe('dock');
  });
});

describe('lighting', () => {
  it('is full brightness by day, dim and blue at night, warm at dusk', () => {
    expect(lighting(13)).toEqual({ phase: 'day', filter: 'none' });
    expect(lighting(2).phase).toBe('night');
    expect(lighting(2).filter).toMatch(/brightness\(0\.\d+\)/);
    expect(lighting(19).phase).toBe('dusk');
    expect(lighting(6).phase).toBe('dawn');
  });
});
