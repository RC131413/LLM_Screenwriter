const timeLabels = new Set([
  'DZIEŃ', 'NOC', 'RANO', 'RANEK', 'ŚWIT', 'ZMROK', 'ZMIERZCH', 'WIECZÓR',
  'POŁUDNIE', 'PRZEDPOŁUDNIE', 'POPOŁUDNIE', 'NAD RANEM', 'WCZESNY RANEK',
  'WCZESNY PORANEK', 'PÓŹNY WIECZÓR', 'PÓŹNA NOC', 'ZACHÓD SŁOŃCA', 'WSCHÓD SŁOŃCA',
  'DAY', 'NIGHT', 'MORNING', 'NOON', 'AFTERNOON', 'EVENING', 'DAWN', 'DUSK', 'SUNSET', 'SUNRISE',
  'PÓŹNIEJ', 'CHWILĘ PÓŹNIEJ', 'KONTYNUACJA', 'CIĄG DALSZY', 'LATER', 'CONTINUOUS', 'SAME TIME',
]);

const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toUpperCase();

function isTimeOfDay(value: string, savedTime: string): boolean {
  const normalized = normalize(value);
  // Retain custom labels already supplied by the API as well as standard PL/EN labels.
  return !!normalized && (normalized === normalize(savedTime) ||
    normalized.split(/\s*\/\s*/).every(part => timeLabels.has(part)));
}

export function splitSceneHeading(heading: string, savedTime = ''): { location_heading: string; time_of_day: string } {
  const value = heading.trim();
  const separators = [...value.matchAll(/[-–—]/gu)].reverse();
  for (const separator of separators) {
    const suffix = value.slice(separator.index + 1).trim();
    if (isTimeOfDay(suffix, savedTime)) {
      return { location_heading: value.slice(0, separator.index).trim(), time_of_day: normalize(suffix) };
    }
  }
  // A hyphen in a location name must not turn part of that name into a time of day.
  return { location_heading: value, time_of_day: '' };
}

export function formatSceneHeading(location: string, timeOfDay: string): string {
  const value = location.trim();
  const time = timeOfDay.trim();
  if (!time) return value;
  const legacy = splitSceneHeading(value, time);
  if (normalize(legacy.time_of_day) === normalize(time)) return value;
  // Old records may include time in location_heading; display it only once.
  const place = legacy.time_of_day ? legacy.location_heading : value;
  return `${place} - ${time}`.trim();
}
