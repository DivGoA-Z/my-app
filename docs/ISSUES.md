#Issues

Real-use bug reports and feature requests, logged as they come up.
Move an item to `docs/ISSUES-FIXED.md` once resolved (or investigated
and found not to be a code defect) — never delete it. See `CLAUDE.md`.

## Open

**AI images draw small mosaic tiles about twice too big (23 Nov 2026).**
- A 35 mm hexagon mosaic comes out at about 70 mm in every Photographic
  v2 image. That held with the tile size in words (§139), the finish
  photo attached, and a row count (§145: "about 17 rows"; the image
  showed about 8). Large floor tiles come out right.
- **Untried lever: output resolution.** The Worker sends no
  `imageConfig.imageSize`, so Gemini returns its default (about
  1376×768). There a 35 mm tile is only 8–10 px, near the size of the
  model's internal patches, too small to draw as separate tiles, so it
  enlarges them. `imageSize: "2K"` would give 16–20 px per tile.
  Lowering the resolution would make it worse.
- To test: add an "Image size (1K / 2K)" setting per prompt in the
  Prompt lab and compare v2 at 1K and 2K on the same camera. Check
  Google's current pricing for 2K first.
- If 2K doesn't help, drop this theory and the §145 count line, which
  then isn't earning its words.
- Parked by the user on 23 Nov 2026, to come back to later.

**28 Sep 2026, corrected twice over.** Earlier the same day, this file
was edited to list 20 items as open, sourced from `docs/Issues_fixed.md`
— a mislabeled file whose name said "fixed" but whose content read like
an undated list of unresolved reports. That edit was itself wrong:
cross-checking each of the 20 items against `docs/ISSUES-FIXED.md`
shows every one already has a matching "fixed" or "investigated, not a
bug" entry there, dated 21–23 Sep 2026. `Issues_fixed.md` was the
ORIGINAL raw complaint list from before that triage process — never
cleared out even though nothing on it was still open by the time it
was read. Reverted back to empty; `Issues_fixed.md` deleted (nothing
lost — its content is the same 20 items already logged, resolved, in
`docs/ISSUES-FIXED.md`). Full account, including the item-by-item
cross-reference, in `docs/DECISIONS.md` §31 (corrected in place).

Two of those twenty are worth a second look rather than treated as
definitely closed, since their `ISSUES-FIXED.md` entries said so
explicitly:

- "floor shows some reflections or some other things rather than
  simple floor" — investigated 22 Sep, not reproducible at the time;
  reopen with a fresh screenshot if it recurs.
- The two `TypeError: Failed to fetch` save errors (appliance catalog
  save, project save) — investigated 21 Sep, transient network drops
  at the time, not code defects; reopen if either recurs against a
  confirmed-live connection.
