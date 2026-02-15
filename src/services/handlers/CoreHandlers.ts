import * as vscode from 'vscode';
import { IMessageHandler } from '../MessageHandler';
import { ConnectionUtils } from '../../utils/connectionUtils';
import { PostgresMetadata } from '../../common/types';

export class ShowConnectionSwitcherHandler implements IMessageHandler {
  constructor(private statusBar: any) { }

  async handle(message: any, context: { editor: vscode.NotebookEditor }) {
    if (!context.editor) return;

    // const metadata = context.editor.metadata as PostgresMetadata; // Not directly accessible on editor type sometimes, check usage
    // Actually editor.notebook.metadata is read-only in API but we update via workspace edit or custom util
    // ConnectionUtils.updateNotebookMetadata handles the edit.

    const selected = await ConnectionUtils.showConnectionPicker(message.connectionId);

    if (selected && selected.id !== message.connectionId) {
      await ConnectionUtils.updateNotebookMetadata(context.editor.notebook, {
        connectionId: selected.id,
        databaseName: selected.database,
        host: selected.host,
        port: selected.port,
        username: selected.username
      });
      vscode.window.showInformationMessage(`Switched to: ${selected.name || selected.host}`);
      this.statusBar.update();
    }
  }
}

export class ShowDatabaseSwitcherHandler implements IMessageHandler {
  constructor(private statusBar: any) { }

  async handle(message: any, context: { editor: vscode.NotebookEditor }) {
    if (!context.editor) return;

    const connection = ConnectionUtils.findConnection(message.connectionId);
    if (!connection) {
      vscode.window.showErrorMessage('Connection not found');
      return;
    }

    const selectedDb = await ConnectionUtils.showDatabasePicker(connection, message.currentDatabase);

    if (selectedDb && selectedDb !== message.currentDatabase) {
      await ConnectionUtils.updateNotebookMetadata(context.editor.notebook, { databaseName: selectedDb });
      vscode.window.showInformationMessage(`Switched to database: ${selectedDb}`);
      this.statusBar.update();
    }
  }
}

export class ExportRequestHandler implements IMessageHandler {
  async handle(message: any) {
    // This logic was in NotebookKernel previously
    // It requires UI interaction so it fits here.
    const { rows: displayRows, columns } = message;

    const selection = await vscode.window.showQuickPick(['Save as CSV', 'Save as JSON', 'Copy to Clipboard']);
    if (!selection) return;

    const rowsToExport = displayRows;

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
}

export class ShowErrorMessageHandler implements IMessageHandler {
  async handle(message: any) {
    vscode.window.showErrorMessage(message.message);
  }
}

