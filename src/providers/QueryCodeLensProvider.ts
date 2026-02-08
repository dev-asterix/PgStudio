import * as vscode from 'vscode';

/**
 * Provides CodeLens actions for SQL queries in notebook cells
 * Detects SELECT queries and offers EXPLAIN and EXPLAIN ANALYZE options
 */
export class QueryCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  public refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] {
    // Only provide CodeLens for SQL in notebook cells
    if (document.uri.scheme !== 'vscode-notebook-cell') {
      return [];
    }

    if (document.languageId !== 'postgres' && document.languageId !== 'sql') {
      return [];
    }

    const text = document.getText().trim();
    
    // Don't show CodeLens for empty cells
    if (!text) {
      return [];
    }

    // Check if it's already an EXPLAIN query
    const isExplainQuery = /^\s*EXPLAIN/i.test(text);

    const codeLenses: vscode.CodeLens[] = [];
    const range = new vscode.Range(0, 0, 0, 0);

    // Show EXPLAIN options for any query that isn't already EXPLAIN
    if (!isExplainQuery) {
      codeLenses.push(
        new vscode.CodeLens(range, {
          title: '$(graph) EXPLAIN',
          tooltip: 'Show query execution plan without running the query',
          command: 'postgres-explorer.explainQuery',
          arguments: [document.uri, false]
        })
      );

      codeLenses.push(
        new vscode.CodeLens(range, {
          title: '$(telescope) EXPLAIN ANALYZE',
          tooltip: 'Show query execution plan with actual runtime statistics',
          command: 'postgres-explorer.explainQuery',
          arguments: [document.uri, true]
        })
      );
    }

    // Add Save Query codelens for all queries
    codeLenses.push(
      new vscode.CodeLens(range, {
        title: '$(save) Save Query',
        tooltip: 'Save this query to the library for easy reuse',
        command: 'postgres-explorer.saveQueryToLibraryUI'
      })
    );

    return codeLenses;
  }
}
