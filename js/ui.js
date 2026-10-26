import { store, uid, PALETTE } from './store.js';
import { overlappingPersonIds, dailyAwayMap } from './overlaps.js';
import { buildICS, downloadICS } from './ics.js';
import * as drive from './google.js';
import * as sync from './sync.js';

const KIND_LABELS = { vacation: 'Отпуск', holiday: 'Каникулы', event: 'Праздник', other: 'Другое' };
const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WEEKDAYS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

let cfg = null;
let root = null;
let activeTab = 'periods';
const today = new Date();
let cursor = { y: today.getFullYear(), m: today.getMonth() };
let detailPeriodId = null;
let exportIncluded = null;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function isoOf(y, m, d) {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}

function fmtRu(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS_RU[m - 1].toLowerCase()} ${y}`;
}

function toast(msg, isError = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' toast-error' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

function activeGroup() {
  const id = store.state.ui.activeGroupId;
  return id ? store.state.groups[id] : null;
}

function currentMemberIds() {
  const g = activeGroup();
  return g ? g.memberIds : [store.state.me];
}

function currentPeriods() {
  const g = activeGroup();
  return g ? store.periodsForGroup(g.id) : store.periodsForPerson(store.state.me);
}

export async function mountApp(appConfig) {
  cfg = appConfig;
  root = document.getElementById('app');
  store.subscribe(render);
  handleInviteHash();
  render();
}

function handleInviteHash() {
  const m = location.hash.match(/invite=([^&]+)&name=([^&]+)/);
  if (!m) return;
  const folderId = decodeURIComponent(m[1]);
  const name = decodeURIComponent(m[2]);
  window.__pendingInvite = { folderId, name };
}

function render() {
  const configured = drive.isConfigured(cfg);
  const signedIn = drive.isSignedIn();
  const invite = window.__pendingInvite;

  root.innerHTML = `
    <header class="app-header">
      <div class="brand">🏖️ Отпуска и каникулы</div>
      <div class="account">
        ${
          !configured
            ? `<span class="pill pill-muted">Локальный режим (без Google)</span>`
            : signedIn
            ? `<span class="pill pill-ok">В сети: ${esc(store.myPerson().email || store.myPerson().name)}</span>
               <button class="btn btn-ghost" data-action="sign-out">Выйти</button>`
            : `<button class="btn btn-primary" data-action="sign-in">Войти через Google</button>`
        }
      </div>
    </header>

    ${invite ? renderInviteBanner(invite) : ''}

    <nav class="group-chips">
      <button class="chip ${!store.state.ui.activeGroupId ? 'chip-active' : ''}" data-action="select-group" data-group="">Личное</button>
      ${Object.values(store.state.groups)
        .map(
          (g) =>
            `<button class="chip ${store.state.ui.activeGroupId === g.id ? 'chip-active' : ''}" data-action="select-group" data-group="${g.id}">${esc(g.name)}</button>`
        )
        .join('')}
      <button class="chip chip-add" data-action="add-group">+ Группа</button>
    </nav>

    <nav class="tabs">
      ${['periods', 'timeline', 'access', 'export']
        .map((t) => `<button class="tab ${activeTab === t ? 'tab-active' : ''}" data-action="tab" data-tab="${t}">${tabLabel(t)}</button>`)
        .join('')}
    </nav>

    <main class="tab-panel">
      ${activeTab === 'periods' ? renderPeriodsTab() : ''}
      ${activeTab === 'timeline' ? renderTimelineTab() : ''}
      ${activeTab === 'access' ? renderAccessTab(configured, signedIn) : ''}
      ${activeTab === 'export' ? renderExportTab(signedIn) : ''}
    </main>
  `;

  wireEvents();
}

function tabLabel(t) {
  return { periods: 'Мои периоды', timeline: 'Таймлайн', access: 'Участники и доступ', export: 'Экспорт' }[t];
}

function renderInviteBanner(invite) {
  return `
    <div class="banner">
      <span>Вас пригласили в группу «${esc(invite.name)}». Войдите через Google и подтвердите доступ к папке.</span>
      <button class="btn btn-primary" data-action="accept-invite">Принять приглашение</button>
      <button class="btn btn-ghost" data-action="dismiss-invite">Скрыть</button>
    </div>
  `;
}

// ---------- Мои периоды ----------
function renderPeriodsTab() {
  const me = store.myPerson();
  const mine = store.periodsForPerson(me.id).sort((a, b) => a.start.localeCompare(b.start));
  const allPeriods = Object.values(store.state.periods);
  return `
    <div class="toolbar">
      <button class="btn btn-primary" data-action="add-period">+ Добавить период</button>
    </div>
    <div class="period-list">
      ${
        mine.length
          ? mine.map((p) => renderPeriodCard(p, allPeriods)).join('')
          : `<p class="empty">Пока нет ни одного периода. Добавьте отпуск, каникулы или праздник.</p>`
      }
    </div>
  `;
}

function renderPeriodCard(p, allPeriods) {
  const overlapIds = overlappingPersonIds(p, allPeriods);
  const overlapNames = [...overlapIds].map((id) => store.state.people[id]?.name).filter(Boolean);
  const color = p.color || store.myPerson().color;
  return `
    <div class="period-card" style="border-left-color:${color}">
      <div class="period-card-head">
        <strong>${esc(p.title)}</strong>
        <span class="badge">${KIND_LABELS[p.kind] || 'Другое'}</span>
      </div>
      <div class="period-dates">${fmtRu(p.start)} — ${fmtRu(p.end)}</div>
      ${p.notes ? `<div class="period-notes">${esc(p.notes)}</div>` : ''}
      ${
        p.plans?.length
          ? `<ul class="plan-list">${p.plans.map((pl) => `<li><b>${esc(pl.date ? fmtRu(pl.date) : '')}</b> ${esc(pl.title)}${pl.note ? ' — ' + esc(pl.note) : ''}</li>`).join('')}</ul>`
          : ''
      }
      ${overlapNames.length ? `<div class="overlap-note">⚠ пересекается с: ${esc(overlapNames.join(', '))}</div>` : ''}
      <div class="period-actions">
        <button class="btn btn-ghost" data-action="edit-period" data-id="${p.id}">Изменить</button>
        <button class="btn btn-ghost btn-danger" data-action="delete-period" data-id="${p.id}">Удалить</button>
      </div>
    </div>
  `;
}

// ---------- Таймлайн ----------
function renderTimelineTab() {
  const memberIds = currentMemberIds();
  const periods = currentPeriods();
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const startISO = isoOf(cursor.y, cursor.m, 1);
  const endISO = isoOf(cursor.y, cursor.m, daysInMonth);
  const away = dailyAwayMap(periods, startISO, endISO);
  const gridCols = `repeat(${daysInMonth}, minmax(22px, 1fr))`;

  const dayHeaders = Array.from({ length: daysInMonth }, (_, i) => {
    const d = i + 1;
    const wd = new Date(cursor.y, cursor.m, d).getDay();
    const weekend = wd === 0 || wd === 6;
    return `<div class="day-cell ${weekend ? 'weekend' : ''}">${d}</div>`;
  }).join('');

  const heatCells = Array.from({ length: daysInMonth }, (_, i) => {
    const iso = isoOf(cursor.y, cursor.m, i + 1);
    const n = away.get(iso)?.size || 0;
    const lvl = n === 0 ? '' : n === 1 ? 'lvl1' : n === 2 ? 'lvl2' : 'lvl3';
    return `<div class="heat-cell ${lvl}" title="${n} чел. в отъезде">${n > 1 ? n : ''}</div>`;
  }).join('');

  const rows = memberIds
    .map((pid) => {
      const person = store.state.people[pid];
      if (!person) return '';
      const bars = periods
        .filter((p) => p.personId === pid && p.start <= endISO && p.end >= startISO)
        .map((p) => {
          const s = p.start < startISO ? 1 : Number(p.start.slice(8, 10));
          const e = p.end > endISO ? daysInMonth : Number(p.end.slice(8, 10));
          const overlap = overlappingPersonIds(p, periods).size > 0;
          return `<div class="timeline-bar ${overlap ? 'overlap' : ''}" style="grid-column:${s} / ${e + 1};background:${p.color || person.color}" data-action="show-period" data-id="${p.id}">${esc(p.title)}</div>`;
        })
        .join('');
      return `
        <div class="timeline-row">
          <div class="row-label"><span class="dot" style="background:${person.color}"></span>${esc(person.name)}</div>
          <div class="row-grid" style="grid-template-columns:${gridCols}">${bars}</div>
        </div>
      `;
    })
    .join('');

  const detail = detailPeriodId ? renderDetailPanel(detailPeriodId, periods) : '';

  return `
    <div class="toolbar">
      <button class="btn btn-ghost" data-action="prev-month">←</button>
      <strong>${MONTHS_RU[cursor.m]} ${cursor.y}</strong>
      <button class="btn btn-ghost" data-action="next-month">→</button>
    </div>
    <div class="timeline" style="--cols:${daysInMonth}">
      <div class="timeline-row timeline-head">
        <div class="row-label">Пересечения</div>
        <div class="row-grid heat-row" style="grid-template-columns:${gridCols}">${heatCells}</div>
      </div>
      <div class="timeline-row timeline-head">
        <div class="row-label"></div>
        <div class="row-grid" style="grid-template-columns:${gridCols}">${dayHeaders}</div>
      </div>
      ${rows || '<p class="empty">В этой группе пока нет участников с периодами.</p>'}
    </div>
    ${detail}
  `;
}

function renderDetailPanel(periodId, allPeriods) {
  const p = store.state.periods[periodId];
  if (!p) return '';
  const person = store.state.people[p.personId];
  const overlapIds = overlappingPersonIds(p, allPeriods);
  const overlapNames = [...overlapIds].map((id) => store.state.people[id]?.name).filter(Boolean);
  return `
    <div class="detail-panel">
      <div class="detail-head">
        <strong>${esc(p.title)}</strong>
        <button class="btn btn-ghost" data-action="close-detail">✕</button>
      </div>
      <div>${esc(person?.name || '')} · ${fmtRu(p.start)} — ${fmtRu(p.end)} · ${KIND_LABELS[p.kind]}</div>
      ${p.notes ? `<div class="period-notes">${esc(p.notes)}</div>` : ''}
      ${p.plans?.length ? `<ul class="plan-list">${p.plans.map((pl) => `<li>${esc(pl.title)}${pl.date ? ' — ' + fmtRu(pl.date) : ''}</li>`).join('')}</ul>` : ''}
      ${overlapNames.length ? `<div class="overlap-note">⚠ пересекается с: ${esc(overlapNames.join(', '))}</div>` : '<div class="muted">Пересечений нет</div>'}
    </div>
  `;
}

// ---------- Участники и доступ ----------
function renderAccessTab(configured, signedIn) {
  const g = activeGroup();
  if (!g) {
    return `<p class="empty">«Личное» — ваш собственный раздел, он не передаётся другим людям.<br>Создайте группу, чтобы делиться отпусками и видеть пересечения.</p>`;
  }
  const members = g.memberIds.map((id) => store.state.people[id]).filter(Boolean);
  const inviteLink = sync.buildInviteLink(g.id);

  return `
    <div class="card">
      <div class="card-head">
        <strong>${esc(g.name)}</strong>
        <button class="btn btn-ghost btn-danger" data-action="delete-group" data-id="${g.id}">Удалить группу</button>
      </div>
      ${
        !g.driveFolderId
          ? `<p>Синхронизация через Google Drive не включена.</p>
             <button class="btn btn-primary" data-action="connect-drive" data-id="${g.id}" ${!configured ? 'disabled title="Заполните config.js"' : ''}>Включить синхронизацию</button>`
          : `<p>Папка в Drive подключена. <a href="https://drive.google.com/drive/folders/${g.driveFolderId}" target="_blank" rel="noopener">Открыть в Google Drive</a></p>
             <button class="btn btn-ghost" data-action="sync-group" data-id="${g.id}">Синхронизировать сейчас</button>`
      }
    </div>

    <div class="card">
      <strong>Участники (${members.length})</strong>
      <ul class="member-list">
        ${members
          .map(
            (p) => `<li><span class="dot" style="background:${p.color}"></span>${esc(p.name)} ${p.email ? `<span class="muted">(${esc(p.email)})</span>` : ''} ${p.isMe ? '<span class="pill pill-muted">вы</span>' : ''}</li>`
          )
          .join('')}
      </ul>
    </div>

    ${
      g.driveFolderId
        ? `<div class="card">
        <strong>Пригласить человека</strong>
        <div class="row">
          <input type="text" readonly id="invite-link" value="${esc(inviteLink)}">
          <button class="btn btn-ghost" data-action="copy-invite">Скопировать ссылку</button>
        </div>
        <form class="row" data-action="invite-email-form">
          <input type="email" name="email" placeholder="email@пример.com" required>
          <select name="role">
            <option value="writer">Может редактировать свои данные</option>
            <option value="reader">Только просмотр</option>
          </select>
          <button class="btn btn-primary" type="submit">Отправить приглашение</button>
        </form>
        <p class="hint">Google отправит человеку письмо со ссылкой на папку. Дополнительно отправьте ему ссылку на это приложение (выше) — после входа через Google ему нужно один раз подтвердить папку через «Принять приглашение».</p>
        <button class="btn btn-ghost" data-action="refresh-permissions" data-id="${g.driveFolderId}">Показать, у кого есть доступ</button>
        <div id="permissions-list"></div>
      </div>`
        : ''
    }
  `;
}

// ---------- Экспорт ----------
function renderExportTab(signedIn) {
  const memberIds = currentMemberIds();
  if (!exportIncluded) exportIncluded = new Set(memberIds);
  const periods = currentPeriods().filter((p) => exportIncluded.has(p.personId));

  return `
    <div class="card">
      <strong>Кого включить</strong>
      <ul class="member-list">
        ${memberIds
          .map((id) => store.state.people[id])
          .filter(Boolean)
          .map(
            (p) =>
              `<li><label><input type="checkbox" data-action="toggle-export-person" data-id="${p.id}" ${exportIncluded.has(p.id) ? 'checked' : ''}> <span class="dot" style="background:${p.color}"></span>${esc(p.name)}</label></li>`
          )
          .join('')}
      </ul>
    </div>
    <div class="card">
      <p>${periods.length} период(ов) будет экспортировано.</p>
      <div class="row">
        <button class="btn btn-primary" data-action="export-ics">Скачать .ics</button>
        <button class="btn btn-primary" data-action="export-gcal" ${!signedIn ? 'disabled title="Сначала войдите через Google"' : ''}>Отправить в Google Calendar</button>
      </div>
    </div>
  `;
}

// ---------- Period editor modal ----------
function openPeriodEditor(periodId) {
  const existing = periodId ? store.state.periods[periodId] : null;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <form class="modal" id="period-form">
      <h3>${existing ? 'Изменить период' : 'Новый период'}</h3>
      <label>Название<input name="title" required value="${esc(existing?.title || '')}" placeholder="Летний отпуск 2026"></label>
      <label>Тип
        <select name="kind">
          ${Object.entries(KIND_LABELS)
            .map(([k, v]) => `<option value="${k}" ${existing?.kind === k ? 'selected' : ''}>${v}</option>`)
            .join('')}
        </select>
      </label>
      <div class="row">
        <label>С<input type="date" name="start" required value="${existing?.start || ''}"></label>
        <label>По<input type="date" name="end" required value="${existing?.end || ''}"></label>
      </div>
      <label>Заметки<textarea name="notes" rows="2">${esc(existing?.notes || '')}</textarea></label>
      <div class="plan-editor">
        <strong>Планы внутри периода</strong>
        <div id="plan-rows">
          ${(existing?.plans || []).map((pl) => planRow(pl)).join('')}
        </div>
        <button type="button" class="btn btn-ghost" id="add-plan-row">+ Добавить пункт</button>
      </div>
      <div class="row modal-actions">
        <button type="button" class="btn btn-ghost" id="cancel-modal">Отмена</button>
        ${existing ? '' : ''}
        <button type="submit" class="btn btn-primary">Сохранить</button>
      </div>
    </form>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#cancel-modal').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#add-plan-row').addEventListener('click', () => {
    overlay.querySelector('#plan-rows').insertAdjacentHTML('beforeend', planRow({}));
  });
  overlay.addEventListener('click', (e) => {
    if (e.target.matches('[data-remove-plan]')) e.target.closest('.plan-row').remove();
  });
  overlay.querySelector('#period-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const title = fd.get('title').trim();
    const start = fd.get('start');
    const end = fd.get('end');
    if (end < start) return toast('Дата окончания раньше даты начала', true);
    const plans = [...overlay.querySelectorAll('.plan-row')]
      .map((row) => ({
        id: row.dataset.planId || uid(),
        title: row.querySelector('[name=plan-title]').value.trim(),
        date: row.querySelector('[name=plan-date]').value,
        note: row.querySelector('[name=plan-note]').value.trim(),
      }))
      .filter((pl) => pl.title);
    const patch = { title, kind: fd.get('kind'), start, end, notes: fd.get('notes').trim(), plans };
    if (existing) {
      store.updatePeriod(existing.id, patch);
    } else {
      const newId = store.addPeriod({ personId: store.state.me, ...patch });
      store.updatePeriod(newId, { plans });
    }
    overlay.remove();
  });
}

function planRow(pl) {
  return `
    <div class="plan-row" data-plan-id="${pl.id || ''}">
      <input name="plan-title" placeholder="Что" value="${esc(pl.title || '')}">
      <input name="plan-date" type="date" value="${pl.date || ''}">
      <input name="plan-note" placeholder="Заметка" value="${esc(pl.note || '')}">
      <button type="button" data-remove-plan>✕</button>
    </div>
  `;
}

// ---------- Events ----------
function wireEvents() {
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('submit', onSubmit);
}

async function onClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === 'tab') {
    activeTab = btn.dataset.tab;
    exportIncluded = null;
    render();
  } else if (action === 'select-group') {
    store.setActiveGroup(btn.dataset.group || null);
    exportIncluded = null;
  } else if (action === 'add-group') {
    const name = prompt('Название группы (например, «Семья» или «Отдел продаж»):');
    if (name?.trim()) store.addGroup(name.trim());
  } else if (action === 'delete-group') {
    if (confirm('Удалить группу? Локальные данные участников останутся, но группа перестанет быть доступна здесь.')) {
      store.deleteGroup(btn.dataset.id);
      render();
    }
  } else if (action === 'add-period') {
    openPeriodEditor(null);
  } else if (action === 'edit-period') {
    openPeriodEditor(btn.dataset.id);
  } else if (action === 'delete-period') {
    if (confirm('Удалить этот период?')) store.deletePeriod(btn.dataset.id);
  } else if (action === 'show-period') {
    detailPeriodId = btn.dataset.id;
    render();
  } else if (action === 'close-detail') {
    detailPeriodId = null;
    render();
  } else if (action === 'prev-month') {
    cursor.m--; if (cursor.m < 0) { cursor.m = 11; cursor.y--; }
    render();
  } else if (action === 'next-month') {
    cursor.m++; if (cursor.m > 11) { cursor.m = 0; cursor.y++; }
    render();
  } else if (action === 'sign-in') {
    try {
      await drive.signIn(cfg);
      toast('Вход выполнен');
      render();
    } catch (err) {
      toast('Не удалось войти: ' + err.message, true);
    }
  } else if (action === 'sign-out') {
    drive.signOut();
    render();
  } else if (action === 'connect-drive') {
    try {
      if (!drive.isSignedIn()) await drive.signIn(cfg);
      await sync.connectGroupToDrive(btn.dataset.id);
      toast('Синхронизация включена');
    } catch (err) {
      toast('Ошибка: ' + err.message, true);
    }
  } else if (action === 'sync-group') {
    try {
      if (!drive.isSignedIn()) await drive.signIn(cfg);
      await sync.syncGroup(btn.dataset.id);
      toast('Синхронизировано');
    } catch (err) {
      toast('Ошибка синхронизации: ' + err.message, true);
    }
  } else if (action === 'copy-invite') {
    const input = document.getElementById('invite-link');
    try {
      await navigator.clipboard.writeText(input.value);
      toast('Ссылка скопирована');
    } catch {
      input.select();
      toast('Скопируйте ссылку вручную (Ctrl+C)');
    }
  } else if (action === 'refresh-permissions') {
    try {
      if (!drive.isSignedIn()) await drive.signIn(cfg);
      const perms = await drive.listPermissions(btn.dataset.id);
      document.getElementById('permissions-list').innerHTML = renderPermissions(btn.dataset.id, perms);
    } catch (err) {
      toast('Ошибка: ' + err.message, true);
    }
  } else if (action === 'revoke-permission') {
    if (!confirm('Отключить доступ этому человеку?')) return;
    try {
      await drive.revokePermission(btn.dataset.file, btn.dataset.perm);
      btn.closest('.perm-row').remove();
      toast('Доступ отключён');
    } catch (err) {
      toast('Ошибка: ' + err.message, true);
    }
  } else if (action === 'export-ics') {
    const memberIds = currentMemberIds();
    const periods = currentPeriods().filter((p) => exportIncluded.has(p.personId));
    downloadICS('otpuska.ics', buildICS(periods, store.state.people));
    toast('Файл .ics скачан');
  } else if (action === 'export-gcal') {
    try {
      if (!drive.isSignedIn()) await drive.signIn(cfg);
      const periods = currentPeriods().filter((p) => exportIncluded.has(p.personId));
      await drive.pushToGoogleCalendar(periods, store.state.people);
      toast('События добавлены в Google Calendar');
    } catch (err) {
      toast('Ошибка экспорта: ' + err.message, true);
    }
  } else if (action === 'accept-invite') {
    try {
      if (!drive.isSignedIn()) await drive.signIn(cfg);
      const { folderId, name } = window.__pendingInvite;
      await sync.acceptInvite(cfg, folderId, name);
      window.__pendingInvite = null;
      history.replaceState(null, '', location.pathname);
      toast('Приглашение принято, группа подключена');
      render();
    } catch (err) {
      toast(err.message, true);
    }
  } else if (action === 'dismiss-invite') {
    window.__pendingInvite = null;
    render();
  }
}

function renderPermissions(fileId, perms) {
  return `<ul class="member-list">${perms
    .map(
      (p) =>
        `<li class="perm-row"><span>${esc(p.displayName || p.emailAddress || p.type)} — ${p.role}</span>${
          p.role !== 'owner' ? `<button class="btn btn-ghost btn-danger" data-action="revoke-permission" data-file="${fileId}" data-perm="${p.id}">Отключить</button>` : ''
        }</li>`
    )
    .join('')}</ul>`;
}

function onChange(e) {
  if (e.target.matches('[data-action="toggle-export-person"]')) {
    const id = e.target.dataset.id;
    if (e.target.checked) exportIncluded.add(id);
    else exportIncluded.delete(id);
    render();
  }
}

async function onSubmit(e) {
  if (e.target.matches('[data-action="invite-email-form"]')) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const g = activeGroup();
    try {
      if (!drive.isSignedIn()) await drive.signIn(cfg);
      await drive.shareByEmail(g.driveFolderId, fd.get('email'), fd.get('role'));
      toast('Приглашение отправлено на ' + fd.get('email'));
      e.target.reset();
    } catch (err) {
      toast('Ошибка приглашения: ' + err.message, true);
    }
  }
}
