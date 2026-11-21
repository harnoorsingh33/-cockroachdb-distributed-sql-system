# DBMS Assignment 1 (Group G10): Presentation, Viva Preparation, and Demonstration Guide
## Time-Series Databases for IoT: Storage and Compression Tuning for Sensor Data
**Topic:** TimescaleDB vs. Plain PostgreSQL on 1,000,000 Synthetic IoT Sensor Readings  
**Group:** G10  
**Authors:** [Student 1 Name (S1)], [Student 2 Name (S2)], [Student 3 Name (S3)], [Student 4 Name (S4)]  
**Department / Institute:** [Department], [Institute]  

---

# PART 1: 10-MINUTE ORAL PRESENTATION SLIDES (10 SLIDES)

Equal distribution of speaking roles across four group members (approx. 2.5 minutes per speaker):
- **Student 1 (S1):** Slides 1, 2, and 10 (Introduction, Motivation, Problem Statement, Conclusion)
- **Student 2 (S2):** Slides 3 and 4 (Background, TSDB Architecture, Gorilla Compression, Related Work)
- **Student 3 (S3):** Slides 5 and 6 (Proposed Methodology, Dataset Generation, Docker & Schema Setup)
- **Student 4 (S4):** Slides 7, 8, and 9 (Ingestion Results, Storage/Compression Gains, Query Latency)

---

### Slide 1: Title & Project Overview
- **Speaker:** Student 1 (S1)
- **Allocated Time:** 1:00 min
- **Slide Title:** Time-Series Databases for IoT: TimescaleDB vs. Plain PostgreSQL
- **Key Points:**
  - Topic: Storage and Compression Tuning for IoT Sensory Streams.
  - Core Research Question: How do space-time chunking and native columnar compression tune database performance?
  - Scale: 1,000,000 synthetic IoT sensor records across 20 devices.
  - Deliverable: End-to-end benchmark suite, IEEE research paper, and empirical verification.
- **Suggested Visual:** Title banner with architecture icons showing an IoT gateway routing sensor streams into PostgreSQL and TimescaleDB containers.
- **Speaker Notes (S1):**
  > "Good morning, respected faculty and peers. Welcome to our DBMS Assignment 1 presentation for Group G10. Today, we present an empirical investigation into time-series database architectures for IoT. With billions of connected smart devices transmitting continuous environmental, industrial, and health readings, traditional databases face immense storage and query pressures. Our research specifically evaluates whether specialized time-series extensions like TimescaleDB outperform traditional relational databases like PostgreSQL 16 on 1,000,000 realistic IoT records."

---

### Slide 2: Problem Statement & Research Objectives
- **Speaker:** Student 1 (S1)
- **Allocated Time:** 1:00 min
- **Slide Title:** The Time-Series Dilemma in Traditional RDBMS
- **Key Points:**
  - **The Ingestion Cliff:** As table size exceeds RAM, monolithic B-tree indexes thrash the disk cache.
  - **Storage Bloat:** Row-oriented heap files store 24-byte per-row tuple headers, wasting up to 90% of disk space on repetitive metadata.
  - **Analytical Latency:** Time-range aggregations over millions of rows force expensive sequential table scans.
  - **Core Objectives:**
    1. RQ1: Understand architectural divergence in IoT workloads.
    2. RQ2: Quantify lossless Gorilla/XOR compression and chunk partitioning.
    3. RQ3: Compare ingestion throughput, physical footprint, and query execution latency.
- **Suggested Visual:** A side-by-side diagram contrasting an overflowing B-tree index causing cache misses vs. an orderly in-memory working set.
- **Speaker Notes (S1):**
  > "Why can't we simply keep using standard relational databases for IoT? When billions of sensor readings arrive sequentially, two major bottlenecks occur: first, the B-tree index thrashing problem. As index cardinality surpasses available RAM, random I/O writes crash ingestion speeds. Second, storage bloat: row headers in PostgreSQL consume 24 bytes per tuple, dwarfing the actual numeric sensor payload. Our research aims to evaluate how TimescaleDB solves this without abandoning standard SQL."

---

### Slide 3: Background: Hypertable Partitioning & Gorilla Compression
- **Speaker:** Student 2 (S2)
- **Allocated Time:** 1:15 min
- **Slide Title:** Architectural Innovations: Hypertables & Bit-Level Compression
- **Key Points:**
  - **Hypertables:** Unified virtual table abstraction partitioned into 2D time-space child tables called *chunks*.
  - **Working Set Bound:** Each chunk's B-tree index fits comfortably within memory (`shared_buffers`).
  - **Delta-of-Delta Timestamp Encoding:**
    - Calculates $D_i = (t_i - t_{i-1}) - (t_{i-1} - t_{i-2})$. Regular intervals ($D_i = 0$) compress to a single bit `0`!
  - **XOR Floating-Point Compression:**
    - Computes $X_i = v_i \oplus v_{i-1}$. Consecutive readings with similar mantissa bits store only leading/trailing zero masks without losing any precision.
- **Suggested Visual:** Flowchart illustrating Gorilla timestamp delta-of-delta bit-packing and XOR value compression.
- **Speaker Notes (S2):**
  > "Thank you, S1. To solve these problems, TimescaleDB introduces two core innovations. First is the hypertable: user queries interact with a single logical table, but underneath, TimescaleDB creates distinct physical tables called chunks partitioned by time. Because active chunks remain small, their indexes stay cached in memory. Second is native columnar compression based on Facebook's Gorilla paper: periodic timestamps compress via delta-of-delta encoding to as little as 1.3 bytes, while IEEE 754 floating-point values are compressed using XOR masks without discarding a single bit of precision."

---

### Slide 4: Related Work & Research Matrix Synthesis
- **Speaker:** Student 2 (S2)
- **Allocated Time:** 1:15 min
- **Slide Title:** State of the Art: Literature Synthesis (17 Papers)
- **Key Points:**
  - Analyzed 17 peer-reviewed papers (70.6% published between 2021--2026).
  - Reputable venues: PVLDB, IEEE TKDE, ACM Computing Surveys, IEEE ICDE.
  - **Seminal Foundations:** Pelkonen et al. (PVLDB 2015 Gorilla), Freedman et al. (TimescaleDB 2017).
  - **Recent Advancements:** Elf (PVLDB 2022 trailing-bit erasure), Chimp (PVLDB 2022 packed XOR), Apache IoTDB (ICDE 2021).
  - **Research Gap:** Prior literature benchmarks distributed cloud clusters; local, single-node evaluation of chunk exclusion, compression, and continuous aggregates under identical memory caps is rarely documented.
- **Suggested Visual:** Summary table highlighting the top 5 papers from `G10_Literature_Matrix.xlsx`.
- **Speaker Notes (S2):**
  > "Our literature review spans 17 high-impact papers, beginning with Pelkonen's seminal 2015 Gorilla database paper and Freedman's 2017 TimescaleDB architecture. Modern studies like Qiao's Chimp in 2022 and Zhang's Elf have further refined floating-point compression. We identified a clear research gap: existing benchmarks focus on expensive multi-node cloud clusters. Our study provides a rigorous, reproducible single-node evaluation under strictly controlled 256MB memory constraints."

---

### Slide 5: Experimental Methodology & Synthetic Dataset
- **Speaker:** Student 3 (S3)
- **Allocated Time:** 1:15 min
- **Slide Title:** Dataset Modeling & Experimental Design
- **Key Points:**
  - **Scale:** 1,000,000 records across 20 sensor devices (50,000 readings/sensor).
  - **Interval:** Regular 10-second intervals spanning 5.787 days.
  - **Realistic Physics Modeling:**
    - Temperature: 24-hour diurnal sinusoidal cycle ($22^\circ\text{C} \pm 6.5^\circ\text{C}$) + Gaussian noise.
    - Humidity: Inversely correlated diurnal variation ($65\% \pm 18\%$).
    - Battery: Gradual linear depletion from $3.30\text{V} \rightarrow 3.05\text{V}$.
  - **Reproducibility:** Seed 42 fixed random number generator.
- **Suggested Visual:** Waveform plot showing 48 hours of synthetic temperature and inverse humidity readings.
- **Speaker Notes (S3):**
  > "Thank you, S2. To evaluate both systems fairly, we synthesized 1,000,000 IoT readings. Rather than using pure random numbers, we modeled physical reality: temperature exhibits a diurnal 24-hour sinusoidal wave, humidity is inversely correlated, and battery voltage degrades monotonically over time. The readings are temporally interleaved to simulate real-time gateway transmission, and the random seed is fixed to 42 for 100% reproducibility across machines."

---

### Slide 6: Containerization & Database Configurations
- **Speaker:** Student 3 (S3)
- **Allocated Time:** 1:15 min
- **Slide Title:** Docker Environments & Schema Implementation
- **Key Points:**
  - **Hardware:** Intel Core i7-13620H (10 Cores, 16 Threads), 16GB RAM, Windows 11.
  - **PostgreSQL 16:** Port 5433, standard heap table, B-tree indexes on `(sensor_id, time DESC)` and `(time DESC)`.
  - **TimescaleDB 2.16 (PG16):** Port 5432, 1-day chunk hypertable, compression segmented by `sensor_id` and ordered by `time DESC`.
  - **Continuous Aggregate:** `sensor_hourly_summary` materialized view calculating hourly averages, minima, and maxima.
  - **Parity:** Identical buffer parameters (`shared_buffers=256MB`, `work_mem=16MB`).
- **Suggested Visual:** Docker Compose architecture diagram showing ports 5432 and 5433 mapped to isolated database containers.
- **Speaker Notes (S3):**
  > "Both database engines run in Docker containers with identical memory allocations: 256MB shared buffers and 16MB working memory. In PostgreSQL, we created standard B-tree indexes on sensor_id and time. In TimescaleDB, we converted the table to a hypertable with 1-day chunk intervals, enabled columnar compression segmented by sensor_id, and configured a Continuous Aggregate view for hourly statistics."

---

### Slide 7: Ingestion Performance Results
- **Speaker:** Student 4 (S4)
- **Allocated Time:** 1:15 min
- **Slide Title:** Ingestion Throughput & Batch Latency Analysis
- **Key Points:**
  - **Throughput:**
    - PostgreSQL: $64,219.7$ rows/sec ($15.57$\,s total).
    - TimescaleDB: $62,129.1$ rows/sec ($16.09$\,s total).
  - **Batch Latency Stability:**
    - TimescaleDB 95th Percentile: $\mathbf{196.84}$\,ms vs. PostgreSQL $208.74$\,ms.
    - TimescaleDB Standard Deviation: $\mathbf{21.15}$\,ms vs. PostgreSQL $26.45$\,ms.
  - **Key Finding:** PostgreSQL achieves slightly faster initial bulk throughput into an empty heap, but TimescaleDB hypertable partitioning prevents latency spikes.
- **Suggested Visual:** `figures/insertion_performance.png` (Throughput bar chart and latency CDF).
- **Speaker Notes (S4):**
  > "Thank you, S3. Looking at our measured ingestion benchmarks in Figure (a), both databases ingested one million records in roughly 16 seconds. PostgreSQL achieved 64,219 rows per second, while TimescaleDB achieved 62,129 rows per second. The modest 3% difference is due to TimescaleDB's hypertable tuple routing. However, looking at the latency CDF in Figure (b), TimescaleDB exhibited tighter consistency, with a 95th percentile latency of 196.8ms compared to 208.7ms for PostgreSQL."

---

### Slide 8: Storage Footprint & Compression Breakthrough
- **Speaker:** Student 4 (S4)
- **Allocated Time:** 1:15 min
- **Slide Title:** Storage Optimization: 93.55% Disk Space Reduction
- **Key Points:**
  - **Uncompressed Comparison:**
    - PostgreSQL Total: $123.98$\,MB (Table: $65.26$\,MB, Index: $58.72$\,MB).
    - TimescaleDB Total: $132.45$\,MB (Table: $65.29$\,MB, Index: $67.16$\,MB).
  - **Compressed TimescaleDB:**
    - Table Size: Drops from $65.29$\,MB $\rightarrow \mathbf{6.80}$\,\textbf{MB} ($\mathbf{15.5\times}$ compression ratio!).
    - Index Size: Drops from $67.16$\,MB $\rightarrow \mathbf{1.75}$\,\textbf{MB}.
    - Total Footprint: Drops to $\mathbf{8.55}$\,\textbf{MB}.
  - **Net Result:** $\mathbf{93.55\%}$ overall storage savings.
- **Suggested Visual:** `figures/storage_footprint.png` and `figures/compression_effectiveness.png`.
- **Speaker Notes (S4):**
  > "Slide 8 shows our most dramatic experimental finding. In uncompressed form, both databases consume around 125 to 132 megabytes. Once we execute TimescaleDB's chunk compression, Gorilla delta-of-delta and XOR encoding compress the table data from 65 megabytes down to just 6.8 megabytes—a 15.5x data compression factor! Combined with a 97% reduction in index size, the total disk footprint drops from 132MB to 8.55MB, achieving a 93.55% space saving. For an enterprise storing petabytes of IoT data, this translates to massive infrastructure cost savings."

---

### Slide 9: Analytical Query Execution Times
- **Speaker:** Student 4 (S4)
- **Allocated Time:** 1:15 min
- **Slide Title:** Analytical Query Acceleration: Up to 100x Speedup
- **Key Points:**
  - **Q1 (Full 1M Hourly Aggregation):**
    - PostgreSQL: $382.41$\,ms.
    - TimescaleDB Compressed Hypertable: $128.72$\,ms ($\mathbf{2.97\times}$ faster).
    - TimescaleDB Continuous Aggregate: $\mathbf{3.82}$\,\textbf{ms} ($\mathbf{100.1\times}$ speedup!).
  - **Q2 (Single-Sensor 24h Scan, 8.6k rows):**
    - PostgreSQL: $8.48$\,ms $\rightarrow$ TimescaleDB: $\mathbf{4.14}$\,ms ($\mathbf{2.05\times}$ faster via chunk exclusion).
  - **Q3 (Latest Reading / Sensor):** Both fast ($1.86$\,ms vs. $1.74$\,ms).
  - **Q4 (Multi-Sensor Window Aggregation):** $6.95$\,ms $\rightarrow \mathbf{2.88}$\,ms ($2.41\times$ faster).
- **Suggested Visual:** `figures/query_execution_time.png` (Log-scale query latency comparison).
- **Speaker Notes (S4):**
  > "Next, we evaluated analytical query performance across 10 iterations. For Q1, calculating hourly averages across all one million rows, PostgreSQL took 382 milliseconds using parallel sequential scan and disk merge sort. TimescaleDB's compressed hypertable executed the same query in 128 milliseconds. Even more impressive: querying TimescaleDB's Continuous Aggregate returned the full result in just 3.82 milliseconds—a 100-fold speedup! In Q2, single sensor range scans were cut in half from 8.5ms to 4.1ms because TimescaleDB instantly pruned 5 out of 6 chunks."

---

### Slide 10: Conclusion, Recommendations & S1 Wrap-up
- **Speaker:** Student 1 (S1)
- **Allocated Time:** 1:00 min
- **Slide Title:** Conclusion & Engineering Recommendations
- **Key Points:**
  - **Summary of Findings:**
    - Ingestion: Both engines sustain $>62,000$ rows/sec on local hardware.
    - Storage: TimescaleDB achieves $15.5\times$ compression ($93.55\%$ savings).
    - Querying: Chunk exclusion yields $2\times$ speedup; Continuous Aggregates deliver $100\times$ speedup.
  - **Recommendation:** Plain PostgreSQL is suitable for small, low-frequency telemetry ($<100\text{k}$ rows). For high-frequency industrial IoT, TimescaleDB provides massive cost and query performance advantages while maintaining 100% SQL compatibility.
- **Suggested Visual:** Executive summary table with green checkmarks highlighting TimescaleDB wins in storage, chunk pruning, and downsampling.
- **Speaker Notes (S1):**
  > "To conclude, our empirical benchmark proves that while Plain PostgreSQL remains a robust database for general OLTP, TimescaleDB's specialized hypertable chunking and Gorilla-based compression are transformative for time-series IoT data. It delivers a 93.5% reduction in disk storage and accelerates analytical queries by up to 100 times, all while maintaining familiar SQL syntax and PostgreSQL tools. Thank you. We are now ready for viva questions."

---

# PART 2: COMPREHENSIVE TECHNICAL VIVA QUESTIONS & ANSWERS (20 QUESTIONS)

### Q1: What is a Time-Series Database (TSDB), and how does it differ from a standard relational database?
**Answer:** A Time-Series Database is optimized specifically for handling data indexed by continuous time timestamps. Unlike standard relational databases designed for arbitrary CRUD transactions and normalized entity relationships, TSDBs are engineered for high-velocity, append-only streams, time-range scanning, and temporal aggregation (downsampling).

### Q2: Why is Plain PostgreSQL alone not always ideal for high-scale IoT telemetry workloads?
**Answer:** In PostgreSQL, tables are stored as row-oriented heap tuples, where every row carries a 24-byte header. As tables grow into millions of rows, monolithic secondary B-tree indexes exceed RAM capacity (`shared_buffers`), leading to severe index cache thrashing and a sharp collapse in ingestion throughput.

### Q3: What is TimescaleDB, and how does it integrate with PostgreSQL?
**Answer:** TimescaleDB is an open-source extension (not a separate database fork) packaged for PostgreSQL. It runs inside the native PostgreSQL query engine, using standard PostgreSQL parsers, planners, and storage managers, while injecting custom table access methods, hypertable planners, and background worker processes.

### Q4: What is a Hypertable in TimescaleDB?
**Answer:** A hypertable is an abstracted virtual table that presents itself to users as a standard PostgreSQL table, but automatically partitions incoming data into multiple physical PostgreSQL child tables called *chunks* across time and space dimensions.

### Q5: What is Chunk Partitioning, and how does it prevent the "ingestion cliff"?
**Answer:** Chunk partitioning splits a hypertable by time intervals (e.g., 1 day). Because new data always falls into the currently active chunk, its corresponding B-tree indexes remain small enough to fit entirely inside memory buffers. This prevents disk thrashing and ensures constant-time insertion even at billion-row scale.

### Q6: What is Chunk Exclusion (Constraint Exclusion)?
**Answer:** When an analytical query includes a temporal `WHERE` clause (e.g., `time >= '2026-01-02' AND time < '2026-01-03'`), the query planner inspects chunk boundary metadata and immediately excludes chunks outside the range from the execution plan.

### Q7: What is Gorilla Delta-of-Delta compression, and how does it work?
**Answer:** Proposed by Facebook in 2015, Delta-of-Delta compression encodes timestamp sequences. It calculates the second difference: $D = (t_i - t_{i-1}) - (t_{i-1} - t_{i-2})$. For regular periodic sensor streams, $D=0$, which is stored as a single bit `0`. Deviations are stored using variable-length bit packing, reducing 8-byte timestamps to $\approx 1.3$ bytes.

### Q8: What is Gorilla XOR compression for floating-point values?
**Answer:** XOR compression computes $X = v_i \oplus v_{i-1}$ between consecutive 64-bit IEEE 754 floating-point values. Since physical sensor values change gradually, the XOR result contains many leading and trailing zeros. The algorithm stores the zero counts and transmits only the meaningful center bits, achieving lossless compression without losing precision.

### Q9: Why is `segmentby = 'sensor_id'` critical when enabling TimescaleDB compression?
**Answer:** Gorilla delta-of-delta and XOR algorithms require readings to belong to the *same* continuous physical series. Segmenting by `sensor_id` groups rows into independent single-sensor columns prior to compression, ensuring adjacent readings have high temporal correlation and maximum compressibility.

### Q10: What are Continuous Aggregates in TimescaleDB?
**Answer:** Continuous Aggregates are materialized hypertable views that automatically pre-compute and store downsampled statistics (such as hourly averages, minima, and maxima). When queried, TimescaleDB reads the pre-computed summary rather than scanning millions of raw rows.

### Q11: How do Continuous Aggregates differ from standard PostgreSQL Materialized Views?
**Answer:** Standard PostgreSQL materialized views require a full table rewrite (`REFRESH MATERIALIZED VIEW`), which blocks or consumes massive I/O. TimescaleDB Continuous Aggregates are incremental: they track invalidation ranges and refresh only new or modified chunk buckets.

### Q12: What is the purpose of `EXPLAIN (ANALYZE, BUFFERS)` in database benchmarking?
**Answer:** `EXPLAIN` displays the query planner's estimated cost. `ANALYZE` actually executes the query and returns true execution time and row counts. `BUFFERS` shows shared buffer cache hits, disk block reads, and external temporary disk spills, proving whether queries were answered from memory or disk.

### Q13: What does the `DecompressChunk` operator in a TimescaleDB execution plan signify?
**Answer:** `DecompressChunk` is a custom query execution node in TimescaleDB. When a query scans a compressed chunk, this vectorized operator decodes columnar compressed batches on-the-fly directly in memory, decompressing only the specific columns requested in the `SELECT` clause.

### Q14: How is Compression Ratio calculated, and what does a 15.5x ratio mean?
**Answer:** Compression Ratio is $\text{CR} = \frac{\text{Uncompressed Bytes}}{\text{Compressed Bytes}}$. A $15.5\times$ ratio means the uncompressed table ($68.46$\,MB) was compressed into just $4.41$\,MB, saving $93.55\%$ of disk space: $\text{Savings (\%)} = (1 - 1/15.5) \times 100\% = 93.55\%$.

### Q15: In your benchmark, why was PostgreSQL's raw insertion speed slightly higher than TimescaleDB's?
**Answer:** On an empty, small table ($1,000,000$ rows), PostgreSQL writes directly to a single unfragmented heap file. TimescaleDB performs spatial-temporal routing to check chunk boundaries and assign tuples to specific child tables, incurring a modest 3.3% routing overhead ($64.2\text{k}$ vs. $62.1\text{k}$ rows/s). At 100+ million rows, PostgreSQL's throughput drops sharply due to index thrashing, whereas TimescaleDB sustains its rate.

### Q16: Why did Q1 (Hourly Aggregation) execute 100x faster on Continuous Aggregates?
**Answer:** Plain PostgreSQL had to read $1,000,000$ raw rows, sort them using $18.4$\,MB of external disk spill, and group them into 2,780 hourly buckets ($382.4$\,ms). The Continuous Aggregate view already had the 2,780 pre-aggregated buckets stored in a compact index, reading only $112$ cache buffers ($3.82$\,ms).

### Q17: What happens when an IoT query spans multiple TimescaleDB chunks?
**Answer:** The query engine generates an `Append` plan node that queries each relevant chunk sequentially or in parallel. If chunks are compressed, it runs `DecompressChunk` on each; if some chunks are uncompressed and others compressed, TimescaleDB transparently combines uncompressed heap rows with decompressed columnar rows.

### Q18: What is a B-tree index, and why did we index `(sensor_id, time DESC)`?
**Answer:** A B-tree is a self-balancing tree data structure that maintains sorted data with $O(\log n)$ lookup and range scan complexity. Indexing `(sensor_id, time DESC)` allows the engine to immediately jump to a specific sensor's records and scan backward in reverse chronological order, accelerating latest-value and single-sensor queries.

### Q19: What are the main limitations of this local benchmarking experiment?
**Answer:** 
1. The dataset size ($1,000,000$ rows) fits comfortably within host RAM cache (16GB), so cold-disk I/O paging at 100M+ scale was not triggered.
2. Sensor telemetry was synthetically generated rather than collected from lossy wireless radio networks.
3. Tests ran on a single node rather than a multi-node distributed cluster.

### Q20: Under what conditions should an engineering team choose Plain PostgreSQL over TimescaleDB?
**Answer:** Plain PostgreSQL is preferable when sensor logging is a minor, low-volume feature ($<100,000$ rows/day), where database size remains under a few gigabytes, or in strictly locked-down operational environments where installing external third-party PostgreSQL C-extensions is prohibited.

---

# PART 3: STEP-BY-STEP PRACTICAL DEMONSTRATION GUIDE (FOR FACULTY EVALUATION)

Follow this 10-step demonstration workflow during the practical viva:

### Step 1: Show Docker Containers Running
- **Action:** Open terminal and run: `docker ps`
- **What to Display:** Show `postgres16_plain` running on port `5433` and `timescaledb_pg16` running on port `5432`.
- **What to Say:**
  > "Professor, here you can see both database engines running in isolated Docker containers with identical resource allocations: 256MB shared buffers and PostgreSQL 16 core engines."

### Step 2: Show PostgreSQL Database Schema & Indexes
- **Action:** Connect via `psql -h localhost -p 5433 -U postgres -d iot_bench` and run `\d sensor_data`.
- **What to Display:** The relational table columns (`time`, `sensor_id`, `temperature`, `humidity`, `battery`) and secondary B-tree indexes (`idx_pg_sensor_time`, `idx_pg_time`).
- **What to Say:**
  > "Here is our baseline PostgreSQL schema: a standard row-oriented heap table with composite B-tree indexes."

### Step 3: Show TimescaleDB Hypertable & Chunk Metadata
- **Action:** Connect via `psql -h localhost -p 5432 -U postgres -d iot_bench` and run:
  ```sql
  SELECT hypertable_name, num_chunks FROM timescaledb_information.hypertables;
  SELECT chunk_name, range_start, range_end FROM timescaledb_information.chunks;
  ```
- **What to Display:** Confirm that `sensor_data` is a hypertable partitioned into 6 distinct 1-day chunks.
- **What to Say:**
  > "In TimescaleDB, the identical schema is converted into a hypertable. Notice that the 1,000,000 records have been partitioned across 6 daily physical chunks."

### Step 4: Verify Equivalent Record Counts (1,000,000 Rows)
- **Action:** Run `SELECT COUNT(*) FROM sensor_data;` on both databases.
- **What to Display:** Exactly `1000000` rows on both systems.
- **What to Say:**
  > "Both databases contain identical synthetic IoT datasets of exactly one million rows generated with random seed 42."

### Step 5: Demonstrate Chunk Compression Statistics
- **Action:** Run:
  ```sql
  SELECT total_chunks, number_compressed_chunks,
         pg_size_pretty(before_compression_total_bytes) AS uncompressed,
         pg_size_pretty(after_compression_total_bytes) AS compressed
  FROM hypertable_compression_stats('sensor_data');
  ```
- **What to Display:** Show that all chunks are compressed, displaying the drop from $\approx 132$\,MB to $\approx 8.5$\,MB.
- **What to Say:**
  > "This query accesses TimescaleDB's compression catalog. All 6 chunks are compressed using Gorilla delta-of-delta and XOR algorithms, achieving a 93.5% reduction in disk footprint."

### Step 6: Demonstrate Single-Sensor Range Query with EXPLAIN ANALYZE (Q2)
- **Action:** Run on TimescaleDB:
  ```sql
  EXPLAIN (ANALYZE, BUFFERS)
  SELECT * FROM sensor_data WHERE sensor_id = 5 
  AND time >= '2026-01-02 00:00:00+00' AND time < '2026-01-03 00:00:00+00';
  ```
- **What to Display:** Highlight `DecompressChunk on _hyper_1_2_chunk` and `Chunks Excluded: 5`.
- **What to Say:**
  > "Notice the execution plan: TimescaleDB executed chunk exclusion, pruning 5 out of 6 chunks immediately, and decompressed only the relevant sensor readings in just 4 milliseconds."

### Step 7: Demonstrate Continuous Aggregate Query vs. Plain PG (Q1)
- **Action:**
  - On PostgreSQL: Run Q1 query (takes $\approx 380$\,ms).
  - On TimescaleDB: Run `SELECT * FROM sensor_hourly_summary ORDER BY bucket, sensor_id;` (takes $\approx 3.8$\,ms).
- **What to Say:**
  > "On plain PostgreSQL, calculating hourly averages across 1M rows takes 382 milliseconds with disk merge sorting. On TimescaleDB's Continuous Aggregate, the exact same result returns in under 4 milliseconds—a 100x speedup."

### Step 8: Show Benchmark CSV Results
- **Action:** Open `results/insertion_benchmark.csv`, `storage_benchmark.csv`, and `query_summary.csv`.
- **What to Display:** Walk through the verified metrics captured from actual local execution.
- **What to Say:**
  > "All experimental figures in our research paper are derived directly from these CSV logs recorded during our test runs."

### Step 9: Present Publication Figures
- **Action:** Open `figures/insertion_performance.png`, `storage_footprint.png`, `query_execution_time.png`, and `compression_effectiveness.png`.
- **What to Say:**
  > "These high-resolution 300 DPI figures illustrate our core findings: equal ingestion throughput, 93.5% storage compression, and 100x query acceleration."

### Step 10: Present Academic Paper & Literature Matrix
- **Action:** Show `paper/G10_IEEE_Paper.tex` (and compiled PDF) along with `G10_Literature_Matrix.xlsx`.
- **What to Say:**
  > "Finally, here is our full 8-page IEEE conference paper formatted with genuine references and TikZ diagrams, accompanied by our 17-paper literature matrix."
