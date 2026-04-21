import { MongoClient } from "mongodb";
import { readProjectEnv } from "../utils/load-project-env";

let clientPromise: Promise<MongoClient> | undefined;

function getMongoUri(): string {
  const uri = readProjectEnv("MONGODB_URI");
  if (!uri) {
    throw new Error("MONGODB_URI is required for the web dashboard.");
  }

  return uri;
}

export async function getMongoClient(): Promise<MongoClient> {
  if (!clientPromise) {
    clientPromise = MongoClient.connect(getMongoUri());
  }

  return clientPromise;
}

export async function getMongoDb() {
  const client = await getMongoClient();
  const dbName = readProjectEnv("MONGODB_DB") || "yijiex_hris";
  return client.db(dbName);
}
