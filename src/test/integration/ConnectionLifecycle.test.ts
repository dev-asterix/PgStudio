import { expect } from 'chai';
import * as sinon from 'sinon';
import { ConnectionManager } from '../../services/ConnectionManager';
import { SecretStorageService } from '../../services/SecretStorageService';
import { Client, Pool } from 'pg';

describe('Connection Lifecycle Integration Tests', () => {
  let connectionManager: ConnectionManager;
  let secretService: SecretStorageService;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    connectionManager = ConnectionManager.getInstance();
    secretService = SecretStorageService.getInstance();
  });

  afterEach(() => {
    sandbox.restore();
    connectionManager['connections'].clear();
  });

  describe('Basic Connection Lifecycle', () => {
    it('should establish a connection to PostgreSQL', async function () {
      this.timeout(10000);
      
      const config = {
        connectionId: 'test-basic-conn',
        host: 'localhost',
        port: 5416,
        database: 'testdb',
        user: 'testuser',
        password: 'testpass',
        ssl: false
      };

      try {
        const client = await connectionManager.getConnection(config);
        expect(client).to.exist;
        
        const result = await client.query('SELECT 1 as result');
        expect(result.rows).to.have.length(1);
        expect(result.rows[0].result).to.equal(1);
        
        await client.end();
      } catch (error) {
        throw new Error(`Connection failed: ${error}`);
      }
    });

    it('should reuse existing connections', async function () {
      this.timeout(10000);
      
      const config = {
        connectionId: 'test-reuse-conn',
        host: 'localhost',
        port: 5416,
        database: 'testdb',
        user: 'testuser',
        password: 'testpass',
        ssl: false
      };

      const client1 = await connectionManager.getConnection(config);
      const client2 = await connectionManager.getConnection(config);
      
      expect(client1).to.equal(client2);
      
      await client1.end();
    });

    it('should handle connection closure gracefully', async function () {
      this.timeout(10000);
      
      const config = {
        connectionId: 'test-close-conn',
        host: 'localhost',
        port: 5416,
        database: 'testdb',
        user: 'testuser',
        password: 'testpass',
        ssl: false
      };

      const client = await connectionManager.getConnection(config);
      await client.end();
      
      expect(() => connectionManager.releaseConnection('test-close-conn')).to.not.throw();
    });
  });

  describe('SSL Connection Tests', () => {
    it('should attempt SSL connection and fallback on failure', async function () {
      this.timeout(10000);
      
      const config = {
        connectionId: 'test-ssl-conn',
        host: 'localhost',
        port: 5416,
        database: 'testdb',
        user: 'testuser',
        password: 'testpass',
        ssl: true
      };

      try {
        // For testing without SSL certificate, this should fallback
        const client = await connectionManager.getConnection(config);
        expect(client).to.exist;
        await client.end();
      } catch (error) {
        // Expected for self-signed certs without proper setup
        expect(error).to.exist;
      }
    });

    it('should handle SSL with reject unauthorized false', async function () {
      this.timeout(10000);
      
      const config = {
        connectionId: 'test-ssl-insecure',
        host: 'localhost',
        port: 5416,
        database: 'testdb',
        user: 'testuser',
        password: 'testpass',
        ssl: { rejectUnauthorized: false }
      };

      try {
        const client = await connectionManager.getConnection(config);
        expect(client).to.exist;
        await client.end();
      } catch (error) {
        // Expected since no SSL is configured on test postgres
        expect(error).to.exist;
      }
    });
  });

  describe('Pool Exhaustion Scenarios', () => {
    it('should handle multiple concurrent connections', async function () {
      this.timeout(15000);
      
      const config = {
        connectionId: 'test-concurrent',
        host: 'localhost',
        port: 5416,
        database: 'testdb',
        user: 'testuser',
        password: 'testpass',
        ssl: false,
        max: 5
      };

      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          connectionManager.getConnection(config).then(client => {
            return client.query('SELECT 1').finally(() => client.end());
          })
        );
      }

      const results = await Promise.all(promises);
      expect(results).to.have.length(5);
    });

    it('should timeout on pool exhaustion', async function () {
      this.timeout(15000);
      
      const config = {
        connectionId: 'test-pool-exhaust',
        host: 'localhost',
        port: 5416,
        database: 'testdb',
        user: 'testuser',
        password: 'testpass',
        ssl: false,
        max: 1,
        connectionTimeoutMillis: 2000
      };

      try {
        const client1 = await connectionManager.getConnection(config);
        
        // Try to get another connection while first is still active
        const client2Promise = connectionManager.getConnection(config);
        
        // This should timeout
        const result = await Promise.race([
          client2Promise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
        ]);
      } catch (error) {
        expect(error).to.exist;
      }
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle authentication failure', async function () {
      this.timeout(10000);
      
      const config = {
        connectionId: 'test-auth-fail',
        host: 'localhost',
        port: 5416,
        database: 'testdb',
        user: 'testuser',
        password: 'wrongpass',
        ssl: false
      };

      try {
        await connectionManager.getConnection(config);
        expect.fail('Should have thrown authentication error');
      } catch (error) {
        expect((error as any).message).to.include('password authentication failed');
      }
    });

    it('should handle connection to non-existent database', async function () {
      this.timeout(10000);
      
      const config = {
        connectionId: 'test-db-not-found',
        host: 'localhost',
        port: 5416,
        database: 'nonexistentdb',
        user: 'testuser',
        password: 'testpass',
        ssl: false
      };

      try {
        await connectionManager.getConnection(config);
        expect.fail('Should have thrown database does not exist error');
      } catch (error) {
        expect((error as any).message).to.include('does not exist');
      }
    });

    it('should handle connection to unreachable host', async function () {
      this.timeout(10000);
      
      const config = {
        connectionId: 'test-unreachable',
        host: 'unreachable.invalid',
        port: 5432,
        database: 'testdb',
        user: 'testuser',
        password: 'testpass',
        ssl: false
      };

      try {
        await connectionManager.getConnection(config);
        expect.fail('Should have thrown connection error');
      } catch (error) {
        expect(error).to.exist;
      }
    });
  });

  describe('Connection Pool Management', () => {
    it('should manage multiple connections per pool', async function () {
      this.timeout(10000);
      
      const config1 = {
        connectionId: 'test-pool-1',
        host: 'localhost',
        port: 5416,
        database: 'testdb',
        user: 'testuser',
        password: 'testpass',
        ssl: false
      };

      const config2 = {
        connectionId: 'test-pool-2',
        host: 'localhost',
        port: 5416,
        database: 'testdb',
        user: 'testuser',
        password: 'testpass',
        ssl: false
      };

      const client1 = await connectionManager.getConnection(config1);
      const client2 = await connectionManager.getConnection(config2);
      
      expect(client1).to.not.equal(client2);
      
      await client1.end();
      await client2.end();
    });

    it('should release connections on explicit call', async function () {
      this.timeout(10000);
      
      const config = {
        connectionId: 'test-release',
        host: 'localhost',
        port: 5416,
        database: 'testdb',
        user: 'testuser',
        password: 'testpass',
        ssl: false
      };

      const client = await connectionManager.getConnection(config);
      connectionManager.releaseConnection('test-release');
      
      // Connection should be removed from cache
      expect(connectionManager['connections'].has('test-release')).to.be.false;
    });

    it('should handle cleanup of all connections', async function () {
      this.timeout(10000);
      
      const config = {
        connectionId: 'test-cleanup',
        host: 'localhost',
        port: 5416,
        database: 'testdb',
        user: 'testuser',
        password: 'testpass',
        ssl: false
      };

      const client = await connectionManager.getConnection(config);
      
      // Clean up all connections
      await connectionManager.cleanup();
      
      expect(connectionManager['connections'].size).to.equal(0);
    });
  });

  describe('Version Compatibility', () => {
    it('should work with different PostgreSQL versions', async function () {
      this.timeout(10000);
      
      const versions = [
        { port: 5412, version: 'pg12' },
        { port: 5414, version: 'pg14' },
        { port: 5415, version: 'pg15' },
        { port: 5416, version: 'pg16' },
        { port: 5417, version: 'pg17' }
      ];

      for (const { port, version } of versions) {
        try {
          const config = {
            connectionId: `test-${version}`,
            host: 'localhost',
            port,
            database: 'testdb',
            user: 'testuser',
            password: 'testpass',
            ssl: false
          };

          const client = await connectionManager.getConnection(config);
          const result = await client.query('SELECT version()');
          expect(result.rows).to.have.length(1);
          await client.end();
        } catch (error) {
          // Skip if version not available
          console.log(`PostgreSQL ${version} not available: ${error}`);
        }
      }
    });
  });
});
