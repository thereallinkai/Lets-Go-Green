import type { Metadata } from "next";
import {
  CalendarView,
  type CalendarCheckin,
} from "@/components/calendar-view";
import {
  localDateInTimeZone,
  normalizeMealSlotCheckins,
  type MealCheckinStatus,
  type MealSlot,
} from "@/src/lib/domain";
import { isDevelopmentDemo } from "@/src/lib/env";
import {
  createSupabaseServerClient,
  getCurrentProfile,
  getCurrentUser,
} from "@/src/lib/supabase/server";

export const metadata: Metadata = { title: "Calendar" };

function monthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    first: `${month}-01`,
    last: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

export default async function CalendarPage() {
  if (isDevelopmentDemo()) return <CalendarView />;

  const user = await getCurrentUser();
  if (!user) return <CalendarView initialCheckins={[]} />;
  const { data: profile } = await getCurrentProfile(user.id);
  const supabase = await createSupabaseServerClient();
  const timeZone = profile?.time_zone ?? "UTC";
  const today = localDateInTimeZone(new Date(), timeZone);
  const month = today.slice(0, 7);
  const bounds = monthBounds(month);
  const [daysResult, mealsResult] = await Promise.all([
    supabase
      .from("daily_checkins")
      .select("local_date,notes")
      .eq("user_id", user.id)
      .gte("local_date", bounds.first)
      .lte("local_date", bounds.last)
      .order("local_date"),
    supabase
      .from("daily_meal_checkins")
      .select("local_date,meal_type,status,skip_reason")
      .eq("user_id", user.id)
      .gte("local_date", bounds.first)
      .lte("local_date", bounds.last)
      .order("local_date"),
  ]);
  const mealRows = (mealsResult.data ?? []) as Array<{
    local_date: string;
    meal_type: MealSlot;
    skip_reason: string | null;
    status: MealCheckinStatus;
  }>;
  const initialCheckins: CalendarCheckin[] = (daysResult.data ?? []).map(
    (day) => ({
      localDate: day.local_date,
      notes: day.notes,
      slots: normalizeMealSlotCheckins(
        mealRows
          .filter((meal) => meal.local_date === day.local_date)
          .map((meal) => ({
            mealType: meal.meal_type,
            status: meal.status,
            skipReason: meal.skip_reason,
          })),
      ),
    }),
  );

  return (
    <CalendarView
      initialMonth={month}
      initialSelectedDate={today}
      initialCheckins={initialCheckins}
      timeZone={timeZone}
    />
  );
}
