import type { Metadata } from "next";
import { CalendarView } from "@/components/calendar-view";
import { PageLoadError } from "@/components/page-load-error";
import { loadCheckinRange } from "@/src/lib/checkin-loader";
import { localDateInTimeZone, localMonthBounds } from "@/src/lib/domain";
import { isDevelopmentDemo } from "@/src/lib/env";
import {
  createSupabaseServerClient,
  getCurrentProfile,
  getCurrentUser,
} from "@/src/lib/supabase/server";

export const metadata: Metadata = { title: "Calendar" };

function calendarLoadError() {
  return (
    <PageLoadError
      title="Your calendar could not be loaded."
      message="Your profile or saved check-ins could not be loaded safely. Reload Calendar before relying on or changing this information."
      retryHref="/calendar"
      retryLabel="Reload Calendar"
    />
  );
}

export default async function CalendarPage() {
  if (isDevelopmentDemo()) return <CalendarView />;

  const user = await getCurrentUser();
  if (!user) return <CalendarView initialCheckins={[]} />;
  const profileResult = await getCurrentProfile(user.id);
  if (profileResult.error) return calendarLoadError();
  const supabase = await createSupabaseServerClient();
  const timeZone = profileResult.data?.time_zone ?? "UTC";
  let today: string;
  try {
    today = localDateInTimeZone(new Date(), timeZone);
  } catch {
    return calendarLoadError();
  }
  const month = today.slice(0, 7);
  const bounds = localMonthBounds(month);
  const checkinsResult = await loadCheckinRange(
    supabase,
    user.id,
    bounds.first,
    bounds.last,
  );
  if (checkinsResult.error) return calendarLoadError();

  return (
    <CalendarView
      initialMonth={month}
      initialSelectedDate={today}
      initialCheckins={checkinsResult.data}
      timeZone={timeZone}
    />
  );
}
