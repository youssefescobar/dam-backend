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
    /** Why Durra AI replied / escalated (see docs/AI-CHATBOT.md "Reply reasons"); analytics only. */
    reason: { type: String, default: '' },
    /** Guided topic id when a menu/shortcut answer was given. */
    topic: { type: String, default: '' },
    /** A file the customer attached (private R2 key + original name); text holds the name. */
    attachment: {
      type: new mongoose.Schema({ key: String, name: String, contentType: String }, { _id: false }),
      default: null,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Chat history / recent turns, and the insights date range (was a full collection scan).
messageSchema.index({ conversationId: 1, createdAt: 1 });
messageSchema.index({ createdAt: 1, sender: 1 });

export const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);