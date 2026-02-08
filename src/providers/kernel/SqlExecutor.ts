
import * as vscode from 'vscode';
import { ConnectionManager } from '../../services/ConnectionManager';
import { TelemetryService, SpanNames } from '../../services/TelemetryService';
import { PostgresMetadata, QueryResults } from '../../common/types';
import { SqlParser } from './SqlParser';
import { SecretStorageService } from '../../services/SecretStorageService';
import { ErrorService } from '../../services/ErrorService';
import { QueryHistoryService } from '../../services/QueryHistoryService';
import { getTransactionManager } from '../../services/TransactionManager';
import { QueryAnalyzer } from '../../services/QueryAnalyzer';

export class SqlExecutor {
  constructor(private readonly _controller: vscode.NotebookController) { }

  public async executeCell(cell: vscode.NotebookCell) {
    console.log(`SqlExecutor: Starting cell execution. Controller ID: ${this._controller.id}`);
    const execution = this._controller.createNotebookCellExecution(cell);
    const startTime = Date.now();
    execution.start(startTime);
    await execution.clearOutput();

    try {
      const metadata = cell.notebook.metadata as PostgresMetadata;
      if (!metadata || !metadata.connectionId) {
        throw new Error('No connection metadata found');
      }

      // Get connection info
      const connections = vscode.workspace.getConfiguration().get<any[]>('postgresExplorer.connections') || [];
      const connection = connections.find(c => c.id === metadata.connectionId);
      if (!connection) {
        throw new Error('Connection not found');
      }

      const client = await ConnectionManager.getInstance().getSessionClient({
        id: connection.id,
        host: connection.host,
        port: connection.port,
        username: connection.username,
        database: metadata.databaseName || connection.database,
        name: connection.name
      }, cell.notebook.uri.toString());

      console.log('SqlExecutor: Connected to database');

      // Get PostgreSQL backend PID for query cancellation
      let backendPid: number | null = null;
      try {
        const pidResult = await client.query('SELECT pg_backend_pid()');
        backendPid = pidResult.rows[0]?.pg_backend_pid || null;
        console.log('SqlExecutor: Backend PID:', backendPid);
      } catch (err) {
        console.warn('Failed to get backend PID:', err);
      }

      // Capture PostgreSQL NOTICE messages
      const notices: string[] = [];
      const noticeListener = (msg: any) => {
        const message = msg.message || msg.toString();
        notices.push(message);
      };
      client.on('notice', noticeListener);

      const queryText = cell.document.getText();
      const statements = SqlParser.splitSqlStatements(queryText);

      console.log('SqlExecutor: Executing', statements.length, 'statement(s)');

      // Safety check: Analyze queries for dangerous operations
      const queryAnalyzer = QueryAnalyzer.getInstance();
      for (const stmt of statements) {
        // Check read-only mode
        if (connection.readOnlyMode && !queryAnalyzer.isReadOnlyQuery(stmt)) {
          throw new Error('Write operations are not allowed in read-only mode');
        }

        // Analyze for dangerous operations
        const analysis = queryAnalyzer.analyzeQuery(stmt, connection);
        if (analysis.requiresConfirmation && analysis.warningMessage) {
          const action = await vscode.window.showWarningMessage(
            analysis.warningMessage,
            { modal: true },
            'Execute',
            'Execute in Transaction'
          );

          if (!action) {
            throw new Error('Query execution cancelled by user');
          } else if (action === 'Execute in Transaction') {
            // Wrap in transaction if not already in one
            const txManager = getTransactionManager();
            const sessionId = cell.notebook.uri.toString();
            const txInfo = txManager.getTransactionInfo(sessionId);
            
            if (!txInfo || !txInfo.isActive) {
              await client.query('BEGIN');
              if (!txInfo) {
                txManager.initializeSession(sessionId, true);
              }
              notices.push('Transaction started automatically for safety. Run COMMIT or ROLLBACK when done.');
            }
          }
        }
      }

      // Execute each statement
      for (let stmtIndex = 0; stmtIndex < statements.length; stmtIndex++) {
        const query = statements[stmtIndex];
        const stmtStartTime = Date.now();

        console.log(`SqlExecutor: Executing statement ${stmtIndex + 1}/${statements.length}:`, query.substring(0, 100));

        let result;
        try {
          const telemetry = TelemetryService.getInstance();
          const spanId = telemetry.startSpan(SpanNames.QUERY_EXECUTE, {
            statementIndex: stmtIndex + 1,
            statementCount: statements.length
          });

          result = await client.query(query);
          const stmtEndTime = Date.now();
          const executionTime = (stmtEndTime - stmtStartTime) / 1000;

          const success = true;
          const slowThresholdMs = vscode.workspace.getConfiguration().get<number>('postgresExplorer.performance.slowQueryThresholdMs', 2000);
          const durationMs = executionTime * 1000;
          const isSlow = durationMs >= slowThresholdMs;

          // Extract EXPLAIN (FORMAT JSON) plan if available
          let explainPlan: any | undefined;
          if (result.command === 'EXPLAIN' && result.rows?.length) {
            const planCell = result.rows[0]['QUERY PLAN'] ?? result.rows[0]['query_plan'];
            if (planCell) {
              try {
                explainPlan = typeof planCell === 'string' ? JSON.parse(planCell) : planCell;
              } catch {
                explainPlan = planCell;
              }
            }
          }

          // Build output data
          const tableInfo = await this.getTableInfo(client, result, query);
          const outputData: QueryResults = {
            success,
            rowCount: result.rowCount,
            rows: result.rows,
            columns: result.fields?.map((f: any) => f.name) || [],
            columnTypes: result.fields?.reduce((acc: any, f: any) => {
              // Approximate type mapping or use OID if available
              acc[f.name] = this.getTypeName(f.dataTypeID);
              return acc;
            }, {}),
            command: result.command,
            query: query,
            notices: [...notices], // Copy current notices
            executionTime,
            backendPid,
            tableInfo,
            explainPlan,
            slowQuery: isSlow,
            breadcrumb: {
              connectionId: connection.id,
              connectionName: connection.name || connection.host,
              database: metadata.databaseName || connection.database,
              schema: tableInfo?.schema,
              object: tableInfo?.table ? { name: tableInfo.table, type: 'table' } : undefined
            }
          };

          telemetry.endSpan(spanId, { success: 'true', rowCount: result.rowCount ?? 0 });

          // Clear notices for next statement
          notices.length = 0;

          await execution.appendOutput(new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.json(outputData, 'application/vnd.postgres-notebook.result')
          ]));

          // Log to history
          QueryHistoryService.getInstance().add({
            query: query,
            success: true,
            duration: executionTime,
            durationMs,
            slow: isSlow,
            rowCount: result.rowCount || 0,
            connectionName: connection.name
          });

        } catch (err: any) {
          const stmtEndTime = Date.now();
          const executionTime = (stmtEndTime - stmtStartTime) / 1000;

          console.error('SqlExecutor: Query error:', err);

          // Handle transaction auto-rollback on error
          const sessionId = cell.notebook.uri.toString();
          const txManager = getTransactionManager();
          try {
            await txManager.handleCellError(client, sessionId, err);
          } catch (txErr) {
            console.error('SqlExecutor: Transaction error handling failed:', txErr);
          }

          const slowThresholdMs = vscode.workspace.getConfiguration().get<number>('postgresExplorer.performance.slowQueryThresholdMs', 2000);
          const durationMs = executionTime * 1000;
          const isSlow = durationMs >= slowThresholdMs;

          const errorData = {
            success: false,
            error: err.message,
            query: query,
            executionTime,
            slowQuery: isSlow,
            canExplain: true
          };

          await execution.appendOutput(new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.json(errorData, 'application/vnd.postgres-notebook.error')
          ]));

          // Log to history
          QueryHistoryService.getInstance().add({
            query: query,
            success: false,
            duration: executionTime,
            durationMs,
            slow: isSlow,
            connectionName: connection.name
          });

          // Stop execution on error
          break;
        }
      }

      client.removeListener('notice', noticeListener);
      execution.end(true, Date.now());

    } catch (err: any) {
      console.error('SqlExecutor: Execution failed:', err);
      await execution.replaceOutput(new vscode.NotebookCellOutput([
        vscode.NotebookCellOutputItem.error(err)
      ]));
      execution.end(false, Date.now());
    }
  }

  // --- Helpers ---

  private getTypeName(oid: number): string {
    // Basic mapping, in a real app this would use a proper TypeRegistry
    const types: Record<number, string> = {
      16: 'bool',
      17: 'bytea',
      20: 'int8',
      21: 'int2',
      23: 'int4',
      25: 'text',
      114: 'json',
      1043: 'varchar',
      1082: 'date',
      1114: 'timestamp',
      1184: 'timestamptz',
      1700: 'numeric'
    };
    return types[oid] || 'string'; // Default to string
  }

  private async getTableInfo(client: any, result: any, query: string): Promise<any> {
    // Attempt to deduce table from query for basic primary key support
    // This is a heuristic. For better support, we'd parse the query structure.
    const fromMatch = query.match(/FROM\s+["']?([a-zA-Z0-9_.]+)["']?/i);
    if (!fromMatch) return undefined;

    const tableNameFull = fromMatch[1];
    const parts = tableNameFull.split('.');
    const table = parts.length > 1 ? parts[1] : parts[0];
    const schema = parts.length > 1 ? parts[0] : 'public';

    // Fetch PKs
    try {
      const pkResult = await client.query(`
        SELECT a.attname
        FROM   pg_index i
        JOIN   pg_attribute a ON a.attrelid = i.indrelid
                             AND a.attnum = ANY(i.indkey)
        WHERE  i.indrelid = '${schema}.${table}'::regclass
        AND    i.indisprimary
      `);
      return {
        schema,
        table,
        primaryKeys: pkResult.rows.map((r: any) => r.attname)
      };
    } catch (e) {
      // Ignore errors if we can't get PKs (e.g. view or complex query)
      return undefined;
    }
  }

  // --- Message Handlers for Execution (Cancel, Updates) ---

  public async cancelQuery(message: any) {
    const { backendPid, connectionId, databaseName } = message;
    try {
      const connections = vscode.workspace.getConfiguration().get<any[]>('postgresExplorer.connections') || [];
      const connection = connections.find(c => c.id === connectionId);
      if (!connection) throw new Error('Connection not found');

      let cancelClient;
      try {
        cancelClient = await ConnectionManager.getInstance().getPooledClient({
          id: connection.id,
          host: connection.host,
          port: connection.port,
          username: connection.username,
          database: databaseName || connection.database,
          name: connection.name
        });
        await cancelClient.query('SELECT pg_cancel_backend($1)', [backendPid]);
        vscode.window.showInformationMessage(`Query cancelled (PID: ${backendPid})`);
      } finally {
        if (cancelClient) cancelClient.release();
      }
    } catch (err: any) {
      await ErrorService.getInstance().handleCommandError(err, 'cancel query');
    }
  }

  public async executeBackgroundUpdate(message: any, notebook: vscode.NotebookDocument) {
    const { statements } = message;
    try {
      const metadata = notebook.metadata as PostgresMetadata;
      if (!metadata?.connectionId) throw new Error('No connection found');

      const connections = vscode.workspace.getConfiguration().get<any[]>('postgresExplorer.connections') || [];
      const connection = connections.find(c => c.id === metadata.connectionId);
      if (!connection) throw new Error('Connection not found');

      const client = await ConnectionManager.getInstance().getSessionClient({
        id: connection.id,
        host: connection.host,
        port: connection.port,
        username: connection.username,
        database: metadata.databaseName || connection.database,
        name: connection.name
      }, notebook.uri.toString());

      await client.query(statements.join('\n'));
      vscode.window.showInformationMessage(`✅ Successfully saved ${statements.length} change(s).`);
    } catch (err: any) {
      await ErrorService.getInstance().handleCommandError(err, 'save changes');
    }
  }
}
