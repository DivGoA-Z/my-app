# UI/UX overhaul — plan

Started 3 Oct 2026. The app works but isn't usable: every tool is
visible at once, each screen invents its own navigation, and there's
no visual system. This is a redesign of **layout, navigation and theme**
on the existing foundation (shadcn/ui + Radix + Tailwind v4). The
pricing, cutting list, store and tests are not touched.

Steps:
1. Users and tasks
2. Structure
3. Design system
4. Mockups, reviewed before code
5. Build page by page

This file holds steps 1–2. The design system and mockups are reviewed
as web pages; links are recorded at the bottom.

---

## 1. Who uses it, where

| Who | Where / device | What they're doing |
|---|---|---|
| **Designer + customer together** | Showroom or customer's home. Laptop or **tablet**, customer watching and sometimes touching it | Build or change the kitchen live, try finishes, see 3D, agree a price, **finalise the quote on the spot** |
| **Designer alone** | Desk, laptop | Draw the plan from site measurements, set up cabinets, prepare the quote |
| **Owner** | Laptop or **phone** | Pipeline, which quotes are out, follow-ups, rates and catalogue |
| **Workshop** | Laptop or printer | Cutting list, sheet layouts, labels |

**The design page is customer-facing.** The customer watches and edits
alongside the designer, so it must look good, not only work. Present
mode is no longer the only "pretty" screen.

## 2. Top tasks (fewest clicks)

1. Start a new customer and get to the plan.
2. Set the room size and walls, then add pillars, doors and windows.
3. Add cabinets and appliances and arrange them.
4. **Change something the customer asks for** (finish, size, front,
   handle) and see the price update.
5. See it in 3D with the customer.
6. **Finalise:** freeze the quote and send it on WhatsApp.
7. Find a customer and see where they are in the pipeline.

Second level, one click deeper: cutting list, Cabinet Designer, glass
order, labels, versions. Third level, in Settings: rate card,
catalogues, Workshop settings, business details.

## 3. Devices

| | Laptop (≥1280) | Tablet (768–1279) | Phone (<768) |
|---|---|---|---|
| Pipeline, customers | ✓ | ✓ | ✓ list view |
| Draw/edit plan | ✓ full | ✓ **touch-first** | view + **light edits** only |
| Inspector edits (finish, size, front) | ✓ right panel | ✓ slide-over panel | ✓ bottom sheet |
| 3D, Present | ✓ | ✓ | ✓ |
| Quote: view, edit, freeze, send | ✓ | ✓ | ✓ |
| Cutting list | ✓ | ✓ | view / download only |
| Settings (rates, catalogue) | ✓ | ✓ | view + simple edits |

Touch rules, which apply on every device:
- Hit targets are at least 40px (44px on touch).
- No action exists only on hover or only on double-click. Rotate gets a
  button, not just a double-click.
- Pinch to zoom and two-finger pan on the plan.
- Panels slide in rather than squeezing the canvas.

## 4. What we take from each reference

| Reference | What we take |
|---|---|
| **IKEA planner** | A **guided flow**: Room → Layout → Cabinets → Finishes → Quote as visible steps (free to jump around). Product picking from pictures, not lists. |
| **RoomSketcher** | The **editor**: clean canvas, live dimensions while dragging, typed measurements. |
| **Planner 5D** | **Beginner UX**: big friendly catalogue tiles, obvious undo, nothing scary on first open. |
| **Homestyler** | **Materials**: finish swatches as large visual tiles, "apply to all" in one tap. |
| **SketchUp** | **Precision**: type exact numbers, snapping, nudging with arrow keys, for the designer alone. |
| **Cedreo** | **Presentation**: Present mode and the quote PDF as polished, branded customer-facing output. |

## 5. Structure (screen map)

```
Sign in
└── App shell (every screen): top bar + navigation
    ├── Home: today's follow-ups, quotes out, recent customers, "+ New customer"
    ├── Customers (pipeline): board/list, search, filters
    │   └── Customer: details, quotes (all versions), designs
    │       └── Design editor (steps: Room · Layout · Cabinets · Finishes · Quote)
    │           ├── views: Plan · 3D · Elevation
    │           ├── Present (full screen, for the customer)
    │           ├── Cabinet Designer (one cabinet's panels)
    │           └── Cutting list (+ print, labels, glass order)
    └── Settings
        ├── Business (name, logo, contact, used on quote PDF)
        ├── Rate card
        ├── Catalogue: cabinets · appliances · finishes · handles · fixtures · obstacles
        └── Workshop settings
```

Today's screens map onto this as follows:
- dashboard → Home + Customers
- canvas → Design editor
- preview3d / elevation → views inside the editor
- inventory → Settings
- workshop → Settings
- cutlist / designer / present → unchanged places, new shell

## 6. Design editor layout (the most important screen)

**Laptop**

```
┌─────────────────────────────────────────────────────────────────┐
│ ← Neha Verma   Room · Layout · Cabinets · Finishes · Quote  Saved ✓ │
├────┬────────────────────────────────────────┬───────────────────┤
│Rail│              Plan | 3D | Elevation      │ Right panel        │
│ ▢  │                                         │ selected → Inspector│
│ ▦  │            canvas (full height)         │ nothing → Quote    │
│ ◫  │                                         │ summary + Finalise │
│ ⌂  │                                         │                    │
│ ✦  │                                         │                    │
├────┴────────────────────────────────────────┴───────────────────┤
│ ⚠ 2 checks ▸   Undo Redo   Zoom   ·   ₹1,84,500 incl. margin  [Finalise] │
└─────────────────────────────────────────────────────────────────┘
```

- **Left rail:** one tool panel opens at a time: Room, Cabinets,
  Appliances, Doors & windows, Lighting, Cameras. The catalogue shows as
  picture tiles.
- **Right panel:** the inspector for the selection, otherwise the quote
  summary. The full quote opens as its own panel.
- **Bottom bar:** design checks (replacing the four tick boxes),
  undo/redo, zoom, and the **live total with a Finalise button**,
  always visible, since that is the point of the session.

**Tablet:** the rail stays. The inspector and quote become slide-over
panels from the right, and the canvas keeps the full width.

**Phone:** a bottom tab bar (Plan · 3D · Quote · More). Tapping an item
opens a **bottom sheet** with its options (finish, size, front). No
free drawing.

## 7. UI principles (agreed 3 Oct 2026 — now in PRINCIPLES.md Part 1)

1. **One primary action per screen**, and it's obvious: "+ New
   customer", "Finalise quote", "Save".
2. **The customer is watching.** Anything on the design page may be
   seen by the customer, so the machinery (cost basis, margin, waste,
   board rates) stays behind a "Details" toggle. The customer sees
   finishes, sizes and the price.
3. **Progressive disclosure.** Show the 20% used 80% of the time. The
   rest is one click deeper, never removed.
4. **Same thing, same place, same look.** One shell, one back
   behaviour, one way to edit a list, one way to confirm a delete.
5. **Touch is first-class.** Every action works by tap. Hover and
   double-click are shortcuts, never the only way.
6. **Pictures over words** for products and finishes. Numbers are typed
   wherever precision matters.
7. **Never a dead end.** Every empty screen says what to do next; every
   error says how to fix it.

## 8. Build order

1. Design system (theme) + app shell + responsive breakpoints
2. Design editor (laptop, then tablet, then phone light-edit)
3. Inspectors + quote panel + Finalise flow
4. Home + Customers
5. Cutting list, Cabinet Designer, Settings (rate card, catalogue,
   Workshop)
6. Sign in

Each page is mockup → your OK → build → screen tests updated → you
check it on laptop, tablet and phone.

## Progress

- 3 Oct: look and editor layout approved; UI principles agreed; theme
  tokens and fonts in `src/index.css` (every screen picks them up).
- 3 Oct: Home, Customers (board) and Customers (phone) mocked up on the
  same canvas, using the app's real pipeline stages (Lead, Layout
  drafted, Quote sent, Approved, In production).

- 3 Oct, decided on review:
  - **Home cards:**
    - Quotes out
    - Follow-ups due
    - **Approved jobs (open)**: every approved job not yet installed, with
      the split "not started / in production". Not "this month"; monthly
      sales can be a report later.
    - Installs coming up
  - "Recent designs" → **Continue designing**: designs not yet approved,
    edited in the last 7 days.
  - **Two new pipeline stages:**
    - **Installed**: the end of a job; the board shows the last 30 days.
    - **Lost**: off the board, under a filter, and asks for a **reason**
      (price, went elsewhere, postponed, other).
  - **In production** gets an **install date**.

- 3 Oct: **built**: app shell (sidebar / icon rail / phone tab bar),
  Home, Customers (board + list + Lost reason + install date) and
  Settings (rate card, workshop, account). The rate card moved out of
  the catalogue. Not yet seen in a browser. Next: the design editor.

- 3 Oct: Catalogue page redesigned (section frames, help behind a
  toggle, most-used first), sidebar sub-list for its sections, cutting
  list from a customer card (§71).

## Review links

- **3 Oct 2026 — design system v0.1 + design editor (laptop, tablet,
  phone):** https://claude.ai/artifact/PL5bCLZw5Yyq6o5Jk8jNbb (private).
  The look is called "Calm workshop": warm paper neutrals, a forest-green
  primary (#1F5C4A), brass for warnings, Plus Jakarta Sans for text and
  JetBrains Mono for measurements. The laptop editor is clickable. All
  figures in it are samples.
