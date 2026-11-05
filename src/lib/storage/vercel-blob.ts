import "server-only";
import { del, get, put } from "@vercel/blob";
import type { StorageDriver } from "./index";

/** Staging driver. Objects are private; reads stream through the server. */
export function createVercelBlobDriver(): StorageDriver {
  return {
    async put(key, body, contentType) {
      await put(key, body, {
        access: "private",
        contentType,
        addRandomSuffix: false,
      });
      return { key };
    },

    async read(key) {
      const result = await get(key, { access: "private" });
      if (!result || result.statusCode !== 200) return null;
      return {
        stream: result.stream,
        contentType: result.blob.contentType,
        size: result.blob.size,
      };
    },

    async delete(key) {
      await del(key);
    },
  };
}
