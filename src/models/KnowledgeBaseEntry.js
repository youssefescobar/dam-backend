import mongoose from 'mongoose';

const chunkSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    embedding: { type: [Number], default: [] },
  },
  { _id: false }
);

const knowledgeBaseEntrySchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true },
    chunks: { type: [chunkSchema], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

export const KnowledgeBaseEntry =
  mongoose.models.KnowledgeBaseEntry ||
  mongoose.model('KnowledgeBaseEntry', knowledgeBaseEntrySchema);