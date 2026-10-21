import { createScene, buildWarehouse } from './scene';
import { loadLayout } from './data';

const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
if (!canvas) throw new Error('canvas#scene not found');

const { renderer, scene, camera, controls } = createScene(canvas);

// ─── Render loop ────────────────────────────────────────────────────────────
function animate(): void {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

// ─── Load data and populate the scene ───────────────────────────────────────
async function init(): Promise<void> {
  const hud = document.getElementById('hud');

  try {
    const layout = await loadLayout();

    const slotCount = layout.racks.reduce((sum, r) => sum + r.slots.length, 0);
    console.log(
      `[viewer] layout v${layout.version}: ${layout.floors.length} floors, ` +
      `${layout.racks.length} racks, ${slotCount} slots`
    );

    buildWarehouse(scene, layout);

    if (hud) {
      hud.innerHTML =
        `<strong>Warehouse</strong> · ${layout.floors.length} floors · ` +
        `${layout.racks.length} racks · ${slotCount} slots<br>` +
        `<span style="font-size:11px;opacity:0.7">drag to orbit · scroll to zoom · right-drag to pan</span>`;
    }
  } catch (err) {
    console.error(err);
    if (hud) hud.textContent = `Error: ${(err as Error).message}`;
  }
}
init();

// ─── Handle window resize ───────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
