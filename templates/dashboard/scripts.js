const vscode = acquireVsCodeApi();

// --- Theme & Colors ---
const style = getComputedStyle(document.body);
const colors = {
  text: style.getPropertyValue('--fg-color').trim(),
  muted: style.getPropertyValue('--muted-color').trim(),
  border: style.getPropertyValue('--border-color').trim(),
  accent: style.getPropertyValue('--accent-color').trim(),
  success: '#4ade80',
  warning: '#facc15',
  danger: '#f87171',
  grid: 'rgba(128, 128, 128, 0.1)'
};

Chart.defaults.color = colors.muted;
Chart.defaults.borderColor = colors.grid;
Chart.defaults.font.family = 'var(--font-family)';

// --- Chart Configurations ---
const commonOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { enabled: true, mode: 'index', intersect: false } },
  scales: {
    x: { display: false },
    y: { display: true, grid: { color: colors.grid, borderDash: [2, 2] }, ticks: { maxTicksLimit: 4 } }
  },
  elements: { point: { radius: 0, hitRadius: 10 }, line: { tension: 0.3, borderWidth: 2 } }
};

const sparklineOptions = {
  ...commonOptions,
  plugins: { legend: { display: false }, tooltip: { enabled: false } },
  scales: { x: { display: false }, y: { display: false } },
  elements: { point: { radius: 0 }, line: { borderWidth: 1.5 } }
};

// --- State ---
const maxHistory = 30;
// TPS History (Sparkline)
let tpsHistory = new Array(maxHistory).fill(0);

// Connections History (Stacked)
let connHistory = {
  labels: new Array(maxHistory).fill(''),
  active: new Array(maxHistory).fill(0),
  idle: new Array(maxHistory).fill(0)
};

// New Signals History
let rollbackHistory = new Array(maxHistory).fill(0);
let cacheHitHistory = new Array(maxHistory).fill(100);
let longRunningHistory = new Array(maxHistory).fill(0);

// Initial State Placeholder - Will be injected
const initialStats = null; // __STATS_JSON__

// Track PIDs for lock visualization
let blockingPids = new Set();
let waitingPids = new Set();

let lastMetrics = {
  timestamp: Date.now(),
  xact_commit: initialStats?.metrics?.xact_commit ?? 0,
  xact_rollback: initialStats?.metrics?.xact_rollback ?? 0,
  blks_read: initialStats?.metrics?.blks_read ?? 0,
  blks_hit: initialStats?.metrics?.blks_hit ?? 0,
  tps: 0 // Track last TPS for delta
};

// --- Initialization ---

// 1. TPS Sparkline
const tpsChart = new Chart(document.getElementById('tpsSparkline'), {
  type: 'line',
  data: {
    labels: new Array(maxHistory).fill(''),
    datasets: [{
      data: tpsHistory,
      borderColor: colors.text,
      borderWidth: 1.5,
      fill: false,
      tension: 0.1,
      pointRadius: 0
    }]
  },
  options: sparklineOptions
});

// 2. Connections Chart (Stacked Area)
const connChart = new Chart(document.getElementById('connectionsHistoryChart'), {
  type: 'line',
  data: {
    labels: connHistory.labels,
    datasets: [
      { label: 'Active', data: connHistory.active, borderColor: colors.success, backgroundColor: 'rgba(74, 222, 128, 0.1)', fill: true, tension: 0.4 },
      { label: 'Idle', data: connHistory.idle, borderColor: colors.muted, backgroundColor: 'rgba(128, 128, 128, 0.05)', fill: true, tension: 0.4 }
    ]
  },
  options: {
    ...commonOptions,
    scales: {
      x: { display: false },
      y: { stacked: true, display: true, grid: { color: colors.grid } }
    },
    plugins: { legend: { display: true, position: 'top', align: 'end', labels: { boxWidth: 8, usePointStyle: true } } }
  }
});

// 3. Rollback Spikes
const rollbackChart = new Chart(document.getElementById('rollbackChart'), {
  type: 'line',
  data: {
    labels: new Array(maxHistory).fill(''),
    datasets: [{
      label: 'Rollbacks/s',
      data: rollbackHistory,
      borderColor: colors.danger,
      backgroundColor: 'rgba(248, 113, 113, 0.1)',
      fill: true,
      tension: 0.2
    }]
  },
  options: commonOptions
});

// 4. Cache Hit Ratio
const cacheHitChart = new Chart(document.getElementById('cacheHitChart'), {
  type: 'line',
  data: {
    labels: new Array(maxHistory).fill(''),
    datasets: [{
      label: 'Hit Ratio %',
      data: cacheHitHistory,
      borderColor: 'rgba(128, 128, 128, 0.5)', // Muted color
      borderDash: [5, 5],
      fill: false,
      tension: 0.2
    }]
  },
  options: {
    ...commonOptions,
    scales: {
      x: { display: false },
      y: { display: true, min: 0, max: 105, ticks: { stepSize: 20 }, grid: { color: colors.grid } }
    }
  }
});

// 5. Long Running Queries
const longRunningChart = new Chart(document.getElementById('longRunningChart'), {
  type: 'line',
  data: {
    labels: new Array(maxHistory).fill(''),
    datasets: [{
      label: 'Queries > 5s',
      data: longRunningHistory,
      borderColor: colors.warning,
      backgroundColor: 'rgba(250, 204, 21, 0.1)',
      fill: true,
      stepped: true
    }]
  },
  options: commonOptions
});

let refreshIntervalId;

function startAutoRefresh(interval) {
  if (refreshIntervalId) clearInterval(refreshIntervalId);
  if (interval > 0) {
    refreshIntervalId = setInterval(() => {
      vscode.postMessage({ command: 'refresh' });
    }, interval);
  }
}

// --- Updates ---

// Populate Header Info (Static-ish)
function initializeDashboard(stats) {
  if (!stats) return;
  document.getElementById('db-name').innerText = stats.dbName;
  document.getElementById('db-owner').innerText = stats.owner;
  document.getElementById('db-size').innerText = stats.size;
  updateObjectCounts(stats.objectCounts);
}

function updateObjectCounts(counts) {
  if (!counts) return;
  document.getElementById('count-tables').innerText = `${counts.tables} Tables`;
  document.getElementById('count-views').innerText = `${counts.views} Views`;
  document.getElementById('count-funcs').innerText = `${counts.functions} Funcs`;
}

function updateDashboard(stats) {
  const now = Date.now();
  const timeDiff = (now - lastMetrics.timestamp) / 1000;

  // Always update header stats as they might change (size, counts)
  updateObjectCounts(stats.objectCounts);
  document.getElementById('db-size').innerText = stats.size;

  if (timeDiff > 0) {
    // Calc Deltas
    const commits = stats.metrics.xact_commit - lastMetrics.xact_commit;
    const rollbacks = stats.metrics.xact_rollback - lastMetrics.xact_rollback;
    const reads = stats.metrics.blks_read - lastMetrics.blks_read;
    const hits = stats.metrics.blks_hit - lastMetrics.blks_hit;

    const tps = Math.round((commits + rollbacks) / timeDiff);
    const rollbackRate = Math.round(rollbacks / timeDiff);

    const totalIo = reads + hits;
    const hitRatio = totalIo > 0 ? (hits / totalIo) * 100 : 100;

    // 1. Update TPS Sparkline & Delta
    tpsHistory.push(tps);
    if (tpsHistory.length > maxHistory) tpsHistory.shift();
    tpsChart.data.datasets[0].data = tpsHistory;
    tpsChart.update('none');

    // TPS Value
    const tpsEl = document.getElementById('tps-value');
    if (tpsEl) tpsEl.innerText = tps;

    // TPS Delta
    const deltaEl = document.getElementById('tps-delta');
    if (deltaEl && lastMetrics.tps > 0) {
      const delta = tps - lastMetrics.tps;
      const pct = Math.round((delta / lastMetrics.tps) * 100);
      if (delta === 0) {
        deltaEl.innerText = '-';
        deltaEl.style.color = 'var(--muted-color)';
      } else {
        const arrow = delta > 0 ? '↑' : '↓';
        deltaEl.innerText = `${arrow} ${Math.abs(pct)}%`;
        deltaEl.style.color = delta > 0 ? 'var(--success-color)' : 'var(--warning-color)'; // Green up, Yellow down (or flip if TPS drop is bad?) Usually high TPS is "activity"
        // Actually, context dependent. Let's keep it neutral colored or specific.
        // User requested: "TPS: 0   ↓ 12% (5m)". 
        // I'll use standard colors: Green for up, Default/Muted for down unless drastic.
        // Actually, purely informational.
        deltaEl.style.color = 'var(--muted-color)';
      }
    } else if (deltaEl) {
      deltaEl.innerText = '';
    }

    // Update TPS card tooltip for flatline annotation
    const tpsCard = document.getElementById('tps-card');
    if (tpsCard) {
      if (tps === 0 && blockingPids.size > 0) {
        tpsCard.title = 'Throughput stalled due to blocking locks';
      } else if (tps === 0) {
        tpsCard.title = 'No transaction activity';
      } else {
        tpsCard.title = 'Transactions per second';
      }
    }

    // 2. Update Connections
    connHistory.active.push(stats.activeConnections);
    connHistory.idle.push(stats.idleConnections);
    if (connHistory.active.length > maxHistory) {
      connHistory.active.shift();
      connHistory.idle.shift();
    }
    connChart.update('none');

    // 3. Update Rollbacks
    rollbackHistory.push(rollbackRate);
    if (rollbackHistory.length > maxHistory) rollbackHistory.shift();
    rollbackChart.update('none');

    // 4. Update Cache Hit
    cacheHitHistory.push(hitRatio);
    if (cacheHitHistory.length > maxHistory) cacheHitHistory.shift();
    cacheHitChart.update('none');

    // 5. Update Long Running
    longRunningHistory.push(stats.longRunningQueries || 0);
    if (longRunningHistory.length > maxHistory) longRunningHistory.shift();
    longRunningChart.update('none');

    // Update Health Indicator
    updateHealth(stats);

    // Update Locks FIRST (populates blockingPids for Active Queries)
    updateLocks(stats.blockingLocks);

    // Update Active Queries Table (uses blockingPids for lock icons)
    updateActiveQueries(stats.activeQueries);

    // Update Active Load Card
    updateActiveLoad(stats);

    // Update Issues Card
    updateIssues(stats);

    lastMetrics = {
      timestamp: now,
      xact_commit: stats.metrics.xact_commit,
      xact_rollback: stats.metrics.xact_rollback,
      blks_read: stats.metrics.blks_read,
      blks_hit: stats.metrics.blks_hit,
      tps: tps
    };
  }
}

function updateActiveLoad(stats) {
  const el = document.getElementById('active-load-value');
  if (el) el.innerHTML = `${stats.activeConnections} <span style="font-size: 0.8em; color: var(--muted-color); font-weight: 400;">/ ${stats.maxConnections}</span>`;

  const sub = document.getElementById('active-load-sub');
  if (sub) {
    if (stats.waitingConnections > 0) {
      // Emphasize waiting with icon and stronger color
      sub.innerHTML = `<span style="color: var(--danger-color); font-weight: 500;">⚠️ ${stats.waitingConnections} waiting</span>`;
    } else {
      sub.innerHTML = 'No waits';
    }
  }
}

function updateIssues(stats) {
  const container = document.getElementById('issues-card-content');
  if (!container) return;

  if (stats.waitEvents && stats.waitEvents.length > 0) {
    // Show Wait Events
    document.getElementById('issues-label').innerText = 'Top Wait Events';
    container.innerHTML = `<div style="display: flex; flex-direction: column; gap: 4px; margin-top: 8px;">
            ${stats.waitEvents.map(w => `
                <div style="display: flex; justify-content: space-between; font-size: 0.85em;">
                    <span style="color: var(--text-color);">${w.type}</span>
                    <span style="color: var(--muted-color);">${w.count}</span>
                </div>
            `).join('')}
        </div>`;
  } else {
    // Show Generic Issues
    document.getElementById('issues-label').innerText = 'Issues (Events)';
    container.innerHTML = `
            <div class="value">
                ${stats.metrics.deadlocks + stats.metrics.conflicts}
            </div>
            <div style="font-size: 0.8rem; color: var(--muted-color);">
                ${stats.metrics.deadlocks} Deadlocks
            </div>`;
  }
}

function updateHealth(stats) {
  const healthDot = document.getElementById('health-dot');
  const healthText = document.getElementById('health-text');
  const healthCard = document.getElementById('tile-health');

  // Build micro-summary parts
  const summaryParts = [];
  const connUsage = stats.activeConnections / (stats.maxConnections || 100);
  const hasBlocks = stats.blockingLocks && stats.blockingLocks.length > 0;
  const hasLongRunning = stats.longRunningQueries > 0;
  const hasWaiting = stats.waitingConnections > 0;

  if (hasBlocks) summaryParts.push('Locks');
  if (hasWaiting) summaryParts.push(`${stats.waitingConnections} waiting`);
  if (hasLongRunning) summaryParts.push('Long-running');
  if (connUsage > 0.7) summaryParts.push(`${Math.round(connUsage * 100)}% conn`);

  // Determine status
  if (hasBlocks || connUsage > 0.9) {
    healthDot.className = 'status-dot status-crit';
    healthText.innerHTML = `Critical<br><span style="font-size: 0.65em; font-weight: normal; opacity: 0.9;">${summaryParts.join(' • ') || 'High load'}</span>`;
    healthText.style.color = colors.danger;
  } else if (connUsage > 0.7 || hasWaiting) {
    healthDot.className = 'status-dot status-warn';
    healthText.innerHTML = `Degraded<br><span style="font-size: 0.65em; font-weight: normal; opacity: 0.9;">${summaryParts.join(' • ') || 'Elevated load'}</span>`;
    healthText.style.color = colors.warning;
  } else {
    healthDot.className = 'status-dot status-ok';
    healthText.innerText = 'Healthy';
    healthText.style.color = colors.success;
  }

  // Hover Tooltip: Detailed factors
  const tooltip = [];
  if (connUsage > 0.7) tooltip.push(`High connection usage (${Math.round(connUsage * 100)}%)`);
  if (hasBlocks) tooltip.push(`${stats.blockingLocks.length} blocking locks`);
  if (hasLongRunning) tooltip.push(`${stats.longRunningQueries} long running queries`);
  if (hasWaiting) tooltip.push(`${stats.waitingConnections} waiting connections`);

  if (healthCard) {
    healthCard.title = tooltip.length > 0 ? tooltip.join(' · ') : 'No issues detected';
  }

  // Update recommended action
  updateRecommendedAction(stats, hasBlocks);
}

function updateActiveQueries(queries) {
  const tbody = document.querySelector('#active-queries-table tbody');
  if (!queries || queries.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 24px; color: var(--muted-color);">No active queries running</td></tr>';
    return;
  }

  tbody.innerHTML = queries.map(q => {
    let rowClass = '';
    if (q.duration.includes('m') || (q.duration.includes(':') && q.duration > '00:01:00')) {
      rowClass = 'row-crit'; // > 60s
    } else if (q.duration > '00:00:10') {
      rowClass = 'row-warn'; // > 10s
    }

    // Check for lock status
    const isBlocker = blockingPids.has(q.pid);
    const isWaiting = waitingPids.has(q.pid);

    let pidContent = `${q.pid}`;
    let pidStyle = '';
    let pidTitle = '';

    if (isBlocker) {
      pidContent = `🔒 ${q.pid}`;
      pidStyle = 'color: var(--danger-color); font-weight: bold;';
      pidTitle = 'This process is blocking other queries';
    } else if (isWaiting) {
      pidContent = `⏳ ${q.pid}`;
      pidStyle = 'color: var(--warning-color); font-weight: 500;'; // Amber for waiting
      pidTitle = 'This process is waiting for a lock';
    }

    const b64Query = btoa(unescape(encodeURIComponent(q.query || '')));
    return `
        <tr class="${rowClass}">
            <td class="mono" style="${pidStyle}" title="${pidTitle}">${pidContent}</td>
            <td>${q.usename}</td>
            <td style="font-weight: 500;">${q.duration}</td>
            <td style="font-size: 0.85em; color: var(--muted-color);">${q.startTime || '-'}</td>
            <td class="mono" style="font-size: 0.85em; color: var(--muted-color);" title="${(q.query || '').replace(/"/g, '&quot;')}">
                ${(q.query || '').substring(0, 120)}${(q.query || '').length > 120 ? '...' : ''}
            </td>
            <td class="actions-cell">
                <div style="display: flex; gap: 4px; justify-content: flex-end;">
                    <button class="btn-action" data-action="explain" data-query="${b64Query}" title="Explain Plan">Explain</button>
                    <button class="btn-action btn-warn" data-action="cancel" data-pid="${q.pid}" title="Cancel Query (SIGINT)">Cancel</button>
                    <button class="btn-action btn-danger" data-action="terminate" data-pid="${q.pid}" title="Terminate Backend (SIGTERM)">Kill</button>
                </div>
            </td>
        </tr>
    `}).join('');
}

function updateLocks(locks) {
  const container = document.getElementById('locks-section');
  const headerTitle = document.getElementById('locks-title');
  const tableContainer = document.getElementById('locks-table-container');

  // Update blocking PIDs set for lock icon display
  blockingPids.clear();
  waitingPids.clear();
  if (locks && locks.length > 0) {
    locks.forEach(l => {
      blockingPids.add(l.blocking_pid);
      waitingPids.add(l.blocked_pid);
    });
  }

  // If we have no locks, show empty state
  if (!locks || locks.length === 0) {
    if (headerTitle) {
      headerTitle.innerText = 'Locks & Blocking';
      headerTitle.style.color = 'var(--fg-color)';
    }
    if (tableContainer) tableContainer.style.borderColor = 'var(--border-color)';

    if (container) {
      container.style.display = 'none';
    }
    return;
  }

  // Restore visibility if we have locks
  if (container) container.style.display = 'block';

  if (headerTitle) {
    headerTitle.innerText = 'Blocking Locks Detected';
    headerTitle.style.color = 'var(--danger-color)';
  }
  if (tableContainer) tableContainer.style.borderColor = 'var(--danger-color)';

  if (container) {
    const tbody = container.querySelector('tbody');
    if (tbody) {
      tbody.innerHTML = locks.map(l => {
        // Fix null object display
        let objectDisplay = l.locked_object;
        if (!objectDisplay || objectDisplay === 'null' || objectDisplay === null) {
          objectDisplay = '<span style="color: var(--muted-color); font-style: italic;">Session-level lock</span>';
        }
        return `
                <tr>
                    <td class="mono" style="color: var(--danger-color); font-weight: bold;">${l.blocking_pid}</td>
                    <td class="mono">${l.blocked_pid}</td>
                    <td>${objectDisplay}</td>
                    <td>${l.lock_mode}</td>
                </tr>
            `;
      }).join('');
    }
  }
}

// Recommended Action helper
function updateRecommendedAction(stats, hasBlocks) {
  let actionContainer = document.getElementById('recommended-action');

  if (!hasBlocks || !stats.blockingLocks || stats.blockingLocks.length === 0) {
    if (actionContainer) actionContainer.style.display = 'none';
    return;
  }

  // Show recommended action
  const blockerPid = stats.blockingLocks[0].blocking_pid;
  if (actionContainer) {
    actionContainer.style.display = 'block';
    actionContainer.innerHTML = `<span style="cursor: pointer;" data-action="terminate" data-pid="${blockerPid}">💡 Recommended: Kill blocker PID ${blockerPid}</span>`;
  }
}

// --- Detail View Logic ---
function showDetails(type) {
  vscode.postMessage({ command: 'showDetails', type });
}

function hideDetails() {
  document.getElementById('detail-view').style.display = 'none';
  document.getElementById('main-view').style.display = 'block';
}

function renderDetailsView(type, data, columns) {
  const titleMap = {
    tables: 'Tables',
    views: 'Views',
    functions: 'Functions',
    pgStatStatements: 'Top SQL (pg_stat_statements)'
  };
  const title = titleMap[type] || (type.charAt(0).toUpperCase() + type.slice(1));
  document.getElementById('detail-title').innerText = title;

  let html = '<div class="table-container"><table><thead><tr>';
  columns.forEach(c => html += '<th>' + c + '</th>');
  html += '</tr></thead><tbody>';

  if (!data || data.length === 0) {
    html += '<tr><td colspan="' + columns.length + '" style="text-align: center; color: var(--muted-color); padding: 24px;">No items found</td></tr>';
  } else {
    data.forEach(row => {
      html += '<tr>';
      if (type === 'pgStatStatements') {
        html += '<td class="mono" style="max-width: 640px; white-space: pre-wrap;">' + row.query + '</td>';
        html += '<td>' + row.calls + '</td>';
        html += '<td>' + row.total_time + '</td>';
        html += '<td>' + row.mean_time + '</td>';
        html += '<td>' + row.rows + '</td>';
      } else {
        html += '<td class="mono">' + row.name + '</td>';
        if (type === 'tables') html += '<td>' + row.size + '</td>';
        if (type === 'views') html += '<td>' + (row.owner || '') + '</td>';
        if (type === 'functions') html += '<td>' + row.language + '</td>';
      }
      html += '</tr>';
    });
  }
  html += '</tbody></table></div>';

  document.getElementById('detail-content').innerHTML = html;
  document.getElementById('main-view').style.display = 'none';
  document.getElementById('detail-view').style.display = 'block';
  window.scrollTo(0, 0);
}

// --- Actions (Called via Event Delegation) ---
function manualRefresh() { vscode.postMessage({ command: 'refresh' }); }
function explainQuery(b64Query) { vscode.postMessage({ command: 'explainQuery', query: decodeURIComponent(escape(atob(b64Query))) }); }
function cancelQuery(pid) { vscode.postMessage({ command: 'cancelQuery', pid }); }
function terminateQuery(pid) { vscode.postMessage({ command: 'terminateQuery', pid }); }
function jumpToQueries() {
  const el = document.getElementById('active-queries-table');
  if (el) el.scrollIntoView({ behavior: 'smooth' });
}
function jumpToLocks() {
  const el = document.getElementById('locks-section');
  if (el) el.scrollIntoView({ behavior: 'smooth' });
}

// Global Click Handler (Event Delegation)
document.addEventListener('click', event => {
  const target = event.target.closest('[data-action], [id^="count-"], #tps-card, .interactive, .back-link, .btn-action');
  if (!target) return;

  // Handle data-actions
  const action = target.getAttribute('data-action');
  if (action) {
    event.preventDefault();
    if (action === 'explain') explainQuery(target.getAttribute('data-query'));
    else if (action === 'cancel') cancelQuery(target.getAttribute('data-pid'));
    else if (action === 'terminate') terminateQuery(target.getAttribute('data-pid'));
    else if (action === 'refresh') manualRefresh();
    else if (action === 'showDetails') showDetails(target.getAttribute('data-type'));
    else if (action === 'hideDetails') hideDetails();
    else if (action === 'jumpToQueries') jumpToQueries();
    else if (action === 'jumpToLocks') jumpToLocks();
    return;
  }

  // Handle Static IDs/Classes (Legacy support if we missed data-actions)
  if (target.id === 'count-tables') { event.preventDefault(); showDetails('tables'); }
  else if (target.id === 'count-views') { event.preventDefault(); showDetails('views'); }
  else if (target.id === 'count-funcs') { event.preventDefault(); showDetails('functions'); }
  else if (target.classList.contains('back-link')) { event.preventDefault(); hideDetails(); }
});

// Remove old inline handlers from HTML by relying on this listener.
// Note: We need to update index.html to use data-action attributes for cleanliness, 
// but this listener handles the active parts.

// --- Message Handler ---
window.addEventListener('message', event => {
  const message = event.data;
  switch (message.command) {
    case 'updateStats':
      updateDashboard(message.stats);
      break;
    case 'showDetails':
      renderDetailsView(message.type, message.data, message.columns);
      break;
  }
});

// Auto Refresh
setInterval(manualRefresh, 5000);

// Init
initializeDashboard(initialStats);
updateDashboard(initialStats); // Populate initial charts
