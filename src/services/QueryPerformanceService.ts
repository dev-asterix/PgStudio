import * as vscode from 'vscode';
import { QueryBaseline } from './QueryAnalyzer';

export class QueryPerformanceService {
  private static instance: QueryPerformanceService;
  private storage: vscode.Memento;
  private readonly STORAGE_KEY = 'postgres-explorer.queryPerformanceBaselines';

  // Cache in memory to avoid redundant reads
  private cache: Map<string, QueryBaseline> = new Map();

  private constructor(storage: vscode.Memento) {
    this.storage = storage;
    this.loadCache();
  }

  public static initialize(storage: vscode.Memento): void {
    if (!QueryPerformanceService.instance) {
      QueryPerformanceService.instance = new QueryPerformanceService(storage);
    }
  }

  public static getInstance(): QueryPerformanceService {
    if (!QueryPerformanceService.instance) {
      throw new Error('QueryPerformanceService not initialized');
    }
    return QueryPerformanceService.instance;
  }

  private loadCache() {
    const data = this.storage.get<Record<string, QueryBaseline>>(this.STORAGE_KEY, {});
    this.cache = new Map(Object.entries(data));
  }

  private async saveCache() {
    const data = Object.fromEntries(this.cache);
    await this.storage.update(this.STORAGE_KEY, data);
  }

  public getBaseline(queryHash: string): QueryBaseline | null {
    return this.cache.get(queryHash) || null;
  }

  public async recordExecution(queryHash: string, executionTimeMs: number): Promise<void> {
    const existing = this.cache.get(queryHash);
    const now = Date.now();

    let baseline: QueryBaseline;

    if (existing) {
      // Update rolling stats
      const newCount = existing.sampleCount + 1;

      // Welford's online algorithm for variance (optional, but good for stdDev)
      // For now, simpler rolling average is fine:
      // avg_new = avg_old + (value - avg_old) / n
      const newAvg = existing.avgExecutionTime + (executionTimeMs - existing.avgExecutionTime) / newCount;

      baseline = {
        queryHash,
        avgExecutionTime: newAvg,
        minExecutionTime: Math.min(existing.minExecutionTime, executionTimeMs),
        maxExecutionTime: Math.max(existing.maxExecutionTime, executionTimeMs),
        stdDev: 0, // Placeholder for now unless we implement full Welford
        sampleCount: newCount,
        lastUpdated: now
      };
    } else {
      // Create new baseline
      baseline = {
        queryHash,
        avgExecutionTime: executionTimeMs,
        minExecutionTime: executionTimeMs,
        maxExecutionTime: executionTimeMs,
        stdDev: 0,
        sampleCount: 1,
        lastUpdated: now
      };
    }

    this.cache.set(queryHash, baseline);

    // Persist every update (or could debounce if high traffic, but this is user-driven query execution)
    await this.saveCache();
  }

  public async clear(): Promise<void> {
    this.cache.clear();
    await this.storage.update(this.STORAGE_KEY, {});
  }
}
