// Standard EUR1 wooden pallet (mm). Usable stack height above deck.
export const PALLET_W = 1200;
export const PALLET_D = 800;
export const PALLET_H = 1500;

export type BoxShape = 'cube' | 'rect';

export interface BoxSpec {
  id: string;
  shape: BoxShape;
  width: number;
  depth: number;
  height: number;
  label: string;
}

export const BOX_SPECS: BoxSpec[] = [
  { id: 'cube-s', shape: 'cube', width: 250, depth: 250, height: 250, label: 'Cube S · 25×25×25' },
  { id: 'cube-m', shape: 'cube', width: 300, depth: 300, height: 300, label: 'Cube M · 30×30×30' },
  { id: 'cube-l', shape: 'cube', width: 400, depth: 400, height: 400, label: 'Cube L · 40×40×40' },
  { id: 'rect-s', shape: 'rect', width: 300, depth: 200, height: 150, label: 'Rect S · 30×20×15' },
  { id: 'rect-m', shape: 'rect', width: 400, depth: 300, height: 250, label: 'Rect M · 40×30×25' },
  { id: 'rect-l', shape: 'rect', width: 600, depth: 400, height: 300, label: 'Rect L · 60×40×30' },
];

export type PatternId = 'pinwheel' | 'split-block' | 'column';

export const PATTERN_LABEL: Record<PatternId, string> = {
  'pinwheel': 'Pinwheel (Perimeter Interlock)',
  'split-block': 'Split-Block (Hybrid)',
  'column': 'Column Stack',
};

export interface BoxPlacement {
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
  height: number;
}

export interface StackPlan {
  box: BoxSpec;
  pattern: PatternId;
  orientation: 'A' | 'B';
  layers: number;
  boxesPerLayer: number;
  totalPlaced: number;
  capacity: number;
  targetBoxes: number;
  placements: BoxPlacement[];
}

function hashSku(sku: string): number {
  let h = 17;
  for (let i = 0; i < sku.length; i++) {
    h = (h * 31 + sku.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function pickBoxForSku(sku: string): BoxSpec {
  return BOX_SPECS[hashSku(sku) % BOX_SPECS.length];
}

// ─── Local pattern definitions ─────────────────────────────────────
// All local coordinates assume origin at (0,0), boxes placed in a
// bounding box of `width` × `depth`. Fitting is checked separately.

interface LocalBox { x: number; y: number; w: number; d: number; }
interface PatternBase {
  layerA: LocalBox[];
  layerB: LocalBox[] | null;   // null for Column (no alternation)
  width: number;
  depth: number;
}
interface PatternVariant extends PatternBase {
  pattern: PatternId;
  orientation: 'A' | 'B';
}

function pinwheelPattern(W: number, D: number): PatternBase {
  const layerA: LocalBox[] = [
    { x: 0, y: 0, w: W, d: D },           // H top-left
    { x: W, y: 0, w: D, d: W },           // V top-right
    { x: W, y: W, w: D, d: W },           // V mid-right
    { x: D, y: 2 * W, w: W, d: D },       // H bottom-right
    { x: 0, y: D, w: D, d: W },           // V mid-left
    { x: 0, y: D + W, w: D, d: W },       // V bot-left
  ];
  const patternW = W + D;
  const layerB = layerA.map((p) => ({ ...p, x: patternW - p.x - p.w }));
  return { layerA, layerB, width: patternW, depth: 2 * W + D };
}

function splitBlockPattern(W: number, D: number): PatternBase {
  const N = Math.floor((2 * W) / D);
  const layerA: LocalBox[] = [
    { x: 0, y: 0, w: D, d: W },           // V top-left
    { x: 0, y: W, w: D, d: W },           // V bot-left
  ];
  for (let i = 0; i < N; i++) {
    layerA.push({ x: D, y: i * D, w: W, d: D });
  }
  const patternW = W + D;
  const layerB = layerA.map((p) => ({ ...p, x: patternW - p.x - p.w }));
  return { layerA, layerB, width: patternW, depth: 2 * W };
}

function columnPattern(W: number, D: number, cols: number, rows: number): PatternBase {
  const layerA: LocalBox[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      layerA.push({ x: c * W, y: r * D, w: W, d: D });
    }
  }
  return { layerA, layerB: null, width: cols * W, depth: rows * D };
}

function rotatePattern(p: PatternBase): PatternBase {
  const rot = (b: LocalBox): LocalBox => ({
    x: p.depth - b.y - b.d,
    y: b.x,
    w: b.d,
    d: b.w,
  });
  return {
    layerA: p.layerA.map(rot),
    layerB: p.layerB ? p.layerB.map(rot) : null,
    width: p.depth,
    depth: p.width,
  };
}

function fits(width: number, depth: number): boolean {
  return width <= PALLET_W && depth <= PALLET_D;
}

// ─── Winner-takes-all ──────────────────────────────────────────────

function chooseBestPattern(targetBoxes: number, box: BoxSpec): StackPlan {
  const W = Math.max(box.width, box.depth);
  const D = Math.min(box.width, box.depth);

  const candidates: PatternVariant[] = [];

  // Pinwheel — A and B tried independently
  const pin = pinwheelPattern(W, D);
  if (fits(pin.width, pin.depth)) {
    candidates.push({ ...pin, pattern: 'pinwheel', orientation: 'A' });
  }
  const pinB = rotatePattern(pin);
  if (fits(pinB.width, pinB.depth)) {
    candidates.push({ ...pinB, pattern: 'pinwheel', orientation: 'B' });
  }

  // Split-Block — A and B tried independently
  const sb = splitBlockPattern(W, D);
  if (fits(sb.width, sb.depth)) {
    candidates.push({ ...sb, pattern: 'split-block', orientation: 'A' });
  }
  const sbB = rotatePattern(sb);
  if (fits(sbB.width, sbB.depth)) {
    candidates.push({ ...sbB, pattern: 'split-block', orientation: 'B' });
  }

  // Column — A and B are DIFFERENT grids (not rotations of each other)
  const cA_cols = Math.floor(PALLET_W / W);
  const cA_rows = Math.floor(PALLET_D / D);
  if (cA_cols > 0 && cA_rows > 0) {
    candidates.push({
      ...columnPattern(W, D, cA_cols, cA_rows),
      pattern: 'column',
      orientation: 'A',
    });
  }
  const cB_cols = Math.floor(PALLET_W / D);
  const cB_rows = Math.floor(PALLET_D / W);
  if (cB_cols > 0 && cB_rows > 0) {
    candidates.push({
      ...columnPattern(D, W, cB_cols, cB_rows),
      pattern: 'column',
      orientation: 'B',
    });
  }

  if (candidates.length === 0) {
    return {
      box, pattern: 'column', orientation: 'A',
      layers: 0, boxesPerLayer: 0, totalPlaced: 0, capacity: 0,
      targetBoxes, placements: [],
    };
  }

  // Strict `>` keeps the first candidate on ties — Pinwheel/Split-Block
  // win over Column, and orientation A wins over B, when counts are equal.
  let best = candidates[0];
  for (const c of candidates) {
    if (c.layerA.length > best.layerA.length) best = c;
  }

  const perLayer = best.layerA.length;
  const maxLayers = Math.max(1, Math.floor(PALLET_H / box.height));
  const capacity = perLayer * maxLayers;
  const totalPlaced = Math.min(targetBoxes, capacity);

  const offsetX = (PALLET_W - best.width) / 2;
  const offsetY = (PALLET_D - best.depth) / 2;

  const placements: BoxPlacement[] = [];
  let remaining = totalPlaced;
  let layerCount = 0;

  for (let z = 0; z < maxLayers && remaining > 0; z++) {
    const layerBoxes = (z % 2 === 1 && best.layerB) ? best.layerB : best.layerA;
    for (const p of layerBoxes) {
      if (remaining <= 0) break;
      placements.push({
        x: p.x + offsetX,
        y: p.y + offsetY,
        z: z * box.height,
        width: p.w,
        depth: p.d,
        height: box.height,
      });
      remaining--;
    }
    layerCount++;
  }

  return {
    box,
    pattern: best.pattern,
    orientation: best.orientation,
    layers: layerCount,
    boxesPerLayer: perLayer,
    totalPlaced,
    capacity,
    targetBoxes,
    placements,
  };
}

export function planStack(targetBoxes: number, sku: string): StackPlan {
  const box = pickBoxForSku(sku);
  return chooseBestPattern(targetBoxes, box);
}
