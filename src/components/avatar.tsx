/** Profile photo, or initials when there's none. */
export function Avatar({ name, avatarKey, size = 30 }: { name: string; avatarKey: string | null; size?: number }) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  if (avatarKey) {
    // eslint-disable-next-line @next/next/no-img-element -- private file served by /api/files, not optimisable
    return <img src={`/api/files/${avatarKey}`} alt="" width={size} height={size} className="flex-none rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span className="grid flex-none place-items-center rounded-full bg-accent-soft font-bold text-accent" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}>
      {initials}
    </span>
  );
}
