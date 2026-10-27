import math

PALLET_W = 1200
PALLET_D = 800
PALLET_H = 1500

# Must match viewer/src/palletizer.ts BOX_SPECS exactly.
BOX_SPECS = [
    {'id': 'cube-s',     'w': 250, 'd': 250, 'h': 250},
    {'id': 'rect-s',     'w': 300, 'd': 200, 'h': 150},
    {'id': 'cube-m',     'w': 300, 'd': 300, 'h': 300},
    {'id': 'rect-sm',    'w': 350, 'd': 250, 'h': 200},
    {'id': 'cube-l',     'w': 400, 'd': 400, 'h': 400},
    {'id': 'rect-xl',    'w': 450, 'd': 300, 'h': 250},
    {'id': 'rect-pw',    'w': 400, 'd': 350, 'h': 200},
    {'id': 'rect-long',  'w': 600, 'd': 180, 'h': 200},
    {'id': 'rect-wedge', 'w': 500, 'd': 300, 'h': 250},
    {'id': 'rect-sb',    'w': 550, 'd': 280, 'h': 250},
]


def _hash_sku(sku: str) -> int:
    h = 17
    for c in sku:
        h = (h * 31 + ord(c)) & 0xFFFFFFFF
    return h


def get_max_capacity(sku: str) -> int:
    """
    Return max boxes that fit on one EUR1 pallet for this SKU.
    Mirrors viewer/src/palletizer.ts chooseBestPattern().
    """
    box = BOX_SPECS[_hash_sku(sku) % len(BOX_SPECS)]
    W = max(box['w'], box['d'])
    D = min(box['w'], box['d'])

    # Column A / B
    c_a = (PALLET_W // W) * (PALLET_D // D) if W <= PALLET_W and D <= PALLET_D else 0
    c_b = (PALLET_W // D) * (PALLET_D // W) if D <= PALLET_W and W <= PALLET_D else 0

    # Pinwheel A / B
    pw_a = 6 if (W + D <= PALLET_W and 2 * W + D <= PALLET_D) else 0
    pw_b = 6 if (W + D <= PALLET_D and 2 * W + D <= PALLET_W) else 0

    # Split-Block A / B
    sb_a = 0
    if W + D <= PALLET_W and 2 * W <= PALLET_D:
        sb_a = 2 + (2 * W) // D
    sb_b = 0
    if W + D <= PALLET_D and 2 * W <= PALLET_W:
        sb_b = 2 + (2 * W) // D

    per_layer = max(c_a, c_b, pw_a, pw_b, sb_a, sb_b)
    max_layers = PALLET_H // box['h']
    return max(1, per_layer * max_layers)


def split_pallet_boxes(boxes: int, sku: str) -> list[int]:
    """Split a batch of boxes into physical pallets, each within capacity."""
    cap = get_max_capacity(sku)
    if boxes <= cap:
        return [boxes]
    result = []
    remaining = boxes
    while remaining > 0:
        take = min(remaining, cap)
        result.append(take)
        remaining -= take
    return result
