/**
 * Shrinks a photo in the browser before upload (JPEG ~80%).
 * `square` crops the centre first (profile photos).
 */
export async function compressImage(file: File, maxSide: number, opts: { square?: boolean; name?: string } = {}): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const [sx, sy, sw, sh] = opts.square ? [(bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side] : [0, 0, bitmap.width, bitmap.height];
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  canvas.getContext("2d")!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), "image/jpeg", 0.8));
  return new File([blob], opts.name ?? "photo.jpg", { type: "image/jpeg" });
}
