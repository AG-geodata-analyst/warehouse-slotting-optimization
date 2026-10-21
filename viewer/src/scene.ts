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

const PALLET_COLOR = 0xd68a3a;

export interface SceneHandle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  updatePallets: (state: WarehouseState) => void;
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

  // Pallets will be added by `attachWarehouse`
  const placeholder = () => {};
  return {
    renderer,
    scene,
    camera,
    controls,
    updatePallets: placeholder,
  };
}

/**
 * Build the warehouse (slots + pallets) and return an `updatePallets`
 * callback that changes which slots are occupied by pallets.
 */
export function attachWarehouse(
  handle: SceneHandle,
  layout: WarehouseLayout,
): void {
  const { scene } = handle;

  const totalSlots = layout.racks.reduce((n, r) => n + r.slots.length, 0);

  // ─── Slot mesh ──────────────────────────────────────────────────────────
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

  // ─── Pallet mesh ────────────────────────────────────────────────────────
  const palletGeom = new THREE.BoxGeometry(
    SLOT_WIDTH_M * 0.70,
    SLOT_HEIGHT_M * 0.70,
    SLOT_DEPTH_M * 0.70,
  );
  const palletMat = new THREE.MeshStandardMaterial({
    color: PALLET_COLOR,
    roughness: 0.85,
    metalness: 0.0,
  });
  const palletMesh = new THREE.InstancedMesh(
    palletGeom,
    palletMat,
    totalSlots,
  );
  palletMesh.count = 0;
  scene.add(palletMesh);

  const palletDummy = new THREE.Object3D();

  const updatePallets = (state: WarehouseState): void => {
    let n = 0;
    for (const [slotId] of state.slots) {
      const pos = slotPositions.get(slotId);
      if (!pos) continue;
      palletDummy.position.copy(pos);
      palletDummy.updateMatrix();
      palletMesh.setMatrixAt(n, palletDummy.matrix);
      n++;
    }
    palletMesh.count = n;
    palletMesh.instanceMatrix.needsUpdate = true;
  };

  handle.updatePallets = updatePallets;
}
