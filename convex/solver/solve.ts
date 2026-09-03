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

interface Load {
  weeklyMin: number; // minutes/week from weekly_sync assignments
  onceMin: number; // total minutes from once_sync assignments (averaged over weeks)
  asyncHours: number; // total async hours (averaged over weeks)
}

interface State {
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
  const syncShifts = input.shifts.filter((s): s is SyncShift => s.kind !== "async");
  const asyncShifts = input.shifts.filter((s): s is AsyncShift => s.kind === "async");

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
    syncByShift: new Map([...state.syncByShift].map(([k, v]) => [k, v.slice()])),
    asyncByShift: new Map([...state.asyncByShift].map(([k, v]) => [k, new Map(v)])),
    taSyncShifts: new Map([...state.taSyncShifts].map(([k, v]) => [k, v.slice()])),
    loads: new Map([...state.loads].map(([k, v]) => [k, { ...v }])),
  };
}

function restore(state: State, snap: State): void {
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

function buildOutput(
  ctx: Ctx,
  state: State,
  hardViolations: SolveDiagnostics["hardViolations"],
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

  const unfilledShifts: SolveDiagnostics["unfilledShifts"] = [];
  for (const s of ctx.input.shifts) {
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

  const assignedTas = new Set(assignments.map((a) => a.taProfileId));
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
    diagnostics: { unfilledShifts, taLoads, zeroAssignmentTaIds, hardViolations },
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
  return buildOutput(ctx, state, hardViolations);
}
