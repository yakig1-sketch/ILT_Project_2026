# Letter sheets → intervention canvases (Phase 5a)

`extract_letter_sheet.py` turns one of the clinical team's intervention letter sheets
(`Documents/09_Samples/Hebrew_Letter_Sheets/*.pdf`) into an ILT canvas: the boxes, the dots, and
the model letter, all in millimetres at true size.

The output for the four arc letters ה ח ק ת is committed in
`Documents/05_Measures/Intervention_Letters/`:
- `<CODE>.json` holds the canvas geometry, a starting scoring profile and an extraction report.
- `<CODE>_check.png` is the sheet with the extracted values drawn on top, for checking by eye:
  - boxes in green;
  - dots as red rings, numbered in writing order;
  - each pen stroke's centre line in orange.

`pnpm db:seed` loads these files into the Hebrew intervention letter set as **Draft** canvases.

## How a sheet is read

A block on the sheet is 3 rows of 5 boxes, written right to left:

| Row | On the sheet | On the canvas |
|---|---|---|
| 1 | The model letter in the first box (blue). In the other four boxes, only the dots where each pen stroke starts and ends | `TRACE_MODEL`. Every box gets all the dots; the first box also shows the model letter (`show_model`) |
| 2 | Only the start dot | `START_DOT`, one dot |
| 3 | Empty | `FREEHAND`, no dots |

- **Box frames and the model letter** are vector drawings in the PDF, so they are exact.
- **The dots** are small pictures. The page is rendered at 600 dpi, and each dot is the centre of a dark grey ring.
- **Pen strokes.** Each separately filled part of the model is one pen stroke; for example, ה has the arch and the left leg. A stroke's path is the centre line (skeleton) of its shape.
- **Writing order:**
  - The stroke that starts at row 2's start dot comes first.
  - The other strokes start at their higher end.
  - Dots are numbered in that order: stroke 1's start, any corner, its end, then stroke 2, and so on.
  - Stroke ends are matched first; a dot that isn't at an end is a corner along a stroke (ת's foot).
- **Row 1's dots** are the mean of the four traced boxes; the report gives how far they spread.

## Points the clinical team should check

- **Stroke order of ח.** The sheet has three dots: the top-left start serves both strokes, and the left leg's own start has no dot. The canvas takes the arch first (dots 1 → 2), then the left leg (its end is dot 3), as on the ה sheet.
- **Dot positions.** They are as printed, hand-placed in Word. They vary by up to 1.6 mm between boxes, and row 2's start dot is up to 2.5 mm from row 1's.
- **Profile defaults** (in the canvas screen, editable while Draft):
  - every dot: 3.5 mm radius, equal weights, none required;
  - 30 expected pen lifts per sheet (two strokes per letter);
  - no normal speed yet (record it in reference mode).

## Running it

Use Python 3.12 with the packages in `requirements.txt`. From the repo root:

```bash
sh tools/letter-sheets/run_all.sh
```

Re-running it changes only the JSON and PNG files. The database keeps its canvases until a new
version is loaded through the canvas screen.
