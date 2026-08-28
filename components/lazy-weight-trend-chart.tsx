"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { WeightTrendChartProps } from "@/components/weight-trend-chart";

const WeightTrendChart = dynamic<WeightTrendChartProps>(
  () =>
    import("@/components/weight-trend-chart").then(
      (module) => module.WeightTrendChart,
    ),
  {
    loading: () => (
      <div className="chart-loading-placeholder" aria-hidden="true" />
    ),
    ssr: false,
  },
);

export function LazyWeightTrendChart(props: WeightTrendChartProps) {
  const [shouldLoad, setShouldLoad] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: "300px 0px" },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="lazy-chart-container" ref={containerRef}>
      {shouldLoad ? (
        <WeightTrendChart {...props} />
      ) : (
        <div className="chart-loading-placeholder" aria-hidden="true" />
      )}
    </div>
  );
}
