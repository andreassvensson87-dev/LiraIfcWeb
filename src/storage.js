let dbPromise;
function database() {
  return (dbPromise ||= new Promise((resolve, reject) => {
    const request = indexedDB.open("lira-ifc-viewer", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("files", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
async function transaction(mode, operation) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", mode);
    const request = operation(tx.objectStore("files"));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export const storedFiles = () =>
  transaction("readonly", (store) => store.getAll());
export const storeFile = (file) =>
  transaction("readwrite", (store) => store.put(file));
export const deleteFile = (id) =>
  transaction("readwrite", (store) => store.delete(id));
export function readSettings() {
  try {
    return JSON.parse(localStorage.getItem("lira-ifc-settings")) || {};
  } catch {
    return {};
  }
}
export function saveSettings(settings) {
  try {
    localStorage.setItem("lira-ifc-settings", JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
