import * as vscode from 'vscode';
import { ErrorHandlers } from '../commands/helper';
import { DatabaseTreeItem } from '../providers/DatabaseTreeProvider';
import { resolveTreeItemConnection } from './connectionHelper';
import { ConnectionManager } from '../services/ConnectionManager';
import { SecretStorageService } from '../services/SecretStorageService';

interface SchemaSnapshot {
  tables: TableSnapshot[];
}

interface TableSnapshot {
  name: string;
  schema: string;
  columns: ColumnSnapshot[];
  constraints: ConstraintSnapshot[];
  indexes: IndexSnapshot[];
}

interface ColumnSnapshot {
  column_name: string;
  data_type: string;
  not_null: boolean;
  default_value: string | null;
  ordinal: number;
}

interface ConstraintSnapshot {
  name: string;
  type: string;
  definition: string;
}

interface IndexSnapshot {
  name: string;
  definition: string;
  is_unique: boolean;
  is_primary: boolean;
}

type DiffStatus = 'added' | 'removed' | 'changed' | 'unchanged';

interface TableDiff {
  name: string;
  status: DiffStatus;
  columnDiffs: ColumnDiff[];
  constraintDiffs: ConstraintDiff[];
  indexDiffs: IndexDiff[];
}

interface ColumnDiff {
  name: string;
  status: DiffStatus;
  before?: ColumnSnapshot;
  after?: ColumnSnapshot;
}

interface ConstraintDiff {
  name: string;
  status: DiffStatus;
  before?: ConstraintSnapshot;
  after?: ConstraintSnapshot;
}

interface IndexDiff {
  name: string;
  status: DiffStatus;
  before?: IndexSnapshot;
  after?: IndexSnapshot;
}

/**
 * Schema Diff Panel
 *
 * Compares two schemas (or the same schema at two points in time) and renders
 * a color-coded diff. Generates a migration SQL script for review in a notebook.
 */
export class SchemaDiffPanel {
  public static readonly viewType = 'pgStudio.schemaDiff';

  private static _panels = new Map<string, SchemaDiffPanel>();
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel) {
    this._panel = panel;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  public static async open(
    item: DatabaseTreeItem,
    context: vscode.ExtensionContext
  ): Promise<void> {
    let sourceConn;
    let targetConn: any;

    try {
      sourceConn = await resolveTreeItemConnection(item);
      if (!sourceConn) return; // user cancelled

      const { client: sourceClient, metadata } = sourceConn;

      // Determine source schema
      const labelStr = typeof item.label === 'string' ? item.label : (item.label as any)?.label ?? '';
      const sourceSchema = item.schema || labelStr || 'public';

      // 1. Get schemas in current DB
      const allSchemasResult = await sourceClient.query(`
        SELECT nspname as schema_name
        FROM pg_namespace
        WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
          AND nspname NOT LIKE 'pg_%'
        ORDER BY nspname
      `);

      const currentDbSchemas = allSchemasResult.rows.map((r: any) => r.schema_name);
      const otherSchemasInCurrentDb = currentDbSchemas.filter((s: string) => s !== sourceSchema);

      // 2. Build QuickPick items
      const pickItems: vscode.QuickPickItem[] = [
        {
          label: '$(server) Compare with another database...',
          description: 'Select a schema from a different connection or database',
          alwaysShow: true
        },
        {
          label: 'Current Database',
          kind: vscode.QuickPickItemKind.Separator
        },
        ...otherSchemasInCurrentDb.map(s => ({ label: s, description: 'Current Database' }))
      ];

      // 3. Ask user for target
      const selection = await vscode.window.showQuickPick(pickItems, {
        placeHolder: `Compare "${sourceSchema}" against...`,
        title: 'Schema Diff: Select Target'
      });

      if (!selection) return;

      let targetSchema = selection.label;
      let targetClient = sourceClient; // Default to same client

      // Handle "Compare with another database..."
      if (selection.label === '$(server) Compare with another database...') {
        // A. Pick Connection
        const connections = vscode.workspace.getConfiguration().get<any[]>('postgresExplorer.connections') || [];
        if (connections.length === 0) {
          vscode.window.showErrorMessage('No other connections found.');
          return;
        }

        const connPick = await vscode.window.showQuickPick(
          connections.map(c => ({
            label: c.name || `${c.host}:${c.port}`,
            description: c.database || 'postgres',
            original: c
          })),
          { title: 'Select Target Connection' }
        );
        if (!connPick) return;

        // B. Pick Database (need to connect first to list DBs)
        const selectedConn = connPick.original;

        // Connect to 'postgres' or default db to list databases
        const password = await SecretStorageService.getInstance().getPassword(selectedConn.id);
        if (!password) {
          vscode.window.showErrorMessage('Password not found for selected connection.');
          return;
        }

        const tempClient = await ConnectionManager.getInstance().getPooledClient({
          ...selectedConn,
          password,
          database: selectedConn.database || 'postgres' // Connect to default
        });

        try {
          const dbsResult = await tempClient.query(`
                SELECT datname FROM pg_database 
                WHERE datallowconn = true AND datname != 'postgres' AND datistemplate = false
                ORDER BY datname
            `);
          const databases = dbsResult.rows.map((r: any) => r.datname);

          // Add the default db if it's not in the list (e.g. if we filtered 'postgres' but it was the default)
          if (selectedConn.database && !databases.includes(selectedConn.database)) {
            databases.unshift(selectedConn.database);
          }

          const dbPick = await vscode.window.showQuickPick(databases, { title: 'Select Target Database' });
          if (!dbPick) return; // user cancelled

          // C. Connect to Target Database
          targetConn = {
            client: await ConnectionManager.getInstance().getPooledClient({
              ...selectedConn,
              password,
              database: dbPick
            }),
            release: () => targetConn?.client.release()
          };
          targetClient = targetConn.client;

          // D. Pick Schema in Target Database
          const targetSchemasResult = await targetClient.query(`
                SELECT nspname as schema_name
                FROM pg_namespace
                WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
                AND nspname NOT LIKE 'pg_%'
                ORDER BY nspname
            `);
          const targetSchemas = targetSchemasResult.rows.map((r: any) => r.schema_name);

          const schemaPick = await vscode.window.showQuickPick(targetSchemas, { title: `Select Schema in ${dbPick}` });
          if (!schemaPick) return;

          targetSchema = schemaPick;

        } finally {
          tempClient.release();
        }
      }

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Computing schema diff...', cancellable: false },
        async () => {
          // Serialize queries to avoid client interleaving issues (even if different clients, good practice)
          // sourceClient and targetClient might be same or different
          const sourceSnapshot = await SchemaDiffPanel._fetchSnapshot(sourceClient, sourceSchema);
          const targetSnapshot = await SchemaDiffPanel._fetchSnapshot(targetClient, targetSchema);

          const diffs = SchemaDiffPanel._computeDiff(sourceSnapshot, targetSnapshot);

          // Key needs to include target connection info to be unique
          const targetConnId = (targetClient === sourceClient) ? item.connectionId : 'external';
          const panelKey = `diff:${item.connectionId}:${item.databaseName}:${sourceSchema}:${targetConnId}:${targetSchema}`;

          if (SchemaDiffPanel._panels.has(panelKey)) {
            SchemaDiffPanel._panels.get(panelKey)!._panel.reveal(vscode.ViewColumn.One);
            return;
          }

          const panel = vscode.window.createWebviewPanel(
            SchemaDiffPanel.viewType,
            `🔍 Diff: ${sourceSchema} ↔ ${targetSchema}`,
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
          );

          const diffPanel = new SchemaDiffPanel(panel);
          SchemaDiffPanel._panels.set(panelKey, diffPanel);

          panel.onDidDispose(() => {
            SchemaDiffPanel._panels.delete(panelKey);
          });

          panel.webview.html = SchemaDiffPanel._getHtml(
            sourceSchema,
            targetSchema,
            diffs
          );

          panel.webview.onDidReceiveMessage(async (message) => {
            if (message.type === 'generateMigration') {
              await SchemaDiffPanel._generateMigration(
                sourceSchema,
                targetSchema,
                diffs,
                metadata
              );
            }
          }, null, diffPanel._disposables);
        }
      );

    } catch (err: any) {
      await ErrorHandlers.handleCommandError(err, 'open schema diff');
    } finally {
      if (sourceConn && sourceConn.release) sourceConn.release();
      if (targetConn && targetConn.client) targetConn.release();
    }
  }

  private static async _fetchSnapshot(client: any, schema: string): Promise<SchemaSnapshot> {
    // Fetch tables
    const tablesResult = await client.query(`
      SELECT c.relname as table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind = 'r'
      ORDER BY c.relname
    `, [schema]);

    const tables: TableSnapshot[] = [];

    for (const tableRow of tablesResult.rows) {
      const tableName = tableRow.table_name;

      // Columns
      const colResult = await client.query(`
        SELECT
          a.attnum as ordinal,
          a.attname as column_name,
          pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
          a.attnotnull as not_null,
          pg_catalog.pg_get_expr(d.adbin, d.adrelid) as default_value
        FROM pg_catalog.pg_attribute a
        LEFT JOIN pg_catalog.pg_attrdef d
          ON d.adrelid = a.attrelid AND d.adnum = a.attnum AND a.atthasdef
        WHERE a.attrelid = ($1 || '.' || $2)::regclass
          AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum
      `, [schema, tableName]);

      // Constraints
      const conResult = await client.query(`
        SELECT
          conname as name,
          CASE contype
            WHEN 'p' THEN 'PRIMARY KEY'
            WHEN 'f' THEN 'FOREIGN KEY'
            WHEN 'u' THEN 'UNIQUE'
            WHEN 'c' THEN 'CHECK'
            ELSE contype
          END as type,
          pg_get_constraintdef(oid) as definition
        FROM pg_constraint
        WHERE conrelid = ($1 || '.' || $2)::regclass
        ORDER BY conname
      `, [schema, tableName]);

      // Indexes
      const idxResult = await client.query(`
        SELECT
          i.relname as name,
          pg_get_indexdef(ix.indexrelid) as definition,
          ix.indisunique as is_unique,
          ix.indisprimary as is_primary
        FROM pg_index ix
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_class t ON t.oid = ix.indrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE t.relname = $1 AND n.nspname = $2
        ORDER BY i.relname
      `, [tableName, schema]);

      tables.push({
        name: tableName,
        schema,
        columns: colResult.rows,
        constraints: conResult.rows,
        indexes: idxResult.rows
      });
    }

    return { tables };
  }

  private static _computeDiff(source: SchemaSnapshot, target: SchemaSnapshot): TableDiff[] {
    const diffs: TableDiff[] = [];
    const sourceMap = new Map(source.tables.map(t => [t.name, t]));
    const targetMap = new Map(target.tables.map(t => [t.name, t]));

    const allTableNames = new Set([...sourceMap.keys(), ...targetMap.keys()]);

    for (const tableName of allTableNames) {
      const srcTable = sourceMap.get(tableName);
      const tgtTable = targetMap.get(tableName);

      if (!srcTable) {
        // Table added in target
        diffs.push({
          name: tableName,
          status: 'added',
          columnDiffs: (tgtTable!.columns || []).map(c => ({ name: c.column_name, status: 'added', after: c })),
          constraintDiffs: (tgtTable!.constraints || []).map(c => ({ name: c.name, status: 'added', after: c })),
          indexDiffs: (tgtTable!.indexes || []).map(i => ({ name: i.name, status: 'added', after: i }))
        });
        continue;
      }

      if (!tgtTable) {
        // Table removed in target
        diffs.push({
          name: tableName,
          status: 'removed',
          columnDiffs: (srcTable.columns || []).map(c => ({ name: c.column_name, status: 'removed', before: c })),
          constraintDiffs: (srcTable.constraints || []).map(c => ({ name: c.name, status: 'removed', before: c })),
          indexDiffs: (srcTable.indexes || []).map(i => ({ name: i.name, status: 'removed', before: i }))
        });
        continue;
      }

      // Both exist — diff columns, constraints, indexes
      const columnDiffs = SchemaDiffPanel._diffColumns(srcTable.columns, tgtTable.columns);
      const constraintDiffs = SchemaDiffPanel._diffConstraints(srcTable.constraints, tgtTable.constraints);
      const indexDiffs = SchemaDiffPanel._diffIndexes(srcTable.indexes, tgtTable.indexes);

      const hasChanges = columnDiffs.some(d => d.status !== 'unchanged') ||
        constraintDiffs.some(d => d.status !== 'unchanged') ||
        indexDiffs.some(d => d.status !== 'unchanged');

      diffs.push({
        name: tableName,
        status: hasChanges ? 'changed' : 'unchanged',
        columnDiffs,
        constraintDiffs,
        indexDiffs
      });
    }

    // Sort: changed first, then added/removed, then unchanged
    const order: Record<DiffStatus, number> = { changed: 0, added: 1, removed: 2, unchanged: 3 };
    diffs.sort((a, b) => order[a.status] - order[b.status]);

    return diffs;
  }

  private static _diffColumns(src: ColumnSnapshot[], tgt: ColumnSnapshot[]): ColumnDiff[] {
    const srcMap = new Map(src.map(c => [c.column_name, c]));
    const tgtMap = new Map(tgt.map(c => [c.column_name, c]));
    const diffs: ColumnDiff[] = [];

    for (const [name, srcCol] of srcMap) {
      const tgtCol = tgtMap.get(name);
      if (!tgtCol) {
        diffs.push({ name, status: 'removed', before: srcCol });
      } else {
        const changed = srcCol.data_type !== tgtCol.data_type ||
          srcCol.not_null !== tgtCol.not_null ||
          (srcCol.default_value || '') !== (tgtCol.default_value || '');
        diffs.push({ name, status: changed ? 'changed' : 'unchanged', before: srcCol, after: tgtCol });
      }
    }
    for (const [name, tgtCol] of tgtMap) {
      if (!srcMap.has(name)) {
        diffs.push({ name, status: 'added', after: tgtCol });
      }
    }
    return diffs;
  }

  private static _diffConstraints(src: ConstraintSnapshot[], tgt: ConstraintSnapshot[]): ConstraintDiff[] {
    const srcMap = new Map(src.map(c => [c.name, c]));
    const tgtMap = new Map(tgt.map(c => [c.name, c]));
    const diffs: ConstraintDiff[] = [];

    for (const [name, srcCon] of srcMap) {
      const tgtCon = tgtMap.get(name);
      if (!tgtCon) {
        diffs.push({ name, status: 'removed', before: srcCon });
      } else {
        const changed = srcCon.definition !== tgtCon.definition;
        diffs.push({ name, status: changed ? 'changed' : 'unchanged', before: srcCon, after: tgtCon });
      }
    }
    for (const [name, tgtCon] of tgtMap) {
      if (!srcMap.has(name)) {
        diffs.push({ name, status: 'added', after: tgtCon });
      }
    }
    return diffs;
  }

  private static _diffIndexes(src: IndexSnapshot[], tgt: IndexSnapshot[]): IndexDiff[] {
    const srcMap = new Map(src.map(i => [i.name, i]));
    const tgtMap = new Map(tgt.map(i => [i.name, i]));
    const diffs: IndexDiff[] = [];

    for (const [name, srcIdx] of srcMap) {
      const tgtIdx = tgtMap.get(name);
      if (!tgtIdx) {
        diffs.push({ name, status: 'removed', before: srcIdx });
      } else {
        const changed = srcIdx.definition !== tgtIdx.definition;
        diffs.push({ name, status: changed ? 'changed' : 'unchanged', before: srcIdx, after: tgtIdx });
      }
    }
    for (const [name, tgtIdx] of tgtMap) {
      if (!srcMap.has(name)) {
        diffs.push({ name, status: 'added', after: tgtIdx });
      }
    }
    return diffs;
  }

  private static async _generateMigration(
    sourceSchema: string,
    targetSchema: string,
    diffs: TableDiff[],
    metadata: any
  ): Promise<void> {
    const stmts: string[] = [];

    for (const table of diffs) {
      if (table.status === 'unchanged') continue;

      if (table.status === 'added') {
        // Table exists in target but not source — generate CREATE TABLE
        const cols = table.columnDiffs.filter(c => c.status === 'added' && c.after);
        const colDefs = cols.map(c => {
          const nn = c.after!.not_null ? ' NOT NULL' : '';
          const def = c.after!.default_value ? ` DEFAULT ${c.after!.default_value}` : '';
          return `  "${c.name}" ${c.after!.data_type}${nn}${def}`;
        });
        stmts.push(`-- Table added in ${targetSchema}\nCREATE TABLE "${sourceSchema}"."${table.name}" (\n${colDefs.join(',\n')}\n);`);
        continue;
      }

      if (table.status === 'removed') {
        stmts.push(`-- Table removed in ${targetSchema}\n-- DROP TABLE "${sourceSchema}"."${table.name}"; -- Uncomment to drop`);
        continue;
      }

      // Changed table
      stmts.push(`-- Changes for table: ${table.name}`);

      for (const col of table.columnDiffs) {
        if (col.status === 'added' && col.after) {
          const nn = col.after.not_null ? ' NOT NULL' : '';
          const def = col.after.default_value ? ` DEFAULT ${col.after.default_value}` : '';
          stmts.push(`ALTER TABLE "${sourceSchema}"."${table.name}"\n  ADD COLUMN "${col.name}" ${col.after.data_type}${nn}${def};`);
        } else if (col.status === 'removed') {
          stmts.push(`-- ALTER TABLE "${sourceSchema}"."${table.name}"\n--   DROP COLUMN "${col.name}"; -- Uncomment to drop`);
        } else if (col.status === 'changed' && col.before && col.after) {
          if (col.before.data_type !== col.after.data_type) {
            stmts.push(`ALTER TABLE "${sourceSchema}"."${table.name}"\n  ALTER COLUMN "${col.name}" TYPE ${col.after.data_type};`);
          }
          if (col.before.not_null !== col.after.not_null) {
            stmts.push(`ALTER TABLE "${sourceSchema}"."${table.name}"\n  ALTER COLUMN "${col.name}" ${col.after.not_null ? 'SET' : 'DROP'} NOT NULL;`);
          }
          if ((col.before.default_value || '') !== (col.after.default_value || '')) {
            if (col.after.default_value) {
              stmts.push(`ALTER TABLE "${sourceSchema}"."${table.name}"\n  ALTER COLUMN "${col.name}" SET DEFAULT ${col.after.default_value};`);
            } else {
              stmts.push(`ALTER TABLE "${sourceSchema}"."${table.name}"\n  ALTER COLUMN "${col.name}" DROP DEFAULT;`);
            }
          }
        }
      }

      for (const con of table.constraintDiffs) {
        if (con.status === 'added' && con.after) {
          stmts.push(`ALTER TABLE "${sourceSchema}"."${table.name}"\n  ADD CONSTRAINT "${con.name}" ${con.after.definition};`);
        } else if (con.status === 'removed') {
          stmts.push(`-- ALTER TABLE "${sourceSchema}"."${table.name}"\n--   DROP CONSTRAINT "${con.name}"; -- Uncomment to drop`);
        }
      }

      for (const idx of table.indexDiffs) {
        if (idx.status === 'added' && idx.after) {
          // Replace schema in definition
          stmts.push(idx.after.definition.replace(
            new RegExp(`ON ${targetSchema}\\.`, 'g'),
            `ON ${sourceSchema}.`
          ) + ';');
        } else if (idx.status === 'removed') {
          stmts.push(`-- DROP INDEX "${idx.name}"; -- Uncomment to drop`);
        }
      }
    }

    if (stmts.length === 0) {
      vscode.window.showInformationMessage('No differences found between schemas.');
      return;
    }

    const { createAndShowNotebook } = await import('../commands/connection');
    const cells: vscode.NotebookCellData[] = [
      new vscode.NotebookCellData(
        vscode.NotebookCellKind.Markup,
        `### 🔍 Schema Migration: \`${sourceSchema}\` → \`${targetSchema}\`\n\n` +
        `<div style="font-size:12px;background:rgba(231,76,60,0.1);border-left:3px solid #e74c3c;padding:6px 10px;margin-bottom:15px;border-radius:3px;">` +
        `<strong>⚠️ Warning:</strong> Review all statements carefully. DROP operations are commented out for safety.</div>\n\n` +
        `Generated **${stmts.length}** migration statement(s).`,
        'markdown'
      ),
      new vscode.NotebookCellData(
        vscode.NotebookCellKind.Code,
        `-- Schema Migration Script\n-- Source: ${sourceSchema}  Target: ${targetSchema}\n-- Generated by PgStudio Schema Diff\n\nBEGIN;\n\n${stmts.join('\n\n')}\n\n-- COMMIT; -- Uncomment to apply\n-- ROLLBACK; -- Uncomment to cancel`,
        'sql'
      )
    ];

    await createAndShowNotebook(cells, metadata);
  }

  private static _getHtml(
    sourceSchema: string,
    targetSchema: string,
    diffs: TableDiff[]
  ): string {
    const totalTables = diffs.length;
    const added = diffs.filter(d => d.status === 'added').length;
    const removed = diffs.filter(d => d.status === 'removed').length;
    const changed = diffs.filter(d => d.status === 'changed').length;
    const unchanged = diffs.filter(d => d.status === 'unchanged').length;

    const statusIcon: Record<DiffStatus, string> = {
      added: '🟢',
      removed: '🔴',
      changed: '🟡',
      unchanged: '⚪'
    };
    const statusLabel: Record<DiffStatus, string> = {
      added: 'Added',
      removed: 'Removed',
      changed: 'Changed',
      unchanged: 'Unchanged'
    };
    const statusClass: Record<DiffStatus, string> = {
      added: 'diff-added',
      removed: 'diff-removed',
      changed: 'diff-changed',
      unchanged: 'diff-unchanged'
    };

    const renderColumnDiff = (col: ColumnDiff): string => {
      if (col.status === 'unchanged') return '';
      const icon = statusIcon[col.status];
      let detail = '';
      if (col.status === 'changed' && col.before && col.after) {
        const changes: string[] = [];
        if (col.before.data_type !== col.after.data_type) {
          changes.push(`type: <span class="before">${col.before.data_type}</span> → <span class="after">${col.after.data_type}</span>`);
        }
        if (col.before.not_null !== col.after.not_null) {
          changes.push(`not_null: <span class="before">${col.before.not_null}</span> → <span class="after">${col.after.not_null}</span>`);
        }
        if ((col.before.default_value || '') !== (col.after.default_value || '')) {
          changes.push(`default: <span class="before">${col.before.default_value || 'NULL'}</span> → <span class="after">${col.after.default_value || 'NULL'}</span>`);
        }
        detail = changes.join(', ');
      } else if (col.status === 'added' && col.after) {
        detail = `${col.after.data_type}${col.after.not_null ? ' NOT NULL' : ''}`;
      } else if (col.status === 'removed' && col.before) {
        detail = `${col.before.data_type}`;
      }
      return `<div class="diff-item ${statusClass[col.status]}">${icon} <strong>${col.name}</strong> <span class="diff-detail">${detail}</span></div>`;
    };

    const renderTableDiff = (table: TableDiff): string => {
      const changedCols = table.columnDiffs.filter(c => c.status !== 'unchanged');
      const changedCons = table.constraintDiffs.filter(c => c.status !== 'unchanged');
      const changedIdxs = table.indexDiffs.filter(c => c.status !== 'unchanged');

      const colsHtml = changedCols.map(renderColumnDiff).join('');
      const consHtml = changedCons.map(c => {
        const icon = statusIcon[c.status];
        const def = c.after?.definition || c.before?.definition || '';
        return `<div class="diff-item ${statusClass[c.status]}">${icon} <strong>${c.name}</strong> <span class="diff-detail">${def}</span></div>`;
      }).join('');
      const idxsHtml = changedIdxs.map(i => {
        const icon = statusIcon[i.status];
        return `<div class="diff-item ${statusClass[i.status]}">${icon} <strong>${i.name}</strong></div>`;
      }).join('');

      const hasDetails = colsHtml || consHtml || idxsHtml;

      return `
        <div class="table-card ${statusClass[table.status]}">
          <div class="table-header" onclick="toggleTable('${table.name}')">
            <span class="status-icon">${statusIcon[table.status]}</span>
            <span class="table-name">${table.name}</span>
            <span class="status-badge ${statusClass[table.status]}">${statusLabel[table.status]}</span>
            ${hasDetails ? '<span class="expand-icon" id="icon-' + table.name + '">▶</span>' : ''}
          </div>
          ${hasDetails ? `
          <div class="table-details" id="details-${table.name}" style="display:none;">
            ${colsHtml ? `<div class="diff-section"><div class="diff-section-title">Columns</div>${colsHtml}</div>` : ''}
            ${consHtml ? `<div class="diff-section"><div class="diff-section-title">Constraints</div>${consHtml}</div>` : ''}
            ${idxsHtml ? `<div class="diff-section"><div class="diff-section-title">Indexes</div>${idxsHtml}</div>` : ''}
          </div>
          ` : ''}
        </div>
      `;
    };

    const tablesHtml = diffs.map(renderTableDiff).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Schema Diff</title>
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
      padding: 14px 20px;
    }
    .header h1 { font-size: 15px; font-weight: 600; margin: 0 0 4px 0; }
    .header p { font-size: 12px; color: var(--vscode-descriptionForeground); margin: 0; }
    .stats-bar {
      display: flex;
      gap: 16px;
      padding: 10px 20px;
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--vscode-panel-border);
      align-items: center;
    }
    .stat {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 12px;
    }
    .stat-count {
      font-weight: 700;
      font-size: 14px;
    }
    .actions {
      margin-left: auto;
      display: flex;
      gap: 8px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 6px 14px;
      border: none;
      border-radius: 3px;
      font-size: 12px;
      font-family: inherit;
      cursor: pointer;
    }
    .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .filter-bar {
      padding: 8px 20px;
      border-bottom: 1px solid var(--vscode-panel-border);
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .filter-btn {
      padding: 3px 10px;
      border-radius: 12px;
      border: 1px solid var(--vscode-panel-border);
      background: transparent;
      color: var(--vscode-editor-foreground);
      font-size: 11px;
      cursor: pointer;
    }
    .filter-btn.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }
    .content { padding: 16px 20px; overflow-y: auto; height: calc(100vh - 140px); }
    .table-card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 5px;
      margin-bottom: 8px;
      overflow: hidden;
    }
    .table-card.diff-changed { border-left: 3px solid #f39c12; }
    .table-card.diff-added { border-left: 3px solid #2ecc71; }
    .table-card.diff-removed { border-left: 3px solid #e74c3c; }
    .table-card.diff-unchanged { border-left: 3px solid var(--vscode-panel-border); opacity: 0.7; }
    .table-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      cursor: pointer;
      background: var(--vscode-sideBar-background);
    }
    .table-header:hover { background: var(--vscode-list-hoverBackground); }
    .table-name { font-weight: 600; flex: 1; }
    .status-badge {
      font-size: 10px;
      padding: 2px 7px;
      border-radius: 10px;
      font-weight: 600;
    }
    .diff-added .status-badge { background: rgba(46,204,113,0.2); color: #2ecc71; }
    .diff-removed .status-badge { background: rgba(231,76,60,0.2); color: #e74c3c; }
    .diff-changed .status-badge { background: rgba(243,156,18,0.2); color: #f39c12; }
    .diff-unchanged .status-badge { background: rgba(128,128,128,0.15); color: var(--vscode-descriptionForeground); }
    .expand-icon { font-size: 10px; color: var(--vscode-descriptionForeground); transition: transform 0.2s; }
    .expand-icon.open { transform: rotate(90deg); }
    .table-details { padding: 10px 14px; border-top: 1px solid var(--vscode-panel-border); }
    .diff-section { margin-bottom: 10px; }
    .diff-section-title {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 4px;
    }
    .diff-item {
      font-size: 12px;
      padding: 3px 8px;
      border-radius: 3px;
      margin-bottom: 2px;
    }
    .diff-item.diff-added { background: rgba(46,204,113,0.1); }
    .diff-item.diff-removed { background: rgba(231,76,60,0.1); }
    .diff-item.diff-changed { background: rgba(243,156,18,0.1); }
    .diff-detail { font-size: 11px; color: var(--vscode-descriptionForeground); margin-left: 6px; }
    .before { color: #e74c3c; }
    .after { color: #2ecc71; }
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: var(--vscode-descriptionForeground);
    }
    .empty-state .icon { font-size: 48px; margin-bottom: 12px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🔍 Schema Diff</h1>
    <p><strong>${sourceSchema}</strong> (source) vs <strong>${targetSchema}</strong> (target) — ${totalTables} tables compared</p>
  </div>

  <div class="stats-bar">
    <div class="stat"><span>🟡</span><span class="stat-count">${changed}</span><span>Changed</span></div>
    <div class="stat"><span>🟢</span><span class="stat-count">${added}</span><span>Added</span></div>
    <div class="stat"><span>🔴</span><span class="stat-count">${removed}</span><span>Removed</span></div>
    <div class="stat"><span>⚪</span><span class="stat-count">${unchanged}</span><span>Unchanged</span></div>
    <div class="actions">
      <button class="btn btn-primary" onclick="generateMigration()">📄 Generate Migration Script</button>
    </div>
  </div>

  <div class="filter-bar">
    <span style="font-size:11px;color:var(--vscode-descriptionForeground);">Show:</span>
    <button class="filter-btn active" id="filter-all" onclick="setFilter('all')">All (${totalTables})</button>
    <button class="filter-btn" id="filter-changed" onclick="setFilter('changed')">Changed (${changed})</button>
    <button class="filter-btn" id="filter-added" onclick="setFilter('added')">Added (${added})</button>
    <button class="filter-btn" id="filter-removed" onclick="setFilter('removed')">Removed (${removed})</button>
  </div>

  <div class="content" id="content">
    ${diffs.length === 0
        ? '<div class="empty-state"><div class="icon">✅</div><p>Schemas are identical — no differences found.</p></div>'
        : tablesHtml
      }
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let currentFilter = 'all';

    function toggleTable(name) {
      const details = document.getElementById('details-' + name);
      const icon = document.getElementById('icon-' + name);
      if (!details) return;
      const isOpen = details.style.display !== 'none';
      details.style.display = isOpen ? 'none' : 'block';
      if (icon) icon.classList.toggle('open', !isOpen);
    }

    function setFilter(filter) {
      currentFilter = filter;
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('filter-' + filter)?.classList.add('active');

      document.querySelectorAll('.table-card').forEach(card => {
        if (filter === 'all') {
          card.style.display = '';
        } else {
          card.style.display = card.classList.contains('diff-' + filter) ? '' : 'none';
        }
      });
    }

    function generateMigration() {
      vscode.postMessage({ type: 'generateMigration' });
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
