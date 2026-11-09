/** Plain download link (not <Link>: a file download must not be prefetched). */
export function ExportLink({ entity, label = "Export CSV" }: { entity: string; label?: string }) {
  return (
    <a href={`/api/export/${entity}`} download className="btn">
      {label}
    </a>
  );
}
