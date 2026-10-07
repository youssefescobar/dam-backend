/** Office-hours helpers. Everything is off unless Settings.officeHoursEnabled is true. */

const DAYS = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  ar: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
};
const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function validTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Weekday (0 = Sunday) and "HH:MM" of `date` in the settings timezone. */
function localParts(settings, date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: settings.timezone || 'Asia/Riyadh',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return { day: WEEKDAY_INDEX[get('weekday')], time: `${get('hour')}:${get('minute')}` };
}

/** True when the feature is off, or `date` falls inside the configured office hours. */
export function isOpenNow(settings, date = new Date()) {
  if (!settings?.officeHoursEnabled) return true;
  const { day, time } = localParts(settings, date);
  return (
    (settings.officeDays || []).includes(day) && time >= settings.officeStart && time < settings.officeEnd
  );
}

/** "Sunday at 09:00" (or Arabic) for the next opening after `date`; null if no days are configured. */
export function nextOpeningText(settings, lang = 'en', date = new Date()) {
  const days = settings.officeDays || [];
  if (!days.length) return null;
  const { day, time } = localParts(settings, date);
  // Still to open today (before opening time), else the next configured day.
  for (let i = 0; i <= 7; i += 1) {
    const d = (day + i) % 7;
    if (days.includes(d) && (i > 0 || time < settings.officeStart)) {
      const when = i === 0 ? '' : `${DAYS[lang === 'ar' ? 'ar' : 'en'][d]} `;
      return lang === 'ar' ? `${when}الساعة ${settings.officeStart}`.trim() : `${when}at ${settings.officeStart}`.trim();
    }
  }
  return null;
}
