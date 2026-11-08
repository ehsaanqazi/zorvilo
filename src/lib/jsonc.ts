/**
 * Minimal JSONC support: let request bodies carry `//` and `/* *​/` comments
 * (and trailing commas) the way editors like VS Code and tools like Postman
 * tolerate. The editor keeps the comments for readability; we strip them here
 * so strictly-valid JSON goes over the wire.
 *
 * The scan is string-aware: comment markers and commas inside string literals
 * are left untouched.
 */
export function stripJsonComments(input: string): string {
  let out = '';
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    const next = input[i + 1];

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        out += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inString) {
      out += ch;
      if (ch === '\\') {
        // copy the escaped character verbatim
        if (next !== undefined) {
          out += next;
          i++;
        }
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }

    out += ch;
  }

  return stripTrailingCommas(out);
}

/** Remove commas that sit right before a closing `}` or `]` (JSON5/JSONC habit). */
function stripTrailingCommas(input: string): string {
  let out = '';
  let inString = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;

    if (inString) {
      out += ch;
      if (ch === '\\') {
        const next = input[i + 1];
        if (next !== undefined) {
          out += next;
          i++;
        }
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === ',') {
      // look ahead past whitespace for a closing bracket
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j]!)) j++;
      const following = input[j];
      if (following === '}' || following === ']') {
        continue; // drop the trailing comma
      }
    }

    out += ch;
  }

  return out;
}
