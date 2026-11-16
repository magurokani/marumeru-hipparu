import * as THREE from 'three';

/* ------------------------------------------------------------------ *
 * Camera model. All layout is authored in poster pixels (2000×1125).
 * The poster is a shifted-lens view: verticals stay vertical and the
 * horizon sits at y=125, so projection is a plain pinhole.
 * World: plinth top is y=0, front edge z=0, back edge z≈-8.81.
 * ------------------------------------------------------------------ */
const F = 2000, CX = 1005, HY = 125, CAM_H = 9.03, CAM_Z = 19.63;
const TALL = innerHeight / innerWidth > 1.05;
// Landscape is drawn lighter: smaller parts on a slightly larger plinth.
const PART_K = TALL ? 1 : .86;           // knobs, plugs, sockets
const PLINTH_W = TALL ? 16 : 17.6, PLINTH_D = TALL ? 8.81 : 9.7;
const PLUG_BASE = 1.02;
const PLUG_H = PLUG_BASE * PART_K;

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
// A tall phone screen gets its own composition: two-line logo, cables standing tall.
const PORTRAIT = TALL;
// The phone layout follows a tall design frame (1416×2000). One design pixel = DS poster pixels;
// the frame's plinth front edge (y 1915) sits on the poster's (y 1045), centred on the same axis.
const DS = 1.254;
const LED_K = PORTRAIT ? 1.6 : 1;        // the LED bar is a little taller on phones so it stays readable
const BAR_BOTTOM = 1045 + 80 * LED_K;   // bottom of the LED bar in poster pixels
const WIDTH_K = PORTRAIT ? 1.4 : .86;  // the tall design draws cables heavier; landscape a touch finer
const fromDesign = ([x, y]) => [1005 + (x - 708) * DS, 1045 + (y - 1915) * DS];
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const rand = (a, b) => a + Math.random() * (b - a);

const canvas = document.getElementById('stage');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  document.documentElement.classList.add('no-webgl');
  throw e;
}
renderer.autoClear = false;
renderer.setClearColor(0xcbcbcb, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();
camera.position.set(0, CAM_H, CAM_Z);
camera.matrixAutoUpdate = true;

/* ---- viewport fitting ---- */
const view = { w: 1, h: 1, s: 1, ox: 0, oy: 0, portrait: false, dpr: 1 };

function layout() {
  const w = innerWidth, h = innerHeight;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  const portrait = PORTRAIT;
  let s, ox, oy, dsc = 0;
  if (portrait) {
    // the whole tall design frame fits the screen at its own proportions, LED bar on the bottom edge
    const frameH = 1915 + 80 * LED_K / DS;
    dsc = Math.min(w / 1416, h / frameH);   // css px per design px
    s = dsc / DS;
    ox = w / 2 - 1005 * s;
    // centre the frame; any spare height splits above and below (the plinth's black face continues down)
    oy = h - BAR_BOTTOM * s - Math.max(0, h - frameH * dsc) / 2;
  } else {
    // the poster at its own proportions with a little breathing room around it
    s = Math.min(w / 2000, h / 1125) * .92;
    ox = (w - 2000 * s) / 2;
    oy = h - 1125 * s;
  }
  Object.assign(view, { w, h, s, ox, oy, portrait, dpr, dsc });

  const near = 1, far = 220;
  const pxL = -ox / s, pxR = (w - ox) / s, pyT = -oy / s, pyB = (h - oy) / s;
  camera.near = near; camera.far = far;
  camera.projectionMatrix.makePerspective(
    (pxL - CX) * near / F, (pxR - CX) * near / F,
    (HY - pyT) * near / F, (HY - pyB) * near / F, near, far);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  layoutTitle();
}

function project(v) {
  const d = camera.position.z - v.z;
  const k = F / d;
  return {
    x: view.ox + view.s * (CX + (v.x - camera.position.x) * k),
    y: view.oy + view.s * (HY + (camera.position.y - v.y) * k),
    k: view.s * k, // css px per world unit at this depth
  };
}
function unproject(sx, sy, z, out = new THREE.Vector3()) {
  const px = (sx - view.ox) / view.s, py = (sy - view.oy) / view.s;
  const d = camera.position.z - z;
  return out.set(camera.position.x + (px - CX) * d / F, camera.position.y - (py - HY) * d / F, z);
}
const groundDepth = py => F * CAM_H / (py - HY);
const ground = (px, py) => {
  const d = groundDepth(py);
  return new THREE.Vector3((px - CX) * d / F, 0, CAM_Z - d);
};
const atDepth = (px, py, d) =>
  new THREE.Vector3((px - CX) * d / F, CAM_H - (py - HY) * d / F, CAM_Z - d);

/* ---- plinth ---- */
function buildPlinth() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#f0f0f0'); grad.addColorStop(1, '#f5f5f5');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const top = new THREE.Mesh(new THREE.PlaneGeometry(PLINTH_W, PLINTH_D), new THREE.MeshBasicMaterial({ map: tex }));
  top.rotation.x = -Math.PI / 2;
  top.position.set(0, 0, -PLINTH_D / 2);
  scene.add(top);

  // on phones the plinth's face stops at the LED bar, so the object sits on the grey ground
  const faceH = PORTRAIT ? PLINTH_W * 160 / 3260 * LED_K : 60;
  const front = new THREE.Mesh(new THREE.PlaneGeometry(PLINTH_W, faceH), new THREE.MeshBasicMaterial({ color: 0x060606 }));
  front.position.set(0, -faceH / 2, 0);
  scene.add(front);
}

/* The plinth's front face is an LED board: the event line is drawn once as a
 * low-res bitmap, and a shader turns each texel into a round lamp while the
 * text steps sideways one column at a time, looping forever. */
const LED_ROWS = 26;                   // lamps from top to bottom of the bar
const LED_TEXT = 'NxPC.Live vol.80　　2026年12月5日　　@ソフトピアジャパンセンタービル ギャラリー2　　　';
const footerUniforms = {
  uText: { value: null }, uTextW: { value: 1 }, uScroll: { value: 0 },
  uCols: { value: 1 }, uRows: { value: LED_ROWS },
};

function ledBitmap() {
  const c = document.createElement('canvas');
  const g = c.getContext('2d', { willReadFrequently: true });
  const font = '16px "DotGothic16", monospace';
  g.font = font;
  const w = Math.ceil(g.measureText(LED_TEXT).width);
  c.width = w; c.height = LED_ROWS;
  g.font = font;
  g.textBaseline = 'top';
  g.fillStyle = '#fff';
  g.fillText(LED_TEXT, 0, 5);
  const src = g.getImageData(0, 0, w, LED_ROWS).data;
  const lit = new Uint8Array(w * LED_ROWS);
  for (let i = 0; i < lit.length; i++) lit[i] = src[i * 4 + 3] > 110 ? 255 : 0;
  const tex = new THREE.DataTexture(lit, w, LED_ROWS, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return { tex, w };
}

function buildFooter() {
  const H = PLINTH_W * 160 / 3260 * LED_K;    // the bar's height (taller on phones)
  footerUniforms.uCols.value = Math.round(LED_ROWS * PLINTH_W / H);
  const mat = new THREE.ShaderMaterial({
    uniforms: footerUniforms,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uText;
      uniform float uTextW, uScroll, uCols, uRows;
      const vec3 BOARD = vec3(.024, .022, .022);
      const vec3 OFF   = vec3(.085, .078, .076);
      const vec3 ON    = vec3(.949, .937, .902);
      void main() {
        vec2 g = vec2(vUv.x * uCols, (1. - vUv.y) * uRows);
        vec2 cell = floor(g);
        float col = mod(cell.x + floor(uScroll), uTextW);
        float on = texture2D(uText, vec2((col + .5) / uTextW, (cell.y + .5) / uRows)).r;
        float d = length(fract(g) - .5);
        float aa = fwidth(g.x) * .8;
        float lamp = 1. - smoothstep(.36 - aa, .36 + aa, d);
        vec3 c = mix(BOARD, mix(OFF, ON, on), lamp);
        c += on * ON * .16 * exp(-d * d * 9.) * (1. - lamp); // soft glow around lit lamps
        gl_FragColor = vec4(c, 1.);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(PLINTH_W, H), mat);
  mesh.position.set(0, -H / 2, 0.002);
  scene.add(mesh);

  const load = () => {
    const { tex, w } = ledBitmap();
    if (footerUniforms.uText.value) footerUniforms.uText.value.dispose();
    footerUniforms.uText.value = tex;
    footerUniforms.uTextW.value = w;
  };
  load();
  document.fonts.load('16px "DotGothic16"', 'NxPC年ソ').then(load).catch(() => {});
}

/* ---- sockets ---- */
const washerGeo = new THREE.CylinderGeometry(.31, .33, .1, 32);
const holeGeo = new THREE.CircleGeometry(.16, 24);
const greyMat = new THREE.MeshBasicMaterial({ color: 0xbdbdbd });
const greenMat = new THREE.MeshBasicMaterial({ color: 0xa5dc72 });
const holeGrey = new THREE.MeshBasicMaterial({ color: 0x6d6d6d });
const holeGreen = new THREE.MeshBasicMaterial({ color: 0xdff2c9 });
const glowMat = new THREE.MeshBasicMaterial({ color: 0xff7c2a, transparent: true, opacity: 0, depthWrite: false });
const glowGeo = new THREE.RingGeometry(.36, .5, 40);

const sockets = {};
function addSocket(id, px, py, kind = 'grey') {
  const p = ground(px, py);
  const s = { id, kind, x: p.x, z: p.z, occupied: false, pulse: 0, glow: 0 };
  sockets[id] = s;
  if (kind === 'root') return s; // worm bodies grow straight out of the board
  const g = new THREE.Group();
  g.position.set(p.x, 0, p.z);
  const w = new THREE.Mesh(washerGeo, kind === 'green' ? greenMat : greyMat);
  w.position.y = .05;
  const h = new THREE.Mesh(holeGeo, kind === 'green' ? holeGreen : holeGrey);
  h.rotation.x = -Math.PI / 2;
  h.position.y = .102;
  const glow = new THREE.Mesh(glowGeo, glowMat.clone());
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = .11;
  g.add(w, h, glow);
  g.scale.setScalar(PART_K);
  scene.add(g);
  s.group = g; s.glowMesh = glow;
  return s;
}
const socketTop = (s, out = new THREE.Vector3()) =>
  out.set(s.x, s.kind === 'root' ? 0 : PLUG_H, s.z);

// jacks visible in the poster
[['b1', 472, 885], ['o1', 527, 815], ['g1', 678, 915], ['g2', 727, 885], ['b2', 853, 890], ['b3', 860, 832],
 ['o2', 953, 950], ['g3', 1020, 865], ['g4', 1180, 855], ['b4', 1252, 890], ['g5', 1372, 870], ['o3', 1316, 950],
 ['o4', 1482, 890], ['b5', 1533, 890], ['b6', 1505, 845],
 // washers that carry extra cables
 ['w1', 452, 915], ['w2', 600, 918], ['w3', 793, 828], ['w4', 907, 885], ['w5', 640, 850], ['w6', 1290, 835], ['w7', 1395, 835],
 // free washers
 ['f1', 433, 945], ['f2', 1085, 885], ['f3', 1405, 915], ['f4', 1230, 950], ['f5', 560, 960], ['f6', 860, 960],
].forEach(a => addSocket(...a));
// the 2×3 green rings
[1087, 1136, 1185].forEach((x, i) => { addSocket('r' + i, x, 918, 'green'); addSocket('r' + (i + 3), x, 948, 'green'); });
// root points for the wide bodies
[['c', 750, 803], ['t', 592, 800], ['l', 1000, 785], ['q', 1110, 805], ['v', 1530, 812], ['m', 858, 785]]
  .forEach(([id, x, y]) => addSocket('root_' + id, x, y, 'root'));

/* ---- knobs ---- */
const knobBody = new THREE.CylinderGeometry(.16, .25, .74, 28);
const knobSkirt = new THREE.CylinderGeometry(.27, .275, .05, 28);
const knobMat = new THREE.MeshBasicMaterial({ color: 0x232325 });
const stripeGeo = new THREE.BoxGeometry(.03, .4, .012);
const capLineGeo = new THREE.BoxGeometry(.03, .008, .14);
const accent = { o: 0xff7c2a, b: 0x4faef0, g: 0xa8de75 };
const accentMats = Object.fromEntries(Object.entries(accent).map(([k, c]) => [k, new THREE.MeshBasicMaterial({ color: c })]));

const knobs = [];
function addKnob(px, py) {
  const p = ground(px, py);
  const g = new THREE.Group();
  g.position.set(p.x, 0, p.z);
  const body = new THREE.Mesh(knobBody, knobMat); body.position.y = .39;
  const skirt = new THREE.Mesh(knobSkirt, knobMat); skirt.position.y = .03;
  const col = accentMats['obg'[Math.floor(Math.random() * 3)]];
  const stripe = new THREE.Mesh(stripeGeo, col);
  stripe.position.set(0, .54, .2); stripe.rotation.x = .12;
  const cap = new THREE.Mesh(capLineGeo, col); cap.position.set(0, .762, .09);
  g.add(body, skirt, stripe, cap);
  const base = rand(-.45, .45);
  g.rotation.y = base * 2.4;
  g.scale.setScalar(PART_K);
  scene.add(g);
  knobs.push({ g, base, value: base, shown: base, x: p.x, z: p.z, cable: null });
}
[[508, 958], [765, 952], [1265, 955], [1370, 955], [1475, 955],
 [537, 905], [605, 900], [792, 882], [910, 870], [975, 866], [1025, 905], [1133, 868], [1345, 915], [1410, 870], [1452, 878],
 [536, 836], [625, 822], [670, 846], [795, 822], [1083, 836], [1245, 832], [1300, 842], [1325, 866], [1415, 822], [1432, 842],
].forEach(k => addKnob(...k));

/* flat LED dots on the plinth */
function addDots() {
  const geo = new THREE.CircleGeometry(.05, 16);
  const put = (px, py, key) => {
    const m = new THREE.Mesh(geo, accentMats[key]);
    const p = ground(px, py);
    m.rotation.x = -Math.PI / 2;
    m.position.set(p.x, .006, p.z);
    scene.add(m);
  };
  [[545, 948, 'o'], [551, 942, 'o'], [547, 957, 'o'], [632, 914, 'o'], [636, 906, 'o'], [627, 924, 'o'], [728, 914, 'o'], [733, 924, 'o'],
   [803, 942, 'g'], [806, 950, 'g'], [988, 918, 'g'], [988, 932, 'g'], [988, 946, 'g'], [1222, 888, 'g'], [1222, 900, 'g'], [1232, 912, 'g']]
    .forEach(a => put(...a));
}

/* ---- plugs ---- */
const plugGeo = new THREE.LatheGeometry([
  [.0, 0], [.11, 0], [.11, .22], [.26, .24], [.26, .33], [.19, .36], [.265, .42], [.275, .82], [.235, .92], [.17, .98], [.15, PLUG_BASE], [0, PLUG_BASE],
].map(([x, y]) => new THREE.Vector2(x, y)), 28);
plugGeo.computeVertexNormals();
const plugHoleGeo = new THREE.CircleGeometry(.05, 14);
const plugHoleMat = new THREE.MeshBasicMaterial({ color: 0x33414c });
const plugColors = { o: 0xfc8032, b: 0x4aa6f4, g: 0xb0e080, w: 0xe3e5e6 };
const plugMats = Object.fromEntries(Object.entries(plugColors).map(([k, c]) => [k, new THREE.MeshBasicMaterial({ color: c })]));
const grooveGeo = new THREE.BoxGeometry(.02, .24, .012);
const grooveMats = Object.fromEntries(Object.entries(plugColors).map(([k, c]) =>
  [k, new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(.72) })]));

function makePlug(colorKey) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(plugGeo, plugMats[colorKey]));
  const hole = new THREE.Mesh(plugHoleGeo, plugHoleMat);
  hole.position.set(0, .58, .276);
  for (const dx of [-.13, .13]) {
    const gr = new THREE.Mesh(grooveGeo, grooveMats[colorKey]);
    gr.position.set(dx, .62, .236);
    g.add(gr);
  }
  g.add(hole);
  g.scale.setScalar(.001);
  scene.add(g);
  return g;
}

/* ---- eyes ---- */
const eyeGeo = new THREE.CircleGeometry(1, 40);
const eyeWhite = new THREE.MeshBasicMaterial({ color: 0xffffff });
const eyeRim = new THREE.MeshBasicMaterial({ color: 0xd6d6d6 });
const eyePupil = new THREE.MeshBasicMaterial({ color: 0x222224 });

function makeEye(r) {
  const g = new THREE.Group();
  const rim = new THREE.Mesh(eyeGeo, eyeRim); rim.position.set(-.04 * r, -.1 * r, -.004); rim.scale.setScalar(1.02);
  const white = new THREE.Mesh(eyeGeo, eyeWhite);
  const pupil = new THREE.Mesh(eyeGeo, eyePupil); pupil.scale.setScalar(.47); pupil.position.z = .004;
  g.add(rim, white, pupil);
  const holder = new THREE.Group();
  holder.add(g);
  g.scale.setScalar(r);
  holder.scale.setScalar(.001);
  scene.add(holder);
  return {
    holder, pupil, r, scale: 0, vs: 0, look: new THREE.Vector2(), lookT: new THREE.Vector2(),
    nextBlink: rand(1, 6), blink: 0, nextSaccade: rand(0, 2), boost: 0,
  };
}

/* ---- ribbons ---- */
const RIBBON_VS = /* glsl */`
  attribute vec3 aData;
  varying vec3 vData;
  void main() {
    vData = aData;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
  }`;

const RIBBON_FS = /* glsl */`
  precision highp float;
  varying vec3 vData;
  uniform int uP0, uP1, uPN;
  uniform float uSplit, uT0, uR, uLo, uHi, uReveal, uRevealMode, uCapA, uCapB, uQEnd;

  // Colours sampled from the poster.
  const vec3 ORANGE    = vec3(.988, .502, .197);
  const vec3 BLUE      = vec3(.310, .665, .958);
  const vec3 BLUE_L    = vec3(.401, .718, .965);
  const vec3 GREEN     = vec3(.690, .880, .500);
  const vec3 GREEN_Y   = vec3(.800, .900, .560);
  const vec3 INK_GREEN = vec3(.640, .890, .410);
  const vec3 GREY      = vec3(.912, .905, .895);
  const vec3 PALE      = vec3(.895, .902, .908);
  const vec3 TEAL_LOW  = vec3(.434, .743, .883);
  const vec3 TEAL_TOP  = vec3(.470, .752, .760);
  const vec3 WAVE_BASE = vec3(.868, .888, .905);

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3. - 2. * f);
    return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y);
  }
  float capsule(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.);
    return length(pa - ba * h);
  }

  // Hand-drawn curls: scattered open arcs.
  float curls(float x, float y) {
    vec2 p = vec2(x, y), size = vec2(.46, .38);
    vec2 id = floor(p / size);
    float m = 0.;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 c = id + vec2(float(i), float(j));
      if (hash(c + 5.1) < .22) continue;
      vec2 ctr = (c + vec2(hash(c), hash(c + 11.3))) * size;
      float r = mix(.11, .24, hash(c + 2.7));
      vec2 q = p - ctr;
      float da = abs(mod(atan(q.y, q.x) - hash(c + 9.2) * 6.2832 + 3.1416, 6.2832) - 3.1416);
      float span = mix(.9, 2.3, hash(c + 4.4));
      m = max(m, smoothstep(.05, .028, abs(length(q) - r)) * smoothstep(span + .1, span - .1, da));
    }
    return m * smoothstep(.03, .1, y) * smoothstep(.97, .9, y);
  }

  vec3 pattern(int id, float x, float y, float t, float aa) {
    vec3 c = ORANGE;
    if (id == 1) c = BLUE;
    else if (id == 2) c = GREEN;
    else if (id == 3) { // grey bands, unevenly spaced
      float g = (x - 1.) / 4.1;
      float cell = floor(g), k = fract(g);
      float n = mod(cell, 4.);
      float len = mod(cell, 2.) < .5 ? .34 : .62;
      if (n >= 2.) c = mix(ORANGE, GREY, smoothstep(0., .02, k) * smoothstep(len, len - .02, k));
    }
    else if (id == 4) { // two-column checker
      float s = sin(6.2832 * x * .88) * sin(6.2832 * y);
      c = mix(vec3(.992), ORANGE, smoothstep(-aa * 5., aa * 5., s));
    }
    else if (id == 5) { // teal: ruled lines low down, dashes higher up
      c = mix(TEAL_LOW, TEAL_TOP, smoothstep(.35, .95, t));
      float low = smoothstep(.62, .42, t);
      float px = x * 1.05, row = floor(px + .1);
      float wobble = .05 * sin(y * 9. + row * 3.) + .04 * (y - .5);
      float d = abs(fract(px + wobble) - .5) / 1.05;
      c = mix(c, INK_GREEN, low * step(.1, hash(vec2(row, 3.))) * smoothstep(.04, .02, d));

      float r = floor(y * 2.8);
      float dx = x * 1.55 + r * .41;
      vec2 cell = vec2(floor(dx), r);
      vec2 f = vec2(fract(dx) / 1.55, fract(y * 2.8) / 2.8);
      vec2 ctr = vec2(.32, .18) + (vec2(hash(cell + 1.), hash(cell + 2.)) - .5) * vec2(.2, .1);
      float len = mix(.1, .2, hash(cell + 3.));
      float a = (hash(cell + 4.) - .5) * .7;
      vec2 dir = vec2(cos(a), sin(a)) * len;
      float keep = step(.22, hash(cell + 6.));
      c = mix(c, INK_GREEN, (1. - low) * keep * smoothstep(.058, .036, capsule(f, ctr - dir, ctr + dir)));
    }
    else if (id == 6) c = mix(ORANGE, vec3(.992, .735, .57), curls(x, y));
    else if (id == 7) { // blue tilde strokes across a pale body
      c = WAVE_BASE;
      float ph = x / .72 + .25 * sin(y * 6.2832 + .6);
      float d = abs(fract(ph) - .5) * .72;
      float span = smoothstep(.07, .11, y) * smoothstep(.93, .89, y);
      c = mix(c, vec3(.318, .69, .95), smoothstep(.094, .07, d) * span);
    }
    else if (id == 8) { // blue with four-point sparkles and small green dots
      c = mix(BLUE_L, BLUE, smoothstep(.2, .6, t));
      float cell = floor(x * .45);
      float h = hash(vec2(cell, 1.));
      vec2 q = vec2(x - (cell + .2 + .6 * h) / .45, y - (.25 + .5 * hash(vec2(cell, 2.))));
      if (hash(vec2(cell, 3.)) > .45) {
        vec2 a = pow(abs(q), vec2(.6));
        c = mix(c, vec3(.60, .85, .985), smoothstep(.31, .27, a.x + a.y));
      } else {
        c = mix(c, vec3(.56, .85, .64), smoothstep(.062, .042, length(q)));
      }
    }
    else if (id == 9) { // yellow-green with groups of fine orange ticks
      c = mix(GREEN, GREEN_Y, smoothstep(.35, .75, vnoise(vec2(x * .22, 3.))));
      float zone = step(10., x) * step(fract((x - 14.5) / 11.), .25);
      float g = x * 1.1 + (y - .5) * .15;
      float d = abs(fract(g) - .5) / 1.1;
      float use = step(.3, hash(vec2(floor(g), 8.)));
      float span = smoothstep(.1, .16, y) * smoothstep(.97, .9, y);
      c = mix(c, vec3(.97, .72, .38), zone * use * span * smoothstep(.05, .03, d));
    }
    else if (id == 10) { // pale with a line of green beads
      c = PALE;
      float px = (fract(x / 1.25) - .5) * 1.25;
      float d = length(vec2(px, y - .5 + .04 * sin(x * 1.3)));
      c = mix(c, vec3(.74, .90, .60), smoothstep(.105, .08, d) * smoothstep(.35, .5, t));
    }
    else if (id == 11) { // thin green with short ochre sections
      c = GREEN;
      float cell = floor(x / 9.);
      if (hash(vec2(cell, 5.)) > .4) {
        float k = fract(x / 9.) * 9.;
        float len = mix(.8, 1.7, hash(vec2(cell, 6.)));
        vec3 tone = hash(vec2(cell, 7.)) > .5 ? vec3(.96, .72, .35) : vec3(.74, .70, .40);
        c = mix(c, tone, smoothstep(3.8, 4.1, k) * smoothstep(4.2 + len, 3.9 + len, k));
      }
    }
    return c;
  }

  void main() {
    float q = vData.x, v = vData.y, t = vData.z;
    if (uRevealMode < .5) { if (t > uReveal) discard; }
    else if (min(t, 1. - t) * 2. > uReveal) discard;

    float y = v * .5 + .5;
    float aa = fwidth(q) + fwidth(y);
    vec3 c = t < uSplit ? pattern(uP0, q, y, t, aa) : pattern(uP1, q, y, t, aa);
    if (uR > 0. && t >= uLo && t <= uHi && abs(t - uT0) + .012 * sin(y * 9.) < uR) {
      c = pattern(uPN, q, y, t, aa);
    }
    c += (vnoise(vec2(q * .7, y * 1.5)) - .5) * .028; // faint painted mottling
    float e = fwidth(v) * 1.2;
    float alpha = 1. - smoothstep(1. - e, 1., abs(v));
    // round caps where a head ends (radius in width units, matching the narrowed end)
    float eq = fwidth(q);
    if (uCapA > 0. && q < uCapA) {
      float d = length(vec2(uCapA - q, v * uCapA));
      alpha *= 1. - smoothstep(uCapA - eq, uCapA, d);
    }
    if (uCapB > 0. && uQEnd - q < uCapB) {
      float d = length(vec2(uCapB - (uQEnd - q), v * uCapB));
      alpha *= 1. - smoothstep(uCapB - eq, uCapB, d);
    }
    if (alpha < .01) discard;
    gl_FragColor = vec4(c, alpha);
  }
  `;

function ribbonMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: RIBBON_VS, fragmentShader: RIBBON_FS,
    uniforms: {
      uP0: { value: 0 }, uP1: { value: 0 }, uPN: { value: 0 }, uSplit: { value: 2 },
      uT0: { value: 0 }, uR: { value: 0 }, uLo: { value: 0 }, uHi: { value: 1 },
      uReveal: { value: 0 }, uRevealMode: { value: 0 },
      uCapA: { value: 0 }, uCapB: { value: 0 }, uQEnd: { value: 1 },
    },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}

/* ---- cable definitions (traced from the poster) ---- */
const P = { ORANGE: 0, BLUE: 1, GREEN: 2, BANDS: 3, CHECK: 4, TEAL: 5, SQUIG: 6, WAVE: 7, SPARK: 8, TICKS: 9, PALE: 10, LOOP: 11 };
const PAT_COUNT = 12;

const DEFS = [
  { // long one: striped on the left, blue on the right, an eye in the middle
    a: 'o1', b: 'b6', w: 36, pats: [P.BANDS, P.SPARK], eyeAt: [393, 258], ca: 'o', cb: 'b',
    pts: [[527, 745], [478, 660], [400, 610], [295, 550], [226, 470], [240, 360], [310, 275], [393, 258], [470, 370], [580, 530],
      [720, 630], [880, 702], [1060, 715], [1190, 680], [1290, 540], [1400, 488], [1510, 500], [1590, 590], [1570, 700], [1505, 770]],
  },
  { a: 'root_c', w: 46, pats: [P.CHECK], pts: [[750, 803], [738, 640], [690, 500], [625, 390], [575, 265], [572, 205], [640, 145]], cb: 'o' },
  { a: 'root_t', w: 54, pats: [P.TEAL], pts: [[592, 800], [570, 680], [620, 560], [700, 440], [780, 360], [870, 310]], cb: 'b' },
  { a: 'root_l', w: 48, pats: [P.GREEN], pts: [[1000, 785], [1018, 620], [1045, 400], [1075, 160]], cb: 'g' },
  { a: 'root_q', w: 46, pats: [P.SQUIG], pts: [[1110, 805], [1170, 690], [1240, 480], [1320, 290], [1400, 215], [1472, 235]], cb: 'o' },
  { a: 'root_v', w: 48, pats: [P.WAVE], pts: [[1530, 812], [1610, 700], [1722, 590], [1732, 470], [1695, 380], [1635, 335]], cb: 'b' },
  { // pale-green line with a mid eye
    a: 'root_m', b: 'g5', w: 34, pats: [P.TICKS, P.GREEN], eyeAt: [1540, 378], cb: 'g',
    pts: [[858, 785], [880, 520], [925, 375], [1010, 385], [1130, 470], [1250, 492], [1390, 445], [1480, 368], [1540, 378], [1530, 480], [1470, 640], [1372, 795]],
  },
  { a: 'g1', b: 'g3', w: 20, pats: [P.ORANGE], ca: 'g', cb: 'g', pts: [[678, 835], [682, 660], [755, 545], [840, 505], [930, 535], [990, 640], [1020, 785]] },
  { a: 'o2', b: 'w2', w: 18, pats: [P.ORANGE], ca: 'o', cb: 'g', pts: [[953, 870], [990, 720], [985, 620], [905, 540], [800, 545], [700, 660], [640, 790], [600, 840]] },
  { a: 'o3', b: 'o4', w: 20, pats: [P.ORANGE], ca: 'o', cb: 'o', pts: [[1316, 870], [1322, 700], [1345, 595], [1400, 582], [1470, 630], [1505, 730], [1482, 810]] },
  { a: 'b2', b: 'b4', w: 28, pats: [P.SPARK], ca: 'b', cb: 'b', pts: [[853, 810], [865, 700], [935, 625], [1020, 612], [1120, 665], [1200, 715], [1252, 810]] },
  { a: 'b3', b: 'b1', w: 26, pats: [P.BLUE], ca: 'b', cb: 'b', pts: [[860, 755], [895, 620], [940, 480], [925, 395], [860, 365], [800, 372], [700, 470], [600, 560], [470, 600], [398, 640], [410, 720], [472, 805]] },
  { a: 'w4', b: 'w7', w: 30, pats: [P.PALE], ca: 'w', cb: 'w', pts: [[907, 810], [880, 650], [950, 535], [1015, 515], [1100, 570], [1190, 592], [1290, 572], [1360, 640], [1395, 760]] },
  { a: 'g2', b: 'w3', w: 16, pats: [P.LOOP], ca: 'g', cb: 'g', pts: [[727, 800], [705, 720], [640, 650], [480, 570], [400, 470], [412, 392], [475, 372], [570, 425], [670, 490], [770, 620], [793, 750]] },
  { a: 'w1', b: 'w5', w: 16, pats: [P.LOOP], ca: 'g', cb: 'g', pts: [[452, 850], [440, 700], [430, 575], [540, 610], [620, 680], [640, 775]] },
  { a: 'g4', b: 'w6', w: 20, pats: [P.GREEN], ca: 'g', cb: 'g', pts: [[1180, 780], [1190, 715], [1240, 680], [1285, 715], [1290, 765]] },
];

// Same cables and sockets, standing tall. Points are in the tall design frame's pixels.
const PORTRAIT_SHAPES = [
  { pts: [[327, 1690], [300, 1450], [300, 1250], [255, 1050], [180, 900], [125, 760], [110, 620], [140, 500], [200, 430], [283, 420], [345, 480], [380, 620], [420, 800], [470, 960], [560, 1080], [680, 1110], [800, 1060], [900, 950], [1030, 915], [1120, 1000], [1150, 1200], [1120, 1450], [1107, 1690]], eyeAt: [283, 420] },
  { pts: [[505, 1690], [530, 1450], [545, 1200], [550, 950], [530, 780], [490, 640], [450, 500], [440, 350], [470, 240], [522, 175]] },
  { pts: [[379, 1690], [395, 1450], [410, 1200], [440, 1000], [490, 820], [560, 680], [620, 570], [675, 525]] },
  { pts: [[704, 1690], [740, 1450], [760, 1150], [770, 850], [775, 550], [778, 318]] },
  { pts: [[792, 1690], [830, 1450], [870, 1200], [905, 950], [930, 700], [960, 520], [1020, 420], [1100, 400]] },
  { pts: [[1127, 1690], [1135, 1450], [1170, 1250], [1260, 1100], [1300, 920], [1270, 740], [1220, 650], [1155, 615]] },
  { pts: [[591, 1690], [610, 1400], [620, 1100], [650, 850], [713, 708], [770, 760], [840, 850], [920, 860], [1000, 780], [1060, 710], [1110, 720], [1130, 850], [1110, 1100], [1050, 1400], [1001, 1690]], eyeAt: [713, 708] },
  { pts: [[447, 1690], [430, 1520], [455, 1330], [500, 1140], [560, 1010], [640, 960], [710, 1000], [750, 1120], [745, 1300], [715, 1500], [720, 1690]] },
  { pts: [[667, 1690], [700, 1520], [700, 1330], [650, 1130], [560, 980], [450, 930], [360, 960], [300, 1060], [290, 1220], [330, 1420], [385, 1690]] },
  { pts: [[956, 1690], [935, 1530], [945, 1380], [985, 1260], [1040, 1215], [1095, 1250], [1120, 1370], [1100, 1530], [1088, 1690]] },
  { pts: [[587, 1690], [575, 1520], [600, 1330], [660, 1180], [740, 1110], [830, 1120], [890, 1210], [915, 1380], [895, 1550], [905, 1690]] },
  { pts: [[592, 1690], [620, 1480], [640, 1250], [655, 1020], [640, 820], [590, 750], [510, 800], [420, 940], [320, 1020], [245, 1130], [215, 1320], [245, 1520], [283, 1690]] },
  { pts: [[630, 1690], [650, 1480], [690, 1260], [760, 1060], [850, 960], [940, 980], [1000, 1110], [1030, 1320], [1010, 1520], [1019, 1690]] },
  { pts: [[486, 1690], [470, 1450], [420, 1200], [330, 1000], [260, 820], [290, 690], [390, 680], [470, 770], [520, 930], [560, 1150], [570, 1420], [539, 1690]] },
  { pts: [[267, 1690], [280, 1580], [320, 1490], [380, 1460], [430, 1500], [440, 1600], [417, 1690]] },
  { pts: [[848, 1690], [845, 1610], [870, 1560], [915, 1555], [945, 1600], [935, 1690]] },
];

/* ---- cable ---- */
const _v = new THREE.Vector3(), _t = new THREE.Vector3(), _s = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();

function catmull(p0, p1, p2, p3, t, out) {
  const t2 = t * t, t3 = t2 * t;
  return out.set(
    .5 * (2 * p1.x + (p2.x - p0.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (3 * p1.x - p0.x - 3 * p2.x + p3.x) * t3),
    .5 * (2 * p1.y + (p2.y - p0.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (3 * p1.y - p0.y - 3 * p2.y + p3.y) * t3),
    .5 * (2 * p1.z + (p2.z - p0.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (3 * p1.z - p0.z - 3 * p2.z + p3.z) * t3),
  );
}

class End {
  constructor(cable, socket, colorKey, startPos) {
    this.cable = cable;
    this.socket = socket; // null when free
    this.home = startPos.clone();
    this.pos = startPos.clone();
    this.vel = new THREE.Vector3();
    this.form = socket ? 'plug' : 'head';
    this.bare = !!socket && socket.kind === 'root';
    this.grabbed = false;
    this.target = new THREE.Vector3();
    this.candidate = null;
    this.prevSocket = null;
    this.plugScale = 0;
    this.plugVel = 0;
    this.colorKey = colorKey || 'o';
    this.plug = this.bare ? null : makePlug(this.colorKey);
    this.eye = null;
    this.shadow = null;
  }
}

class Cable {
  constructor(def, index) {
    this.def = def;
    this.index = index;
    const sa = sockets[def.a], sb = def.b ? sockets[def.b] : null;
    const A0 = socketTop(sa, new THREE.Vector3());
    const dA = CAM_Z - A0.z;
    const dB = sb ? CAM_Z - sb.z : dA + (index % 2 ? .6 : -.6);
    const tall = PORTRAIT ? PORTRAIT_SHAPES[index] : null;
    const src = tall ? tall.pts.map(fromDesign) : def.pts;
    const eyeAt = tall ? (tall.eyeAt && fromDesign(tall.eyeAt)) : def.eyeAt;
    const last = src.length - 1;
    const pts = src.map((p, i) => atDepth(p[0], p[1], lerp(dA, dB, i / last)));
    pts[0].copy(A0);
    if (sb) socketTop(sb, pts[last]);
    const B0 = pts[last].clone();

    // dense curve, leaving plugs vertically
    const up = new THREE.Vector3(0, .7, 0);
    const startGhost = A0.clone().sub(up);
    const endGhost = sb ? B0.clone().sub(up) : B0.clone().multiplyScalar(2).sub(pts[last - 1]);
    const ctrl = [startGhost, ...pts, endGhost];
    const dense = [], cum = [0];
    for (let i = 1; i < ctrl.length - 2; i++) {
      for (let k = 0; k < 28; k++) dense.push(catmull(ctrl[i - 1], ctrl[i], ctrl[i + 1], ctrl[i + 2], k / 28, new THREE.Vector3()));
    }
    dense.push(B0.clone());
    for (let i = 1; i < dense.length; i++) cum[i] = cum[i - 1] + dense[i].distanceTo(dense[i - 1]);
    const L = cum[cum.length - 1];
    const n = this.n = clamp(Math.round(L / .22), 26, 150);
    this.len = L; this.seg = L / (n - 1);

    const sample = new Array(n);
    for (let i = 0, j = 0; i < n; i++) {
      const target = L * i / (n - 1);
      while (j < cum.length - 2 && cum[j + 1] < target) j++;
      const t = (target - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
      sample[i] = dense[j].clone().lerp(dense[j + 1], t);
    }
    this.U = new Float32Array(n);
    this.W = new Float32Array(n);
    this.Q = new Float32Array(n);
    this.pos = new Float32Array(3 * n);
    this.vel = new Float32Array(3 * n);
    this.rest = new Float32Array(3 * n);
    this.shape = new Float32Array(3 * n);
    this.shapeT = new Float32Array(3 * n);
    this.initShape = new Float32Array(3 * n);

    let q = 0;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      this.U[i] = u;
      const d = CAM_Z - sample[i].z;
      this.W[i] = def.w * WIDTH_K * d / F;
      this.pos.set([sample[i].x, sample[i].y, sample[i].z], i * 3);
      _v.copy(A0).lerp(B0, u);
      this.shape.set([sample[i].x - _v.x, sample[i].y - _v.y, sample[i].z - _v.z], i * 3);
      this.Q[i] = q;
      q += this.seg / this.W[i];
    }
    this.shapeT.set(this.shape);
    this.initShape.set(this.shape);
    this.L0 = this.initL0 = A0.distanceTo(B0);

    // mesh
    const geo = new THREE.BufferGeometry();
    this.vtx = new Float32Array(n * 6);
    this.data = new Float32Array(n * 6);
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.BufferAttribute(this.vtx, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aData', new THREE.BufferAttribute(this.data, 3));
    for (let i = 0; i < n; i++) {
      this.data.set([this.Q[i], -1, this.U[i], this.Q[i], 1, this.U[i]], i * 6);
    }
    this.mat = ribbonMaterial();
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mat.uniforms.uQEnd.value = this.Q[n - 1];
    scene.add(this.mesh);

    // pattern state
    this.pats = def.pats.length > 1 ? [...def.pats] : [def.pats[0], def.pats[0]];
    this.initPats = [...this.pats];
    this.wipe = null;

    // ends
    this.a = new End(this, sa, def.ca, A0);
    this.b = new End(this, sb, def.cb, B0);
    sa.occupied = true;
    if (sb) sb.occupied = true;
    this.eyeR = 24 * (PORTRAIT ? 1.26 : .84) * (CAM_Z - B0.z) / F;

    // eye on the body
    this.midIdx = -1;
    if (eyeAt) {
      let best = 1e9, target = atDepth(eyeAt[0], eyeAt[1], lerp(dA, dB, .5));
      for (let i = 0; i < n; i++) {
        const dx = sample[i].x - target.x, dy = sample[i].y - target.y;
        const dd = dx * dx + dy * dy;
        if (dd < best) { best = dd; this.midIdx = i; }
      }
      this.pats = [...def.pats];
      this.initPats = [...def.pats];
      this.split = this.U[this.midIdx];
      this.mat.uniforms.uSplit.value = this.split;
      this.midEye = makeEye(this.eyeR);
    } else {
      this.split = 2;
    }
    if (!sb) this.b.eye = makeEye(this.eyeR);

    this.grab = null;   // { i, delta } while the body is being pulled
    this.curl = 0; this.curlOn = false; this.curlG = 0; this.curlC = new THREE.Vector3(); this.curlCap = 1; this.curlDir = 1;
    this.curlW = new Float32Array(n);
    this.wig = 0;
    this.hot = 0; this.hotT = 0;
    this.phase = rand(0, 6.28);
    this.rate = rand(.8, 1.25);
    this.idle = 0; this.idleT = 0;
    // free-standing bodies swing wide, cables held at both ends move less
    this.idleAmp = (def.b ? (def.eyeAt ? .24 : .3) : .62) * (reduced ? .25 : 1);
    this.nx = new Float32Array(n); this.ny = new Float32Array(n);
    this.reveal = reduced ? 1 : 0;
    this.delay = index * .05;
    this.mat.uniforms.uRevealMode.value = sb ? 1 : 0;
    this.applyPats();
  }

  applyPats() {
    this.mat.uniforms.uP0.value = this.pats[0];
    this.mat.uniforms.uP1.value = this.pats[1];
  }

  /** Paint a new pattern, spreading outward from where it was touched. */
  repaint(u, pat) {
    const side = u < this.split ? 0 : 1;
    if (pat === undefined) {
      do { pat = Math.floor(Math.random() * PAT_COUNT); } while (pat === this.pats[side]);
    }
    if (this.wipe) this.finishWipe();
    const lo = side === 0 ? 0 : this.split, hi = side === 0 ? Math.min(1, this.split) : 1;
    this.wipe = { side, pat, t: 0, max: Math.max(u - lo, hi - u) + .03 };
    const un = this.mat.uniforms;
    un.uPN.value = pat; un.uT0.value = u; un.uLo.value = lo; un.uHi.value = hi; un.uR.value = .001;
  }
  finishWipe() {
    this.pats[this.wipe.side] = this.wipe.pat;
    this.wipe = null;
    this.mat.uniforms.uR.value = 0;
    this.applyPats();
  }

  kick(u, strength) {
    for (let i = 1; i < this.n - 1; i++) {
      const g = Math.exp(-Math.pow((this.U[i] - u) * this.len / 2.4, 2));
      this.vel[i * 3] += g * strength * Math.sin(i * .5 + this.phase);
      this.vel[i * 3 + 1] += g * strength * .7;
    }
  }

  regen() {
    const { a, b, n } = this;
    const pa = a.socket ? socketTop(a.socket, new THREE.Vector3()) : a.home.clone();
    const pb = b.socket ? socketTop(b.socket, new THREE.Vector3()) : b.home.clone();
    const dist = pa.distanceTo(pb);
    this.L0 = Math.max(.5, dist);
    const c1 = new THREE.Vector3(), c2 = new THREE.Vector3();
    if (a.socket && b.socket) {
      const h = clamp(dist * .8, 1.3, 5.6) + rand(0, 1.1);
      c1.copy(pa); c1.y += h; c2.copy(pb); c2.y += h;
      const skew = rand(-.8, .8);
      c1.x += skew; c2.x += skew;
    } else {
      const rootA = !!a.socket;
      const r = rootA ? pa : pb, h = rootA ? pb : pa;
      const look = h.x >= r.x ? 1 : -1;
      const c = rootA ? c1 : c2, e = rootA ? c2 : c1;
      c.copy(r); c.y += r.distanceTo(h) * .55; c.x -= look * 1.2;
      e.copy(h); e.x -= look * 2.2; e.y -= .5;
    }
    for (let i = 0; i < n; i++) {
      const u = this.U[i], w = 1 - u;
      const b0 = w * w * w, b1 = 3 * w * w * u, b2 = 3 * w * u * u, b3 = u * u * u;
      this.shapeT[i * 3] = b0 * pa.x + b1 * c1.x + b2 * c2.x + b3 * pb.x - lerp(pa.x, pb.x, u);
      this.shapeT[i * 3 + 1] = b0 * pa.y + b1 * c1.y + b2 * c2.y + b3 * pb.y - lerp(pa.y, pb.y, u);
      this.shapeT[i * 3 + 2] = b0 * pa.z + b1 * c1.z + b2 * c2.z + b3 * pb.z - lerp(pa.z, pb.z, u);
    }
  }

  stepEnd(e, dt, T, other) {
    if (e.grabbed) {
      e.pos.lerp(e.target, 1 - Math.exp(-dt * 28));
      e.vel.set(0, 0, 0);
    } else {
      if (e.socket) socketTop(e.socket, _v);
      else {
        _v.copy(e.home);
        const amp = (reduced ? .03 : .05) + this.idle * (reduced ? .1 : .55);
        _v.x += amp * Math.sin(T * .62 * this.rate + this.phase);
        _v.y += amp * .55 * Math.sin(T * .47 * this.rate + this.phase * 2.1);
      }
      const k = e.socket ? 320 : 70, c = e.socket ? 20 : 5.2;
      e.vel.x += (k * (_v.x - e.pos.x) - c * e.vel.x) * dt;
      e.vel.y += (k * (_v.y - e.pos.y) - c * e.vel.y) * dt;
      e.vel.z += (k * (_v.z - e.pos.z) - c * e.vel.z) * dt;
      e.pos.addScaledVector(e.vel, dt);
    }
  }

  computeRest(dt, T) {
    const { n, U, rest, shape, shapeT, a, b } = this;
    const ease = 1 - Math.exp(-dt * 3.4);
    const dist = a.pos.distanceTo(b.pos);
    const sc = clamp(dist / this.L0, .72, 1.3);
    const amp = .02 + this.idle * this.idleAmp + this.wig * .85;
    this.wavePhase = (this.wavePhase || 0) + dt * this.rate * (.85 + this.wig * 3.4);
    const ph = this.wavePhase;
    for (let i = 0; i < n; i++) {
      const u = U[i], j = i * 3;
      for (let c = 0; c < 3; c++) shape[j + c] += (shapeT[j + c] - shape[j + c]) * ease;
      rest[j] = lerp(a.pos.x, b.pos.x, u) + shape[j] * sc;
      rest[j + 1] = lerp(a.pos.y, b.pos.y, u) + shape[j + 1] * sc;
      rest[j + 2] = lerp(a.pos.z, b.pos.z, u) + shape[j + 2] * sc;
    }
    // A slow wave travels along the body, sideways to the cable's own direction.
    for (let i = 0; i < n; i++) {
      const p = Math.max(0, i - 1) * 3, q = Math.min(n - 1, i + 1) * 3;
      const tx = rest[q] - rest[p], ty = rest[q + 1] - rest[p + 1];
      const m = Math.max(1e-5, Math.hypot(tx, ty));
      this.nx[i] = -ty / m; this.ny[i] = tx / m;
    }
    for (let i = 0; i < n; i++) {
      const u = U[i], j = i * 3, s = u * this.len;
      const env = Math.pow(Math.sin(Math.PI * u), .7);
      const w = amp * env * (Math.sin(ph - s * .84 + this.phase) + .35 * Math.sin(ph * .61 - s * .47 + this.phase * 2.3));
      rest[j] += this.nx[i] * w;
      rest[j + 1] += this.ny[i] * w;
    }
    if (this.grab) {
      const g = this.grab.i, j = g * 3;
      const dx = this.grab.target.x - rest[j], dy = this.grab.target.y - rest[j + 1], dz = this.grab.target.z - rest[j + 2];
      const sig = Math.min(.42, 5.2 / this.len);
      const ug = U[g];
      for (let i = 1; i < n - 1; i++) {
        const f = Math.exp(-Math.pow((U[i] - ug) / sig, 2));
        rest[i * 3] += dx * f; rest[i * 3 + 1] += dy * f; rest[i * 3 + 2] += dz * f;
      }
    }
    if (this.curl > .002) this.applyCurl();
    this.straightenRoots(rest, false);
  }

  /** Where an end sits in a plug or the board, the cable leaves it straight up:
   *  pinned for the first stretch, then easing into its own curve. */
  straightenRoots(arr, hard) {
    const { n, seg, vel } = this;
    const hold = hard ? .14 : (PORTRAIT ? .75 : 1.5);   // tall layout: let the legs bend sooner
    for (const [e, first, step] of [[this.a, 0, 1], [this.b, n - 1, -1]]) {
      if (!e.socket) continue;
      for (let k = 1; k * seg <= hold && k < n / 3; k++) {
        const s = k * seg, j = (first + step * k) * 3;
        // stays straight just above the plug, then eases into the curve over a long, soft blend
        const w = hard ? 1 : Math.pow(1 - sstep(.1, hold, s), 1.6);
        arr[j] = lerp(arr[j], e.pos.x, w);
        arr[j + 1] = lerp(arr[j + 1], e.pos.y + s, w);
        arr[j + 2] = lerp(arr[j + 2], e.pos.z, w);
        if (hard) vel[j] = vel[j + 1] = vel[j + 2] = 0;
      }
    }
  }

  applyCurl() {
    const { n, rest, seg, W } = this;
    const g = this.curlG;
    const double = g > 2 && g < n - 3;
    const avg = (W[g] + W[clamp(g + (g < n / 2 ? 18 : -18), 0, n - 1)]) * .5;
    const spacing = (double ? 2.7 : 1.5) * Math.max(avg, .2);
    const b = spacing / 6.2832;
    const Lq = Math.max(.01, this.curl * this.curlCap);
    const span = Math.ceil(Lq / seg);
    const c = this.curlC;
    this.curlW.fill(0);
    for (let i = Math.max(1, g - span); i <= Math.min(n - 2, g + span); i++) {
      const s = Math.abs(i - g) * seg;
      if (s > Lq) continue;
      const th = Math.sqrt(2 * s / b);
      const ang = th * this.curlDir + (i < g ? Math.PI : 0) + this.phase;
      const r = b * th;
      const w = 1 - sstep(.66 * Lq, Lq, s);
      this.curlW[i] = w;
      const j = i * 3;
      rest[j] = lerp(rest[j], c.x + Math.cos(ang) * r, w);
      rest[j + 1] = lerp(rest[j + 1], c.y + Math.sin(ang) * r, w);
      rest[j + 2] = lerp(rest[j + 2], c.z, w);
    }
  }

  step(dt, T) {
    this.stepEnd(this.a, dt, T);
    this.stepEnd(this.b, dt, T);
    this.computeRest(dt, T);
    const { n, pos, vel, rest, U, W } = this;
    const SUB = 3, h = dt / SUB;
    const K = 42, C = 2300, D = 4.6;
    if (!this.curlOn) this.curlW.fill(0);
    for (let s = 0; s < SUB; s++) {
      for (let i = 1; i < n - 1; i++) {
        const j = i * 3;
        const cw = this.curlW[i];
        const Ki = lerp(K, 620, cw), Ci = lerp(C, 120, cw), Di = lerp(D, 26, cw);
        for (let c = 0; c < 3; c++) {
          const acc = Ki * (rest[j + c] - pos[j + c]) + Ci * (pos[j - 3 + c] + pos[j + 3 + c] - 2 * pos[j + c]) * .5 - Di * vel[j + c];
          vel[j + c] += acc * h;
        }
      }
      for (let i = 1; i < n - 1; i++) {
        const j = i * 3;
        pos[j] += vel[j] * h; pos[j + 1] += vel[j + 1] * h; pos[j + 2] += vel[j + 2] * h;
        if (U[i] > .05 && U[i] < .95 && pos[j + 1] < W[i] * .55) { pos[j + 1] = W[i] * .55; vel[j + 1] *= -.3; }
      }
      pos[0] = this.a.pos.x; pos[1] = this.a.pos.y; pos[2] = this.a.pos.z;
      const l = (n - 1) * 3;
      pos[l] = this.b.pos.x; pos[l + 1] = this.b.pos.y; pos[l + 2] = this.b.pos.z;
      this.straightenRoots(pos, true);
      if (this.grab) {
        const j = this.grab.i * 3;
        pos[j] = lerp(pos[j], this.grab.target.x, .5);
        pos[j + 1] = lerp(pos[j + 1], this.grab.target.y, .5);
        pos[j + 2] = lerp(pos[j + 2], this.grab.target.z, .5);
      }
    }
    if (this.wipe) {
      this.wipe.t += dt;
      const r = Math.pow(clamp(this.wipe.t / .5, 0, 1), .8) * this.wipe.max;
      this.mat.uniforms.uR.value = r;
      if (this.wipe.t >= .5) this.finishWipe();
    }
    this.curl += this.curlOn ? (1 - this.curl) * (1 - Math.exp(-dt * 2.8)) : -this.curl * (1 - Math.exp(-dt * 9));
    this.hot += (this.hotT - this.hot) * (1 - Math.exp(-dt * 12));
  }

  writeMesh() {
    const { n, pos, vtx } = this;
    const capA = this.mat.uniforms.uCapA, capB = this.mat.uniforms.uCapB;
    capA.value = 0; capB.value = 0;
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    let sx = 1, sy = 0, sz = 0;
    let current = 0;
    for (let i = 0; i < n - 1; i++) {
      const j = i * 3;
      current += Math.hypot(pos[j + 3] - pos[j], pos[j + 4] - pos[j + 1], pos[j + 5] - pos[j + 2]);
    }
    const thin = clamp(1 / Math.sqrt(Math.max(current / this.len, .4)), .55, 1.06);
    this.thinS = this.thinS === undefined ? thin : lerp(this.thinS, thin, .18);
    const halfPx = this.def.w * WIDTH_K * .5 * this.thinS * (1 + this.hot * .1);
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      const p = Math.max(0, i - 1) * 3, q = Math.min(n - 1, i + 1) * 3;
      const tx = pos[q] - pos[p], ty = pos[q + 1] - pos[p + 1], tz = pos[q + 2] - pos[p + 2];
      const vx = cx - pos[j], vy = cy - pos[j + 1], vz = cz - pos[j + 2];
      let ax = ty * vz - tz * vy, ay = tz * vx - tx * vz, az = tx * vy - ty * vx;
      const m = Math.hypot(ax, ay, az);
      if (m > 1e-5) { sx = ax / m; sy = ay / m; sz = az / m; }
      const hw = halfPx * (cz - pos[j + 2]) / F;
      const end = i === 0 ? this.a : i === n - 1 ? this.b : null;
      const sink = end && end.socket ? (end.bare ? .45 : .28) : 0;
      // a short moulded boot: the cable's width blends into the plug's neck
      let boot = 1;
      for (const [e, s] of [[this.a, i * this.seg], [this.b, (n - 1 - i) * this.seg]]) {
        if (!e.socket || e.bare || s > .55) continue;
        const neck = .16 * PART_K / Math.max(hw, 1e-4);
        boot = Math.min(boot === 1 ? 9 : boot, lerp(neck, 1, sstep(0, .55, s)));
      }
      // a free head narrows into its eye
      for (const [e, s] of [[this.a, i * this.seg], [this.b, (n - 1 - i) * this.seg]]) {
        if (e.form !== 'head' || s > .7) continue;
        const into = Math.min(1, this.eyeR * .94 / Math.max(hw, 1e-4)); // just inside the eye's width
        boot = Math.min(boot, lerp(into, 1, sstep(0, .7, s)));
        if (s === 0) (e === this.a ? capA : capB).value = into * .5;
      }
      const hwb = hw * boot;
      vtx[i * 6] = pos[j] - sx * hwb; vtx[i * 6 + 1] = pos[j + 1] - sy * hwb - sink; vtx[i * 6 + 2] = pos[j + 2] - sz * hwb;
      vtx[i * 6 + 3] = pos[j] + sx * hwb; vtx[i * 6 + 4] = pos[j + 1] + sy * hwb - sink; vtx[i * 6 + 5] = pos[j + 2] + sz * hwb;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }

  avgDepth() {
    let z = 0;
    for (let i = 0; i < this.n; i += 4) z += this.pos[i * 3 + 2];
    return z / Math.ceil(this.n / 4);
  }
}

/* ---- title ---- */
const SDF_CROP = { x: 90, y: 100, w: 1850, h: 380 };
const WORDS = [{ x0: 20, x1: 889 }, { x0: 889, x1: 1830 }]; // in crop pixels
const titleUniforms = {
  uSdf: { value: null }, uFront: { value: null },
  uDest0: { value: new THREE.Vector3() }, uDest1: { value: new THREE.Vector3() },
  uRes: { value: new THREE.Vector2(1, 1) }, uDpr: { value: 1 },
  uG: { value: new THREE.Vector2() }, uD: { value: new THREE.Vector2() }, uFat: { value: 0 }, uSig: { value: 200 },
  uTime: { value: 0 }, uGrow: { value: reduced ? 1 : 0 },
};
const titleScene = new THREE.Scene();
const titleCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
// The title is drawn twice: whole behind the cables, then ま・め・っ・る again on top of them.
const titleFrontScene = new THREE.Scene();
const titleMaterial = front => new THREE.ShaderMaterial({
  uniforms: titleUniforms, depthTest: false, depthWrite: false, transparent: front,
  defines: front ? { FRONT: 1 } : {},
  vertexShader: `void main(){ gl_Position = vec4(position.xy, 0., 1.); }`,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D uSdf, uFront;
    uniform vec3 uDest0, uDest1;
    uniform vec2 uRes, uG, uD;
    uniform float uDpr, uFat, uSig, uTime, uGrow;
    const vec2 CROP = vec2(1850., 380.);

    float word(vec2 p, vec3 dest, float x0, float x1) {
      vec2 c = (p - dest.xy) / dest.z;
      // Outside the stored frame, keep counting distance from its edge so a
      // swollen or stretched glyph never meets a hard cut.
      vec2 cc = clamp(c, vec2(x0, 0.), vec2(x1, CROP.y));
      float v = texture2D(uSdf, vec2(cc.x, CROP.y - cc.y) / CROP).r;
      return v - length(c - cc) * .5 / 40.;
    }
    // 1 where a pixel belongs to a letter that sits in front of the cables
    float front(vec2 p, vec3 dest, float x0, float x1) {
      vec2 c = (p - dest.xy) / dest.z;
      // outside this word's frame nothing is in front (the other line of a two-line logo
      // must not borrow this one's edge pixels)
      if (c.x < x0 || c.x > x1 || c.y < 0. || c.y > CROP.y) return 0.;
      return texture2D(uFront, vec2(c.x, CROP.y - c.y) / CROP).r;
    }
    void main() {
      vec2 p = vec2(gl_FragCoord.x, uRes.y * uDpr - gl_FragCoord.y) / uDpr;
      vec2 delta = p - uG;
      float f = exp(-dot(delta, delta) / (uSig * uSig));
      p -= uD * f;
      p += 1.3 * vec2(sin(p.y * .017 + uTime * .9), cos(p.x * .013 + uTime * .7));
      float d = max(word(p, uDest0, 20., 889.), word(p, uDest1, 889., 1830.));
      d += uFat * exp(-dot(delta, delta) / (uSig * uSig * 1.2));
      d -= (1. - uGrow) * .5;
      float w = max(fwidth(d) * .8, .002);
      float ink = smoothstep(.5 - w, .5 + w, d);
    #ifdef FRONT
      float sel = max(front(p, uDest0, 20., 889.), front(p, uDest1, 889., 1830.));
      float a = ink * sel;
      if (a < .003) discard;
      gl_FragColor = vec4(vec3(.015), a);
    #else
      gl_FragColor = vec4(mix(vec3(.796), vec3(.015), ink), 1.);
    #endif
    }`,
});
titleScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), titleMaterial(false)));
titleFrontScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), titleMaterial(true)));

const titleLayout = { d0: { x: 0, y: 0, s: 1 }, d1: { x: 0, y: 0, s: 1 } };
function layoutTitle() {
  const { s, ox, oy, portrait, w } = view;
  let d0, d1;
  if (portrait) {
    // design frame → screen
    const X = x => w / 2 + (x - 708) * view.dsc;
    const Y = y => oy + s * (1045 + (y - 1915) * DS);
    const ws = view.dsc * 1.1;               // letter size as in the tall design
    // crop ink: まるめる starts at x 34, ひっぱる at x 925, both at y≈25
    d0 = { x: X(270) - 34 * ws, y: Y(295) - 25 * ws, s: ws };
    d1 = { x: X(190) - 925 * ws, y: Y(725) - 25 * ws, s: ws };
  } else {
    // ink centre in the crop is (924, 193); shrink the logo about it
    const ts = s * .88;
    d0 = { x: ox + s * (SDF_CROP.x + 924) - 924 * ts, y: oy + s * (SDF_CROP.y + 193) - 193 * ts, s: ts };
    d1 = { ...d0 };
  }
  titleLayout.d0 = d0; titleLayout.d1 = d1;
  titleUniforms.uDest0.value.set(d0.x, d0.y, d0.s);
  titleUniforms.uDest1.value.set(d1.x, d1.y, d1.s);
  titleUniforms.uRes.value.set(view.w, view.h);
  titleUniforms.uDpr.value = view.dpr;
  titleUniforms.uSig.value = 150 * Math.max(.45, s * 1.6);
}

const sdfCpu = { data: null, w: 0, h: 0 };
const frontCpu = { data: null };
function titleHit(x, y, frontOnly = false) {
  if (!sdfCpu.data) return false;
  const test = (d, x0, x1) => {
    const cx = (x - d.x) / d.s, cy = (y - d.y) / d.s;
    if (cx < x0 || cx >= x1 || cy < 0 || cy >= SDF_CROP.h) return false;
    const k = (Math.floor(cy) * sdfCpu.w + Math.floor(cx)) * 4;
    if (frontOnly && !(frontCpu.data && frontCpu.data[k] > 127)) return false;
    return sdfCpu.data[k] > 120;
  };
  return test(titleLayout.d0, WORDS[0].x0, WORDS[0].x1) || test(titleLayout.d1, WORDS[1].x0, WORDS[1].x1);
}
new THREE.TextureLoader().load('assets/title-sdf.png', tex => {
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  titleUniforms.uSdf.value = tex;
  const c = document.createElement('canvas');
  c.width = tex.image.width; c.height = tex.image.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(tex.image, 0, 0);
  sdfCpu.w = c.width; sdfCpu.h = c.height;
  sdfCpu.data = g.getImageData(0, 0, c.width, c.height).data;
});
new THREE.TextureLoader().load('assets/title-front.png', tex => {
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  titleUniforms.uFront.value = tex;
  const c = document.createElement('canvas');
  c.width = tex.image.width; c.height = tex.image.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(tex.image, 0, 0);
  frontCpu.data = g.getImageData(0, 0, c.width, c.height).data;
});
const titleState = { active: false, g: new THREE.Vector2(), dT: new THREE.Vector2(), d: new THREE.Vector2(), v: new THREE.Vector2(), fat: 0, fatT: 0 };

/* ---- build ---- */
buildPlinth();
buildFooter();
addDots();
const cables = DEFS.map((d, i) => new Cable(d, i));
for (const k of knobs) {
  let best = 1e9;
  for (const c of cables) for (const e of [c.a, c.b]) {
    if (!e.socket) continue;
    const dd = (e.socket.x - k.x) ** 2 + (e.socket.z - k.z) ** 2;
    if (dd < best) { best = dd; k.cable = c; }
  }
}
function sortRibbons() {
  // the pale cable always sits behind the others, as in the poster
  const key = c => c.avgDepth() - (c.def.pats[0] === P.PALE ? 100 : 0);
  [...cables].sort((a, b) => key(a) - key(b)).forEach((c, i) => { c.mesh.renderOrder = i; });
}
sortRibbons();
setInterval(sortRibbons, 600);

/* ---- interaction ---- */
const pointer = { x: -999, y: -999, down: false, inside: false, last: performance.now() };
let action = null;
const DRAG_START = 7;
const HOLD_MS = 240;

function endHitCenter(e) {
  if (e.form === 'plug') return _v.set(e.pos.x, e.pos.y - PLUG_H * .45, e.pos.z);
  return _v.copy(e.pos);
}

function pick(x, y) {
  // letters drawn over the cables (and over any eye tucked behind them) are touched first there
  if (titleHit(x, y, true)) return { type: 'title' };
  // eyes first — they are the handles people reach for
  let best = null, bestScore = 1;
  const consider = (hit, d, r) => { const score = d / r; if (score < bestScore) { bestScore = score; best = hit; } };
  for (const c of cables) {
    for (const e of [c.a, c.b]) {
      if (e.form === 'head') {
        const p = project(e.pos);
        consider({ type: 'end', cable: c, end: e }, Math.hypot(p.x - x, p.y - y), Math.max(26, c.eyeR * p.k * 1.35));
      }
    }
    if (c.midIdx >= 0) {
      const i = c.midIdx * 3;
      _a.set(c.pos[i], c.pos[i + 1], c.pos[i + 2]);
      const p = project(_a);
      consider({ type: 'body', cable: c, i: c.midIdx }, Math.hypot(p.x - x, p.y - y), Math.max(26, c.eyeR * p.k * 1.35));
    }
  }
  if (best) return best;

  bestScore = 1;
  for (const c of cables) for (const e of [c.a, c.b]) {
    if (e.form !== 'plug' || e.bare) continue;
    const p = project(endHitCenter(e));
    const r = Math.max(24, .52 * p.k);
    const d = Math.hypot((p.x - x), (p.y - y) * .7);
    consider({ type: 'end', cable: c, end: e }, d, r);
  }
  if (best) return best;

  bestScore = 1;
  for (const k of knobs) {
    const p = project(_v.set(k.x, .38, k.z));
    consider({ type: 'knob', knob: k }, Math.hypot(p.x - x, (p.y - y) * .75), Math.max(20, .34 * p.k));
  }
  if (best) return best;

  bestScore = 1;
  for (const c of cables) {
    if (c.reveal < .95) continue;
    for (let i = 1; i < c.n - 1; i++) {
      const j = i * 3;
      _v.set(c.pos[j], c.pos[j + 1], c.pos[j + 2]);
      const p = project(_v);
      const d = Math.hypot(p.x - x, p.y - y);
      consider({ type: 'body', cable: c, i }, d, Math.max(14, c.W[i] * .5 * p.k + 6));
    }
  }
  if (best) return best;

  if (titleHit(x, y)) return { type: 'title' };
  return null;
}

let hovered = null;
function setHover(hit) {
  for (const c of cables) c.hotT = 0;
  hovered = hit;
  if (hit && hit.cable) hit.cable.hotT = 1;
  canvas.style.cursor = !hit ? 'default' : hit.type === 'knob' ? 'ns-resize' : 'grab';
}

function freeSockets(self) {
  return Object.values(sockets).filter(s => s.kind !== 'root' && !s.occupied && s !== self);
}

canvas.addEventListener('contextmenu', ev => ev.preventDefault()); // long-press is a gesture here
canvas.addEventListener('pointerdown', ev => {
  try { canvas.setPointerCapture(ev.pointerId); } catch { /* capture is only a nicety */ }
  pointer.x = ev.clientX; pointer.y = ev.clientY; pointer.down = true; pointer.last = performance.now();
  const hit = pick(ev.clientX, ev.clientY);
  if (!hit) return;
  canvas.style.cursor = hit.type === 'knob' ? 'ns-resize' : 'grabbing';
  action = { ...hit, stage: 'pending', sx: ev.clientX, sy: ev.clientY, t0: performance.now(), v0: hit.knob ? hit.knob.value : 0 };
  if (hit.type === 'title') {
    titleState.active = true;
    titleState.g.set(ev.clientX, ev.clientY);
    titleUniforms.uG.value.copy(titleState.g);
    titleState.d.set(0, 0); titleState.v.set(0, 0); titleState.dT.set(0, 0);
  }
});

canvas.addEventListener('pointermove', ev => {
  pointer.x = ev.clientX; pointer.y = ev.clientY; pointer.last = performance.now(); pointer.inside = true;
  if (!action) { setHover(pick(ev.clientX, ev.clientY)); return; }
  const moved = Math.hypot(ev.clientX - action.sx, ev.clientY - action.sy);

  if (action.type === 'knob') {
    const dv = (action.sy - ev.clientY + (ev.clientX - action.sx)) / 130;
    action.knob.value = clamp(action.v0 + dv, -1.1, 1.1);
    action.stage = 'drag';
    return;
  }
  if (action.type === 'title') {
    titleState.dT.set(ev.clientX - action.sx, ev.clientY - action.sy);
    return;
  }
  if (action.stage === 'pending' && moved > DRAG_START) beginDrag();
});

function beginDrag() {
  action.stage = 'drag';
  const c = action.cable;
  if (action.type === 'end') {
    const e = action.end;
    e.grabbed = true;
    e.grabZ = e.pos.z;
    if (e.socket) { e.prevSocket = e.socket; e.socket.occupied = false; e.socket = null; }
    else e.prevSocket = null;
    e.target.copy(e.pos);
  } else if (action.type === 'body') {
    const i = action.i;
    c.grab = { i, target: new THREE.Vector3(c.pos[i * 3], c.pos[i * 3 + 1], c.pos[i * 3 + 2]), z: c.pos[i * 3 + 2] };
  }
}

function beginCurl() {
  action.stage = 'curl';
  const c = action.cable;
  let g, center;
  if (action.type === 'end') {
    g = action.end === c.a ? 0 : c.n - 1;
    center = action.end.pos;
  } else {
    g = action.i;
    center = _v.set(c.pos[g * 3], c.pos[g * 3 + 1], c.pos[g * 3 + 2]);
  }
  c.curlG = g;
  c.curlC.copy(center);
  const tA = c.a.socket ? g * c.seg * .85 : g * c.seg;
  const tB = c.b.socket ? (c.n - 1 - g) * c.seg * .85 : (c.n - 1 - g) * c.seg;
  const room = g === 0 ? tB : g === c.n - 1 ? tA : Math.min(tA, tB);
  c.curlCap = clamp(room, 1.2, 11);
  c.curlDir = Math.random() < .5 ? 1 : -1;
  c.curlOn = true;
}

function release() {
  const a = action;
  action = null;
  if (a.type === 'title') {
    titleState.active = false;
    titleState.dT.set(0, 0);
    return;
  }
  if (a.type === 'knob') return;
  const c = a.cable;

  if (a.stage === 'curl') {
    c.curlOn = false;
    c.kick(c.U[c.curlG], 3);
    return;
  }
  if (a.stage === 'pending') {
    const u = a.type === 'end' ? (a.end === c.a ? .02 : .98) : c.U[a.i];
    c.repaint(u);
    c.kick(u, 5);
    return;
  }
  if (a.type === 'body') {
    c.grab = null;
    return;
  }

  // released a plug / head
  const e = a.end, other = e === c.a ? c.b : c.a;
  e.grabbed = false;
  if (e.candidate) {
    connect(c, e, e.candidate);
  } else if (e.prevSocket) {
    if (other.socket) {
      // an unplugged end stands up and looks around
      e.form = 'head';
      if (!e.eye) e.eye = makeEye(c.eyeR);
      const root = other.socket;
      const px = clamp(e.pos.x, root.x - 6, root.x + 6);
      e.home.set(clamp(px, -10, 10), clamp(e.pos.y, 4.2, 8.6), root.z);
      c.regen();
      c.kick(.7, 7);
    } else {
      connect(c, e, e.prevSocket);
    }
  }
  e.candidate = null;
  e.prevSocket = null;
}

function connect(c, e, s) {
  s.occupied = true;
  s.pulse = 1;
  e.socket = s;
  e.form = 'plug';
  c.regen();
  c.kick(.5, 6);
}

canvas.addEventListener('pointerup', ev => {
  pointer.down = false;
  if (action) release();
  setHover(pick(ev.clientX, ev.clientY));
});
canvas.addEventListener('pointercancel', () => { pointer.down = false; if (action) release(); });
canvas.addEventListener('pointerleave', () => { pointer.inside = false; if (!action) setHover(null); });

function updateDragTargets() {
  if (!action || action.stage !== 'drag') return;
  if (action.type === 'body') {
    const g = action.cable.grab;
    unproject(pointer.x, pointer.y, g.z, g.target);
    g.target.y = Math.max(g.target.y, .25);
  } else if (action.type === 'end') {
    const e = action.end;
    unproject(pointer.x, pointer.y, e.grabZ, e.target);
    e.target.y = Math.max(e.target.y, PLUG_H + .1);
    let best = null, bestD = Math.max(36, 58 * view.s * 1.4);
    for (const s of freeSockets()) {
      const p = project(socketTop(s, _v));
      const d = Math.hypot(p.x - pointer.x, p.y - pointer.y);
      if (d < bestD) { bestD = d; best = s; }
    }
    e.candidate = best;
    if (best) { socketTop(best, e.target); e.target.y += .3; }
  }
}

/* ---- buttons ---- */
document.getElementById('shuffle').addEventListener('click', () => {
  cables.forEach((c, i) => setTimeout(() => {
    c.repaint(.5, Math.floor(Math.random() * PAT_COUNT));
    if (c.split < 1) setTimeout(() => c.repaint(c.split > .5 ? .95 : .05, Math.floor(Math.random() * PAT_COUNT)), 520);
    c.kick(.5, 8);
  }, i * 45));
});

document.getElementById('reset').addEventListener('click', () => {
  if (action) release();
  for (const s of Object.values(sockets)) s.occupied = false;
  for (const c of cables) {
    for (const [e, id] of [[c.a, c.def.a], [c.b, c.def.b]]) {
      e.grabbed = false; e.candidate = null; e.prevSocket = null;
      if (id) { e.socket = sockets[id]; e.socket.occupied = true; e.form = 'plug'; }
      else { e.socket = null; e.form = 'head'; }
    }
    c.a.home.copy(c.a.pos);
    if (!c.def.b) {
      c.b.home.copy(c.initialHead);
    }
    c.shapeT.set(c.initShape);
    c.L0 = c.initL0;
    if (c.wipe) c.finishWipe();
    c.pats = [...c.initPats];
    c.applyPats();
    c.kick(.5, 8);
  }
  for (const k of knobs) k.value = k.base;
});
for (const c of cables) c.initialHead = c.b.home.clone();

/* ---- idle: a handful of cables wriggle at any one time, and the set slowly changes ---- */
const wrigglers = [1, 4, 5, 0, 7, 12].map(i => cables[i]);
let nextSwap = 5;
function updateWrigglers(T) {
  if (T < nextSwap) return;
  nextSwap = T + rand(2.6, 4.2);
  wrigglers.shift();
  const rest = cables.filter(c => !wrigglers.includes(c));
  const bodies = rest.filter(c => !c.def.b);
  const pool = bodies.length && Math.random() < .6 ? bodies : rest;
  wrigglers.push(pool[Math.floor(Math.random() * pool.length)]);
}

/* ---- frame ---- */
const SHOW_PLUG = e => (e.form === 'plug' && !e.bare) ? 1 : 0;

function updateEye(eye, pos, wanted, dt, T, surprised) {
  const k = 170, c = 11;
  eye.vs += (k * (wanted - eye.scale) - c * eye.vs) * dt;
  eye.scale += eye.vs * dt;
  eye.scale = Math.max(eye.scale, .001);
  eye.boost += ((surprised ? 1 : 0) - eye.boost) * (1 - Math.exp(-dt * 14));

  if (T > eye.nextBlink) { eye.blink = 1; eye.nextBlink = T + rand(2, 7); }
  eye.blink = Math.max(0, eye.blink - dt * 7);
  const lid = 1 - Math.sin(Math.min(1, eye.blink) * Math.PI) * .92;

  const g = eye.scale * (1 + eye.boost * .28);
  eye.holder.scale.set(g, g * lid, 1);
  eye.holder.position.set(pos.x, pos.y, pos.z + .16);

  const idle = performance.now() - pointer.last > 2600 || pointer.x < -900;
  if (idle) {
    if (T > eye.nextSaccade) { eye.lookT.set(rand(-1, 1), rand(-1, 1)).multiplyScalar(.5); eye.nextSaccade = T + rand(.8, 3); }
  } else {
    const p = project(pos);
    eye.lookT.set(pointer.x - p.x, p.y - pointer.y);
    const m = eye.lookT.length();
    eye.lookT.multiplyScalar(Math.min(1, m / 140) / Math.max(1, m) * .5);
  }
  eye.look.lerp(eye.lookT, 1 - Math.exp(-dt * 14));
  eye.pupil.position.x = eye.look.x;
  eye.pupil.position.y = eye.look.y;
  eye.pupil.scale.setScalar(.47 * (1 - eye.boost * .25));
}

const clock = new THREE.Clock();
let T = 0, sinceStart = 0;
const camGoal = new THREE.Vector2();

function frame() {
  requestAnimationFrame(frame);
  const raw = clock.getDelta();
  const dt = Math.min(raw, 1 / 30);
  T += dt; sinceStart += Math.min(raw, .25);

  // gentle parallax, frozen while something is held so drags stay stable
  if (!action && !reduced && pointer.inside) {
    camGoal.set((pointer.x / view.w - .5) * .5, (pointer.y / view.h - .5) * -.22);
  }
  const ce = 1 - Math.exp(-dt * 3);
  camera.position.x += (camGoal.x - camera.position.x) * ce;
  camera.position.y += (CAM_H + camGoal.y - camera.position.y) * ce;
  camera.updateMatrixWorld();

  if (action && action.stage === 'pending' && action.cable && performance.now() - action.t0 > HOLD_MS) {
    if (!(action.type === 'end' && action.end.form === 'plug')) beginCurl();
  }
  if (action && action.stage === 'curl' && action.type === 'body') {
    unproject(pointer.x, pointer.y, action.cable.curlC.z, action.cable.curlC);
  }
  updateDragTargets();

  // sockets
  const dragging = action && action.stage === 'drag' && action.type === 'end';
  for (const s of Object.values(sockets)) {
    if (!s.group) continue;
    s.pulse = Math.max(0, s.pulse - dt * 2.4);
    const free = dragging && !s.occupied;
    const cand = dragging && action.end.candidate === s;
    const glowT = cand ? 1 : free ? .4 + .2 * Math.sin(T * 6 + s.x) : s.pulse;
    s.glow += (glowT - s.glow) * (1 - Math.exp(-dt * 16));
    s.glowMesh.material.opacity = s.glow;
    s.glowMesh.visible = s.glow > .01;
    const pop = 1 + s.pulse * s.pulse * .35 + (cand ? .15 : 0);
    s.glowMesh.scale.set(pop, pop, 1);
  }

  // knobs
  for (const k of knobs) {
    k.shown += (k.value - k.shown) * (1 - Math.exp(-dt * 24));
    k.g.rotation.y = k.shown * 2.4;
    if (k.cable) {
      const w = Math.abs(k.value - k.base);
      k.touched = k.touched || w > .001;
      if (k.touched) k.cable.wigFrom = Math.max(k.cable.wigFrom || 0, w);
    }
  }
  for (const c of cables) {
    c.wig += ((c.wigFrom || 0) - c.wig) * (1 - Math.exp(-dt * 5));
    c.wigFrom = 0;
  }

  // cables
  updateWrigglers(T);
  for (const c of cables) {
    const held = c.grab || c.curlOn || c.a.grabbed || c.b.grabbed;
    c.idleT = !held && wrigglers.includes(c) ? 1 : 0;
    c.idle += (c.idleT - c.idle) * (1 - Math.exp(-dt * (held ? 6 : .8)));
    if (!reduced && c.reveal < 1) {
      const t = clamp((sinceStart - .15 - c.delay) / .85, 0, 1);
      c.reveal = 1 - Math.pow(1 - t, 3);
      c.mat.uniforms.uReveal.value = c.reveal;
    } else {
      c.mat.uniforms.uReveal.value = 1;
    }
    c.step(dt, T);
    c.writeMesh();

    for (const e of [c.a, c.b]) {
      const on = c.reveal > .05 ? SHOW_PLUG(e) : 0;
      if (e.plug) {
        e.plugVel += (240 * (on - e.plugScale) - 16 * e.plugVel) * dt;
        e.plugScale = Math.max(.001, e.plugScale + e.plugVel * dt);
        e.plug.scale.setScalar(e.plugScale * PART_K);
        e.plug.position.set(e.pos.x, e.pos.y - PLUG_H, e.pos.z);
        const tilt = e.socket ? 0 : clamp((e.target.x - e.pos.x) * -.2, -.5, .5);
        e.plug.rotation.z += (tilt - e.plug.rotation.z) * (1 - Math.exp(-dt * 12));
      }
      if (e.eye) {
        const wanted = e.form === 'head' && c.reveal > .9 ? 1 : 0;
        const held = (action && action.end === e && action.stage === 'drag') || (hovered && hovered.end === e);
        updateEye(e.eye, e.pos, wanted, dt, T, held);
      }
    }
    if (c.midEye) {
      const i = c.midIdx * 3;
      _a.set(c.pos[i], c.pos[i + 1], c.pos[i + 2]);
      const held = (action && action.cable === c && action.i === c.midIdx && action.stage === 'drag') || (hovered && hovered.cable === c && hovered.i === c.midIdx);
      updateEye(c.midEye, _a, c.reveal > .9 ? 1 : 0, dt, T, held);
    }
  }

  // title: dough-like pull with a springy return
  const ts = titleState;
  const hold = action && action.type === 'title';
  if (hold) {
    const still = ts.dT.length() < 8;
    ts.fatT = still ? Math.min(.26, (performance.now() - action.t0) / 2600) : 0;
  } else ts.fatT = 0;
  ts.fat += (ts.fatT - ts.fat) * (1 - Math.exp(-dt * 10));
  ts.v.x += (150 * (ts.dT.x - ts.d.x) - (hold ? 26 : 6.5) * ts.v.x) * dt;
  ts.v.y += (150 * (ts.dT.y - ts.d.y) - (hold ? 26 : 6.5) * ts.v.y) * dt;
  ts.d.addScaledVector(ts.v, dt);
  const base = 150 * Math.max(.45, view.s * 1.6);
  titleUniforms.uSig.value = Math.max(base, ts.d.length() * 1.08);
  titleUniforms.uD.value.copy(ts.d);
  titleUniforms.uFat.value = ts.fat;
  titleUniforms.uTime.value = reduced ? 0 : T;
  if (!reduced) titleUniforms.uGrow.value = 1 - Math.pow(1 - clamp(sinceStart / 1.1, 0, 1), 3);

  // LED board steps one lamp column at a time
  if (!reduced) footerUniforms.uScroll.value += dt * 22;

  renderer.clear();
  renderer.render(titleScene, titleCam);
  renderer.clearDepth();
  renderer.render(scene, camera);
  if (titleUniforms.uFront.value) renderer.render(titleFrontScene, titleCam);
}

layout();
addEventListener('resize', () => {
  if ((innerHeight / innerWidth > 1.05) !== PORTRAIT) location.reload(); // other composition
  else layout();
});
frame();
