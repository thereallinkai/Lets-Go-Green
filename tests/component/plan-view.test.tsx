import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PlanView } from "../../components/plan-view";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("PlanView generation", () => {
  it("preserves the accepted plan while generation is pending and after failure", async () => {
    const request = deferred<{ ok: boolean }>();
    const fetchMock = vi.fn((..._arguments: Parameters<typeof fetch>) => {
      void _arguments;
      return request.promise;
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<PlanView />);

    expect(screen.getByText("Plan version 2 · Accepted July 20")).toBeInTheDocument();
    expect(screen.getByText("Rolled oats")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Generate new draft" }),
    );
    expect(
      screen.getByRole("button", { name: "Generating draft…" }),
    ).toBeDisabled();
    expect(screen.getByText("Plan version 2 · Accepted July 20")).toBeInTheDocument();
    expect(screen.getByText("Rolled oats")).toBeInTheDocument();

    request.resolve({ ok: false });
    await waitFor(() =>
      expect(
        screen.getByText(
          "Plan generation could not finish. Your accepted plan is unchanged.",
          { selector: "[aria-live]" },
        ),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Generate new draft" }),
    ).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Error code: PLAN_GENERATION_UNAVAILABLE",
    );
    expect(screen.getByText("Plan version 2 · Accepted July 20")).toBeInTheDocument();
    expect(screen.getByText("Rolled oats")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Accept this version" }),
    ).not.toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("treats a successful response without a plan identifier as a failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: { planId: null } }),
      })),
    );
    const user = userEvent.setup();
    render(<PlanView />);

    await user.click(
      screen.getByRole("button", { name: "Generate new draft" }),
    );
    await waitFor(() =>
      expect(
        screen.getByText(
          "Plan generation could not finish. Your accepted plan is unchanged.",
          { selector: "[aria-live]" },
        ),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "Accept this version" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Error code: PLAN_RESPONSE_INVALID",
    );
    expect(screen.getByText("Rolled oats")).toBeInTheDocument();
  });

  it("reloads the persisted draft instead of relabeling accepted props", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: { planId: "persisted-plan-v3" } }),
      })),
    );
    const user = userEvent.setup();
    render(<PlanView initialPlanId="persisted-plan-v2" serverBacked />);

    await user.click(
      screen.getByRole("button", { name: "Generate new draft" }),
    );

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/plan"));
    expect(router.refresh).toHaveBeenCalledOnce();
    expect(screen.getByText("Plan version 2 · Accepted July 20")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Accept this version" }),
    ).not.toBeInTheDocument();
  });

  it("links history to a server-selected version and can re-accept it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: { planId: "persisted-plan-v1", status: "accepted" },
        }),
      })),
    );
    const user = userEvent.setup();
    const history = [
      {
        id: "persisted-plan-v2",
        version: 2,
        status: "Accepted",
        date: "July 20",
        reviewable: true,
      },
      {
        id: "persisted-plan-v1",
        version: 1,
        status: "Superseded",
        date: "July 13",
        reviewable: true,
      },
    ];
    const { unmount } = render(
      <PlanView
        history={history}
        initialPlanId="persisted-plan-v2"
        serverBacked
      />,
    );

    await user.click(screen.getByRole("button", { name: "Version history" }));
    expect(
      screen.getByRole("link", { name: "Review plan version 1" }),
    ).toHaveAttribute("href", "/plan?version=1");

    unmount();
    render(
      <PlanView
        acceptedVersion={2}
        history={history}
        initialPlanId="persisted-plan-v1"
        initialStatus="historical"
        serverBacked
        version={1}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Accept this prior version" }),
    );

    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith("/plan?view=accepted"),
    );
    expect(router.refresh).toHaveBeenCalledOnce();
  });
});
