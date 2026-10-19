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

const html = workspace.renderNotesHtml(d, { css: "" });

// Extract URLs
const urls = html.match(/https?:\/\/[^\s"'<)]+/g) || [];
console.log("URLs found:", urls);

// Check for constellation-bg-canvas
console.log("Has constellation-bg-canvas:", html.includes("constellation-bg-canvas"));

// Check for key points
console.log("Has 'the cell state carries long-term memory':", html.includes("the cell state carries long-term memory"));

// Check for Common Mistakes
console.log("Has Common Mistakes:", html.includes("Common Mistakes"));

// Check for constellation-bg-canvas in script
console.log("Has constellation-bg-canvas in script:", html.includes("constellation-bg-canvas"));

// Check URL format
const chapterUrls = html.match(/https:\/\/www\.youtube\.com\/watch\?v=0Q4yhrkwn7c[^"'>\s]+/g) || [];
console.log("Chapter URLs:", chapterUrls);

// Check for constellation-bg-canvas in the script section
const scriptSection = html.split("<script>")[1] || "";
console.log("Script section has constellation:", scriptSection.includes("constellation-bg-canvas"));

// Check for key points in HTML
console.log("Key points in HTML:", html.includes("the cell state carries long-term memory"));

// Check for Common Mistakes in HTML
console.log("Common Mistakes in HTML:", html.includes("Common Mistakes"));

// Check for degraded badge
console.log("Degraded badge:", html.includes("Not written up"));

// Check for notes-banner
console.log("Notes banner:", html.includes("could not be written up"));

// Check for toc-folded
console.log("toc-folded in CSS:", workspace.PAGE_STYLE.includes("toc-folded"));

// Check for toggleTocFold in script
console.log("toggleTocFold in script:", workspace.NOTES_SCRIPT.includes("toggleTocFold"));

// Check for search-empty
console.log("search-empty:", html.includes("search-empty"));

// Check for constellation-bg-canvas in the page scripts
const pageScripts = html.split("<script>")[1] || "";
console.log("Page scripts has constellation:", pageScripts.includes("constellation-bg-canvas"));

// Full HTML length
console.log("HTML length:", html.length);