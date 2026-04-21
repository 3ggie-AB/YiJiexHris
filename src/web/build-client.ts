import fs from "node:fs/promises";
import path from "node:path";

const CLIENT_OUT_DIR = path.resolve(import.meta.dir, "../../.web-build");

export function getWebClientOutDir(): string {
  return CLIENT_OUT_DIR;
}

export async function ensureWebClientBundle(): Promise<void> {
  await fs.mkdir(CLIENT_OUT_DIR, { recursive: true });

  const result = await Bun.build({
    entrypoints: [path.resolve(import.meta.dir, "client.tsx")],
    outdir: CLIENT_OUT_DIR,
    target: "browser",
    format: "esm",
    splitting: false,
    sourcemap: "external",
  });

  if (!result.success) {
    const logs = result.logs.map((entry) => entry.message).join("\n");
    throw new Error(`Failed to build React web client.\n${logs}`);
  }
}
