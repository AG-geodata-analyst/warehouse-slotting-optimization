import type {
  WarehouseLayout,
  DaysManifest,
  Day,
  Bootstrap,
} from './types';

const BASE = import.meta.env.BASE_URL;

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

export async function loadBootstrap(): Promise<Bootstrap> {
  const b = await fetchJson<Bootstrap>('data/bootstrap.json');
  if (b.version !== 1) {
    throw new Error(`Unsupported bootstrap version: ${b.version}`);
  }
  return b;
}

export async function loadManifest(): Promise<DaysManifest> {
  const m = await fetchJson<DaysManifest>('data/days.json');
  if (m.version !== 1) {
    throw new Error(`Unsupported manifest version: ${m.version}`);
  }
  return m;
}

export async function loadDay(dayIso: string): Promise<Day> {
  const day = await fetchJson<Day>(`data/day/${dayIso}.json`);
  if (day.version !== 1) {
    throw new Error(`Unsupported day version: ${day.version}`);
  }
  return day;
}

export async function loadAllDays(manifest: DaysManifest): Promise<Day[]> {
  return Promise.all(manifest.days.map((d) => loadDay(d)));
}
