import { getMongoDb } from "./mongo";
import type { GitHubUserRecord } from "./models";

const USERS_COLLECTION = "github_users";

export async function upsertGitHubUser(
  input: Omit<GitHubUserRecord, "createdAt" | "updatedAt">,
): Promise<GitHubUserRecord> {
  const db = await getMongoDb();
  const existing = await db.collection<GitHubUserRecord>(USERS_COLLECTION).findOne({ _id: input._id });
  const now = new Date();
  const user: GitHubUserRecord = {
    ...input,
    connectedRepositories: input.connectedRepositories,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await db.collection<GitHubUserRecord>(USERS_COLLECTION).updateOne(
    { _id: input._id },
    {
      $set: user,
    },
    { upsert: true },
  );

  return user;
}

export async function findGitHubUserById(id: string): Promise<GitHubUserRecord | null> {
  const db = await getMongoDb();
  return db.collection<GitHubUserRecord>(USERS_COLLECTION).findOne({ _id: id });
}

export async function updateConnectedRepositories(id: string, repositories: string[]): Promise<GitHubUserRecord | null> {
  const db = await getMongoDb();
  const normalizedRepositories = Array.from(
    new Set(
      repositories
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );

  await db.collection<GitHubUserRecord>(USERS_COLLECTION).updateOne(
    { _id: id },
    {
      $set: {
        connectedRepositories: normalizedRepositories,
        updatedAt: new Date(),
      },
    },
  );

  return findGitHubUserById(id);
}
