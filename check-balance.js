const fs = require('fs');
const content = fs.readFileSync('extension/src/pipeline.js', 'utf8');
let braceCount = 0;
let parenCount = 0;
let inString = false;
let stringChar = '';
let escapeNext = false;

for (let i = 0; i < content.length; i++) {
  const ch = content[i];
  if (escapeNext) { escapeNext = false; continue; }
  if (ch === '\\') { escapeNext = true; continue; }
  if (inString) {
    if (ch === stringChar) inString = false;
    continue;
  }
  if (ch === '"' || ch === "'" || ch === '`') { inString = true; stringChar = ch; continue; }
  if (ch === '{') braceCount++;
  else if (ch === '}') braceCount--;
  else if (ch === '(') parenCount++;
  else if (ch === ')') parenCount--;
}

console.log('braceCount:', braceCount, 'parenCount:', parenCount);

// Find where brace count is highest
braceCount = 0;
let maxBrace = 0, maxLine = 0;
const lines = content.split('\n');
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  for (let j = 0; j < line.length; j++) {
    const ch = line[j];
    if (ch === '{') braceCount++;
    else if (ch === '}') braceCount--;
  }
  if (braceCount > maxBrace) {
    maxBrace = braceCount;
    maxLine = i + 1;
  }
}
console.log('Max braceCount:', maxBrace, 'at line', maxLine);
console.log('Line', maxLine, ':', lines[maxLine - 1]);