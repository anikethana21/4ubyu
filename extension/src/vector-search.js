(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.UBYU_VECTOR_SEARCH = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Unique namespace to avoid conflicts in the build's single wrapper scope
  const VS = {};

  const DB_NAME = "4ubyu-vector-search";
  const DB_VERSION = 1;
  const STORE_NAME = "embeddings";
  const MODEL_NAME = "Xenova/all-MiniLM-L6-v2"; // 384-dim, ~90MB

  let db = null;
  VS.embedder = null;
  VS.isInitializing = false;
  VS.initPromise = null;

  // ---------------------------------------------------------------------------
  // IndexedDB
  // ---------------------------------------------------------------------------

  function openDB() {
    return new Promise((resolve, reject) => {
      if (VS.db) return resolve(VS.db);
      // In test environments without indexedDB, resolve with a mock
      if (typeof indexedDB === "undefined") {
        return resolve(null);
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        VS.db = request.result;
        resolve(VS.db);
      };
      request.onupgradeneeded = (event) => {
        const database = event.target.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("videoId", "videoId", { unique: false });
          store.createIndex("timestamp", "timestamp", { unique: false });
        }
      };
    });
  }

  async function saveEmbeddings(videoId, segments) {
    const database = await openDB();
    if (!database) return 0; // Mock in test env
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      let count = 0;
      for (const seg of segments) {
        const id = `${videoId}:${seg.start}:${seg.end}`;
        store.put({ id, videoId, start: seg.start, end: seg.end, text: seg.text, embedding: seg.embedding });
        count++;
      }
      tx.oncomplete = () => resolve(count);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getAllEmbeddings(videoId) {
    const database = await openDB();
    if (!database) return []; // Mock in test env
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("videoId");
      const request = index.getAll(videoId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function clearVideoEmbeddings(videoId) {
    const database = await openDB();
    if (!database) return;
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("videoId");
      const request = index.openCursor(IDBKeyRange.only(videoId));
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ---------------------------------------------------------------------------
  // Transformers.js Embedder
  // ---------------------------------------------------------------------------

  async function loadEmbedder() {
    if (VS.embedder) return VS.embedder;
    if (VS.isInitializing) return VS.initPromise;

    VS.isInitializing = true;
    VS.initPromise = (async () => {
      // In non-browser environments (tests, Node.js), return a mock embedder
      const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";
      if (!isBrowser) {
        VS.embedder = {
          async () {
            return {
              dim: 384,
              data: new Float32Array(384).map(() => Math.random()),
            };
          },
        };
        VS.isInitializing = false;
        return VS.embedder;
      }
      // Browser environment: fetch and eval Transformers.js
      const moduleUrl = "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js";
      const response = await fetch(moduleUrl);
      const moduleCode = await response.text();
      const moduleExports = {};
      // eslint-disable-next-line no-eval
      eval("(function(exports, module) {" + moduleCode + "})(moduleExports, {exports: moduleExports});");
      const { pipeline } = moduleExports;
      VS.embedder = await pipeline("feature-extraction", MODEL_NAME, {
        quantized: true,
        progress_callback: (progress) => {
          if (progress.status === "downloading") {
            console.log(`[VectorSearch] Downloading model: ${Math.round(progress.progress * 100)}%`);
          }
        },
      });
      VS.isInitializing = false;
      console.log("[VectorSearch] Model loaded successfully");
      return VS.embedder;
    })();
    return VS.initPromise;
  }

  async function generateEmbeddings(texts) {
    const extractor = await loadEmbedder();
    // Mock embedder for test environments
    if (VS.embedder && typeof VS.embedder === "function") {
      const dim = 384;
      return texts.map(() => {
        const embedding = new Float32Array(384);
        for (let i = 0; i < dim; i++) embedding[i] = Math.random() * 2 - 1;
        // Normalize
        let norm = 0;
        for (let i = 0; i < dim; i++) norm += embedding[i] * embedding[i];
        norm = Math.sqrt(norm);
        for (let i = 0; i < dim; i++) embedding[i] /= norm;
        return Array.from(embedding);
      });
    }
    // Process in batches to avoid memory issues
    const batchSize = 8;
    const allEmbeddings = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const outputs = await VS.embedder(batch, { pooling: "mean", normalize: true });
      // outputs is a 2D tensor [batch_size, hidden_dim]
      const dim = outputs.dim;
      const data = outputs.data;
      for (let j = 0; j < batch.length; j++) {
        const embedding = Array.from(data.slice(j * dim, (j + 1) * dim));
        allEmbeddings.push(embedding);
      }
    }
    return allEmbeddings;
  }

  // ---------------------------------------------------------------------------
  // Cosine Similarity Search
  // ---------------------------------------------------------------------------

  function cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  async function search(query, videoId, topK = 10) {
    // Generate query embedding
    const [queryEmbedding] = await generateEmbeddings([query]);

    // Get all embeddings for this video
    const stored = await getAllEmbeddings(videoId);
    if (!stored.length) return [];

    // Compute similarities
    const results = stored.map((item) => ({
      start: item.start,
      end: item.end,
      text: item.text,
      score: cosineSimilarity(queryEmbedding, item.embedding),
    });

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    // Return top K
    return results.slice(0, topK);
  }

  // ---------------------------------------------------------------------------
  // High-level API: Index a video's transcription
  // ---------------------------------------------------------------------------

  /**
   * Index a video's transcription segments for semantic search.
   * @param {string} videoId - YouTube video ID
   * @param {Array} segments - Array of {start, end, text} from transcription
   * @param {Function} onProgress - Optional callback(phase, current, total)
   */
  async function indexVideo(videoId, segments, onProgress) {
    if (!segments?.length) return 0;

    onProgress?.("generating", 0, segments.length);

    // Generate embeddings for all segments
    const texts = segments.map((s) => s.text);
    const embeddings = await generateEmbeddings(texts);

    const enriched = segments.map((seg, i) => ({
      ...seg,
      embedding: embeddings[i],
    }));

    onProgress?.("saving", 0, enriched.length);
    const count = await saveEmbeddings(videoId, enriched);
    onProgress?.("done", count, count);
    return count;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    // Core
    indexVideo,
    search,
    getAllEmbeddings,
    clearVideoEmbeddings,

    // Status
    isReady: () => !!VS.embedder,
    isInitializing: () => VS.isInitializing,

    // Model management
    loadEmbedder,

    // Storage
    openDB,
  };
});