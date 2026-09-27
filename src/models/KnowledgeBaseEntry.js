import mongoose from 'mongoose';

const knowledgeBaseEntrySchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true },
    sourceId: { type: String, default: null, trim: true, index: true },
    intent: { type: String, default: '', trim: true, index: true },
    category: { type: String, default: '', trim: true, index: true },
    locale: {
      type: String,
      enum: ['en', 'ar', ''],
      default: 'en',
      index: true,
    },
    escalate: { type: Boolean, default: false, index: true },
    requiresLiveData: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

knowledgeBaseEntrySchema.index({ locale: 1, title: 1 });

export const KnowledgeBaseEntry =
  mongoose.models.KnowledgeBaseEntry ||
  mongoose.model('KnowledgeBaseEntry', knowledgeBaseEntrySchema);
