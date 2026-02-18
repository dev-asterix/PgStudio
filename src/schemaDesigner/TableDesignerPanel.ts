import * as vscode from 'vscode';
import { ErrorHandlers } from '../commands/helper';
import { DatabaseTreeItem } from '../providers/DatabaseTreeProvider';
import { resolveTreeItemConnection } from './connectionHelper';

/**
 * Visual Table Designer Panel
 *
 * Opens an interactive webview for designing/editing a PostgreSQL table.
 * Supports both "Edit" mode (existing table) and "Create" mode (new table).
 * Generates ALTER TABLE / CREATE TABLE DDL and opens it in a notebook for review.
 */
export class TableDesignerPanel {
  public static readonly viewType = 'pgStudio.tableDesigner';

  private static _panels = new Map<string, TableDesignerPanel>();

  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
  ) {
    this._panel = panel;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  /**
   * Open Table Designer for an existing table (Edit mode)
   */
  public static async openForTable(
    item: DatabaseTreeItem,
    context: vscode.ExtensionContext
  ): Promise<void> {
    let dbConn;
    try {
      dbConn = await resolveTreeItemConnection(item);
      if (!dbConn) return; // user cancelled
      const { client, metadata, connection } = dbConn;
      const schema = item.schema!;
      const tableName = item.label;

      // Fetch columns
      const colResult = await client.query(`
        SELECT
          a.attnum as ordinal,
          a.attname as column_name,
          pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
          a.attnotnull as not_null,
          pg_catalog.pg_get_expr(d.adbin, d.adrelid) as default_value,
          CASE WHEN pk.contype = 'p' THEN true ELSE false END as is_primary_key,
          CASE WHEN uq.contype = 'u' THEN true ELSE false END as is_unique,
          col_description(a.attrelid, a.attnum) as comment
        FROM pg_catalog.pg_attribute a
        LEFT JOIN pg_catalog.pg_attrdef d
          ON d.adrelid = a.attrelid AND d.adnum = a.attnum AND a.atthasdef
        LEFT JOIN pg_catalog.pg_constraint pk
          ON pk.conrelid = a.attrelid AND a.attnum = ANY(pk.conkey) AND pk.contype = 'p'
        LEFT JOIN pg_catalog.pg_constraint uq
          ON uq.conrelid = a.attrelid AND a.attnum = ANY(uq.conkey) AND uq.contype = 'u'
        WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum
      `, [`"${schema}"."${tableName}"`]);

      const columns = colResult.rows;

      // Fetch table comment
      const commentResult = await client.query(`
        SELECT obj_description(c.oid, 'pg_class') as comment
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = $1 AND n.nspname = $2
      `, [tableName, schema]);
      const tableComment = commentResult.rows[0]?.comment || '';

      const panelKey = `${item.connectionId}:${item.databaseName}:${schema}.${tableName}`;

      if (TableDesignerPanel._panels.has(panelKey)) {
        TableDesignerPanel._panels.get(panelKey)!._panel.reveal(vscode.ViewColumn.One);
        return;
      }

      const panel = vscode.window.createWebviewPanel(
        TableDesignerPanel.viewType,
        `🎨 ${schema}.${tableName}`,
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'resources')]
        }
      );

      const designer = new TableDesignerPanel(panel, context.extensionUri, context);
      TableDesignerPanel._panels.set(panelKey, designer);

      panel.onDidDispose(() => {
        TableDesignerPanel._panels.delete(panelKey);
      });

      panel.webview.html = TableDesignerPanel._getHtml(
        panel.webview,
        schema,
        tableName,
        columns,
        tableComment,
        false
      );

      // Handle messages from the webview
      panel.webview.onDidReceiveMessage(async (message) => {
        switch (message.type) {
          case 'applyChanges': {
            await TableDesignerPanel._applyChanges(
              message.original,
              message.modified,
              schema,
              tableName,
              metadata
            );
            break;
          }
          case 'copySQL': {
            await vscode.env.clipboard.writeText(message.sql);
            vscode.window.showInformationMessage('SQL copied to clipboard');
            break;
          }
        }
      }, null, designer._disposables);

    } catch (err: any) {
      await ErrorHandlers.handleCommandError(err, 'open table designer');
    } finally {
      if (dbConn && dbConn.release) dbConn.release();
    }
  }

  /**
   * Open Table Designer in Create mode (new table)
   */
  public static async openForCreate(
    item: DatabaseTreeItem,
    context: vscode.ExtensionContext
  ): Promise<void> {
    let dbConn;
    try {
      dbConn = await resolveTreeItemConnection(item);
      if (!dbConn) return; // user cancelled
      const { metadata } = dbConn;
      const labelStr = typeof item.label === 'string' ? item.label : (item.label as any)?.label ?? '';
      const schema = item.schema || labelStr || 'public';

      const panelKey = `create:${item.connectionId}:${item.databaseName}:${schema}`;

      if (TableDesignerPanel._panels.has(panelKey)) {
        TableDesignerPanel._panels.get(panelKey)!._panel.reveal(vscode.ViewColumn.One);
        return;
      }

      const panel = vscode.window.createWebviewPanel(
        TableDesignerPanel.viewType,
        `🎨 New Table in ${schema}`,
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        }
      );

      const designer = new TableDesignerPanel(panel, context.extensionUri, context);
      TableDesignerPanel._panels.set(panelKey, designer);

      panel.onDidDispose(() => {
        TableDesignerPanel._panels.delete(panelKey);
      });

      // Start with a default id column
      const defaultColumns = [
        {
          ordinal: 1,
          column_name: 'id',
          data_type: 'bigserial',
          not_null: true,
          default_value: null,
          is_primary_key: true,
          is_unique: false,
          comment: ''
        }
      ];

      panel.webview.html = TableDesignerPanel._getHtml(
        panel.webview,
        schema,
        '',
        defaultColumns,
        '',
        true
      );

      panel.webview.onDidReceiveMessage(async (message) => {
        switch (message.type) {
          case 'applyChanges': {
            await TableDesignerPanel._createTable(
              message.tableName,
              schema,
              message.modified,
              message.tableComment,
              metadata
            );
            break;
          }
          case 'copySQL': {
            await vscode.env.clipboard.writeText(message.sql);
            vscode.window.showInformationMessage('SQL copied to clipboard');
            break;
          }
        }
      }, null, designer._disposables);

    } catch (err: any) {
      await ErrorHandlers.handleCommandError(err, 'open table designer (create)');
    } finally {
      if (dbConn && dbConn.release) dbConn.release();
    }
  }

  /**
   * Generate ALTER TABLE SQL from diff and open in notebook
   */
  private static async _applyChanges(
    original: any[],
    modified: any[],
    schema: string,
    tableName: string,
    metadata: any
  ): Promise<void> {
    const statements: string[] = [];
    const originalMap = new Map(original.map((c: any) => [c.column_name, c]));
    const modifiedMap = new Map(modified.map((c: any) => [c.column_name, c]));

    // Detect dropped columns
    for (const [name, col] of originalMap) {
      if (!modifiedMap.has(name) && !col._deleted) {
        // column was removed from the list
      }
      if (col._deleted) {
        statements.push(`-- Drop column\nALTER TABLE "${schema}"."${tableName}"\n  DROP COLUMN "${name}";`);
      }
    }

    // Detect added columns
    for (const col of modified) {
      if (col._new) {
        const notNull = col.not_null ? ' NOT NULL' : '';
        const defaultVal = col.default_value ? ` DEFAULT ${col.default_value}` : '';
        statements.push(
          `-- Add column\nALTER TABLE "${schema}"."${tableName}"\n  ADD COLUMN "${col.column_name}" ${col.data_type}${notNull}${defaultVal};`
        );
        if (col.is_primary_key) {
          statements.push(
            `-- Add primary key\nALTER TABLE "${schema}"."${tableName}"\n  ADD PRIMARY KEY ("${col.column_name}");`
          );
        }
        if (col.comment) {
          statements.push(
            `-- Add column comment\nCOMMENT ON COLUMN "${schema}"."${tableName}"."${col.column_name}" IS '${col.comment.replace(/'/g, "''")}';`
          );
        }
      } else {
        // Detect modified columns
        const orig = originalMap.get(col.column_name);
        if (!orig) continue;

        if (orig.data_type !== col.data_type) {
          statements.push(
            `-- Change column type\nALTER TABLE "${schema}"."${tableName}"\n  ALTER COLUMN "${col.column_name}" TYPE ${col.data_type};`
          );
        }
        if (orig.not_null !== col.not_null) {
          if (col.not_null) {
            statements.push(
              `-- Set NOT NULL\nALTER TABLE "${schema}"."${tableName}"\n  ALTER COLUMN "${col.column_name}" SET NOT NULL;`
            );
          } else {
            statements.push(
              `-- Drop NOT NULL\nALTER TABLE "${schema}"."${tableName}"\n  ALTER COLUMN "${col.column_name}" DROP NOT NULL;`
            );
          }
        }
        if ((orig.default_value || '') !== (col.default_value || '')) {
          if (col.default_value) {
            statements.push(
              `-- Set default\nALTER TABLE "${schema}"."${tableName}"\n  ALTER COLUMN "${col.column_name}" SET DEFAULT ${col.default_value};`
            );
          } else {
            statements.push(
              `-- Drop default\nALTER TABLE "${schema}"."${tableName}"\n  ALTER COLUMN "${col.column_name}" DROP DEFAULT;`
            );
          }
        }
        if ((orig.comment || '') !== (col.comment || '')) {
          statements.push(
            `-- Update column comment\nCOMMENT ON COLUMN "${schema}"."${tableName}"."${col.column_name}" IS '${(col.comment || '').replace(/'/g, "''")}';`
          );
        }
      }
    }

    if (statements.length === 0) {
      vscode.window.showInformationMessage('No changes detected.');
      return;
    }

    const { createAndShowNotebook } = await import('../commands/connection');
    const cells: vscode.NotebookCellData[] = [
      new vscode.NotebookCellData(
        vscode.NotebookCellKind.Markup,
        `### 🎨 Table Designer: \`${schema}.${tableName}\`\n\n` +
        `<div style="font-size:12px;background:rgba(52,152,219,0.1);border-left:3px solid #3498db;padding:6px 10px;margin-bottom:15px;border-radius:3px;">` +
        `<strong>ℹ️ Review:</strong> Review each statement carefully before executing. Run them in a transaction for safety.</div>\n\n` +
        `Generated **${statements.length}** change(s).`,
        'markdown'
      ),
      new vscode.NotebookCellData(
        vscode.NotebookCellKind.Code,
        `-- Generated by PgStudio Table Designer\n-- Review carefully before executing!\n\nBEGIN;\n\n${statements.join('\n\n')}\n\n-- COMMIT; -- Uncomment to apply changes\n-- ROLLBACK; -- Uncomment to cancel`,
        'sql'
      )
    ];

    await createAndShowNotebook(cells, metadata);
  }

  /**
   * Generate CREATE TABLE SQL and open in notebook
   */
  private static async _createTable(
    tableName: string,
    schema: string,
    columns: any[],
    tableComment: string,
    metadata: any
  ): Promise<void> {
    if (!tableName || !tableName.trim()) {
      vscode.window.showWarningMessage('Please enter a table name.');
      return;
    }

    const pkCols = columns.filter(c => c.is_primary_key).map(c => `"${c.column_name}"`);
    const colDefs = columns.map(c => {
      const notNull = c.not_null ? ' NOT NULL' : '';
      const defaultVal = c.default_value ? ` DEFAULT ${c.default_value}` : '';
      return `  "${c.column_name}" ${c.data_type}${notNull}${defaultVal}`;
    });

    if (pkCols.length > 0) {
      colDefs.push(`  PRIMARY KEY (${pkCols.join(', ')})`);
    }

    const createSQL = `CREATE TABLE "${schema}"."${tableName}" (\n${colDefs.join(',\n')}\n);`;

    const commentStatements: string[] = [];
    if (tableComment) {
      commentStatements.push(`COMMENT ON TABLE "${schema}"."${tableName}" IS '${tableComment.replace(/'/g, "''")}';`);
    }
    for (const col of columns) {
      if (col.comment) {
        commentStatements.push(`COMMENT ON COLUMN "${schema}"."${tableName}"."${col.column_name}" IS '${col.comment.replace(/'/g, "''")}';`);
      }
    }

    const { createAndShowNotebook } = await import('../commands/connection');
    const cells: vscode.NotebookCellData[] = [
      new vscode.NotebookCellData(
        vscode.NotebookCellKind.Markup,
        `### 🎨 Create Table: \`${schema}.${tableName}\`\n\n` +
        `<div style="font-size:12px;background:rgba(46,204,113,0.1);border-left:3px solid #2ecc71;padding:6px 10px;margin-bottom:15px;border-radius:3px;">` +
        `<strong>💡 Tip:</strong> Review the generated SQL, then execute to create the table.</div>`,
        'markdown'
      ),
      new vscode.NotebookCellData(
        vscode.NotebookCellKind.Code,
        `-- Generated by PgStudio Table Designer\n${createSQL}${commentStatements.length > 0 ? '\n\n' + commentStatements.join('\n') : ''}`,
        'sql'
      )
    ];

    await createAndShowNotebook(cells, metadata);
  }

  private static _getHtml(
    webview: vscode.Webview,
    schema: string,
    tableName: string,
    columns: any[],
    tableComment: string,
    isCreate: boolean
  ): string {
    const columnsJson = JSON.stringify(columns);
    const mode = isCreate ? 'create' : 'edit';

    const pgTypes = [
      'bigint', 'bigserial', 'boolean', 'bytea', 'char', 'character varying',
      'date', 'double precision', 'integer', 'interval', 'json', 'jsonb',
      'numeric', 'real', 'serial', 'smallint', 'smallserial', 'text',
      'time', 'timestamp', 'timestamptz', 'uuid', 'varchar'
    ];
    const typeOptions = pgTypes.map(t => `<option value="${t}">${t}</option>`).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Table Designer</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: var(--vscode-editor-font-family, 'Segoe UI', sans-serif);
      font-size: 13px;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      margin: 0;
      padding: 0;
    }
    .header {
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--vscode-panel-border);
      padding: 12px 20px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .header h1 {
      font-size: 15px;
      font-weight: 600;
      margin: 0;
      color: var(--vscode-editor-foreground);
    }
    .badge {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 10px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    .main {
      display: flex;
      height: calc(100vh - 57px);
    }
    .left-pane {
      flex: 1;
      overflow-y: auto;
      padding: 16px 20px;
      border-right: 1px solid var(--vscode-panel-border);
    }
    .right-pane {
      width: 380px;
      display: flex;
      flex-direction: column;
      background: var(--vscode-sideBar-background);
    }
    .right-pane-header {
      padding: 10px 16px;
      font-weight: 600;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      border-bottom: 1px solid var(--vscode-panel-border);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .sql-preview {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
    }
    .sql-preview pre {
      margin: 0;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-textCodeBlock-background);
      padding: 12px;
      border-radius: 4px;
      min-height: 100px;
    }
    .right-pane-actions {
      padding: 12px;
      border-top: 1px solid var(--vscode-panel-border);
      display: flex;
      gap: 8px;
    }
    .section-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin: 0 0 8px 0;
    }
    .table-meta {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 20px;
    }
    .field-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .field-group label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      font-weight: 500;
    }
    input[type="text"], select, textarea {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 3px;
      padding: 5px 8px;
      font-size: 12px;
      font-family: inherit;
      outline: none;
      width: 100%;
    }
    input[type="text"]:focus, select:focus, textarea:focus {
      border-color: var(--vscode-focusBorder);
    }
    textarea { resize: vertical; min-height: 40px; }
    .columns-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 12px;
    }
    .columns-table th {
      text-align: left;
      padding: 6px 8px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      font-weight: 600;
      background: var(--vscode-sideBar-background);
      border-bottom: 2px solid var(--vscode-panel-border);
      white-space: nowrap;
    }
    .columns-table td {
      padding: 4px 4px;
      border-bottom: 1px solid var(--vscode-panel-border);
      vertical-align: middle;
    }
    .columns-table tr:hover td {
      background: var(--vscode-list-hoverBackground);
    }
    .columns-table tr.deleted td {
      opacity: 0.4;
      text-decoration: line-through;
    }
    .columns-table tr.new-row td {
      background: rgba(46, 204, 113, 0.05);
    }
    .col-input {
      background: transparent;
      border: 1px solid transparent;
      color: var(--vscode-editor-foreground);
      padding: 3px 6px;
      font-size: 12px;
      font-family: inherit;
      border-radius: 3px;
      width: 100%;
    }
    .col-input:focus {
      background: var(--vscode-input-background);
      border-color: var(--vscode-focusBorder);
      outline: none;
    }
    .col-select {
      background: transparent;
      border: 1px solid transparent;
      color: var(--vscode-editor-foreground);
      padding: 3px 4px;
      font-size: 12px;
      font-family: inherit;
      border-radius: 3px;
      width: 100%;
    }
    .col-select:focus {
      background: var(--vscode-input-background);
      border-color: var(--vscode-focusBorder);
      outline: none;
    }
    .col-checkbox {
      width: 14px;
      height: 14px;
      cursor: pointer;
    }
    .drag-handle {
      cursor: grab;
      color: var(--vscode-descriptionForeground);
      padding: 0 4px;
      font-size: 14px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 6px 12px;
      border: none;
      border-radius: 3px;
      font-size: 12px;
      font-family: inherit;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .btn:hover { opacity: 0.85; }
    .btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .btn-danger {
      background: transparent;
      color: var(--vscode-errorForeground);
      border: 1px solid var(--vscode-errorForeground);
      padding: 3px 6px;
      font-size: 11px;
    }
    .btn-add {
      background: transparent;
      color: var(--vscode-textLink-foreground);
      border: 1px dashed var(--vscode-textLink-foreground);
      padding: 5px 12px;
      width: 100%;
      justify-content: center;
      margin-bottom: 16px;
    }
    .pk-badge {
      font-size: 10px;
      color: var(--vscode-symbolIcon-keyForeground, #e5c07b);
    }
    .info-box {
      font-size: 11px;
      background: rgba(52,152,219,0.1);
      border-left: 3px solid #3498db;
      padding: 6px 10px;
      margin-bottom: 16px;
      border-radius: 3px;
      color: var(--vscode-editor-foreground);
    }
    .no-changes {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
      padding: 8px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🎨 Table Designer</h1>
    <span class="badge">${isCreate ? 'CREATE MODE' : 'EDIT MODE'}</span>
    <span style="color:var(--vscode-descriptionForeground);font-size:12px;">${isCreate ? schema : `${schema}.${tableName}`}</span>
  </div>

  <div class="main">
    <div class="left-pane">
      ${isCreate ? `
      <p class="section-title">Table Properties</p>
      <div class="table-meta">
        <div class="field-group">
          <label>Table Name *</label>
          <input type="text" id="tableName" placeholder="e.g. users" oninput="updateSQL()">
        </div>
        <div class="field-group">
          <label>Schema</label>
          <input type="text" id="schemaName" value="${schema}" readonly style="opacity:0.6;">
        </div>
        <div class="field-group" style="grid-column:1/-1;">
          <label>Comment</label>
          <textarea id="tableComment" rows="2" placeholder="Optional table description..." oninput="updateSQL()"></textarea>
        </div>
      </div>
      ` : `
      <div class="info-box">
        ℹ️ <strong>Edit mode:</strong> Modify columns below. Changes generate safe ALTER TABLE statements for review before execution.
      </div>
      `}

      <p class="section-title">Columns</p>
      <table class="columns-table" id="columnsTable">
        <thead>
          <tr>
            <th style="width:24px;"></th>
            <th style="width:160px;">Column Name</th>
            <th style="width:150px;">Data Type</th>
            <th style="width:70px;">Not Null</th>
            <th style="width:130px;">Default</th>
            <th style="width:40px;">PK</th>
            <th style="width:40px;">UQ</th>
            <th style="width:130px;">Comment</th>
            <th style="width:50px;"></th>
          </tr>
        </thead>
        <tbody id="columnRows">
        </tbody>
      </table>

      <button class="btn btn-add" onclick="addColumn()">+ Add Column</button>
    </div>

    <div class="right-pane">
      <div class="right-pane-header">📋 SQL Preview</div>
      <div class="sql-preview">
        <pre id="sqlPreview"><span style="color:var(--vscode-descriptionForeground);font-style:italic;">Make changes to see SQL preview...</span></pre>
      </div>
      <div class="right-pane-actions">
        <button class="btn btn-primary" onclick="applyChanges()" style="flex:1;">
          ▶ Open in Notebook
        </button>
        <button class="btn btn-secondary" onclick="copySQL()">
          📋 Copy
        </button>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const MODE = '${mode}';
    const SCHEMA = '${schema}';
    const TABLE_NAME = '${tableName}';
    const PG_TYPES = ${JSON.stringify(pgTypes)};

    let columns = ${columnsJson};
    let nextId = columns.length + 1;

    // Initialize
    renderColumns();
    updateSQL();

    function renderColumns() {
      const tbody = document.getElementById('columnRows');
      tbody.innerHTML = '';
      columns.forEach((col, idx) => {
        if (col._deleted) {
          const tr = document.createElement('tr');
          tr.className = 'deleted';
          tr.innerHTML = \`
            <td></td>
            <td colspan="7" style="padding:4px 8px;font-size:12px;">\${col.column_name} <em style="font-size:11px;">(will be dropped)</em></td>
            <td><button class="btn btn-secondary" style="padding:2px 6px;font-size:11px;" onclick="restoreColumn(\${idx})">Restore</button></td>
          \`;
          tbody.appendChild(tr);
          return;
        }

        const typeOptions = PG_TYPES.map(t =>
          \`<option value="\${t}" \${col.data_type === t ? 'selected' : ''}>\${t}</option>\`
        ).join('');

        const tr = document.createElement('tr');
        tr.className = col._new ? 'new-row' : '';
        tr.innerHTML = \`
          <td><span class="drag-handle">⠿</span></td>
          <td>
            <input class="col-input" type="text" value="\${col.column_name || ''}"
              onchange="updateCol(\${idx}, 'column_name', this.value)"
              oninput="updateSQL()" placeholder="column_name">
          </td>
          <td>
            <select class="col-select" onchange="updateCol(\${idx}, 'data_type', this.value)">
              \${typeOptions}
              <option value="\${col.data_type}" \${!PG_TYPES.includes(col.data_type) ? 'selected' : ''}>\${col.data_type}</option>
            </select>
          </td>
          <td style="text-align:center;">
            <input class="col-checkbox" type="checkbox" \${col.not_null ? 'checked' : ''}
              onchange="updateCol(\${idx}, 'not_null', this.checked)">
          </td>
          <td>
            <input class="col-input" type="text" value="\${col.default_value || ''}"
              onchange="updateCol(\${idx}, 'default_value', this.value || null)"
              oninput="updateSQL()" placeholder="NULL">
          </td>
          <td style="text-align:center;">
            <input class="col-checkbox" type="checkbox" \${col.is_primary_key ? 'checked' : ''}
              onchange="updateCol(\${idx}, 'is_primary_key', this.checked)">
          </td>
          <td style="text-align:center;">
            <input class="col-checkbox" type="checkbox" \${col.is_unique ? 'checked' : ''}
              onchange="updateCol(\${idx}, 'is_unique', this.checked)">
          </td>
          <td>
            <input class="col-input" type="text" value="\${(col.comment || '').replace(/"/g, '&quot;')}"
              onchange="updateCol(\${idx}, 'comment', this.value)"
              oninput="updateSQL()" placeholder="Optional...">
          </td>
          <td>
            <button class="btn btn-danger" onclick="deleteColumn(\${idx})">✕</button>
          </td>
        \`;
        tbody.appendChild(tr);
      });
    }

    function updateCol(idx, field, value) {
      columns[idx][field] = value;
      updateSQL();
    }

    function addColumn() {
      columns.push({
        ordinal: nextId++,
        column_name: '',
        data_type: 'text',
        not_null: false,
        default_value: null,
        is_primary_key: false,
        is_unique: false,
        comment: '',
        _new: true
      });
      renderColumns();
      updateSQL();
      // Focus the new column name input
      const inputs = document.querySelectorAll('.col-input');
      if (inputs.length > 0) {
        inputs[inputs.length - 9]?.focus();
      }
    }

    function deleteColumn(idx) {
      if (columns[idx]._new) {
        columns.splice(idx, 1);
      } else {
        columns[idx]._deleted = true;
      }
      renderColumns();
      updateSQL();
    }

    function restoreColumn(idx) {
      delete columns[idx]._deleted;
      renderColumns();
      updateSQL();
    }

    function generateSQL() {
      if (MODE === 'create') {
        return generateCreateSQL();
      } else {
        return generateAlterSQL();
      }
    }

    function generateCreateSQL() {
      const tblName = document.getElementById('tableName')?.value?.trim() || '<table_name>';
      const comment = document.getElementById('tableComment')?.value?.trim() || '';
      const activeCols = columns.filter(c => !c._deleted);

      if (activeCols.length === 0) {
        return '-- Add at least one column';
      }

      const pkCols = activeCols.filter(c => c.is_primary_key).map(c => '"' + c.column_name + '"');
      const colDefs = activeCols.map(c => {
        const nn = c.not_null ? ' NOT NULL' : '';
        const def = c.default_value ? ' DEFAULT ' + c.default_value : '';
        return '  "' + (c.column_name || 'column_name') + '" ' + c.data_type + nn + def;
      });

      if (pkCols.length > 0) {
        colDefs.push('  PRIMARY KEY (' + pkCols.join(', ') + ')');
      }

      let sql = 'CREATE TABLE "' + SCHEMA + '"."' + tblName + '" (\\n' + colDefs.join(',\\n') + '\\n);';

      if (comment) {
        sql += '\\n\\nCOMMENT ON TABLE "' + SCHEMA + '"."' + tblName + '" IS \\'' + comment.replace(/'/g, "''") + '\\';';
      }

      for (const c of activeCols) {
        if (c.comment) {
          sql += '\\nCOMMENT ON COLUMN "' + SCHEMA + '"."' + tblName + '"."' + c.column_name + '" IS \\'' + c.comment.replace(/'/g, "''") + '\\';';
        }
      }

      return sql;
    }

    function generateAlterSQL() {
      const originalCols = ${columnsJson};
      const origMap = {};
      originalCols.forEach(c => { origMap[c.column_name] = c; });

      const stmts = [];

      for (const col of columns) {
        if (col._deleted) {
          stmts.push('ALTER TABLE "' + SCHEMA + '"."' + TABLE_NAME + '"\\n  DROP COLUMN "' + col.column_name + '";');
          continue;
        }
        if (col._new) {
          const nn = col.not_null ? ' NOT NULL' : '';
          const def = col.default_value ? ' DEFAULT ' + col.default_value : '';
          stmts.push('ALTER TABLE "' + SCHEMA + '"."' + TABLE_NAME + '"\\n  ADD COLUMN "' + (col.column_name || 'column_name') + '" ' + col.data_type + nn + def + ';');
          if (col.comment) {
            stmts.push('COMMENT ON COLUMN "' + SCHEMA + '"."' + TABLE_NAME + '"."' + col.column_name + '" IS \\'' + col.comment.replace(/'/g, "''") + '\\';');
          }
          continue;
        }

        const orig = origMap[col.column_name];
        if (!orig) continue;

        if (orig.data_type !== col.data_type) {
          stmts.push('ALTER TABLE "' + SCHEMA + '"."' + TABLE_NAME + '"\\n  ALTER COLUMN "' + col.column_name + '" TYPE ' + col.data_type + ';');
        }
        if (orig.not_null !== col.not_null) {
          stmts.push('ALTER TABLE "' + SCHEMA + '"."' + TABLE_NAME + '"\\n  ALTER COLUMN "' + col.column_name + '" ' + (col.not_null ? 'SET' : 'DROP') + ' NOT NULL;');
        }
        if ((orig.default_value || '') !== (col.default_value || '')) {
          if (col.default_value) {
            stmts.push('ALTER TABLE "' + SCHEMA + '"."' + TABLE_NAME + '"\\n  ALTER COLUMN "' + col.column_name + '" SET DEFAULT ' + col.default_value + ';');
          } else {
            stmts.push('ALTER TABLE "' + SCHEMA + '"."' + TABLE_NAME + '"\\n  ALTER COLUMN "' + col.column_name + '" DROP DEFAULT;');
          }
        }
        if ((orig.comment || '') !== (col.comment || '')) {
          stmts.push('COMMENT ON COLUMN "' + SCHEMA + '"."' + TABLE_NAME + '"."' + col.column_name + '" IS \\'' + (col.comment || '').replace(/'/g, "''") + '\\';');
        }
      }

      if (stmts.length === 0) {
        return '-- No changes detected';
      }

      return '-- Generated by PgStudio Table Designer\\n-- Wrap in BEGIN/COMMIT for safety\\n\\n' + stmts.join('\\n\\n');
    }

    function updateSQL() {
      const sql = generateSQL();
      const pre = document.getElementById('sqlPreview');
      pre.textContent = sql;
    }

    function applyChanges() {
      const sql = generateSQL();
      if (sql === '-- No changes detected' || sql === '-- Add at least one column') {
        return;
      }

      if (MODE === 'create') {
        const tblName = document.getElementById('tableName')?.value?.trim();
        const comment = document.getElementById('tableComment')?.value?.trim() || '';
        vscode.postMessage({
          type: 'applyChanges',
          tableName: tblName,
          modified: columns.filter(c => !c._deleted),
          tableComment: comment
        });
      } else {
        const originalCols = ${columnsJson};
        vscode.postMessage({
          type: 'applyChanges',
          original: originalCols,
          modified: columns
        });
      }
    }

    function copySQL() {
      const sql = generateSQL();
      vscode.postMessage({ type: 'copySQL', sql });
    }
  </script>
</body>
</html>`;
  }

  public dispose(): void {
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) d.dispose();
    }
  }
}
