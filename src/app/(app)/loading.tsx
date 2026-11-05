export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <div className="h-8 w-64 animate-pulse rounded bg-surface-2" />
      <div className="h-4 w-96 max-w-full animate-pulse rounded bg-surface-2" />
      <div className="h-40 animate-pulse rounded-xl bg-surface-2" />
    </div>
  );
}
