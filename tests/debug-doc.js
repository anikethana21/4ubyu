const workspace = require("../extension/src/workspace.js");

const chapters = [{
  title: "Chapter 2: Gating the Hidden State",
  timestamp_seconds: 7020,
  summary: "",
  sections: [
    {
      title: "Forget, Input and Output Gates",
      timestamp_seconds: 7080,
      explanation: "Test",
      analogy: "A water filter that keeps the clean part.",
      key_points: ["the cell state carries long-term memory", "each gate has its own weights"],
      pitfalls: ["confusing h_t with c_t -> keep the two names separate"],
      examples: ['the sentence "Riya is a doctor"'],
      degraded: false,
    },
    {
      title: "Backpropagation Through Time",
      timestamp_seconds: 7500,
      explanation: "Test",
      degraded: true,
    },
  ],
}];

const d = workspace.buildNotesDocument({
  video: { video_id: "0Q4yhrkwn7c", title: "Test", channel: "CampusX", duration_str: "2:10:00" },
  chapters,
  meta: { provider: "groq", model: "openai/gpt-oss-120b", generated_at: "2026-10-19T06:30:00.000Z" },
});

console.log("Video ID:", d.video_id);
console.log("Chapters:", d.chapters.length);
console.log("Chapter 0:", d.chapters[0].chapter_title);
console.log("Sections:", d.chapters[0].sections.length);
console.log("Section 0 title:", d.chapters[0].sections[0].section_title);
console.log("Section 0 theory_block keys:", Object.keys(d.chapters[0].sections[0].theory_block || {}));

const json = workspace.notesDocumentToJson(d);
const parsed = workspace.coerceNotesDocument(json);
console.log("Coerced video_id:", parsed?.video_id);
console.log("Coerce null:", workspace.coerceNotesDocument(null));
console.log("Coerce string:", workspace.coerceNotesDocument('{"video_id":"x","chapters":[]}'));
console.log("Validate null:", workspace.validateNotesDocument(null));
console.log("Validate chapters empty:", workspace.validateNotesDocument({ chapters: [{ sections: [] }] }));
console.log("Validate video_id x chapters empty:", workspace.validateNotesDocument({ video_id: "x", chapters: [] }));