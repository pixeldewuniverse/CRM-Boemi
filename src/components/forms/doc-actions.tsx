"use client";

import { deleteOrder, deletePayment, recordPayment, setDeliveryStatus, setOrderStatus, updateOrder } from "@/app/actions/orders";
import { convertQuotationToOrder, deleteQuotation, reviewDiscount, setQuotationStatus } from "@/app/actions/quotations";
import { PAYMENT_METHODS } from "@/lib/labels";
import { ActionButton, ConfirmButton } from "./action-button";
import { FormNote, SelectField, TextArea, TextField } from "./fields";
import { FormDialog } from "./form-dialog";

const today = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

/* ───────────── Quotation ───────────── */

export function QuoteStatusActions({
  id,
  quoteNo,
  status,
  approval,
  editable,
  canReview,
  hasOrder,
}: {
  id: string;
  quoteNo: string;
  status: string;
  approval: string;
  editable: boolean;
  canReview: boolean;
  hasOrder: boolean;
}) {
  return (
    <>
      {canReview && approval === "pending" && (
        <>
          <FormDialog trigger="Approve discount" triggerClassName="btn border-ok text-ok" title={`Approve the discount on ${quoteNo}?`} action={reviewDiscount} submitLabel="Approve">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="decision" value="approved" />
            <TextArea name="note" label="Note to the rep (optional)" rows={2} />
          </FormDialog>
          <FormDialog trigger="Reject discount" triggerClassName="btn text-bad" title={`Reject the discount on ${quoteNo}?`} action={reviewDiscount} submitLabel="Reject" danger>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="decision" value="rejected" />
            <TextArea name="note" label="Reason" required rows={2} placeholder="e.g. Max 12% for this volume." />
          </FormDialog>
        </>
      )}
      {editable && status === "draft" && (
        <>
          <ConfirmButton
            action={setQuotationStatus}
            fields={{ id, status: "sent" }}
            trigger="Mark as sent"
            triggerClassName="btn btn-primary"
            title={`Mark ${quoteNo} as sent?`}
            submitLabel="Mark as sent"
            danger={false}
          >
            Send the printable version (Print / PDF) to the customer, then mark it here. Sent quotations can&apos;t be edited; they expire automatically after the valid-until date.
          </ConfirmButton>
          <ConfirmButton action={deleteQuotation} fields={{ id }} trigger="Delete" title={`Delete ${quoteNo}?`}>
            The draft is removed permanently. Its number is not reused.
          </ConfirmButton>
        </>
      )}
      {editable && status === "sent" && (
        <>
          <ConfirmButton action={setQuotationStatus} fields={{ id, status: "accepted" }} trigger="Accepted" triggerClassName="btn border-ok text-ok" title={`${quoteNo} accepted by the customer?`} submitLabel="Mark accepted" danger={false}>
            You can then convert it into an order.
          </ConfirmButton>
          <FormDialog trigger="Rejected" triggerClassName="btn text-bad" title={`${quoteNo} rejected by the customer?`} action={setQuotationStatus} submitLabel="Mark rejected" danger>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="status" value="rejected" />
            <TextArea name="note" label="Why? (optional)" rows={2} placeholder="e.g. chose a competitor, budget moved to Q2" />
          </FormDialog>
        </>
      )}
      {editable && status === "accepted" && !hasOrder && (
        <ConfirmButton
          action={convertQuotationToOrder}
          fields={{ id }}
          trigger="Convert to order"
          triggerClassName="btn btn-primary"
          title={`Create an order from ${quoteNo}?`}
          submitLabel="Create order"
          danger={false}
        >
          A confirmed order is created with the quoted items and prices. The linked deal is marked won.
        </ConfirmButton>
      )}
    </>
  );
}

/* ───────────── Order ───────────── */

const STATUS_NEXT: Record<string, { to: string; label: string }[]> = {
  draft: [{ to: "confirmed", label: "Confirm" }],
  confirmed: [{ to: "processing", label: "Start processing" }],
  processing: [{ to: "completed", label: "Complete" }],
  completed: [{ to: "processing", label: "Reopen" }],
  cancelled: [{ to: "confirmed", label: "Reopen" }],
};

export function OrderStatusActions({
  id,
  orderNo,
  status,
  delivery,
  editable,
  canDelete,
  details,
}: {
  id: string;
  orderNo: string;
  status: string;
  delivery: string;
  editable: boolean;
  canDelete: boolean;
  details: { depositPct: number; reference: string | null; notes: string | null };
}) {
  if (!editable) return null;
  const live = status !== "draft" && status !== "cancelled";
  return (
    <>
      {(STATUS_NEXT[status] ?? []).map((s) => (
        <ActionButton key={s.to} action={setOrderStatus} fields={{ id, status: s.to }} className={s.to === "completed" || s.to === "confirmed" ? "btn btn-primary" : "btn"}>
          {s.label}
        </ActionButton>
      ))}
      {live && delivery === "pending" && (
        <ActionButton action={setDeliveryStatus} fields={{ id, deliveryStatus: "shipped" }}>
          Mark shipped
        </ActionButton>
      )}
      {live && delivery === "shipped" && (
        <ActionButton action={setDeliveryStatus} fields={{ id, deliveryStatus: "delivered" }}>
          Mark delivered
        </ActionButton>
      )}
      {live && delivery !== "pending" && (
        <ActionButton action={setDeliveryStatus} fields={{ id, deliveryStatus: delivery === "delivered" ? "shipped" : "pending" }} className="btn text-muted">
          Undo {delivery === "delivered" ? "delivered" : "shipped"}
        </ActionButton>
      )}
      <FormDialog trigger="Edit" triggerClassName="btn" title={`Edit ${orderNo}`} action={updateOrder}>
        <input type="hidden" name="id" value={id} />
        <TextField name="depositPct" label="Deposit %" inputMode="numeric" defaultValue={String(details.depositPct)} />
        <TextField name="reference" label="Customer PO / reference" defaultValue={details.reference ?? ""} />
        <TextArea name="notes" label="Notes" rows={3} defaultValue={details.notes ?? ""} />
        <FormNote>Items can&apos;t change once an order exists. Cancel it and create a new one if the items are wrong.</FormNote>
      </FormDialog>
      {status !== "cancelled" && status !== "completed" && (
        <ConfirmButton action={setOrderStatus} fields={{ id, status: "cancelled" }} trigger="Cancel order" title={`Cancel ${orderNo}?`} submitLabel="Cancel order">
          Cancelled orders don&apos;t count towards revenue or receivables. Payments must be removed first.
        </ConfirmButton>
      )}
      {canDelete && (
        <ConfirmButton action={deleteOrder} fields={{ id }} trigger="Delete" title={`Delete ${orderNo}?`}>
          Only unpaid drafts can be deleted.
        </ConfirmButton>
      )}
    </>
  );
}

export function RecordPaymentButton({ orderId, outstanding, depositDue }: { orderId: string; outstanding: number; depositDue: number }) {
  const suggestDeposit = depositDue > 0 && depositDue < outstanding;
  return (
    <FormDialog trigger="+ Payment" title="Record payment" description={`Outstanding Rp ${outstanding.toLocaleString("en-US")}.`} action={recordPayment} submitLabel="Record" wide>
      <input type="hidden" name="orderId" value={orderId} />
      <SelectField
        name="kind"
        label="Type"
        options={[
          { value: "deposit", label: "Deposit" },
          { value: "settlement", label: "Settlement (pelunasan)" },
          { value: "other", label: "Other" },
        ]}
        defaultValue={suggestDeposit ? "deposit" : "settlement"}
      />
      <TextField name="amount" label="Amount (Rp)" required inputMode="numeric" defaultValue={String(suggestDeposit ? depositDue : outstanding)} />
      <TextField name="paidOn" label="Paid on" type="date" required defaultValue={today()} />
      <SelectField name="method" label="Method" options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} defaultValue="Transfer" />
      <TextField name="reference" label="Reference" placeholder="Transfer ref / receipt no." wide />
      <TextArea name="note" label="Note" wide rows={2} />
    </FormDialog>
  );
}

export function DeletePaymentButton({ id }: { id: string }) {
  return (
    <ConfirmButton action={deletePayment} fields={{ id }} trigger="Remove" triggerClassName="text-xs text-muted hover:text-bad" title="Remove this payment?" submitLabel="Remove">
      Use this to correct a payment recorded by mistake. The order&apos;s payment status is recalculated.
    </ConfirmButton>
  );
}
