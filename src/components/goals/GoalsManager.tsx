import { useMemo, useState } from "react";
import { Calendar, DollarSign, Target } from "lucide-react";
import type { SavingsGoal } from "@/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/auth/FormField";
import { formatCents } from "@/lib/format-money";

interface Props {
  initialGoals: SavingsGoal[];
}

function getTomorrowDateString(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const year = tomorrow.getFullYear();
  const month = String(tomorrow.getMonth() + 1).padStart(2, "0");
  const day = String(tomorrow.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getMonthsRemainingLabel(targetDate: string): string {
  const target = new Date(`${targetDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (target.getTime() <= today.getTime()) return "Past due";
  let months = (target.getFullYear() - today.getFullYear()) * 12 + (target.getMonth() - today.getMonth());
  if (target.getDate() < today.getDate()) months -= 1;
  const labelMonths = Math.max(1, months);
  return `${labelMonths} month${labelMonths === 1 ? "" : "s"} remaining`;
}

export default function GoalsManager({ initialGoals }: Props) {
  const [goals, setGoals] = useState<SavingsGoal[]>(initialGoals);
  const [name, setName] = useState("");
  const [targetAmountDollars, setTargetAmountDollars] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editAmountDollars, setEditAmountDollars] = useState("");
  const [editDate, setEditDate] = useState("");

  const minTargetDate = useMemo(() => getTomorrowDateString(), []);
  const atGoalCap = goals.length >= 3;

  function startEdit(goal: SavingsGoal) {
    setError(null);
    setEditingId(goal.id);
    setEditName(goal.name);
    setEditAmountDollars((goal.target_amount / 100).toString());
    setEditDate(goal.target_date);
  }

  function cancelEdit() {
    setEditingId(null);
    setError(null);
  }

  async function handleUpdate(goal: SavingsGoal, e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (savingId) return;

    setError(null);

    const amount = Number.parseFloat(editAmountDollars);
    if (!editName.trim()) {
      setError("Goal name is required");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Target amount must be greater than 0");
      return;
    }
    if (!editDate) {
      setError("Target date is required");
      return;
    }

    setSavingId(goal.id);

    try {
      const response = await fetch(`/api/goals/${goal.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          target_amount_dollars: amount,
          target_date: editDate,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as { goal?: SavingsGoal; error?: string };

      if (!response.ok) {
        setError(payload.error ?? "Failed to update goal");
        return;
      }

      if (payload.goal) {
        const updated = payload.goal;
        setGoals((current) => current.map((g) => (g.id === goal.id ? updated : g)));
        setEditingId(null);
      }
    } catch {
      setError("Failed to update goal. Please try again.");
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(goal: SavingsGoal) {
    if (deletingId) return;
    if (!window.confirm(`Delete "${goal.name}"?`)) return;

    setError(null);
    setDeletingId(goal.id);

    try {
      const response = await fetch(`/api/goals/${goal.id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setError(payload.error ?? "Failed to delete goal");
        return;
      }
      setGoals((current) => current.filter((g) => g.id !== goal.id));
    } catch {
      setError("Failed to delete goal. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (atGoalCap || isSubmitting) return;

    setError(null);
    setIsSubmitting(true);

    const amount = Number.parseFloat(targetAmountDollars);
    if (!name.trim()) {
      setError("Goal name is required");
      setIsSubmitting(false);
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Target amount must be greater than 0");
      setIsSubmitting(false);
      return;
    }
    if (!targetDate) {
      setError("Target date is required");
      setIsSubmitting(false);
      return;
    }

    try {
      const response = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          target_amount_dollars: amount,
          target_date: targetDate,
        }),
      });

      const payload = (await response.json()) as { goal?: SavingsGoal; error?: string };

      if (!response.ok) {
        setError(payload.error ?? "Failed to create savings goal");
        return;
      }

      if (payload.goal) {
        const created = payload.goal;
        setGoals((current) => [...current, created]);
        setName("");
        setTargetAmountDollars("");
        setTargetDate("");
      }
    } catch {
      setError("Failed to create savings goal. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-white/10 bg-white/10 p-6 text-white backdrop-blur-xl">
        <h2 className="mb-4 text-lg font-semibold text-white">Your goals</h2>
        {goals.length === 0 ? (
          <p className="text-sm text-blue-100/70">No savings goals yet. Create your first goal below.</p>
        ) : (
          <ul className="space-y-3">
            {goals.map((goal) => {
              const isEditing = editingId === goal.id;
              const rowBusy = savingId !== null || deletingId !== null;
              const otherRowActive = editingId !== null && !isEditing;

              if (isEditing) {
                return (
                  <li key={goal.id} className="rounded-xl border border-white/10 bg-white/5 px-4 py-4">
                    <form onSubmit={(e) => void handleUpdate(goal, e)} className="space-y-4">
                      <FormField
                        id={`edit-name-${goal.id}`}
                        label="Goal name"
                        value={editName}
                        onChange={setEditName}
                        maxLength={100}
                        icon={<Target className="size-4" />}
                      />
                      <FormField
                        id={`edit-amount-${goal.id}`}
                        label="Target amount (USD)"
                        type="number"
                        value={editAmountDollars}
                        onChange={setEditAmountDollars}
                        step="0.01"
                        min="0.01"
                        icon={<DollarSign className="size-4" />}
                      />
                      <div>
                        <label htmlFor={`edit-date-${goal.id}`} className="mb-1 block text-sm text-blue-100/80">
                          Target date
                        </label>
                        <div className="relative">
                          <span className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-white/40">
                            <Calendar className="size-4" />
                          </span>
                          <input
                            id={`edit-date-${goal.id}`}
                            name={`edit-date-${goal.id}`}
                            type="date"
                            value={editDate}
                            onChange={(e) => {
                              setEditDate(e.target.value);
                            }}
                            className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 pl-10 text-white focus:ring-2 focus:ring-purple-400 focus:outline-none"
                          />
                        </div>
                      </div>
                      {error && <p className="text-sm text-red-300">{error}</p>}
                      <div className="flex gap-3">
                        <Button
                          type="submit"
                          disabled={savingId !== null}
                          className="border border-white/20 bg-white/10 text-white hover:bg-white/20"
                        >
                          {savingId === goal.id ? "Saving…" : "Save"}
                        </Button>
                        <Button
                          type="button"
                          onClick={cancelEdit}
                          disabled={savingId !== null}
                          className="border border-white/10 bg-transparent text-blue-100/80 hover:bg-white/10"
                        >
                          Cancel
                        </Button>
                      </div>
                    </form>
                  </li>
                );
              }

              return (
                <li
                  key={goal.id}
                  className="flex items-start justify-between gap-4 rounded-xl border border-white/10 bg-white/5 px-4 py-4"
                >
                  <div className="min-w-0">
                    <p className="mb-2 font-medium text-white">{goal.name}</p>
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-blue-100/80">
                      <span>Target: {formatCents(goal.target_amount)}</span>
                      <span>By: {goal.target_date}</span>
                      <span>{getMonthsRemainingLabel(goal.target_date)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      type="button"
                      onClick={() => {
                        startEdit(goal);
                      }}
                      disabled={rowBusy || otherRowActive}
                      className="border border-white/20 bg-white/10 text-white hover:bg-white/20"
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void handleDelete(goal)}
                      disabled={rowBusy || otherRowActive}
                      className="border border-rose-400/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20"
                    >
                      {deletingId === goal.id ? "Deleting…" : "Delete"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/10 p-6 text-white backdrop-blur-xl">
        <h2 className="mb-4 text-lg font-semibold text-white">Add a goal</h2>
        {atGoalCap && (
          <p className="mb-4 text-sm text-amber-200">You&apos;ve reached the 3-goal limit (max 3 active goals).</p>
        )}
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <FormField
            id="goal-name"
            label="Goal name"
            value={name}
            onChange={setName}
            placeholder="e.g. Emergency fund"
            maxLength={100}
            icon={<Target className="size-4" />}
            disabled={atGoalCap}
          />
          <FormField
            id="target-amount"
            label="Target amount (USD)"
            type="number"
            value={targetAmountDollars}
            onChange={setTargetAmountDollars}
            placeholder="1500"
            step="0.01"
            min="0.01"
            icon={<DollarSign className="size-4" />}
            disabled={atGoalCap}
          />
          <div>
            <label htmlFor="target-date" className="mb-1 block text-sm text-blue-100/80">
              Target date
            </label>
            <div className="relative">
              <span className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-white/40">
                <Calendar className="size-4" />
              </span>
              <input
                id="target-date"
                name="target-date"
                type="date"
                min={minTargetDate}
                value={targetDate}
                onChange={(e) => {
                  setTargetDate(e.target.value);
                }}
                disabled={atGoalCap}
                className={cn(
                  "w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 pl-10 text-white focus:ring-2 focus:ring-purple-400 focus:outline-none",
                  atGoalCap && "cursor-not-allowed opacity-50",
                )}
              />
            </div>
          </div>
          {error && <p className="text-sm text-red-300">{error}</p>}
          <Button
            type="submit"
            disabled={atGoalCap || isSubmitting}
            className={cn(
              "w-full border border-white/20 bg-white/10 text-white hover:bg-white/20",
              atGoalCap && "cursor-not-allowed",
            )}
          >
            {isSubmitting ? "Creating…" : "Create goal"}
          </Button>
        </form>
      </section>
    </div>
  );
}
