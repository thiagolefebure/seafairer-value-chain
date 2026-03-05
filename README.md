# 🌊 SEAFAIRER — Biofuel Value Chain Decision-Making Tool

> **Maritime decarbonisation** · Mixed-Integer Linear Programming · Monte Carlo Uncertainty Analysis · Life-Cycle Assessment

[![Live Dashboard](https://img.shields.io/badge/Live%20Demo-Vercel-black?style=flat-square&logo=vercel)](https://your-vercel-url.vercel.app)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

---

## Overview

This tool supports **techno-economic and environmental optimisation** of advanced biofuel supply chains targeting maritime decarbonisation, in the context of the [SEAFAIRER Horizon Europe Innovation Action](https://cordis.europa.eu/project/id/101056730).

It implements the core analytical framework described in the project:

| Module | Method | Output |
|---|---|---|
| `milp_solver.py` | Mixed-Integer Linear Programming (PuLP/CBC) | Optimal routing, LCOF, cost breakdown |
| `monte_carlo.py` | Stochastic Monte Carlo (1000 runs) | P10/P50/P90 confidence intervals, sensitivity indices |
| `lca.py` | ISO 14040/44 cradle-to-wake LCA | GHG intensity (gCO₂eq/MJ), FuelEU compliance |
| `dashboard/` | React interactive frontend | Live parameter exploration |

---

## The Problem

Maritime shipping accounts for ~3% of global CO₂ emissions. The IMO targets a **40% GHG reduction by 2030** and net zero by 2050. Drop-in biofuels — chemically equivalent to fossil HFO but produced from lignocellulosic biomass — are one of the few near-term pathways that don't require fleet retrofitting.

The challenge: **the economics are highly sensitive** to feedstock costs, conversion efficiency, hydrogen source, and carbon pricing. This tool quantifies that uncertainty and finds optimal supply chain configurations.

---

## Value Chain Structure

```
Biomass Farm → Preprocessing → Pyrolysis → Hydrotreatment → Blending → Port Bunker
     ↓               ↓              ↓              ↓              ↓           ↓
  Feedstock       Drying,       Bio-oil       Drop-in        B20-B30    Maritime
  procurement    size reduc.   production    biofuel        blending    delivery
```

**Technology pathway:** Fast pyrolysis of lignocellulosic biomass → bio-oil upgrading via catalytic hydrotreatment → drop-in marine distillate fuel (compliant with ISO 8217).

---

## MILP Formulation

**Objective:** Minimise net cost of fuel delivery

$$\min \sum_{i} c_i x_i - p_{CO_2} \sum_{i} e_i x_i$$

**Subject to:**
- Mass balance: $x_{i+1} \leq \eta_i \cdot x_i$ at each node $i$
- Capacity: $Q_i^{min} y_i \leq x_i \leq Q_i^{max} y_i$
- Demand: $x_{bunker} \geq D_{target}$
- GHG requirement: $\sum_i e_i x_i \geq r_{min} \cdot x_{farm}$ (FuelEU compliance)
- Binary: $y_i \in \{0,1\}$ (node activation)

Where $x_i$ = flow [t], $c_i$ = unit cost [€/t], $p_{CO_2}$ = carbon price [€/tCO₂], $\eta_i$ = conversion efficiency.

---

## Installation

```bash
git clone https://github.com/your-username/seafairer-value-chain.git
cd seafairer-value-chain
pip install -r requirements.txt
```

---

## Usage

### MILP Optimizer
```bash
# Run with default parameters
python solver/milp_solver.py

# Custom scenario
python solver/milp_solver.py \
  --feedstock-cost 95 \
  --carbon-price 120 \
  --demand 8000 \
  --output-json results/optimal_chain.json
```

**Sample output:**
```
=======================================================
  SEAFAIRER MILP — Optimal Value Chain Solution
=======================================================
  Status          : Optimal
  Fuel delivered  : 5,000 t
  Total cost      : €892,450
  Carbon credits  : €148,200
  Net cost        : €744,250
  GHG saved       : 1,560 tCO₂e
  LCOF            : €148.85/t
=======================================================
```

### Monte Carlo Uncertainty Analysis
```bash
# Run 1000 simulations, export results
python solver/monte_carlo.py --runs 1000 --output results/mc_results.csv
```

**Sample output:**
```
=======================================================
  Monte Carlo Uncertainty Analysis — LCOF (€/t)
=======================================================
  P10  : €118/t   (optimistic)
  P50  : €149/t   (median)
  P90  : €197/t   (pessimistic)
  Mean : €152/t  ± 24

  Top sensitivity drivers:
    feedstock_cost          38.2% variance
    conversion_eff          27.1% variance
    opex_hydro              16.4% variance
=======================================================
```

### Life-Cycle Assessment
```bash
# Compare biomass types and H2 sources
python solver/lca.py --biomass agricultural_residue --h2 electrolysis_renewable

# Check FuelEU compliance under different scenarios
python solver/lca.py --biomass energy_crop --h2 SMR_natural_gas --no-luc
```

---

## Data Sources

| File | Description | Source |
|---|---|---|
| `data/feedstock_costs.csv` | Regional feedstock prices and availability | ENTSOG 2023, EEA 2023, JRC 2022 |
| `data/ghg_factors.csv` | GHG emission factors by process stage | ecoinvent 3.9, IPCC AR6, FuelEU Maritime |

---

## Key Results

| Scenario | LCOF (€/t) | GHG Reduction | FuelEU 2030 |
|---|---|---|---|
| Optimistic | ~118 | 68% | ✅ |
| Base Case | ~149 | 54% | ✅ |
| Pessimistic | ~197 | 41% | ✅ |
| High Carbon Price (€180) | ~131 | 54% | ✅ |

The base case achieves a **54% GHG reduction vs HFO**, well above the 40% FuelEU 2030 threshold. The main cost driver is feedstock price (38% of LCOF variance), followed by pyrolysis conversion efficiency (27%).

---

## Interactive Dashboard

The `dashboard/` folder contains a React application with four panels:

- **MILP Optimizer** — live sliders for all parameters, real-time cost/GHG output
- **Sensitivity Analysis** — tornado chart + parameter sweep curves
- **Monte Carlo** — LCOF distribution histogram, cost–GHG trade-off scatter
- **Life-Cycle** — LCA radar chart, GHG pathway vs IMO targets

→ **[Open live demo](https://your-vercel-url.vercel.app)**

---

## Methodology Notes

- **MILP solver**: CBC via PuLP. For production use, replace with Gurobi or CPLEX for larger instances (>100 nodes).
- **Monte Carlo**: Parameters sampled from triangular/normal distributions based on literature ranges. Sobol sensitivity approximated via Pearson correlation; full variance decomposition available with SALib.
- **LCA**: Follows ISO 14040/44. GHG factors from ecoinvent 3.9 and IPCC AR6. Biogenic CO₂ accounting per RED III Article 29. Land use change per JRC ILUC factors.
- **FuelEU compliance**: Assessed against Annex I of Regulation (EU) 2023/1805 well-to-wake GHG intensity thresholds.

---

## Project Context

This tool was developed as part of portfolio work aligned with the **SEAFAIRER Horizon Europe Innovation Action** (Grant Agreement 101056730), which targets TRL 7 demonstration of improved intermediate biofuels for maritime decarbonisation at DTU Chemical Engineering.

---

## License

MIT License — see [LICENSE](LICENSE) for details.
"# seafairer-value-chain" 
