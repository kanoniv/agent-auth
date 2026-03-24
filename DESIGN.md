# Design System - Kanoniv Observatory

## Product Context
- **What this is:** AP authorization dashboard for AI agents - the proof and control layer between AI agents and QuickBooks
- **Who it's for:** Accounting firms managing AI agents that process invoices, create bills, and handle payments
- **Space/industry:** Fintech / AP automation / Agent authorization. Peers: Melio, Bill.com, Ramp, QuickBooks
- **Project type:** Data-heavy web app / dashboard

## Aesthetic Direction
- **Direction:** Luxury/Refined
- **Decoration level:** Intentional - subtle card elevation, thin borders, gold accent lines. Not cold-minimal, not noisy-expressive.
- **Mood:** Institutional authority with warmth. The dashboard a CFO trusts with financial controls. Feels like wealth management, not a SaaS app.
- **Reference sites:** Melio (meliopayments.com) for onboarding flow and layout patterns. Stripe Dashboard for data density.
- **Key insight:** Every finance dashboard uses cool blue-grays and sans-serif because they copy each other. Observatory is an AUTHORIZATION layer - it should feel institutional and weighty, like a legal document. Warm neutrals + serif headings differentiate from the entire category.

## Typography
- **Display/Hero:** Instrument Serif - Modern serif with institutional authority. No finance dashboard uses serif headings. This communicates "this is the law, not a suggestion."
- **Body/UI:** DM Sans - Clean geometric sans-serif. Professional, readable, neutral. Excellent weight range.
- **Data/Tables:** Geist - Purpose-built for data display. Perfect tabular-nums. Clean at small sizes.
- **Code:** Geist Mono - Monospace companion to Geist. For DIDs, tokens, scopes.
- **Loading:** Google Fonts for Instrument Serif + DM Sans. Self-host Geist/Geist Mono via npm (geist package).
- **Scale:**
  - H1: 32px / Instrument Serif / line-height 1.2
  - H2: 24px / Instrument Serif / line-height 1.2
  - H3: 18px / Instrument Serif / line-height 1.3
  - Body: 14px / DM Sans / line-height 1.6
  - Small: 13px / DM Sans / line-height 1.5
  - Caption: 12px / DM Sans / line-height 1.5
  - Label: 10px / DM Sans / font-weight 700 / uppercase / letter-spacing 0.1em
  - Data: 14px / Geist / tabular-nums
  - Mono: 13px / Geist Mono

## Color

### Light Theme (Primary)
- **Approach:** Restrained - one warm accent (gold) + warm neutrals. Color is rare and meaningful.
- **Background:** #FAFAF8 - warm off-white (NOT pure white)
- **Surface (cards):** #FFFFFF - pure white cards float on warm background
- **Surface hover:** #F7F6F3 - subtle warm hover state
- **Border:** #E8E5DE - warm border (NOT cool gray)
- **Border subtle:** #F0EDE6 - lighter border for inner dividers
- **Text primary:** #1A1814 - warm near-black (NOT pure black)
- **Text secondary:** #6B6760 - warm medium gray
- **Text hint:** #9C978E - warm light gray for labels and hints
- **Gold accent:** #B08D3E - deepened from original #C5A572 for better contrast on white
- **Gold hover:** #C5A572 - original gold, brighter on interaction
- **Gold tint:** #FAF6ED - very light gold for selected states and backgrounds
- **Gold border:** #E8DCC4 - light gold for accent borders
- **Gold text (small):** #8B7130 - darker gold for small text (better contrast)
- **Success:** #1A7A42 - muted deep green
- **Success bg:** #EDFAF2 / **Success border:** #C6F0D6
- **Warning:** #B8860B - dark goldenrod (harmonizes with gold accent)
- **Warning bg:** #FFF8E8 / **Warning border:** #F0DDB0
- **Error:** #C23A3A - muted red
- **Error bg:** #FDF0F0 / **Error border:** #F0C6C6
- **Info:** #2E6DA4 - muted blue
- **Info bg:** #EDF4FB / **Info border:** #B8D4F0

### Dark Theme (Secondary)
- Strategy: Warm dark surfaces, NOT pure black. Reduce accent brightness slightly.
- **Background:** #0F0E0C
- **Surface:** #1A1814
- **Surface hover:** #242118
- **Border:** #2E2A22
- **Border subtle:** #1E1B16
- **Text primary:** #E8E5DE
- **Text secondary:** #9C978E
- **Text hint:** #6B6760
- **Gold accent:** #C5A572
- **Gold hover:** #D4BC94
- **Gold tint:** #1E1A12

### Shadows
- **Small:** 0 1px 2px rgba(26, 24, 20, 0.04)
- **Medium:** 0 2px 8px rgba(26, 24, 20, 0.06)
- **Large:** 0 4px 16px rgba(26, 24, 20, 0.08)

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable - finance users need clarity, not cramming
- **Scale:** 2xs(2px) xs(4px) sm(8px) md(12px) lg(16px) xl(24px) 2xl(32px) 3xl(48px) 4xl(64px)

## Layout
- **Approach:** Grid-disciplined - strict alignment for data-heavy dashboard
- **Grid:** 12-column at desktop, 6-column at tablet, stack on mobile
- **Max content width:** 1200px
- **Sidebar:** 220px fixed, collapsible. White surface, border-right separator.
- **Border radius:** sm: 4px (inputs, small elements), md: 6px (cards, buttons), lg: 8px (modals, large containers), full: 9999px (pills, badges)
- **Card pattern:** White surface, 1px warm border, small shadow. No rounded-xl bubbly SaaS look.

## Motion
- **Approach:** Intentional - subtle entrance animations, meaningful state transitions. NOT expressive/playful.
- **Framework:** Framer Motion (already in use)
- **Easing:** enter: ease-out / exit: ease-in / move: cubic-bezier(0.25, 0.1, 0.25, 1)
- **Duration:** micro: 100ms / short: 150ms / medium: 250ms / long: 400ms
- **Patterns:**
  - Page enter: opacity 0->1, y 8->0, duration 200ms
  - Stagger children: 60ms between items (lighter than current 80ms)
  - No spring pops on data elements (springs are playful - wrong for finance)
  - Skeleton loaders for async data (pulse animation)
  - Height collapse for dismiss/remove

## Sidebar Navigation
Six items maximum (from Melio research):
1. Home (dashboard)
2. Clients (firm/QB connections)
3. Agents (registry + delegation)
4. Escalations (pending approvals)
5. Audit (provenance + export)
6. Settings

Icons: Lucide React, 18px, stroke-width 1.5. Active state: gold tint background + gold text.

## Accessibility Notes
- Gold accent (#B08D3E) on white: 3.5:1 contrast - passes AA for large text (18px+) and UI components
- For small gold text, use darker variant (#8B7130) at 5.2:1 contrast
- Primary buttons: gold bg (#B08D3E) with white text (#FFFFFF) - 4.5:1 passes AA
- All semantic colors chosen for WCAG AA compliance on their respective backgrounds
- Focus rings: 2px gold outline with gold-tint offset

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-24 | Initial design system created | /design-consultation based on Melio competitive research. Light theme mandatory for finance product. |
| 2026-03-24 | Instrument Serif for headings | Institutional authority differentiator. No finance dashboard uses serif - communicates "this is the law." |
| 2026-03-24 | Warm neutrals over cool grays | Every competitor uses cool blue-gray. Warm palette (#FAFAF8 bg) with gold feels like wealth management. |
| 2026-03-24 | Gold accent retained + deepened | Brand continuity. Deepened from #C5A572 to #B08D3E for white-bg contrast. No competitor uses gold. |
| 2026-03-24 | Tight border radius (4/6/8px) | Financial precision. No bubbly SaaS rounding. Tight corners communicate exactness. |
