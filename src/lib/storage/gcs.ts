import "server-only";
import { Readable } from "node:stream";
import { Storage } from "@google-cloud/storage";
import type { StorageDriver } from "./index";

/**
 * Production driver for BOEMI's Google Cloud. On Cloud Run, credentials come
 * from the service account attached to the service (no key file needed).
 */
export function createGcsDriver(): StorageDriver {
  const bucketName = process.env.GCS_BUCKET;
  if (!bucketName) throw new Error("GCS_BUCKET is not set");
  const bucket = new Storage().bucket(bucketName);

  return {
    async put(key, body, contentType) {
      const data = Buffer.isBuffer(body)
        ? body
        : Buffer.from(await body.arrayBuffer());
      await bucket.file(key).save(data, { contentType, resumable: false });
      return { key };
    },

    async read(key) {
      const file = bucket.file(key);
      const [exists] = await file.exists();
      if (!exists) return null;
      const [meta] = await file.getMetadata();
      return {
        stream: Readable.toWeb(file.createReadStream()) as ReadableStream<Uint8Array>,
        contentType: meta.contentType ?? "application/octet-stream",
        size: meta.size ? Number(meta.size) : undefined,
      };
    },

    async delete(key) {
      await bucket.file(key).delete({ ignoreNotFound: true });
    },
  };
}

