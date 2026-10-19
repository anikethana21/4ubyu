const workspace = require("../extension/src/workspace.js");

const chapters = [{
  title: "Chapter 2: Gating the Hidden State",
  timestamp_seconds: 7020,
  summary: "",
  sections: [
    {
      title: "Forget, Input and Output Gates",
      timestamp_seconds: 7080,
      explanation: "The **forget gate** decides what leaves the cell state.\n\n\\[ f_t = \\sigma(W_f h_{t-1}) \\]\n\nInline: \\(h_{t-1}\\) is the hidden state a moment ago.",
      analogy: "A water filter that keeps the clean part.",
      key_points: ["the cell state carries long-term memory", "each gate has its own weights"],
      pitfalls: ["confusing h_t with c_t -> keep the two names separate"],
      examples: ['the sentence "Riya is a doctor"'],
      degraded: false,
    },
    {
      title: "Backpropagation Through Time",
      timestamp_seconds: 7500,
      explanation: "### This section could not be written up\n\n**Why:** the provider's daily token allowance for this model is spent.",
      key_points: [],
      pitfalls: [],
      examples: [],
      degraded: true,
    },
  ],
}];

const d = workspace.buildNotesDocument({
  video: { video_id: "0Q4yhrkwn7c", title: "Deep Learning Complete Course | Part 3", channel: "CampusX", duration_str: "2:10:00" },
  chapters,
  meta: { provider: "groq", model: "openai/gpt-oss-120b", generated_at: "2026-10-19T06:30:00.000Z" },
});

console.log("=== Document ===");
console.log("video_id:", d.video_id);
console.log("chapters:", d.chapters.length);
console.log("chapter 0:", d.chapters[0].chapter_title);
console.log("chapter 0 id:", d.chapters[0].chapter_id);
console.log("sections:", d.chapters[0].sections.length);
console.log("section 0:", d.chapters[0].sections[0].section_title);
console.log("section 0 id:", d.chapters[0].sections[0].section_id);
console.log("section 0 theory_block.explanation:", d.chapters[0].sections[0].theory_block.explanation?.slice(0, 50));
console.log("section 1 degraded:", d.chapters[0].sections[1].degraded);

console.log("\n=== Coerce ===");
const json = workspace.notesDocumentToJson(d);
console.log("JSON length:", json.length);
const parsed = workspace.coerceNotesDocument(json);
console.log("Coerced video_id:", parsed?.video_id);
console.log("Coerced chapters:", parsed?.chapters?.length);
console.log("Coerced chapter 0 title:", parsed?.chapters?.[0]?.chapter_title);
console.log("Coerced chapter 0 id:", parsed?.chapters?.[0]?.chapter_id);

console.log("\n=== Validation ===");
console.log("Validate sampleDocument:", workspace.validateNotesDocument(require("./debug-doc.js").sampleDocument?.() || d));