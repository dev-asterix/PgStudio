import { Client, PoolClient } from 'pg';
import * as vscode from 'vscode';
import { fetchStats } from './DashboardData';
import { getErrorHtml, getHtmlForWebview, getLoadingHtml } from './DashboardHtml';
import { ConnectionManager } from '../services/ConnectionManager';
import { ConnectionConfig } from '../common/types';
import { createMetadata, createAndShowNotebook } from '../commands/connection';

export class DashboardPanel {
  private static panels: Map<string, DashboardPanel> = new Map();
  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];
  private readonly _panelKey: string;

  private constructor(panel: vscode.WebviewPanel, private readonly config: ConnectionConfig, private readonly dbName: string, panelKey: string, private readonly extensionUri: vscode.Uri) {
    this._panel = panel;
    this._panelKey = panelKey;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.html = getLoadingHtml();

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async message => {
        switch (message.command) {
          case 'refresh':
            await this._update();
            break;
          case 'showDetails':
            await this._showDetails(message.type);
            break;
          case 'explainQuery':
            // Open a new notebook with the query, prefixed with EXPLAIN ANALYZE
            // and connected to the current database
            const metadata = createMetadata(this.config, this.dbName);
            const cell = new vscode.NotebookCellData(
              vscode.NotebookCellKind.Code,
              'EXPLAIN ANALYZE ' + message.query,
              'sql'
            );
            await createAndShowNotebook([cell], metadata);
            break;
          case 'terminateQuery':
            const termAns = await vscode.window.showWarningMessage(
              `Are you sure you want to terminate query ${message.pid}?`,
              { modal: true },
              'Yes', 'No'
            );
            if (termAns === 'Yes') {
              await this._terminateQuery(message.pid);
            }
            break;
          case 'cancelQuery':
            const cancelAns = await vscode.window.showWarningMessage(
              `Are you sure you want to cancel query ${message.pid}?`,
              { modal: true },
              'Yes', 'No'
            );
            if (cancelAns === 'Yes') {
              await this._cancelQuery(message.pid);
            }
            break;
        }
      },
      null,
      this._disposables
    );

    this._update();
  }

  public static async show(extensionUri: vscode.Uri, config: ConnectionConfig, dbName: string, connectionId?: string) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // Create unique key for this dashboard (connection + database)
    // Use timestamp to allow multiple dashboards for the same database
    const timestamp = Date.now();
    const panelKey = `${connectionId || 'default'}-${dbName}-${timestamp}`;

    // Always create a new panel to allow multiple dashboards
    const panel = vscode.window.createWebviewPanel(
      'postgresDashboard',
      `Dashboard: ${dbName}`,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    const dashboardPanel = new DashboardPanel(panel, config, dbName, panelKey, extensionUri);
    DashboardPanel.panels.set(panelKey, dashboardPanel);
  }

  public dispose() {
    DashboardPanel.panels.delete(this._panelKey);
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private async getClient(): Promise<PoolClient> {
    return await ConnectionManager.getInstance().getPooledClient(this.config);
  }

  private async _terminateQuery(pid: number) {
    let client;
    try {
      client = await this.getClient();
      await client.query('SELECT pg_terminate_backend($1)', [pid]);
      vscode.window.showInformationMessage(`Terminated query with PID ${pid}`);
      this._update();
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to terminate query: ${error.message}`);
    } finally {
      if (client) client.release();
    }
  }

  private async _cancelQuery(pid: number) {
    let client;
    try {
      client = await this.getClient();
      await client.query('SELECT pg_cancel_backend($1)', [pid]);
      vscode.window.showInformationMessage(`Cancelled query with PID ${pid}`);
      this._update();
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to cancel query: ${error.message}`);
    } finally {
      if (client) client.release();
    }
  }



  private async _update() {
    let client;
    try {
      client = await this.getClient();
      const stats = await fetchStats(client as unknown as Client, this.dbName);
      this._panel.webview.postMessage({ command: 'updateStats', stats });
      // If it's the first load, set the HTML
      if (this._panel.webview.html.includes('Loading Dashboard...')) {
        this._panel.webview.html = await getHtmlForWebview(this._panel.webview, this.extensionUri, stats);
      }
    } catch (error: any) {
      // Only show error if we haven't loaded the UI yet, otherwise send error message
      if (this._panel.webview.html.includes('Loading Dashboard...')) {
        this._panel.webview.html = getErrorHtml(error.message);
      } else {
        // Could send error toast to webview here
        console.error('Dashboard update failed:', error);
      }
    } finally {
      if (client) client.release();
    }
  }

  private async _showDetails(type: string) {
    let client;
    try {
      client = await this.getClient();
      let data: any[] = [];
      let columns: string[] = [];

      switch (type) {
        case 'tables':
          const res = await client.query(`
                        SELECT schemaname || '.' || tablename as name,
                               pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename)) as size,
                               pg_total_relation_size(schemaname || '.' || tablename) as raw_size
                        FROM pg_tables
                        WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
                        ORDER BY raw_size DESC
                    `);
          data = res.rows;
          columns = ['Name', 'Size'];
          break;
        case 'views':
          const vRes = await client.query(`
                        SELECT schemaname || '.' || viewname as name,
                               viewowner as owner
                        FROM pg_views
                        WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
                        ORDER BY schemaname, viewname
                    `);
          data = vRes.rows;
          columns = ['Name', 'Owner'];
          break;
        case 'functions':
          const fRes = await client.query(`
                        SELECT n.nspname || '.' || p.proname as name,
                               l.lanname as language
                        FROM pg_proc p
                        JOIN pg_namespace n ON p.pronamespace = n.oid
                        JOIN pg_language l ON p.prolang = l.oid
                        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
                        ORDER BY n.nspname, p.proname
                    `);
          data = fRes.rows;
          columns = ['Name', 'Language'];
          break;
        case 'pgStatStatements':
          const pgRes = await client.query(`
                        SELECT query, calls, total_time, mean_time, rows
                        FROM pg_stat_statements
                        WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
                        ORDER BY total_time DESC
                        LIMIT 50
                    `);
          data = pgRes.rows.map((r: any) => ({
            query: r.query,
            calls: r.calls,
            total_time: Number(r.total_time).toFixed(1),
            mean_time: Number(r.mean_time).toFixed(1),
            rows: r.rows
          }));
          columns = ['Query', 'Calls', 'Total Time (ms)', 'Mean Time (ms)', 'Rows'];
          break;
        // Add other cases as needed
      }

      this._panel.webview.postMessage({ command: 'showDetails', type, data, columns });
    } catch (error: any) {
      console.error('Failed to fetch details:', error);
    } finally {
      if (client) client.release();
    }
  }
}
