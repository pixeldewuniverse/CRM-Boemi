"use client";

/** "+" on a calendar day: opens the shared New task dialog with that date filled in. */
export function DayAddButton({ date, dialogId, label }: { date: string; dialogId: string; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="grid size-6 place-items-center rounded-md text-muted opacity-60 hover:bg-accent-soft hover:text-accent hover:opacity-100 focus-visible:opacity-100"
      onClick={() => {
        const dialog = document.getElementById(dialogId) as HTMLDialogElement | null;
        const input = dialog?.querySelector<HTMLInputElement>('input[name="dueDate"]');
        if (input) input.value = date;
        dialog?.showModal();
      }}
    >
      +
    </button>
  );
}
