export function getLocalReportDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseClockTime(raw: string): { hours: number; minutes: number } {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(raw.trim());
  if (!match) {
    throw new Error(`Invalid SCHEDULE_TIME value "${raw}". Use HH:mm format.`);
  }

  return {
    hours: Number(match[1]),
    minutes: Number(match[2]),
  };
}

export function getNextRunAt(timeText: string, now = new Date()): Date {
  const { hours, minutes } = parseClockTime(timeText);
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);

  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}
