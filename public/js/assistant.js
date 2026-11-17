import { api } from './api.js';
import { html, mount } from './ui.js';

const CHIPS = ['Lusaka to Livingstone next Friday for 2', 'Hotel in Livingstone this weekend', 'Plan Lusaka to Cape Town 5 Dec for 4 nights under 40k', 'Pay with mobile money?'];

/** Floating assistant. Understands plain sentences, answers common questions and hands back ready-made search links. */
export function initAssistant() {
  const root = document.createElement('div');
  root.id = 'assistant';
  document.body.appendChild(root);
  const log = [{ from: 'bot', text: 'Hi, I am Pulse. Tell me where you want to go and I will set up the search. Try one of these:', actions: [] }];
  let open = false, busy = false;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  const draw = () => {
    mount(root, html`
      ${open ? html`<section class="ai-panel" role="dialog" aria-label="Pulse assistant">
        <header><div><strong>Pulse</strong><span>Your trip assistant</span></div><button type="button" class="ai-x" id="ai-close" aria-label="Close assistant">×</button></header>
        <div class="ai-log" id="ai-log" aria-live="polite">
          ${log.map((m) => html`<div class="ai-msg ${m.from}"><p>${m.text}</p>${m.actions?.length ? html`<div class="ai-actions">${m.actions.map((a) => html`<a href="${a.href}" class="ai-act">${a.label} →</a>`)}</div>` : ''}</div>`)}
          ${busy ? html`<div class="ai-msg bot"><p class="ai-typing"><i></i><i></i><i></i></p></div>` : ''}
          ${log.length === 1 ? html`<div class="ai-chips">${CHIPS.map((c) => html`<button type="button" data-chip="${c}">${c}</button>`)}</div>` : ''}
        </div>
        <form id="ai-form"><input id="ai-input" placeholder="Where to? Ask anything…" autocomplete="off" aria-label="Message">${SR ? html`<button type="button" class="ai-mic" id="ai-mic" aria-label="Speak">🎙</button>` : ''}<button type="submit" aria-label="Send">➤</button></form>
      </section>` : ''}
      <button type="button" class="ai-fab" id="ai-fab" aria-label="${open ? 'Close' : 'Open'} Pulse assistant">${open ? '×' : html`<span>✦</span> Ask Pulse`}</button>`);
    root.querySelector('#ai-fab').addEventListener('click', () => { open = !open; draw(); if (open) root.querySelector('#ai-input')?.focus(); });
    if (!open) return;
    root.querySelector('#ai-close').addEventListener('click', () => { open = false; draw(); });
    const box = root.querySelector('#ai-log'); box.scrollTop = box.scrollHeight;
    root.querySelectorAll('.ai-act').forEach((a) => a.addEventListener('click', () => { open = false; setTimeout(draw, 0); }));
    root.querySelectorAll('[data-chip]').forEach((b) => b.addEventListener('click', () => send(b.dataset.chip)));
    root.querySelector('#ai-form').addEventListener('submit', (e) => { e.preventDefault(); const i = root.querySelector('#ai-input'); const v = i.value.trim(); if (v) { i.value = ''; send(v); } });
    root.querySelector('#ai-mic')?.addEventListener('click', () => {
      const r = new SR(); r.lang = 'en-GB'; r.interimResults = false;
      r.onresult = (ev) => { const v = ev.results[0][0].transcript; send(v); };
      try { r.start(); } catch { /* already listening */ }
    });
  };

  async function send(text) {
    if (busy) return;
    log.push({ from: 'me', text }); busy = true; draw();
    try {
      const r = await api('/ai/chat', { method: 'POST', body: { message: text } });
      log.push({ from: 'bot', text: r.reply, actions: r.actions });
    } catch (e) { log.push({ from: 'bot', text: e.message || 'Something went wrong. Please try again.', actions: [] }); }
    busy = false; draw();
    root.querySelector('#ai-input')?.focus();
  }
  draw();
}
