import { useRef, useState, useMemo } from "react";
import "./App.css";
import { TransactionAnalyzer } from "transaction-analyzer";

type BankName = "Nordea" | "ING";

function detectBank(fileName: string): BankName {
    return fileName.toLowerCase().includes("ing") ? "ING" : "Nordea";
}

export default function App() {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const analyzer = useMemo(() => new TransactionAnalyzer(), []);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<object | null>(null);

    async function onFileSelected(
        e: React.ChangeEvent<HTMLInputElement>
    ) {
        const file = e.target.files?.[0];
        if (!file) return;

        setLoading(true);
        setError(null);
        setResult(null);

        try {
            const csvText = await file.text();
            const bank = detectBank(file.name);

            const analysis = await analyzer.analyzeCsvContent(csvText, bank);
            setResult(analysis);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    }

    return (
        <div style={{ padding: 32, maxWidth: 900, margin: "0 auto" }}>
            <h1>Transaction Analyzer</h1>

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
                style={{ padding: "10px 16px", cursor: "pointer" }}
            >
                {loading ? "Analyzing…" : "Upload file"}
            </button>

            {error && (
                <pre style={{ marginTop: 20, color: "red" }}>
                  {error}
                </pre>
            )}

            {result && (
                <pre style={{marginTop: 20}}>
                  {JSON.stringify(result, null, 2)}
                </pre>
            )}
        </div>
    );
}