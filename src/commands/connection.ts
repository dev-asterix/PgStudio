import { Client } from 'pg';
import * as vscode from 'vscode';
import { PostgresMetadata } from '../common/types';
import { DatabaseTreeItem, DatabaseTreeProvider } from '../providers/DatabaseTreeProvider';
import { ConnectionManager } from '../services/ConnectionManager';
import { SecretStorageService } from '../services/SecretStorageService';
import { ErrorHandlers } from './helper';

/**
 * createMetadata - Creates metadata for the PostgreSQL connection.
 */
export function createMetadata(connection: any, databaseName: string | undefined): PostgresMetadata {
    // Create the base metadata object
    const metadata = {
        connectionId: connection.id,
        databaseName: databaseName,
        host: connection.host,
        port: connection.port,
        username: connection.username,
        password: connection.password
    };

    // Wrap it in the custom object structure expected by the notebook
    return {
        ...metadata,
        custom: {
            cells: [],
            metadata: {
                ...metadata,
                enableScripts: true
            }
        }
    };
}

/**
 * createAndShowNotebook - Creates and displays a notebook with the provided cells and metadata.
 */
export async function createAndShowNotebook(cells: vscode.NotebookCellData[], metadata: PostgresMetadata): Promise<void> {
    const notebookData = new vscode.NotebookData(cells);
    notebookData.metadata = metadata;
    const notebook = await vscode.workspace.openNotebookDocument('postgres-notebook', notebookData);
    await vscode.window.showNotebookDocument(notebook);
}

/**
 * validateRoleItem - Validates the selected role item in the database tree.
 */
export function validateRoleItem(item: DatabaseTreeItem): asserts item is DatabaseTreeItem & { connectionId: string } {
    if (!item?.connectionId) {
        throw new Error('Invalid role selection');
    }
}

/**
 * validateItem - Validates the selected item in the database tree.
 */
export function validateItem(item: DatabaseTreeItem): asserts item is DatabaseTreeItem & { schema: string; connectionId: string } {
    if (!item?.schema || !item?.connectionId) {
        throw new Error('Invalid selection');
    }
}

/**
 * validateCategoryItem - Validates the selected category item in the database tree.
 */
export function validateCategoryItem(item: DatabaseTreeItem): asserts item is DatabaseTreeItem & { connectionId: string } {
    if (!item?.connectionId) {
        throw new Error('Invalid category selection');
    }
}

/**
 * getConnectionWithPassword - Retrieves the connection details and password for the specified connection ID.
 */
export async function getConnectionWithPassword(connectionId: string): Promise<any> {
    const connections = vscode.workspace.getConfiguration().get<any[]>('postgresExplorer.connections') || [];
    const connection = connections.find(c => c.id === connectionId);

    if (!connection) {
        throw new Error('Connection not found');
    }

    const password = await SecretStorageService.getInstance().getPassword(connectionId);
    if (!password) {
        throw new Error('Password not found in secure storage');
    }

    return {
        ...connection,
        password
    };
}

export async function cmdDisconnectDatabase(item: DatabaseTreeItem, context: vscode.ExtensionContext, databaseTreeProvider?: DatabaseTreeProvider) {
    const answer = await vscode.window.showWarningMessage(
        `Are you sure you want to delete connection '${item.label}'?`,
        'Yes', 'No'
    );

    if (answer === 'Yes') {
        try {
            const config = vscode.workspace.getConfiguration();
            const connections = config.get<any[]>('postgresExplorer.connections') || [];

            // Find the connection to verify it exists
            const connectionToDelete = connections.find(c => c.id === item.connectionId);
            if (!connectionToDelete) {
                vscode.window.showWarningMessage(`Connection '${item.label}' not found.`);
                return;
            }

            // Remove the connection info from settings
            const updatedConnections = connections.filter(c => c.id !== item.connectionId);
            await config.update('postgresExplorer.connections', updatedConnections, vscode.ConfigurationTarget.Global);

            // Remove the password from SecretStorage (if it exists)
            try {
                await SecretStorageService.getInstance().deletePassword(item.connectionId!);
            } catch (err) {
                // Password might not exist if connection was created without credentials
                console.log(`No password to delete for connection ${item.connectionId}`);
            }

            // Close any active connections in ConnectionManager
            try {
                await ConnectionManager.getInstance().closeConnection({
                    id: connectionToDelete.id,
                    host: connectionToDelete.host,
                    port: connectionToDelete.port,
                    username: connectionToDelete.username,
                    database: connectionToDelete.database
                });
            } catch (err) {
                // Connection might not be open, that's okay
                console.log(`No active connection to close for ${item.connectionId}`);
            }

            // Refresh the tree view
            databaseTreeProvider?.refresh();

            vscode.window.showInformationMessage(`Connection '${item.label}' has been deleted successfully.`);
        } catch (err: any) {
            await ErrorHandlers.handleCommandError(err, 'delete connection');
            console.error('Delete connection error:', err);
        }
    }
}

export async function cmdDisconnectConnection(item: DatabaseTreeItem, context: vscode.ExtensionContext, databaseTreeProvider?: DatabaseTreeProvider) {
    try {
        if (!item?.connectionId) {
            throw new Error('Invalid connection selection');
        }

        const connectionManager = ConnectionManager.getInstance();
        const connectionId = item.connectionId;
        
        // Close all database connections for this connection ID
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Closing connections for ${item.label}...`,
            cancellable: false
        }, async () => {
            await connectionManager.closeAllConnectionsById(connectionId);
        });

        // Mark connection as disconnected and refresh tree
        databaseTreeProvider?.markConnectionDisconnected(item.connectionId);
        
        vscode.window.showInformationMessage(`Disconnected from '${item.label}'`);
    } catch (err: any) {
        await ErrorHandlers.handleCommandError(err, 'disconnect');
    }
}

export async function cmdReconnectConnection(item: DatabaseTreeItem, context: vscode.ExtensionContext, databaseTreeProvider?: DatabaseTreeProvider) {
    try {
        if (!item?.connectionId) {
            throw new Error('Invalid connection selection');
        }

        // Mark connection as connected and refresh tree
        databaseTreeProvider?.markConnectionConnected(item.connectionId);
        
        vscode.window.showInformationMessage(`Reconnected to '${item.label}'`);
    } catch (err: any) {
        await ErrorHandlers.handleCommandError(err, 'reconnect');
    }
}

export async function cmdConnectDatabase(item: DatabaseTreeItem, context: vscode.ExtensionContext, databaseTreeProvider?: DatabaseTreeProvider) {
    try {
        const connectionString = await vscode.window.showInputBox({
            prompt: 'Enter PostgreSQL connection string',
            placeHolder: 'postgresql://user:password@localhost:5432/dbname'
        });

        if (!connectionString) {
            return;
        }

        const client = new Client(connectionString);
        await client.connect();
        vscode.window.showInformationMessage('Connected to PostgreSQL database');
        databaseTreeProvider?.refresh();
        await client.end();
    } catch (err: any) {
        await ErrorHandlers.handleCommandError(err, 'connect');
    }
}

/**
 * Show connection safety details - displays environment and safety settings
 */
export async function showConnectionSafety(): Promise<void> {
    try {
        const editor = vscode.window.activeNotebookEditor;
        if (!editor) {
            vscode.window.showInformationMessage('No active PostgreSQL notebook');
            return;
        }

        const metadata = editor.notebook.metadata as PostgresMetadata;
        if (!metadata?.connectionId) {
            vscode.window.showInformationMessage('No active connection');
            return;
        }

        const connections = vscode.workspace.getConfiguration().get<any[]>('postgresExplorer.connections') || [];
        const connection = connections.find(c => c.id === metadata.connectionId);

        if (!connection) {
            vscode.window.showErrorMessage('Connection configuration not found');
            return;
        }

        const environment = connection.environment || 'Not set';
        const readOnlyMode = connection.readOnlyMode ? 'Enabled' : 'Disabled';
        const environmentIcon = 
            environment === 'production' ? '🔴' :
            environment === 'staging' ? '🟡' :
            environment === 'development' ? '🟢' : 'ℹ️';

        const title = `${environmentIcon} ${connection.name || connection.host}`;
        const message = [
            `Environment: ${environment.charAt(0).toUpperCase() + environment.slice(1)}`,
            `Read-Only Mode: ${readOnlyMode}`,
            `Host: ${connection.host}:${connection.port}`,
            `Database: ${metadata.databaseName || connection.database || 'default'}`,
        ].join('\n');

        const action = environment === 'production' 
            ? 'Be extra careful with write operations!'
            : 'Review connection settings';

        const result = await vscode.window.showInformationMessage(
            title,
            { modal: true, detail: `${message}\n\n${action}` },
            'Edit Connection'
        );

        if (result === 'Edit Connection') {
            await vscode.commands.executeCommand('postgres-explorer.editConnection', 
                new DatabaseTreeItem(
                    connection.name || connection.host,
                    vscode.TreeItemCollapsibleState.None,
                    'connection',
                    connection.id
                )
            );
        }
    } catch (err: any) {
        await ErrorHandlers.handleCommandError(err, 'show connection safety');
    }
}

/**
 * Reveal connection in explorer - shows and selects the connection in the tree view
 */
export async function revealInExplorer(databaseTreeProvider: DatabaseTreeProvider): Promise<void> {
    try {
        const editor = vscode.window.activeNotebookEditor;
        if (!editor) {
            vscode.window.showInformationMessage('No active PostgreSQL notebook');
            return;
        }

        const metadata = editor.notebook.metadata as PostgresMetadata;
        if (!metadata?.connectionId) {
            vscode.window.showInformationMessage('No active connection');
            return;
        }

        await databaseTreeProvider.revealItem(metadata.connectionId, metadata.databaseName);
    } catch (err: any) {
        await ErrorHandlers.handleCommandError(err, 'reveal in explorer');
    }
}
