(() => {
  const css = `
    table.decisions .answer { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; min-width: 15em; }
    table.decisions .answer textarea { align-self: stretch; }
    table.decisions .choices { border: 0; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
    table.decisions .choices legend { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    table.decisions .choice { position: relative; }
    table.decisions .choice input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
    table.decisions .choice span { display: inline-block; padding: 4px 14px; border: 1px solid var(--line-strong, #c4d1e0); border-radius: 999px; font-size: 14px; font-weight: 600; color: var(--ink, #0f1720); background: var(--surface, #ffffff); cursor: pointer; }
    table.decisions .choice input:checked + span { background: var(--accent, #0e7f6f); border-color: var(--accent, #0e7f6f); color: var(--on-accent, #ffffff); }
    table.decisions .choice input[value="Not OK"]:checked + span,
    table.decisions .choice input[value="No"]:checked + span { background: var(--ink-2, #45535f); border-color: var(--ink-2, #45535f); color: var(--surface, #ffffff); }
    table.decisions .choice input:focus-visible + span { outline: 2px solid var(--accent, #0e7f6f); outline-offset: 2px; }
    table.decisions .comment-toggle { align-self: flex-start; border: 0; background: none; padding: 0; font: inherit; font-size: 14px; font-weight: 600; color: var(--accent, #0e7f6f); cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
    table.decisions .comment-toggle:focus-visible { outline: 2px solid var(--accent, #0e7f6f); outline-offset: 2px; }
    table.decisions textarea, .decisions-form textarea { width: 100%; box-sizing: border-box; min-height: 72px; padding: 8px 10px; border: 1px solid var(--line-strong, #c4d1e0); border-radius: var(--radius-sm, 6px); font: inherit; font-size: 14px; line-height: 1.5; color: var(--ink, #0f1720); background: var(--surface, #ffffff); resize: vertical; }
    table.decisions textarea:focus-visible, .decisions-form textarea:focus-visible { outline: 2px solid var(--accent, #0e7f6f); outline-offset: 1px; border-color: var(--accent, #0e7f6f); }
    table.decisions tr.answered td { background: var(--sunken, #f1f6fd); }
    .decisions-form .general { display: flex; flex-direction: column; gap: 8px; max-width: 42em; }
    .decisions-form .general label { font-weight: 600; }
    .decisions-form .submit { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; }
    .decisions-form .copy { border: 0; border-radius: var(--radius-md, 10px); padding: 12px 22px; background: var(--accent, #0e7f6f); color: var(--on-accent, #ffffff); font: inherit; font-weight: 700; font-size: 16px; cursor: pointer; }
    .decisions-form .copy:focus-visible { outline: 2px solid var(--ink, #0f1720); outline-offset: 2px; }
    .decisions-form .copy:disabled { opacity: 0.6; cursor: progress; }
    .decisions-form .copy.secondary { background: var(--surface, #ffffff); color: var(--accent, #0e7f6f); box-shadow: inset 0 0 0 1px var(--line-strong, #c4d1e0); }
    .decisions-form .progress { font-size: 14px; color: var(--ink-2, #45535f); }
    .decisions-form .fallback { min-height: 200px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-ligatures: none; font-size: 13px; }
    @media (max-width: 720px) {
      table.decisions, table.decisions tbody, table.decisions tr, table.decisions td { display: block; width: auto; }
      table.decisions thead { display: none; }
      table.decisions tr { border-bottom: 1px solid var(--line, #e3e9f1); padding: 6px 0; }
      table.decisions td { border: 0; padding: 6px 14px; }
      table.decisions .answer { min-width: 0; }
    }
  `;

  const ASKS = {
    ok: ['OK', 'Not OK'],
    yesno: ['Yes', 'No'],
  };

  const text = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

  function storage(prefix) {
    const read = key => {
      try { return localStorage.getItem(`${prefix}:${key}`) ?? ''; } catch { return ''; }
    };
    const write = (key, value) => {
      try { localStorage.setItem(`${prefix}:${key}`, value); } catch {}
    };
    return { read, write };
  }

  function commentBox(id, key, label, store, alwaysOpen) {
    const area = document.createElement('textarea');
    area.id = `${id}-comment`;
    area.setAttribute('aria-label', label);
    area.placeholder = alwaysOpen ? 'Your answer' : 'Comment (optional)';
    area.value = store.read(`${key}:comment`);
    area.addEventListener('input', () => store.write(`${key}:comment`, area.value));

    if (alwaysOpen || area.value) {
      return { nodes: [area], area };
    }

    area.hidden = true;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'comment-toggle';
    toggle.textContent = 'Add a comment';
    toggle.setAttribute('aria-controls', area.id);
    toggle.addEventListener('click', () => {
      area.hidden = false;
      toggle.hidden = true;
      area.focus();
    });
    return { nodes: [toggle, area], area };
  }

  function enhance(table, tableIndex) {
    const title = table.dataset.decisions || document.title;
    const store = storage(`artifact-decisions:${title}`);
    const scope = `t${tableIndex + 1}`;
    const rows = [];

    const headCells = table.querySelectorAll('thead th');
    if (headCells.length) {
      headCells[headCells.length - 1].textContent = 'Your answer';
    }

    table.querySelectorAll('tbody tr').forEach((tr, index) => {
      const cells = tr.querySelectorAll('td');
      const key = `d-${tr.dataset.decision || index + 1}`;
      const id = `${scope}-${key}`;
      const ask = tr.dataset.ask || 'none';
      const choices = ask === 'choice' ? (tr.dataset.choices || '').split('|').filter(Boolean) : ASKS[ask];
      const decision = text(cells[0]);
      const recommendation = cells.length > 2 ? text(cells[1]) : '';
      const status = text(cells[cells.length - 1].querySelector('.pill'));
      const cell = cells[cells.length - 1];
      const wrap = document.createElement('div');
      wrap.className = 'answer';
      const pill = cell.querySelector('.pill');
      if (pill) wrap.append(pill);
      const row = { tr, decision, recommendation, status, ask, choice: () => '', comment: null };

      if (choices) {
        const fieldset = document.createElement('fieldset');
        fieldset.className = 'choices';
        const legend = document.createElement('legend');
        legend.textContent = decision;
        fieldset.append(legend);
        const saved = store.read(`${key}:choice`);
        choices.forEach((value, i) => {
          const label = document.createElement('label');
          label.className = 'choice';
          const input = document.createElement('input');
          input.type = 'radio';
          input.name = id;
          input.id = `${id}-${i}`;
          input.value = value;
          input.checked = saved === value;
          input.addEventListener('change', () => {
            store.write(`${key}:choice`, value);
            update();
          });
          const span = document.createElement('span');
          span.textContent = value;
          label.append(input, span);
          fieldset.append(label);
        });
        row.choice = () => fieldset.querySelector('input:checked')?.value ?? '';
        wrap.append(fieldset);
      }

      const { nodes, area } = commentBox(id, key, `${ask === 'text' ? 'Answer' : 'Comment'}: ${decision}`, store, ask === 'text');
      area.addEventListener('input', update);
      row.comment = area;
      wrap.append(...nodes);
      cell.append(wrap);
      rows.push(row);
    });

    const form = document.createElement('div');
    form.className = 'decisions-form';
    form.style.cssText = 'display:flex;flex-direction:column;gap:20px;margin-top:24px;';

    const general = document.createElement('div');
    general.className = 'general';
    const generalLabel = document.createElement('label');
    generalLabel.htmlFor = `${scope}-general`;
    generalLabel.textContent = 'Anything else';
    const generalArea = document.createElement('textarea');
    generalArea.id = `${scope}-general`;
    generalArea.placeholder = 'Optional';
    generalArea.value = store.read('general');
    generalArea.addEventListener('input', () => store.write('general', generalArea.value));
    general.append(generalLabel, generalArea);

    const submit = document.createElement('div');
    submit.className = 'submit';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy';
    button.textContent = 'Copy answers for Claude';
    const progress = document.createElement('span');
    progress.className = 'progress';
    progress.setAttribute('aria-live', 'polite');
    const send = document.createElement('button');
    send.type = 'button';
    send.className = 'copy send';
    send.textContent = 'Send to Claude';
    send.hidden = true;
    const sendNote = document.createElement('span');
    sendNote.className = 'progress';
    sendNote.setAttribute('aria-live', 'polite');
    submit.append(send, button, progress, sendNote);

    const fallback = document.createElement('textarea');
    fallback.className = 'fallback';
    fallback.readOnly = true;
    fallback.hidden = true;
    fallback.setAttribute('aria-label', 'Answers to copy');

    form.append(general, submit, fallback);
    (table.closest('.table-wrap') || table).after(form);

    const needsAnswer = row => row.ask !== 'none';
    const isAnswered = row => (row.ask === 'text' ? row.comment.value.trim() !== '' : row.choice() !== '');

    function update() {
      rows.forEach(row => row.tr.classList.toggle('answered', needsAnswer(row) && isAnswered(row)));
      const asked = rows.filter(needsAnswer);
      const done = asked.filter(isAnswered).length;
      progress.textContent = `${done} of ${asked.length} answered`;
    }

    function compose(withRecommendations = true) {
      const lines = [`Decisions: ${title}`, ''];
      rows.forEach((row, i) => {
        lines.push(`${i + 1}. ${row.decision}`);
        if (withRecommendations && row.recommendation) lines.push(`   Recommendation: ${row.recommendation}`);
        if (row.ask === 'none') {
          if (row.status) lines.push(`   Status: ${row.status}`);
        } else if (row.ask !== 'text') {
          lines.push(`   Answer: ${row.choice() || 'No answer'}`);
        }
        const comment = row.comment.value.trim();
        if (row.ask === 'text') {
          lines.push(`   Answer: ${comment || 'No answer'}`);
        } else if (comment) {
          lines.push(`   Comment: ${comment}`);
        }
        lines.push('');
      });
      const extra = generalArea.value.trim();
      if (extra) lines.push('Anything else:', extra, '');
      return lines.join('\n').trimEnd();
    }

    button.addEventListener('click', () => {
      const output = compose();
      const showFallback = () => {
        fallback.value = output;
        fallback.hidden = false;
        fallback.focus();
        fallback.select();
        progress.textContent = 'Copying is blocked here. The answers are selected below; copy them with your keyboard.';
      };
      if (!navigator.clipboard?.writeText) {
        showFallback();
        return;
      }
      navigator.clipboard.writeText(output).then(() => {
        fallback.hidden = true;
        button.textContent = 'Copied';
        setTimeout(() => { button.textContent = 'Copy answers for Claude'; update(); }, 2000);
      }, showFallback);
    });

    const SEND_LIMIT_BYTES = 4096;
    const SEND_OFF_CODES = ['forbidden', 'not_granted', 'capability_disabled', 'capability_removed'];
    let comments = null;
    let sendBlocked = false;

    function showSend(on, reason = '') {
      send.hidden = !on;
      button.classList.toggle('secondary', on);
      sendNote.textContent = reason;
    }

    async function refreshSend() {
      if (!comments || sendBlocked || typeof comments.canSendToClaude !== 'function') {
        showSend(false);
        return;
      }
      let state = 'off';
      try { state = await comments.canSendToClaude(); } catch {}
      const reasons = {
        writers_only: 'Only editors of this page can send answers to Claude. Use Copy.',
        no_session: 'No Claude session is watching this page right now. Use Copy.',
      };
      showSend(state === 'available', reasons[state] || '');
    }

    send.addEventListener('click', async () => {
      const output = compose(false);
      if (new TextEncoder().encode(output).length > SEND_LIMIT_BYTES) {
        sendNote.textContent = 'Too long to send as one comment. Use Copy.';
        return;
      }
      send.disabled = true;
      try {
        const anchor = await comments.anchorFor(table);
        await comments.sendToClaude({ anchor, text: output });
        sendNote.textContent = 'Sent. Claude replies in the comment thread on this table.';
      } catch (error) {
        const code = error?.code;
        if (SEND_OFF_CODES.includes(code)) {
          sendBlocked = true;
          showSend(false, 'Sending from this page is off here. Use Copy.');
        } else if (code === 'claude_unavailable') {
          await refreshSend();
          sendNote.textContent = 'Not sent: no Claude session could take it. Use Copy.';
        } else {
          sendNote.textContent = {
            consent_required: 'Not sent. Allow comments from this page when asked, then press Send again.',
            rate_limited: 'Not sent: too many sends. Wait a minute, then try again.',
            invalid: 'Not sent: the answers could not be posted as a comment. Use Copy.',
          }[code] || 'Sending failed. Check the comment thread before sending again, or use Copy.';
        }
      } finally {
        send.disabled = false;
      }
    });

    if (typeof window.claude?.use === 'function') {
      window.claude.use('comments').then(namespace => {
        comments = namespace;
        refreshSend();
      }, () => {});
      window.addEventListener('focus', refreshSend);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) refreshSend();
      });
    }

    update();
  }

  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  document.querySelectorAll('table[data-decisions]').forEach((table, i) => enhance(table, i));
})();
