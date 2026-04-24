export function parseJsonObject<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
): T | undefined {
  const trimmed = text.trim();
  for (const candidate of [trimmed, stripMarkdownCodeFence(trimmed), extractFirstJsonObject(trimmed)]) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as T;
      }
    } catch {
      // Try next candidate.
    }
  }
  return undefined;
}

export function extractAnswerSummary(text: string, maxLength: number = 800): string {
  const parsed = parseJsonObject(text);
  if (parsed) {
    const summary = firstString([
      parsed.summary,
      parsed.directAnswer,
      parsed.answer,
      valueAtPath(parsed, ["sections", "summary"]),
      extractSummaryFromSections(parsed.sections),
    ]);
    if (summary) {
      return truncate(summary, maxLength);
    }
  }
  const normalized = text
    .replace(/```(?:json|markdown|md)?/gi, "")
    .replace(/```/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return truncate(normalized, maxLength);
}

function stripMarkdownCodeFence(text: string): string | undefined {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim();
}

function extractFirstJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1).trim();
      }
    }
  }
  return undefined;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function firstString(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (Array.isArray(value)) {
      const joined = value
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .join(" ")
        .trim();
      if (joined) {
        return joined;
      }
    }
  }
  return undefined;
}

function valueAtPath(root: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = root;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function extractSummaryFromSections(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const parts: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const summary = firstString([record.summary]);
    if (summary) {
      parts.push(summary);
    }
    if (parts.length >= 2) {
      break;
    }
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}
