import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";

type HttpMetadata = { contentType?: string; cacheControl?: string };
type PutOptions = { httpMetadata?: HttpMetadata };
type RangeOptions = { range?: { offset: number; length: number } };

const KEY_PATTERN = /^[a-zA-Z0-9._/-]+$/;

function rootDirectory() {
  const configured = process.env.MEDIA_ROOT?.trim();
  if (!configured || !path.isAbsolute(configured)) {
    throw new Error("MEDIA_ROOT must be an absolute private directory on the VPS.");
  }
  return path.resolve(configured);
}

function objectPath(key: string) {
  if (!key || !KEY_PATTERN.test(key) || key.includes("..") || key.startsWith("/")) {
    throw new Error("Invalid media key.");
  }
  const root = rootDirectory();
  const resolved = path.resolve(root, key);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) throw new Error("Invalid media key.");
  return resolved;
}

function metadataPath(filePath: string) {
  return `${filePath}.metadata.json`;
}

async function contentType(filePath: string) {
  try {
    const value = JSON.parse(await readFile(metadataPath(filePath), "utf8"));
    return typeof value.contentType === "string" ? value.contentType : "";
  } catch {
    return "";
  }
}

async function writeBody(filePath: string, body: unknown) {
  const temporary = `${filePath}.${crypto.randomUUID()}.uploading`;
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o750 });
  try {
    if (body instanceof Uint8Array) {
      await writeFile(temporary, body, { mode: 0o640 });
    } else if (body instanceof ArrayBuffer) {
      await writeFile(temporary, new Uint8Array(body), { mode: 0o640 });
    } else if (body instanceof Blob) {
      await writeFile(temporary, new Uint8Array(await body.arrayBuffer()), { mode: 0o640 });
    } else if (body && typeof (body as ReadableStream).getReader === "function") {
      await new Promise<void>((resolve, reject) => {
        const input = Readable.fromWeb(body as unknown as import("node:stream/web").ReadableStream<Uint8Array>);
        const output = createWriteStream(temporary, { mode: 0o640 });
        input.on("error", reject);
        output.on("error", reject);
        output.on("finish", resolve);
        input.pipe(output);
      });
    } else {
      throw new Error("Unsupported media body.");
    }
    await rename(temporary, filePath);
    await chmod(filePath, 0o640);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

class VpsMultipartUpload {
  constructor(
    private readonly store: VpsMediaStore,
    readonly key: string,
    readonly uploadId: string,
  ) {}

  private directory() {
    return path.join(rootDirectory(), ".multipart", this.uploadId);
  }

  async uploadPart(partNumber: number, bytes: Uint8Array) {
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 1000) throw new Error("Invalid upload part.");
    const directory = this.directory();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const target = path.join(directory, `${String(partNumber).padStart(5, "0")}.part`);
    await writeFile(target, bytes, { mode: 0o600 });
    return { partNumber, etag: `${bytes.byteLength}-${partNumber}` };
  }

  async complete(parts: Array<{ partNumber: number; etag: string }>) {
    const target = objectPath(this.key);
    const temporary = `${target}.${crypto.randomUUID()}.uploading`;
    await mkdir(path.dirname(target), { recursive: true, mode: 0o750 });
    const output = await open(temporary, "w", 0o640);
    try {
      for (const part of parts) {
        const source = path.join(this.directory(), `${String(part.partNumber).padStart(5, "0")}.part`);
        const bytes = await readFile(source);
        await output.write(bytes);
      }
    } catch (error) {
      await output.close().catch(() => {});
      await rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
    await output.close();
    await rename(temporary, target);
    const session = JSON.parse(await readFile(path.join(this.directory(), "session.json"), "utf8"));
    await writeFile(metadataPath(target), JSON.stringify(session.httpMetadata || {}), { mode: 0o640 });
    await rm(this.directory(), { recursive: true, force: true });
    return { key: this.key, size: (await stat(target)).size };
  }

  async abort() {
    await rm(this.directory(), { recursive: true, force: true });
  }
}

class VpsMediaStore {
  async head(key: string) {
    const target = objectPath(key);
    try {
      const details = await stat(target);
      if (!details.isFile()) return null;
      return { size: details.size, httpMetadata: { contentType: await contentType(target) } };
    } catch {
      return null;
    }
  }

  async get(key: string, options: RangeOptions = {}) {
    const target = objectPath(key);
    const details = await this.head(key);
    if (!details) return null;
    const range = options.range;
    const stream = range
      ? createReadStream(target, { start: range.offset, end: range.offset + range.length - 1 })
      : createReadStream(target);
    return {
      body: Readable.toWeb(stream) as ReadableStream<Uint8Array>,
      size: details.size,
      httpMetadata: details.httpMetadata,
    };
  }

  async put(key: string, body: unknown, options: PutOptions = {}) {
    const target = objectPath(key);
    await writeBody(target, body);
    await writeFile(metadataPath(target), JSON.stringify(options.httpMetadata || {}), { mode: 0o640 });
    return { key, size: (await stat(target)).size };
  }

  async delete(key: string) {
    const target = objectPath(key);
    await Promise.all([
      rm(target, { force: true }),
      rm(metadataPath(target), { force: true }),
    ]);
  }

  async createMultipartUpload(key: string, options: PutOptions = {}) {
    objectPath(key);
    const uploadId = crypto.randomUUID();
    const directory = path.join(rootDirectory(), ".multipart", uploadId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(path.join(directory, "session.json"), JSON.stringify({ key, httpMetadata: options.httpMetadata || {} }), { mode: 0o600 });
    return new VpsMultipartUpload(this, key, uploadId);
  }

  resumeMultipartUpload(key: string, uploadId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(uploadId)) throw new Error("Invalid upload session.");
    objectPath(key);
    return new VpsMultipartUpload(this, key, uploadId);
  }
}

let store: VpsMediaStore | undefined;

export function getVpsMediaStore() {
  store ||= new VpsMediaStore();
  return store;
}
