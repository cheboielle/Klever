export type Role = 'owner' | 'admin' | 'technician';
export type MeterUnit = 'hours' | 'km';
export type AssetStatus = 'Active' | 'Out of Service' | 'Workshop' | 'Other';
export type TriggerMode = 'hours' | 'calendar' | 'both';
export interface Access {
  allowed: boolean;
  reason?: 'inactive' | 'signed_out' | 'not_provisioned';
  user_id?: string;
  tenant_id?: string;
  tenant_name?: string;
  name?: string;
  role?: Role;
  can_write?: boolean;
  access_ends_at?: string | null;
  app_lock?: boolean;
}
export interface Asset {
  id: string; asset_type_id: string; name: string; serial: string; status: AssetStatus;
  meter_unit: MeterUnit;
  current_hours: number | string; meter_revision: number; archived: boolean;
}
export interface ServiceSchedule {
  mode: TriggerMode;
  intervalHours: number | null;
  intervalDays: number | null;
  baselineHours: number | null;
  baselineDate: string | null;
}

function validDate(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Use a calendar date.');
  const value = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== date) {
    throw new Error('Invalid calendar date.');
  }
  return value;
}
export function addCalendarDays(date: string, days: number): string {
  if (!Number.isInteger(days) || days < 1) throw new Error('Interval must be positive days.');
  const value = validDate(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function serviceDue(schedule: ServiceSchedule, hours: number, today: string) {
  validDate(today);
  if (!Number.isFinite(hours) || hours < 0) throw new Error('Hours must be nonnegative.');
  const usesHours = schedule.mode !== 'calendar';
  const usesDays = schedule.mode !== 'hours';
  if (usesHours && !(schedule.intervalHours !== null && schedule.intervalHours > 0)) throw new Error('Hours interval required.');
  if (usesDays && !(schedule.intervalDays !== null && Number.isInteger(schedule.intervalDays) && schedule.intervalDays > 0)) throw new Error('Days interval required.');
  const nextHours = usesHours && schedule.baselineHours !== null ? schedule.baselineHours + schedule.intervalHours! : null;
  const nextDate = usesDays && schedule.baselineDate ? addCalendarDays(schedule.baselineDate, schedule.intervalDays!) : null;
  const missingBaseline = (usesHours && nextHours === null) || (usesDays && nextDate === null);
  const due = (nextHours !== null && hours >= nextHours) || (nextDate !== null && today >= nextDate);
  return { due, missingBaseline, nextHours, nextDate, hoursRemaining: nextHours === null ? null : nextHours - hours };
}

/** Always calculate monthly occurrences from the original anchor, not February's clamp. */
export function nextTaskDate(anchor: string, after: string, cadence: 'monthly' | number): string {
  const origin = validDate(anchor); const current = validDate(after);
  if (origin > current) return anchor;
  if (cadence !== 'monthly') {
    if (!Number.isInteger(cadence) || cadence < 1) throw new Error('Invalid interval.');
    const days = Math.floor((current.getTime() - origin.getTime()) / 86400000);
    return addCalendarDays(anchor, (Math.floor(days / cadence) + 1) * cadence);
  }
  let offset = (current.getUTCFullYear() - origin.getUTCFullYear()) * 12 + current.getUTCMonth() - origin.getUTCMonth();
  for (;;) {
    const first = new Date(Date.UTC(origin.getUTCFullYear(), origin.getUTCMonth() + offset, 1));
    const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    first.setUTCDate(Math.min(origin.getUTCDate(), lastDay));
    if (first > current) return first.toISOString().slice(0, 10);
    offset++;
  }
}
