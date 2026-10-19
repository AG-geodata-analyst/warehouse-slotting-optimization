from __future__ import annotations

from datetime import date, time
from enum import Enum
from typing import List

from pydantic import BaseModel


class SlotStatus(str, Enum):
    VACANT = "VACANT"
    OCCUPIED = "OCCUPIED"
    RESERVED = "RESERVED"
    BLOCKED = "BLOCKED"


class Slot(BaseModel):
    id: str                     # e.g. "B1-R03-L01-B05"
    floor: str                  # "B1", "1F", "2F"
    rack: str                   # "R03"
    level: int                  # 1..3 (vertical level in the rack)
    bay: int                    # 1..10 (horizontal position)
    width_cm: int = 120
    depth_cm: int = 100
    height_cm: int = 160
    max_weight_kg: int = 800
    status: SlotStatus = SlotStatus.VACANT


class Rack(BaseModel):
    id: str                     # "R03"
    floor: str
    x: float                    # metres from warehouse origin
    y: float
    slots: List[Slot]


class WarehouseLayout(BaseModel):
    version: int = 1
    floors: List[str]           # ["B1", "1F", "2F"]
    racks: List[Rack]

    @property
    def all_slots(self) -> List[Slot]:
        return [s for r in self.racks for s in r.slots]


class SKU(BaseModel):
    code: str                   # "N013"
    description: str = ""
    box_length_cm: int = 40
    box_width_cm: int = 30
    box_height_cm: int = 25
    box_weight_kg: float = 5.0
    boxes_per_pallet: int = 24


class Pallet(BaseModel):
    id: str                     # "P-20261019-01-02"
    sku: str                    # "N013"
    boxes: int
    gross_weight_kg: float
    length_cm: int = 120
    width_cm: int = 100
    height_cm: int = 145
    slot_id: str | None = None  # assigned on put-away


class InboundEvent(BaseModel):
    event_id: int
    time: time
    pallets: List[Pallet]


class OutboundEvent(BaseModel):
    event_id: int
    time: time
    pallet_ids: List[str]


class Day(BaseModel):
    version: int = 1
    date: date
    seed: int
    inbound: List[InboundEvent]
    outbound: List[OutboundEvent]
