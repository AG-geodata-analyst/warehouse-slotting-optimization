"""
Deterministic day generator for the warehouse simulation.

For each date in the display window, generates 5 inbound and 5 outbound
events with deterministic randomness seeded by the date. Replays from
GENESIS so that occupancy at any date is correct regardless of which
window the caller requests.

Key design points:
  - seed = date (YYYYMMDD as int)  →  same date produces identical output
  - equilibrium rule keeps occupancy near a slowly oscillating target
  - outbound can only pick pallets already in the warehouse at start of day
  - inbound pallets are assigned to vacant slots after outbound removals
"""
import json
import math
import random
from datetime import date, time, timedelta
from pathlib import Path

from .layout import generate_layout, DATA_DIR
from .models import (
    Day, InboundEvent, OutboundEvent, Pallet, WarehouseLayout,
)

GENESIS = date(2026, 1, 1)
BOOTSTRAP_OCCUPANCY = 60          # pallets already in the warehouse at genesis
WINDOW_DAYS = 30
SKUS = [f"N{i:03d}" for i in range(1, 51)]

# Target-occupancy oscillation parameters
BASE_TARGET = 70
TARGET_AMPLITUDE = 5
TARGET_PERIOD_DAYS = 7            # ~44-day period, so 30-day window shows ~2/3 of a cycle

# Events per day
INBOUND_EVENTS_PER_DAY = 5
OUTBOUND_EVENTS_PER_DAY = 5
PALLETS_PER_INBOUND_EVENT_MIN = 2
PALLETS_PER_INBOUND_EVENT_MAX = 4

FIRST_INBOUND_TIME = time(8, 30)


# ─── Helpers ────────────────────────────────────────────────────────────────

def _seed_for(d: date) -> int:
    """Deterministic, date-derived seed."""
    return int(d.strftime("%Y%m%d"))


def _target_occupancy(day_index: int) -> int:
    """Oscillates between 65 and 75 slots."""
    return BASE_TARGET + int(
        TARGET_AMPLITUDE * math.sin(day_index / TARGET_PERIOD_DAYS)
    )


def _rand_time(rng: random.Random) -> time:
    return time(rng.randint(9, 17), rng.randint(0, 59))


def _distribute(total: int, buckets: int) -> list[int]:
    """Split total into buckets counts; remainder goes to the first buckets."""
    base, rem = divmod(total, buckets)
    return [base + (1 if i < rem else 0) for i in range(buckets)]


def _make_pallet(prefix: str, idx: int, rng: random.Random) -> Pallet:
    return Pallet(
        id=f"{prefix}-{idx:03d}",
        sku=rng.choice(SKUS),
        boxes=rng.randint(12, 36),
        gross_weight_kg=round(rng.uniform(100, 800), 1),
    )


def _bootstrap(layout: WarehouseLayout) -> dict[str, Pallet]:
    """
    Fill the warehouse with a deterministic set of pallets at genesis.
    Returns slot_id → Pallet.
    """
    rng = random.Random(_seed_for(GENESIS))
    slots = rng.sample(layout.all_slots, BOOTSTRAP_OCCUPANCY)
    result: dict[str, Pallet] = {}
    for i, slot in enumerate(slots):
        pallet = _make_pallet("P-BOOT", i, rng)
        pallet.slot_id = slot.id
        result[slot.id] = pallet
    return result


# ─── Day simulation ─────────────────────────────────────────────────────────

def _simulate_day(
    d: date,
    slot_to_pallet: dict[str, Pallet],
    layout: WarehouseLayout,
    target: int,
) -> Day:
    """Generate one day's events and apply them to slot_to_pallet in place."""
    seed = _seed_for(d)
    rng = random.Random(seed)

    # --- 1. Generate inbound pallets (no slot assignment yet) ---
    inbound_events: list[InboundEvent] = []
    for i in range(1, INBOUND_EVENTS_PER_DAY + 1):
        event_time = FIRST_INBOUND_TIME if i == 1 else _rand_time(rng)
        n_pallets = rng.randint(
            PALLETS_PER_INBOUND_EVENT_MIN,
            PALLETS_PER_INBOUND_EVENT_MAX,
        )
        pallets = [
            _make_pallet(f"P-{d.strftime('%Y%m%d')}-{i:02d}", j, rng)
            for j in range(n_pallets)
        ]
        inbound_events.append(
            InboundEvent(event_id=i, time=event_time, pallets=pallets)
        )

    # --- 2. Decide how many pallets must ship out to reach the target ---
    current = len(slot_to_pallet)
    total_inbound = sum(len(e.pallets) for e in inbound_events)
    outbound_total = current + total_inbound - target
    outbound_total = max(0, min(outbound_total, current))

    # --- 3. Pick pallets to ship out (only from current occupancy) ---
    occupied_slots = list(slot_to_pallet.keys())
    rng.shuffle(occupied_slots)
    outbound_counts = _distribute(outbound_total, OUTBOUND_EVENTS_PER_DAY)

    outbound_events: list[OutboundEvent] = []
    cursor = 0
    for i in range(1, OUTBOUND_EVENTS_PER_DAY + 1):
        n = outbound_counts[i - 1]
        pids: list[str] = []
        for _ in range(n):
            if cursor >= len(occupied_slots):
                break
            slot_id = occupied_slots[cursor]
            cursor += 1
            pids.append(slot_to_pallet[slot_id].id)
        outbound_events.append(
            OutboundEvent(event_id=i, time=_rand_time(rng), pallet_ids=pids)
        )

    # --- 4. Apply outbound: remove those pallets from state ---
    pids_to_remove = {pid for ev in outbound_events for pid in ev.pallet_ids}
    for slot_id in list(slot_to_pallet.keys()):
        if slot_to_pallet[slot_id].id in pids_to_remove:
            del slot_to_pallet[slot_id]

    # --- 5. Apply inbound: assign slots to arrivals ---
    occupied_after_out = set(slot_to_pallet.keys())
    vacant = [s for s in layout.all_slots if s.id not in occupied_after_out]
    rng.shuffle(vacant)
    for ev in inbound_events:
        for pallet in ev.pallets:
            if not vacant:
                break  # warehouse full — pallet stays at dock, slot_id=None
            slot = vacant.pop()
            pallet.slot_id = slot.id
            slot_to_pallet[slot.id] = pallet

    return Day(
        version=1,
        date=d,
        seed=seed,
        inbound=inbound_events,
        outbound=outbound_events,
    )


# ─── Public entry point ─────────────────────────────────────────────────────

def generate_window(
    end_date: date,
    window_days: int = WINDOW_DAYS,
    verbose: bool = True,
) -> list[Day]:
    layout = generate_layout()
    slot_to_pallet = _bootstrap(layout)

    if verbose:
        print(f"[generate] genesis:    {GENESIS}")
        print(f"[generate] end date:   {end_date}")
        print(f"[generate] replaying:  {(end_date - GENESIS).days + 1} days")

    window_start = end_date - timedelta(days=window_days - 1)
    days: list[Day] = []
    cur = GENESIS

    while cur <= end_date:
        target = _target_occupancy((cur - GENESIS).days)
        day = _simulate_day(cur, slot_to_pallet, layout, target)
        if cur >= window_start:
            days.append(day)
        cur += timedelta(days=1)

    if verbose:
        print(
            f"[generate] window:     {window_days} days "
            f"({window_start} → {end_date})"
        )
        print(
            f"[generate] final occupancy: {len(slot_to_pallet)}/"
            f"{len(layout.all_slots)}"
        )

    return days


def main(end_date_str: str | None = None) -> None:
    end_date = date.fromisoformat(end_date_str) if end_date_str else date.today()
    days = generate_window(end_date)

    out_dir = DATA_DIR / "day"
    out_dir.mkdir(parents=True, exist_ok=True)

    for day in days:
        path = out_dir / f"{day.date.isoformat()}.json"
        path.write_text(day.model_dump_json(indent=2))

    manifest = {
        "version": 1,
        "genesis": GENESIS.isoformat(),
        "end": end_date.isoformat(),
        "days": [d.date.isoformat() for d in days],
    }
    (DATA_DIR / "days.json").write_text(json.dumps(manifest, indent=2))

    print(f"[generate] wrote {len(days)} day files → {out_dir}")
    print(f"[generate] wrote manifest → {DATA_DIR / 'days.json'}")


if __name__ == "__main__":
    import sys
    arg = sys.argv[1] if len(sys.argv) > 1 else None
    main(arg)
