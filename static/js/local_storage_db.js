/**
 * 4 U By U — Client-Side Local Storage & IndexedDB Engine
 * Saves and auto-reads generated handbooks, video metadata, and study notes
 * directly on the user''s local machine (browser IndexedDB).
 * Zero cloud storage costs, 100% private, instant offline launch.
 */

const DB_NAME = "4UByU_LocalLibrary";
const DB_VERSION = 1;
const STORE_NAME = "handbooks";

// Open or initialize IndexedDB
function openLocalDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      console.warn("IndexedDB not supported in this browser. Falling back to memory/localStorage.");
      resolve(null);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
        store.createIndex("title", "title", { unique: false });
      }
    };

    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => {
      console.error("IndexedDB open error:", e.target.error);
      resolve(null);
    };
  });
}

// Save or update a handbook in local IndexedDB
async function saveHandbookLocally(handbook) {
  const db = await openLocalDB();
  if (!db) {
    // Fallback: localStorage
    try {
      const existing = JSON.parse(localStorage.getItem("4ubyu_handbooks") || "{}");
      existing[handbook.id] = handbook;
      localStorage.setItem("4ubyu_handbooks", JSON.stringify(existing));
    } catch (e) {
      console.warn("localStorage quota exceeded:", e);
    }
    return;
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], "readwrite");
    const store = tx.objectStore(STORE_NAME);
    handbook.updatedAt = new Date().toISOString();
    if (!handbook.createdAt) handbook.createdAt = handbook.updatedAt;

    const req = store.put(handbook);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

// Retrieve all locally stored handbooks on the user''s PC
async function getLocalHandbooks() {
  const db = await openLocalDB();
  if (!db) {
    try {
      const existing = JSON.parse(localStorage.getItem("4ubyu_handbooks") || "{}");
      return Object.values(existing);
    } catch (e) {
      return [];
    }
  }

  return new Promise((resolve) => {
    const tx = db.transaction([STORE_NAME], "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();

    req.onsuccess = () => {
      const items = req.result || [];
      // Sort newest first
      items.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      resolve(items);
    };
    req.onerror = () => resolve([]);
  });
}

// Delete a handbook from user''s local PC storage
async function deleteLocalHandbook(id) {
  const db = await openLocalDB();
  if (!db) {
    try {
      const existing = JSON.parse(localStorage.getItem("4ubyu_handbooks") || "{}");
      delete existing[id];
      localStorage.setItem("4ubyu_handbooks", JSON.stringify(existing));
    } catch (e) {}
    return true;
  }

  return new Promise((resolve) => {
    const tx = db.transaction([STORE_NAME], "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => resolve(false);
  });
}

// Export all user''s handbooks as a single JSON backup file to PC
async function exportLocalBackup() {
  const items = await getLocalHandbooks();
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(items, null, 2));
  const downloadAnchor = document.createElement("a");
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `4_U_By_U_Library_Backup_${new Date().toISOString().slice(0, 10)}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

// Expose on window object
window.LocalLibrary = {
  saveHandbookLocally,
  getLocalHandbooks,
  deleteLocalHandbook,
  exportLocalBackup
};
