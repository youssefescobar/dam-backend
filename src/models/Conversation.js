import mongoose from 'mongoose';

const conversationSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['ai_handling', 'needs_human', 'claimed', 'closed'],
      default: 'ai_handling',
      index: true,
    },
    assignedAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
    lastActivityAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    lastCustomerMessageAt: {
      type: Date,
      default: null,
    },
    lastAdminMessageAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

export const Conversation =
  mongoose.models.Conversation || mongoose.model('Conversation', conversationSchema);

/**
 * @param {import('mongoose').Document} conversation
 * @param {'customer' | 'admin' | 'ai' | 'system' | 'claim'} kind
 */
export async function bumpConversationActivity(conversation, kind) {
  const now = new Date();
  conversation.lastActivityAt = now;
  if (kind === 'customer') conversation.lastCustomerMessageAt = now;
  if (kind === 'admin') conversation.lastAdminMessageAt = now;
  await conversation.save();
  return conversation;
}
