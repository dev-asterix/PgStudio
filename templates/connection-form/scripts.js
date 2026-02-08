console.log('[PgStudio] Connection form script starting...');
window.onerror = function (msg, source, line, col, error) {
  console.error('[PgStudio] Global Error:', msg, error);
  // Try to notify VS Code if possible
  if (typeof vscode !== 'undefined') {
    vscode.postMessage({ type: 'error', error: msg });
  }
};
const vscode = acquireVsCodeApi();
const messageDiv = document.getElementById('message');
const testBtn = document.getElementById('testConnection');
const addBtn = document.getElementById('addConnection');
const form = document.getElementById('connectionForm');
const inputs = form.querySelectorAll('input');

// Injected connection data (replaced at runtime)
const connectionData = {{ CONNECTION_DATA }};

// Populate form if editing existing connection
if (connectionData) {
  document.getElementById('name').value = connectionData.name || '';
  document.getElementById('host').value = connectionData.host || '';
  document.getElementById('port').value = connectionData.port || 5432;
  document.getElementById('database').value = connectionData.database || '';
  document.getElementById('group').value = connectionData.group || '';
  document.getElementById('username').value = connectionData.username || '';
  document.getElementById('password').value = connectionData.password || '';

  // Populate advanced options
  if (connectionData.sslmode) {
    document.getElementById('sslmode').value = connectionData.sslmode;
  }
  if (connectionData.sslCertPath) {
    document.getElementById('sslCertPath').value = connectionData.sslCertPath;
  }
  if (connectionData.sslKeyPath) {
    document.getElementById('sslKeyPath').value = connectionData.sslKeyPath;
  }
  if (connectionData.sslRootCertPath) {
    document.getElementById('sslRootCertPath').value = connectionData.sslRootCertPath;
  }
  if (connectionData.statementTimeout) {
    document.getElementById('statementTimeout').value = connectionData.statementTimeout;
  }
  if (connectionData.connectTimeout) {
    document.getElementById('connectTimeout').value = connectionData.connectTimeout;
  }
  if (connectionData.applicationName) {
    document.getElementById('applicationName').value = connectionData.applicationName;
  }
  if (connectionData.options) {
    document.getElementById('options').value = connectionData.options;
  }

  // Populate safety options
  if (connectionData.environment) {
    document.getElementById('environment').value = connectionData.environment;
  }
  if (connectionData.readOnlyMode) {
    document.getElementById('readOnlyMode').checked = connectionData.readOnlyMode;
  }

  // Show advanced section if any advanced options are set
  const hasAdvancedOptions = connectionData.sslmode || connectionData.statementTimeout ||
    connectionData.connectTimeout || connectionData.applicationName || connectionData.options;
  if (hasAdvancedOptions) {
    setTimeout(() => {
      const advSection = document.getElementById('advanced-section');
      const advArrow = document.getElementById('advanced-arrow');
      advSection.style.display = 'block';
      advArrow.style.transform = 'rotate(180deg)';
      updateSSLCertFields();
    }, 100);
  }

  // SSH settings
  if (connectionData.ssh) {
    document.getElementById('sshEnabled').checked = connectionData.ssh.enabled;
    document.getElementById('sshHost').value = connectionData.ssh.host || '';
    document.getElementById('sshPort').value = connectionData.ssh.port || 22;
    document.getElementById('sshUsername').value = connectionData.ssh.username || '';
    document.getElementById('sshKeyPath').value = connectionData.ssh.privateKeyPath || '';

    // Trigger SSH UI state update
    setTimeout(() => {
      const sshSection = document.getElementById('ssh-section');
      const arrow = document.getElementById('ssh-arrow');
      sshSection.style.display = 'block';
      arrow.style.transform = 'rotate(180deg)';
      updateSSHState();
    }, 100);
  }
}

// SSH toggle
function toggleSSH() {
  const section = document.getElementById('ssh-section');
  const arrow = document.getElementById('ssh-arrow');
  if (section.style.display === 'none') {
    section.style.display = 'block';
    arrow.style.transform = 'rotate(180deg)';
  } else {
    section.style.display = 'none';
    arrow.style.transform = 'rotate(0deg)';
  }
}

function updateSSHState() {
  const enabled = document.getElementById('sshEnabled').checked;
  const fields = document.getElementById('ssh-fields');
  const inputs = fields.querySelectorAll('input');

  if (enabled) {
    fields.style.opacity = '1';
    fields.style.pointerEvents = 'auto';
    inputs.forEach(i => i.required = true);
    document.getElementById('sshKeyPath').required = true;
  } else {
    fields.style.opacity = '0.5';
    fields.style.pointerEvents = 'none';
    inputs.forEach(i => i.required = false);
  }
}

document.getElementById('sshEnabled').addEventListener('change', updateSSHState);

// Advanced Options toggle
function toggleAdvanced() {
  const section = document.getElementById('advanced-section');
  const arrow = document.getElementById('advanced-arrow');
  if (section.style.display === 'none') {
    section.style.display = 'block';
    arrow.style.transform = 'rotate(180deg)';
  } else {
    section.style.display = 'none';
    arrow.style.transform = 'rotate(0deg)';
  }
}

// SSL mode change handler - show cert fields for verify modes
function updateSSLCertFields() {
  const sslmode = document.getElementById('sslmode').value;
  const certFields = document.getElementById('ssl-cert-fields');
  if (sslmode === 'verify-ca' || sslmode === 'verify-full') {
    certFields.style.display = 'block';
    document.getElementById('sslRootCertPath').required = true;
  } else {
    certFields.style.display = 'none';
    document.getElementById('sslRootCertPath').required = false;
  }
}

document.getElementById('sslmode').addEventListener('change', updateSSLCertFields);

let isTested = false;

function showMessage(text, type = 'info') {
  const icons = {
    success: '✓',
    error: '✗',
    info: 'ℹ'
  };
  messageDiv.innerHTML = `<span class="message-icon">${icons[type]}</span><span>${text}</span>`;
  messageDiv.className = 'message ' + type;
  messageDiv.style.display = 'flex';
}

function hideMessage() {
  messageDiv.style.display = 'none';
}

function getFormData() {
  const usernameInput = document.getElementById('username').value.trim();
  const passwordInput = document.getElementById('password').value;
  const sshEnabled = document.getElementById('sshEnabled').checked;

  const data = {
    name: document.getElementById('name').value,
    host: document.getElementById('host').value,
    port: parseInt(document.getElementById('port').value),
    database: document.getElementById('database').value || 'postgres',
    group: document.getElementById('group').value || undefined,
    username: usernameInput || undefined,
    password: passwordInput || undefined,
    // Safety options
    environment: document.getElementById('environment').value || undefined,
    readOnlyMode: document.getElementById('readOnlyMode').checked || undefined,
    // Advanced options
    sslmode: document.getElementById('sslmode').value || undefined,
    sslCertPath: document.getElementById('sslCertPath').value || undefined,
    sslKeyPath: document.getElementById('sslKeyPath').value || undefined,
    sslRootCertPath: document.getElementById('sslRootCertPath').value || undefined,
    statementTimeout: document.getElementById('statementTimeout').value ? parseInt(document.getElementById('statementTimeout').value) : undefined,
    connectTimeout: document.getElementById('connectTimeout').value ? parseInt(document.getElementById('connectTimeout').value) : undefined,
    applicationName: document.getElementById('applicationName').value || undefined,
    options: document.getElementById('options').value || undefined
  };

  if (sshEnabled) {
    data.ssh = {
      enabled: true,
      host: document.getElementById('sshHost').value,
      port: parseInt(document.getElementById('sshPort').value),
      username: document.getElementById('sshUsername').value,
      privateKeyPath: document.getElementById('sshKeyPath').value
    };
  }

  return data;
}

// Reset tested state on any input change
inputs.forEach(input => {
  input.addEventListener('input', () => {
    if (isTested) {
      isTested = false;
      addBtn.classList.add('hidden');
      testBtn.classList.remove('hidden');
      hideMessage();
    }
  });
});

testBtn.addEventListener('click', () => {
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  hideMessage();
  testBtn.disabled = true;
  testBtn.innerHTML = '<span class="btn-icon">⏳</span><span>Testing...</span>';

  vscode.postMessage({
    command: 'testConnection',
    connection: getFormData()
  });
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!isTested) return;

  hideMessage();
  addBtn.disabled = true;
  addBtn.innerHTML = '<span class="btn-icon">⏳</span><span>Saving...</span>';

  vscode.postMessage({
    command: 'saveConnection',
    connection: getFormData()
  });
});

window.addEventListener('message', event => {
  const message = event.data;
  testBtn.disabled = false;
  testBtn.innerHTML = '<span class="btn-icon">⚡</span><span>Test Connection</span>';
  addBtn.disabled = false;
  addBtn.innerHTML = '<span class="btn-icon">✓</span><span>Add Connection</span>';

  switch (message.type) {
    case 'testSuccess':
      showMessage('Connection successful! ' + message.version, 'success');
      isTested = true;
      testBtn.classList.add('hidden');
      addBtn.classList.remove('hidden');
      break;
    case 'testError':
      showMessage('Connection failed: ' + message.error, 'error');
      isTested = false;
      addBtn.classList.add('hidden');
      testBtn.classList.remove('hidden');
      break;
  }
});
