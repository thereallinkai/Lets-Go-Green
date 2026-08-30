const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const DAY_IN_MILLISECONDS = 86_400_000;

export interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

export type LocalDateFormatStyle =
  | "weekday-short"
  | "month-day"
  | "month-day-year";

const LOCAL_DATE_FORMATTERS: Record<
  LocalDateFormatStyle,
  Intl.DateTimeFormat
> = {
  "weekday-short": new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "UTC",
  }),
  "month-day": new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }),
  "month-day-year": new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }),
};

export function parseLocalDate(localDate: string): LocalDateParts {
  const match = LOCAL_DATE_PATTERN.exec(localDate);
  if (!match) {
    throw new RangeError("Local date must use YYYY-MM-DD format.");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid local date: ${localDate}.`);
  }
  return { year, month, day };
}

export function formatLocalDate(
  localDate: string,
  style: LocalDateFormatStyle,
): string {
  const { year, month, day } = parseLocalDate(localDate);
  return LOCAL_DATE_FORMATTERS[style].format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

function localDateToEpochDay(localDate: string): number {
  const { year, month, day } = parseLocalDate(localDate);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_IN_MILLISECONDS);
}

function epochDayToLocalDate(epochDay: number): string {
  if (!Number.isInteger(epochDay)) {
    throw new RangeError("Epoch day must be an integer.");
  }
  const date = new Date(epochDay * DAY_IN_MILLISECONDS);
  return [
    date.getUTCFullYear().toString().padStart(4, "0"),
    (date.getUTCMonth() + 1).toString().padStart(2, "0"),
    date.getUTCDate().toString().padStart(2, "0"),
  ].join("-");
}

export function addLocalDays(localDate: string, days: number): string {
  if (!Number.isInteger(days)) throw new RangeError("Days must be an integer.");
  return epochDayToLocalDate(localDateToEpochDay(localDate) + days);
}

export function addLocalMonths(localMonth: string, months: number): string {
  const match = LOCAL_MONTH_PATTERN.exec(localMonth);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  if (!match || month < 1 || month > 12) {
    throw new RangeError("Local month must use a valid YYYY-MM format.");
  }
  if (!Number.isInteger(months)) {
    throw new RangeError("Months must be an integer.");
  }
  const monthIndex = year * 12 + month - 1 + months;
  const shiftedYear = Math.floor(monthIndex / 12);
  const shiftedMonth = ((monthIndex % 12) + 12) % 12 + 1;
  return `${String(shiftedYear).padStart(4, "0")}-${String(shiftedMonth).padStart(2, "0")}`;
}

export function localMonthBounds(localMonth: string) {
  const first = `${addLocalMonths(localMonth, 0)}-01`;
  const nextMonth = `${addLocalMonths(localMonth, 1)}-01`;
  return { first, last: addLocalDays(nextMonth, -1) };
}

export function daysBetweenLocalDates(fromDate: string, toDate: string): number {
  return localDateToEpochDay(toDate) - localDateToEpochDay(fromDate);
}

export function isValidIanaTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

export function localDateInTimeZone(
  instant: Date | string | number,
  timeZone: string,
): string {
  if (!isValidIanaTimeZone(timeZone)) {
    throw new RangeError(`Invalid IANA time zone: ${timeZone}.`);
  }
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) throw new RangeError("Invalid instant.");

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

export function remainingDays(
  targetDate: string,
  options: {
    now?: Date | string | number;
    timeZone?: string;
    clampAtZero?: boolean;
  } = {},
): number {
  parseLocalDate(targetDate);
  const {
    now = new Date(),
    timeZone = "UTC",
    clampAtZero = true,
  } = options;
  const today = localDateInTimeZone(now, timeZone);
  const result = daysBetweenLocalDates(today, targetDate);
  return clampAtZero ? Math.max(0, result) : result;
}

export function enumerateLocalDates(startDate: string, endDate: string): string[] {
  const start = localDateToEpochDay(startDate);
  const end = localDateToEpochDay(endDate);
  if (end < start) return [];
  return Array.from({ length: end - start + 1 }, (_, index) =>
    epochDayToLocalDate(start + index),
  );
}
