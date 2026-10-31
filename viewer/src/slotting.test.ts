import { describe, it, expect } from 'vitest';
import { computeSkuVelocity, analyzePlacement } from './slotting';
import type { Bootstrap, Day, WarehouseLayout } from './types';
import type { WarehouseState } from './replay';

const bootstrap: Bootstrap = {
  version: 1,
  as_of: '2026-01-01',
  pallets: [
    { id: 'P1', sku: 'N001', boxes: 10, gross_weight_kg: 100, slot_id: 'SLOT1' },
    { id: 'P2', sku: 'N002', boxes: 10, gross_weight_kg: 100, slot_id: 'SLOT2' },
  ],
};

const days: Day[] = [
  {
    version: 1,
    date: '2026-01-02',
    seed: 1,
    inbound: [],
    outbound: [{ event_id: 1, time: '10:00:00', pallet_ids: ['P1'] }],
  },
];

const layout: WarehouseLayout = {
  version: 1,
  floors: ['1F'],
  racks: [
    {
      id: 'R1',
      floor: '1F',
      x: 0,
      y: 0,
      slots: [
        {
          id: 'SLOT1', floor: '1F', rack: 'R1',
          level: 1, bay: 1,
          width_cm: 100, depth_cm: 100, height_cm: 100,
          max_weight_kg: 1000, status: 'OCCUPIED',
        },
        {
          id: 'SLOT2', floor: '1F', rack: 'R1',
          level: 1, bay: 2,
          width_cm: 100, depth_cm: 100, height_cm: 100,
          max_weight_kg: 1000, status: 'OCCUPIED',
        },
      ],
    },
  ],
};

describe('slotting', () => {
  it('computeSkuVelocity counts outbound events per SKU', () => {
    const vel = computeSkuVelocity(bootstrap, days);
    expect(vel.get('N001')).toBe(1);
    expect(vel.get('N002')).toBe(0);
  });

  it('computeSkuVelocity includes never-shipped SKUs at 0', () => {
    const vel = computeSkuVelocity(bootstrap, []);
    expect(vel.get('N001')).toBe(0);
    expect(vel.get('N002')).toBe(0);
  });

  it('analyzePlacement returns valid KPIs', () => {
    const state: WarehouseState = {
      slots: new Map([
        ['SLOT1', { id: 'P1', sku: 'N001', boxes: 10, gross_weight_kg: 100, slot_id: 'SLOT1' }],
        ['SLOT2', { id: 'P2', sku: 'N002', boxes: 10, gross_weight_kg: 100, slot_id: 'SLOT2' }],
      ]),
      ageDays: new Map([['P1', 5], ['P2', 5]]),
    };
    const vel = computeSkuVelocity(bootstrap, days);
    const analysis = analyzePlacement(state, layout, vel);
    expect(analysis.kpis.aPlacedPct).toBeGreaterThanOrEqual(0);
    expect(analysis.kpis.aPlacedPct).toBeLessThanOrEqual(100);
    expect(analysis.kpis.avgPickDistance).toBeGreaterThanOrEqual(0);
    expect(analysis.kpis.wouldMove).toBeGreaterThanOrEqual(0);
    expect(analysis.kpis.stranded).toBeGreaterThanOrEqual(0);
    expect(analysis.slotQuality.size).toBe(2);
  });

  it('slot quality classifies as good/wasted/misplaced', () => {
    const state: WarehouseState = {
      slots: new Map([
        ['SLOT1', { id: 'P1', sku: 'N001', boxes: 10, gross_weight_kg: 100, slot_id: 'SLOT1' }],
        ['SLOT2', { id: 'P2', sku: 'N002', boxes: 10, gross_weight_kg: 100, slot_id: 'SLOT2' }],
      ]),
      ageDays: new Map([['P1', 5], ['P2', 5]]),
    };
    const vel = computeSkuVelocity(bootstrap, days);
    const analysis = analyzePlacement(state, layout, vel);
    for (const q of analysis.slotQuality.values()) {
      expect(['good', 'wasted', 'misplaced']).toContain(q);
    }
  });
});

