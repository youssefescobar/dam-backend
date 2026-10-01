/**
 * Guided (menu) chat: canned answers + buttons, no LLM required.
 * Menus are bilingual; answers prefer English with Arabic twin available via settings/KB.
 */

export const MAIN_MENU_OPTIONS = [
  { id: 'about', label: 'About the company', labelAr: 'عن الشركة' },
  { id: 'hours', label: 'Business hours', labelAr: 'ساعات العمل' },
  { id: 'airport', label: 'Airport transfers', labelAr: 'نقل المطارات' },
  { id: 'hajj', label: 'Hajj & Umrah', labelAr: 'الحج والعمرة' },
  { id: 'workers', label: 'Worker / corporate transit', labelAr: 'نقل الموظفين' },
  { id: 'school', label: 'School & university', labelAr: 'النقل المدرسي والجامعي' },
  { id: 'tourism', label: 'Tourism & events', labelAr: 'السياحة والفعاليات' },
  { id: 'international', label: 'International routes', labelAr: 'الرحلات الدولية' },
  { id: 'care', label: 'Munawwara Care', labelAr: 'منورة كير' },
  { id: 'quote', label: 'How to get a quote', labelAr: 'طلب عرض سعر' },
  { id: 'complaint', label: 'Make a complaint', labelAr: 'تقديم شكوى' },
  { id: 'lost_found', label: 'Lost an item', labelAr: 'مفقودات' },
  { id: 'human', label: 'Talk to a human', labelAr: 'التحدث مع موظف' },
  { id: 'free_text', label: 'Type my own question', labelAr: 'اكتب سؤالي' },
];

/** @type {Record<string, { answer?: string, escalate?: boolean, freeText?: boolean, options?: 'main' | { id: string, label: string }[] }>} */
export const GUIDED_NODES = {
  about: {
    answer:
      'We’re Durrah Al-Munawwara Transport, a Saudi passenger transport company. We offer Hajj & Umrah, tourism, corporate and student transport, intercity trips, and international routes to Yemen (Marib, Mukalla, Aden), plus fleet management.',
    options: 'main',
  },
  hours: {
    answer:
      'Customer-service hours are set by management (typically Sunday–Thursday). In-progress trip reports and emergencies go to the operations channel on your booking. Ask for current hours if you need them confirmed.',
    options: 'main',
  },
  airport: {
    answer:
      'Yes — airport and city transfers are available. Share flight number, airport/terminal, time, passengers, and luggage for a quote. Meeting point is confirmed with the booking.',
    options: 'main',
  },
  hajj: {
    answer:
      'We provide integrated Hajj & Umrah transport between airports, hotels, Makkah, Madinah, and the Holy Sites. Hajj-season pilgrim transport is contracted via the responsible mission and registered on the electronic path (المسار الإلكتروني) — not as a direct pilgrim-to-company booking. Payment for Hajj contracts goes through that path.',
    options: 'main',
  },
  workers: {
    answer:
      'Our Worker Transfer team runs daily, monthly, or annual employee shuttle contracts with routes and shifts around workplaces and housing — including night and 24-hour designs when contracted.',
    options: 'main',
  },
  school: {
    answer:
      'We offer school and university transport under educational contracts, with route planning, optional supervisors, and tracking according to the contract scope.',
    options: 'main',
  },
  tourism: {
    answer:
      'We provide buses for tourist groups, conferences, events, and private occasions. Share date, city, guest count, pickup points, and destination for a quote. VIP airport options are available by capacity.',
    options: 'main',
  },
  international: {
    answer:
      'We currently operate international transport to Yemen — Marib, Mukalla, and Aden. Share origin, destination, date, and passenger count for availability.',
    options: 'main',
  },
  care: {
    answer:
      'Munawwara Care supports Guests of Rahman with guidance, health information, help requests, location sharing, and hotel/room details within the contracted program scope.',
    options: 'main',
  },
  quote: {
    answer:
      'Happy to help with a quote. Send: name, organization, contact, service type, passenger count, origin, destination, date/time, bus class if known, and any accessibility or luggage notes. A request number is issued after consent; confirmation comes only after an official offer.',
    options: 'main',
  },
  // Handled by the guided form flow in services/chat.js (config/guidedForms.js).
  complaint: { startFlow: 'complaint' },
  lost_found: { startFlow: 'lost_found' },
  cancel_flow: {
    answer: 'No problem — I’ve cancelled that. What else can I help with?',
    options: 'main',
  },
  human: {
    escalate: true,
  },
  free_text: {
    answer: 'Of course. Type your question below and I’ll do my best to help.',
    options: [],
    freeText: true,
  },
};

export function resolveGuidedOptions(spec) {
  if (spec === 'main' || spec == null) return MAIN_MENU_OPTIONS;
  if (Array.isArray(spec)) return spec;
  return MAIN_MENU_OPTIONS;
}

export function getGuidedNode(choiceId) {
  if (!choiceId) return null;
  return GUIDED_NODES[choiceId] || null;
}

export function findChoiceIdByLabel(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;
  const hit = MAIN_MENU_OPTIONS.find(
    (o) =>
      o.label.toLowerCase() === t ||
      (o.labelAr && o.labelAr === text.trim())
  );
  return hit?.id || null;
}

export function getWelcomePayload(settings) {
  return {
    answer: greetingWelcome(settings),
    options: MAIN_MENU_OPTIONS,
    reason: 'guided_welcome',
  };
}

export function greetingWelcome(settings) {
  if (settings?.botGreetingEn) return settings.botGreetingEn;
  return 'Hi, I’m Durri, the Durrah Al-Munawwara Transport assistant. How can I help? Choose booking or quote, trip follow-up, Hajj & Umrah, corporate transport, international, complaint or lost items, or talk to an agent.';
}

/**
 * Apply live settings overrides to guided answers (hours / WhatsApp).
 * @param {string} choiceId
 * @param {object | null} settings
 */
export function applySettingsToGuidedAnswer(choiceId, settings) {
  const node = getGuidedNode(choiceId);
  if (!node?.answer || !settings) return node?.answer;
  if (choiceId === 'hours' && settings.workingHoursEn) {
    return `Our published customer-service hours are: ${settings.workingHoursEn}. In-progress trip reports and emergencies go to the operations channel on your booking.`;
  }
  if (choiceId === 'quote' && settings.whatsappNumber) {
    const wa = formatWhatsApp(settings.whatsappNumber);
    return `${node.answer} You can also reach us on WhatsApp at ${wa}.`;
  }
  return node.answer;
}

function formatWhatsApp(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length >= 12) {
    return `+${digits.slice(0, 3)} ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
  }
  return raw;
}
