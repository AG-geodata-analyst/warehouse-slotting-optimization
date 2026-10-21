import { createScene, attachWarehouse, AGE_FRESH_MAX_DAYS, AGE_AGING_MAX_DAYS } from './scene';
import { loadLayout, loadBootstrap, loadManifest, loadAllDays } from './data';
import {
  buildTimeline,
  analyzeMovement,
  type WarehouseState,
} from './replay';

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

// ─── HUD legend ────────────────────────────────────────────────────────
function legendHtml(fastCount: number, windowDays: number): string {
  const aging = AGE_FRESH_MAX_DAYS + 1;
  const old = AGE_AGING_MAX_DAYS + 1;
  return (
    `<div style="margin-top:10px;border-top:1px solid #2a2a2a;padding-top:8px">` +
    `<div style="font-size:11px;opacity:0.7;margin-bottom:6px">Pallet age</div>` +
    `<div style="display:flex;flex-direction:column;gap:3px;font-size:11px;line-height:1.4">` +
    `<div><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#fff;border:2px solid #000;margin-right:8px;vertical-align:middle"></span>Fresh · 0–${AGE_FRESH_MAX_DAYS}d</div>` +
    `<div><span style="display:inline-block;width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:12px solid #fff;filter:drop-shadow(0 0 1px #000) drop-shadow(0 0 1px #000);margin-right:8px;vertical-align:middle"></span>Aging · ${aging}–${AGE_AGING_MAX_DAYS}d</div>` +
    `<div><span style="display:inline-block;font-weight:bold;font-size:14px;line-height:12px;margin-right:8px;vertical-align:middle">✕</span>Old · ${old}d+</div>` +
    `</div>` +
    `<div style="margin-top:8px;font-size:11px;opacity:0.75">` +
    `<span style="display:inline-block;width:12px;height:12px;border:2px solid #ffe066;` +
    `border-radius:2px;margin-right:6px;vertical-align:middle"></span>` +
    `Fast mover · top ${fastCount} SKU${fastCount === 1 ? '' : 's'} ` +
    `by ${windowDays}-day outbound` +
    `</div>` +
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

    // Baseline age for bootstrap pallets = days between genesis and as_of.
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

    if (daySlider) {
      daySlider.min = '0';
      daySlider.max = String(days.length - 1);
      daySlider.value = String(days.length - 1);
    }

    let currentIndex = days.length - 1;

    const showDay = (index: number): void => {
      currentIndex = index;
      const state = timeline[index];
      handle.updatePallets(state, insights.fastSkus);
      if (dayLabel) dayLabel.textContent = days[index].date;
      if (dayPallets) dayPallets.textContent = `${state.slots.size} pallets`;
      if (hud) {
        const pct = Math.round((state.slots.size / slotCount) * 100);
        hud.innerHTML =
          `<strong>Warehouse</strong> · ${layout.floors.length} floors · ` +
          `${layout.racks.length} racks · ${slotCount} slots<br>` +
          `<strong>State</strong> · ${state.slots.size} pallets · ${pct}% occupied<br>` +
          `<span style="font-size:11px;opacity:0.7">drag to orbit · scroll to zoom · right-drag to pan</span>` +
          legendHtml(insights.topSkus.length, insights.windowDays);
      }
    };

    if (dayControls) dayControls.style.display = 'flex';

    // ─── Play / pause button ─────────────────────────────────────────
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
        }, 700);
      } else {
        playBtn.textContent = '▶ Play month';
        if (playTimer !== null) {
          window.clearInterval(playTimer);
          playTimer = null;
        }
      }
    };
    playBtn.addEventListener('click', () => setPlaying(playTimer === null));

    if (daySlider) {
      daySlider.addEventListener('input', () => {
        setPlaying(false);
        showDay(parseInt(daySlider.value, 10));
      });
    }

    // Initial render at newest day
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
