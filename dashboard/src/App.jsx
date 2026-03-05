import { useState, useEffect, useRef } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis, AreaChart, Area, ScatterChart, Scatter, Cell } from "recharts";

// ── Color tokens ──────────────────────────────────────────────────────────────
const C = {
  bg: "#060e0a",
  surface: "#0d1f14",
  surfaceHigh: "#122418",
  border: "#1e3d28",
  accent: "#2ee87a",
  accentDim: "#1a9649",
  accentGlow: "rgba(46,232,122,0.15)",
  text: "#d4f0df",
  textMuted: "#6b9b7e",
  warn: "#f0a832",
  danger: "#e84b3a",
  blue: "#38bdf8",
};

// ── MILP Solver (simplified linear relaxation for demo) ───────────────────────
function solveMILP(params) {
  const { feedstockCost, conversionEff, transportCost, carbonPrice, demandTarget } = params;
  const nodes = ["Biomass Farm", "Preprocessing", "Pyrolysis", "Hydrotreatment", "Blending", "Port Bunker"];
  const flows = [];
  let cumulativeCost = 0;
  let cumulativeGHG = 0;
  let quantity = demandTarget;

  nodes.forEach((node, i) => {
    const lossFactor = i === 2 ? conversionEff / 100 : i === 3 ? 0.92 : 0.97;
    const inputQty = quantity / lossFactor;
    const nodeCost =
      i === 0 ? inputQty * feedstockCost :
      i === 1 ? inputQty * 18 :
      i === 2 ? inputQty * 45 :
      i === 3 ? inputQty * 60 :
      i === 4 ? inputQty * 12 :
      inputQty * transportCost;
    const ghgSaving = i === 2 ? inputQty * 0.38 : i === 3 ? inputQty * 0.12 : 0;
    cumulativeCost += nodeCost;
    cumulativeGHG += ghgSaving;
    flows.push({ node, inputQty: Math.round(inputQty), outputQty: Math.round(quantity), cost: Math.round(nodeCost), ghg: Math.round(ghgSaving), lossFactor });
    quantity = Math.round(quantity * lossFactor) / lossFactor * lossFactor;
  });

  const carbonCredit = cumulativeGHG * carbonPrice;
  const netCost = cumulativeCost - carbonCredit;
  const lcof = netCost / demandTarget; // Levelized Cost of Fuel

  return { flows, totalCost: Math.round(cumulativeCost), carbonCredit: Math.round(carbonCredit), netCost: Math.round(netCost), lcof: Math.round(lcof * 100) / 100, ghgReduction: Math.round(cumulativeGHG) };
}

// ── Sensitivity Analysis ───────────────────────────────────────────────────────
function runSensitivity(baseParams) {
  const vars = ["feedstockCost", "conversionEff", "transportCost", "carbonPrice"];
  const labels = ["Feedstock Cost", "Conv. Efficiency", "Transport Cost", "Carbon Price"];
  const deltas = [-20, -10, 0, 10, 20]; // % change
  return vars.map((v, vi) => ({
    variable: labels[vi],
    data: deltas.map(d => {
      const p = { ...baseParams, [v]: baseParams[v] * (1 + d / 100) };
      const r = solveMILP(p);
      return { delta: d, lcof: r.lcof };
    })
  }));
}

// ── Scenario Monte Carlo ───────────────────────────────────────────────────────
function monteCarlo(baseParams, runs = 300) {
  const results = [];
  for (let i = 0; i < runs; i++) {
    const p = {
      feedstockCost: baseParams.feedstockCost * (0.7 + Math.random() * 0.6),
      conversionEff: Math.max(40, Math.min(85, baseParams.conversionEff + (Math.random() - 0.5) * 20)),
      transportCost: baseParams.transportCost * (0.8 + Math.random() * 0.4),
      carbonPrice: baseParams.carbonPrice * (0.5 + Math.random()),
      demandTarget: baseParams.demandTarget,
    };
    const r = solveMILP(p);
    results.push({ lcof: r.lcof, ghg: r.ghgReduction, cost: r.netCost });
  }
  results.sort((a, b) => a.lcof - b.lcof);
  return results;
}

// ── Tiny components ───────────────────────────────────────────────────────────
const KPI = ({ label, value, unit, delta, color }) => (
  <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "16px 20px", position: "relative", overflow: "hidden" }}>
    <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at top left, ${color || C.accentGlow}, transparent 70%)` }} />
    <div style={{ fontSize: 11, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
    <div style={{ fontSize: 28, fontFamily: "'Space Mono', monospace", color: color ? color.replace("0.15", "1").replace("rgba(", "").split(",")[0] === "46" ? C.accent : color : C.accent, fontWeight: 700 }}>
      {value}<span style={{ fontSize: 14, marginLeft: 4, color: C.textMuted }}>{unit}</span>
    </div>
    {delta !== undefined && (
      <div style={{ fontSize: 12, color: delta > 0 ? C.warn : C.accent, marginTop: 4 }}>
        {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}% vs baseline
      </div>
    )}
  </div>
);

const Slider = ({ label, value, min, max, step, unit, onChange }) => (
  <div style={{ marginBottom: 18 }}>
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
      <span style={{ fontSize: 12, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
      <span style={{ fontSize: 13, fontFamily: "'Space Mono', monospace", color: C.accent }}>{value}{unit}</span>
    </div>
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={e => onChange(Number(e.target.value))}
      style={{ width: "100%", accentColor: C.accent, height: 4, cursor: "pointer" }} />
  </div>
);

// ── Main App ──────────────────────────────────────────────────────────────────
export default function BiofuelValueChain() {
  const [params, setParams] = useState({ feedstockCost: 85, conversionEff: 62, transportCost: 22, carbonPrice: 95, demandTarget: 5000 });
  const [activeTab, setTab] = useState("optimizer");
  const [mcData, setMcData] = useState([]);
  const [animStep, setAnimStep] = useState(0);

  const result = solveMILP(params);
  const sensitivity = runSensitivity(params);

  useEffect(() => {
    setMcData(monteCarlo(params));
  }, [params]);

  useEffect(() => {
    const t = setInterval(() => setAnimStep(s => (s + 1) % 6), 800);
    return () => clearInterval(t);
  }, []);

  const set = (k) => (v) => setParams(p => ({ ...p, [k]: v }));

  // Waterfall chart for cost breakdown
  const waterfallData = result.flows.map(f => ({ name: f.node.split(" ")[0], cost: f.cost }));

  // Sensitivity tornado
  const tornadoData = sensitivity.map(s => {
    const low = s.data[0].lcof;
    const high = s.data[4].lcof;
    return { name: s.variable, low: Math.round(low * 100) / 100, high: Math.round(high * 100) / 100, base: result.lcof, spread: Math.round((high - low) * 100) / 100 };
  }).sort((a, b) => b.spread - a.spread);

  // Monte Carlo histogram
  const bins = Array.from({ length: 20 }, (_, i) => {
    const minL = Math.min(...mcData.map(d => d.lcof));
    const maxL = Math.max(...mcData.map(d => d.lcof));
    const w = (maxL - minL) / 20;
    const lo = minL + i * w;
    const hi = lo + w;
    return { bin: Math.round(lo * 10) / 10, count: mcData.filter(d => d.lcof >= lo && d.lcof < hi).length };
  });

  const p10 = mcData[Math.floor(mcData.length * 0.1)]?.lcof || 0;
  const p90 = mcData[Math.floor(mcData.length * 0.9)]?.lcof || 0;

  const tabs = ["optimizer", "sensitivity", "uncertainty", "lifecycle"];

  return (
    <div style={{ background: C.bg, minHeight: "100vh", fontFamily: "'Inter', sans-serif", color: C.text, padding: "24px" }}>
      <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.accent, boxShadow: `0 0 12px ${C.accent}` }} />
          <span style={{ fontSize: 11, color: C.textMuted, letterSpacing: "0.15em", textTransform: "uppercase" }}>SEAFAIRER · Horizon Europe · DTU Chemical Engineering</span>
        </div>
        <h1 style={{ fontSize: 26, fontFamily: "'Space Mono', monospace", fontWeight: 700, color: C.text, margin: 0, lineHeight: 1.2 }}>
          Biofuel Value Chain<br />
          <span style={{ color: C.accent }}>Decision-Making Tool</span>
        </h1>
        <p style={{ fontSize: 13, color: C.textMuted, marginTop: 8, maxWidth: 560 }}>
          Mixed-integer linear programming optimizer for maritime drop-in biofuel supply chains. 
          Sensitivity & uncertainty assessment via Monte Carlo simulation.
        </p>
      </div>

      {/* KPI Strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        <KPI label="Levelized Cost of Fuel" value={result.lcof} unit="€/t" />
        <KPI label="Net Chain Cost" value={(result.netCost / 1000).toFixed(0)} unit="k€" />
        <KPI label="GHG Reduction" value={result.ghgReduction} unit="tCO₂" color="rgba(56,189,248,0.15)" />
        <KPI label="Carbon Credit Value" value={(result.carbonCredit / 1000).toFixed(0)} unit="k€" color="rgba(240,168,50,0.15)" />
      </div>

      {/* Tab Nav */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: `1px solid ${C.border}`, paddingBottom: 0 }}>
        {[
          { id: "optimizer", label: "⚙ MILP Optimizer" },
          { id: "sensitivity", label: "↕ Sensitivity" },
          { id: "uncertainty", label: "◎ Monte Carlo" },
          { id: "lifecycle", label: "♻ Life-Cycle" },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background: "none", border: "none", cursor: "pointer",
            padding: "10px 16px", fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase",
            color: activeTab === t.id ? C.accent : C.textMuted,
            borderBottom: activeTab === t.id ? `2px solid ${C.accent}` : "2px solid transparent",
            fontFamily: "'Space Mono', monospace",
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── MILP OPTIMIZER TAB ── */}
      {activeTab === "optimizer" && (
        <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 20 }}>
          {/* Controls */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
            <div style={{ fontSize: 11, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 20 }}>Model Parameters</div>
            <Slider label="Feedstock Cost" value={params.feedstockCost} min={40} max={160} step={5} unit="€/t" onChange={set("feedstockCost")} />
            <Slider label="Pyrolysis Efficiency" value={params.conversionEff} min={40} max={85} step={1} unit="%" onChange={set("conversionEff")} />
            <Slider label="Transport Cost" value={params.transportCost} min={8} max={60} step={2} unit="€/t·km" onChange={set("transportCost")} />
            <Slider label="Carbon Price (ETS)" value={params.carbonPrice} min={20} max={200} step={5} unit="€/tCO₂" onChange={set("carbonPrice")} />
            <Slider label="Fuel Demand Target" value={params.demandTarget} min={1000} max={20000} step={500} unit="t" onChange={set("demandTarget")} />

            <div style={{ marginTop: 20, padding: 14, background: C.surfaceHigh, borderRadius: 8, border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.1em" }}>Optimal Route</div>
              <div style={{ fontSize: 12, color: C.text, lineHeight: 1.8 }}>
                {result.flows.map((f, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: i === animStep ? C.accent : C.textMuted, fontSize: 10 }}>{"●"}</span>
                    <span style={{ color: i === animStep ? C.text : C.textMuted }}>{f.node}</span>
                    <span style={{ marginLeft: "auto", fontFamily: "'Space Mono', monospace", fontSize: 11, color: i === animStep ? C.accent : C.textMuted }}>{f.inputQty.toLocaleString()}t</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Charts */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Cost by node */}
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, flex: 1 }}>
              <div style={{ fontSize: 11, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 16 }}>Cost Distribution Across Value Chain Nodes</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={waterfallData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="name" tick={{ fill: C.textMuted, fontSize: 11 }} axisLine={{ stroke: C.border }} />
                  <YAxis tick={{ fill: C.textMuted, fontSize: 11 }} axisLine={{ stroke: C.border }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={{ background: C.surfaceHigh, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12 }} formatter={v => [`€${v.toLocaleString()}`, "Cost"]} />
                  <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
                    {waterfallData.map((_, i) => <Cell key={i} fill={i === animStep % waterfallData.length ? C.accent : C.accentDim} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Efficiency flow */}
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, flex: 1 }}>
              <div style={{ fontSize: 11, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 16 }}>Mass Flow Through Value Chain (tonnes)</div>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={result.flows.map(f => ({ name: f.node.split(" ")[0], qty: f.inputQty }))} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                  <defs>
                    <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={C.accent} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={C.accent} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="name" tick={{ fill: C.textMuted, fontSize: 11 }} axisLine={{ stroke: C.border }} />
                  <YAxis tick={{ fill: C.textMuted, fontSize: 11 }} axisLine={{ stroke: C.border }} tickFormatter={v => `${(v).toLocaleString()}`} />
                  <Tooltip contentStyle={{ background: C.surfaceHigh, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12 }} />
                  <Area type="monotone" dataKey="qty" stroke={C.accent} strokeWidth={2} fill="url(#areaGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* ── SENSITIVITY TAB ── */}
      {activeTab === "sensitivity" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {/* Tornado */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
            <div style={{ fontSize: 11, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 4 }}>Tornado Chart — LCOF Impact (€/t)</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 16 }}>±20% variation on each parameter</div>
            {tornadoData.map((d, i) => (
              <div key={i} style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: C.text }}>{d.name}</span>
                  <span style={{ fontSize: 11, fontFamily: "'Space Mono', monospace", color: C.textMuted }}>±{d.spread} €/t</span>
                </div>
                <div style={{ position: "relative", height: 24, background: C.surfaceHigh, borderRadius: 4, overflow: "hidden" }}>
                  <div style={{
                    position: "absolute", left: "50%", height: "100%",
                    width: `${(d.spread / (tornadoData[0].spread * 2)) * 100}%`,
                    background: `linear-gradient(90deg, ${C.accentGlow.replace("0.15", "0.4")}, ${C.accent})`,
                    transform: "translateX(-50%)", borderRadius: 4,
                  }} />
                  <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: C.accent }} />
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 8px" }}>
                    <span style={{ fontSize: 10, fontFamily: "'Space Mono', monospace", color: C.accentDim }}>{d.low}</span>
                    <span style={{ fontSize: 10, fontFamily: "'Space Mono', monospace", color: C.accentDim }}>{d.high}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Spider charts per variable */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {sensitivity.slice(0, 2).map((s, si) => (
              <div key={si} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, flex: 1 }}>
                <div style={{ fontSize: 11, color: C.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>LCOF vs {s.variable}</div>
                <ResponsiveContainer width="100%" height={130}>
                  <LineChart data={s.data} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="delta" tick={{ fill: C.textMuted, fontSize: 11 }} tickFormatter={v => `${v}%`} axisLine={{ stroke: C.border }} />
                    <YAxis tick={{ fill: C.textMuted, fontSize: 11 }} axisLine={{ stroke: C.border }} domain={["auto", "auto"]} />
                    <Tooltip contentStyle={{ background: C.surfaceHigh, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12 }} formatter={v => [`${v} €/t`, "LCOF"]} labelFormatter={v => `Δ${v}%`} />
                    <Line type="monotone" dataKey="lcof" stroke={si === 0 ? C.accent : C.blue} strokeWidth={2} dot={{ fill: si === 0 ? C.accent : C.blue, r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── MONTE CARLO TAB ── */}
      {activeTab === "uncertainty" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
            <div style={{ fontSize: 11, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 4 }}>Monte Carlo — LCOF Distribution</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 16 }}>300 stochastic simulations · Uniform parameter distributions</div>
            <div style={{ display: "flex", gap: 20, marginBottom: 16 }}>
              {[
                { label: "P10", value: p10.toFixed(1), unit: "€/t", color: C.accent },
                { label: "P50", value: mcData[150]?.lcof.toFixed(1) || "—", unit: "€/t", color: C.text },
                { label: "P90", value: p90.toFixed(1), unit: "€/t", color: C.warn },
              ].map(k => (
                <div key={k.label} style={{ flex: 1, background: C.surfaceHigh, borderRadius: 8, padding: "10px 14px", border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 10, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.1em" }}>{k.label}</div>
                  <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 18, color: k.color, marginTop: 2 }}>{k.value}<span style={{ fontSize: 11, color: C.textMuted }}> {k.unit}</span></div>
                </div>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={bins} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis dataKey="bin" tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={{ stroke: C.border }} />
                <YAxis tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={{ stroke: C.border }} />
                <Tooltip contentStyle={{ background: C.surfaceHigh, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12 }} formatter={v => [v, "Simulations"]} />
                <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                  {bins.map((b, i) => <Cell key={i} fill={b.bin < p10 ? C.accent : b.bin > p90 ? C.warn : C.accentDim} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Scatter: cost vs GHG */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
            <div style={{ fontSize: 11, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 4 }}>Cost–GHG Trade-off Space</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 16 }}>Each point = one Monte Carlo scenario</div>
            <ResponsiveContainer width="100%" height={280}>
              <ScatterChart margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis dataKey="ghg" name="GHG Reduction" type="number" tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={{ stroke: C.border }} label={{ value: "GHG Reduction (tCO₂)", fill: C.textMuted, fontSize: 10, position: "insideBottom", offset: -4 }} />
                <YAxis dataKey="lcof" name="LCOF" type="number" tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={{ stroke: C.border }} label={{ value: "LCOF (€/t)", fill: C.textMuted, fontSize: 10, angle: -90, position: "insideLeft" }} />
                <Tooltip contentStyle={{ background: C.surfaceHigh, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12 }} formatter={(v, n) => [`${v.toFixed(1)}`, n]} />
                <Scatter data={mcData.slice(0, 150)} fill={C.accentDim} opacity={0.6} r={2} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── LIFECYCLE TAB ── */}
      {activeTab === "lifecycle" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {/* LCA Radar */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
            <div style={{ fontSize: 11, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 16 }}>Life-Cycle Assessment — Impact Categories</div>
            <ResponsiveContainer width="100%" height={280}>
              <RadarChart data={[
                { subject: "GWP", biofuel: 22, fossil: 100 },
                { subject: "Land Use", biofuel: 65, fossil: 8 },
                { subject: "Water Use", biofuel: 55, fossil: 30 },
                { subject: "Acidification", biofuel: 40, fossil: 80 },
                { subject: "Eutrophication", biofuel: 60, fossil: 20 },
                { subject: "Energy", biofuel: 35, fossil: 100 },
              ]}>
                <PolarGrid stroke={C.border} />
                <PolarAngleAxis dataKey="subject" tick={{ fill: C.textMuted, fontSize: 11 }} />
                <Radar name="Drop-in Biofuel" dataKey="biofuel" stroke={C.accent} fill={C.accent} fillOpacity={0.25} />
                <Radar name="Fossil HFO" dataKey="fossil" stroke={C.warn} fill={C.warn} fillOpacity={0.1} />
                <Tooltip contentStyle={{ background: C.surfaceHigh, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12 }} />
              </RadarChart>
            </ResponsiveContainer>
            <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 8 }}>
              {[{ c: C.accent, l: "Drop-in Biofuel" }, { c: C.warn, l: "Fossil HFO" }].map(x => (
                <div key={x.l} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.textMuted }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: x.c }} />{x.l}
                </div>
              ))}
            </div>
          </div>

          {/* GHG Pathway */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
            <div style={{ fontSize: 11, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 4 }}>GHG Reduction Pathway</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 16 }}>vs. 2050 IMO decarbonisation targets</div>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={[
                { year: "2024", fossil: 100, biofuel: 78, target: 80 },
                { year: "2026", fossil: 98, biofuel: 68, target: 70 },
                { year: "2028", fossil: 95, biofuel: 55, target: 58 },
                { year: "2030", fossil: 90, biofuel: 42, target: 40 },
                { year: "2035", fossil: 85, biofuel: 28, target: 25 },
                { year: "2040", fossil: 80, biofuel: 18, target: 10 },
                { year: "2050", fossil: 75, biofuel: 8, target: 0 },
              ]} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                <defs>
                  <linearGradient id="fossilGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={C.danger} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={C.danger} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="biofuelGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={C.accent} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={C.accent} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis dataKey="year" tick={{ fill: C.textMuted, fontSize: 11 }} axisLine={{ stroke: C.border }} />
                <YAxis tick={{ fill: C.textMuted, fontSize: 11 }} axisLine={{ stroke: C.border }} tickFormatter={v => `${v}%`} />
                <Tooltip contentStyle={{ background: C.surfaceHigh, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12 }} formatter={v => [`${v}%`, ""]} />
                <Area type="monotone" dataKey="fossil" name="Fossil Baseline" stroke={C.danger} strokeWidth={2} fill="url(#fossilGrad)" strokeDasharray="5 3" />
                <Area type="monotone" dataKey="biofuel" name="SEAFAIRER Pathway" stroke={C.accent} strokeWidth={2} fill="url(#biofuelGrad)" />
                <Line type="monotone" dataKey="target" name="IMO Target" stroke={C.blue} strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
            <div style={{ marginTop: 12, padding: "10px 14px", background: C.surfaceHigh, borderRadius: 8, border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 12, color: C.text }}>
                Projected GHG intensity at 2030: <span style={{ fontFamily: "'Space Mono', monospace", color: C.accent }}>42% of fossil baseline</span>
                <span style={{ color: C.textMuted }}> · IMO target: 40%</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop: 28, padding: "12px 16px", background: C.surface, borderRadius: 8, border: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: C.textMuted }}>MILP Value Chain Optimizer · Built for SEAFAIRER Horizon Europe · DTU Chemical Engineering</span>
        <div style={{ display: "flex", gap: 16, fontSize: 11, color: C.textMuted }}>
          <span>Python · PuLP / Pyomo</span>
          <span>·</span>
          <span>Monte Carlo · 300 runs</span>
          <span>·</span>
          <span>ISO 14040/44 LCA</span>
        </div>
      </div>
    </div>
  );
}
