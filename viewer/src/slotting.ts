import type { WarehouseLayout, Bootstrap, Day } from './types';
import type { WarehouseState } from './replay';

// Dispatch origin — pickers start & return here. World coords in x/z plane.
const DISPATCH_X = 0;
const DISPATCH_Z = 0;

// Must match scene.ts geometry.
const SLOT_WIDTH_M = 1.2;

export type Tier = 'A' | 'B' | 'C';
export type Quality = 'good' | 'misplaced' | 'wasted';

export interface PlacementKPIs {
  /** % of A-tier pallets that sit in an A-tier slot. 0..100 */
  aPlacedPct: number;
  /** Average dispatch distance (metres) across all occupied pallets. */
  avgPickDistance: number;
  /** Pallets whose tier doesn't match their slot's tier. */
  wouldMove: number;
  totalPalletCount: number;
}

export interface PlacementAnalysis {
  slotQuality: Map<string, Quality>;
  kpis: PlacementKPIs;
}

const TIER_VALUE: Record<Tier, number> = { A: 3, B: 2, C: 1 };

/**
 * Split `items` into A/B/C tiers by `rankOf`.
 * If `descending` = true, higher rank = better (A).
 * If `descending` = false, lower rank = better (A).
 */
function splitIntoTiers<T>(
  items: T[],
  rankOf: (item: T) => number,
  descending: boolean,
): Map<T, Tier> {
  const sorted = [...items].sort((a, b) =>
    descending ? rankOf(b) - rankOf(a) : rankOf(a) - rankOf(b),
  );
  const n = sorted.length;
  const aEnd = Math.ceil(n / 3);
  const bEnd = Math.ceil((2 * n) / 3);
  const map = new Map<T, Tier>();
  sorted.forEach((item, i) => {
    map.set(item, i < aEnd ? 'A' : i < bEnd ? 'B' : 'C');
  });
  return map;
}

/**
 * Sum outbound pallet counts per SKU over the whole loaded window.
 * Every SKU that ever existed (bootstrap or inbound) is initialised to 0,
 * so never-shipped SKUs land in tier C rather than being skipped.
 */
export function computeSkuVelocity(
  bootstrap: Bootstrap,
  days: Day[],
): Map<string, number> {
  const skuByPallet = new Map<string, string>();
  for (const p of bootstrap.pallets) skuByPallet.set(p.id, p.sku);
  for (const d of days) {
    for (const ev of d.inbound) {
      for (const p of ev.pallets) skuByPallet.set(p.id, p.sku);
    }
  }

  const vel = new Map<string, number>();
  for (const sku of skuByPallet.values()) vel.set(sku, 0);

  for (const d of days) {
    for (const ev of d.outbound) {
      for (const pid of ev.pallet_ids) {
        const sku = skuByPallet.get(pid);
        if (!sku) continue;
        vel.set(sku, (vel.get(sku) ?? 0) + 1);
      }
    }
  }
  return vel;
}

export function analyzePlacement(
  state: WarehouseState,
  layout: WarehouseLayout,
  skuVelocity: Map<string, number>,
): PlacementAnalysis {
  // 1. Distance from dispatch for every slot.
  const slotDist = new Map<string, number>();
  for (const rack of layout.racks) {
    for (const slot of rack.slots) {
      const x = rack.x + (slot.bay - 1) * SLOT_WIDTH_M;
      const z = rack.y;
      const dx = x - DISPATCH_X;
      const dz = z - DISPATCH_Z;
      slotDist.set(slot.id, Math.sqrt(dx * dx + dz * dz));
    }
  }

  // 2. Slot tier — ascending distance, so nearest = A.
  const slotIds = [...slotDist.keys()];
  const slotTier = splitIntoTiers(slotIds, (id) => slotDist.get(id)!, false);

  // 3. SKU tier — descending velocity, so fastest = A.
  const skuKeys = [...skuVelocity.keys()];
  const skuTier = splitIntoTiers(skuKeys, (s) => skuVelocity.get(s) ?? 0, true);

  // 4. Score every occupied slot.
  const slotQuality = new Map<string, Quality>();
  let totalDist = 0;
  let count = 0;
  let wouldMove = 0;
  let aTotal = 0;
  let aPlaced = 0;

  for (const [slotId, pallet] of state.slots) {
    const d = slotDist.get(slotId);
    const st = slotTier.get(slotId);
    if (d === undefined || st === undefined) continue;

    totalDist += d;
    count++;

    const kt: Tier = skuTier.get(pallet.sku) ?? 'C';
    if (kt === 'A') {
      aTotal++;
      if (st === 'A') aPlaced++;
    }

    const sv = TIER_VALUE[kt];
    const stv = TIER_VALUE[st];
    if (sv === stv) {
      slotQuality.set(slotId, 'good');
    } else if (sv > stv) {
      slotQuality.set(slotId, 'misplaced');
      wouldMove++;
    } else {
      slotQuality.set(slotId, 'wasted');
      wouldMove++;
    }
  }

  return {
    slotQuality,
    kpis: {
      aPlacedPct: aTotal > 0 ? (aPlaced / aTotal) * 100 : 0,
      avgPickDistance: count > 0 ? totalDist / count : 0,
      wouldMove,
      totalPalletCount: count,
    },
  };
}
