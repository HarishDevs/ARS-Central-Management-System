"use client";

import { saveTicketCategoryAction } from "@/app/admin/tickets/actions";
import { FieldError, ResultMessage, SubmitButton, useActionForm } from "@/features/ui/form";
import type { TicketCategory } from "@/lib/db/repositories/tickets.repository";

// v1.55.0 (owner's ticketing brief §11): one ticket category (new or existing).
export function TicketCategoryForm({ category }: { category?: TicketCategory }) {
  const { result, pending, onSubmit } = useActionForm(saveTicketCategoryAction);
  const id = category ? `cat-${category.id}` : "cat-new";
  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-[1fr_9rem_6rem_6rem_auto_auto] sm:items-end" aria-label={category ? `Category ${category.name}` : "New category"} data-testid={category ? "ticket-category" : "ticket-category-new"}>
      {category && <input type="hidden" name="id" value={category.id} />}
      <div>
        <label htmlFor={`${id}-name`} className="field-label">
          Name
        </label>
        <input id={`${id}-name`} name="name" defaultValue={category?.name ?? ""} required maxLength={80} className="field-input" placeholder="e.g. IT Software" />
        <FieldError result={result} name="name" />
      </div>
      <div>
        <label htmlFor={`${id}-prefix`} className="field-label">
          Number prefix
        </label>
        <input id={`${id}-prefix`} name="prefix" defaultValue={category?.numberPrefix ?? ""} required maxLength={10} className="field-input uppercase" placeholder="IT-SW" />
        <FieldError result={result} name="prefix" />
      </div>
      <div>
        <label htmlFor={`${id}-digits`} className="field-label">
          Digits
        </label>
        <input id={`${id}-digits`} name="digits" type="number" min={3} max={8} defaultValue={category?.numberDigits ?? 5} className="field-input" />
        <FieldError result={result} name="digits" />
      </div>
      <div>
        <label htmlFor={`${id}-position`} className="field-label">
          Order
        </label>
        <input id={`${id}-position`} name="position" type="number" min={0} max={999} defaultValue={category?.position ?? 0} className="field-input" />
      </div>
      {category ? (
        <div>
          <label htmlFor={`${id}-active`} className="field-label">
            Status
          </label>
          <select id={`${id}-active`} name="active" defaultValue={category.active ? "yes" : "no"} className="field-input">
            <option value="yes">Active</option>
            <option value="no">Switched off</option>
          </select>
        </div>
      ) : (
        <span />
      )}
      <SubmitButton pending={pending} variant={category ? "secondary" : "primary"} className="btn-compact">
        {category ? "Save" : "Add category"}
      </SubmitButton>
      <div className="sm:col-span-6">
        <ResultMessage result={result} />
      </div>
    </form>
  );
}
