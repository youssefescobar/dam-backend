import mongoose from 'mongoose';

const quoteSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true,
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      default: null,
    },
    pickup: { type: String, required: true, trim: true },
    dropoff: { type: String, required: true, trim: true },
    date: { type: Date, required: true },
    vehicleType: { type: String, required: true, trim: true },
    passengers: { type: Number, required: true, min: 1 },
    notes: { type: String, default: '' },
    status: {
      type: String,
      enum: ['new', 'quoted', 'won', 'lost'],
      default: 'new',
      index: true,
    },
    quotedPrice: { type: Number, default: null },
    customerName: { type: String, required: true },
    customerContact: { type: String, required: true },
  },
  { timestamps: true }
);

export const Quote = mongoose.models.Quote || mongoose.model('Quote', quoteSchema);