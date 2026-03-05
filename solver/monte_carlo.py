"""
Monte Carlo Uncertainty & Sensitivity Analysis
===============================================
Stochastic assessment of biofuel value chain economics under parameter uncertainty.
Supports both Monte Carlo simulation and one-at-a-time (OAT) sensitivity analysis.

Methodology
-----------
- Parameters sampled from specified distributions (uniform / triangular / normal)
- 1000 simulation runs per scenario by default
- Outputs P10/P50/P90 confidence intervals on LCOF and GHG metrics
- Sobol-style sensitivity indices approximated via OAT variance decomposition

Dependencies: numpy, pandas, scipy, matplotlib
"""

import numpy as np
import pandas as pd
from scipy import stats
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Tuple, Optional
import warnings
warnings.filterwarnings("ignore")


# ── Parameter distributions ────────────────────────────────────────────────────

@dataclass
class UncertainParam:
    name: str
    base: float
    dist: str          # "uniform", "triangular", "normal"
    low: float = None
    high: float = None
    std: float = None  # for normal dist

    def sample(self, n: int) -> np.ndarray:
        if self.dist == "uniform":
            return np.random.uniform(self.low, self.high, n)
        elif self.dist == "triangular":
            mid = (self.low + self.high) / 2
            return np.random.triangular(self.low, self.base, self.high, n)
        elif self.dist == "normal":
            return np.random.normal(self.base, self.std, n)
        else:
            raise ValueError(f"Unknown distribution: {self.dist}")


DEFAULT_PARAMS = [
    UncertainParam("feedstock_cost",  85,  "triangular", low=50,  high=140),
    UncertainParam("conversion_eff",  0.62,"triangular", low=0.45, high=0.80),
    UncertainParam("transport_cost",  22,  "uniform",    low=12,  high=40),
    UncertainParam("carbon_price",    95,  "normal",     std=25),
    UncertainParam("opex_pyrolysis",  45,  "triangular", low=30,  high=70),
    UncertainParam("opex_hydro",      60,  "triangular", low=40,  high=90),
]


# ── Simplified model (closed-form, fast for MC) ────────────────────────────────

def fast_value_chain(params_dict: Dict, demand: float = 5000.0) -> Dict:
    """
    Closed-form value chain evaluation for Monte Carlo speed.
    Returns LCOF (€/t), GHG saved (tCO2e), and net cost (€).
    """
    fc   = params_dict.get("feedstock_cost", 85)
    eff  = params_dict.get("conversion_eff", 0.62)
    tc   = params_dict.get("transport_cost", 22)
    cp   = params_dict.get("carbon_price", 95)
    op_p = params_dict.get("opex_pyrolysis", 45)
    op_h = params_dict.get("opex_hydro", 60)

    # Back-calculate required input at each stage
    q_bunker  = demand
    q_blend   = q_bunker  / 0.97
    q_hydro   = q_blend   / 0.92
    q_pyro    = q_hydro   / eff
    q_prep    = q_pyro    / 0.97
    q_farm    = q_prep    / 1.00

    cost = (
        fc  * q_farm   +   # feedstock
        18  * q_prep   +   # preprocessing opex
        op_p * q_pyro  +   # pyrolysis opex
        op_h * q_hydro +   # hydrotreatment opex
        12  * q_blend  +   # blending opex
        tc  * q_farm   +   # transport (simplified flat per tonne)
        8   * q_bunker     # bunkering opex
    )

    ghg_saved = 0.38 * q_pyro + 0.12 * q_hydro
    carbon_credit = cp * ghg_saved
    net_cost = cost - carbon_credit
    lcof = net_cost / demand

    return {"lcof": lcof, "ghg_saved": ghg_saved, "net_cost": net_cost, "cost_gross": cost}


# ── Monte Carlo engine ─────────────────────────────────────────────────────────

class MonteCarloAnalysis:
    """
    Runs stochastic simulations across the biofuel value chain.
    """

    def __init__(self, uncertain_params: List[UncertainParam] = None, demand: float = 5000.0, seed: int = 42):
        self.params = uncertain_params or DEFAULT_PARAMS
        self.demand = demand
        self.seed = seed
        self.results_df: Optional[pd.DataFrame] = None

    def run(self, n_simulations: int = 1000) -> pd.DataFrame:
        np.random.seed(self.seed)

        # Sample all parameters
        samples = {p.name: p.sample(n_simulations) for p in self.params}

        # Evaluate model for each sample
        rows = []
        for i in range(n_simulations):
            pdict = {k: v[i] for k, v in samples.items()}
            result = fast_value_chain(pdict, self.demand)
            rows.append({**pdict, **result})

        self.results_df = pd.DataFrame(rows)
        return self.results_df

    def percentiles(self, metric: str = "lcof") -> Dict:
        if self.results_df is None:
            self.run()
        s = self.results_df[metric]
        return {
            "P05": round(s.quantile(0.05), 2),
            "P10": round(s.quantile(0.10), 2),
            "P25": round(s.quantile(0.25), 2),
            "P50": round(s.quantile(0.50), 2),
            "P75": round(s.quantile(0.75), 2),
            "P90": round(s.quantile(0.90), 2),
            "P95": round(s.quantile(0.95), 2),
            "mean": round(s.mean(), 2),
            "std":  round(s.std(), 2),
        }

    def sensitivity_indices(self, metric: str = "lcof") -> pd.DataFrame:
        """
        Approximates first-order sensitivity indices via variance decomposition.
        Method: fix all other params at base, vary one at a time, compute variance share.
        """
        if self.results_df is None:
            self.run()

        total_variance = self.results_df[metric].var()
        indices = []

        for p in self.params:
            # Pearson correlation as a proxy for linear sensitivity
            corr = self.results_df[p.name].corr(self.results_df[metric])
            # Variance explained (R² contribution, approximate)
            partial_r2 = corr ** 2
            indices.append({
                "parameter": p.name,
                "correlation": round(corr, 4),
                "sensitivity_index": round(partial_r2, 4),
                "pct_variance_explained": round(partial_r2 * 100, 1),
            })

        return pd.DataFrame(indices).sort_values("sensitivity_index", ascending=False)

    def oat_sensitivity(self, metric: str = "lcof", delta_pct: float = 10.0) -> pd.DataFrame:
        """
        One-At-a-Time (OAT) sensitivity: vary each param ±delta_pct, hold others at base.
        Returns elasticity = % change in metric / % change in param.
        """
        base_params = {p.name: p.base for p in self.params}
        base_result = fast_value_chain(base_params, self.demand)[metric]

        rows = []
        for p in self.params:
            for sign, label in [(+1, f"+{delta_pct}%"), (-1, f"-{delta_pct}%")]:
                perturbed = {**base_params, p.name: p.base * (1 + sign * delta_pct / 100)}
                perturbed_result = fast_value_chain(perturbed, self.demand)[metric]
                pct_change_metric = (perturbed_result - base_result) / base_result * 100
                elasticity = pct_change_metric / (sign * delta_pct)
                rows.append({
                    "parameter": p.name,
                    "perturbation": label,
                    f"{metric}_base": round(base_result, 2),
                    f"{metric}_perturbed": round(perturbed_result, 2),
                    "pct_change": round(pct_change_metric, 2),
                    "elasticity": round(elasticity, 4),
                })

        return pd.DataFrame(rows)

    def scenario_comparison(self) -> pd.DataFrame:
        """
        Compare named scenarios: Optimistic, Base, Pessimistic, High Carbon Price.
        """
        scenarios = {
            "Optimistic":        {"feedstock_cost": 55,  "conversion_eff": 0.78, "transport_cost": 14, "carbon_price": 130, "opex_pyrolysis": 32, "opex_hydro": 44},
            "Base Case":         {"feedstock_cost": 85,  "conversion_eff": 0.62, "transport_cost": 22, "carbon_price": 95,  "opex_pyrolysis": 45, "opex_hydro": 60},
            "Pessimistic":       {"feedstock_cost": 125, "conversion_eff": 0.49, "transport_cost": 36, "carbon_price": 65,  "opex_pyrolysis": 62, "opex_hydro": 82},
            "High Carbon Price": {"feedstock_cost": 85,  "conversion_eff": 0.62, "transport_cost": 22, "carbon_price": 180, "opex_pyrolysis": 45, "opex_hydro": 60},
        }
        rows = []
        for name, p in scenarios.items():
            r = fast_value_chain(p, self.demand)
            rows.append({"scenario": name, **{k: round(v, 2) for k, v in r.items()}})
        return pd.DataFrame(rows)

    def summary(self) -> str:
        pct = self.percentiles("lcof")
        si  = self.sensitivity_indices("lcof")
        lines = [
            "=" * 55,
            "  Monte Carlo Uncertainty Analysis — LCOF (€/t)",
            "=" * 55,
            f"  P10  : €{pct['P10']}/t   (optimistic)",
            f"  P50  : €{pct['P50']}/t   (median)",
            f"  P90  : €{pct['P90']}/t   (pessimistic)",
            f"  Mean : €{pct['mean']}/t  ± {pct['std']}",
            "",
            "  Top sensitivity drivers:",
        ]
        for _, row in si.head(3).iterrows():
            lines.append(f"    {row['parameter']:<22} {row['pct_variance_explained']:>5.1f}% variance")
        lines.append("=" * 55)
        return "\n".join(lines)


# ── CLI entry point ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Monte Carlo uncertainty analysis for biofuel value chain")
    parser.add_argument("--runs",   type=int,   default=1000)
    parser.add_argument("--demand", type=float, default=5000.0)
    parser.add_argument("--seed",   type=int,   default=42)
    parser.add_argument("--output", type=str,   default=None, help="CSV output path")
    args = parser.parse_args()

    mc = MonteCarloAnalysis(demand=args.demand, seed=args.seed)
    mc.run(args.runs)

    print(mc.summary())

    print("\nScenario comparison:")
    print(mc.scenario_comparison().to_string(index=False))

    print("\nOAT Sensitivity (±10%):")
    print(mc.oat_sensitivity().to_string(index=False))

    if args.output:
        mc.results_df.to_csv(args.output, index=False)
        print(f"\nSimulation results saved to {args.output}")
