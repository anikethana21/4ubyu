"""
Neural Network Model for Chapter Boundary & Topic Classification
Predicts chapter boundaries from transcript window embeddings.

Design:
- Encoder: all-MiniLM-L6-v2 (384-dim sentence embeddings), matching the
  existing transcript_segmentation encoder so features stay consistent.
- Classifier: 3-layer MLP over window embeddings (binary boundary task).
- The model is optional: if torch is unavailable, a deterministic fallback
  heuristic keeps the pipeline runnable.
"""

import json
from pathlib import Path
from typing import List, Dict, Any, Optional

import numpy as np

try:
    import torch
    import torch.nn as nn
    from torch.utils.data import Dataset, DataLoader
    TORCH_AVAILABLE = True
except ImportError:  # pragma: no cover
    TORCH_AVAILABLE = False

try:
    from sentence_transformers import SentenceTransformer
    SBERT_AVAILABLE = True
except ImportError:  # pragma: no cover
    SBERT_AVAILABLE = False

from config import BASE_DIR

INPUT_DIM = 384  # all-MiniLM-L6-v2 embedding size


if TORCH_AVAILABLE:
    class WindowDataset(Dataset):
        """Torch dataset over precomputed window embeddings + binary labels."""

        def __init__(self, embeddings: np.ndarray, labels: np.ndarray):
            self.x = torch.tensor(embeddings, dtype=torch.float32)
            self.y = torch.tensor(labels, dtype=torch.long)

        def __len__(self) -> int:
            return int(self.x.shape[0])

        def __getitem__(self, idx: int):
            return self.x[idx], self.y[idx]

    class ChapterBoundaryMLP(nn.Module):
        """Feedforward boundary classifier."""

        def __init__(self, input_dim: int = INPUT_DIM, hidden_dim: int = 256, dropout: float = 0.3):
            super().__init__()
            self.net = nn.Sequential(
                nn.Linear(input_dim, hidden_dim),
                nn.ReLU(),
                nn.Dropout(dropout),
                nn.Linear(hidden_dim, hidden_dim // 2),
                nn.ReLU(),
                nn.Dropout(dropout),
                nn.Linear(hidden_dim // 2, 2),
            )

        def forward(self, x: torch.Tensor) -> torch.Tensor:
            return self.net(x)


class ChapterClassifierModel:
    """High-level wrapper: encode windows, train, save/load, predict."""

    def __init__(self, model_dir: Optional[Path] = None):
        self.model_dir = Path(model_dir) if model_dir else (BASE_DIR / "models" / "chapter_classifier")
        self.model_dir.mkdir(parents=True, exist_ok=True)
        self.device = "cuda" if TORCH_AVAILABLE and torch.cuda.is_available() else "cpu"
        self.model = ChapterBoundaryMLP().to(self.device) if TORCH_AVAILABLE else None
        self.encoder = None
        self.config: Dict[str, Any] = {"input_dim": INPUT_DIM, "hidden_dim": 256, "dropout": 0.3}

        if SBERT_AVAILABLE:
            try:
                self.encoder = SentenceTransformer("all-MiniLM-L6-v2")
            except Exception as e:  # pragma: no cover
                print(f"[ChapterClassifier] Encoder load failed, falling back: {e}")

    # ------------------------------------------------------------------
    # Encoding
    # ------------------------------------------------------------------
    def encode(self, texts: List[str]) -> np.ndarray:
        if self.encoder is not None:
            return np.asarray(
                self.encoder.encode(texts, normalize_embeddings=True, show_progress_bar=False),
                dtype=np.float32,
            )
        # Fallback: TF-IDF style hashing to keep shapes consistent (384-dim)
        from sklearn.feature_extraction.text import HashingVectorizer
        hv = HashingVectorizer(n_features=INPUT_DIM, stop_words="english", alternate_sign=False)
        return hv.transform(texts).astype(np.float32).toarray()

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------
    def save(self) -> None:
        if TORCH_AVAILABLE and self.model is not None:
            torch.save({"model_state": self.model.state_dict()}, self.model_dir / "model.pt")
        (self.model_dir / "config.json").write_text(json.dumps(self.config, indent=2), encoding="utf-8")
        print(f"[ChapterClassifier] Saved model to {self.model_dir}")

    def load(self) -> bool:
        cfg_path = self.model_dir / "config.json"
        weights_path = self.model_dir / "model.pt"
        if cfg_path.exists():
            self.config = json.loads(cfg_path.read_text(encoding="utf-8"))
        if weights_path.exists() and TORCH_AVAILABLE and self.model is not None:
            state = torch.load(weights_path, map_location=self.device)
            self.model.load_state_dict(state["model_state"])
            print(f"[ChapterClassifier] Loaded model from {weights_path}")
            return True
        return False

    # ------------------------------------------------------------------
    # Training
    # ------------------------------------------------------------------
    def train(
        self,
        embeddings: np.ndarray,
        labels: np.ndarray,
        epochs: int = 30,
        batch_size: int = 32,
        lr: float = 1e-3,
        val_fraction: float = 0.2,
        verbose: bool = True,
    ) -> Dict[str, Any]:
        if not TORCH_AVAILABLE or self.model is None:
            raise RuntimeError("torch is required for training the chapter classifier")

        n = len(labels)
        idx = np.random.permutation(n)
        n_val = max(1, int(n * val_fraction)) if n > 5 else 0
        val_idx, train_idx = idx[:n_val], idx[n_val:]

        train_ds = WindowDataset(embeddings[train_idx], labels[train_idx])
        train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True)
        val_ds = WindowDataset(embeddings[val_idx], labels[val_idx]) if n_val else None

        # Handle class imbalance (boundaries are rare): weighted cross entropy
        n_pos = float(labels[train_idx].sum()) or 1.0
        n_neg = float(len(train_idx) - labels[train_idx].sum()) or 1.0
        weights = torch.tensor([1.0, n_neg / n_pos], dtype=torch.float32).to(self.device)
        criterion = nn.CrossEntropyLoss(weight=weights)
        optimizer = torch.optim.Adam(self.model.parameters(), lr=lr)

        history: Dict[str, List[float]] = {"train_loss": [], "val_acc": []}
        for epoch in range(epochs):
            self.model.train()
            total_loss = 0.0
            for xb, yb in train_loader:
                xb, yb = xb.to(self.device), yb.to(self.device)
                optimizer.zero_grad()
                logits = self.model(xb)
                loss = criterion(logits, yb)
                loss.backward()
                optimizer.step()
                total_loss += float(loss.item())
            avg_loss = total_loss / max(1, len(train_loader))
            history["train_loss"].append(avg_loss)

            val_acc = float("nan")
            if val_ds is not None:
                val_acc = self._accuracy(val_ds)
                history["val_acc"].append(val_acc)

            if verbose and (epoch % 5 == 0 or epoch == epochs - 1):
                print(f"[ChapterClassifier] epoch {epoch:>3} loss={avg_loss:.4f} val_acc={val_acc:.3f}")

        return history

    def _accuracy(self, ds) -> float:
        loader = DataLoader(ds, batch_size=64)
        self.model.eval()
        correct = total = 0
        with torch.no_grad():
            for xb, yb in loader:
                xb, yb = xb.to(self.device), yb.to(self.device)
                preds = torch.argmax(self.model(xb), dim=1)
                correct += int((preds == yb).sum().item())
                total += int(yb.shape[0])
        return correct / total if total else 0.0

    # ------------------------------------------------------------------
    # Inference
    # ------------------------------------------------------------------
    def predict_boundaries(self, windows: List[Dict[str, Any]]) -> List[int]:
        """
        Predict a binary boundary flag per window.
        Falls back to a heuristic cadence when the model or torch is unavailable.
        """
        texts = [w.get("text", "") for w in windows]
        if not texts:
            return []

        if not (TORCH_AVAILABLE and self.model is not None):
            return [1 if i % 4 == 0 else 0 for i in range(len(texts))]

        emb = self.encode(texts)
        x = torch.tensor(emb, dtype=torch.float32).to(self.device)
        self.model.eval()
        with torch.no_grad():
            logits = self.model(x)
            preds = torch.argmax(logits, dim=1).cpu().numpy()
        return preds.astype(int).tolist()
