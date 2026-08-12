import type { PropsWithChildren } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ProgressView } from "../../components/progress-view";
import { localDateInTimeZone } from "../../src/lib/domain/dates";

vi.mock("recharts", () => {
  const Container = ({ children }: PropsWithChildren) => <div>{children}</div>;
  const LineChart = ({
    children,
    data,
  }: PropsWithChildren<{ data?: unknown[] }>) => (
    <div data-chart={JSON.stringify(data ?? [])} data-testid="line-chart">
      {children}
    </div>
  );
  const Line = ({ dataKey }: { dataKey: string }) => (
    <div data-testid={`line-${dataKey}`} />
  );
  const Empty = () => null;
  return {
    ResponsiveContainer: Container,
    LineChart,
    CartesianGrid: Empty,
    Line,
    ReferenceLine: Empty,
    Tooltip: Empty,
    XAxis: Empty,
    YAxis: Empty,
  };
});

const rangedEntries = [
  { id: "latest", date: "Jul 24", isoDate: "2026-07-24", kg: 80 },
  { id: "four-week", date: "Jul 1", isoDate: "2026-07-01", kg: 81 },
  { id: "twelve-week", date: "Jun 1", isoDate: "2026-06-01", kg: 82 },
  { id: "all-time", date: "Mar 1", isoDate: "2026-03-01", kg: 83 },
];

describe("ProgressView weight entry", () => {
  it("shows the converted value and synchronizes the input when units change", async () => {
    const user = userEvent.setup();
    render(<ProgressView />);
    const weight = screen.getByRole("textbox", { name: "Weight" });
    const unit = screen.getByRole("combobox", { name: "Unit" });

    await user.type(weight, "80");
    expect(screen.getByText("Equivalent: 176.4 lb")).toBeInTheDocument();

    await user.selectOptions(unit, "lb");
    expect(weight).toHaveValue("176.4");
    expect(screen.getByText("Equivalent: 80.0 kg")).toBeInTheDocument();
  });

  it("rejects non-positive input before making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ProgressView />);

    await user.type(screen.getByRole("textbox", { name: "Weight" }), "0");
    await user.click(screen.getByRole("button", { name: "Save entry" }));

    expect(
      screen.getByRole("status", {
        name: "",
      }),
    ).toHaveTextContent("Enter a valid weight greater than zero.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("saves the source value and unit, then clears the form", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const expectedLocalDate = localDateInTimeZone(
      new Date(),
      "America/New_York",
    );
    render(<ProgressView />);

    const weight = screen.getByRole("textbox", { name: "Weight" });
    await user.type(weight, "79.5");
    await user.click(screen.getByRole("button", { name: "Save entry" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Saved 79.5 kg."),
    );
    expect(weight).toHaveValue("");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/weights",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          localDate: expectedLocalDate,
          weight: 79.5,
          unit: "kg",
        }),
      }),
    );
  });

  it("restores the previous history when persistence fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    const user = userEvent.setup();
    render(<ProgressView />);

    await user.type(screen.getByRole("textbox", { name: "Weight" }), "79.5");
    await user.click(screen.getByRole("button", { name: "Save entry" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "The entry could not be saved. Your previous history was restored.",
      ),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Error code: WEIGHT_SAVE_UNAVAILABLE",
    );
    expect(
      screen.getAllByText("80.7 kg", { selector: ".history-row strong" }),
    ).toHaveLength(1);
  });
});

describe("ProgressView history and trends", () => {
  it("explains and removes edit/delete controls for the protected baseline", () => {
    const today = localDateInTimeZone(new Date(), "America/New_York");
    const date = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${today}T12:00:00Z`));

    render(
      <ProgressView
        initialEntries={[
          {
            id: "baseline-entry",
            date,
            isoDate: today,
            kg: 80,
            isBaseline: true,
          },
        ]}
      />,
    );

    expect(screen.getByText("Starting point · protected")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: `Edit weight for ${date}` }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: `Delete weight for ${date}` }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save entry" })).toBeDisabled();
    expect(
      screen.getByText(/Today.*protected onboarding starting weight/),
    ).toBeInTheDocument();
  });

  it("requires confirmation before deleting an entry", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ProgressView />);

    await user.click(
      screen.getByRole("button", { name: "Delete weight for Jul 24" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Delete weight entry?",
    });
    expect(dialog).toHaveTextContent(
      "Delete the Jul 24 entry of 80.7 kg? This cannot be undone.",
    );
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Keep entry" }));
    expect(
      screen.queryByRole("dialog", { name: "Delete weight entry?" }),
    ).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Delete weight for Jul 24" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete entry" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Removed the Jul 24 entry.",
      ),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/weights/00000000-0000-4000-8000-000000000101",
      { method: "DELETE" },
    );
  });

  it("restores a confirmed deletion when persistence fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    const user = userEvent.setup();
    render(<ProgressView />);

    await user.click(
      screen.getByRole("button", { name: "Delete weight for Jul 24" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete entry" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "The entry could not be removed. Your previous history was restored.",
      ),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Error code: WEIGHT_DELETE_UNAVAILABLE",
    );
    expect(
      screen.getByRole("button", { name: "Delete weight for Jul 24" }),
    ).toBeInTheDocument();
  });

  it("filters both chart and history with honest range controls", async () => {
    const user = userEvent.setup();
    render(<ProgressView initialEntries={rangedEntries} />);

    expect(
      screen.getByRole("button", { name: "4 weeks" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Jul 1")).toBeInTheDocument();
    expect(screen.queryByText("Jun 1")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: /2 weight readings.*4 weeks/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "12 weeks" }));
    expect(screen.getByText("Jun 1")).toBeInTheDocument();
    expect(screen.queryByText("Mar 1")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: /3 weight readings.*12 weeks/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("Mar 1")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /4 weight readings.*All/ })).toBeInTheDocument();
  });

  it("keeps missing dates null and shows the exact insufficient-data copy", () => {
    render(<ProgressView />);

    expect(
      screen.getByText("Not enough data for a seven-day trend.", {
        exact: true,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("line-rollingAverage")).not.toBeInTheDocument();
    const chartData = JSON.parse(
      screen.getByTestId("line-chart").getAttribute("data-chart") ?? "[]",
    ) as Array<{ isoDate: string; weight: number | null }>;
    expect(chartData).toContainEqual(
      expect.objectContaining({ isoDate: "2026-07-20", weight: null }),
    );
    expect(chartData.every((point) => point.weight !== 0)).toBe(true);
  });

  it("shows a rolling-average line only after seven consecutive dated readings", () => {
    const completeEntries = Array.from({ length: 7 }, (_, index) => ({
      id: `entry-${index}`,
      date: `Jul ${18 + index}`,
      isoDate: `2026-07-${String(18 + index).padStart(2, "0")}`,
      kg: 70 + index,
    }));
    render(<ProgressView initialEntries={completeEntries} />);

    expect(screen.getByTestId("line-rollingAverage")).toBeInTheDocument();
    expect(
      screen.queryByText("Not enough data for a seven-day trend."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("The latest seven-day average is 73.0 kg."),
    ).toBeInTheDocument();
  });
});
