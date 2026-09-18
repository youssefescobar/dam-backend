import mongoose from 'mongoose';

const customerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    contact: { type: String, required: true, trim: true },
    channel: {
      type: String,
      enum: ['web', 'whatsapp', 'phone', 'other'],
      default: 'web',
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const Customer = mongoose.models.Customer || mongoose.model('Customer', customerSchema);