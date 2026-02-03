
import * as vscode from 'vscode';
import { PostgresMetadata } from '../common/types';
import { ConnectionManager } from '../services/ConnectionManager';
import { ConnectionUtils } from '../utils/connectionUtils';
import { CompletionProvider } from './kernel/CompletionProvider';
import { SqlExecutor } from './kernel/SqlExecutor';
import { getTransactionManager, IsolationLevel } from '../services/TransactionManager';

export class PostgresKernel implements vscode.Disposable {
  readonly id = 'postgres-kernel';
  readonly label = 'PostgreSQL';
  readonly supportedLanguages = ['sql'];

  private readonly _controller: vscode.NotebookController;
  private readonly _executor: SqlExecutor;

  constructor(private readonly context: vscode.ExtensionContext, viewType: string = 'postgres-notebook', messageHandler?: (message: any) => void) {
    this._controller = vscode.notebooks.createNotebookController(
      this.id + '-' + viewType,
      viewType,
      this.label
    );

    this._controller.supportedLanguages = this.supportedLanguages;
    this._controller.supportsExecutionOrder = true;
    this._controller.executeHandler = this._executeAll.bind(this);

    this._executor = new SqlExecutor(this._controller);

    // Register completion provider
    const completionProvider = new CompletionProvider();
    context.subscriptions.push(
      vscode.languages.registerCompletionItemProvider(
        { scheme: 'vscode-notebook-cell', language: 'sql' },
        completionProvider,
        ' ', '.', '"' // Trigger characters
      )
    );

    // Handle messages from renderer
    (this._controller as any).onDidReceiveMessage(async (event: any) => {
      console.log('[NotebookKernel] onDidReceiveMessage triggered, event:', event);
      this.handleMessage(event);
    });
  }

  private async _executeAll(cells: vscode.NotebookCell[], _notebook: vscode.NotebookDocument, _controller: vscode.NotebookController): Promise<void> {
    for (const cell of cells) {
      await this._executor.executeCell(cell);
    }
  }

  private async handleMessage(event: any) {
    const { type } = event.message;
    console.log(`[NotebookKernel] handleMessage: Received message type: ${type}`);
    console.log(`[NotebookKernel] handleMessage: Full event.message:`, event.message);

    // Transaction management commands
    if (type === 'transaction_begin') {
      console.log('[NotebookKernel] Handling transaction_begin');
      await this.handleTransactionBegin(event);
    } else if (type === 'transaction_commit') {
      console.log('[NotebookKernel] Handling transaction_commit');
      await this.handleTransactionCommit(event);
    } else if (type === 'transaction_rollback') {
      console.log('[NotebookKernel] Handling transaction_rollback');
      await this.handleTransactionRollback(event);
    } else if (type === 'savepoint_create') {
      console.log('[NotebookKernel] Handling savepoint_create');
      await this.handleSavepointCreate(event);
    } else if (type === 'savepoint_release') {
      console.log('[NotebookKernel] Handling savepoint_release');
      await this.handleSavepointRelease(event);
    } else if (type === 'savepoint_rollback') {
      console.log('[NotebookKernel] Handling savepoint_rollback');
      await this.handleSavepointRollback(event);
    } else if (type === 'cancel_query') {
      console.log('[NotebookKernel] Handling cancel_query');
      await this._executor.cancelQuery(event.message);
    } else if (type === 'execute_update_background') {
      console.log('[NotebookKernel] Handling execute_update_background');
      await this._executor.executeBackgroundUpdate(event.message, event.editor.notebook);
    } else if (type === 'script_delete') {
      console.log('[NotebookKernel] Handling script_delete');
      await this.handleScriptDelete(event);
    } else if (type === 'execute_update') {
      console.log('[NotebookKernel] Handling execute_update');
      await this.handleExecuteUpdate(event);
    } else if (type === 'export_request') {
      console.log('[NotebookKernel] Handling export_request');
      await this.handleExportRequest(event);
    } else if (type === 'delete_row' || type === 'delete_rows') {
      console.log('[NotebookKernel] Handling delete_row/delete_rows');
      await this.handleDeleteRows(event);
    } else if (type === 'sendToChat') {
      console.log('[NotebookKernel] Handling sendToChat');
      const { data } = event.message;
      await vscode.commands.executeCommand('postgresExplorer.chatView.focus');
      await vscode.commands.executeCommand('postgres-explorer.sendToChat', data);
    } else if (type === 'saveChanges') {
      console.log('[NotebookKernel] Handling saveChanges');
      await this.handleSaveChanges(event);
    } else if (type === 'showErrorMessage') {
      console.log('[NotebookKernel] Handling showErrorMessage');
      vscode.window.showErrorMessage(event.message.message);
    } else {
      console.log(`[NotebookKernel] Unknown message type: ${type}`);
    }
  }

  private async handleSaveChanges(event: any) {
    console.log('NotebookKernel: handleSaveChanges called');
    const { updates, tableInfo } = event.message;
    console.log('NotebookKernel: Updates received:', JSON.stringify(updates));
    console.log('NotebookKernel: TableInfo:', JSON.stringify(tableInfo));

    const { schema, table } = tableInfo;
    const statements: string[] = [];

    for (const update of updates) {
      const { keys, column, value } = update;

      // Format value for SQL
      let valueStr = 'NULL';
      if (value !== null && value !== undefined) {
        if (typeof value === 'boolean') {
          valueStr = value ? 'TRUE' : 'FALSE';
        } else if (typeof value === 'number') {
          valueStr = String(value);
        } else if (typeof value === 'object') {
          valueStr = `'${JSON.stringify(value).replace(/'/g, "''")}'`;
        } else {
          valueStr = `'${String(value).replace(/'/g, "''")}'`;
        }
      }

      // Format conditions
      const conditions: string[] = [];
      for (const [pk, pkVal] of Object.entries(keys)) {
        let pkValStr = 'NULL';
        if (pkVal !== null && pkVal !== undefined) {
          if (typeof pkVal === 'number' || typeof pkVal === 'boolean') {
            pkValStr = String(pkVal);
          } else {
            pkValStr = `'${String(pkVal).replace(/'/g, "''")}'`;
          }
        }
        conditions.push(`"${pk}" = ${pkValStr}`);
      }

      const query = `UPDATE "${schema}"."${table}" SET "${column}" = ${valueStr} WHERE ${conditions.join(' AND ')};`;
      console.log('NotebookKernel: Generated query:', query);
      statements.push(query);
    }

    if (statements.length === 0) {
      console.warn('NotebookKernel: No statements generated');
      return;
    }

    // Reuse existing background update executor
    await this._executor.executeBackgroundUpdate({ statements }, event.editor.notebook);
  }

  // --- Lightweight Message Handlers that don't need heavy services ---

  private async handleScriptDelete(event: any) {
    const { schema, table, primaryKeys, rows, cellIndex } = event.message;
    const notebook = event.editor.notebook;
    try {
      // Construct DELETE query
      let query = '';
      for (const row of rows) {
        const conditions: string[] = [];
        for (const pk of primaryKeys) {
          const val = row[pk];
          const valStr = typeof val === 'string' ? `'${val.replace(/'/g, "''")}'` : val;
          conditions.push(`"${pk}" = ${valStr}`);
        }
        query += `DELETE FROM "${schema}"."${table}" WHERE ${conditions.join(' AND ')};\n`;
      }

      this.insertCell(notebook, cellIndex + 1, query);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to generate delete script: ${err.message}`);
    }
  }

  private async handleExecuteUpdate(event: any) {
    const { statements, cellIndex } = event.message;
    const notebook = event.editor.notebook;
    try {
      const query = statements.join('\n');
      this.insertCell(notebook, cellIndex + 1, `-- Update statements generated\n${query}`);
      vscode.window.showInformationMessage(`Generated ${statements.length} UPDATE statement(s).`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to generate update script: ${err.message}`);
    }
  }

  private async insertCell(notebook: vscode.NotebookDocument, index: number, content: string) {
    const newCell = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, content, 'sql');
    const edit = new vscode.NotebookEdit(new vscode.NotebookRange(index, index), [newCell]);
    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.set(notebook.uri, [edit]);
    await vscode.workspace.applyEdit(workspaceEdit);
  }

  private async handleExportRequest(event: any) {
    const { rows: displayRows, columns, query: originalQuery } = event.message;
    // ... (Keep existing simple export logic here for now, or move to ResultFormatter if it grows)

    // For this refactor, let's keep the existing logic but compacted.
    const selection = await vscode.window.showQuickPick(['Save as CSV', 'Save as JSON', 'Copy to Clipboard']);
    if (!selection) return;

    // ... (Use displayRows for now)

    const rowsToExport = displayRows; // Simplified to just use displayed rows for this refactor step

    if (selection === 'Copy to Clipboard') {
      const csv = this.rowsToCsv(rowsToExport, columns);
      await vscode.env.clipboard.writeText(csv);
      vscode.window.showInformationMessage('Copied to clipboard');
    } else if (selection === 'Save as CSV') {
      const csv = this.rowsToCsv(rowsToExport, columns);
      const uri = await vscode.window.showSaveDialog({ filters: { 'CSV': ['csv'] } });
      if (uri) await vscode.workspace.fs.writeFile(uri, Buffer.from(csv));
    } else if (selection === 'Save as JSON') {
      const json = JSON.stringify(rowsToExport, null, 2);
      const uri = await vscode.window.showSaveDialog({ filters: { 'JSON': ['json'] } });
      if (uri) await vscode.workspace.fs.writeFile(uri, Buffer.from(json));
    }
  }

  private rowsToCsv(rows: any[], columns: string[]): string {
    const header = columns.map(c => `"${c.replace(/"/g, '""')}"`).join(',');
    const body = rows.map(row => columns.map(col => {
      const val = row[col];
      const str = String(val ?? '');
      return str.includes(',') || str.includes('\n') ? `"${str.replace(/"/g, '""')}"` : str;
    }).join(',')).join('\n');
    return `${header}\n${body}`;
  }

  private async handleDeleteRows(event: any) {
    console.log('[NotebookKernel] handleDeleteRows called, event.message:', event.message);
    const { tableInfo, rows, row } = event.message; // Support both 'rows' (array) and legacy 'row' (single)
    const targets = rows || (row ? [row] : []);
    console.log('[NotebookKernel] targets:', targets);

    if (targets.length === 0) return;

    const { schema, table, primaryKeys } = tableInfo || event.message; // Support legacy payload structure if needed
    console.log('[NotebookKernel] schema:', schema, 'table:', table, 'primaryKeys:', primaryKeys);

    if (!primaryKeys || primaryKeys.length === 0) {
      vscode.window.showErrorMessage('Cannot delete: No primary keys defined for this table.');
      return;
    }

    const notebook = event.editor.notebook;
    const metadata = notebook.metadata as PostgresMetadata;
    if (!metadata?.connectionId) return;

    try {
      const connection = ConnectionUtils.findConnection(metadata.connectionId);
      if (!connection) throw new Error('Connection not found');

      // Use ConnectionManager with correct database from metadata
      const config = {
        ...connection,
        database: metadata.databaseName || connection.database
      };

      const client = await ConnectionManager.getInstance().getSessionClient(config, notebook.uri.toString());

      // Batch delete matching PKs
      // DELETE FROM table WHERE (pk1, pk2) IN ((v1, v2), (v3, v4))
      // Constructing a safe parameterized query

      // Flatten all values for parameters
      const allValues: any[] = [];
      const rowConditions: string[] = [];

      let paramIndex = 1;

      for (const targetRow of targets) {
        const conditions: string[] = [];
        for (const pk of primaryKeys) {
          conditions.push(`$${paramIndex++}`);
          allValues.push(targetRow[pk]);
        }
        if (primaryKeys.length > 1) {
          rowConditions.push(`(${conditions.join(', ')})`);
        } else {
          rowConditions.push(conditions[0]);
        }
      }

      const pkCols = primaryKeys.map((pk: string) => `"${pk}"`).join(', ');
      const whereClause = primaryKeys.length > 1
        ? `(${pkCols}) IN (${rowConditions.join(', ')})`
        : `${pkCols} IN (${rowConditions.join(', ')})`;

      const query = `DELETE FROM "${schema}"."${table}" WHERE ${whereClause}`;
      console.log('[NotebookKernel] Executing query:', query);
      console.log('[NotebookKernel] Query params:', allValues);

      const result = await client.query(query, allValues);

      vscode.window.showInformationMessage(`Deleted ${result.rowCount} row(s) from ${schema}.${table}`);
      console.log('[NotebookKernel] Delete successful, rowCount:', result.rowCount);

      // Re-execute the cell to refresh the data
      const cell = event.editor.document;
      if (cell) {
        console.log('[NotebookKernel] Re-executing cell to refresh data');
        await vscode.commands.executeCommand('notebook.cell.execute', { ranges: [{ start: cell.index, end: cell.index + 1 }] });
      }

    } catch (err: any) {
      console.error('[NotebookKernel] Delete failed:', err);
      vscode.window.showErrorMessage(`Failed to delete rows: ${err.message}`);
    }
  }

  private async getSessionClient(notebook: vscode.NotebookDocument): Promise<any> {
    const metadata = notebook.metadata as PostgresMetadata;
    if (!metadata?.connectionId) throw new Error('No connection found');

    const connections = vscode.workspace.getConfiguration().get<any[]>('postgresExplorer.connections') || [];
    const connection = connections.find(c => c.id === metadata.connectionId);
    if (!connection) throw new Error('Connection not found');

    return await ConnectionManager.getInstance().getSessionClient({
      id: connection.id,
      host: connection.host,
      port: connection.port,
      username: connection.username,
      database: metadata.databaseName || connection.database,
      name: connection.name
    }, notebook.uri.toString());
  }

  private async handleTransactionBegin(event: any) {
    try {
      const notebook = event.editor.notebook;
      const client = await this.getSessionClient(notebook);
      const sessionId = notebook.uri.toString();
      const txManager = getTransactionManager();
      const { isolationLevel = 'READ COMMITTED', readOnly = false, deferrable = false } = event.message;

      await txManager.beginTransaction(client, sessionId, isolationLevel as IsolationLevel, readOnly, deferrable);
      
      const summary = txManager.getTransactionSummary(sessionId);
      vscode.window.showInformationMessage(summary);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to begin transaction: ${err.message}`);
    }
  }

  private async handleTransactionCommit(event: any) {
    try {
      const notebook = event.editor.notebook;
      const client = await this.getSessionClient(notebook);
      const sessionId = notebook.uri.toString();
      const txManager = getTransactionManager();

      await txManager.commitTransaction(client, sessionId);
      vscode.window.showInformationMessage('✅ Transaction committed');
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to commit transaction: ${err.message}`);
    }
  }

  private async handleTransactionRollback(event: any) {
    try {
      const notebook = event.editor.notebook;
      const client = await this.getSessionClient(notebook);
      const sessionId = notebook.uri.toString();
      const txManager = getTransactionManager();

      await txManager.rollbackTransaction(client, sessionId);
      vscode.window.showInformationMessage('⏮️ Transaction rolled back');
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to rollback transaction: ${err.message}`);
    }
  }

  private async handleSavepointCreate(event: any) {
    try {
      const notebook = event.editor.notebook;
      const client = await this.getSessionClient(notebook);
      const sessionId = notebook.uri.toString();
      const txManager = getTransactionManager();

      const savepointName = await txManager.createSavepoint(client, sessionId);
      vscode.window.showInformationMessage(`📍 Savepoint created: ${savepointName}`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to create savepoint: ${err.message}`);
    }
  }

  private async handleSavepointRelease(event: any) {
    try {
      const notebook = event.editor.notebook;
      const client = await this.getSessionClient(notebook);
      const sessionId = notebook.uri.toString();
      const txManager = getTransactionManager();
      const { savepointName } = event.message;

      await txManager.releaseSavepoint(client, sessionId, savepointName);
      vscode.window.showInformationMessage(`✓ Savepoint released: ${savepointName || 'latest'}`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to release savepoint: ${err.message}`);
    }
  }

  private async handleSavepointRollback(event: any) {
    try {
      const notebook = event.editor.notebook;
      const client = await this.getSessionClient(notebook);
      const sessionId = notebook.uri.toString();
      const txManager = getTransactionManager();
      const { savepointName } = event.message;

      await txManager.rollbackToSavepoint(client, sessionId, savepointName);
      vscode.window.showInformationMessage(`⏮️ Rolled back to savepoint: ${savepointName || 'latest'}`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to rollback savepoint: ${err.message}`);
    }
  }

  dispose() {
    const txManager = getTransactionManager();
    // Cleanup will happen on extension deactivation
    this._controller.dispose();
  }
}
