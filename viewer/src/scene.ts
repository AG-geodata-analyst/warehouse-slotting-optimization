import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { WarehouseLayout } from './types';
import type { WarehouseState } from './replay';

const SLOT_WIDTH_M = 1.2;
const SLOT_DEPTH_M = 1.0;
const SLOT_HEIGHT_M = 1.6;
const FLOOR_HEIGHT_M = 5.0;

const FLOOR_COLORS: Record<string, number> = {
  B1: 0x3b5b7a,
  '1F': 0x5c9b76,
  '2F': 0x9b7a5c,
};

// Age → colour: cyan (fresh) → green → yellow → orange → red (old).
const AGE_FULL_DAYS = 30;
const AGE_FRESH_HUE = 0.55;   // ≈ 198° cyan
const AGE_OLD_HUE   = 0.00;   // ≈   0° red
const AGE_SAT       = 0.75;
const AGE_LIGHT     = 0.55;

const FAST_MOVER_COLOR = 0xffe066;

export interface SceneHandle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  updatePallets: (state: WarehouseState, fastSkus: Set<string>) => void;
}

export function createScene(canvas: HTMLCanvasElement): SceneHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);
  scene.fog = new THREE.Fog(0x111111, 40, 80);

  const camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    200,
  );
  camera.position.set(16, 14, 20);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(5, 0, 5);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.95;
  controls.update();

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
  keyLight.position.set(20, 30, 15);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0x88aaff, 0.35);
  fillLight.position.set(-10, 10, -10);
  scene.add(fillLight);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 1.0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -FLOOR_HEIGHT_M * 1.6;
  scene.add(ground);

  const grid = new THREE.GridHelper(40, 40, 0x333333, 0x1f1f1f);
  grid.position.y = -FLOOR_HEIGHT_M * 1.6 + 0.01;
  scene.add(grid);

  return {
    renderer,
    scene,
    camera,
    controls,
    updatePallets: () => {},
  };
}

export function attachWarehouse(
  handle: SceneHandle,
  layout: WarehouseLayout,
): void {
  const { scene } = handle;
  const totalSlots = layout.racks.reduce((n, r) => n + r.slots.length, 0);

  // ─── Slot mesh ──────────────────────────────────────────────────────
  const slotGeom = new THREE.BoxGeometry(
    SLOT_WIDTH_M * 0.85,
    SLOT_HEIGHT_M * 0.85,
    SLOT_DEPTH_M * 0.85,
  );
  const slotMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.75,
    metalness: 0.05,
    transparent: true,
    opacity: 0.55,
  });
  const slotMesh = new THREE.InstancedMesh(slotGeom, slotMat, totalSlots);
  slotMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(totalSlots * 3),
    3,
  );

  const dummy = new THREE.Object3D();
  const colour = new THREE.Color();
  const slotPositions = new Map<string, THREE.Vector3>();

  let idx = 0;
  for (const rack of layout.racks) {
    const floorIndex = layout.floors.indexOf(rack.floor);
    const floorY = (floorIndex - 1) * FLOOR_HEIGHT_M;

    for (const slot of rack.slots) {
      const x = rack.x + (slot.bay - 1) * SLOT_WIDTH_M;
      const y = floorY + (slot.level - 1) * SLOT_HEIGHT_M;
      const z = rack.y;

      dummy.position.set(x, y, z);
      dummy.updateMatrix();
      slotMesh.setMatrixAt(idx, dummy.matrix);

      colour.setHex(FLOOR_COLORS[rack.floor] ?? 0x666666);
      slotMesh.setColorAt(idx, colour);

      slotPositions.set(slot.id, new THREE.Vector3(x, y, z));
      idx++;
    }
  }
  slotMesh.instanceMatrix.needsUpdate = true;
  if (slotMesh.instanceColor) slotMesh.instanceColor.needsUpdate = true;
  scene.add(slotMesh);

  // ─── Pallet mesh (age-coloured) ─────────────────────────────────────
  const palletGeom = new THREE.BoxGeometry(
    SLOT_WIDTH_M * 0.70,
    SLOT_HEIGHT_M * 0.70,
    SLOT_DEPTH_M * 0.70,
  );
  const palletMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0.0,
  });
  const palletMesh = new THREE.InstancedMesh(
    palletGeom,
    palletMat,
    totalSlots,
  );
  palletMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(totalSlots * 3),
    3,
  );
  palletMesh.count = 0;
  scene.add(palletMesh);

  // ─── Fast-mover outline (back-side rim, pulsing) ────────────────────
  const outlineScale = 1.12;
  const outlineGeom = new THREE.BoxGeometry(
    SLOT_WIDTH_M * 0.70 * outlineScale,
    SLOT_HEIGHT_M * 0.70 * outlineScale,
    SLOT_DEPTH_M * 0.70 * outlineScale,
  );
  const outlineMat = new THREE.MeshBasicMaterial({
    color: FAST_MOVER_COLOR,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  const outlineMesh = new THREE.InstancedMesh(
    outlineGeom,
    outlineMat,
    totalSlots,
  );
  outlineMesh.count = 0;
  outlineMesh.onBeforeRender = () => {
    outlineMat.opacity = 0.75 + 0.15 * Math.sin(performance.now() * 0.003);
  };
  scene.add(outlineMesh);

  const palletDummy = new THREE.Object3D();

  const updatePallets = (
    state: WarehouseState,
    fastSkus: Set<string>,
  ): void => {
    let n = 0;
    let fastN = 0;

    for (const [slotId, pallet] of state.slots) {
      const pos = slotPositions.get(slotId);
      if (!pos) continue;

      palletDummy.position.copy(pos);
      palletDummy.updateMatrix();

      // Pallet matrix + age colour
      palletMesh.setMatrixAt(n, palletDummy.matrix);
      const age = state.ageDays.get(pallet.id) ?? 0;
      const t = Math.min(1, age / AGE_FULL_DAYS);
      const hue = AGE_FRESH_HUE * (1 - t) + AGE_OLD_HUE * t;
      colour.setHSL(hue, AGE_SAT, AGE_LIGHT);
      palletMesh.setColorAt(n, colour);
      n++;

      // Fast-mover outline
      if (fastSkus.has(pallet.sku)) {
        outlineMesh.setMatrixAt(fastN, palletDummy.matrix);
        fastN++;
      }
    }

    palletMesh.count = n;
    palletMesh.instanceMatrix.needsUpdate = true;
    if (palletMesh.instanceColor) palletMesh.instanceColor.needsUpdate = true;

    outlineMesh.count = fastN;
    outlineMesh.instanceMatrix.needsUpdate = true;
  };

  handle.updatePallets = updatePallets;
}
