import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";

/// A settings page before what it reads is there: the lead line, a quiet heading
/// and rows of a label with its reason on the left and a control on the right,
/// the shape `StudioRow` draws.
export default function SettingsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <SkeletonRegion label="Reading settings" className="flex flex-col gap-7">
      <Skeleton className="h-3 w-3/5" />
      <Skeleton className="-mb-3.5 h-2.5 w-24" />
      <div className="overflow-hidden rounded-[13px] bg-s1 shadow-[inset_0_0_0_1px_var(--line)]">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-6 border-t border-line px-3.5 py-3 first:border-t-0">
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-2.5 w-40" />
            </div>
            <Skeleton className={i % 2 ? "h-8 w-48 rounded-md" : "h-8 w-32 rounded-md"} />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}
