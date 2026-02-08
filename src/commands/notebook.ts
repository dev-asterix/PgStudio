import * as vscode from 'vscode';
import { DatabaseTreeItem } from '../providers/DatabaseTreeProvider';
import { getDatabaseConnection, NotebookBuilder, MarkdownUtils, ErrorHandlers } from './helper';
import { PostgresMetadata } from '../common/types';

export async function cmdNewNotebook(item: DatabaseTreeItem) {
  try {
    // For schema and table items, validateItem is appropriate
    // For database-level operations, would need validateCategoryItem
    const dbConn = await getDatabaseConnection(item);
    const { metadata } = dbConn;
    if (dbConn.release) dbConn.release();

    await new NotebookBuilder(metadata)
      .addMarkdown(
        MarkdownUtils.header(`📓 New Notebook: \`${metadata.databaseName}\``) +
        MarkdownUtils.infoBox('Write and execute your SQL queries in the cell below.')
      )
      .addSql(`-- Connected to database: ${metadata.databaseName}
-- Write your SQL query here
SELECT * FROM ${item.schema ? `${item.schema}.${item.label}` : 'your_table'}
LIMIT 100;`)
      .show();

  } catch (err: any) {
    await ErrorHandlers.handleCommandError(err, 'create new notebook');
  }
}

/**
 * Execute EXPLAIN or EXPLAIN ANALYZE for a query
 * Executes in the notebook so results can be sent to chat
 */
export async function cmdExplainQuery(cellUri: vscode.Uri, analyze: boolean) {
  try {
    // Get the notebook cell document
    const doc = await vscode.workspace.openTextDocument(cellUri);
    if (!doc) {
      vscode.window.showErrorMessage('Could not find cell document');
      return;
    }

    let query = doc.getText().trim();
    if (!query) {
      vscode.window.showErrorMessage('Cell is empty');
      return;
    }

    // Get the notebook and its metadata
    const notebook = vscode.workspace.notebookDocuments.find(nb => 
      nb.getCells().some(c => c.document.uri.toString() === cellUri.toString())
    );

    if (!notebook) {
      vscode.window.showErrorMessage('Could not find notebook');
      return;
    }

    const metadata = notebook.metadata as PostgresMetadata;
    if (!metadata || !metadata.connectionId) {
      vscode.window.showErrorMessage('No connection metadata found');
      return;
    }

    // Wrap query in EXPLAIN
    const explainQuery = analyze 
      ? `EXPLAIN (FORMAT JSON, ANALYZE, BUFFERS, VERBOSE) ${query}`
      : `EXPLAIN (FORMAT JSON) ${query}`;

    // Find the cell in the notebook
    const cells = notebook.getCells();
    const cellIndex = cells.findIndex(c => c.document.uri.toString() === cellUri.toString());
    
    if (cellIndex === -1) {
      vscode.window.showErrorMessage('Could not locate cell in notebook');
      return;
    }

    // Create workspace edit to insert the EXPLAIN query cell after current cell
    const workspaceEdit = new vscode.WorkspaceEdit();
    
    const notebookEdit = new vscode.NotebookEdit(
      new vscode.NotebookRange(cellIndex + 1, cellIndex + 1),
      [
        new vscode.NotebookCellData(
          vscode.NotebookCellKind.Code,
          explainQuery,
          'sql'
        )
      ]
    );

    workspaceEdit.set(notebook.uri, [notebookEdit]);
    await vscode.workspace.applyEdit(workspaceEdit);

    vscode.window.showInformationMessage(
      analyze 
        ? 'EXPLAIN ANALYZE query created in next cell. Execute to see the plan with actual statistics. Send results to Chat for AI analysis!'
        : 'EXPLAIN query created in next cell. Execute to see the estimated execution plan. Send results to Chat for optimization suggestions!'
    );

  } catch (error: any) {
    await ErrorHandlers.handleCommandError(error, 'create EXPLAIN query');
  }
}