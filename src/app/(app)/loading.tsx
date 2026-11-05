export default function Loading() {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="h-7 w-48 animate-pulse rounded bg-border" />
      <div className="h-32 animate-pulse rounded-xl bg-border/60" />
    </div>
  );
}
