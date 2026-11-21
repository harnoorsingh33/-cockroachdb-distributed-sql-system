#!/usr/bin/env python3
"""
plot_results.py - Academic Publication-Quality Visualizations
Group G10: Time-Series Databases for IoT
TimescaleDB vs. Plain PostgreSQL

Generates 300 DPI figures saved in figures/:
  1. insertion_performance.png
  2. storage_footprint.png
  3. query_execution_time.png
  4. compression_effectiveness.png
"""

import os
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker

# Style configuration
plt.rcParams.update({
    'font.family': 'sans-serif',
    'font.sans-serif': ['DejaVu Sans', 'Arial', 'Helvetica'],
    'font.size': 11,
    'axes.labelsize': 12,
    'axes.titlesize': 13,
    'xtick.labelsize': 10,
    'ytick.labelsize': 10,
    'legend.fontsize': 10,
    'figure.titlesize': 14,
    'grid.linestyle': '--',
    'grid.alpha': 0.6,
    'axes.grid': True,
    'savefig.dpi': 300,
    'savefig.bbox': 'tight'
})

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RESULTS_DIR = os.path.join(BASE_DIR, "results")
FIGURES_DIR = os.path.join(BASE_DIR, "figures")
os.makedirs(FIGURES_DIR, exist_ok=True)

# Colors
COLOR_PG = "#1f77b4"       # Muted Blue
COLOR_TS = "#ff7f0e"       # Safety Orange
COLOR_TS_COMP = "#2ca02c"  # Grass Green
COLOR_TS_CAGG = "#9467bd"  # Purple


def plot_insertion_performance():
    summary_path = os.path.join(RESULTS_DIR, "insertion_benchmark.csv")
    latency_path = os.path.join(RESULTS_DIR, "batch_latencies.csv")
    if not os.path.exists(summary_path) or not os.path.exists(latency_path):
        print(f"[!] Skipping insertion plot: results not found in {RESULTS_DIR}")
        return

    summary_df = pd.read_csv(summary_path)
    lat_df = pd.read_csv(latency_path)

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5))

    # Subplot 1: Throughput
    systems = [s.upper() for s in summary_df['system']]
    throughputs = summary_df['throughput_rows_per_sec']
    bars = ax1.bar(systems, throughputs, color=[COLOR_PG, COLOR_TS], width=0.45, edgecolor='black', linewidth=1.1)
    ax1.set_ylabel("Ingestion Throughput (rows/sec)")
    ax1.set_title("(a) Bulk Ingestion Throughput (1M Rows)")
    ax1.yaxis.set_major_formatter(ticker.FuncFormatter(lambda x, p: f'{x:,.0f}'))

    for bar in bars:
        h = bar.get_height()
        ax1.annotate(f"{h:,.0f} r/s",
                     xy=(bar.get_x() + bar.get_width() / 2, h),
                     xytext=(0, 4), textcoords="offset points",
                     ha='center', va='bottom', fontweight='bold', fontsize=10)

    ax1.set_ylim(0, max(throughputs) * 1.18)

    # Subplot 2: Batch Latency CDF
    pg_lat = lat_df[lat_df['system'] == 'postgres']['elapsed_ms'].sort_values()
    ts_lat = lat_df[lat_df['system'] == 'timescaledb']['elapsed_ms'].sort_values()

    y_pg = np.linspace(0, 1, len(pg_lat))
    y_ts = np.linspace(0, 1, len(ts_lat))

    ax2.plot(pg_lat, y_pg, label=f"PostgreSQL (Mean: {pg_lat.mean():.1f} ms)", color=COLOR_PG, linewidth=2.0)
    ax2.plot(ts_lat, y_ts, label=f"TimescaleDB (Mean: {ts_lat.mean():.1f} ms)", color=COLOR_TS, linewidth=2.0)
    ax2.set_xlabel("Batch Latency (ms per 10k rows)")
    ax2.set_ylabel("Cumulative Probability (CDF)")
    ax2.set_title("(b) Batch Insertion Latency Distribution")
    ax2.legend(loc='lower right', frameon=True)

    plt.tight_layout()
    out_file = os.path.join(FIGURES_DIR, "insertion_performance.png")
    plt.savefig(out_file)
    plt.close()
    print(f"[+] Saved {out_file}")


def plot_storage_footprint():
    storage_path = os.path.join(RESULTS_DIR, "storage_benchmark.csv")
    if not os.path.exists(storage_path):
        print(f"[!] Skipping storage plot: results not found in {RESULTS_DIR}")
        return

    df = pd.read_csv(storage_path)
    # Convert bytes to MB
    df['table_mb'] = df['table_size_bytes'] / (1024 * 1024)
    df['index_mb'] = df['index_size_bytes'] / (1024 * 1024)
    df['total_mb'] = df['total_size_bytes'] / (1024 * 1024)

    labels = []
    for _, r in df.iterrows():
        if r['system'] == 'postgres':
            labels.append("PostgreSQL\n(Standard)")
        elif r['state'] == 'uncompressed':
            labels.append("TimescaleDB\n(Uncompressed)")
        else:
            labels.append("TimescaleDB\n(Compressed)")

    x = np.arange(len(labels))
    width = 0.26

    fig, ax = plt.subplots(figsize=(10, 5.5))

    rects1 = ax.bar(x - width, df['table_mb'], width, label='Table Data', color='#4a7bb0', edgecolor='black')
    rects2 = ax.bar(x, df['index_mb'], width, label='Index Data', color='#e89242', edgecolor='black')
    rects3 = ax.bar(x + width, df['total_mb'], width, label='Total Footprint', color='#5ba85a', edgecolor='black')

    ax.set_ylabel("Storage Footprint (MB)")
    ax.set_title("Storage Footprint Comparison (1,000,000 Records)")
    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontweight='bold')
    ax.legend(frameon=True)
    ax.yaxis.set_major_formatter(ticker.FormatStrFormatter('%.1f MB'))

    # Annotate total size and savings
    pg_total = df[df['system'] == 'postgres']['total_mb'].values[0]
    for idx, row in df.iterrows():
        tot = row['total_mb']
        ax.annotate(f"{tot:.1f} MB",
                    xy=(x[idx] + width, tot),
                    xytext=(0, 4), textcoords="offset points",
                    ha='center', va='bottom', fontweight='bold', fontsize=9.5)
        if row['state'] == 'compressed':
            saving = (1.0 - (tot / pg_total)) * 100.0
            ratio = pg_total / tot
            ax.annotate(f"{saving:.1f}% Savings\n({ratio:.1f}x vs PG)",
                        xy=(x[idx] + width, tot / 2),
                        xytext=(0, 0), textcoords="offset points",
                        ha='center', va='center', color='white', fontweight='bold', fontsize=9)

    ax.set_ylim(0, max(df['total_mb']) * 1.18)
    plt.tight_layout()
    out_file = os.path.join(FIGURES_DIR, "storage_footprint.png")
    plt.savefig(out_file)
    plt.close()
    print(f"[+] Saved {out_file}")


def plot_query_execution_time():
    summary_path = os.path.join(RESULTS_DIR, "query_summary.csv")
    if not os.path.exists(summary_path):
        print(f"[!] Skipping query plot: results not found in {RESULTS_DIR}")
        return

    df = pd.read_csv(summary_path)

    # Friendly query names
    q_map = {
        "Q1_Hourly_Aggregation": "Q1: Hourly Aggregation\n(All 1M Rows)",
        "Q2_Single_Sensor_Range": "Q2: Single Sensor 24h Scan\n(8,640 Rows)",
        "Q3_Latest_Reading_Per_Sensor": "Q3: Latest Reading\nPer Sensor (20 Rows)",
        "Q4_Multi_Sensor_Window_Agg": "Q4: Multi-Sensor Window\nAggregation (5 Sensors)"
    }

    df['clean_q'] = df['query_name'].map(q_map)

    fig, ax = plt.subplots(figsize=(11, 5.5))

    # We plot Q1 comparison separately or side-by-side
    queries = list(q_map.values())
    x = np.arange(len(queries))

    # Extract means
    pg_means = []
    ts_means = []
    for q in q_map.keys():
        pg_val = df[(df['query_name'] == q) & (df['system'] == 'postgres')]['mean_ms'].values
        ts_val = df[(df['query_name'] == q) & (df['system'] == 'timescaledb')]['mean_ms'].values
        pg_means.append(pg_val[0] if len(pg_val) > 0 else 0)
        ts_means.append(ts_val[0] if len(ts_val) > 0 else 0)

    # Check for Continuous Aggregate in Q1
    cagg_val = df[(df['query_name'] == 'Q1_Hourly_Aggregation') & (df['system'] == 'timescaledb_cagg')]['mean_ms'].values
    cagg_mean = cagg_val[0] if len(cagg_val) > 0 else None

    width = 0.35
    b1 = ax.bar(x - width/2, pg_means, width, label='PostgreSQL (Standard B-tree)', color=COLOR_PG, edgecolor='black')
    b2 = ax.bar(x + width/2, ts_means, width, label='TimescaleDB (Hypertable Compressed)', color=COLOR_TS, edgecolor='black')

    if cagg_mean is not None:
        b3 = ax.bar(x[0] + width*1.5, [cagg_mean], width*0.8, label='TimescaleDB Continuous Aggregate (Pre-computed)', color=COLOR_TS_CAGG, edgecolor='black', hatch='//')
        ax.annotate(f"{cagg_mean:.2f} ms\n({pg_means[0]/cagg_mean:.1f}x speedup)",
                    xy=(x[0] + width*1.5, cagg_mean),
                    xytext=(0, 6), textcoords="offset points",
                    ha='center', va='bottom', fontweight='bold', fontsize=8.5, color=COLOR_TS_CAGG)

    ax.set_ylabel("Mean Execution Time (ms) [Log Scale]")
    ax.set_yscale('log')
    ax.set_title("Query Execution Latency Comparison (10 Iterations Mean)")
    ax.set_xticks(x)
    ax.set_xticklabels(queries, fontweight='bold')
    ax.legend(frameon=True, loc='upper right')
    ax.yaxis.set_major_formatter(ticker.FuncFormatter(lambda y, _: f'{y:g} ms'))

    # Annotations
    for bar in b1:
        h = bar.get_height()
        if h > 0:
            ax.annotate(f"{h:.1f} ms",
                        xy=(bar.get_x() + bar.get_width() / 2, h),
                        xytext=(0, 3), textcoords="offset points",
                        ha='center', va='bottom', fontsize=8.5)

    for bar in b2:
        h = bar.get_height()
        if h > 0:
            ax.annotate(f"{h:.1f} ms",
                        xy=(bar.get_x() + bar.get_width() / 2, h),
                        xytext=(0, 3), textcoords="offset points",
                        ha='center', va='bottom', fontsize=8.5)

    plt.tight_layout()
    out_file = os.path.join(FIGURES_DIR, "query_execution_time.png")
    plt.savefig(out_file)
    plt.close()
    print(f"[+] Saved {out_file}")


def plot_compression_effectiveness():
    storage_path = os.path.join(RESULTS_DIR, "storage_benchmark.csv")
    if not os.path.exists(storage_path):
        print(f"[!] Skipping compression plot: results not found in {RESULTS_DIR}")
        return

    df = pd.read_csv(storage_path)
    ts_uncomp = df[(df['system'] == 'timescaledb') & (df['state'] == 'uncompressed')]
    ts_comp = df[(df['system'] == 'timescaledb') & (df['state'] == 'compressed')]

    if ts_uncomp.empty or ts_comp.empty:
        print("[!] Incomplete TimescaleDB storage data.")
        return

    uncomp_tot = ts_uncomp['total_size_bytes'].values[0] / (1024 * 1024)
    comp_tot = ts_comp['total_size_bytes'].values[0] / (1024 * 1024)
    uncomp_tbl = ts_uncomp['table_size_bytes'].values[0] / (1024 * 1024)
    comp_tbl = ts_comp['table_size_bytes'].values[0] / (1024 * 1024)
    uncomp_idx = ts_uncomp['index_size_bytes'].values[0] / (1024 * 1024)
    comp_idx = ts_comp['index_size_bytes'].values[0] / (1024 * 1024)

    ratio = uncomp_tot / comp_tot if comp_tot > 0 else 1.0
    savings = (1.0 - (comp_tot / uncomp_tot)) * 100.0 if uncomp_tot > 0 else 0.0

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 5))

    # Subplot 1: Stacked Bar Comparison
    categories = ['Uncompressed', 'Compressed']
    tables = [uncomp_tbl, comp_tbl]
    indexes = [uncomp_idx, comp_idx]

    ax1.bar(categories, tables, label='Table Data', color='#4a7bb0', width=0.45, edgecolor='black')
    ax1.bar(categories, indexes, bottom=tables, label='Index Data', color='#e89242', width=0.45, edgecolor='black')
    ax1.set_ylabel("Storage Footprint (MB)")
    ax1.set_title("(a) TimescaleDB Native Compression Footprint")
    ax1.legend(loc='upper right', frameon=True)

    ax1.annotate(f"Total: {uncomp_tot:.1f} MB", xy=(0, uncomp_tot), xytext=(0, 4),
                 textcoords="offset points", ha='center', fontweight='bold')
    ax1.annotate(f"Total: {comp_tot:.1f} MB\n({savings:.1f}% reduction)", xy=(1, comp_tot), xytext=(0, 4),
                 textcoords="offset points", ha='center', fontweight='bold', color=COLOR_TS_COMP)

    ax1.set_ylim(0, uncomp_tot * 1.25)

    # Subplot 2: Donut of Space Breakdown
    saved_mb = uncomp_tot - comp_tot
    sizes = [comp_tot, saved_mb]
    colors = [COLOR_TS_COMP, '#e0e0e0']
    explode = (0.05, 0)

    wedges, texts, autotexts = ax2.pie(
        sizes, explode=explode, labels=['Retained Data\n(Compressed)', 'Storage Space\nSaved'],
        colors=colors, autopct='%1.1f%%', startangle=140,
        wedgeprops=dict(width=0.4, edgecolor='black')
    )
    plt.setp(autotexts, size=11, weight="bold")
    ax2.set_title(f"(b) Space Savings ({ratio:.2f}x Compression Ratio)")

    plt.tight_layout()
    out_file = os.path.join(FIGURES_DIR, "compression_effectiveness.png")
    plt.savefig(out_file)
    plt.close()
    print(f"[+] Saved {out_file}")


def main():
    print("[-] Generating Publication-Quality Figures...")
    plot_insertion_performance()
    plot_storage_footprint()
    plot_query_execution_time()
    plot_compression_effectiveness()
    print("[✓] All figures generated in figures/ directory.")


if __name__ == "__main__":
    main()
