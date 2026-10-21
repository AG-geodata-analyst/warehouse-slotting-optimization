import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { WarehouseLayout } from './types';

// Real-world dimensions in metres (converted from the cm values in models.py)
const SLOT_WIDTH_M = 1.2;
const SLOT_DEPTH_M = 1.0;
const SLOT_HEIGHT_M = 1.6;
const FLOOR_HEIGHT_M = 5.0;      // vertical spacing between B1 / 1F / 2F

// Colour per floor so you can see each one at a glance
const FLOOR_COLORS: Record<string, number> = {
  'B1': 0x3b5b7a,
  '1F': 0x5c9b76,
  '2F': 0x9b7a5c,
};

export interface SceneHandle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
}

export function createScene(canvas: HTMLCanvasElement): SceneHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);
  scene.fog = new THREE.Fog(0x111111, 40, 80);

  const camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    200
  );
  camera.position.set(16, 14, 20);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(5, 0, 5);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.95;
  controls.update();

  // Ambient + directional lighting
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
  keyLight.position.set(20, 30, 15);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0x88aaff, 0.35);
  fillLight.position.set(-10, 10, -10);
  scene.add(fillLight);

  // Ground plane + grid for spatial reference
  const groundGeom = new THREE.PlaneGeometry(40, 40);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x0a0a0a,
    roughness: 1.0,
  });
  const ground = new THREE.Mesh(groundGeom, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -FLOOR_HEIGHT_M * 1.6;
  scene.add(ground);

  const grid = new THREE.GridHelper(
    40,
    40,
    0x333333,
    0x1f1f1f
  );
  grid.position.y = -FLOOR_HEIGHT_M * 1.6 + 0.01;
  scene.add(grid);

  return { renderer, scene, camera, controls };
}

/**
 * Build the 3D warehouse from layout.json.
 * Each slot becomes one instance of a single InstancedMesh — one draw call
 * for all 100 boxes, regardless of how many slots the layout has.
 */
export function buildWarehouse(
  scene: THREE.Scene,
  layout: WarehouseLayout
): void {
  const totalSlots = layout.racks.reduce((sum, r) => sum + r.slots.length, 0);

  const geom = new THREE.BoxGeometry(
    SLOT_WIDTH_M * 0.85,
    SLOT_HEIGHT_M * 0.85,
    SLOT_DEPTH_M * 0.85
  );
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,      // overridden per-instance
    roughness: 0.75,
    metalness: 0.05,
    transparent: true,
    opacity: 0.72,
  });

  const mesh = new THREE.InstancedMesh(geom, mat, totalSlots);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(totalSlots * 3),
    3
  );

  const dummy = new THREE.Object3D();
  const colour = new THREE.Color();
  let idx = 0;

  // Sort floors so that the lowest (B1) is rendered below and 2F above.
  // layout.floors is ordered ["B1", "1F", "2F"]; we want B1 lowest in Y.
  for (const rack of layout.racks) {
    const floorIndex = layout.floors.indexOf(rack.floor);
    // B1 -> -FLOOR_HEIGHT_M, 1F -> 0, 2F -> +FLOOR_HEIGHT_M
    const floorY = (floorIndex - 1) * FLOOR_HEIGHT_M;

    for (const slot of rack.slots) {
      const x = rack.x + (slot.bay - 1) * SLOT_WIDTH_M;
      const y = floorY + (slot.level - 1) * SLOT_HEIGHT_M;
      const z = rack.y;

      dummy.position.set(x, y, z);
      dummy.updateMatrix();
      mesh.setMatrixAt(idx, dummy.matrix);

      colour.setHex(FLOOR_COLORS[rack.floor] ?? 0x666666);
      mesh.setColorAt(idx, colour);

      idx++;
    }
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  scene.add(mesh);
}
