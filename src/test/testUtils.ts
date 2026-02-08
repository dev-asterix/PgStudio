/**
 * Test utilities for integration and component testing
 */

import { Client, Pool } from 'pg';

export interface TestDatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: boolean | any;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

export class TestDatabaseSetup {
  private client: Client | null = null;

  /**
   * Get test database configuration based on environment
   */
  static getTestConfig(): TestDatabaseConfig {
    const version = process.env.DB_VERSION || '16';
    const portMap: { [key: string]: number } = {
      '12': 5412,
      '14': 5414,
      '15': 5415,
      '16': 5416,
      '17': 5417
    };

    return {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || String(portMap[version] || 5416)),
      user: process.env.DB_USER || 'testuser',
      password: process.env.DB_PASSWORD || 'testpass',
      database: process.env.DB_NAME || 'testdb',
      ssl: false
    };
  }

  /**
   * Create a test client
   */
  async createClient(config?: Partial<TestDatabaseConfig>): Promise<Client> {
    const fullConfig = { ...TestDatabaseSetup.getTestConfig(), ...config };
    this.client = new Client(fullConfig);
    await this.client.connect();
    return this.client;
  }

  /**
   * Create a test pool
   */
  createPool(config?: Partial<TestDatabaseConfig>): Pool {
    const fullConfig = { ...TestDatabaseSetup.getTestConfig(), ...config };
    return new Pool(fullConfig);
  }

  /**
   * Setup test schema
   */
  async setupTestSchema(client: Client): Promise<void> {
    await client.query(`
      DROP SCHEMA IF EXISTS test_schema CASCADE;
      CREATE SCHEMA test_schema;
    `);

    await client.query(`
      CREATE TABLE test_schema.users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE test_schema.posts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES test_schema.users(id),
        title VARCHAR(255) NOT NULL,
        content TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX idx_posts_user_id ON test_schema.posts(user_id);
      CREATE INDEX idx_users_email ON test_schema.users(email);
    `);
  }

  /**
   * Cleanup test schema
   */
  async cleanupTestSchema(client: Client): Promise<void> {
    await client.query('DROP SCHEMA IF EXISTS test_schema CASCADE;');
  }

  /**
   * Insert test data
   */
  async insertTestData(client: Client): Promise<void> {
    await client.query(`
      INSERT INTO test_schema.users (name, email) VALUES
        ('John Doe', 'john@example.com'),
        ('Jane Smith', 'jane@example.com'),
        ('Bob Johnson', 'bob@example.com');
    `);

    await client.query(`
      INSERT INTO test_schema.posts (user_id, title, content) VALUES
        (1, 'First Post', 'Content of first post'),
        (1, 'Second Post', 'Content of second post'),
        (2, 'Jane\'s Post', 'Content of jane\'s post');
    `);
  }

  /**
   * Close client
   */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.end();
      this.client = null;
    }
  }
}

/**
 * Test utilities for timing and performance
 */
export class TestTimer {
  private startTime: number = 0;

  start(): void {
    this.startTime = Date.now();
  }

  elapsed(): number {
    return Date.now() - this.startTime;
  }

  reset(): void {
    this.startTime = 0;
  }
}

/**
 * Helper for testing connection lifecycle
 */
export class ConnectionLifecycleHelper {
  /**
   * Test connection with timeout
   */
  static async testConnectionWithTimeout(
    client: Client,
    timeout: number = 5000
  ): Promise<boolean> {
    return Promise.race([
      client.query('SELECT 1').then(() => true),
      new Promise<boolean>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), timeout)
      )
    ]);
  }

  /**
   * Simulate connection pool exhaustion
   */
  static async exhaustConnectionPool(
    pool: Pool,
    connectionCount: number
  ): Promise<Client[]> {
    const clients: Client[] = [];
    for (let i = 0; i < connectionCount; i++) {
      const client = new Client(pool.options);
      await client.connect();
      clients.push(client);
    }
    return clients;
  }

  /**
   * Release exhausted connections
   */
  static async releaseExhaustedConnections(clients: Client[]): Promise<void> {
    for (const client of clients) {
      await client.end();
    }
  }
}

/**
 * Coverage reporting utilities
 */
export class CoverageReporter {
  private statements = 0;
  private statementsCovered = 0;
  private branches = 0;
  private branchesCovered = 0;
  private functions = 0;
  private functionsCovered = 0;
  private lines = 0;
  private linesCovered = 0;

  addStatementCoverage(total: number, covered: number): void {
    this.statements += total;
    this.statementsCovered += covered;
  }

  addBranchCoverage(total: number, covered: number): void {
    this.branches += total;
    this.branchesCovered += covered;
  }

  addFunctionCoverage(total: number, covered: number): void {
    this.functions += total;
    this.functionsCovered += covered;
  }

  addLineCoverage(total: number, covered: number): void {
    this.lines += total;
    this.linesCovered += covered;
  }

  getPercentage(covered: number, total: number): number {
    return total === 0 ? 100 : Math.round((covered / total) * 100);
  }

  generateReport(): string {
    const statements = this.getPercentage(this.statementsCovered, this.statements);
    const branches = this.getPercentage(this.branchesCovered, this.branches);
    const functions = this.getPercentage(this.functionsCovered, this.functions);
    const lines = this.getPercentage(this.linesCovered, this.lines);

    return `
Coverage Report
===============
Statements: ${statements}% (${this.statementsCovered}/${this.statements})
Branches:   ${branches}% (${this.branchesCovered}/${this.branches})
Functions:  ${functions}% (${this.functionsCovered}/${this.functions})
Lines:      ${lines}% (${this.linesCovered}/${this.lines})

Overall:    ${Math.round((statements + branches + functions + lines) / 4)}%
`;
  }
}
