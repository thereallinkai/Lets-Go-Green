import type { Metadata } from "next";
import { OnboardingFlow } from "@/components/onboarding-flow";
import { isDevelopmentDemo } from "@/src/lib/env";
import { normalizeOnboardingStep } from "@/src/lib/onboarding-routing";
import { getCurrentUser } from "@/src/lib/supabase/server";

export const metadata: Metadata = { title: "Set up your plan" };

async function resolveDraftOwnerKey() {
  if (isDevelopmentDemo()) return "demo";
  try {
    return (await getCurrentUser())?.id ?? null;
  } catch {
    return null;
  }
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; email?: string }>;
}) {
  const params = await searchParams;
  const draftOwnerKey = await resolveDraftOwnerKey();
  return (
    <OnboardingFlow
      initialStep={normalizeOnboardingStep(params.step)}
      email={params.email ?? ""}
      draftOwnerKey={draftOwnerKey}
    />
  );
}
