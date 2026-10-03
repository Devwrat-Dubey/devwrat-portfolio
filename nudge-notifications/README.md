# Nudge Notifications

> Status: in progress. Version 0.1 is a working TypeScript engine with a runnable demo and tests.

## Overview

Nudge notifications are short, timely reminders that prompt a user to take an action they intended to take, or would benefit from taking, such as finishing a task, returning to an unfinished flow, or acting before a deadline.

## Goals

- Send the right reminder to the right user at the right time.
- Keep nudges relevant and low-noise so users don't tune them out.
- Make it easy to create, schedule and manage nudges.

## What it does

The engine listens to user events (for example `signed_up` or `task_created`) and turns them into scheduled nudges using a set of rules. When a nudge comes due it is delivered over email and an in-app inbox, unless something says it shouldn't be.

- **Rules-based scheduling.** Each rule names a trigger event, when to send relative to it, and which channels to use.
- **Automatic cancellation.** If the user does the thing before the nudge goes out (`onboarding_completed`, `task_completed`), the nudge is cancelled. A match key ties a cancel to the right item, so finishing one task doesn't cancel the reminder for another.
- **Low-noise by default.** Quiet hours defer nudges to the morning, a per-user daily cap stops floods, per-rule cooldowns stop repeats, and a repeated trigger reschedules the existing nudge rather than queueing a duplicate.
- **User preferences.** Users can opt out of individual channels; a nudge with no channel left is suppressed.
- **Pluggable channels.** Email and in-app senders sit behind one `Channel` interface. Email is a mock that records to an outbox, so nothing needs credentials; a real provider can be added by implementing `send`.
- **Fault tolerant delivery.** If one channel fails, the others still deliver and the failure is recorded on the nudge.

## How it works

```
user event ──► NudgeEngine.handleEvent ──► cancels satisfied nudges
                                       └─► schedules nudges from matching rules
clock tick ──► NudgeEngine.runDue(now) ──► quiet hours ─► cooldown ─► daily cap ─► opt-outs
                                                                             └─► Channel.send (email, in-app)
```

The engine never reads the system clock; time is passed in. That keeps it deterministic in tests and lets the demo replay several days in under a second. In production `runDue` would be called by a cron job or a queue worker.

| File | Purpose |
| --- | --- |
| `src/engine.ts` | `NudgeEngine`: scheduling, cancellation and delivery |
| `src/rules.ts` | Example rules for a task-management app |
| `src/quietHours.ts` | Quiet-hours check and next-allowed-time calculation |
| `src/channels/` | Mock email sender and in-app inbox |
| `src/types.ts` | Shared types, including the `Channel` and `NudgeRule` interfaces |
| `src/demo.ts` | Simulated multi-day run |
| `test/` | Unit tests (Node's built-in test runner) |

## Run it

Requires Node.js 20 or later.

```bash
cd nudge-notifications
npm install
npm run demo       # replay a few simulated days and print every nudge decision
npm test           # run the unit tests
npm run typecheck  # strict TypeScript check
```

Sample demo output:

```
2026-10-05 09:00  ben -> onboarding_completed
  cancelled finish-onboarding (user did "onboarding_completed")
2026-10-05 10:00  delivering due nudges
  [email]  to=asha@example.com subject="You're one step away from your first project"
  [in-app] user=asha "You're one step away from your first project"
...
2026-10-08 23:30  delivering due nudges
  deferred come-back for asha to 2026-10-09 07:00 (deferred for quiet hours)
2026-10-09 07:00  delivering due nudges
  [email]  to=asha@example.com subject="Your tasks miss you"
```

## Adding a rule

```ts
import { after, HOUR_MS, type NudgeRule } from "./src/index.ts";

const cartReminder: NudgeRule = {
  id: "abandoned-cart",
  triggerEvent: "cart_updated",
  schedule: after(4 * HOUR_MS),
  cancelOn: ["checkout_completed"],
  channels: ["email", "in_app"],
  render: (user) => ({ subject: "Still thinking it over?", body: `Hi ${user.name}, your cart is saved.` }),
};
```

## Next steps

- Persist scheduled nudges in a database instead of memory.
- Add a real email provider and a push channel behind the same interface.
- Store quiet hours in the user's own time zone.
- Track opens and clicks to measure which nudges actually help.

## Back to portfolio

[← All projects](../README.md)
