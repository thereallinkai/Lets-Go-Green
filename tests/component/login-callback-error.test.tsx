import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

import LoginPage from "../../app/login/page";

describe("login callback feedback", () => {
  it("renders the callback's safe concrete reason and next step", async () => {
    render(
      await LoginPage({
        searchParams: Promise.resolve({
          authError: "RECOVERY_LINK_INVALID_OR_EXPIRED",
        }),
      }),
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      "This password-reset link is invalid or has expired.",
    );
    expect(alert).toHaveTextContent(
      "Error code: RECOVERY_LINK_INVALID_OR_EXPIRED",
    );
    expect(
      screen.getByRole("link", { name: "Request another reset link" }),
    ).toHaveAttribute("href", "/forgot-password");
  });

  it("ignores arbitrary callback error text from the URL", async () => {
    render(
      await LoginPage({
        searchParams: Promise.resolve({
          authError: "Render this attacker-controlled message",
        }),
      }),
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Render this attacker-controlled message"),
    ).not.toBeInTheDocument();
  });
});
