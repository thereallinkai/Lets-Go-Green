import { beforeEach, describe, expect, it, vi } from "vitest";

const pageState = vi.hoisted(() => ({
  developmentDemo: false,
  user: { id: "user-1" } as { id: string } | null,
  userError: null as Error | null,
}));

vi.mock("@/src/lib/env", () => ({
  isDevelopmentDemo: () => pageState.developmentDemo,
}));

vi.mock("@/src/lib/supabase/server", () => ({
  getCurrentUser: async () => {
    if (pageState.userError) throw pageState.userError;
    return pageState.user;
  },
}));

vi.mock("@/components/onboarding-flow", () => ({
  OnboardingFlow: () => null,
}));

import OnboardingPage from "../../app/onboarding/page";

type OnboardingPageProps = {
  draftOwnerKey: string | null;
  email: string;
  initialStep: number;
};

async function resolvedProps(step?: string) {
  const element = await OnboardingPage({
    searchParams: Promise.resolve({ step, email: "person@example.test" }),
  });
  return element.props as OnboardingPageProps;
}

describe("onboarding page routing and draft scope", () => {
  beforeEach(() => {
    pageState.developmentDemo = false;
    pageState.user = { id: "user-1" };
    pageState.userError = null;
  });

  it("passes the authenticated user scope without putting it in the URL", async () => {
    await expect(resolvedProps("5")).resolves.toMatchObject({
      initialStep: 5,
      email: "person@example.test",
      draftOwnerKey: "user-1",
    });
  });

  it("uses the isolated demo scope in local demo mode", async () => {
    pageState.developmentDemo = true;

    await expect(resolvedProps("3")).resolves.toMatchObject({
      initialStep: 3,
      draftOwnerKey: "demo",
    });
  });

  it.each([
    ["no authenticated user", null, null],
    ["an auth lookup failure", { id: "user-1" }, new Error("private")],
  ])("uses no browser draft scope for %s", async (_case, user, userError) => {
    pageState.user = user;
    pageState.userError = userError;

    await expect(resolvedProps("4")).resolves.toMatchObject({
      initialStep: 4,
      draftOwnerKey: null,
    });
  });

  it("never passes a malformed URL step to the client flow", async () => {
    await expect(resolvedProps("4.5")).resolves.toMatchObject({
      initialStep: 2,
      draftOwnerKey: "user-1",
    });
  });
});
