/**
 * Step-by-step forms Durri walks a customer through (English + Arabic).
 * Each answer is stored in conversation.flow.data[key]; the last step creates a Report.
 */

import { formatWhatsApp, normalizeLang, pickText } from './guidedChat.js';

/** Keep codes and numbers left-to-right inside Arabic sentences (LRI … PDI). */
const ltr = (s) => `⁦${s}⁩`;

export const GUIDED_FORMS = {
  complaint: {
    reportType: 'complaint',
    refPrefix: 'CMP',
    label: { en: 'complaint', ar: 'الشكوى' },
    intro: {
      en: 'I’m sorry about that. I’ll log a complaint for you — it takes a few quick questions. Type “cancel” at any time to stop.',
      ar: 'يؤسفني ذلك. سأسجّل شكواك الآن، وتحتاج بضعة أسئلة سريعة. اكتب «إلغاء» في أي وقت للتوقف.',
    },
    steps: [
      {
        key: 'tripNumber',
        prompt: {
          en: 'What is your trip or booking number?',
          ar: 'ما رقم الرحلة أو الحجز؟',
        },
      },
      {
        key: 'incidentDate',
        prompt: {
          en: 'What date did it happen? (e.g. 2026-10-01)',
          ar: 'في أي تاريخ حدث ذلك؟ (مثال: 2026-10-01)',
        },
      },
      {
        key: 'description',
        prompt: { en: 'Please describe what happened.', ar: 'من فضلك صف لي ما حدث.' },
      },
    ],
  },
  lost_found: {
    reportType: 'lost_found',
    refPrefix: 'LF',
    label: { en: 'lost-item report', ar: 'بلاغ المفقودات' },
    intro: {
      en: 'Sorry to hear that — let’s try to get it back to you. A few quick questions. Type “cancel” at any time to stop.',
      ar: 'نأسف لذلك، لنحاول إعادته إليك. بضعة أسئلة سريعة. اكتب «إلغاء» في أي وقت للتوقف.',
    },
    steps: [
      {
        key: 'tripNumber',
        prompt: { en: 'What is the trip or bus number?', ar: 'ما رقم الرحلة أو الحافلة؟' },
      },
      {
        key: 'incidentDate',
        prompt: {
          en: 'What date was the trip? (e.g. 2026-10-01)',
          ar: 'ما تاريخ الرحلة؟ (مثال: 2026-10-01)',
        },
      },
      {
        key: 'incidentTime',
        prompt: { en: 'Roughly what time did you travel?', ar: 'في أي وقت تقريباً كانت الرحلة؟' },
      },
      {
        key: 'seat',
        prompt: {
          en: 'Which seat were you in? (or type “skip”)',
          ar: 'ما رقم مقعدك؟ (أو اكتب «تخطي»)',
        },
      },
      {
        key: 'description',
        prompt: {
          en: 'Please describe the item (colour, brand, anything identifying).',
          ar: 'من فضلك صف الغرض (اللون، الماركة، أي علامة مميزة).',
        },
      },
    ],
  },
};

const CANCEL_RE = /^\s*(cancel|stop|exit|back|never ?mind|إلغاء|الغاء|الغِ|ألغِ|الغي|توقف|رجوع)\s*$/i;
const SKIP_RE = /^\s*(skip|no|none|تخطي|تخطى|لا|لا يوجد|ما اذكر|مو متأكد)\s*$/i;

export const isFlowCancel = (text) => CANCEL_RE.test(String(text || ''));
export const isFlowSkip = (text) => SKIP_RE.test(String(text || ''));

export function getForm(type) {
  return GUIDED_FORMS[type] || null;
}

export const stepPrompt = (step, lang) => pickText(step.prompt, lang);
export const formIntro = (form, lang) => pickText(form.intro, lang);

/** Human-readable reference, e.g. CMP-7F3A9C21. */
export function makeRefNumber(prefix) {
  return `${prefix}-${Math.random().toString(16).slice(2, 10).toUpperCase().padEnd(8, '0')}`;
}

/** Thank-you line shown when a report is logged. */
export function reportDoneText({ form, refNumber, slaHours, whatsapp, lang }) {
  const ar = normalizeLang(lang) === 'ar';
  const wa = whatsapp ? formatWhatsApp(whatsapp) : '';
  const photo = wa
    ? ar
      ? ` إذا كانت لديك صورة، أرسلها على واتساب ${ltr(wa)} مع ذكر هذا الرقم.`
      : ` If you have a photo, send it on WhatsApp (${wa}) quoting this number.`
    : '';
  return ar
    ? `شكراً لك، تم تسجيل ${pickText(form.label, 'ar')} برقم ${ltr(refNumber)}. سيرد عليك فريقنا خلال ${slaHours} ساعة تقريباً على رقم الجوال الذي زوّدتنا به.${photo}`
    : `Thank you — your ${pickText(form.label, 'en')} is logged as ${refNumber}. Our team will respond within about ${slaHours} hours using the phone number you gave us.${photo}`;
}
