// One char per colour. Crew uniforms use U/u, which each worker's colour replaces.
export const palette: Record<string, string> = {
  // hull
  '0': '#2b3347',
  '9': '#1d2333',
  '8': '#3d4863',
  r: '#56627f',
  // floor
  f: '#161c2b',
  g: '#1a2133',
  q: '#0f1420',
  // consoles and lights
  c: '#2e3a55',
  x: '#222b40',
  y: '#3fd0c9',
  z: '#1b5f6a',
  R: '#e8452c',
  Y: '#ffcf5c',
  G: '#5fd08a',
  // lounge
  p: '#7a4b8c',
  m: '#55345f',
  L: '#2f7a52',
  n: '#8a5a3c',
  M: '#c9ced9',
  N: '#6b7489',
  j: '#3a4560',
  // crew: skin tones, hair, details
  '1': '#f2c9a0',
  '2': '#d9a273',
  '3': '#a86b45',
  '4': '#6b4028',
  h: '#3b2a20',
  i: '#e8c15a',
  l: '#b6462e',
  s: '#d8dce6',
  t: '#151821',
  E: '#0b0f1a',
  B: '#1b1f2a',
  W: '#ffffff',
  k: '#11151f',
  o: '#0a0d16',
  // defaults for the uniform slots (replaced per worker)
  U: '#888888',
  u: '#666666',
};
