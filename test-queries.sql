-- =====================================================================
-- CockroachDB Three-Node Distributed SQL Verification & Test Queries
-- Database: distributed_store
-- Table: products
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CLUSTER & NODE VERIFICATION QUERIES
-- ---------------------------------------------------------------------

-- View all live nodes in the cluster and their Raft range/lease count
SELECT 
    node_id, 
    address, 
    is_live, 
    ranges, 
    leases, 
    build_tag 
FROM crdb_internal.kv_node_status 
ORDER BY node_id;

-- View current node identity processing this query
SELECT 
    crdb_internal.node_id() AS executing_node_id,
    current_database() AS active_database,
    version() AS cockroach_version;

-- View cluster gossip nodes
SELECT * FROM crdb_internal.gossip_nodes;

-- ---------------------------------------------------------------------
-- 2. REPLICATION FACTOR & ZONE CONFIGURATION
-- ---------------------------------------------------------------------

-- Inspect database-level replication settings (num_replicas = 3)
SHOW ZONE CONFIGURATION FOR DATABASE distributed_store;

-- Inspect table-level replication settings (num_replicas = 3)
SHOW ZONE CONFIGURATION FOR TABLE products;

-- Inspect physical Raft ranges, replica nodes, and leaseholder
SHOW RANGES FROM TABLE products;

-- ---------------------------------------------------------------------
-- 3. CRUD (CREATE, READ, UPDATE, DELETE) OPERATIONS
-- ---------------------------------------------------------------------

-- CREATE (INSERT)
INSERT INTO products (sku, name, category, price, stock_quantity)
VALUES ('SKU-TAB-008', 'Samsung Galaxy Tab S9', 'Tablets', 799.99, 30)
RETURNING *;

-- READ (SELECT)
-- Read all products ordered by last update
SELECT id, sku, name, category, price, stock_quantity, updated_at 
FROM products 
ORDER BY updated_at DESC;

-- Filtered Read by category
SELECT sku, name, price, stock_quantity 
FROM products 
WHERE category = 'Accessories' AND price < 150.00;

-- UPDATE
UPDATE products 
SET price = 179.99, stock_quantity = 75, updated_at = clock_timestamp() 
WHERE sku = 'SKU-KBD-004' 
RETURNING *;

-- DELETE
DELETE FROM products 
WHERE sku = 'SKU-TAB-008' 
RETURNING sku, name;

-- ---------------------------------------------------------------------
-- 4. DISTRIBUTED QUERY PROCESSING (DISTSQL)
-- ---------------------------------------------------------------------

-- Explain the physical distributed execution plan across cluster nodes
EXPLAIN (DISTSQL)
SELECT 
    category, 
    COUNT(*) AS total_items, 
    ROUND(AVG(price), 2) AS avg_price, 
    SUM(stock_quantity) AS total_stock 
FROM products 
GROUP BY category 
ORDER BY total_stock DESC;

-- Execute the distributed aggregation query
SELECT 
    category, 
    COUNT(*) AS total_items, 
    ROUND(AVG(price), 2) AS avg_price, 
    SUM(stock_quantity) AS total_stock 
FROM products 
GROUP BY category 
ORDER BY total_stock DESC;

-- ---------------------------------------------------------------------
-- 5. DISTRIBUTED ACID TRANSACTION (SERIALIZABLE)
-- ---------------------------------------------------------------------

-- Atomic transfer of inventory stock between products across Raft ranges
BEGIN;

-- Deduct 5 units from Dell XPS 15
UPDATE products 
SET stock_quantity = stock_quantity - 5, updated_at = clock_timestamp() 
WHERE sku = 'SKU-LAP-001' AND stock_quantity >= 5;

-- Add 5 units to Google Pixel 8 Pro
UPDATE products 
SET stock_quantity = stock_quantity + 5, updated_at = clock_timestamp() 
WHERE sku = 'SKU-PHN-002';

COMMIT;

-- Verify updated balances
SELECT sku, name, stock_quantity, updated_at 
FROM products 
WHERE sku IN ('SKU-LAP-001', 'SKU-PHN-002');
