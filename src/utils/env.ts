export function parseListEnv(raw?: string): string[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(/[\r\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseJsonEnv(raw: string | undefined, envName: string): Record<string, unknown> {
  if (!raw || !raw.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("must be a JSON object");
    }

    return parsed as Record<string, unknown>;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`Environment variable ${envName} ${reason}.`);
  }
}

export function parseJsonArrayEnv(raw: string | undefined, envName: string): unknown[] {
  if (!raw || !raw.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("must be a JSON array");
    }

    return parsed;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`Environment variable ${envName} ${reason}.`);
  }
}

export function parseBooleanEnv(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) {
    return fallback;
  }

  return ["1", "true", "yes", "y", "on"].includes(raw.trim().toLowerCase());
}

export function parseNumberEnv(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}
