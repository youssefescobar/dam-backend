/*! Damic portable customer chat widget (guided + free text) */
(function (global) {
  const STYLE_ID = 'damic-chat-widget-css';

  function ensureCss(href) {
    if (document.getElementById(STYLE_ID)) return;
    const link = document.createElement('link');
    link.id = STYLE_ID;
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function mount(options = {}) {
    const apiBase = String(options.apiBase || '').replace(/\/$/, '');
    const mode = options.mode || 'floating';
    const customerName = options.customerName || 'Guest';
    const customerContact = options.customerContact || '';

    if (mode === 'floating') {
      const cssHref =
        options.cssUrl ||
        (apiBase ? apiBase + '/widget/chat-widget.css' : '/widget/chat-widget.css');
      ensureCss(cssHref);
    }

    let conversationId = null;
    let busy = false;

    const root = el('div', 'damic-chat');
    const toggle = el('button', 'damic-chat__toggle', 'Chat');
    toggle.type = 'button';

    const panel = el('div', 'damic-chat__panel');
    panel.hidden = true;

    const header = el('div', 'damic-chat__header');
    header.appendChild(el('strong', null, options.title || 'Damic Assistant'));
    const closeBtn = el('button', 'damic-chat__close', '×');
    closeBtn.type = 'button';
    header.appendChild(closeBtn);

    const messages = el('div', 'damic-chat__messages');
    const optionsRow = el('div', 'damic-chat__options');
    const form = el('form', 'damic-chat__form');
    const input = el('textarea', 'damic-chat__input');
    input.rows = 1;
    input.placeholder = 'Or type a free question…';
    const send = el('button', 'damic-chat__send', 'Send');
    send.type = 'submit';
    form.appendChild(input);
    form.appendChild(send);

    panel.appendChild(header);
    panel.appendChild(messages);
    panel.appendChild(optionsRow);
    panel.appendChild(form);
    root.appendChild(toggle);
    root.appendChild(panel);
    document.body.appendChild(root);

    function addBubble(role, text) {
      const bubble = el('div', 'damic-chat__bubble damic-chat__bubble--' + role);
      bubble.textContent = text;
      messages.appendChild(bubble);
      messages.scrollTop = messages.scrollHeight;
    }

    function renderOptions(list) {
      optionsRow.innerHTML = '';
      (list || []).forEach((opt) => {
        const btn = el('button', 'damic-chat__option', opt.label);
        btn.type = 'button';
        btn.addEventListener('click', () => {
          void sendMessage({ choiceId: opt.id, text: opt.label });
        });
        optionsRow.appendChild(btn);
      });
    }

    async function sendMessage({ text, choiceId }) {
      if (busy) return;
      const display = (text || '').trim();
      if (!display && !choiceId) return;
      busy = true;
      send.disabled = true;
      if (display) addBubble('user', display);
      input.value = '';

      try {
        const res = await fetch(apiBase + '/chat/message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: display || undefined,
            choiceId: choiceId || undefined,
            conversationId: conversationId || undefined,
            customerName,
            customerContact: customerContact || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
        conversationId = data.conversationId || conversationId;
        if (data.answer) addBubble('assistant', data.answer);
        if (data.escalated) {
          addBubble(
            'system',
            data.systemMessage || 'Connecting you with a team member…'
          );
        }
        renderOptions(data.options || []);
      } catch (err) {
        addBubble('system', err.message || 'Something went wrong');
        renderOptions([]);
      } finally {
        busy = false;
        send.disabled = false;
        input.focus();
      }
    }

    function setOpen(open) {
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    toggle.addEventListener('click', () => setOpen(panel.hidden));
    closeBtn.addEventListener('click', () => setOpen(false));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void sendMessage({ text: input.value });
    });

    // Load guided menu
    fetch(apiBase + '/chat/guided')
      .then((r) => r.json())
      .then((data) => {
        addBubble('assistant', data.answer || 'How can we help?');
        renderOptions(data.options || []);
      })
      .catch(() => {
        addBubble('system', 'Chat is temporarily unavailable.');
      });

    return {
      open: () => setOpen(true),
      close: () => setOpen(false),
      destroy: () => root.remove(),
    };
  }

  global.DamicChat = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
