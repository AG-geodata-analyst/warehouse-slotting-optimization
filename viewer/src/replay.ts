import type { Bootstrap, Day, Pallet } from './types';

/** Warehouse state at a given moment: slot_id → Pallet. */
export interface WarehouseState {
  slots: Map<string, Pallet>;
}

export function bootstrapState(b: Bootstrap): WarehouseState {
  const slots = new Map<string, Pallet>();
  for (const p of b.pallets) {
    if (p.slot_id) slots.set(p.slot_id, p);
  }
  return { slots };
}

/**
 * Apply one day's events to a state and return a NEW state.
 * Order matches the Python pipeline: all outbound removals, then all
 * inbound additions. This is what the generator does internally.
 */
export function applyDay(state: WarehouseState, day: Day): WarehouseState {
  const newSlots = new Map(state.slots);

  // 1. Remove pallets that shipped out
  const idsToRemove = new Set<string>();
  for (const ev of day.outbound) {
    for (const pid of ev.pallet_ids) idsToRemove.add(pid);
  }
  for (const [slotId, pallet] of newSlots.entries()) {
    if (idsToRemove.has(pallet.id)) newSlots.delete(slotId);
  }

  // 2. Add inbound pallets
  for (const ev of day.inbound) {
    for (const p of ev.pallets) {
      if (p.slot_id) newSlots.set(p.slot_id, p);
    }
  }

  return { slots: newSlots };
}

/**
 * Pre-compute the state at every day in the window.
 * `states[i]` = state at end of day `days[i]`. `states[0]` is what you get
 * after applying days[0] to the bootstrap.
 */
export function buildTimeline(
  bootstrap: Bootstrap,
  days: Day[],
): WarehouseState[] {
  const states: WarehouseState[] = [];
  let state = bootstrapState(bootstrap);
  for (const day of days) {
    state = applyDay(state, day);
    states.push(state);
  }
  return states;
}
