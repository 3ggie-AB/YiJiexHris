import { mkdir } from "node:fs/promises";
import path from "node:path";

export async function writeJsonArtifact(
  outputDir: string | undefined,
  filename: string,
  data: unknown,
): Promise<string | undefined> {
  if (!outputDir) {
    return undefined;
  }

  const resolvedDir = path.resolve(outputDir);
  await mkdir(resolvedDir, { recursive: true });
  const filePath = path.join(resolvedDir, filename);
  await Bun.write(filePath, `${JSON.stringify(data, null, 2)}\n`);
  return filePath;
}
