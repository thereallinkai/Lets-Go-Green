import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppReleaseCard } from "@/components/app-release-card";

describe("AppReleaseCard", () => {
  it("shows the testing channel and exact application version", () => {
    render(<AppReleaseCard />);

    expect(
      screen.getByRole("heading", { name: "About Let's Go Green!" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Beta 3")).toBeInTheDocument();
    expect(screen.getByText("v1.0.0-beta.3")).toBeInTheDocument();
    expect(screen.getByText(/This is a testing release/)).toBeInTheDocument();
  });
});
