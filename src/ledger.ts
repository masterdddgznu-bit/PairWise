import type { Ticket } from "./types.js";

export class TicketLedger {
  private readonly tickets = new Map<string, Ticket>();

  get(ticketId: string): Ticket | undefined {
    return this.tickets.get(ticketId);
  }

  has(ticketId: string): boolean {
    return this.tickets.has(ticketId);
  }

  put(ticket: Ticket): Ticket | undefined {
    this.tickets.set(ticket.ticketId, ticket);
    return undefined;
  }

  updateRemaining(ticketId: string, remaining: number): void {
    const t = this.tickets.get(ticketId);
    if (!t) return;
    if (remaining <= 0) this.tickets.delete(ticketId);
    else t.remaining = remaining;
  }

  delete(ticketId: string): Ticket | undefined {
    const t = this.tickets.get(ticketId);
    if (!t) return undefined;
    this.tickets.delete(ticketId);
    return t;
  }

  expiredIds(now: number): string[] {
    const ids: string[] = [];
    for (const t of this.tickets.values()) {
      if (now > t.expireAt) ids.push(t.ticketId);
    }
    return ids.sort();
  }

  all(): Ticket[] {
    return [...this.tickets.values()];
  }
}
