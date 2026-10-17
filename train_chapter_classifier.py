"""
4 U By U — Chapter Classifier Training Entrypoint
===================================================
Builds labeled windows from generated workspaces (chapter markers = labels),
trains the boundary-classification MLP, and saves it to models/chapter_classifier/.

Usage:
    python train_chapter_classifier.py                    # auto-dataset + train
    python train_chapter_classifier.py --epochs 50        # custom epochs
    python train_chapter_classifier.py --json data.json   # train from prepared dataset
"""

import argparse
import json
import sys
from pathlib import Path
from typing import List, Dict, Any

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))

from core.chapter_dataset_builder import ChapterDatasetBuilder
from core.chapter_classifier_nn import ChapterClassifierModel


def build_training_set() -> tuple[List[str], np.ndarray]:
    """
    Build embeddings + labels from the local library:
    - Parse chapter timestamps from generated HTML handbooks.
    - We lack raw transcripts offline, so use chapter start markers as the
      positive signal and construct synthetic negative boundaries between them.
    """
    builder = ChapterDatasetBuilder()
    info = builder.build_from_existing_outputs()
    builder.save_dataset(info)

    samples = info.get("samples", [])
    if not samples:
        raise SystemExit(
            "[Train] No generated workspaces found in output/. "
            "Generate at least one handbook first, then re-run."
        )

    texts: List[str] = []
    labels: List[int] = []

    for sample in samples:
        chapters = sample.get("chapters", [])
        if len(chapters) < 2:
            continue
        starts = sorted(int(c.get("timestamp_seconds", 0)) for c in chapters)

        # Positive: chapter starts
        for c in chapters:
            texts.append(c.get("text", "")[:600])
            labels.append(1)

        # Negative: midpoints between consecutive chapter starts
        for a, b in zip(starts, starts[1:]):
            mid = (a + b) // 2
            # find a chapter whose text approximates the middle region
            nxt = next((c for c in chapters if c.get("timestamp_seconds") == b), None)
            if nxt:
                texts.append(nxt.get("text", "")[:600])
                labels.append(0)

    if not texts:
        raise SystemExit("[Train] Could not derive any training samples.")

    return texts, np.asarray(labels, dtype=np.int64)


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the chapter boundary classifier")
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--save", action="store_true", default=True)
    args = parser.parse_args()

    print("[Train] Building labeled dataset from local workspaces...")
    texts, labels = build_training_set()
    print(f"[Train] {len(texts)} samples, {int(labels.sum())} positive boundaries")

    model = ChapterClassifierModel()
    print("[Train] Encoding windows with all-MiniLM-L6-v2...")
    embeddings = model.encode(texts)

    history = model.train(
        embeddings,
        labels,
        epochs=args.epochs,
        batch_size=args.batch_size,
        lr=args.lr,
    )

    if args.save:
        model.save()

    print(f"[Train] Done. Final train loss: {history['train_loss'][-1]:.4f}")
    if history["val_acc"]:
        print(f"[Train] Final val acc: {history['val_acc'][-1]:.3f}")


if __name__ == "__main__":
    main()
