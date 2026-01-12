import { useMemo, useRef, useState } from "react";
import "./App.css";
import { TransactionAnalyzer } from "transaction-analyzer";

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import {Bar, Pie} from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend);

type BankName = "Nordea" | "ING";

function detectBank(fileName: string): BankName {
  return fileName.toLowerCase().includes("ing") ? "ING" : "Nordea";
}

type MonthlyExpense = {
  month: string;
  sum: string; // e.g. "1330.84 euros"
  categories?: Record<
      string,
      {
        amount: number;
        percentage: number;
        transactions?: Record<string, string>;
      }
  >;
};

type AnalysisResult = {
  averageMonthExpenses?: string;
  monthlyExpenses: MonthlyExpense[];
};

function parseEuroAmount(sum: string): number {
  const match = new RegExp(/-?\d+(?:\.\d+)?/).exec(sum);
  return match ? Number(match[0]) : 0;
}


function makePieColors(n: number): string[] {
  // Distinct colors without hardcoding a palette
  return Array.from({ length: n }, (_, i) => `hsl(${Math.round((360 * i) / n)}, 70%, 60%)`);
}

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const analyzer = useMemo(() => new TransactionAnalyzer(), []);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  // New: category breakdown controls
  const [breakdownMode, setBreakdownMode] = useState<"month" | "year">("month");
  const [selectedMonth, setSelectedMonth] = useState<string>("");

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setFileName(file.name);

    try {
      const csvText = await file.text();
      const bank = detectBank(file.name);

      const analysis = (await analyzer.analyzeCsvContent(csvText, bank)) as AnalysisResult;
      setResult(analysis);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const chart = useMemo(() => {
    if (!result?.monthlyExpenses?.length) return null;

    // Your JSON seems to list months newest-first; reverse for a left-to-right timeline.
    const ordered = [...result.monthlyExpenses].reverse();

    const labels = ordered.map((m) => m.month);
    const values = ordered.map((m) => parseEuroAmount(m.sum));

    const colors = values.map(() => "rgba(13, 110, 253, 0.4)");

    return {
      data: {
        labels,
        datasets: [
          {
            label: "Expenses per month (€)",
            data: values,
            backgroundColor: colors,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: true },
          title: {
            display: true,
            text: "Monthly expenses",
          },
          tooltip: {
            callbacks: {
              label: (ctx: any) => {
                const v = ctx.parsed?.y ?? ctx.raw;
                return `€ ${Number(v).toFixed(2)}`;
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
  }, [result]);

  const availableMonths = useMemo(() => {
    return result?.monthlyExpenses?.map((m) => m.month) ?? [];
  }, [result]);

  const pieChart = useMemo(() => {
    if (!result?.monthlyExpenses?.length) return null;

    // Helper: normalize categories object to { [category]: amount }
    const extractMonthCategoryAmounts = (m: MonthlyExpense): Record<string, number> => {
      const cats = m.categories ?? {};
      const out: Record<string, number> = {};
      for (const [catName, info] of Object.entries(cats)) {
        out[catName] = Number(info.amount) || 0;
      }
      return out;
    };

    let categoryTotals: Record<string, number> = {};

    if (breakdownMode === "month") {
      const monthObj =
          result.monthlyExpenses.find((m) => m.month === selectedMonth) ??
          result.monthlyExpenses[0];

      categoryTotals = extractMonthCategoryAmounts(monthObj);
    } else {
      // Year view (MVP): aggregate across all months present in analysis
      for (const m of result.monthlyExpenses) {
        const monthTotals = extractMonthCategoryAmounts(m);
        for (const [cat, amount] of Object.entries(monthTotals)) {
          categoryTotals[cat] = (categoryTotals[cat] ?? 0) + amount;
        }
      }
    }

    // Remove zero categories + sort by amount desc
    const entries = Object.entries(categoryTotals)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1]);

    if (!entries.length) return null;

    const labels = entries.map(([k]) => k);
    const values = entries.map(([, v]) => v);
    const colors = makePieColors(values.length);

    const title =
        breakdownMode === "month"
            ? `Category breakdown — ${selectedMonth || result.monthlyExpenses[0].month}`
            : "Category breakdown — All months (year)";

    return {
      data: {
        labels,
        datasets: [
          {
            label: "€",
            data: values,
            backgroundColor: colors,
          },
        ],
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
                return `${label}: € ${value.toFixed(2)}`;
              },
            },
          },
        },
      } as const,
    };
  }, [result, breakdownMode, selectedMonth]);


  return (
    <div style={{ padding: 32, maxWidth: 900, margin: "0 auto" }}>
      <h1>Transaction Analyzer</h1>
      <p style={{ marginTop: 8, color: "#666" }}>
        Upload a CSV and view total expenses per month.
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        onChange={onFileSelected}
        style={{ display: "none" }}
      />

      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={loading}
        style={{ padding: "10px 16px", cursor: loading ? "not-allowed" : "pointer" }}
      >
        {loading ? "Analyzing…" : "Upload file"}
      </button>

      {error && (
        <pre style={{ marginTop: 20, color: "red", whiteSpace: "pre-wrap" }}>{error}</pre>
      )}

      {result && (
        <div style={{ marginTop: 20 }}>
          {fileName && (
            <div style={{ marginBottom: 8, color: "#555" }}>
              <strong>File:</strong> {fileName}
            </div>
          )}
          {result.averageMonthExpenses && (
            <div style={{ marginBottom: 10 }}>
              <strong>Average month expenses:</strong> {result.averageMonthExpenses}
            </div>
          )}

          {chart ? (
            <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
              <Bar data={chart.data} options={chart.options} />
            </div>
          ) : (
            <div>No monthly data found in analysis result.</div>
          )}

          {/* Category breakdown section */}
          <div style={{ marginTop: 24, borderTop: "1px solid #eee", paddingTop: 16 }}>
            <h2 style={{ margin: "0 0 12px" }}>Category breakdown</h2>

            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <label>
                View:&nbsp;
                <select
                    value={breakdownMode}
                    onChange={(e) => setBreakdownMode(e.target.value as "month" | "year")}
                >
                  <option value="month">Month</option>
                  <option value="year">Year</option>
                </select>
              </label>

              {breakdownMode === "month" && (
                  <label>
                    Month:&nbsp;
                    <select
                        value={selectedMonth}
                        onChange={(e) => setSelectedMonth(e.target.value)}
                    >
                      {availableMonths.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                      ))}
                    </select>
                  </label>
              )}
            </div>

            <div style={{ marginTop: 12 }}>
              {pieChart ? (
                  <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
                    <Pie data={pieChart.data} options={pieChart.options} />
                  </div>
              ) : (
                  <div>No category data found for this selection.</div>
              )}
            </div>
          </div>


          {/* Keep for debugging while MVP */}
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