export const dashboardHtml = String.raw`<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Servisní požadavky</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #182230; background: #f3f6fa; }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
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
    input, select, textarea { border: 1px solid #cfd8e3; border-radius: 8px; background: #fff; padding: 9px 11px; color: #182230; font: inherit; }
    textarea { resize: vertical; line-height: 1.45; }
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
    .workspace-nav { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
    .workspace-nav button, .subtle { color: #24466b; background: #e7eef7; }
    .workspace-nav button:hover, .subtle:hover { background: #d8e5f4; }
    .workspace-nav button[aria-current="page"] { background: #173d67; color: #fff; }
    .ops-layout { padding: 0 14px 14px; display: grid; gap: 14px; }
    .checks { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
    .check { border: 1px solid #e1e7ef; border-radius: 10px; padding: 12px; }
    .check h3, .admin-box .section-title { margin: 0 0 8px; font-size: 15px; }
    .health-status { display: grid; justify-items: start; gap: 6px; color: #475569; font-size: 13px; }
    .health-ok { background: #dff5e9; color: #176442; }
    .health-warning { background: #fff2c6; color: #684b00; }
    .health-error { background: #fde7e7; color: #922727; }
    .health-status time { font-size: 11px; color: #64748b; }
    .settings-sections { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(0, 1.6fr); gap: 14px; }
    .setting-group { display: grid; align-content: start; gap: 10px; min-width: 0; margin: 0; padding: 12px; border: 1px solid #e1e7ef; border-radius: 9px; }
    .setting-group legend { padding: 0 6px; font-weight: 650; }
    .setting-group .muted { margin: 0; }
    .ops-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
    .ops-table { min-width: 520px; }
    .ops-table td { overflow-wrap: anywhere; }
    .ticket-link { padding: 0; background: transparent; color: #1a559b; text-decoration: underline; text-underline-offset: 3px; }
    .ticket-link:hover { color: #163859; background: transparent; }
    button:disabled { opacity: .65; cursor: default; }
    .ticket-dialog { width: min(720px, calc(100vw - 28px)); max-height: 88vh; overflow: auto; border: 1px solid #cfd8e3; border-radius: 12px; padding: 18px; color: #182230; }
    .ticket-dialog::backdrop { background: #0b203980; }
    .ticket-dialog h2 { font-size: 20px; margin: 0; }
    .ticket-dialog dl { display: grid; grid-template-columns: minmax(95px, .4fr) minmax(0, 1fr); gap: 8px 12px; }
    .ticket-dialog dt { color: #475569; }
    .ticket-dialog dd { margin: 0; overflow-wrap: anywhere; }
    .ticket-dialog .related-calls { min-width: 0; }
    .dialog-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
    @media (max-width: 700px) { header { padding: 18px 16px; } main { margin-top: 16px; padding: 0 12px 24px; } .stats { grid-template-columns: repeat(2, 1fr); gap: 8px; } .toolbar { flex-wrap: wrap; } input { min-width: 100%; } .updated { margin-left: 0; } }
    @media (max-width: 900px) { .admin-tools { grid-template-columns: 1fr; } }
    @media (max-width: 700px) { .unlinked-call, .settings-sections { grid-template-columns: 1fr; } }
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
    <div class="header-actions"><span id="header-user" class="header-user"></span><button id="refresh" type="button">Obnovit</button><button id="logout" class="secondary" type="button">Odhlásit</button></div>
  </header>
  <main>
    <nav id="workspace-nav" class="workspace-nav" aria-label="Správa portálu" hidden>
      <button type="button" data-view="requests" aria-current="page">Požadavky</button>
      <button type="button" data-view="settings">Nastavení agenta</button>
      <button type="button" data-view="operations">Provoz a logy</button>
    </nav>
    <div id="requests-view">
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
    </div>
    <section id="settings-view" class="panel admin-panel" hidden>
      <h2>Nastavení agenta</h2>
      <p>Uložené změny scénáře a poskytovatele se použijí při dalším hovoru.</p>
      <div class="admin-tools">
        <div class="admin-box" style="grid-column:1/-1">
          <form id="settings-form" class="user-form">
            <div class="settings-sections">
              <fieldset class="setting-group">
                <legend>ISPadmin</legend>
                <label>Základní adresa API (HTTPS, včetně /api/v1)<input id="settings-ispadmin-url" type="url" maxlength="2048" placeholder="https://isp.firma.cz/api/v1" autocomplete="url"></label>
                <label>API token pro čtení<input id="settings-ispadmin-token" type="password" maxlength="2048" placeholder="Prázdné pole zachová uložený token" autocomplete="new-password"></label>
                <div class="admin-notice" id="settings-token-status">Stav tokenu se načítá…</div>
                <label style="display:flex;align-items:center"><input id="settings-clear-token" type="checkbox" style="min-width:0;width:auto;flex:none"> Odpojit ISPadmin a odstranit token</label>
                <div id="ispadmin-test-status" class="health-status" aria-live="polite"></div>
                <button id="test-ispadmin" type="button" class="subtle">Ověřit připojení k ISPadminu</button>
              </fieldset>
              <fieldset class="setting-group">
                <legend>Hlasový agent</legend>
                <label>Poskytovatel<select id="settings-provider"><option value="openai">OpenAI Realtime</option><option value="xai">Grok Voice (xAI)</option></select></label>
                <label id="openai-model-label">OpenAI Realtime model<select id="settings-model"></select></label>
                <p id="voice-provider-info" class="muted"></p>
                <label>Role agenta<input id="settings-role" maxlength="300" required></label>
                <label>Úvodní pozdrav<textarea id="settings-greeting" rows="2" maxlength="2000" required></textarea></label>
                <label>Instrukce pro rozhovor (prompt)<textarea id="settings-prompt" rows="12" maxlength="20000" required aria-describedby="prompt-hint"></textarea></label>
                <p id="prompt-hint" class="muted">Určete, které služby agent řeší, na co se má doptat a jak zapsat problém pro technika. V pozdravu i promptu lze použít {{company_name}} nebo {{agent_name}}.</p>
                <div id="voice-test-status" class="health-status" aria-live="polite"></div>
                <button id="test-voice" type="button" class="subtle">Ověřit uložené AI připojení</button>
              </fieldset>
            </div>
            <div class="ops-actions"><button id="settings-save" type="submit" disabled>Uložit nastavení</button><div id="settings-message" class="health-status" role="status"></div></div>
          </form>
        </div>
        <div class="admin-box" style="grid-column:1/-1">
          <h3>Ústředna 3CX</h3>
          <form id="pbx-form" class="user-form">
            <div class="settings-sections">
              <fieldset class="setting-group">
                <legend>Programovatelná klapka</legend>
                <label>HTTPS adresa ústředny<input name="baseUrl" type="url" maxlength="2048" placeholder="https://pbx.firma.cz" required></label>
                <label>Client ID klapky<input name="clientId" maxlength="80" required></label>
                <label>3CX API klíč<input name="clientSecret" type="password" maxlength="2048" autocomplete="new-password" placeholder="Prázdné pole zachová uložený klíč"></label>
                <div id="pbx-secret-status" class="admin-notice"></div>
              </fieldset>
              <fieldset class="setting-group">
                <legend>Předání a kontrola spojení</legend>
                <label>Klapka fronty techniků (volitelné)<input name="queueExtension" maxlength="40"></label>
                <p class="muted">Test ověří přístup k 3CX API a čtení klapky. Uložené nastavení klapky načte aplikace při příštím startu.</p>
                <div id="pbx-test-status" class="health-status" aria-live="polite"></div>
                <button id="test-pbx" type="button" class="subtle" disabled>Ověřit připojení k 3CX</button>
              </fieldset>
            </div>
            <div class="ops-actions"><button id="pbx-save" type="submit" disabled>Uložit nastavení 3CX</button><div id="pbx-message" class="health-status" role="status"></div></div>
          </form>
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
    <section id="operations-view" class="panel admin-panel" hidden>
      <h2>Provoz a logy</h2>
      <p id="operations-updated" role="status">Načítám stav služeb…</p>
      <div class="ops-layout">
        <div id="operation-checks" class="checks" aria-label="Stav součástí"></div>
        <div class="admin-box">
          <h3>Poslední příchozí hovory agenta</h3>
          <div class="table-wrap"><table class="ops-table">
            <thead><tr><th>Začátek</th><th>Konec</th><th>Volající</th><th>AI</th><th>Výsledek</th><th>Tiket</th></tr></thead>
            <tbody id="operation-calls"></tbody>
          </table></div>
        </div>
        <div class="admin-box">
          <h3>Nepřiřazené hovory z 3CX</h3>
          <div id="unlinked-calls" class="unlinked-list"><div class="muted">Načítám hovory…</div></div>
        </div>
        <div class="admin-box">
          <div class="ops-actions">
            <h3 class="section-title">Provozní logy</h3>
            <select id="component-filter" aria-label="Součást provozních logů">
              <option value="">Všechny součásti</option>
              <option value="container">Kontejner</option><option value="agent">Agent</option><option value="pbx">3CX</option>
              <option value="ispadmin">ISPadmin</option><option value="openai">OpenAI</option><option value="xai">Grok (xAI)</option>
            </select>
            <select id="severity-filter" aria-label="Úroveň provozních logů">
              <option value="">Všechny úrovně</option><option value="warn">Upozornění</option><option value="error">Chyby</option>
            </select>
          </div>
          <div class="table-wrap"><table class="ops-table">
            <thead><tr><th>Čas</th><th>Součást</th><th>Úroveň</th><th>Událost</th><th>Hovor</th></tr></thead>
            <tbody id="operation-logs"></tbody>
          </table></div>
        </div>
      </div>
    </section>
    <dialog id="ticket-detail" class="ticket-dialog">
      <div class="dialog-head"><h2 id="ticket-detail-title">Tiket</h2><form method="dialog"><button class="subtle" type="submit">Zavřít</button></form></div>
      <div id="ticket-detail-content"></div>
    </dialog>
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
    let activeView = 'requests';
    let loadedSettings = null;
    let loadedPbx = null;
    let operationEvents = [];
    let operationRequest = 0;
    let ticketRequest = 0;
    const providerNames = { openai: 'OpenAI', xai: 'Grok (xAI)' };
    const componentNames = { container: 'Kontejner', agent: 'Agent', pbx: '3CX', ispadmin: 'ISPadmin', ...providerNames };
    const outcomeNames = { active: 'Probíhá', ticket: 'Vznikl tiket', no_ticket: 'Bez tiketu', failed: 'Chyba', interrupted: 'Přerušen restartem' };
    const healthNames = { ok: 'Funguje', warning: 'Vyžaduje pozornost', error: 'Chyba' };
    const nav = document.querySelector('#workspace-nav');
    const dateFormat = new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'short', timeStyle: 'short' });
    function cell(value, className) { const td = document.createElement('td'); if (className) td.className = className; td.textContent = value || '—'; return td; }
    function formatDate(value) { return value ? dateFormat.format(new Date(value)) : '—'; }
    function stateText(item) { return statusNames[item.status] || item.status || 'Neznámý'; }
    function isAdmin() { return currentUser?.role === 'admin'; }
    function showLogin() {
      currentUser = null;
      loadedSettings = null;
      loadedPbx = null;
      operationRequest++;
      document.querySelector('#settings-ispadmin-token').value = '';
      document.querySelector('#pbx-form').elements.clientSecret.value = '';
      document.querySelector('#ticket-detail').close();
      document.querySelector('#app-view').hidden = true;
      document.querySelector('#login-view').hidden = false;
      document.querySelector('#login-form').elements.password.value = '';
    }
    function showApp(user) {
      currentUser = user;
      document.querySelector('#login-view').hidden = true;
      document.querySelector('#app-view').hidden = false;
      document.querySelector('#header-user').textContent = user.username + (isAdmin() ? ' · správce' : '');
      nav.hidden = !isAdmin();
      document.querySelector('.admin-column').hidden = !isAdmin();
      selectView('requests');
      void load();
    }
    function selectView(view) {
      if (view !== 'requests' && !isAdmin()) return;
      activeView = view;
      for (const button of nav.querySelectorAll('[data-view]')) {
        const selected = button.dataset.view === view;
        document.querySelector('#' + button.dataset.view + '-view').hidden = !selected;
        if (selected) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      }
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
      if (item.status === 'resolved') return 'Požadavek je vyřešený';
      if (item.status === 'accepted' && (item.latest_dtmf_digit === '3' || item.transfer_result === 'transferred')) return 'Spojeno s volajícím';
      if (item.status === 'accepted') return 'Převzato technikem';
      if (item.status === 'dispatching' && item.latest_attempt_status === 'connected') return 'U technika — čeká na volbu';
      if (item.status === 'unassigned') return 'Zatím nepřevzato';
      if (item.status === 'received' && item.dispatch_attempts > 0) return 'Čeká na další pokus';
      return 'Čeká na technika';
    }
    function ticketButton(number) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ticket-link';
      button.textContent = '#' + number;
      button.setAttribute('aria-label', 'Otevřít tiket ' + number);
      button.addEventListener('click', () => void openTicket(number));
      return button;
    }
    function appendRelatedCalls(target, calls) {
      for (const call of calls || []) {
        const entry = document.createElement('div'); entry.className = 'related-call';
        const summary = document.createElement('strong'); summary.textContent = [formatDate(call.started_at), call.call_direction, call.external_number].filter(Boolean).join(' · '); entry.append(summary);
        const details = document.createElement('div'); details.className = 'muted';
        details.textContent = [call.contact_name, call.agent_name || call.agent_extension, call.queue_extension ? 'Fronta ' + call.queue_extension : '', Number.isFinite(call.duration_seconds) ? Math.floor(call.duration_seconds / 60) + ' min ' + (call.duration_seconds % 60) + ' s' : ''].filter(Boolean).join(' · ');
        entry.append(details);
        if (call.recording_url) { const player = document.createElement('audio'); player.controls = true; player.preload = 'none'; player.src = call.recording_url; player.setAttribute('aria-label', 'Nahrávka hovoru'); entry.append(player); }
        else { const noRecording = document.createElement('div'); noRecording.className = 'muted'; noRecording.textContent = 'Nahrávka není k dispozici'; entry.append(noRecording); }
        target.append(entry);
      }
      if (!target.childElementCount) target.textContent = 'Zatím bez přiřazeného hovoru z 3CX';
    }
    async function openTicket(number) {
      const dialog = document.querySelector('#ticket-detail');
      const title = document.querySelector('#ticket-detail-title');
      const content = document.querySelector('#ticket-detail-content');
      const request = ++ticketRequest;
      title.textContent = 'Tiket #' + number;
      content.textContent = 'Načítám požadavek…';
      if (!dialog.open) dialog.showModal();
      try {
        const [ticket] = await api('/service-requests?ticket=' + encodeURIComponent(number));
        if (!dialog.open || request !== ticketRequest) return;
        if (!ticket) { content.textContent = 'Požadavek se nepodařilo najít.'; return; }
        const fields = [
          ['Stav', stateText(ticket)], ['Vytvořeno', formatDate(ticket.created_at)], ['Volající', ticket.caller_name],
          ['Zpětné číslo', ticket.callback_number], ['Naléhavost', urgencyNames[ticket.urgency]],
          ['Předání', acceptanceText(ticket)], ['Poslední pokus', formatDate(ticket.latest_finished_at)]
        ];
        const list = document.createElement('dl');
        for (const [label, value] of fields) {
          const term = document.createElement('dt'); term.textContent = label;
          const desc = document.createElement('dd'); desc.textContent = value || '—';
          list.append(term, desc);
        }
        const issueTitle = document.createElement('h3'); issueTitle.textContent = 'Popis požadavku';
        const issue = document.createElement('p'); issue.className = 'issue'; issue.textContent = ticket.issue_summary;
        const callTitle = document.createElement('h3'); callTitle.textContent = 'Související hovory';
        const calls = document.createElement('div'); calls.className = 'related-calls';
        appendRelatedCalls(calls, ticket.related_calls);
        content.replaceChildren(list, issueTitle, issue, callTitle, calls);
      } catch (error) { if (request === ticketRequest) content.textContent = error.message; }
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
        const ticket = document.createElement('td'); ticket.className = 'ticket'; ticket.append(ticketButton(item.ticket_number)); tr.append(ticket);
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
        appendRelatedCalls(calls, item.related_calls);
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
    async function loadSettings() {
      loadedSettings = null;
      document.querySelector('#settings-save').disabled = true;
      const settings = await api('/admin/settings');
      loadedSettings = settings;
      const model = document.querySelector('#settings-model'); model.replaceChildren();
      for (const value of settings.models) { const option = document.createElement('option'); option.value = value; option.textContent = value; model.append(option); }
      model.value = settings.openAiModel;
      document.querySelector('#settings-ispadmin-url').value = settings.ispadminApiBaseUrl || '';
      document.querySelector('#settings-role').value = settings.role;
      document.querySelector('#settings-greeting').value = settings.greeting;
      document.querySelector('#settings-prompt').value = settings.prompt;
      document.querySelector('#settings-ispadmin-token').value = '';
      document.querySelector('#settings-clear-token').checked = false;
      const tokenInput = document.querySelector('#settings-ispadmin-token');
      tokenInput.disabled = location.protocol !== 'https:' || !settings.encryptionKeyConfigured;
      const tokenStatus = document.querySelector('#settings-token-status');
      tokenStatus.textContent = settings.ispadminTokenUnreadable ? 'Uložený token nelze načíst.' : settings.hasIspadminToken ? 'API token je nastavený.' : 'API token není nastavený.';
      if (!settings.encryptionKeyConfigured) tokenStatus.textContent += ' Uložení vyžaduje na serveru nastavený APP_SETTINGS_ENCRYPTION_KEY.';
      if (location.protocol !== 'https:') tokenStatus.textContent += ' Pro zadání tokenu otevřete administraci přes HTTPS.';
      document.querySelector('#settings-provider').value = settings.voiceProvider;
      paintHealth(document.querySelector('#ispadmin-test-status'), settings.ispadminStatus);
      paintHealth(document.querySelector('#voice-test-status'), settings.aiStatus);
      updateProviderFields();
      document.querySelector('#settings-save').disabled = false;
    }
    function updateProviderFields() {
      if (!loadedSettings) return;
      const provider = document.querySelector('#settings-provider').value;
      const isXai = provider === 'xai';
      document.querySelector('#openai-model-label').hidden = isXai;
      const parts = [];
      if (isXai) parts.push('Model ' + loadedSettings.xaiModel + '.');
      if (!loadedSettings.voiceKeys[provider]) parts.push('Doplňte ' + (isXai ? 'XAI_API_KEY' : 'OPENAI_API_KEY') + ' v konfiguraci serveru.');
      if (isXai && loadedSettings.dispatchEnabled) parts.push('Předání technikovi v této instalaci používá OpenAI.');
      document.querySelector('#voice-provider-info').textContent = parts.join(' ');
      const savedModel = isXai || document.querySelector('#settings-model').value === loadedSettings.openAiModel;
      document.querySelector('#test-voice').disabled = !loadedSettings.voiceKeys[provider] || provider !== loadedSettings.voiceProvider || !savedModel;
    }
    function paintHealth(target, status) {
      const pill = document.createElement('span');
      pill.className = 'pill health-' + status.state;
      pill.textContent = healthNames[status.state];
      const detail = document.createElement('span'); detail.textContent = status.message;
      target.replaceChildren(pill, detail);
      if (status.checkedAt) {
        const time = document.createElement('time'); time.dateTime = status.checkedAt;
        time.textContent = 'Kontrola ' + formatDate(status.checkedAt);
        target.append(time);
      }
    }
    async function loadPbxConfiguration() {
      const settings = await api('/admin/settings/pbx');
      loadedPbx = settings;
      const fields = document.querySelector('#pbx-form').elements;
      fields.baseUrl.value = settings.baseUrl;
      fields.clientId.value = settings.clientId;
      fields.queueExtension.value = settings.queueExtension;
      fields.clientSecret.value = '';
      fields.clientSecret.disabled = location.protocol !== 'https:' || !settings.encryptionConfigured;
      const details = document.querySelector('#pbx-secret-status');
      details.textContent = settings.secretUnreadable ? 'Uložený 3CX API klíč nelze načíst.' : settings.hasSecret ? '3CX API klíč je nastavený.' : '3CX API klíč není nastavený.';
      if (location.protocol !== 'https:') details.textContent += ' Pro zadání klíče otevřete portál přes HTTPS.';
      if (!settings.encryptionConfigured) details.textContent += ' Uložení vyžaduje na serveru nastavený APP_SETTINGS_ENCRYPTION_KEY.';
      if (settings.restartRequired) details.textContent += ' Uložené parametry čekají na restart aplikace.';
      paintHealth(document.querySelector('#pbx-test-status'), settings.status);
      document.querySelector('#pbx-save').disabled = false;
      document.querySelector('#test-pbx').disabled = false;
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
    function emptyTable(target, columns, message) {
      const row = document.createElement('tr');
      const note = cell(message, 'empty'); note.colSpan = columns;
      row.append(note); target.append(row);
    }
    function renderOperationLogs() {
      const target = document.querySelector('#operation-logs');
      const component = document.querySelector('#component-filter').value;
      const severity = document.querySelector('#severity-filter').value;
      target.replaceChildren();
      for (const event of operationEvents) {
        if ((component && event.component !== component) || (severity && event.level !== severity)) continue;
        const row = document.createElement('tr');
        const level = document.createElement('td');
        const badge = document.createElement('span'); badge.className = 'pill health-' + ({ info: 'ok', warn: 'warning', error: 'error' }[event.level] || 'warning');
        badge.textContent = { info: 'Informace', warn: 'Upozornění', error: 'Chyba' }[event.level] || event.level;
        level.append(badge);
        const reference = cell(event.call_id?.slice(0, 8)); reference.title = event.call_id || '';
        row.append(cell(formatDate(event.created_at)), cell(componentNames[event.component] || event.component), level, cell(event.message), reference);
        target.append(row);
      }
      if (!target.childElementCount) emptyTable(target, 5, 'Filtru neodpovídají žádné provozní události.');
    }
    function renderOperations(data) {
      const checks = document.querySelector('#operation-checks');
      checks.replaceChildren();
      const names = { container: 'Kontejner a databáze', agent: 'Scénář agenta', pbx: 'Příjem hovorů z 3CX', pbxApi: '3CX API', ispadmin: 'ISPadmin', ai: providerNames[data.provider] || 'Hlasové AI' };
      for (const [key, status] of Object.entries(data.checks)) {
        const card = document.createElement('section'); card.className = 'check';
        const caption = document.createElement('h3'); caption.textContent = names[key];
        const detail = document.createElement('div'); detail.className = 'health-status';
        paintHealth(detail, status); card.append(caption, detail); checks.append(card);
      }
      const calls = document.querySelector('#operation-calls');
      calls.replaceChildren();
      for (const call of data.calls) {
        const row = document.createElement('tr'); row.title = 'Hovor ' + call.id.slice(0, 8);
        const outcome = document.createElement('td');
        const pill = document.createElement('span');
        pill.className = 'pill health-' + (call.outcome === 'ticket' ? 'ok' : call.outcome === 'failed' ? 'error' : 'warning');
        pill.textContent = outcomeNames[call.outcome] || call.outcome; outcome.append(pill);
        const ticket = cell(call.ticket_number ? String(call.ticket_number) : '—');
        if (call.ticket_number) ticket.replaceChildren(ticketButton(call.ticket_number));
        row.append(cell(formatDate(call.started_at)), cell(formatDate(call.ended_at)), cell(call.caller_number), cell(providerNames[call.provider]), outcome, ticket);
        calls.append(row);
      }
      if (!calls.childElementCount) emptyTable(calls, 6, 'Agent zatím v tomto přehledu nemá žádné hovory.');
      operationEvents = data.events;
      renderOperationLogs();
    }
    async function loadOperations() {
      const request = ++operationRequest;
      const status = document.querySelector('#operations-updated');
      try {
        const data = await api('/admin/operations');
        if (request !== operationRequest || !isAdmin()) return;
        renderOperations(data);
        status.textContent = 'Aktualizováno ' + formatDate(new Date().toISOString());
      } catch (error) {
        if (request !== operationRequest) return;
        document.querySelector('#operation-checks').replaceChildren();
        status.textContent = 'Stav provozu se nepodařilo ověřit. ' + error.message;
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
    nav.addEventListener('click', event => {
      const view = event.target.closest('[data-view]')?.dataset.view;
      if (!view || !isAdmin()) return;
      selectView(view);
      void refreshView();
    });
    async function refreshView() {
      try {
        if (activeView === 'operations') await Promise.all([loadOperations(), loadUnlinkedCalls()]);
        else if (activeView === 'settings') await Promise.all([loadUsers(), ...(loadedSettings ? [] : [loadSettings()]), ...(loadedPbx ? [] : [loadPbxConfiguration()])]);
        else await load();
      } catch (error) {
        if (activeView === 'operations') document.querySelector('#operations-updated').textContent = error.message;
        else if (activeView === 'settings') document.querySelector('#settings-message').textContent = error.message;
        else showError(error.message);
      }
    }
    document.querySelector('#settings-provider').addEventListener('change', updateProviderFields);
    document.querySelector('#settings-model').addEventListener('change', updateProviderFields);
    document.querySelector('#component-filter').addEventListener('change', renderOperationLogs);
    document.querySelector('#severity-filter').addEventListener('change', renderOperationLogs);
    document.querySelector('#settings-form').addEventListener('submit', async event => {
      event.preventDefault();
      const message = document.querySelector('#settings-message');
      const save = document.querySelector('#settings-save');
      const body = {
        ispadminApiBaseUrl: document.querySelector('#settings-ispadmin-url').value,
        ispadminApiToken: document.querySelector('#settings-ispadmin-token').value,
        clearIspadminApiToken: document.querySelector('#settings-clear-token').checked,
        voiceProvider: document.querySelector('#settings-provider').value,
        openAiModel: document.querySelector('#settings-model').value,
        role: document.querySelector('#settings-role').value,
        greeting: document.querySelector('#settings-greeting').value,
        prompt: document.querySelector('#settings-prompt').value
      };
      if (body.ispadminApiToken && location.protocol !== 'https:') {
        message.textContent = 'Pro uložení tokenu otevřete administraci přes HTTPS.'; return;
      }
      save.disabled = true; message.textContent = 'Ukládám…';
      try {
        await api('/admin/settings', { method: 'PUT', body: JSON.stringify(body) });
        await loadSettings();
        paintHealth(message, { state: 'ok', message: 'Uloženo pro nové hovory.' });
      } catch (error) {
        paintHealth(message, { state: 'error', message: error.message });
      } finally { save.disabled = !loadedSettings; }
    });
    async function verifyConnection(button, target, endpoint, body) {
      button.disabled = true; target.textContent = 'Ověřuji spojení…';
      try { paintHealth(target, await api(endpoint, { method: 'POST', body: JSON.stringify(body) })); }
      catch (error) { paintHealth(target, { state: 'error', message: error.message }); }
      finally { button.disabled = false; updateProviderFields(); }
    }
    document.querySelector('#test-ispadmin').addEventListener('click', event => {
      const body = { ispadminApiBaseUrl: document.querySelector('#settings-ispadmin-url').value, ispadminApiToken: document.querySelector('#settings-ispadmin-token').value };
      const target = document.querySelector('#ispadmin-test-status');
      if (body.ispadminApiToken && location.protocol !== 'https:') {
        paintHealth(target, { state: 'error', message: 'Pro odeslání tokenu otevřete administraci přes HTTPS.' }); return;
      }
      void verifyConnection(event.currentTarget, target, '/admin/settings/ispadmin-test', body);
    });
    document.querySelector('#test-voice').addEventListener('click', event => {
      void verifyConnection(event.currentTarget, document.querySelector('#voice-test-status'), '/admin/settings/voice-test', {});
    });
    const pbxForm = document.querySelector('#pbx-form');
    pbxForm.addEventListener('submit', async event => {
      event.preventDefault();
      const body = Object.fromEntries(new FormData(pbxForm));
      const message = document.querySelector('#pbx-message');
      const button = document.querySelector('#pbx-save');
      button.disabled = true;
      message.textContent = 'Ukládám…';
      try {
        await api('/admin/settings/pbx', { method: 'PUT', body: JSON.stringify(body) });
        await loadPbxConfiguration();
        paintHealth(message, { state: 'ok', message: 'Nastavení 3CX bylo uloženo.' });
      } catch (error) { paintHealth(message, { state: 'error', message: error.message }); }
      finally { button.disabled = !loadedPbx; }
    });
    document.querySelector('#test-pbx').addEventListener('click', event => {
      const body = Object.fromEntries(new FormData(pbxForm));
      void verifyConnection(event.currentTarget, document.querySelector('#pbx-test-status'), '/admin/settings/pbx-test', body);
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
    document.querySelector('#refresh').addEventListener('click', refreshView);
    search.addEventListener('input', render);
    filter.addEventListener('change', render);
    api('/auth/me').then(showApp).catch(() => showLogin());
    setInterval(() => {
      if (!currentUser) return;
      if (activeView === 'operations') void loadOperations();
      if (activeView === 'requests') void load();
    }, 15000);
  </script>
</body>
</html>`;

