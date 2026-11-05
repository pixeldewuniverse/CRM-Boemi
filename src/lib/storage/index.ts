import "server-only";

/**
 * Single storage interface for uploads (visit photos, receipts, imports).
 * Staging uses Vercel Blob; production uses Google Cloud Storage.
 * Switch with STORAGE_DRIVER=vercel-blob | gcs — no other code changes.
 *
 * Only the object key is stored in the database, never a public URL.
 * Files are always private and served through the authenticated
 * /api/files/[...key] route, so access rules live in one place.
 */
export type StoredObject = {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  size?: number;
};

export interface StorageDriver {
  put(key: string, body: Blob | Buffer, contentType: string): Promise<{ key: string }>;
  read(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

let driver: StorageDriver | undefined;

export async function getStorage(): Promise<StorageDriver> {
  if (driver) return driver;
  const name = process.env.STORAGE_DRIVER ?? "vercel-blob";

  if (name === "gcs") {
    const { createGcsDriver } = await import("./gcs");
    driver = createGcsDriver();
  } else if (name === "vercel-blob") {
    const { createVercelBlobDriver } = await import("./vercel-blob");
    driver = createVercelBlobDriver();
  } else {
    throw new Error(`Unknown STORAGE_DRIVER "${name}"`);
  }
  return driver;
}

/** e.g. visits/2026/11/<uuid>.jpg */
export function buildKey(folder: string, extension: string): string {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const ext = extension.replace(/^\./, "").toLowerCase();
  return `${folder}/${now.getUTCFullYear()}/${month}/${crypto.randomUUID()}.${ext}`;
}
