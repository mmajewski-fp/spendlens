import type { RecommendationsResult } from "@/types";

interface Props {
  result: RecommendationsResult;
}

export default function RecommendationsPanel(_props: Props) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/10 p-8 text-center text-white backdrop-blur-xl">
      <p className="text-blue-100/80">Loading recommendations…</p>
    </div>
  );
}
