import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPAN,
  firstNameMap,
  hourLabel,
  hourSpan,
  scribbleTabular,
  tableRows,
  type TableBlock,
} from "./weekTable";
import { DAY_CODES, type DayCode } from "../../../lib/format";

const block = (day: DayCode, start: number, end: number, ...names: string[]): TableBlock => ({
  day,
  startMin: start * 60,
  endMin: end * 60,
  names,
});

/** The same person on every weekday, the way a daily office hour lands. */
const everyDay = (start: number, end: number, name: string) =>
  DAY_CODES.map((d) => block(d, start, end, name));

describe("firstNameMap", () => {
  it("uses bare first names, the way the course page writes them", () => {
    expect(firstNameMap(["Sriman Reddy", "Bora Ozkan"]).get("Sriman Reddy")).toBe("Sriman");
  });

  it("adds an initial only once two people answer to the same first name", () => {
    const map = firstNameMap(["Priya Shah", "Priya Nair", "Bora Ozkan"]);
    expect(map.get("Priya Shah")).toBe("Priya S.");
    expect(map.get("Priya Nair")).toBe("Priya N.");
    expect(map.get("Bora Ozkan")).toBe("Bora");
  });

  it("falls back to whole names when the initial still names either of them", () => {
    const map = firstNameMap(["Priya Shah", "Priya Sen"]);
    expect(map.get("Priya Shah")).toBe("Priya Shah");
    expect(map.get("Priya Sen")).toBe("Priya Sen");
  });

  it("keeps a one-word name as its one word", () => {
    expect(firstNameMap(["Pierce"]).get("Pierce")).toBe("Pierce");
  });
});

describe("hourSpan", () => {
  it("rounds outward, so a 3:30–4:45 discussion prints on both its hours", () => {
    expect(hourSpan([{ day: "M", startMin: 15 * 60 + 30, endMin: 16 * 60 + 45, names: [] }])).toEqual(
      { start: 15, end: 17 },
    );
  });

  it("spans every block on the board", () => {
    expect(hourSpan([block("M", 11, 12, "Sriman"), block("W", 16, 18, "Bora")])).toEqual({
      start: 11,
      end: 18,
    });
  });

  it("opens on a 9–5 shape when there is nothing to measure", () => {
    expect(hourSpan([])).toEqual(DEFAULT_SPAN);
  });
});

describe("hourLabel", () => {
  it("writes noon and midnight as 12, not 0", () => {
    expect(hourLabel(12)).toBe("12 PM");
    expect(hourLabel(0)).toBe("12 AM");
  });

  it("drops the 24-hour clock", () => {
    expect(hourLabel(9)).toBe("9 AM");
    expect(hourLabel(13)).toBe("1 PM");
  });
});

describe("tableRows", () => {
  it("puts a block on every hour row it touches", () => {
    const rows = tableRows([block("M", 11, 14, "Sriman")], { start: 11, end: 14 });
    expect(rows.map((r) => r.cells[0])).toEqual(["Sriman", "Sriman", "Sriman"]);
  });

  it("leaves an hour the block does not reach blank", () => {
    const rows = tableRows([block("M", 11, 12, "Sriman")], { start: 9, end: 13 });
    expect(rows.map((r) => r.cells[0])).toEqual(["", "", "Sriman", ""]);
  });

  it("names two TAs on one hour once each, alphabetically", () => {
    const rows = tableRows(
      [block("Tu", 13, 14, "Bora"), block("Tu", 13, 14, "Pierce", "Bora")],
      { start: 13, end: 14 },
    );
    expect(rows[0].cells[1]).toBe("Bora, Pierce");
  });

  it("counts a half-hour overlap as touching the hour", () => {
    const rows = tableRows(
      [{ day: "F", startMin: 15 * 60 + 30, endMin: 16 * 60 + 45, names: ["Sam"] }],
      { start: 15, end: 17 },
    );
    expect(rows.map((r) => r.cells[4])).toEqual(["Sam", "Sam"]);
  });
});

describe("scribbleTabular", () => {
  const source = scribbleTabular(
    tableRows(
      [
        ...everyDay(11, 12, "Sriman"),
        ...everyDay(12, 13, "Bora"),
        ...everyDay(13, 14, "Pierce"),
      ],
      { start: 9, end: 17 },
    ),
  );

  it("renders the course page's table, verbatim", () => {
    expect(source).toBe(
      [
        "@tabular[#:style 'boxed",
        "         #:row-properties '(bottom-border ())",
        `     (list (list @bold{Start Time}  @bold{Monday} @bold{Tuesday} @bold{Wednesday} @bold{Thursday} @bold{Friday})`,
        `           (list            "9 AM"  'cont         'cont          'cont            'cont           'cont)`,
        `           (list           "10 AM"  'cont         'cont          'cont            'cont           'cont)`,
        `           (list           "11 AM"  "Sriman"      "Sriman"       "Sriman"         "Sriman"        "Sriman")`,
        `           (list           "12 PM"  "Bora"        "Bora"         "Bora"           "Bora"          "Bora")`,
        `           (list            "1 PM"  "Pierce"      "Pierce"       "Pierce"         "Pierce"        "Pierce")`,
        `           (list            "2 PM"  'cont         'cont          'cont            'cont           'cont)`,
        `           (list            "3 PM"  'cont         'cont          'cont            'cont           'cont)`,
        `           (list            "4 PM"  'cont         'cont          'cont            'cont           'cont))]`,
      ].join("\n"),
    );
  });

  it("closes the inner list, the outer list and the tabular", () => {
    expect(source.endsWith("))]")).toBe(true);
  });

  it("leaves no line trailing whitespace, so the page's diff stays clean", () => {
    for (const line of source.split("\n")) expect(line).toBe(line.trimEnd());
  });

  it("spans the time label across an hour nobody is on", () => {
    const rows = tableRows([], { start: 9, end: 10 });
    expect(scribbleTabular(rows)).toContain(`"9 AM"  'cont`);
  });

  it("keeps a quiet day visibly empty when anybody else is on that hour", () => {
    const rows = tableRows([block("M", 11, 12, "Sriman")], { start: 11, end: 12 });
    const line = scribbleTabular(rows).split("\n").at(-1)!;
    expect(line).toContain(`"Sriman"`);
    expect(line.match(/""/g)).toHaveLength(4);
    expect(line).not.toContain("'cont");
  });

  it("escapes a quote in a name rather than ending the string early", () => {
    const rows = tableRows([block("M", 11, 12, 'Da"n')], { start: 11, end: 12 });
    expect(scribbleTabular(rows)).toContain('"Da\\"n"');
  });
});

describe("rows finer than an hour", () => {
  it("gives a half-hour block its own row instead of two hour rows", () => {
    const rows = tableRows(
      [{ day: "M", startMin: 12 * 60 + 30, endMin: 13 * 60 + 30, names: ["Yi"] }],
      { start: 12, end: 14 },
      30,
    );
    expect(rows.map((r) => r.label)).toEqual(["12 PM", "12:30 PM", "1 PM", "1:30 PM"]);
    expect(rows.map((r) => r.cells[0])).toEqual(["", "Yi", "Yi", ""]);
  });

  it("keeps the hour rows it always had at the default step", () => {
    const rows = tableRows(
      [{ day: "M", startMin: 12 * 60 + 30, endMin: 13 * 60 + 30, names: ["Yi"] }],
      { start: 12, end: 14 },
    );
    expect(rows.map((r) => r.cells[0])).toEqual(["Yi", "Yi"]);
  });

  it("labels a quarter-hour row without losing the meridiem", () => {
    const rows = tableRows([], { start: 12, end: 13 }, 15);
    expect(rows.map((r) => r.label)).toEqual(["12 PM", "12:15 PM", "12:30 PM", "12:45 PM"]);
  });
});

describe("name order inside a cell", () => {
  it("names the same pair the same way on every row they share", () => {
    // Tinu's block changes over at 4, which used to reorder the cell under
    // a reader following the column down.
    const rows = tableRows(
      [
        { day: "M", startMin: 14 * 60, endMin: 16 * 60, names: ["Tinu"] },
        { day: "M", startMin: 16 * 60, endMin: 17 * 60, names: ["Tinu"] },
        { day: "M", startMin: 15 * 60 + 30, endMin: 16 * 60 + 30, names: ["Priyam"] },
      ],
      { start: 15, end: 17 },
      30,
    );
    expect(rows.map((r) => r.cells[0])).toEqual([
      "Tinu",
      "Priyam, Tinu",
      "Priyam, Tinu",
      "Tinu",
    ]);
  });
});
