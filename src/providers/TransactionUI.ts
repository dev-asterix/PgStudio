import * as vscode from 'vscode';

/**
 * Create transaction toolbar HTML with BEGIN/COMMIT/ROLLBACK buttons
 */
export function createTransactionToolbar(): string {
    return `
      <div class="transaction-toolbar" style="
        display: flex;
        gap: 8px;
        padding: 8px 12px;
        background: var(--vscode-editor-background);
        border-bottom: 1px solid var(--vscode-widget-border);
        align-items: center;
        font-size: 12px;
      ">
        <!-- Transaction Status Indicator -->
        <div class="tx-status" style="
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 150px;
          padding: 4px 8px;
          background: var(--vscode-input-background);
          border-radius: 3px;
          color: var(--vscode-editor-foreground);
          border: 1px solid var(--vscode-widget-border);
        ">
          <span class="tx-indicator" style="
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #666;
            transition: background 0.3s;
          "></span>
          <span class="tx-text" style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            No transaction
          </span>
        </div>

        <!-- Transaction Buttons -->
        <button class="tx-btn tx-begin" data-action="begin" style="
          padding: 6px 12px;
          background: #007ACC;
          color: white;
          border: none;
          border-radius: 3px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
        ">
          ▶ BEGIN
        </button>

        <button class="tx-btn tx-commit" data-action="commit" disabled style="
          padding: 6px 12px;
          background: #107C10;
          color: white;
          border: none;
          border-radius: 3px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
          opacity: 0.5;
        ">
          ✓ COMMIT
        </button>

        <button class="tx-btn tx-rollback" data-action="rollback" disabled style="
          padding: 6px 12px;
          background: #E81123;
          color: white;
          border: none;
          border-radius: 3px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
          opacity: 0.5;
        ">
          ⟲ ROLLBACK
        </button>

        <!-- Savepoint Controls -->
        <div style="display: flex; gap: 4px; margin-left: 8px; border-left: 1px solid var(--vscode-widget-border); padding-left: 8px;">
          <button class="tx-btn tx-savepoint" data-action="savepoint" disabled style="
            padding: 6px 10px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
            opacity: 0.5;
          ">
            📌 Savepoint
          </button>

          <select class="tx-savepoint-list" disabled style="
            padding: 4px 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-editor-foreground);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 3px;
            font-size: 12px;
            opacity: 0.5;
          ">
            <option>— No savepoints —</option>
          </select>
        </div>

        <!-- Transaction Options -->
        <div style="display: flex; gap: 4px; margin-left: auto;">
          <label style="display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--vscode-editor-foreground);">
            Isolation:
            <select class="tx-isolation" style="
              padding: 4px 8px;
              background: var(--vscode-input-background);
              color: var(--vscode-editor-foreground);
              border: 1px solid var(--vscode-widget-border);
              border-radius: 3px;
              font-size: 11px;
            ">
              <option value="READ COMMITTED" selected>Read Committed</option>
              <option value="READ UNCOMMITTED">Read Uncommitted</option>
              <option value="REPEATABLE READ">Repeatable Read</option>
              <option value="SERIALIZABLE">Serializable</option>
            </select>
          </label>

          <label style="display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--vscode-editor-foreground);">
            <input type="checkbox" class="tx-readonly" style="cursor: pointer;"> Read-Only
          </label>

          <label style="display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--vscode-editor-foreground);">
            <input type="checkbox" class="tx-autorollback" style="cursor: pointer;"> Auto-Rollback
          </label>
        </div>
      </div>

      <style>
        .transaction-toolbar button:hover:not(:disabled) {
          opacity: 0.9;
        }
        
        .transaction-toolbar button:active:not(:disabled) {
          transform: scale(0.98);
        }
        
        .transaction-toolbar button:disabled {
          cursor: not-allowed;
        }

        .tx-status {
          position: relative;
        }

        .tx-indicator.idle { background: #666; }
        .tx-indicator.active { background: #4EC9B0; animation: pulse 2s infinite; }
        .tx-indicator.failed { background: #F48771; animation: pulse 0.5s infinite; }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      </style>
    `;
  }

/**
 * Create isolation level configuration dialog
 */
export async function showIsolationLevelPicker(): Promise<string | undefined> {
    const levels = [
      { label: 'Read Uncommitted (Lowest isolation)', value: 'READ UNCOMMITTED' },
      { label: 'Read Committed (Default)', value: 'READ COMMITTED' },
      { label: 'Repeatable Read', value: 'REPEATABLE READ' },
      { label: 'Serializable (Highest isolation)', value: 'SERIALIZABLE' }
    ];

    return await vscode.window.showQuickPick(levels.map(l => ({
      label: l.label,
      value: l.value
    })), {
      title: 'Select Transaction Isolation Level',
      placeHolder: 'Choose isolation level (affects concurrency and consistency)'
    }).then(selected => selected?.value);
  }

/**
 * Create transaction info notification
 */
export function showTransactionInfo(summary: string, duration?: string): void {
    const message = duration ? `${summary} — Duration: ${duration}` : summary;
    vscode.window.showInformationMessage(message);
  }

/**
 * Show transaction error with rollback option
 */
export async function showTransactionError(error: string, isFailed: boolean = false): Promise<'rollback' | 'ignore' | undefined> {
    if (isFailed) {
      return await vscode.window.showErrorMessage(
        `Transaction failed: ${error}. Transaction must be rolled back.`,
        { modal: true },
        { title: 'Rollback', value: 'rollback' }
      ).then(result => (result as any)?.value);
    } else {
      return await vscode.window.showErrorMessage(
        `Error during transaction: ${error}`,
        { title: 'Rollback', value: 'rollback' },
        { title: 'Ignore', value: 'ignore' }
      ).then(result => (result as any)?.value);
    }
  }

/**
 * Show savepoint operations menu
 */
export async function showSavepointMenu(): Promise<'create' | 'release' | 'rollback' | undefined> {
    return await vscode.window.showQuickPick([
      { label: '📌 Create Savepoint', value: 'create' },
      { label: '✓ Release Savepoint', value: 'release' },
      { label: '⟲ Rollback to Savepoint', value: 'rollback' }
    ], {
      title: 'Savepoint Operations',
      placeHolder: 'Select operation'
    }).then(selected => (selected as any)?.value);
  }

/**
 * Update toolbar state based on transaction status
 */
export function updateToolbarState(container: HTMLElement, isActive: boolean, isFailed: boolean, savepointCount: number): void {
  const beginBtn = container.querySelector('.tx-begin') as HTMLButtonElement;
  const commitBtn = container.querySelector('.tx-commit') as HTMLButtonElement;
  const rollbackBtn = container.querySelector('.tx-rollback') as HTMLButtonElement;
  const savepointBtn = container.querySelector('.tx-savepoint') as HTMLButtonElement;
  const indicator = container.querySelector('.tx-indicator') as HTMLElement;
  const statusText = container.querySelector('.tx-text') as HTMLElement;

  if (beginBtn) beginBtn.disabled = isActive;
  if (commitBtn) commitBtn.disabled = !isActive || isFailed;
  if (rollbackBtn) rollbackBtn.disabled = !isActive;
  if (savepointBtn) savepointBtn.disabled = !isActive;

  if (indicator) {
    indicator.className = 'tx-indicator';
    if (isActive) {
      if (isFailed) {
        indicator.classList.add('failed');
        if (statusText) statusText.textContent = '🔴 Transaction Failed';
      } else {
        indicator.classList.add('active');
        if (statusText) statusText.textContent = `🟢 In Transaction (${savepointCount} savepoints)`;
      }
    } else {
      indicator.classList.add('idle');
      if (statusText) statusText.textContent = 'No transaction';
    }
  }
}

