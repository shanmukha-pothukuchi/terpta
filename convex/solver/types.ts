// Pure-TS solver contract. No Convex imports — vitest runs these without codegen.
// Ids are plain strings (Convex Ids are strings at runtime).

export type Day = "M" | "Tu" | "W" | "Th" | "F";

/** How a TA would like their office hours cut. */
export type OfficeHoursStyle = "few_long" | "many_short";

export type SolverShift =
  | {
      id: string;
      kind: "weekly_sync";
      dutyTypeId: string;
      sectionId?: string;
      requiredCount: number;
      day: Day;
      startMin: number;
      endMin: number;
      startDate: string; // ISO YYYY-MM-DD
      endDate: string;
    }
  | {
      id: string;
      kind: "once_sync";
      dutyTypeId: string;
      sectionId?: string;
      requiredCount: number;
      date: string; // ISO YYYY-MM-DD
      day: Day; // weekday of `date`
      startMin: number;
      endMin: number;
    }
  | {
      id: string;
      kind: "async";
      dutyTypeId: string;
      requiredCount: number; // max TAs to split across (>=1)
      hoursRequired: number;
      dueDate: string;
    }
  | {
      /**
       * A range of time office hours may fall in, not a slot to fill. The
       * solver cuts each TA's weekly office-hour requirement into blocks
       * inside these; `requiredCount` is how many TAs may hold hours at once.
       */
      id: string;
      kind: "window";
      dutyTypeId: string;
      requiredCount: number;
      day: Day;
      startMin: number;
      endMin: number;
      startDate: string;
      endDate: string;
    };

export interface SolverTaProfile {
  id: string;
  maxHoursPerWeek: number;
  syncAsyncPreference: number; // 0 = all sync … 1 = all async
  dutyTypePrefs: string[]; // ranked dutyTypeIds, best first
  sectionPrefs: string[]; // ranked sectionIds, best first
  /** Absent means "few_long", which is what existing profiles get. */
  officeHoursStyle?: OfficeHoursStyle;
}

export interface SolverAvailabilityBlock {
  taProfileId: string;
  day: Day;
  startMin: number;
  endMin: number;
  status: "available" | "prefer_not" | "unavailable";
}

export interface SolverDateException {
  taProfileId: string;
  startDate: string; // inclusive
  endDate: string; // inclusive
}

export interface SolverLockedAssignment {
  shiftId: string;
  taProfileId: string;
  hoursAllocated?: number; // async only
}

/** An office-hour block the coordinator has pinned; the solver builds around it. */
export interface SolverLockedWindowBlock {
  windowShiftId: string;
  taProfileId: string;
  day: Day;
  startMin: number;
  endMin: number;
}

export interface SolveInput {
  shifts: SolverShift[];
  taProfiles: SolverTaProfile[];
  availability: SolverAvailabilityBlock[];
  dateExceptions: SolverDateException[];
  lockedAssignments: SolverLockedAssignment[];
  /** Hours each TA owes per week, by window duty type id. */
  windowHoursPerTa?: Record<string, number>;
  /** Most sync shifts of a duty type one TA may be given, by duty type id. */
  maxPerTaByDuty?: Record<string, number>;
  lockedWindowBlocks?: SolverLockedWindowBlock[];
  periodStart: string; // ISO date
  periodEnd: string; // ISO date
}

export interface SolvedAssignment {
  shiftId: string;
  taProfileId: string;
  hoursAllocated?: number; // async only
  locked: boolean;
}

export interface SolvedWindowBlock {
  windowShiftId: string;
  dutyTypeId: string;
  taProfileId: string;
  day: Day;
  startMin: number;
  endMin: number;
  locked: boolean;
}

export interface SolveDiagnostics {
  unfilledShifts: Array<{
    shiftId: string;
    /** People missing for sync shifts; hours missing for async. */
    missing: number;
  }>;
  /** Office-hour requirement the solver could not place for a TA. */
  unfilledWindowHours: Array<{
    taProfileId: string;
    dutyTypeId: string;
    missingHours: number;
  }>;
  taLoads: Array<{
    taProfileId: string;
    weeklyHours: number; // sync durations + async hours averaged over period
    maxHoursPerWeek: number;
  }>;
  zeroAssignmentTaIds: string[];
  /** Only possible via conflicting locked assignments. */
  hardViolations: Array<{ shiftId: string; taProfileId: string; reason: string }>;
}

export interface SolveOutput {
  assignments: SolvedAssignment[];
  windowBlocks: SolvedWindowBlock[];
  diagnostics: SolveDiagnostics;
}
