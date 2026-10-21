const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Step-by-step forms Durra AI walks a customer through (English + Arabic).
 * Each answer is stored in conversation.flow.data[key]; the last step creates a Report.
 * A step with `file` asks for an upload (see POST /chat/upload) instead of typed text.
 */

import { normalizeLang, pickText } from './guidedChat.js';

/** Keep codes and numbers left-to-right inside Arabic sentences (LRI … PDI). */
const ltr = (s) => `⁦${s}⁩`;

export const GUIDED_FORMS = {
  complaint: {
    reportType: 'complaint',
    refPrefix: 'CMP',
    label: { en: 'complaint', ar: 'الشكوى' },
    staffTitle: 'New complaint',
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
      {
        key: 'photo',
        file: { accept: ['image/jpeg', 'image/png', 'image/webp'], maxMb: 10, optional: true },
        prompt: {
          en: 'Do you have a photo? Attach it with the paperclip button, or type “skip”.',
          ar: 'هل لديك صورة؟ أرفقها بزر المشبك، أو اكتب «تخطي».',
        },
        hint: {
          en: 'To add a photo, tap the paperclip button. Or type “skip” to finish without one.',
          ar: 'لإضافة صورة اضغط زر المشبك، أو اكتب «تخطي» للإنهاء بدونها.',
        },
      },
    ],
  },
  career: {
    reportType: 'career',
    refPrefix: 'JOB',
    label: { en: 'job application', ar: 'طلب التوظيف' },
    staffTitle: 'New job application',
    intro: {
      en: 'Great, thanks for your interest in joining us. Two quick steps. Type “cancel” at any time to stop.',
      ar: 'رائع، شكراً لاهتمامك بالانضمام إلينا. خطوتان سريعتان. اكتب «إلغاء» في أي وقت للتوقف.',
    },
    steps: [
      {
        key: 'position',
        prompt: {
          en: 'Which job or field are you interested in? (e.g. bus driver, operations, accounting)',
          ar: 'ما الوظيفة أو المجال الذي يهمك؟ (مثال: سائق حافلة، العمليات، المحاسبة)',
        },
      },
      {
        key: 'cv',
        file: { accept: ['application/pdf', DOCX], maxMb: 10 },
        prompt: {
          en: 'Please attach your CV using the paperclip button (PDF or Word, up to 10 MB).',
          ar: 'من فضلك أرفق سيرتك الذاتية بزر المشبك (PDF أو Word، حتى 10 ميجابايت).',
        },
        hint: {
          en: 'I need the CV as a file. Tap the paperclip button to attach a PDF or Word document.',
          ar: 'أحتاج السيرة الذاتية كملف. اضغط زر المشبك لإرفاق ملف PDF أو Word.',
        },
      },
    ],
    done: {
      en: 'Thank you, your application is received as {ref}. Our HR team will contact you on the phone number you gave us if there is a suitable opening.',
      ar: 'شكراً لك، تم استلام طلبك برقم {ref}. سيتواصل معك فريق الموارد البشرية على رقم الجوال الذي زوّدتنا به إذا توفرت فرصة مناسبة.',
    },
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
export function reportDoneText({ form, refNumber, slaHours, lang }) {
  const ar = normalizeLang(lang) === 'ar';
  if (form.done) return pickText(form.done, lang).replace('{ref}', ar ? ltr(refNumber) : refNumber);
  return ar
    ? `شكراً لك، تم تسجيل ${pickText(form.label, 'ar')} برقم ${ltr(refNumber)}. سيرد عليك فريقنا خلال ${slaHours} ساعة تقريباً على رقم الجوال الذي زوّدتنا به.`
    : `Thank you — your ${pickText(form.label, 'en')} is logged as ${refNumber}. Our team will respond within about ${slaHours} hours using the phone number you gave us.`;
}

/** What the website needs to show the attach button for a file step, or null. */
export function stepUpload(step) {
  if (!step?.file) return null;
  return { accept: step.file.accept, maxMb: step.file.maxMb, optional: Boolean(step.file.optional) };
}

/** The form step a conversation is waiting on, or null. */
export function currentStep(conversation) {
  const form = getForm(conversation?.flow?.type);
  return form?.steps[conversation.flow.step] ?? null;
}
