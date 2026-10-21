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

