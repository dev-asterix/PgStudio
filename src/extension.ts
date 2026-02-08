import { Client } from 'pg';
import * as vscode from 'vscode';
import { PostgresMetadata } from './common/types';
import { PostgresKernel } from './providers/NotebookKernel';
import { ConnectionManager } from './services/ConnectionManager';
import { SecretStorageService } from './services/SecretStorageService';
import { ErrorHandlers } from './commands/helper';
import { registerProviders } from './activation/providers';
import { registerAllCommands } from './activation/commands';
import { NotebookStatusBar } from './activation/statusBar';
import { WhatsNewManager } from './activation/WhatsNewManager';
import { ChatViewProvider } from './providers/ChatViewProvider';
import { QueryHistoryService } from './services/QueryHistoryService';
import { ConnectionUtils } from './utils/connectionUtils';
import { ExplainProvider } from './providers/ExplainProvider';

export let outputChannel: vscode.OutputChannel;

let chatViewProvider: ChatViewProvider | undefined;

export function getChatViewProvider(): ChatViewProvider | undefined {
  return chatViewProvider;
}

export async function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('PgStudio');
  outputChannel.appendLine('Activating PgStudio extension');

  SecretStorageService.getInstance(context);
  ConnectionManager.getInstance();
  QueryHistoryService.initialize(context.workspaceState);

  const { databaseTreeProvider, treeView, chatViewProviderInstance: chatView } = registerProviders(context, outputChannel);
  chatViewProvider = chatView;

  // Store tree view instance for reveal functionality
  (databaseTreeProvider as any).setTreeView(treeView);

  registerAllCommands(context, databaseTreeProvider, chatView, outputChannel);

  // Kernel initialization
  // Kernel initialization
  const kernel = new PostgresKernel(context, 'postgres-notebook', async (msg: { type: string; command: string; format?: string; content?: string; filename?: string }) => {
    if (msg.type === 'custom' && msg.command === 'export') {
      vscode.commands.executeCommand('postgres-explorer.exportData', {
        format: msg.format,
        content: msg.content,
        filename: msg.filename
      });
    }
  });
  context.subscriptions.push(kernel);

  // What's New / Welcome Screen
  const whatsNewManager = new WhatsNewManager(context, context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('postgresExplorer.whatsNew', whatsNewManager)
  );
  await whatsNewManager.checkAndShow();

  context.subscriptions.push(
    vscode.commands.registerCommand('postgres-explorer.showWhatsNew', () => {
      whatsNewManager.checkAndShow(true);
    })
  );

  const queryKernel = new PostgresKernel(context, 'postgres-query');

  // Status bar for connection/database display
  const statusBar = new NotebookStatusBar();
  context.subscriptions.push(statusBar);

  const rendererMessaging = vscode.notebooks.createRendererMessaging('postgres-query-renderer');
  rendererMessaging.onDidReceiveMessage(async (event) => {
    const message = event.message;
    const notebook = event.editor.notebook;

    if (message.type === 'explainError') {
      if (chatView) {
        await chatView.handleExplainError(message.error, message.query);
      }
      return;
    }
    if (message.type === 'fixQuery') {
      if (chatView) {
        await chatView.handleFixQuery(message.error, message.query);
      }
      return;
    }
    if (message.type === 'analyzeData') {
      if (chatView) {
        await chatView.handleAnalyzeData(message.data, message.query, message.rowCount);
      }
      return;
    }
    if (message.type === 'optimizeQuery') {
      if (chatView) {
        await chatView.handleOptimizeQuery(message.query, message.executionTime);
      }
      return;
    }
    if (message.type === 'sendToChat') {
      if (chatView) {
        await vscode.commands.executeCommand('postgresExplorer.chatView.focus');
        await chatView.sendToChat(message.data);
      }
      return;
    }

    if (message.type === 'showExplainPlan') {
      ExplainProvider.show(context.extensionUri, message.plan, message.query);
      return;
    }

    if (message.type === 'convertExplainToJson') {
      // Convert text EXPLAIN to FORMAT JSON and show visual plan
      const originalQuery = message.query;
      
      if (!originalQuery) {
        vscode.window.showErrorMessage('No query available to convert');
        return;
      }
      
      // Extract the actual query from EXPLAIN statement
      const explainMatch = originalQuery.match(/^\s*EXPLAIN\s*(?:\([^)]*\))?\s*(.+)$/is);
      const innerQuery = explainMatch ? explainMatch[1].trim() : originalQuery;
      
      // Create new query with FORMAT JSON
      const jsonQuery = `EXPLAIN (FORMAT JSON, ANALYZE, BUFFERS, VERBOSE)\n${innerQuery}`;
      
      // Execute and show plan
      try {
        const metadata = notebook.metadata as PostgresMetadata;
        
        // Get connection config from workspace settings
        const connections = vscode.workspace.getConfiguration().get<any[]>('postgresExplorer.connections') || [];
        const connection = connections.find(c => c.id === metadata.connectionId);
        
        if (!connection) {
          vscode.window.showErrorMessage('No active database connection');
          return;
        }

        const password = await SecretStorageService.getInstance().getPassword(metadata.connectionId);
        if (!password && connection.authMode === 'password') {
          vscode.window.showErrorMessage('Password not found for connection');
          return;
        }

        // Show progress
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: 'Converting EXPLAIN to JSON format...',
          cancellable: false
        }, async () => {
          const { Pool } = await import('pg');
          const client = new Pool({
            host: connection.host,
            port: connection.port,
            user: connection.username,
            password: password || undefined,
            database: metadata.databaseName,
            ssl: connection.ssl ? { rejectUnauthorized: false } : false
          });

          const result = await client.query(jsonQuery);
          await client.end();

          if (result.rows?.length) {
            const planCell = result.rows[0]['QUERY PLAN'] ?? result.rows[0]['query_plan'];
            if (planCell) {
              const explainPlan = typeof planCell === 'string' ? JSON.parse(planCell) : planCell;
              ExplainProvider.show(context.extensionUri, explainPlan, innerQuery);
            } else {
              vscode.window.showErrorMessage('No plan data returned from query');
            }
          } else {
            vscode.window.showErrorMessage('No results returned from EXPLAIN query');
          }
        });
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to convert EXPLAIN query: ${error.message}`);
        console.error('EXPLAIN conversion error:', error);
      }
      return;
    }

    if (message.type === 'showConnectionSwitcher') {
      const metadata = notebook.metadata as PostgresMetadata;
      const selected = await ConnectionUtils.showConnectionPicker(message.connectionId);

      if (selected && selected.id !== message.connectionId) {
        await ConnectionUtils.updateNotebookMetadata(notebook, {
          connectionId: selected.id,
          databaseName: selected.database,
          host: selected.host,
          port: selected.port,
          username: selected.username
        });
        vscode.window.showInformationMessage(`Switched to: ${selected.name || selected.host}`);
        statusBar.update();
      }
      return;
    }

    if (message.type === 'showDatabaseSwitcher') {
      const metadata = notebook.metadata as PostgresMetadata;
      const connection = ConnectionUtils.findConnection(message.connectionId);

      if (!connection) {
        vscode.window.showErrorMessage('Connection not found');
        return;
      }

      const selectedDb = await ConnectionUtils.showDatabasePicker(connection, message.currentDatabase);

      if (selectedDb && selectedDb !== message.currentDatabase) {
        await ConnectionUtils.updateNotebookMetadata(notebook, { databaseName: selectedDb });
        vscode.window.showInformationMessage(`Switched to database: ${selectedDb}`);
        statusBar.update();
      }
      return;
    }


    if (message.type === 'execute_update_background') {
      const { statements } = message;
      let client;
      try {
        const metadata = notebook.metadata as PostgresMetadata;
        if (!metadata?.connectionId) {
          await ErrorHandlers.handleCommandError(new Error('No connection in notebook metadata'), 'background update');
          return;
        }

        // Use ConnectionManager to get a pooled client (handles SSL, SSH, etc.)
        const connectionConfig = {
          id: metadata.connectionId,
          name: metadata.host, // fallback name
          host: metadata.host,
          port: metadata.port,
          username: metadata.username,
          database: metadata.databaseName
        };

        client = await ConnectionManager.getInstance().getPooledClient(connectionConfig);

        // No need to connect(), pooled client is already connected

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
    } else if (message.type === 'script_delete') {
      const { schema, table, primaryKeys, rows, cellIndex } = message;

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
    } else if (message.type === 'saveChanges') {
      // Handle saveChanges from renderer
      const { updates, deletions, tableInfo } = message;
      const { schema, table } = tableInfo;
      let client;

      try {
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
          rendererMessaging.postMessage({ type: 'saveSuccess', successCount, errorCount, deletedCount }, event.editor);
        } else if (errorCount > 0) {
          vscode.window.showErrorMessage(`Failed to save changes: ${errorCount} error(s)`);
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to save changes: ${err.message}`);
      } finally {
        if (client) client.release();
      }
    } else if (message.type === 'showErrorMessage') {
      vscode.window.showErrorMessage(message.message);
    }
  });

  const { migrateExistingPasswords } = await import('./services/SecretStorageService');
  await migrateExistingPasswords(context);
}

export async function deactivate() {
  outputChannel?.appendLine('Deactivating PgStudio extension - closing all connections');
  
  try {
    // Close all database connections (pools and sessions)
    await ConnectionManager.getInstance().closeAll();
    outputChannel?.appendLine('All database connections closed successfully');
  } catch (err) {
    outputChannel?.appendLine(`Error closing connections during deactivation: ${err}`);
    console.error('Error during extension deactivation:', err);
  }
  
  outputChannel?.appendLine('PgStudio extension deactivated');
}
