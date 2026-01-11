import { useMemo, useRef, useState } from "react";
import "./App.css";
import { TransactionAnalyzer } from "transaction-analyzer";

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

type BankName = "Nordea" | "ING";

function detectBank(fileName: string): BankName {
  return fileName.toLowerCase().includes("ing") ? "ING" : "Nordea";
}

type MonthlyExpense = {
  month: string;
  sum: string; // e.g. "1330.84 euros"
};

type AnalysisResult = {
  averageMonthExpenses?: string;
  monthlyExpenses: MonthlyExpense[];
};

function parseEuroAmount(sum: string): number {
  const match = new RegExp(/-?\d+(?:\.\d+)?/).exec(sum);
  return match ? Number(match[0]) : 0;
}

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const analyzer = useMemo(() => new TransactionAnalyzer(), []);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

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