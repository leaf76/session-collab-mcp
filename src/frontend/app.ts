// Frontend App - Session Collab MCP Dashboard
// Security: All user-provided content is escaped via escapeHtml() before DOM insertion

export function generateAppHtml(origin: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Session Collab MCP - Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg-primary: #0f0f1a;
      --bg-secondary: #1a1a2e;
      --bg-card: #16213e;
      --bg-input: #0d1b2a;
      --text-primary: #e4e4e7;
      --text-secondary: #a1a1aa;
      --text-muted: #71717a;
      --accent-blue: #60a5fa;
      --accent-purple: #a78bfa;
      --accent-green: #22c55e;
      --accent-red: #ef4444;
      --accent-yellow: #eab308;
      --border: #2d2d3a;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      min-height: 100vh;
      line-height: 1.6;
    }

    .app { display: flex; flex-direction: column; min-height: 100vh; }

    header {
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      padding: 1rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .logo {
      font-size: 1.25rem;
      font-weight: 700;
      background: linear-gradient(90deg, var(--accent-blue), var(--accent-purple));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .user-info { display: flex; align-items: center; gap: 1rem; }
    .user-email { color: var(--text-secondary); font-size: 0.875rem; }

    main {
      flex: 1;
      padding: 2rem;
      max-width: 1200px;
      margin: 0 auto;
      width: 100%;
    }

    .auth-container { max-width: 400px; margin: 4rem auto; }

    .auth-card {
      background: var(--bg-card);
      border-radius: 12px;
      padding: 2rem;
      border: 1px solid var(--border);
    }

    .auth-tabs {
      display: flex;
      margin-bottom: 1.5rem;
      border-bottom: 1px solid var(--border);
    }

    .auth-tab {
      flex: 1;
      padding: 0.75rem;
      background: none;
      border: none;
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 1rem;
    }

    .auth-tab.active {
      color: var(--accent-blue);
      border-bottom: 2px solid var(--accent-blue);
      margin-bottom: -1px;
    }

    .form-group { margin-bottom: 1rem; }

    label {
      display: block;
      margin-bottom: 0.5rem;
      color: var(--text-secondary);
      font-size: 0.875rem;
    }

    input[type="text"],
    input[type="email"],
    input[type="password"],
    input[type="number"] {
      width: 100%;
      padding: 0.75rem 1rem;
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text-primary);
      font-size: 1rem;
    }

    input:focus { outline: none; border-color: var(--accent-blue); }

    .btn {
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      border: none;
    }

    .btn-primary {
      background: linear-gradient(90deg, var(--accent-blue), var(--accent-purple));
      color: white;
      width: 100%;
    }

    .btn-secondary {
      background: var(--bg-secondary);
      color: var(--text-primary);
      border: 1px solid var(--border);
    }

    .btn-danger { background: var(--accent-red); color: white; }
    .btn-sm { padding: 0.5rem 1rem; font-size: 0.75rem; }

    .dashboard { display: none; }
    .dashboard.active { display: block; }
    .auth-container.hidden { display: none; }

    .dashboard-grid {
      display: grid;
      grid-template-columns: 300px 1fr;
      gap: 1.5rem;
      align-items: start;
    }

    @media (max-width: 768px) {
      .dashboard-grid {
        grid-template-columns: 1fr;
      }
    }

    .card {
      background: var(--bg-card);
      border-radius: 12px;
      padding: 1.5rem;
      border: 1px solid var(--border);
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
    }

    .card-title { font-size: 1.125rem; font-weight: 600; }

    .token-list, .session-list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .session-list {
      max-height: 70vh;
      overflow-y: auto;
      padding-right: 0.5rem;
    }

    .session-list::-webkit-scrollbar {
      width: 6px;
    }

    .session-list::-webkit-scrollbar-track {
      background: var(--bg-input);
      border-radius: 3px;
    }

    .session-list::-webkit-scrollbar-thumb {
      background: var(--border);
      border-radius: 3px;
    }

    .session-list::-webkit-scrollbar-thumb:hover {
      background: var(--text-muted);
    }

    .token-item, .session-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem;
      background: var(--bg-secondary);
      border-radius: 8px;
      border: 1px solid var(--border);
    }

    .token-info h4, .session-info h4 {
      font-size: 0.875rem;
      font-weight: 500;
      margin-bottom: 0.25rem;
    }

    .token-meta, .session-meta {
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    .token-prefix {
      font-family: monospace;
      background: var(--bg-input);
      padding: 0.125rem 0.5rem;
      border-radius: 4px;
    }

    .status-badge {
      padding: 0.25rem 0.5rem;
      border-radius: 9999px;
      font-size: 0.625rem;
      font-weight: 600;
      text-transform: uppercase;
    }

    .status-active { background: rgba(34, 197, 94, 0.2); color: var(--accent-green); }
    .status-inactive { background: rgba(234, 179, 8, 0.2); color: var(--accent-yellow); }

    .alert {
      padding: 0.75rem 1rem;
      border-radius: 8px;
      margin-bottom: 1rem;
      font-size: 0.875rem;
    }

    .alert-error {
      background: rgba(239, 68, 68, 0.2);
      color: var(--accent-red);
    }

    .alert-success {
      background: rgba(34, 197, 94, 0.2);
      color: var(--accent-green);
    }

    .modal-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .modal-overlay.active { display: flex; }

    .modal {
      background: var(--bg-card);
      border-radius: 12px;
      padding: 2rem;
      max-width: 500px;
      width: 90%;
      border: 1px solid var(--border);
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
    }

    .modal-title { font-size: 1.25rem; font-weight: 600; }

    .modal-close {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 1.5rem;
    }

    .token-display {
      background: var(--bg-input);
      padding: 1rem;
      border-radius: 8px;
      font-family: monospace;
      font-size: 0.875rem;
      word-break: break-all;
      margin: 1rem 0;
      border: 1px solid var(--accent-green);
    }

    .token-warning {
      color: var(--accent-yellow);
      font-size: 0.75rem;
    }

    .empty-state {
      text-align: center;
      padding: 2rem;
      color: var(--text-muted);
    }

    .empty-state p { margin-bottom: 1rem; }

    .setup-guide {
      grid-column: 1 / -1;
    }

    .setup-guide .collapsible-content {
      max-height: 0;
      overflow: hidden;
    }

    .setup-guide .collapsible-content.expanded {
      max-height: 800px;
      overflow-y: auto;
    }

    .setup-steps {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .setup-step {
      display: flex;
      gap: 1rem;
      padding: 1rem;
      background: var(--bg-secondary);
      border-radius: 8px;
      border: 1px solid var(--border);
    }

    .step-number {
      width: 28px;
      height: 28px;
      background: linear-gradient(90deg, var(--accent-blue), var(--accent-purple));
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 0.875rem;
      flex-shrink: 0;
    }

    .step-content h4 {
      font-size: 0.9375rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }

    .step-content p {
      font-size: 0.8125rem;
      color: var(--text-secondary);
      margin-bottom: 0.5rem;
    }

    .code-block {
      background: var(--bg-input);
      padding: 0.75rem 1rem;
      border-radius: 6px;
      font-family: monospace;
      font-size: 0.75rem;
      overflow-x: auto;
      white-space: pre;
      color: var(--accent-green);
      border: 1px solid var(--border);
    }

    .copy-btn {
      background: var(--bg-card);
      border: 1px solid var(--border);
      color: var(--text-secondary);
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.625rem;
      cursor: pointer;
      margin-left: 0.5rem;
    }

    .copy-btn:hover {
      background: var(--bg-secondary);
      color: var(--text-primary);
    }

    .collapsible-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
    }

    .collapsible-content {
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.3s ease;
    }

    .collapsible-content.expanded {
      max-height: 2000px;
    }

    .expand-icon {
      transition: transform 0.3s ease;
    }

    .expand-icon.rotated {
      transform: rotate(180deg);
    }

    .session-item {
      flex-direction: column;
      align-items: stretch;
      gap: 0.75rem;
    }

    .session-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .current-task {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      background: rgba(96, 165, 250, 0.1);
      border-radius: 6px;
      border-left: 3px solid var(--accent-blue);
      font-size: 0.8125rem;
      color: var(--text-primary);
    }

    .current-task-label {
      color: var(--accent-blue);
      font-weight: 500;
      font-size: 0.75rem;
    }

    .session-todos {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
      padding-top: 0.5rem;
      border-top: 1px solid var(--border);
    }

    .todo-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.375rem 0.5rem;
      background: var(--bg-input);
      border-radius: 4px;
      font-size: 0.75rem;
    }

    .todo-status {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .todo-status.pending { background: var(--text-muted); }
    .todo-status.in_progress {
      background: var(--accent-blue);
      box-shadow: 0 0 6px var(--accent-blue);
      animation: pulse 1.5s ease-in-out infinite;
    }
    .todo-status.completed { background: var(--accent-green); }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .todo-order {
      color: var(--text-muted);
      font-size: 0.625rem;
      font-weight: 600;
      min-width: 1rem;
    }

    .todo-content {
      flex: 1;
      color: var(--text-secondary);
    }

    .todo-item.in_progress .todo-content {
      color: var(--accent-blue);
      font-weight: 500;
    }

    .todo-item.completed .todo-content {
      color: var(--text-muted);
      text-decoration: line-through;
    }

    .loading { text-align: center; padding: 2rem; }

    .spinner {
      display: inline-block;
      width: 24px;
      height: 24px;
      border: 2px solid var(--border);
      border-top-color: var(--accent-blue);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    @media (max-width: 640px) {
      header { padding: 1rem; }
      main { padding: 1rem; }
      .dashboard-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="app">
    <header>
      <div class="logo">Session Collab MCP</div>
      <div class="user-info" id="userInfo" style="display: none;">
        <span class="user-email" id="userEmail"></span>
        <button class="btn btn-secondary btn-sm" id="logoutBtn">Logout</button>
      </div>
    </header>

    <main>
      <div class="auth-container" id="authContainer">
        <div class="auth-card">
          <div class="auth-tabs">
            <button class="auth-tab active" data-tab="login" id="loginTab">Login</button>
            <button class="auth-tab" data-tab="register" id="registerTab">Register</button>
          </div>

          <div id="authAlert"></div>

          <form id="loginForm">
            <div class="form-group">
              <label for="loginEmail">Email</label>
              <input type="email" id="loginEmail" placeholder="you@example.com" required>
            </div>
            <div class="form-group">
              <label for="loginPassword">Password</label>
              <input type="password" id="loginPassword" placeholder="Your password" required>
            </div>
            <button type="submit" class="btn btn-primary">Login</button>
          </form>

          <form id="registerForm" style="display: none;">
            <div class="form-group">
              <label for="registerName">Display Name</label>
              <input type="text" id="registerName" placeholder="Your name">
            </div>
            <div class="form-group">
              <label for="registerEmail">Email</label>
              <input type="email" id="registerEmail" placeholder="you@example.com" required>
            </div>
            <div class="form-group">
              <label for="registerPassword">Password</label>
              <input type="password" id="registerPassword" placeholder="Min 8 chars" required>
            </div>
            <button type="submit" class="btn btn-primary">Create Account</button>
          </form>
        </div>
      </div>

      <div class="dashboard" id="dashboard">
        <div class="dashboard-grid">
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">API Tokens</h3>
              <button class="btn btn-secondary btn-sm" id="newTokenBtn">+ New Token</button>
            </div>
            <div id="tokenList" class="token-list"></div>
          </div>

          <div class="card">
            <div class="card-header">
              <h3 class="card-title">Active Sessions</h3>
              <button class="btn btn-secondary btn-sm" id="refreshSessionsBtn">Refresh</button>
            </div>
            <div id="sessionList" class="session-list"></div>
          </div>

          <div class="card setup-guide">
            <div class="card-header collapsible-header" id="setupGuideHeader">
              <h3 class="card-title">Setup Guide</h3>
              <span class="expand-icon" id="expandIcon">&#9660;</span>
            </div>
            <div class="collapsible-content" id="setupGuideContent">
              <div class="setup-steps">
                <div class="setup-step">
                  <div class="step-number">1</div>
                  <div class="step-content">
                    <h4>Save API Token</h4>
                    <p>Copy your token and save it to ~/.claude/.env</p>
                    <div class="code-block" id="envCode">MCP_TOKEN="your-token-here"</div>
                  </div>
                </div>

                <div class="setup-step">
                  <div class="step-number">2</div>
                  <div class="step-content">
                    <h4>Create Hook Scripts</h4>
                    <p>Create .claude/hooks/ directory in your project and add these scripts:</p>
                    <div class="code-block">mkdir -p .claude/hooks</div>
                  </div>
                </div>

                <div class="setup-step">
                  <div class="step-number">3</div>
                  <div class="step-content">
                    <h4>Configure .claude/settings.json</h4>
                    <p>Add hooks configuration to your project:</p>
                    <div class="code-block" id="settingsCode">{
  "hooks": {
    "SessionStart": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "bash .claude/hooks/session-start.sh my-session"
      }]
    }],
    "PreToolUse": [{
      "matcher": "Edit|Write",
      "hooks": [{
        "type": "command",
        "command": "bash .claude/hooks/check-claims.sh"
      }]
    }],
    "PostToolUse": [{
      "matcher": "TodoWrite",
      "hooks": [{
        "type": "command",
        "command": "bash .claude/hooks/todo-sync.sh"
      }]
    }]
  }
}</div>
                    <button class="btn btn-secondary btn-sm" id="copySettingsBtn" style="margin-top: 0.5rem;">Copy JSON</button>
                  </div>
                </div>

                <div class="setup-step">
                  <div class="step-number">4</div>
                  <div class="step-content">
                    <h4>Download Hook Scripts</h4>
                    <p>Get the hook scripts from the repository or create them manually:</p>
                    <div class="code-block"># session-start.sh - Register session on new conversation
# check-claims.sh  - Check file conflicts before editing
# todo-sync.sh     - Sync todo list after updates

# See CLAUDE.md in the repo for full script contents</div>
                  </div>
                </div>

                <div class="setup-step">
                  <div class="step-number">5</div>
                  <div class="step-content">
                    <h4>Restart Claude Code</h4>
                    <p>Start a new conversation to activate the hooks. You should see your session appear above!</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>

  <div class="modal-overlay" id="createTokenModal">
    <div class="modal">
      <div class="modal-header">
        <h3 class="modal-title">Create API Token</h3>
        <button class="modal-close" id="closeCreateModal">&times;</button>
      </div>
      <form id="createTokenForm">
        <div class="form-group">
          <label for="tokenName">Token Name</label>
          <input type="text" id="tokenName" placeholder="e.g., Claude Code" required>
        </div>
        <div class="form-group">
          <label for="tokenExpiry">Expires In (days)</label>
          <input type="number" id="tokenExpiry" placeholder="Leave empty for no expiry" min="1" max="365">
        </div>
        <button type="submit" class="btn btn-primary">Create Token</button>
      </form>
    </div>
  </div>

  <div class="modal-overlay" id="tokenCreatedModal">
    <div class="modal">
      <div class="modal-header">
        <h3 class="modal-title">Token Created</h3>
        <button class="modal-close" id="closeTokenModal">&times;</button>
      </div>
      <p>Copy your token now - it won't be shown again!</p>
      <div class="token-display" id="newTokenValue"></div>
      <p class="token-warning">Store this token securely.</p>
      <button class="btn btn-primary" id="copyTokenBtn">Copy to Clipboard</button>
    </div>
  </div>

  <script>
    (function() {
      const API_BASE = '${origin}';
      let accessToken = localStorage.getItem('accessToken');
      let refreshToken = localStorage.getItem('refreshToken');
      let currentUser = null;

      // DOM elements
      const $ = (id) => document.getElementById(id);

      // Safe text content setter
      function setText(el, text) {
        if (el) el.textContent = text || '';
      }

      // Safe element creation
      function createEl(tag, className, text) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text) el.textContent = text;
        return el;
      }

      // Initialize
      document.addEventListener('DOMContentLoaded', init);

      function init() {
        // Event listeners
        $('loginTab').addEventListener('click', () => switchTab('login'));
        $('registerTab').addEventListener('click', () => switchTab('register'));
        $('loginForm').addEventListener('submit', handleLogin);
        $('registerForm').addEventListener('submit', handleRegister);
        $('logoutBtn').addEventListener('click', logout);
        $('newTokenBtn').addEventListener('click', openCreateTokenModal);
        $('refreshSessionsBtn').addEventListener('click', loadSessions);
        $('closeCreateModal').addEventListener('click', () => closeModal('createTokenModal'));
        $('closeTokenModal').addEventListener('click', () => closeModal('tokenCreatedModal'));
        $('createTokenForm').addEventListener('submit', handleCreateToken);
        $('copyTokenBtn').addEventListener('click', copyToken);
        $('setupGuideHeader').addEventListener('click', toggleSetupGuide);
        $('copySettingsBtn').addEventListener('click', copySettings);

        if (accessToken) checkAuth();
      }

      function switchTab(tab) {
        $('loginTab').classList.toggle('active', tab === 'login');
        $('registerTab').classList.toggle('active', tab === 'register');
        $('loginForm').style.display = tab === 'login' ? 'block' : 'none';
        $('registerForm').style.display = tab === 'register' ? 'block' : 'none';
        $('authAlert').textContent = '';
      }

      function showAlert(type, message) {
        const alert = $('authAlert');
        alert.className = 'alert alert-' + type;
        alert.textContent = message;
      }

      async function handleLogin(e) {
        e.preventDefault();
        const email = $('loginEmail').value;
        const password = $('loginPassword').value;

        try {
          const res = await fetch(API_BASE + '/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
          });

          const data = await res.json();
          if (!res.ok) {
            showAlert('error', data.error || 'Login failed');
            return;
          }

          saveAuth(data);
          showDashboard();
        } catch (err) {
          showAlert('error', 'Network error');
        }
      }

      async function handleRegister(e) {
        e.preventDefault();
        const display_name = $('registerName').value;
        const email = $('registerEmail').value;
        const password = $('registerPassword').value;

        try {
          const res = await fetch(API_BASE + '/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, display_name })
          });

          const data = await res.json();
          if (!res.ok) {
            const msg = data.details ? data.details.map(d => d.message).join(', ') : data.error;
            showAlert('error', msg || 'Registration failed');
            return;
          }

          saveAuth(data);
          showDashboard();
        } catch (err) {
          showAlert('error', 'Network error');
        }
      }

      function saveAuth(data) {
        accessToken = data.access_token;
        refreshToken = data.refresh_token;
        currentUser = data.user;
        localStorage.setItem('accessToken', accessToken);
        localStorage.setItem('refreshToken', refreshToken);
      }

      async function checkAuth() {
        try {
          const res = await fetch(API_BASE + '/auth/me', {
            headers: { 'Authorization': 'Bearer ' + accessToken }
          });

          if (res.ok) {
            currentUser = await res.json();
            showDashboard();
          } else if (res.status === 401 && refreshToken) {
            await doRefresh();
          } else {
            logout();
          }
        } catch (err) {
          logout();
        }
      }

      async function doRefresh() {
        try {
          const res = await fetch(API_BASE + '/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken })
          });

          if (res.ok) {
            const data = await res.json();
            saveAuth(data);
            showDashboard();
          } else {
            logout();
          }
        } catch (err) {
          logout();
        }
      }

      function logout() {
        accessToken = null;
        refreshToken = null;
        currentUser = null;
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        showAuth();
      }

      function showAuth() {
        $('authContainer').classList.remove('hidden');
        $('dashboard').classList.remove('active');
        $('userInfo').style.display = 'none';
      }

      function showDashboard() {
        $('authContainer').classList.add('hidden');
        $('dashboard').classList.add('active');
        $('userInfo').style.display = 'flex';
        setText($('userEmail'), currentUser?.email);
        loadTokens();
        loadSessions();
      }

      async function loadTokens() {
        const container = $('tokenList');
        container.textContent = '';
        const loading = createEl('div', 'loading');
        loading.appendChild(createEl('div', 'spinner'));
        container.appendChild(loading);

        try {
          const res = await fetch(API_BASE + '/tokens', {
            headers: { 'Authorization': 'Bearer ' + accessToken }
          });

          if (!res.ok) throw new Error('Failed');
          const data = await res.json();
          container.textContent = '';

          if (data.tokens.length === 0) {
            const empty = createEl('div', 'empty-state');
            empty.appendChild(createEl('p', '', 'No API tokens yet'));
            const btn = createEl('button', 'btn btn-secondary btn-sm', 'Create your first token');
            btn.addEventListener('click', openCreateTokenModal);
            empty.appendChild(btn);
            container.appendChild(empty);
            return;
          }

          data.tokens.forEach(token => {
            const item = createEl('div', 'token-item');

            const info = createEl('div', 'token-info');
            info.appendChild(createEl('h4', '', token.name));

            const meta = createEl('div', 'token-meta');
            const prefix = createEl('span', 'token-prefix', token.token_prefix + '...');
            meta.appendChild(prefix);
            meta.appendChild(document.createTextNode(' Created ' + formatDate(token.created_at)));
            info.appendChild(meta);

            const btn = createEl('button', 'btn btn-danger btn-sm', 'Revoke');
            btn.addEventListener('click', () => revokeToken(token.id));

            item.appendChild(info);
            item.appendChild(btn);
            container.appendChild(item);
          });
        } catch (err) {
          container.textContent = '';
          const empty = createEl('div', 'empty-state');
          empty.appendChild(createEl('p', '', 'Failed to load tokens'));
          container.appendChild(empty);
        }
      }

      function openCreateTokenModal() {
        $('createTokenModal').classList.add('active');
        $('tokenName').value = '';
        $('tokenExpiry').value = '';
      }

      function closeModal(id) {
        $(id).classList.remove('active');
      }

      async function handleCreateToken(e) {
        e.preventDefault();
        const name = $('tokenName').value;
        const expiryVal = $('tokenExpiry').value;
        const body = { name };
        if (expiryVal) body.expires_in_days = parseInt(expiryVal);

        try {
          const res = await fetch(API_BASE + '/tokens', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + accessToken
            },
            body: JSON.stringify(body)
          });

          if (!res.ok) throw new Error('Failed');
          const data = await res.json();

          closeModal('createTokenModal');
          setText($('newTokenValue'), data.token.token);
          $('tokenCreatedModal').classList.add('active');
          loadTokens();
        } catch (err) {
          alert('Failed to create token');
        }
      }

      async function revokeToken(id) {
        if (!confirm('Revoke this token?')) return;

        try {
          const res = await fetch(API_BASE + '/tokens/' + id, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + accessToken }
          });

          if (!res.ok) throw new Error('Failed');
          loadTokens();
        } catch (err) {
          alert('Failed to revoke token');
        }
      }

      function copyToken() {
        const token = $('newTokenValue').textContent;
        navigator.clipboard.writeText(token).then(() => {
          alert('Copied!');
          closeModal('tokenCreatedModal');
        });
      }

      function toggleSetupGuide() {
        const content = $('setupGuideContent');
        const icon = $('expandIcon');
        content.classList.toggle('expanded');
        icon.classList.toggle('rotated');
      }

      function copySettings() {
        const settingsJson = \`{
  "hooks": {
    "SessionStart": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "bash .claude/hooks/session-start.sh my-session"
      }]
    }],
    "PreToolUse": [{
      "matcher": "Edit|Write",
      "hooks": [{
        "type": "command",
        "command": "bash .claude/hooks/check-claims.sh"
      }]
    }],
    "PostToolUse": [{
      "matcher": "TodoWrite",
      "hooks": [{
        "type": "command",
        "command": "bash .claude/hooks/todo-sync.sh"
      }]
    }]
  }
}\`;
        navigator.clipboard.writeText(settingsJson).then(() => {
          const btn = $('copySettingsBtn');
          const originalText = btn.textContent;
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = originalText; }, 2000);
        });
      }

      async function loadSessions() {
        const container = $('sessionList');
        container.textContent = '';
        const loading = createEl('div', 'loading');
        loading.appendChild(createEl('div', 'spinner'));
        container.appendChild(loading);

        try {
          const res = await fetch(API_BASE + '/mcp', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + accessToken
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/call',
              params: {
                name: 'collab_session_list',
                arguments: { include_inactive: false }
              }
            })
          });

          if (!res.ok) throw new Error('Failed');
          const data = await res.json();
          const result = JSON.parse(data.result.content[0].text);
          container.textContent = '';

          if (result.sessions.length === 0) {
            const empty = createEl('div', 'empty-state');
            empty.appendChild(createEl('p', '', 'No active sessions'));
            container.appendChild(empty);
            return;
          }

          result.sessions.forEach(session => {
            const item = createEl('div', 'session-item');

            // Session header with info and status badge
            const header = createEl('div', 'session-header');

            const info = createEl('div', 'session-info');
            info.appendChild(createEl('h4', '', session.name || session.id.slice(0, 8)));

            const meta = createEl('div', 'session-meta');
            // Show only the last part of the path for brevity
            const projectName = session.project_root ? session.project_root.split('/').pop() : 'No project';
            meta.textContent = projectName + ' - ' + formatDate(session.last_heartbeat);
            info.appendChild(meta);

            const badge = createEl('span', 'status-badge status-' + session.status, session.status);

            header.appendChild(info);
            header.appendChild(badge);
            item.appendChild(header);

            // Current task display
            if (session.current_task) {
              const taskEl = createEl('div', 'current-task');
              taskEl.appendChild(createEl('span', 'current-task-label', 'Working on:'));
              taskEl.appendChild(createEl('span', '', session.current_task));
              item.appendChild(taskEl);
            }

            // Todo list display
            if (session.todos && session.todos.length > 0) {
              const todosEl = createEl('div', 'session-todos');

              session.todos.forEach((todo, index) => {
                const todoItem = createEl('div', 'todo-item ' + todo.status);

                const statusDot = createEl('span', 'todo-status ' + todo.status);
                const orderNum = createEl('span', 'todo-order', String(index + 1));
                const content = createEl('span', 'todo-content', todo.content);

                todoItem.appendChild(statusDot);
                todoItem.appendChild(orderNum);
                todoItem.appendChild(content);
                todosEl.appendChild(todoItem);
              });

              item.appendChild(todosEl);
            }

            container.appendChild(item);
          });
        } catch (err) {
          container.textContent = '';
          const empty = createEl('div', 'empty-state');
          empty.appendChild(createEl('p', '', 'Failed to load sessions'));
          container.appendChild(empty);
        }
      }

      function formatDate(dateStr) {
        const date = new Date(dateStr);
        const diff = Date.now() - date.getTime();
        if (diff < 60000) return 'just now';
        if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
        if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
        return date.toLocaleDateString();
      }
    })();
  </script>
</body>
</html>`;
}
