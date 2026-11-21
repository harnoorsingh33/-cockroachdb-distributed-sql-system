-- =====================================================================
-- CockroachDB 3-Node Distributed Cluster Initialization Script
-- Project: Implementation of a Three-Node Replicated Distributed SQL Database
-- Database: distributed_store
-- Table: products
-- =====================================================================

-- 1. Create the Distributed Database
CREATE DATABASE IF NOT EXISTS distributed_store;

-- 2. Configure Replication Zone on the Database Level (Replication Factor = 3)
-- This ensures all ranges belonging to this database are replicated across 3 nodes
ALTER DATABASE distributed_store CONFIGURE ZONE USING num_replicas = 3;

-- 3. Switch to distributed_store
USE distributed_store;

-- 4. Create the Replicated Products Table
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL,
    price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
    stock_quantity INT NOT NULL CHECK (stock_quantity >= 0),
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

-- 5. Configure Table-Specific Zone (Explicit 3-node Raft consensus replication)
ALTER TABLE products CONFIGURE ZONE USING num_replicas = 3;

-- 6. Insert Initial Enterprise Products
INSERT INTO products (sku, name, category, price, stock_quantity)
VALUES 
    ('SKU-LAP-001', 'Dell XPS 15 Laptop', 'Computers', 1899.99, 25),
    ('SKU-PHN-002', 'Google Pixel 8 Pro', 'Mobile Phones', 999.00, 50),
    ('SKU-MNT-003', 'LG UltraFine 4K Monitor', 'Monitors', 699.50, 40),
    ('SKU-KBD-004', 'Keychron Q1 Mechanical Keyboard', 'Accessories', 199.00, 80),
    ('SKU-MOU-005', 'Logitech MX Master 3S Mouse', 'Accessories', 99.99, 120)
ON CONFLICT (sku) DO NOTHING;

-- 7. Verification Queries (Raft Range & Cluster Node Inspection)
-- SHOW ZONE CONFIGURATION FOR TABLE products;
-- SHOW RANGES FROM TABLE products;
-- SELECT node_id, address, is_live FROM crdb_internal.kv_node_status;
