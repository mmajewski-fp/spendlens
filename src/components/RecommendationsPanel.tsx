import { useState } from "react";
import type { GoalRecommendation, RecommendationsResult, SpendingAlert, Suggestion } from "@/types";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/format-money";

interface Props {
  result: RecommendationsResult;
}

function AlertCard({ alert }: { alert: SpendingAlert }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3">
      <div>
        <p className="font-medium text-amber-200">{alert.categoryName}</p>
        <p className="text-xs text-amber-300/70">Threshold: {formatCents(alert.thresholdCents)} / month</p>
      </div>
      <div className="text-right">
        <p className="font-semibold text-amber-100">{formatCents(alert.spendCents)}</p>
        <p className="text-xs text-amber-300/70">spent</p>
      </div>
    </div>
  );
}

function SuggestionCard({ suggestion, rank }: { suggestion: Suggestion; rank: number }) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-xs font-bold text-blue-300">
        {rank}
      </span>
      <div className="flex-1">
        <p className="font-medium text-white">{suggestion.categoryName}</p>
      </div>
      <p className="font-semibold text-emerald-300">Cut ~{formatCents(suggestion.estimatedSavingCents)}</p>
    </div>
  );
}

function GoalTab({ goal, isActive, onClick }: { goal: GoalRecommendation; isActive: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
        isActive ? "bg-white/20 text-white" : "text-blue-100/60 hover:bg-white/10 hover:text-white",
      )}
    >
      {goal.goalName}
      {goal.isExpired && (
        <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-semibold text-red-300">Expired</span>
      )}
    </button>
  );
}

function GoalContent({ goal }: { goal: GoalRecommendation }) {
  if (goal.isOnTrack) {
    return (
      <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-6 text-center">
        <p className="mb-1 text-lg font-semibold text-emerald-200">You&apos;re on track for {goal.goalName}!</p>
        <p className="text-sm text-emerald-300/70">
          Your current surplus covers the required monthly saving of {formatCents(goal.requiredMonthlySavingCents)}.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {goal.isExpired && (
        <div className="rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          This goal has expired. Suggestions below are based on the original target.
        </div>
      )}
      <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
        <span className="text-blue-100/60">Required monthly saving</span>
        <span className="font-semibold text-white">{formatCents(goal.requiredMonthlySavingCents)}</span>
      </div>
      <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
        <span className="text-blue-100/60">Current monthly surplus</span>
        <span className={cn("font-semibold", goal.currentSurplusCents >= 0 ? "text-emerald-300" : "text-red-300")}>
          {formatCents(goal.currentSurplusCents)}
        </span>
      </div>
      {goal.suggestions.length > 0 ? (
        <div className="space-y-2 pt-2">
          <p className="text-xs font-semibold tracking-wider text-blue-100/50 uppercase">
            Top expense cuts to close the gap
          </p>
          {goal.suggestions.map((s, i) => (
            <SuggestionCard key={s.categorySlug} suggestion={s} rank={i + 1} />
          ))}
        </div>
      ) : (
        <p className="pt-2 text-center text-sm text-blue-100/50">No expense categories found to suggest cuts from.</p>
      )}
    </div>
  );
}

export default function RecommendationsPanel({ result }: Props) {
  const [activeGoalIndex, setActiveGoalIndex] = useState(0);

  if (result.hasMissingIncome) {
    return (
      <div className="rounded-2xl border border-blue-400/30 bg-blue-500/10 p-6 text-center text-white backdrop-blur-xl">
        <p className="mb-1 font-semibold text-blue-200">No income detected this month</p>
        <p className="text-sm text-blue-300/70">
          We couldn&apos;t detect income this month — make sure salary/income transactions are imported.
        </p>
      </div>
    );
  }

  const activeGoal = result.goals[activeGoalIndex];

  return (
    <div className="space-y-6">
      {result.alerts.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold tracking-wider text-amber-300/70 uppercase">
            Excessive Spending Alerts
          </h2>
          <div className="space-y-2">
            {result.alerts.map((alert) => (
              <AlertCard key={alert.categorySlug} alert={alert} />
            ))}
          </div>
        </section>
      )}

      {result.goals.length > 0 && (
        <section className="rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl">
          {result.goals.length > 1 && (
            <div className="mb-6 flex flex-wrap gap-2">
              {result.goals.map((goal, i) => (
                <GoalTab
                  key={goal.goalId}
                  goal={goal}
                  isActive={i === activeGoalIndex}
                  onClick={() => {
                    setActiveGoalIndex(i);
                  }}
                />
              ))}
            </div>
          )}
          {result.goals.length === 1 && (
            <div className="mb-4 flex items-center gap-2">
              <h2 className="font-semibold text-white">{activeGoal.goalName}</h2>
              {activeGoal.isExpired && (
                <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-semibold text-red-300">
                  Expired
                </span>
              )}
            </div>
          )}
          <GoalContent goal={activeGoal} />
        </section>
      )}
    </div>
  );
}
