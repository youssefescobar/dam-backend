/**
 * Guided (menu) chat for Durri: canned answers + buttons, no LLM required.
 * Everything customer-facing exists in English and Arabic; `lang` picks one.
 */

export const LANGS = ['en', 'ar'];

/** Normalise any input to 'en' | 'ar'. */
export function normalizeLang(lang) {
  return String(lang || '').toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

const ARABIC_LETTERS = /[؀-ۿ]/g;
const LATIN_LETTERS = /[A-Za-z]/g;

/**
 * Language of a message, or null when it is too short or code-like to tell
 * (digits, emoji, a booking reference such as `BK-4821`).
 */
export function detectLang(text) {
  const s = String(text || '');
  const ar = (s.match(ARABIC_LETTERS) || []).length;
  const en = (s.match(LATIN_LETTERS) || []).length;
  if (Math.max(ar, en) < 3) return null;
  return ar >= en ? 'ar' : 'en';
}

/** Pick the string for a language from a `{ en, ar }` pair. */
export const pickText = (pair, lang) => (normalizeLang(lang) === 'ar' ? pair.ar : pair.en);

/** Every guided topic. Used for lookups; only some are shown as menu buttons. */
export const ALL_TOPIC_OPTIONS = [
  { id: 'quote', label: 'Get a quote', labelAr: 'طلب عرض سعر' },
  { id: 'airport', label: 'Airport transfers', labelAr: 'نقل المطارات' },
  { id: 'hajj', label: 'Hajj & Umrah', labelAr: 'الحج والعمرة' },
  { id: 'workers', label: 'Worker / corporate transit', labelAr: 'نقل الموظفين' },
  { id: 'school', label: 'School & university', labelAr: 'النقل المدرسي والجامعي' },
  { id: 'tourism', label: 'Tourism & events', labelAr: 'السياحة والفعاليات' },
  { id: 'international', label: 'International routes', labelAr: 'الرحلات الدولية' },
  { id: 'care', label: 'Munawwara Care', labelAr: 'منورة كير' },
  { id: 'about', label: 'About the company', labelAr: 'عن الشركة' },
  { id: 'hours', label: 'Business hours', labelAr: 'ساعات العمل' },
  { id: 'contact', label: 'Contact us', labelAr: 'تواصل معنا' },
  { id: 'complaint', label: 'Make a complaint', labelAr: 'تقديم شكوى' },
  { id: 'lost_found', label: 'Lost an item', labelAr: 'مفقودات' },
  { id: 'human', label: 'Talk to a human', labelAr: 'التحدث مع موظف' },
];

/** Menu buttons customers see (kept to five). Order matters. Other topics stay reachable by typing. */
const MENU_IDS = ['quote', 'hajj', 'airport', 'complaint', 'human'];
export const MAIN_MENU_OPTIONS = MENU_IDS.map((id) => ALL_TOPIC_OPTIONS.find((o) => o.id === id));

/** Buttons that are not menu topics. `href` options are links the UI opens. */
export const EXTRA_OPTIONS = {
  open_quote: {
    id: 'open_quote',
    label: 'Open the quote form',
    labelAr: 'افتح نموذج طلب العرض',
    href: '/quote',
  },
  cancel_flow: { id: 'cancel_flow', label: 'Cancel', labelAr: 'إلغاء' },
  human: ALL_TOPIC_OPTIONS.find((o) => o.id === 'human'),
  contact: ALL_TOPIC_OPTIONS.find((o) => o.id === 'contact'),
  main_menu: { id: 'main_menu', label: 'Main menu', labelAr: 'القائمة الرئيسية' },
};

/** Turn option records into the shape the UI renders, in one language. */
export function localizeOptions(options, lang) {
  const ar = normalizeLang(lang) === 'ar';
  const seen = new Set();
  return (options || [])
    .filter(Boolean)
    .filter((o) => !seen.has(o.id) && seen.add(o.id))
    .map((o) => {
      const out = { id: o.id, label: ar ? o.labelAr || o.label : o.label };
      if (o.href) out.href = o.href;
      return out;
    });
}

/** Legacy shape (`label` + `labelAr`) for callers that pick the language themselves. */
export const menuOptions = (lang) => localizeOptions(MAIN_MENU_OPTIONS, lang);

/**
 * @typedef {{ en: string, ar: string }} Pair
 * @type {Record<string, { answer?: Pair, escalate?: boolean, freeText?: boolean, startFlow?: string, options?: 'main' | string[] }>}
 */
export const GUIDED_NODES = {
  about: {
    answer: {
      en: 'We’re Durrah Al-Munawwara Transport, a Saudi passenger transport company. We offer Hajj & Umrah, tourism, corporate and student transport, intercity trips, and international routes to Yemen (Marib, Mukalla, Aden), plus fleet management.',
      ar: 'نحن درة المنورة للنقل، شركة سعودية لنقل الركاب. نقدّم نقل الحج والعمرة، والنقل السياحي، ونقل الشركات والطلاب، والرحلات بين المدن، والرحلات الدولية إلى اليمن (مأرب والمكلا وعدن)، إضافةً إلى إدارة الأساطيل.',
    },
    options: 'main',
  },
  hours: {
    answer: {
      en: 'Customer-service hours are set by management (typically Sunday–Thursday). In-progress trip reports and emergencies go to the operations channel on your booking. Ask for current hours if you need them confirmed.',
      ar: 'ساعات خدمة العملاء تحددها الإدارة (عادةً من الأحد إلى الخميس). بلاغات الرحلات الجارية والحالات الطارئة تُرفع عبر قناة العمليات المذكورة في حجزك. اسألني إن أردت تأكيد الساعات الحالية.',
    },
    options: 'main',
  },
  airport: {
    answer: {
      en: 'Yes — airport and city transfers are available. Share flight number, airport/terminal, time, passengers, and luggage for a quote. Meeting point is confirmed with the booking.',
      ar: 'نعم، يتوفر النقل من المطارات وإليها وبين المدن. أرسل رقم الرحلة والمطار/الصالة والوقت وعدد الركاب والأمتعة لنعدّ لك عرض سعر. يُؤكَّد مكان اللقاء مع الحجز.',
    },
    extra: ['open_quote'],
    options: 'main',
  },
  hajj: {
    answer: {
      en: 'We provide integrated Hajj & Umrah transport between airports, hotels, Makkah, Madinah, and the Holy Sites. Hajj-season pilgrim transport is contracted via the responsible mission and registered on the electronic path (المسار الإلكتروني) — not as a direct pilgrim-to-company booking. Payment for Hajj contracts goes through that path.',
      ar: 'نوفّر نقلاً متكاملاً للحج والعمرة بين المطارات والفنادق ومكة والمدينة والمشاعر المقدسة. نقل الحجاج في موسم الحج يُتعاقد عليه عبر البعثة المسؤولة ويُسجَّل في المسار الإلكتروني، وليس كحجز مباشر بين الحاج والشركة، وتتم مدفوعات عقود الحج عبر ذلك المسار.',
    },
    extra: ['open_quote'],
    options: 'main',
  },
  workers: {
    answer: {
      en: 'Our Worker Transfer team runs daily, monthly, or annual employee shuttle contracts with routes and shifts around workplaces and housing — including night and 24-hour designs when contracted.',
      ar: 'يدير فريق نقل العمال عقود نقل الموظفين اليومية أو الشهرية أو السنوية بمسارات ومناوبات حول مواقع العمل والسكن، بما في ذلك التشغيل الليلي وعلى مدار 24 ساعة عند التعاقد.',
    },
    extra: ['open_quote'],
    options: 'main',
  },
  school: {
    answer: {
      en: 'We offer school and university transport under educational contracts, with route planning, optional supervisors, and tracking according to the contract scope.',
      ar: 'نوفّر النقل المدرسي والجامعي بعقود تعليمية، مع تخطيط المسارات ومشرفين اختياريين وتتبّع بحسب نطاق العقد.',
    },
    extra: ['open_quote'],
    options: 'main',
  },
  tourism: {
    answer: {
      en: 'We provide buses for tourist groups, conferences, events, and private occasions. Share date, city, guest count, pickup points, and destination for a quote. VIP airport options are available by capacity.',
      ar: 'نوفّر حافلات للمجموعات السياحية والمؤتمرات والفعاليات والمناسبات الخاصة. أرسل التاريخ والمدينة وعدد الضيوف ونقاط الاستلام والوجهة لنعدّ لك عرضاً. تتوفر خيارات VIP للمطارات بحسب السعة.',
    },
    extra: ['open_quote'],
    options: 'main',
  },
  international: {
    answer: {
      en: 'We currently operate international transport to Yemen — Marib, Mukalla, and Aden. Share origin, destination, date, and passenger count for availability.',
      ar: 'ننفّذ حالياً رحلات دولية إلى اليمن: مأرب والمكلا وعدن. أرسل نقطة الانطلاق والوجهة والتاريخ وعدد الركاب لنفيدك بالتوفر.',
    },
    extra: ['open_quote'],
    options: 'main',
  },
  care: {
    answer: {
      en: 'Munawwara Care supports Guests of Rahman with guidance, health information, help requests, location sharing, and hotel/room details within the contracted program scope.',
      ar: 'تدعم «منورة كير» ضيوف الرحمن بالإرشاد والمعلومات الصحية وطلبات المساعدة ومشاركة الموقع وبيانات الفندق والغرفة ضمن نطاق البرنامج المتعاقد عليه.',
    },
    options: 'main',
  },
  quote: {
    answer: {
      en: 'Happy to help with a quote. The quickest way is the quote form: pick your trip type, see the route on the map, choose date and passengers, and you get a request number right away. A request is not a booking until an official offer is issued.',
      ar: 'يسعدني مساعدتك في عرض السعر. أسرع طريقة هي نموذج طلب العرض: تختار نوع الرحلة وترى المسار على الخريطة، ثم تحدد الموعد وعدد الركاب، ويصلك رقم الطلب مباشرة. لا يُعد الطلب حجزاً مؤكداً قبل صدور عرض رسمي.',
    },
    extra: ['open_quote'],
    options: 'main',
  },
  contact: {
    // Built from live settings in contactAnswer(); this is only the fallback.
    answer: {
      en: 'You can reach our team through the quote form, WhatsApp, or by phone — pick what suits you.',
      ar: 'يمكنك التواصل مع فريقنا عبر نموذج طلب العرض أو واتساب أو الهاتف، اختر ما يناسبك.',
    },
    extra: ['open_quote'],
    options: 'main',
  },
  // Handled by the guided form flow in services/chat.js (config/guidedForms.js).
  complaint: { startFlow: 'complaint' },
  lost_found: { startFlow: 'lost_found' },
  cancel_flow: {
    answer: {
      en: 'No problem — I’ve cancelled that. What else can I help with?',
      ar: 'لا مشكلة، تم الإلغاء. بماذا أستطيع مساعدتك أيضاً؟',
    },
    options: 'main',
  },
  main_menu: {
    answer: {
      en: 'Sure — here’s what I can help with.',
      ar: 'بكل سرور، هذه المواضيع التي أستطيع مساعدتك بها.',
    },
    options: 'main',
  },
  human: {
    escalate: true,
  },
  free_text: {
    answer: {
      en: 'Of course. Type your question below and I’ll do my best to help.',
      ar: 'تفضّل، اكتب سؤالك في الأسفل وسأبذل جهدي لمساعدتك.',
    },
    options: [],
    freeText: true,
  },
};

/** Resolve a node's follow-up buttons (extras first, then the menu). */
export function resolveGuidedOptions(node, lang) {
  if (!node || node.options === undefined || node.options === 'main') {
    const extras = (node?.extra || []).map((id) => EXTRA_OPTIONS[id]);
    return localizeOptions([...extras, ...MAIN_MENU_OPTIONS], lang);
  }
  if (Array.isArray(node.options)) return localizeOptions(node.options, lang);
  return menuOptions(lang);
}

export function getGuidedNode(choiceId) {
  if (!choiceId) return null;
  return GUIDED_NODES[choiceId] || null;
}

export function findChoiceIdByLabel(text) {
  const raw = String(text || '').trim();
  const t = raw.toLowerCase();
  if (!t) return null;
  const all = [...ALL_TOPIC_OPTIONS, EXTRA_OPTIONS.main_menu, EXTRA_OPTIONS.cancel_flow];
  const hit = all.find((o) => o.label.toLowerCase() === t || (o.labelAr && o.labelAr === raw));
  return hit?.id || null;
}

/* ---------- Intent shortcuts (so key flows work even with no LLM) ---------- */

const INTENTS = [
  {
    id: 'lost_found',
    // A physical item left/lost on a trip. "phone number" and generic words are excluded
    // so "I left my phone number in the form" or "نسيت أن أسأل عن شيء" don't start a report.
    re: /\b(lost|left|forgot|forgotten|misplaced)\b[^.!?\n]{0,30}\b(bag|bags|backpack|suitcase|phone(?!\s*(number|no\b|#))|wallet|luggage|passport|laptop|keys?|jacket|glasses)\b|\blost (and|&) found\b|(نسيت|ضاع|ضاعت|ضاع مني|فقدت|ضيعت)\s+(\S+\s+){0,2}(حقيبة|حقيبتي|شنطة|شنطتي|جوال|جوالي|هاتف|هاتفي|محفظة|محفظتي|جواز|جوازي|نظارة|نظارتي|مفاتيح|مفاتيحي|أغراضي|اغراضي)|مفقودات/i,
  },
  {
    id: 'complaint',
    // Explicit complaint words only; mood words ("terrible", "unhappy") are left to the LLM.
    re: /\b(complain\w*|complaint)\b|شكوى|أشتكي|اشتكي|اشتكى|أقدم شكوى/i,
  },
  {
    id: 'quote',
    // Only explicit quote requests — price questions go to the knowledge base / LLM.
    re: /\b(get|request|need|want)\s+(a\s+)?(quote|quotation)\b|^\s*(a\s+)?quote\s*\??\s*$|\bquotation\b|عرض\s*سعر|طلب\s*عرض/i,
  },
  {
    id: 'hours',
    re: /\b(opening hours|working hours|business hours|what time (do|are) you (open|close)|when (do|are) you (open|close))\b|ساعات (العمل|الدوام)|متى (تفتحون|تفتح|تغلقون|الدوام)|اوقات الدوام|أوقات الدوام/i,
  },
  {
    id: 'contact',
    // Asking for *our* details. A bare "phone number" is not enough (customers mention their own).
    re: /\b((your|the company'?s?)\s+(phone|contact|mobile)\s*(number|details|no\.?)|what('?s| is) your (phone |contact )?number|contact (you|us|number|details)|how (do|can) i (contact|reach) (you|us)|whatsapp|your email|where are you|your address|location of (the )?office)\b|(رقم|ارقام|أرقام)\s+(الهاتف|التواصل|الجوال|واتساب)\s*(الخاص بكم|حقكم|عندكم)|واتساب|وين مقركم|عنوانكم|كيف أتواصل|كيف اتواصل/i,
  },
];

/** Cheap keyword router for short messages. Returns a choice id or null. */
export function detectIntent(text) {
  const s = String(text || '').trim();
  if (!s || s.length > 80) return null;
  for (const intent of INTENTS) {
    if (intent.re.test(s)) return intent.id;
  }
  return null;
}

/* ---------- Greetings ---------- */

/**
 * The old stock greetings were stored in the database as editable "defaults". If the
 * saved text is still one of those, ignore it so Durri's greeting shows without a manual
 * Settings edit. Anything staff wrote themselves is kept.
 */
const isLegacyGreeting = (text) =>
  /Choose booking or quote, trip follow-up/i.test(text) || /يمكنك اختيار حجز أو عرض سعر، متابعة رحلة/.test(text);

export function greetingWelcome(settings, lang) {
  const ar = normalizeLang(lang) === 'ar';
  const saved = ar ? settings?.botGreetingAr : settings?.botGreetingEn;
  if (saved && !isLegacyGreeting(saved)) return saved;
  return ar
    ? 'أهلاً بك، أنا دُرّي مساعد درة المنورة للنقل. كيف أستطيع مساعدتك؟ اختر موضوعاً من الأسفل أو اكتب سؤالك.'
    : 'Hi, I’m Durri, the Durrah Al-Munawwara Transport assistant. How can I help? Pick a topic below or just type your question.';
}

export function getWelcomePayload(settings, lang) {
  return {
    answer: greetingWelcome(settings, lang),
    options: menuOptions(lang),
    reason: 'guided_welcome',
  };
}

/* ---------- Settings-backed answers ---------- */

export function formatWhatsApp(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length >= 12) {
    return `+${digits.slice(0, 3)} ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
  }
  return raw;
}

function contactAnswer(settings, lang) {
  const ar = normalizeLang(lang) === 'ar';
  const lines = [];
  const phones = (settings?.phones || []).filter(Boolean);
  if (phones.length) lines.push(`${ar ? 'الهاتف' : 'Phone'}: ${phones.join(' / ')}`);
  if (settings?.whatsappNumber) {
    lines.push(`${ar ? 'واتساب' : 'WhatsApp'}: ${formatWhatsApp(settings.whatsappNumber)}`);
  }
  if (settings?.email) lines.push(`${ar ? 'البريد' : 'Email'}: ${settings.email}`);
  const address = ar ? settings?.addressAr : settings?.addressEn;
  if (address) lines.push(`${ar ? 'العنوان' : 'Address'}: ${address}`);
  const hours = ar ? settings?.workingHoursAr : settings?.workingHoursEn;
  if (hours) lines.push(`${ar ? 'ساعات العمل' : 'Hours'}: ${hours}`);
  if (!lines.length) return null;
  const intro = ar ? 'يسعدنا تواصلك معنا:' : 'Here’s how to reach us:';
  return `${intro}\n${lines.join('\n')}`;
}

/**
 * Final answer text for a guided node, with live settings applied.
 * @param {string} choiceId
 * @param {object | null} settings
 * @param {string} [lang]
 */
export function guidedAnswerText(choiceId, settings, lang) {
  const node = getGuidedNode(choiceId);
  if (!node?.answer) return '';
  const ar = normalizeLang(lang) === 'ar';
  const base = pickText(node.answer, lang);
  if (!settings) return base;

  if (choiceId === 'contact') return contactAnswer(settings, lang) || base;

  if (choiceId === 'hours') {
    const hours = ar ? settings.workingHoursAr : settings.workingHoursEn;
    if (hours) {
      return ar
        ? `ساعات خدمة العملاء المعتمدة: ${hours}. بلاغات الرحلات الجارية والحالات الطارئة تُرفع عبر قناة العمليات المذكورة في حجزك.`
        : `Our published customer-service hours are: ${hours}. In-progress trip reports and emergencies go to the operations channel on your booking.`;
    }
  }

  if (choiceId === 'quote' && settings.whatsappNumber) {
    const wa = formatWhatsApp(settings.whatsappNumber);
    return ar ? `${base} ويمكنك أيضاً مراسلتنا على واتساب: ${wa}.` : `${base} You can also reach us on WhatsApp at ${wa}.`;
  }
  return base;
}

/** @deprecated kept for older imports; prefer guidedAnswerText. */
export const applySettingsToGuidedAnswer = (choiceId, settings, lang = 'en') =>
  guidedAnswerText(choiceId, settings, lang);

/* ---------- Canned system replies ---------- */

export const REPLIES = {
  escalated: {
    en: 'I’m connecting you with a teammate now. Someone will be with you shortly.',
    ar: 'أحوّلك الآن إلى أحد أعضاء الفريق، وسيكون معك بعد قليل.',
  },
  escalatedSafety: {
    en: 'I’m getting a teammate for you right now. If anyone is in danger, please call emergency services on 911 first.',
    ar: 'أستدعي لك أحد أعضاء الفريق الآن. وإذا كان أحد في خطر، فاتصل بالطوارئ على 911 أولاً.',
  },
  notSure: {
    en: 'I couldn’t find a confirmed answer to that. I can connect you with our team, or you can pick a topic below.',
    ar: 'لم أجد إجابة مؤكدة لسؤالك. يمكنني تحويلك إلى فريقنا، أو يمكنك اختيار أحد المواضيع أدناه.',
  },
  emptyKb: {
    en: 'I don’t have that in my knowledge base yet. Pick an option below, or ask to talk to a human.',
    ar: 'لا تتوفر لدي هذه المعلومة حالياً. اختر أحد الخيارات أدناه، أو اطلب التحدث مع موظف.',
  },
  llmDown: {
    en: 'Sorry, I’m a bit stuck right now. Try a menu option, wait a moment, or ask for a human.',
    ar: 'عذراً، أواجه مشكلة مؤقتة. جرّب أحد خيارات القائمة، أو انتظر قليلاً، أو اطلب التحدث مع موظف.',
  },
  thanks: {
    en: 'You’re welcome! Anything else I can help with?',
    ar: 'العفو! هل هناك شيء آخر أستطيع مساعدتك به؟',
  },
  bye: {
    en: 'Take care. Message me anytime.',
    ar: 'في أمان الله. راسلني متى شئت.',
  },
  humanBusy: {
    en: 'A teammate is already on the way. You can keep typing here and they will see everything.',
    ar: 'أحد أعضاء الفريق في الطريق إليك. يمكنك الاستمرار بالكتابة هنا وسيطّلع على كل شيء.',
  },
  // Office-hours / queue notices appended to the handover message.
  // TODO(native review): Arabic wording below is simple on purpose; have a native speaker check it.
  offlineHours: {
    en: 'Our team is offline right now, so a reply may take a while. They will be back {when}.',
    ar: 'فريقنا غير متواجد الآن، وقد يتأخر الرد. سيعودون {when}.',
  },
  offlineQueued: {
    en: 'No one is online at the moment. Your message is saved and the first available teammate will reply.',
    ar: 'لا يوجد أحد متصل حالياً. رسالتك محفوظة وسيرد عليك أول موظف متاح.',
  },
  rateLimited: {
    en: 'You are sending messages very fast. Please wait a moment and try again.',
    ar: 'ترسل رسائل بسرعة كبيرة. يرجى الانتظار قليلاً ثم المحاولة مرة أخرى.',
  },
};
