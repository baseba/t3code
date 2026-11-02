import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { useState, type RefObject } from "react";

import { cn } from "../../lib/utils";
import { isOverSidebar, useTrackpadSwipe, type SwipeState } from "../HistorySwipeNavigation";
import { resolveSidebarProjectSwipeTarget } from "../Sidebar.logic";
import { createSidebarSwipeMotion } from "../Sidebar.motion";

type ProjectSwipeTarget = NonNullable<ReturnType<typeof resolveSidebarProjectSwipeTarget>>;

/** Two-finger horizontal trackpad swipes over the sidebar step through the project filter. */
export function SidebarProjectSwipe({
  groups,
  scopeKeys,
  onSelect,
  contentRef,
}: {
  readonly groups: Parameters<typeof resolveSidebarProjectSwipeTarget>[0]["groups"];
  readonly scopeKeys: readonly string[];
  readonly onSelect: (keys: readonly string[]) => void;
  readonly contentRef: RefObject<HTMLElement | null>;
}) {
  const [motion] = useState(createSidebarSwipeMotion);
  const readViewport = () =>
    contentRef.current?.closest<HTMLElement>("[data-slot=scroll-area-viewport]") ?? null;
  const swipe = useTrackpadSwipe({
    begin: (direction, path) =>
      isOverSidebar(path) && !motion.isSwapping()
        ? resolveSidebarProjectSwipeTarget({ groups, scopeKeys, direction })
        : null,
    move: (direction, distance) =>
      motion.track(readViewport(), direction === "forward" ? -distance : distance),
    commit: (direction, target) =>
      motion.finish(readViewport(), direction === "forward" ? "left" : "right", () =>
        onSelect(target.keys),
      ),
    cancel: () => motion.settle(readViewport()),
  });

  return swipe === null ? null : <ProjectSwipeIndicator {...swipe} />;
}

// Sits in the sidebar's fixed container, so it spans the sidebar without reading its bounds.
function ProjectSwipeIndicator({
  direction,
  target,
  progress,
  y,
  tracking,
}: SwipeState<ProjectSwipeTarget>) {
  const armed = progress >= 1;
  const Icon = direction === "back" ? ArrowLeftIcon : ArrowRightIcon;
  const offset = (1 - progress) * 16;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      <div
        className={cn(
          "absolute inset-x-3 flex justify-center",
          !tracking && "transition-opacity duration-200 ease-out",
        )}
        style={{
          top: `clamp(0.5rem, calc(${y}px - 1rem), calc(100% - 2.5rem))`,
          opacity: tracking ? 1 : 0,
          transform: `translateX(${direction === "back" ? -offset : offset}px)`,
        }}
      >
        <div className="flex h-8 min-w-0 items-center gap-1.5 rounded-full border border-border bg-popover px-3 text-xs font-medium text-popover-foreground shadow-md">
          <Icon
            className={cn(
              "size-3.5 shrink-0 transition-opacity duration-100",
              armed ? "opacity-100" : "opacity-40",
            )}
          />
          <span className="truncate">{target.label}</span>
        </div>
      </div>
    </div>
  );
}
