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

// Three age buckets — tune freely.
export const AGE_FRESH_MAX_DAYS = 7;    // 0–7d   → ●
export const AGE_AGING_MAX_DAYS = 14;   // 8–14d  → ▲
                                         // 15+d   → ✕

const FAST_MOVER_COLOR = 0xffe066;

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

  if (kind === 'fresh') {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (kind === 'aging') {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 6;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(S / 2, 22);
    ctx.lineTo(S - 22, S - 28);
    ctx.lineTo(22, S - 28);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    const m = 34;
    const n = S - 34;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 22;
    ctx.beginPath();
    ctx.moveTo(m, m); ctx.lineTo(n, n);
    ctx.moveTo(n, m); ctx.lineTo(m, n);
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 14;
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

  // ─── Pallet mesh (neutral wood color) ───────────────────────────────
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
  const palletMesh = new THREE.InstancedMesh(palletGeom, palletMat, totalSlots);
  palletMesh.count = 0;
  scene.add(palletMesh);

  // ─── Symbol planes (three age buckets) ──────────────────────────────
  const symbolGeom = new THREE.PlaneGeometry(0.35, 0.35);
  const makeSymbolMesh = (kind: 'fresh' | 'aging' | 'old'): THREE.InstancedMesh => {
    const tex = makeSymbolTexture(kind);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
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

  // ─── Fast-mover outline (unchanged) ─────────────────────────────────
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
  const symbolDummy = new THREE.Object3D();
  const frontZ = (SLOT_DEPTH_M * 0.70) / 2 + 0.005;

  const updatePallets = (
    state: WarehouseState,
    fastSkus: Set<string>,
  ): void => {
    let n = 0;
    let fastN = 0;
    const symbolCounts: [number, number, number] = [0, 0, 0];

    for (const [slotId, pallet] of state.slots) {
      const pos = slotPositions.get(slotId);
      if (!pos) continue;

      palletDummy.position.copy(pos);
      palletDummy.updateMatrix();
      palletMesh.setMatrixAt(n++, palletDummy.matrix);

      const age = state.ageDays.get(pallet.id) ?? 0;
      const bucket: 0 | 1 | 2 =
        age <= AGE_FRESH_MAX_DAYS ? 0 : age <= AGE_AGING_MAX_DAYS ? 1 : 2;

      symbolDummy.position.set(pos.x, pos.y, pos.z + frontZ);
      symbolDummy.rotation.set(0, 0, 0);
      symbolDummy.updateMatrix();
      symbolMeshes[bucket].setMatrixAt(
        symbolCounts[bucket]++,
        symbolDummy.matrix,
      );

      if (fastSkus.has(pallet.sku)) {
        outlineMesh.setMatrixAt(fastN++, palletDummy.matrix);
      }
    }

    palletMesh.count = n;
    palletMesh.instanceMatrix.needsUpdate = true;

    for (let b = 0; b < 3; b++) {
      symbolMeshes[b].count = symbolCounts[b];
      symbolMeshes[b].instanceMatrix.needsUpdate = true;
    }

    outlineMesh.count = fastN;
    outlineMesh.instanceMatrix.needsUpdate = true;
  };

  handle.updatePallets = updatePallets;
}
