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
export const clearStoredFiles = () =>
  transaction("readwrite", (store) => store.clear());
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

export async function storePlacement(id, placement, unitConfirmed) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readwrite"),
      store = tx.objectStore("files");
    const request = store.get(id);
    request.onsuccess = () => {
      if (request.result)
        store.put({
          ...request.result,
          placement,
          ...(unitConfirmed === undefined ? {} : { unitConfirmed }),
        });
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
