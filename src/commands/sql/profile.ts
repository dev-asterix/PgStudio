/**
 * SQL queries for table profiling and statistics
 */

/**
 * Get table size and row count statistics
 */
export function tableStats(schema: string, table: string): string {
  return `
SELECT 
  schemaname,
  relname AS table_name,
  n_live_tup AS approximate_row_count,
  pg_size_pretty(pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(relname))) AS total_size,
  pg_size_pretty(pg_relation_size(quote_ident(schemaname) || '.' || quote_ident(relname))) AS table_size,
  pg_size_pretty(pg_indexes_size(quote_ident(schemaname) || '.' || quote_ident(relname))) AS indexes_size,
  pg_size_pretty(pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(relname)) - 
                 pg_relation_size(quote_ident(schemaname) || '.' || quote_ident(relname)) - 
                 pg_indexes_size(quote_ident(schemaname) || '.' || quote_ident(relname))) AS toast_size
FROM pg_stat_user_tables
WHERE schemaname = '${schema}' AND relname = '${table}';
`.trim();
}

/**
 * Get column statistics from pg_stats
 */
export function columnStats(schema: string, table: string): string {
  return `
SELECT 
  attname AS column_name,
  null_frac AS null_fraction,
  n_distinct AS distinct_values,
  avg_width AS avg_bytes,
  correlation,
  most_common_vals::text AS most_common_values,
  most_common_freqs::text AS frequencies
FROM pg_stats
WHERE schemaname = '${schema}' AND tablename = '${table}'
ORDER BY attname;
`.trim();
}

/**
 * Get detailed column information with types and constraints
 */
export function columnDetails(schema: string, table: string): string {
  return `
SELECT 
  a.attname AS column_name,
  pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
  a.attnotnull AS not_null,
  COALESCE(pg_get_expr(ad.adbin, ad.adrelid), '') AS default_value,
  CASE 
    WHEN a.attnum = ANY(pk.conkey) THEN 'PK'
    WHEN a.attnum = ANY(uk.conkey) THEN 'UNIQUE'
    ELSE ''
  END AS key_type
FROM pg_catalog.pg_attribute a
LEFT JOIN pg_catalog.pg_attrdef ad ON (a.attrelid = ad.adrelid AND a.attnum = ad.adnum)
LEFT JOIN pg_catalog.pg_constraint pk ON (pk.conrelid = a.attrelid AND pk.contype = 'p')
LEFT JOIN pg_catalog.pg_constraint uk ON (uk.conrelid = a.attrelid AND uk.contype = 'u' AND a.attnum = ANY(uk.conkey))
WHERE a.attrelid = '${schema}.${table}'::regclass
  AND a.attnum > 0 
  AND NOT a.attisdropped
ORDER BY a.attnum;
`.trim();
}

/**
 * Get table activity statistics
 */
export function tableActivity(schema: string, table: string): string {
  return `
SELECT 
  seq_scan AS sequential_scans,
  seq_tup_read AS rows_seq_read,
  idx_scan AS index_scans,
  idx_tup_fetch AS rows_idx_fetched,
  n_tup_ins AS rows_inserted,
  n_tup_upd AS rows_updated,
  n_tup_del AS rows_deleted,
  n_tup_hot_upd AS hot_updates,
  n_live_tup AS live_rows,
  n_dead_tup AS dead_rows,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze,
  vacuum_count,
  autovacuum_count,
  analyze_count,
  autoanalyze_count
FROM pg_stat_user_tables
WHERE schemaname = '${schema}' AND relname = '${table}';
`.trim();
}

/**
 * Get index usage statistics for a table
 */
export function indexUsage(schema: string, table: string): string {
  return `
SELECT 
  s.indexrelname AS index_name,
  pg_size_pretty(pg_relation_size(s.indexrelid)) AS index_size,
  s.idx_scan AS number_of_scans,
  s.idx_tup_read AS tuples_read,
  s.idx_tup_fetch AS tuples_fetched,
  pg_get_indexdef(s.indexrelid) AS index_definition,
  CASE 
    WHEN i.indisunique THEN 'UNIQUE'
    WHEN i.indisprimary THEN 'PRIMARY KEY'
    ELSE 'INDEX'
  END AS index_type
FROM pg_stat_user_indexes s
JOIN pg_index i ON s.indexrelid = i.indexrelid
WHERE s.schemaname = '${schema}' AND s.relname = '${table}'
ORDER BY s.idx_scan DESC;
`.trim();
}

/**
 * Sample data distribution (for numeric/date columns)
 */
export function dataSample(schema: string, table: string, column: string, limit: number = 10): string {
  return `
SELECT 
  ${column},
  COUNT(*) AS frequency
FROM ${schema}.${table}
WHERE ${column} IS NOT NULL
GROUP BY ${column}
ORDER BY frequency DESC
LIMIT ${limit};
`.trim();
}
