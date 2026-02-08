import * as vscode from 'vscode';
import { ProfileManager } from '../services/ProfileManager';
import { SavedQueriesService } from '../services/SavedQueriesService';
import { extensionContext } from '../extension';

/**
 * Tree view item for connection profiles
 */
class ProfileTreeItem extends vscode.TreeItem {
  constructor(
    public readonly profile: any,
    public readonly isActive: boolean = false,
    public readonly command?: vscode.Command
  ) {
    const label = isActive 
      ? `● ${profile.profileName || profile.name || `${profile.host}:${profile.port}`}`
      : profile.profileName || profile.name || `${profile.host}:${profile.port}`;
    
    super(
      label,
      vscode.TreeItemCollapsibleState.None
    );
    this.description = isActive ? `${profile.description || `${profile.host}:${profile.port}`} (ACTIVE)` : (profile.description || `${profile.host}:${profile.port}`);
    this.tooltip = `${profile.profileName}\n${profile.description || ''}\nHost: ${profile.host}:${profile.port}${isActive ? '\n\n✓ This profile is currently active' : ''}`;
    this.contextValue = 'profile';
    this.iconPath = new vscode.ThemeIcon(profile.readOnlyMode ? 'lock' : 'person');
    
    // Highlight active profile with bold styling if supported
    if (isActive) {
      this.resourceUri = vscode.Uri.parse('profile://active');
    }
  }
}

/**
 * Tree view item for saved queries
 */
class SavedQueryTreeItem extends vscode.TreeItem {
  constructor(
    public readonly query: any
  ) {
    super(query.title, vscode.TreeItemCollapsibleState.None);
    this.description = query.description || `${query.usageCount} uses`;
    this.tooltip = query.query;
    this.contextValue = 'savedQuery';
    this.iconPath = new vscode.ThemeIcon('save');
  }
}

/**
 * Tree view provider for connection profiles
 */
export class ProfilesTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor() {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    const profileManager = ProfileManager.getInstance();
    const profiles = profileManager.getProfiles();

    if (profiles.length === 0) {
      const noItemsItem = new vscode.TreeItem('No profiles yet');
      noItemsItem.contextValue = 'emptyProfiles';
      noItemsItem.iconPath = new vscode.ThemeIcon('info');
      return [noItemsItem];
    }

    // Get currently active notebook to check which profile is active
    const activeEditor = vscode.window.activeNotebookEditor;
    const notebookKey = activeEditor 
      ? `activeProfile-${activeEditor.notebook.uri.toString()}`
      : null;
    const activeProfileContext = notebookKey 
      ? extensionContext?.globalState.get<any>(notebookKey)
      : null;

    return profiles.map(
      (profile) => {
        const isActive = activeProfileContext?.profileId === profile.id;
        return new ProfileTreeItem(profile, isActive, {
          command: 'postgres-explorer.switchConnectionProfile',
          title: 'Switch Profile',
          arguments: [profile.id],
        });
      }
    );
  }
}

/**
 * Tree view provider for saved queries
 */
export class SavedQueriesTreeProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor() {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    const service = SavedQueriesService.getInstance();
    const queries = service.getQueries();

    if (queries.length === 0) {
      const noItemsItem = new vscode.TreeItem('No saved queries yet');
      noItemsItem.contextValue = 'emptySavedQueries';
      noItemsItem.iconPath = new vscode.ThemeIcon('info');
      return [noItemsItem];
    }

    // Show recent queries first (up to 20)
    return queries.slice(0, 20).map((query) => new SavedQueryTreeItem(query));
  }
}
