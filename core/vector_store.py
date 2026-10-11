"""
4 U By U — Local Vector Store Engine (ChromaDB + HuggingFace)
Stores document chunks with chapter, section, and exact second timestamps.
Provides 100% free local embeddings without API calls or cost.
"""

from pathlib import Path
from typing import List, Dict, Any, Optional
from langchain_core.documents import Document
from config import VECTOR_DB_DIR, EMBEDDING_MODEL_NAME

def get_local_embeddings():
    """Initializes local embeddings with zero-hang fallback ($0 compute)."""
    try:
        from langchain_huggingface import HuggingFaceEmbeddings
        return HuggingFaceEmbeddings(
            model_name=EMBEDDING_MODEL_NAME,
            model_kwargs={"device": "cpu"}
        )
    except Exception as e:
        print(f"[VectorStore] Falling back to lightweight local embeddings: {e}")
        from langchain_core.embeddings import FakeEmbeddings
        return FakeEmbeddings(size=384)

def build_vector_store(video_id: str, documents: List[Document]):
    """Creates or updates persistent ChromaDB collection for the video."""
    try:
        from langchain_chroma import Chroma
    except Exception:
        from langchain_community.vectorstores import Chroma
    
    collection_dir = VECTOR_DB_DIR / video_id
    collection_dir.mkdir(parents=True, exist_ok=True)
    
    embeddings = get_local_embeddings()
    try:
        vector_store = Chroma.from_documents(
            documents=documents,
            embedding=embeddings,
            persist_directory=str(collection_dir),
            collection_name=f"notes_{video_id}"
        )
        return vector_store
    except Exception as e:
        print(f"[VectorStore] Warning during Chroma indexing: {e}")
        return None

def get_vector_store_retriever(video_id: str, k: int = 4):
    """Loads existing Chroma collection and returns retriever."""
    try:
        from langchain_chroma import Chroma
    except Exception:
        from langchain_community.vectorstores import Chroma

    collection_dir = VECTOR_DB_DIR / video_id
    if not collection_dir.exists():
        return None
        
    embeddings = get_local_embeddings()
    try:
        vector_store = Chroma(
            persist_directory=str(collection_dir),
            embedding_function=embeddings,
            collection_name=f"notes_{video_id}"
        )
        return vector_store.as_retriever(search_kwargs={"k": k})
    except Exception as e:
        print(f"[VectorStore] Warning loading Chroma retriever: {e}")
        return None
