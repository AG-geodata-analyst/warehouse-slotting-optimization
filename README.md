# 📦 Warehouse Slotting & Palletization Optimization

> A decision-support system that combines SKU inventory records, packaging specifications, pallet constraints, rack-slot availability, and whole-pallet movement history to recommend feasible pallet configurations, allocate new pallets to suitable slots, and identify existing storage assignments worth relocating.

[![Python 3.12](https://img.shields.io/badge/python-3.12-blue.svg)](https://www.python.org/downloads/release/python-3120/)
[![Pydantic 2](https://img.shields.io/badge/pydantic-2-E92063.svg)](https://docs.pydantic.dev/)
[![Status](https://img.shields.io/badge/status-v1.0%20release-brightgreen.svg)](#-roadmap)

---

## 🎯 The problem

A warehouse is fundamentally a spatial system. Each pallet has a physical footprint, each storage slot has constraints (dimensions, weight capacity, access), and every pallet movement carries a cost in time, equipment, and disruption. In most warehouses, put-away decisions rely on spreadsheet rules or worker intuition rather than a reproducible, data-driven model.

This project builds that model. It answers three connected questions:

1. **How should incoming boxes be arranged on wooden pallets?** (palletization)
2. **Which slot should each resulting pallet go to?** (allocation)
3. **Are existing pallets stored in suboptimal positions worth relocating?** (re-slotting)

The third question is the analytical payoff: a frequently moved SKU may sit in an oversized or hard-to-reach slot, when a better location exists and the relocation is justified by reduced handling.

---

## 🧱 Scope of Version 1

| Decision | Why |
|---|---|
| **Synthetic data, not company data** | Reproducible; no confidentiality risk; realistic volume via tuned generator |
| **Whole-pallet operations only** | Every inbound and outbound event moves a complete pallet, not individual boxes |
| **Deterministic per date** | Same date → same events, forever. Bug reports are reproducible. Different dates → different scenarios |
| **Static 3D website, no backend in v1** | Fast, cheap, hosted on GitHub Pages; pipeline commits JSON, viewer renders |
| **Rule-based allocation in v1** | Transparent, inspectable, debuggable; optimisation libraries deferred to v2 |

---

## 🏗️ Architecture

```
GitHub Actions (cron, daily 06:00 UTC)
        │
        ▼
Python pipeline  (warehouse/)
   • deterministic day generator (seed = date)
   • 5 inbound events + 5 outbound events per day
   • equilibrium rule keeps occupancy at 60–80%
   • writes 30-day rolling window to data/
        │
        ▼
data/layout.json    +    data/day/YYYY-MM-DD.json
        │
        ▼
Three.js 3D viewer  (GitHub Pages)
   • 100-slot warehouse rendered with InstancedMesh
   • timeline: 30 days × 5 events
   • pallets animate from dock to slot
```

**Two workflows, one repo.**

- `simulate.yml` — regenerates the last 30 days, commits to `data/`
- `deploy.yml` — builds the viewer, publishes to GitHub Pages

---

## 🗺️ Roadmap

| Version | Focus | Status |
|---|---|---|
| **v0.1** | Data model, 100-slot layout, deterministic day generator | ✅ |
| **v0.2** | GitHub Actions scheduled simulation (daily commit) | ✅ |
| **v0.3** | Three.js 3D viewer (100 slots, 30 days) | ✅ |
| **v0.4** | Movement story (pallet age symbols, fast-mover highlight, play-month) | ✅ |
| **v0.5** | Palletization viewer — 3 stacking patterns, box view toggle, side panel inspector | ✅ |
| **v0.6** | ABC placement quality (good / wasted / misplaced) + stranded KPI + click-to-focus | ✅ |
| **v1.0** | KPIs dashboard, test suite, docs refresh, polish | ⏳ |
| **v2.0** | Backend for user-submitted what-if scenarios | 🚫 out of scope |

---

## 👀 What you're looking at

The live demo is deployed at **https://ag-geodata-analyst.github.io/warehouse-slotting-optimization/**.

- **Blocks view** (default) — one solid block per pallet, coloured by its floor (blue = B1, green = 1F, amber = 2F) or by placement quality when the toggle is on
- **Boxes view** — same pallets rendered as individual boxes according to the winning stacking pattern (Pinwheel / Split-Block / Column)
- **Quality mode** — green = pallet tier matches slot tier, amber = wasted (slow mover in a prime slot), red = misplaced (fast mover far from dispatch)
- **Age symbols** — ● 0–7 days · ▲ 8–14 days · ✕ 15+ days
- **Click any pallet** — camera zooms in, siblings of the same delivery stay bright, the rest dim; side panel shows the 3D stacking preview, SKU, weight, age, and quality
- **HUD** — day slider, ▶ Play month, and the KPI line: `% A-placed · avg distance · would move · stranded`
- **Cyan marker at (0, 0)** — the dispatch origin every "avg distance" is measured from

---


## 🚀 Quick start

### Prerequisites

- Python 3.12+
- Git

### Setup

```bash
git clone https://github.com/AG-geodata-analyst/warehouse-slotting-optimization.git
cd warehouse-slotting-optimization
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### Generate a warehouse layout

```bash
python -m warehouse.layout
```

Output: `data/layout.json` with 100 slots across 3 floors and 10 racks.

### Generate a 30-day simulation window

```bash
python -m warehouse.generate 2026-10-19
```

Output: `data/days.json` (manifest) plus one `data/day/YYYY-MM-DD.json` per day.

### Verify determinism

Run the same command twice, check that `git diff data/` is empty:

```bash
python -m warehouse.generate 2026-10-19
git diff data/day/2026-10-19.json   # should print nothing
```

---

## 📐 Data contract

Everything the pipeline produces is JSON, versioned with a top-level `"version": 1` field. The TypeScript viewer will consume these files directly — no translation layer.

| File | Contents | Approx size |
|---|---|---|
| `data/layout.json` | Floor/rack/slot geometry for the full warehouse | ~30 KB |
| `data/days.json` | Manifest of available days | ~1 KB |
| `data/day/YYYY-MM-DD.json` | One day's inbound + outbound events | ~10 KB |

The schema is defined in `warehouse/models.py` via Pydantic, so both the Python producer and any consumer agree on the shape.

---

## 🧠 Design principles

- **Determinism over randomness** — each day's seed is derived from its date. Same date → same simulation, forever.
- **Genesis replay** — day *N* always replays days 1..N−1 to compute the correct starting occupancy, independent of the display window.
- **Version every file** — retrofitting versioning is painful; add it in the first commit.
- **JSON that looks like an API response** — v1 static files mirror what a v2 backend will return, so the frontend needs no refactor to move from static to dynamic.

---

## 🙋 About

**Anderson Isaac Guamán Viveros**
Background in GIScience, Earth Observation, and Environmental Modelling. Focus on data engineering, data quality, and geospatial analytics.

- GitHub: [@AG-geodata-analyst](https://github.com/AG-geodata-analyst)
