import { encodeProject, decodeProject } from "./project-file.js";
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "save") {
      const bytes = await encodeProject(data.project);
      self.postMessage({ bytes }, [bytes.buffer]);
    } else {
      const project = await decodeProject(data.buffer);
      self.postMessage(
        { project },
        project.files.map((file) => file.buffer),
      );
    }
  } catch (error) {
    self.postMessage({
      error: error.message || "Projektfilen kunde inte läsas.",
    });
  }
};
