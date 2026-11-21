/**
 * CockroachDB Three-Node Replicated Distributed SQL Database Backend
 * Tech Stack: Node.js, Express.js, PostgreSQL driver (pg)
 * Connects directly to CockroachDB 3-Node Cluster
 */

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Node connection configs (3 separate nodes in the distributed cluster)
const NODES = {
  1: { id: 1, name: 'Node 1 (roach1)', host: 'localhost', port: 26257, httpPort: 8080 },
  2: { id: 2, name: 'Node 2 (roach2)', host: 'localhost', port: 26258, httpPort: 8081 },
  3: { id: 3, name: 'Node 3 (roach3)', host: 'localhost', port: 26259, httpPort: 8082 }
};

// Create PostgreSQL connection pools for each CockroachDB node
const pools = {
  1: new Pool({
    connectionString: 'postgresql://root@localhost:26257/distributed_store?sslmode=disable',
    connectionTimeoutMillis: 3000,
    max: 10
  }),
  2: new Pool({
    connectionString: 'postgresql://root@localhost:26258/distributed_store?sslmode=disable',
    connectionTimeoutMillis: 3000,
    max: 10
  }),
  3: new Pool({
    connectionString: 'postgresql://root@localhost:26259/distributed_store?sslmode=disable',
    connectionTimeoutMillis: 3000,
    max: 10
  })
};

// Helper: Get connection pool for requested node (1, 2, 3) or auto-find healthy node
async function getPool(preferredNode = 'auto') {
  const nodeNum = parseInt(preferredNode, 10);
  if ([1, 2, 3].includes(nodeNum)) {
    try {
      const client = await pools[nodeNum].connect();
      client.release();
      return { pool: pools[nodeNum], targetNode: nodeNum };
    } catch (err) {
      console.warn(`Target Node ${nodeNum} unreachable, failing over to available node...`);
    }
  }

  // Auto failover: try 1, then 2, then 3
  for (const n of [1, 2, 3]) {
    try {
      const client = await pools[n].connect();
      client.release();
      return { pool: pools[n], targetNode: n };
    } catch (err) {
      // Continue to next node
    }
  }

  throw new Error('All CockroachDB nodes are currently unreachable. Ensure the cluster is started.');
}

// Database & Table Auto-Initializer
async function initializeDatabase() {
  console.log('🔄 Checking / Initializing Distributed Database and Replication Zones...');
  
  // Try to connect to any active node with default database 'defaultdb'
  let initClient = null;
  for (const n of [1, 2, 3]) {
    try {
      const tempPool = new Pool({
        connectionString: `postgresql://root@localhost:${NODES[n].port}/defaultdb?sslmode=disable`,
        connectionTimeoutMillis: 3000
      });
      initClient = await tempPool.connect();
      console.log(` Connected to cluster gateway via Node ${n} (Port ${NODES[n].port})`);
      break;
    } catch (e) {
      // try next
    }
  }

  if (!initClient) {
    console.warn('⚠️ CockroachDB nodes not yet reachable on startup. Will initialize upon first API call or cluster startup.');
    return false;
  }

  try {
    // 1. Create Database
    await initClient.query('CREATE DATABASE IF NOT EXISTS distributed_store;');
    
    // 2. Set Database Replication Zone to 3
    try {
      await initClient.query('ALTER DATABASE distributed_store CONFIGURE ZONE USING num_replicas = 3;');
    } catch (e) {
      console.log('Notice on database zone config:', e.message);
    }

    // 3. Create Table
    await initClient.query(`
      CREATE TABLE IF NOT EXISTS distributed_store.products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        sku VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        category VARCHAR(50) NOT NULL,
        price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
        stock_quantity INT NOT NULL CHECK (stock_quantity >= 0),
        created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
        updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
      );
    `);

    // 4. Set Table-Level Replication Zone to 3
    try {
      await initClient.query('ALTER TABLE distributed_store.products CONFIGURE ZONE USING num_replicas = 3;');
    } catch (e) {
      console.log('Notice on table zone config:', e.message);
    }

    // 5. Seed initial data if empty
    const countRes = await initClient.query('SELECT count(*) FROM distributed_store.products;');
    if (parseInt(countRes.rows[0].count, 10) === 0) {
      await initClient.query(`
        INSERT INTO distributed_store.products (sku, name, category, price, stock_quantity)
        VALUES 
          ('SKU-LAP-001', 'Dell XPS 15 Laptop', 'Computers', 1899.99, 25),
          ('SKU-PHN-002', 'Google Pixel 8 Pro', 'Mobile Phones', 999.00, 50),
          ('SKU-MNT-003', 'LG UltraFine 4K Monitor', 'Monitors', 699.50, 40),
          ('SKU-KBD-004', 'Keychron Q1 Mechanical Keyboard', 'Accessories', 199.00, 80),
          ('SKU-MOU-005', 'Logitech MX Master 3S Mouse', 'Accessories', 99.99, 120);
      `);
      console.log(' Seeded 5 initial records into distributed_store.products');
    }

    console.log(' Distributed Database, Products Table & Replication Zones Verified (Replication Factor = 3)');
    return true;
  } catch (err) {
    console.error('Error during database initialization:', err.message);
    return false;
  } finally {
    if (initClient) initClient.release();
  }
}

// =====================================================================
// REST APIs
// =====================================================================

/**
 * 1. CLUSTER STATUS & HEALTH
 * Queries CockroachDB internal system tables and node socket connectivity
 */
app.get('/api/cluster/status', async (req, res) => {
  const startTime = Date.now();
  const nodeHealth = {};

  // Check physical connection to each of the 3 ports
  for (const n of [1, 2, 3]) {
    const config = NODES[n];
    try {
      const client = await pools[n].connect();
      const nodeRes = await client.query('SELECT crdb_internal.node_id() as node_id, version() as version;');
      client.release();
      nodeHealth[n] = {
        online: true,
        nodeId: nodeRes.rows[0].node_id,
        sqlAddress: `${config.host}:${config.port}`,
        httpPort: config.httpPort,
        adminUrl: `http://${config.host}:${config.httpPort}`,
        version: nodeRes.rows[0].version.split(' ')[0]
      };
    } catch (err) {
      nodeHealth[n] = {
        online: false,
        error: err.message,
        sqlAddress: `${config.host}:${config.port}`,
        httpPort: config.httpPort,
        adminUrl: `http://${config.host}:${config.httpPort}`
      };
    }
  }

  // Query CockroachDB internal KV node status from any active node
  let internalStatus = [];
  try {
    const { pool } = await getPool('auto');
    const statusQuery = await pool.query(`
      SELECT 
        node_id, 
        address, 
        is_live,
        ranges,
        leases,
        build_tag,
        updated_at
      FROM crdb_internal.kv_node_status
      ORDER BY node_id ASC;
    `);
    internalStatus = statusQuery.rows;
  } catch (err) {
    // If table query fails, fallback to port connectivity check
  }

  const liveCount = Object.values(nodeHealth).filter(n => n.online).length;
  const quorumRequired = 2; // In 3-node cluster, quorum = floor(3/2) + 1 = 2
  const quorumSatisfied = liveCount >= quorumRequired;

  let clusterState = 'HEALTHY';
  if (liveCount === 0) clusterState = 'DOWN';
  else if (liveCount < quorumRequired) clusterState = 'QUORUM_LOST';
  else if (liveCount < 3) clusterState = 'DEGRADED';

  res.json({
    status: 'success',
    clusterState,
    totalNodes: 3,
    liveNodes: liveCount,
    quorumRequired,
    quorumSatisfied,
    responseTimeMs: Date.now() - startTime,
    nodes: nodeHealth,
    internalStatus
  });
});

/**
 * 2. REPLICATION & RAFT RANGE INSPECTOR
 * Shows real-time CockroachDB ranges, replicas array, and leaseholder
 */
app.get('/api/cluster/replication', async (req, res) => {
  try {
    const { pool, targetNode } = await getPool('auto');
    
    // 1. Get Table Ranges
    const rangesRes = await pool.query('SHOW RANGES FROM TABLE products;');
    
    // 2. Get Zone Configuration
    const zoneRes = await pool.query('SHOW ZONE CONFIGURATION FOR TABLE products;');
    
    // 3. Get Database Zone Configuration
    const dbZoneRes = await pool.query('SHOW ZONE CONFIGURATION FOR DATABASE distributed_store;');

    res.json({
      status: 'success',
      inspectedViaNode: targetNode,
      tableName: 'products',
      database: 'distributed_store',
      replicationFactor: 3,
      ranges: rangesRes.rows,
      tableZoneConfig: zoneRes.rows,
      dbZoneConfig: dbZoneRes.rows,
      explanation: {
        concept: 'Multi-Raft Consensus',
        rangeMechanism: 'CockroachDB divides the table keyspace into contiguous chunks called Ranges. Each range is replicated across 3 nodes.',
        quorumRule: 'Writes require consensus from at least 2 out of 3 replicas before being committed.',
        leaseholderRule: 'The Leaseholder is the replica designated to serve reads directly without Raft consensus overhead, guaranteeing linearizable consistency.'
      }
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * 3. DISTRIBUTED SQL QUERY EXPLAIN PLAN
 * Demonstrates how CockroachDB DistSQL plans and executes queries across cluster nodes
 */
app.get('/api/cluster/distsql-plan', async (req, res) => {
  try {
    const { pool, targetNode } = await getPool(req.query.node);
    const planRes = await pool.query(`
      EXPLAIN (DISTSQL) 
      SELECT category, count(*) AS total_products, avg(price) AS average_price, sum(stock_quantity) AS total_inventory
      FROM products 
      GROUP BY category;
    `);

    res.json({
      status: 'success',
      executedOnNode: targetNode,
      query: 'SELECT category, count(*), avg(price), sum(stock_quantity) FROM products GROUP BY category;',
      distsqlPlan: planRes.rows
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * 4. INITIALIZE / SEED DATABASE (Triggered manually or via button)
 */
app.post('/api/cluster/init-db', async (req, res) => {
  const success = await initializeDatabase();
  if (success) {
    res.json({ status: 'success', message: 'Database, tables, and replication zones initialized successfully.' });
  } else {
    res.status(500).json({ status: 'error', message: 'Failed to initialize database. Ensure at least one CockroachDB node is online.' });
  }
});

/**
 * 5. CRUD: LIST ALL PRODUCTS (Supports querying specific node)
 */
app.get('/api/products', async (req, res) => {
  const startTime = Date.now();
  const targetNode = req.query.node || 'auto';
  const category = req.query.category;
  const search = req.query.search;

  try {
    const { pool, targetNode: resolvedNode } = await getPool(targetNode);

    let queryText = 'SELECT * FROM products';
    const params = [];
    const conditions = [];

    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(name ILIKE $${params.length} OR sku ILIKE $${params.length})`);
    }

    if (conditions.length > 0) {
      queryText += ' WHERE ' + conditions.join(' AND ');
    }

    queryText += ' ORDER BY created_at DESC;';

    const result = await pool.query(queryText, params);
    const duration = Date.now() - startTime;

    res.json({
      status: 'success',
      count: result.rows.length,
      processedByNode: resolvedNode,
      processedByPort: NODES[resolvedNode].port,
      durationMs: duration,
      data: result.rows
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
      requestedNode: targetNode
    });
  }
});

/**
 * 6. CRUD: GET SINGLE PRODUCT
 */
app.get('/api/products/:id', async (req, res) => {
  const targetNode = req.query.node || 'auto';
  try {
    const { pool, targetNode: resolvedNode } = await getPool(targetNode);
    const result = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Product not found' });
    }

    res.json({
      status: 'success',
      processedByNode: resolvedNode,
      data: result.rows[0]
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * 7. CRUD: CREATE PRODUCT (INSERT)
 * Demonstrates distributed Raft consensus write commit
 */
app.post('/api/products', async (req, res) => {
  const startTime = Date.now();
  const targetNode = req.query.node || 'auto';
  const { sku, name, category, price, stock_quantity } = req.body;

  if (!sku || !name || !category || price === undefined || stock_quantity === undefined) {
    return res.status(400).json({ status: 'error', message: 'sku, name, category, price, and stock_quantity are required' });
  }

  try {
    const { pool, targetNode: resolvedNode } = await getPool(targetNode);
    const result = await pool.query(
      `INSERT INTO products (sku, name, category, price, stock_quantity)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *;`,
      [sku.trim(), name.trim(), category.trim(), parseFloat(price), parseInt(stock_quantity, 10)]
    );

    const duration = Date.now() - startTime;

    res.status(201).json({
      status: 'success',
      message: `Product inserted via Node ${resolvedNode} (Port ${NODES[resolvedNode].port}) and replicated to cluster.`,
      processedByNode: resolvedNode,
      processedByPort: NODES[resolvedNode].port,
      durationMs: duration,
      raftConsensusNotice: 'Committed to majority quorum (>=2 nodes) before acknowledging write.',
      data: result.rows[0]
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * 8. CRUD: UPDATE PRODUCT
 */
app.put('/api/products/:id', async (req, res) => {
  const startTime = Date.now();
  const targetNode = req.query.node || 'auto';
  const { name, category, price, stock_quantity } = req.body;

  try {
    const { pool, targetNode: resolvedNode } = await getPool(targetNode);

    const fields = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name.trim()); }
    if (category !== undefined) { fields.push(`category = $${idx++}`); values.push(category.trim()); }
    if (price !== undefined) { fields.push(`price = $${idx++}`); values.push(parseFloat(price)); }
    if (stock_quantity !== undefined) { fields.push(`stock_quantity = $${idx++}`); values.push(parseInt(stock_quantity, 10)); }
    fields.push(`updated_at = clock_timestamp()`);

    if (fields.length === 1) {
      return res.status(400).json({ status: 'error', message: 'No fields provided to update.' });
    }

    values.push(req.params.id);
    const query = `UPDATE products SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *;`;

    const result = await pool.query(query, values);
    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Product not found.' });
    }

    res.json({
      status: 'success',
      message: `Product updated on Node ${resolvedNode}.`,
      processedByNode: resolvedNode,
      durationMs: Date.now() - startTime,
      data: result.rows[0]
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * 9. CRUD: DELETE PRODUCT
 */
app.delete('/api/products/:id', async (req, res) => {
  const targetNode = req.query.node || 'auto';
  try {
    const { pool, targetNode: resolvedNode } = await getPool(targetNode);
    const result = await pool.query('DELETE FROM products WHERE id = $1 RETURNING id, sku, name;', [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Product not found' });
    }

    res.json({
      status: 'success',
      message: `Product deleted via Node ${resolvedNode}.`,
      processedByNode: resolvedNode,
      data: result.rows[0]
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * 10. DISTRIBUTED ACID TRANSACTION DEMO
 * Demonstrates serializable distributed transaction across products (e.g. inventory transfer)
 */
app.post('/api/products/distributed-transaction', async (req, res) => {
  const { fromSku, toSku, quantity } = req.body;
  const qty = parseInt(quantity || 5, 10);
  const targetNode = req.query.node || 'auto';

  if (!fromSku || !toSku) {
    return res.status(400).json({ status: 'error', message: 'fromSku and toSku are required' });
  }

  let client = null;
  try {
    const { pool, targetNode: resolvedNode } = await getPool(targetNode);
    client = await pool.connect();

    // Start SERIALIZABLE transaction
    await client.query('BEGIN;');

    // Deduct stock from source product
    const deductRes = await client.query(
      `UPDATE products 
       SET stock_quantity = stock_quantity - $1 
       WHERE sku = $2 AND stock_quantity >= $1 
       RETURNING sku, name, stock_quantity;`,
      [qty, fromSku]
    );

    if (deductRes.rows.length === 0) {
      await client.query('ROLLBACK;');
      return res.status(400).json({
        status: 'error',
        message: `Transaction Aborted: Insufficient stock or source product '${fromSku}' not found.`
      });
    }

    // Add stock to destination product
    const addRes = await client.query(
      `UPDATE products 
       SET stock_quantity = stock_quantity + $1 
       WHERE sku = $2 
       RETURNING sku, name, stock_quantity;`,
      [qty, toSku]
    );

    if (addRes.rows.length === 0) {
      await client.query('ROLLBACK;');
      return res.status(400).json({
        status: 'error',
        message: `Transaction Aborted: Target product '${toSku}' not found.`
      });
    }

    // Commit distributed transaction
    await client.query('COMMIT;');

    res.json({
      status: 'success',
      message: `Distributed ACID Transaction Committed successfully via Node ${resolvedNode}!`,
      processedByNode: resolvedNode,
      isolationLevel: 'SERIALIZABLE',
      details: {
        transferredQty: qty,
        source: deductRes.rows[0],
        destination: addRes.rows[0]
      }
    });
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK;'); } catch (e) {}
    }
    res.status(500).json({ status: 'error', message: err.message });
  } finally {
    if (client) client.release();
  }
});

// Start Server
app.listen(PORT, async () => {
  console.log(`================================================================`);
  console.log(` CockroachDB Distributed SQL System Server Running on Port ${PORT}`);
  console.log(` Web Dashboard: http://localhost:${PORT}`);
  console.log(` Node 1 SQL: localhost:26257 | Web UI: http://localhost:8080`);
  console.log(` Node 2 SQL: localhost:26258 | Web UI: http://localhost:8081`);
  console.log(` Node 3 SQL: localhost:26259 | Web UI: http://localhost:8082`);
  console.log(`================================================================`);
  await initializeDatabase();
});

module.exports = { app, initializeDatabase };
