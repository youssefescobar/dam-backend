import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },
    sender: {
      type: String,
      enum: ['customer', 'ai', 'admin', 'system'],
      required: true,
    },
    text: { type: String, required: true },
    /** Why Durri replied / escalated (see docs/AI-CHATBOT.md "Reply reasons"); analytics only. */
    reason: { type: String, default: '' },
    /** Guided topic id when a menu/shortcut answer was given. */
    topic: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);