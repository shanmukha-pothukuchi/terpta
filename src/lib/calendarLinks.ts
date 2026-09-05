/**
 * The scope of a course calendar link: which kinds of work it carries.
 *
 * Stored as a list of duty type ids, or nothing for everything. "Everything"
 * is stored as an absence rather than as the full list so a kind of work
 * added next month rides along without anyone re-making the link.
 */

/** What to store for a set of checked duty types. */
export function scopeToStore(
  checked: ReadonlySet<string>,
  all: readonly string[],
): string[] | undefined {
  // Vacuously true for a board with no kinds of work yet: a link made
  // before any exist carries whatever comes.
  if (all.every((id) => checked.has(id))) return undefined;
  return all.filter((id) => checked.has(id));
}

/** The checked set a stored scope stands for. */
export function scopeFromStore(
  stored: readonly string[] | undefined,
  all: readonly string[],
): Set<string> {
  return new Set(stored === undefined ? all : stored.filter((id) => all.includes(id)));
}

/** "Everything", "Office Hours", "Office Hours and Discussion", … */
export function describeScope(
  stored: readonly string[] | undefined,
  nameOf: (id: string) => string | undefined,
): string {
  if (stored === undefined) return "Everything";
  const names = stored.map((id) => nameOf(id) ?? "a removed kind of work");
  if (names.length === 0) return "Nothing";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
