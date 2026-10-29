import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";

/// The Routines page before its first read: the week strip's seven days, the
/// heading line, and rows with an agent tile, a name, the routine's sentence and
/// the switch on the right.
export default function RoutinesSkeleton() {
  return (
    <SkeletonRegion label="Reading routines">
      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex h-[66px] flex-col items-center gap-1.5 rounded-(--r2) py-2 shadow-[inset_0_0_0_1px_var(--line)]">
            <Skeleton className="h-2.5 w-7" />
            <Skeleton className="h-4 w-5 rounded-[4px]" />
          </div>
        ))}
      </div>

      <div className="mx-1 mt-5 mb-2 flex items-baseline gap-1.5">
        <Skeleton className="h-3 w-20" />
      </div>

      <div className="rounded-[13px] bg-s1 shadow-[inset_0_0_0_1px_var(--line)] [&>*+*]:border-t [&>*+*]:border-line">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-[11px] px-3 py-[9px]">
            <Skeleton className="size-[26px] rounded-lg" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className={i === 1 ? "h-3.5 w-1/2" : "h-3.5 w-2/5"} />
              <Skeleton className="h-3 w-3/5" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}
