# After the first customers

Work deliberately parked until a few businesses (customers) are using
the app. They are onboarded **by hand** first. Decided 3 Oct 2026: build
for the businesses that exist, not for imagined ones.

The **Before the first customer** section is the exception. It lists
what has to be true before customer #1 is onboarded by hand.

## Principles for this phase

1. **Hand-onboard first, automate later.** Run the manual steps for the
   first few customers and write down every step and every question
   they ask. Self-serve sign-up then automates a process that's known to
   work, rather than one that was guessed.
2. **Each customer's feedback goes in `docs/ISSUES.md`, with who
   reported it and the date.** What several customers ask for outranks
   what one asks for, and both outrank what we guess.
3. **No change to a customer's numbers without telling them.** A
   pricing or cutting-list change alters live quotes for real
   businesses now. Frozen quotes never change (CLAUDE.md), but open
   ones do, and a release note is owed.
4. **Data isolation is checked, not assumed.** Each business sees only
   its own data (RLS). It was built for that but only ever ran with
   one business, so prove it with two before relying on it.
5. **Placeholders stay labelled.** A new business starts on the seeded
   rates, and the amber banner stays until that business replaces them.
6. **Shared things are opt-in.** Anything shared between businesses
   (catalogue, presets) is a copy the business chooses, never live
   data another business can change under it.

## Before the first customer (needed for hand-onboarding)

- [x] **Starter catalogue for a new business.** Built 7 Oct 2026
      (§107): a master starter (`biz_starter`, filled from your catalogue
      by `refresh_starter_catalog`) is copied into each business by
      `approve_new_business`, and saved as its default ("Go back to my
      default" on the Catalogue page). The rate card and Workshop settings
      still start on the in-app defaults.
- [x] **A written onboarding runbook.** `docs/DEPLOY.md`, "Sign-up and
      approving a new account" (§106–§107): they sign up, you run one
      `approve_new_business` line, they press Check again.
- [ ] **Two-business isolation check** (principle 4). The check is
      written and passes against a local copy of the schema (§107):
      `supabase/isolation_check.sql`. **Still to do: run it in the real
      Supabase** after re-running `schema.sql`. Note: the
      `businesses` table itself had no RLS until 3 Oct (§70) — exactly the
      kind of gap this check exists to find. Sign in as each
      business and confirm neither sees the other's customers, quotes,
      catalogue, rates or uploaded files.
- [x] **Business profile on the quote PDF: name, phone, logo, GSTIN.**
      Built 4 Oct 2026 (§94). Remaining: re-run `schema.sql`, then fill in
      Settings → Business. Include it in the two-business isolation check
      (each sees and prints only its own name and logo).
- [x] **Your own super-admin view.** Decided 7 Oct 2026 (§107): no
      bypass in the app, so the app always shows your own business only;
      you see everything through the SQL editor. A "view as business X"
      switch can come later if support needs it.

- [ ] **A proper domain.** The app runs at
      `my-app.divyanshgoyal240.workers.dev` (Cloudflare, `docs/DEPLOY.md`),
      which is fine for you and your co-founder but shows the account
      name. Buy a domain (roughly ₹800–1,500 a year) before businesses
      that pay you start using it. Moving later costs each business a new
      bookmark and one sign-in; quote PDFs already sent keep working (they
      live in Supabase storage). Afterwards: attach it in Cloudflare
      (Domains), and set Supabase → Authentication → Site URL to it.
- [ ] **Supabase paid plan (about $25/month), for backups.** The free
      plan has no daily backups and pauses after a quiet week. Once a
      business's real customers and quotes are in, losing them would be
      serious. Also check the free plan's storage and download caps
      against what 360° photos and quote PDFs use. Decided 5 Oct 2026:
      both this and the domain before the first few customers; stay on
      the free plan and `workers.dev` until then.
- [ ] **A "set a new password" screen.** Supabase's password-recovery
      email signs a person in but the app has nowhere to choose a new
      password, so today a forgotten password is reset by hand in SQL
      (`docs/DEPLOY.md`). Needed before businesses manage their own logins.

## Parked until a few customers are onboarded

- **Self-serve sign-up** and a first-run walkthrough for a new
  business. Billing and SaaS pricing are an open decision
  (`docs/PRINCIPLES.md`).
- **Real rates.** Each business enters its own. Possibly a guided "set
  your rates" step during onboarding.
- **Shared / global catalogue toggle.** The shape is in
  `docs/PRINCIPLES.md`; it needs real businesses to know what they'd
  share.
- **Our own email sender (SMTP).** Supabase's built-in email, which
  sends the sign-up confirmation link (§106), allows only a few messages
  an hour on the free plan. Fine for a handful of sign-ups; once more
  people are signing up, set up an email service (Supabase →
  Authentication → Emails → SMTP settings) so confirmation emails don't
  stall.
- **Carpenter validation of the cutting list.** Compare one real job's
  parts and sheet count against what was actually cut, then confirm
  Workshop settings. It can come from the first customer who has a
  workshop.

- **Opening cabinets in 3D** (doors, drawers, tambour, corner units).
  Parked 4 Oct 2026, to decide later which option, once customers have
  seen the 3D and said whether they'd use it. Both need **inside parts
  first**: carcasses are closed boxes today, so opening a door shows an
  empty shell. Those inside parts (shelves, drawer boxes) must agree
  with the cutting list: if the 3D shows two shelves, the cutting list
  and price count two.
  - *Cheaper:* a **"Show open"** switch in Present mode. Every cabinet
    is drawn standing open in one fixed position (doors at 90° on their
    hinge side, drawers and trolleys two-thirds out, tambour rolled up),
    with basic inside parts from the cutting list's counts. No
    animation and no per-cabinet interaction. Roughly a third of the
    work, most of the customer reaction, and it builds the inside parts
    the full version needs anyway.
  - *More interesting:* **tap a cabinet to open it, animated.** Doors
    swing on their hinge, drawers slide, tambour rolls, and corner
    carousel or magic-corner trays turn or pull out. Default closed.
    Needs the inside parts above, movement for six front kinds plus the
    corner mechanisms, and a tap that opens without fighting
    tap-to-select. The module-type split in DECISIONS §3 was made to
    give this a clean seam. Several sessions; the cutting-list link is
    the risky part.

## Deliberately deferred

- **Cabinet cutouts sized to placed appliances** (beyond the sink):
  - a hob's cutout in the countertop
  - a built-in oven or microwave opening in a tall unit
- **Rectilinear (L/U-shaped) rooms**: §27. Rectangle plus pillars
  covers most Delhi NCR kitchens.
- **Hardware boring / CNC export**: drilling positions, DXF or
  panel-saw formats, for workshops with machines.
- **Offcut reuse across jobs and a board inventory.**
- **Lighting**: `RectAreaLight` for strip lights (§5) and the `inside`
  cabinet-light mount.
- **Draco decoding** for smaller 3D models.

## Not planned (decided)

- **Accept/reject on the WhatsApp quote.** The quote goes out as a PDF
  link and acceptance happens in conversation, which is how the trade
  works. Decided 3 Oct 2026.
