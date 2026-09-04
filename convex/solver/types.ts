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
      /** The most TAs on duty at once. */
      requiredCount: number;
      /**
       * The fewest TAs the window should have on duty at any moment. The
       * generator hands out office hours beyond a TA's own weekly
       * requirement to meet it, which is what keeps the day covered rather
       * than stacking everybody into the first free slot.
       */
      minCount?: number;
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

/** A weekday time range, used for blackout windows. */
export interface SolverTimeRange {
  day: Day;
  startMin: number;
  endMin: number;
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
  /** The most office hours a TA is given per week, by window duty type id. */
  windowHoursPerTa?: Record<string, number>;
  /**
   * The fewest they must end up with. Between the two the generator only
   * takes a block if it is the shape the TA asked for — a TA who wanted few
   * long blocks stops early rather than accept a stub hour.
   */
  windowHoursPerTaMin?: Record<string, number>;
  /** Most sync shifts of a duty type one TA may be given, by duty type id. */
  maxPerTaByDuty?: Record<string, number>;
  /** Shortest office-hour block in minutes, by window duty type id. Default 60. */
  windowMinBlockMin?: Record<string, number>;
  /**
   * Times office hours of a window duty type may not be cut into, whoever
   * would hold them — lectures, discussions, anything the coordinator picked.
   */
  windowBlackouts?: Record<string, SolverTimeRange[]>;
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
