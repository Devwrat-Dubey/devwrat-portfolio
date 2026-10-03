export type ChannelName = "email" | "in_app";

/** A window during which a user should not be nudged, in UTC hours (0-23). May wrap past midnight. */
export interface QuietHours {
  startHour: number;
  endHour: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  quietHours?: QuietHours;
  /** Channels the user has turned off. */
  optedOutOf?: ChannelName[];
}

/** Something a user did, e.g. "signed_up" or "task_created". Events drive both scheduling and cancellation. */
export interface UserEvent {
  userId: string;
  type: string;
  at: Date;
  data?: Record<string, unknown>;
}

export interface RenderedNudge {
  subject: string;
  body: string;
}

export interface NudgeRule {
  id: string;
  /** Event type that schedules this nudge. */
  triggerEvent: string;
  /** When the nudge should go out, relative to the trigger event. */
  schedule: (event: UserEvent) => Date;
  /** Event types that make the nudge unnecessary (the user already did the thing). */
  cancelOn: string[];
  /**
   * Optional key that ties a cancel event to a specific trigger, e.g. a task id,
   * so completing one task does not cancel the reminder for another.
   */
  matchKey?: (event: UserEvent) => string | undefined;
  channels: ChannelName[];
  /** Minimum gap between two sends of this rule to the same user. */
  cooldownMs?: number;
  render: (user: User, event: UserEvent) => RenderedNudge;
}

export interface NudgeMessage extends RenderedNudge {
  nudgeId: string;
  ruleId: string;
  userId: string;
  channel: ChannelName;
  sentAt: Date;
}

/** A delivery channel. Real providers (SES, SendGrid, push) can be added by implementing this. */
export interface Channel {
  readonly name: ChannelName;
  send(message: NudgeMessage, user: User): Promise<void>;
}

export type NudgeStatus = "pending" | "sent" | "cancelled" | "suppressed" | "failed";

export interface ScheduledNudge {
  id: string;
  ruleId: string;
  userId: string;
  key?: string;
  trigger: UserEvent;
  dueAt: Date;
  status: NudgeStatus;
  /** Why a nudge was cancelled, suppressed, deferred or failed. */
  reason?: string;
  sentAt?: Date;
  deliveredVia?: ChannelName[];
}
