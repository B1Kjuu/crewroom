import { describe, expect, it } from 'vitest';
import { createCrewMotion, facing } from '../src/office/crew-motion.js';
import { BUILTIN_LAYOUT, deriveMap } from '../src/shared/layout.js';
import type { WorkerView } from '../src/shared/events.js';

const map = deriveMap(BUILTIN_LAYOUT);
const w = (over: Partial<WorkerView>): WorkerView => ({
  id: 'editor', name: 'Editor', sprite: 'crew-2', color: '#3aa7ff', home: 'console-2', state: 'working', sessions: 1, generic: false, ...over,
});

describe('facing (which frames to show for the camera)', () => {
  it('with the camera at yaw 0, walking toward the viewer (+y) shows the front', () => {
    expect(facing({ x: 0, y: 1 }, 0)).toEqual({ set: 'walkDown', flip: false });
    expect(facing({ x: 0, y: -1 }, 0)).toEqual({ set: 'walkUp', flip: false });
    expect(facing({ x: 1, y: 0 }, 0)).toEqual({ set: 'walkRight', flip: false });
    expect(facing({ x: -1, y: 0 }, 0)).toEqual({ set: 'walkRight', flip: true });
  });

  it('turning the camera 90 degrees turns what you see', () => {
    // camera yawed 90 degrees: the screen's "toward you" direction is now +x
    expect(facing({ x: 1, y: 0 }, Math.PI / 2)).toEqual({ set: 'walkDown', flip: false });
    expect(facing({ x: 0, y: 1 }, Math.PI / 2).set).toBe('walkRight');
  });
});

describe('createCrewMotion', () => {
  it('a worker who arrives after the deck opened enters at the door and walks to their console', () => {
    const m = createCrewMotion(map);
    m.update([]);
    m.update([w({})]);
    const e = m.ents.get('editor')!;
    expect([e.x, e.y]).toEqual([10, 12]);
    for (let i = 0; i < 200; i++) m.step(0.1);
    expect([e.x, e.y]).toEqual([5, 6]);
    expect(e.path).toHaveLength(0);
  });

  it('moves 3 tiles a second and records the direction of travel', () => {
    const m = createCrewMotion(map);
    m.update([]);
    m.update([w({})]);
    const e = m.ents.get('editor')!;
    m.step(1);
    expect(Math.abs(e.x - 10) + Math.abs(e.y - 12)).toBeCloseTo(3, 5);
    expect(Math.hypot(e.move.x, e.move.y)).toBeCloseTo(1, 5);
  });

  it('temporary crew leave and hide when their session ends', () => {
    const m = createCrewMotion(map, { rand: () => 0.5, hour: () => 12 });
    m.update([]);
    m.update([w({ id: 't', generic: true })]);
    for (let i = 0; i < 100; i++) m.step(0.1);
    m.update([w({ id: 't', generic: true, state: 'away' })]);
    for (let i = 0; i < 300; i++) m.step(0.1);
    expect(m.ents.get('t')?.hidden).toBe(true);
  });
});
