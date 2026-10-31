import type { WarehouseLayout } from './types';
import type { WarehouseState } from './replay';
import { analyzePlacement } from './slotting';
import { planStack, PATTERN_LABEL, type PatternId } from './palletizer';

interface FloorStats { count: number; sumDist: number; }

interface CachedData {
  occupancyTrend: number[];
  strandedTrend: number[];
  qualityPerDay: Array<{ good: number; wasted: number; misplaced: number }>;
  floorTrend: Array<Record<string, FloorStats>>;
  patternTrend: Array<Record<PatternId, number>>;
}

let cached: CachedData | null = null;
let panelEl: HTMLDivElement | null = null;
let bodyEl: HTMLDivElement | null = null;
let isExpanded = true;

const DISPATCH_X = 0;
const DISPATCH_Z = 0;
const SLOT_WIDTH_M = 1.2;

function getSkuPattern(sku: string, cache: Map<string, PatternId>): PatternId {
  let p = cache.get(sku);
  if (!p) {
    p = planStack(1, sku).pattern;
    cache.set(sku, p);
  }
  return p;
}

/**
 * Compute all 30 days once at load. Called from main.ts after
 * computeSkuVelocity(). All subsequent updateKpiPanel(i) calls just
 * index into cached arrays — cheap and instant.
 */
export function precomputeKpis(
  timeline: WarehouseState[],
  layout: WarehouseLayout,
  skuVelocity: Map<string, number>,
): void {
  const slotFloor = new Map<string, string>();
  const slotDist = new Map<string, number>();
  for (const rack of layout.racks) {
    for (const slot of rack.slots) {
      slotFloor.set(slot.id, rack.floor);
      const x = rack.x + (slot.bay - 1) * SLOT_WIDTH_M;
      const z = rack.y;
      const dx = x - DISPATCH_X;
      const dz = z - DISPATCH_Z;
      slotDist.set(slot.id, Math.sqrt(dx * dx + dz * dz));
    }
  }

  const occupancyTrend: number[] = [];
  const strandedTrend: number[] = [];
  const qualityPerDay: CachedData['qualityPerDay'] = [];
  const floorTrend: CachedData['floorTrend'] = [];
  const patternTrend: CachedData['patternTrend'] = [];
  const skuPattern = new Map<string, PatternId>();

  for (const state of timeline) {
    occupancyTrend.push(state.slots.size);

    const analysis = analyzePlacement(state, layout, skuVelocity);
    strandedTrend.push(analysis.kpis.stranded);

    let good = 0, wasted = 0, misplaced = 0;
    for (const q of analysis.slotQuality.values()) {
      if (q === 'good') good++;
      else if (q === 'wasted') wasted++;
      else misplaced++;
    }
    qualityPerDay.push({ good, wasted, misplaced });

    const floors: Record<string, FloorStats> = {};
    for (const floor of layout.floors) floors[floor] = { count: 0, sumDist: 0 };
    for (const slotId of state.slots.keys()) {
      const f = slotFloor.get(slotId);
      if (!f) continue;
      floors[f].count++;
      floors[f].sumDist += slotDist.get(slotId) ?? 0;
    }
    floorTrend.push(floors);

    const patCount: Record<PatternId, number> = {
      pinwheel: 0, 'split-block': 0, column: 0,
    };
    for (const pallet of state.slots.values()) {
      patCount[getSkuPattern(pallet.sku, skuPattern)]++;
    }
    patternTrend.push(patCount);
  }

  cached = { occupancyTrend, strandedTrend, qualityPerDay, floorTrend, patternTrend };
}

export function initKpiPanel(): void {
  if (panelEl) return;

  panelEl = document.createElement('div');
  panelEl.id = 'kpi-panel';
  panelEl.style.cssText =
    'position:fixed;left:20px;top:200px;width:320px;' +
    'background:rgba(20,20,20,0.95);border:1px solid #2a2a2a;border-radius:6px;' +
    'color:#eee;font-family:system-ui,sans-serif;font-size:12px;z-index:90;' +
    'max-height:calc(100vh - 220px);overflow-y:auto;' +
    'box-shadow:0 4px 12px rgba(0,0,0,0.5);';

  const header = document.createElement('div');
  header.style.cssText =
    'padding:10px 14px;cursor:pointer;user-select:none;' +
    'display:flex;justify-content:space-between;align-items:center;' +
    'border-bottom:1px solid #2a2a2a;font-weight:600;';
  header.innerHTML = '<span>📊 KPIs</span><span id="kpi-caret">▾</span>';
  panelEl.appendChild(header);

  bodyEl = document.createElement('div');
  bodyEl.style.cssText = 'padding:12px 14px;';
  panelEl.appendChild(bodyEl);

  document.body.appendChild(panelEl);

  header.addEventListener('click', () => {
    isExpanded = !isExpanded;
    if (bodyEl) bodyEl.style.display = isExpanded ? 'block' : 'none';
    const caret = document.getElementById('kpi-caret');
    if (caret) caret.textContent = isExpanded ? '▾' : '▸';
  });
}

function sparkline(values: number[], currentIdx: number, color: string): string {
  if (values.length === 0) return '';
  const W = 290, H = 44, padX = 4, padY = 6;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = (W - 2 * padX) / Math.max(1, values.length - 1);

  const pts: string[] = [];
  for (let i = 0; i < values.length; i++) {
    const x = padX + i * stepX;
    const y = H - padY - ((values[i] - min) / range) * (H - 2 * padY);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  const linePath = `M ${pts.join(' L ')}`;
  const cx = padX + currentIdx * stepX;
  const cy = H - padY - ((values[currentIdx] - min) / range) * (H - 2 * padY);

  return (
    `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block">` +
    `<path d="${linePath}" fill="none" stroke="${color}" stroke-width="1.5" />` +
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3" fill="${color}" />` +
    `</svg>`
  );
}

function section(title: string, body: string): string {
  return (
    `<div style="margin-bottom:14px">` +
    `<div style="font-size:10px;text-transform:uppercase;opacity:0.6;` +
    `margin-bottom:6px;letter-spacing:0.5px">${title}</div>` +
    body +
    `</div>`
  );
}

export function updateKpiPanel(currentIndex: number): void {
  if (!panelEl || !bodyEl || !cached || !isExpanded) return;

  const c = cached;
  const occupancy = c.occupancyTrend;
  const stranded = c.strandedTrend;
  const quality = c.qualityPerDay[currentIndex] ?? { good: 0, wasted: 0, misplaced: 0 };
  const floors = c.floorTrend[currentIndex] ?? {};
  const patterns = c.patternTrend[currentIndex] ?? { pinwheel: 0, 'split-block': 0, column: 0 };

  const currOcc = occupancy[currentIndex] ?? 0;
  const currStranded = stranded[currentIndex] ?? 0;

  const qTotal = quality.good + quality.wasted + quality.misplaced || 1;
  const goodPct = (quality.good / qTotal) * 100;
  const wastedPct = (quality.wasted / qTotal) * 100;
  const misPct = (quality.misplaced / qTotal) * 100;

  const qualityBar =
    `<div style="display:flex;height:16px;border-radius:3px;overflow:hidden;margin-bottom:4px">` +
    `<div style="background:#4caf50;width:${goodPct}%"></div>` +
    `<div style="background:#ffb300;width:${wastedPct}%"></div>` +
    `<div style="background:#e53935;width:${misPct}%"></div>` +
    `</div>` +
    `<div style="font-size:10px;display:flex;justify-content:space-between">` +
    `<span style="color:#4caf50">Good ${quality.good}</span>` +
    `<span style="color:#ffb300">Wasted ${quality.wasted}</span>` +
    `<span style="color:#e53935">Misplaced ${quality.misplaced}</span>` +
    `</div>`;

  const floorRows = Object.entries(floors).map(([f, s]) => {
    const avg = s.count > 0 ? (s.sumDist / s.count).toFixed(1) : '—';
    return (
      `<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:11px">` +
      `<span style="font-weight:600;width:36px">${f}</span>` +
      `<span style="opacity:0.7">${s.count} pallets</span>` +
      `<span>avg ${avg} m</span>` +
      `</div>`
    );
  }).join('');

  const patternRows = (['pinwheel', 'split-block', 'column'] as PatternId[]).map(p => {
    const count = patterns[p] || 0;
    const barW = Math.min(100, count * 3);
    return (
      `<div style="display:flex;align-items:center;gap:6px;padding:2px 0;font-size:11px">` +
      `<span style="width:110px;opacity:0.8">${PATTERN_LABEL[p]}</span>` +
      `<div style="flex:1;height:6px;background:#222;border-radius:3px;overflow:hidden">` +
      `<div style="background:#6c9bd1;height:100%;width:${barW}%"></div>` +
      `</div>` +
      `<span style="width:24px;text-align:right">${count}</span>` +
      `</div>`
    );
  }).join('');

  bodyEl.innerHTML =
    section(
      'Occupancy — 30-day trend',
      sparkline(occupancy, currentIndex, '#6c9bd1') +
        `<div style="font-size:10px;opacity:0.7;margin-top:2px">Today: ${currOcc} pallets</div>`,
    ) +
    section('Quality distribution', qualityBar) +
    section('Per floor', floorRows || '<div style="opacity:0.5">—</div>') +
    section(
      'Stranded — 30-day trend',
      sparkline(stranded, currentIndex, '#ff6b6b') +
        `<div style="font-size:10px;opacity:0.7;margin-top:2px">Today: ${currStranded}</div>`,
    ) +
    section('Stacking patterns in use', patternRows);
}
