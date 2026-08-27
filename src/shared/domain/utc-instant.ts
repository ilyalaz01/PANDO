export const MILLISECONDS_PER_DAY = 86_400_000;

const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;

export interface EvaluationClock {
  readonly asOf: string;
}

function hasValidCalendarFields(value: string): boolean {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  const second = Number(value.slice(17, 19));
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth[month - 1]! &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59
  );
}

export function parseInstant(value: string, fieldName: string): number {
  if (!ISO_INSTANT_PATTERN.test(value)) {
    throw new RangeError(`${fieldName} must be an ISO 8601 instant with Z or an explicit offset`);
  }

  if (!hasValidCalendarFields(value)) {
    throw new RangeError(`${fieldName} is not a valid calendar instant`);
  }

  const epochMilliseconds = Date.parse(value);
  if (!Number.isFinite(epochMilliseconds)) {
    throw new RangeError(`${fieldName} is not a valid instant`);
  }

  return epochMilliseconds;
}

export function toCanonicalInstant(epochMilliseconds: number): string {
  return new Date(epochMilliseconds).toISOString();
}

export function utcDateKey(epochMilliseconds: number): string {
  return toCanonicalInstant(epochMilliseconds).slice(0, 10);
}
