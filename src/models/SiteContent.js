import mongoose from 'mongoose';

export const CONTENT_KINDS = ['news', 'testimonial'];

/** Text for one language. Which fields matter depends on `kind`. */
const localizedSchema = new mongoose.Schema(
  {
    // news: title, excerpt, body · testimonial: quote, name, role
    title: { type: String, default: '', trim: true },
    excerpt: { type: String, default: '' },
    body: { type: String, default: '' },
    quote: { type: String, default: '' },
    name: { type: String, default: '', trim: true },
    role: { type: String, default: '', trim: true },
  },
  { _id: false }
);

/** Website content staff edit in admin: news posts and testimonials. */
const siteContentSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: CONTENT_KINDS, required: true, index: true },
    published: { type: Boolean, default: false, index: true },
    /** News only: URL path segment, unique among news. */
    slug: { type: String, default: '', trim: true, lowercase: true },
    /** News cover or testimonial avatar (absolute URL or site path). */
    image: { type: String, default: '', trim: true },
    /** News only: images/videos in display order; media[0] is mirrored into `image`. */
    media: { type: [String], default: [] },
    publishedAt: { type: Date, default: null },
    sortOrder: { type: Number, default: 0 },
    en: { type: localizedSchema, default: () => ({}) },
    ar: { type: localizedSchema, default: () => ({}) },
  },
  { timestamps: true }
);

siteContentSchema.index(
  { kind: 1, slug: 1 },
  { unique: true, partialFilterExpression: { kind: 'news', slug: { $gt: '' } } }
);

export const SiteContent =
  mongoose.models.SiteContent || mongoose.model('SiteContent', siteContentSchema);
