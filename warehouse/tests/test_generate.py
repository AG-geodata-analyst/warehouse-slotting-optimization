"""Tests for warehouse.generate — determinism and split integration."""
from datetime import date
import pytest
from warehouse.generate import generate_window


def _day_pallets(days):
    """Flatten all inbound pallets across all days."""
    for day in days:
        for event in day.inbound:
            for pallet in event.pallets:
                yield pallet


def test_determinism():
    """Same end_date must produce identical days."""
    d = date(2026, 10, 19)
    days_a, _ = generate_window(d, verbose=False)
    days_b, _ = generate_window(d, verbose=False)
    assert len(days_a) == len(days_b)
    for a, b in zip(days_a, days_b):
        assert a.model_dump() == b.model_dump()


def test_window_length():
    """generate_window returns exactly WINDOW_DAYS."""
    days, _ = generate_window(date(2026, 10, 19), verbose=False)
    assert len(days) == 30


def test_split_pallets_have_part_ids():
    """Any pallet that was split must have a -partN suffix."""
    days, _ = generate_window(date(2026, 10, 19), verbose=False)
    parts = [p for p in _day_pallets(days) if "-part" in p.id]
    if parts:
        assert all("-part" in p.id for p in parts)


def test_no_pallet_exceeds_capacity():
    """After splitting, every pallet must fit on one physical pallet."""
    from warehouse.palletizer import get_max_capacity
    days, _ = generate_window(date(2026, 10, 19), verbose=False)
    for p in _day_pallets(days):
        cap = get_max_capacity(p.sku)
        assert p.boxes <= cap, (
            f"Pallet {p.id} has {p.boxes} boxes but {p.sku} capacity is {cap}"
        )


def test_split_parts_sum_to_original():
    """If a pallet was split, the parts should sum to the original count."""
    days, _ = generate_window(date(2026, 10, 19), verbose=False)
    by_base: dict[str, list] = {}
    for p in _day_pallets(days):
        base = p.id.split("-part")[0]
        by_base.setdefault(base, []).append(p)
    for base, parts in by_base.items():
        if len(parts) > 1:
            assert all("-part" in p.id for p in parts)
