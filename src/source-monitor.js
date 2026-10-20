export const fileStamp = (file) => ({
  size: file.size,
  lastModified: file.lastModified,
});
export const sameStamp = (a, b) =>
  !!a && !!b && a.size === b.size && a.lastModified === b.lastModified;

export const sourceAccessHandle = (source) => source.directory || source.handle;
export const createFileSource = (handle, file) => ({
  handle,
  name: file.name,
  baseline: fileStamp(file),
});

// Prefer resolving through a linked directory, otherwise use the dropped file's
// persisted handle. Polling never reads contents, requests permission or parses models.
export async function sourceFile(source) {
  const access = sourceAccessHandle(source);
  if ((await access.queryPermission({ mode: "read" })) !== "granted")
    throw Object.assign(Error("Ge läsbehörighet till originalfilen först."), {
      name: "NotAllowedError",
    });
  const handle = source.directory
    ? await source.directory.getFileHandle(source.name, { create: false })
    : source.handle;
  return handle.getFile();
}

export class SourceMonitor {
  constructor({ onChange = () => {}, isBusy = () => false } = {}) {
    this.links = new Map();
    this.statuses = new Map();
    this.onChange = onChange;
    this.isBusy = isBusy;
    this.checking = null;
  }
  set(id, source) {
    this.links.delete(id);
    this.statuses.delete(id);
    if (source) this.links.set(id, source);
    this.onChange(id);
  }
  status(id) {
    return this.statuses.get(id) || null;
  }
  check() {
    if (this.isBusy()) return Promise.resolve();
    return (this.checking ||= this.run().finally(() => {
      this.checking = null;
    }));
  }
  async run() {
    const entries = [...this.links];
    for (let i = 0; i < entries.length; i += 8) {
      if (this.isBusy()) return;
      await Promise.all(
        entries.slice(i, i + 8).map(async ([id, source]) => {
          let status;
          try {
            const file = await sourceFile(source);
            status = sameStamp(source.baseline, fileStamp(file))
              ? null
              : "changed";
          } catch (error) {
            status =
              error.name === "NotFoundError"
                ? "missing"
                : ["NotAllowedError", "SecurityError"].includes(error.name)
                  ? "permission"
                  : "error";
          }
          // A removed/relinked model must never be resurrected by an in-flight check.
          if (this.links.get(id) !== source || this.status(id) === status)
            return;
          if (status) this.statuses.set(id, status);
          else this.statuses.delete(id);
          this.onChange(id);
        }),
      );
    }
  }
  start({ window, document, interval = 30000 }) {
    const check = () => {
      if (!document.hidden) void this.check();
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    const timer = window.setInterval(check, interval);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }
}

// Old embedded projects have no original modification time. Compare their bytes
// once when explicitly linking, never during automatic background checks.
export async function createSourceLink(directory, record, file) {
  let baseline = record.sourceStamp;
  if (!baseline) {
    const bytes = await file.arrayBuffer();
    const original = record.buffer;
    let equal = bytes.byteLength === original.byteLength;
    if (equal) {
      const [a, b] = await Promise.all([
        crypto.subtle.digest("SHA-256", bytes),
        crypto.subtle.digest("SHA-256", original),
      ]);
      equal = new Uint8Array(a).every(
        (value, index) => value === new Uint8Array(b)[index],
      );
    }
    baseline = equal ? fileStamp(file) : { size: -1, lastModified: -1 };
  }
  return { directory, name: record.name, baseline };
}
