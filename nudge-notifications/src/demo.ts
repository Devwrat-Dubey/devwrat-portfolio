/**
 * Runs a few simulated days of a task-management app through the nudge engine
 * and prints what gets sent, cancelled, deferred and suppressed.
 *
 *   npm run demo
 */
import { ConsoleEmailSender } from "./channels/email.ts";
import { InAppInbox } from "./channels/inApp.ts";
import { NudgeEngine } from "./engine.ts";
import { defaultRules } from "./rules.ts";
import type { User, UserEvent } from "./types.ts";

const users: User[] = [
  { id: "asha", name: "Asha", email: "asha@example.com", quietHours: { startHour: 22, endHour: 7 } },
  { id: "ben", name: "Ben", email: "ben@example.com", optedOutOf: ["email"] },
];

const at = (iso: string) => new Date(`${iso}Z`);
const events: UserEvent[] = [
  { userId: "asha", type: "signed_up", at: at("2026-10-05T08:00") },
  { userId: "ben", type: "signed_up", at: at("2026-10-05T08:00") },
  { userId: "ben", type: "onboarding_completed", at: at("2026-10-05T09:00") },
  {
    userId: "asha",
    type: "task_created",
    at: at("2026-10-05T10:30"),
    data: { taskId: "t1", title: "Send invoice", dueAt: "2026-10-06T12:00:00Z" },
  },
  {
    userId: "asha",
    type: "task_created",
    at: at("2026-10-05T10:45"),
    data: { taskId: "t2", title: "Draft Q4 plan", dueAt: "2026-10-07T09:00:00Z" },
  },
  { userId: "asha", type: "task_completed", at: at("2026-10-05T11:30"), data: { taskId: "t1" } },
  { userId: "ben", type: "session_ended", at: at("2026-10-05T17:00") },
  { userId: "asha", type: "session_ended", at: at("2026-10-05T23:30") },
];

const fmt = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");

const email = new ConsoleEmailSender();
const inbox = new InAppInbox();
const engine = new NudgeEngine({ rules: defaultRules, channels: [email, inbox], users });

const start = at("2026-10-05T08:00");
const end = at("2026-10-10T00:00");
let next = 0;

console.log("Nudge notifications demo (simulated clock, UTC)\n");
for (let now = start; now <= end; now = new Date(now.getTime() + 15 * 60 * 1000)) {
  while (next < events.length && events[next].at <= now) {
    const event = events[next++];
    const before = new Set(engine.pending(event.userId).map((n) => n.id));
    const scheduled = engine.handleEvent(event);
    console.log(`${fmt(event.at)}  ${event.userId} -> ${event.type}`);
    for (const n of engine.history(event.userId)) {
      if (before.has(n.id) && n.status === "cancelled") console.log(`  cancelled ${n.ruleId} (${n.reason})`);
    }
    for (const n of scheduled) console.log(`  scheduled ${n.ruleId} for ${fmt(n.dueAt)}`);
  }

  if (!engine.pending().some((n) => n.dueAt <= now)) continue;
  console.log(`${fmt(now)}  delivering due nudges`);
  const report = await engine.runDue(now);
  for (const n of report.deferred) console.log(`  deferred ${n.ruleId} for ${n.userId} to ${fmt(n.dueAt)} (${n.reason})`);
  for (const n of report.suppressed) console.log(`  suppressed ${n.ruleId} for ${n.userId} (${n.reason})`);
  for (const n of report.failed) console.log(`  failed ${n.ruleId} for ${n.userId} (${n.reason})`);
}

console.log("\nSummary");
const counts = new Map<string, number>();
for (const n of engine.history()) counts.set(n.status, (counts.get(n.status) ?? 0) + 1);
console.log(`  nudges: ${[...counts].map(([status, count]) => `${count} ${status}`).join(", ")}`);
console.log(`  emails in outbox: ${email.outbox.length}`);
for (const user of users) console.log(`  ${user.name}'s in-app inbox: ${inbox.unreadCount(user.id)} unread`);
