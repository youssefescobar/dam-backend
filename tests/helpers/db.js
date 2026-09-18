import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../../src/config/db.js';

/** @type {MongoMemoryServer | null} */
let memoryServer = null;

export async function startTestDb() {
  memoryServer = await MongoMemoryServer.create();
  const uri = memoryServer.getUri();
  process.env.MONGO_URI = uri;
  await connectDb(uri);
  return uri;
}

export async function stopTestDb() {
  await disconnectDb();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}

export async function clearDb() {
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
}