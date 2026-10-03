import type { Channel, NudgeMessage, User } from "../types.ts";

export interface OutboxEntry {
  to: string;
  subject: string;
  body: string;
  sentAt: Date;
}

/**
 * Mock email sender. It records each email in an outbox and optionally logs it,
 * so the demo and tests run without SMTP or provider credentials.
 */
export class ConsoleEmailSender implements Channel {
  readonly name = "email" as const;
  readonly outbox: OutboxEntry[] = [];

  constructor(private readonly log: ((line: string) => void) | null = console.log) {}

  async send(message: NudgeMessage, user: User): Promise<void> {
    const entry = { to: user.email, subject: message.subject, body: message.body, sentAt: message.sentAt };
    this.outbox.push(entry);
    this.log?.(`  [email]  to=${entry.to} subject="${entry.subject}"`);
  }
}
