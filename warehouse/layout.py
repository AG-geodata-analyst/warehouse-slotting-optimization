"""
Generate a deterministic 100-slot warehouse layout and write it to
data/layout.json.

Layout plan:
  - 3 floors: B1 (basement), 1F, 2F
  - 10 racks total: 4 on B1, 3 on 1F, 3 on 2F
  - 10 slots per rack: 2 vertical levels × 5 horizontal bays
  - Rack (x, y) positions are metres from the warehouse origin

The layout is fixed (no randomness) so that the 3D viewer can rely on
stable slot IDs across runs.
"""
import json
from pathlib import Path

from .models import WarehouseLayout, Rack, Slot, SlotStatus

DATA_DIR = Path(__file__).parent.parent / "data"

FLOORS = ["B1", "1F", "2F"]

# (floor_name, number_of_racks, floor_index_0based)
PLAN = [
    ("B1", 4, 0),
    ("1F", 3, 1),
    ("2F", 3, 2),
]

# Rack positions on each floor (x, y) in metres.
# Two-row arrangement keeps racks physically separated in the 3D view.
RACK_POSITIONS = {
    "B1": [(2.0, 2.0), (8.0, 2.0), (2.0, 8.0), (8.0, 8.0)],
    "1F": [(2.0, 2.0), (8.0, 2.0), (5.0, 8.0)],
    "2F": [(2.0, 2.0), (8.0, 2.0), (5.0, 8.0)],
}

LEVELS_PER_RACK = 2
BAYS_PER_LEVEL = 5


def generate_layout() -> WarehouseLayout:
    """Build the full 100-slot WarehouseLayout object."""
    racks: list[Rack] = []
    rack_counter = 1

    for floor, n_racks, _floor_idx in PLAN:
        positions = RACK_POSITIONS[floor]
        for i in range(n_racks):
            rack_id = f"R{rack_counter:02d}"
            x, y = positions[i]

            slots: list[Slot] = []
            for level in range(1, LEVELS_PER_RACK + 1):
                for bay in range(1, BAYS_PER_LEVEL + 1):
                    slot_id = f"{floor}-{rack_id}-L{level:02d}-B{bay:02d}"
                    slots.append(
                        Slot(
                            id=slot_id,
                            floor=floor,
                            rack=rack_id,
                            level=level,
                            bay=bay,
                            status=SlotStatus.VACANT,
                        )
                    )

            racks.append(Rack(id=rack_id, floor=floor, x=x, y=y, slots=slots))
            rack_counter += 1

    return WarehouseLayout(floors=FLOORS, racks=racks)


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    layout = generate_layout()
    out = DATA_DIR / "layout.json"
    out.write_text(layout.model_dump_json(indent=2))
    print(
        f"[layout] wrote {len(layout.all_slots)} slots "
        f"across {len(layout.racks)} racks "
        f"on {len(layout.floors)} floors → {out}"
    )


if __name__ == "__main__":
    main()

