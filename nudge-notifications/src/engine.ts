import { nextAllowedTime } from "./quietHours.ts";
import { DAY_MS } from "./rules.ts";
import type { Channel, ChannelName, NudgeRule, ScheduledNudge, User, UserEvent } from "./types.ts";

export interface EngineOptions {
  rules: NudgeRule[];
  channels: Channel[];
  users: User[];
  /** Maximum nudges a user may receive in any rolling 24 hours, across all rules. */
  maxPerDay?: number;
}

export interface DeliveryReport {
  sent: ScheduledNudge[];
  suppressed: ScheduledNudge[];
  deferred: ScheduledNudge[];
  failed: ScheduledNudge[];
}

/**
 * Schedules nudges from user events and delivers them when they come due.
 *
 * Time is always passed in, never read from the system clock, so the engine
 * is deterministic in tests and can be driven by a simulated clock in the demo.
 * In production `runDue` would be called by a cron job or queue worker.
 */
export class NudgeEngine {
  private readonly rules: NudgeRule[];
  private readonly channels = new Map<ChannelName, Channel>();
  private readonly users = new Map<string, User>();
  private readonly nudges: ScheduledNudge[] = [];
  private readonly maxPerDay: number;
  private nextId = 1;

  constructor(options: EngineOptions) {
    this.rules = options.rules;
    for (const channel of options.channels) this.channels.set(channel.name, channel);
    for (const user of options.users) this.users.set(user.id, user);
    this.maxPerDay = options.maxPerDay ?? 3;
  }

  /** Record a user event: cancels nudges it satisfies and schedules nudges it triggers. */
  handleEvent(event: UserEvent): ScheduledNudge[] {
    for (const nudge of this.pending(event.userId)) {
      const rule = this.rule(nudge.ruleId);
      if (!rule.cancelOn.includes(event.type)) continue;
      if (rule.matchKey && rule.matchKey(event) !== nudge.key) continue;
      nudge.status = "cancelled";
      nudge.reason = `user did "${event.type}"`;
    }

    const scheduled: ScheduledNudge[] = [];
    for (const rule of this.rules.filter((r) => r.triggerEvent === event.type)) {
      const key = rule.matchKey?.(event);
      const dueAt = rule.schedule(event);
      const existing = this.pending(event.userId).find((n) => n.ruleId === rule.id && n.key === key);
      if (existing) {
        // The same trigger fired again before the nudge went out: push it back instead of sending twice.
        existing.trigger = event;
        existing.dueAt = dueAt;
        scheduled.push(existing);
        continue;
      }
      const nudge: ScheduledNudge = {
        id: `n${this.nextId++}`,
        ruleId: rule.id,
        userId: event.userId,
        key,
        trigger: event,
        dueAt,
        status: "pending",
      };
      this.nudges.push(nudge);
      scheduled.push(nudge);
    }
    return scheduled;
  }

  /** Deliver every pending nudge that is due at `now`, applying quiet hours, cooldowns and the daily cap. */
  async runDue(now: Date): Promise<DeliveryReport> {
    const report: DeliveryReport = { sent: [], suppressed: [], deferred: [], failed: [] };
    const due = this.nudges
      .filter((n) => n.status === "pending" && n.dueAt <= now)
      .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());

    for (const nudge of due) {
      const rule = this.rule(nudge.ruleId);
      const user = this.users.get(nudge.userId);
      if (!user) {
        this.suppress(nudge, "unknown user", report);
        continue;
      }

      const allowedAt = nextAllowedTime(now, user.quietHours);
      if (allowedAt > now) {
        nudge.dueAt = allowedAt;
        nudge.reason = "deferred for quiet hours";
        report.deferred.push(nudge);
        continue;
      }

      const lastSameRule = this.lastSent(user.id, rule.id);
      if (rule.cooldownMs && lastSameRule && now.getTime() - lastSameRule.getTime() < rule.cooldownMs) {
        this.suppress(nudge, "rule cooldown", report);
        continue;
      }

      if (this.sentInLastDay(user.id, now) >= this.maxPerDay) {
        this.suppress(nudge, `daily cap of ${this.maxPerDay} reached`, report);
        continue;
      }

      const channels = rule.channels
        .filter((name) => !user.optedOutOf?.includes(name))
        .map((name) => this.channels.get(name))
        .filter((c): c is Channel => c !== undefined);
      if (channels.length === 0) {
        this.suppress(nudge, "user opted out of every channel for this nudge", report);
        continue;
      }

      const content = rule.render(user, nudge.trigger);
      const delivered: ChannelName[] = [];
      const errors: string[] = [];
      for (const channel of channels) {
        try {
          await channel.send(
            { ...content, nudgeId: nudge.id, ruleId: rule.id, userId: user.id, channel: channel.name, sentAt: now },
            user,
          );
          delivered.push(channel.name);
        } catch (err) {
          errors.push(`${channel.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (delivered.length === 0) {
        nudge.status = "failed";
        nudge.reason = errors.join("; ");
        report.failed.push(nudge);
        continue;
      }
      nudge.status = "sent";
      nudge.sentAt = now;
      nudge.deliveredVia = delivered;
      nudge.reason = errors.length ? `partial failure: ${errors.join("; ")}` : undefined;
      report.sent.push(nudge);
    }
    return report;
  }

  /** All nudges the engine knows about, in creation order. */
  history(userId?: string): ScheduledNudge[] {
    return this.nudges.filter((n) => userId === undefined || n.userId === userId);
  }

  pending(userId?: string): ScheduledNudge[] {
    return this.history(userId).filter((n) => n.status === "pending");
  }

  private rule(id: string): NudgeRule {
    const rule = this.rules.find((r) => r.id === id);
    if (!rule) throw new Error(`Unknown rule ${id}`);
    return rule;
  }

  private suppress(nudge: ScheduledNudge, reason: string, report: DeliveryReport): void {
    nudge.status = "suppressed";
    nudge.reason = reason;
    report.suppressed.push(nudge);
  }

  private lastSent(userId: string, ruleId: string): Date | undefined {
    let last: Date | undefined;
    for (const n of this.nudges) {
      if (n.userId === userId && n.ruleId === ruleId && n.sentAt && (!last || n.sentAt > last)) last = n.sentAt;
    }
    return last;
  }

  private sentInLastDay(userId: string, now: Date): number {
    return this.nudges.filter(
      (n) => n.userId === userId && n.sentAt !== undefined && now.getTime() - n.sentAt.getTime() < DAY_MS,
    ).length;
  }
}
