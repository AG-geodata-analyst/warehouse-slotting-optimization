import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { WarehouseLayout } from './types';
import type { WarehouseState } from './replay';
import type { Quality } from './slotting';
import { planStack, PALLET_W, PALLET_D, PALLET_H } from './palletizer';

const SLOT_WIDTH_M = 1.2;
const SLOT_DEPTH_M = 1.0;
const SLOT_HEIGHT_M = 1.6;
const FLOOR_HEIGHT_M = 5.0;

const SLOT_BOX_SCALE = 0.85;
const PALLET_BOX_SCALE = 0.70;

// Scene-space pallet box dimensions (blocks view).
const PALLET_SCENE_W = SLOT_WIDTH_M * PALLET_BOX_SCALE;
const PALLET_SCENE_H = SLOT_HEIGHT_M * PALLET_BOX_SCALE;
const PALLET_SCENE_D = SLOT_DEPTH_M * PALLET_BOX_SCALE;

// Scaling from plan mm → scene meters.
const BOX_SCALE_X = PALLET_SCENE_W / PALLET_W;
const BOX_SCALE_Y = PALLET_SCENE_H / PALLET_H;
const BOX_SCALE_Z = PALLET_SCENE_D / PALLET_D;

// Conservative max boxes per pallet (column pattern on Rect S tops out at 160).
const MAX_BOXES_PER_PALLET = 200;

const FLOOR_COLORS: Record<string, number> = {
  B1: 0x3b5b7a,
  '1F': 0x5c9b76,
  '2F': 0x9b7a5c,
};

export const AGE_FRESH_MAX_DAYS = 7;
export const AGE_AGING_MAX_DAYS = 14;

const FAST_MOVER_PALLET = 0xd94a4a;

const QUALITY_COLOURS: Record<Quality, number> = {
  good: 0x4caf50,
  misplaced: 0xe53935,
  wasted: 0xffb300,
};

const SYMBOL_SIZE = 0.28;
const SYMBOL_INSET = 0.02;
const SYMBOL_OPACITY = 0.88;

export interface SceneHandle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  updatePallets: (
    state: WarehouseState,
    fastSkus: Set<string>,
    qualityMode?: Map<string, Quality> | null,
    boxesMode?: boolean,
  ) => void;
  pickPallet: (clientX: number, clientY: number) => string | null;
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
  camera.position.set(-12, 14, 22);

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
    pickPallet: () => null,
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
    depthWrite: false,
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

  // ─── Pallet mesh (blocks view) ─────────────────────────────────────
  const palletGeom = new THREE.BoxGeometry(
    PALLET_SCENE_W,
    PALLET_SCENE_H,
    PALLET_SCENE_D,
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

  // ─── Boxes mesh (boxes view) ───────────────────────────────────────
  const boxGeom = new THREE.BoxGeometry(1, 1, 1);
  const boxMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0.0,
  });
  const boxCapacity = totalSlots * MAX_BOXES_PER_PALLET;
  const boxMesh = new THREE.InstancedMesh(boxGeom, boxMat, boxCapacity);
  boxMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(boxCapacity * 3),
    3,
  );
  boxMesh.count = 0;
  boxMesh.visible = false;
  scene.add(boxMesh);

  // ─── Age symbol planes ─────────────────────────────────────────────
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
  const boxDummy = new THREE.Object3D();
  const symbolDummy = new THREE.Object3D();

  // Raycaster state for click picking
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const slotIdByInstance = new Map<number, string>();
  const boxSlotIdByInstance = new Map<number, string>();

  // Symbol is anchored to the PALLET's front-top-right corner.
  const palletHalfW = PALLET_SCENE_W / 2;
  const palletHalfH = PALLET_SCENE_H / 2;
  const palletHalfD = PALLET_SCENE_D / 2;
  const symX = palletHalfW - SYMBOL_SIZE / 2 - SYMBOL_INSET;
  const symY = palletHalfH - SYMBOL_SIZE / 2 - SYMBOL_INSET;
  const symZ = palletHalfD + 0.01;

  // ─── Dispatch origin indicator ─────────────────────────────────────
  const dispatchColour = 0x00e5ff;
  const groundY = -FLOOR_HEIGHT_M * 1.6 + 0.02;

  const ringGeom = new THREE.RingGeometry(0.6, 0.9, 48);
  const ringMat = new THREE.MeshBasicMaterial({
    color: dispatchColour,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  });
  const ringMesh = new THREE.Mesh(ringGeom, ringMat);
  ringMesh.rotation.x = -Math.PI / 2;
  ringMesh.position.set(0, groundY, 0);
  ringMesh.renderOrder = 2;
  ringMesh.onBeforeRender = () => {
    ringMat.opacity = 0.5 + 0.3 * Math.sin(performance.now() * 0.003);
  };
  scene.add(ringMesh);

  const dotGeom = new THREE.CircleGeometry(0.35, 32);
  const dotMat = new THREE.MeshBasicMaterial({
    color: dispatchColour,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const dotMesh = new THREE.Mesh(dotGeom, dotMat);
  dotMesh.rotation.x = -Math.PI / 2;
  dotMesh.position.set(0, groundY + 0.001, 0);
  dotMesh.renderOrder = 2;
  scene.add(dotMesh);

  const BEACON_HEIGHT = 3.0;
  const beaconGeom = new THREE.CylinderGeometry(0.05, 0.05, BEACON_HEIGHT, 12, 1, true);
  const beaconMat = new THREE.MeshBasicMaterial({
    color: dispatchColour,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const beaconMesh = new THREE.Mesh(beaconGeom, beaconMat);
  beaconMesh.position.set(0, groundY + BEACON_HEIGHT / 2, 0);
  beaconMesh.renderOrder = 2;
  scene.add(beaconMesh);

  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 512;
  labelCanvas.height = 128;
  const lctx = labelCanvas.getContext('2d')!;
  lctx.clearRect(0, 0, 512, 128);
  lctx.fillStyle = '#00e5ff';
  lctx.font = 'bold 64px sans-serif';
  lctx.textAlign = 'center';
  lctx.textBaseline = 'middle';
  lctx.fillText('DISPATCH', 256, 64);
  const labelTex = new THREE.CanvasTexture(labelCanvas);
  labelTex.colorSpace = THREE.SRGBColorSpace;
  labelTex.minFilter = THREE.LinearFilter;
  labelTex.magFilter = THREE.LinearFilter;
  const labelMat = new THREE.SpriteMaterial({
    map: labelTex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const labelSprite = new THREE.Sprite(labelMat);
  labelSprite.scale.set(4, 1, 1);
  labelSprite.position.set(0, groundY + BEACON_HEIGHT + 0.6, 0);
  labelSprite.renderOrder = 3;
  scene.add(labelSprite);

  // Pre-built THREE.Color objects.
  const fallbackColour = new THREE.Color(0x888888);
  const fastMoverColour = new THREE.Color(FAST_MOVER_PALLET);
  const qualityColours: Record<Quality, THREE.Color> = {
    good: new THREE.Color(QUALITY_COLOURS.good),
    misplaced: new THREE.Color(QUALITY_COLOURS.misplaced),
    wasted: new THREE.Color(QUALITY_COLOURS.wasted),
  };

  const updatePallets = (
    state: WarehouseState,
    fastSkus: Set<string>,
    qualityMode: Map<string, Quality> | null = null,
    boxesMode = false,
  ): void => {
    let palletN = 0;
    let boxN = 0;
    const symbolCounts: [number, number, number] = [0, 0, 0];
    slotIdByInstance.clear();
    boxSlotIdByInstance.clear();

    for (const [slotId, pallet] of state.slots) {
      const pos = slotPositions.get(slotId);
      if (!pos) continue;

      let colour: THREE.Color;
      if (qualityMode) {
        const q = qualityMode.get(slotId);
        colour = q ? qualityColours[q] : fallbackColour;
      } else if (fastSkus.has(pallet.sku)) {
        colour = fastMoverColour;
      } else {
        colour = slotPalletColors.get(slotId) ?? fallbackColour;
      }

      if (boxesMode) {
        const plan = planStack(pallet.boxes, pallet.sku);
        for (const p of plan.placements) {
          const bx = (p.x + p.width / 2 - PALLET_W / 2) * BOX_SCALE_X;
          const by = (p.z + p.height / 2 - PALLET_H / 2) * BOX_SCALE_Y;
          const bz = (p.y + p.depth / 2 - PALLET_D / 2) * BOX_SCALE_Z;
          boxDummy.position.set(pos.x + bx, pos.y + by, pos.z + bz);
          boxDummy.scale.set(p.width * BOX_SCALE_X, p.height * BOX_SCALE_Y, p.depth * BOX_SCALE_Z);
          boxDummy.updateMatrix();
          boxMesh.setMatrixAt(boxN, boxDummy.matrix);
          boxMesh.setColorAt(boxN, colour);
          boxSlotIdByInstance.set(boxN, slotId);
          boxN++;
        }
      } else {
        palletDummy.position.copy(pos);
        palletDummy.updateMatrix();
        palletMesh.setMatrixAt(palletN, palletDummy.matrix);
        palletMesh.setColorAt(palletN, colour);
        slotIdByInstance.set(palletN, slotId);
        palletN++;
      }

      const age = state.ageDays.get(pallet.id) ?? 0;
      const bucket: 0 | 1 | 2 =
        age <= AGE_FRESH_MAX_DAYS ? 0 : age <= AGE_AGING_MAX_DAYS ? 1 : 2;
      symbolDummy.position.set(pos.x + symX, pos.y + symY, pos.z + symZ);
      symbolDummy.rotation.set(0, 0, 0);
      symbolDummy.updateMatrix();
      symbolMeshes[bucket].setMatrixAt(symbolCounts[bucket]++, symbolDummy.matrix);
    }

    palletMesh.count = palletN;
    palletMesh.visible = !boxesMode;
    palletMesh.instanceMatrix.needsUpdate = true;
    if (palletMesh.instanceColor) palletMesh.instanceColor.needsUpdate = true;

    boxMesh.count = boxN;
    boxMesh.visible = boxesMode;
    boxMesh.instanceMatrix.needsUpdate = true;
    if (boxMesh.instanceColor) boxMesh.instanceColor.needsUpdate = true;

    for (let b = 0; b < 3; b++) {
      symbolMeshes[b].count = symbolCounts[b];
      symbolMeshes[b].instanceMatrix.needsUpdate = true;
    }
  };

  handle.updatePallets = updatePallets;

  handle.pickPallet = (clientX: number, clientY: number): string | null => {
    const rect = handle.renderer.domElement.getBoundingClientRect();
    pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, handle.camera);
    const hits = raycaster.intersectObjects([palletMesh, boxMesh]);
    for (const h of hits) {
      if (h.instanceId === undefined) continue;
      if (h.object === palletMesh) {
        const sid = slotIdByInstance.get(h.instanceId);
        if (sid) return sid;
      } else if (h.object === boxMesh) {
        const sid = boxSlotIdByInstance.get(h.instanceId);
        if (sid) return sid;
      }
    }
    return null;
  };
}
