import * as vscode from 'vscode';
import { DatabaseTreeItem } from '../../providers/DatabaseTreeProvider';
import { getDatabaseConnection, NotebookBuilder, MarkdownUtils, ErrorHandlers } from '../helper';

/**
 * Show table definition with DDL, indexes, and constraints
 */
export async function cmdTableDefinition(item: DatabaseTreeItem, context: vscode.ExtensionContext) {
  try {
    if (!item.schema || !item.label) {
      throw new Error('Schema and table name are required');
    }

    const { connection, client, metadata, release } = await getDatabaseConnection(item);

    try {
      // Get table DDL
      const ddlQuery = `
        SELECT 
          'CREATE TABLE ' || quote_ident(n.nspname) || '.' || quote_ident(c.relname) || ' (' ||
          string_agg(
            E'\n  ' || quote_ident(a.attname) || ' ' || 
            pg_catalog.format_type(a.atttypid, a.atttypmod) ||
            CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END ||
            CASE WHEN pg_get_expr(ad.adbin, ad.adrelid) IS NOT NULL 
              THEN ' DEFAULT ' || pg_get_expr(ad.adbin, ad.adrelid) 
              ELSE '' 
            END,
            ','
            ORDER BY a.attnum
          ) || E'\n);' AS ddl
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid
        LEFT JOIN pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
        WHERE n.nspname = '${item.schema}'
          AND c.relname = '${item.label}'
          AND a.attnum > 0
          AND NOT a.attisdropped
        GROUP BY n.nspname, c.relname;
      `;
      
      const ddlResult = await client.query(ddlQuery);
      const ddl = ddlResult.rows[0]?.ddl || 'N/A';

      // Get indexes
      const indexQuery = `
        SELECT 
          indexname,
          indexdef
        FROM pg_indexes
        WHERE schemaname = '${item.schema}'
          AND tablename = '${item.label}'
        ORDER BY indexname;
      `;
      
      const indexResult = await client.query(indexQuery);
      const indexes = indexResult.rows;

      // Get constraints
      const constraintQuery = `
        SELECT 
          con.conname AS constraint_name,
          CASE con.contype
            WHEN 'p' THEN 'PRIMARY KEY'
            WHEN 'u' THEN 'UNIQUE'
            WHEN 'f' THEN 'FOREIGN KEY'
            WHEN 'c' THEN 'CHECK'
            ELSE con.contype::text
          END AS constraint_type,
          pg_get_constraintdef(con.oid) AS definition
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE nsp.nspname = '${item.schema}'
          AND rel.relname = '${item.label}'
        ORDER BY con.contype, con.conname;
      `;
      
      const constraintResult = await client.query(constraintQuery);
      const constraints = constraintResult.rows;

      // Get foreign keys referencing this table
      const referencingQuery = `
        SELECT 
          n.nspname || '.' || c.relname AS referencing_table,
          con.conname AS constraint_name,
          pg_get_constraintdef(con.oid) AS definition
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_class ref ON ref.oid = con.confrelid
        JOIN pg_namespace refn ON refn.oid = ref.relnamespace
        WHERE refn.nspname = '${item.schema}'
          AND ref.relname = '${item.label}'
          AND con.contype = 'f'
        ORDER BY n.nspname, c.relname;
      `;
      
      const referencingResult = await client.query(referencingQuery);
      const referencingTables = referencingResult.rows;

      // Build markdown
      const builder = new NotebookBuilder(metadata)
        .addMarkdown(
          MarkdownUtils.header(`📐 Table Definition: \`${item.schema}.${item.label}\``) +
          MarkdownUtils.infoBox('Complete DDL, indexes, constraints, and relationships')
        );

      // Table DDL
      builder.addMarkdown(
        MarkdownUtils.header('📝 CREATE TABLE Statement', '##') +
        'Complete table definition including column names, types, and defaults.'
      );

      builder.addMarkdown('```sql\n' + ddl + '\n```');

      // Constraints
      builder.addMarkdown(
        MarkdownUtils.header('🔒 Table Constraints', '##') +
        'Primary keys, unique constraints, foreign keys, and check constraints.'
      );

      if (constraints.length === 0) {
        builder.addMarkdown('*No constraints defined*');
      } else {
        let constraintMarkdown = '| Name | Type | Definition |\n' +
          '|------|------|------------|\n';
        constraints.forEach((con: any) => {
          constraintMarkdown += `| \`${con.constraint_name}\` | ${con.constraint_type} | \`${con.definition}\` |\n`;
        });
        builder.addMarkdown(constraintMarkdown);
      }

      // Indexes
      builder.addMarkdown(
        MarkdownUtils.header('📑 Table Indexes', '##') +
        'Index definitions for improved query performance.'
      );

      if (indexes.length === 0) {
        builder.addMarkdown('*No indexes defined*');
      } else {
        indexes.forEach((idx: any) => {
          builder.addMarkdown(
            MarkdownUtils.header(`\`${idx.indexname}\``, '###') +
            '```sql\n' + idx.indexdef + ';\n```'
          );
        });
      }

      // Referencing tables
      builder.addMarkdown(
        MarkdownUtils.header('🔗 Referenced By (Incoming Foreign Keys)', '##') +
        'Other tables that have foreign key relationships pointing to this table.'
      );

      if (referencingTables.length === 0) {
        builder.addMarkdown('*No tables reference this table*');
      } else {
        let refMarkdown = '| Table | Constraint | Definition |\n' +
          '|-------|------------|------------|\n';
        referencingTables.forEach((ref: any) => {
          refMarkdown += `| \`${ref.referencing_table}\` | \`${ref.constraint_name}\` | \`${ref.definition}\` |\n`;
        });
        builder.addMarkdown(refMarkdown);
      }

      // SQL Query Details
      builder.addMarkdown(
        MarkdownUtils.header('📊 Query: Generate CREATE TABLE DDL', '##') +
        'Reconstructs the CREATE TABLE statement from system catalog.'
      )
        .addSql(ddlQuery);

      builder.addMarkdown(
        MarkdownUtils.header('📑 Query: Table Indexes', '##') +
        'Lists all indexes defined on this table.'
      )
        .addSql(indexQuery);

      builder.addMarkdown(
        MarkdownUtils.header('🔒 Query: Constraints', '##') +
        'Shows all constraints (PK, UNIQUE, FK, CHECK) on this table.'
      )
        .addSql(constraintQuery);

      builder.addMarkdown(
        MarkdownUtils.header('🔗 Query: Incoming Foreign Keys', '##') +
        'Find all tables that have foreign key relationships to this table.'
      )
        .addSql(referencingQuery);

      await builder.show();

    } finally {
      release();
    }

  } catch (err: any) {
    await ErrorHandlers.handleCommandError(err, 'show table definition');
  }
}
