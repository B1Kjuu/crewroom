import { describe, expect, it } from 'vitest';
import { activitySpots, createCrewMotion } from '../src/office/crew-motion.js';
import { BUILTIN_LAYOUT, deriveMap } from '../src/shared/layout.js';
import type { WorkerView } from '../src/shared/events.js';

const map = deriveMap(BUILTIN_LAYOUT);
const w = (over: Partial<WorkerView>): WorkerView => ({
  id: 'editor', name: 'Editor', sprite: 'crew-2', color: '#3aa7ff', home: 'console-2', state: 'away', sessions: 0, generic: false, ...over,
});
// Deterministic randomness and a daytime clock.
const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length]!;
};
const run = (m: ReturnType<typeof createCrewMotion>, seconds: number) => {
  for (let i = 0; i < seconds * 10; i++) m.step(0.1);
};

describe('activitySpots', () => {
  it('finds the coffee machine, the plant, the window and the sofa in the built-in deck', () => {
    const s = activitySpots(map);
    expect(s.coffee).toContainEqual({ x: 20, y: 10 }); // in front of the machine
    expect(s.plants).toContainEqual({ x: 15, y: 10 }); // in front of the plant
    expect(s.window.length).toBeGreaterThan(10); // the row below the cockpit dash
    expect(s.sofa).toHaveLength(4);
  });
});

describe('idle life', () => {
  it('off-duty crew are aboard as soon as the deck opens, not hidden', () => {
    const m = createCrewMotion(map, { rand: seq(0.1), hour: () => 12 });
    m.update([w({})]);
    const e = m.ents.get('editor')!;
    expect(e.hidden).toBe(false);
    expect(e.leaving).toBe(false);
    expect(`${e.x},${e.y}`).not.toBe('10,12'); // placed in the deck, not at the door
  });

  it('idle crew pick an activity, go there, and pick another later', () => {
    const m = createCrewMotion(map, { rand: seq(0.05, 0.5, 0.9, 0.3), hour: () => 12 });
    m.update([w({})]);
    run(m, 1);
    const first = m.ents.get('editor')!.activity;
    expect(first).toBeDefined();
    run(m, 60);
    const later = m.ents.get('editor')!.activity;
    expect(later).toBeDefined();
    expect(later!.since).toBeGreaterThan(first!.since);
  });

  it('two free crew can chat next to each other', () => {
    // rand 0.99 picks the last option, which is a chat when someone is free
    const m = createCrewMotion(map, { rand: seq(0.99), hour: () => 12 });
    m.update([w({ id: 'a' }), w({ id: 'b', home: 'console-3' })]);
    run(m, 20);
    const a = m.ents.get('a')!;
    const b = m.ents.get('b')!;
    expect(a.activity?.kind).toBe('chat');
    expect(b.activity?.kind).toBe('chat');
    expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBeLessThanOrEqual(1.01);
    for (const e of [a, b]) expect(`${e.x},${e.y}`).not.toBe('10,12'); // never in the airlock
  });

  it('off-duty crew sleep at night', () => {
    const m = createCrewMotion(map, { rand: seq(0.5), hour: () => 2 });
    m.update([w({})]);
    run(m, 1);
    expect(m.ents.get('editor')!.activity?.kind).toBe('sleep');
  });

  it('working crew ignore routines and go to their console', () => {
    const m = createCrewMotion(map, { rand: seq(0.5), hour: () => 12 });
    m.update([w({ state: 'working', sessions: 1 })]);
    run(m, 30);
    const e = m.ents.get('editor')!;
    expect([e.x, e.y]).toEqual([5, 6]);
    expect(e.activity).toBeUndefined();
  });

  it('temporary crew still leave through the door when their session ends', () => {
    const m = createCrewMotion(map, { rand: seq(0.5), hour: () => 12 });
    m.update([w({ id: 'session-x', generic: true, state: 'working', sessions: 1 })]);
    run(m, 5);
    m.update([]);
    run(m, 30);
    expect(m.ents.has('session-x')).toBe(false);
  });

  it('no two idle crew head for the same tile', () => {
    const m = createCrewMotion(map, { rand: seq(0.3), hour: () => 12 });
    m.update(['a', 'b', 'c', 'd'].map((id, i) => w({ id, home: `console-${i + 1}` })));
    run(m, 20);
    const spots = [...m.ents.values()].map((e) => `${e.x},${e.y}`);
    expect(new Set(spots).size).toBe(spots.length);
  });
});
