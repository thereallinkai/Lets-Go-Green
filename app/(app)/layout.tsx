import { redirect } from "next/navigation";
import {
  MobileHeader,
  MobileNavigation,
  Sidebar,
} from "@/components/app-navigation";
import { ProductTour } from "@/components/product-tour";
import { isDevelopmentDemo } from "@/src/lib/env";
import { CURRENT_PRODUCT_TOUR_VERSION } from "@/src/lib/product-tour";
import {
  getCurrentProfile,
  getCurrentUser,
} from "@/src/lib/supabase/server";

export const dynamic = "force-dynamic";

type AppShellProfile = {
  full_name: string;
  onboarding_status: "not_started" | "in_progress" | "completed";
  product_tour_completed_version: number;
};

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const demo = isDevelopmentDemo();
  if (!user && !demo) redirect("/login");

  let storedProfile: AppShellProfile | null = null;
  if (user) {
    const { data } = await getCurrentProfile(user.id);
    storedProfile = data;
  }

  const name = String(
    storedProfile?.full_name
      ?? user?.user_metadata?.full_name
      ?? (demo ? "Jamie Rivera" : "Member"),
  );
  const email = user?.email ?? "demo@letsgogreen.local";
  const showProductTour =
    !demo
    && storedProfile?.onboarding_status === "completed"
    && (storedProfile.product_tour_completed_version ?? 0)
      < CURRENT_PRODUCT_TOUR_VERSION;

  return (
    <div className="app-shell">
      <Sidebar name={name} email={email} />
      <MobileHeader name={name} />
      <main id="main-content" className="app-main">{children}</main>
      <MobileNavigation />
      <ProductTour initialOpen={showProductTour} />
    </div>
  );
}
