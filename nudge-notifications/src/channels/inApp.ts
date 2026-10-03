import type { Channel, NudgeMessage, User } from "../types.ts";

export interface InboxItem {
  id: string;
  ruleId: string;
  subject: string;
  body: string;
  createdAt: Date;
  read: boolean;
}

/** In-memory in-app inbox: the bell-icon list a user sees inside the product. */
export class InAppInbox implements Channel {
  readonly name = "in_app" as const;
  private readonly items = new Map<string, InboxItem[]>();

  constructor(private readonly log: ((line: string) => void) | null = console.log) {}

  async send(message: NudgeMessage, user: User): Promise<void> {
    const list = this.items.get(user.id) ?? [];
    list.push({
      id: message.nudgeId,
      ruleId: message.ruleId,
      subject: message.subject,
      body: message.body,
      createdAt: message.sentAt,
      read: false,
    });
    this.items.set(user.id, list);
    this.log?.(`  [in-app] user=${user.id} "${message.subject}"`);
  }

  list(userId: string): InboxItem[] {
    return [...(this.items.get(userId) ?? [])];
  }

  unreadCount(userId: string): number {
    return this.list(userId).filter((item) => !item.read).length;
  }

  markRead(userId: string, itemId: string): boolean {
    const item = this.items.get(userId)?.find((i) => i.id === itemId);
    if (!item) return false;
    item.read = true;
    return true;
  }
}
