import type { Metadata } from "next";
import Link from "next/link";
import { BrandLink } from "@/components/brand-link";
import { BRAND } from "@/src/lib/brand";

export const metadata: Metadata = { title: "Privacy Notice" };

export default function PrivacyPage() {
  return (
    <main id="main-content" className="legal-page">
      <header>
        <BrandLink />
        <Link className="text-link" href="/register">Back to signup</Link>
      </header>
      <p className="eyebrow">Version 1.3 · August 9, 2026</p>
      <h1>Privacy Notice</h1>
      <p>
        This notice explains the data {BRAND.name} needs for account access, meal
        planning, check-ins, and trend calculations. The product is designed to
        collect only information needed for those features.
      </p>
      <h2>Information you provide</h2>
      <p>
        Account details, including your date of birth, preferences, goals,
        optional safety context, meal check-ins, weight entries, user-entered
        food-label facts, and optional label photos are stored with your
        account. Your confirmed date of birth is used to derive your current
        age and cannot be edited through the app after account creation. Label
        photos are kept in private storage and are not shown to other users.
        Passwords are handled by Supabase Auth and are never stored in{" "}
        {BRAND.name} business tables.
      </p>
      <p>
        Before account creation, the current browser tab may keep a temporary
        registration draft containing your name, gender, date of birth, and
        email so a refresh does not erase the form. Passwords and Terms or
        Privacy acceptance selections are not put in that draft. The draft is
        removed after successful registration and normally ends with the tab
        session.
      </p>
      <p>
        After successful registration, the same browser tab may keep the
        validated email address for up to 15 minutes solely to hand it to the
        verification step. That one-time value is removed when onboarding reads
        it. New registrations do not place the email address in the onboarding
        URL.
      </p>
      <p>
        After verification, the browser may keep an onboarding draft under an
        account-specific storage key so a refresh does not expose one user&apos;s
        weights, preferences, restrictions, or safety context to another account
        on the same browser. The app compares browser and account timestamps when
        restoring progress. Older globally keyed onboarding drafts are removed
        without being restored because they cannot be safely assigned to one
        account. If browser storage is blocked, the app continues with account
        saving and states that the browser copy is unavailable.
      </p>
      <h2>Food sources and reusable product facts</h2>
      <p>
        After you explicitly submit a food-name search, the server may send that
        search term to USDA FoodData Central and Open Food Facts. The app stores
        an imported product&apos;s facts with its source and verification status.
        Open Food Facts product and nutrition-label thumbnails may load from
        that provider&apos;s image host after a search. Merely typing does not send
        an online-provider request.
      </p>
      <p>
        A photographed label first creates a private product for your account.
        If you separately choose to share normalized facts when confirming the
        transcription, the app may add one pending-review catalog record keyed
        by an exact normalized product-and-core-nutrition fingerprint. That
        shared record can include brand, product, variant, package description,
        confirmed nutrition, ingredients, allergens, and restrictions. It does
        not include your account identity, email, free-form source note, or raw
        label photo. If you do not select that sharing option, the photographed
        product remains private to your account.
      </p>
      <p>
        The Beta 3 data migration also removes legacy photo-derived hashes from
        earlier public catalog provenance and replaces them with hashes of
        normalized, non-photo facts. Earlier shared records linked to a Terms
        1.1 acceptance remain pending review; unlinked shared rows are rejected.
        Owner-private foods and private evidence images are preserved.
      </p>
      <h2>Calculated and suggested information</h2>
      <p>
        The app computes conversions, summaries, ranges, and trends. When you
        explicitly generate a plan, a minimized profile snapshot may be sent to
        the configured AI provider. That snapshot can include the app-derived
        age, but not the raw date of birth. The review screen shows what will be
        shared. Hidden model reasoning is not stored.
      </p>
      <h2>Development mode</h2>
      <p>
        Local development uses local Supabase, captured local email, seeded test
        accounts, and a deterministic mock AI provider. It does not send data to
        OpenAI unless a developer supplies credentials and explicitly enables real
        AI mode.
      </p>
      <h2>Control and retention</h2>
      <p>
        Settings provides an account-data export. Account deletion is visibly
        unavailable in this development build and the interface does not claim
        otherwise. A production operator must implement deletion and publish
        completed contact, retention, subprocessors, and jurisdiction details
        before a public launch.
      </p>
      <h2>Location and external maps</h2>
      <p>
        Device time-zone detection uses browser-provided time-zone settings and
        does not require precise location permission. The detected time zone is
        used to keep date-of-birth validation and current-age calculations on
        the same local calendar date. Nearby-shopping shortcuts open Google Maps
        in a new tab. {BRAND.name} does not receive the location or search
        results from that external page and does not verify inventory.
      </p>
      <h2>Appearance preference</h2>
      <p>
        System appearance follows the light or dark preference reported by your
        device or browser. If you choose an explicit Light or Dark override, the
        browser stores that choice locally so it survives reloads; the override
        is not needed for account access or meal planning.
      </p>
    </main>
  );
}
