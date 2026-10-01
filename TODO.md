# TODO — Damic / Durrah Al-Munawwara

Open work across the three repos: **`dam-backend`** (this one), **`munnawara-web`** (website), **`dam-admin`** (admin panel). Items are grouped by who is blocking them. Tick them off as they land.

Last reviewed: 2026-10-01.

---

## 1. Waiting on Abdullah (content & decisions)

### Partners page — logos
- [ ] Logo pack for the Partners page: SVG preferred, transparent PNG otherwise, plus **name** and optional **website link** for each partner.
  - Where it goes: drop files in `munnawara-web/public/partners/` and add one entry each to `munnawara-web/src/content/partners.ts`. The grid (`PartnerLogoGrid`) is already built and shows nothing until the list has entries; until then the site falls back to the client category chips.

### Fleet — specs and videos
- [ ] **Decide the scope:** does every bus class get its own motion video, or only the flagship ones (VIP, standard)?
- [ ] **Sign off the specs.** The brochure and the knowledge base disagree on seat counts and nothing should be published until Abdullah picks one set:
  - Brochure (`munnawara-web/src/content/*/fleet.ts`): Premium VIP 18+1+1 · VIP 28+1+1 · Coach 49+1+1 · City 45+1 / 55+1 · Labour 66+1 · Mini 55+1.
  - Knowledge base: VIP 32 · standard 49 · city 19 · 45-seat · staff/employee 48 & 60.
  - Only state what is confirmed (A/C yes across the board; accessibility, Wi-Fi/charging and onboard restroom vary by model).
- [ ] Confirm the **Mini Bus** label — the brochure's Arabic banner says «سيتي باص» while the English says Mini Bus (`notes` field on that fleet entry).
- [ ] The bus clips themselves (see §2).

### Quote wizard — confirm my drafts
Everything below is in one editable file: `munnawara-web/src/components/forms/quoteWizardConfig.ts`.
- [ ] Customer types (Individual, Company, Government, School/University, Hajj/Umrah mission, Tourism company).
- [ ] **Company sub-menu** (currently: workers/staff, school/university, tourism groups, events & conferences, VIP airport transfer, international routes, other). The notes say “get the exact list”.
- [ ] English names for the Umrah products: *Umrah Group Package*, *Umrah Circuit (Dawra)*, *Point-to-Point Transfer (Maqta')*, *Short Circuit*, *Long Circuit with Ziyarat*.
- [ ] Exactly what a **short** vs **long** Dawra includes.
- [ ] **Ziyarat list** (13 sites incl. Badr as a full-day trip) and which are pre-ticked by default.
- [ ] Maqta' places (Jeddah Airport, Makkah, Madinah, Madinah Airport) — any others?
- [ ] Bus classes and seat labels offered in the wizard (tie to the fleet sign-off above).
- [ ] Extras offered (supervisors, live tracking, branding, airport pickup).
- [ ] Wording of the home-page **ticket** (“Boarding pass”, “Your journey starts here”, “Umrah circuits · Transfers · Corporate · Charter”, Arabic text) — `munnawara-web/src/components/sections/QuoteTicket.tsx`.

### Durri (the chatbot) — review and approve
- [ ] Read the **Arabic** canned answers and prompts (`src/config/guidedChat.js`, `src/config/guidedForms.js`) — I wrote them; they need a native review for tone and wording.
- [ ] Review the persona rules in `src/services/llm.js` (`SYSTEM_PROMPT`) — tone, what it may and may not say.
- [ ] Review / complete the **knowledge base**, especially Arabic rows (Admin → Knowledge). Durri only knows what is in there.
- [ ] Confirm the safety line that tells customers to call **911** in danger.
- [ ] Confirm the response-time promises: **quote 24 h**, **complaint / lost item 48 h** (Admin → Settings).
- [ ] Decide what Durri should say **outside working hours** (not implemented yet).

### Company facts — nothing may ship with placeholder copy
Enter in Admin → Settings and/or the Knowledge page:
- [ ] Legal name + commercial registration number + tax number
- [ ] Official founding date
- [ ] Exact current fleet size (Settings still says “more than 1,300 … confirm before publishing”)
- [ ] Address, branches and map links
- [ ] Luggage / children / pets / prohibited-items policy
- [ ] Cancellation & refund policy
- [ ] Accepted payment methods
- [ ] Licences & certificates list
- [ ] Official SLA numbers
- [ ] Data privacy / retention policy (the quote form links to “the privacy policy” — it needs to exist)

---

## 2. Needs design / video work (no code can fix it alone)

- [ ] **Durrah icon on the buses in the hero videos.** Needs the flat brand mark as SVG/PNG and either a regenerated AI clip with the icon in the reference image, or a tracked overlay in a video editor (After Effects / ffmpeg with tracking) on the bus side panel, front third of the body, clear of the teal stripe / lotus. Re-export all affected clips, then swap them in (`munnawara-web/public/hero/backvid.mp4` and any secondary bus clips) and QA on desktop + mobile.
- [ ] After the new clips exist, **check the hero video for any baked-in mirrored Arabic** (the intro text bug was in the page, but the original report may also involve text inside the video).
- [ ] **Per-class fleet videos** (5 classes: VIP, standard, city, 45-seat, staff). When they exist, re-add a video slot + specs row to the fleet carousel — the teammate's new carousel replaced my earlier version (`src/components/fleet/FleetShowcase.tsx`, content in `src/content/fleetVideos.ts` was removed in the merge).

---

## 3. Engineering — can be done any time

### Chatbot (Durri)
- [ ] **Photo upload** for lost items / complaints (needs file storage: S3/Cloudinary or similar). Today customers are told to send photos on WhatsApp.
- [ ] Admin Inbox: label Durri's messages as “Durri” and show who said what more clearly.
- [ ] Edit the **guided answers from the admin** instead of in code (move `GUIDED_NODES` texts to the database).
- [ ] **Unanswered-questions log** in the admin so staff can turn misses into new knowledge-base rows.
- [ ] Warn in the Knowledge page when an entry has no Arabic (or English) twin.
- [ ] Working-hours awareness (“the team is offline, expect a reply at …”) and queue messaging for human handover.
- [ ] Per-customer rate limiting / abuse protection (today it is per IP only).
- [ ] Remove or use the unused `botClosingEn/Ar` settings.
- [ ] Hand over to WhatsApp as an option when no agent is online.
- [ ] Basic analytics: topics asked, handover rate, miss rate, satisfaction.

### Quote flow
- [ ] Let customers **edit a request after sending** (needs an update endpoint; today the editable summary is before sending).
- [ ] Show the structured trip (route, stops, ziyarat) properly in the admin Quotes page, ideally with the map.
- [ ] Confirmation by WhatsApp / SMS / email to the customer after submit.
- [ ] Show the real SLA on the confirmation from `Settings.quoteSlaHours` for every case (done when the backend replies; verify with the real backend).

### Website
- [ ] Re-test the new quote page, ticket and chat on **real phones** (iOS Safari + Android Chrome), in Arabic RTL and dark mode.
- [ ] Hijri date option in the date picker (only if Abdullah wants it).
- [ ] Tune the route-map labels for the smallest phones (360×640) — they crowd together.
- [ ] Review the Arabic intro once more on real devices after the `درة المنورة للنقل` fix.

### Housekeeping
- [ ] Line endings: the repos warn “LF will be replaced by CRLF” (Windows `autocrlf`). Add a `.gitattributes` per repo so diffs stay clean.
- [ ] `munnawara-web`: avoid committing `package-lock.json` churn from unrelated installs.

---

## 4. Before / at launch

- [ ] **Map services:** road routing uses the free public OSRM demo and tiles come from openstreetmap.org. Switch to a paid or self-hosted provider (Mapbox, MapTiler, own OSRM) — one URL each in `munnawara-web/src/components/forms/QuoteMap.tsx`.
- [ ] Confirm the latest backend deploy succeeded on the droplet and `GEMINI_API_KEY` is set there; check one live Arabic and one English chat.
- [ ] Website env on Vercel: `CHAT_API_URL`, `NEXT_PUBLIC_CHAT_API_URL`; backend `CORS_ORIGIN` includes the production domain.
- [ ] **Change the default admin password** (`seed:admin` creates `admin@damic.local` / `changeme123`).
- [ ] VAPID keys configured so push notifications reach staff phones.
- [ ] Update the **stored greeting** in Admin → Settings if you want custom wording (the old stock text is already ignored automatically).
- [ ] Watch the first days of real chats; use the Knowledge page to close gaps fast.

---

## Recently finished (for context)

- Quote wizard: step-by-step flow, real map with road routing, ziyarat sites with verified coordinates, custom date/time/dropdown pickers, fit-to-screen split layout, home “tear the ticket” entry, dedicated `/quote` page.
- Durri: bilingual chat, conversation memory, FAQ retrieval, resume after refresh, guided complaint & lost-item forms with reports, human handover rules. See [`docs/AI-CHATBOT.md`](docs/AI-CHATBOT.md).
- Admin: Reports page, Durri naming, live toasts for new reports.
- Pre-chat form: name + phone only. Arabic intro brand line fixed. Navbar made less translucent.
