import { ObjectId } from "mongodb";
import { getMongoDb } from "./mongo";
import type { AnalysisRunRecord, SavedAnalysisRun } from "./models";

const RUNS_COLLECTION = "analysis_runs";

interface AnalysisRunDocument extends AnalysisRunRecord {
  _id: ObjectId;
}

function toSavedRun(document: AnalysisRunDocument): SavedAnalysisRun {
  return {
    ...document,
    _id: document._id.toHexString(),
  };
}

export async function createAnalysisRun(run: AnalysisRunRecord): Promise<SavedAnalysisRun> {
  const db = await getMongoDb();
  const result = await db.collection<AnalysisRunRecord>(RUNS_COLLECTION).insertOne(run);
  return {
    ...run,
    _id: result.insertedId.toHexString(),
  };
}

export async function listRecentAnalysisRuns(limit = 12): Promise<SavedAnalysisRun[]> {
  const db = await getMongoDb();
  const documents = await db
    .collection<AnalysisRunDocument>(RUNS_COLLECTION)
    .find({})
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  return documents.map(toSavedRun);
}

export async function listRecentAnalysisRunsByUser(createdBy: string, limit = 12): Promise<SavedAnalysisRun[]> {
  const db = await getMongoDb();
  const documents = await db
    .collection<AnalysisRunDocument>(RUNS_COLLECTION)
    .find({ createdBy })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  return documents.map(toSavedRun);
}

export async function findAnalysisRunById(id: string): Promise<SavedAnalysisRun | null> {
  if (!ObjectId.isValid(id)) {
    return null;
  }

  const db = await getMongoDb();
  const document = await db.collection<AnalysisRunDocument>(RUNS_COLLECTION).findOne({ _id: new ObjectId(id) });
  return document ? toSavedRun(document) : null;
}
