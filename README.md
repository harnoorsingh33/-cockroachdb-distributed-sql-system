# DBMS Assignment 1 (Group G10): Time-Series Databases for IoT
## Storage and Compression Tuning for Sensor Data: TimescaleDB vs. Plain PostgreSQL

**Academic Course:** Database Management Systems (DBMS)  
**Group:** G10  
**Research Focus:** Ingestion Throughput, Compression (Gorilla / Delta-of-Delta / XOR), and Query Latency on 1,000,000 IoT Sensor Readings.

---

## 1. Project Overview

Modern Internet of Things (IoT) ecosystems produce high-frequency, append-only streams of telemetry. While general-purpose Relational Database Management Systems (RDBMS) like PostgreSQL offer strong ACID guarantees and rich SQL querying, their row-oriented heap tuple architectures and monolithic B-tree indexes encounter significant memory and I/O bottlenecks as tables grow.

This benchmark project empirically compares **TimescaleDB** (an open-source time-series extension for PostgreSQL utilizing two-dimensional hypertable chunk partitioning, native columnar compression, and continuous aggregates) against **Standard PostgreSQL 16**.

### Key Workloads & Measurements
1. **Synthetic Dataset:** 1,000,000 readings across 20 sensors (50,000 readings/sensor at regular 10-second intervals) modeling diurnal temperature variations, inverse humidity, and battery degradation.
2. **Ingestion Benchmarking:** Bulk insertion throughput (rows/sec) and batch latency (ms) across 10,000-row batches.
3. **Storage Footprint:** Total disk footprint, table heap size, and index size before and after native TimescaleDB chunk compression.
4. **Analytical Querying:**
   - **Q1 (Full-Range Hourly Aggregation):** Comparing `date_trunc` vs. `time_bucket` vs. pre-computed **Continuous Aggregates**.
   - **Q2 (Single-Sensor 24h Scan):** Testing chunk-exclusion and B-tree index scans.
   - **Q3 (Latest Reading Per Sensor):** Testing `DISTINCT ON` scans across all sensors.
   - **Q4 (Multi-Sensor Window Aggregation):** Multi-predicate spatial-temporal filtering.

---

## 2. Directory Structure

```text
D:\DBMS PROJECT\
├── docker-compose.yml           # Multi-container definition for PG16 and TimescaleDB
├── start_containers.bat         # Automated container launcher script
├── requirements.txt             # Python dependencies (psycopg2-binary, pandas, matplotlib, openpyxl)
├── benchmark.py                 # End-to-end benchmark suite (data gen, ingestion, compression, queries)
├── plot_results.py              # Publication-ready figure generator (300 DPI)
├── generate_matrix.py           # Literature review matrix generator (Excel)
├── G10_Literature_Matrix.xlsx   # 17 peer-reviewed papers formatted spreadsheet
├── README.md                    # Project documentation and reproducibility guide
├── results/                     # Measured benchmark CSVs and EXPLAIN ANALYZE logs
│   ├── insertion_benchmark.csv
│   ├── batch_latencies.csv
│   ├── storage_benchmark.csv
│   ├── query_benchmark.csv
│   ├── query_summary.csv
│   ├── benchmark_metadata.json
│   ├── explain_analyze_pg.txt
│   └── explain_analyze_timescale.txt
├── figures/                     # Generated charts
│   ├── insertion_performance.png
│   ├── storage_footprint.png
│   ├── query_execution_time.png
│   └── compression_effectiveness.png
├── paper/                       # IEEE Research Paper
│   └── G10_IEEE_Paper.tex
└── presentation/                # Presentation slides and Viva preparation
    └── G10_Presentation_and_Viva.md
```

---

## 3. Prerequisites & Environment Setup

### Software Requirements
- **Operating System:** Windows 10/11, macOS, or Linux
- **Docker Desktop:** Version 20.10+ (Docker Compose v2+)
- **Python:** 3.9 to 3.14
- **LaTeX Distribution (Optional for compilation):** MiKTeX, TeX Live, or Overleaf

### Python Dependencies Installation
Install all required libraries via `pip`:
```bash
pip install -r requirements.txt
```

---

## 4. Step-by-Step Execution Guide

### Step 1: Start Database Containers
Ensure Docker Desktop is running, then execute:
```bash
# On Windows:
.\start_containers.bat

# Or using Docker Compose directly:
docker compose up -d
```
Verify both containers are running and healthy:
- **Plain PostgreSQL 16:** Port `5433` (`iot_bench`, user `postgres`, password `postgres`)
- **TimescaleDB (PG16):** Port `5432` (`iot_bench`, user `postgres`, password `postgres`)

### Step 2: Run End-to-End Benchmark
Execute the automated benchmark pipeline:
```bash
python benchmark.py
```
This script automatically:
1. Connects to both databases and checks engine readiness.
2. Creates optimized relational tables, hypertable chunks, indexes, and compression policies.
3. Generates 1,000,000 synthetic IoT readings using seed 42.
4. Measures batched bulk insertion throughput and latencies.
5. Measures uncompressed storage sizes.
6. Executes native chunk compression on TimescaleDB and measures compressed storage savings.
7. Refreshes the TimescaleDB Continuous Aggregate.
8. Runs 10 iterations of analytical queries and captures `EXPLAIN (ANALYZE, BUFFERS)` execution plans.
9. Exports all measured data to `results/*.csv`.

### Step 3: Generate Publication-Quality Figures
Generate high-resolution (300 DPI) plots from the measured CSVs:
```bash
python plot_results.py
```
All four figures will be saved in `figures/`.

### Step 4: Generate Literature Review Matrix
Generate the professional Excel literature spreadsheet:
```bash
python generate_matrix.py
```
Outputs `G10_Literature_Matrix.xlsx` containing 17 peer-reviewed papers.

---

## 5. Database Schema & Architecture

### Plain PostgreSQL 16 (Port 5433)
```sql
CREATE TABLE sensor_data (
    time TIMESTAMPTZ NOT NULL,
    sensor_id INT NOT NULL,
    temperature DOUBLE PRECISION NOT NULL,
    humidity DOUBLE PRECISION NOT NULL,
    battery DOUBLE PRECISION NOT NULL
);

CREATE INDEX idx_pg_sensor_time ON sensor_data (sensor_id, time DESC);
CREATE INDEX idx_pg_time ON sensor_data (time DESC);
```

### TimescaleDB (Port 5432)
```sql
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

CREATE TABLE sensor_data (
    time TIMESTAMPTZ NOT NULL,
    sensor_id INT NOT NULL,
    temperature DOUBLE PRECISION NOT NULL,
    humidity DOUBLE PRECISION NOT NULL,
    battery DOUBLE PRECISION NOT NULL
);

-- 1-Day Chunk Hypertable Partitioning
SELECT create_hypertable('sensor_data', 'time', chunk_time_interval => INTERVAL '1 day');
CREATE INDEX idx_ts_sensor_time ON sensor_data (sensor_id, time DESC);

-- Columnar Compression Segmented by Sensor ID
ALTER TABLE sensor_data SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'sensor_id',
    timescaledb.compress_orderby = 'time DESC'
);

-- Continuous Aggregate (Hourly Pre-computation)
CREATE MATERIALIZED VIEW sensor_hourly_summary
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    sensor_id,
    AVG(temperature) AS avg_temp,
    MIN(temperature) AS min_temp,
    MAX(temperature) AS max_temp,
    AVG(humidity) AS avg_humidity,
    AVG(battery) AS avg_battery,
    COUNT(*) AS reading_count
FROM sensor_data
GROUP BY bucket, sensor_id
WITH NO DATA;
```

---

## 6. Reproducing Results on Another Machine

To reproduce these exact results on any target computer:
1. Clone or copy the project directory.
2. Verify Docker Desktop is active.
3. Run `start_containers.bat` (or `docker compose up -d`).
4. Run `python benchmark.py`.
5. Run `python plot_results.py`.
Because `benchmark.py` uses a fixed pseudo-random seed (`seed=42`), the dataset and sensor values are strictly deterministic across runs.
