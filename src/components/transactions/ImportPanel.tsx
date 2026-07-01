import { useState } from "react";
import { Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";

// No server data to hydrate — the panel triggers the import on click and shows
// the landed count. (No Props: the page passes nothing.)

type Status = "idle" | "loading" | "success" | "error";

export default function ImportPanel() {
  const [status, setStatus] = useState<Status>("idle");
  const [imported, setImported] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    if (status === "loading") return;
    setStatus("loading");
    setError(null);

    try {
      const response = await fetch("/api/transactions/import", { method: "POST" });
      const payload = (await response.json()) as { imported?: number; error?: string };

      if (!response.ok) {
        setError(payload.error ?? "Failed to import transactions");
        setStatus("error");
        return;
      }

      setImported(payload.imported ?? 0);
      setStatus("success");
    } catch {
      setError("Failed to import transactions. Please try again.");
      setStatus("error");
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/10 bg-white/10 p-6 text-white backdrop-blur-xl">
        <p className="mb-2 text-lg font-semibold">Import your transactions</p>
        <p className="mb-6 text-sm text-blue-100/70">
          Connect the simulated banking API to import and auto-categorize your recent transactions. We&apos;ll use them
          to power your spending dashboard and goal-based recommendations.
        </p>

        <Button
          onClick={() => void handleConnect()}
          disabled={status === "loading"}
          className="border border-white/20 bg-white/10 text-white hover:bg-white/20"
        >
          <Landmark className="mr-2 size-4" />
          {status === "loading" ? "Connecting…" : "Connect Bank"}
        </Button>

        {status === "error" && <p className="mt-4 text-sm text-red-300">{error}</p>}

        {status === "success" && (
          <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="mb-3 font-medium text-white">
              {imported === 0
                ? "0 new — your transactions are already imported."
                : `Imported ${imported} transaction${imported === 1 ? "" : "s"}.`}
            </p>
            <div className="flex flex-wrap gap-3 text-sm">
              <a
                href="/recommendations"
                className="inline-block rounded-lg border border-white/20 bg-white/10 px-4 py-2 font-medium transition-colors hover:bg-white/20"
              >
                View recommendations
              </a>
              <a
                href="/dashboard"
                className="inline-block rounded-lg border border-white/20 bg-white/10 px-4 py-2 font-medium transition-colors hover:bg-white/20"
              >
                Go to dashboard
              </a>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
