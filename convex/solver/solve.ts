// Pure, deterministic assignment solver for TerpTA.
// NO Convex imports. Fixed-seed PRNG (mulberry32(42)) — identical input
// always produces byte-identical output.

import type {
  Day,
  SolveDiagnostics,
  SolveInput,
  SolveOutput,
  SolvedAssignment,
  SolverShift,
  SolverTaProfile,
  SolvedWindowBlock,
} from "./types";

// ---------------------------------------------------------------------------
// PRNG
// ---------------------------------------------------------------------------

/** Deterministic 32-bit PRNG. Exported for test fixture generation. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Constants / weights (lexicographic-ish priority via magnitude)
// ---------------------------------------------------------------------------

const EPS = 1e-6;

const W = {
  FILL_PERSON: 10000, // (1) missing person on a sync shift
  FILL_HOUR: 2000, // (1) missing hour on an async shift
  SECTION: 300, // (2) section preference rank
  DUTY: 80, // (3) duty-type preference rank
  SLIDER: 80, // (3) sync/async slider mismatch
  PREFER_NOT: 40, // (4) overlap with a prefer_not block
  BALANCE: 1, // (5) squared deviation from mean weekly load
  CLUSTER: 3, // (6) per extra distinct sync day per TA
  HOUR_SCALE: 0.25, // async soft costs are per-hour, scaled down
};

const SA_ITERS = 3000;
const SA_T0 = 200;
const SA_COOL = 0.9985;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SyncShift = Extract<SolverShift, { kind: "weekly_sync" | "once_sync" }>;
type AsyncShift = Extract<SolverShift, { kind: "async" }>;
type WindowShift = Extract<SolverShift, { kind: "window" }>;

/**
 * Office-hour blocks are cut on a quarter-hour grid.
 *
 * Availability is painted on quarter hours, and a TA free 12:15 to 1:45 got
 * an hour out of ninety minutes on a half-hour grid: 12:30-1:30 was the only
 * thing that fit, so their day was clipped at both ends and their week came
 * out split when it need not have been. Block lengths still step by the half
 * hour; it is where a block may start that got finer.
 */
const SLOT = 15;
/** Block lengths still come in half hours: 2h, 1h30, 1h. */
const SIZE_STEP = 30;
/** Shortest office-hour block when the duty type does not say otherwise. */
const DEFAULT_MIN_BLOCK = 60;

/**
 * Spreading office hours out, in the same currency as the prefer-not cost.
 *
 * A TA saying "not then" outranks all of it — their weight is scaled up so a
 * single prefer-not minute costs more than any amount of clumping.
 */
const OH = {
  PREFER_NOT: 10, // per minute the block crosses prefer_not time
  STACK: 40, // per half hour already staffed on that day at that hour
  SAME_TIME: 12, // per half hour staffed at that hour on some other day
  SAME_DAY: 25, // per block already sitting on that day
  NEAR: 10, // per half hour of closeness to another block on that day
  NEAR_REACH: 120, // how far apart two blocks stop crowding each other
  COVER: 60, // credit per half hour that is below the window's floor
};
const DAY_ORDER: Record<Day, number> = { M: 0, Tu: 1, W: 2, Th: 3, F: 4 };

interface Load {
  weeklyMin: number; // minutes/week from weekly_sync assignments
  onceMin: number; // total minutes from once_sync assignments (averaged over weeks)
  asyncHours: number; // total async hours (averaged over weeks)
}

interface State {
  windowBlocks: SolvedWindowBlock[];
  syncByShift: Map<string, string[]>; // sync shiftId -> assigned taIds
  asyncByShift: Map<string, Map<string, number>>; // async shiftId -> taId -> hours
  taSyncShifts: Map<string, string[]>; // taId -> sync shiftIds
  loads: Map<string, Load>;
}

interface Ctx {
  numWeeks: number;
  tas: SolverTaProfile[];
  taById: Map<string, SolverTaProfile>;
  taIndex: Map<string, number>;
  taIds: string[];
  shiftById: Map<string, SolverShift>;
  syncShifts: SyncShift[];
  asyncShifts: AsyncShift[];
  windowShifts: WindowShift[];
  maxPerTaByDuty: Record<string, number>;
  coversWindow: (taId: string, day: Day, s: number, e: number) => boolean;
  overlapsUnavail: (taId: string, day: Day, s: number, e: number) => boolean;
  preferNotMinutes: (taId: string, day: Day, s: number, e: number) => number;
  eligible: Map<string, string[]>; // sync shiftId -> statically eligible taIds (sorted)
  eligibleSet: Map<string, Set<string>>;
  syncPairCost: Map<string, Float64Array>; // sync shiftId -> cost per taIndex
  asyncPerHour: Map<string, Float64Array>; // async shiftId -> cost/hour per taIndex
  lockedSync: Set<string>; // "shiftId|taId"
  lockedAsync: Map<string, number>; // "shiftId|taId" -> min locked hours
  input: SolveInput;
}

const pairKey = (shiftId: string, taId: string) => `${shiftId}|${taId}`;
const round4 = (x: number) => Math.round(x * 10000) / 10000;

// ---------------------------------------------------------------------------
// Date / time helpers (ISO YYYY-MM-DD strings compare lexicographically)
// ---------------------------------------------------------------------------

function isoToUtc(d: string): number {
  const [y, m, dd] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, dd);
}

function timeOverlap(aS: number, aE: number, bS: number, bE: number): boolean {
  return aS < bE && bS < aE;
}

function syncShiftsConflict(a: SyncShift, b: SyncShift): boolean {
  if (!timeOverlap(a.startMin, a.endMin, b.startMin, b.endMin)) return false;
  if (a.kind === "weekly_sync" && b.kind === "weekly_sync") return a.day === b.day;
  if (a.kind === "once_sync" && b.kind === "once_sync") return a.date === b.date;
  const once = (a.kind === "once_sync" ? a : b) as Extract<SyncShift, { kind: "once_sync" }>;
  const weekly = (a.kind === "weekly_sync" ? a : b) as Extract<SyncShift, { kind: "weekly_sync" }>;
  return once.day === weekly.day && weekly.startDate <= once.date && once.date <= weekly.endDate;
}

// ---------------------------------------------------------------------------
// Context construction
// ---------------------------------------------------------------------------

function rankPenalty(prefs: string[], id: string | undefined): number {
  if (id === undefined) return 0;
  if (prefs.length === 0) return 0.5; // indifferent
  const idx = prefs.indexOf(id);
  return idx === -1 ? 1 : idx / prefs.length;
}

function buildContext(input: SolveInput): Ctx {
  const days = Math.max(
    1,
    Math.round((isoToUtc(input.periodEnd) - isoToUtc(input.periodStart)) / 86400000) + 1,
  );
  const numWeeks = Math.max(1, Math.ceil(days / 7));

  const tas = input.taProfiles;
  const taById = new Map(tas.map((t) => [t.id, t]));
  const taIndex = new Map(tas.map((t, i) => [t.id, i]));
  const taIds = tas.map((t) => t.id);

  const shiftById = new Map(input.shifts.map((s) => [s.id, s]));
  const syncShifts = input.shifts.filter(
    (s): s is SyncShift => s.kind === "weekly_sync" || s.kind === "once_sync",
  );
  const asyncShifts = input.shifts.filter((s): s is AsyncShift => s.kind === "async");
  const windowShifts = input.shifts
    .filter((s): s is WindowShift => s.kind === "window")
    .sort(
      (a, b) =>
        DAY_ORDER[a.day] - DAY_ORDER[b.day] || a.startMin - b.startMin || a.id.localeCompare(b.id),
    );

  // Availability indexes. Semantics: unpainted time is UNAVAILABLE. A TA can
  // take a sync shift only if the window is FULLY covered by "available" or
  // "prefer_not" blocks (coverage), AND no "unavailable" block overlaps it.
  const unavail = new Map<string, Map<Day, Array<[number, number]>>>();
  const preferNot = new Map<string, Map<Day, Array<[number, number]>>>();
  const coverage = new Map<string, Map<Day, Array<[number, number]>>>();
  const pushBlock = (
    target: Map<string, Map<Day, Array<[number, number]>>>,
    taId: string,
    day: Day,
    s: number,
    e: number,
  ) => {
    let byDay = target.get(taId);
    if (!byDay) target.set(taId, (byDay = new Map()));
    let arr = byDay.get(day);
    if (!arr) byDay.set(day, (arr = []));
    arr.push([s, e]);
  };
  for (const b of input.availability) {
    if (b.status === "unavailable") {
      pushBlock(unavail, b.taProfileId, b.day, b.startMin, b.endMin);
    } else {
      pushBlock(coverage, b.taProfileId, b.day, b.startMin, b.endMin);
      if (b.status === "prefer_not") {
        pushBlock(preferNot, b.taProfileId, b.day, b.startMin, b.endMin);
      }
    }
  }
  // Pre-sort coverage intervals so coverage checks are a single sweep.
  for (const byDay of coverage.values()) {
    for (const arr of byDay.values()) arr.sort((a, b) => a[0] - b[0]);
  }
  const coversWindow = (taId: string, day: Day, s: number, e: number): boolean => {
    // A TA who has painted nothing has told us nothing, and is assumed free
    // rather than left out of every shift; their class times still bind via
    // the unavailable index. See convex/lib/availability.ts for the rule.
    if (!coverage.has(taId)) return true;
    const arr = coverage.get(taId)?.get(day);
    if (!arr) return false;
    let cur = s;
    for (const [bs, be] of arr) {
      if (bs > cur) break; // gap before `cur` — window not covered
      if (be > cur) cur = be;
      if (cur >= e) return true;
    }
    return cur >= e;
  };
  const overlapsBlocks = (
    m: Map<string, Map<Day, Array<[number, number]>>>,
    taId: string,
    day: Day,
    s: number,
    e: number,
  ): boolean => {
    const arr = m.get(taId)?.get(day);
    if (!arr) return false;
    for (const [bs, be] of arr) if (timeOverlap(s, e, bs, be)) return true;
    return false;
  };

  const preferNotMinutesOf = (taId: string, day: Day, s: number, e: number): number => {
    const arr = preferNot.get(taId)?.get(day);
    if (!arr) return 0;
    let total = 0;
    for (const [bs, be] of arr) {
      const lo = Math.max(bs, s);
      const hi = Math.min(be, e);
      if (hi > lo) total += hi - lo;
    }
    return total;
  };

  const exceptions = new Map<string, Array<[string, string]>>();
  for (const ex of input.dateExceptions) {
    let arr = exceptions.get(ex.taProfileId);
    if (!arr) exceptions.set(ex.taProfileId, (arr = []));
    arr.push([ex.startDate, ex.endDate]);
  }
  const exceptionCovers = (taId: string, date: string): boolean => {
    const arr = exceptions.get(taId);
    if (!arr) return false;
    for (const [s, e] of arr) if (s <= date && date <= e) return true;
    return false;
  };

  // Static eligibility + pair costs
  const eligible = new Map<string, string[]>();
  const eligibleSet = new Map<string, Set<string>>();
  const syncPairCost = new Map<string, Float64Array>();
  for (const s of syncShifts) {
    const elig: string[] = [];
    const row = new Float64Array(tas.length);
    for (let i = 0; i < tas.length; i++) {
      const ta = tas[i];
      const covered = coversWindow(ta.id, s.day, s.startMin, s.endMin);
      const blockedUnavail = overlapsBlocks(unavail, ta.id, s.day, s.startMin, s.endMin);
      const blockedEx = s.kind === "once_sync" && exceptionCovers(ta.id, s.date);
      if (covered && !blockedUnavail && !blockedEx) elig.push(ta.id);
      let c =
        W.SECTION * rankPenalty(ta.sectionPrefs, "sectionId" in s ? s.sectionId : undefined) +
        W.DUTY * rankPenalty(ta.dutyTypePrefs, s.dutyTypeId) +
        W.SLIDER * ta.syncAsyncPreference;
      if (overlapsBlocks(preferNot, ta.id, s.day, s.startMin, s.endMin)) c += W.PREFER_NOT;
      row[i] = c;
    }
    elig.sort();
    eligible.set(s.id, elig);
    eligibleSet.set(s.id, new Set(elig));
    syncPairCost.set(s.id, row);
  }

  const asyncPerHour = new Map<string, Float64Array>();
  for (const s of asyncShifts) {
    const row = new Float64Array(tas.length);
    for (let i = 0; i < tas.length; i++) {
      const ta = tas[i];
      row[i] =
        (W.DUTY * rankPenalty(ta.dutyTypePrefs, s.dutyTypeId) +
          W.SLIDER * (1 - ta.syncAsyncPreference)) *
        W.HOUR_SCALE;
    }
    asyncPerHour.set(s.id, row);
  }

  return {
    numWeeks,
    tas,
    taById,
    taIndex,
    taIds,
    shiftById,
    syncShifts,
    asyncShifts,
    windowShifts,
    maxPerTaByDuty: input.maxPerTaByDuty ?? {},
    coversWindow,
    overlapsUnavail: (taId, day, s, e) => overlapsBlocks(unavail, taId, day, s, e),
    preferNotMinutes: preferNotMinutesOf,
    eligible,
    eligibleSet,
    syncPairCost,
    asyncPerHour,
    lockedSync: new Set(),
    lockedAsync: new Map(),
    input,
  };
}

// ---------------------------------------------------------------------------
// State ops
// ---------------------------------------------------------------------------

function createState(ctx: Ctx): State {
  const state: State = {
    windowBlocks: [],
    syncByShift: new Map(),
    asyncByShift: new Map(),
    taSyncShifts: new Map(),
    loads: new Map(),
  };
  for (const s of ctx.syncShifts) state.syncByShift.set(s.id, []);
  for (const s of ctx.asyncShifts) state.asyncByShift.set(s.id, new Map());
  for (const ta of ctx.tas) {
    state.taSyncShifts.set(ta.id, []);
    state.loads.set(ta.id, { weeklyMin: 0, onceMin: 0, asyncHours: 0 });
  }
  return state;
}

function weeklyHoursOf(ctx: Ctx, load: Load): number {
  return load.weeklyMin / 60 + (load.onceMin / 60 + load.asyncHours) / ctx.numWeeks;
}

function addSync(_ctx: Ctx, state: State, shift: SyncShift, taId: string): void {
  state.syncByShift.get(shift.id)!.push(taId);
  state.taSyncShifts.get(taId)!.push(shift.id);
  const load = state.loads.get(taId)!;
  const dur = shift.endMin - shift.startMin;
  if (shift.kind === "weekly_sync") load.weeklyMin += dur;
  else load.onceMin += dur;
}

function removeSync(_ctx: Ctx, state: State, shift: SyncShift, taId: string): void {
  const arr = state.syncByShift.get(shift.id)!;
  const i = arr.indexOf(taId);
  if (i >= 0) arr.splice(i, 1);
  const tarr = state.taSyncShifts.get(taId)!;
  const j = tarr.indexOf(shift.id);
  if (j >= 0) tarr.splice(j, 1);
  const load = state.loads.get(taId)!;
  const dur = shift.endMin - shift.startMin;
  if (shift.kind === "weekly_sync") load.weeklyMin -= dur;
  else load.onceMin -= dur;
}

function setAsyncHours(state: State, shiftId: string, taId: string, hours: number): void {
  const m = state.asyncByShift.get(shiftId)!;
  const prev = m.get(taId) ?? 0;
  if (hours <= EPS) m.delete(taId);
  else m.set(taId, hours);
  state.loads.get(taId)!.asyncHours += hours - prev;
}

function asyncCapacity(ctx: Ctx, state: State, taId: string): number {
  const ta = ctx.taById.get(taId)!;
  const free = ta.maxHoursPerWeek - weeklyHoursOf(ctx, state.loads.get(taId)!);
  return Math.max(0, free * ctx.numWeeks);
}

function canAddSync(ctx: Ctx, state: State, shift: SyncShift, taId: string): boolean {
  if (!ctx.eligibleSet.get(shift.id)!.has(taId)) return false;
  const arr = state.syncByShift.get(shift.id)!;
  if (arr.includes(taId)) return false;
  // A duty-type cap: "one discussion per TA". Locked placements are forced
  // through applyLocked and never come here, so a coordinator's hand
  // placement can exceed it; the solver's own choices cannot.
  const cap = ctx.maxPerTaByDuty[shift.dutyTypeId];
  if (cap !== undefined) {
    let held = 0;
    for (const sid of state.taSyncShifts.get(taId)!) {
      if ((ctx.shiftById.get(sid) as SyncShift).dutyTypeId === shift.dutyTypeId) held++;
    }
    if (held >= cap) return false;
  }
  for (const sid of state.taSyncShifts.get(taId)!) {
    if (syncShiftsConflict(shift, ctx.shiftById.get(sid) as SyncShift)) return false;
  }
  const ta = ctx.taById.get(taId)!;
  const load = state.loads.get(taId)!;
  const dur = shift.endMin - shift.startMin;
  const addWeekly =
    shift.kind === "weekly_sync" ? dur / 60 : dur / 60 / ctx.numWeeks;
  return weeklyHoursOf(ctx, load) + addWeekly <= ta.maxHoursPerWeek + 1e-9;
}

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

function computeCost(ctx: Ctx, state: State): number {
  let cost = 0;
  for (const s of ctx.syncShifts) {
    const arr = state.syncByShift.get(s.id)!;
    const missing = s.requiredCount - arr.length;
    if (missing > 0) cost += W.FILL_PERSON * missing;
    const row = ctx.syncPairCost.get(s.id)!;
    for (const taId of arr) cost += row[ctx.taIndex.get(taId)!];
  }
  for (const s of ctx.asyncShifts) {
    const m = state.asyncByShift.get(s.id)!;
    const row = ctx.asyncPerHour.get(s.id)!;
    let alloc = 0;
    for (const [taId, h] of m) {
      alloc += h;
      cost += row[ctx.taIndex.get(taId)!] * h;
    }
    const missing = s.hoursRequired - alloc;
    if (missing > EPS) cost += W.FILL_HOUR * missing;
  }
  // (5) balance
  if (ctx.tas.length > 0) {
    let total = 0;
    const hrs: number[] = [];
    for (const ta of ctx.tas) {
      const h = weeklyHoursOf(ctx, state.loads.get(ta.id)!);
      hrs.push(h);
      total += h;
    }
    const mean = total / ctx.tas.length;
    for (const h of hrs) cost += W.BALANCE * (h - mean) * (h - mean);
  }
  // (6) day clustering
  for (const ta of ctx.tas) {
    const sids = state.taSyncShifts.get(ta.id)!;
    if (sids.length < 2) continue;
    const days = new Set<string>();
    for (const sid of sids) days.add((ctx.shiftById.get(sid) as SyncShift).day);
    cost += W.CLUSTER * (days.size - 1);
  }
  return cost;
}

// ---------------------------------------------------------------------------
// Locked assignments
// ---------------------------------------------------------------------------

function applyLocked(
  ctx: Ctx,
  state: State,
): SolveDiagnostics["hardViolations"] {
  const violations: SolveDiagnostics["hardViolations"] = [];
  const seen = new Set<string>();
  for (const la of ctx.input.lockedAssignments) {
    const key = pairKey(la.shiftId, la.taProfileId);
    if (seen.has(key)) continue;
    seen.add(key);
    const shift = ctx.shiftById.get(la.shiftId);
    const ta = ctx.taById.get(la.taProfileId);
    if (!shift || !ta) {
      violations.push({
        shiftId: la.shiftId,
        taProfileId: la.taProfileId,
        reason: !shift ? "locked assignment references unknown shift" : "locked assignment references unknown TA",
      });
      continue;
    }
    if (shift.kind === "window") continue; // blocks are pinned via lockedWindowBlocks
    if (shift.kind === "async") {
      const hours = Math.max(0, la.hoursAllocated ?? 0);
      const m = state.asyncByShift.get(shift.id)!;
      const cap = asyncCapacity(ctx, state, ta.id);
      if (hours > cap + 1e-9) {
        violations.push({ shiftId: shift.id, taProfileId: ta.id, reason: "locked hours exceed maxHoursPerWeek" });
      }
      if (!m.has(ta.id) && m.size >= shift.requiredCount) {
        violations.push({ shiftId: shift.id, taProfileId: ta.id, reason: "locked assignments exceed async TA limit (requiredCount)" });
      }
      setAsyncHours(state, shift.id, ta.id, (m.get(ta.id) ?? 0) + hours);
      ctx.lockedAsync.set(key, hours);
    } else {
      const reasons: string[] = [];
      if (!ctx.eligibleSet.get(shift.id)!.has(ta.id)) {
        reasons.push(
          shift.kind === "once_sync" &&
            ctx.input.dateExceptions.some(
              (ex) => ex.taProfileId === ta.id && ex.startDate <= shift.date && shift.date <= ex.endDate,
            )
            ? "blocked by date exception"
            : "shift window not covered by availability (or overlaps unavailable block)",
        );
      }
      for (const sid of state.taSyncShifts.get(ta.id)!) {
        if (syncShiftsConflict(shift, ctx.shiftById.get(sid) as SyncShift)) {
          reasons.push(`overlaps sync assignment on shift ${sid}`);
          break;
        }
      }
      const dur = (shift.endMin - shift.startMin) / 60;
      const addWeekly = shift.kind === "weekly_sync" ? dur : dur / ctx.numWeeks;
      if (
        weeklyHoursOf(ctx, state.loads.get(ta.id)!) + addWeekly >
        ta.maxHoursPerWeek + 1e-9
      ) {
        reasons.push("exceeds maxHoursPerWeek");
      }
      addSync(ctx, state, shift, ta.id); // forced: locked is immutable
      ctx.lockedSync.add(key);
      for (const reason of reasons) {
        violations.push({ shiftId: shift.id, taProfileId: ta.id, reason });
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Greedy construction
// ---------------------------------------------------------------------------

function greedySyncOrder(ctx: Ctx): SyncShift[] {
  return [...ctx.syncShifts].sort((a, b) => {
    const ea = ctx.eligible.get(a.id)!.length;
    const eb = ctx.eligible.get(b.id)!.length;
    if (ea !== eb) return ea - eb; // most constrained first
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function greedyFillSync(ctx: Ctx, state: State): void {
  for (const s of greedySyncOrder(ctx)) {
    const row = ctx.syncPairCost.get(s.id)!;
    let needed = s.requiredCount - state.syncByShift.get(s.id)!.length;
    while (needed > 0) {
      let best: string | null = null;
      let bestScore = Infinity;
      for (const taId of ctx.eligible.get(s.id)!) {
        if (!canAddSync(ctx, state, s, taId)) continue;
        let score =
          row[ctx.taIndex.get(taId)!] +
          2 * weeklyHoursOf(ctx, state.loads.get(taId)!);
        // cluster bonus: prefer a TA who already works this day
        for (const sid of state.taSyncShifts.get(taId)!) {
          if ((ctx.shiftById.get(sid) as SyncShift).day === s.day) {
            score -= W.CLUSTER;
            break;
          }
        }
        if (score < bestScore - 1e-12) {
          bestScore = score;
          best = taId;
        }
      }
      if (best === null) break;
      addSync(ctx, state, s, best);
      needed--;
    }
  }
}

function greedyFillAsync(ctx: Ctx, state: State): void {
  const sorted = [...ctx.asyncShifts].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const s of sorted) {
    const m = state.asyncByShift.get(s.id)!;
    const row = ctx.asyncPerHour.get(s.id)!;
    let allocated = 0;
    for (const h of m.values()) allocated += h;
    let remaining = s.hoursRequired - allocated;
    if (remaining <= EPS) continue;
    const slots = Math.max(0, s.requiredCount - m.size);
    const newbies = ctx.taIds
      .filter((id) => !m.has(id) && asyncCapacity(ctx, state, id) > EPS)
      .sort((a, b) => {
        const ca = row[ctx.taIndex.get(a)!];
        const cb = row[ctx.taIndex.get(b)!];
        if (ca !== cb) return ca - cb;
        return a < b ? -1 : 1;
      })
      .slice(0, slots);
    const chosen = [...m.keys(), ...newbies];
    let guard = chosen.length + 2;
    while (remaining > EPS && guard-- > 0) {
      const withCap = chosen.filter((id) => asyncCapacity(ctx, state, id) > EPS);
      if (withCap.length === 0) break;
      const share = remaining / withCap.length;
      for (const id of withCap) {
        const add = Math.min(share, asyncCapacity(ctx, state, id));
        setAsyncHours(state, s.id, id, (m.get(id) ?? 0) + add);
        remaining -= add;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Simulated annealing
// ---------------------------------------------------------------------------

function snapshot(state: State): State {
  return {
    windowBlocks: [...state.windowBlocks],
    syncByShift: new Map([...state.syncByShift].map(([k, v]) => [k, v.slice()])),
    asyncByShift: new Map([...state.asyncByShift].map(([k, v]) => [k, new Map(v)])),
    taSyncShifts: new Map([...state.taSyncShifts].map(([k, v]) => [k, v.slice()])),
    loads: new Map([...state.loads].map(([k, v]) => [k, { ...v }])),
  };
}

function restore(state: State, snap: State): void {
  state.windowBlocks = [...snap.windowBlocks];
  const c = snapshot(snap);
  state.syncByShift = c.syncByShift;
  state.asyncByShift = c.asyncByShift;
  state.taSyncShifts = c.taSyncShifts;
  state.loads = c.loads;
}

type Undo = () => void;

function proposeSyncMove(ctx: Ctx, state: State, rnd: () => number): Undo | null {
  const s = ctx.syncShifts[Math.floor(rnd() * ctx.syncShifts.length)];
  const arr = state.syncByShift.get(s.id)!;
  const cands = ctx.eligible.get(s.id)!;
  if (arr.length < s.requiredCount && rnd() < 0.7) {
    // try to fill a vacancy
    if (cands.length === 0) return null;
    const start = Math.floor(rnd() * cands.length);
    for (let k = 0; k < cands.length; k++) {
      const taId = cands[(start + k) % cands.length];
      if (canAddSync(ctx, state, s, taId)) {
        addSync(ctx, state, s, taId);
        return () => removeSync(ctx, state, s, taId);
      }
    }
    return null;
  }
  const removable = arr.filter((t) => !ctx.lockedSync.has(pairKey(s.id, t)));
  if (removable.length === 0) return null;
  const out = removable[Math.floor(rnd() * removable.length)];
  removeSync(ctx, state, s, out);
  if (rnd() < 0.9 && cands.length > 0) {
    const start = Math.floor(rnd() * cands.length);
    for (let k = 0; k < cands.length; k++) {
      const taId = cands[(start + k) % cands.length];
      if (taId === out) continue;
      if (canAddSync(ctx, state, s, taId)) {
        addSync(ctx, state, s, taId);
        return () => {
          removeSync(ctx, state, s, taId);
          addSync(ctx, state, s, out);
        };
      }
    }
  }
  // pure removal (escape move)
  return () => addSync(ctx, state, s, out);
}

function proposeAsyncMove(ctx: Ctx, state: State, rnd: () => number): Undo | null {
  const s = ctx.asyncShifts[Math.floor(rnd() * ctx.asyncShifts.length)];
  const m = state.asyncByShift.get(s.id)!;
  let alloc = 0;
  for (const h of m.values()) alloc += h;
  if (alloc < s.hoursRequired - EPS && rnd() < 0.6) {
    // add hours to some TA with capacity
    const start = Math.floor(rnd() * ctx.taIds.length);
    for (let k = 0; k < ctx.taIds.length; k++) {
      const taId = ctx.taIds[(start + k) % ctx.taIds.length];
      if (!m.has(taId) && m.size >= s.requiredCount) continue;
      const cap = asyncCapacity(ctx, state, taId);
      if (cap <= EPS) continue;
      const prev = m.get(taId) ?? 0;
      const add = Math.min(s.hoursRequired - alloc, cap);
      setAsyncHours(state, s.id, taId, prev + add);
      return () => setAsyncHours(state, s.id, taId, prev);
    }
    return null;
  }
  // move hours donor -> recipient
  const donors: Array<[string, number]> = [];
  for (const [t, h] of m) {
    const movable = h - (ctx.lockedAsync.get(pairKey(s.id, t)) ?? 0);
    if (movable > EPS) donors.push([t, movable]);
  }
  if (donors.length === 0) return null;
  const [donor, movable] = donors[Math.floor(rnd() * donors.length)];
  const want = movable * (0.25 + 0.75 * rnd());
  const start = Math.floor(rnd() * ctx.taIds.length);
  for (let k = 0; k < ctx.taIds.length; k++) {
    const taId = ctx.taIds[(start + k) % ctx.taIds.length];
    if (taId === donor) continue;
    if (!m.has(taId) && m.size >= s.requiredCount) continue;
    const cap = asyncCapacity(ctx, state, taId);
    if (cap <= EPS) continue;
    const amt = Math.min(want, cap);
    if (amt <= EPS) continue;
    const prevDonor = m.get(donor)!;
    const prevRecip = m.get(taId) ?? 0;
    setAsyncHours(state, s.id, donor, prevDonor - amt);
    setAsyncHours(state, s.id, taId, prevRecip + amt);
    return () => {
      setAsyncHours(state, s.id, taId, prevRecip);
      setAsyncHours(state, s.id, donor, prevDonor);
    };
  }
  return null;
}

function anneal(ctx: Ctx, state: State): void {
  if (ctx.tas.length === 0) return;
  if (ctx.syncShifts.length === 0 && ctx.asyncShifts.length === 0) return;
  const rnd = mulberry32(42);
  let cost = computeCost(ctx, state);
  let best = snapshot(state);
  let bestCost = cost;
  let T = SA_T0;
  for (let i = 0; i < SA_ITERS; i++, T *= SA_COOL) {
    const useSync =
      ctx.syncShifts.length > 0 && (ctx.asyncShifts.length === 0 || rnd() < 0.75);
    const undo = useSync
      ? proposeSyncMove(ctx, state, rnd)
      : proposeAsyncMove(ctx, state, rnd);
    if (!undo) continue;
    const newCost = computeCost(ctx, state);
    const d = newCost - cost;
    if (d <= 0 || rnd() < Math.exp(-d / T)) {
      cost = newCost;
      if (cost < bestCost - 1e-9) {
        bestCost = cost;
        best = snapshot(state);
      }
    } else {
      undo();
    }
  }
  restore(state, best);
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Office-hour windows
// ---------------------------------------------------------------------------

/**
 * Cut each TA's weekly office-hour requirement into blocks inside the
 * windows the coordinator opened.
 *
 * Runs after the sync and async fills, on the loads they left, so office
 * hours land in the gaps rather than the other way round — a discussion
 * section meets when it meets; office hours can move. For each window duty
 * type, TAs are taken lightest-loaded first, and for each the largest block
 * their style allows is placed where it costs least: no prefer_not time if
 * possible, and for "many_short" a day they are not already holding hours
 * on. Window capacity (`requiredCount` TAs at once), the TA's own sync
 * shifts, class times, unavailable blocks and weekly cap are all hard.
 *
 * Deterministic: ties go to the earliest day and time, then window id.
 */
function fillWindows(ctx: Ctx, state: State): SolveDiagnostics["unfilledWindowHours"] {
  const unfilled: SolveDiagnostics["unfilledWindowHours"] = [];
  if (ctx.windowShifts.length === 0) return unfilled;
  const hoursPerTa = ctx.input.windowHoursPerTa ?? {};
  const hoursPerTaMin = ctx.input.windowHoursPerTaMin ?? {};
  const minBlockByDuty = ctx.input.windowMinBlockMin ?? {};
  const blackoutByDuty = ctx.input.windowBlackouts ?? {};

  /** Shortest block worth holding, snapped to the half-hour grid. */
  const minBlockOf = (dutyId: string): number => {
    const raw = minBlockByDuty[dutyId] ?? DEFAULT_MIN_BLOCK;
    return Math.max(SLOT, Math.round(raw / SLOT) * SLOT);
  };
  // Nobody comes to office hours held during the lecture, and the TA holding
  // them is usually in it. This is a rule about the hour, not about one TA:
  // `busy` below only knows the TA's own shifts.
  const blockedByDuty = (dutyId: string, day: Day, s: number, e: number): boolean => {
    for (const b of blackoutByDuty[dutyId] ?? []) {
      if (b.day === day && timeOverlap(s, e, b.startMin, b.endMin)) return true;
    }
    return false;
  };

  const occupancy = new Map<string, Int32Array>();
  for (const w of ctx.windowShifts) {
    occupancy.set(w.id, new Int32Array(Math.max(0, Math.ceil((w.endMin - w.startMin) / SLOT))));
  }
  const slotIndex = (w: WindowShift, min: number) => Math.floor((min - w.startMin) / SLOT);

  const blocksOf = new Map<string, SolvedWindowBlock[]>();
  const busy = (taId: string, day: Day, s: number, e: number): boolean => {
    for (const sid of state.taSyncShifts.get(taId) ?? []) {
      const sh = ctx.shiftById.get(sid) as SyncShift | undefined;
      if (sh && sh.day === day && timeOverlap(s, e, sh.startMin, sh.endMin)) return true;
    }
    for (const b of blocksOf.get(taId) ?? []) {
      if (b.day === day && timeOverlap(s, e, b.startMin, b.endMin)) return true;
    }
    return false;
  };
  const place = (w: WindowShift, taId: string, s: number, e: number, locked: boolean) => {
    const occ = occupancy.get(w.id)!;
    for (let i = slotIndex(w, s); i < slotIndex(w, e); i++) occ[i] += 1;
    const block: SolvedWindowBlock = {
      windowShiftId: w.id,
      dutyTypeId: w.dutyTypeId,
      taProfileId: taId,
      day: w.day,
      startMin: s,
      endMin: e,
      locked,
    };
    state.windowBlocks.push(block);
    let mine = blocksOf.get(taId);
    if (!mine) blocksOf.set(taId, (mine = []));
    mine.push(block);
    const load = state.loads.get(taId);
    if (load) load.weeklyMin += e - s;
  };

  /** Undo a placement, so a TA's week can be re-cut and compared. */
  const unplace = (block: SolvedWindowBlock) => {
    const w = ctx.shiftById.get(block.windowShiftId);
    if (!w || w.kind !== "window") return;
    const occ = occupancy.get(w.id)!;
    for (let i = slotIndex(w, block.startMin); i < slotIndex(w, block.endMin); i++) {
      occ[i] -= 1;
    }
    const load = state.loads.get(block.taProfileId);
    if (load) load.weeklyMin -= block.endMin - block.startMin;
    const all = state.windowBlocks.indexOf(block);
    if (all >= 0) state.windowBlocks.splice(all, 1);
    const mine = blocksOf.get(block.taProfileId);
    const at = mine?.indexOf(block) ?? -1;
    if (mine && at >= 0) mine.splice(at, 1);
  };

  // Pinned blocks first: they consume capacity and count toward the owner.
  for (const lb of ctx.input.lockedWindowBlocks ?? []) {
    const w = ctx.shiftById.get(lb.windowShiftId);
    if (!w || w.kind !== "window" || !ctx.taById.has(lb.taProfileId)) continue;
    place(w, lb.taProfileId, lb.startMin, lb.endMin, true);
  }

  const dutyIds = [...new Set(ctx.windowShifts.map((w) => w.dutyTypeId))].sort();
  for (const dutyId of dutyIds) {
    const targetMin = Math.round((hoursPerTa[dutyId] ?? 0) * 60);
    // The fewest a TA must end up with. Everything between this and the
    // target is optional, and only taken in the shape they asked for.
    const requiredHoursMin = Math.min(
      Math.round((hoursPerTaMin[dutyId] ?? hoursPerTa[dutyId] ?? 0) * 60),
      targetMin,
    );
    const windows = ctx.windowShifts.filter((w) => w.dutyTypeId === dutyId);
    // Nobody owes hours and no window asks to be covered: nothing to cut.
    if (targetMin <= 0 && !windows.some((w) => (w.minCount ?? 0) > 0)) continue;
    const minBlock = minBlockOf(dutyId);
    const tas = [...ctx.tas].sort((a, b) => a.id.localeCompare(b.id));

    // "few_long" reaches for two-hour blocks and settles for less;
    // "many_short" never holds more than an hour at a stretch. Neither goes
    // below the minimum the coordinator set, even if that means the last
    // sliver of a TA's requirement goes unplaced and gets reported.
    const styleOf = (ta: SolverTaProfile) => ta.officeHoursStyle ?? "few_long";
    const maxSizeOf = (ta: SolverTaProfile) =>
      Math.max(styleOf(ta) === "few_long" ? 120 : 60, minBlock);
    const sizesOf = (ta: SolverTaProfile) => {
      const out: number[] = [];
      for (let s = maxSizeOf(ta); s >= minBlock; s -= SIZE_STEP) out.push(s);
      return out;
    };

    const need = new Map<string, number>();
    for (const ta of tas) {
      const held = (blocksOf.get(ta.id) ?? [])
        .filter((b) => b.dutyTypeId === dutyId)
        .reduce((n, b) => n + (b.endMin - b.startMin), 0);
      need.set(ta.id, targetMin - held);
    }

    type Placement = { w: WindowShift; s: number; e: number; score: number };

    /**
     * How much this candidate piles onto hours that are already staffed.
     *
     * Without it the generator takes the first legal slot every time, so a
     * week of office hours ends up stacked at the top of each window with
     * whole afternoons empty. Same hour on the same day costs most, the same
     * hour on another day next, and merely being on a day that already has
     * blocks costs a little — enough to walk hours across the day and week.
     */
    const spreadPenalty = (day: Day, start: number, end: number): number => {
      let penalty = 0;
      for (const b of state.windowBlocks) {
        if (b.dutyTypeId !== dutyId) continue;
        const overlap = Math.min(b.endMin, end) - Math.max(b.startMin, start);
        if (b.day === day) {
          penalty += OH.SAME_DAY;
          if (overlap > 0) penalty += (overlap / SLOT) * OH.STACK;
          else {
            // Butting one block against another leaves the rest of the day
            // empty just as surely as stacking them does.
            const gap = -overlap;
            if (gap < OH.NEAR_REACH) penalty += ((OH.NEAR_REACH - gap) / SLOT) * OH.NEAR;
          }
        } else if (overlap > 0) {
          penalty += (overlap / SLOT) * OH.SAME_TIME;
        }
      }
      return penalty;
    };
    /**
     * Where this TA could go right now, at the largest size that fits
     * anywhere, with how many such slots exist. The count is what makes the
     * ordering below possible.
     */
    const optionsFor = (ta: SolverTaProfile): { best: Placement; count: number } | null => {
      const want = need.get(ta.id) ?? 0;
      const style = styleOf(ta);
      // Past the fewest hours they must have, a "few long blocks" TA takes
      // only a full-length block: an hour tacked on the end is the shape
      // they said they did not want, and the range says they may go without
      // it. A "many short" TA wants every block they can get, so nothing is
      // withheld from them.
      const optional = targetMin - want >= requiredHoursMin;
      const sizes =
        optional && style === "few_long" ? [maxSizeOf(ta)] : sizesOf(ta);
      for (const size of sizes) {
        if (size > want) continue;
        let best: Placement | null = null;
        let count = 0;
        for (const w of windows) {
          const occ = occupancy.get(w.id)!;
          for (let start = w.startMin; start + size <= w.endMin; start += SLOT) {
            const end = start + size;
            let room = true;
            for (let i = slotIndex(w, start); i < slotIndex(w, end); i++) {
              if (occ[i] >= w.requiredCount) {
                room = false;
                break;
              }
            }
            if (!room) continue;
            if (blockedByDuty(dutyId, w.day, start, end)) continue;
            if (!ctx.coversWindow(ta.id, w.day, start, end)) continue;
            if (ctx.overlapsUnavail(ta.id, w.day, start, end)) continue;
            if (busy(ta.id, w.day, start, end)) continue;
            const load = state.loads.get(ta.id)!;
            if (weeklyHoursOf(ctx, load) + size / 60 > ta.maxHoursPerWeek + 1e-9) continue;

            count += 1;
            // Hours a TA owes go where the window is thinnest first. This is
            // what "at least one TA on duty" buys: not extra hours, but the
            // ones already owed landing on the empty stretches.
            let uncovered = 0;
            const floor = Math.min(w.minCount ?? 0, w.requiredCount);
            if (floor > 0) {
              for (let i = slotIndex(w, start); i < slotIndex(w, end); i++) {
                if (occ[i] < floor) uncovered += 1;
              }
            }
            let score =
              ctx.preferNotMinutes(ta.id, w.day, start, end) * OH.PREFER_NOT +
              spreadPenalty(w.day, start, end) -
              uncovered * OH.COVER;
            if (
              style === "many_short" &&
              (blocksOf.get(ta.id) ?? []).some((b) => b.day === w.day && b.dutyTypeId === dutyId)
            ) {
              score += 10000; // one TA's short blocks go on different days
            }
            if (best === null || score < best.score) best = { w, s: start, e: end, score };
          }
        }
        if (best !== null) return { best, count };
      }
      return null;
    };

    /**
     * Most constrained first.
     *
     * Going in order of who is least loaded reads as fair and is not: a TA
     * with one legal hour in the whole week loses it to a TA with thirty who
     * happened to be lighter, and ends up with nothing while the other could
     * have gone anywhere. Whoever has the fewest places to stand is served
     * first; load only breaks ties.
     */
    for (;;) {
      let pick: { ta: SolverTaProfile; opt: { best: Placement; count: number } } | null = null;
      for (const ta of tas) {
        if ((need.get(ta.id) ?? 0) < minBlock) continue;
        const opt = optionsFor(ta);
        if (opt === null) continue;
        if (pick === null) {
          pick = { ta, opt };
          continue;
        }
        const load = weeklyHoursOf(ctx, state.loads.get(ta.id)!);
        const bestLoad = weeklyHoursOf(ctx, state.loads.get(pick.ta.id)!);
        if (
          opt.count < pick.opt.count ||
          (opt.count === pick.opt.count &&
            (load < bestLoad - 1e-9 ||
              (Math.abs(load - bestLoad) <= 1e-9 && ta.id.localeCompare(pick.ta.id) < 0)))
        ) {
          pick = { ta, opt };
        }
      }
      if (pick === null) break;
      const { best } = pick.opt;
      place(best.w, pick.ta.id, best.s, best.e, false);
      need.set(pick.ta.id, (need.get(pick.ta.id) ?? 0) - (best.e - best.s));
    }

    /**
     * Re-cut one TA's week, now that everybody has been placed.
     *
     * Placing a block at a time is greedy: an hour taken early can leave a
     * two-hour stretch it half-covers unusable, and the TA ends up with two
     * blocks where one would have done. So each TA's own blocks come back
     * out and are laid again from scratch — first as one block, then two,
     * and so on — against everyone else's, which stay put. The result is
     * kept only if it is fewer blocks, or the same number holding more
     * hours. Nobody else's week can get worse for it.
     */
    const recut = (ta: SolverTaProfile) => {
      const mine = (blocksOf.get(ta.id) ?? []).filter(
        (b) => b.dutyTypeId === dutyId && !b.locked,
      );
      if (mine.length < 2) return; // one block cannot be improved on
      const held = mine.reduce((n, b) => n + (b.endMin - b.startMin), 0);
      const original = mine.map((b) => ({
        w: ctx.shiftById.get(b.windowShiftId) as WindowShift,
        s: b.startMin,
        e: b.endMin,
      }));
      for (const b of mine) unplace(b);

      /** Lay `limit` blocks, longest first, and say what they came to. */
      const layOut = (limit: number): Placement[] => {
        const chosen: Placement[] = [];
        let budget = targetMin;
        for (let n = 0; n < limit; n++) {
          let best: Placement | null = null;
          for (const size of sizesOf(ta)) {
            if (size > budget) continue;
            for (const w of windows) {
              const occ = occupancy.get(w.id)!;
              for (let start = w.startMin; start + size <= w.endMin; start += SLOT) {
                const end = start + size;
                let room = true;
                for (let i = slotIndex(w, start); i < slotIndex(w, end); i++) {
                  if (occ[i] >= w.requiredCount) {
                    room = false;
                    break;
                  }
                }
                if (!room) continue;
                if (chosen.some((c) => c.w.day === w.day && timeOverlap(c.s, c.e, start, end))) {
                  continue;
                }
                if (blockedByDuty(dutyId, w.day, start, end)) continue;
                if (!ctx.coversWindow(ta.id, w.day, start, end)) continue;
                if (ctx.overlapsUnavail(ta.id, w.day, start, end)) continue;
                if (busy(ta.id, w.day, start, end)) continue;
                const load = state.loads.get(ta.id)!;
                const soFar = chosen.reduce((n2, c) => n2 + (c.e - c.s), 0);
                if (
                  weeklyHoursOf(ctx, load) + (soFar + size) / 60 >
                  ta.maxHoursPerWeek + 1e-9
                ) {
                  continue;
                }
                const score =
                  ctx.preferNotMinutes(ta.id, w.day, start, end) * OH.PREFER_NOT +
                  spreadPenalty(w.day, start, end) +
                  (chosen.some((c) => c.w.day === w.day) ? OH.SAME_DAY : 0);
                if (best === null || score < best.score) best = { w, s: start, e: end, score };
              }
            }
            if (best) break; // longest size that fits anywhere
          }
          const pick = best as Placement | null;
          if (pick === null) break;
          chosen.push(pick);
          budget -= pick.e - pick.s;
        }
        return chosen;
      };

      let winner: Placement[] | null = null;
      for (let limit = 1; limit < mine.length; limit++) {
        const attempt = layOut(limit);
        const total = attempt.reduce((n, c) => n + (c.e - c.s), 0);
        if (total < Math.max(requiredHoursMin, held)) continue;
        winner = attempt;
        break; // fewer blocks is the whole point; stop at the first that works
      }

      for (const p of winner ?? original) place(p.w, ta.id, p.s, p.e, false);
      if (winner) {
        const total = winner.reduce((n, c) => n + (c.e - c.s), 0);
        need.set(ta.id, targetMin - total);
      }
    };
    for (const ta of tas) recut(ta);

    /**
     * Keep the window staffed to its floor.
     *
     * The only thing that hands a TA hours beyond their own weekly
     * requirement: the coordinator asked for at least this many people on
     * duty at any moment, so somebody has to be there, and the least-loaded
     * TA who legally can be, is. Windows without a floor are untouched.
     */
    for (const w of windows) {
      const floor = Math.min(w.minCount ?? 0, w.requiredCount);
      if (floor <= 0) continue;
      const occ = occupancy.get(w.id)!;
      for (let i = 0; i < occ.length; i++) {
        const slotStart = w.startMin + i * SLOT;
        while (occ[i] < floor) {
          let chosen: { ta: SolverTaProfile; s: number; e: number; score: number } | null = null;
          for (const ta of tas) {
            // Hours per TA is what it says: a ceiling. A window that wants
            // more cover than the TAs owe between them stays part-covered
            // rather than quietly handing somebody a sixth hour.
            if ((need.get(ta.id) ?? 0) < minBlock) continue;
            const first = Math.max(w.startMin, slotStart - minBlock + SLOT);
            for (let start = first; start <= slotStart && start + minBlock <= w.endMin; start += SLOT) {
              const end = start + minBlock;
              let room = true;
              for (let j = slotIndex(w, start); j < slotIndex(w, end); j++) {
                if (occ[j] >= w.requiredCount) {
                  room = false;
                  break;
                }
              }
              if (!room) continue;
              if (blockedByDuty(dutyId, w.day, start, end)) continue;
              if (!ctx.coversWindow(ta.id, w.day, start, end)) continue;
              if (ctx.overlapsUnavail(ta.id, w.day, start, end)) continue;
              if (busy(ta.id, w.day, start, end)) continue;
              const load = state.loads.get(ta.id)!;
              const hours = weeklyHoursOf(ctx, load);
              if (hours + minBlock / 60 > ta.maxHoursPerWeek + 1e-9) continue;
              // Whoever has the most room left in their week goes first.
              const score =
                hours * 1000 +
                ctx.preferNotMinutes(ta.id, w.day, start, end) * OH.PREFER_NOT +
                spreadPenalty(w.day, start, end);
              if (chosen === null || score < chosen.score) chosen = { ta, s: start, e: end, score };
            }
          }
          if (chosen === null) break; // nobody can stand here; leave the hole
          place(w, chosen.ta.id, chosen.s, chosen.e, false);
          need.set(chosen.ta.id, (need.get(chosen.ta.id) ?? 0) - (chosen.e - chosen.s));
        }
      }
    }

    for (const ta of tas) {
      let left = need.get(ta.id) ?? 0;
      const style = styleOf(ta);
      const maxSize = maxSizeOf(ta);

      // A requirement that is not a whole number of blocks strands its last
      // sliver: two and a half hours with an hour minimum places two and
      // drops the rest, week after week. Grow a block by the remainder
      // instead, so long as it stays under the ceiling the TA asked for.
      const placed = targetMin - left;
      if (placed < requiredHoursMin && left > 0 && left < minBlock && left % SLOT === 0) {
        for (const b of blocksOf.get(ta.id) ?? []) {
          if (b.dutyTypeId !== dutyId || b.locked) continue;
          // A TA who asked for fewer, longer blocks will not mind one being
          // longer still. One who asked for short ones would, so they keep
          // the ceiling and the remainder is reported instead.
          if (style === "many_short" && b.endMin - b.startMin + left > maxSize) continue;
          const w = ctx.shiftById.get(b.windowShiftId);
          if (!w || w.kind !== "window") continue;
          const end = b.endMin + left;
          if (end > w.endMin) continue;
          const occ = occupancy.get(w.id)!;
          let room = true;
          for (let i = slotIndex(w, b.endMin); i < slotIndex(w, end); i++) {
            if (occ[i] >= w.requiredCount) {
              room = false;
              break;
            }
          }
          if (!room) continue;
          if (blockedByDuty(dutyId, w.day, b.endMin, end)) continue;
          if (!ctx.coversWindow(ta.id, w.day, b.endMin, end)) continue;
          if (ctx.overlapsUnavail(ta.id, w.day, b.endMin, end)) continue;
          if (busy(ta.id, w.day, b.endMin, end)) continue;
          const load = state.loads.get(ta.id)!;
          if (weeklyHoursOf(ctx, load) + left / 60 > ta.maxHoursPerWeek + 1e-9) continue;
          for (let i = slotIndex(w, b.endMin); i < slotIndex(w, end); i++) occ[i] += 1;
          b.endMin = end;
          load.weeklyMin += left;
          left = 0;
          break;
        }
      }

      // Short of the fewest they must have — stopping between the two is a
      // choice the range allows, not a gap worth reporting.
      const missing = requiredHoursMin - (targetMin - left);
      if (missing >= SLOT) {
        unfilled.push({
          taProfileId: ta.id,
          dutyTypeId: dutyId,
          missingHours: round4(missing / 60),
        });
      }
    }
  }
  return unfilled;
}

function buildOutput(
  ctx: Ctx,
  state: State,
  hardViolations: SolveDiagnostics["hardViolations"],
  unfilledWindowHours: SolveDiagnostics["unfilledWindowHours"],
): SolveOutput {
  const assignments: SolvedAssignment[] = [];
  for (const s of ctx.syncShifts) {
    for (const taId of state.syncByShift.get(s.id)!) {
      assignments.push({
        shiftId: s.id,
        taProfileId: taId,
        locked: ctx.lockedSync.has(pairKey(s.id, taId)),
      });
    }
  }
  for (const s of ctx.asyncShifts) {
    for (const [taId, h] of state.asyncByShift.get(s.id)!) {
      assignments.push({
        shiftId: s.id,
        taProfileId: taId,
        hoursAllocated: round4(h),
        locked: ctx.lockedAsync.has(pairKey(s.id, taId)),
      });
    }
  }
  assignments.sort((a, b) =>
    a.shiftId < b.shiftId
      ? -1
      : a.shiftId > b.shiftId
        ? 1
        : a.taProfileId < b.taProfileId
          ? -1
          : a.taProfileId > b.taProfileId
            ? 1
            : 0,
  );

  const windowBlocks = [...state.windowBlocks].sort(
    (a, b) =>
      DAY_ORDER[a.day] - DAY_ORDER[b.day] ||
      a.startMin - b.startMin ||
      a.taProfileId.localeCompare(b.taProfileId),
  );

  const unfilledShifts: SolveDiagnostics["unfilledShifts"] = [];
  for (const s of ctx.input.shifts) {
    if (s.kind === "window") continue; // a window is a range, never "unfilled"
    if (s.kind === "async") {
      const m = state.asyncByShift.get(s.id)!;
      let alloc = 0;
      for (const h of m.values()) alloc += h;
      const missing = round4(s.hoursRequired - alloc);
      if (missing > EPS) unfilledShifts.push({ shiftId: s.id, missing });
    } else {
      const missing = s.requiredCount - state.syncByShift.get(s.id)!.length;
      if (missing > 0) unfilledShifts.push({ shiftId: s.id, missing });
    }
  }

  const assignedTas = new Set([
    ...assignments.map((a) => a.taProfileId),
    ...windowBlocks.map((b) => b.taProfileId),
  ]);
  const taLoads = ctx.tas.map((ta) => ({
    taProfileId: ta.id,
    weeklyHours: round4(weeklyHoursOf(ctx, state.loads.get(ta.id)!)),
    maxHoursPerWeek: ta.maxHoursPerWeek,
  }));
  const zeroAssignmentTaIds = ctx.tas
    .filter((ta) => !assignedTas.has(ta.id))
    .map((ta) => ta.id);

  return {
    assignments,
    windowBlocks,
    diagnostics: {
      unfilledShifts,
      unfilledWindowHours,
      taLoads,
      zeroAssignmentTaIds,
      hardViolations,
    },
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function solve(input: SolveInput): SolveOutput {
  const ctx = buildContext(input);
  const state = createState(ctx);
  const hardViolations = applyLocked(ctx, state);
  greedyFillSync(ctx, state);
  greedyFillAsync(ctx, state);
  anneal(ctx, state);
  // Final repair: fill any vacancies the annealer left open.
  greedyFillSync(ctx, state);
  greedyFillAsync(ctx, state);
  const unfilledWindowHours = fillWindows(ctx, state);
  return buildOutput(ctx, state, hardViolations, unfilledWindowHours);
}
