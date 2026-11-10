"use client";

/**
 * Quotation and order forms with a line-item editor. The totals shown here
 * are a preview only — the Server Action prices every line again from the
 * product list and the account's tier.
 */
import { useId, useMemo, useState } from "react";
import { createOrder } from "@/app/actions/orders";
import { createQuotation, updateQuotation } from "@/app/actions/quotations";
import { lineTotals, PRICE_TIERS, tierForSegment, unitPrice } from "@/lib/pricing";
import { SelectField, TextArea, TextField, type Option } from "./fields";
import { FormDialog, useFormErrors } from "./form-dialog";

export type AccountOption = Option & { segment: string | null };
export type DealOption = Option & { accountId: string };
export type ProductOption = { id: string; sku: string; name: string; variant: string | null; unit: string; price: number; active: boolean };
export type Line = { productId: string; quantity: number };

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("en-US")}`;
let seq = 0;
const key = () => `l${++seq}`;

function LineEditor({
  products,
  segment,
  initial,
  discountLimit,
  limitMode,
  defaults,
}: {
  products: ProductOption[];
  segment: string | null;
  initial: Line[];
  discountLimit: number;
  limitMode: "approval" | "max";
  defaults: { discountPct: number; ppn: boolean };
}) {
  const id = useId();
  const errors = useFormErrors().fieldErrors ?? {};
  const [lines, setLines] = useState(() => (initial.length ? initial : [{ productId: "", quantity: 1 }]).map((l) => ({ ...l, key: key() })));
  const [discount, setDiscount] = useState(String(defaults.discountPct || ""));
  const [ppn, setPpn] = useState(defaults.ppn);
  const tier = tierForSegment(segment);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const kept = new Set(initial.map((l) => l.productId));
  const choices = products.filter((p) => p.active || kept.has(p.id));

  const priced = lines.map((l) => {
    const p = byId.get(l.productId);
    const unit = p ? unitPrice(p.price, tier) : 0;
    return { ...l, unit, subtotal: unit * (l.quantity || 0) };
  });
  const pct = Math.min(Math.max(Number(discount) || 0, 0), 100);
  const totals = lineTotals(priced, pct, ppn);
  const filled = lines.filter((l) => l.productId).map(({ productId, quantity }) => ({ productId, quantity }));
  const over = pct > discountLimit;
  const set = (k: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));

  return (
    <div className="flex flex-col gap-3 sm:col-span-2">
      <input type="hidden" name="items" value={JSON.stringify(filled)} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-semibold">
          Products <span className="text-bad">*</span>
        </h3>
        <p className="text-xs text-muted">
          Price tier: <span className="font-semibold text-fg">{PRICE_TIERS[tier].label}</span> ({Math.round(PRICE_TIERS[tier].factor * 100)}% of retail{segment ? `, from segment ${segment}` : ""})
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {priced.map((l, i) => (
          <li key={l.key} className="grid grid-cols-[1fr_auto] gap-2 rounded-lg border border-line p-2 sm:grid-cols-[minmax(0,1fr)_6rem_8rem_auto] sm:items-center sm:border-0 sm:p-0">
            <select
              aria-label={`Product ${i + 1}`}
              value={l.productId}
              onChange={(e) => set(l.key, { productId: e.target.value })}
              className="input col-span-2 sm:col-span-1"
            >
              <option value="">Choose a product…</option>
              {choices.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.variant ? ` · ${p.variant}` : ""} ({p.sku}){p.active ? "" : " — inactive"}
                </option>
              ))}
            </select>
            <input
              aria-label={`Quantity ${i + 1}`}
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={l.quantity || ""}
              onChange={(e) => set(l.key, { quantity: Math.max(0, Math.floor(Number(e.target.value))) })}
              className="input text-right"
            />
            <p className="self-center text-right text-[13px] tabular-nums">
              <span className="block font-semibold">{rp(l.subtotal)}</span>
              {l.productId && (
                <span className="block text-xs text-muted">
                  {rp(l.unit)} / {byId.get(l.productId)?.unit}
                </span>
              )}
            </p>
            <button
              type="button"
              className="btn col-span-2 justify-center px-2 text-bad sm:col-span-1"
              aria-label={`Remove line ${i + 1}`}
              onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [{ productId: "", quantity: 1, key: key() }]))}
            >
              ✕<span className="sm:sr-only">Remove</span>
            </button>
          </li>
        ))}
      </ul>
      {errors.items && <p className="text-xs text-bad">{errors.items}</p>}
      <button type="button" className="btn self-start" onClick={() => setLines((ls) => [...ls, { productId: "", quantity: 1, key: key() }])} disabled={lines.length >= 50}>
        + Add product
      </button>

      <div className="grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-disc`} className="text-[13px] font-semibold">
            Discount %
          </label>
          <input
            id={`${id}-disc`}
            name="discountPct"
            inputMode="decimal"
            value={discount}
            onChange={(e) => setDiscount(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="0"
            aria-invalid={Boolean(errors.discountPct)}
            className={`input ${errors.discountPct ? "border-bad" : ""}`}
          />
          {errors.discountPct ? (
            <p className="text-xs text-bad">{errors.discountPct}</p>
          ) : over ? (
            <p className="text-xs text-warn">{limitMode === "approval" ? `Above ${discountLimit}% — a sales manager must approve before sending.` : `Max ${discountLimit}% on a direct order.`}</p>
          ) : (
            <p className="text-xs text-muted">{discountLimit < 100 ? `Up to ${discountLimit}% without approval.` : "No approval needed."}</p>
          )}
          <label className="mt-2 flex items-center gap-2 text-[13px]">
            <input type="checkbox" name="ppn" checked={ppn} onChange={(e) => setPpn(e.target.checked)} className="size-4 accent-[var(--accent)]" />
            Add PPN 11%
          </label>
        </div>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 self-end text-[13px] tabular-nums">
          <dt className="text-muted">Subtotal</dt>
          <dd className="text-right">{rp(totals.subtotal)}</dd>
          <dt className="text-muted">Discount {pct ? `${pct}%` : ""}</dt>
          <dd className="text-right">− {rp(totals.discount)}</dd>
          <dt className="text-muted">PPN 11%</dt>
          <dd className="text-right">{rp(totals.taxAmount)}</dd>
          <dt className="border-t border-line pt-1 font-bold">Total</dt>
          <dd className="border-t border-line pt-1 text-right font-bold">{rp(totals.total)}</dd>
        </dl>
      </div>
    </div>
  );
}

function AccountAndDeal({
  accounts,
  deals,
  accountId,
  setAccountId,
  fixedAccount,
  defaultDealId,
}: {
  accounts: AccountOption[];
  deals: DealOption[];
  accountId: string;
  setAccountId: (v: string) => void;
  fixedAccount: boolean;
  defaultDealId?: string;
}) {
  const id = useId();
  const errors = useFormErrors().fieldErrors ?? {};
  const own = deals.filter((d) => d.accountId === accountId);
  return (
    <>
      {fixedAccount ? (
        <input type="hidden" name="customerId" value={accountId} />
      ) : (
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${id}-acc`} className="text-[13px] font-semibold">
            Account <span className="text-bad">*</span>
          </label>
          <select id={`${id}-acc`} name="customerId" value={accountId} onChange={(e) => setAccountId(e.target.value)} className={`input ${errors.customerId ? "border-bad" : ""}`}>
            <option value="">Choose…</option>
            {accounts.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
          {errors.customerId && <p className="text-xs text-bad">{errors.customerId}</p>}
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${id}-deal`} className="text-[13px] font-semibold">
          Deal
        </label>
        <select key={accountId} id={`${id}-deal`} name="opportunityId" defaultValue={own.some((d) => d.value === defaultDealId) ? defaultDealId : ""} className="input" disabled={!own.length}>
          <option value="">{own.length ? "None" : "No open deals"}</option>
          {own.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
        {errors.opportunityId && <p className="text-xs text-bad">{errors.opportunityId}</p>}
      </div>
    </>
  );
}

type Shared = {
  accounts: AccountOption[];
  deals: DealOption[];
  products: ProductOption[];
  defaultAccountId?: string;
  defaultDealId?: string;
  triggerClassName?: string;
  trigger?: string;
};

function QuoteBody({
  accounts,
  deals,
  products,
  defaultAccountId,
  defaultDealId,
  discountLimit,
  defaultTerms,
  edit,
}: Shared & {
  discountLimit: number;
  defaultTerms: string;
  edit?: QuoteValues;
}) {
  const [accountId, setAccountId] = useState(edit?.customerId ?? defaultAccountId ?? "");
  const segment = accounts.find((a) => a.value === accountId)?.segment ?? edit?.segment ?? null;
  return (
    <>
      {edit && <input type="hidden" name="id" value={edit.id} />}
      <AccountAndDeal
        accounts={accounts}
        deals={deals}
        accountId={accountId}
        setAccountId={setAccountId}
        fixedAccount={Boolean(edit) || (Boolean(defaultAccountId) && accounts.length <= 1)}
        defaultDealId={edit?.opportunityId ?? defaultDealId}
      />
      <TextField name="issuedOn" label="Issued" type="date" defaultValue={edit?.issuedOn ?? ""} hint={edit ? undefined : "Defaults to today."} />
      <TextField name="validUntil" label="Valid until" type="date" defaultValue={edit?.validUntil ?? ""} hint={edit ? undefined : "Empty = default validity from settings."} />
      <LineEditor
        products={products}
        segment={segment}
        initial={edit?.lines ?? []}
        discountLimit={discountLimit}
        limitMode="approval"
        defaults={{ discountPct: edit?.discountPct ?? 0, ppn: edit?.ppn ?? true }}
      />
      <TextArea name="notes" label="Notes for the customer" wide rows={2} defaultValue={edit?.notes ?? ""} />
      <TextArea name="terms" label="Terms & conditions" wide rows={3} defaultValue={edit?.terms ?? defaultTerms} />
    </>
  );
}

export type QuoteValues = {
  id: string;
  customerId: string;
  segment: string | null;
  opportunityId: string | null;
  issuedOn: string;
  validUntil: string | null;
  discountPct: number;
  ppn: boolean;
  notes: string | null;
  terms: string | null;
  lines: Line[];
};

export function NewQuotationButton(props: Shared & { discountLimit: number; defaultTerms: string }) {
  return (
    <FormDialog trigger={props.trigger ?? "+ Quotation"} triggerClassName={props.triggerClassName} title="New quotation" description="Prices follow the account's tier. Totals are recalculated on save." action={createQuotation} submitLabel="Create draft" size="xl">
      <QuoteBody {...props} />
    </FormDialog>
  );
}

export function EditQuotationButton(props: Shared & { discountLimit: number; defaultTerms: string; edit: QuoteValues }) {
  return (
    <FormDialog trigger="Edit" triggerClassName={props.triggerClassName ?? "btn"} title="Edit quotation" action={updateQuotation} submitLabel="Save draft" size="xl">
      <QuoteBody {...props} />
    </FormDialog>
  );
}

function OrderBody({ accounts, deals, products, defaultAccountId, defaultDealId, discountLimit, defaultDepositPct }: Shared & { discountLimit: number; defaultDepositPct: number }) {
  const [accountId, setAccountId] = useState(defaultAccountId ?? "");
  const segment = accounts.find((a) => a.value === accountId)?.segment ?? null;
  return (
    <>
      <AccountAndDeal
        accounts={accounts}
        deals={deals}
        accountId={accountId}
        setAccountId={setAccountId}
        fixedAccount={Boolean(defaultAccountId) && accounts.length <= 1}
        defaultDealId={defaultDealId}
      />
      <TextField name="orderedOn" label="Order date" type="date" hint="Defaults to today." />
      <SelectField
        name="status"
        label="Status"
        options={[
          { value: "confirmed", label: "Confirmed" },
          { value: "draft", label: "Draft" },
        ]}
        defaultValue="confirmed"
      />
      <LineEditor products={products} segment={segment} initial={[]} discountLimit={discountLimit} limitMode="max" defaults={{ discountPct: 0, ppn: true }} />
      <TextField name="depositPct" label="Deposit %" inputMode="numeric" defaultValue={String(defaultDepositPct)} />
      <TextField name="reference" label="Customer PO / reference" />
      <TextArea name="notes" label="Notes" wide rows={2} />
    </>
  );
}

export function NewOrderButton(props: Shared & { discountLimit: number; defaultDepositPct: number }) {
  return (
    <FormDialog trigger={props.trigger ?? "+ Order"} triggerClassName={props.triggerClassName} title="New order" description="For repeat orders without a quotation. Prices follow the account's tier." action={createOrder} submitLabel="Create order" size="xl">
      <OrderBody {...props} />
    </FormDialog>
  );
}

