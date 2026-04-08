export const CALENDAR_EVENT_TYPES = [
  "Scouting",
  "Patrol",
  "Meetup",
  "Op",
  "Logistics",
] as const;

export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number];

/** Plaintext event — only ever stored decrypted in RAM / device cache; ciphertext on server. */
export type CalendarEventPlain = {
  v: 1;
  type: CalendarEventType;
  /** Human label or reverse-geocoded (optional). */
  locationLabel?: string;
  lat?: number;
  lng?: number;
  startIso: string;
  endIso: string;
  description: string;
};

export type DecryptedCalendarRow = {
  rowId: string;
  authorId: string;
  plain: CalendarEventPlain;
};
