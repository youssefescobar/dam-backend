import mongoose from 'mongoose';

const knowledgeBaseEntrySchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

export const KnowledgeBaseEntry =
  mongoose.models.KnowledgeBaseEntry ||
  mongoose.model('KnowledgeBaseEntry', knowledgeBaseEntrySchema);
