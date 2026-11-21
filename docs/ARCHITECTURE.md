# Distributed Architecture & Consensus Design
## Three-Node Replicated Distributed SQL Database Using CockroachDB

This document provides a detailed architectural breakdown of the 3-node CockroachDB distributed SQL cluster, explaining data partitioning, the Multi-Raft consensus algorithm, transaction processing, and fault tolerance mechanisms.

---

## 1. High-Level System Architecture Diagram

```
+-----------------------------------------------------------------------------------+
|                                  CLIENT LAYER                                     |
|             Web Browser Dashboard (HTML5 / Modern CSS / Vanilla JS)               |
+-----------------------------------------------------------------------------------+
                                         │  HTTP / REST (port 3000)
                                         ▼
+-----------------------------------------------------------------------------------+
|                             APPLICATION SERVER LAYER                              |
|                       Node.js + Express.js API Gateway                            |
|                                                                                   |
|  • Connection Pool 1 (Node 1)    • Multi-Node Failover Router                     |
|  • Connection Pool 2 (Node 2)    • Cluster Health Monitor                         |
|  • Connection Pool 3 (Node 3)    • Telemetry & Query Tracker                      |
+-----------------------------------------------------------------------------------+
              │                              │                              │
              │ SQL (26257)                  │ SQL (26258)                  │ SQL (26259)
              ▼                              ▼                              ▼
+───────────────────────────+  +───────────────────────────+  +───────────────────────────+
|     COCKROACHDB NODE 1    |  |     COCKROACHDB NODE 2    |  |     COCKROACHDB NODE 3    |
|       (Container: roach1) |  |       (Container: roach2) |  |       (Container: roach3) |
|   SQL: 26257 | Web: 8080  |  |   SQL: 26258 | Web: 8081  |  |   SQL: 26259 | Web: 8082  |
+───────────────────────────+  +───────────────────────────+  +───────────────────────────+
| [SQL Execution Layer]     |  | [SQL Execution Layer]     |  | [SQL Execution Layer]     |
| [Transaction / MVCC Layer]|  | [Transaction / MVCC Layer]|  | [Transaction / MVCC Layer]|
| [Distributed KV Layer]    |  | [Distributed KV Layer]    |  | [Distributed KV Layer]    |
| [Raft Consensus Engine]   |  | [Raft Consensus Engine]   |  | [Raft Consensus Engine]   |
| [Pebble Storage Engine]   |  | [Pebble Storage Engine]   |  | [Pebble Storage Engine]   |
+───────────────────────────+  +───────────────────────────+  +───────────────────────────+
              ▲                              ▲                              ▲
              │                              │                              │
              └────────────── Gossip Network & Raft Consensus ──────────────┘
                       (Internal Port 26257 on bridge network 'roachnet')
```

---

## 2. CockroachDB Internal Layered Architecture

Each CockroachDB node runs five modular, cooperating layers:

```
+-------------------------------------------------------------+
| 1. SQL Layer                                                |
|    - Parses PostgreSQL dialect queries                      |
|    - Cost-based Query Optimizer (CBO)                       |
|    - Plans execution and transforms SQL into KV operations  |
+-------------------------------------------------------------+
                              │
                              ▼
+-------------------------------------------------------------+
| 2. Distributed Execution Layer (DistSQL)                    |
|    - Breaks SQL execution plans into distributed sub-trees  |
|    - Pushes TableReader and Filter nodes to data-owning nodes|
+-------------------------------------------------------------+
                              │
                              ▼
+-------------------------------------------------------------+
| 3. Distributed KV & Transaction Layer                       |
|    - Provides single monolithic sorted KV keyspace          |
|    - Manages Multi-Version Concurrency Control (MVCC)       |
|    - Enforces STRICT SERIALIZABLE ACID transactions         |
+-------------------------------------------------------------+
                              │
                              ▼
+-------------------------------------------------------------+
| 4. Replication Layer (Multi-Raft Consensus)                 |
|    - Divides keyspace into 64MB Ranges                      |
|    - Each range replicates across 3 nodes                   |
|    - Requires Quorum (>= 2 of 3) for log entry commit       |
|    - Assigns Range Leases to minimize read latencies        |
+-------------------------------------------------------------+
                              │
                              ▼
+-------------------------------------------------------------+
| 5. Storage Layer (Pebble LSM-Tree Storage Engine)           |
|    - High-performance Go-native Log-Structured Merge-tree   |
|    - Writes data to persistent disk volumes                 |
+-------------------------------------------------------------+
```

---

## 3. Data Distribution & Range Partitioning

In CockroachDB:
- All relational tables, indexes, and system data are encoded into a single, global, sorted Key-Value keyspace.
- The global keyspace is divided into contiguous chunks known as **Ranges** (default target size: 64MB).
- In our project, table `distributed_store.products` is mapped to ranges:
  - `start_key`: `/Table/products/Min`
  - `end_key`: `/Table/products/Max`
- Every range has a **Replication Factor of 3** (configured via `ALTER TABLE products CONFIGURE ZONE USING num_replicas = 3`).
- Replicas are distributed across Node 1, Node 2, and Node 3.

```
Table: products
Key Space: [/Table/products/Min --------------> /Table/products/Max]
                           │
                           ▼
                 +-------------------+
                 |      Range 1      |
                 +-------------------+
                 | Replica 1: Node 1 |
                 | Replica 2: Node 2 |
                 | Replica 3: Node 3 |
                 +-------------------+
```

---

## 4. Multi-Raft Consensus Protocol & Quorum

Traditional consensus systems (like standard Raft or Paxos) operate a single leader for the entire system, creating a scalability bottleneck. CockroachDB solves this with **Multi-Raft**:
- Each 64MB Range has its own independent Raft group.
- For Range 1:
  - **Node 1** may be the **Raft Leader** and **Leaseholder**.
  - **Node 2** is a **Raft Follower**.
  - **Node 3** is a **Raft Follower**.
- When another range is created, Node 2 or Node 3 can be its Raft Leader!

### Write Flow (Quorum Consensus):
1. **Client** issues `INSERT INTO products ...` to **Node 2** (Gateway Node).
2. Node 2 routes the write operation to the **Leaseholder** of Range 1 (e.g. Node 1).
3. The Raft Leader (Node 1) writes the log entry to its local Raft log and broadcasts `AppendEntries` RPC to Node 2 and Node 3.
4. Once at least **2 out of 3 nodes** (Leader + 1 Follower = Majority Quorum $\lfloor 3/2 \rfloor + 1 = 2$) acknowledge writing the log entry:
   - The write is **Committed**.
   - The Raft Leader applies the change to its Pebble KV store.
   - The transaction returns `SUCCESS` to the client.

### Read Flow (Range Leases):
1. **Client** issues `SELECT * FROM products` to **Node 3**.
2. Node 3 checks range metadata and forwards read to the **Leaseholder** (Node 1).
3. Because the Leaseholder holds an active time-based lease and is guaranteed to have the latest committed Raft state, it serves the read **immediately from local storage** without requiring a network consensus vote!
4. Guarantees **Strict Serializability** with optimal low-latency read performance.

---

## 5. Fault Tolerance & Quorum Arithmetic

The mathematical fault tolerance of Raft consensus is defined as:
$$\text{Tolerated Failures } f = \left\lfloor \frac{n - 1}{2} \right\rfloor$$
Where $n$ is the total number of replica nodes.

For our 3-node cluster ($n = 3$):
$$f = \left\lfloor \frac{3 - 1}{2} \right\rfloor = 1$$
$$\text{Quorum Size } Q = \left\lfloor \frac{n}{2} \right\rfloor + 1 = \left\lfloor \frac{3}{2} \right\rfloor + 1 = 2$$

| Scenario | Active Nodes | Surviving Replicas | Quorum Status | Cluster Operation |
|---|---|---|---|---|
| **Normal** | Node 1, 2, 3 | 3 of 3 | Satisfied ($3 \ge 2$) | Fully operational, 100% throughput |
| **Node 1 Down** | Node 2, 3 | 2 of 3 | Satisfied ($2 \ge 2$) | Fully operational, reads/writes succeed |
| **Node 1 Restored**| Node 1, 2, 3 | 3 of 3 | Satisfied ($3 \ge 2$) | Node 1 catches up Raft logs, 100% restored |
| **2 Nodes Down** | Node 3 only | 1 of 3 | Broken ($1 < 2$) | Reads/writes paused to prevent split-brain |
