export interface TriggerOccurrence {
  occurrenceId: string;
  scheduleId: string;
  idempotencyKey: string;
  dueAt: string;
}

export interface PersistentSchedulerPort {
  reconcileMissedRuns(now: string): Promise<readonly TriggerOccurrence[]>;
}
