import mongoose from 'mongoose';

/** A customer question Durri could not answer; one row per distinct question + language. */
const unansweredQuestionSchema = new mongoose.Schema(
  {
    /** Lower-cased, whitespace-collapsed text used to group repeats. */
    key: { type: String, required: true },
    question: { type: String, required: true },
    language: { type: String, enum: ['en', 'ar'], default: 'en' },
    /** Latest reason: model_uncertain | empty_kb | llm_failure. */
    reason: { type: String, default: '' },
    count: { type: Number, default: 1 },
    lastAskedAt: { type: Date, default: Date.now },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', default: null },
    status: { type: String, enum: ['open', 'resolved', 'dismissed'], default: 'open', index: true },
  },
  { timestamps: true }
);
unansweredQuestionSchema.index({ key: 1, language: 1 }, { unique: true });

export const UnansweredQuestion =
  mongoose.models.UnansweredQuestion || mongoose.model('UnansweredQuestion', unansweredQuestionSchema);

export async function logUnanswered({ question, language, reason, conversationId }) {
  const text = String(question || '').trim().slice(0, 500);
  if (!text) return;
  await UnansweredQuestion.updateOne(
    { key: text.toLowerCase().replace(/\s+/g, ' '), language },
    {
      $inc: { count: 1 },
      $set: { reason, lastAskedAt: new Date(), conversationId },
      $setOnInsert: { question: text },
    },
    { upsert: true }
  );
}
