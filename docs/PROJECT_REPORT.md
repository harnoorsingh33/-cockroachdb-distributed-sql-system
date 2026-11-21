# Academic Project Report
## Implementation of a Three-Node Replicated Distributed SQL Database Using CockroachDB

**Course:** Database Management Systems (Distributed Databases)  
**Project Title:** Implementation of a Three-Node Replicated Distributed SQL Database Using CockroachDB  
**Technology Stack:** CockroachDB, Node.js, Express.js, PostgreSQL Driver (`pg`), Docker, Docker Compose, HTML5, CSS3, JavaScript  

---

## Executive Summary

Traditional relational database management systems (RDBMS) such as MySQL and PostgreSQL were architected for single-machine deployment, relying on active-passive replication schemes that suffer from failover latency, potential data loss during network partitions, and vertical scaling limitations. Conversely, distributed NoSQL stores sacrifice ACID guarantees and standard SQL semantics to achieve horizontal scalability (eventual consistency).

This project designs, implements, and evaluates a **Three-Node Replicated Distributed SQL Database** utilizing **CockroachDB**, containerized with **Docker Compose**, and interfaced through a custom full-stack **Node.js/Express** monitoring dashboard and REST API. The system validates horizontal data distribution, Multi-Raft consensus replication, strict serializable ACID transactions, distributed query optimization (DistSQL), and seamless fault tolerance during node failure scenarios without loss of quorum.

---

## 1. Introduction and Objectives

Distributed SQL databases represent the latest evolution in database architecture, combining the robust relational model, declarative SQL language, and ACID guarantees of traditional RDBMS with the horizontal scalability, continuous availability, and fault tolerance of modern distributed systems.

### 1.1 Project Objectives
1. **Cluster Configuration:** Deploy a resilient 3-node CockroachDB cluster using Docker Compose with dedicated storage volumes and internal bridge networking.
2. **Cluster Initialization & Discovery:** Initialize the distributed cluster into a unified single-system image via Raft gossip protocols.
3. **Replication Verification:** Configure a replication factor of 3 (`num_replicas = 3`) and empirically verify range replica distribution across all nodes.
4. **Full-Stack Application Integration:** Develop a high-performance Node.js/Express backend utilizing the PostgreSQL wire protocol (`pg` driver) with connection pools to all three nodes.
5. **Multi-Node Read/Write Verification:** Prove that any node can act as a gateway to perform writes, and data is instantly accessible and consistent when read from any peer node.
6. **Distributed ACID Transactions:** Demonstrate multi-row distributed transactions operating under Serializable isolation level.
7. **Distributed SQL Query Processing (DistSQL):** Inspect and evaluate physical distributed execution plans (`EXPLAIN (DISTSQL)`).
8. **Fault Tolerance & High Availability:** Empirically validate uninterrupted service when a node fails ($Q \ge 2$), followed by automatic recovery and Raft log catch-up upon node restoration.

---

## 2. Theoretical Foundations

### 2.1 The CAP Theorem and PACELC Classification
According to Eric Brewer's CAP Theorem, a distributed data store can guarantee at most two of three properties: Consistency (C), Availability (A), and Partition tolerance (P). In the event of a network partition (P), CockroachDB prioritizes **Consistency over Availability** (CP system):
- If a network partition occurs, only the partition containing a majority quorum ($> 50\%$ of replicas) continues serving writes and linearizable reads.
- Partitions lacking quorum halt operations to prevent **Split-Brain** anomalies.
- Under the PACELC theorem, CockroachDB is classified as **PC/EC** (if Partitioned: Consistency over Availability; Else: Consistency over Latency).

### 2.2 Multi-Raft Consensus Protocol
CockroachDB divides the global tabular keyspace into contiguous 64MB blocks termed **Ranges**. Instead of relying on a single, global Raft consensus leader (which creates a CPU and network throughput bottleneck), CockroachDB implements **Multi-Raft**:
- Every individual 64MB range operates an independent Raft consensus group with its own leader and followers.
- A cluster with millions of ranges distributes leadership evenly across all nodes, enabling concurrent distributed writes without centralized contention.
- Writes to a range require agreement from a quorum $Q = \lfloor n/2 \rfloor + 1$. In our 3-node cluster ($n = 3$), quorum is $Q = \lfloor 3/2 \rfloor + 1 = 2$.

### 2.3 Range Leases and Linearizable Reads
In standard Raft, reading data requires a roundtrip consensus check to ensure the leader has not been partitioned. CockroachDB eliminates this overhead using **Range Leases**:
- One replica in each Raft group is granted a time-based Leaseholder status (typically co-located with the Raft leader).
- The Leaseholder is guaranteed to possess all committed Raft logs.
- Client reads are served directly by the Leaseholder from its local storage engine (Pebble) without network consensus rounds, achieving sub-millisecond read latency while preserving strict serializability.

### 2.4 Distributed Multi-Version Concurrency Control (MVCC)
CockroachDB records every key-value modification with a timestamp. Updates do not overwrite existing data in place; instead, a new MVCC version is written. This enables lock-free snapshot reads without blocking concurrent writes, supporting high transaction concurrency.

---

## 3. Technology Stack and System Architecture

### 3.1 Component Specifications
- **Distributed Database:** CockroachDB v23.2.3 (Go-native, PostgreSQL wire compatible)
- **Containerization:** Docker & Docker Compose v3.8
- **Backend Framework:** Node.js v24 + Express.js v4.21
- **Driver:** `pg` (PostgreSQL client pool for Node.js)
- **Frontend Dashboard:** HTML5, CSS3 (Modern Dark Slate Theme), Vanilla ECMAScript 6+
- **Internal Storage Engine:** Pebble (High-performance LSM-tree key-value store)

### 3.2 Network and Port Mapping Configuration

| Service Name | Container Name | Internal IP / Host | SQL Client Port | Web Admin UI Port |
|---|---|---|---|---|
| Node 1 | `roach1` | `roach1:26257` | `26257` (Host) | `8080` (Host) |
| Node 2 | `roach2` | `roach2:26257` | `26258` (Host) | `8081` (Host) |
| Node 3 | `roach3` | `roach3:26257` | `26259` (Host) | `8082` (Host) |
| Express App | Host Process | `localhost:3000` | N/A | `3000` (Host) |

---

## 4. Database Schema and Replication Configuration

### 4.1 Schema Definition
The database `distributed_store` models a distributed enterprise product catalog and inventory system:

```sql
CREATE DATABASE IF NOT EXISTS distributed_store;
USE distributed_store;

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
```

### 4.2 Replication Zone Configuration
To guarantee that data is replicated across all 3 nodes, replication zone constraints were applied at both database and table levels:

```sql
ALTER DATABASE distributed_store CONFIGURE ZONE USING num_replicas = 3;
ALTER TABLE products CONFIGURE ZONE USING num_replicas = 3;
```

---

## 5. Implementation Details

### 5.1 Multi-Pool Connection Architecture (`server.js`)
Rather than treating CockroachDB as an opaque single database, the Node.js backend maintains three distinct `pg.Pool` connection pools targeting Node 1 (port 26257), Node 2 (port 26258), and Node 3 (port 26259). This allows the frontend to explicitly route queries through specific physical nodes, demonstrating distributed consistency and transparent query routing.

### 5.2 REST API Endpoints Summary

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/cluster/status` | Live status of all 3 nodes, quorum state, and internal KV metrics |
| `GET` | `/api/cluster/replication` | Range descriptors, replica arrays, and leaseholders from `SHOW RANGES` |
| `GET` | `/api/cluster/distsql-plan` | Distributed query execution graph from `EXPLAIN (DISTSQL)` |
| `GET` | `/api/products` | Retrieve products (supports `?node=1|2|3|auto`, `?search=`) |
| `POST` | `/api/products` | Insert product via specified gateway node |
| `PUT` | `/api/products/:id` | Update product price or stock via specified gateway node |
| `DELETE` | `/api/products/:id` | Delete product across cluster |
| `POST` | `/api/products/distributed-transaction` | Execute atomic stock transfer across rows with `BEGIN ... COMMIT` |

---

## 6. Experimental Verification and Results

### 6.1 Experiment 1: Multi-Node Read/Write Consistency
- **Procedure:** A new record (`SKU-PROBE-01`) was inserted directly via **Node 1** on port 26257. An immediate query was dispatched to **Node 2** (port 26258), and concurrently to **Node 3** (port 26259).
- **Result:** Both Node 2 and Node 3 returned the record instantaneously with 100% data fidelity.
- **Conclusion:** Proves CockroachDB's Raft consensus commits data to majority replicas synchronously prior to returning write acknowledgment.

### 6.2 Experiment 2: Fault Tolerance Under Node Failure
- **Procedure:**
  1. Cluster operational with all 3 nodes online ($Live = 3, Quorum = 2$).
  2. Node 1 was abruptly terminated (`docker compose stop roach1`).
  3. The monitoring dashboard detected Node 1 down, marking cluster state as **DEGRADED**.
  4. Write and Read operations were dispatched to surviving nodes (Node 2 and Node 3).
- **Result:** Writes and reads completed successfully without error or delay because surviving nodes ($2$) met the required quorum ($2 \ge 2$).
- **Conclusion:** CockroachDB guarantees continuous availability and zero data loss despite a single node failure in a 3-node cluster.

### 6.3 Experiment 3: Node Recovery and Catch-Up
- **Procedure:** Node 1 was restarted (`docker compose start roach1`).
- **Result:**
  1. The node rejoined the gossip network.
  2. The Raft leader for each range transmitted missed log entries via Raft snapshot/append RPCs.
  3. The cluster status returned to **HEALTHY** ($3/3$ nodes online).
  4. Data written while Node 1 was offline was verified present on Node 1.
- **Conclusion:** Proves self-healing distributed consensus and automatic replica synchronization.

### 6.4 Experiment 4: Distributed Query Execution (DistSQL)
- **Procedure:** Executed `EXPLAIN (DISTSQL) SELECT category, count(*), avg(price) FROM products GROUP BY category`.
- **Result:** The optimizer generated a distributed physical plan where `TableReader` operators execute in parallel on data-holding nodes, pushing down local aggregation stages before streaming partial results to the coordinating gateway node for final reduction.
- **Conclusion:** Demonstrates distributed query optimization and reduced network serialization bottlenecks.

---

## 7. Conclusion

This project successfully implemented a complete, fully functioning Three-Node Replicated Distributed SQL Database using CockroachDB, Node.js, and Docker Compose. By actively verifying Raft range replication, cross-node data consistency, distributed transactions, and node failure tolerance, the system proves the core advantages of modern Distributed SQL:
1. True horizontal scaling without sacrificing relational SQL expressiveness.
2. Uncompromising serializable consistency through Multi-Raft consensus.
3. High availability and automated recovery during physical node outages.
