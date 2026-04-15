interface OutputContent {
  type?: string;
  text?: string;
}

interface OutputItem {
  type?: string;
  content?: OutputContent[];
}

interface CompatibleResponsePayload {
  output_text?: string;
  output?: OutputItem[];
  error?: {
    message?: string;
  };
}

export function extractOutputText(payload: CompatibleResponsePayload): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const parts: string[] = [];

  for (const item of payload.output ?? []) {
    if (item.type !== "message") {
      continue;
    }

    for (const content of item.content ?? []) {
      if ((content.type === "output_text" || content.type === "text") && content.text) {
        parts.push(content.text);
      }
    }
  }

  if (parts.length === 0) {
    const message = payload.error?.message ?? "LLM response does not contain output text.";
    throw new Error(message);
  }

  return parts.join("").trim();
}

export function extractFirstJsonObject(raw: string): string {
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("Could not find JSON object in model output.");
  }

  return raw.slice(firstBrace, lastBrace + 1);
}
