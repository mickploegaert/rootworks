/** A line of code without its # comment (a # inside quotes stays), trimmed. */
export function withoutComment(line: string): string {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === '#') return line.slice(0, i).trim();
  }
  return line.trim();
}
