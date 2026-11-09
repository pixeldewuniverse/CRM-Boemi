import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StorageDriver } from "./index";

/** Development only: files on local disk (./.data/uploads). */
export function createLocalDriver(): StorageDriver {
  const root = path.join(/* turbopackIgnore: true */ process.cwd(), process.env.LOCAL_UPLOAD_DIR ?? ".data/uploads");
  const resolve = (key: string) => {
    const p = path.join(/* turbopackIgnore: true */ root, key);
    if (!p.startsWith(root + path.sep)) throw new Error("Invalid key");
    return p;
  };
  return {
    async put(key, body, contentType) {
      const file = resolve(key);
      await mkdir(path.dirname(file), { recursive: true });
      const data = Buffer.isBuffer(body) ? body : Buffer.from(await body.arrayBuffer());
      await writeFile(file, data);
      await writeFile(`${file}.type`, contentType);
      return { key };
    },
    async read(key) {
      try {
        const data = await readFile(resolve(key));
        const type = await readFile(`${resolve(key)}.type`, "utf8").catch(() => "application/octet-stream");
        return { stream: new Blob([new Uint8Array(data)]).stream(), contentType: type, size: data.length };
      } catch {
        return null;
      }
    },
    async delete(key) {
      await rm(resolve(key), { force: true });
      await rm(`${resolve(key)}.type`, { force: true });
    },
  };
}
