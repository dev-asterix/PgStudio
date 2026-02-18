import * as vscode from 'vscode';
import { DatabaseTreeItem } from '../providers/DatabaseTreeProvider';
import { TableDesignerPanel } from '../schemaDesigner/TableDesignerPanel';
import { SchemaDiffPanel } from '../schemaDesigner/SchemaDiffPanel';

/**
 * Open the Visual Table Designer for an existing table (Edit mode)
 */
export async function cmdOpenTableDesigner(
  item: DatabaseTreeItem,
  context: vscode.ExtensionContext
): Promise<void> {
  console.log('[SchemaDesigner] cmdOpenTableDesigner called with item:', JSON.stringify({
    label: item?.label,
    type: item?.type,
    connectionId: item?.connectionId,
    databaseName: item?.databaseName,
    schema: item?.schema,
    tableName: item?.tableName,
    contextValue: item?.contextValue,
  }));
  await TableDesignerPanel.openForTable(item, context);
}

/**
 * Open the Visual Table Designer in Create mode (new table)
 */
export async function cmdCreateTableVisual(
  item: DatabaseTreeItem,
  context: vscode.ExtensionContext
): Promise<void> {
  await TableDesignerPanel.openForCreate(item, context);
}

/**
 * Open the Schema Diff panel to compare two schemas
 */
export async function cmdOpenSchemaDiff(
  item: DatabaseTreeItem,
  context: vscode.ExtensionContext
): Promise<void> {
  console.log('[SchemaDesigner] cmdOpenSchemaDiff called with item:', JSON.stringify({
    label: item?.label,
    type: item?.type,
    connectionId: item?.connectionId,
    databaseName: item?.databaseName,
    schema: item?.schema,
    tableName: item?.tableName,
    contextValue: item?.contextValue,
  }));
  await SchemaDiffPanel.open(item, context);
}
