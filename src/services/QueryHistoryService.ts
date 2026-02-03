import * as vscode from 'vscode';

export interface QueryHistoryItem {
  id: string;
  query: string;
  timestamp: number;
  success: boolean;
  duration?: number;
  durationMs?: number;
  rowCount?: number;
  connectionName?: string;
  slow?: boolean;
}

export class QueryHistoryService {
  private static instance: QueryHistoryService;
  private storage: vscode.Memento;
  private readonly STORAGE_KEY = 'postgres-explorer.queryHistory';
  private readonly MAX_ITEMS = 100;

  private _onDidChangeHistory = new vscode.EventEmitter<void>();
  public readonly onDidChangeHistory = this._onDidChangeHistory.event;

  private constructor(storage: vscode.Memento) {
    this.storage = storage;
  }

  public static initialize(storage: vscode.Memento): void {
    if (!QueryHistoryService.instance) {
      QueryHistoryService.instance = new QueryHistoryService(storage);
    }
  }

  public static getInstance(): QueryHistoryService {
    if (!QueryHistoryService.instance) {
      throw new Error('QueryHistoryService not initialized');
    }
    return QueryHistoryService.instance;
  }

  public getHistory(): QueryHistoryItem[] {
    return this.storage.get<QueryHistoryItem[]>(this.STORAGE_KEY, []);
  }

  public async add(item: Omit<QueryHistoryItem, 'id' | 'timestamp'>): Promise<void> {
    const history = this.getHistory();
    const newItem: QueryHistoryItem = {
      ...item,
      id: this.generateId(),
      timestamp: Date.now()
    };

    // Add to beginning
    history.unshift(newItem);

    // Trim
    if (history.length > this.MAX_ITEMS) {
      history.splice(this.MAX_ITEMS);
    }

    await this.storage.update(this.STORAGE_KEY, history);
    this._onDidChangeHistory.fire();
  }

  public async clear(): Promise<void> {
    await this.storage.update(this.STORAGE_KEY, []);
    this._onDidChangeHistory.fire();
  }

  public async delete(id: string): Promise<void> {
    const history = this.getHistory();
    const newHistory = history.filter(item => item.id !== id);
    await this.storage.update(this.STORAGE_KEY, newHistory);
    this._onDidChangeHistory.fire();
  }

  /**
   * Trend stats for recent query history
   */
  public getTrendStats(): { avgMs: number; successRate: number; slowRate: number; total: number } {
    const history = this.getHistory();
    if (history.length === 0) {
      return { avgMs: 0, successRate: 0, slowRate: 0, total: 0 };
    }

    const total = history.length;
    const avgMs = history.reduce((sum, h) => sum + (h.durationMs ?? (h.duration ? h.duration * 1000 : 0)), 0) / total;
    const successRate = history.filter(h => h.success).length / total;
    const slowRate = history.filter(h => h.slow).length / total;

    return { avgMs, successRate, slowRate, total };
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }
}
