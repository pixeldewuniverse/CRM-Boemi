/**
 * Google Calendar sync — interface only (not implemented yet).
 *
 * Plan once BOEMI's Google Workspace is ready: each user connects their
 * Google account (OAuth, scope calendar.events); tasks with a due time and
 * planned visits are pushed to a "BOEMI Tools" calendar. Call the provider
 * from the task/visit Server Actions *after* the database write, and keep
 * Google's event id in a mapping table so updates/deletes find the event.
 * Nothing in the app depends on this yet; the noop provider is used.
 */
import type { CalendarItem } from "@/lib/queries/calendar";

export interface CalendarSyncProvider {
  readonly name: string;
  /** Create or update the external event for this item; returns the external id. */
  upsert(userId: string, item: CalendarItem): Promise<string | null>;
  remove(userId: string, externalId: string): Promise<void>;
}

export const noopCalendarSync: CalendarSyncProvider = {
  name: "none",
  async upsert() {
    return null;
  },
  async remove() {},
};

export function getCalendarSync(): CalendarSyncProvider {
  return noopCalendarSync;
}
