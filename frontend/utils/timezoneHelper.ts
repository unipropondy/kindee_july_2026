/**
 * Timezone utilities to enforce Asia/Singapore (SGT, UTC+8) timezone in the frontend.
 */

// Helper to shift a Date to Singapore Time (UTC+8) so we can format it as UTC
function toSgtDate(date: Date): Date {
  // SGT is UTC+8
  return new Date(date.getTime() + 8 * 60 * 60 * 1000);
}

export function getSingaporeDateString(date: Date = new Date()): string {
  const sgt = toSgtDate(date);
  const year = sgt.getUTCFullYear();
  const month = String(sgt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(sgt.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatToSingaporeDate(
  dateInput: Date | string | number,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
): string {
  if (!dateInput) return "";
  const date = parseDatabaseDate(dateInput);
  if (isNaN(date.getTime())) return "";
  const sgt = toSgtDate(date);
  return new Intl.DateTimeFormat('en-US', {
    ...options,
    timeZone: 'UTC'
  }).format(sgt);
}

export function formatToSingaporeTime(
  dateInput: Date | string | number,
  options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: true }
): string {
  if (!dateInput) return "";
  const date = parseDatabaseDate(dateInput);
  if (isNaN(date.getTime())) return "";
  const sgt = toSgtDate(date);
  return new Intl.DateTimeFormat('en-US', {
    ...options,
    timeZone: 'UTC'
  }).format(sgt);
}

export function formatToSingaporeDateTime(dateInput: Date | string | number): string {
  if (!dateInput) return "";
  const date = parseDatabaseDate(dateInput);
  if (isNaN(date.getTime())) return "";
  const dateStr = formatToSingaporeDate(date, { day: 'numeric', month: 'short' });
  const timeStr = formatToSingaporeTime(date, { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${dateStr} • ${timeStr}`;
}

export function getSingaporeDate(): Date {
  const now = new Date();
  return toSgtDate(now);
}

export function getSingaporeTimeTodayRange(): { from: Date; to: Date } {
  const nowSgt = getSingaporeDate();
  const from = new Date(nowSgt);
  from.setUTCHours(0, 0, 0, 0);
  const to = new Date(nowSgt);
  return { from, to };
}

export function parseDatabaseDate(dateInput: Date | string | number): Date {
  if (!dateInput) return new Date();
  if (dateInput instanceof Date) return dateInput;
  if (typeof dateInput === 'number') return new Date(dateInput);

  let str = String(dateInput).trim();
  
  // Try custom regex parsing for: "Jul  9 2026  2:12PM"
  const cleaned = str.replace(/\s+/g, ' ');
  const match = cleaned.match(/^([a-zA-Z]{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)$/);
  if (match) {
    const monthMap: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
    };
    const [_, monStr, dayStr, yearStr, hourStr, minStr, ampm] = match;
    const month = monthMap[monStr.toLowerCase()];
    const day = parseInt(dayStr, 10);
    const year = parseInt(yearStr, 10);
    let hour = parseInt(hourStr, 10);
    const minute = parseInt(minStr, 10);
    if (ampm.toUpperCase() === 'PM' && hour < 12) hour += 12;
    if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0;

    const utcTime = Date.UTC(year, month, day, hour, minute, 0);
    return new Date(utcTime - 8 * 60 * 60 * 1000); // Shift to SGT (UTC+8)
  }

  if (str.endsWith('Z')) {
    str = str.slice(0, -1) + '+08:00';
  } else if (str.endsWith('+00:00')) {
    str = str.slice(0, -6) + '+08:00';
  } else if (!str.includes('+') && !str.includes('-') && str.includes('T')) {
    str = str + '+08:00';
  } else if (!str.includes('T') && str.includes(' ')) {
    str = str.replace(' ', 'T') + '+08:00';
  }

  const parsed = new Date(str);
  if (isNaN(parsed.getTime())) {
    return new Date(dateInput);
  }
  return parsed;
}

