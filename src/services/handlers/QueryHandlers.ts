import * as vscode from 'vscode';
import { IMessageHandler } from '../MessageHandler';
import { PostgresMetadata } from '../../common/types';
import { ConnectionManager } from '../../services/ConnectionManager';
import { ErrorHandlers } from '../../commands/helper';
import { ConnectionUtils } from '../../utils/connectionUtils';
import { SqlExecutor } from '../../providers/kernel/SqlExecutor';

export class ExecuteUpdateBackgroundHandler implements IMessageHandler {
  async handle(message: any, context: { editor: vscode.NotebookEditor }) {
    if (!context.editor) return;

    const { statements } = message;
    let client;
    try {
      const notebook = context.editor.notebook;
      const metadata = notebook.metadata as PostgresMetadata;
      if (!metadata?.connectionId) {
        throw new Error('No connection in notebook metadata');
      }

      const connectionConfig = {
        id: metadata.connectionId,
        name: metadata.host,
        host: metadata.host,
        port: metadata.port,
        username: metadata.username,
        database: metadata.databaseName
      };

      client = await ConnectionManager.getInstance().getPooledClient(connectionConfig);

      let successCount = 0;
      let errorCount = 0;
      for (const stmt of statements) {
        try {
          await client.query(stmt);
          successCount++;
        } catch (err: any) {
          errorCount++;
          await ErrorHandlers.handleCommandError(err, 'update statement');
        }
      }

      if (successCount > 0) {
        vscode.window.showInformationMessage(`Successfully updated ${successCount} row(s)${errorCount > 0 ? `, ${errorCount} failed` : ''}`);
      }
    } catch (err: any) {
      await ErrorHandlers.handleCommandError(err, 'background updates');
    } finally {
      if (client) client.release();
    }
  }
}

export class ExecuteUpdateHandler implements IMessageHandler {
  async handle(message: any, context: { editor: vscode.NotebookEditor }) {
    if (!context.editor) return;

    const { statements, cellIndex } = message;
    const notebook = context.editor.notebook;
    try {
      const query = statements.join('\n');
      await this.insertCell(notebook, cellIndex + 1, `-- Update statements generated\n${query}`);
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
}

export class CancelQueryHandler implements IMessageHandler {
  async handle(message: any, context: { executor?: SqlExecutor }) {
    if (context.executor) {
      await context.executor.cancelQuery(message);
    } else {
      console.warn('CancelQueryHandler: No executor provided in context');
    }
  }
}

export class DeleteRowsHandler implements IMessageHandler {
  async handle(message: any, context: { editor: vscode.NotebookEditor }) {
    if (!context.editor) return;

    console.log('[DeleteRowsHandler] Called', message);
    const { tableInfo, rows, row } = message; // Support both 'rows' (array) and legacy 'row' (single)
    const targets = rows || (row ? [row] : []);

    if (targets.length === 0) return;

    const { schema, table, primaryKeys } = tableInfo || message;

    if (!primaryKeys || primaryKeys.length === 0) {
      vscode.window.showErrorMessage('Cannot delete: No primary keys defined for this table.');
      return;
    }

    const notebook = context.editor.notebook;
    const metadata = notebook.metadata as PostgresMetadata;
    if (!metadata?.connectionId) return;

    try {
      const connection = ConnectionUtils.findConnection(metadata.connectionId);
      if (!connection) throw new Error('Connection not found');

      const config = {
        ...connection,
        database: metadata.databaseName || connection.database
      };

      const client = await ConnectionManager.getInstance().getSessionClient(config, notebook.uri.toString());

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

      const result = await client.query(query, allValues);

      vscode.window.showInformationMessage(`Deleted ${result.rowCount} row(s) from ${schema}.${table}`);

      if (context.editor.selection) {
        const range = context.editor.selection;
        await vscode.commands.executeCommand('notebook.cell.execute', { ranges: [range], document: context.editor.notebook.uri });
      }

    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to delete rows: ${err.message}`);
    }
  }
}

export class ScriptDeleteHandler implements IMessageHandler {
  async handle(message: any, context: { editor: vscode.NotebookEditor }) {
    if (!context.editor) return;

    const { schema, table, primaryKeys, rows, cellIndex } = message;
    const notebook = context.editor.notebook;

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

      // Insert new cell with the query
      const targetIndex = cellIndex + 1;
      const newCell = new vscode.NotebookCellData(
        vscode.NotebookCellKind.Code,
        query,
        'sql'
      );

      const edit = new vscode.NotebookEdit(
        new vscode.NotebookRange(targetIndex, targetIndex),
        [newCell]
      );

      const workspaceEdit = new vscode.WorkspaceEdit();
      workspaceEdit.set(notebook.uri, [edit]);
      await vscode.workspace.applyEdit(workspaceEdit);
    } catch (err: any) {
      await ErrorHandlers.handleCommandError(err, 'generate delete script');
    }
  }
}

export class SaveChangesHandler implements IMessageHandler {
  async handle(message: any, context: { editor: vscode.NotebookEditor; postMessage?: (msg: any) => Thenable<boolean> }) {
    if (!context.editor) return;

    const { updates, deletions, tableInfo } = message;
    const { schema, table } = tableInfo;
    let client;

    try {
      const notebook = context.editor.notebook;
      const metadata = notebook.metadata as PostgresMetadata;
      if (!metadata?.connectionId) {
        vscode.window.showErrorMessage('Cannot save changes: No connection in notebook metadata');
        return;
      }

      // Use ConnectionManager to get a pooled client
      const connectionConfig = {
        id: metadata.connectionId,
        name: metadata.host,
        host: metadata.host,
        port: metadata.port,
        username: metadata.username,
        database: metadata.databaseName
      };

      client = await ConnectionManager.getInstance().getPooledClient(connectionConfig);

      let successCount = 0;
      let errorCount = 0;

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

        const query = `UPDATE "${schema}"."${table}" SET "${column}" = ${valueStr} WHERE ${conditions.join(' AND ')}`;

        try {
          await client.query(query);
          successCount++;
        } catch (err: any) {
          errorCount++;
          console.error('Update failed:', query, err);
        }
      }

      // Process DELETE queries
      let deletedCount = 0;
      for (const deletion of deletions || []) {
        const { keys } = deletion;

        // Build WHERE clause
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

        const query = `DELETE FROM "${schema}"."${table}" WHERE ${conditions.join(' AND ')}`;

        try {
          await client.query(query);
          deletedCount++;
          successCount++;
        } catch (err: any) {
          errorCount++;
          console.error('Delete failed:', query, err);
        }
      }

      if (successCount > 0) {
        const parts = [];
        const updateCount = (updates?.length || 0);
        if (updateCount > 0) parts.push(`${updateCount} edit(s)`);
        if (deletedCount > 0) parts.push(`${deletedCount} deletion(s)`);

        vscode.window.showInformationMessage(`✅ Successfully saved ${parts.join(', ')}${errorCount > 0 ? `, ${errorCount} failed` : ''}`);
        // Notify renderer to clear modified cells and remove deleted rows
        if (context.postMessage) {
          context.postMessage({ type: 'saveSuccess', successCount, errorCount, deletedCount });
        }
      } else if (errorCount > 0) {
        vscode.window.showErrorMessage(`Failed to save changes: ${errorCount} error(s)`);
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to save changes: ${err.message}`);
    } finally {
      if (client) client.release();
    }
  }
}
