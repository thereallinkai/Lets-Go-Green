import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/weight-trend-chart", () => ({
  WeightTrendChart: () => <div data-testid="loaded-weight-chart" />,
}));

import { LazyWeightTrendChart } from "../../components/lazy-weight-trend-chart";

describe("LazyWeightTrendChart", () => {
  it("defers the chart bundle until the chart is near the viewport", async () => {
    let callback: IntersectionObserverCallback | null = null;
    let observed: Element | null = null;
    const observer = {
      disconnect: vi.fn(),
      observe: vi.fn((target: Element) => {
        observed = target;
      }),
      root: null,
      rootMargin: "300px 0px",
      takeRecords: () => [],
      thresholds: [0],
      unobserve: vi.fn(),
    } satisfies IntersectionObserver;

    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(nextCallback: IntersectionObserverCallback) {
          callback = nextCallback;
        }

        disconnect = observer.disconnect;
        observe = observer.observe;
        root = observer.root;
        rootMargin = observer.rootMargin;
        takeRecords = observer.takeRecords;
        thresholds = observer.thresholds;
        unobserve = observer.unobserve;
      },
    );

    const { container } = render(
      <LazyWeightTrendChart
        data={[{ day: "Thu", weight: 80 }]}
        kind="today"
      />,
    );

    expect(container.querySelector(".chart-loading-placeholder")).not.toBeNull();
    expect(screen.queryByTestId("loaded-weight-chart")).not.toBeInTheDocument();
    expect(observed).not.toBeNull();

    act(() => {
      callback?.(
        [
          {
            isIntersecting: true,
            target: observed,
          } as IntersectionObserverEntry,
        ],
        observer,
      );
    });

    expect(await screen.findByTestId("loaded-weight-chart")).toBeInTheDocument();
    expect(observer.disconnect).toHaveBeenCalled();
  });
});
