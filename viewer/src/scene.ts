import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { WarehouseLayout } from './types';
import type { WarehouseState } from './replay';

const SLOT_WIDTH_M = 1.2;
const SLOT_DEPTH_M = 1.0;
const SLOT_HEIGHT_M = 1.6;
const FLOOR_HEIGHT_M = 5.0;

const SLOT_BOX_SCALE = 0.85;
const PALLET_BOX_SCALE = 0.70;

// Base floor colours — slot mesh uses these directly; pallets use brightened siblings.
const FLOOR_COLORS: Record<string, number> = {
  B1: 0x3b5b7a,
  '1F': 0x5c9b76,
  '2F': 0x9b7a5c,
};

// Age thresholds — tune freely.
export const AGE_FRESH_MAX_DAYS = 7;    // 0–7d   → ●
export const AGE_AGING_MAX_DAYS = 14;   // 8–14d  → ▲
                                         // 15+d   → ✕

// Fast-mover pallet tint.
const FAST_MOVER_PALLET = 0xd94a4a;

// Symbol plane geometry.
const SYMBOL_SIZE = 0.28;
const SYMBOL_INSET = 0.02;
const SYMBOL_OPACITY = 0.88;

export interface SceneHandle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  updatePallets: (state: WarehouseState, fastSkus: Set<string>) => void;
}

function makeSymbolTexture(kind: 'fresh' | 'aging' | 'old'): THREE.CanvasTexture {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';

  if (kind === 'fresh') {
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 18, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'aging') {
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(S / 2, 20);
    ctx.lineTo(S - 20, S - 24);
    ctx.lineTo(20, S - 24);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.lineCap = 'round';
    ctx.lineWidth = 18;
    const m = 32;
    const n = S - 32;
    ctx.beginPath();
    ctx.moveTo(m, m); ctx.lineTo(n, n);
    ctx.moveTo(n, m); ctx.lineTo(m, n);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/** Brighter / more saturated sibling of a base colour. */
function brighten(base: THREE.Color): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  return new THREE.Color().setHSL(
    hsl.h,
    Math.min(1, hsl.s * 1.15),
    Math.min(0.78, hsl.l + 0.22),
  );
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
    SLOT_WIDTH_M * SLOT_BOX_SCALE,
    SLOT_HEIGHT_M * SLOT_BOX_SCALE,
    SLOT_DEPTH_M * SLOT_BOX_SCALE,
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
  const slotPositions = new Map<string, THREE.Vector3>();
  const slotPalletColors = new Map<string, THREE.Color>();

  let idx = 0;
  for (const rack of layout.racks) {
    const floorIndex = layout.floors.indexOf(rack.floor);
    const floorY = (floorIndex - 1) * FLOOR_HEIGHT_M;
    const baseColour = new THREE.Color(FLOOR_COLORS[rack.floor] ?? 0x666666);
    const palletColour = brighten(baseColour);

    for (const slot of rack.slots) {
      const x = rack.x + (slot.bay - 1) * SLOT_WIDTH_M;
      const y = floorY + (slot.level - 1) * SLOT_HEIGHT_M;
      const z = rack.y;

      dummy.position.set(x, y, z);
      dummy.updateMatrix();
      slotMesh.setMatrixAt(idx, dummy.matrix);
      slotMesh.setColorAt(idx, baseColour);

      slotPositions.set(slot.id, new THREE.Vector3(x, y, z));
      slotPalletColors.set(slot.id, palletColour);
      idx++;
    }
  }
  slotMesh.instanceMatrix.needsUpdate = true;
  if (slotMesh.instanceColor) slotMesh.instanceColor.needsUpdate = true;
  scene.add(slotMesh);

  // ─── Pallet mesh (per-slot shade, or red for fast movers) ──────────
  const palletGeom = new THREE.BoxGeometry(
    SLOT_WIDTH_M * PALLET_BOX_SCALE,
    SLOT_HEIGHT_M * PALLET_BOX_SCALE,
    SLOT_DEPTH_M * PALLET_BOX_SCALE,
  );
  const palletMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0.0,
  });
  const palletMesh = new THREE.InstancedMesh(palletGeom, palletMat, totalSlots);
  palletMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(totalSlots * 3),
    3,
  );
  palletMesh.count = 0;
  scene.add(palletMesh);

  // ─── Age symbol planes (one per occupied slot, front-top-right) ────
  const symbolGeom = new THREE.PlaneGeometry(SYMBOL_SIZE, SYMBOL_SIZE);

  const makeSymbolMesh = (kind: 'fresh' | 'aging' | 'old'): THREE.InstancedMesh => {
    const tex = makeSymbolTexture(kind);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: SYMBOL_OPACITY,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    const mesh = new THREE.InstancedMesh(symbolGeom, mat, totalSlots);
    mesh.count = 0;
    mesh.renderOrder = 1;
    return mesh;
  };

  const symbolMeshes: [THREE.InstancedMesh, THREE.InstancedMesh, THREE.InstancedMesh] = [

    makeSymbolMesh('fresh'),
    makeSymbolMesh('aging'),
    makeSymbolMesh('old'),
  ];
  scene.add(symbolMeshes[0], symbolMeshes[1], symbolMeshes[2]);

  const palletDummy = new THREE.Object3D();
  const symbolDummy = new THREE.Object3D();

  // Symbol is anchored to the PALLET's front-top-right corner (not the slot).
  
  const palletHalfW = (SLOT_WIDTH_M * PALLET_BOX_SCALE) / 2;
  const palletHalfH = (SLOT_HEIGHT_M * PALLET_BOX_SCALE) / 2;
  
  const symX = palletHalfW - SYMBOL_SIZE / 2 - SYMBOL_INSET;
  const symY = palletHalfH - SYMBOL_SIZE / 2 - SYMBOL_INSET;

  // Must be > slot front face (slotHalfD = 0.425), otherwise the transparent
  // slot box writes depth and depth-culls the symbol entirely.
  const symZ = (SLOT_DEPTH_M * SLOT_BOX_SCALE) / 2 + 0.02;   // ≈ 0.445

  const fallbackColour = new THREE.Color(0x888888);
  const fastMoverColour = new THREE.Color(FAST_MOVER_PALLET);

  const updatePallets = (
    state: WarehouseState,
    fastSkus: Set<string>,
  ): void => {
    let n = 0;
    const symbolCounts: [number, number, number] = [0, 0, 0];

    for (const [slotId, pallet] of state.slots) {
      const pos = slotPositions.get(slotId);
      if (!pos) continue;

      palletDummy.position.copy(pos);
      palletDummy.updateMatrix();
      palletMesh.setMatrixAt(n, palletDummy.matrix);

      const colour = fastSkus.has(pallet.sku)
        ? fastMoverColour
        : (slotPalletColors.get(slotId) ?? fallbackColour);
      palletMesh.setColorAt(n, colour);
      n++;

      const age = state.ageDays.get(pallet.id) ?? 0;
      const bucket: 0 | 1 | 2 =
        age <= AGE_FRESH_MAX_DAYS ? 0 : age <= AGE_AGING_MAX_DAYS ? 1 : 2;

      symbolDummy.position.set(pos.x + symX, pos.y + symY, pos.z + symZ);
      symbolDummy.rotation.set(0, 0, 0);
      symbolDummy.updateMatrix();
      symbolMeshes[bucket].setMatrixAt(
        symbolCounts[bucket]++,
        symbolDummy.matrix,
      );
    }

    palletMesh.count = n;
    palletMesh.instanceMatrix.needsUpdate = true;
    if (palletMesh.instanceColor) palletMesh.instanceColor.needsUpdate = true;

    for (let b = 0; b < 3; b++) {
      symbolMeshes[b].count = symbolCounts[b];
      symbolMeshes[b].instanceMatrix.needsUpdate = true;
    }
  };

  handle.updatePallets = updatePallets;
}
