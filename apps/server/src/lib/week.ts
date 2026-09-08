export const DEFAULT_TIMEZONE = "Europe/Paris";

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function safeTimeZone(timeZone: string | null | undefined): string {
  if (timeZone && isValidTimeZone(timeZone)) return timeZone;
  return DEFAULT_TIMEZONE;
}

/** Date calendaire (YYYY-MM-DD) telle que l'athlète la voit dans son fuseau. */
export function localCalendarDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/**
 * Les dates de séance sont des jours calendaires, pas des instants : elles sont
 * stockées à minuit UTC. Le lundi est donc calculé à partir du jour local de
 * l'athlète, sinon un athlète en UTC+13 (ou en UTC-8) voit sa semaine basculer
 * un jour trop tôt ou trop tard.
 */
export function startOfWeek(instant: Date, timeZone: string = DEFAULT_TIMEZONE): Date {
  const iso = localCalendarDate(instant, timeZone);
  const d = new Date(`${iso}T00:00:00.000Z`);
  const day = d.getUTCDay();
  const shiftToMonday = (day === 0 ? -6 : 1) - day;
  d.setUTCDate(d.getUTCDate() + shiftToMonday);
  return d;
}

export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

export function weekDays(weekStart: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => formatDate(addDays(weekStart, i)));
}

/** Début de la journée locale de l'athlète, exprimé en instant UTC. */
export function startOfLocalDay(instant: Date, timeZone: string): Date {
  const iso = localCalendarDate(instant, timeZone);
  const guess = new Date(`${iso}T00:00:00.000Z`);
  // Décalage du fuseau à cette date : on l'obtient en comparant le rendu local
  // d'un instant connu avec ce même instant en UTC.
  const asUtc = new Date(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: safeTimeZone(timeZone),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .format(instant)
      .replace(", ", "T") + "Z"
  );
  const offsetMs = asUtc.getTime() - instant.getTime();
  return new Date(guess.getTime() - offsetMs);
}
