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

/** Compute category totals and percentages for the whole period (all months in the analysis). */
function computePeriodCategoryPercentages(monthlyExpenses: MonthlyExpense[]) {
  const totals: Record<string, number> = {};
  for (const m of monthlyExpenses) {
    const monthTotals = extractMonthCategoryAmounts(m);
    for (const [cat, amount] of Object.entries(monthTotals)) {
      totals[cat] = (totals[cat] ?? 0) + amount;
    }
  }

  const entries = Object.entries(totals)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  const grandTotal = entries.reduce((acc, [, v]) => acc + v, 0);

  return entries.map(([category, total]) => ({
    category,
    total,
    percent: grandTotal > 0 ? (total / grandTotal) * 100 : 0,
  }));
}

/** Compute category totals and percentages for a single month. */
function computeMonthCategoryPercentages(monthlyExpenses: MonthlyExpense[], selectedMonth: string) {
  const monthObj = monthlyExpenses.find((m) => m.month === selectedMonth) ?? monthlyExpenses[0];
  const totals = extractMonthCategoryAmounts(monthObj);

  const entries = Object.entries(totals)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  const grandTotal = entries.reduce((acc, [, v]) => acc + v, 0);

  return entries.map(([category, total]) => ({
    category,
    total,
    percent: grandTotal > 0 ? (total / grandTotal) * 100 : 0,
  }));
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

type RecurringTransaction = {
  name: string;
  category: string;
  count: number;
  avgAmount: number;
  totalAmount: number;
};

type IdenticalRecurringTransaction = {
  name: string;
  category: string;
  amount: number;
  count: number;
  totalAmount: number;
};

/**
 * Parse analyzer-generated transaction summary lines like:
 * "spent 28.33 euros in Paytrail Oyj DNA Oyj Mobiilipa on Tue Dec 09 2025"
 */
function parseSummaryLine(line: string): { name: string; amount: number } | null {
  const amountMatch = /spent\s+(-?\d+(?:\.\d+)?)\s+euros?/i.exec(line);
  if (!amountMatch) return null;
  const amount = Number(amountMatch[1]);

  // Prefer extracting merchant between " in " and " on ". If " on " is missing, take the rest.
  const inIdx = line.toLowerCase().indexOf(" in ");
  if (inIdx === -1) return null;
  const afterIn = line.slice(inIdx + 4);
  const onIdx = afterIn.toLowerCase().lastIndexOf(" on ");
  const name = (onIdx === -1 ? afterIn : afterIn.slice(0, onIdx)).trim();
  if (!name) return null;

  return { name, amount };
}

/** Compute total spend per category across all months (used for consistent color mapping). */
function computeCategoryTotals(monthlyExpenses: MonthlyExpense[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const m of monthlyExpenses) {
    const cats = m.categories ?? {};
    for (const [catName, info] of Object.entries(cats)) {
      totals[catName] = (totals[catName] ?? 0) + (Number(info.amount) || 0);
    }
  }
  return totals;
}

/** Build a stable category color map (sorted by total spend desc, then name). */
function buildCategoryColorMap(monthlyExpenses: MonthlyExpense[]): Record<string, string> {
  const totals = computeCategoryTotals(monthlyExpenses);
  const names = Object.keys(totals).sort((a, b) => {
    const diff = (totals[b] ?? 0) - (totals[a] ?? 0);
    return diff !== 0 ? diff : a.localeCompare(b);
  });
  const colors = makePieColors(names.length || 1);
  const map: Record<string, string> = {};
  names.forEach((name, idx) => {
    map[name] = colors[idx];
  });
  return map;
}

/** Compute top recurring transactions by merchant/name across all months/categories. */
function computeTopRecurringTransactions(
  monthlyExpenses: MonthlyExpense[],
  topN = 10
): RecurringTransaction[] {
  const stats: Record<
    string,
    { count: number; sum: number; categoryCounts: Record<string, number> }
  > = {};

  for (const m of monthlyExpenses) {
    const categories = m.categories ?? {};
    for (const [categoryName, cat] of Object.entries(categories)) {
      const tx = cat.transactions ?? {};
      for (const [key, value] of Object.entries(tx)) {
        // Skip synthesized rows
        if (key === "on average") continue;
        if (typeof value !== "string") continue;

        const parsed = parseSummaryLine(value);
        if (!parsed) continue;

        const normalizedName = parsed.name.replace(/\s+/g, " ").trim();
        const current = stats[normalizedName] ?? {
          count: 0,
          sum: 0,
          categoryCounts: {},
        };

        current.count += 1;
        current.sum += parsed.amount;
        current.categoryCounts[categoryName] = (current.categoryCounts[categoryName] ?? 0) + 1;
        stats[normalizedName] = current;
      }
    }
  }

  return Object.entries(stats)
    .map(([name, s]) => {
      const bestCategory = Object.entries(s.categoryCounts)
        .sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

      return {
        name,
        category: bestCategory,
        count: s.count,
        avgAmount: s.count ? s.sum / s.count : 0,
        totalAmount: s.sum,
      };
    })
    .sort((a, b) => (b.count - a.count) || (b.avgAmount - a.avgAmount))
    .slice(0, topN);
}

/**
 * Compute transactions that repeat identically: same merchant/name AND same amount.
 * Useful for subscriptions (e.g., Netflix €12.99 every month).
 */
function computeIdenticalRecurringTransactions(
  monthlyExpenses: MonthlyExpense[],
  topN = 10
): IdenticalRecurringTransaction[] {
  const stats: Record<
    string,
    { name: string; amount: number; count: number; categoryCounts: Record<string, number> }
  > = {};

  for (const m of monthlyExpenses) {
    const categories = m.categories ?? {};
    for (const [categoryName, cat] of Object.entries(categories)) {
      const tx = cat.transactions ?? {};
      for (const [key, value] of Object.entries(tx)) {
        // Skip synthesized rows
        if (key === "on average") continue;
        if (typeof value !== "string") continue;

        const parsed = parseSummaryLine(value);
        if (!parsed) continue;

        const normalizedName = parsed.name.replace(/\s+/g, " ").trim();

        // Amount normalization: keep 2 decimals (EUR cents)
        const amount = Math.round(parsed.amount * 100) / 100;

        const groupKey = `${normalizedName}__${amount.toFixed(2)}`;
        const current = stats[groupKey] ?? {
          name: normalizedName,
          amount,
          count: 0,
          categoryCounts: {},
        };
        current.count += 1;
        current.categoryCounts[categoryName] = (current.categoryCounts[categoryName] ?? 0) + 1;
        stats[groupKey] = current;
      }
    }
  }

  return Object.values(stats)
    // Only keep truly recurring ones (2+ occurrences)
    .filter((r) => r.count >= 2)
    .map((r) => {
      const bestCategory = Object.entries(r.categoryCounts)
        .sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
      return {
        name: r.name,
        category: bestCategory,
        amount: r.amount,
        count: r.count,
        totalAmount: r.amount * r.count,
      };
    })
    .sort((a, b) => (b.count - a.count) || (b.amount - a.amount))
    .slice(0, topN);
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
  const yearRows = useMemo(
    () => computePeriodCategoryPercentages(props.monthlyExpenses),
    [props.monthlyExpenses]
  );
  const monthRows = useMemo(
    () => computeMonthCategoryPercentages(props.monthlyExpenses, props.selectedMonth),
    [props.monthlyExpenses, props.selectedMonth]
  );
  const categoryColors = useMemo(
    () => buildCategoryColorMap(props.monthlyExpenses),
    [props.monthlyExpenses]
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

          {(props.breakdownMode === "year" ? yearRows : monthRows).length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ color: "#555", fontWeight: 600, marginBottom: 6 }}>
                {props.breakdownMode === "year"
                  ? "Percentages for the whole period"
                  : `Percentages for ${props.selectedMonth || props.monthlyExpenses[0]?.month}`}
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: "8px 6px" }}>
                        Category
                      </th>
                      <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: "8px 6px", whiteSpace: "nowrap" }}>
                        Total
                      </th>
                      <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: "8px 6px", whiteSpace: "nowrap" }}>
                        %
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(props.breakdownMode === "year" ? yearRows : monthRows).map((r) => (
                      <tr key={r.category}>
                        <td style={{ padding: "8px 6px", borderBottom: "1px solid #f3f3f3" }}>
                          <span style={{ color: categoryColors[r.category] ?? "#555", fontWeight: 600 }}>
                            {r.category}
                          </span>
                        </td>
                        <td style={{ padding: "8px 6px", borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>
                          € {r.total.toFixed(2)}
                        </td>
                        <td style={{ padding: "8px 6px", borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>
                          {r.percent.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
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

/** Table showing the most recurring transactions (by merchant/name) across the analyzed period. */
function TopRecurringTransactions({ monthlyExpenses }: Readonly<{ monthlyExpenses: MonthlyExpense[] }>) {
  const [limit, setLimit] = useState<number>(10);
  const rawRows = useMemo(
    () => computeTopRecurringTransactions(monthlyExpenses, limit),
    [monthlyExpenses, limit]
  );
  const [sortKey, setSortKey] = useState<"name" | "category" | "avgAmount" | "totalAmount" | "count">("count");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const rows = useMemo(() => {
    const sorted = [...rawRows];
    sorted.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortKey) {
        case "name":
          return dir * a.name.localeCompare(b.name);
        case "category":
          return dir * (a.category || "").localeCompare(b.category || "");
        case "avgAmount":
          return dir * (a.avgAmount - b.avgAmount);
        case "totalAmount":
          return dir * (a.totalAmount - b.totalAmount);
        case "count":
        default:
          return dir * (a.count - b.count);
      }
    });
    return sorted;
  }, [rawRows, sortKey, sortDir]);

  function toggleSort(nextKey: typeof sortKey) {
    if (nextKey === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(nextKey);
      setSortDir(nextKey === "name" || nextKey === "category" ? "asc" : "desc");
    }
  }

  const categoryColors = useMemo(() => buildCategoryColorMap(monthlyExpenses), [monthlyExpenses]);

  return (
    <div style={{ marginTop: 24, borderTop: "1px solid #eee", paddingTop: 16 }}>
      <h2 style={{ margin: "0 0 12px" }}>Top recurring transactions</h2>
      <div style={{ marginBottom: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ color: "#555" }}>
          Show:{" "}
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
        </label>
      </div>

      {rows.length ? (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th
                  onClick={() => toggleSort("name")}
                  style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: "8px 6px", cursor: "pointer" }}
                >
                  Name
                </th>
                <th
                  onClick={() => toggleSort("category")}
                  style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: "8px 6px", cursor: "pointer" }}
                >
                  Category
                </th>
                <th
                  onClick={() => toggleSort("avgAmount")}
                  style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: "8px 6px", whiteSpace: "nowrap", cursor: "pointer" }}
                >
                  Avg amount
                </th>
                <th
                  onClick={() => toggleSort("count")}
                  style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: "8px 6px", whiteSpace: "nowrap", cursor: "pointer" }}
                >
                  Count
                </th>
                <th
                  onClick={() => toggleSort("totalAmount")}
                  style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: "8px 6px", whiteSpace: "nowrap", cursor: "pointer" }}
                >
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td style={{ padding: "8px 6px", borderBottom: "1px solid #f3f3f3" }}>{r.name}</td>
                  <td style={{ padding: "8px 6px", borderBottom: "1px solid #f3f3f3" }}>
                    <span
                      style={{
                        color: categoryColors[r.category] ?? "#555",
                        fontWeight: 600,
                      }}
                    >
                      {r.category || "—"}
                    </span>
                  </td>
                  <td style={{ padding: "8px 6px", borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>
                    € {r.avgAmount.toFixed(2)}
                  </td>
                  <td style={{ padding: "8px 6px", borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{r.count}</td>
                  <td style={{ padding: "8px 6px", borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>
                    € {r.totalAmount.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div>No recurring transactions found in the current analysis output.</div>
      )}

      <div style={{ marginTop: 8, color: "#666", fontSize: 12 }}>
        Based on transaction summary lines emitted by the analyzer per category/month. (MVP approximation.)
      </div>
    </div>
  );
}

/**
 * Table showing "identical" recurring payments: same merchant/name AND same amount.
 * This is a good proxy for subscriptions.
 */
function IdenticalRecurringTransactions({ monthlyExpenses }: Readonly<{ monthlyExpenses: MonthlyExpense[] }>) {
  const [limit, setLimit] = useState<number>(10);
  const rawRows = useMemo(
    () => computeIdenticalRecurringTransactions(monthlyExpenses, limit),
    [monthlyExpenses, limit]
  );
  const [sortKey, setSortKey] = useState<"name" | "category" | "amount" | "totalAmount" | "count">("count");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const rows = useMemo(() => {
    const sorted = [...rawRows];
    sorted.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortKey) {
        case "name":
          return dir * a.name.localeCompare(b.name);
        case "category":
          return dir * (a.category || "").localeCompare(b.category || "");
        case "amount":
          return dir * (a.amount - b.amount);
        case "totalAmount":
          return dir * (a.totalAmount - b.totalAmount);
        case "count":
        default:
          return dir * (a.count - b.count);
      }
    });
    return sorted;
  }, [rawRows, sortKey, sortDir]);

  function toggleSort(nextKey: typeof sortKey) {
    if (nextKey === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(nextKey);
      setSortDir(nextKey === "name" || nextKey === "category" ? "asc" : "desc");
    }
  }

  const categoryColors = useMemo(() => buildCategoryColorMap(monthlyExpenses), [monthlyExpenses]);

  return (
    <div style={{ marginTop: 24, borderTop: "1px solid #eee", paddingTop: 16 }}>
      <h2 style={{ margin: "0 0 12px" }}>Identical recurring payments (subscriptions)</h2>
      <div style={{ marginBottom: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ color: "#555" }}>
          Show:{" "}
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
        </label>
      </div>

      {rows.length ? (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th
                  onClick={() => toggleSort("name")}
                  style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: "8px 6px", cursor: "pointer" }}
                >
                  Name
                </th>
                <th
                  onClick={() => toggleSort("category")}
                  style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: "8px 6px", cursor: "pointer" }}
                >
                  Category
                </th>
                <th
                  onClick={() => toggleSort("amount")}
                  style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: "8px 6px", whiteSpace: "nowrap", cursor: "pointer" }}
                >
                  Amount
                </th>
                <th
                  onClick={() => toggleSort("count")}
                  style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: "8px 6px", whiteSpace: "nowrap", cursor: "pointer" }}
                >
                  Count
                </th>
                <th
                  onClick={() => toggleSort("totalAmount")}
                  style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: "8px 6px", whiteSpace: "nowrap", cursor: "pointer" }}
                >
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.name}__${r.amount.toFixed(2)}`}>
                  <td style={{ padding: "8px 6px", borderBottom: "1px solid #f3f3f3" }}>{r.name}</td>
                  <td style={{ padding: "8px 6px", borderBottom: "1px solid #f3f3f3" }}>
                    <span
                      style={{
                        color: categoryColors[r.category] ?? "#555",
                        fontWeight: 600,
                      }}
                    >
                      {r.category || "—"}
                    </span>
                  </td>
                  <td style={{ padding: "8px 6px", borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>
                    € {r.amount.toFixed(2)}
                  </td>
                  <td style={{ padding: "8px 6px", borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{r.count}</td>
                  <td style={{ padding: "8px 6px", borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>
                    € {r.totalAmount.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div>No identical recurring payments found (need 2+ occurrences).</div>
      )}

      <div style={{ marginTop: 8, color: "#666", fontSize: 12 }}>
        Grouped by merchant/name + exact amount (rounded to cents). (MVP approximation.)
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

              <TopRecurringTransactions monthlyExpenses={result.monthlyExpenses} />
              <IdenticalRecurringTransactions monthlyExpenses={result.monthlyExpenses} />

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