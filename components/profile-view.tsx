"use client";

import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  CalendarDays,
  MapPin,
  PlayCircle,
  Settings,
  ShieldCheck,
  Store,
  UserRound,
  Utensils,
} from "lucide-react";
import {
  PRODUCT_TOUR_OPEN_EVENT,
  PRODUCT_TOUR_REPLAY_HASH,
  PRODUCT_TOUR_REPLAY_REQUEST_KEY,
} from "@/src/lib/product-tour";
import { parseLocalDate } from "@/src/lib/domain/dates";
import { convertWeight } from "@/src/lib/domain/units";

type ProfileViewData = {
  mode: "authenticated" | "demo";
  account: {
    email: string;
    createdAt: string | null;
  };
  profile: {
    fullName: string;
    dateOfBirth: string | null;
    age: number | null;
    gender:
      | "male"
      | "female"
      | "another_identity"
      | "prefer_not_to_say"
      | null;
    heightCm: number | null;
    preferredWeightUnit: "kg" | "lb";
    timeZone: string;
    activityLevel:
      | "sedentary"
      | "lightly_active"
      | "moderately_active"
      | "very_active"
      | "extremely_active"
      | null;
    trainingDaysPerWeek: number | null;
    allergies: string[];
    dietaryRestrictions: string[];
    dislikedFoods: string[];
    hasSafetyContext: boolean;
    onboardingCompletedAt: string | null;
  };
  goal: {
    goalType:
      | "fat_loss"
      | "muscle_gain"
      | "maintenance"
      | "body_recomposition";
    targetWeightKg: number;
    targetDate: string;
  } | null;
  latestWeightKg: number | null;
  mealPreferenceCount: number;
  preferredFoods: string[];
};

const genderLabels = {
  male: "Male",
  female: "Female",
  another_identity: "Another identity",
  prefer_not_to_say: "Prefer not to say",
} as const;

const activityLabels = {
  sedentary: "Mostly seated",
  lightly_active: "Lightly active",
  moderately_active: "Moderately active",
  very_active: "Highly active",
  extremely_active: "Very highly active",
} as const;

const goalLabels = {
  fat_loss: "Fat loss",
  muscle_gain: "Muscle gain",
  maintenance: "Maintenance",
  body_recomposition: "Body recomposition",
} as const;

const shoppingSearches = [
  {
    label: "Grocery stores",
    detail: "General food shopping",
    query: "grocery stores",
  },
  {
    label: "Farmers markets",
    detail: "Produce and local foods",
    query: "farmers markets",
  },
  {
    label: "Nutrition stores",
    detail: "Packaged nutrition products",
    query: "nutrition stores",
  },
] as const;

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "LG"
  );
}

function displayDate(value: string | null) {
  if (!value) return "Not available";
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function displayDateOfBirth(value: string | null) {
  if (!value) return "Not provided";
  try {
    const { year, month, day } = parseLocalDate(value);
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(year, month - 1, day)));
  } catch {
    return "Not available";
  }
}

function displayWeight(
  weightKg: number | null,
  unit: ProfileViewData["profile"]["preferredWeightUnit"],
) {
  if (weightKg === null) return "Not available";
  const value = convertWeight(weightKg, "kg", unit);
  return `${value.toFixed(1)} ${unit}`;
}

function mapsUrl(query: string) {
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", query);
  return url.toString();
}

function ListValue({
  items,
  empty,
}: {
  items: string[];
  empty: string;
}) {
  if (!items.length) return <span className="profile-empty">{empty}</span>;
  return (
    <div className="profile-tags">
      {items.map((item) => (
        <span key={item}>{item}</span>
      ))}
    </div>
  );
}

export function ProfileView({ data }: { data: ProfileViewData }) {
  const { account, profile, goal } = data;
  const preferredFoodSearches = data.preferredFoods.slice(0, 5).map((food) => ({
    label: food,
    detail: "Search nearby sellers",
    query: `${food} near me`,
  }));
  const nearbySearches = [...preferredFoodSearches, ...shoppingSearches];

  return (
    <div className="page-frame profile-page">
      <header className="profile-hero">
        <span className="profile-avatar-large" aria-hidden="true">
          {initials(profile.fullName)}
        </span>
        <div>
          <span className="date-label">
            {data.mode === "demo" ? "Demo profile" : "Your profile"}
          </span>
          <h1>{profile.fullName}</h1>
          <p>{account.email}</p>
          <small>
            Member since {displayDate(account.createdAt)} ·{" "}
            {profile.timeZone}
          </small>
        </div>
        <Link className="button button-dark" href="/settings#profile">
          <Settings size={17} aria-hidden="true" /> Edit settings
        </Link>
      </header>

      <div className="profile-grid">
        <section className="card profile-card" aria-labelledby="personal-heading">
          <div className="card-title">
            <div>
              <h2 id="personal-heading">Personal details</h2>
              <p>Account information. Confirmed date of birth is read-only.</p>
            </div>
            <UserRound size={20} aria-hidden="true" />
          </div>
          <dl className="profile-detail-list">
            <div>
              <dt>Date of birth</dt>
              <dd>{displayDateOfBirth(profile.dateOfBirth)}</dd>
            </div>
            <div>
              <dt>Current age</dt>
              <dd>{profile.age ?? "Not provided"}</dd>
            </div>
            <div>
              <dt>Gender</dt>
              <dd>
                {profile.gender
                  ? genderLabels[profile.gender]
                  : "Not provided"}
              </dd>
            </div>
            <div>
              <dt>Height</dt>
              <dd>
                {profile.heightCm === null
                  ? "Not provided"
                  : `${profile.heightCm.toFixed(1)} cm`}
              </dd>
            </div>
            <div>
              <dt>Preferred unit</dt>
              <dd>{profile.preferredWeightUnit.toUpperCase()}</dd>
            </div>
          </dl>
        </section>

        <section className="card profile-card" aria-labelledby="routine-heading">
          <div className="card-title">
            <div>
              <h2 id="routine-heading">Routine and plan</h2>
              <p>Context used for future suggestions</p>
            </div>
            <Activity size={20} aria-hidden="true" />
          </div>
          <dl className="profile-detail-list">
            <div>
              <dt>Activity</dt>
              <dd>
                {profile.activityLevel
                  ? activityLabels[profile.activityLevel]
                  : "Not provided"}
              </dd>
            </div>
            <div>
              <dt>Strength training</dt>
              <dd>
                {profile.trainingDaysPerWeek === null
                  ? "Not provided"
                  : `${profile.trainingDaysPerWeek} days / week`}
              </dd>
            </div>
            <div>
              <dt>Latest weight</dt>
              <dd>
                {displayWeight(
                  data.latestWeightKg,
                  profile.preferredWeightUnit,
                )}
              </dd>
            </div>
            <div>
              <dt>Meal preferences</dt>
              <dd>{data.mealPreferenceCount} saved foods</dd>
            </div>
          </dl>
        </section>

        <section className="card profile-card profile-card-wide" aria-labelledby="goal-heading">
          <div className="card-title">
            <div>
              <h2 id="goal-heading">Goal context</h2>
              <p>Targets are context, not outcome promises</p>
            </div>
            <CalendarDays size={20} aria-hidden="true" />
          </div>
          {goal ? (
            <div className="profile-goal">
              <div>
                <span>Active direction</span>
                <strong>{goalLabels[goal.goalType]}</strong>
              </div>
              <div>
                <span>Target</span>
                <strong>
                  {displayWeight(
                    goal.targetWeightKg,
                    profile.preferredWeightUnit,
                  )}
                </strong>
              </div>
              <div>
                <span>Target date</span>
                <strong>{displayDate(goal.targetDate)}</strong>
              </div>
              <Link className="text-link" href="/progress">
                View progress <ArrowUpRight size={15} aria-hidden="true" />
              </Link>
            </div>
          ) : (
            <p className="profile-empty">
              No active goal is available. Complete onboarding or review Settings.
            </p>
          )}
        </section>

        <section className="card profile-card profile-card-wide" aria-labelledby="preferences-heading">
          <div className="card-title">
            <div>
              <h2 id="preferences-heading">Food preferences and boundaries</h2>
              <p>Used to filter future suggestions</p>
            </div>
            <Utensils size={20} aria-hidden="true" />
          </div>
          <div className="profile-preferences">
            <div>
              <h3>Allergies</h3>
              <ListValue
                items={profile.allergies}
                empty="No known allergies"
              />
            </div>
            <div>
              <h3>Dietary restrictions</h3>
              <ListValue
                items={profile.dietaryRestrictions}
                empty="No dietary restrictions"
              />
            </div>
            <div>
              <h3>Disliked foods</h3>
              <ListValue
                items={profile.dislikedFoods}
                empty="No disliked foods"
              />
            </div>
          </div>
          {profile.hasSafetyContext ? (
            <div className="profile-safety-note">
              <ShieldCheck size={18} aria-hidden="true" />
              <span>
                Optional safety context is on file. Its private text is not
                repeated on this overview.
              </span>
            </div>
          ) : null}
          <div className="section-actions">
            <Link className="button button-quiet" href="/settings#preferences">
              <Settings size={16} aria-hidden="true" /> Edit meal preferences
            </Link>
          </div>
        </section>

        <section className="card profile-card" aria-labelledby="tutorial-heading">
          <div className="card-title">
            <div>
              <h2 id="tutorial-heading">Need a walkthrough?</h2>
              <p>Replay the feature introduction at any time.</p>
            </div>
            <PlayCircle size={20} aria-hidden="true" />
          </div>
          <Link
            className="button button-quiet form-submit"
            href={PRODUCT_TOUR_REPLAY_HASH}
            onClick={(event) => {
              event.preventDefault();
              window.history.replaceState(
                window.history.state,
                "",
                `${window.location.pathname}${window.location.search}${PRODUCT_TOUR_REPLAY_HASH}`,
              );
              try {
                window.sessionStorage.setItem(
                  PRODUCT_TOUR_REPLAY_REQUEST_KEY,
                  "true",
                );
              } catch {
                // The event still opens the tour once its listener is ready.
              }
              window.dispatchEvent(new Event(PRODUCT_TOUR_OPEN_EVENT));
            }}
          >
            <PlayCircle size={17} aria-hidden="true" /> Replay tutorial
          </Link>
        </section>

        <section className="card profile-card" aria-labelledby="shopping-heading">
          <div className="card-title">
            <div>
              <h2 id="shopping-heading">Shop nearby</h2>
              <p>Optional external map searches</p>
            </div>
            <MapPin size={20} aria-hidden="true" />
          </div>
          <div className="shopping-links">
            {nearbySearches.map((search) => (
              <a
                href={mapsUrl(search.query)}
                key={search.label}
                rel="noopener noreferrer"
                target="_blank"
              >
                <Store size={17} aria-hidden="true" />
                <span>
                  <strong>{search.label}</strong>
                  <small>{search.detail}</small>
                </span>
                <ArrowUpRight size={15} aria-hidden="true" />
              </a>
            ))}
          </div>
          <p className="field-help shopping-disclosure">
            Opens Google Maps, which may use its own location settings. Let&apos;s
            Go Green! does not receive your location or these results and cannot
            verify that a store has a specific product in stock.
          </p>
        </section>
      </div>
    </div>
  );
}

export type { ProfileViewData };
