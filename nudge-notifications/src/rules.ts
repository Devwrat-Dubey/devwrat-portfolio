import type { NudgeRule, UserEvent } from "./types.ts";

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export const after = (ms: number) => (event: UserEvent) => new Date(event.at.getTime() + ms);

/** Example rules for a task-management app. */
export const defaultRules: NudgeRule[] = [
  {
    id: "finish-onboarding",
    triggerEvent: "signed_up",
    schedule: after(2 * HOUR_MS),
    cancelOn: ["onboarding_completed"],
    channels: ["email", "in_app"],
    render: (user) => ({
      subject: "You're one step away from your first project",
      body: `Hi ${user.name}, finish setting up your workspace to start tracking tasks.`,
    }),
  },
  {
    id: "task-due-soon",
    triggerEvent: "task_created",
    // Remind 24 hours before the deadline (or right away if the deadline is closer than that).
    schedule: (event) => {
      const due = new Date(String(event.data?.dueAt));
      return new Date(Math.max(event.at.getTime(), due.getTime() - DAY_MS));
    },
    cancelOn: ["task_completed"],
    matchKey: (event) => event.data?.taskId as string | undefined,
    channels: ["in_app"],
    render: (user, event) => ({
      subject: `Reminder: ${event.data?.title} is due soon`,
      body: `Hi ${user.name}, your task "${event.data?.title}" is due soon. Want to wrap it up?`,
    }),
  },
  {
    id: "come-back",
    triggerEvent: "session_ended",
    schedule: after(3 * DAY_MS),
    cancelOn: ["session_started"],
    channels: ["email"],
    cooldownMs: 7 * DAY_MS,
    render: (user) => ({
      subject: "Your tasks miss you",
      body: `Hi ${user.name}, it's been a few days. Here's what's still open on your list.`,
    }),
  },
];
