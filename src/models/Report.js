import mongoose from 'mongoose';

/** Complaint or lost-item report collected through the guided chat flow. */
const reportSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['complaint', 'lost_found'], required: true, index: true },
    refNumber: { type: String, required: true, unique: true, index: true },
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
    name: { type: String, default: '' },
    phone: { type: String, default: '' },
    tripNumber: { type: String, default: '' },
    incidentDate: { type: String, default: '' },
    incidentTime: { type: String, default: '' },
    seat: { type: String, default: '' },
    description: { type: String, default: '' },
    status: {
      type: String,
      enum: ['new', 'in_progress', 'resolved'],
      default: 'new',
      index: true,
    },
    slaHours: { type: Number, default: null },
  },
  { timestamps: true }
);

export const Report = mongoose.models.Report || mongoose.model('Report', reportSchema);
