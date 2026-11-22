// The 3D deck: pixel-textured blocks, a Sims-style camera, crew as 2D sprites that show their
// front, back or side depending on where they walk relative to the camera.
import * as THREE from 'three';
import type { WorkerView } from '../shared/events.js';
import { CREW_H, CREW_W, DRONE_FRAMES, SKILL_DRONE, createSpriteCache, drawTags, exposeDebug, frameFor, noteFor } from './crew-look.js';
import { createCrewMotion, type CrewEnt } from './crew-motion.js';
import type { Office } from './render.js';
import { bakeSprite } from './sprite.js';
import type { SettingPack } from './settings/types.js';

const WALL_H = 1.6;
const SIDE_SHADE = 0.68; // sides of blocks are darker than tops: shading without lights
const GLOW: Record<string, number> = { type: 0x3aa7ff, read: 0x5fd08a, run: 0xffcf5c, think: 0xc86bd6, wait: 0xff4d4d };

interface Block {
  h: number;
  /** Footprint inside the tile (1 = whole tile). */
  w?: number;
  d?: number;
  /** Shift toward -z (the back of the tile), in tiles. */
  back?: number;
}

// Height and footprint per tile char. Anything not listed is plain floor.
const BLOCKS: Record<string, Block> = {
  H: { h: WALL_H },
  K: { h: 0.55 },
};

// A potted plant, front view, 16 x 24 (stands as a sprite like the crew).
const PLANT = {
  w: 16,
  h: 24,
  rows: [
    '................',
    '......LL........',
    '.....LGGL..LL...',
    '....LGGGGLLGGL..',
    '...LGGLGGGGGGL..',
    '..LGGGGLGGLGGL..',
    '..LGLGGGGGGGL...',
    '...LGGGGLGGGGL..',
    '..LGGGLGGGGLGGL.',
    '.LGGGGGGLGGGGGL.',
    '.LGLGGGGGGGLGGL.',
    '..LGGGLGGGGGGL..',
    '...LLGGGGLGGL...',
    '.....LLGGGLL....',
    '......LLLLL.....',
    '.......LL.......',
    '....nnnnnnnn....',
    '....nnnnnnnn....',
    '.....nnnnnn.....',
    '.....nnnnnn.....',
    '.....nnnnnn.....',
    '......nnnn......',
    '......nnnn......',
    '................',
  ],
};


const hashColor = (s: string) => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return new THREE.Color().setHSL((h % 360) / 360, 0.65, 0.6);
};

function pixelTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface Office3D extends Office {
  resetView(): void;
  /** Follow a crewmember with a third-person camera, or null for the whole-deck view. */
  follow(id: string | null): void;
  onFollowChange(cb: (id: string | null) => void): void;
}

export function createOffice3D(canvas: HTMLCanvasElement, pack: SettingPack): Office3D {
  const T = pack.tile;
  const { map } = pack;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(1); // chunky pixels on purpose
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070f);
  const disposables: { dispose(): void }[] = [renderer];
  const keep = <D extends { dispose(): void }>(d: D) => (disposables.push(d), d);

  const consoles: { x: number; y: number; screen: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> }[] = [];
  const doors: { x: number; y: number; left: THREE.Mesh; right: THREE.Mesh }[] = [];
  const cutaways: { obj: THREE.Object3D; out: [number, number] }[] = [];

  // Space all around the ship: a star sphere, and a pixel planet with a moon ahead of the cockpit.
  const starCanvas = document.createElement('canvas');
  starCanvas.width = 1024;
  starCanvas.height = 512;
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  {
    const g = starCanvas.getContext('2d')!;
    g.fillStyle = '#05070f';
    g.fillRect(0, 0, 1024, 512);
    for (let i = 0; i < 1100; i++) {
      g.fillStyle = rand() > 0.85 ? '#c9d4ff' : '#4a5578';
      g.fillRect(Math.floor(rand() * 1024), Math.floor(rand() * 512), 1, 1);
    }
  }
  const sky = new THREE.Mesh(keep(new THREE.SphereGeometry(150, 24, 16)), keep(new THREE.MeshBasicMaterial({ map: keep(pixelTexture(starCanvas)), side: THREE.BackSide })));
  sky.position.set(map.w / 2, 0, map.h / 2);
  scene.add(sky);
  const pixelBody = (w: number, h: number, colorAt: (x: number, y: number) => string) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      g.fillStyle = colorAt(x, y);
      g.fillRect(x, y, 1, 1);
    }
    return keep(pixelTexture(c));
  };
  const bands = ['#3b2a4f', '#55345f', '#7a4b8c', '#9a63ad', '#c88cd6', '#9a63ad', '#7a4b8c'];
  const planet = new THREE.Mesh(
    keep(new THREE.SphereGeometry(7, 18, 12)),
    keep(new THREE.MeshBasicMaterial({ map: pixelBody(32, 16, (x, y) => bands[Math.min(bands.length - 1, Math.max(0, Math.floor(((y + (x % 7 === 0 ? 1 : 0)) / 16) * bands.length)))]!) })),
  );
  planet.position.set(map.w * 0.75, -3, -22);
  const moon = new THREE.Mesh(
    keep(new THREE.SphereGeometry(1.3, 10, 8)),
    keep(new THREE.MeshBasicMaterial({ map: pixelBody(16, 8, () => (rand() > 0.7 ? '#8a90a3' : '#c9ced9')) })),
  );
  scene.add(planet, moon);

  // Tiles that change meaning in 3D: the hull in front of the windows becomes a glass wall
  // (with struts where the 2D deck has them), and the window tiles become cockpit floor.
  const at = (x: number, y: number) => map.rows[y]?.[x];
  const isGlass = (x: number, y: number) => at(x, y) === 'H' && (at(x, y + 1) === 'W' || at(x, y + 1) === 'V');
  const floorChar = (ch: string, x: number, y: number) =>
    ch === 'W' || ch === 'V' || isGlass(x, y) ? 'H' : ch === 'H' || ch === 'K' ? ch : (x + y) % 2 ? ',' : '.';

  // Floor: every tile's floor plate baked into one texture, under everything.
  const floorCanvas = document.createElement('canvas');
  floorCanvas.width = map.w * T;
  floorCanvas.height = map.h * T;
  const fctx = floorCanvas.getContext('2d')!;
  const bakedTile = new Map<string, HTMLCanvasElement>();
  const tileCanvas = (ch: string) => {
    if (!bakedTile.has(ch) && pack.tiles[ch]) bakedTile.set(ch, bakeSprite(pack.tiles[ch]!, pack.palette));
    return bakedTile.get(ch);
  };
  map.rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const img = tileCanvas(floorChar(ch, x, y));
      if (img) fctx.drawImage(img, x * T, y * T);
    }),
  );
  const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(map.w, map.h)), keep(new THREE.MeshBasicMaterial({ map: keep(pixelTexture(floorCanvas)) })));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(map.w / 2, 0, map.h / 2);
  scene.add(floor);

  const shaded = (tex: THREE.Texture | null, color?: string, k = SIDE_SHADE) => {
    const c = new THREE.Color(color ?? '#ffffff');
    return keep(new THREE.MeshBasicMaterial({ map: tex, color: c.multiplyScalar(k) }));
  };
  const OUT: Record<string, [number, number]> = { s: [0, 1], n: [0, -1], w: [-1, 0], e: [1, 0] };
  const edgeOf = (x: number, y: number) => (y === map.h - 1 ? 's' : y === 0 ? 'n' : x === 0 ? 'w' : x === map.w - 1 ? 'e' : 'in');
  const m = new THREE.Matrix4();

  // Walls and the cockpit dash: instanced blocks, sides darker than tops. Tall blocks on the outer
  // edges are grouped by edge so the edge facing the camera can drop low (a Sims-style cutaway).
  for (const [ch, b] of Object.entries(BLOCKS)) {
    const cells: [number, number][] = [];
    map.rows.forEach((row, y) => [...row].forEach((c, x) => c === ch && !isGlass(x, y) && cells.push([x, y])));
    const img = tileCanvas(ch);
    if (!cells.length || !img) continue;
    const tex = keep(pixelTexture(img));
    const top = shaded(tex, undefined, 1);
    const side = shaded(tex);
    const geo = keep(new THREE.BoxGeometry(b.w ?? 1, b.h, b.d ?? 1));
    const groups = new Map<string, [number, number][]>();
    for (const [x, y] of cells) {
      const g = b.h < 1 ? 'in' : edgeOf(x, y);
      groups.set(g, [...(groups.get(g) ?? []), [x, y]]);
    }
    for (const [edge, list] of groups) {
      const mesh = keep(new THREE.InstancedMesh(geo, [side, side, top, side, side, side], list.length));
      list.forEach(([x, y], i) => mesh.setMatrixAt(i, m.makeTranslation(x + 0.5, b.h / 2, y + 0.5)));
      scene.add(mesh);
      if (OUT[edge]) cutaways.push({ obj: mesh, out: OUT[edge]! });
    }
  }

  // Glass wall: a sill, a beam and a see-through pane per glass tile; struts where the deck has them.
  const hullTex = keep(pixelTexture(tileCanvas('H')!));
  const hullTop = shaded(hullTex, undefined, 1);
  const hullSide = shaded(hullTex);
  const glassMat = keep(new THREE.MeshBasicMaterial({ color: 0x7fc4ff, transparent: true, opacity: 0.13, depthWrite: false }));
  const sillGeo = keep(new THREE.BoxGeometry(1, 0.18, 0.4));
  const beamGeo = keep(new THREE.BoxGeometry(1, 0.14, 0.4));
  const paneGeo = keep(new THREE.BoxGeometry(1, WALL_H - 0.32, 0.06));
  const strutGeo = keep(new THREE.BoxGeometry(0.22, WALL_H, 0.4));
  map.rows.forEach((row, y) =>
    [...row].forEach((_, x) => {
      if (!isGlass(x, y)) return;
      const z = y + 0.7;
      if (at(x, y + 1) === 'V') {
        const strut = new THREE.Mesh(strutGeo, [hullSide, hullSide, hullTop, hullSide, hullSide, hullSide]);
        strut.position.set(x + 0.5, WALL_H / 2, z);
        scene.add(strut);
        return;
      }
      const sill = new THREE.Mesh(sillGeo, [hullSide, hullSide, hullTop, hullSide, hullSide, hullSide]);
      sill.position.set(x + 0.5, 0.09, z);
      const beam = new THREE.Mesh(beamGeo, [hullSide, hullSide, hullTop, hullSide, hullSide, hullSide]);
      beam.position.set(x + 0.5, WALL_H - 0.07, z);
      const pane = new THREE.Mesh(paneGeo, glassMat);
      pane.position.set(x + 0.5, WALL_H / 2, z);
      pane.renderOrder = 5;
      scene.add(sill, beam, pane);
    }),
  );

  // Furniture: simple shapes with pixel textures. Small and leafy things are standing sprites.
  const pal = pack.palette;
  const solid = (hex: string, k = 1) => keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k) }));
  const deskTex = pixelBody(16, 16, (x, y) => (y < 2 || y > 13 ? pal.x! : y >= 8 && y <= 10 && x > 1 && x < 14 ? pal.N! : x === 4 && y === 12 ? pal.R! : pal.c!));
  const deskTop = shaded(deskTex, undefined, 1);
  const deskSide = solid(pal.c!, SIDE_SHADE);
  const deskGeo = keep(new THREE.BoxGeometry(0.9, 0.45, 0.6));
  const sofaTex = pixelBody(16, 16, (x, y) => (x === 7 || x === 8 || y === 0 || y === 15 ? pal.m! : pal.p!));
  const sofaTop = shaded(sofaTex, undefined, 1);
  const sofaSide = solid(pal.p!, SIDE_SHADE);
  const sofaMats = [sofaSide, sofaSide, sofaTop, sofaSide, sofaSide, sofaSide];
  const seatGeo = keep(new THREE.BoxGeometry(1, 0.24, 0.66));
  const backGeo = keep(new THREE.BoxGeometry(1, 0.62, 0.18));
  const armGeo = keep(new THREE.BoxGeometry(0.14, 0.4, 0.66));
  const metal = solid(pal.N!);
  const metalDark = solid(pal.N!, SIDE_SHADE);
  const machineFront = shaded(keep(pixelTexture(tileCanvas('M')!)), undefined, 1);
  const machineGeo = keep(new THREE.BoxGeometry(0.72, 1.05, 0.5));
  const plantImg = bakeSprite(PLANT, pal);
  const plantMat = keep(new THREE.SpriteMaterial({ map: keep(pixelTexture(plantImg)), transparent: true, alphaTest: 0.5 }));
  map.rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const cx = x + 0.5;
      const cz = y + 0.5;
      if (ch === 'C') {
        const desk = new THREE.Mesh(deskGeo, [deskSide, deskSide, deskTop, deskSide, deskSide, deskSide]);
        desk.position.set(cx, 0.225, cz - 0.1);
        // Monitor on the desk; its screen glows with the work being done.
        const body = new THREE.Mesh(keep(new THREE.BoxGeometry(0.72, 0.46, 0.08)), deskSide);
        body.position.set(cx, 0.45 + 0.28, cz - 0.32);
        const screen = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.62, 0.36)), keep(new THREE.MeshBasicMaterial({ color: 0x1b2a3a })));
        screen.position.set(cx, 0.45 + 0.28, cz - 0.275);
        scene.add(desk, body, screen);
        consoles.push({ x, y, screen });
      } else if (ch === 'S') {
        const seat = new THREE.Mesh(seatGeo, sofaMats);
        seat.position.set(cx, 0.12, cz);
        const back = new THREE.Mesh(backGeo, sofaMats);
        back.position.set(cx, 0.31, cz - 0.33);
        scene.add(seat, back);
        for (const side of [-1, 1]) {
          if (at(x + side, y) === 'S') continue; // arms only at the ends of a sofa
          const arm = new THREE.Mesh(armGeo, sofaMats);
          arm.position.set(cx + side * 0.43, 0.2, cz);
          scene.add(arm);
        }
      } else if (ch === 'M') {
        const machine = new THREE.Mesh(machineGeo, [metalDark, metalDark, metal, metalDark, machineFront, metalDark]);
        machine.position.set(cx, 0.525, cz - 0.15);
        scene.add(machine);
      } else if (ch === 'P') {
        const plant = new THREE.Sprite(plantMat);
        plant.center.set(0.5, 0);
        plant.scale.set(1, 1.5, 1);
        plant.position.set(cx, 0, cz);
        scene.add(plant);
      }
    }),
  );

  // Airlock door: two panels in the wall that slide apart when crew are near.
  map.rows.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (c !== 'D') return;
      const mat = keep(new THREE.MeshBasicMaterial({ color: 0x3a4560 }));
      const geo = keep(new THREE.BoxGeometry(0.5, WALL_H, 0.2).translate(0, WALL_H / 2, 0)); // base at the floor, so a cutaway can lower it
      const left = new THREE.Mesh(geo, mat);
      const right = new THREE.Mesh(geo, mat);
      left.position.set(x + 0.25, 0, y + 0.5);
      right.position.set(x + 0.75, 0, y + 0.5);
      scene.add(left, right);
      doors.push({ x, y, left, right });
      const edge = edgeOf(x, y);
      if (OUT[edge]) cutaways.push({ obj: left, out: OUT[edge]! }, { obj: right, out: OUT[edge]! });
    }),
  );

  // Crew: a sprite each, a blob shadow, an optional project ring, and a label sprite.
  const spriteFor = createSpriteCache(pack);
  const motion = createCrewMotion(map);
  const textures = new Map<string, THREE.CanvasTexture>();
  const frameTexture = (canvasImg: HTMLCanvasElement, flip: boolean) => {
    const key = `${(canvasImg as HTMLCanvasElement & { __id?: number }).__id ??= Math.random()}|${flip}`;
    let t = textures.get(key);
    if (!t) {
      t = keep(pixelTexture(canvasImg));
      if (flip) {
        t.wrapS = THREE.RepeatWrapping;
        t.repeat.x = -1;
        t.offset.x = 1;
      }
      textures.set(key, t);
    }
    return t;
  };
  const shadowGeo = keep(new THREE.CircleGeometry(0.32, 16));
  const shadowMat = keep(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
  const ringGeo = keep(new THREE.RingGeometry(0.36, 0.44, 24));
  interface Look {
    sprite: THREE.Sprite;
    shadow: THREE.Mesh;
    ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
    tag: THREE.Sprite;
    tagCanvas: HTMLCanvasElement;
    tagKey: string;
  }
  const looks = new Map<string, Look>();
  // Labels keep the same size on screen at any zoom: 2 screen pixels per label pixel.
  let tagScale = 0.004;
  const freeLook = (l: Look) => {
    (l.sprite.material as THREE.SpriteMaterial).dispose();
    l.ring.material.dispose();
    (l.tag.material as THREE.SpriteMaterial).map?.dispose();
    (l.tag.material as THREE.SpriteMaterial).dispose();
  };
  const lookFor = (id: string): Look => {
    let l = looks.get(id);
    if (l) return l;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, alphaTest: 0.5 }));
    sprite.center.set(0.5, 0);
    sprite.scale.set(1, CREW_H / CREW_W, 1);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    const tagCanvas = document.createElement('canvas');
    tagCanvas.width = 96;
    tagCanvas.height = 32; // name and task above the head, the "!" beside it
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: pixelTexture(tagCanvas), transparent: true, depthTest: false, sizeAttenuation: false }));
    tag.center.set(0.5, 0);
    tag.scale.set(96 * tagScale, 32 * tagScale, 1);
    tag.renderOrder = 10;
    scene.add(sprite, shadow, ring, tag);
    l = { sprite, shadow, ring, tag, tagCanvas, tagKey: '' };
    looks.set(id, l);
    return l;
  };

  const drawLook = (e: CrewEnt, id: string, t: number, yaw: number) => {
    const l = lookFor(id);
    const visible = !e.hidden;
    l.sprite.visible = l.shadow.visible = l.tag.visible = visible;
    l.ring.visible = visible && !!e.view.project;
    if (!visible) return;
    const f = frameFor(e, t, yaw);
    (l.sprite.material as THREE.SpriteMaterial).map = frameTexture(spriteFor(e.view, f.set, f.index), f.flip);
    const px = e.x + 0.5;
    const pz = e.y + 0.5;
    l.sprite.position.set(px, 0, pz);
    l.shadow.position.set(px, 0.01, pz);
    l.ring.position.set(px, 0.012, pz);
    if (e.view.project) l.ring.material.color = hashColor(e.view.project);
    l.tag.position.set(px, CREW_H / CREW_W + 0.12, pz);
    const walking = e.path.length > 0;
    const note = noteFor(e);
    const key = `${e.view.name}|${e.view.sessions}|${e.view.label}|${e.view.state}|${walking}|${note}|${e.view.state === 'waiting' ? f.index % 2 : 0}`;
    if (key !== l.tagKey) {
      l.tagKey = key;
      const ctx = l.tagCanvas.getContext('2d')!;
      ctx.clearRect(0, 0, 96, 32);
      drawTags(ctx, e.view, 48, 24 - 1, walking, f.index, note);
      ((l.tag.material as THREE.SpriteMaterial).map as THREE.CanvasTexture).needsUpdate = true;
    }
  };

  // The ship drone, skill drones beside crew using a skill, and the odd meteor shower outside.
  const droneMats = DRONE_FRAMES.map((g) => keep(new THREE.SpriteMaterial({ map: keep(pixelTexture(bakeSprite(g, pack.palette))), transparent: true, alphaTest: 0.5 })));
  const droneSprite = new THREE.Sprite(droneMats[0]);
  droneSprite.center.set(0.5, 0);
  droneSprite.scale.set(0.75, 0.56, 1);
  const droneShadow = new THREE.Mesh(shadowGeo, shadowMat);
  droneShadow.rotation.x = -Math.PI / 2;
  droneShadow.scale.setScalar(0.5);
  scene.add(droneSprite, droneShadow);
  const skillMat = keep(new THREE.SpriteMaterial({ map: keep(pixelTexture(bakeSprite(SKILL_DRONE, pack.palette))), transparent: true, alphaTest: 0.5 }));
  const skillDrones = new Map<string, THREE.Sprite>();
  const meteorGeo = keep(new THREE.BoxGeometry(0.5, 0.5, 0.5));
  const meteorMat = keep(new THREE.MeshBasicMaterial({ color: 0xc9d4ff }));
  const meteors: { mesh: THREE.Mesh; vx: number; vy: number; until: number }[] = [];
  let nextShower = 20;

  // Camera: Sims-style, looking down at the deck; drag to rotate, wheel to zoom, right-drag to pan.
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
  const view = { yaw: 0, pitch: 0.82, dist: Math.max(map.w, map.h) * 1.25, tx: map.w / 2, tz: map.h / 2 + 0.5 };
  const home = { ...view };
  let untouched = true; // until you move the camera, it keeps the whole deck in view as the window changes
  // Follow mode: a third-person camera just above and behind one crewmember.
  let follow: string | null = null;
  let turnedByHandAt = -Infinity;
  let onFollowChange: (id: string | null) => void = () => {};
  const setFollow = (id: string | null) => {
    if (id === follow) return;
    follow = id;
    untouched = id === null;
    if (id) Object.assign(view, { dist: 5.5, pitch: 0.42 });
    else Object.assign(view, home);
    onFollowChange(id);
  };
  const placeCamera = (dt: number) => {
    const e = follow ? motion.ents.get(follow) : undefined;
    if (follow && (!e || e.hidden)) setFollow(null);
    if (e && !e.hidden) {
      const k = Math.min(1, dt * 6);
      view.tx += (e.x + 0.5 - view.tx) * k;
      view.tz += (e.y + 0.5 - view.tz) * k;
      // Swing behind them as they walk, unless you just turned the camera yourself.
      if (e.path.length && performance.now() - turnedByHandAt > 2500) {
        const want = Math.atan2(-e.move.x, -e.move.y);
        const diff = Math.atan2(Math.sin(want - view.yaw), Math.cos(want - view.yaw));
        view.yaw += diff * Math.min(1, dt * 3);
      }
    }
    const lookY = follow ? 0.9 : 0;
    const flat = view.dist * Math.cos(view.pitch);
    camera.position.set(view.tx + flat * Math.sin(view.yaw), lookY + view.dist * Math.sin(view.pitch), view.tz + flat * Math.cos(view.yaw));
    camera.lookAt(view.tx, lookY, view.tz);
  };
  const raycaster = new THREE.Raycaster();
  const crewAt = (clientX: number, clientY: number): string | null => {
    const r = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
    const sprites = [...looks.entries()].filter(([, l]) => l.sprite.visible);
    const hit = raycaster.intersectObjects(sprites.map(([, l]) => l.sprite))[0];
    return hit ? (sprites.find(([, l]) => l.sprite === hit.object)?.[0] ?? null) : null;
  };
  let drag: { x: number; y: number; button: number; startX: number; startY: number } | null = null;
  const onDown = (e: PointerEvent) => {
    untouched = false;
    drag = { x: e.clientX, y: e.clientY, button: e.button, startX: e.clientX, startY: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if ((drag.button === 2 || e.shiftKey) && !follow) {
      const k = view.dist / 600;
      view.tx -= (dx * Math.cos(view.yaw) + dy * Math.sin(view.yaw)) * k;
      view.tz -= (-dx * Math.sin(view.yaw) + dy * Math.cos(view.yaw)) * k;
    } else {
      view.yaw -= dx * 0.008;
      view.pitch = Math.min(1.35, Math.max(follow ? 0.12 : 0.45, view.pitch + dy * 0.006));
      turnedByHandAt = performance.now();
    }
  };
  const onUp = (e: PointerEvent) => {
    // A click (not a drag) on a crewmember follows them.
    if (drag && drag.button === 0 && Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) < 5) {
      const id = crewAt(e.clientX, e.clientY);
      if (id) setFollow(id);
    }
    drag = null;
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    untouched = false;
    view.dist = Math.min(60, Math.max(follow ? 1.8 : 6, view.dist * (e.deltaY > 0 ? 1.1 : 0.9)));
  };
  const noMenu = (e: Event) => e.preventDefault();
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  const onCancel = () => (drag = null);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', noMenu);

  const fit = () => {
    const box = canvas.parentElement!.getBoundingClientRect();
    const w = Math.max(1, Math.floor(box.width));
    const h = Math.max(1, Math.floor(box.height));
    renderer.setSize(w, h, false);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // Distance that fits the deck width and depth on screen, with a little margin.
    const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
    home.dist = Math.min(60, Math.max(6, Math.max((map.w * 0.58) / Math.tan(hHalf), (map.h * 0.62) / Math.tan(vHalf))));
    if (untouched) view.dist = home.dist;
    tagScale = (2 * 2 * Math.tan(vHalf)) / h;
    for (const l of looks.values()) l.tag.scale.set(96 * tagScale, 32 * tagScale, 1);
  };
  const resize = new ResizeObserver(fit);
  resize.observe(canvas.parentElement!);
  fit();

  const update = (workers: WorkerView[]) => {
    motion.update(workers);
    exposeDebug(workers, '3d', motion.ents);
  };

  let last = 0;
  const loop = (ms: number) => {
    const t = ms / 1000;
    const dt = last ? Math.min(t - last, 0.5) : 0;
    last = t;
    motion.step(dt);
    placeCamera(dt);
    // Cutaway: walls on the side facing the camera drop low.
    for (const c of cutaways) c.obj.scale.y = c.out[0] * Math.sin(view.yaw) + c.out[1] * Math.cos(view.yaw) > 0.35 ? 0.18 : 1;
    planet.rotation.y = t * 0.03;
    moon.position.set(planet.position.x + Math.cos(t * 0.05) * 11, planet.position.y + 1.5, planet.position.z + Math.sin(t * 0.05) * 11);
    // Console screens glow with what the crewmember at them is doing.
    for (const c of consoles) {
      const at = [...motion.ents.values()].find((e) => !e.hidden && !e.path.length && Math.round(e.x) === c.x && Math.round(e.y) === c.y + 1);
      const anim = at && (at.view.state === 'working' || at.view.state === 'waiting') ? (at.view.anim ?? 'type') : null;
      const pulse = anim === 'wait' ? 0.6 + 0.4 * Math.sin(t * 6) : 1;
      c.screen.material.color.setHex(anim ? GLOW[anim] ?? GLOW.type! : 0x1b2a3a).multiplyScalar(pulse);
    }
    // Airlock opens when someone is close.
    for (const d of doors) {
      const near = [...motion.ents.values()].some((e) => !e.hidden && Math.abs(e.x - d.x) + Math.abs(e.y - d.y) < 1.6);
      const open = near ? 0.42 : 0;
      d.left.position.x += (d.x + 0.25 - open - d.left.position.x) * Math.min(1, dt * 8);
      d.right.position.x += (d.x + 0.75 + open - d.right.position.x) * Math.min(1, dt * 8);
    }
    for (const [id, e] of motion.ents) drawLook(e, id, t, view.yaw);
    // Drone: bobs as it floats, light blinks.
    const d = motion.drone;
    droneSprite.material = droneMats[Math.floor(t * 2) % 2]!;
    droneSprite.position.set(d.x + 0.5, 0.75 + Math.sin(t * 3) * 0.08, d.y + 0.5);
    droneShadow.position.set(d.x + 0.5, 0.012, d.y + 0.5);
    // Skill drones circle the head of crew working with a skill.
    for (const [id, e] of motion.ents) {
      let sd = skillDrones.get(id);
      const on = !e.hidden && !!e.view.skill && (e.view.state === 'working' || e.view.state === 'waiting');
      if (!on) {
        if (sd) sd.visible = false;
        continue;
      }
      if (!sd) {
        sd = new THREE.Sprite(skillMat);
        sd.scale.set(0.32, 0.32, 1);
        scene.add(sd);
        skillDrones.set(id, sd);
      }
      sd.visible = true;
      const a = t * 1.6 + id.length;
      sd.position.set(e.x + 0.5 + Math.cos(a) * 0.5, CREW_H / CREW_W + 0.1 + Math.sin(t * 4) * 0.05, e.y + 0.5 + Math.sin(a) * 0.5);
    }
    for (const [id, sd] of skillDrones) {
      if (!motion.ents.has(id)) {
        scene.remove(sd);
        skillDrones.delete(id);
      }
    }
    // Meteor shower every minute or so, streaking across the far sky.
    if (t > nextShower) {
      nextShower = t + 45 + Math.random() * 60;
      for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
        const mesh = new THREE.Mesh(meteorGeo, meteorMat);
        mesh.position.set(-30 - i * 6, 14 + Math.random() * 10, -30 - Math.random() * 20);
        scene.add(mesh);
        meteors.push({ mesh, vx: 26 + Math.random() * 8, vy: -4 - Math.random() * 3, until: t + 4 });
      }
    }
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i]!;
      m.mesh.position.x += m.vx * dt;
      m.mesh.position.y += m.vy * dt;
      if (t > m.until) {
        scene.remove(m.mesh);
        meteors.splice(i, 1);
      }
    }
    // Labels that would overlap on screen stack upward, nearest crewmember lowest.
    const placed: { x: number; y: number }[] = [];
    const cw = canvas.clientWidth || 1;
    const ch = canvas.clientHeight || 1;
    const tagW = 96 * tagScale * (ch / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))) * 0.42;
    const tagH = 26; // two text lines of the pixel font at 2 screen px per pixel
    const visibleTags = [...looks.values()].filter((l) => l.tag.visible);
    visibleTags.sort((p, q) => p.tag.position.distanceToSquared(camera.position) - q.tag.position.distanceToSquared(camera.position));
    for (const l of visibleTags) {
      const p = l.tag.position.clone().project(camera);
      const sx = ((p.x + 1) / 2) * cw;
      let sy = ((1 - p.y) / 2) * ch;
      let lift = 0;
      while (placed.some((o) => Math.abs(o.x - sx) < tagW && Math.abs(o.y - sy) < tagH) && lift < 6) {
        sy -= tagH;
        lift++;
      }
      placed.push({ x: sx, y: sy });
      l.tag.center.set(0.5, -lift * (tagH / 64)); // the label image is 32 px = 64 screen px tall
    }
    for (const [id, l] of looks) {
      if (!motion.ents.has(id)) {
        scene.remove(l.sprite, l.shadow, l.ring, l.tag);
        freeLook(l);
        looks.delete(id);
      }
    }
    renderer.render(scene, camera);
    if (!stopped) frameId = requestAnimationFrame(loop);
  };

  let stopped = false;
  let frameId = 0;
  return {
    update,
    start: () => {
      frameId = requestAnimationFrame(loop);
    },
    destroy: () => {
      stopped = true;
      cancelAnimationFrame(frameId);
      resize.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', noMenu);
      for (const l of looks.values()) freeLook(l);
      for (const d of disposables) d.dispose();
    },
    resetView: () => {
      setFollow(null);
      Object.assign(view, home);
      untouched = true;
    },
    follow: (id: string | null) => setFollow(id),
    onFollowChange: (cb: (id: string | null) => void) => {
      onFollowChange = cb;
    },
  } as Office3D;
}
