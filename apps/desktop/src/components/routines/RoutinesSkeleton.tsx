import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";

/// The Routines page before its first read: the week strip's seven days, the
/// heading line, and rows with an agent tile, a name, the routine's sentence and
/// the switch on the right.
export default function RoutinesSkeleton() {
  return (
    <SkeletonRegion label="Reading routines">
      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex h-[92px] flex-col gap-2 rounded-(--r3) bg-s1 p-2.5 shadow-[inset_0_0_0_1px_var(--line)]">
            <Skeleton className="h-2.5 w-8" />
            {i % 3 !== 1 && <Skeleton className="h-4 w-full rounded-[4px]" />}
            {i % 2 === 0 && <Skeleton className="h-4 w-4/5 rounded-[4px]" />}
          </div>
        ))}
      </div>

      <div className="mt-[34px] mb-2.5 flex items-baseline gap-2.5">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-2.5 w-44" />
      </div>

      <div className="flex flex-col gap-1.5">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex items-start gap-3.5 rounded-(--r4) bg-s1 py-4 pr-4 pl-[18px] shadow-[inset_0_0_0_1px_var(--line)]"
          >
            <Skeleton className="size-[34px] rounded-lg" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className={i === 1 ? "h-3 w-2/3" : "h-3 w-4/5"} />
              <Skeleton className="h-2.5 w-48" />
            </div>
            <Skeleton className="h-5 w-9 rounded-full" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}
