"""
SEAFAIRER Value Chain MILP Optimizer
=====================================
Mixed-Integer Linear Programming model for optimizing biofuel supply chains
targeting maritime drop-in fuel production (Horizon Europe Innovation Action).

Formulation
-----------
Minimize: Total net cost = sum of node costs - carbon credits
Subject to:
  - Mass balance at each node
  - Capacity constraints per node
  - Minimum GHG reduction requirement (FuelEU Maritime)
  - Binary route selection variables

Author: Portfolio project — DTU Chemical Engineering context
Dependencies: pulp, pandas, numpy
"""

import pandas as pd
import numpy as np
import pulp
from dataclasses import dataclass, field
from typing import Dict, List, Tuple
import json


# ── Data structures ────────────────────────────────────────────────────────────

@dataclass
class Node:
    name: str
    capacity_min: float   # tonnes/year
    capacity_max: float
    opex_per_tonne: float # €/t input
    conversion_eff: float # output/input ratio
    ghg_saving: float     # tCO2e saved per tonne processed


@dataclass
class Route:
    origin: str
    destination: str
    transport_cost: float  # €/t·km
    distance_km: float
    available: bool = True


@dataclass
class ValueChainParams:
    feedstock_cost: float = 85.0       # €/t
    carbon_price: float = 95.0         # €/tCO2 (EU ETS)
    demand_target: float = 5000.0      # tonnes fuel/year
    min_ghg_reduction: float = 0.40    # 40% vs fossil baseline (FuelEU)
    fossil_ghg_intensity: float = 91.0 # gCO2eq/MJ (HFO baseline)


# ── Default value chain nodes ──────────────────────────────────────────────────

DEFAULT_NODES = [
    Node("Biomass_Farm",      1000,  50000, 0,    1.00, 0.00),
    Node("Preprocessing",     800,   40000, 18,   0.97, 0.00),
    Node("Pyrolysis",         500,   25000, 45,   0.62, 0.38),
    Node("Hydrotreatment",    400,   20000, 60,   0.92, 0.12),
    Node("Blending",          300,   18000, 12,   0.97, 0.00),
    Node("Port_Bunker",       200,   15000, 8,    0.99, 0.00),
]

DEFAULT_ROUTES = [
    Route("Biomass_Farm",    "Preprocessing",  0.08, 120),
    Route("Preprocessing",   "Pyrolysis",      0.06, 80),
    Route("Pyrolysis",       "Hydrotreatment", 0.05, 60),
    Route("Hydrotreatment",  "Blending",       0.04, 40),
    Route("Blending",        "Port_Bunker",    0.07, 90),
]


# ── MILP Model ────────────────────────────────────────────────────────────────

class BiofuelValueChainMILP:
    """
    MILP formulation of the biofuel value chain.
    
    Decision variables:
        x[i]  : flow (tonnes) through node i  [continuous]
        y[i]  : node active flag               [binary]
        z[r]  : route active flag              [binary]
    
    Objective:
        Minimize total_cost - carbon_credits
    """

    def __init__(self, params: ValueChainParams, nodes: List[Node] = None, routes: List[Route] = None):
        self.params = params
        self.nodes = nodes or DEFAULT_NODES
        self.routes = routes or DEFAULT_ROUTES
        self.model = None
        self.results = {}

    def build(self):
        p = self.params
        self.model = pulp.LpProblem("Biofuel_ValueChain_MILP", pulp.LpMinimize)

        # ── Decision variables ────────────────────────────────────────────────
        x = {n.name: pulp.LpVariable(f"flow_{n.name}", lowBound=0) for n in self.nodes}
        y = {n.name: pulp.LpVariable(f"active_{n.name}", cat="Binary") for n in self.nodes}
        z = {(r.origin, r.destination): pulp.LpVariable(f"route_{r.origin}_{r.destination}", cat="Binary")
             for r in self.routes}

        # ── Objective: minimise net cost ──────────────────────────────────────
        feedstock_cost  = p.feedstock_cost * x["Biomass_Farm"]
        processing_cost = pulp.lpSum(n.opex_per_tonne * x[n.name] for n in self.nodes)
        transport_cost  = pulp.lpSum(
            r.transport_cost * r.distance_km * x[r.origin]
            for r in self.routes if r.available
        )
        carbon_credits  = p.carbon_price * pulp.lpSum(n.ghg_saving * x[n.name] for n in self.nodes)

        self.model += feedstock_cost + processing_cost + transport_cost - carbon_credits

        # ── Constraints ───────────────────────────────────────────────────────

        # 1. Demand satisfaction
        self.model += x["Port_Bunker"] >= p.demand_target, "demand"

        # 2. Mass balance through each node pair
        for r in self.routes:
            src = next(n for n in self.nodes if n.name == r.origin)
            dst = next(n for n in self.nodes if n.name == r.destination)
            self.model += x[dst.name] <= src.conversion_eff * x[src.name], f"mass_balance_{r.origin}"

        # 3. Capacity constraints (big-M formulation)
        M = 1e6
        for n in self.nodes:
            self.model += x[n.name] >= n.capacity_min * y[n.name], f"cap_min_{n.name}"
            self.model += x[n.name] <= n.capacity_max * y[n.name], f"cap_max_{n.name}"

        # 4. Route activation: can only use route if both ends are active
        for r in self.routes:
            self.model += z[(r.origin, r.destination)] <= y[r.origin],      f"route_src_{r.origin}"
            self.model += z[(r.origin, r.destination)] <= y[r.destination],  f"route_dst_{r.destination}"

        # 5. GHG reduction requirement
        total_ghg_saved = pulp.lpSum(n.ghg_saving * x[n.name] for n in self.nodes)
        # Simplified: require saved GHG >= threshold * feedstock input
        self.model += total_ghg_saved >= p.min_ghg_reduction * x["Biomass_Farm"], "ghg_requirement"

        self._x = x
        self._y = y
        self._z = z
        return self

    def solve(self, solver=None) -> Dict:
        if self.model is None:
            self.build()

        solver = solver or pulp.PULP_CBC_CMD(msg=False)
        status = self.model.solve(solver)

        if pulp.LpStatus[status] != "Optimal":
            raise RuntimeError(f"Solver did not find optimal solution. Status: {pulp.LpStatus[status]}")

        x, y, z = self._x, self._y, self._z

        flows = {n: pulp.value(x[n]) or 0 for n in x}
        active_nodes = [n for n in y if pulp.value(y[n]) > 0.5]

        total_cost = (
            self.params.feedstock_cost * flows["Biomass_Farm"]
            + sum(n.opex_per_tonne * flows[n.name] for n in self.nodes)
            + sum(r.transport_cost * r.distance_km * flows[r.origin] for r in self.routes)
        )
        carbon_credits = self.params.carbon_price * sum(n.ghg_saving * flows[n.name] for n in self.nodes)
        net_cost = total_cost - carbon_credits
        ghg_saved = sum(n.ghg_saving * flows[n.name] for n in self.nodes)
        lcof = net_cost / max(flows["Port_Bunker"], 1)

        self.results = {
            "status": pulp.LpStatus[status],
            "flows_t": flows,
            "active_nodes": active_nodes,
            "total_cost_eur": round(total_cost, 2),
            "carbon_credits_eur": round(carbon_credits, 2),
            "net_cost_eur": round(net_cost, 2),
            "ghg_saved_tco2": round(ghg_saved, 2),
            "lcof_eur_per_t": round(lcof, 2),
            "objective": round(pulp.value(self.model.objective), 2),
        }
        return self.results

    def to_dataframe(self) -> pd.DataFrame:
        if not self.results:
            raise RuntimeError("Run solve() first.")
        rows = []
        for n in self.nodes:
            rows.append({
                "node": n.name,
                "flow_t": round(self.results["flows_t"][n.name], 1),
                "active": n.name in self.results["active_nodes"],
                "opex_eur": round(n.opex_per_tonne * self.results["flows_t"][n.name], 0),
                "ghg_saved_tco2": round(n.ghg_saving * self.results["flows_t"][n.name], 1),
            })
        return pd.DataFrame(rows)

    def summary(self) -> str:
        r = self.results
        lines = [
            "=" * 55,
            "  SEAFAIRER MILP — Optimal Value Chain Solution",
            "=" * 55,
            f"  Status          : {r['status']}",
            f"  Fuel delivered  : {r['flows_t']['Port_Bunker']:,.0f} t",
            f"  Total cost      : €{r['total_cost_eur']:,.0f}",
            f"  Carbon credits  : €{r['carbon_credits_eur']:,.0f}",
            f"  Net cost        : €{r['net_cost_eur']:,.0f}",
            f"  GHG saved       : {r['ghg_saved_tco2']:,.0f} tCO₂e",
            f"  LCOF            : €{r['lcof_eur_per_t']:.2f}/t",
            "=" * 55,
        ]
        return "\n".join(lines)


# ── CLI entry point ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="SEAFAIRER Biofuel Value Chain MILP Optimizer")
    parser.add_argument("--feedstock-cost", type=float, default=85.0)
    parser.add_argument("--carbon-price",   type=float, default=95.0)
    parser.add_argument("--demand",         type=float, default=5000.0)
    parser.add_argument("--min-ghg",        type=float, default=0.40)
    parser.add_argument("--output-json",    type=str,   default=None)
    args = parser.parse_args()

    params = ValueChainParams(
        feedstock_cost=args.feedstock_cost,
        carbon_price=args.carbon_price,
        demand_target=args.demand,
        min_ghg_reduction=args.min_ghg,
    )

    solver = BiofuelValueChainMILP(params)
    results = solver.solve()

    print(solver.summary())
    print("\nNode-level breakdown:")
    print(solver.to_dataframe().to_string(index=False))

    if args.output_json:
        with open(args.output_json, "w") as f:
            json.dump(results, f, indent=2)
        print(f"\nResults saved to {args.output_json}")
