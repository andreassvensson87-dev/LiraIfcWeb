import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerFileHandling } from "../src/file-handling.js";

test("IFC association stays inside the installed app scope, including GitHub Pages", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../public/manifest.webmanifest", import.meta.url)),
  );
  const base = "https://example.com/LiraIfcWeb/";
  const handler = manifest.file_handlers[0];
  assert.equal(new URL(handler.action, base).href, base);
  assert.deepEqual(handler.accept["application/x-step"], [".ifc"]);
  assert.equal(handler.launch_type, "single-client");
  assert.equal(manifest.launch_handler.client_mode, "focus-existing");
});

test("OS launches are serialized and unreadable files do not discard other files", async () => {
  let consume, release;
  const imports = [],
    errors = [];
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  registerFileHandling({
    launchQueue: {
      setConsumer: (callback) => {
        consume = callback;
      },
    },
    onError: (message) => errors.push(message),
    openFiles: async (files) => {
      imports.push(files.map((file) => file.name));
      if (imports.length === 1) await wait;
    },
  });
  const handle = (name) => ({ getFile: async () => ({ name }) });
  const first = consume({
    files: [
      handle("A.IFC"),
      {
        name: "missing.ifc",
        getFile: async () => {
          throw Error();
        },
      },
      handle("B.ifc"),
    ],
  });
  const second = consume({ files: [handle("C.ifc")] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(imports, [["A.IFC", "B.ifc"]]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(imports, [["A.IFC", "B.ifc"], ["C.ifc"]]);
  assert.equal(errors.length, 1);
});

test("Empty launches, unsupported browsers and failed imports remain usable", async () => {
  assert.equal(registerFileHandling({ launchQueue: null }), false);
  let consume,
    attempts = 0;
  const errors = [];
  registerFileHandling({
    launchQueue: {
      setConsumer: (callback) => {
        consume = callback;
      },
    },
    onError: (message) => errors.push(message),
    openFiles: async () => {
      if (++attempts === 1) throw Error("test");
    },
  });
  await consume({});
  await consume({ files: [{ getFile: async () => ({ name: "wrong.txt" }) }] });
  const params = { files: [{ getFile: async () => ({ name: "model.ifc" }) }] };
  await consume(params);
  await consume(params);
  assert.equal(attempts, 2);
  assert.equal(errors.length, 2);
});

test("Opening IFC from the OS retains the original file handle for monitoring", async () => {
  let consume, received;
  const file = new File(["IFC"], "A.ifc"),
    handle = { kind: "file", name: "A.ifc", getFile: async () => file };
  registerFileHandling({
    launchQueue: {
      setConsumer: (callback) => {
        consume = callback;
      },
    },
    onError: assert.fail,
    openFiles: async (files, handles) => {
      received = { files, handles };
    },
  });
  await consume({ files: [handle] });
  assert.equal(received.files[0], file);
  assert.equal(received.handles.get(file), handle);
});
