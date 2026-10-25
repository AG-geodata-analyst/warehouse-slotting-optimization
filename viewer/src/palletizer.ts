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

// ─── Local (unpositioned) pattern definitions ─────────────────────
// All coordinates in mm, origin at (0, 0) = top-left of the pattern.
// `w` = width along pallet X axis, `d` = depth along pallet Y axis.

interface LocalBox { x: number; y: number; w: number; d: number; }

interface PatternVariant {
  pattern: PatternId;
  orientation: 'A' | 'B';
  layerA: LocalBox[];
  layerB: LocalBox[] | null;   // null for Column (no alternation)
  width: number;               // total pattern width
  depth: number;               // total pattern depth
  boxesPerLayer: number;
}

/**
 * Pinwheel — the closed-loop pattern from the sketch.
 * 6 boxes: 2 horizontals (opposite corners) + 4 verticals (sides).
 * Requires: W + D ≤ PALLET_W  AND  2W + D ≤ PALLET_D  for orientation A.
 */
function pinwheelVariant(W: number, D: number): PatternVariant | null {
  if (W + D > PALLET_W || 2 * W + D > PALLET_D) return null;
  const patternW = W + D;
  const layerA: LocalBox[] = [
    { x: 0, y: 0, w: W, d: D },          // H top-left
    { x: W, y: 0, w: D, d: W },          // V top-right
    { x: W, y: W, w: D, d: W },          // V mid-right
    { x: D, y: 2 * W, w: W, d: D },      // H bottom-right
    { x: 0, y: D, w: D, d: W },          // V mid-left
    { x: 0, y: D + W, w: D, d: W },      // V bot-left
  ];
  const layerB = layerA.map((p) => ({ ...p, x: patternW - p.x - p.w }));
  return {
    pattern: 'pinwheel',
    orientation: 'A',
    layerA,
    layerB,
    width: patternW,
    depth: 2 * W + D,
    boxesPerLayer: layerA.length,
  };
}

/**
 * Split-Block — 2 verticals stacked in one column + N horizontals in the other.
 * Constraints:
 *   W + D ≤ PALLET_W       (two columns fit side by side)
 *   2W     ≤ PALLET_D      (both verticals must fit within pallet depth)
 *   N = floor(2W / D)      (horizontals count matched to vertical column height)
 */
function splitBlockVariant(W: number, D: number): PatternVariant | null {
  if (W + D > PALLET_W || 2 * W > PALLET_D) return null;
  const patternW = W + D;
  const N = Math.floor((2 * W) / D);
  const layerA: LocalBox[] = [
    { x: 0, y: 0, w: D, d: W },          // V top-left
    { x: 0, y: W, w: D, d: W },          // V bot-left
  ];
  for (let i = 0; i < N; i++) {
    layerA.push({ x: D, y: i * D, w: W, d: D });  // N horizontals on right
  }
  const layerB = layerA.map((p) => ({ ...p, x: patternW - p.x - p.w }));
  return {
    pattern: 'split-block',
    orientation: 'A',
    layerA,
    layerB,
    width: patternW,
    depth: 2 * W,
    boxesPerLayer: layerA.length,
  };
}

/**
 * Column — regular grid. Only pattern with no Layer B (all layers identical).
 */
function columnVariant(W: number, D: number): PatternVariant | null {
  const cols = Math.floor(PALLET_W / W);
  const rows = Math.floor(PALLET_D / D);
  if (cols === 0 || rows === 0) return null;
  const layerA: LocalBox[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      layerA.push({ x: c * W, y: r * D, w: W, d: D });
    }
  }
  return {
    pattern: 'column',
    orientation: 'A',
    layerA,
    layerB: null,
    width: cols * W,
    depth: rows * D,
    boxesPerLayer: layerA.length,
  };
}

/**
 * Rotate a variant 90° counter-clockwise (orientation A → B).
 * The whole pattern is rotated; box dimensions within it swap w ↔ d.
 */
function rotateVariant(v: PatternVariant): PatternVariant {
  const rotateLayer = (layer: LocalBox[]) =>
    layer.map((p) => ({
      x: v.depth - p.y - p.d,
      y: p.x,
      w: p.d,
      d: p.w,
    }));
  return {
    ...v,
    orientation: 'B',
    layerA: rotateLayer(v.layerA),
    layerB: v.layerB ? rotateLayer(v.layerB) : null,
    width: v.depth,
    depth: v.width,
  };
}

function fitsPallet(v: PatternVariant): boolean {
  return v.width <= PALLET_W && v.depth <= PALLET_D;
}

// ─── Winner-takes-all selection ───────────────────────────────────

function chooseBestPattern(targetBoxes: number, box: BoxSpec): StackPlan {
  const W = Math.max(box.width, box.depth);
  const D = Math.min(box.width, box.depth);

  // Build all candidates: 3 patterns × 2 orientations
  const candidates: PatternVariant[] = [];
  for (const gen of [pinwheelVariant, splitBlockVariant, columnVariant]) {
    const a = gen(W, D);
    if (a && fitsPallet(a)) candidates.push(a);
    if (a) {
      const b = rotateVariant(a);
      if (fitsPallet(b)) candidates.push(b);
    }
  }

  if (candidates.length === 0) {
    return {
      box,
      pattern: 'column',
      orientation: 'A',
      layers: 0,
      boxesPerLayer: 0,
      totalPlaced: 0,
      capacity: 0,
      targetBoxes,
      placements: [],
    };
  }

  // Pick the pattern with the highest boxes per layer
  let best = candidates[0];
  for (const c of candidates) {
    if (c.boxesPerLayer > best.boxesPerLayer) best = c;
  }

  const maxLayers = Math.max(1, Math.floor(PALLET_H / box.height));
  const capacity = best.boxesPerLayer * maxLayers;
  const totalPlaced = Math.min(targetBoxes, capacity);

  // Center the pattern on the pallet (equal margins on all sides)
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
    boxesPerLayer: best.boxesPerLayer,
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
