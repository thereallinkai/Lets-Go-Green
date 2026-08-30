import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("PlanView generation", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

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

  it("reuses the idempotency key after a lost response", async () => {
    const requestBodies: Array<{ idempotencyKey: string }> = [];
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBodies.push(JSON.parse(String(init?.body)));
        if (requestBodies.length === 1) {
          throw new TypeError("response was lost after request acceptance");
        }
        return jsonResponse({
          data: { planId: "persisted-plan-v3", status: "succeeded" },
          error: null,
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<PlanView />);

    await user.click(
      screen.getByRole("button", { name: "Generate new draft" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "PLAN_GENERATION_UNAVAILABLE",
    );

    await user.click(
      screen.getByRole("button", { name: "Generate new draft" }),
    );
    expect(
      await screen.findByRole("button", { name: "Accept this version" }),
    ).toBeInTheDocument();

    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[1]?.idempotencyKey).toBe(
      requestBodies[0]?.idempotencyKey,
    );
  });

  it("recovers an ambiguous generation key after the view remounts", async () => {
    const requestBodies: Array<{ idempotencyKey: string }> = [];
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBodies.push(JSON.parse(String(init?.body)));
        if (requestBodies.length === 1) {
          throw new TypeError("response was lost after request acceptance");
        }
        return jsonResponse({
          data: { planId: "persisted-plan-v3", status: "succeeded" },
          error: null,
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const firstView = render(<PlanView />);

    await user.click(
      screen.getByRole("button", { name: "Generate new draft" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "PLAN_GENERATION_UNAVAILABLE",
    );
    firstView.unmount();

    render(<PlanView />);
    await user.click(
      screen.getByRole("button", { name: "Generate new draft" }),
    );
    expect(
      await screen.findByRole("button", { name: "Accept this version" }),
    ).toBeInTheDocument();

    expect(requestBodies[1]?.idempotencyKey).toBe(
      requestBodies[0]?.idempotencyKey,
    );
    expect(
      window.sessionStorage.getItem(
        "lets-go-green-plan-generation-idempotency-key",
      ),
    ).toBeNull();
  });

  it("rechecks a pending generation with the same idempotency key", async () => {
    const requestBodies: Array<{ idempotencyKey: string }> = [];
    const responses = [
      jsonResponse(
        {
          data: {
            requestId: "request-1",
            planId: null,
            status: "processing",
            replayed: true,
          },
          error: null,
        },
        202,
      ),
      jsonResponse({
        data: {
          requestId: "request-1",
          planId: "persisted-plan-v3",
          status: "succeeded",
          replayed: true,
        },
        error: null,
      }),
    ];
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBodies.push(JSON.parse(String(init?.body)));
        return responses.shift()!;
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<PlanView />);

    await user.click(
      screen.getByRole("button", { name: "Generate new draft" }),
    );
    expect(
      await screen.findByText(
        "Plan generation is still processing. Wait a moment, then choose Generate new draft again to check the same request.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Generate new draft" }),
    ).toBeEnabled();

    await user.click(
      screen.getByRole("button", { name: "Generate new draft" }),
    );
    expect(
      await screen.findByRole("button", { name: "Accept this version" }),
    ).toBeInTheDocument();

    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[1]?.idempotencyKey).toBe(
      requestBodies[0]?.idempotencyKey,
    );
  });

  it("rotates the idempotency key only after an explicit terminal failure", async () => {
    const requestBodies: Array<{ idempotencyKey: string }> = [];
    const responses = [
      jsonResponse(
        {
          data: null,
          error: {
            code: "PLAN_REQUEST_FAILED",
            message:
              "That plan request did not finish. Start a new generation request.",
          },
        },
        409,
      ),
      jsonResponse({
        data: { planId: "persisted-plan-v3", status: "succeeded" },
        error: null,
      }),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBodies.push(JSON.parse(String(init?.body)));
        return responses.shift()!;
      }),
    );
    const user = userEvent.setup();
    render(<PlanView />);

    await user.click(
      screen.getByRole("button", { name: "Generate new draft" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "PLAN_REQUEST_FAILED",
    );
    await user.click(
      screen.getByRole("button", { name: "Generate new draft" }),
    );
    expect(
      await screen.findByRole("button", { name: "Accept this version" }),
    ).toBeInTheDocument();

    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[1]?.idempotencyKey).not.toBe(
      requestBodies[0]?.idempotencyKey,
    );
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
