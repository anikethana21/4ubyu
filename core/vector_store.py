"""
4 U By U - High-Performance Local Vector Store Engine (ChromaDB + HuggingFace)
Stores document chunks with chapter, section, and exact second timestamps.
Provides in-memory caching and singleton embedding models for ultra-low latency.
"""

import hashlib
from pathlib import Path
from typing import List, Dict, Any, Optional
from langchain_core.documents import Document
from config import VECTOR_DB_DIR, EMBEDDING_MODEL_NAME

# Singleton embeddings model to prevent reloading on CPU every query
_GLOBAL_EMBEDDINGS = None
_VECTOR_STORE_CACHE: Dict[str, Any] = {}
_RETRIEVER_CACHE: Dict[str, Any] = {}

def get_local_embeddings():
    """Initializes local embeddings once as a persistent singleton ($0 compute)."""
    global _GLOBAL_EMBEDDINGS
    if _GLOBAL_EMBEDDINGS is not None:
        return _GLOBAL_EMBEDDINGS
        
    try:
        from langchain_huggingface import HuggingFaceEmbeddings
        _GLOBAL_EMBEDDINGS = HuggingFaceEmbeddings(
            model_name=EMBEDDING_MODEL_NAME,
            model_kwargs={"device": "cpu"}
        )
    except Exception as e:
        print(f"[VectorStore] Falling back to lightweight local embeddings: {e}")
        from langchain_core.embeddings import FakeEmbeddings
        _GLOBAL_EMBEDDINGS = FakeEmbeddings(size=384)
        
    return _GLOBAL_EMBEDDINGS

def compute_docs_fingerprint(documents: List[Document]) -> str:
    """Computes MD5 hash of document texts to detect when index is already current."""
    h = hashlib.md5()
    for doc in documents:
        h.update(doc.page_content.encode("utf-8", errors="ignore"))
    return h.hexdigest()

def build_vector_store(video_id: str, documents: List[Document]):
    """Creates or updates persistent ChromaDB collection with intelligent hash caching."""
    if not documents:
        return None
        
    collection_dir = VECTOR_DB_DIR / video_id
    collection_dir.mkdir(parents=True, exist_ok=True)
    hash_file = collection_dir / "content.hash"
    
    current_hash = compute_docs_fingerprint(documents)
    
    # 1. Skip expensive re-indexing if collection already exists with identical content
    if hash_file.exists() and (collection_dir / "chroma.sqlite3").exists():
        try:
            cached_hash = hash_file.read_text(encoding="utf-8").strip()
            if cached_hash == current_hash and video_id in _VECTOR_STORE_CACHE:
                print(f"[VectorStore] Cache hit for video {video_id}: skipping re-indexing.")
                return _VECTOR_STORE_CACHE[video_id]
        except Exception:
            pass

    try:
        from langchain_chroma import Chroma
    except Exception:
        from langchain_community.vectorstores import Chroma
    
    embeddings = get_local_embeddings()
    try:
        vector_store = Chroma.from_documents(
            documents=documents,
            embedding=embeddings,
            persist_directory=str(collection_dir),
            collection_name=f"notes_{video_id}"
        )
        try:
            hash_file.write_text(current_hash, encoding="utf-8")
        except Exception:
            pass
            
        _VECTOR_STORE_CACHE[video_id] = vector_store
        # Invalidate cached retriever so it gets the fresh vector store
        _RETRIEVER_CACHE.pop(video_id, None)
        return vector_store
    except Exception as e:
        print(f"[VectorStore] Warning during Chroma indexing: {e}")
        return None

def get_vector_store_retriever(video_id: str, k: int = 4):
    """Loads existing Chroma collection and returns cached ultra-fast retriever."""
    cache_key = f"{video_id}_k{k}"
    if cache_key in _RETRIEVER_CACHE:
        return _RETRIEVER_CACHE[cache_key]

    collection_dir = VECTOR_DB_DIR / video_id
    if not collection_dir.exists():
        return None
        
    try:
        from langchain_chroma import Chroma
    except Exception:
        from langchain_community.vectorstores import Chroma

    embeddings = get_local_embeddings()
    try:
        vector_store = Chroma(
            persist_directory=str(collection_dir),
            embedding_function=embeddings,
            collection_name=f"notes_{video_id}"
        )
        retriever = vector_store.as_retriever(search_kwargs={"k": k})
        _RETRIEVER_CACHE[cache_key] = retriever
        return retriever
    except Exception as e:
        print(f"[VectorStore] Warning loading Chroma retriever: {e}")
        return None
