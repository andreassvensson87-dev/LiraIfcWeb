// Installed desktop apps receive files from the OS through the launch queue.
// Keep launches ordered and use the same import path as the file picker/drop.
export function registerFileHandling({
  openFiles,
  onError,
  launchQueue = globalThis.window?.launchQueue,
}) {
  if (!launchQueue?.setConsumer) return false;
  let pending = Promise.resolve();
  launchQueue.setConsumer((params) => {
    pending = pending
      .then(async () => {
        const files = [];
        for (const handle of params.files || []) {
          try {
            const file = await handle.getFile();
            if (/\.ifc$/i.test(file.name)) files.push(file);
            else onError(`${file.name}: Välj en IFC-fil.`);
          } catch {
            onError(`${handle.name || "IFC-filen"}: Filen kunde inte öppnas.`);
          }
        }
        if (files.length) await openFiles(files);
      })
      .catch((error) =>
        onError(`Filen kunde inte importeras: ${error.message}`),
      );
    return pending;
  });
  return true;
}
