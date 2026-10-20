// Snapshot files AND call getAsFileSystemHandle synchronously during drop.
// Browsers protect the drag data store as soon as that event returns.
export function captureDroppedFiles(dataTransfer) {
  const fallback = [...(dataTransfer?.files || [])];
  const entries = [...(dataTransfer?.items || [])]
    .filter((item) => item.kind === "file")
    .map((item) => {
      let file;
      try {
        file = item.getAsFile();
      } catch {
        // FileList below remains available if this item cannot be read.
      }
      let handle;
      try {
        handle = item.getAsFileSystemHandle?.();
      } catch {
        // Unsupported/blocked handles must not prevent ordinary file import.
      }
      return { file, handle: Promise.resolve(handle).catch(() => null) };
    });
  return Promise.all(
    entries.map(async ({ file, handle }) => ({ file, handle: await handle })),
  ).then((entries) => {
    const files = entries.map((entry) => entry.file).filter(Boolean);
    const handles = new Map();
    for (const { file, handle } of entries)
      if (file && handle?.kind === "file" && handle.name === file.name)
        handles.set(file, handle);
    return { files: files.length ? files : fallback, handles };
  });
}
