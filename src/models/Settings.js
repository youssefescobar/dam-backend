import mongoose from 'mongoose';

/**
 * Singleton company settings used by the bot and (optionally) the marketing site.
 * Document id is always `company`.
 */
const settingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'company' },
    legalNameAr: { type: String, default: 'شركة درة المنورة للنقل' },
    legalNameEn: { type: String, default: 'Durrah Al-Munawwara Transport' },
    email: { type: String, default: 'info@munawwara.com' },
    phones: { type: [String], default: ['+966504352314', '+966596610097'] },
    whatsappNumber: { type: String, default: '966556616713' },
    addressAr: {
      type: String,
      default:
        'المملكة العربية السعودية، جدة — طريق المدينة المنورة، مبنى الوصال، الدور الرابع، مكتب 408',
    },
    addressEn: {
      type: String,
      default:
        'KSA, Jeddah — Almadinah Almunawarah Rd, Al Wessal Building, 4th floor, Office 408',
    },
    workingHoursAr: {
      type: String,
      default: 'الأحد – الخميس، ٩ ص – ٥ م',
    },
    workingHoursEn: {
      type: String,
      default: 'Sunday – Thursday, 9 AM – 5 PM',
    },
    fleetSizeNote: {
      type: String,
      default:
        'Large fleet; more than 1,300 buses registered with the General Cars Syndicate in Makkah (confirm before publishing).',
    },
    baggagePolicy: {
      type: String,
      default:
        'Baggage allowance varies by route, ticket, and bus type. Confirm the current booking policy before payment.',
    },
    cancellationPolicy: {
      type: String,
      default:
        'Cancellation and refund terms vary by service type, timing, and contract. Show the policy tied to the booking before payment; do not invent fixed percentages.',
    },
    childFareNote: {
      type: String,
      default:
        'Child and infant fares follow ticket and route policy from the booking system.',
    },
    quoteSlaHours: { type: Number, default: 24 },
    complaintSlaHours: { type: Number, default: 48 },
    botGreetingEn: {
      type: String,
      default:
        'Welcome to Durrah Al-Munawwara Transport. How can I help? Choose booking or quote, trip follow-up, Hajj & Umrah, corporate transport, international, complaint or lost items, or talk to an agent.',
    },
    botGreetingAr: {
      type: String,
      default:
        'أهلاً بك في درة المنورة للنقل. كيف أستطيع مساعدتك؟ يمكنك اختيار حجز أو عرض سعر، متابعة رحلة، الحج والعمرة، نقل الشركات، النقل الدولي، شكوى أو مفقودات، أو التحدث مع موظف.',
    },
    botClosingEn: {
      type: String,
      default:
        'Your request was logged as [request number]. Please review the summary and confirm your contact number. You will receive an update via [channel] within [approved SLA].',
    },
    botClosingAr: {
      type: String,
      default:
        'تم تسجيل طلبك برقم [رقم الطلب]. يرجى مراجعة الملخص والتأكد من صحة رقم التواصل. سيصلك التحديث عبر [القناة] خلال [زمن الخدمة المعتمد].',
    },
  },
  { timestamps: true }
);

export const Settings =
  mongoose.models.Settings || mongoose.model('Settings', settingsSchema);

/**
 * @returns {Promise<import('mongoose').Document>}
 */
export async function getCompanySettings() {
  let doc = await Settings.findById('company');
  if (!doc) {
    doc = await Settings.create({ _id: 'company' });
  }
  return doc;
}
