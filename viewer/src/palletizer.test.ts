import { describe, it, expect } from 'vitest';
import {
  planStack,
  pickBoxForSku,
  BOX_SPECS,
  PALLET_W,
  PALLET_D,
} from './palletizer';

describe('palletizer', () => {
  it('returns a valid plan for any SKU', () => {
    for (let i = 1; i <= 50; i++) {
      const sku = `N${String(i).padStart(3, '0')}`;
      const plan = planStack(20, sku);
      expect(plan.totalPlaced).toBeGreaterThan(0);
      expect(plan.totalPlaced).toBeLessThanOrEqual(20);
      expect(['pinwheel', 'split-block', 'column']).toContain(plan.pattern);
      expect(['A', 'B']).toContain(plan.orientation);
      expect(plan.boxesPerLayer).toBeGreaterThan(0);
    }
  });

  it('is deterministic for a given SKU', () => {
    const a = planStack(30, 'N007');
    const b = planStack(30, 'N007');
    expect(a.pattern).toBe(b.pattern);
    expect(a.boxesPerLayer).toBe(b.boxesPerLayer);
    expect(a.placements.length).toBe(b.placements.length);
  });

  it('never places more boxes than requested', () => {
    for (const target of [1, 5, 15, 50, 200]) {
      const plan = planStack(target, 'N025');
      expect(plan.totalPlaced).toBeLessThanOrEqual(target);
    }
  });

  it('all placements fit within pallet footprint', () => {
    for (let i = 1; i <= 20; i++) {
      const sku = `N${String(i).padStart(3, '0')}`;
      const plan = planStack(50, sku);
      for (const p of plan.placements) {
        expect(p.x).toBeGreaterThanOrEqual(-0.5);
        expect(p.y).toBeGreaterThanOrEqual(-0.5);
        expect(p.x + p.width).toBeLessThanOrEqual(PALLET_W + 0.5);
        expect(p.y + p.depth).toBeLessThanOrEqual(PALLET_D + 0.5);
        expect(p.z).toBeGreaterThanOrEqual(0);
        expect(p.width).toBeGreaterThan(0);
        expect(p.depth).toBeGreaterThan(0);
        expect(p.height).toBeGreaterThan(0);
      }
    }
  });

  it('all box specs are valid', () => {
    for (const box of BOX_SPECS) {
      expect(box.width).toBeGreaterThan(0);
      expect(box.depth).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
      expect(box.width).toBeLessThanOrEqual(PALLET_W);
      expect(box.depth).toBeLessThanOrEqual(PALLET_D);
    }
  });

  it('picks the same box for the same SKU', () => {
    expect(pickBoxForSku('N001').id).toBe(pickBoxForSku('N001').id);
    expect(pickBoxForSku('N025').id).toBe(pickBoxForSku('N025').id);
    expect(pickBoxForSku('N050').id).toBe(pickBoxForSku('N050').id);
  });
});
