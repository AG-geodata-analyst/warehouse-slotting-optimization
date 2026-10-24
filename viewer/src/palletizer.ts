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
  'pinwheel': 'Alternating Perimeter Interlock (Pinwheel)',
  'split-block': 'Split-Block Interlocking',
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

function canPinwheel(box: BoxSpec): boolean {
  const halfW = PALLET_W / 2;
  const halfD = PALLET_D / 2;
  return box.width <= halfW && box.depth <= halfD
      && box.depth <= halfW && box.width <= halfD;
}

function choosePattern(sku: string, box: BoxSpec): PatternId {
  const patterns: PatternId[] = canPinwheel(box)
    ? ['pinwheel', 'split-block', 'column']
    : ['split-block', 'column'];
  return patterns[hashSku(sku) % patterns.length];
}

function planPinwheel(targetBoxes: number, box: BoxSpec): StackPlan {
  const perLayer = 6;
  const maxLayers = Math.max(1, Math.floor(PALLET_H / box.height));
  const capacity = perLayer * maxLayers;
  const totalPlaced = Math.min(targetBoxes, capacity);
  const placements: BoxPlacement[] = [];
  let remaining = totalPlaced;
  let layers = 0;

  for (let z = 0; z < maxLayers && remaining > 0; z++) {
    const even = z % 2 === 0;
    const cw = even ? box.depth : box.width;
    const cd = even ? box.width : box.depth;
    const corners = [
      { x: 0, y: 0 },
      { x: PALLET_W - cw, y: 0 },
      { x: 0, y: PALLET_D - cd },
      { x: PALLET_W - cw, y: PALLET_D - cd },
    ];
    for (const c of corners) {
      if (remaining <= 0) break;
      placements.push({ x: c.x, y: c.y, z: z * box.height, width: cw, depth: cd, height: box.height });
      remaining--;
    }
    const mw = even ? box.width : box.depth;
    const md = even ? box.depth : box.width;
    const mx = Math.max(0, (PALLET_W - mw) / 2);
    for (const my of [0, PALLET_D - md]) {
      if (remaining <= 0) break;
      placements.push({ x: mx, y: my, z: z * box.height, width: mw, depth: md, height: box.height });
      remaining--;
    }
    layers++;
  }

  return { box, pattern: 'pinwheel', layers, boxesPerLayer: perLayer, totalPlaced, capacity, targetBoxes, placements };
}

function planSplitBlock(targetBoxes: number, box: BoxSpec): StackPlan {
  const perLayer = 7;
  const maxLayers = Math.max(1, Math.floor(PALLET_H / box.height));
  const capacity = perLayer * maxLayers;
  const totalPlaced = Math.min(targetBoxes, capacity);
  const placements: BoxPlacement[] = [];
  const half = PALLET_W / 2;
  let remaining = totalPlaced;
  let layers = 0;

  for (let z = 0; z < maxLayers && remaining > 0; z++) {
    const even = z % 2 === 0;
    const vw = box.depth;
    const vd = box.width;
    const vY0 = Math.max(0, (PALLET_D - 2 * vd) / 2);
    const vSectionX = even ? 0 : half;
    for (let i = 0; i < 2 && remaining > 0; i++) {
      const y = vY0 + i * vd;
      if (y + vd > PALLET_D + 0.5) break;
      placements.push({ x: vSectionX, y, z: z * box.height, width: vw, depth: vd, height: box.height });
      remaining--;
    }
    const hSectionX = even ? half : 0;
    for (let i = 0; i < 5 && remaining > 0; i++) {
      const y = i * box.depth;
      if (y + box.depth > PALLET_D + 0.5) break;
      placements.push({ x: hSectionX, y, z: z * box.height, width: box.width, depth: box.depth, height: box.height });
      remaining--;
    }
    layers++;
  }

  return { box, pattern: 'split-block', layers, boxesPerLayer: perLayer, totalPlaced, capacity, targetBoxes, placements };
}

function planColumn(targetBoxes: number, box: BoxSpec): StackPlan {
  const colsX = Math.max(1, Math.floor(PALLET_W / box.width));
  const colsY = Math.max(1, Math.floor(PALLET_D / box.depth));
  const perLayer = colsX * colsY;
  const maxLayers = Math.max(1, Math.floor(PALLET_H / box.height));
  const capacity = perLayer * maxLayers;
  const totalPlaced = Math.min(targetBoxes, capacity);
  const placements: BoxPlacement[] = [];
  let remaining = totalPlaced;
  let layers = 0;

  for (let z = 0; z < maxLayers && remaining > 0; z++) {
    for (let y = 0; y < colsY && remaining > 0; y++) {
      for (let x = 0; x < colsX && remaining > 0; x++) {
        placements.push({
          x: x * box.width,
          y: y * box.depth,
          z: z * box.height,
          width: box.width,
          depth: box.depth,
          height: box.height,
        });
        remaining--;
      }
    }
    layers++;
  }

  return { box, pattern: 'column', layers, boxesPerLayer: perLayer, totalPlaced, capacity, targetBoxes, placements };
}

export function planStack(targetBoxes: number, sku: string): StackPlan {
  const box = pickBoxForSku(sku);
  const pattern = choosePattern(sku, box);
  if (pattern === 'pinwheel') return planPinwheel(targetBoxes, box);
  if (pattern === 'split-block') return planSplitBlock(targetBoxes, box);
  return planColumn(targetBoxes, box);
}
