import type { ToolActivityRecord } from "@specialists/shared";

export function classifyToolKind(toolName: string): ToolActivityRecord["toolKind"] {
  switch (toolName) {
    case "web_search":
      return "web_search";
    case "web_research":
      return "web_research";
    case "web_fetch":
      return "web_fetch";
    case "edit":
      return "edit";
    case "write":
      return "write";
    case "read":
    case "bash":
    case "grep":
    case "find":
    case "ls":
      return "repo";
    default:
      return "other";
  }
}
