import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Pallet } from './types';
import type { Quality } from './slotting';
import { planStack, PATTERN_LABEL, PALLET_W, PALLET_D, PALLET_H, type StackPlan } from './palletizer';

export interface PanelContext {
  slotId: string;
  pallet: Pallet;
  ageDays: number;
  quality?: Quality;
  slotColor?: string;
}

const QUALITY_LABEL: Record<Quality, string> = {
  good: 'Good',
  misplaced: 'Misplaced',
  wasted: 'Wasted',
};
const QUALITY_COLOR: Record<Quality, string> = {
  good: '#4caf50',
  misplaced: '#e53935',
  wasted: '#ffb300',
};

let panelHost: HTMLDivElement | null = null;
let overlayHost: HTMLDivElement | null = null;
let current: PanelContext | null = null;
let currentPlans: StackPlan[] = [];

// Mini-3D state
let miniRenderer: THREE.WebGLRenderer | null = null;
let miniScene: THREE.Scene | null = null;
let miniCamera: THREE.PerspectiveCamera | null = null;
let miniControls: OrbitControls | null = null;
let miniAnimId = 0;
let miniContainerEl: HTMLDivElement | null = null;

function ensureHosts(): { panel: HTMLDivElement; overlay: HTMLDivElement } {
  if (!panelHost) {
    panelHost = document.createElement('div');
    panelHost.style.cssText =
      'position:fixed;right:0;top:0;bottom:0;width:340px;background:#141414;color:#eee;' +
      'border-left:1px solid #2a2a2a;overflow-y:auto;transform:translateX(100%);' +
      'transition:transform 0.2s ease;z-index:100;padding:16px;' +
      'font-family:system-ui,sans-serif;font-size:13px;box-shadow:-4px 0 12px rgba(0,0,0,0.5);';
    document.body.appendChild(panelHost);
  }
  if (!overlayHost) {
    overlayHost = document.createElement('div');
    overlayHost.style.cssText =
      'position:fixed;inset:0;background:rgba(8,8,8,0.96);display:none;' +
      'align-items:center;justify-content:center;z-index:200;cursor:pointer;';
    const c = document.createElement('canvas');
    c.width = 1400; c.height = 720;
    c.style.cssText = 'max-width:90vw;max-height:90vh;background:#0a0a0a;border:1px solid #333;border-radius:8px;';
    overlayHost.appendChild(c);
    overlayHost.addEventListener('click', () => { overlayHost!.style.display = 'none'; });
    document.body.appendChild(overlayHost);
  }
  return { panel: panelHost, overlay: overlayHost };
}

function buildPlans(totalBoxes: number, sku: string): StackPlan[] {
  const plans: StackPlan[] = [];
  let remaining = totalBoxes;
  let safety = 0;
  while (remaining > 0 && safety++ < 5) {
    const plan = planStack(remaining, sku);
    plans.push(plan);
    if (plan.totalPlaced === 0) break;
    remaining -= plan.totalPlaced;
  }
  return plans;
}

// ─── Mini 3D (panel preview) ────────────────────────────────────────

function disposeMini3D(): void {
  if (miniAnimId) {
    cancelAnimationFrame(miniAnimId);
    miniAnimId = 0;
  }
  if (miniControls) {
    miniControls.dispose();
    miniControls = null;
  }

  // Dispose all geometries and materials before releasing the renderer.
  if (miniScene) {
    miniScene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
    });
  }

  if (miniRenderer) {
    miniRenderer.dispose();
    miniRenderer.forceContextLoss();
    miniRenderer = null;
  }
  miniScene = null;
  miniCamera = null;
  if (miniContainerEl) {
    miniContainerEl.innerHTML = '';
    miniContainerEl = null;
  }
}

function createMini3D(
  container: HTMLDivElement,
  plans: StackPlan[],
): void {
  disposeMini3D();
  miniContainerEl = container;

  const width = container.clientWidth || 308;
  const height = container.clientHeight || 240;

  const canvas = document.createElement('canvas');
  canvas.style.cssText = `display:block;width:100%;height:${height}px;`;
  container.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(width, height, false);
  miniRenderer = renderer;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a0a);
  miniScene = scene;

  const camera = new THREE.PerspectiveCamera(45, width / height, 10, 10000);
  camera.position.set(1600, 1800, 1600);
  miniCamera = camera;

  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
  keyLight.position.set(2000, 3000, 2000);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0x99bbff, 0.35);
  fillLight.position.set(-2000, 1000, -1500);
  scene.add(fillLight);

  // Wooden deck
  const baseH = 144;
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(PALLET_W, baseH, PALLET_D),
    new THREE.MeshStandardMaterial({ color: 0xb78d56, roughness: 0.9 }),
  );
  base.position.set(PALLET_W / 2, baseH / 2, PALLET_D / 2);
  scene.add(base);

  // Boxes — render every pallet in the batch, placed side by side along X.
  const boxMat = new THREE.MeshStandardMaterial({
    color: 0xe0c89a,
    roughness: 0.85,
  });

  const outlineMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.65,
  });

  const palletGap = PALLET_W * 1.15;  // 15% gap between pallets
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    const offsetX = i * palletGap;
    // Optional: a wooden deck per pallet
    if (i > 0) {
      const extraBase = new THREE.Mesh(
        new THREE.BoxGeometry(PALLET_W, baseH, PALLET_D),
        new THREE.MeshStandardMaterial({ color: 0xb78d56, roughness: 0.9 }),
      );
      extraBase.position.set(PALLET_W / 2 + offsetX, baseH / 2, PALLET_D / 2);
      scene.add(extraBase);
    }
    
    for (const p of plan.placements) {
      const geom = new THREE.BoxGeometry(p.width * 0.98, p.height * 0.98, p.depth * 0.98);
      
      // 1. Black outline box (full size)
      const outline = new THREE.Mesh(geom, outlineMat);
      outline.position.set(
        p.x + p.width / 2 + offsetX,
        baseH + p.z + p.height / 2,
        p.y + p.depth / 2,
      );
      scene.add(outline);

      // 2. Colored transparent box (shrunk 6% to reveal black edges)
      const mesh = new THREE.Mesh(geom, boxMat);
      mesh.position.set(
        p.x + p.width / 2 + offsetX,
        baseH + p.z + p.height / 2,
        p.y + p.depth / 2,
      );
      mesh.scale.set(0.97, 0.97, 0.97);
      scene.add(mesh);
    }
  }

  const controls = new OrbitControls(camera, canvas);
  const totalWidth = PALLET_W + (plans.length - 1) * palletGap;
  controls.target.set(totalWidth / 2, baseH + 700, PALLET_D / 2);

  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.2;
  controls.minDistance = 1000;
  controls.maxDistance = 4500;
  controls.maxPolarAngle = Math.PI * 0.48;
  miniControls = controls;

  const animate = () => {
    miniAnimId = requestAnimationFrame(animate);
    if (miniControls) miniControls.update();
    if (miniRenderer && miniScene && miniCamera) {
      miniRenderer.render(miniScene, miniCamera);
    }
  };
  animate();
}

// ─── 2D isometric (open full view overlay) ──────────────────────────

function projectPoint(x: number, y: number, z: number): { sx: number; sy: number } {
  const cos30 = Math.cos(Math.PI / 6);
  const sin30 = 0.5;
  return { sx: (x - y) * cos30, sy: (x + y) * sin30 - z };
}

function drawPlanIntoRect(
  ctx: CanvasRenderingContext2D,
  plan: StackPlan,
  vx: number, vy: number, vw: number, vh: number,
  margin = 10,
): void {
  if (plan.placements.length === 0) return;

  const corners = [
    projectPoint(0, 0, 0), projectPoint(PALLET_W, 0, 0), projectPoint(0, PALLET_D, 0), projectPoint(PALLET_W, PALLET_D, 0),
    projectPoint(0, 0, PALLET_H), projectPoint(PALLET_W, 0, PALLET_H), projectPoint(0, PALLET_D, PALLET_H), projectPoint(PALLET_W, PALLET_D, PALLET_H),
  ];
  const minX = Math.min(...corners.map(p => p.sx));
  const maxX = Math.max(...corners.map(p => p.sx));
  const minY = Math.min(...corners.map(p => p.sy));
  const maxY = Math.max(...corners.map(p => p.sy));

  const scale = Math.min(
    (vw - 2 * margin) / (maxX - minX),
    (vh - 2 * margin) / (maxY - minY),
  );
  const offsetX = vx + vw / 2 - ((minX + maxX) / 2) * scale;
  const offsetY = vy + vh / 2 - ((minY + maxY) / 2) * scale;

  const project = (x: number, y: number, z: number) => {
    const p = projectPoint(x, y, z);
    return { sx: p.sx * scale + offsetX, sy: p.sy * scale + offsetY };
  };

  const sorted = [...plan.placements].sort(
    (a, b) => (a.x + a.y + a.z) - (b.x + b.y + b.z),
  );

  const fill = (points: Array<{ sx: number; sy: number }>, color: string) => {
    ctx.beginPath();
    ctx.moveTo(points[0].sx, points[0].sy);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].sx, points[i].sy);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  };

  for (const p of sorted) {
    const x0 = p.x, x1 = p.x + p.width;
    const y0 = p.y, y1 = p.y + p.depth;
    const z0 = p.z, z1 = p.z + p.height;
    const top = [project(x0, y0, z1), project(x1, y0, z1), project(x1, y1, z1), project(x0, y1, z1)];
    const rightFace = [project(x1, y0, z0), project(x1, y1, z0), project(x1, y1, z1), project(x1, y0, z1)];
    const leftFace = [project(x0, y1, z0), project(x1, y1, z0), project(x1, y1, z1), project(x0, y1, z1)];
    fill(rightFace, '#a88a5f');
    fill(leftFace, '#c4a575');
    fill(top, '#e8c89a');
  }
}

function render2DPlans(
  canvas: HTMLCanvasElement,
  plans: StackPlan[],
  labels: boolean,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const n = plans.length;
  if (n === 0) return;

  const gap = 15;
  const labelH = labels ? 30 : 0;
  const usableH = H - 2 * gap - labelH;
  const usableW = W - 2 * gap;
  const perW = usableW / n;

  for (let i = 0; i < n; i++) {
    const x = gap + i * perW;
    drawPlanIntoRect(ctx, plans[i], x, gap, perW, usableH);

    if (labels) {
      ctx.fillStyle = '#ccc';
      ctx.font = '14px system-ui';
      ctx.textAlign = 'center';
      const isPartial = plans[i].totalPlaced < plans[i].capacity;
      const label = n === 1
        ? `${plans[i].totalPlaced} boxes`
        : (isPartial && i === n - 1)
          ? `Pallet ${i + 1} (partial) · ${plans[i].totalPlaced}`
          : `Pallet ${i + 1} · ${plans[i].totalPlaced}`;
      ctx.fillText(label, x + perW / 2, H - 12);
    }
  }
}

// ─── Panel HTML ──────────────────────────────────────────────────────

function buildPanelHtml(ctx: PanelContext, plans: StackPlan[]): string {
  if (plans.length === 0) {
    return (
      `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">` +
      `<div style="font-weight:600;">Pallet · ${ctx.slotId}</div>` +
      `<button data-action="close" style="background:none;border:1px solid #444;color:#ccc;border-radius:4px;padding:2px 8px;cursor:pointer;">✕</button>` +
      `</div>` +
      `<div style="padding:12px;font-size:12px;opacity:0.7;">No boxes to preview for this pallet (boxes = 0).</div>`
    );
  }
  const ageSym = ctx.ageDays <= 7 ? '●' : ctx.ageDays <= 14 ? '▲' : '✕';
  const q = ctx.quality;
  const qLabel = q ? QUALITY_LABEL[q] : '—';
  const qColor = q ? QUALITY_COLOR[q] : '#888';

  const totalPlaced = plans.reduce((n, p) => n + p.totalPlaced, 0);
  const overflow = ctx.pallet.boxes - totalPlaced;
  const palletCount = plans.length;

  const palletSummary = palletCount === 1
    ? `${ctx.pallet.boxes} boxes · 1 pallet`
    : `${ctx.pallet.boxes} boxes · ${palletCount} pallets required (${plans.map(p => p.totalPlaced).join(' + ')})`;

  const primary = plans[0];

  return (
    `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">` +
    `<div style="font-weight:600;">Pallet · ${ctx.slotId}</div>` +
    `<button data-action="close" style="background:none;border:1px solid #444;color:#ccc;border-radius:4px;padding:2px 8px;cursor:pointer;">✕</button>` +
    `</div>` +
    `<div id="mini-3d" style="width:100%;height:240px;background:#0a0a0a;border-radius:4px;margin-bottom:6px;overflow:hidden;position:relative;"></div>` +
    `<div style="font-size:10px;opacity:0.5;margin-bottom:14px;">EUR1 pallet · ${PALLET_W} × ${PALLET_D} mm · drag to rotate</div>` +
    `<div style="margin-bottom:6px;"><span style="opacity:0.6">SKU</span> · <code style="color:#9cf;">${ctx.pallet.sku}</code></div>` +
    `<div style="margin-bottom:6px;"><span style="opacity:0.6">Boxes</span> · ${palletSummary}</div>` +
    `<div style="margin-bottom:6px;"><span style="opacity:0.6">Weight</span> · ${ctx.pallet.gross_weight_kg.toFixed(1)} kg</div>` +
    `<div style="margin-bottom:6px;"><span style="opacity:0.6">Age</span> · ${ctx.ageDays}d ${ageSym}</div>` +
    `<div style="margin-bottom:12px;"><span style="opacity:0.6">Quality</span> · <span style="color:${qColor};font-weight:600">${qLabel}</span></div>` +
    `<hr style="border:none;border-top:1px solid #2a2a2a;margin:12px 0;">` +
    `<div style="margin-bottom:6px;font-weight:600;">Stacking</div>` +
    `<div style="margin-bottom:6px;"><span style="opacity:0.6">Box type</span> · ${primary.box.label}</div>` +
    `<div style="margin-bottom:6px;"><span style="opacity:0.6">Pattern</span> · ${PATTERN_LABEL[primary.pattern]}</div>` +
    `<div style="margin-bottom:6px;"><span style="opacity:0.6">Layers</span> · ${primary.layers} × ${primary.boxesPerLayer} = ${primary.totalPlaced} per pallet</div>` +
    (overflow > 0
      ? `<div style="color:#ffb300;font-size:11px;margin-bottom:8px;">⚠ ${overflow} box(es) exceed the plan's capacity — data anomaly</div>`
      : '') +
    `<button data-action="fullview" style="width:100%;padding:8px;background:#1e3a5f;border:1px solid #3b6ea5;color:#fff;border-radius:4px;cursor:pointer;margin-top:12px;font:inherit;">Open 2D plan view (all pallets)</button>`
  );
}

export function openPanel(ctx: PanelContext): void {
  current = ctx;
  currentPlans = buildPlans(ctx.pallet.boxes, ctx.pallet.sku);
  const { panel } = ensureHosts();
  panel.innerHTML = buildPanelHtml(ctx, currentPlans);
  panel.style.transform = 'translateX(0)';

  const mini = panel.querySelector('#mini-3d') as HTMLDivElement | null;
  if (mini && currentPlans.length > 0) {
    try {
      createMini3D(mini, currentPlans);
    } catch (e) {
      console.warn('[panel] mini-3D init failed', e);
      mini.innerHTML = '<div style="padding:12px;font-size:11px;opacity:0.6;">3D preview unavailable in this browser.</div>';
    }
  }
}

export function closePanel(): void {
  disposeMini3D();
  current = null;
  currentPlans = [];
  if (panelHost) panelHost.style.transform = 'translateX(100%)';
  if (overlayHost) overlayHost.style.display = 'none';
}

export function isPanelOpen(): boolean {
  return current !== null;
}

export function bindPanelEvents(): void {
  const { panel, overlay } = ensureHosts();
  panel.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const action = target.dataset.action;
    if (action === 'close') closePanel();
    if (action === 'fullview' && currentPlans.length > 0) {
      const c = overlay.querySelector('canvas') as HTMLCanvasElement | null;
      if (c) render2DPlans(c, currentPlans, true);
      overlay.style.display = 'flex';
    }
  });
}
