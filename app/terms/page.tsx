import type { Metadata } from "next";
import Link from "next/link";
import { BrandLink } from "@/components/brand-link";
import { BRAND } from "@/src/lib/brand";

export const metadata: Metadata = { title: "Terms of Use" };

export default function TermsPage() {
  return (
    <main id="main-content" className="legal-page">
      <header>
        <BrandLink />
        <Link className="text-link" href="/register">Back to signup</Link>
      </header>
      <p className="eyebrow">Version 1.2 · August 9, 2026</p>
      <h1>Terms of Use</h1>
      <p>
        {BRAND.name} offers general wellness information, meal-planning tools,
        and habit tracking. It is not a medical service and does not diagnose,
        treat, or guarantee health or weight outcomes.
      </p>
      <h2>Use of the service</h2>
      <p>
        You are responsible for providing accurate information, protecting your
        account, and deciding whether suggestions fit your circumstances. Do not
        use the service in an emergency. If you have concerning symptoms or a
        medical, pregnancy, nursing, or eating-disorder context, seek appropriate
        professional guidance.
      </p>
      <h2>Plans and estimates</h2>
      <p>
        Nutrition totals, projections, and plan suggestions are estimates.
        Sources and verification status are shown where available. AI-generated
        suggestions may be incomplete or incorrect and are reviewed by
        deterministic application rules before they can become an accepted plan.
      </p>
      <h2>Your content and account</h2>
      <p>
        You retain responsibility for information you enter and for accurately
        transcribing a package label. A confirmed transcription creates a
        private product for your account. Only when you separately select the
        sharing option may the app create a non-personal, normalized
        product-facts record for the pending-review shared catalog. Raw label
        photos, account identifiers, and free-form notes remain private.
        You may export your account data through Settings. Account deletion must
        be implemented before a public production launch. Legal and security
        records may be retained when required to protect users or comply with law.
      </p>
      <h2>Changes</h2>
      <p>
        Material changes will use a new document version and require a fresh
        acceptance when appropriate. Contact information and jurisdiction-specific
        terms must be completed before a public production launch.
      </p>
    </main>
  );
}
