/* Calendar-style lane assignment for absolutely-positioned time blocks.
   Two blocks on the same day and time used to be painted on top of each other
   (both `left-1 right-1`), doubling their text. Instead we do what a calendar
   does: walk the day's blocks in start order, group the ones that overlap into
   a cluster, and give every block in a cluster its own column ("lane") so they
   sit side by side. A block with nothing overlapping it is a cluster of one and
   still spans the full column, so nothing moves when there is no collision.

   Pure + shared: the coordinator Builder week grid and the TA schedule grid
   both position blocks this way. */

export interface LaneSpan {
  /** 0-based column this block occupies inside its overlap cluster. */
  lane: number;
  /** Number of columns the cluster was split into (>= 1). */
  lanes: number;
}

export interface LaneItem {
  id: string;
  /** Minutes from midnight. */
  start: number;
  end: number;
}

/**
 * Assign each item a lane within its overlap cluster.
 *
 * Blocks that merely touch (`a.end === b.start`) do not overlap and share a
 * lane. Returns a map keyed by `id`; ids missing from the map (only possible
 * for an empty input) should be treated as `{ lane: 0, lanes: 1 }`.
 */
export function assignLanes(items: LaneItem[]): Map<string, LaneSpan> {
  const spans = new Map<string, LaneSpan>();
  if (items.length === 0) return spans;

  // Longest-first on ties keeps the wide block in lane 0, which reads better.
  const ordered = [...items].sort((a, b) => a.start - b.start || b.end - a.end);

  let cluster: string[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;

  const closeCluster = () => {
    const lanes = Math.max(1, laneEnds.length);
    for (const id of cluster) {
      const span = spans.get(id);
      if (span) span.lanes = lanes;
    }
    cluster = [];
    laneEnds = [];
    clusterEnd = Number.NEGATIVE_INFINITY;
  };

  for (const item of ordered) {
    // Guard against zero/negative-length blocks so they still take a slot.
    const end = Math.max(item.end, item.start + 1);
    // Starting at or after every open block ends the cluster.
    if (item.start >= clusterEnd) closeCluster();

    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= item.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }

    spans.set(item.id, { lane, lanes: laneEnds.length });
    cluster.push(item.id);
    clusterEnd = Math.max(clusterEnd, end);
  }
  closeCluster();

  return spans;
}

/**
 * Horizontal placement for one lane as CSS `left`/`width`.
 *
 * `inset` is the breathing room on both edges of the day column and `gutter`
 * the gap between neighbouring lanes. At `lanes === 1` this collapses to
 * `left: inset` / `width: calc(100% - 2*inset)` — i.e. the old full-width
 * block, unchanged.
 */
export function laneStyle(
  span: LaneSpan | undefined,
  { inset = 4, gutter = 3 }: { inset?: number; gutter?: number } = {},
): { left: string; width: string } {
  const lanes = Math.max(1, span?.lanes ?? 1);
  const lane = Math.min(Math.max(0, span?.lane ?? 0), lanes - 1);
  const taken = inset * 2 + gutter * (lanes - 1);
  const width = `calc((100% - ${taken}px) / ${lanes})`;
  return {
    left: `calc((100% - ${taken}px) / ${lanes} * ${lane} + ${inset + gutter * lane}px)`,
    width,
  };
}
