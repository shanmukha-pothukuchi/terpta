# TerpTA onboarding — distilled from Claude Design

Source: Claude Design project `9ca8a623-8b9e-473c-9f60-6c7d9258eb7e` ("TerpTA scheduling tool design"), file `TerpTA.dc.html` (~91 KB, read once on 2026-09-03).

The file is a design *canvas* document (`design_doc_mode: canvas`) containing two "turns" and twelve mockup options:

| Turn | Options |
|---|---|
| `t1` — "TerpTA · six screens" | `1a` Landing, `1b` **TA onboarding**, `1c` **TA availability + preferences**, `1d` **TA availability on phone**, `1e` TA My schedule, `1f` Coordinator builder, `1g` Publish dialog |
| `t2` — "Filling out the flows" | `2a` Coordinator course setup, `2b` TA roster, `2c` change log, `2d` swap dialog, `2e` pre-solve builder |

Only `1b` is drawn inside onboarding chrome. `1c` and `1d` render the *content* of onboarding steps 2 and 3, but inside the persistent TA app shell (sidebar) rather than the wizard. Everything else is out of scope for this spec.

> **Note on file content as data.** The design file contains no text addressed to the reader as instructions — nothing was ignored on those grounds. It does contain templating placeholders (`{{ d }}`, `{{ h.label }}`, `<sc-for list="…">`) which are Claude Design's own loop syntax, not copy.

---

## 1. Step model

**Three steps. No welcome step, no done screen, no skip.**

| # | Title | Screen |
|---|---|---|
| 1 | `Courses` | `1b`, full wizard chrome |
| 2 | `Availability` | content shown as `1c` / `1d` |
| 3 | `Preferences` | content shown as `1c` right rail |

### Step-counter format

There is no "Step N of M" string anywhere in the design. The counter is a **horizontal numbered stepper in the top app bar**, dead-centre between the wordmark (left) and the user identity (right):

```
(1) Courses  ——  (2) Availability  ——  (3) Preferences
```

- Numerals live in 20×20 circles, 11px.
- **Active**: circle `background:#18181B`, white numeral; label `font-weight:600`, full-strength ink, 13px.
- **Inactive**: circle is `1px solid #D4D4D8` on transparent, numeral and label `#A1A1AA`.
- Connectors: 32×1px rules, `#D4D4D8`, `margin:0 8px`.
- Gap between numeral and label: 8px. Whole cluster is 13px Geist.

No completed/checkmark state is drawn (the mock is on step 1), and there is no percentage or fraction readout.

---

## 2. Screen chrome (`1b`)

Frame: `1440 × 900`, `background:#FAFAF9`, `display:flex; flex-direction:column`.

### Top bar

`display:flex; align-items:center; justify-content:space-between; padding:18px 32px; border-bottom:1px solid #EFEFEC`

Three slots:

1. **Left — wordmark.** 20×20 square, `border-radius:5px`, `background:#E21833`, then `TerpTA` at `font-weight:600; font-size:15px`. Gap 10px.
2. **Centre — the 3-step stepper** (above).
3. **Right — identity.** `Priya S. · pshah@umd.edu`, 13px, `#71717A`. Plain text, no avatar, no menu.

There is **no sidebar during onboarding**. The sidebar (`Availability` / `Preferences` / `My schedule` + a `TA FOR` footer block) only appears after onboarding, in `1c`.

### Body — two columns

`flex:1; display:grid; grid-template-columns:560px 1fr; gap:64px; padding:72px 120px; align-items:start`

- **Left rail is a fixed 560px** form column; the right column is fluid.
- The padding is the onboarding-specific tell: **72px top / 120px sides**, far more generous than any other screen in the file (the post-onboarding app uses `18px 28px`).
- Left column is `flex-direction:column; gap:28px`.

---

## 3. Step 1 — `Courses`

### Copy (verbatim)

Headline (`<h2>`, `font-size:30px; font-weight:600; letter-spacing:-.02em`, margin 0):

> `What are you taking this semester?`

Body (`<p>`, `font-size:15px; line-height:1.5; color:#52525B`):

> `We'll pull your lecture and discussion times from the Schedule of Classes so they're blocked off automatically.`

Headline + body are grouped in their own `gap:10px` stack.

### The combobox

A **token/chip input**, not a list with an Add button. It is a bare bordered box, **not** wrapped in a card:

- `display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding:8px 10px`
- `background:#fff; border:1px solid #18181B; border-radius:10px`
- focus ring: `box-shadow:0 0 0 3px rgba(24,24,27,.08)`

Contents, left to right:

- Committed course chips: `MATH240 ×`, `ENGL393 ×` — `font:500 13px 'Geist Mono'`, `background:#F4F4F5`, `padding:5px 8px`, `border-radius:6px`, the `×` in `#A1A1AA`.
- Live query text `CMSC3` at `font:500 14px 'Geist Mono'` followed by a hand-drawn **1.5px × 16px caret** (`background:#18181B`, `vertical-align:-3px`) — i.e. the mock deliberately depicts mid-typing.

### Autocomplete dropdown

Absolutely positioned `top:calc(100% + 6px); left:0; right:0`, `z-index:2`, `background:#fff`, `border:1px solid #E4E4E7`, `border-radius:10px`, `box-shadow:0 12px 32px -12px rgba(0,0,0,.2)`, `padding:6px`.

Four result rows, each `display:flex; justify-content:space-between; padding:8px 10px`:

| Course code | Title | Right meta |
|---|---|---|
| `CMSC330` | `Organization of Programming Languages` | `Sec 0201 · TuTh 2:00` |
| `CMSC335` | `Web Application Development` | `Sec 0101 · MW 5:00` |
| `CMSC351` | `Algorithms` | `Sec 0301 · MWF 1:00` |
| `CMSC389N` | `Full-stack Web Development` | `Sec 0101 · Tu 5:00` |

- First row is the highlighted/active option: `background:#F4F4F5; border-radius:7px`.
- Course code `font:500 13px 'Geist Mono'`; title 13px `#52525B`; meta 12px `#71717A`.
- **Each result already carries a section number and meeting time** — a single default section is implied by the search result, so there is no separate section-picking step.

Footer row inside the dropdown, `padding:8px 10px 4px; font-size:11.5px; color:#A1A1AA; border-top:1px solid #F4F4F5; margin-top:4px`:

> `Don't see it? Add a custom block on the next step.`

Manual entry is therefore **deferred to step 2**, not offered on step 1.

### Spacer

An explicit `<div style="height:180px">` sits between the combobox and the footer row — the actions are pinned low in the column, giving the form deliberate breathing room.

### Footer actions

`display:flex; justify-content:space-between; align-items:center`

- **Left**, 13px `#71717A`: `You can edit this anytime under Preferences.`
- **Right**, the only button: `Continue to availability →`
  - `font-size:14px; font-weight:500; color:#fff; background:#18181B; padding:10px 16px; border-radius:9px`
  - Neutral black, **not** the `#E21833` UMD red. Red is reserved for the wordmark and for the post-onboarding `Submit availability` / `Submit` CTAs.
  - Trailing `→` is part of the label string.

**There is no Back button and no Skip link on this screen.** Nothing in the file gates Continue — the button is drawn in its enabled state with two courses already chipped, and no disabled variant or validation message exists anywhere in the onboarding markup.

### Right column — live import preview card

`background:#fff; border:1px solid #E4E4E7; border-radius:12px; padding:20px; gap:14px; margin-top:8px`. This is the one card on the screen.

**Card header** (`justify-content:space-between; align-items:baseline`):

- Left, 13px/600: `Pulled from Schedule of Classes`
- Right, 12px `#71717A`: `5 meetings · 2 courses`

**Meeting list**, rows of `display:grid; grid-template-columns:90px 1fr auto; gap:12px; padding:10px 12px`:

| Course | Meeting | Time | State |
|---|---|---|---|
| `MATH240` | `Lecture 0201 · Kirwan 3206` | `MWF 11:00–11:50` | committed |
| `MATH240` | `Discussion 0211 · Kirwan 1311` | `Tu 9:00–9:50` | committed |
| `ENGL393` | `Lecture 0503 · Tawes 1100` | `MW 3:30–4:45` | committed |
| `CMSC330` | `Lecture 0201 · IRB 0324` | `TuTh 2:00–3:15` | **preview** |
| `CMSC330` | `Discussion 0201 · IRB 1207` | `F 10:00–10:50` | **preview** |

- Committed rows: `background:#FAFAF9; border-radius:8px`, no border.
- Preview rows: `border:1px dashed #E4E4E7; border-radius:8px; opacity:.6`, no fill.
- **This is the distinctive interaction**: hovering/highlighting a dropdown result *optimistically previews its meetings* in the right card as ghosted dashed rows, and the header count (`5 meetings · 2 courses`) counts them. The user sees the consequence of a pick before committing it. Room numbers are shown, not just times.
- Type ramp: course code `font:500 13px 'Geist Mono'`; description 13px `#52525B`; time `font:400 12px 'Geist Mono'` in full ink.

**Mini week grid** at the card foot, above a `border-top:1px solid #F4F4F5; padding-top:12px`:

- `display:grid; grid-template-columns:34px repeat(5,1fr)` — 5 weekdays only, no weekend.
- Day headers 11px/500 `#71717A`.
- Body height **288px**; hour rail labels `font:400 10px 'Geist Mono'; color:#A1A1AA`, absolutely positioned and `translateY(-50%)`.
- Day columns use `background:repeating-linear-gradient(to bottom,transparent 0 35px,#F4F4F5 35px 36px)` — a 36px hour band with a hairline rule.
- Blocks are absolutely positioned, `border-radius:4px; padding:3px 5px; font:500 10px 'Geist Mono'; color:#fff`, with a per-block `{{ b.bg }}` and, crucially, a per-block `{{ b.opacity }}` — so the ghosted preview state propagates into the grid too.

---

## 4. Step 2 — `Availability`

Shown as `1c` (desktop) and `1d` (phone). Both are drawn in the *post-onboarding* app shell, so the wizard framing for this step is not explicitly designed; the content below is what step 2 must contain.

### Header

- `<h2>` `font-size:20px; font-weight:600; letter-spacing:-.02em`: `Weekly availability`
- Sub, 13px `#71717A`: `Click or drag to paint. Due Fri Aug 28 · saved 2 min ago`
  - Carries **both a deadline and an autosave receipt** in one line.

### Brush picker (segmented control, top-right)

`display:flex; background:#fff; border:1px solid #E4E4E7; border-radius:8px; padding:3px; font-size:13px`. Three segments, each with a 10px swatch (`border-radius:3px`) then a label:

| Label | Swatch |
|---|---|
| `Available` | `oklch(0.86 0.12 152)` — green |
| `Prefer not` | `oklch(0.9 0.09 85)` — amber |
| `Unavailable` | `#fff` with `1px solid #D4D4D8` |

Selected segment: `background:#18181B; color:#fff; font-weight:500; border-radius:6px; padding:5px 10px`. A **three-state brush** (available / prefer-not / unavailable), not a binary paint.

### Primary action

`Submit availability` — `font-size:13px; font-weight:500; color:#fff; background:#E21833; padding:8px 14px; border-radius:8px`. **Red**, unlike the neutral-black onboarding Continue.

### Grid

- Card: `background:#fff; border:1px solid #E4E4E7; border-radius:12px; overflow:hidden`.
- `grid-template-columns:52px repeat(5,1fr)`; header row day names 12px/500 `#52525B`, `border-bottom:1px solid #EFEFEC`.
- Body height **624px**; cells are **26px** tall each, `border-bottom:1px solid {{ c.line }}` with per-cell `{{ c.bg }}`.
- Turn `t1`'s own note says: `grid cells 30 min, 22px tall on desktop, 16px on phone` (the rendered `1c` uses 26px; phone `1d` uses 16px).
- Hour rail labels `font:400 10.5px 'Geist Mono'; color:#A1A1AA`, right-aligned at `right:8px`.
- **Class blocks are diagonal-striped and locked**: `background:repeating-linear-gradient(135deg,#3F3F46 0 6px,#4B4B53 6px 12px); border-radius:5px; padding:5px 7px; color:#fff`, showing a mono 11px `{{ b.title }}` and a 10.5px `opacity:.75` `{{ b.sub }}`.

### Legend / readout below the grid

`display:flex; gap:18px; padding:12px 4px; font-size:12px; color:#71717A`:

- 12px striped swatch + `In class · imported from Testudo, locked`
- `·`
- `21.5 h available · 3 h prefer not`

A **running two-number tally** of both paint states, not a percentage.

### Phone variant (`1d`)

- iOS frame `402 × 874`, imported via `<x-import component-from-global-scope="IOSDevice" from="./ios-frame.jsx">`.
- Header: `Availability` (19px/600) over `CMSC131 · due Fri Aug 28` (12px `#71717A`); right-side red `Submit` pill.
- Grid `grid-template-columns:34px repeat(5,1fr)`, body 384px, cells **16px**, blocks show `{{ b.short }}` at `font:500 9px 'Geist Mono'`.
- **Brush picker moves to the bottom, fixed in the thumb zone**: full-width `display:flex` with three `flex:1` segments at `padding:11px 0`, `border-radius:12px`, container `padding:4px`.
- Third segment is relabelled `Clear` on phone (vs `Unavailable` on desktop).
- Footer hint, centred, 11.5px `#A1A1AA`: `Drag to paint · striped blocks are your classes`

---

## 5. Step 3 — `Preferences`

Shown as `1c`'s right rail: a fixed **320px** column (`grid-template-columns:1fr 320px`) sitting beside the availability grid — i.e. in the app, availability and preferences are on screen *simultaneously*.

One card, `background:#fff; border:1px solid #E4E4E7; border-radius:12px; padding:18px; gap:18px`, titled `Preferences` (14px/600). Three groups:

### a. Hours

- Row: `Max hours per week` (13px `#52525B`) — right-aligned value `10 h` (`font:500 13px 'Geist Mono'`).
- A **custom slider**: 3px track `#E4E4E7`, 50% fill `#18181B`, 16px round thumb (`background:#fff; border:1.5px solid #18181B; box-shadow:0 1px 3px rgba(0,0,0,.15)`).
- End labels beneath, `font:400 10.5px 'Geist Mono'; color:#A1A1AA`: `4` and `20`. **Range is 4–20.**

### b. Duty types

- Label 13px `#52525B`: `I'd like to do`
- Multi-select pills, `padding:6px 10px; border-radius:7px; font-size:13px`:
  - Selected: `background:#18181B; color:#fff; font-weight:500` — `Discussion`, `Office hours`
  - Unselected: `border:1px solid #E4E4E7; color:#52525B` — `Grading`
- **Flat multi-select, no sync/async axis.**

### c. Ranked sections

- Header row: `Discussion sections, ranked` (13px `#52525B`) with right-side affordance hint `drag to reorder` (12px `#A1A1AA`).
- Rows: `display:grid; grid-template-columns:18px 48px 1fr auto; gap:8px; padding:8px 10px; background:#FAFAF9; border-radius:7px; font-size:13px` — rank numeral (mono 11px `#A1A1AA`), section number (mono 13px), meeting time (`#52525B`), and a `⋮⋮` drag handle (`color:#D4D4D8; letter-spacing:1px`).
- Trailing add affordance: `padding:8px 10px; border:1px dashed #E4E4E7; border-radius:7px; font-size:13px; color:#A1A1AA`:
  > `+ Add a section`
  - Only ranked sections are listed; unranked ones are added explicitly rather than shown greyed.

### Inline validation card (below the Preferences card)

`background:#FFF7F7; border:1px solid #FBD5DA; border-radius:12px; padding:14px 16px; font-size:12.5px; line-height:1.5; color:#7F1D1D`:

> `Fri 10:00 conflicts with your CMSC330 discussion. Section 0104 is unranked for you.`

**Cross-step, non-blocking validation**: it reconciles the step-1 class import against the step-3 section ranking and states two facts in one card. It is advisory — no button, and nothing is disabled.

---

## 6. Completion / done screen

**There is none.** The design has no completion screen, no summary card, no "You're all set" copy, and no post-wizard confirmation of any kind. Searches for `Welcome`, `Skip`, `All set`, `Finish`, `Get started` (outside the landing nav) return nothing in the onboarding region.

The implied model is that step 3 flows straight into the live app: `1c` *is* the destination, and the `Submit availability` button inside it is the real terminal action. The onboarding "finish" is submitting availability, not a separate confirmation page.

---

## 7. Onboarding-specific visual treatment

Things that differ from every other screen in the design file:

| | Onboarding (`1b`) | Rest of app (`1c`, `1e`, `1f`) |
|---|---|---|
| Navigation | Centred numbered stepper in top bar | 216px left sidebar with nav list |
| Page padding | `72px 120px` | `18px 28px` |
| Headline size | **30px** | 20px |
| Body copy size | 15px | 13px |
| Primary button | `#18181B` neutral black, `padding:10px 16px; border-radius:9px`, 14px | `#E21833` red, `padding:8px 14px; border-radius:8px`, 13px |
| Layout | Fixed 560px form column + fluid preview, 64px gutter | Sidebar + content + 320px rail |
| Card count | One (the preview) — the form itself is uncarded | Everything is carded |

### Shared tokens

- Type: **Geist** (400/500/600) and **Geist Mono** (400/500) from Google Fonts.
- Canvas `#FAFAF9`; card `#fff`; borders `#E4E4E7` / `#EFEFEC` / `#F4F4F5`.
- Ink ramp: `#18181B` → `#52525B` → `#71717A` → `#A1A1AA` → `#D4D4D8`.
- Accent `#E21833` (UMD red), hover `#B3122A`. Turn `t1` note: `neutral warm grays · #E21833 accent, gold only on the landing mark`.
- Radii: 6–7px (chips/pills), 8px (rows/small buttons), 9px (primary button), 10px (input/dropdown), 12px (cards).
- Every course code, time, hour label, section number and numeric value is set in **Geist Mono**. Prose is Geist.
- Semantic paint colours are `oklch()`: green `oklch(0.86 0.12 152)`, amber `oklch(0.9 0.09 85)`.

### Loading / empty / error states

- No loading, spinner, or skeleton state is drawn anywhere in the onboarding region.
- No empty state for "no courses added" — the mock always shows populated chips.
- The only error-ish treatment is the advisory conflict card in §5.
- The dashed/`opacity:.6` preview rows are the only transient-state treatment in step 1.

---

# Differences from the shipped wizard

Compared against `src/pages/ta/onboarding/` on `main` (commit `608aa97`).

## Step model and chrome

1. **Step count: 3 vs 4.** — `src/pages/ta/onboarding/model.ts`. `WIZARD_STEPS` is `Welcome` / `Your classes` / `Your availability` / `Preferences`. The design has no basics/welcome step at all; it opens directly on `Courses`. Adopting the design means deleting `basics` from `WIZARD_STEPS`, `BasicsValue`, `WizardState`, `emptyWizardState()`, and deleting `Step1Basics.tsx`.

2. **Step titles differ on all three surviving steps.** — `model.ts`. Design: `Courses`, `Availability`, `Preferences`. Ours: `Your classes`, `Your availability`, `Preferences`. The design's titles are bare nouns; ours are possessive.

3. **Progress indicator is a numbered stepper, not a bar.** — `WizardChrome.tsx`. We render a 3px full-width `<div role="progressbar">` filled to `((index+1)/total)*100`% in `bg-umd`, with a mono `Step N of 4 · Title` caption below. The design renders three 20px numbered circles with 32×1px connectors, centred in a top app bar, with active state on the circle fill (`#18181B`) and label weight. Ours also has no top app bar at all.

4. **No `Step N of M` string exists in the design.** — `model.ts` (`stepLabel()`). The `Step ${index + 1} of ${WIZARD_STEPS.length} · ${step.title}` format would be dropped entirely; the step names are the counter.

5. **Progress indicator position and size.** — `WizardChrome.tsx`. Ours sits above the step body inside an `880px` centred column; the design's sits in a full-bleed `1440px` bar with `padding:18px 32px` and a `1px solid #EFEFEC` bottom rule, alongside a wordmark and the user's name/email.

## Navigation

6. **No Back button in the design.** — `WizardChrome.tsx`. We render a secondary `Back` button with an `ArrowLeft` icon whenever `index > 0`. The design's step 1 has no Back, and no Back appears anywhere in the onboarding region.

7. **No Skip in the design.** — `WizardChrome.tsx` and `Wizard.tsx`. We render a `Skip for now` underlined text link on step 2 (jumps to step 3) and step 4 (finishes). The string `Skip` does not appear in the design file.

8. **Continue label is step-specific and directional.** — `WizardChrome.tsx` (`continueLabel` default) and `Wizard.tsx`. Ours is `Continue` on steps 1–3 and `Finish` on step 4. The design uses `Continue to availability →` — it names the destination and includes a trailing arrow glyph.

9. **Nothing gates progression in the design.** — `Wizard.tsx`. We disable Continue via `continueDisabled` on step 2 (`!state.classes.confirmedComplete`, tooltip `Confirm you have added all your classes`) and step 3 (`percent === 0`, tooltip `Paint at least some availability first`). No disabled state, tooltip, or validation gate appears in the design's onboarding. Following it would also remove the `This is all my classes` checkbox from `Step2Classes.tsx` and `confirmedComplete` from `ClassesValue` in `model.ts`.

10. **Footer layout is split, with reassurance copy on the left.** — `WizardChrome.tsx`. Ours is a `border-t` row with skip on the left, a spacer, then Back + Continue right. The design is `justify-content:space-between` with the 13px `#71717A` line `You can edit this anytime under Preferences.` on the left and the single Continue button on the right — no top border, and an explicit 180px spacer above it.

## Step 1 → Courses

11. **Headline copy and size.** — `Step2Classes.tsx`. Ours: `Which courses are you taking this semester?` as a 15px `<h2>`. Design: `What are you taking this semester?` at **30px**, `letter-spacing:-.02em`.

12. **Body copy.** — `Step2Classes.tsx`. Ours: `We lock these times on your availability grid so nobody schedules you during class.` Design: `We'll pull your lecture and discussion times from the Schedule of Classes so they're blocked off automatically.` — the design leads with the mechanism (Schedule of Classes) rather than the consequence, and is set at 15px vs our 12.5px.

13. **Course input is a chip/token combobox, not a search + result list.** — `CourseSearch.tsx` and `Step2Classes.tsx`. The design keeps added courses as removable mono chips *inside* the same bordered input the user is typing in, with a hand-drawn caret after the live query. Ours uses a separate `CourseSearch` control above a list of `Surface` course rows with Edit/Remove icon buttons.

14. **No separate section-picking step.** — `SectionPicker.tsx`, `Step2Classes.tsx`. Each design autocomplete row already carries `Sec 0201 · TuTh 2:00`, implying the pick commits a default section inline. Ours opens a full `SectionPicker` panel (`Add course` / `Save changes`) after every selection, plus per-course `Edit sections` and `Remove` buttons.

15. **Manual entry is deferred to step 2 and only hinted.** — `ManualClassEntry.tsx`, `Step2Classes.tsx`. The design's only manual-entry affordance in step 1 is the dropdown footer line `Don't see it? Add a custom block on the next step.` We render `<ManualClassEntry>` inline on the same step.

16. **Preview card is far richer.** — `MiniWeekGrid.tsx` and `Step2Classes.tsx`. Design: a bordered white card headed `Pulled from Schedule of Classes` / `5 meetings · 2 courses`, containing a *list* of five meeting rows with room numbers (`Lecture 0201 · Kirwan 3206`, `MWF 11:00–11:50`) **above** the mini grid. Ours shows only a `Your week` label + meeting count above a bare `MiniWeekGrid`, with no meeting list and no rooms.

17. **Optimistic hover preview of un-committed meetings.** — `Step2Classes.tsx` / `MiniWeekGrid.tsx`. The design ghosts the highlighted result's meetings into the preview card as `border:1px dashed #E4E4E7; opacity:.6` rows *and* propagates a per-block `{{ b.opacity }}` into the mini grid, so hovering a search result shows its effect before committing. We have no hover-preview state; blocks only appear after the section picker is submitted.

18. **Column proportions and gutter.** — `Step2Classes.tsx`. Ours: `lg:grid-cols-[minmax(0,1fr)_360px]` with `gap-5` (20px), preview sticky on the right. Design: a **fixed 560px** form column + fluid preview with a **64px** gutter and `align-items:start`, inside `72px 120px` page padding.

19. **Our error/empty/loading states have no design counterpart.** — `Step2Classes.tsx`. We ship an import error alert (`Couldn't reach UMD's schedule of classes — add times manually`), an `Importing {course}…` spinner, and an `EmptyState` (`No classes added yet.` / `Search for a course above…`). None of these exist in the design, which shows only the populated state — so these are additive, not conflicting, but they need styling that matches the light palette.

## Step 2 → Availability

20. **Three-state brush vs our editor's states.** — `Step3Availability.tsx` and `src/pages/ta/availability/AvailabilityEditor.tsx`. The design specifies exactly three segments — `Available` (green `oklch(0.86 0.12 152)`), `Prefer not` (amber `oklch(0.9 0.09 85)`), `Unavailable` (white/outlined) — in a bordered segmented control, and on phone renames the third to `Clear` and pins the whole control to the bottom thumb zone.

21. **Completion readout is an hour tally, not a percentage.** — `Step3Availability.tsx`. Ours renders a `<ProgressBar>` plus `Week {pct}% marked`. The design renders `21.5 h available · 3 h prefer not` as plain 12px text in the legend row under the grid, alongside `In class · imported from Testudo, locked` with a striped swatch.

22. **Header carries a deadline and a save receipt.** — `Step3Availability.tsx`. Design sub-line: `Click or drag to paint. Due Fri Aug 28 · saved 2 min ago`. Ours has an `sr-only` `Your availability` heading and a dismissible first-visit hint card reading `Click and drag to paint. Everything unmarked counts as unavailable.` — different copy, and no deadline or autosave indicator.

23. **Locked class blocks are diagonally striped.** — `AvailabilityEditor.tsx` / grid cell rendering. Design uses `repeating-linear-gradient(135deg,#3F3F46 0 6px,#4B4B53 6px 12px)` with a two-line label (mono title + `opacity:.75` sub), explicitly captioned `imported from Testudo, locked`.

24. **Grid metrics are specified.** — `AvailabilityEditor.tsx`. Design: 5 weekday columns only, `52px` hour rail, 26px cells over a 624px body (turn note says 30-min cells, 22px desktop / 16px phone), card `border-radius:12px` with `overflow:hidden`.

## Step 3 → Preferences

25. **Preferences sits beside availability, not after it.** — `Wizard.tsx`, `Step4Preferences.tsx`. In the design both are on one screen (`1fr 320px`); as a wizard step it would be a 320px rail. Ours is a full-width standalone step of stacked `Card`s.

26. **Hours range and control.** — `Step4Preferences.tsx` and `model.ts`. Design: a slider from **4 to 20** with mono end labels and a `10 h` readout. Ours: `MIN_HOURS = 2`, `MAX_HOURS = 20`, with `−` / `+` icon buttons rather than a slider.

27. **Duty preference is flat multi-select, not a sync/async slider.** — `Step4Preferences.tsx` and `model.ts`. Design: label `I'd like to do` over pills `Discussion` / `Office hours` / `Grading`. Ours: a `Type of work` card with a `syncAsyncPreference` 0–1 continuous slider (`Synchronous versus asynchronous work preference`) *plus* `dutyTypePrefs`.

28. **Section ranking uses drag handles and an explicit add row.** — `Step4Preferences.tsx`. Design: `Discussion sections, ranked` with a `drag to reorder` hint, `⋮⋮` handles, a rank numeral column, and a dashed `+ Add a section` row for unranked sections. Ours uses `Move up` / `Move down` buttons plus a `No preference` toggle (`noSectionPreference`), which has no design counterpart.

29. **Card titles differ.** — `Step4Preferences.tsx`. Ours: `Hours`, `Type of work`, `Sections you'd like to teach`, and an empty state `Your coordinator hasn't added discussion sections yet.` Design: one card titled `Preferences` with inline group labels `Max hours per week`, `I'd like to do`, `Discussion sections, ranked`.

30. **Cross-step conflict validation.** — `Step4Preferences.tsx` (new). Design shows a pink advisory card (`#FFF7F7` / `#FBD5DA` / `#7F1D1D`) reconciling step-1 class times against step-3 rankings: `Fri 10:00 conflicts with your CMSC330 discussion. Section 0104 is unranked for you.` We have no equivalent.

## Completion

31. **The design has no done screen.** — `DoneScreen.tsx`, `Wizard.tsx`. We ship a 440px centred screen with a `CircleCheck`, `You're set.`, `Your coordinator will publish assignments after {date}.`, a summary card (`Courses added` / `Hours marked` / `Weekly cap` / `Top preferences`), and `Go to My Schedule` + `Edit availability`. The design instead ends onboarding by landing the TA in the live app, where a red `Submit availability` button is the terminal action. Keeping `DoneScreen` is a deliberate divergence, not a gap in the design.

## Cross-cutting visual

32. **The design is light; the app is dark.** — `src/index.css`. Our tokens are `--color-surface: #0f0f13`, `--color-ink: #ededef`, `--color-line: rgba(255,255,255,0.08)`. The design is `#FAFAF9` canvas / `#fff` cards / `#18181B` ink / `#E4E4E7` borders. Every onboarding surface would need to invert (or the design would need a dark translation) — this is the single largest visual gap and it touches every file listed here.

33. **Primary button colour is inverted between contexts.** — `src/components/ui` (`Button`) and `WizardChrome.tsx`. The design uses **neutral black** for the onboarding Continue and reserves **`#E21833` red** for the post-onboarding `Submit` actions. Our `variant="primary"` is red everywhere, including in the wizard.

34. **Type scale is compressed relative to the design.** — `WizardChrome.tsx` and all four step files. Design onboarding: 30px headline / 15px body. Ours: 22px headline (`Step1Basics`), 15px `<h2>` (`Step2Classes`), 12.5px body throughout.

35. **Container width and page padding.** — `WizardChrome.tsx`. Ours: `max-w-[880px]` centred with `px-5 py-8 sm:py-10` and `gap-7/8`. Design: full 1440px with `padding:72px 120px` and a 28px column gap — substantially more generous, and a deliberate onboarding-only treatment.
