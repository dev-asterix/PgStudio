import * as vscode from 'vscode';
import * as fs from 'fs';
import { DatabaseTreeItem } from '../../providers/DatabaseTreeProvider';
import { CommandBase } from '../../common/commands/CommandBase';
import { ConnectionManager } from '../../services/ConnectionManager';
import Cursor from 'pg-cursor';

export async function cmdExportTable(item: DatabaseTreeItem, context: vscode.ExtensionContext) {
  if (!item.schema || !item.label) return;

  const tableFull = `${item.schema}.${item.label}`;

  // 1. Select Format
  const format = await vscode.window.showQuickPick(['CSV', 'JSON', 'SQL INSERT'], {
    placeHolder: 'Select Export Format'
  });
  if (!format) return;

  // 2. Select Delimiter (if CSV)
  let delimiter = ',';
  if (format === 'CSV') {
    const delimOptions = [
      { label: 'Comma (,)', value: ',' },
      { label: 'Semicolon (;)', value: ';' },
      { label: 'Tab (\\t)', value: '\t' },
      { label: 'Pipe (|)', value: '|' }
    ];
    const pickedDelim = await vscode.window.showQuickPick(delimOptions, { placeHolder: 'Select Delimiter' });
    if (!pickedDelim) return;
    delimiter = pickedDelim.value;
  }

  // 3. Select Encoding
  const encodingOptions = [
    { label: 'UTF-8', value: 'utf8' },
    { label: 'UTF-16 LE', value: 'utf16le' },
    { label: 'ASCII', value: 'ascii' }
  ];
  const pickedEncoding = await vscode.window.showQuickPick(encodingOptions, { placeHolder: 'Select Encoding' });
  if (!pickedEncoding) return;
  const encoding = pickedEncoding.value as BufferEncoding;

  // 4. Save Dialog
  const filters: { [key: string]: string[] } = {};
  if (format === 'CSV') filters['CSV'] = ['csv'];
  else if (format === 'JSON') filters['JSON'] = ['json'];
  else filters['SQL'] = ['sql'];

  const uri = await vscode.window.showSaveDialog({
    filters,
    saveLabel: 'Export',
    title: `Export ${tableFull}`
  });
  if (!uri) return;

  await CommandBase.run(context, item, 'export table', async (conn, client, metadata) => {
    // We use a dedicated client for streaming to avoid blocking the main pool/session
    // Actually CommandBase gives us a client. If it's from pool, we should be careful.
    // But CommandBase uses `run` which likely gets a pooled client (ephemeral).
    // Streaming might take time.
    // Ideally we should use a progress indicator.

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Exporting ${tableFull}...`,
      cancellable: true
    }, async (progress, token) => {

      const cursor = client.query(new Cursor(`SELECT * FROM "${item.schema}"."${item.label}"`));

      // Open file stream
      // vscode.workspace.fs does not support streaming write easily (it has writeFile which takes Buffer).
      // For large files, we should use fs.createWriteStream if local, but we might be in web.
      // However, the extension runs in Node host for local files.
      // If we are in standard VS Code desktop, `fs` works.
      // If `uri.scheme` is 'file', use `fs`.

      if (uri.scheme !== 'file') {
        throw new Error('Streaming export currently supports local file system only.');
      }

      const writeStream = fs.createWriteStream(uri.fsPath, { encoding });

      try {
        // Write Header
        if (format === 'CSV') {
          // We need column names. Fetch 1 row or use metadata?
          // We can't fetch 1 row from cursor without consuming it?
          // Wait, pg-cursor read(batchSize) returns rows.
          // We can get columns from the first batch result fields (if available) or just row keys.
        } else if (format === 'JSON') {
          writeStream.write('[');
        }

        let isFirstBatch = true;
        let rowCount = 0;
        const BATCH_SIZE = 1000;
        let cancelled = false;

        token.onCancellationRequested(() => {
          cancelled = true;
          cursor.close(() => { });
        });

        // Loop
        while (true) {
          if (cancelled) break;

          const rows = await new Promise<any[]>((resolve, reject) => {
            cursor.read(BATCH_SIZE, (err: Error, rows: any[]) => {
              if (err) reject(err);
              else resolve(rows);
            });
          });

          if (rows.length === 0) break;

          if (isFirstBatch) {
            if (format === 'CSV') {
              const columns = Object.keys(rows[0]);
              writeStream.write(columns.map(c => `"${c}"`).join(delimiter) + '\n');
            }
            isFirstBatch = false;
          }

          let chunk = '';
          if (format === 'CSV') {
            const columns = Object.keys(rows[0]); // Assume consistent schema
            chunk = rows.map(row => {
              return columns.map(col => {
                const val = row[col];
                if (val === null || val === undefined) return '';
                const str = String(val);
                if (str.includes(delimiter) || str.includes('"') || str.includes('\n')) {
                  return `"${str.replace(/"/g, '""')}"`;
                }
                return str;
              }).join(delimiter);
            }).join('\n') + '\n';
          } else if (format === 'JSON') {
            // Need comma between batches
            const jsonStr = JSON.stringify(rows); // [obj, obj]
            // We want ... obj, obj ...
            // JSON.stringify(rows) returns "[obj,obj]"
            // Remove brackets
            let inner = jsonStr.substring(1, jsonStr.length - 1);
            if (rowCount > 0 && inner.length > 0) chunk = ',' + inner;
            else chunk = inner;
          } else if (format === 'SQL INSERT') {
            const columns = Object.keys(rows[0]);
            const colsStr = columns.map(c => `"${c}"`).join(', ');
            chunk = rows.map(row => {
              const vals = columns.map(c => {
                const v = row[c];
                if (v === null) return 'NULL';
                if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
                return v;
              }).join(', ');
              return `INSERT INTO ${tableFull} (${colsStr}) VALUES (${vals});`;
            }).join('\n') + '\n';
          }

          if (!writeStream.write(chunk)) {
            await new Promise(fulfill => writeStream.once('drain', fulfill));
          }

          rowCount += rows.length;
          progress.report({ message: `${rowCount} rows exported...` });
        }

        if (format === 'JSON') {
          writeStream.write(']');
        }

      } finally {
        writeStream.end();
        cursor.close(() => { });
      }
    });

    vscode.window.showInformationMessage(`Export complete for ${tableFull}`);
  });
}
