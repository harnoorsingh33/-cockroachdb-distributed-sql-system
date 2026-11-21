#!/usr/bin/env python3
"""
benchmark.py - Automated End-to-End Benchmarking Suite
Group G10: Time-Series Databases for IoT
TimescaleDB vs. Plain PostgreSQL (1,000,000 Synthetic IoT Sensor Readings)

Measures:
  1. Bulk insertion throughput (rows/sec) and batch latency (ms).
  2. Database storage footprint (table, index, total).
  3. Compression ratio and space savings (Gorilla / Delta-of-delta / XOR).
  4. Query execution latency across multiple IoT workloads:
     - Q1: Full-range hourly aggregation (Standard vs. Hypertable vs. Continuous Aggregate)
     - Q2: Single-sensor 24-hour time-range scan
     - Q3: Latest reading per sensor across all sensors
     - Q4: Multi-sensor windowed aggregation
  5. Detailed EXPLAIN ANALYZE query plans.
"""

import os
import sys
import time
import json
import platform
import numpy as np
import pandas as pd
import psycopg2
from psycopg2 import extras

# Configuration
CONFIG = {
    "num_sensors": 20,
    "readings_per_sensor": 50000,   # 20 * 50,000 = 1,000,000 rows
    "interval_seconds": 10,
    "batch_size": 10000,            # 100 batches of 10,000
    "query_iterations": 10,
    "random_seed": 42,
    "results_dir": os.path.join(os.path.dirname(os.path.abspath(__file__)), "results"),
    "postgres": {
        "host": "localhost",
        "port": 5433,
        "dbname": "iot_bench",
        "user": "postgres",
        "password": "postgres"
    },
    "timescaledb": {
        "host": "localhost",
        "port": 5432,
        "dbname": "iot_bench",
        "user": "postgres",
        "password": "postgres"
    }
}

os.makedirs(CONFIG["results_dir"], exist_ok=True)


def get_connection(db_key):
    cfg = CONFIG[db_key]
    return psycopg2.connect(
        host=cfg["host"],
        port=cfg["port"],
        dbname=cfg["dbname"],
        user=cfg["user"],
        password=cfg["password"]
    )


def wait_for_databases():
    """Verify both databases are online and responsive."""
    print("[-] Checking database connectivity...")
    for key in ["postgres", "timescaledb"]:
        connected = False
        for attempt in range(15):
            try:
                conn = get_connection(key)
                with conn.cursor() as cur:
                    cur.execute("SELECT version();")
                    ver = cur.fetchone()[0]
                    print(f"    [+] {key.upper()} connected: {ver.split(',')[0]}")
                conn.close()
                connected = True
                break
            except Exception as e:
                time.sleep(2)
        if not connected:
            raise ConnectionError(f"Could not connect to {key} on port {CONFIG[key]['port']}")


def setup_schemas():
    """Setup schema for PostgreSQL and TimescaleDB."""
    print("\n[-] Setting up database schemas...")

    # 1. Plain PostgreSQL
    conn_pg = get_connection("postgres")
    conn_pg.autocommit = True
    with conn_pg.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS sensor_data CASCADE;")
        cur.execute("""
            CREATE TABLE sensor_data (
                time TIMESTAMPTZ NOT NULL,
                sensor_id INT NOT NULL,
                temperature DOUBLE PRECISION NOT NULL,
                humidity DOUBLE PRECISION NOT NULL,
                battery DOUBLE PRECISION NOT NULL
            );
        """)
        cur.execute("CREATE INDEX idx_pg_sensor_time ON sensor_data (sensor_id, time DESC);")
        cur.execute("CREATE INDEX idx_pg_time ON sensor_data (time DESC);")
        print("    [+] PostgreSQL schema created with B-tree indexes.")
    conn_pg.close()

    # 2. TimescaleDB
    conn_ts = get_connection("timescaledb")
    conn_ts.autocommit = True
    with conn_ts.cursor() as cur:
        cur.execute("CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;")
        cur.execute("DROP TABLE IF EXISTS sensor_data CASCADE;")
        cur.execute("""
            CREATE TABLE sensor_data (
                time TIMESTAMPTZ NOT NULL,
                sensor_id INT NOT NULL,
                temperature DOUBLE PRECISION NOT NULL,
                humidity DOUBLE PRECISION NOT NULL,
                battery DOUBLE PRECISION NOT NULL
            );
        """)
        # Create hypertable with 1-day chunks
        cur.execute("SELECT create_hypertable('sensor_data', 'time', chunk_time_interval => INTERVAL '1 day');")
        cur.execute("CREATE INDEX idx_ts_sensor_time ON sensor_data (sensor_id, time DESC);")

        # Enable compression
        cur.execute("""
            ALTER TABLE sensor_data SET (
                timescaledb.compress,
                timescaledb.compress_segmentby = 'sensor_id',
                timescaledb.compress_orderby = 'time DESC'
            );
        """)
        print("    [+] TimescaleDB hypertable created with 1-day chunking and compression enabled.")
    conn_ts.close()


def generate_synthetic_data():
    """
    Generate 1,000,000 synthetic IoT sensor records.
    20 sensors, 50,000 readings each at 10-second intervals.
    Realistic diurnal cycles for temperature, inverse humidity, battery depletion.
    """
    print(f"\n[-] Generating {CONFIG['num_sensors'] * CONFIG['readings_per_sensor']:,} synthetic IoT readings...")
    np.random.seed(CONFIG["random_seed"])

    num_sensors = CONFIG["num_sensors"]
    readings = CONFIG["readings_per_sensor"]
    interval = CONFIG["interval_seconds"]
    base_epoch = 1767225600  # 2026-01-01 00:00:00 UTC

    # Total duration: 50,000 * 10s = 500,000s (~5.787 days)
    t_seconds = np.arange(readings) * interval
    timestamps = pd.to_datetime(base_epoch + t_seconds, unit='s', utc=True)

    all_data = []

    for s_id in range(1, num_sensors + 1):
        # Diurnal temperature cycle: period = 86400s (24h)
        temp_cycle = 22.0 + (s_id - 10) * 0.15 + 6.5 * np.sin(2 * np.pi * t_seconds / 86400.0)
        temp_noise = np.random.normal(0, 0.35, readings)
        temperature = np.round(temp_cycle + temp_noise, 2)

        # Diurnal humidity cycle: inversely correlated with temperature
        hum_cycle = 65.0 - (s_id - 10) * 0.2 - 18.0 * np.sin(2 * np.pi * t_seconds / 86400.0)
        hum_noise = np.random.normal(0, 0.8, readings)
        humidity = np.clip(np.round(hum_cycle + hum_noise, 2), 10.0, 99.0)

        # Battery depletion: monotonic drop with tiny fluctuation
        depletion = 0.25 * (t_seconds / (readings * interval))
        bat_noise = np.random.normal(0, 0.003, readings)
        battery = np.clip(np.round(3.30 - depletion + bat_noise, 3), 2.50, 3.30)

        sensor_records = [
            (timestamps[i].isoformat(), s_id, float(temperature[i]), float(humidity[i]), float(battery[i]))
            for i in range(readings)
        ]
        all_data.extend(sensor_records)

    # Sort interleaved by time to simulate realistic IoT gateway stream
    all_data.sort(key=lambda r: r[0])
    print(f"    [+] Generated {len(all_data):,} records. Ready for insertion.")
    return all_data


def benchmark_insertion(data, db_key):
    """Benchmark batched bulk insertion."""
    print(f"\n[-] Benchmarking insertion into {db_key.upper()}...")
    batch_size = CONFIG["batch_size"]
    total_records = len(data)
    num_batches = total_records // batch_size

    conn = get_connection(db_key)
    conn.autocommit = True
    batch_latencies = []

    start_total = time.perf_counter()

    insert_sql = "INSERT INTO sensor_data (time, sensor_id, temperature, humidity, battery) VALUES %s"

    with conn.cursor() as cur:
        for b_idx in range(num_batches):
            batch = data[b_idx * batch_size : (b_idx + 1) * batch_size]
            b_start = time.perf_counter()
            extras.execute_values(cur, insert_sql, batch, page_size=batch_size)
            b_elapsed = (time.perf_counter() - b_start) * 1000.0  # ms
            batch_latencies.append({
                "system": db_key,
                "batch_index": b_idx + 1,
                "records": len(batch),
                "elapsed_ms": b_elapsed
            })
            if (b_idx + 1) % 20 == 0 or b_idx == num_batches - 1:
                print(f"    Batch {b_idx + 1}/{num_batches} ({((b_idx + 1) * batch_size):,} records) - Latency: {b_elapsed:.2f} ms")

    total_time_sec = time.perf_counter() - start_total
    throughput = total_records / total_time_sec

    # Verify count
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM sensor_data;")
        verified_count = cur.fetchone()[0]

    conn.close()

    latencies_arr = np.array([b["elapsed_ms"] for b in batch_latencies])
    print(f"    [+] {db_key.upper()} Ingestion Complete:")
    print(f"        Verified Count: {verified_count:,} rows")
    print(f"        Total Time:     {total_time_sec:.3f} s")
    print(f"        Throughput:     {throughput:,.1f} rows/sec")
    print(f"        Mean Batch Lat: {np.mean(latencies_arr):.2f} ms (p95: {np.percentile(latencies_arr, 95):.2f} ms)")

    return {
        "system": db_key,
        "total_records": verified_count,
        "batch_size": batch_size,
        "total_time_sec": total_time_sec,
        "throughput_rows_per_sec": throughput,
        "mean_batch_latency_ms": np.mean(latencies_arr),
        "median_batch_latency_ms": np.median(latencies_arr),
        "p95_batch_latency_ms": np.percentile(latencies_arr, 95),
        "std_batch_latency_ms": np.std(latencies_arr)
    }, batch_latencies


def measure_storage(db_key, state="uncompressed"):
    """Query PostgreSQL and TimescaleDB system catalogs for storage footprint."""
    conn = get_connection(db_key)
    with conn.cursor() as cur:
        if db_key == "postgres":
            cur.execute("""
                SELECT
                    pg_table_size('sensor_data') AS table_bytes,
                    pg_indexes_size('sensor_data') AS index_bytes,
                    pg_total_relation_size('sensor_data') AS total_bytes,
                    pg_size_pretty(pg_table_size('sensor_data')) AS table_pretty,
                    pg_size_pretty(pg_indexes_size('sensor_data')) AS index_pretty,
                    pg_size_pretty(pg_total_relation_size('sensor_data')) AS total_pretty;
            """)
            row = cur.fetchone()
            res = {
                "system": db_key,
                "state": state,
                "table_size_bytes": row[0],
                "index_size_bytes": row[1],
                "total_size_bytes": row[2],
                "table_size_pretty": row[3],
                "index_size_pretty": row[4],
                "total_size_pretty": row[5],
                "compression_ratio": 1.0,
                "space_savings_pct": 0.0
            }
        else: # timescaledb
            if state == "compressed":
                cur.execute("""
                    SELECT
                        COALESCE(sum(before_compression_total_bytes), 0) AS before_bytes,
                        COALESCE(sum(after_compression_total_bytes), 0) AS after_bytes
                    FROM hypertable_compression_stats('sensor_data');
                """)
                comp_row = cur.fetchone()
                before_bytes = comp_row[0]
                after_bytes = comp_row[1]
                ratio = (before_bytes / after_bytes) if after_bytes > 0 else 1.0
                savings = ((1.0 - (after_bytes / before_bytes)) * 100.0) if before_bytes > 0 else 0.0
            else:
                ratio = 1.0
                savings = 0.0

            cur.execute("""
                SELECT
                    table_bytes,
                    index_bytes,
                    total_bytes
                FROM hypertable_detailed_size('sensor_data');
            """)
            h_row = cur.fetchone()
            table_bytes = h_row[0]
            index_bytes = h_row[1]
            total_bytes = h_row[2]

            cur.execute("SELECT pg_size_pretty(%s::bigint), pg_size_pretty(%s::bigint), pg_size_pretty(%s::bigint);",
                        (int(table_bytes), int(index_bytes), int(total_bytes)))
            pretty_row = cur.fetchone()

            res = {
                "system": db_key,
                "state": state,
                "table_size_bytes": table_bytes,
                "index_size_bytes": index_bytes,
                "total_size_bytes": total_bytes,
                "table_size_pretty": pretty_row[0],
                "index_size_pretty": pretty_row[1],
                "total_size_pretty": pretty_row[2],
                "compression_ratio": round(ratio, 2),
                "space_savings_pct": round(savings, 2)
            }
    conn.close()
    return res


def compress_timescaledb():
    """Compress all chunks in TimescaleDB hypertable."""
    print("\n[-] Compressing TimescaleDB chunks...")
    conn = get_connection("timescaledb")
    conn.autocommit = True
    with conn.cursor() as cur:
        # Show chunk list
        cur.execute("SELECT show_chunks('sensor_data');")
        chunks = cur.fetchall()
        print(f"    Found {len(chunks)} chunks to compress:")
        for c in chunks:
            chunk_name = c[0]
            c_start = time.perf_counter()
            cur.execute(f"SELECT compress_chunk('{chunk_name}');")
            c_sec = time.perf_counter() - c_start
            print(f"    Compressed {chunk_name} in {c_sec:.3f} s")
    conn.close()


def setup_continuous_aggregate():
    """Create and refresh TimescaleDB Continuous Aggregate for hourly statistics."""
    print("\n[-] Setting up Continuous Aggregate in TimescaleDB...")
    conn = get_connection("timescaledb")
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("DROP MATERIALIZED VIEW IF EXISTS sensor_hourly_summary CASCADE;")
        cur.execute("""
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
        """)
        t0 = time.perf_counter()
        cur.execute("CALL refresh_continuous_aggregate('sensor_hourly_summary', NULL, NULL);")
        t_ref = time.perf_counter() - t0
        print(f"    [+] Continuous Aggregate refreshed across all 1M rows in {t_ref:.3f} s.")
    conn.close()


def benchmark_queries():
    """Benchmark test queries across PostgreSQL and TimescaleDB."""
    print("\n[-] Benchmarking Query Performance...")

    queries = {
        "Q1_Hourly_Aggregation": {
            "postgres": """
                SELECT date_trunc('hour', time) AS bucket, sensor_id,
                       AVG(temperature) AS avg_temp, MIN(temperature) AS min_temp, MAX(temperature) AS max_temp,
                       AVG(humidity) AS avg_humidity, AVG(battery) AS avg_battery, COUNT(*) AS count
                FROM sensor_data
                GROUP BY 1, 2
                ORDER BY 1, 2;
            """,
            "timescaledb": """
                SELECT time_bucket('1 hour', time) AS bucket, sensor_id,
                       AVG(temperature) AS avg_temp, MIN(temperature) AS min_temp, MAX(temperature) AS max_temp,
                       AVG(humidity) AS avg_humidity, AVG(battery) AS avg_battery, COUNT(*) AS count
                FROM sensor_data
                GROUP BY 1, 2
                ORDER BY 1, 2;
            """,
            "timescaledb_cagg": """
                SELECT bucket, sensor_id, avg_temp, min_temp, max_temp, avg_humidity, avg_battery, reading_count
                FROM sensor_hourly_summary
                ORDER BY bucket, sensor_id;
            """
        },
        "Q2_Single_Sensor_Range": {
            "postgres": """
                SELECT time, sensor_id, temperature, humidity, battery
                FROM sensor_data
                WHERE sensor_id = 5
                  AND time >= '2026-01-02 00:00:00+00'
                  AND time < '2026-01-03 00:00:00+00'
                ORDER BY time ASC;
            """,
            "timescaledb": """
                SELECT time, sensor_id, temperature, humidity, battery
                FROM sensor_data
                WHERE sensor_id = 5
                  AND time >= '2026-01-02 00:00:00+00'
                  AND time < '2026-01-03 00:00:00+00'
                ORDER BY time ASC;
            """
        },
        "Q3_Latest_Reading_Per_Sensor": {
            "postgres": """
                SELECT DISTINCT ON (sensor_id) sensor_id, time, temperature, humidity, battery
                FROM sensor_data
                ORDER BY sensor_id, time DESC;
            """,
            "timescaledb": """
                SELECT DISTINCT ON (sensor_id) sensor_id, time, temperature, humidity, battery
                FROM sensor_data
                ORDER BY sensor_id, time DESC;
            """
        },
        "Q4_Multi_Sensor_Window_Agg": {
            "postgres": """
                SELECT sensor_id, AVG(temperature) AS avg_temp, MAX(humidity) AS max_hum
                FROM sensor_data
                WHERE sensor_id IN (1, 5, 10, 15, 20)
                  AND time >= '2026-01-03 00:00:00+00'
                  AND time < '2026-01-03 06:00:00+00'
                GROUP BY sensor_id;
            """,
            "timescaledb": """
                SELECT sensor_id, AVG(temperature) AS avg_temp, MAX(humidity) AS max_hum
                FROM sensor_data
                WHERE sensor_id IN (1, 5, 10, 15, 20)
                  AND time >= '2026-01-03 00:00:00+00'
                  AND time < '2026-01-03 06:00:00+00'
                GROUP BY sensor_id;
            """
        }
    }

    raw_results = []
    explain_plans = {"postgres": {}, "timescaledb": {}}

    iterations = CONFIG["query_iterations"]

    for q_name, targets in queries.items():
        print(f"    Evaluating {q_name}...")
        for target_sys, sql in targets.items():
            # Determine actual database connection
            db_conn_key = "timescaledb" if "timescaledb" in target_sys else "postgres"
            conn = get_connection(db_conn_key)

            # Warm-up run
            with conn.cursor() as cur:
                cur.execute(sql)
                _ = cur.fetchall()

            # Iteration runs
            latencies = []
            with conn.cursor() as cur:
                for i in range(iterations):
                    t0 = time.perf_counter()
                    cur.execute(sql)
                    _ = cur.fetchall()
                    elapsed = (time.perf_counter() - t0) * 1000.0  # ms
                    latencies.append(elapsed)
                    raw_results.append({
                        "query_name": q_name,
                        "system": target_sys,
                        "iteration": i + 1,
                        "execution_time_ms": elapsed
                    })

            # Capture EXPLAIN (ANALYZE, BUFFERS)
            with conn.cursor() as cur:
                try:
                    cur.execute(f"EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) {sql}")
                    plan_lines = [r[0] for r in cur.fetchall()]
                    explain_plans[db_conn_key][f"{q_name}_{target_sys}"] = "\n".join(plan_lines)
                except Exception as ex:
                    explain_plans[db_conn_key][f"{q_name}_{target_sys}"] = f"EXPLAIN failed: {ex}"

            conn.close()

            print(f"        [{target_sys:20s}] Mean: {np.mean(latencies):7.2f} ms | Median: {np.median(latencies):7.2f} ms | p95: {np.percentile(latencies, 95):7.2f} ms")

    return raw_results, explain_plans


def main():
    print("=" * 70)
    print(" DBMS ASSIGNMENT 1 (GROUP G10): BENCHMARKING SUITE")
    print(" Time-Series Databases for IoT: TimescaleDB vs. Plain PostgreSQL")
    print(" Target: 1,000,000 Synthetic Sensor Records")
    print("=" * 70)

    # 1. Connectivity
    wait_for_databases()

    # 2. Host specifications capture
    uname = platform.uname()
    host_metadata = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
        "os": f"{uname.system} {uname.release} ({uname.version})",
        "machine": uname.machine,
        "processor": uname.processor,
        "python_version": sys.version.split()[0],
        "dataset_sensors": CONFIG["num_sensors"],
        "dataset_readings_per_sensor": CONFIG["readings_per_sensor"],
        "total_records": CONFIG["num_sensors"] * CONFIG["readings_per_sensor"],
        "batch_size": CONFIG["batch_size"],
        "query_iterations": CONFIG["query_iterations"],
        "random_seed": CONFIG["random_seed"]
    }

    # 3. Setup Schemas
    setup_schemas()

    # 4. Generate Data
    dataset = generate_synthetic_data()

    # 5. Benchmark Insertion
    pg_summary, pg_latencies = benchmark_insertion(dataset, "postgres")
    ts_summary, ts_latencies = benchmark_insertion(dataset, "timescaledb")

    insertion_summary_df = pd.DataFrame([pg_summary, ts_summary])
    all_latencies_df = pd.DataFrame(pg_latencies + ts_latencies)

    # 6. Measure Pre-compression Storage
    pg_storage_uncomp = measure_storage("postgres", "uncompressed")
    ts_storage_uncomp = measure_storage("timescaledb", "uncompressed")

    # 7. Setup Continuous Aggregates
    setup_continuous_aggregate()

    # 8. Compress TimescaleDB Chunks
    compress_timescaledb()

    # 9. Measure Post-compression Storage
    ts_storage_comp = measure_storage("timescaledb", "compressed")

    storage_df = pd.DataFrame([pg_storage_uncomp, ts_storage_uncomp, ts_storage_comp])

    # 10. Benchmark Queries
    query_raw_results, explain_plans = benchmark_queries()
    query_raw_df = pd.DataFrame(query_raw_results)

    # Summarize query results
    query_summary = query_raw_df.groupby(["query_name", "system"])["execution_time_ms"].agg(
        mean_ms="mean",
        std_ms="std",
        median_ms="median",
        min_ms="min",
        max_ms="max",
        p95_ms=lambda x: np.percentile(x, 95)
    ).reset_index()

    # 11. Save all CSVs and Reports
    results_dir = CONFIG["results_dir"]
    insertion_summary_df.to_csv(os.path.join(results_dir, "insertion_benchmark.csv"), index=False)
    all_latencies_df.to_csv(os.path.join(results_dir, "batch_latencies.csv"), index=False)
    storage_df.to_csv(os.path.join(results_dir, "storage_benchmark.csv"), index=False)
    query_raw_df.to_csv(os.path.join(results_dir, "query_benchmark.csv"), index=False)
    query_summary.to_csv(os.path.join(results_dir, "query_summary.csv"), index=False)

    with open(os.path.join(results_dir, "benchmark_metadata.json"), "w") as f:
        json.dump(host_metadata, f, indent=2)

    with open(os.path.join(results_dir, "explain_analyze_pg.txt"), "w") as f:
        for k, v in explain_plans["postgres"].items():
            f.write(f"=== {k} ===\n{v}\n\n")

    with open(os.path.join(results_dir, "explain_analyze_timescale.txt"), "w") as f:
        for k, v in explain_plans["timescaledb"].items():
            f.write(f"=== {k} ===\n{v}\n\n")

    print("\n" + "=" * 70)
    print(" [✓] BENCHMARK COMPLETED SUCCESSFULLY!")
    print(f" All CSV files and execution plans saved in: {results_dir}")
    print("=" * 70)


if __name__ == "__main__":
    main()
