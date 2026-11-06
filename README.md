# SweepAlert 🧹🚗

A cross-platform mobile app that reminds you to move your car before street
cleaning. Built with **React Native + Expo + TypeScript**. Ships with a seeded
**Boston** demo so it runs end-to-end with **zero external setup**.

> Imported from the SweepAlert Claude Design (`SweepAlert.dc.html`) — the light/
> dark tokens, Plus Jakarta Sans / IBM Plex Mono typography, and all seven
> screens are reproduced faithfully in native components.

---

## Quick start

```bash
# from the repo root (it is the Expo app)
npm install

# start the Metro bundler
npm start
# then press  i  (iOS simulator)   or   a  (Android emulator)
# or scan the QR code with Expo Go on a physical device
```

Run the scheduling-engine unit tests and the type checker:

```bash
npm test          # jest — scheduling engine, providers, store, persistence
npm run typecheck # tsc --noEmit
npm run lint      # eslint (eslint-config-expo flat config, eslint.config.js)
```

CI (`.github/workflows/ci.yml`) runs `npm ci`, then lint, typecheck and tests on
every push and pull request.

### What works where

| Capability | Expo Go (simulator/phone) | Dev build on device |
|---|---|---|
| Cars, reminders, schedules, notifications | ✅ | ✅ |
| Map + draggable pin (`react-native-maps`) | ✅ | ✅ |
| GPS capture + reverse-geocode (`expo-location`) | ✅ | ✅ |
| Local notifications (`expo-notifications`) | ✅ (device) | ✅ |
| **NFC tag tap** (`react-native-nfc-manager`) | ❌ feature-detected → GPS fallback | ✅ (NFC phone) |

NFC is a native module absent from Expo Go and simulators. The app
**feature-detects** it (`src/services/nfc.ts` → `isSupported()`) and degrades to
GPS with a clear message, so nothing breaks. To exercise NFC for real:

```bash
npx expo run:ios      # or: npx expo run:android  (physical NFC device)
```

---

## Architecture

```
sweepalert/                     # repo root = the Expo app
├── App.tsx                     # providers + navigation container + lifecycle
├── index.ts                    # Expo entry
├── app.json                    # permissions, plugins, endpoint config (extra)
├── eslint.config.js            # eslint-config-expo (flat)
├── .github/workflows/ci.yml    # lint + typecheck + tests
├── plugins/
│   └── withFreeTeamSigning.js  # strips entitlements a free Apple team can't sign
├── __tests__/
│   ├── scheduling.test.ts        # engine unit tests (DST, season, fire times)
│   ├── upcoming.test.ts          # next-N cleanings + notification planner
│   ├── bostonMapping.test.ts     # live CKAN row -> schedule translation
│   ├── samSegments.test.ts       # SAM geometry / side-of-street math
│   ├── recollect.test.ts         # ReCollect (Cambridge) mapping
│   ├── coverage.test.ts          # Boston boundary gate
│   ├── snapshotFallback.test.ts  # offline snapshot distance gate
│   ├── providerContract.test.ts  # null vs LookupFailedError contract
│   ├── store.test.ts             # real Zustand store: init, seeding, refresh
│   ├── persistence.test.ts       # persisted shape + migrations
│   ├── serial.test.ts            # per-key serialization
│   ├── http.test.ts              # fetch timeout wrapper
│   └── log.test.ts               # production log redaction
└── src/
    ├── types.ts                # Car / ParkingSpot / CleaningSchedule / Reminder
    ├── theme/
    │   ├── tokens.ts           # design tokens (light/dark) from the design
    │   └── ThemeContext.tsx
    ├── hooks/
    │   └── useNow.ts           # ticking clock for live countdowns
    ├── data/                   # ── schedule providers ──
    │   ├── boston-snapshot.json  # bundled offline Boston blocks
    │   ├── snapshot.ts           # nearest-block (distance-gated) + builders
    │   ├── coverage.ts           # isWithinBoston boundary check
    │   └── providers/
    │       ├── types.ts            # StreetCleaningProvider + LookupFailedError
    │       ├── index.ts            # registry + Greater Boston city router
    │       ├── BostonProvider.ts   # SAM + Analyze Boston lookup, offline fallback
    │       ├── bostonApi.ts        # CKAN datastore client + config
    │       ├── bostonMapping.ts    # pure row -> CleaningSchedule (unit-tested)
    │       ├── bostonNeighborhoods.ts # BPDA neighborhood point-in-polygon
    │       ├── samSegments.ts      # SAM street-segments ArcGIS client
    │       ├── samGeometry.ts      # pure SAM geometry + parsing
    │       ├── recollect.ts        # ReCollect provider (Cambridge)
    │       ├── recollectMapping.ts # pure ReCollect events -> schedule
    │       └── MockProvider.ts     # pure offline demo data
    ├── services/              # ── engine + device ──
    │   ├── scheduling.ts         # next cleaning / fire times / notification plan
    │   ├── presets.ts            # reminder presets
    │   ├── format.ts             # countdown / status / upcoming view-models
    │   ├── location.ts           # expo-location + reverse-geocode
    │   ├── nfc.ts                # feature-detected NFC
    │   ├── notifications.ts      # expo-notifications schedule/cancel/sync
    │   ├── http.ts               # fetch with a hard timeout
    │   ├── log.ts                # logger that keeps addresses out of prod logs
    │   ├── serial.ts             # per-key task serialization
    │   └── seed.ts               # seeded demo cars
    ├── state/
    │   ├── store.ts              # Zustand + AsyncStorage; refresh + reschedule glue
    │   ├── persistence.ts        # persisted shape, version + migrations
    │   └── lifecycle.ts          # AppState foreground -> onAppActive
    ├── components/             # Screen, Button, primitives (Card, Toggle, Pill, …)
    ├── navigation/            # bottom tabs + Cars stack, custom pill tab bar
    └── screens/               # MyCars, Park, CarDetail, ReminderEditor,
        │                      # ManageCars, Alerts, Lookup, Settings
        └── park/              # Park screen pieces: map, capture controls,
                               # detected block, street picker, car picker, save
```

### The scheduling engine (`src/services/scheduling.ts`)

Pure, dependency-light (luxon only), and fully unit-tested. All wall-clock math
runs in the schedule's IANA timezone so it is DST-correct.

```ts
getNextCleaning(schedule, from): Date | null   // next sweep after `from`
computeFireTimes(schedule, cleaning, reminders, now): FireTime[]  // notif times
getUpcomingCleanings(schedule, from, count): Date[]  // next N sweeps
planCarNotifications(car, now): PlannedNotification[]  // what to schedule
```

- **Recurrence** — a `CleaningRule` is `{ weekday, weeksOfMonth }`. Empty
  `weeksOfMonth` = "every Thursday"; `[1, 3]` = "1st & 3rd Monday".
- **Season** — inclusive on/off window; Boston is Apr 1 – Nov 30. Off-season
  days are skipped and the engine rolls forward to next April.
- **DST** — a sweep at "08:00 local" stays 08:00 across the spring-forward and
  fall-back boundaries; "night before at 8pm" reminders likewise (see tests).
- **Roll-forward** — each car's reminders are pre-scheduled for the next 3
  cleanings (`planCarNotifications`, capped at 16 per car — and fewer with 5+
  cars, `perCarCap` — so the total stays under iOS's 64-pending limit; past 64
  cars only each car's soonest alert is kept), so alerts keep firing even if the
  app isn't reopened; the
  window rolls forward on every launch and whenever a car is moved
  (`store.refreshCar` → `notifications.syncCarNotifications`).
- **16-car limit** — `MAX_CARS = 16` (`scheduling.ts`) so every car keeps at
  least 4 of the 64 pending alerts (`perCarCap`). `addCar` refuses past it and
  Manage Cars swaps the add form for a "reached the 16-car limit" note.
- **Staying fresh while open** — on every background → active transition
  (`state/lifecycle.ts` → `store.onAppActive`) the app runs a cheap non-forced
  `refreshAll` from cached schedules (or retries a failed storage load), and a
  wake timer (`armWakeTimer`, capped at 6 h and re-armed after each refresh)
  refreshes when the soonest sweep passes, so countdowns and the planned
  notifications roll forward without a relaunch.

Run `npm test` to see the DST / season / fire-time cases.

---

## Pluggable schedule providers

Every city implements one interface (`src/data/providers/types.ts`):

```ts
interface StreetCleaningProvider {
  getScheduleForLocation(lat: number, lng: number): Promise<CleaningSchedule | null>;
  getNextCleaning(schedule: CleaningSchedule, from: Date): Date | null;
}
```

- **`BostonProvider`** (reference) is wired to the **live public dataset** on
  [Analyze Boston](https://data.boston.gov/dataset/street-sweeping-schedules)
  (`data.boston.gov`), served via CKAN's datastore API — **no API key**. When
  the network is unreachable it **falls back to the bundled snapshot** only for a
  point within ~100 m of a snapshot block (the demo cars); otherwise it returns
  no schedule and the car keeps its last cached schedule rather than showing
  made-up data.
- **`ReCollectProvider`** covers cities whose schedule lives in **ReCollect**
  (recollect.net) rather than open data — currently **Cambridge**. Cambridge
  sweeps monthly (Apr–Dec), odd/even sides on different days, and ReCollect
  publishes a concrete, holiday-adjusted calendar per address. Flow:
  reverse-geocode → ReCollect `address-suggest` (place_id) → `events` (dated,
  per side); the parked parcel's house-number parity selects the side. These
  concrete dates are stored as `explicitDates` on the schedule, which the engine
  uses directly (`src/data/providers/recollect.ts`, mapping in
  `recollectMapping.ts`). ⚠️ ReCollect's API is unofficial — a failed call
  surfaces as a lookup failure (`LookupFailedError`), never as made-up data; an
  address ReCollect doesn't know is "no schedule". (Somerville uses ReCollect
  too; its service id is still TODO.)
- **`MockProvider`** serves the bundled snapshot only (tests + first-run demo).

**No schedule vs. lookup failed.** The provider contract
(`src/data/providers/types.ts`, tested in `__tests__/providerContract.test.ts`)
separates two outcomes:

- **`null`** is authoritative: the point is outside coverage, or the resolved
  street / address has no sweeping schedule. The store clears the car's schedule
  and the card shows **No schedule** (`OUTSIDE COVERAGE · NO SCHEDULE`); no
  alerts are planned.
- **A thrown `LookupFailedError`** means "couldn't tell" (offline, timeout,
  service error, geocoder down with no city to route to). The store logs it and
  **keeps the car's cached schedule** and its alerts; the next launch (which
  re-resolves every car) or re-park tries again. A freshly parked car has no
  cached schedule (`parkCar` clears it), so it shows no schedule until a lookup
  succeeds — and because it has nothing cached, each foreground refresh
  retries it.

**Multi-city router.** `getProvider()` returns a `GreaterBostonProvider` that
reverse-geocodes the point to a city and delegates: `Cambridge → ReCollect`,
everything else → Boston (which self-gates to its real boundary and returns
`null` outside). Add a city by implementing the interface and adding one route.

### How the live Boston lookup works

The sweeping dataset is **tabular, keyed by street name** (columns `st_name`,
`side`, `from`/`to`, `start_time`/`end_time`, day flags `monday…sunday`, week
flags `week_1…week_5`, `year_round`) — it has **no lat/lng geometry**. A plain
reverse-geocode of the pin can therefore snap to a *parallel* street and pick
the wrong block/side. So resolution is **geometry-first**
(`src/data/providers/BostonProvider.ts`):

1. **Snap to the road** — query Boston's live **SAM street-segments** ArcGIS
   layer (`samSegments.ts`) for the segment nearest the pin. Its geometry gives
   the *actual* nearest street, and its per-side address parity (`L_F_ADD` /
   `R_F_ADD`) + the point's side of the polyline gives the **even/odd side**.
   (Falls back to `expo-location` reverse-geocode if SAM is unreachable.)
2. **Pin the neighborhood** — point-in-polygon against Boston's **BPDA
   neighborhood boundaries** (`bostonNeighborhoods.ts`) resolves *which* Back Bay
   / Jamaica Plain / … you're in. (Boylston St, for instance, is swept daily
   12:01–7am in Back Bay but 8am–12pm in Jamaica Plain.)
3. **Look up the schedule** — `datastore_search?resource_id=…&q=<street>`, then
   `pickRow` narrows by **side**, then scores each block by **neighborhood +
   nearby cross streets** and takes the best. Neighborhood is weighted above a
   lone cross street so a same-neighborhood block always beats a name
   coincidence elsewhere. The pure geometry math is unit-tested in
   `samGeometry.ts` / `__tests__/samSegments.test.ts`; the scoring in
   `__tests__/bostonMapping.test.ts`.

If SAM ever names the wrong street (dense corners), the Park screen surfaces a
**"Wrong street?"** control listing nearby streets, and
`BostonProvider.getScheduleForStreet()` re-resolves the schedule for the one you
pick.

> **Block precision.** SAM fixes the street + side reliably. Pinning the exact
> *block* within a street is still best-effort (the sweeping dataset has no
> geometry to join on), but per-side rules rarely vary block-to-block, so the
> resolved cleaning times/days/season are correct in practice.

The raw row → `CleaningSchedule` translation is pure and unit-tested in
`src/data/providers/bostonMapping.ts` (see `__tests__/bostonMapping.test.ts`):
`week_2 & week_4` → `weeksOfMonth: [2,4]`, all-weeks → "every", `Even/Odd` →
`side`, `year_round` flips the season between year-round and Apr 1 – Nov 30.

**It already points at the real endpoint** (`app.json` → `expo.extra`):

```json
"extra": {
  "bostonCkanBase": "https://data.boston.gov/api/3/action",
  "bostonSweepingResourceId": "9fdbdcad-67c8-4b23-b6ec-861e77d56227"
}
```

Override those to target a mirror or an updated resource id — no code change.

> **Segment precision caveat.** Because the open dataset has no geometry, a
> street with several segments (different sides / cross-street ranges) can't be
> pinned to the exact block from GPS alone — the provider picks the best match by
> street + neighborhood. Boston also publishes a geometric
> [Street Segments (SAM)](https://data.boston.gov/dataset/boston-street-segments-sam-system)
> layer; joining sweeping rows to SAM segment geometry would make block-level
> disambiguation exact, and is the natural next step.

### Adding a new city

1. Create `src/data/providers/<City>Provider.ts` implementing
   `StreetCleaningProvider`. Reuse `getNextCleaning` from
   `src/services/scheduling.ts` — the engine is city-agnostic.
2. Register it in `src/data/providers/index.ts` and set `ACTIVE_PROVIDER_ID`.
3. (Optional) Ship a `<city>-snapshot.json` for an offline fallback, mirroring
   `boston-snapshot.json`.

---

## Reminders

Each car carries its own stack of reminders; toggle each one, switch it between
**Push** and **Critical alert**, or remove it. Adding a reminder offers **fixed
presets only** — the editor's chips are `ADDABLE_PRESETS` in
`src/services/presets.ts` (1 day before, 3 hours before, 1 hour before, 15 min
before, at sweep start). There is no custom offset or time picker yet; to offer
a new timing, add a preset there.

---

## Data model (persisted via AsyncStorage)

```ts
Car            { id, name, color, plate, location?, schedule?, nextCleaning?, reminders, createdAt }
ParkingSpot    { carId, lat, lng, address, blockId, savedAt }
CleaningSchedule { blockId, rules, windowStart, windowEnd, side, season, timezone, …labels }
Reminder       { id, carId, label, offsetMinutes, timeOfDayOverride?, channel, enabled, notificationId? }
```

Zustand persists only the durable domain data (plus a `seeded` flag so demo
cars are seeded only once); schedules, next-cleaning times, and OS notification
IDs are refreshed on launch by `store.init()`, keeping the cached schedule if the
lookup fails offline.

---

## Permissions & denied-state handling

- **Location** and **Notifications** are requested lazily with clear prompts;
  Settings shows live status and a one-tap "Enable". Denied states never crash —
  Park still works via the draggable pin, and scheduling silently no-ops until
  notifications are granted.
- iOS usage strings and Android permissions are declared in `app.json`.

---

## Demo tips

- **Settings → Start with no cars** toggles the first-run empty state.
- **Alerts → Preview a push notification** fires a real local notification
  (grant notifications first; use a physical device — simulators don't alert).
- Countdowns tick live; the seeded Subaru is parked on a block that sweeps very
  soon, so it shows the red **Move now / Move soon** states.

---

## Notes on versions

Pinned to **Expo SDK 54** (React Native 0.81, React 19.1). If your installed Expo differs,
align native deps with:

```bash
npx expo install --check
```
