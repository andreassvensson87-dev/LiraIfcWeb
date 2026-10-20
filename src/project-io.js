export function processProject(data) {
  if (data.type === "save") {
    // Folder permissions belong to this device, never to a portable project.
    data = {
      ...data,
      project: {
        ...data.project,
        files: data.project.files.map(({ source, ...file }) => file),
      },
    };
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./project.worker.js", import.meta.url), {
      type: "module",
    });
    worker.onmessage = ({ data }) => {
      worker.terminate();
      data.error ? reject(Error(data.error)) : resolve(data);
    };
    worker.onerror = (error) => {
      worker.terminate();
      reject(Error(error.message || "Projektfilen kunde inte hanteras."));
    };
    const transfers =
      data.type === "save"
        ? data.project.files.map((file) => file.buffer)
        : [data.buffer];
    worker.postMessage(data, transfers);
  });
}
