#Issues

Real-use bug reports and feature requests, logged as they come up.
Move an item to `docs/ISSUES-FIXED.md` once resolved (or investigated
and found not to be a code defect) — never delete it. See `CLAUDE.md`.

## Open

- **Quote PDF prints the business name from `.env`, not from Settings.**
  Found 4 Oct 2026 by Claude while scoping the PDF logo. `lib/quotePdf.ts`
  reads `VITE_BUSINESS_NAME` / `VITE_BUSINESS_PHONE`, and its comment
  says "there is no `businesses` table yet", which stopped being true
  (§70: the table exists, and Settings → Business renames it). So
  renaming the business in Settings never reaches the customer's PDF,
  and with a second business, every business's quotes would carry
  whatever name the `.env` on that machine has. This blocks
  hand-onboarding customer #1 (listed in `AFTER_FIRST_CUSTOMERS.md`).
  The fix comes with the business profile + logo work.

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
