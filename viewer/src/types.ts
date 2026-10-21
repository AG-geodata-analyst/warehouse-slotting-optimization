/**
 * Mirror of warehouse/models.py — the JSON contract between the Python
 * pipeline and this viewer. Keep in sync with the Pydantic models.
 */

export type SlotStatus = 'VACANT' | 'OCCUPIED' | 'RESERVED' | 'BLOCKED';

export interface Slot {
  id: string;
  floor: string;
  rack: string;
  level: number;
  bay: number;
  width_cm: number;
  depth_cm: number;
  height_cm: number;
  max_weight_kg: number;
  status: SlotStatus;
}

export interface Rack {
  id: string;
  floor: string;
  x: number;
  y: number;
  slots: Slot[];
}

export interface WarehouseLayout {
  version: number;
  floors: string[];
  racks: Rack[];
}

export interface Pallet {
  id: string;
  sku: string;
  boxes: number;
  gross_weight_kg: number;
  slot_id: string | null;
}

export interface InboundEvent {
  event_id: number;
  time: string;              // "HH:MM:SS"
  pallets: Pallet[];
}

export interface OutboundEvent {
  event_id: number;
  time: string;
  pallet_ids: string[];
}

export interface Day {
  version: number;
  date: string;              // "YYYY-MM-DD"
  seed: number;
  inbound: InboundEvent[];
  outbound: OutboundEvent[];
}

export interface DaysManifest {
  version: number;
  genesis: string;
  end: string;
  days: string[];            // ordered oldest → newest
}

export interface Bootstrap {
  version: number;
  as_of: string;
  pallets: Array<Pallet & { slot_id: string }>;   // always has slot_id
}
