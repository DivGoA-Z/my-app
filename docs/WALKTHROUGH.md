# End-to-end walkthrough

A script for building one kitchen from scratch and checking that every
part of the app works. Rates are out of scope, but the arithmetic is
checked. Written 3 Oct 2026. Expected numbers come straight from the code
(the same functions the app uses), so a mismatch means something is wrong.

**How to use it:** go top to bottom and tick as you go. Write anything
odd in `docs/ISSUES.md`, one line each, e.g. "Step 4.2 — drawer unit
drags 18mm off the wall". Odd counts too: confusing wording, a button
you couldn't find, a slow screen.

**Leave the Workshop settings and rate card alone until Part 9.** The
expected numbers assume the defaults (Workshop settings untouched, the
seeded rate card: HDMR 18mm ₹1,400/m², HDMR 6mm ₹450/m², site labour
₹150/sq ft, fabrication ₹2,500 per cabinet, margin 25%, waste ×1.00). If
you've already changed any of these, the price checks in Part 6 will
differ by exactly that change.

Never seen in a browser before today, so look harder at these: Parts 7–10.

---

## Part 1 — Start

- [ ] `npm run dev`, open the app and sign in.
- [ ] Dashboard (**Customer Pipeline**). Click **+ New Lead** and add
      "Test Kitchen A" with any phone number and locality.
- [ ] Click **Open 2D Canvas** on that row.
- [ ] The header shows "Test Kitchen A — <locality>", with **← Back to
      Pipeline**, **Wall Elevation**, **3D Preview**, **Present**,
      **Cutting List** and **Save Project**.

## Part 2 — Room

- [ ] **Room Settings**: set the room to 3000 × 2400 mm and click **Apply**.
      The plan redraws at that size.
- [ ] Add a **pillar** (Obstacle toolbar), e.g. 300 × 300 in a corner. It
      takes floor space, and a cabinet dropped onto it gets an overlap
      warning.
- [ ] Add a **door** and a **window** (Opening toolbar) on two walls.
- [ ] **Show dimensions** on and off: wall and item dimensions appear and
      disappear.

## Part 3 — Cabinets

Place these along the walls from the Cabinet toolbar:

| # | Cabinet | Size (W × D × H) | Front |
|---|---|---|---|
| A | Base | 600 × 600 × 720 | single door |
| B | Drawer unit | 600 × 600 × 720 | 3 drawers |
| C | Sink unit | 900 × 600 × 720 | double door |
| D | Corner carousel | 900 × 900 × 720 | (diagonal door) |
| E | Wall cabinet | 800 × 350 × 720 | double door, **brown glass** |
| F | Tall unit | 600 × 600 × 2100 | double door |

- [ ] Drag each one. It snaps to the grid and stays inside the room.
- [ ] Double-click to rotate. It turns about its centre and the front
      faces the room.
- [ ] Overlap two cabinets on purpose: an overlap warning appears. Move
      one apart and the warning clears.
- [ ] Put a cabinet so its door swing hits the pillar or the door: a
      clearance warning appears.
- [ ] **Undo / Redo** (Cmd+Z / Cmd+Shift+Z) steps back and forward
      through your moves.
- [ ] "Auto saved hh:mm" appears in the header a few seconds after an
      edit. Reload the page and everything is still there.

## Part 4 — Appliances and checks

- [ ] Add a **hob** on a base cabinet, a **sink** in the sink unit, a
      **chimney** above the hob, and a **fridge** on the floor.
- [ ] Kitchen checks (**Show kitchen ergonomics checks**):
  - move the hob right next to the sink: a sink–hob distance finding
  - move the fridge right next to the hob: a fridge distance finding
  - put the hob under the window: a finding
- [ ] Move them apart again and each finding clears.

## Part 5 — 3D, lighting, presenting

- [ ] **3D Preview**: walk around. Cabinets are where the plan says; the
      glass wall cabinet is see-through brown; the carousel has a
      diagonal door.
- [ ] Lighting toolbar: switch between the three lighting modes and move
      the brightness. The scene changes and stays responsive.
- [ ] Add a **camera node**, then capture a 360° panorama from it.
- [ ] **Wall Elevation**: each wall's cabinets show at the right heights.
- [ ] **Present**: the 3D view and a clean floor plan. Clicking can't move
      anything. The price shows only when you reveal it.

## Part 6 — The quote (arithmetic check)

The calculations are easiest to check on a kitchen with ONE cabinet. Make
a second lead, "Test Kitchen B", with a single **Base 600 × 600 × 720,
single door**. In the Cabinet Designer (Part 8), make sure no extra
shelves are ticked.

Expected in the quote sidebar (seeded rates):

| Line | Expected | How it's worked out |
|---|---|---|
| Board area | **22.70 sq ft** (2.109 m²) | every part's real area (Part 7 list) |
| Board (material) | **₹2,567** | 1.703 m² of 18mm × ₹1,400 + 0.406 m² of 6mm back × ₹450 |
| Hardware | **2 hinges** | door 720 high → 2 hinges |
| Labour — site installation | **₹3,406** | 22.70 sq ft × ₹150 |
| Labour — fabrication | **₹2,500** | per cabinet |
| Cost total | **₹8,923** | sum of the lines above |
| Margin 25% | **₹2,231** | |
| **Grand total** | **₹11,153** | |

- [ ] The figures match, to the rupee or within ₹1 of rounding.
- [ ] Set the project's **sheet waste** to 1.10. Board becomes ₹2,824 (×1.10)
      and the total moves to match. Then click **use default**.
- [ ] **Customise for this project** under Labour and other charges:
      change fabrication to ₹3,000 and the total goes up by ₹500 + 25%
      margin = **₹625**. Then click **Use business-level rate-card charges
      again** and it returns to ₹11,153.
- [ ] Place a light fixture, then tick and untick **Charge electrical work**
      (Lighting toolbar). The fixture's cost is added to the total, then
      shown as "not charged".

## Part 7 — Freeze, send, versions

(On Test Kitchen A, the full kitchen.)

- [ ] **Freeze quote**. The card shows "Quote v1", the total, and "Matches
      the current design".
- [ ] **Download PDF**: it opens and the totals equal the sidebar.
- [ ] **Share on WhatsApp**: WhatsApp opens with a link to the PDF. You can
      send it to your own number using "A different number, just this once".
- [ ] Move a cabinet: the card turns amber ("design has changed"). Click
      **Freeze v2**.
- [ ] **All frozen versions (2)** at the bottom: choose v1. You can download
      its PDF with the OLD total, and **Cutting list for v1 →** opens it.
- [ ] Dashboard: the customer's quote column shows the sent quote.

## Part 8 — Cutting list

(Test Kitchen B, the single base unit, is the easiest to read.) Click
**Cutting List**.

Expected parts for the Base 600 × 600 × 720, single door, default
settings:

| Part | Size (mm) | Board | Edge |
|---|---|---|---|
| Left side | 720 × 582 | HDMR 18mm | 1L |
| Right side | 720 × 582 | HDMR 18mm | 1L |
| Front rail | 564 × 100 | HDMR 18mm | 1L |
| Back rail | 564 × 100 | HDMR 18mm | — |
| Bottom | 564 × 582 | HDMR 18mm | 1L |
| Back | 700 × 580 | HDMR 6mm | — |
| Shutter | 714 × 594 | HDMR 18mm | 2L 2W |

Why these sizes:
- **582 deep**: 600 minus the 18mm shutter (the depth includes the
  shutter).
- **564 wide**: 600 minus two 18mm sides.
- **714 × 594**: the door minus a 3mm gap on each edge.

- [ ] The parts match.
- [ ] On Test Kitchen A, spot-check the special cabinets:
  - **Drawer unit**: 3 × Drawer front 236 × 594, and per drawer a Drawer
    bottom 540 × 489 and a Drawer back 477 × 176.
  - **Corner carousel**: Return panels 720 × 540 (×2), pentagon
    Top/Bottom 882 × 882, two Backs, **Shutter (diagonal) 714 × 503**.
  - **Glass wall cabinet**: no shutters in the board list. **Glass to
    order** shows 2 × 714 × 395, Brown tint.
- [ ] Switch between **For cutting**, **By cabinet** and **Sheets & waste**.
      The sheet drawings show every part, with dimensions.
- [ ] Click a cabinet ref (e.g. C1) and it opens that cabinet in the
      Designer.
- [ ] **Export to Excel**: tabs for parts, sheet layout and glass order.
- [ ] **Print (PDF)**: parts per board, glass, then one page per sheet.
- [ ] **Part labels (PDF)**: 24 per page, "piece n of N".
- [ ] Version dropdown: switch to Quote v1. It shows that quote's list,
      read-only.

## Part 9 — Cabinet Designer

(From a Cutting List cabinet link, or select a cabinet → **Panels & boards…**
in its inspector.)

- [ ] Untick **Back**. The Back part disappears and **Save** lights up.
      Board cost drops by about **₹183** (0.406 m² × ₹450). Click **Discard
      changes**.
- [ ] Set **Extra shelves** to 1. A Shelf part appears (about 564 × 556).
- [ ] Add an **extra part** (e.g. a filler 720 × 100). It's listed and
      priced, and noted as not drawn in 3D.
- [ ] Change the carcass board. Every carcass part moves to that board.
- [ ] The 3D preview: hover a row and that panel lights up. Rotate the
      view.
- [ ] **Save**, go **← Back**, and confirm the quote changed by the same
      amount.

## Part 10 — Workshop settings and depth

(Header → **Workshop settings**.)

- [ ] Read through the choices. The banner says they're **assumed**.
- [ ] Change **"Cabinet depth (e.g. 600) means…"** to **Carcass only**.
      Then:
  - Cutting list: sides become **720 × 600** and the bottom **564 × 600**.
    The shutter is still 714 × 594.
  - Board area for Test Kitchen B becomes **23.09 sq ft**.
  - Plan: each cabinet now reaches **18mm further into the room**, while
    its back stays against the wall. Check this at all four rotations
    if you can.
  - Drag a cabinet in this mode: it lands where you drop it and doesn't
    creep forward each time.
- [ ] In one project's **Room Settings**, set the depth back to "Includes
      the shutter". Only that project changes.
- [ ] Put Workshop settings back to the defaults. Don't **confirm/lock**
      yet; that's for when a carpenter has checked them.

## Part 11 — Rate card and catalogue (mechanics only)

(**Manage Inventory**.)

- [ ] Rate card: change any number. The amber **Unsaved rate changes**
      bar appears; **Save rates** saves it. Change it back.
- [ ] Sheet waste on quotes: switch **Approx — one factor ↔ Calculated — per board**. The quote's
      board figure changes to the measured sheet waste. Switch back.
- [ ] Boards: try removing **HDMR 18mm**. It's blocked and names the
      projects using it.
- [ ] A catalogue row's board dropdown: only priced boards are offered.
      **+ Add a new board…** needs a rate, then appears on the rate card.
- [ ] Excel: export the cabinet catalogue, change one row's price in
      Excel, import it, review, commit. Only that row changes; its panels
      and fronts are kept.

## Part 12 — Pipeline

- [ ] **← Back to Pipeline**. Change Test Kitchen A's status (Lead →
      Layout Drafted → Quote Sent …). It's kept after a reload.
- [ ] The quote column shows the sent version and its date.
- [ ] Sign out and back in. Everything is still there.

---

**When you're done:** everything you wrote in `docs/ISSUES.md` is the
fix list. After that come browser tests that script these same parts.
You can delete or keep the two test leads.
