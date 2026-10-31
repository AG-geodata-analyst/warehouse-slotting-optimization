"""Tests for warehouse.palletizer — capacity math and split logic."""
import pytest
from warehouse.palletizer import (
    get_max_capacity,
    split_pallet_boxes,
    BOX_SPECS,
    PALLET_H,
)


def test_all_skus_return_positive_capacity():
    """Every SKU must fit at least one box on a pallet."""
    for i in range(1, 51):
        sku = f"N{i:03d}"
        assert get_max_capacity(sku) > 0, f"{sku} has zero capacity"


def test_capacity_consistent_across_calls():
    """Determinism: same SKU → same capacity, every time."""
    for sku in ["N001", "N025", "N050"]:
        assert get_max_capacity(sku) == get_max_capacity(sku)


def test_split_returns_single_item_when_within_capacity():
    """Batches that fit are not split."""
    sku = "N037"
    cap = get_max_capacity(sku)
    assert split_pallet_boxes(1, sku) == [1]
    assert split_pallet_boxes(cap, sku) == [cap]


def test_split_exceeds_capacity():
    """Batches exceeding capacity are split into multiple valid parts."""
    sku = "N037"
    cap = get_max_capacity(sku)
    result = split_pallet_boxes(cap + 1, sku)
    assert len(result) == 2
    assert sum(result) == cap + 1
    assert all(x <= cap for x in result)


def test_split_sum_always_equals_input():
    """Conservation: sum of parts == original box count."""
    for sku in ["N001", "N037", "N050"]:
        for boxes in [1, 10, 50, 100, 250]:
            parts = split_pallet_boxes(boxes, sku)
            assert sum(parts) == boxes
            cap = get_max_capacity(sku)
            assert all(p <= cap for p in parts), f"{sku} split of {boxes} exceeds capacity"


def test_box_specs_have_required_fields():
    """Every BOX_SPECS entry must be usable by the capacity math."""
    for spec in BOX_SPECS:
        assert 'id' in spec
        assert 'w' in spec and spec['w'] > 0
        assert 'd' in spec and spec['d'] > 0
        assert 'h' in spec and spec['h'] > 0
        assert spec['h'] <= PALLET_H, f"{spec['id']} taller than pallet"
