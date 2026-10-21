import type { Bootstrap, Day, Pallet } from './types';

/** Warehouse state at a given moment: slot_id → Pallet. */
export interface WarehouseState {
  slots: Map<string, Pallet>;
  /** pallet_id → number of days this pallet has been in the warehouse. */
  ageDays: Map<string, number>;
}

/**
 * `baselineAge` = days between manifest.genesis and bootstrap.as_of.
 * Bootstrap pallets have been sitting in the warehouse at least that long,
 * so we start their counter there instead of at 0 (which would falsely
 * show them as brand-new on the oldest visible day).
 */
export function bootstrapState(b: Bootstrap, baselineAge = 0): WarehouseState {
  const slots = new Map<string, Pallet>();
  const ageDays = new Map<string, number>();
  for (const p of b.pallets) {
    if (p.slot_id) {
      slots.set(p.slot_id, p);
      ageDays.set(p.id, baselineAge);
    }
  }
  return { slots, ageDays };
}

/**
 * Apply one day's events to a state and return a NEW state.
 * Order matches the Python pipeline: all outbound removals, then all
 * inbound additions.
 */
export function applyDay(state: WarehouseState, day: Day): WarehouseState {
  const newSlots = new Map(state.slots);
  const newAgeDays = new Map<string, number>();

  // 1. Increment age of every pallet currently present
  for (const pallet of state.slots.values()) {
    newAgeDays.set(pallet.id, (state.ageDays.get(pallet.id) ?? 0) + 1);
  }

  // 2. Remove pallets that shipped out
  const idsToRemove = new Set<string>();
  for (const ev of day.outbound) {
    for (const pid of ev.pallet_ids) idsToRemove.add(pid);
  }
  for (const [slotId, pallet] of newSlots.entries()) {
    if (idsToRemove.has(pallet.id)) {
      newSlots.delete(slotId);
      newAgeDays.delete(pallet.id);
    }
  }

  // 3. Add inbound pallets (age 0 — they arrive "today")
  for (const ev of day.inbound) {
    for (const p of ev.pallets) {
      if (p.slot_id) {
        newSlots.set(p.slot_id, p);
        newAgeDays.set(p.id, 0);
      }
    }
  }

  return { slots: newSlots, ageDays: newAgeDays };
}

/**
 * Pre-compute the state at every day in the window.
 * `states[i]` = state at end of day `days[i]`.
 */
export function buildTimeline(
  bootstrap: Bootstrap,
  days: Day[],
  baselineAge = 0,
): WarehouseState[] {
  const states: WarehouseState[] = [];
  let state = bootstrapState(bootstrap, baselineAge);
  for (const day of days) {
    state = applyDay(state, day);
    states.push(state);
  }
  return states;
}

// ─── Movement analytics ────────────────────────────────────────────────

export interface MovementInsights {
  /** SKUs ranked as fastest movers within the analysis window. */
  fastSkus: Set<string>;
  /** Ordered list of the chosen fast-mover SKUs. */
  topSkus: string[];
  windowDays: number;
  topN: number;
}

/**
 * Rank SKUs by outbound pallet count over the last `windowDays` days
 * and return the top `topN` as the "fast mover" set.
 * Pallet→SKU is reconstructed from bootstrap + every inbound event,
 * because outbound events only carry pallet ids.
 */
export function analyzeMovement(
  bootstrap: Bootstrap,
  days: Day[],
  windowDays = 14,
  topN = 5,
): MovementInsights {
  const skuByPallet = new Map<string, string>();
  for (const p of bootstrap.pallets) skuByPallet.set(p.id, p.sku);
  for (const day of days) {
    for (const ev of day.inbound) {
      for (const p of ev.pallets) skuByPallet.set(p.id, p.sku);
    }
  }

  const startIdx = Math.max(0, days.length - windowDays);
  const tally = new Map<string, number>();
  for (let i = startIdx; i < days.length; i++) {
    for (const ev of days[i].outbound) {
      for (const pid of ev.pallet_ids) {
        const sku = skuByPallet.get(pid);
        if (!sku) continue;
        tally.set(sku, (tally.get(sku) ?? 0) + 1);
      }
    }
  }

  const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  const topSkus = sorted.slice(0, topN).map(([s]) => s);
  return { fastSkus: new Set(topSkus), topSkus, windowDays, topN };
}
