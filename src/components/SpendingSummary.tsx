import type { SpendingSummary as SpendingSummaryData } from "@/types";
import { formatCents } from "@/lib/format-money";

interface Props {
  summary: SpendingSummaryData;
}

export default function SpendingSummary({ summary }: Props) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/10 p-8 text-white backdrop-blur-xl">
      <div className="mb-6 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-blue-100">Spending this month</h2>
        <span className="text-2xl font-bold text-white">{formatCents(summary.totalExpensesCents)}</span>
      </div>

      <ul className="space-y-4">
        {summary.categories.map((category) => (
          <li key={category.categorySlug}>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="font-medium text-white">{category.categoryName}</span>
              <span className="text-blue-100/80">
                {formatCents(category.totalCents)}
                <span className="ml-2 text-blue-100/50">{category.percent}%</span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-400 to-purple-400"
                style={{ width: `${category.percent}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
