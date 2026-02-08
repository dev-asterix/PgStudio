// DEBUG: Initialization Logger
console.log('[PgStudio] Chat script starting...');
window.onerror = function (message, source, lineno, colno, error) {
  console.error('[PgStudio] Global Error:', message, error);
  if (typeof vscode !== 'undefined') {
    vscode.postMessage({ type: 'error', error: message });
  }
};
const vscode = acquireVsCodeApi();
console.log('[PgStudio] VS Code API acquired');

const messagesContainer = document.getElementById('messagesContainer');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const stopBtn = document.getElementById('stopBtn');
const attachBtn = document.getElementById('attachBtn');
const emptyState = document.getElementById('emptyState');
const typingIndicator = document.getElementById('typingIndicator');
const loadingText = document.getElementById('loadingText');
const attachmentsContainer = document.getElementById('attachmentsContainer');
const inputWrapper = document.getElementById('inputWrapper');
const historyOverlay = document.getElementById('historyOverlay');
const historyList = document.getElementById('historyList');
const historySearch = document.getElementById('historySearch');
const mentionPicker = document.getElementById('mentionPicker');
const mentionSearch = document.getElementById('mentionSearch');
const mentionList = document.getElementById('mentionList');
const mentionBtn = document.getElementById('mentionBtn');

let attachedFiles = [];
let loadingInterval = null;
let typingAnimation = null;
let chatHistory = [];
let dbObjects = [];
let selectedMentions = [];
let mentionPickerVisible = false;
let selectedMentionIndex = -1;
let searchDebounceTimer = null;
let currentHierarchyPath = {
    connection: null,
    database: null,
    schema: null
};

// Hierarchy Navigation
function navigateToRoot() {
    currentHierarchyPath = { connection: null, database: null, schema: null };
    vscode.postMessage({ type: 'getDbHierarchy', path: {} });
    renderBreadcrumbs();
    mentionList.innerHTML = '<div class="mention-picker-loading">Loading connections...</div>';
}

function navigateToConnection(id, name) {
    currentHierarchyPath = { 
        connection: { id, name }, 
        database: null, 
        schema: null 
    };
    vscode.postMessage({ type: 'getDbHierarchy', path: { connectionId: id } });
    renderBreadcrumbs();
    mentionList.innerHTML = '<div class="mention-picker-loading">Loading databases...</div>';
}

function navigateToDatabase(dbName) {
    if (!currentHierarchyPath.connection) return;
    currentHierarchyPath.database = dbName;
    currentHierarchyPath.schema = null;
    vscode.postMessage({ 
        type: 'getDbHierarchy', 
        path: { 
            connectionId: currentHierarchyPath.connection.id,
            database: dbName
        } 
    });
    renderBreadcrumbs();
    mentionList.innerHTML = '<div class="mention-picker-loading">Loading schemas...</div>';
}

function navigateToSchema(schemaName) {
    if (!currentHierarchyPath.connection || !currentHierarchyPath.database) return;
    currentHierarchyPath.schema = schemaName;
    vscode.postMessage({ 
        type: 'getDbHierarchy', 
        path: { 
            connectionId: currentHierarchyPath.connection.id,
            database: currentHierarchyPath.database,
            schema: schemaName
        } 
    });
    renderBreadcrumbs();
    mentionList.innerHTML = '<div class="mention-picker-loading">Loading objects...</div>';
}

function renderBreadcrumbs() {
    const container = document.getElementById('mentionBreadcrumbs');
    if (!container) return;
    
    let html = `<div class="mention-breadcrumb-item" onclick="navigateToRoot()">Home</div>`;
    
    if (currentHierarchyPath.connection) {
        html += `<span class="mention-breadcrumb-separator">/</span>`;
        html += `<div class="mention-breadcrumb-item" onclick="navigateToConnection('${currentHierarchyPath.connection.id}', '${escapeHtml(currentHierarchyPath.connection.name)}')">${escapeHtml(currentHierarchyPath.connection.name)}</div>`;
    }
    
    if (currentHierarchyPath.database) {
        html += `<span class="mention-breadcrumb-separator">/</span>`;
        html += `<div class="mention-breadcrumb-item" onclick="navigateToDatabase('${escapeHtml(currentHierarchyPath.database)}')">${escapeHtml(currentHierarchyPath.database)}</div>`;
    }
    
    if (currentHierarchyPath.schema) {
        html += `<span class="mention-breadcrumb-separator">/</span>`;
        html += `<div class="mention-breadcrumb-item" onclick="navigateToSchema('${escapeHtml(currentHierarchyPath.schema)}')">${escapeHtml(currentHierarchyPath.schema)}</div>`;
    }
    
    container.innerHTML = html;
}

function handleContainerClick(index) {
    const obj = dbObjects[index];
    if (obj.type === 'connection') {
        navigateToConnection(obj.connectionId, obj.name);
    } else if (obj.type === 'database') {
        navigateToDatabase(obj.name);
    } else if (obj.type === 'schema') {
        navigateToSchema(obj.name);
    }
}

// History functions
function toggleHistory() {
  historyOverlay.classList.toggle('visible');
  if (historyOverlay.classList.contains('visible')) {
    vscode.postMessage({ type: 'getHistory' });
    historySearch.focus();
  }
}

function closeHistory(event) {
  if (event.target === historyOverlay) {
    historyOverlay.classList.remove('visible');
  }
}

function loadSession(sessionId) {
  vscode.postMessage({ type: 'loadSession', sessionId });
  historyOverlay.classList.remove('visible');
}

let pendingDeleteId = null;

function deleteSession(sessionId, event) {
  console.log('[WebView] deleteSession called with sessionId:', sessionId, 'event:', event);
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }

  // If already pending for this session, confirm delete
  if (pendingDeleteId === sessionId) {
    console.log('[WebView] Confirmed delete for:', sessionId);
    vscode.postMessage({ type: 'deleteSession', sessionId });
    pendingDeleteId = null;
    return;
  }

  // First click - show confirmation state
  console.log('[WebView] First click, setting pending delete for:', sessionId);
  if (pendingDeleteId) {
    // Reset any other pending delete
    const prevBtn = document.querySelector(`[data-pending-delete="${pendingDeleteId}"]`);
    if (prevBtn) {
      prevBtn.removeAttribute('data-pending-delete');
      prevBtn.classList.remove('confirm-delete');
    }
  }

  pendingDeleteId = sessionId;
  const btn = event.currentTarget || event.target.closest('.history-item-delete');
  if (btn) {
    btn.setAttribute('data-pending-delete', sessionId);
    btn.classList.add('confirm-delete');
  }

  // Auto-reset after 3 seconds
  setTimeout(() => {
    if (pendingDeleteId === sessionId) {
      pendingDeleteId = null;
      if (btn) {
        btn.removeAttribute('data-pending-delete');
        btn.classList.remove('confirm-delete');
      }
    }
  }, 3000);
}

function newChat() {
  vscode.postMessage({ type: 'newChat' });
}

function openAiSettings() {
  vscode.postMessage({ type: 'openAiSettings' });
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return 'Today ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (days === 1) {
    return 'Yesterday ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (days < 7) {
    return date.toLocaleDateString([], { weekday: 'short' }) + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}

function renderHistory(sessions) {
  console.log('[WebView] renderHistory called with', sessions?.length, 'sessions');
  chatHistory = sessions;
  filterHistory(historySearch.value);
}

function filterHistory(query) {
  const filtered = query
    ? chatHistory.filter(s => s.title.toLowerCase().includes(query.toLowerCase()))
    : chatHistory;

  if (filtered.length === 0) {
    historyList.innerHTML = '<div class="history-empty">' + (query ? 'No matching chats found' : 'No chat history yet') + '</div>';
    return;
  }

  historyList.innerHTML = filtered.map(session => `
                <div class="history-item ${session.isActive ? 'active' : ''}" onclick="loadSession('${session.id}')">
                    <div class="history-item-title">${escapeHtml(session.title)}</div>
                    <div class="history-item-meta">
                        <span>📅 ${formatDate(session.updatedAt)}</span>
                        <span>💬 ${session.messageCount} messages</span>
                    </div>
                    <button class="history-item-delete" onclick="deleteSession('${session.id}', event)" title="Delete chat">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                            <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4L4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                        </svg>
                    </button>
                </div>
            `).join('');
}

// @ Mention functions
function toggleMentionPicker() {
  console.log('[WebView] toggleMentionPicker called, current visible:', mentionPickerVisible);
  mentionPickerVisible = !mentionPickerVisible;
  if (mentionPickerVisible) {
    showMentionPicker();
  } else {
    hideMentionPicker();
  }
}

function showMentionPicker() {
  console.log('[WebView] showMentionPicker called');
  mentionPickerVisible = true;
  mentionPicker.classList.add('visible');
  mentionSearch.value = '';
  mentionSearch.focus();
  // Start at root
  navigateToRoot();
}

function hideMentionPicker() {
  console.log('[WebView] hideMentionPicker called');
  mentionPickerVisible = false;
  mentionPicker.classList.remove('visible');
  selectedMentionIndex = -1;
}

function searchMentions(query) {
  console.log('[WebView] searchMentions:', query);
  if (!query) {
     const path = {};
     if (currentHierarchyPath.connection) {
         path.connectionId = currentHierarchyPath.connection.id;
         if (currentHierarchyPath.database) {
             path.database = currentHierarchyPath.database;
             if (currentHierarchyPath.schema) {
                 path.schema = currentHierarchyPath.schema;
             }
         }
     }
     vscode.postMessage({ type: 'getDbHierarchy', path });
     return;
  }
  vscode.postMessage({ type: 'searchDbObjects', query: query });
}

function getDbTypeIcon(type) {
  const icons = {
    'table': '📋',
    'view': '👁️',
    'function': '⚙️',
    'materialized-view': '📦',
    'type': '🔤',
    'schema': '📁',
    'database': '🗄️',
    'connection': '🔌'
  };
  return icons[type] || '📄';
}


function renderHierarchyItems(items) {
  console.log('[WebView] renderHierarchyItems called with', items.length, 'items');
  dbObjects = items; 
  
  if (items.length === 0) {
     mentionList.innerHTML = '<div class="mention-picker-empty">No items found.</div>';
     return;
  }
  
  let html = '';
  
  items.sort((a, b) => {
      const aContainer = !!a.isContainer;
      const bContainer = !!b.isContainer;
      
      if (aContainer && !bContainer) return -1;
      if (!aContainer && bContainer) return 1;
      return (a.name || '').localeCompare(b.name || '');
  });
  
  items.forEach((obj, idx) => {
      const isContainer = !!obj.isContainer;
      let icon = getDbTypeIcon(obj.type);
      
      const clickHandler = isContainer 
        ? `handleContainerClick(${idx})`
        : `selectMention(${idx})`;
        
      const displayName = isContainer ? obj.name : (obj.schema ? obj.schema + '.' + obj.name : obj.name);

      let metaHtml = '';
      if (obj.type !== 'connection') {
          const metaParts = [];
          
          if (obj.connectionName) {
             metaParts.push(obj.connectionName);
          }
          if (obj.database && obj.type !== 'database') {
             metaParts.push(obj.database);
          }
          
          if (metaParts.length > 0) {
              metaHtml = `<div class="mention-item-meta">${escapeHtml(metaParts.join(' • '))}</div>`;
          }
      }

      html += `<div class="mention-item" data-index="${idx}" onclick="${clickHandler}" onmouseenter="highlightMention(${idx})">
          <div class="mention-item-name">
            <span class="db-type-icon">${icon}</span>
            <span class="mention-item-label">${escapeHtml(displayName)}</span>
          </div>
          ${metaHtml}
      </div>`;
  });
  
  mentionList.innerHTML = html;
}

function renderDbObjects(objects) {
  console.log('[WebView] renderDbObjects called with', objects.length, 'objects');
  dbObjects = objects;

  if (objects.length === 0) {
    mentionList.innerHTML = '<div class="mention-picker-empty">No matches found. Try a different search term.</div>';
    return;
  }

  selectedMentionIndex = -1;

  // Limit to 20 items for better performance and cleaner display
  const MAX_DISPLAY = 20;
  const displayObjects = objects.slice(0, MAX_DISPLAY);
  const hasMore = objects.length > MAX_DISPLAY;

  // Group by type for cleaner organization
  const grouped = {};
  displayObjects.forEach((obj, originalIdx) => {
    const type = obj.type || 'other';
    if (!grouped[type]) grouped[type] = [];
    grouped[type].push({ ...obj, originalIdx });
  });

  // Type order and labels
  const typeOrder = ['table', 'view', 'materialized-view', 'function', 'type', 'schema'];
  const typeLabels = {
    'table': 'Tables',
    'view': 'Views',
    'materialized-view': 'Materialized Views',
    'function': 'Functions',
    'type': 'Types',
    'schema': 'Schemas',
    'other': 'Other'
  };

  let html = '';
  let globalIdx = 0;

  // Helper to generate item HTML with metadata
  const renderItem = (obj) => {
    const idx = globalIdx++;
    const metaParts = [];
    if (obj.connectionName) metaParts.push(obj.connectionName);
    if (obj.database) metaParts.push(obj.database);
    
    const metaHtml = metaParts.length > 0 
        ? `<div class="mention-item-meta">${escapeHtml(metaParts.join(' • '))}</div>` 
        : '';

    return `<div class="mention-item" data-index="${idx}" onclick="selectMention(${idx})" onmouseenter="highlightMention(${idx})">
      <div class="mention-item-name">
        <span class="db-type-icon">${getDbTypeIcon(obj.type)}</span>
        <span class="mention-item-label">${escapeHtml(obj.schema)}.${escapeHtml(obj.name)}</span>
      </div>
      ${metaHtml}
    </div>`;
  };

  // Render in type order
  typeOrder.forEach(type => {
    if (grouped[type] && grouped[type].length > 0) {
      html += '<div class="mention-group-header">' + (typeLabels[type] || type) + ' (' + grouped[type].length + ')</div>';
      grouped[type].forEach(obj => {
        html += renderItem(obj);
      });
    }
  });

  // Handle types not in order
  Object.keys(grouped).forEach(type => {
    if (!typeOrder.includes(type) && grouped[type].length > 0) {
      html += '<div class="mention-group-header">' + (typeLabels[type] || type) + ' (' + grouped[type].length + ')</div>';
      grouped[type].forEach(obj => {
         html += renderItem(obj);
      });
    }
  });


  if (hasMore) {
    html += '<div class="mention-picker-more">' + (objects.length - MAX_DISPLAY) + ' more... (refine your search)</div>';
  }

  mentionList.innerHTML = html;

  // Re-map dbObjects to match displayed order
  dbObjects = [];
  typeOrder.forEach(type => {
    if (grouped[type]) {
      grouped[type].forEach(obj => dbObjects.push(obj));
    }
  });
  Object.keys(grouped).forEach(type => {
    if (!typeOrder.includes(type) && grouped[type]) {
      grouped[type].forEach(obj => dbObjects.push(obj));
    }
  });
}

function highlightMention(index) {
  const items = mentionList.querySelectorAll('.mention-item');
  items.forEach((item, i) => {
    item.classList.toggle('selected', i === index);
  });
  selectedMentionIndex = index;
}

function selectMention(index) {
  const obj = dbObjects[index];
  if (!obj) return;

  if (obj.isContainer) {
    handleContainerClick(index);
    mentionSearch.value = '';
    mentionSearch.focus();
    return;
  }

  // Create mention object
  const mention = {
    name: obj.name,
    type: obj.type,
    schema: obj.schema,
    database: obj.database,
    connectionId: obj.connectionId,
    connectionName: obj.connectionName,
    breadcrumb: obj.breadcrumb
  };

  // Check if already selected
  const exists = selectedMentions.find(m =>
    m.name === mention.name &&
    m.schema === mention.schema &&
    m.database === mention.database
  );

  if (!exists) {
    selectedMentions.push(mention);
    renderMentionChips();

    // Insert @mention in textarea
    const mentionText = '@' + obj.schema + '.' + obj.name;
    const cursorPos = chatInput.selectionStart;
    const textBefore = chatInput.value.substring(0, cursorPos);
    const textAfter = chatInput.value.substring(cursorPos);

    // Check if there's an incomplete @ mention to replace
    const atMatch = textBefore.match(/@[\w.]*$/);
    if (atMatch) {
      chatInput.value = textBefore.substring(0, textBefore.length - atMatch[0].length) + mentionText + ' ' + textAfter;
    } else {
      chatInput.value = textBefore + mentionText + ' ' + textAfter;
    }
  }

  hideMentionPicker();
  chatInput.focus();
}

function removeMention(index) {
  selectedMentions.splice(index, 1);
  renderMentionChips();
}

function renderMentionChips() {
  // Include both files and mentions in the attachments container
  const hasContent = attachedFiles.length > 0 || selectedMentions.length > 0;

  if (!hasContent) {
    attachmentsContainer.classList.remove('has-files');
    attachmentsContainer.classList.remove('has-mentions');
    inputWrapper.classList.remove('has-attachments');
    renderAttachments(); // Just render file chips
    return;
  }

  attachmentsContainer.classList.add('has-files');
  if (selectedMentions.length > 0) {
    attachmentsContainer.classList.add('has-mentions');
  }
  inputWrapper.classList.add('has-attachments');

  // Render file chips first, then mention chips
  attachmentsContainer.innerHTML = '';

  attachedFiles.forEach((file, index) => {
    const chip = document.createElement('div');
    chip.className = 'attachment-chip';
    const icon = getFileIcon(file.type);
    chip.innerHTML = `
                    <span class="file-icon">${icon}</span>
                    <span class="file-name">${file.name}</span>
                    <button class="remove-btn" onclick="removeAttachment(${index})" title="Remove file">
                        <svg viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.708.708L7.293 8l-3.647 3.646.708.708L8 8.707z"/>
                        </svg>
                    </button>
                `;
    attachmentsContainer.appendChild(chip);
  });

  selectedMentions.forEach((mention, index) => {
    const chip = document.createElement('div');
    chip.className = 'mention-chip';
    
    // Prepare metadata text
    const metaParts = [];
    if (mention.connectionName) metaParts.push(mention.connectionName);
    if (mention.database) metaParts.push(mention.database);
    const metaText = metaParts.join(' • ');

    chip.innerHTML = `
                    <span class="mention-icon">${getDbTypeIcon(mention.type)}</span>
                    <div class="mention-chip-content">
                        <span class="mention-name">@${mention.schema}.${mention.name}</span>
                        ${metaText ? `<span class="mention-chip-meta">${escapeHtml(metaText)}</span>` : ''}
                    </div>
                    <button class="remove-btn" onclick="removeMention(${index})" title="Remove reference">
                        <svg viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.708.708L7.293 8l-3.647 3.646.708.708L8 8.707z"/>
                        </svg>
                    </button>
                `;
    attachmentsContainer.appendChild(chip);
  });
}

function handleChatInput(event) {
  const value = chatInput.value;
  const cursorPos = chatInput.selectionStart;
  const textUpToCursor = value.substring(0, cursorPos);

  // Check if user just typed @ or is in middle of @mention
  const atMatch = textUpToCursor.match(/@([\w.]*)$/);

  if (atMatch) {
    if (!mentionPickerVisible) {
      showMentionPicker();
    }
    // Debounced search with the text after @
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
    }
    const searchQuery = atMatch[1];
    searchDebounceTimer = setTimeout(() => {
      searchMentions(searchQuery);
    }, 250);
  } else if (mentionPickerVisible && !event.inputType?.includes('delete')) {
    // Hide picker if @ context is lost (but not on delete)
    hideMentionPicker();
  }

  // Auto-resize textarea
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
}

function handleMentionKeydown(event) {
  if (!mentionPickerVisible) return false;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    selectedMentionIndex = Math.min(selectedMentionIndex + 1, dbObjects.length - 1);
    highlightMention(selectedMentionIndex);
    scrollMentionIntoView();
    return true;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    selectedMentionIndex = Math.max(selectedMentionIndex - 1, 0);
    highlightMention(selectedMentionIndex);
    scrollMentionIntoView();
    return true;
  }
  if (event.key === 'Enter' && selectedMentionIndex >= 0) {
    event.preventDefault();
    selectMention(selectedMentionIndex);
    return true;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    hideMentionPicker();
    return true;
  }
  if (event.key === 'Tab' && selectedMentionIndex >= 0) {
    event.preventDefault();
    selectMention(selectedMentionIndex);
    return true;
  }
  return false;
}

function scrollMentionIntoView() {
  const selected = mentionList.querySelector('.mention-item.selected');
  if (selected) {
    selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

// Keyboard handler specifically for the search input
function handleMentionSearchKeydown(event) {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (selectedMentionIndex < 0) {
      selectedMentionIndex = 0;
    } else {
      selectedMentionIndex = Math.min(selectedMentionIndex + 1, dbObjects.length - 1);
    }
    highlightMention(selectedMentionIndex);
    scrollMentionIntoView();
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    selectedMentionIndex = Math.max(selectedMentionIndex - 1, 0);
    highlightMention(selectedMentionIndex);
    scrollMentionIntoView();
    return;
  }
  if (event.key === 'Enter' && selectedMentionIndex >= 0) {
    event.preventDefault();
    selectMention(selectedMentionIndex);
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    hideMentionPicker();
    chatInput.focus();
    return;
  }
  if (event.key === 'Tab' && selectedMentionIndex >= 0) {
    event.preventDefault();
    selectMention(selectedMentionIndex);
    return;
  }
}

function highlightMentionsInText(text) {
  // Escape HTML first, then highlight @mentions
  let html = escapeHtml(text);
  // Match @schema.name or @name patterns
  html = html.replace(/@([\w]+(?:\.[\w]+)?)/g, '<span class="mention-inline">@$1</span>');
  return html;
}

// Quirky loading messages
const quirkyMessages = [
  "🧠 Negotiating with the AI overlords…",
  "🐘 Teaching Postgres new tricks…",
  "💾 Convincing the bits to behave…",
  "🧙‍♂️ Refactoring reality… one spell at a time.",
  "🎮 Buffering your next plot twist…",
  "🍕 Bribing the database with carbs…",
  "🐞 Politely asking bugs to leave… again.",
  "🚨 Deploying controlled chaos…",
  "🤖 Beeping, booping, pretending to work…",
  "🌋 Melting slow queries in hot lava…",
  "🧵 Weaving multi-threaded dreams…",
  "🎯 Aiming for 0ms latency (manifesting hard).",
  "🧊 Freezing the race conditions…",
  "🛸 Abducting your data for analysis…",
  "🌈 Painting graphs with unicorn dust…",
  "🧩 Assembling answers without the manual…",
  "⚔️ Sparring with rogue JOIN statements…",
  "📡 Calling the mothership for wisdom…",
  "🌪️ Spinning up some fresh insights…",
  "🍩 Debugging powered by sugar and despair…"
];

function startLoadingMessages() {
  let index = Math.floor(Math.random() * quirkyMessages.length);
  loadingText.textContent = quirkyMessages[index];

  loadingInterval = setInterval(() => {
    index = (index + 1) % quirkyMessages.length;
    loadingText.style.animation = 'none';
    loadingText.offsetHeight; // Trigger reflow
    loadingText.style.animation = 'fadeInOut 0.3s ease';
    loadingText.textContent = quirkyMessages[index];
  }, 2500);
}

function stopLoadingMessages() {
  if (loadingInterval) {
    clearInterval(loadingInterval);
    loadingInterval = null;
  }
  loadingText.textContent = '';
}

function attachFile() {
  vscode.postMessage({ type: 'pickFile' });
}

function removeAttachment(index) {
  attachedFiles.splice(index, 1);
  renderAttachments();
}

function renderAttachments() {
  attachmentsContainer.innerHTML = '';

  if (attachedFiles.length === 0) {
    attachmentsContainer.classList.remove('has-files');
    inputWrapper.classList.remove('has-attachments');
    return;
  }

  attachmentsContainer.classList.add('has-files');
  inputWrapper.classList.add('has-attachments');

  attachedFiles.forEach((file, index) => {
    const chip = document.createElement('div');
    chip.className = 'attachment-chip';

    const icon = getFileIcon(file.type);
    chip.innerHTML = `
                    <span class="file-icon">${icon}</span>
                    <span class="file-name">${file.name}</span>
                    <button class="remove-btn" onclick="removeAttachment(${index})" title="Remove file">
                        <svg viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.708.708L7.293 8l-3.647 3.646.708.708L8 8.707z"/>
                        </svg>
                    </button>
                `;

    attachmentsContainer.appendChild(chip);
  });
}

function getFileIcon(type) {
  const icons = {
    'sql': '📄',
    'json': '📋',
    'csv': '📊',
    'text': '📝'
  };
  return icons[type] || '📎';
}

function sendMessage() {
  const message = chatInput.value.trim();
  if (!message && attachedFiles.length === 0 && selectedMentions.length === 0) return;

  vscode.postMessage({
    type: 'sendMessage',
    message: message || (selectedMentions.length > 0 ? 'Please analyze the referenced database objects' : 'Please analyze the attached file(s)'),
    attachments: attachedFiles.length > 0 ? [...attachedFiles] : undefined,
    mentions: selectedMentions.length > 0 ? [...selectedMentions] : undefined
  });

  chatInput.value = '';
  chatInput.style.height = 'auto';
  chatInput.disabled = true;
  sendBtn.disabled = true;
  attachBtn.disabled = true;
  mentionBtn.disabled = true;

  // Clear attachments and mentions after sending
  attachedFiles = [];
  selectedMentions = [];
  renderMentionChips();
}

function sendSuggestion(text) {
  chatInput.value = text;
  sendMessage();
}

function clearChat() {
  vscode.postMessage({
    type: 'clearChat'
  });
}

function cancelRequest() {
  vscode.postMessage({
    type: 'cancelRequest'
  });
}

function handleKeyDown(event) {
  // Check mention picker navigation first
  if (handleMentionKeydown(event)) {
    return;
  }

  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
}

// Auto-resize textarea
chatInput.addEventListener('input', function () {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 120) + 'px';
});

// Escape HTML for safe display
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Escape characters for HTML attribute values
function escapeAttribute(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Copy code to clipboard
function copyCode(button, codeId) {
  const codeElement = document.getElementById(codeId);
  if (!codeElement) return;

  // Use data-raw attribute if available (preserves original code without HTML)
  // Otherwise fall back to textContent
  const rawCode = codeElement.getAttribute('data-raw');
  const code = rawCode !== null ? rawCode : (codeElement.textContent || '');

  navigator.clipboard.writeText(code).then(() => {
    button.classList.add('copied');
    button.innerHTML = `
                    <svg viewBox="0 0 16 16" fill="currentColor">
                        <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
                    </svg>
                    Copied!
                `;
    setTimeout(() => {
      button.classList.remove('copied');
      button.innerHTML = `
                        <svg viewBox="0 0 16 16" fill="currentColor">
                            <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 010 1.5h-1.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 019.25 16h-7.5A1.75 1.75 0 010 14.25v-7.5z"/>
                            <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0114.25 11h-7.5A1.75 1.75 0 015 9.25v-7.5zm1.75-.25a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25h-7.5z"/>
                        </svg>
                        Copy
                    `;
    }, 2000);
  });
}

// Open SQL code in active notebook
let pendingNotebookButton = null;
let pendingNotebookOriginalHtml = null;

function openInNotebook(button, codeId) {
  const codeElement = document.getElementById(codeId);
  if (!codeElement) return;

  const rawCode = codeElement.getAttribute('data-raw');
  const code = rawCode !== null ? rawCode : (codeElement.textContent || '');

  // Store button reference for response handling
  pendingNotebookButton = button;
  pendingNotebookOriginalHtml = button.innerHTML;

  vscode.postMessage({
    type: 'openInNotebook',
    code: code
  });
}

function handleNotebookResult(success, error) {
  if (!pendingNotebookButton) return;

  const button = pendingNotebookButton;
  const originalHtml = pendingNotebookOriginalHtml;

  if (success) {
    button.classList.add('added');
    button.innerHTML = `
                    <svg viewBox="0 0 16 16" fill="currentColor">
                        <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
                    </svg>
                    Added!
                `;
  } else {
    button.classList.add('error');
    button.innerHTML = `
                    <svg viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 1a7 7 0 110 14A7 7 0 018 1zm0 2.5a.75.75 0 00-.75.75v3.5a.75.75 0 001.5 0v-3.5A.75.75 0 008 3.5zm0 8a1 1 0 100-2 1 1 0 000 2z"/>
                    </svg>
                    ${error || 'Error'}
                `;
  }

  setTimeout(() => {
    button.classList.remove('added');
    button.classList.remove('error');
    button.innerHTML = originalHtml;
  }, 2000);

  pendingNotebookButton = null;
  pendingNotebookOriginalHtml = null;
}

function highlightSql(code) {
  const keywords = ['SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TABLE', 'INDEX', 'VIEW', 'FUNCTION', 'TRIGGER', 'PROCEDURE', 'CONSTRAINT', 'PRIMARY KEY', 'FOREIGN KEY', 'REFERENCES', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 'ON', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'ALL', 'DISTINCT', 'AS', 'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'ILIKE', 'IS', 'NULL', 'TRUE', 'FALSE', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'DEFAULT', 'VALUES', 'SET', 'RETURNING', 'BEGIN', 'COMMIT', 'ROLLBACK', 'TRANSACTION', 'GRANT', 'REVOKE'];
  const types = ['INT', 'INTEGER', 'VARCHAR', 'TEXT', 'BOOLEAN', 'DATE', 'TIMESTAMP', 'NUMERIC', 'FLOAT', 'REAL', 'JSON', 'JSONB', 'UUID', 'SERIAL', 'BIGSERIAL'];

  let html = '';
  let rest = code;

  while (rest.length > 0) {
    let match;

    // Comments -- 
    if (match = rest.match(/^(--[^\n]*)/)) {
      html += '<span class="sql-comment">' + match[0] + '</span>';
      rest = rest.slice(match[0].length);
      continue;
    }

    // Block comments /* */
    if (match = rest.match(/^(\/\* [\s\S]*?\*\/)/)) {
      html += '<span class="sql-comment">' + match[0] + '</span>';
      rest = rest.slice(match[0].length);
      continue;
    }

    // Strings
    if (match = rest.match(/^('(?:[^'\\\\]|\\.)*')/)) {
      html += '<span class="sql-string">' + match[0] + '</span>';
      rest = rest.slice(match[0].length);
      continue;
    }

    // Numbers
    if (match = rest.match(/^(\d+\.?\d*)/)) {
      html += '<span class="sql-number">' + match[0] + '</span>';
      rest = rest.slice(match[0].length);
      continue;
    }

    // Keywords & Identifiers
    if (match = rest.match(/^([a-zA-Z_][a-zA-Z0-9_.]*)/)) {
      // Note: added dot . to regex to capture schema.table as one chunk if generic
      // But to color them separately, we should stick to simple identifiers and handle dots as operators
      // Let's revert to simple identifiers and let the dot fall through to punctuation
    }
    if (match = rest.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/)) {
      const word = match[0];
      const upper = word.toUpperCase();
      if (keywords.includes(upper)) {
        html += '<span class="sql-keyword">' + word + '</span>';
      } else if (types.includes(upper)) {
        html += '<span class="sql-type">' + word + '</span>';
      } else {
        // Function check: look ahead for (
        if (/^\s*\(/.test(rest.slice(word.length))) {
          html += '<span class="sql-function">' + word + '</span>';
        } else {
          html += '<span class="sql-identifier">' + word + '</span>';
        }
      }
      rest = rest.slice(word.length);
      continue;
    }

    // HTML entities (skip them or color them)
    if (match = rest.match(/^(&[a-zA-Z]+;)/)) {
      html += match[0];
      rest = rest.slice(match[0].length);
      continue;
    }

    // Operators: +, -, *, /, =, <, >, !, |, %
    if (match = rest.match(/^([+\-\/*=<>!|%]+)/)) {
      html += '<span class="sql-operator">' + match[0] + '</span>';
      rest = rest.slice(match[0].length);
      continue;
    }

    // Punctuation: , ; ( ) .
    if (match = rest.match(/^([,;().]+)/)) {
      html += '<span class="sql-punctuation">' + match[0] + '</span>';
      rest = rest.slice(match[0].length);
      continue;
    }

    // catch-all
    html += rest[0];
    rest = rest.slice(1);
  }
  return html;
}

// Counter for unique code block IDs
let codeBlockCounter = 0;

// Initialize marked renderer once
let markedRenderer;

function getMarkedRenderer() {
  if (markedRenderer) return markedRenderer;

  // Check if marked is available
  if (typeof marked === 'undefined') {
    console.error('marked library not loaded');
    return null;
  }

  const renderer = new marked.Renderer();

  // Custom code block renderer
  renderer.code = function ({ text, lang }) {
    const codeId = 'code-block-' + (++codeBlockCounter);
    const language = lang || 'text';
    const displayLang = language === 'text' ? 'CODE' : language.toUpperCase();

    // Securely escape the raw code for the data-raw attribute
    const safeRawCode = escapeAttribute(text);

    // Use highlight.js if available
    let highlightedCode;
    if (typeof hljs !== 'undefined') {
      try {
        if (lang && hljs.getLanguage(lang)) {
          highlightedCode = hljs.highlight(text, { language: lang }).value;
        } else {
          highlightedCode = hljs.highlightAuto(text).value;
        }
      } catch (e) {
        console.error('Highlight.js error:', e);
        highlightedCode = escapeHtml(text);
      }
    } else {
      // Fallback to manual SQL highlighting or simple escape
      if (['sql', 'pgsql', 'postgresql', 'plpgsql'].includes(language.toLowerCase())) {
        let escapedCode = text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        highlightedCode = highlightSql(escapedCode);
      } else {
        highlightedCode = escapeHtml(text);
      }
    }

    const isSQL = ['sql', 'pgsql', 'postgresql', 'plpgsql'].includes(language.toLowerCase());

    return `<div class="code-block-wrapper">
                    <div class="code-block-header">
                        <span class="code-language">${displayLang}</span>
                        <div class="code-block-actions">
                            ${isSQL ? `<button class="notebook-btn" onclick="openInNotebook(this, '${codeId}')" title="Add to active notebook">
                                <svg viewBox="0 0 16 16" fill="currentColor">
                                    <path d="M2.5 2A1.5 1.5 0 001 3.5v9A1.5 1.5 0 002.5 14h11a1.5 1.5 0 001.5-1.5v-9A1.5 1.5 0 0013.5 2h-11zM2 3.5a.5.5 0 01.5-.5h11a.5.5 0 01.5.5v9a.5.5 0 01-.5.5h-11a.5.5 0 01-.5-.5v-9z"/>
                                    <path d="M7.5 5.5v2h-2v1h2v2h1v-2h2v-1h-2v-2h-1z"/>
                                </svg>
                                Notebook
                            </button>` : ''}
                            <button class="copy-btn" onclick="copyCode(this, '${codeId}')">
                                <svg viewBox="0 0 16 16" fill="currentColor">
                                    <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 010 1.5h-1.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 019.25 16h-7.5A1.75 1.75 0 010 14.25v-7.5z"/>
                                    <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0114.25 11h-7.5A1.75 1.75 0 015 9.25v-7.5zm1.75-.25a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25h-7.5z"/>
                                </svg>
                                Copy
                            </button>
                        </div>
                    </div>
                    <pre><code id="${codeId}" class="hljs language-${language}" data-raw="${safeRawCode}">${highlightedCode}</code></pre>
                </div>`;
  };

  markedRenderer = renderer;
  return markedRenderer;
}

// Markdown parser using marked.js
function parseMarkdown(text) {
  if (typeof marked !== 'undefined') {
    try {
      const renderer = getMarkedRenderer();
      if (renderer) {
        return marked.parse(text, { renderer: renderer, breaks: true });
      }
    } catch (e) {
      console.error('Error parsing markdown with marked:', e);
    }
  }

  // Fallback (simplified) in case marked fails or isn't loaded
  return text.replace(/\n/g, '<br>');
}

// Typing effect for assistant messages
function typeText(element, text, callback) {
  if (typingAnimation) {
    clearInterval(typingAnimation);
  }

  const parsedHtml = parseMarkdown(text);
  let charIndex = 0;
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = parsedHtml;
  const plainText = tempDiv.textContent || '';

  // For complex HTML, just set it with a quick fade effect
  if (text.includes('```') || text.includes('**') || text.length > 1000) {
    element.style.opacity = '0';
    element.innerHTML = parsedHtml;
    element.style.transition = 'opacity 0.3s ease';
    requestAnimationFrame(() => {
      element.style.opacity = '1';
    });
    if (callback) setTimeout(callback, 300);
    return;
  }

  // Simple typing effect for shorter, simpler messages
  const cursor = document.createElement('span');
  cursor.className = 'typing-cursor';
  element.innerHTML = '';
  element.appendChild(cursor);

  const speed = Math.max(5, Math.min(20, 1000 / plainText.length)); // Adaptive speed

  typingAnimation = setInterval(() => {
    if (charIndex < plainText.length) {
      cursor.before(plainText[charIndex]);
      charIndex++;
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } else {
      clearInterval(typingAnimation);
      typingAnimation = null;
      cursor.remove();
      // Now apply full formatting
      element.innerHTML = parsedHtml;
      if (callback) callback();
    }
  }, speed);
}

// Handle messages from extension
window.addEventListener('message', event => {
  const message = event.data;

  switch (message.type) {
    case 'updateMessages':
      stopLoadingMessages();
      renderMessages(message.messages, true);
      chatInput.disabled = false;
      sendBtn.disabled = false;
      attachBtn.disabled = false;
      mentionBtn.disabled = false;
      chatInput.focus();
      break;
    case 'setTyping':
      if (message.isTyping) {
        typingIndicator.classList.add('visible');
        startLoadingMessages();
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        // Swap send button with stop button
        sendBtn.style.display = 'none';
        stopBtn.style.display = 'flex';
      } else {
        typingIndicator.classList.remove('visible');
        stopLoadingMessages();
        // Swap stop button back to send button
        stopBtn.style.display = 'none';
        sendBtn.style.display = 'flex';
      }
      break;
    case 'fileAttached':
      attachedFiles.push(message.file);
      renderAttachments();
      break;
    case 'updateHistory':
      renderHistory(message.sessions);
      break;
    case 'dbHierarchyData':
      if (message.error) {
           mentionList.innerHTML = '<div class="mention-picker-empty">' + escapeHtml(message.error) + '</div>';
      } else {
           renderHierarchyItems(message.items);
      }
      break;
    case 'dbObjectsResult':
      console.log('[WebView] Received dbObjectsResult:', message.objects?.length || 0, 'objects');
      if (message.error) {
        mentionList.innerHTML = '<div class="mention-picker-empty">' + escapeHtml(message.error) + '</div>';
      } else {
        renderDbObjects(message.objects);
      }
      break;
    case 'addMentionFromTree':
      // Add object to selectedMentions from tree @ button
      if (message.object) {
        const mention = {
          name: message.object.name,
          type: message.object.type,
          schema: message.object.schema,
          database: message.object.database,
          connectionId: message.object.connectionId,
          connectionName: message.object.connectionName,
          breadcrumb: message.object.breadcrumb,
          schemaInfo: message.object.details
        };

        // Check if already selected
        const exists = selectedMentions.find(m =>
          m.name === mention.name &&
          m.schema === mention.schema &&
          m.database === mention.database
        );

        if (!exists) {
          selectedMentions.push(mention);
          renderMentionChips();
        }

        // Always ensure the text reference exists or append it
        const mentionText = '@' + mention.schema + '.' + mention.name;
        if (!chatInput.value.includes(mentionText)) {
             const prefix = chatInput.value.length > 0 && !chatInput.value.endsWith(' ') ? ' ' : '';
             chatInput.value += prefix + mentionText;
        }

        chatInput.focus();
        // Move cursor to end
        chatInput.selectionStart = chatInput.selectionEnd = chatInput.value.length;
        
        showToast('✅ Attached ' + mention.schema + '.' + mention.name + ' to chat', 'info');
      }
      break;
    case 'schemaError':
      // Show a toast notification about schema fetch error
      showToast('⚠️ Could not fetch schema for ' + message.object + ': ' + message.error, 'warning');
      break;
    case 'updateModelInfo':
      const aiModelNameEl = document.getElementById('aiModelName');
      if (aiModelNameEl) {
        aiModelNameEl.textContent = message.modelName || 'Unknown';
      }
      break;
    case 'notebookResult':
      handleNotebookResult(message.success, message.error);
      break;
    case 'prefillInput':
      // Pre-fill chat input with query from "Chat" button
      if (message.message) {
        chatInput.value = message.message;
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + 'px';
        chatInput.focus();
        // Auto-send if it's a query
        if (message.autoSend) {
          sendMessage();
        }
      }
      break;
  }
});

// Toast notification function
function showToast(text, type = 'info') {
  const toast = document.createElement('div');
  toast.className = 'toast toast-' + type;
  toast.textContent = text;
  document.body.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.add('visible');
  });

  // Auto-remove after 5 seconds
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

let lastMessageCount = 0;

function renderMessages(messages, animate = false) {
  if (messages.length === 0) {
    emptyState.style.display = 'flex';
    const messageElements = messagesContainer.querySelectorAll('.message');
    messageElements.forEach(el => el.remove());
    lastMessageCount = 0;
    return;
  }

  emptyState.style.display = 'none';

  // Check if this is a new assistant message (for typing effect)
  const isNewAssistantMessage = animate &&
    messages.length > lastMessageCount &&
    messages[messages.length - 1].role === 'assistant';

  lastMessageCount = messages.length;

  // Clear existing messages (but keep typing indicator)
  const messageElements = messagesContainer.querySelectorAll('.message');
  messageElements.forEach(el => el.remove());

  // Render new messages (insert before typing indicator)
  messages.forEach((msg, idx) => {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message ' + msg.role;

    const roleDiv = document.createElement('div');
    roleDiv.className = 'message-role';
    roleDiv.textContent = msg.role === 'user' ? 'You' : 'Assistant';

    const bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'message-bubble';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    // Render attachments for user messages
    if (msg.role === 'user' && msg.attachments && msg.attachments.length > 0) {
      msg.attachments.forEach(att => {
        const filePreview = document.createElement('div');
        filePreview.className = 'file-preview';
        filePreview.innerHTML = `
                            <div class="file-preview-header">
                                <span>${getFileIcon(att.type)}</span>
                                <span>${att.name}</span>
                            </div>
                            <div class="file-preview-content">${escapeHtml(att.content.substring(0, 500))}${att.content.length > 500 ? '...' : ''}</div>
                        `;
        contentDiv.appendChild(filePreview);
      });

      // Add the text message after attachments if exists
      const textWithoutAttachments = msg.content.split('\n\n📎')[0].trim();
      if (textWithoutAttachments && textWithoutAttachments !== 'Please analyze the attached file(s)') {
        const textP = document.createElement('p');
        textP.innerHTML = highlightMentionsInText(textWithoutAttachments);
        contentDiv.appendChild(textP);
      }
    } else if (msg.role === 'user') {
      // User message without attachments - highlight any @mentions
      const text = msg.content.split('\n\n📎')[0].trim();
      if (text && text !== 'Please analyze the referenced database objects' && text !== 'Please analyze the attached file(s)') {
        contentDiv.innerHTML = highlightMentionsInText(text);
      } else {
        contentDiv.textContent = msg.content;
      }
    } else if (msg.role === 'assistant') {
      // Apply typing effect for the newest assistant message
      const isLastMessage = idx === messages.length - 1;
      if (isNewAssistantMessage && isLastMessage) {
        // Will be typed out
        bubbleDiv.appendChild(contentDiv);
        messageDiv.appendChild(roleDiv);
        messageDiv.appendChild(bubbleDiv);
        messagesContainer.insertBefore(messageDiv, typingIndicator);
        typeText(contentDiv, msg.content);
        return; // Skip the normal append below
      } else {
        contentDiv.innerHTML = parseMarkdown(msg.content);
      }
    } else {
      contentDiv.textContent = msg.content;
    }

    bubbleDiv.appendChild(contentDiv);
    messageDiv.appendChild(roleDiv);
    messageDiv.appendChild(bubbleDiv);
    messagesContainer.insertBefore(messageDiv, typingIndicator);
  });

  // Scroll to bottom smoothly
  messagesContainer.scrollTo({
    top: messagesContainer.scrollHeight,
    behavior: 'smooth'
  });
}
