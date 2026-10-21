import type { WarehouseLayout } from './types';

const BASE = import.meta.env.BASE_URL;   // './' in the deployed build, '/' in dev

async function fetchJson<T>(path: string): Promise<T> {
  const url = `${BASE}${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function loadLayout(): Promise<WarehouseLayout> {
  const layout = await fetchJson<WarehouseLayout>('data/layout.json');
  if (layout.version !== 1) {
    throw new Error(`Unsupported layout version: ${layout.version}`);
  }
  return layout;
}
