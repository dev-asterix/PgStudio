import * as vscode from 'vscode';
import { QueryHistoryService, QueryHistoryItem } from '../services/QueryHistoryService';
import { NotebookBuilder } from '../commands/helper';
import { PostgresMetadata } from '../common/types';

interface HistoryGroup {
  type: 'group';
  label: string;
  items: QueryHistoryItem[];
}

type HistoryNode = HistoryGroup | QueryHistoryItem;

export class QueryHistoryProvider implements vscode.TreeDataProvider<HistoryNode> {
  private _onDidChangeTreeData: vscode.EventEmitter<HistoryNode | undefined | null | void> = new vscode.EventEmitter<HistoryNode | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<HistoryNode | undefined | null | void> = this._onDidChangeTreeData.event;

  constructor() {
    try {
      QueryHistoryService.getInstance().onDidChangeHistory(() => {
        this._onDidChangeTreeData.fire();
      });
    } catch (e) {
      // detailed error handling can be added here if needed
    }
  }

  getTreeItem(element: HistoryNode): vscode.TreeItem {
    // 1. Handle Group Nodes
    if ('type' in element && element.type === 'group') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
      item.contextValue = 'queryHistoryGroup';
      return item;
    }

    // 2. Handle Query History Items
    const historyItem = element as QueryHistoryItem;

    // Strip leading comments (both -- and /* */) to get to the actual query
    const cleanQuery = historyItem.query.replace(/^(\s*(--.*)|(\/\*[\s\S]*?\*\/)\s*)*/gm, '').trim();

    // Show query as label, replacing newlines with spaces to maximize visible content
    // Allow VS Code to truncate visually, but keep it short enough to show description (timestamp)
    const flattenedQuery = cleanQuery.replace(/\s+/g, ' ').substring(0, 60).trim();
    const label = flattenedQuery || '<empty query>';

    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);

    // Set command to open query on click (skip for trend summary items)
    if (!historyItem.id.startsWith('trend-')) {
      item.command = {
        command: 'postgres-explorer.openQuery',
        title: 'Open Query',
        arguments: [historyItem]
      };
    }

    const timeString = this.formatTime(historyItem.timestamp);
    item.description = timeString;
    item.tooltip = new vscode.MarkdownString()
      .appendMarkdown(`**Query**\n\`\`\`sql\n${historyItem.query}\n\`\`\`\n\n`)
      .appendMarkdown(`**Executed At:** ${timeString}\n`)
      .appendMarkdown(`**Status:** ${historyItem.success ? '✅ Success' : '❌ Failed'}\n`)
      .appendMarkdown(`**Duration:** ${historyItem.duration?.toFixed(3)}s\n`)
      .appendMarkdown(`**Rows:** ${historyItem.rowCount ?? '-'}\n`)
      .appendMarkdown(`**Slow Query:** ${historyItem.slow ? '⚠️ Yes' : 'No'}\n`)
      .appendMarkdown(`**Connection:** ${historyItem.connectionName || '-'}`);

    const icon = historyItem.slow && historyItem.success ? 'warning' : (historyItem.success ? 'check' : 'error');
    const color = historyItem.slow && historyItem.success
      ? new vscode.ThemeColor('list.warningForeground')
      : (historyItem.success ? new vscode.ThemeColor('testing.iconPassed') : new vscode.ThemeColor('testing.iconFailed'));

    item.iconPath = new vscode.ThemeIcon(icon, color);

    item.contextValue = 'queryHistoryItem';

    return item;
  }

  getChildren(element?: HistoryNode): vscode.ProviderResult<HistoryNode[]> {
    if (element) {
      // If element is a group, return its items
      if ('type' in element && element.type === 'group') {
        return element.items;
      }
      // If element is an item, it has no children
      return [];
    }

    try {
      const history = QueryHistoryService.getInstance().getHistory();
      const trendGroup = this.buildTrendGroup();
      return [trendGroup, ...this.groupHistory(history)];
    } catch (e) {
      return [];
    }
  }

  private buildTrendGroup(): HistoryGroup {
    const stats = QueryHistoryService.getInstance().getTrendStats();
    const items: QueryHistoryItem[] = [
      { id: 'trend-avg', query: `Avg Duration: ${stats.avgMs.toFixed(1)} ms`, timestamp: Date.now(), success: true },
      { id: 'trend-success', query: `Success Rate: ${(stats.successRate * 100).toFixed(1)}%`, timestamp: Date.now(), success: true },
      { id: 'trend-slow', query: `Slow Queries: ${(stats.slowRate * 100).toFixed(1)}%`, timestamp: Date.now(), success: true },
      { id: 'trend-total', query: `Total Queries: ${stats.total}`, timestamp: Date.now(), success: true }
    ];

    return { type: 'group', label: 'Trends (Recent)', items };
  }

  private groupHistory(items: QueryHistoryItem[]): HistoryGroup[] {
    const groups: HistoryGroup[] = [];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 86400000;
    const lastWeek = today - 7 * 86400000;
    const lastMonth = today - 30 * 86400000;

    const buckets: { [key: string]: QueryHistoryItem[] } = {
      'Today': [],
      'Yesterday': [],
      'Last Week': [],
      'Last Month': []
    };

    // For year-wise grouping
    const yearBuckets: { [year: string]: QueryHistoryItem[] } = {};

    items.forEach(item => {
      // Handle missing timestamp safely
      const ts = item.timestamp || 0;

      if (ts >= today) {
        buckets['Today'].push(item);
      } else if (ts >= yesterday) {
        buckets['Yesterday'].push(item);
      } else if (ts >= lastWeek) {
        buckets['Last Week'].push(item);
      } else if (ts >= lastMonth) {
        buckets['Last Month'].push(item);
      } else {
        const year = new Date(ts).getFullYear().toString();
        if (!yearBuckets[year]) {
          yearBuckets[year] = [];
        }
        yearBuckets[year].push(item);
      }
    });

    // Add standard buckets if they have items
    ['Today', 'Yesterday', 'Last Week', 'Last Month'].forEach(label => {
      if (buckets[label].length > 0) {
        groups.push({ type: 'group', label, items: buckets[label] });
      }
    });

    // Add year buckets (sorted descending)
    Object.keys(yearBuckets).sort((a, b) => Number(b) - Number(a)).forEach(year => {
      groups.push({ type: 'group', label: year, items: yearBuckets[year] });
    });

    return groups;
  }

  private formatTime(timestamp: number | undefined): string {
    if (!timestamp) {
      return '';
    }
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  }


}
