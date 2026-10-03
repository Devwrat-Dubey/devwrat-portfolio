import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConsoleEmailSender } from "../src/channels/email.ts";
import { InAppInbox } from "../src/channels/inApp.ts";
import { NudgeEngine } from "../src/engine.ts";
import { after, DAY_MS, HOUR_MS } from "../src/rules.ts";
import type { Channel, NudgeRule, User } from "../src/types.ts";

const T0 = new Date("2026-10-05T08:00:00Z");
const at = (offsetMs: number) => new Date(T0.getTime() + offsetMs);

const onboardingRule: NudgeRule = {
  id: "finish-onboarding",
  triggerEvent: "signed_up",
  schedule: after(2 * HOUR_MS),
  cancelOn: ["onboarding_completed"],
  channels: ["email", "in_app"],
  render: (user) => ({ subject: "Finish setup", body: `Hi ${user.name}` }),
};

const taskRule: NudgeRule = {
  id: "task-due-soon",
  triggerEvent: "task_created",
  schedule: after(HOUR_MS),
  cancelOn: ["task_completed"],
  matchKey: (event) => event.data?.taskId as string | undefined,
  channels: ["in_app"],
  render: (_user, event) => ({ subject: `Task ${event.data?.taskId}`, body: "" }),
};

function setup(options: { rules?: NudgeRule[]; users?: User[]; maxPerDay?: number; channels?: Channel[] } = {}) {
  const email = new ConsoleEmailSender(null);
  const inbox = new InAppInbox(null);
  const engine = new NudgeEngine({
    rules: options.rules ?? [onboardingRule, taskRule],
    channels: options.channels ?? [email, inbox],
    users: options.users ?? [{ id: "u1", name: "Asha", email: "asha@example.com" }],
    maxPerDay: options.maxPerDay,
  });
  return { engine, email, inbox };
}

describe("NudgeEngine", () => {
  it("schedules a nudge from its trigger event and sends it on every channel when due", async () => {
    const { engine, email, inbox } = setup();
    const [nudge] = engine.handleEvent({ userId: "u1", type: "signed_up", at: T0 });
    assert.deepEqual(nudge.dueAt, at(2 * HOUR_MS));

    assert.equal((await engine.runDue(at(HOUR_MS))).sent.length, 0, "not due yet");
    const report = await engine.runDue(at(2 * HOUR_MS));

    assert.equal(report.sent.length, 1);
    assert.deepEqual(report.sent[0].deliveredVia, ["email", "in_app"]);
    assert.equal(email.outbox[0].to, "asha@example.com");
    assert.equal(inbox.unreadCount("u1"), 1);
  });

  it("cancels a pending nudge when the user completes the action", async () => {
    const { engine, email } = setup();
    engine.handleEvent({ userId: "u1", type: "signed_up", at: T0 });
    engine.handleEvent({ userId: "u1", type: "onboarding_completed", at: at(HOUR_MS) });

    const report = await engine.runDue(at(3 * HOUR_MS));
    assert.equal(report.sent.length, 0);
    assert.equal(engine.history("u1")[0].status, "cancelled");
    assert.equal(email.outbox.length, 0);
  });

  it("only cancels the nudge whose match key matches", async () => {
    const { engine } = setup();
    engine.handleEvent({ userId: "u1", type: "task_created", at: T0, data: { taskId: "a" } });
    engine.handleEvent({ userId: "u1", type: "task_created", at: T0, data: { taskId: "b" } });
    engine.handleEvent({ userId: "u1", type: "task_completed", at: at(1000), data: { taskId: "a" } });

    const report = await engine.runDue(at(HOUR_MS));
    assert.deepEqual(
      report.sent.map((n) => n.key),
      ["b"],
    );
  });

  it("reschedules instead of duplicating when the trigger fires again", () => {
    const { engine } = setup();
    engine.handleEvent({ userId: "u1", type: "signed_up", at: T0 });
    engine.handleEvent({ userId: "u1", type: "signed_up", at: at(HOUR_MS) });

    const pending = engine.pending("u1");
    assert.equal(pending.length, 1);
    assert.deepEqual(pending[0].dueAt, at(3 * HOUR_MS));
  });

  it("defers nudges that fall in the user's quiet hours", async () => {
    const { engine, email } = setup({
      users: [{ id: "u1", name: "Asha", email: "a@example.com", quietHours: { startHour: 22, endHour: 7 } }],
    });
    const lateNight = new Date("2026-10-05T21:00:00Z");
    engine.handleEvent({ userId: "u1", type: "signed_up", at: lateNight });

    const report = await engine.runDue(new Date("2026-10-05T23:00:00Z"));
    assert.equal(report.deferred.length, 1);
    assert.deepEqual(report.deferred[0].dueAt, new Date("2026-10-06T07:00:00Z"));
    assert.equal(email.outbox.length, 0);

    const morning = await engine.runDue(new Date("2026-10-06T07:00:00Z"));
    assert.equal(morning.sent.length, 1);
  });

  it("skips channels the user opted out of and suppresses when none are left", async () => {
    const { engine, email, inbox } = setup({
      users: [{ id: "u1", name: "Ben", email: "b@example.com", optedOutOf: ["email"] }],
    });
    engine.handleEvent({ userId: "u1", type: "signed_up", at: T0 });
    const report = await engine.runDue(at(2 * HOUR_MS));
    assert.deepEqual(report.sent[0].deliveredVia, ["in_app"]);
    assert.equal(email.outbox.length, 0);
    assert.equal(inbox.unreadCount("u1"), 1);

    const { engine: engine2 } = setup({
      users: [{ id: "u1", name: "Ben", email: "b@example.com", optedOutOf: ["in_app"] }],
    });
    engine2.handleEvent({ userId: "u1", type: "task_created", at: T0, data: { taskId: "a" } });
    const report2 = await engine2.runDue(at(HOUR_MS));
    assert.equal(report2.suppressed.length, 1);
  });

  it("enforces a per-user daily cap", async () => {
    const { engine } = setup({ maxPerDay: 2 });
    for (const taskId of ["a", "b", "c"]) {
      engine.handleEvent({ userId: "u1", type: "task_created", at: T0, data: { taskId } });
    }
    const report = await engine.runDue(at(HOUR_MS));
    assert.equal(report.sent.length, 2);
    assert.equal(report.suppressed.length, 1);
    assert.match(report.suppressed[0].reason ?? "", /daily cap/);

    engine.handleEvent({ userId: "u1", type: "task_created", at: at(DAY_MS), data: { taskId: "d" } });
    assert.equal((await engine.runDue(at(DAY_MS + HOUR_MS))).sent.length, 1, "cap resets after 24 hours");
  });

  it("respects a rule's cooldown", async () => {
    const rule: NudgeRule = { ...onboardingRule, channels: ["in_app"], cooldownMs: DAY_MS };
    const { engine } = setup({ rules: [rule] });
    engine.handleEvent({ userId: "u1", type: "signed_up", at: T0 });
    await engine.runDue(at(2 * HOUR_MS));

    engine.handleEvent({ userId: "u1", type: "signed_up", at: at(3 * HOUR_MS) });
    const report = await engine.runDue(at(5 * HOUR_MS));
    assert.equal(report.suppressed[0].reason, "rule cooldown");
  });

  it("still delivers on healthy channels when one channel fails", async () => {
    const broken: Channel = {
      name: "email",
      send: async () => {
        throw new Error("SMTP down");
      },
    };
    const inbox = new InAppInbox(null);
    const { engine } = setup({ channels: [broken, inbox] });
    engine.handleEvent({ userId: "u1", type: "signed_up", at: T0 });

    const report = await engine.runDue(at(2 * HOUR_MS));
    assert.deepEqual(report.sent[0].deliveredVia, ["in_app"]);
    assert.match(report.sent[0].reason ?? "", /SMTP down/);
  });
});
