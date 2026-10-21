import { createScene, attachWarehouse } from './scene';
import { loadLayout, loadBootstrap, loadManifest, loadAllDays } from './data';
import { buildTimeline, type WarehouseState } from './replay';

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

    // Build the static warehouse (slots)
    attachWarehouse(handle, layout);

    // Pre-compute the state at end of every day
    const timeline: WarehouseState[] = buildTimeline(bootstrap, days);

    // Set up the day slider
    if (daySlider) {
      daySlider.min = '0';
      daySlider.max = String(days.length - 1);
      daySlider.value = String(days.length - 1);   // start at newest day
    }

    const showDay = (index: number): void => {
      const state = timeline[index];
      handle.updatePallets(state);
      if (dayLabel) dayLabel.textContent = days[index].date;
      if (dayPallets) dayPallets.textContent = `${state.slots.size} pallets`;
      if (hud) {
        const pct = Math.round((state.slots.size / slotCount) * 100);
        hud.innerHTML =
          `<strong>Warehouse</strong> · ${layout.floors.length} floors · ` +
          `${layout.racks.length} racks · ${slotCount} slots<br>` +
          `<strong>State</strong> · ${state.slots.size} pallets · ${pct}% occupied<br>` +
          `<span style="font-size:11px;opacity:0.7">drag to orbit · scroll to zoom · right-drag to pan</span>`;
      }
    };

    if (dayControls) dayControls.style.display = 'flex';
    if (daySlider) {
      daySlider.addEventListener('input', () => {
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
