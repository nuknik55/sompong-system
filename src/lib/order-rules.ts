/**
 * Supply orders: who may do what, as the screen shows it (README item 35,
 * Nik's decisions of 2026-09-23). The ENFORCEMENT is the database: every
 * order write goes through a function in supply_order_approval_migration.sql
 * that checks role, status and creator itself and refuses everything else.
 * This module is the convenience half, so the screen offers only what the
 * database will accept; changing it alone changes nothing about what is
 * permitted.
 *
 * - A head is editor, admin or owner (is_order_head() in the database, the
 *   ONE place to narrow it). A staff login is never a head.
 * - hr and sales cannot order, receive or cancel (can_order()).
 * - Statuses run submitted → reviewed → sent → received, with returned
 *   (back to the creator) and cancelled (instead of delete) beside them.
 */

export type OrderStatus = "submitted" | "returned" | "reviewed" | "sent" | "received" | "cancelled";

export const ORDER_STATUSES: readonly OrderStatus[] = ["submitted", "returned", "reviewed", "sent", "received", "cancelled"];

export const STATUS_LABEL: Record<OrderStatus, string> = {
  submitted: "รอตรวจสอบ",
  returned:  "ตีกลับ",
  reviewed:  "รอสั่งซื้อ",
  sent:      "สั่งแล้ว",
  received:  "รับของแล้ว",
  cancelled: "ยกเลิก",
};

/** The badge's colours: the shared tones, cancelled grey and struck through. */
export const STATUS_CLASS: Record<OrderStatus, string> = {
  submitted: "bg-pending-soft text-pending-ink",
  returned:  "bg-danger-soft text-danger",
  reviewed:  "bg-info-soft text-info",
  sent:      "bg-primary-soft text-primary",
  received:  "bg-success-soft text-success-ink",
  cancelled: "bg-neutral-200 text-neutral-700 line-through",
};

/**
 * The quantity that stands on a line: the head's, else the creator's (the
 * purchaser stage is gone, decision 5). Here, in a plain module, because the
 * server page and the client component both need it: a function exported
 * from a "use client" file cannot be called on the server.
 */
export function effectiveQty(item: { reviewerQtyOrdered: number | null; qtyOrdered: number }): number {
  return item.reviewerQtyOrdered ?? item.qtyOrdered;
}

/** Open: still moving through the flow (not received, not cancelled). */
export function isOpenStatus(status: OrderStatus): boolean {
  return status !== "received" && status !== "cancelled";
}

export function canOrder(role: string): boolean {
  return role === "staff" || role === "editor" || role === "admin" || role === "owner";
}

export function isOrderHead(role: string): boolean {
  return role === "editor" || role === "admin" || role === "owner";
}

export function canMarkSent(role: string): boolean {
  return role === "admin" || role === "owner";
}

export type OrderView = { role: string; isCreator: boolean; status: OrderStatus };

/** The creator may change lines while the order waits for review, and after a return. */
export function canEditLines(v: OrderView): boolean {
  return canOrder(v.role) && v.isCreator && (v.status === "submitted" || v.status === "returned");
}

/** A head may change quantities only while reviewing, before approving. */
export function canSetHeadQty(v: OrderView): boolean {
  return isOrderHead(v.role) && v.status === "submitted";
}

export function canApprove(v: OrderView): boolean {
  return isOrderHead(v.role) && v.status === "submitted";
}

/** A head may return until the order is marked sent. */
export function canReturn(v: OrderView): boolean {
  return isOrderHead(v.role) && (v.status === "submitted" || v.status === "reviewed");
}

export function canSend(v: OrderView): boolean {
  return canMarkSent(v.role) && v.status === "reviewed";
}

export function canReceive(v: OrderView): boolean {
  return canOrder(v.role) && v.status === "sent";
}

/**
 * Cancel: the creator while it waits for review; a head before it is sent;
 * owner and admin after it is sent too. Never a received or cancelled order.
 */
export function canCancel(v: OrderView): boolean {
  if (!canOrder(v.role)) return false;
  if (v.isCreator && v.status === "submitted") return true;
  if (isOrderHead(v.role) && (v.status === "submitted" || v.status === "returned" || v.status === "reviewed")) return true;
  if (canMarkSent(v.role) && v.status === "sent") return true;
  return false;
}
