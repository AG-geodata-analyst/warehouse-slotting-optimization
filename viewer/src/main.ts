import { createScene, attachWarehouse, AGE_FRESH_MAX_DAYS, AGE_AGING_MAX_DAYS } from './scene';
import { loadLayout, loadBootstrap, loadManifest, loadAllDays } from './data';
import { buildTimeline, analyzeMovement, type WarehouseState } from './replay';
import { analyzePlacement, computeSkuVelocity } from './slotting';
import { openPanel, closePanel, bindPanelEvents, isPanelOpen } from './detail-panel';

const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
if (!canvas) throw new Error('canvas#scene not found');

const handle = createScene(canvas);
const { renderer, scene, camera, controls } = handle;

function animate(): void {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

function legendHtml(
  fastCount: number,
  windowDays: number,
  qualityMode: boolean,
): string {
  const aging = AGE_FRESH_MAX_DAYS + 1;
  const old = AGE_AGING_MAX_DAYS + 1;

  const ageBlock =
    `<div style="font-size:11px;opacity:0.7;margin-bottom:6px">Pallet age</div>` +
    `<div style="display:flex;flex-direction:column;gap:3px;font-size:11px;line-height:1.4">` +
    `<div><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#fff;margin-right:8px;vertical-align:middle"></span>Fresh · 0–${AGE_FRESH_MAX_DAYS}d</div>` +
    `<div><span style="display:inline-block;width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:12px solid #fff;margin-right:8px;vertical-align:middle"></span>Aging · ${aging}–${AGE_AGING_MAX_DAYS}d</div>` +
    `<div><span style="display:inline-block;font-weight:bold;font-size:14px;line-height:12px;margin-right:8px;vertical-align:middle">✕</span>Old · ${old}d+</div>` +
    `</div>`;

  const footer = qualityMode
    ? `<div style="margin-top:10px;font-size:11px;opacity:0.7;margin-bottom:6px">Placement quality (ABC)</div>` +
      `<div style="font-size:10px;opacity:0.65;margin-bottom:6px;line-height:1.35">` +
      `Pallets are tiered A/B/C by SKU velocity (30-day outbound). Slots are tiered A/B/C by distance from dispatch (0,0).<br>` +
      `<strong>Good</strong> = pallet tier matches slot tier.<br>` +
      `<strong>Wasted</strong> = slow mover in a prime slot (blocking a fast SKU).<br>` +
      `<strong>Misplaced</strong> = fast mover sits too far from dispatch.` +
      `</div>` +
      `<div style="display:flex;flex-direction:column;gap:3px;font-size:11px;line-height:1.4">` +
      `<div><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:#4caf50;margin-right:8px;vertical-align:middle"></span>Good</div>` +
      `<div><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:#ffb300;margin-right:8px;vertical-align:middle"></span>Wasted</div>` +
      `<div><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:#e53935;margin-right:8px;vertical-align:middle"></span>Misplaced</div>` +
      `</div>` +
      `<div style="margin-top:10px;font-size:11px;opacity:0.7;margin-bottom:4px">Metrics (top of HUD)</div>` +
      `<div style="font-size:10px;opacity:0.65;line-height:1.35">` +
      `<strong>% A-placed</strong> · share of A-tier pallets currently in an A-tier slot.<br>` +
      `<strong>avg distance</strong> · mean straight-line distance (m) from dispatch (0,0) to each pallet's slot.<br>` +
      `<strong>would move</strong> · pallets whose tier doesn't match their slot's tier (wasted + misplaced).<br>` +
      `<strong style="color:#ff6b6b">stranded</strong> · fast movers (A-tier) stuck in bad slots for ≥15 days — highest-priority moves to fix.` +
      `</div>` +
      `<div style="margin-top:8px;font-size:10px;opacity:0.5">Click any pallet to inspect stacking · Esc to close</div>`
    : `<div style="margin-top:8px;font-size:11px;opacity:0.75">` +
      `<span style="display:inline-block;width:12px;height:12px;background:#d94a4a;border-radius:2px;margin-right:6px;vertical-align:middle"></span>` +
      `Fast mover · top ${fastCount} SKU${fastCount === 1 ? '' : 's'} by ${windowDays}-day outbound` +
      `</div>` +
      `<div style="margin-top:8px;font-size:10px;opacity:0.5">Click any pallet to inspect stacking · Esc to close</div>`;

  return (
    `<div style="margin-top:10px;border-top:1px solid #2a2a2a;padding-top:8px">` +
    ageBlock + footer +
    `</div>`
  );
}

async function init(): Promise<void> {
  const hud = document.getElementById('hud');
  const dayControls = document.getElementById('day-controls') as HTMLElement | null;
  const daySlider = document.getElementById('day-slider') as HTMLInputElement | null;
  const dayLabel = document.getElementById('day-label');
  const dayPallets = document.getElementById('day-pallets');

  try {
    const [layout, bootstrap, manifest] = await Promise.all([
      loadLayout(),
      loadBootstrap(),
      loadManifest(),
    ]);
    const days = await loadAllDays(manifest);

    const slotCount = layout.racks.reduce((n, r) => n + r.slots.length, 0);
    console.log(
      `[viewer] layout v${layout.version}: ${layout.floors.length} floors, ` +
      `${layout.racks.length} racks, ${slotCount} slots`,
    );
    console.log(
      `[viewer] bootstrap ${bootstrap.pallets.length} pallets ` +
      `as of ${bootstrap.as_of}, ${days.length} days loaded`,
    );

    attachWarehouse(handle, layout);

    const genesisMs = Date.parse(manifest.genesis);
    const bootstrapMs = Date.parse(bootstrap.as_of);
    const baselineAge = Number.isFinite(genesisMs) && Number.isFinite(bootstrapMs)
      ? Math.max(0, Math.round((bootstrapMs - genesisMs) / 86_400_000))
      : 0;

    const timeline: WarehouseState[] = buildTimeline(bootstrap, days, baselineAge);

    const insights = analyzeMovement(bootstrap, days, 14, 5);
    console.log(
      `[viewer] fast movers (top ${insights.topN} by ` +
      `${insights.windowDays}-day outbound): ${insights.topSkus.join(', ')}`,
    );

    const skuVelocity = computeSkuVelocity(bootstrap, days);
    console.log(
      `[viewer] SKU velocity computed for ${skuVelocity.size} SKUs (full ${days.length}-day window)`,
    );

    if (daySlider) {
      daySlider.min = '0';
      daySlider.max = String(days.length - 1);
      daySlider.value = String(days.length - 1);
    }

    let currentIndex = days.length - 1;
    let qualityOn = true;
    let boxesMode = false;

    const showDay = (index: number): void => {
      currentIndex = index;
      const state = timeline[index];
      const analysis = qualityOn ? analyzePlacement(state, layout, skuVelocity) : null;
      handle.updatePallets(state, insights.fastSkus, analysis?.slotQuality ?? null, boxesMode);

      if (dayLabel) dayLabel.textContent = days[index].date;
      if (dayPallets) dayPallets.textContent = `${state.slots.size} pallets`;

      if (hud) {
        const pct = Math.round((state.slots.size / slotCount) * 100);
        let qualityKpi = '';
        if (analysis) {
          const { aPlacedPct, avgPickDistance, wouldMove, stranded } = analysis.kpis;
          const strandedPart =
            stranded > 0
              ? ` · <span style="color:#ff6b6b;font-weight:600">${stranded} stranded</span>`
              : ` · <span style="color:#666">0 stranded</span>`;
          qualityKpi =
            `<strong>Quality</strong> · ${aPlacedPct.toFixed(0)}% A-placed · ` +
            `avg ${avgPickDistance.toFixed(1)} m · ${wouldMove} would move` +
            `${strandedPart}<br>`;
        }
        hud.innerHTML =
          `<strong>Warehouse</strong> · ${layout.floors.length} floors · ` +
          `${layout.racks.length} racks · ${slotCount} slots<br>` +
          `<strong>State</strong> · ${state.slots.size} pallets · ${pct}% occupied<br>` +
          qualityKpi +
          `<span style="font-size:11px;opacity:0.7">drag to orbit · scroll to zoom · right-drag to pan</span>` +
          legendHtml(insights.topSkus.length, insights.windowDays, qualityOn);
      }

      if (isPanelOpen()) closePanel();
    };

    if (dayControls) dayControls.style.display = 'flex';

    // ─── Play / pause ────────────────────────────────────────────────
    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.textContent = '▶ Play month';
    playBtn.style.cssText =
      'margin-left:8px;padding:4px 10px;border-radius:4px;' +
      'border:1px solid #555;background:#1e1e1e;color:#eee;' +
      'font:inherit;cursor:pointer;';
    dayControls?.appendChild(playBtn);

    let playTimer: number | null = null;
    const setPlaying = (playing: boolean): void => {
      if (playing) {
        playBtn.textContent = '⏸ Pause';
        if (playTimer !== null) return;
        playTimer = window.setInterval(() => {
          if (!daySlider) return;
          const next = (currentIndex + 1) % days.length;
          daySlider.value = String(next);
          showDay(next);
        }, 1300);
      } else {
        playBtn.textContent = '▶ Play month';
        if (playTimer !== null) {
          window.clearInterval(playTimer);
          playTimer = null;
        }
      }
    };
    playBtn.addEventListener('click', () => setPlaying(playTimer === null));

    // ─── Quality toggle ──────────────────────────────────────────────
    const qualityBtn = document.createElement('button');
    qualityBtn.type = 'button';
    qualityBtn.textContent = 'Quality: On';
    qualityBtn.style.cssText =
      'margin-left:8px;padding:4px 10px;border-radius:4px;' +
      'border:1px solid #4caf50;background:#2e4a2e;color:#eee;' +
      'font:inherit;cursor:pointer;';
    dayControls?.appendChild(qualityBtn);

    qualityBtn.addEventListener('click', () => {
      qualityOn = !qualityOn;
      qualityBtn.textContent = `Quality: ${qualityOn ? 'On' : 'Off'}`;
      qualityBtn.style.background = qualityOn ? '#2e4a2e' : '#1e1e1e';
      qualityBtn.style.borderColor = qualityOn ? '#4caf50' : '#555';
      showDay(currentIndex);
    });

    // ─── Boxes view toggle ──────────────────────────────────────────
    const boxesViewBtn = document.createElement('button');
    boxesViewBtn.type = 'button';
    boxesViewBtn.textContent = 'View: Blocks';
    boxesViewBtn.style.cssText =
      'margin-left:8px;padding:4px 10px;border-radius:4px;' +
      'border:1px solid #555;background:#1e1e1e;color:#eee;' +
      'font:inherit;cursor:pointer;';
    dayControls?.appendChild(boxesViewBtn);

    boxesViewBtn.addEventListener('click', () => {
      boxesMode = !boxesMode;
      boxesViewBtn.textContent = `View: ${boxesMode ? 'Boxes' : 'Blocks'}`;
      boxesViewBtn.style.background = boxesMode ? '#3a2e4a' : '#1e1e1e';
      boxesViewBtn.style.borderColor = boxesMode ? '#8a6ea5' : '#555';
      showDay(currentIndex);
    });

    if (daySlider) {
      daySlider.addEventListener('input', () => {
        setPlaying(false);
        showDay(parseInt(daySlider.value, 10));
      });
    }

    // ─── Pallet click → detail panel ────────────────────────────────
    bindPanelEvents();

    let downX = 0;
    let downY = 0;
    canvas!.addEventListener('pointerdown', (e) => {
      downX = e.clientX;
      downY = e.clientY;
    });
    canvas!.addEventListener('pointerup', (e) => {
      const dx = e.clientX - downX;
      const dy = e.clientY - downY;
      if (Math.sqrt(dx * dx + dy * dy) > 5) return;  // drag, not click
      const slotId = handle.pickPallet(e.clientX, e.clientY);
      if (!slotId) {
        if (isPanelOpen()) closePanel();
        return;
      }
      const state = timeline[currentIndex];
      const pallet = state.slots.get(slotId);
      if (!pallet) return;
      const analysis = qualityOn ? analyzePlacement(state, layout, skuVelocity) : null;
      openPanel({
        slotId,
        pallet,
        ageDays: state.ageDays.get(pallet.id) ?? 0,
        quality: analysis?.slotQuality.get(slotId),
        slotColor: handle.getSlotColor(slotId),
      });
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isPanelOpen()) closePanel();
    });

    // Initial render
    showDay(days.length - 1);
  } catch (err) {
    console.error(err);
    if (hud) hud.textContent = `Error: ${(err as Error).message}`;
  }
}
init();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
