/**
 * What to call a TA on screen, without throwing away what disambiguates them.
 *
 * A TA's preferred name is a first name — "Priyam" for a Priyadarshan — and
 * the board and the table students read shorten names themselves: first name
 * alone, plus a surname initial when two people answer to the same one. Hand
 * those screens the bare preferred name and the initial has nothing to come
 * from, so two Anirudhs who were "Anirudh S." and "Anirudh C." collapse into
 * one name twice over.
 *
 * So the preferred name replaces the first name and the surname rides along.
 * Every shortener downstream keeps working on an ordinary-looking full name,
 * and nobody has to be told which half of it the TA chose.
 */
export function displayName(
  name: string | undefined,
  preferredName: string | undefined,
): string {
  const full = (name ?? "").trim();
  const preferred = (preferredName ?? "").trim();
  if (preferred.length === 0) return full;
  if (full.length === 0) return preferred;
  // A preferred name given with a surname is already a whole name; adding
  // the registered surname to it would say the surname twice.
  if (/\s/.test(preferred)) return preferred;
  const rest = full.split(/\s+/).filter(Boolean).slice(1);
  return rest.length === 0 ? preferred : `${preferred} ${rest.join(" ")}`;
}
