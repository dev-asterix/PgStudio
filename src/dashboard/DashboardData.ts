

export interface DashboardStats {
  dbName: string;
  owner: string;
  size: string;
  activeConnections: number;
  idleConnections: number;
  waitingConnections: number;
  totalConnections: number;
  maxConnections: number;
  extensionCount: number;
  topTables: { name: string; size: string; rawSize: number }[];
  connectionStates: { state: string; count: number }[];
  objectCounts: {
    schemas: number;
    tables: number;
    views: number;
    functions: number;
    sequences: number;
  };
  activeQueries: {
    pid: number;
    usename: string;
    datname: string;
    state: string;
    duration: string;
    startTime: string;
    query: string;
  }[];
  blockingLocks: {
    blocked_pid: number;
    blocked_user: string;
    blocking_pid: number;
    blocking_user: string;
    blocked_query: string;
    blocking_query: string;
    lock_mode: string;
    locked_object: string;
  }[];
  metrics: {
    xact_commit: number;
    xact_rollback: number;
    blks_read: number;
    blks_hit: number;
    deadlocks: number;
    conflicts: number;
    temp_bytes: number;
    temp_files: number;
    checkpoints_timed: number;
    checkpoints_req: number;
    tuples_fetched: number;
    tuples_returned: number;
  };
  pgStatStatements?: {
    query: string;
    calls: number;
    total_time: number;
    mean_time: number;
    rows: number;
  }[];
  waitEvents: { type: string; count: number }[];
  longRunningQueries: number;
}

import { Client, PoolClient } from 'pg';

export async function fetchStats(client: Client | PoolClient, dbName: string): Promise<DashboardStats> {
  // Fetch data with error handling for each query to prevent one failure from breaking the entire dashboard
  const [dbInfoRes, connRes, tableRes, extRes, countsRes, activeQueriesRes, locksRes, metricsRes, settingsRes, pgStatRes, waitsRes, longQueriesRes] = await Promise.allSettled([
    // DB Info
    client.query(`
            SELECT pg_catalog.pg_get_userbyid(d.datdba) as owner,
                   pg_size_pretty(pg_database_size(d.datname)) as size
            FROM pg_database d
            WHERE d.datname = $1
        `, [dbName]),

    // Connection States (Active, Idle, Waiting)
    client.query(`
            SELECT state, wait_event_type IS NOT NULL as waiting, count(*) as count
            FROM pg_stat_activity
            WHERE datname = $1
            GROUP BY state, waiting
        `, [dbName]),

    // Top Tables
    client.query(`
            SELECT schemaname || '.' || tablename as name,
                   pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename)) as size,
                   pg_total_relation_size(schemaname || '.' || tablename) as raw_size
            FROM pg_tables
            WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
            ORDER BY raw_size DESC
            LIMIT 10
        `),

    // Extension Count
    client.query(`SELECT count(*) as count FROM pg_available_extensions WHERE installed_version IS NOT NULL`),

    // Object Counts
    client.query(`
            SELECT
                (SELECT count(*) FROM pg_namespace WHERE nspname NOT IN ('pg_catalog', 'information_schema')) as schemas,
                (SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')) as tables,
                (SELECT count(*) FROM pg_views WHERE schemaname NOT IN ('pg_catalog', 'information_schema')) as views,
                (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')) as functions,
                (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid WHERE c.relkind = 'S' AND n.nspname NOT IN ('pg_catalog', 'information_schema')) as sequences
        `),

    // Active Queries (including idle)
    client.query(`
            SELECT pid, usename, datname, state, 
                   (now() - query_start)::text as duration,
                   query_start,
                   query
            FROM pg_stat_activity
            WHERE pid != pg_backend_pid()
            AND datname = $1
            ORDER BY state = 'active' DESC, query_start ASC
            LIMIT 100
        `, [dbName]),

    // Blocking Locks
    client.query(`
            SELECT
                blocked_locks.pid     AS blocked_pid,
                blocked_activity.usename  AS blocked_user,
                blocking_locks.pid     AS blocking_pid,
                blocking_activity.usename AS blocking_user,
                blocked_activity.query    AS blocked_query,
                blocking_activity.query   AS blocking_query,
                blocked_locks.mode        AS lock_mode,
                COALESCE(c.relname, 'null') AS locked_object
            FROM  pg_catalog.pg_locks         blocked_locks
            JOIN pg_catalog.pg_stat_activity blocked_activity  ON blocked_activity.pid = blocked_locks.pid
            JOIN pg_catalog.pg_locks         blocking_locks 
                ON blocking_locks.locktype = blocked_locks.locktype
                AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
                AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
                AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
                AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
                AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
                AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
                AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
                AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
                AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
                AND blocking_locks.pid != blocked_locks.pid
            JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
            LEFT JOIN pg_catalog.pg_class c ON c.oid = blocked_locks.relation
            WHERE NOT blocked_locks.granted
            AND blocking_activity.datname = $1
        `, [dbName]),

    // Database Metrics (Throughput & I/O & Conflicts/Deadlocks)
    // Select all columns to be robust against version differences (e.g. checkpoints_timed removed in PG 17)
    client.query(`
            SELECT *
            FROM pg_stat_database 
            WHERE datname = $1
        `, [dbName]),

    // Settings (Max Connections)
    client.query(`SHOW max_connections`),

    // pg_stat_statements (Top Queries) - Safe selection that returns empty if extension missing
    // We use a check to avoid error log spam if possible, or just let it fail gracefully via allSettled
    client.query(`
            SELECT query, calls, total_time, mean_time, rows
            FROM pg_stat_statements
            WHERE dbid = (SELECT oid FROM pg_database WHERE datname = $1)
            ORDER BY total_time DESC
            LIMIT 10
    `, [dbName]),

    // Wait Events Information
    client.query(`
            SELECT wait_event_type, count(*) as count
            FROM pg_stat_activity
            WHERE wait_event_type IS NOT NULL
            AND datname = $1
            GROUP BY wait_event_type
            ORDER BY count DESC
            LIMIT 3
    `, [dbName]),

    // Long Running Queries Count (> 5 seconds)
    client.query(`
            SELECT count(*) as count
            FROM pg_stat_activity
            WHERE state = 'active'
            AND (now() - query_start) > interval '5 seconds'
            AND datname = $1
    `, [dbName])
  ]);

  // Helper to safely extract result or return empty default
  const getResult = (result: PromiseSettledResult<any>, defaultValue: any = { rows: [] }) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      console.error('Dashboard query failed:', result.reason?.message || result.reason);
      return defaultValue;
    }
  };

  const dbInfo = getResult(dbInfoRes).rows[0] || {};
  const connections = getResult(connRes).rows;
  const counts = getResult(countsRes).rows[0] || { schemas: 0, tables: 0, views: 0, functions: 0, sequences: 0 };
  const tableRows = getResult(tableRes).rows;
  const extCount = getResult(extRes).rows[0]?.count || 0;
  const activeQueriesRows = getResult(activeQueriesRes).rows;
  const locksRows = getResult(locksRes).rows;
  const metricsRow = getResult(metricsRes).rows[0] || {
    xact_commit: 0, xact_rollback: 0, blks_read: 0, blks_hit: 0, deadlocks: 0, conflicts: 0,
    temp_bytes: 0, temp_files: 0, checkpoints_timed: 0, checkpoints_req: 0,
    tup_fetched: 0, tup_returned: 0
  };
  const maxConnRow = getResult(settingsRes).rows[0] || { max_connections: '100' };
  const pgStatRows = getResult(pgStatRes).rows || [];
  const waitEventsRows = getResult(waitsRes).rows;
  const longQueriesRow = getResult(longQueriesRes).rows[0] || { count: 0 };

  let active = 0;
  let idle = 0;
  let waiting = 0;
  let total = 0;
  const connectionStates: { state: string; count: number }[] = [];

  connections.forEach((row: any) => {
    const count = parseInt(row.count);
    total += count;
    if (row.state === 'active') active += count;
    if (row.state === 'idle') idle += count;
    if (row.waiting) waiting += count;
    connectionStates.push({ state: row.state || 'unknown', count });
  });

  return {
    dbName: dbName,
    owner: dbInfo?.owner || 'Unknown',
    size: dbInfo?.size || 'Unknown',
    activeConnections: active,
    idleConnections: idle,
    waitingConnections: waiting,
    totalConnections: total,
    maxConnections: parseInt(maxConnRow.max_connections),
    extensionCount: parseInt(extCount),
    topTables: tableRows.map((r: any) => ({
      name: r.name,
      size: r.size,
      rawSize: parseInt(r.raw_size)
    })),
    connectionStates,
    objectCounts: {
      schemas: parseInt(counts.schemas || '0'),
      tables: parseInt(counts.tables || '0'),
      views: parseInt(counts.views || '0'),
      functions: parseInt(counts.functions || '0'),
      sequences: parseInt(counts.sequences || '0')
    },
    activeQueries: activeQueriesRows.map((r: any) => {
      // Format duration to be more readable (e.g., remove milliseconds if too long, or keep as is from PG)
      // PG 'interval' cast to text usually looks like "00:00:05.123456" or "1 day 00:00:05"
      let duration = r.duration || '';
      // Optional: Truncate milliseconds for cleaner look if it's just a time string
      if (duration.includes('.')) {
        duration = duration.split('.')[0];
      }

      return {
        pid: r.pid,
        usename: r.usename,
        datname: r.datname,
        state: r.state,
        duration: duration,
        startTime: r.query_start ? new Date(r.query_start).toLocaleString() : '-',
        query: r.query
      };
    }),
    blockingLocks: locksRows,
    metrics: {
      xact_commit: parseInt(metricsRow.xact_commit || '0'),
      xact_rollback: parseInt(metricsRow.xact_rollback || '0'),
      blks_read: parseInt(metricsRow.blks_read || '0'),
      blks_hit: parseInt(metricsRow.blks_hit || '0'),
      deadlocks: parseInt(metricsRow.deadlocks || '0'),
      conflicts: parseInt(metricsRow.conflicts || '0'),
      temp_bytes: parseInt(metricsRow.temp_bytes || '0'),
      temp_files: parseInt(metricsRow.temp_files || '0'),
      checkpoints_timed: parseInt(metricsRow.checkpoints_timed || '0'),
      checkpoints_req: parseInt(metricsRow.checkpoints_req || '0'),
      tuples_fetched: parseInt(metricsRow.tup_fetched || '0'),
      tuples_returned: parseInt(metricsRow.tup_returned || '0')
    },
    pgStatStatements: pgStatRows.map((r: any) => ({
      query: r.query,
      calls: parseInt(r.calls || '0'),
      total_time: parseFloat(r.total_time || '0'),
      mean_time: parseFloat(r.mean_time || '0'),
      rows: parseInt(r.rows || '0')
    })),
    waitEvents: waitEventsRows.map((r: any) => ({
      type: r.wait_event_type,
      count: parseInt(r.count)
    })),
    longRunningQueries: parseInt(longQueriesRow.count)
  };
}

