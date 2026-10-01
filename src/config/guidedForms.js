/**
 * Step-by-step forms the chat bot walks a customer through.
 * Each answer is stored in conversation.flow.data[key]; the last step creates a Report.
 */

export const GUIDED_FORMS = {
  complaint: {
    reportType: 'complaint',
    refPrefix: 'CMP',
    intro: 'I’m sorry about that. I’ll log a complaint for you — it takes a few quick questions. Type “cancel” at any time to stop.',
    steps: [
      { key: 'tripNumber', prompt: 'What is your trip or booking number?' },
      { key: 'incidentDate', prompt: 'What date did it happen? (e.g. 2026-10-01)' },
      { key: 'description', prompt: 'Please describe what happened.' },
    ],
  },
  lost_found: {
    reportType: 'lost_found',
    refPrefix: 'LF',
    intro: 'Sorry to hear that — let’s try to get it back to you. A few quick questions. Type “cancel” at any time to stop.',
    steps: [
      { key: 'tripNumber', prompt: 'What is the trip or bus number?' },
      { key: 'incidentDate', prompt: 'What date was the trip? (e.g. 2026-10-01)' },
      { key: 'incidentTime', prompt: 'Roughly what time did you travel?' },
      { key: 'seat', prompt: 'Which seat were you in? (or type “skip”)' },
      { key: 'description', prompt: 'Please describe the item (colour, brand, anything identifying).' },
    ],
  },
};

const CANCEL_RE = /^\s*(cancel|stop|exit|back|إلغاء|الغاء|توقف)\s*$/i;
const SKIP_RE = /^\s*(skip|تخطي)\s*$/i;

export const isFlowCancel = (text) => CANCEL_RE.test(String(text || ''));
export const isFlowSkip = (text) => SKIP_RE.test(String(text || ''));

export function getForm(type) {
  return GUIDED_FORMS[type] || null;
}

/** Human-readable reference, e.g. CMP-7F3A9C21. */
export function makeRefNumber(prefix) {
  return `${prefix}-${Math.random().toString(16).slice(2, 10).toUpperCase().padEnd(8, '0')}`;
}
