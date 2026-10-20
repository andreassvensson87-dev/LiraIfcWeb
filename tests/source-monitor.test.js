import { test } from "node:test";
import assert from "node:assert/strict";
import { SourceMonitor, createSourceLink } from "../src/source-monitor.js";
function fixture() {
  let file = {
      size: 10,
      lastModified: 100,
      arrayBuffer() {
        throw Error("A metadata poll must not read bytes");
      },
    },
    permission = "granted",
    error = null,
    reads = 0;
  const directory = {
    queryPermission: async () => permission,
    getFileHandle: async (name, options) => {
      assert.equal(name, "A.ifc");
      assert.equal(options.create, false);
      reads++;
      if (error) throw Object.assign(Error(), { name: error });
      return { getFile: async () => file };
    },
  };
  const changes = [],
    monitor = new SourceMonitor({ onChange: (id) => changes.push(id) });
  const source = {
    directory,
    name: "A.ifc",
    baseline: { size: 10, lastModified: 100 },
  };
  monitor.set("a", source);
  changes.length = 0;
  return {
    directory,
    source,
    monitor,
    changes,
    setFile: (f) => {
      file = f;
    },
    permission: (p) => {
      permission = p;
    },
    error: (e) => {
      error = e;
    },
    reads: () => reads,
  };
}
test("Polling reads metadata only; replaced same-name files are resolved anew and current references have no status", async () => {
  const f = fixture();
  await f.monitor.check();
  assert.equal(f.monitor.status("a"), null);
  assert.deepEqual(f.changes, []);
  f.setFile({ size: 20, lastModified: 200 });
  await f.monitor.check();
  assert.equal(f.monitor.status("a"), "changed");
  await f.monitor.check();
  assert.equal(f.changes.length, 1);
  assert.equal(f.reads(), 3);
  f.monitor.set("a", {
    ...f.source,
    baseline: { size: 20, lastModified: 200 },
  });
  await f.monitor.check();
  assert.equal(f.monitor.status("a"), null);
});
test("Missing files and permission changes never claim a reference is current or request permission in the background", async () => {
  const f = fixture();
  f.error("NotFoundError");
  await f.monitor.check();
  assert.equal(f.monitor.status("a"), "missing");
  f.permission("prompt");
  const reads = f.reads();
  await f.monitor.check();
  assert.equal(f.monitor.status("a"), "permission");
  assert.equal(f.reads(), reads);
  f.permission("granted");
  f.error(null);
  await f.monitor.check();
  assert.equal(f.monitor.status("a"), null);
  f.error("NotReadableError");
  await f.monitor.check();
  assert.equal(f.monitor.status("a"), "error");
});
test("Removed or re-linked references cannot be resurrected by an in-flight check", async () => {
  const f = fixture();
  let release;
  f.directory.queryPermission = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const pending = f.monitor.check();
  f.monitor.set("a", null);
  release("granted");
  await pending;
  assert.equal(f.monitor.status("a"), null);
  assert.equal(f.monitor.links.size, 0);
});
test("Imports pause checks; focus and 30-second timer only check while the document is visible", async () => {
  const f = fixture();
  let busy = true;
  f.monitor.isBusy = () => busy;
  await f.monitor.check();
  assert.equal(f.reads(), 0);
  busy = false;
  const windowEvents = {},
    documentEvents = {},
    doc = {
      hidden: true,
      addEventListener: (name, cb) => (documentEvents[name] = cb),
      removeEventListener() {},
    };
  let tick,
    interval,
    cleared = false;
  const win = {
    addEventListener: (name, cb) => (windowEvents[name] = cb),
    removeEventListener() {},
    setInterval: (cb, ms) => {
      tick = cb;
      interval = ms;
      return 1;
    },
    clearInterval: () => {
      cleared = true;
    },
  };
  const stop = f.monitor.start({ window: win, document: doc });
  assert.equal(interval, 30000);
  tick();
  windowEvents.focus();
  assert.equal(f.reads(), 0);
  doc.hidden = false;
  documentEvents.visibilitychange();
  await f.monitor.check();
  assert.equal(f.reads(), 1);
  stop();
  assert.equal(cleared, true);
});
test("Linking old embedded references compares content once so already changed files are flagged", async () => {
  const directory = {},
    buffer = new TextEncoder().encode("old IFC").buffer;
  const record = { name: "A.ifc", buffer };
  const same = new File([buffer], "A.ifc", { lastModified: 100 });
  const equal = await createSourceLink(directory, record, same);
  assert.deepEqual(equal.baseline, { size: 7, lastModified: 100 });
  const different = await createSourceLink(
    directory,
    record,
    new File(["new IFC"], "A.ifc", { lastModified: 200 }),
  );
  assert.equal(different.baseline.lastModified, -1);
  const stamped = await createSourceLink(
    directory,
    { ...record, sourceStamp: { size: 7, lastModified: 50 } },
    same,
  );
  assert.equal(stamped.baseline.lastModified, 50);
});

test("Dropped file handles monitor metadata directly, preserve a pending change and report lost read permission", async () => {
  let permission = "granted",
    file = { size: 10, lastModified: 100 },
    requests = 0,
    reads = 0;
  const handle = {
    kind: "file",
    name: "A.ifc",
    queryPermission: async () => permission,
    requestPermission: async () => {
      requests++;
      return "granted";
    },
    getFile: async () => {
      reads++;
      return file;
    },
  };
  const { createFileSource } = await import("../src/source-monitor.js");
  const source = createFileSource(handle, file),
    monitor = new SourceMonitor();
  monitor.set("a", source);
  await monitor.check();
  assert.equal(monitor.status("a"), null);
  file = { size: 10, lastModified: 200 };
  await monitor.check();
  assert.equal(monitor.status("a"), "changed");
  permission = "prompt";
  const before = reads;
  await monitor.check();
  assert.equal(monitor.status("a"), "permission");
  assert.equal(reads, before);
  assert.equal(requests, 0);
  permission = "granted";
  await monitor.check();
  assert.equal(monitor.status("a"), "changed");
  monitor.set("a", createFileSource(handle, file));
  await monitor.check();
  assert.equal(monitor.status("a"), null);
  handle.getFile = async () => {
    throw Object.assign(Error(), { name: "NotFoundError" });
  };
  await monitor.check();
  assert.equal(monitor.status("a"), "missing");
});
