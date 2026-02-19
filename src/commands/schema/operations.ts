import { Client } from 'pg';
import * as vscode from 'vscode';
import { DatabaseTreeItem, DatabaseTreeProvider } from '../../providers/DatabaseTreeProvider';
import {
  MarkdownUtils,
  ErrorHandlers,
  getDatabaseConnection,
  NotebookBuilder,
  QueryBuilder,
  validateCategoryItem,
} from '../helper';
import { SchemaSQL } from '../sql';



/**
 * cmdCreateSchema - Command to create a new schema in the database
 * @param {DatabaseTreeItem} item - The selected database item in the tree
 * @param {vscode.ExtensionContext} context - The extension context
 */
export async function cmdCreateSchema(item: DatabaseTreeItem, context: vscode.ExtensionContext) {
  let dbConn;
  try {
    dbConn = await getDatabaseConnection(item, validateCategoryItem);
    const { metadata } = dbConn;

    const databaseName = item.label;

    const markdown = MarkdownUtils.header(`➕ Create New Schema in Database: \`${databaseName}\``) +
      MarkdownUtils.infoBox('This notebook provides templates for creating schemas. Modify the templates below and execute to create schemas.') +
      `\n\n#### 📋 Schema Design Guidelines\n\n` +
      MarkdownUtils.operationsTable([
        { operation: '<strong>Naming</strong>', description: 'Use lowercase names (e.g., app_data, analytics, reporting). Avoid reserved names like "public".' },
        { operation: '<strong>Purpose</strong>', description: 'Organize database objects logically. Use schemas to separate applications, environments, or features' },
        { operation: '<strong>Security</strong>', description: 'Control access with GRANT/REVOKE. Use schemas for multi-tenant applications' },
        { operation: '<strong>Search Path</strong>', description: 'Set search_path to include schemas in order of preference' },
        { operation: '<strong>Ownership</strong>', description: 'Assign appropriate owners. Owners can create objects and grant privileges' }
      ]) +
      `\n\n#### 🏷️ Common Schema Patterns\n\n` +
      MarkdownUtils.propertiesTable({
        'Application Schema': 'Separate schema per application (e.g., app1, app2)',
        'Feature Schema': 'Schema per feature/module (e.g., billing, inventory)',
        'Environment Schema': 'Schema per environment (e.g., dev, staging, prod)',
        'Tenant Schema': 'Schema per tenant in multi-tenant applications',
        'Archive Schema': 'Schema for historical/archived data',
        'Reporting Schema': 'Schema for reporting views and materialized views'
      }) +
      MarkdownUtils.successBox('Schemas provide logical organization and security boundaries. Use them to organize large databases and control access.') +
      `\n\n---`;

    await new NotebookBuilder(metadata)
      .addMarkdown(markdown)
      .addMarkdown('##### 📝 Basic Schema (Recommended Start)')
      .addSql(SchemaSQL.create.basic())
      .addMarkdown('##### 🔐 Schema with Permissions')
      .addSql(SchemaSQL.create.withPermissions())
      .addMarkdown('##### 🔄 Default Privileges Setup')
      .addSql(SchemaSQL.create.defaultPrivileges())
      .addMarkdown('##### 🏢 Multi-Tenant Schema Pattern')
      .addSql(SchemaSQL.create.multiTenant())
      .addMarkdown('##### 📊 Reporting Schema Pattern')
      .addSql(SchemaSQL.create.reporting())
      .addMarkdown('##### 🔍 Search Path Configuration')
      .addSql(SchemaSQL.searchPath())
      .addMarkdown(MarkdownUtils.warningBox('After creating a schema, remember to: 1) Grant appropriate permissions, 2) Set up default privileges for future objects, 3) Configure search_path if needed, 4) Document the schema purpose with comments.'))
      .show();
  } catch (err: any) {
    await ErrorHandlers.handleCommandError(err, 'create schema notebook');
  } finally {
    if (dbConn && dbConn.release) dbConn.release();
  }
}

/**
 * cmdCreateObjectInSchema - Command to create a new object (table, view, function, etc.) in the selected schema
 * @param {DatabaseTreeItem} item - The selected schema item in the tree
 * @param {vscode.ExtensionContext} context - The extension context
 */
export async function cmdCreateObjectInSchema(item: DatabaseTreeItem, context: vscode.ExtensionContext) {
  let dbConn;
  try {
    dbConn = await getDatabaseConnection(item);
    const { metadata } = dbConn;

    const items = [
      { label: 'Table', detail: 'Create a new table in this schema', query: `CREATE TABLE ${item.schema}.table_name(\n    id serial PRIMARY KEY, \n    column_name data_type, \n    created_at timestamptz DEFAULT current_timestamp\n); ` },
      { label: 'View', detail: 'Create a new view in this schema', query: `CREATE VIEW ${item.schema}.view_name AS\nSELECT column1, column2\nFROM some_table\nWHERE condition; ` },
      { label: 'Function', detail: 'Create a new function in this schema', query: `CREATE OR REPLACE FUNCTION ${item.schema}.function_name(\n    param1 data_type, \n    param2 data_type\n) RETURNS return_type AS $$\nBEGIN\n-- Function logic here\n    RETURN result; \nEND; \n$$ LANGUAGE plpgsql; ` },
      { label: 'Materialized View', detail: 'Create a new materialized view in this schema', query: `CREATE MATERIALIZED VIEW ${item.schema}.matview_name AS\nSELECT column1, column2\nFROM source_table\nWHERE condition\nWITH DATA; ` },
      { label: 'Type', detail: 'Create a new composite type in this schema', query: `CREATE TYPE ${item.schema}.type_name AS(\n    field1 data_type, \n    field2 data_type\n); ` },
      { label: 'Foreign Table', detail: 'Create a new foreign table in this schema', query: `CREATE FOREIGN TABLE ${item.schema}.foreign_table_name(\n    column1 data_type, \n    column2 data_type\n) SERVER foreign_server_name\nOPTIONS(schema_name 'remote_schema', table_name 'remote_table'); ` }
    ];

    const selection = await vscode.window.showQuickPick(items, {
      title: 'Create in Schema',
      placeHolder: 'Select what to create'
    });

    if (selection) {
      await new NotebookBuilder(metadata)
        .addMarkdown(
          MarkdownUtils.header(`➕ Create New ${selection.label} in Schema: \`${item.schema}\``) +
          MarkdownUtils.infoBox(`Modify the definition below and execute the cell to create the ${selection.label.toLowerCase()}.`)
        )
        .addMarkdown('##### 📝 Object Definition')
        .addSql(selection.query)
        .show();
    }
  } catch (err: any) {
    await ErrorHandlers.handleCommandError(err, 'create notebook');
  } finally {
    if (dbConn && dbConn.release) dbConn.release();
  }
}

/**
 * cmdAllSchemaOperations - Command to create a notebook with various schema operations
 * @param {DatabaseTreeItem} item - The selected schema item in the tree
 * @param {vscode.ExtensionContext} context - The extension context
 */
export async function cmdSchemaOperations(item: DatabaseTreeItem, context: vscode.ExtensionContext) {
  let dbConn;
  try {
    dbConn = await getDatabaseConnection(item);
    const { client, metadata } = dbConn;

    const schemaInfo = await client.query(QueryBuilder.schemaInfo(item.schema!));
    const info = schemaInfo.rows[0];

    const privileges = (info.privileges || []).filter((p: string | null) => p !== null);
    const privilegesText = privileges.length > 0 ? privileges.join(', ') : 'No specific privileges found';

    await new NotebookBuilder(metadata)
      .addMarkdown(
        MarkdownUtils.header(`🗂️ Schema Operations: \`${item.schema}\``) +
        MarkdownUtils.infoBox('This notebook contains operations for managing the schema. Execute the cells below to perform operations.') +
        `\n\n#### 📊 Schema Information\n\n` +
        MarkdownUtils.propertiesTable({
          'Owner': info.owner,
          'Total Size': info.total_size,
          'Objects': `${info.tables_count} tables, ${info.views_count} views, ${info.functions_count} functions`,
          'Privileges': privilegesText
        })
      )
      .addMarkdown('##### 📦 Schema Objects')
      .addSql(`-- List all objects in schema with sizes\nSELECT \n    CASE c.relkind\n        WHEN 'r' THEN 'table'\n        WHEN 'v' THEN 'view'\n        WHEN 'm' THEN 'materialized view'\n        WHEN 'i' THEN 'index'\n        WHEN 'S' THEN 'sequence'\n        WHEN 's' THEN 'special'\n        WHEN 'f' THEN 'foreign table'\n        WHEN 'p' THEN 'partitioned table'\nEND as object_type,\n    c.relname as object_name,\n    pg_size_pretty(pg_total_relation_size(quote_ident('public') || '.' || quote_ident(c.relname))) as size,\n    CASE WHEN c.relkind = 'r' THEN\n        (SELECT reltuples:: bigint FROM pg_class WHERE oid = c.oid)\n    ELSE NULL END as estimated_row_count\nFROM pg_class c\nJOIN pg_namespace n ON n.oid = c.relnamespace\nWHERE n.nspname = 'public'\nAND c.relkind in ('r', 'v', 'm', 'S', 'f', 'p')\nORDER BY c.relkind, pg_total_relation_size(c.oid) DESC; `)
      .addMarkdown('##### 🔐 Schema Privileges')
      .addSql(`-- List schema privileges\nSELECT grantee, string_agg(privilege_type, ', ') as privileges\nFROM(\n    SELECT DISTINCT grantee, privilege_type\n    FROM information_schema.table_privileges\n    WHERE table_schema = '${item.schema}'\n    UNION\n    SELECT DISTINCT grantee, privilege_type\n    FROM information_schema.routine_privileges\n    WHERE routine_schema = '${item.schema}'\n    UNION\n    SELECT DISTINCT grantee, privilege_type\n    FROM information_schema.usage_privileges\n    WHERE object_schema = '${item.schema}'\n) p\nGROUP BY grantee\nORDER BY grantee; `)
      .addMarkdown('##### 🛡️ Grant Privileges')
      .addSql(`-- Grant privileges(modify as needed)\nGRANT USAGE ON SCHEMA ${item.schema} TO role_name;\nGRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${item.schema} TO role_name;\nGRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${item.schema} TO role_name;\nGRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA ${item.schema} TO role_name;\n\n--Set default privileges for future objects\nALTER DEFAULT PRIVILEGES IN SCHEMA ${item.schema}\n    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO role_name;\nALTER DEFAULT PRIVILEGES IN SCHEMA ${item.schema}\n    GRANT EXECUTE ON FUNCTIONS TO role_name;\nALTER DEFAULT PRIVILEGES IN SCHEMA ${item.schema}\n    GRANT SELECT, USAGE ON SEQUENCES TO role_name; `)
      .addMarkdown('##### 🧹 Maintenance')
      .addSql(`-- Schema maintenance\n\n--First analyze all tables(can be run within DO block)\nDO $$\nDECLARE\n    t record;\nBEGIN\n    FOR t IN \n        SELECT tablename \n        FROM pg_tables \n        WHERE pg_tables.schemaname = '${item.schema}'\nLOOP\n        EXECUTE 'ANALYZE VERBOSE ' || quote_ident('${item.schema}') || '.' || quote_ident(t.tablename);\n    END LOOP;\nEND $$;\n\n--Note: VACUUM commands must be run as separate statements\n--The following are example VACUUM commands for each table in the schema\nSELECT format('VACUUM ANALYZE %I.%I;', schemaname, tablename) as vacuum_command\nFROM pg_tables \nWHERE schemaname = '${item.schema}'\nORDER BY tablename;\n\n--To execute VACUUM on a specific table, uncomment and modify:\n--VACUUM ANALYZE ${item.schema}.table_name; `)
      .addMarkdown('##### ❌ Drop Schema')
      .addSql(`-- Drop schema(BE CAREFUL!)\nDROP SCHEMA ${item.schema}; --This will fail if schema is not empty\n\n--To force drop schema and all objects:\n--DROP SCHEMA ${item.schema} CASCADE; `)
      .show();

  } catch (err: any) {
    await ErrorHandlers.handleCommandError(err, 'create schema operations notebook');
  } finally {
    if (dbConn && dbConn.release) dbConn.release();
  }
}

/**
 * cmdRefreshSchema - Refreshes the schema item in the tree view.
 */
export async function cmdRefreshSchema(item: DatabaseTreeItem, context: vscode.ExtensionContext, databaseTreeProvider?: DatabaseTreeProvider) {
  databaseTreeProvider?.refresh(item);
}

export async function cmdShowSchemaProperties(item: DatabaseTreeItem, context: vscode.ExtensionContext) {
  let dbConn;
  try {
    dbConn = await getDatabaseConnection(item);
    const { client, metadata } = dbConn;

    // Gather comprehensive schema information
    const [schemaInfo, objectsInfo, sizeInfo, privilegesInfo, dependenciesInfo, extensionsInfo] = await Promise.all([
      client.query(QueryBuilder.schemaDetails(item.schema!)),
      client.query(QueryBuilder.schemaObjectCounts(item.schema!)),
      client.query(QueryBuilder.schemaSize(item.schema!)),
      client.query(QueryBuilder.schemaPrivileges(item.schema!)),
      client.query(QueryBuilder.schemaDependencies(item.schema!)),
      client.query(QueryBuilder.schemaExtensions(item.schema!))
    ]);

    const schema = schemaInfo.rows[0];
    const objects = objectsInfo.rows[0] || {};
    const sizes = sizeInfo.rows[0];
    const privileges = privilegesInfo.rows;
    const topObjects = dependenciesInfo.rows;
    const extensions = extensionsInfo.rows;

    // Build privileges HTML
    const privilegeRows = privileges.map((p: any) => {
      return `    <tr>
        <td><strong>${p.grantee}</strong></td>
        <td>${p.privileges || '—'}</td>
        <td style="font-size: 10px;">${p.grantable_privileges || '—'}</td>
    </tr>`;
    }).join('\n');

    // Build top objects HTML
    const objectRows = topObjects.map((obj: any) => {
      return `    <tr>
        <td><strong>${obj.object_name}</strong></td>
        <td>${obj.object_type}</td>
        <td>${obj.size}</td>
    </tr>`;
    }).join('\n');

    // Build extensions HTML
    const extensionRows = extensions.map((ext: any) => {
      return `    <tr>
        <td><strong>${ext.extension_name}</strong></td>
        <td>${ext.version}</td>
        <td>${ext.owner}</td>
    </tr>`;
    }).join('\n');

    // Calculate total object count
    const totalObjects = (parseInt(objects.table_count) || 0) +
      (parseInt(objects.view_count) || 0) +
      (parseInt(objects.matview_count) || 0) +
      (parseInt(objects.sequence_count) || 0) +
      (parseInt(objects.foreign_table_count) || 0) +
      (parseInt(objects.partitioned_table_count) || 0) +
      (parseInt(objects.function_count) || 0) +
      (parseInt(objects.type_count) || 0);

    const ownerInfo = `${schema.owner} | <strong>Database:</strong> ${item.databaseName}${schema.comment ? ` | <strong>Comment:</strong> ${schema.comment}` : ''}`;
    const markdown = MarkdownUtils.header(`🗂️ Schema Properties: \`${item.schema}\``) +
      MarkdownUtils.infoBox(`<strong>Owner:</strong> ${ownerInfo}`) +
      `\n\n#### 💾 Size & Statistics\n\n` +
      MarkdownUtils.propertiesTable({
        'Total Size': sizes.total_size || 'N/A',
        'Table Size': sizes.table_size || 'N/A',
        'Index Size': sizes.indexes_size || 'N/A',
        'Total Objects': totalObjects.toLocaleString()
      }) +
      `\n\n#### 📦 Object Breakdown\n\n` +
      MarkdownUtils.propertiesTable({
        '📊 Tables': `${objects.table_count || 0}`,
        '📋 Views': `${objects.view_count || 0}`,
        '📈 Materialized Views': `${objects.matview_count || 0}`,
        '🔢 Sequences': `${objects.sequence_count || 0}`,
        '🔗 Foreign Tables': `${objects.foreign_table_count || 0}`,
        '📂 Partitioned Tables': `${objects.partitioned_table_count || 0}`,
        '⚙️ Functions': `${objects.function_count || 0}`,
        '🏷️ Types': `${objects.type_count || 0}`,
        '⚡ Triggers': `${objects.trigger_count || 0}`
      });

    await new NotebookBuilder(metadata)
      .addMarkdown(markdown +
        (topObjects.length > 0 ? `\n\n#### 📊 Largest Objects (Top 10)

<table style="font-size: 11px; width: 100%; border-collapse: collapse;">
    <tr>
        <th style="text-align: left; width: 40%;">Name</th>
        <th style="text-align: left; width: 30%;">Type</th>
        <th style="text-align: left;">Size</th>
    </tr>
${objectRows}
</table>

` : '') +
        (privileges.length > 0 ? `#### 🔐 Privileges & Permissions (${privileges.length} grantees)

<table style="font-size: 11px; width: 100%; border-collapse: collapse;">
    <tr>
        <th style="text-align: left; width: 25%;">Grantee</th>
        <th style="text-align: left; width: 40%;">Privileges</th>
        <th style="text-align: left;">Grantable</th>
    </tr>
${privilegeRows}
</table>

` : '') +
        (extensions.length > 0 ? `#### 🧩 Extensions in Schema

<table style="font-size: 11px; width: 100%; border-collapse: collapse;">
    <tr>
        <th style="text-align: left; width: 40%;">Extension</th>
        <th style="text-align: left; width: 30%;">Version</th>
        <th style="text-align: left;">Owner</th>
    </tr>
${extensionRows}
</table>

` : '') +
        '---')
      .addMarkdown('##### 📋 List All Objects')
      .addSql(QueryBuilder.schemaAllObjects(item.schema!))
      .addMarkdown('##### 📝 CREATE SCHEMA Script')
      .addSql(`-- Create schema (if recreating)\nCREATE SCHEMA IF NOT EXISTS ${item.schema}\n    AUTHORIZATION ${schema.owner};\n\n-- Add comment\n${schema.comment ? `COMMENT ON SCHEMA ${item.schema} IS '${schema.comment.replace(/'/g, "''")}';` : `-- COMMENT ON SCHEMA ${item.schema} IS 'schema description';`}\n\n-- Grant basic privileges (modify as needed)\nGRANT USAGE ON SCHEMA ${item.schema} TO PUBLIC;\n-- GRANT CREATE ON SCHEMA ${item.schema} TO role_name;`)
      .addMarkdown('##### 🔐 Schema Privileges')
      .addSql(`-- View all schema privileges\nSELECT \n    nspname as schema_name,\n    nspacl as access_control_list,\n    pg_catalog.pg_get_userbyid(nspowner) as owner\nFROM pg_namespace\nWHERE nspname = '${item.schema}';\n\n-- Grant privileges (modify as needed)\n-- GRANT USAGE ON SCHEMA ${item.schema} TO role_name;\n-- GRANT CREATE ON SCHEMA ${item.schema} TO role_name;\n-- GRANT ALL ON SCHEMA ${item.schema} TO role_name;\n\n-- Revoke privileges\n-- REVOKE ALL ON SCHEMA ${item.schema} FROM role_name;`)
      .addMarkdown('##### 🔍 Schema Dependencies')
      .addSql(`-- Find all functions in schema\nSELECT \n    p.proname as function_name,\n    pg_get_function_arguments(p.oid) as arguments,\n    pg_get_function_result(p.oid) as return_type\nFROM pg_proc p\nJOIN pg_namespace n ON n.oid = p.pronamespace\nWHERE n.nspname = '${item.schema}';`)
      .show();

  } catch (err: any) {
    await ErrorHandlers.handleCommandError(err, 'show schema properties');
  } finally {
    if (dbConn && dbConn.release) dbConn.release();
  }
}