import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";
import { HistorySwipeNavigation } from "./HistorySwipeNavigation";
import { SidebarProjectSwipe } from "./sidebar/SidebarProjectSwipe";

const navigateHistory = vi.hoisted(() => vi.fn());
vi.mock("../navigationHistory", () => ({ canNavigateHistory: () => true, navigateHistory }));

function swipe(target: Element, deltaX: number) {
  for (const delta of [deltaX, 0]) {
    target.dispatchEvent(new WheelEvent("wheel", { deltaX: delta, bubbles: true, composed: true }));
  }
}

function viewportOffset(viewport: HTMLElement) {
  return new DOMMatrix(getComputedStyle(viewport).transform).m41;
}

describe("HistorySwipeNavigation", () => {
  it.each([
    ["scrolling left inside a shadow-root scroller keeps the thread", "shadow", 100, -130, false],
    ["scrolling right inside a shadow-root scroller keeps the thread", "shadow", 100, 130, false],
    [
      "scrolling after a shadow scroller remount keeps the thread",
      "shadow-remount",
      100,
      130,
      false,
    ],
    ["scrolling left inside a scroller keeps the thread", "light", 100, -130, false],
    ["swiping back at a shadow-root scroller's left edge navigates", "shadow", 0, -130, true],
    ["swiping back over a panel without overflow navigates", "none", 0, -130, true],
    ["a swipe that started in a closed dialog keeps the thread", "closed-dialog", 0, -130, false],
  ] as const)("%s", async (_name, scroller, scrollLeft, deltaX, navigates) => {
    navigateHistory.mockReset();
    await using screen = await render(<HistorySwipeNavigation />);
    const panel = screen.container.appendChild(document.createElement("div"));
    const root = scroller.startsWith("shadow") ? panel.attachShadow({ mode: "open" }) : panel;
    const viewport = root.appendChild(document.createElement("div"));
    const noOverflow = scroller === "none" || scroller === "closed-dialog";
    viewport.style.cssText = `width: 200px; overflow-x: ${noOverflow ? "visible" : "auto"}`;
    const content = viewport.appendChild(document.createElement("div"));
    content.style.cssText = `height: 20px; width: ${noOverflow ? 100 : 1000}px`;
    viewport.scrollLeft = scrollLeft;

    if (scroller === "closed-dialog") {
      panel.setAttribute("role", "dialog");
      content.dispatchEvent(new WheelEvent("wheel", { deltaX: -1, bubbles: true, composed: true }));
      panel.remove();
      screen.container.appendChild(viewport);
    }

    if (scroller === "shadow-remount") {
      content.dispatchEvent(new WheelEvent("wheel", { deltaX: 1, bubbles: true, composed: true }));
      const replacement = viewport.cloneNode(true) as HTMLDivElement;
      viewport.replaceWith(replacement);
      replacement.scrollLeft = scrollLeft;
      swipe(replacement, deltaX);
    } else {
      swipe(content, deltaX);
    }

    expect(navigateHistory).toHaveBeenCalledTimes(navigates ? 1 : 0);
  });

  it.each([
    ["a swipe over the sidebar changes the project", "sidebar", 130, [["alpha"]], 0],
    ["a short swipe over the sidebar changes nothing", "sidebar", 60, [], 0],
    ["a swipe outside the sidebar navigates", "main", 130, [], 1],
  ] as const)("%s", async (_name, zone, deltaX, selections, navigations) => {
    navigateHistory.mockReset();
    const onSelect = vi.fn();
    await using screen = await render(
      <>
        <div data-slot="sidebar" data-testid="sidebar">
          <SidebarProjectSwipe
            groups={[{ projectKey: "alpha", displayName: "Alpha", pinned: true }]}
            scopeKeys={[]}
            onSelect={onSelect}
            contentRef={{ current: null }}
          />
        </div>
        <div data-testid="main" />
        <HistorySwipeNavigation />
      </>,
    );

    swipe(screen.getByTestId(zone).element(), deltaX);

    expect(onSelect.mock.calls.map(([keys]) => keys)).toEqual(selections);
    expect(navigateHistory).toHaveBeenCalledTimes(navigations);
  });

  it("names the destination project during the swipe", async () => {
    await using screen = await render(
      <div data-slot="sidebar" data-testid="sidebar">
        <SidebarProjectSwipe
          groups={[{ projectKey: "alpha", displayName: "Alpha", pinned: true }]}
          scopeKeys={[]}
          onSelect={vi.fn()}
          contentRef={{ current: null }}
        />
      </div>,
    );

    screen
      .getByTestId("sidebar")
      .element()
      .dispatchEvent(new WheelEvent("wheel", { deltaX: 60, bubbles: true, composed: true }));

    await expect.element(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it.each([
    ["forward", 130, -130, -200],
    ["back", -130, 130, 200],
  ] as const)(
    "a %s swipe slides the list out and swaps it off screen",
    async (_direction, deltaX, tracked, offScreen) => {
      const content = document.createElement("div");
      const swappedAt: number[] = [];
      await using screen = await render(
        <div data-slot="sidebar">
          <div data-slot="scroll-area-viewport" data-testid="viewport" style={{ width: 200 }}>
            <div ref={(node) => node?.append(content)} />
          </div>
          <SidebarProjectSwipe
            groups={[{ projectKey: "alpha", displayName: "Alpha", pinned: true }]}
            scopeKeys={[]}
            onSelect={() => swappedAt.push(viewportOffset(viewport))}
            contentRef={{ current: content }}
          />
        </div>,
      );
      const viewport = screen.getByTestId("viewport").element() as HTMLElement;

      viewport.dispatchEvent(new WheelEvent("wheel", { deltaX, bubbles: true, composed: true }));
      expect(viewport.style.transform).toBe(`translateX(${tracked}px)`);
      viewport.dispatchEvent(new WheelEvent("wheel", { deltaX: 0, bubbles: true, composed: true }));

      await vi.waitFor(() => expect(swappedAt).toEqual([offScreen]));
      await vi.waitFor(() => expect(viewport.getAnimations()).toEqual([]));
      expect(viewportOffset(viewport)).toBe(0);
    },
  );

  it("a short swipe returns the list without changing the project", async () => {
    const content = document.createElement("div");
    const onSelect = vi.fn();
    await using screen = await render(
      <div data-slot="sidebar">
        <div data-slot="scroll-area-viewport" data-testid="viewport" style={{ width: 200 }}>
          <div ref={(node) => node?.append(content)} />
        </div>
        <SidebarProjectSwipe
          groups={[{ projectKey: "alpha", displayName: "Alpha", pinned: true }]}
          scopeKeys={[]}
          onSelect={onSelect}
          contentRef={{ current: content }}
        />
      </div>,
    );
    const viewport = screen.getByTestId("viewport").element() as HTMLElement;

    swipe(viewport, 60);

    await vi.waitFor(() => expect(viewport.getAnimations()).toEqual([]));
    expect(viewportOffset(viewport)).toBe(0);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
