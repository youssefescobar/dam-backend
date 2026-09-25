import mongoose from 'mongoose';

const customerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true, index: true },
    phone: { type: String, required: true, trim: true, index: true },
    /** Denormalized display field (phone preferred). */
    contact: { type: String, required: true, trim: true },
    channel: {
      type: String,
      enum: ['web', 'whatsapp', 'phone', 'other'],
      default: 'web',
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

customerSchema.index({ email: 1, phone: 1 });

export const Customer =
  mongoose.models.Customer || mongoose.model('Customer', customerSchema);

/**
 * Find by email or phone and upsert identity fields.
 * @param {{ name: string, email: string, phone: string, channel?: string }} input
 */
export async function findOrUpsertCustomer(input) {
  const name = String(input.name || '').trim();
  const email = String(input.email || '').trim().toLowerCase();
  const phone = String(input.phone || '').trim();
  if (!name || !email || !phone) {
    const err = new Error('name, email, and phone are required');
    err.status = 400;
    throw err;
  }

  let customer = await Customer.findOne({
    $or: [{ email }, { phone }],
  });

  const contact = phone || email;

  if (!customer) {
    customer = await Customer.create({
      name,
      email,
      phone,
      contact,
      channel: input.channel || 'web',
    });
  } else {
    customer.name = name;
    customer.email = email;
    customer.phone = phone;
    customer.contact = contact;
    if (input.channel) customer.channel = input.channel;
    await customer.save();
  }

  return customer;
}

/** Shape used in admin list/detail responses. */
export function customerPublic(customer) {
  if (!customer) return null;
  return {
    id: customer._id,
    name: customer.name,
    contact: customer.contact || customer.phone || customer.email,
    email: customer.email || null,
    phone: customer.phone || null,
  };
}
