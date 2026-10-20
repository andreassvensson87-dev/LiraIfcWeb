import { test } from "node:test";
import assert from "node:assert/strict";
import { captureDroppedFiles } from "../src/dropped-files.js";

test("Drop captures every handle in the event tick and retains file identity even with duplicate names", async () => {
  let inEvent = true;
  const files = [new File(["a"], "A.ifc"), new File(["b"], "A.ifc")];
  const handles = files.map((file, index) => ({
    kind: "file",
    name: file.name,
    index,
  }));
  const data = {
    files,
    items: files.map((file, index) => ({
      kind: "file",
      getAsFile: () => file,
      getAsFileSystemHandle: () => {
        assert.equal(inEvent, true);
        return Promise.resolve(handles[index]);
      },
    })),
  };
  const captured = captureDroppedFiles(data);
  inEvent = false;
  const result = await captured;
  assert.deepEqual(result.files, files);
  assert.equal(result.handles.get(files[0]), handles[0]);
  assert.equal(result.handles.get(files[1]), handles[1]);
});
test("Unsupported, denied, null or directory handles never break normal file import", async () => {
  const file = new File(["IFC"], "A.ifc");
  for (const getHandle of [
    undefined,
    () => Promise.reject(Error("denied")),
    () => {
      throw Error("blocked");
    },
    () => null,
    () => ({ kind: "directory", name: "A.ifc" }),
    () => ({ kind: "file", name: "wrong.ifc" }),
  ]) {
    const result = await captureDroppedFiles({
      files: [file],
      items: [
        {
          kind: "file",
          getAsFile: () => file,
          getAsFileSystemHandle: getHandle,
        },
      ],
    });
    assert.equal(result.files[0], file);
    assert.equal(result.handles.size, 0);
  }
});
test("Legacy FileList fallback is snapshotted before the drag data store is protected", async () => {
  const files = [new File(["IFC"], "A.ifc")],
    transfer = { files, items: [] };
  const captured = captureDroppedFiles(transfer);
  files.length = 0;
  assert.equal((await captured).files[0].name, "A.ifc");
  const directory = await captureDroppedFiles({
    files: [],
    items: [
      {
        kind: "file",
        getAsFile: () => null,
        getAsFileSystemHandle: () => ({ kind: "directory", name: "models" }),
      },
    ],
  });
  assert.deepEqual(directory.files, []);
  assert.equal(directory.handles.size, 0);
});
