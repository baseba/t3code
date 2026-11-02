import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

import { cn } from "../lib/utils";
import { canNavigateHistory, navigateHistory, type HistoryDirection } from "../navigationHistory";

const SWIPE_TRIGGER_DISTANCE = 120;
// Movement needed before the gesture picks an axis; first events are often diagonal.
const SWIPE_AXIS_LOCK_DISTANCE = 8;
const MOMENTUM_SAMPLE_SIZE = 5;

type SwipeBounds = { left: number; top: number; width: number; height: number };
type SwipeGesture<TTarget> =
  | { kind: "pending"; path: EventTarget[]; y: number; sumX: number; sumY: number }
  | {
      kind: "tracking";
      direction: HistoryDirection;
      target: TTarget;
      distance: number;
      deltas: number[];
      y: number;
    }
  // Not a swipe, or one already decided: the rest of its events are ignored.
  | { kind: "ignored" };
export type SwipeState<TTarget> = {
  direction: HistoryDirection;
  target: TTarget;
  progress: number;
  y: number;
  tracking: boolean;
};
type TrackpadSwipeHandlers<TTarget> = {
  /** Called when the axis locks. Returning null leaves the swipe to another listener. */
  begin: (direction: HistoryDirection, path: readonly EventTarget[]) => TTarget | null;
  commit: (direction: HistoryDirection, target: TTarget) => void;
};

function readMainContentBounds(): SwipeBounds {
  const main = document.querySelector('[data-slot="sidebar-inset"]');
  if (!main) return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  const { left, top, width, height } = main.getBoundingClientRect();
  return { left, top, width, height };
}

// `event.target` stops at a shadow host; the composed path also reaches scrollers inside it.
function canScrollHorizontally(path: readonly EventTarget[], deltaX: number): boolean {
  for (const element of path) {
    if (!(element instanceof Element) || element.scrollWidth <= element.clientWidth) continue;
    const { overflowX } = getComputedStyle(element);
    if (overflowX !== "auto" && overflowX !== "scroll") continue;
    const canScroll =
      deltaX < 0
        ? element.scrollLeft > 0
        : element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
    if (canScroll) return true;
  }
  return false;
}

export function isOverSidebar(path: readonly EventTarget[]): boolean {
  return path.some((node) => node instanceof Element && node.matches('[data-slot="sidebar"]'));
}

function lockSwipeAxis<TTarget>(
  pending: Extract<SwipeGesture<TTarget>, { kind: "pending" }>,
  begin: TrackpadSwipeHandlers<TTarget>["begin"],
): Exclude<SwipeGesture<TTarget>, { kind: "pending" }> {
  const { path, sumX, sumY } = pending;
  if (Math.abs(sumX) <= Math.abs(sumY)) return { kind: "ignored" };
  if (path.some((node) => node instanceof Element && node.matches('[role="dialog"]'))) {
    return { kind: "ignored" };
  }
  if (canScrollHorizontally(path, sumX)) return { kind: "ignored" };
  const direction = sumX < 0 ? "back" : "forward";
  const target = begin(direction, path);
  if (target === null) return { kind: "ignored" };
  return {
    kind: "tracking",
    direction,
    target,
    distance: Math.abs(sumX),
    deltas: [],
    y: pending.y,
  };
}

/**
 * macOS momentum after the fingers lift decays by a near-constant ratio per
 * event; finger movement is noisier. Deltas are signed along the swipe.
 */
export function isMomentumTail(deltas: readonly number[]): boolean {
  if (deltas.length < MOMENTUM_SAMPLE_SIZE) return false;
  const recent = deltas.slice(-MOMENTUM_SAMPLE_SIZE);
  if (recent.some((delta) => delta <= 0)) return false;
  const ratios = recent.slice(1).map((delta, index) => delta / recent[index]!);
  return (
    ratios.every((ratio) => ratio >= 0.7 && ratio < 1) &&
    Math.max(...ratios) - Math.min(...ratios) < 0.1
  );
}

/** Tracks two-finger horizontal trackpad swipes that `begin` claims. */
export function useTrackpadSwipe<TTarget>(
  handlers: TrackpadSwipeHandlers<TTarget>,
): SwipeState<TTarget> | null {
  const [swipe, setSwipe] = useState<SwipeState<TTarget> | null>(null);
  const begin = useEffectEvent(handlers.begin);
  const commit = useEffectEvent(handlers.commit);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window wheel and desktop gesture listeners track trackpad swipes
  useEffect(() => {
    let gesture: SwipeGesture<TTarget> | null = null;
    const hideIndicator = () =>
      setSwipe((current) => (current === null ? null : { ...current, tracking: false }));
    // The fingers lifted: commit if the swipe went far enough, then ignore its momentum.
    const release = () => {
      if (gesture?.kind === "tracking" && gesture.distance >= SWIPE_TRIGGER_DISTANCE) {
        commit(gesture.direction, gesture.target);
      }
      gesture = { kind: "ignored" };
      hideIndicator();
    };
    // Chromium brackets each trackpad scroll, momentum included, with these.
    const unsubscribeScrollBegin = window.desktopBridge?.onTrackpadScrollBegin(() => {
      if (gesture?.kind === "ignored") gesture = null;
    });
    const unsubscribeScrollEnd = window.desktopBridge?.onTrackpadScrollEnd(() => {
      if (gesture?.kind === "tracking") release();
      gesture = null;
    });
    const onWheel = (event: WheelEvent) => {
      if (gesture === null) {
        gesture =
          event.ctrlKey || event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL
            ? { kind: "ignored" }
            : { kind: "pending", path: event.composedPath(), y: event.clientY, sumX: 0, sumY: 0 };
      }
      if (gesture.kind === "ignored") return;
      if (gesture.kind === "pending") {
        gesture.sumX += event.deltaX;
        gesture.sumY += event.deltaY;
        if (Math.abs(gesture.sumX) + Math.abs(gesture.sumY) < SWIPE_AXIS_LOCK_DISTANCE) return;
        gesture = lockSwipeAxis(
          { ...gesture, path: [...gesture.path, ...event.composedPath()] },
          (direction, path) => begin(direction, path),
        );
        if (gesture.kind === "ignored") return;
      } else {
        const delta = gesture.direction === "back" ? -event.deltaX : event.deltaX;
        if (event.deltaX === 0 && event.deltaY === 0) return release();
        gesture.deltas = [...gesture.deltas.slice(1 - MOMENTUM_SAMPLE_SIZE), delta];
        if (isMomentumTail(gesture.deltas)) return release();
        gesture.distance = Math.max(0, gesture.distance + delta);
      }
      setSwipe({
        direction: gesture.direction,
        target: gesture.target,
        progress: Math.min(1, gesture.distance / SWIPE_TRIGGER_DISTANCE),
        y: gesture.y,
        tracking: true,
      });
    };
    window.addEventListener("wheel", onWheel, { capture: true, passive: true });
    return () => {
      unsubscribeScrollBegin?.();
      unsubscribeScrollEnd?.();
      window.removeEventListener("wheel", onWheel, { capture: true });
    };
  }, []);

  return swipe;
}

/** Two-finger horizontal trackpad swipes go back and forward, like a browser. */
export function HistorySwipeNavigation() {
  const swipe = useTrackpadSwipe({
    begin: (direction, path) =>
      !isOverSidebar(path) && canNavigateHistory(direction) ? readMainContentBounds() : null,
    commit: (direction) => navigateHistory(direction),
  });

  return swipe === null ? null : <SwipeIndicator {...swipe} />;
}

// A circle pinned to the edge of the main content that peeks in up to half its width.
function SwipeIndicator({
  direction,
  target: bounds,
  progress,
  y,
  tracking,
}: SwipeState<SwipeBounds>) {
  const armed = progress >= 1;
  const Icon = direction === "back" ? ArrowLeftIcon : ArrowRightIcon;
  const hidden = 100 - progress * 50;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed z-100 overflow-hidden"
      style={bounds}
    >
      <div
        className={cn(
          "absolute flex size-14 items-center rounded-full bg-muted text-foreground dark:bg-black dark:text-white",
          direction === "back" ? "left-0 justify-end pr-2" : "right-0 justify-start pl-2",
          !tracking && "transition-[opacity,transform] duration-200 ease-out",
        )}
        style={{
          top: `clamp(0px, calc(${y - bounds.top}px - 1.75rem), calc(100% - 3.5rem))`,
          opacity: tracking ? 1 : 0,
          transform: `translateX(${direction === "back" ? -hidden : hidden}%)`,
        }}
      >
        <Icon
          className={cn(
            "size-4 transition-opacity duration-100",
            armed ? "opacity-100" : "opacity-40",
          )}
        />
      </div>
    </div>
  );
}
