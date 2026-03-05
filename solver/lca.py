"""
Life-Cycle Assessment (LCA) Module
====================================
Cradle-to-wake GHG accounting and multi-impact LCA for maritime biofuels,
following ISO 14040/14044 and FuelEU Maritime GHG intensity methodology.

Scope
-----
- System boundary: cradle-to-wake (cultivation → bunkering → combustion)
- Functional unit: 1 MJ of fuel energy delivered to ship engine
- GHG metric: CO2 equivalent (100-year GWP, IPCC AR6)
- Complies with: FuelEU Maritime, RED III, IMO CII framework

Impact categories (simplified)
-------------------------------
1.  Climate Change (GWP100)           — gCO2eq/MJ
2.  Land Use Change                   — m²·yr/MJ
3.  Water Consumption                 — L/MJ
4.  Acidification                     — mol H+eq/MJ
5.  Eutrophication (freshwater)       — g Peq/MJ
6.  Primary Energy Demand (fossil)    — MJ_fossil/MJ_fuel

Dependencies: pandas, numpy
"""

import numpy as np
import pandas as pd
from dataclasses import dataclass, field
from typing import Dict, List, Optional


# ── Impact factor databases ────────────────────────────────────────────────────

# GHG intensities by value chain stage (gCO2eq/MJ fuel output)
GHG_FACTORS = {
    "biomass_cultivation":   4.2,   # Land preparation, fertiliser, irrigation
    "biomass_transport":     1.8,   # Truck, avg 120 km
    "preprocessing":         2.1,   # Drying, size reduction
    "pyrolysis":             6.4,   # Process heat, electricity
    "hydrotreatment":        9.2,   # H2 production, high energy
    "blending_logistics":    1.1,
    "combustion":            4.5,   # Residual biogenic + non-biogenic
    "land_use_change":       2.8,   # Indirect LUC (iLUC) factor
    # Credits
    "co2_sequestered":     -31.5,   # Biogenic carbon in biomass
    "biochar_credit":       -5.2,   # Soil carbon sequestration co-product
}

# Fossil reference: HFO (Heavy Fuel Oil) — gCO2eq/MJ
HFO_GHG_INTENSITY = 91.0  # FuelEU Maritime default

# Multi-impact factors per tonne of biomass processed
MULTI_IMPACT_FACTORS = {
    #                        land_use  water  acid   eutroph  fossil_energy
    "biomass_cultivation": (  320,     180,   0.042,  0.018,   2.1),
    "preprocessing":       (    0,      12,   0.008,  0.002,   1.4),
    "pyrolysis":           (    0,      45,   0.015,  0.003,   8.2),
    "hydrotreatment":      (    0,      60,   0.022,  0.004,  14.5),
    "blending_logistics":  (    0,       5,   0.003,  0.001,   0.8),
}

IMPACT_UNITS = {
    "gwp100":         "gCO₂eq/MJ",
    "land_use":       "m²·yr/MJ",
    "water":          "L/MJ",
    "acidification":  "mol H⁺eq/MJ",
    "eutrophication": "g Peq/MJ",
    "fossil_energy":  "MJ_fossil/MJ",
}


# ── Core LCA model ─────────────────────────────────────────────────────────────

@dataclass
class BiofuelLCA:
    """
    Cradle-to-wake LCA for pyrolysis-based maritime drop-in biofuel.
    
    Parameters
    ----------
    biomass_type : str — "agricultural_residue", "forestry_residue", "energy_crop"
    conversion_eff : float — pyrolysis oil yield (mass basis)
    include_luc : bool — include indirect land use change emissions
    h2_source : str — "SMR_natural_gas", "electrolysis_grid", "electrolysis_renewable"
    """
    biomass_type: str = "agricultural_residue"
    conversion_eff: float = 0.62
    include_luc: bool = True
    h2_source: str = "SMR_natural_gas"
    biochar_credit: bool = True
    fuel_lhv_mj_per_t: float = 42500  # Lower heating value, MJ/t

    # H2 GHG factors (gCO2eq/MJ H2)
    H2_GHG = {
        "SMR_natural_gas":      85.0,
        "electrolysis_grid":    48.0,
        "electrolysis_renewable": 3.2,
    }

    # LUC factors by biomass type (gCO2eq/MJ)
    LUC_FACTORS = {
        "agricultural_residue": 0.0,   # No LUC for residues
        "forestry_residue":     0.0,
        "energy_crop":          7.5,   # Miscanthus, etc.
    }

    def _ghg_per_mj(self) -> Dict[str, float]:
        """Decompose GHG intensity by life-cycle stage (gCO2eq/MJ)."""
        f = GHG_FACTORS.copy()

        # Adjust H2 impact in hydrotreatment based on H2 source
        h2_factor = self.H2_GHG[self.h2_source]
        h2_fraction = 0.04  # ~4% H2 by mass in hydrotreatment
        f["hydrotreatment"] = 9.2 * (h2_factor / 85.0)  # Scale to H2 source

        luc = self.LUC_FACTORS[self.biomass_type] if self.include_luc else 0.0
        f["land_use_change"] = luc

        if not self.biochar_credit:
            f["biochar_credit"] = 0.0

        return f

    def gwp100_intensity(self) -> Dict:
        """Total GHG intensity in gCO2eq/MJ, broken down by stage."""
        stages = self._ghg_per_mj()
        total = sum(stages.values())
        reduction_vs_hfo = (HFO_GHG_INTENSITY - total) / HFO_GHG_INTENSITY * 100

        return {
            "stages_gco2eq_mj": {k: round(v, 2) for k, v in stages.items()},
            "total_gco2eq_mj": round(total, 2),
            "hfo_reference_gco2eq_mj": HFO_GHG_INTENSITY,
            "ghg_reduction_pct": round(reduction_vs_hfo, 1),
            "fueleu_compliant_2030": reduction_vs_hfo >= 40.0,
            "fueleu_compliant_2040": reduction_vs_hfo >= 62.0,
        }

    def multi_impact_profile(self, fuel_output_t: float = 1000.0) -> pd.DataFrame:
        """
        Compute all LCA impact categories for a given fuel output volume.
        Returns a DataFrame with absolute and normalised impacts.
        """
        # Back-calculate feedstock input
        q = {
            "biomass_cultivation": fuel_output_t / (self.conversion_eff * 0.92 * 0.97),
            "preprocessing":       fuel_output_t / (self.conversion_eff * 0.92 * 0.97),
            "pyrolysis":           fuel_output_t / (0.92 * 0.97),
            "hydrotreatment":      fuel_output_t / 0.97,
            "blending_logistics":  fuel_output_t,
        }

        total_mj = fuel_output_t * self.fuel_lhv_mj_per_t
        rows = []

        for stage, factors in MULTI_IMPACT_FACTORS.items():
            land, water, acid, eutr, fossil_e = factors
            qty = q[stage]
            rows.append({
                "stage": stage,
                "land_use_m2yr":       round(land  * qty, 0),
                "water_L":             round(water * qty, 0),
                "acidification_molH":  round(acid  * qty, 4),
                "eutrophication_gP":   round(eutr  * qty, 4),
                "fossil_energy_MJ":    round(fossil_e * qty, 1),
            })

        df = pd.DataFrame(rows)
        totals = df.select_dtypes(include=np.number).sum()

        # Normalise to per MJ functional unit
        norm = {col: round(totals[col] / total_mj, 6) for col in totals.index}

        return df, norm

    def comparison_table(self) -> pd.DataFrame:
        """Compare biofuel vs HFO vs VLSFO across key metrics."""
        gwp = self.gwp100_intensity()
        biofuel_ghg = gwp["total_gco2eq_mj"]

        data = {
            "Fuel": ["HFO (baseline)", "VLSFO", "SEAFAIRER Biofuel", "Electro-methanol (ref)"],
            "GHG_gco2eq_mj": [91.0, 87.0, biofuel_ghg, 12.5],
            "GHG_reduction_pct": [0, 4.4, gwp["ghg_reduction_pct"], 86.3],
            "FuelEU_2030": ["❌", "❌", "✅" if gwp["fueleu_compliant_2030"] else "❌", "✅"],
            "FuelEU_2040": ["❌", "❌", "✅" if gwp["fueleu_compliant_2040"] else "❌", "✅"],
            "Drop_in_compatible": ["✅", "✅", "✅", "❌"],
        }
        return pd.DataFrame(data)

    def sensitivity_to_h2_source(self) -> pd.DataFrame:
        """Show GHG impact of different hydrogen production routes."""
        rows = []
        for h2 in self.H2_GHG:
            lca = BiofuelLCA(
                biomass_type=self.biomass_type,
                conversion_eff=self.conversion_eff,
                include_luc=self.include_luc,
                h2_source=h2,
                biochar_credit=self.biochar_credit,
            )
            gwp = lca.gwp100_intensity()
            rows.append({
                "h2_source": h2,
                "total_gco2eq_mj": gwp["total_gco2eq_mj"],
                "ghg_reduction_pct": gwp["ghg_reduction_pct"],
                "fueleu_2030": gwp["fueleu_compliant_2030"],
            })
        return pd.DataFrame(rows)

    def summary(self) -> str:
        gwp = self.gwp100_intensity()
        lines = [
            "=" * 55,
            "  Life-Cycle Assessment — Cradle-to-Wake",
            "=" * 55,
            f"  Biomass type    : {self.biomass_type}",
            f"  H2 source       : {self.h2_source}",
            f"  LUC included    : {self.include_luc}",
            f"  Biochar credit  : {self.biochar_credit}",
            "",
            f"  Total GHG       : {gwp['total_gco2eq_mj']} gCO₂eq/MJ",
            f"  HFO reference   : {HFO_GHG_INTENSITY} gCO₂eq/MJ",
            f"  GHG reduction   : {gwp['ghg_reduction_pct']}%",
            "",
            f"  FuelEU 2030 (40%): {'✅ COMPLIANT' if gwp['fueleu_compliant_2030'] else '❌ NON-COMPLIANT'}",
            f"  FuelEU 2040 (62%): {'✅ COMPLIANT' if gwp['fueleu_compliant_2040'] else '❌ NON-COMPLIANT'}",
            "=" * 55,
        ]
        return "\n".join(lines)


# ── CLI ────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="LCA for maritime biofuels")
    parser.add_argument("--biomass",  default="agricultural_residue",
                        choices=["agricultural_residue", "forestry_residue", "energy_crop"])
    parser.add_argument("--h2",       default="SMR_natural_gas",
                        choices=["SMR_natural_gas", "electrolysis_grid", "electrolysis_renewable"])
    parser.add_argument("--no-luc",   action="store_true")
    parser.add_argument("--no-biochar", action="store_true")
    args = parser.parse_args()

    lca = BiofuelLCA(
        biomass_type=args.biomass,
        h2_source=args.h2,
        include_luc=not args.no_luc,
        biochar_credit=not args.no_biochar,
    )

    print(lca.summary())

    print("\nFuel comparison table:")
    print(lca.comparison_table().to_string(index=False))

    print("\nH₂ source sensitivity:")
    print(lca.sensitivity_to_h2_source().to_string(index=False))

    print("\nMulti-impact profile (per stage, 1000t fuel output):")
    df, norm = lca.multi_impact_profile(1000)
    print(df.to_string(index=False))
    print("\nNormalised to functional unit (per MJ):")
    for k, v in norm.items():
        print(f"  {k:<30} {v}")
