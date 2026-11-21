# Step-by-Step Testing & Demonstration Walkthrough
## Three-Node Replicated Distributed SQL Database

This guide walks you through the exact steps to demonstrate the CockroachDB distributed database cluster, show real-time replication, execute CRUD operations across specific nodes, and test fault tolerance.

---

## Prerequisites Check

Ensure you have the following installed on your machine:
1. **Docker Desktop** (running with WSL2 or Hyper-V backend)
2. **Node.js** (v18+ or v24+)

---

## Step 1: Start the CockroachDB 3-Node Cluster

Open your terminal in `D:\DBMS PROJECT` and execute:

```powershell
docker compose up -d
```

### Expected Output:
```
[+] Running 5/5
 ✔ Network dbms-project_roachnet   Created
 ✔ Volume "roach1_data"             Created
 ✔ Volume "roach2_data"             Created
 ✔ Volume "roach3_data"             Created
 ✔ Container roach1                 Started
 ✔ Container roach2                 Started
 ✔ Container roach3                 Started
 ✔ Container roach-init             Started
```

### Verify Container Status:
```powershell
docker compose ps
```
All three containers (`roach1`, `roach2`, `roach3`) should display status **Up**.

---

## Step 2: Initialize Database and Tables

Run the automated database schema setup script or let the Node.js server initialize it on startup:

```powershell
docker exec -i roach1 ./cockroach sql --insecure < init-cluster.sql
```

### Expected Output:
```
CREATE DATABASE
CONFIGURE ZONE 1
USE
CREATE TABLE
CONFIGURE ZONE 1
INSERT 0 5
```

---

## Step 3: Start the Full-Stack Dashboard Backend

In your terminal in `D:\DBMS PROJECT`:

```powershell
npm start
```

### Expected Output:
```
================================================================
 CockroachDB Distributed SQL System Server Running on Port 3000
 Web Dashboard: http://localhost:3000
 Node 1 SQL: localhost:26257 | Web UI: http://localhost:8080
 Node 2 SQL: localhost:26258 | Web UI: http://localhost:8081
 Node 3 SQL: localhost:26259 | Web UI: http://localhost:8082
================================================================
 Connected to cluster gateway via Node 1 (Port 26257)
 Distributed Database, Products Table & Replication Zones Verified (Replication Factor = 3)
```

---

## Step 4: Open the Monitoring Dashboard

Open your web browser and navigate to:
👉 **[http://localhost:3000](http://localhost:3000)**

Also, you can open CockroachDB's native Admin UI in another tab:
- **Node 1 Console:** [http://localhost:8080](http://localhost:8080)
- **Node 2 Console:** [http://localhost:8081](http://localhost:8081)
- **Node 3 Console:** [http://localhost:8082](http://localhost:8082)

---

## Step 5: Demonstration Scenarios

### Demo 1: Multi-Node Consistency Test
1. On the dashboard, locate the button: **`Test Multi-Node Consistency`**.
2. Click it.
3. Observe the live log:
   - System writes a record (`TEST-XXXXXX`) to **Node 1** (Port 26257).
   - System immediately queries **Node 2** (Port 26258) for that record.
   - System immediately queries **Node 3** (Port 26259) for that record.
   - All three match with 100% precision.
4. **Conclusion for Evaluator:** Demonstrates that data is replicated synchronously via Raft consensus across all 3 nodes before the write is committed.

---

### Demo 2: Targeted Node CRUD Operations
1. Use the dropdown **"Execute Query Via:"** to select:
   - `Direct Node 1 (Port 26257)`
   - `Direct Node 2 (Port 26258)`
   - `Direct Node 3 (Port 26259)`
2. Click **`+ Add Product`**, fill in SKU, Name, Category, Price, and Stock, and click **Commit Product**.
3. Notice the execution banner:
   `Query handled by Node X (Port 2625X) in Y ms.`
4. Now switch the dropdown to a different node (e.g. Node 3) and search for the newly created product.
5. Notice that Node 3 immediately serves the exact product you just added on Node 1!

---

### Demo 3: Live Replication & Raft Range Inspection
1. Click on the tab: **`Data Replication & Raft Ranges`**.
2. Examine the live table populated directly from `SHOW RANGES FROM TABLE products;`:
   - **Range ID**: ID of the active 64MB range.
   - **Replicas**: Shows `[1, 2, 3]` — confirming all 3 physical nodes hold a replica.
   - **Leaseholder**: Displays which node currently holds the range lease to serve fast reads.
   - **Zone Configuration**: Confirms `num_replicas = 3`.

---

### Demo 4: Fault Tolerance & Node Failure Recovery
1. Click on the tab: **`Fault Tolerance & Recovery`**.
2. Open a separate terminal window and simulate Node 1 crashing:
   ```powershell
   docker compose stop roach1
   ```
3. Watch the dashboard:
   - Within 5 seconds, **Node 1** card changes to **DOWN (Red)**.
   - Cluster status changes to **Degraded (2/3 Nodes)**.
   - Quorum badge displays **Quorum: Operational (2 Live >= 2 Required)**.
4. Click **`Test Write on Surviving Nodes`**:
   - The write succeeds! Surviving Node 2 or Node 3 accepts the write and commits it to the majority quorum ($2 \ge 2$).
5. Now restart Node 1 in your terminal:
   ```powershell
   docker compose start roach1
   ```
6. Click **`Verify Node 1 Recovery`**:
   - Node 1 turns **ONLINE (Green)**.
   - Cluster status returns to **HEALTHY (3/3 Nodes)**.
   - Data inserted while Node 1 was dead is verified to be replicated to Node 1!

---

### Demo 5: Distributed SQL (DistSQL) Query Plan
1. Click on the tab: **`Distributed SQL & Transactions`**.
2. Click **`Execute EXPLAIN (DISTSQL)`**.
3. View the distributed physical query plan:
   - Shows parallel `TableReader` operators on storage nodes.
   - Shows distributed grouping and aggregation.
   - Demonstrates that query processing is pushed to data nodes rather than bottlenecked on one node.

---

### Demo 6: Distributed ACID Transaction (Stock Transfer)
1. In the **`Distributed SQL & Transactions`** tab:
2. Select a **Source Product** (e.g. Dell XPS 15).
3. Select a **Destination Product** (e.g. Google Pixel 8).
4. Enter **Quantity: 5**.
5. Click **`Execute Distributed Transaction`**.
6. Observe:
   - Deducts 5 from Source and Adds 5 to Destination inside a single `BEGIN ... COMMIT` block.
   - Executed under **SERIALIZABLE** isolation.
   - Both rows are atomically updated across their respective Raft ranges.

---

## Step 6: Manual SQL CLI Commands (Optional for Viva)

If your teacher or examiner asks to see the database via command line:

```powershell
# Connect to Node 1 SQL prompt
docker exec -it roach1 ./cockroach sql --insecure

# Run any of the following queries:
SHOW DATABASES;
USE distributed_store;
SHOW TABLES;
SELECT * FROM products;
SHOW RANGES FROM TABLE products;
SHOW ZONE CONFIGURATION FOR TABLE products;
SELECT node_id, address, is_live FROM crdb_internal.kv_node_status;
\q
```
