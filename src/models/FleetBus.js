import mongoose from 'mongoose';

export const QUOTE_CLASSES = ['vip', 'premium_vip', 'standard', 'coach', 'city_large', 'city', 'employee'];

/** Bus text for one language. */
const localizedSchema = new mongoose.Schema(
  {
    name: { type: String, default: '', trim: true },
    seatsLabel: { type: String, default: '', trim: true },
    summary: { type: String, default: '' },
    amenities: { type: [String], default: [] },
  },
  { _id: false }
);

/** A bus shown in the website fleet, edited by staff in admin. */
const fleetBusSchema = new mongoose.Schema(
  {
    /** The website's bus id. */
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 80, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
    sortOrder: { type: Number, default: 0 },
    published: { type: Boolean, default: true },
    /** false = kept out of the showroom tabs but still usable elsewhere (e.g. hero label). */
    showInShowroom: { type: Boolean, default: true },
    quoteClass: { type: String, enum: QUOTE_CLASSES, default: 'vip' },
    coverImage: { type: String, default: '', trim: true },
    exteriorImages: { type: [String], default: [] },
    interiorImages: { type: [String], default: [] },
    ar: { type: localizedSchema, default: () => ({}) },
    en: { type: localizedSchema, default: () => ({}) },
    fr: { type: localizedSchema, default: () => ({}) },
    id: { type: localizedSchema, default: () => ({}) },
  },
  { timestamps: true }
);

export const FleetBus = mongoose.models.FleetBus || mongoose.model('FleetBus', fleetBusSchema);
