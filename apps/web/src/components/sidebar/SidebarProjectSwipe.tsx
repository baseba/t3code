import { useState, type RefObject } from "react";
import { flushSync } from "react-dom";

import { isOverSidebar, useTrackpadSwipe } from "../HistorySwipeNavigation";
import { resolveSidebarProjectSwipeTarget } from "../Sidebar.logic";
import { createSidebarSwipeMotion } from "../Sidebar.motion";

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
  useTrackpadSwipe({
    begin: (direction, path) =>
      isOverSidebar(path)
        ? resolveSidebarProjectSwipeTarget({ groups, scopeKeys, direction })
        : null,
    move: (direction, distance) =>
      motion.track(readViewport(), direction === "forward" ? -distance : distance),
    commit: (direction, target) =>
      // Rendering first keeps the outgoing list from sliding back in as the incoming one.
      motion.finish(readViewport(), direction === "forward" ? "left" : "right", () =>
        flushSync(() => onSelect(target.keys)),
      ),
    cancel: () => motion.settle(readViewport()),
  });

  return null;
}
