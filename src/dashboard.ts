export const dashboardHtml = String.raw`<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Servisní požadavky</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #182230; background: #f3f6fa; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    header { background: #14263d; color: white; padding: 24px max(20px, calc((100vw - 1440px) / 2)); display: flex; align-items: center; justify-content: space-between; gap: 18px; }
    h1 { font-size: 23px; margin: 0 0 4px; letter-spacing: -.02em; }
    .subtitle { color: #c2cee0; font-size: 13px; }
    button, input, select { font: inherit; }
    button { border: 0; border-radius: 8px; padding: 10px 14px; background: #3c82f6; color: white; font-weight: 650; cursor: pointer; }
    button:hover { background: #2e70df; }
    main { max-width: 1440px; margin: 24px auto; padding: 0 20px 36px; }
    .stats { display: grid; grid-template-columns: repeat(4, minmax(130px, 1fr)); gap: 12px; margin-bottom: 18px; }
    .stat, .panel { background: white; border: 1px solid #e1e7ef; border-radius: 12px; box-shadow: 0 2px 8px #18304a08; }
    .stat { padding: 14px 16px; }
    .stat-label { color: #64748b; font-size: 12px; }
    .stat-value { font-size: 24px; font-weight: 700; margin-top: 4px; }
    .panel { overflow: hidden; }
    .toolbar { display: flex; align-items: center; gap: 10px; padding: 14px; border-bottom: 1px solid #e8edf3; }
    input, select { border: 1px solid #cfd8e3; border-radius: 8px; background: #fff; padding: 9px 11px; color: #182230; }
    input { min-width: 220px; flex: 1; }
    .updated { margin-left: auto; color: #64748b; font-size: 12px; white-space: nowrap; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; min-width: 950px; }
    th { text-align: left; padding: 11px 12px; background: #f8fafc; color: #64748b; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .045em; }
    td { padding: 12px; border-top: 1px solid #edf1f5; vertical-align: top; font-size: 13px; }
    tbody tr:hover { background: #fbfdff; }
    .ticket { font-weight: 750; white-space: nowrap; }
    .muted { color: #64748b; font-size: 12px; margin-top: 4px; }
    .issue { max-width: 430px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
    .pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 4px 9px; font-size: 11px; font-weight: 700; white-space: nowrap; }
    .received { color: #684b00; background: #fff2c6; }
    .dispatching { color: #1756a9; background: #e2efff; }
    .accepted, .resolved { color: #176b43; background: #dff5e9; }
    .unassigned, .failed { color: #a32d2d; background: #fde7e7; }
    .empty, .error { padding: 30px; text-align: center; color: #64748b; }
    .error { color: #a32d2d; }
    .login-wrap { max-width: 420px; margin: 9vh auto; padding: 28px; background: white; border: 1px solid #e1e7ef; border-radius: 14px; box-shadow: 0 8px 28px #18304a12; }
    .login-wrap h1 { color: #182230; margin-bottom: 8px; }
    .login-form, .user-form { display: grid; gap: 12px; }
    .login-form label, .user-form label { display: grid; gap: 5px; color: #475569; font-size: 13px; font-weight: 650; }
    .login-form input, .user-form input, .user-form select { width: 100%; min-width: 0; }
    .login-error { min-height: 18px; color: #a32d2d; font-size: 13px; }
    .header-actions { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
    .header-actions .secondary { color: #dce8f8; background: #243d5a; }
    .header-actions .secondary:hover { background: #304e70; }
    .header-user { color: #c2cee0; font-size: 13px; margin-right: 4px; }
    .admin-panel { margin-top: 18px; }
    .admin-panel h2 { margin: 18px 16px 8px; font-size: 18px; }
    .admin-panel p { margin: 0 16px 14px; color: #64748b; font-size: 13px; }
    .admin-tools { display: grid; grid-template-columns: minmax(280px, .8fr) minmax(420px, 1.2fr); gap: 14px; padding: 0 14px 14px; }
    .admin-box { border: 1px solid #e1e7ef; border-radius: 10px; padding: 14px; }
    .admin-box h3 { margin: 0 0 12px; font-size: 15px; }
    .user-table { width: 100%; min-width: 480px; }
    .user-controls { display: grid; gap: 6px; min-width: 120px; }
    .user-controls input, .user-controls select { min-width: 0; width: 100%; padding: 6px 8px; font-size: 12px; }
    .small-button { padding: 7px 9px; font-size: 12px; }
    .danger { background: #b42318; }
    .danger:hover { background: #8f1c13; }
    .admin-notice { padding: 10px 12px; color: #475569; background: #f8fafc; border-radius: 8px; font-size: 12px; }
    .row-select { min-width: 130px; padding: 6px 8px; font-size: 12px; }
    .row-actions { display: grid; gap: 6px; }
    .related-calls { min-width: 260px; display: grid; gap: 9px; }
    .related-call { padding: 9px; border: 1px solid #e1e7ef; border-radius: 8px; background: #fbfdff; }
    .related-call audio { width: 230px; max-width: 100%; height: 34px; margin-top: 7px; }
    .unlinked-list { display: grid; gap: 10px; }
    .unlinked-call { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(200px, 1.2fr) auto; align-items: center; gap: 10px; padding: 10px; border: 1px solid #e1e7ef; border-radius: 8px; }
    .unlinked-call select { width: 100%; min-width: 0; }
    @media (max-width: 700px) { header { padding: 18px 16px; } main { margin-top: 16px; padding: 0 12px 24px; } .stats { grid-template-columns: repeat(2, 1fr); gap: 8px; } .toolbar { flex-wrap: wrap; } input { min-width: 100%; } .updated { margin-left: 0; } }
    @media (max-width: 900px) { .admin-tools { grid-template-columns: 1fr; } }
    @media (max-width: 700px) { .unlinked-call { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <section id="login-view" class="login-wrap" hidden>
    <h1>Servisní požadavky</h1>
    <div class="subtitle" style="color:#64748b;margin-bottom:20px">Přihlaste se ke svému účtu.</div>
    <form id="login-form" class="login-form">
      <label>Uživatelské jméno<input name="username" autocomplete="username" required></label>
      <label>Heslo<input name="password" type="password" autocomplete="current-password" required></label>
      <button type="submit">Přihlásit se</button>
      <div id="login-error" class="login-error" role="alert"></div>
    </form>
  </section>
  <div id="app-view" hidden>
  <header>
    <div><h1>Servisní požadavky</h1><div class="subtitle">Přehled požadavků, předání pohotovosti a převzetí</div></div>
    <div class="header-actions"><span id="header-user" class="header-user"></span><button id="admin-toggle" class="secondary" type="button" hidden>Administrace</button><button id="refresh" type="button">Obnovit</button><button id="logout" class="secondary" type="button">Odhlásit</button></div>
  </header>
  <main>
    <section class="stats" aria-label="Souhrn">
      <div class="stat"><div class="stat-label">Celkem zobrazeno</div><div class="stat-value" id="total">—</div></div>
      <div class="stat"><div class="stat-label">Čeká na technika</div><div class="stat-value" id="waiting">—</div></div>
      <div class="stat"><div class="stat-label">Převzato / spojeno</div><div class="stat-value" id="accepted">—</div></div>
      <div class="stat"><div class="stat-label">Bez převzetí</div><div class="stat-value" id="unassigned">—</div></div>
    </section>
    <section class="panel">
      <div class="toolbar">
        <input id="search" type="search" placeholder="Hledat tiket, jméno, číslo nebo popis…" aria-label="Hledat požadavky">
        <select id="status-filter" aria-label="Filtrovat podle stavu">
          <option value="">Všechny stavy</option>
          <option value="received">Čeká na předání</option>
          <option value="dispatching">Voláme pohotovost</option>
          <option value="accepted">Převzato / spojeno</option>
          <option value="unassigned">Bez převzetí</option>
          <option value="resolved">Vyřešeno</option>
        </select>
        <span class="updated" id="updated">Načítám…</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Tiket</th><th>Vytvořeno</th><th>Volající / callback</th><th>Požadavek</th><th>Naléhavost</th><th>Stav</th><th>Převzetí</th><th>Související hovory</th><th class="admin-column" hidden>Správa</th></tr></thead>
          <tbody id="rows"><tr><td class="empty" colspan="8">Načítám požadavky…</td></tr></tbody>
        </table>
      </div>
      <div id="error" class="error" hidden></div>
    </section>
    <section id="admin-panel" class="panel admin-panel" hidden>
      <h2>Administrace</h2>
      <p>Správa uživatelských přístupů a servisních požadavků.</p>
      <div class="admin-tools">
        <div class="admin-box" style="grid-column:1/-1">
          <h3>Diagnostika AI hovorů</h3>
          <p id="ai-model"></p>
          <div class="table-wrap"><table><thead><tr><th>Čas</th><th>Účastník 3CX</th><th>Událost</th><th>Detail</th></tr></thead><tbody id="ai-events"></tbody></table></div>
        </div>
        <div class="admin-box" style="grid-column:1/-1">
          <h3>Nepřiřazené hovory z 3CX</h3>
          <div id="unlinked-calls" class="unlinked-list"><div class="muted">Načítám hovory…</div></div>
        </div>
        <div class="admin-box">
          <h3>Přidat uživatele</h3>
          <form id="user-form" class="user-form">
            <label>Uživatelské jméno<input name="username" minlength="3" maxlength="50" autocomplete="off" required></label>
            <label>Heslo<input name="password" type="password" minlength="12" maxlength="256" autocomplete="new-password" required></label>
            <label>Oprávnění<select name="role"><option value="viewer">Pouze zobrazení</option><option value="admin">Správce</option></select></label>
            <button type="submit">Vytvořit účet</button>
            <div id="user-form-message" class="login-error" role="status"></div>
          </form>
        </div>
        <div class="admin-box">
          <h3>Uživatelé</h3>
          <div class="table-wrap"><table class="user-table"><thead><tr><th>Jméno</th><th>Role / stav</th><th>Nové heslo</th><th>Akce</th></tr></thead><tbody id="users-rows"></tbody></table></div>
        </div>
        <div class="admin-box">
          <h3>Vymazat servisní požadavky</h3>
          <div class="admin-notice">Smaže všechny tikety včetně historie pokusů o předání. Uživatelské účty a testovací hovory zůstanou zachované. Požadavky právě předávané technikovi chrání systém před smazáním.</div>
          <button id="clear-requests" type="button" class="danger" style="margin-top:12px">Smazat všechny požadavky…</button>
        </div>
      </div>
    </section>
  </main>
  </div>
  <script>
    const rows = document.querySelector('#rows');
    const APP_BASE_PATH = '__APP_BASE_PATH__';
    const search = document.querySelector('#search');
    const filter = document.querySelector('#status-filter');
    const statusNames = { received: 'Čeká na předání', dispatching: 'Voláme pohotovost', accepted: 'Převzato', unassigned: 'Bez převzetí', resolved: 'Vyřešeno' };
    const urgencyNames = { low: 'Běžná', normal: 'Standardní', high: 'Vysoká', critical: 'Kritická' };
    const editableStatuses = ['received', 'accepted', 'unassigned', 'resolved'];
    const urgencyValues = ['low', 'normal', 'high', 'critical'];
    let requests = [];
    let currentUser = null;
    const dateFormat = new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'short', timeStyle: 'short' });
    function cell(value, className) { const td = document.createElement('td'); if (className) td.className = className; td.textContent = value || '—'; return td; }
    function formatDate(value) { return value ? dateFormat.format(new Date(value)) : '—'; }
    function stateText(item) { return statusNames[item.status] || item.status || 'Neznámý'; }
    function isAdmin() { return currentUser?.role === 'admin'; }
    function showLogin() {
      currentUser = null;
      document.querySelector('#app-view').hidden = true;
      document.querySelector('#login-view').hidden = false;
      document.querySelector('#login-form').elements.password.value = '';
    }
    function showApp(user) {
      currentUser = user;
      document.querySelector('#login-view').hidden = true;
      document.querySelector('#app-view').hidden = false;
      document.querySelector('#header-user').textContent = user.username + (isAdmin() ? ' · správce' : '');
      document.querySelector('#admin-toggle').hidden = !isAdmin();
      document.querySelector('.admin-column').hidden = !isAdmin();
      document.querySelector('#admin-panel').hidden = true;
      void load();
    }
    async function api(url, options = {}) {
      const headers = { Accept: 'application/json', ...(options.headers || {}) };
      if (options.body !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
      const response = await fetch(APP_BASE_PATH + url, { ...options, headers, credentials: 'same-origin', cache: 'no-store' });
      const result = response.status === 204 ? null : await response.json().catch(() => ({}));
      if (response.status === 401) { showLogin(); throw new Error(result.error || 'Přihlaste se znovu.'); }
      if (!response.ok) throw new Error(result.error || ('HTTP ' + response.status));
      return result;
    }
    function makeSelect(values, labels, value, className) {
      const select = document.createElement('select');
      select.className = className || 'row-select';
      for (const item of values) {
        const option = document.createElement('option'); option.value = item; option.textContent = labels[item] || item; select.append(option);
      }
      select.value = value;
      return select;
    }
    function acceptanceText(item) {
      if (item.status === 'accepted' && item.latest_dtmf_digit === '3') return 'Spojeno s volajícím';
      if (item.status === 'accepted') return 'Převzato technikem';
      if (item.status === 'dispatching' && item.latest_attempt_status === 'connected') return 'U technika — čeká na volbu';
      if (item.status === 'unassigned') return 'Zatím nepřevzato';
      if (item.status === 'received' && item.dispatch_attempts > 0) return 'Čeká na další pokus';
      return 'Čeká na technika';
    }
    function render() {
      const term = search.value.trim().toLocaleLowerCase('cs-CZ');
      const visible = requests.filter(item => {
        if (filter.value && item.status !== filter.value) return false;
        const haystack = [item.ticket_number, item.caller_name, item.callback_number, item.issue_summary, item.status].join(' ').toLocaleLowerCase('cs-CZ');
        return !term || haystack.includes(term);
      });
      rows.replaceChildren();
      if (!visible.length) { const tr = document.createElement('tr'); const td = cell('Žádný požadavek neodpovídá filtru.', 'empty'); td.colSpan = isAdmin() ? 9 : 8; tr.append(td); rows.append(tr); return; }
      for (const item of visible) {
        const tr = document.createElement('tr');
        const ticket = cell('#' + item.ticket_number, 'ticket'); tr.append(ticket);
        tr.append(cell(formatDate(item.created_at)));
        const caller = document.createElement('td'); caller.append(document.createTextNode(item.caller_name || '—'));
        const phone = document.createElement('div'); phone.className = 'muted'; phone.textContent = item.callback_number || 'Callback neuveden'; caller.append(phone); tr.append(caller);
        const issue = cell(item.issue_summary, 'issue'); issue.title = item.issue_summary || ''; tr.append(issue);
        const urgency = document.createElement('td');
        if (isAdmin()) {
          const urgencySelect = makeSelect(urgencyValues, urgencyNames, item.urgency);
          urgencySelect.addEventListener('change', () => void updateRequest(item.ticket_number, { urgency: urgencySelect.value })); urgency.append(urgencySelect);
        } else urgency.textContent = urgencyNames[item.urgency] || item.urgency;
        tr.append(urgency);
        const state = document.createElement('td'); const pill = document.createElement('span'); pill.className = 'pill ' + (item.status || 'received'); pill.textContent = stateText(item); state.append(pill);
        if (isAdmin()) {
          const options = [...editableStatuses]; if (!options.includes(item.status)) options.push(item.status);
          const statusLabels = { ...statusNames };
          const statusSelect = makeSelect(options, statusLabels, item.status);
          statusSelect.disabled = item.status === 'dispatching';
          statusSelect.title = item.status === 'dispatching' ? 'Požadavek je právě předáván technikovi.' : 'Změnit stav';
          statusSelect.addEventListener('change', () => void updateRequest(item.ticket_number, { status: statusSelect.value })); state.append(statusSelect);
        }
        if (item.latest_attempt_no) { const attempt = document.createElement('div'); attempt.className = 'muted'; attempt.textContent = 'Pokus ' + item.latest_attempt_no; state.append(attempt); } tr.append(state);
        const acceptance = cell(acceptanceText(item));
        if (item.latest_dtmf_digit && item.status === 'accepted') { const detail = document.createElement('div'); detail.className = 'muted'; detail.textContent = item.latest_dtmf_digit === '3' ? 'Spojení volbou 3' : 'Potvrzeno volbou 1'; acceptance.append(detail); }
        if (item.status === 'accepted' && item.latest_finished_at) { const when = document.createElement('div'); when.className = 'muted'; when.textContent = formatDate(item.latest_finished_at); acceptance.append(when); }
        tr.append(acceptance);
        const calls = document.createElement('td'); calls.className = 'related-calls';
        for (const call of item.related_calls || []) {
          const entry = document.createElement('div'); entry.className = 'related-call';
          const summary = document.createElement('strong'); summary.textContent = [formatDate(call.started_at), call.call_direction, call.external_number].filter(Boolean).join(' · '); entry.append(summary);
          const details = document.createElement('div'); details.className = 'muted';
          details.textContent = [call.contact_name, call.agent_name || call.agent_extension, call.queue_extension ? 'Fronta ' + call.queue_extension : '', Number.isFinite(call.duration_seconds) ? Math.floor(call.duration_seconds / 60) + ' min ' + (call.duration_seconds % 60) + ' s' : ''].filter(Boolean).join(' · ');
          entry.append(details);
          if (call.recording_url) { const player = document.createElement('audio'); player.controls = true; player.preload = 'none'; player.src = call.recording_url; player.setAttribute('aria-label', 'Nahrávka hovoru'); entry.append(player); }
          else { const noRecording = document.createElement('div'); noRecording.className = 'muted'; noRecording.textContent = 'Nahrávka není k dispozici'; entry.append(noRecording); }
          calls.append(entry);
        }
        if (!calls.childElementCount) calls.textContent = 'Zatím bez přiřazeného hovoru';
        tr.append(calls);
        if (isAdmin()) {
          const actions = document.createElement('td'); actions.className = 'row-actions';
          const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'small-button danger'; remove.textContent = 'Smazat';
          remove.disabled = item.status === 'dispatching'; remove.title = remove.disabled ? 'Požadavek se právě předává technikovi.' : '';
          remove.addEventListener('click', async () => {
            if (!confirm('Opravdu smazat požadavek #' + item.ticket_number + ' včetně historie pokusů?')) return;
            try { await api('/admin/service-requests/' + item.ticket_number, { method: 'DELETE' }); await load(); }
            catch (error) { showError(error.message); }
          });
          actions.append(remove); tr.append(actions);
        }
        rows.append(tr);
      }
    }
    function showError(message) { const error = document.querySelector('#error'); error.textContent = message; error.hidden = false; }
    async function updateRequest(ticketNumber, patch) {
      try { await api('/admin/service-requests/' + ticketNumber, { method: 'PATCH', body: JSON.stringify(patch) }); await load(); }
      catch (error) { showError(error.message); }
    }
    async function load() {
      if (!currentUser) return;
      const error = document.querySelector('#error'); error.hidden = true;
      try {
        requests = await api('/service-requests');
        document.querySelector('#total').textContent = requests.length;
        document.querySelector('#waiting').textContent = requests.filter(r => r.status === 'received' || r.status === 'dispatching').length;
        document.querySelector('#accepted').textContent = requests.filter(r => r.status === 'accepted' || r.status === 'resolved').length;
        document.querySelector('#unassigned').textContent = requests.filter(r => r.status === 'unassigned').length;
        document.querySelector('#updated').textContent = 'Aktualizováno ' + new Intl.DateTimeFormat('cs-CZ', { timeStyle: 'short' }).format(new Date());
        render();
      } catch (err) { if (currentUser) { error.textContent = err.message || 'Požadavky se nepodařilo načíst.'; error.hidden = false; } }
    }
    async function loadUsers() {
      const target = document.querySelector('#users-rows'); target.replaceChildren();
      const users = await api('/admin/users');
      for (const user of users) {
        const tr = document.createElement('tr'); tr.append(cell(user.username));
        const controls = document.createElement('td'); controls.className = 'user-controls';
        const role = makeSelect(['viewer', 'admin'], { viewer: 'Pouze zobrazení', admin: 'Správce' }, user.role, '');
        const active = document.createElement('label'); active.style.cssText = 'display:flex;align-items:center;gap:6px;font-weight:400';
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = user.is_active; checkbox.style.width = 'auto';
        active.append(checkbox, document.createTextNode('Aktivní')); controls.append(role, active); tr.append(controls);
        const passwordCell = document.createElement('td'); const password = document.createElement('input'); password.type = 'password'; password.placeholder = 'Nové heslo (volitelné)'; password.minLength = 12; password.autocomplete = 'new-password'; passwordCell.append(password); tr.append(passwordCell);
        const actions = document.createElement('td'); const save = document.createElement('button'); save.type = 'button'; save.className = 'small-button'; save.textContent = 'Uložit';
        save.addEventListener('click', async () => {
          const patch = { role: role.value, is_active: checkbox.checked };
          if (password.value) patch.password = password.value;
          try { await api('/admin/users/' + user.id, { method: 'PATCH', body: JSON.stringify(patch) }); await loadUsers(); }
          catch (error) { showError(error.message); }
        });
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'small-button danger'; remove.textContent = 'Smazat';
        remove.addEventListener('click', async () => {
          if (!confirm('Opravdu smazat účet ' + user.username + '?')) return;
          try { await api('/admin/users/' + user.id, { method: 'DELETE' }); await loadUsers(); }
          catch (error) { showError(error.message); }
        });
        actions.append(save, remove); tr.append(actions); target.append(tr);
      }
      if (!users.length) { const tr = document.createElement('tr'); const td = cell('Zatím nejsou vytvořené účty.', 'empty'); td.colSpan = 4; tr.append(td); target.append(tr); }
    }
    async function loadAiDiagnostics() {
      const target = document.querySelector('#ai-events');
      try {
        const diagnostics = await api('/admin/ai-diagnostics');
        if (!isAdmin() || document.querySelector('#admin-panel').hidden) return;
        document.querySelector('#ai-model').textContent = 'Model ' + diagnostics.model;
        const rows = diagnostics.events.map(event => {
          const row = document.createElement('tr');
          row.append(cell(new Date(event.at).toLocaleTimeString('cs-CZ')), cell(String(event.participantId)), cell(event.stage), cell(String(event.detail ?? '')));
          return row;
        });
        if (!rows.length) {
          const row = document.createElement('tr');
          const message = cell('Od posledního spuštění zatím neproběhl žádný AI hovor.');
          message.colSpan = 4; row.append(message); rows.push(row);
        }
        target.replaceChildren(...rows);
      } catch (error) {
        if (!isAdmin()) return;
        const row = document.createElement('tr');
        const message = cell(error.message); message.colSpan = 4; row.append(message);
        target.replaceChildren(row);
      }
    }
    async function loadUnlinkedCalls() {
      const target = document.querySelector('#unlinked-calls'); target.replaceChildren();
      const calls = await api('/admin/unlinked-calls');
      if (!calls.length) { target.textContent = 'Žádné nepřiřazené hovory.'; return; }
      for (const call of calls) {
        const row = document.createElement('div'); row.className = 'unlinked-call';
        const info = document.createElement('div');
        const heading = document.createElement('strong'); heading.textContent = [formatDate(call.started_at), call.external_number || 'číslo nezjištěno'].join(' · '); info.append(heading);
        const meta = document.createElement('div'); meta.className = 'muted'; meta.textContent = [call.call_type, call.call_direction, call.contact_name, call.agent_name || call.agent_extension, call.queue_extension ? 'Fronta ' + call.queue_extension : ''].filter(Boolean).join(' · '); info.append(meta);
        if (call.recording_url) { const player = document.createElement('audio'); player.controls = true; player.preload = 'none'; player.src = call.recording_url; player.style.cssText = 'width:100%;height:34px;margin-top:6px'; info.append(player); }
        const select = document.createElement('select'); select.setAttribute('aria-label', 'Přiřadit hovor k tiketu');
        const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Vyberte tiket…'; select.append(placeholder);
        for (const ticket of requests) { const option = document.createElement('option'); option.value = ticket.ticket_number; option.textContent = '#' + ticket.ticket_number + ' · ' + (ticket.caller_name || 'Volající') + ' · ' + formatDate(ticket.created_at); select.append(option); }
        const assign = document.createElement('button'); assign.type = 'button'; assign.className = 'small-button'; assign.textContent = 'Přiřadit'; assign.disabled = !requests.length;
        assign.addEventListener('click', async () => {
          if (!select.value) { showError('Nejprve vyberte tiket.'); return; }
          try { await api('/admin/calls/' + call.id, { method: 'PATCH', body: JSON.stringify({ ticket_number: Number(select.value) }) }); await load(); await loadUnlinkedCalls(); }
          catch (error) { showError(error.message); }
        });
        row.append(info, select, assign); target.append(row);
      }
    }
    document.querySelector('#login-form').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget; const message = document.querySelector('#login-error'); message.textContent = '';
      const values = Object.fromEntries(new FormData(form).entries());
      try { const user = await api('/auth/login', { method: 'POST', body: JSON.stringify(values) }); form.reset(); showApp(user); }
      catch (error) { message.textContent = error.message; }
    });
    document.querySelector('#logout').addEventListener('click', async () => {
      try { await api('/auth/logout', { method: 'POST', body: '{}' }); } catch { /* local logout is still safe */ }
      showLogin();
    });
    document.querySelector('#admin-toggle').addEventListener('click', async () => {
      const panel = document.querySelector('#admin-panel'); panel.hidden = !panel.hidden;
      if (!panel.hidden) { try { await Promise.all([loadUsers(), loadUnlinkedCalls(), loadAiDiagnostics()]); } catch (error) { showError(error.message); } }
    });
    document.querySelector('#user-form').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget; const message = document.querySelector('#user-form-message'); message.textContent = '';
      const values = Object.fromEntries(new FormData(form).entries());
      try { await api('/admin/users', { method: 'POST', body: JSON.stringify(values) }); form.reset(); message.textContent = 'Uživatel byl vytvořen.'; await loadUsers(); }
      catch (error) { message.textContent = error.message; }
    });
    document.querySelector('#clear-requests').addEventListener('click', async () => {
      if (prompt('Tato akce smaže všechny servisní požadavky. Pro potvrzení napište SMAZAT:') !== 'SMAZAT') return;
      try { const result = await api('/admin/service-requests', { method: 'DELETE', body: JSON.stringify({ confirm: 'SMAZAT' }) }); alert('Smazáno požadavků: ' + result.deleted); await load(); }
      catch (error) { showError(error.message); }
    });
    document.querySelector('#refresh').addEventListener('click', load);
    search.addEventListener('input', render);
    filter.addEventListener('change', render);
    document.querySelector('#admin-panel').hidden = true;
    api('/auth/me').then(showApp).catch(() => showLogin());
    setInterval(() => { if (isAdmin() && !document.querySelector('#admin-panel').hidden) void loadAiDiagnostics(); }, 3000);
    setInterval(() => { if (currentUser) void load(); }, 15000);
  </script>
</body>
</html>`;
