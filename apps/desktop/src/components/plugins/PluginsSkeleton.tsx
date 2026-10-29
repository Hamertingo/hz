import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";

const CARD = "rounded-(--r4) bg-s1 shadow-[inset_0_0_0_1px_var(--line)]";
const GRID = "grid grid-cols-3 gap-2.5 max-[900px]:grid-cols-2 max-[620px]:grid-cols-1";

/// The Plugins page's cards before the first read: a plugin card (mark, name,
/// status, two lines, faces) for Connected and Catalog, and a skill card (title,
/// a block of code lines, author) for Skills.
export default function PluginsSkeleton({ tab }: { tab: "connected" | "catalog" | "skills" }) {
  return (
    <SkeletonRegion label="Reading plugins" className={GRID}>
      {Array.from({ length: tab === "skills" ? 3 : 6 }, (_, i) =>
        tab === "skills" ? (
          <div key={i} className={`${CARD} px-[18px] pt-[18px] pb-4`}>
            <div className="flex items-center gap-2">
              <Skeleton className="size-[15px]" />
              <Skeleton className="h-3.5 w-28" />
            </div>
            <div className="mt-3 flex h-[104px] flex-col gap-2.5 overflow-hidden">
              {["w-full", "w-11/12", "w-3/4", "w-5/6", "w-2/3"].map((w) => (
                <Skeleton key={w} className={`h-2.5 ${w}`} />
              ))}
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <Skeleton className="size-[18px] rounded-full" />
              <Skeleton className="h-2.5 w-20" />
            </div>
          </div>
        ) : (
          <div key={i} className={`${CARD} flex flex-col gap-3 p-4`}>
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-[10px]" />
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-2.5 w-14" />
              </div>
              {tab === "connected" && <Skeleton className="ml-auto h-2.5 w-16" />}
            </div>
            <div className="flex min-h-[38px] flex-col gap-2">
              <Skeleton className="h-2.5 w-full" />
              <Skeleton className="h-2.5 w-3/4" />
            </div>
            {tab === "connected" && (
              <div className="flex items-center gap-2">
                <Skeleton className="size-4 rounded-[5px]" />
                <Skeleton className="h-2.5 w-24" />
              </div>
            )}
          </div>
        ),
      )}
    </SkeletonRegion>
  );
}
