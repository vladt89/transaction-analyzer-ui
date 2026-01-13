import { useMemo, useRef, useState } from "react";
import "./App.css";
import { TransactionAnalyzer } from "transaction-analyzer";

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Chart, Pie } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

/**
 * Single-file MVP structure:
 * - Types: shape of analysis data consumed by the UI
 * - Helpers: pure transformations (data -> chart configs)
 * - Components: small presentational pieces (still in one file for simplicity)
 * - App: state + orchestration (file upload -> analysis -> render)
 */
// -------------------- Types --------------------
type BankName = "Nordea" | "ING";

type MonthlyExpense = {
  month: string;
  sum: string;
  categories?: Record<
      string,
      { amount: number; percentage: number; transactions?: Record<string, string> }
  >;
};

type AnalysisResult = {
  averageMonthExpenses?: string;
  monthlyExpenses: MonthlyExpense[];
};

// -------------------- Helpers (pure) --------------------
/** Infer bank type from the uploaded file name (MVP heuristic). */
function detectBank(fileName: string): BankName {
  return fileName.toLowerCase().includes("ing") ? "ING" : "Nordea";
}

/** Extract a numeric amount from strings like "1330.84 euros". */
function parseEuroAmount(sum: string): number {
  const match = /-?\d+(?:\.\d+)?/.exec(sum);
  return match ? Number(match[0]) : 0;
}

/** Generate a distinct color per pie slice using HSL. */
function makePieColors(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `hsl(${Math.round((360 * i) / n)}, 70%, 60%)`);
}

/** Build the Chart.js config for the monthly expenses bar chart. */
function buildMonthlyBarChart(monthlyExpenses: MonthlyExpense[], avgOverride?: number) {
  const ordered = [...monthlyExpenses].reverse();
  const labels = ordered.map((m) => m.month);
  const values = ordered.map((m) => parseEuroAmount(m.sum));
  const colors = values.map(() => "rgba(13, 110, 253, 0.4)");

  const avg =
    avgOverride ?? (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
  const avgSeries = labels.map(() => avg);

  return {
    data: {
      labels,
      datasets: [
        {
          type: "bar" as const,
          label: "Expenses per month (€)",
          data: values,
          backgroundColor: colors,
        },
        {
          type: "line" as const,
          label: "Average",
          data: avgSeries,
          borderColor: "rgba(255, 159, 64, 1)",
          backgroundColor: "rgba(0, 0, 0, 0)",
          borderDash: [6, 6],
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
          fill: false,
          spanGaps: true,
          pointStyle: "line",
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          display: true,
          labels: {
            usePointStyle: true,
          },
        },
        title: { display: true, text: "Monthly expenses" },
      },
    } as const,
  };
}

/** Convert a month.categories map into a simple { category -> amount } object. */
function extractMonthCategoryAmounts(m: MonthlyExpense): Record<string, number> {
  const cats = m.categories ?? {};
  const out: Record<string, number> = {};
  for (const [catName, info] of Object.entries(cats)) out[catName] = Number(info.amount) || 0;
  return out;
}

/**
 * Build the Chart.js config for category breakdown.
 *
 * - mode = "month": uses the selected month
 * - mode = "year": aggregates all months present in the analysis
 */
function buildCategoryPieChart(args: {
  monthlyExpenses: MonthlyExpense[];
  breakdownMode: "month" | "year";
  selectedMonth: string;
}) {
  const { monthlyExpenses, breakdownMode, selectedMonth } = args;
  let totals: Record<string, number> = {};

  if (breakdownMode === "month") {
    const monthObj =
        monthlyExpenses.find((m) => m.month === selectedMonth) ?? monthlyExpenses[0];
    totals = extractMonthCategoryAmounts(monthObj);
  } else {
    for (const m of monthlyExpenses) {
      const monthTotals = extractMonthCategoryAmounts(m);
      for (const [cat, amount] of Object.entries(monthTotals)) {
        totals[cat] = (totals[cat] ?? 0) + amount;
      }
    }
  }

  const entries = Object.entries(totals)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);

  if (!entries.length) return null;

  const labels = entries.map(([k]) => k);
  const values = entries.map(([, v]) => v);
  const colors = makePieColors(values.length);

  const title =
      breakdownMode === "month"
          ? `Category breakdown — ${selectedMonth || monthlyExpenses[0].month}`
          : "Category breakdown — All months (year)";

  return {
    data: {
      labels,
      datasets: [{ label: "€", data: values, backgroundColor: colors }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: true, position: "bottom" as const },
        title: { display: true, text: title },
        tooltip: {
          callbacks: {
            label: (ctx: any) => {
              const label = ctx.label ?? "";
              const value = Number(ctx.raw ?? 0);
              const data = ctx.dataset.data as number[];
              const total = data.reduce((a, b) => a + b, 0);
              const percent = total > 0 ? (value / total) * 100 : 0;

              return `${label}: € ${value.toFixed(2)} (${percent.toFixed(1)}%)`;
            },
          },
        },
      },
    } as const,
  };
}

/**
 * Build the Chart.js config for category trends over time.
 * By default shows top N categories by total spend across all months.
 */
function buildCategoryTrendsChart(monthlyExpenses: MonthlyExpense[], topN = 6) {
  const ordered = [...monthlyExpenses].reverse();
  const labels = ordered.map((m) => m.month);

  // Compute totals per category across all months
  const totals: Record<string, number> = {};
  const perMonth: Record<string, number[]> = {};

  for (const m of ordered) {
    const monthTotals = extractMonthCategoryAmounts(m);
    for (const [cat, amount] of Object.entries(monthTotals)) {
      totals[cat] = (totals[cat] ?? 0) + amount;
    }
  }

  const topCats = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([cat]) => cat);

  // Initialize series arrays
  for (const cat of topCats) {
    perMonth[cat] = new Array(labels.length).fill(0);
  }
  perMonth["Other"] = new Array(labels.length).fill(0);

  // Fill series
  ordered.forEach((m, idx) => {
    const monthTotals = extractMonthCategoryAmounts(m);
    for (const [cat, amount] of Object.entries(monthTotals)) {
      if (topCats.includes(cat)) {
        perMonth[cat][idx] += amount;
      } else {
        perMonth["Other"][idx] += amount;
      }
    }
  });

  const seriesNames = [...topCats, "Other"].filter((n) => perMonth[n].some((v) => v > 0));
  const colors = makePieColors(seriesNames.length);

  return {
    data: {
      labels,
      datasets: seriesNames.map((name, i) => ({
        type: "line" as const,
        label: name,
        data: perMonth[name],
        borderColor: colors[i],
        backgroundColor: "rgba(0,0,0,0)",
        pointRadius: 2,
        tension: 0.2,
      })),
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: true, position: "bottom" as const },
        title: { display: true, text: "Category trends (top categories)" },
        tooltip: {
          callbacks: {
            label: (ctx: any) => {
              const label = ctx.dataset?.label ?? "";
              const value = Number(ctx.raw ?? 0);
              return `${label}: € ${value.toFixed(2)}`;
            },
          },
        },
      },
      scales: {
        y: {
          ticks: {
            callback: (value: any) => `€ ${value}`,
          },
        },
      },
    } as const,
  };
}

// -------------------- Small components (same file) --------------------
/**
 * Upload control (button + hidden file input).
 * Calls `onFile` with the selected CSV file.
 */
function UploadButton(props: Readonly<{
  loading: boolean;
  onFile: (file: File) => void;
}>) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
      <>
        <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) props.onFile(f);
              if (inputRef.current) inputRef.current.value = "";
            }}
            style={{ display: "none" }}
        />
        <button
            onClick={() => inputRef.current?.click()}
            disabled={props.loading}
            style={{ padding: "10px 16px", cursor: props.loading ? "not-allowed" : "pointer" }}
        >
          {props.loading ? "Analyzing…" : "Upload file"}
        </button>
      </>
  );
}

/** Presentational wrapper for the monthly expenses bar chart. */
function MonthlyBarChart(
  { monthlyExpenses, averageMonthExpenses }: Readonly<{ monthlyExpenses: MonthlyExpense[]; averageMonthExpenses?: string }>
) {
  const avgValue = averageMonthExpenses ? parseEuroAmount(averageMonthExpenses) : undefined;
  const chart = useMemo(
    () => buildMonthlyBarChart(monthlyExpenses, avgValue),
    [monthlyExpenses, avgValue]
  );
  return (
      <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, marginTop: 12 }}>
        <Chart type="bar" data={chart.data} options={chart.options} />
      </div>
  );
}

/**
 * Controls + pie chart for category breakdown.
 * Keeps view state (month/year + selected month) in the parent, receives setters.
 */
function CategoryBreakdown(props: Readonly<{
  monthlyExpenses: MonthlyExpense[];
  breakdownMode: "month" | "year";
  selectedMonth: string;
  setBreakdownMode: (v: "month" | "year") => void;
  setSelectedMonth: (v: string) => void;
}>) {
  const months = useMemo(() => props.monthlyExpenses.map((m) => m.month), [props.monthlyExpenses]);

  const pie = useMemo(
      () =>
          buildCategoryPieChart({
            monthlyExpenses: props.monthlyExpenses,
            breakdownMode: props.breakdownMode,
            selectedMonth: props.selectedMonth,
          }),
      [props.monthlyExpenses, props.breakdownMode, props.selectedMonth]
  );

  return (
      <div style={{ marginTop: 24, borderTop: "1px solid #eee", paddingTop: 16 }}>
        <h2 style={{ margin: "0 0 12px" }}>Category breakdown</h2>

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <label>
            View:{" "}
            <select
              value={props.breakdownMode}
              onChange={(e) => props.setBreakdownMode(e.target.value as "month" | "year")}
            >
              <option value="month">Month</option>
              <option value="year">Year</option>
            </select>
          </label>

          {props.breakdownMode === "month" && (
              <label>
                Month:{" "}
                <select value={props.selectedMonth} onChange={(e) => props.setSelectedMonth(e.target.value)}>
                  {months.map((m) => (
                      <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </label>
          )}
        </div>

        <div style={{ marginTop: 12 }}>
          {pie ? (
              <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
                <Pie data={pie.data} options={pie.options} />
              </div>
          ) : (
              <div>No category data found for this selection.</div>
          )}
        </div>
      </div>
  );
}

/** Line chart showing how category spending changes over time. */
function CategoryTrends({ monthlyExpenses }: Readonly<{ monthlyExpenses: MonthlyExpense[] }>) {
  const chart = useMemo(() => buildCategoryTrendsChart(monthlyExpenses, 6), [monthlyExpenses]);

  return (
    <div style={{ marginTop: 24, borderTop: "1px solid #eee", paddingTop: 16 }}>
      <h2 style={{ margin: "0 0 12px" }}>Category trends</h2>
      <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
        <Chart type="line" data={chart.data} options={chart.options} />
      </div>
      <div style={{ marginTop: 8, color: "#666", fontSize: 12 }}>
        Showing top 6 categories by total spend across the selected period (others grouped as "Other").
      </div>
    </div>
  );
}

// -------------------- App (state + orchestration) --------------------
/**
 * Page-level component: owns state and orchestrates file upload -> analysis -> charts.
 */
export default function App() {
  const analyzer = useMemo(() => new TransactionAnalyzer(), []);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const [breakdownMode, setBreakdownMode] = useState<"month" | "year">("month");
  const [selectedMonth, setSelectedMonth] = useState<string>("");

  async function analyzeFile(file: File) {
    setLoading(true);
    setError(null);
    setResult(null);
    setFileName(file.name);

    try {
      const csvText = await file.text();
      const bank = detectBank(file.name);
      const analysis = (await analyzer.analyzeCsvContent(csvText, bank)) as AnalysisResult;

      setResult(analysis);
      setSelectedMonth(analysis.monthlyExpenses?.[0]?.month ?? "");
      setBreakdownMode("month");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
      <div style={{ padding: 32, maxWidth: 900, margin: "0 auto" }}>
        <h1>Transaction Analyzer</h1>

        <UploadButton loading={loading} onFile={analyzeFile} />

        {error && <pre style={{ marginTop: 20, color: "red", whiteSpace: "pre-wrap" }}>{error}</pre>}

        {result && (
            <div style={{ marginTop: 20 }}>
              {fileName && (
                  <div style={{ marginBottom: 8, color: "#555" }}>
                    <strong>File:</strong> {fileName}
                  </div>
              )}

              {result.averageMonthExpenses && (
                <div style={{ marginTop: 8, marginBottom: 8, color: "#555" }}>
                  <strong>Average monthly expenses:</strong> {result.averageMonthExpenses}
                </div>
              )}
              <MonthlyBarChart
                monthlyExpenses={result.monthlyExpenses}
                averageMonthExpenses={result.averageMonthExpenses}
              />

              <CategoryBreakdown
                  monthlyExpenses={result.monthlyExpenses}
                  breakdownMode={breakdownMode}
                  selectedMonth={selectedMonth}
                  setBreakdownMode={setBreakdownMode}
                  setSelectedMonth={setSelectedMonth}
              />

              <CategoryTrends monthlyExpenses={result.monthlyExpenses} />

              <details style={{ marginTop: 16 }}>
                <summary>Show raw JSON</summary>
                <pre style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>
              {JSON.stringify(result, null, 2)}
            </pre>
              </details>
            </div>
        )}
      </div>
  );
}