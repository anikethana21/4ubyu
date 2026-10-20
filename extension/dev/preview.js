const fs = require("node:fs");
const path = require("node:path");
const workspace = require(path.join(__dirname, "..", "src", "workspace.js"));

const src = path.join(__dirname, "out", "notes-a3b72fed-7020.json");
const doc = JSON.parse(fs.readFileSync(src, "utf8"));
const base = doc.chapters[0];

const titles = [
  "What a Language Model Actually Optimises",
  "Tokens, Embeddings, and the Vector Space",
  "Attention as Weighted Lookup",
  "Multi-Head Attention in Practice",
  "Positional Encoding and Order",
  "The Transformer Block, Layer by Layer",
  "Residual Streams and Normalisation",
  "Training Objectives and Next-Token Loss",
  "Backpropagation Through Attention",
  "Optimisers, Warmup, and Learning Rate Schedules",
  "Batching, Gradient Accumulation, and Memory",
  "Mixed Precision and Numerical Stability",
  "Regularisation: Dropout, Weight Decay, and Label Smoothing",
  "Data Pipelines and Tokenisation Artifacts",
  "Evaluation: Perplexity Is Not Understanding",
  "Decoding Strategies and Sampling",
  "Retrieval Augmentation Without the Hype",
  "Fine-Tuning versus Prompting",
  "Serving: Latency, Throughput, and Quantisation",
  "Safety, Refusals, and Evaluation Harnesses",
  "What to Read Next",
];

const chapters = titles.map((title, index) => ({
  ...base,
  chapter_id: `chapter-${index + 1}`,
  chapter_order: index + 1,
  chapter_title: title,
  display_title: title,
  timestamp_seconds: index * 420,
  timestamp_str: `${String(Math.floor((index * 420) / 60)).padStart(2, "0")}:${String((index * 420) % 60).padStart(2, "0")}:00`,
  sections: base.sections.map((section, s) => ({
    ...section,
    section_id: `chapter-${index + 1}-section-${s + 1}`,
  })),
}));

doc.chapters = chapters;
doc.video_metadata = {
  ...(doc.video_metadata || {}),
  title: "Transformers from Scratch — a Full Course",
  channel: "Deep Learning Systems",
  duration_str: "2:27:00",
};

const html = workspace.renderNotesHtml(doc, {});
const out = path.join(__dirname, "out", "preview-layout.html");
fs.writeFileSync(out, html, "utf8");
console.log(out, html.length);
