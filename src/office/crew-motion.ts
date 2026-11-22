// Where each crewmember is and where they're walking, in tile units. No drawing here: the 2D and
// 3D renderers both read these positions. Idle and off-duty crew live little routines (Sims-style).
import type { WorkerView } from '../shared/events.js';
import { restSpots, type MapDef } from '../shared/layout.js';
import { findPath, type Point } from '../shared/path.js';

const SPEED = 3; // tiles per second

export type ActivityKind = 'coffee' | 'plants' | 'window' | 'sofa' | 'chat' | 'sleep';

export interface Activity {
  kind: ActivityKind;
  /** Motion clock (seconds) when it started and when it ends. */
  since: number;
  until: number;
  tile: Point;
  /** Chat partner. */
  with?: string;
}

export interface CrewEnt {
  view: WorkerView;
  x: number;
  y: number;
  path: Point[];
  spot: string;
  /** Unit vector of the last movement, in map coordinates (x right, y toward the bottom of the map). */
  move: Point;
  leaving: boolean;
  hidden: boolean;
  /** What an idle or off-duty crewmember is doing. */
  activity?: Activity;
}

export type WalkSet = 'walkDown' | 'walkUp' | 'walkRight';

/**
 * Which walk frames to show. cameraYaw 0 looks at the map like the 2D deck (toward +y is toward you);
 * a camera turned by cameraYaw radians sees "toward you" as (sin yaw, cos yaw).
 */
export function facing(move: Point, cameraYaw: number): { set: WalkSet; flip: boolean } {
  const towardYou = move.x * Math.sin(cameraYaw) + move.y * Math.cos(cameraYaw);
  const toYourRight = move.x * Math.cos(cameraYaw) - move.y * Math.sin(cameraYaw);
  if (Math.abs(towardYou) >= Math.abs(toYourRight)) return { set: towardYou >= 0 ? 'walkDown' : 'walkUp', flip: false };
  return { set: 'walkRight', flip: toYourRight < 0 };
}

const walkable = (map: MapDef, x: number, y: number) => {
  const ch = map.rows[y]?.[x];
  return ch !== undefined && map.walkable.includes(ch);
};

/** Tiles where idle crew can do things, worked out from the deck's tiles. */
export function activitySpots(map: MapDef): Record<Exclude<ActivityKind, 'chat' | 'sleep'>, Point[]> {
  const near = (ch: string) => {
    const out: Point[] = [];
    map.rows.forEach((row, y) =>
      [...row].forEach((c, x) => {
        if (c !== ch) return;
        for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0]] as const) if (walkable(map, x + dx, y + dy)) out.push({ x: x + dx, y: y + dy });
      }),
    );
    return out;
  };
  const window: Point[] = [];
  map.rows.forEach((row, y) => [...row].forEach((c, x) => c === 'K' && walkable(map, x, y + 1) && window.push({ x, y: y + 1 })));
  const taken = new Set(Object.entries(map.spots).filter(([n]) => !n.startsWith('lounge')).map(([, s]) => `${s.x},${s.y}`));
  const free = (list: Point[]) => list.filter((p) => !taken.has(`${p.x},${p.y}`));
  return { coffee: free(near('M')), plants: free(near('P')), window: free(window), sofa: restSpots(map, 4) };
}

export interface MotionOptions {
  /** 0..1; injectable for tests. */
  rand?: () => number;
  /** Local hour 0..23, for sleeping at night. */
  hour?: () => number;
}

export function createCrewMotion(map: MapDef, opts: MotionOptions = {}) {
  const rand = opts.rand ?? Math.random;
  const hour = opts.hour ?? (() => new Date().getHours());
  // Crew without a free console wait on their own tile.
  const rest = restSpots(map, 16);
  const spots = activitySpots(map);
  const spotTile = (name: string): Point => {
    if (name.startsWith('rest-') && rest.length) return rest[Number(name.slice(5)) % rest.length]!;
    if (name.startsWith('at:')) {
      const [x, y] = name.slice(3).split(',').map(Number);
      return { x: x!, y: y! };
    }
    const s = map.spots[name] ?? map.spots.door!;
    return { x: s.x, y: s.y };
  };
  const key = (p: Point) => `${p.x},${p.y}`;
  const tileOf = (e: CrewEnt): Point => ({ x: Math.round(e.x), y: Math.round(e.y) });
  const offDuty = (v: WorkerView) => v.state === 'away' && !v.generic;
  const free = (v: WorkerView) => v.state === 'idle' || offDuty(v);

  const ents = new Map<string, CrewEnt>();
  let latest: WorkerView[] = [];
  let clock = 0;
  let initial = true;

  const goTo = (e: CrewEnt, spot: string) => {
    if (e.spot === spot && (e.path.length || !e.leaving)) return;
    e.spot = spot;
    e.path = findPath(map, tileOf(e), spotTile(spot)).slice(1);
  };

  const claimed = (except?: CrewEnt) => {
    const s = new Set<string>();
    for (const o of ents.values()) {
      if (o === except) continue;
      if (o.activity) s.add(key(o.activity.tile));
      if (!o.path.length) s.add(key(tileOf(o)));
    }
    return s;
  };

  const startActivity = (e: CrewEnt, kind: ActivityKind, tile: Point, seconds: number, partner?: string) => {
    e.activity = { kind, since: clock, until: clock + seconds, tile, ...(partner ? { with: partner } : {}) };
    goTo(e, `at:${key(tile)}`);
  };

  /** Picks the next thing to do. Night sends off-duty crew to sleep; otherwise a random routine. */
  const chooseActivity = (e: CrewEnt) => {
    const taken = claimed(e);
    const firstFree = (list: Point[]) => {
      const startAt = Math.floor(rand() * list.length);
      for (let i = 0; i < list.length; i++) {
        const p = list[(startAt + i) % list.length]!;
        if (!taken.has(key(p))) return p;
      }
      return undefined;
    };
    const h = hour();
    if (offDuty(e.view) && (h >= 23 || h < 7)) {
      const bed = firstFree(spots.sofa) ?? firstFree(rest);
      if (bed) return startActivity(e, 'sleep', bed, 120);
    }
    const partner = [...ents.entries()].find(([id, o]) => o !== e && !o.hidden && free(o.view) && !o.path.length && !!o.activity && o.activity.kind !== 'chat' && o.activity.kind !== 'sleep' && key(tileOf(o)) !== key(spotTile('door')) && id);
    const kinds: (keyof typeof spots | 'chat')[] = ['coffee', 'plants', 'window', 'sofa'];
    if (partner) kinds.push('chat');
    const seconds = 15 + rand() * 25;
    const pick = Math.min(kinds.length - 1, Math.floor(rand() * kinds.length));
    for (let i = 0; i < kinds.length; i++) {
      const kind = kinds[(pick + i) % kinds.length]!;
      if (kind === 'chat' && partner) {
        const [pid, p] = partner;
        const pt = tileOf(p);
        const spot = [[1, 0], [-1, 0], [0, 1], [0, -1]]
          .map(([dx, dy]) => ({ x: pt.x + dx!, y: pt.y + dy! }))
          .find((n) => walkable(map, n.x, n.y) && !taken.has(key(n)) && key(n) !== key(spotTile('door')));
        if (!spot) continue;
        startActivity(e, 'chat', spot, seconds, pid);
        p.activity = { kind: 'chat', since: clock, until: clock + seconds, tile: pt, with: [...ents.entries()].find(([, o]) => o === e)![0] };
        return;
      }
      if (kind === 'chat') continue;
      const tile = firstFree(spots[kind as keyof typeof spots]);
      if (tile) return startActivity(e, kind, tile, seconds);
    }
  };

  const update = (workers: WorkerView[]) => {
    latest = workers;
    const seen = new Set<string>();
    for (const v of workers) {
      seen.add(v.id);
      let e = ents.get(v.id);
      const busy = v.state === 'working' || v.state === 'waiting';
      if (!e) {
        // Everyone is aboard when the deck opens; crew who show up later walk in through the door.
        const startAt = initial ? (busy ? spotTile(map.spots[v.home] ? v.home : 'rest-0') : undefined) : spotTile('door');
        const door = spotTile('door');
        e = { view: v, x: startAt?.x ?? door.x, y: startAt?.y ?? door.y, path: [], spot: '', move: { x: 0, y: 1 }, leaving: false, hidden: false };
        ents.set(v.id, e);
        if (initial && !busy) {
          chooseActivity(e);
          if (e.activity) {
            e.x = e.activity.tile.x;
            e.y = e.activity.tile.y;
            e.path = [];
          }
        }
      }
      e.view = v;
      e.leaving = v.state === 'away' && v.generic;
      e.hidden = false;
      if (busy) {
        e.activity = undefined;
        goTo(e, map.spots[v.home] ? v.home : `rest-${[...ents.keys()].indexOf(v.id)}`);
      } else if (e.leaving) {
        e.activity = undefined;
        goTo(e, 'door');
      }
    }
    for (const [id, e] of ents) {
      if (seen.has(id)) continue;
      e.leaving = true;
      e.activity = undefined;
      e.view = { ...e.view, state: 'away' };
      goTo(e, 'door');
    }
    initial = false;
  };

  const step = (dt: number) => {
    clock += dt;
    stepDrone(dt);
    for (const [id, e] of ents) {
      let budget = SPEED * dt;
      while (budget > 1e-9 && e.path.length) {
        const next = e.path[0]!;
        const dx = next.x - e.x;
        const dy = next.y - e.y;
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist > 0) e.move = Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
        if (dist <= budget) {
          e.x = next.x;
          e.y = next.y;
          e.path.shift();
          budget -= dist;
        } else {
          e.x += e.move.x * budget;
          e.y += e.move.y * budget;
          budget = 0;
        }
      }
      if (!e.path.length && e.leaving && e.spot === 'door') {
        e.hidden = true;
        if (!latest.some((w) => w.id === id)) ents.delete(id);
        continue;
      }
      if (!e.leaving && free(e.view) && !e.path.length && (!e.activity || clock >= e.activity.until)) chooseActivity(e);
    }
  };

  // The ship drone: always aboard. Follows a busy crewmember, roams when nobody is busy, docks at night.
  const dockTile: Point = (() => {
    const d = spotTile('door');
    for (const [dx, dy] of [[1, -1], [-1, -1], [0, -1]] as const) if (walkable(map, d.x + dx, d.y + dy)) return { x: d.x + dx, y: d.y + dy };
    return d;
  })();
  const floorTiles: Point[] = [];
  map.rows.forEach((row, y) => [...row].forEach((c, x) => c !== 'D' && walkable(map, x, y) && floorTiles.push({ x, y })));
  const drone = { x: dockTile.x, y: dockTile.y, path: [] as Point[], move: { x: 0, y: 1 } as Point, mode: 'roam' as 'roam' | 'follow' | 'dock', following: undefined as string | undefined, nextChoice: 0 };
  const droneTo = (p: Point) => {
    drone.path = findPath(map, { x: Math.round(drone.x), y: Math.round(drone.y) }, p).slice(1);
  };
  const stepDrone = (dt: number) => {
    if (clock >= drone.nextChoice) {
      drone.nextChoice = clock + 6 + rand() * 8;
      const h = hour();
      const busy = [...ents.entries()].filter(([, e]) => !e.hidden && (e.view.state === 'working' || e.view.state === 'waiting'));
      if (busy.length) {
        drone.mode = 'follow';
        drone.following = busy[Math.min(busy.length - 1, Math.floor(rand() * busy.length))]![0];
      } else if (h >= 23 || h < 7) {
        drone.mode = 'dock';
        drone.following = undefined;
        droneTo(dockTile);
      } else {
        drone.mode = 'roam';
        drone.following = undefined;
        if (floorTiles.length) droneTo(floorTiles[Math.min(floorTiles.length - 1, Math.floor(rand() * floorTiles.length))]!);
      }
    }
    if (drone.mode === 'follow' && !drone.path.length) {
      const e = drone.following ? ents.get(drone.following) : undefined;
      if (e && Math.abs(e.x - drone.x) + Math.abs(e.y - drone.y) > 1.5) {
        const near = [[1, 0], [-1, 0], [0, 1]].map(([dx, dy]) => ({ x: Math.round(e.x) + dx!, y: Math.round(e.y) + dy! })).find((p) => walkable(map, p.x, p.y));
        if (near) droneTo(near);
      }
    }
    let budget = 2 * dt; // tiles per second
    while (budget > 1e-9 && drone.path.length) {
      const next = drone.path[0]!;
      const dx = next.x - drone.x;
      const dy = next.y - drone.y;
      const dist = Math.abs(dx) + Math.abs(dy);
      if (dist > 0) drone.move = Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
      if (dist <= budget) {
        drone.x = next.x;
        drone.y = next.y;
        drone.path.shift();
        budget -= dist;
      } else {
        drone.x += drone.move.x * budget;
        drone.y += drone.move.y * budget;
        budget = 0;
      }
    }
  };

  return { ents, update, step, drone, latest: () => latest, clock: () => clock };
}
