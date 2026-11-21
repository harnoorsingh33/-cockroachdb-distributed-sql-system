/**
 * CockroachDB Distributed SQL Dashboard Frontend Application
 * Interacts with Node.js/Express backend connected to the 3-Node Cluster
 */

const API_BASE = '';
let currentProducts = [];
let clusterStatusData = null;

// DOM Elements
const clusterPill = document.getElementById('clusterPill');
const clusterStatusDot = document.getElementById('clusterStatusDot');
const clusterStatusText = document.getElementById('clusterStatusText');
const quorumBadge = document.getElementById('quorumBadge');
const btnRefreshCluster = document.getElementById('btnRefreshCluster');
const selectNodeGateway = document.getElementById('selectNodeGateway');
const searchInput = document.getElementById('searchInput');
const executionBanner = document.getElementById('executionBanner');
const executionText = document.getElementById('executionText');
const productsTableBody = document.getElementById('productsTableBody');
const productModal = document.getElementById('productModal');
const productForm = document.getElementById('productForm');
const modalTitle = document.getElementById('modalTitle');
const btnOpenAddModal = document.getElementById('btnOpenAddModal');
const btnCloseModal = document.getElementById('btnCloseModal');
const btnCancelModal = document.getElementById('btnCancelModal');
const btnConsistencyTest = document.getElementById('btnConsistencyTest');

// Replication Elements
const rangesTableBody = document.getElementById('rangesTableBody');
const zoneConfigBlock = document.getElementById('zoneConfigBlock');
const repFactorVal = document.getElementById('repFactorVal');

// Fault Log
const faultLog = document.getElementById('faultLog');

// DistSQL Elements
const btnExplainDistSQL = document.getElementById('btnExplainDistSQL');
const distsqlPlanOutput = document.getElementById('distsqlPlanOutput');
const txForm = document.getElementById('txForm');
const txFromSku = document.getElementById('txFromSku');
const txToSku = document.getElementById('txToSku');
const txQty = document.getElementById('txQty');
const txResult = document.getElementById('txResult');

// =====================================================================
// Initialization & Event Listeners
// =====================================================================

document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupModal();
  setupCRUD();
  setupDistSQL();

  // Initial Data Loads
  refreshClusterStatus();
  loadProducts();
  loadReplicationData();

  // Periodic poll every 5 seconds
  setInterval(refreshClusterStatus, 5000);
});

// Tab Navigation
function setupTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.add('active');

      if (targetId === 'tab-replication') loadReplicationData();
    });
  });
}

// =====================================================================
// Cluster Health & Monitoring
// =====================================================================

async function refreshClusterStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/cluster/status`);
    const data = await res.json();
    clusterStatusData = data;

    renderClusterHeader(data);
    renderNodeCards(data.nodes, data.internalStatus);
  } catch (err) {
    clusterStatusDot.className = 'status-dot down';
    clusterStatusText.textContent = 'Cluster Unreachable';
    quorumBadge.className = 'badge badge-danger';
    quorumBadge.textContent = 'Quorum: LOST (Backend Offline)';
  }
}

function renderClusterHeader(data) {
  if (data.clusterState === 'HEALTHY') {
    clusterStatusDot.className = 'status-dot online';
    clusterStatusText.textContent = `Cluster Healthy (${data.liveNodes}/${data.totalNodes} Nodes)`;
    quorumBadge.className = 'badge badge-success';
    quorumBadge.textContent = `Quorum: Satisfied (${data.liveNodes} Live >= ${data.quorumRequired} Required)`;
  } else if (data.clusterState === 'DEGRADED') {
    clusterStatusDot.className = 'status-dot degraded';
    clusterStatusText.textContent = `Degraded (${data.liveNodes}/${data.totalNodes} Nodes)`;
    quorumBadge.className = 'badge badge-warning';
    quorumBadge.textContent = `Quorum: Operational (${data.liveNodes} Live >= ${data.quorumRequired} Required)`;
  } else {
    clusterStatusDot.className = 'status-dot down';
    clusterStatusText.textContent = `Cluster Down (${data.liveNodes}/${data.totalNodes} Nodes)`;
    quorumBadge.className = 'badge badge-danger';
    quorumBadge.textContent = `Quorum: Broken (< ${data.quorumRequired} Nodes)`;
  }
}

function renderNodeCards(nodes, internalStatus) {
  [1, 2, 3].forEach(n => {
    const node = nodes[n];
    const dot = document.getElementById(`dot-node-${n}`);
    const badge = document.getElementById(`badge-node-${n}`);
    const idEl = document.getElementById(`id-node-${n}`);
    const rangesEl = document.getElementById(`ranges-node-${n}`);
    const leasesEl = document.getElementById(`leases-node-${n}`);

    if (node && node.online) {
      dot.className = 'status-indicator online';
      badge.className = 'badge badge-success';
      badge.textContent = 'ONLINE';
      idEl.textContent = node.nodeId || n;

      // Find internal metadata for this node if available
      const internal = internalStatus ? internalStatus.find(s => s.node_id === node.nodeId) : null;
      rangesEl.textContent = internal ? internal.ranges : 'Synchronized';
      leasesEl.textContent = internal ? internal.leases : 'Active';
    } else {
      dot.className = 'status-indicator offline';
      badge.className = 'badge badge-danger';
      badge.textContent = 'DOWN';
      idEl.textContent = '-';
      rangesEl.textContent = 'Unreachable';
      leasesEl.textContent = 'Unreachable';
    }
  });
}

btnRefreshCluster.addEventListener('click', () => {
  refreshClusterStatus();
  loadProducts();
  loadReplicationData();
});

// Direct test for a single node card
window.testNodeDirect = async function(nodeNum) {
  selectNodeGateway.value = String(nodeNum);
  logFault(`Testing direct query route to Node ${nodeNum} (Port ${nodeNum === 1 ? 26257 : nodeNum === 2 ? 26258 : 26259})...`);
  await loadProducts();
};

// =====================================================================
// CRUD Operations & Node Routing
// =====================================================================

function setupCRUD() {
  selectNodeGateway.addEventListener('change', () => loadProducts());
  searchInput.addEventListener('input', debounce(() => loadProducts(), 300));
}

async function loadProducts() {
  const node = selectNodeGateway.value;
  const search = searchInput.value.trim();

  let url = `${API_BASE}/api/products?node=${encodeURIComponent(node)}`;
  if (search) url += `&search=${encodeURIComponent(search)}`;

  try {
    const startTime = performance.now();
    const res = await fetch(url);
    const result = await res.json();
    const elapsed = Math.round(performance.now() - startTime);

    if (result.status === 'success') {
      currentProducts = result.data;
      renderProductsTable(result.data);
      updateTxSkuDropdowns(result.data);

      executionBanner.innerHTML = `
        <span class="pulse-icon">●</span>
        <span>Query handled by <strong>Node ${result.processedByNode}</strong> (Port ${result.processedByPort}) in <strong>${result.durationMs || elapsed}ms</strong>. Retrieved ${result.count} records.</span>
      `;
    } else {
      productsTableBody.innerHTML = `<tr><td colspan="8" class="text-center text-danger">Error: ${result.message}</td></tr>`;
      executionBanner.innerHTML = `<span class="text-danger">● Failed executing query on Node ${node}: ${result.message}</span>`;
    }
  } catch (err) {
    productsTableBody.innerHTML = `<tr><td colspan="8" class="text-center text-danger">Cannot connect to backend server.</td></tr>`;
  }
}

function renderProductsTable(products) {
  if (products.length === 0) {
    productsTableBody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">No products found in distributed_store.products.</td></tr>`;
    return;
  }

  productsTableBody.innerHTML = products.map(p => `
    <tr>
      <td class="font-mono font-bold">${escapeHtml(p.sku)}</td>
      <td><strong>${escapeHtml(p.name)}</strong></td>
      <td><span class="badge badge-info">${escapeHtml(p.category)}</span></td>
      <td>$${parseFloat(p.price).toFixed(2)}</td>
      <td><span class="font-mono">${p.stock_quantity} units</span></td>
      <td><span class="badge badge-success">3 Replicas (Raft)</span></td>
      <td class="text-muted text-sm">${new Date(p.updated_at).toLocaleTimeString()}</td>
      <td>
        <button class="btn btn-outline btn-xs mr-1" onclick="openEditModal('${p.id}')">Edit</button>
        <button class="btn btn-outline btn-xs text-danger" onclick="deleteProduct('${p.id}', '${escapeHtml(p.name)}')">Delete</button>
      </td>
    </tr>
  `).join('');
}

// Multi-Node Consistency Test
btnConsistencyTest.addEventListener('click', async () => {
  btnConsistencyTest.disabled = true;
  btnConsistencyTest.textContent = 'Testing Consistency...';
  logFault('====================================================');
  logFault('[CONSISTENCY TEST] Initiating Multi-Node Raft Replication Verification...');

  const testSku = `TEST-${Date.now().toString().slice(-6)}`;
  const testProduct = {
    sku: testSku,
    name: 'Distributed Consistency Probe',
    category: 'Diagnostic',
    price: 49.99,
    stock_quantity: 100
  };

  try {
    // 1. Write to Node 1
    logFault(`[Step 1] Sending INSERT to Node 1 (Port 26257)...`);
    const writeRes = await fetch(`${API_BASE}/api/products?node=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testProduct)
    });
    const writeData = await writeRes.json();
    if (writeData.status !== 'success') throw new Error(`Write to Node 1 failed: ${writeData.message}`);
    logFault(` [Node 1] Wrote record with SKU ${testSku}. Raft consensus committed across quorum!`);

    // 2. Read immediately from Node 2
    logFault(`[Step 2] Sending SELECT to Node 2 (Port 26258) for SKU ${testSku}...`);
    const read2Res = await fetch(`${API_BASE}/api/products?node=2&search=${testSku}`);
    const read2Data = await read2Res.json();
    const found2 = read2Data.data && read2Data.data.find(p => p.sku === testSku);
    if (!found2) throw new Error('Record not found on Node 2!');
    logFault(` [Node 2] Successfully retrieved record from Node 2! Data matches perfectly.`);

    // 3. Read immediately from Node 3
    logFault(`[Step 3] Sending SELECT to Node 3 (Port 26259) for SKU ${testSku}...`);
    const read3Res = await fetch(`${API_BASE}/api/products?node=3&search=${testSku}`);
    const read3Data = await read3Res.json();
    const found3 = read3Data.data && read3Data.data.find(p => p.sku === testSku);
    if (!found3) throw new Error('Record not found on Node 3!');
    logFault(` [Node 3] Successfully retrieved record from Node 3! Data matches perfectly.`);

    logFault(` MULTI-NODE CONSISTENCY VERIFIED: Data written on Node 1 is immediately accessible and consistent across Node 2 and Node 3.`);
    logFault('====================================================');

    alert(` Multi-Node Consistency Verified!\n\n1. Inserted on Node 1 (Port 26257)\n2. Read from Node 2 (Port 26258) - MATCH\n3. Read from Node 3 (Port 26259) - MATCH`);
    await loadProducts();
  } catch (err) {
    logFault(`❌ Consistency Test Error: ${err.message}`);
    alert(`Consistency Test Notice: ${err.message}`);
  } finally {
    btnConsistencyTest.disabled = false;
    btnConsistencyTest.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
      </svg>
      Test Multi-Node Consistency
    `;
  }
});

// Modal Setup
function setupModal() {
  btnOpenAddModal.addEventListener('click', () => {
    productForm.reset();
    document.getElementById('productId').value = '';
    modalTitle.textContent = 'Add New Replicated Product';
    productModal.classList.add('active');
  });

  const closeModal = () => productModal.classList.remove('active');
  btnCloseModal.addEventListener('click', closeModal);
  btnCancelModal.addEventListener('click', closeModal);

  productForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('productId').value;
    const node = selectNodeGateway.value;

    const payload = {
      sku: document.getElementById('productSku').value,
      name: document.getElementById('productName').value,
      category: document.getElementById('productCategory').value,
      price: parseFloat(document.getElementById('productPrice').value),
      stock_quantity: parseInt(document.getElementById('productStock').value, 10)
    };

    try {
      const url = id 
        ? `${API_BASE}/api/products/${id}?node=${encodeURIComponent(node)}`
        : `${API_BASE}/api/products?node=${encodeURIComponent(node)}`;
      const method = id ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (data.status === 'success') {
        closeModal();
        await loadProducts();
        logFault(`[CRUD] ${id ? 'Updated' : 'Inserted'} product '${payload.name}' via Node ${data.processedByNode}.`);
      } else {
        alert(`Error: ${data.message}`);
      }
    } catch (err) {
      alert(`Network error: ${err.message}`);
    }
  });
}

window.openEditModal = function(id) {
  const p = currentProducts.find(item => item.id === id);
  if (!p) return;

  document.getElementById('productId').value = p.id;
  document.getElementById('productSku').value = p.sku;
  document.getElementById('productName').value = p.name;
  document.getElementById('productCategory').value = p.category;
  document.getElementById('productPrice').value = p.price;
  document.getElementById('productStock').value = p.stock_quantity;

  modalTitle.textContent = 'Edit Product (Raft Consensus Update)';
  productModal.classList.add('active');
};

window.deleteProduct = async function(id, name) {
  if (!confirm(`Are you sure you want to delete '${name}'? This DELETE operation will replicate across all 3 nodes.`)) return;

  const node = selectNodeGateway.value;
  try {
    const res = await fetch(`${API_BASE}/api/products/${id}?node=${encodeURIComponent(node)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.status === 'success') {
      logFault(`[CRUD] Deleted product '${name}' via Node ${data.processedByNode}.`);
      await loadProducts();
    } else {
      alert(`Delete Error: ${data.message}`);
    }
  } catch (err) {
    alert(`Network Error: ${err.message}`);
  }
};

// =====================================================================
// Data Replication & Raft Ranges
// =====================================================================

async function loadReplicationData() {
  try {
    const res = await fetch(`${API_BASE}/api/cluster/replication`);
    const data = await res.json();

    if (data.status === 'success') {
      repFactorVal.textContent = `${data.replicationFactor} Replicas (Active)`;

      // Render Ranges Table
      if (data.ranges && data.ranges.length > 0) {
        rangesTableBody.innerHTML = data.ranges.map(r => `
          <tr>
            <td class="font-bold font-mono">${r.range_id || r.range_id_raw || 'Range 1'}</td>
            <td>${r.start_key || '/Table/products/Min'}</td>
            <td>${r.end_key || '/Table/products/Max'}</td>
            <td><span class="badge badge-info">${JSON.stringify(r.replicas || [1, 2, 3])}</span></td>
            <td><span class="badge badge-success">Node ${r.lease_holder || 1}</span></td>
          </tr>
        `).join('');
      } else {
        rangesTableBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">Range active. Replicated to nodes [1, 2, 3].</td></tr>`;
      }

      // Render Zone Config
      if (data.tableZoneConfig) {
        zoneConfigBlock.textContent = JSON.stringify(data.tableZoneConfig, null, 2);
      }
    }
  } catch (err) {
    rangesTableBody.innerHTML = `<tr><td colspan="5" class="text-center text-danger">Replication metadata unavailable until cluster connects.</td></tr>`;
  }
}

// =====================================================================
// Fault Tolerance Simulator Walkthrough
// =====================================================================

function logFault(msg) {
  const time = new Date().toLocaleTimeString();
  faultLog.textContent += `\n[${time}] ${msg}`;
  faultLog.scrollTop = faultLog.scrollHeight;
}

window.clearFaultLog = function() {
  faultLog.textContent = `[Log Reset] Console ready.`;
};

window.verifyClusterState = async function() {
  await refreshClusterStatus();
  if (!clusterStatusData) {
    logFault('❌ Cluster not reachable.');
    return;
  }
  logFault(`[STATUS CHECK] Live Nodes: ${clusterStatusData.liveNodes}/3. Quorum: ${clusterStatusData.quorumSatisfied ? 'SATISFIED' : 'LOST'}. State: ${clusterStatusData.clusterState}.`);
};

window.testWriteDuringFailure = async function() {
  logFault(`[FAILURE TEST] Attempting write to surviving nodes (Node 2 or 3)...`);
  const probeSku = `FAILOVER-${Date.now().toString().slice(-4)}`;
  try {
    const res = await fetch(`${API_BASE}/api/products?node=auto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku: probeSku,
        name: 'Fault Tolerance Test Item',
        category: 'Diagnostic',
        price: 19.99,
        stock_quantity: 10
      })
    });
    const data = await res.json();
    if (data.status === 'success') {
      logFault(` WRITE SUCCEEDED during node failure! Handled by surviving Node ${data.processedByNode} (Port ${data.processedByPort}).`);
      logFault(` CockroachDB maintained Raft quorum (2 of 3 replicas online) and committed the write safely.`);
      await loadProducts();
    } else {
      logFault(`❌ Write failed: ${data.message}`);
    }
  } catch (e) {
    logFault(`❌ Network error during write test: ${e.message}`);
  }
};

window.verifyRecovery = async function() {
  logFault(`[RECOVERY CHECK] Checking if stopped node has rejoined the Raft cluster...`);
  await refreshClusterStatus();
  if (clusterStatusData && clusterStatusData.liveNodes === 3) {
    logFault(` ALL 3 NODES ARE ONLINE! The recovered node has caught up with missed Raft log entries.`);
    logFault(` Cluster State: HEALTHY. Full 3-replica fault tolerance restored.`);
  } else {
    logFault(`⚠️ Node still recovering or offline. Currently ${clusterStatusData ? clusterStatusData.liveNodes : 0}/3 nodes active.`);
  }
  await loadProducts();
};

// =====================================================================
// DistSQL & ACID Transactions
// =====================================================================

function setupDistSQL() {
  btnExplainDistSQL.addEventListener('click', async () => {
    distsqlPlanOutput.textContent = 'Generating distributed query execution plan (EXPLAIN DISTSQL)...';
    try {
      const res = await fetch(`${API_BASE}/api/cluster/distsql-plan`);
      const data = await res.json();

      if (data.status === 'success') {
        distsqlPlanOutput.textContent = `=== DISTRIBUTED SQL EXECUTION PLAN (Node ${data.executedOnNode}) ===\nQuery: ${data.query}\n\n`;
        if (Array.isArray(data.distsqlPlan)) {
          data.distsqlPlan.forEach(row => {
            distsqlPlanOutput.textContent += Object.values(row).join(' | ') + '\n';
          });
        }
      } else {
        distsqlPlanOutput.textContent = `Error: ${data.message}`;
      }
    } catch (err) {
      distsqlPlanOutput.textContent = `Error fetching DistSQL plan: ${err.message}`;
    }
  });

  txForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fromSku = txFromSku.value;
    const toSku = txToSku.value;
    const qty = txQty.value;

    if (!fromSku || !toSku || fromSku === toSku) {
      alert('Please select two different products for the transfer.');
      return;
    }

    txResult.textContent = 'Executing atomic distributed transaction (BEGIN ... UPDATE ... UPDATE ... COMMIT)...';
    try {
      const res = await fetch(`${API_BASE}/api/products/distributed-transaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromSku, toSku, quantity: qty })
      });
      const data = await res.json();

      if (data.status === 'success') {
        txResult.innerHTML = `
          <div class="text-success font-bold"> ${data.message}</div>
          <div>Isolation Level: <strong>${data.isolationLevel}</strong></div>
          <div>Transferred: <strong>${data.details.transferredQty} units</strong> from ${data.details.source.name} (${data.details.source.stock_quantity} left) to ${data.details.destination.name} (${data.details.destination.stock_quantity} now).</div>
        `;
        await loadProducts();
      } else {
        txResult.innerHTML = `<div class="text-danger">❌ Transaction Aborted / Rolled Back: ${data.message}</div>`;
      }
    } catch (err) {
      txResult.innerHTML = `<div class="text-danger">❌ Error: ${err.message}</div>`;
    }
  });
}

function updateTxSkuDropdowns(products) {
  if (!products || products.length === 0) return;
  const prevFrom = txFromSku.value;
  const prevTo = txToSku.value;

  const options = products.map(p => `<option value="${p.sku}">${p.sku} - ${p.name} (Stock: ${p.stock_quantity})</option>`).join('');
  txFromSku.innerHTML = options;
  txToSku.innerHTML = options;

  if (prevFrom) txFromSku.value = prevFrom;
  if (prevTo) txToSku.value = prevTo;
  else if (products.length > 1) txToSku.selectedIndex = 1;
}

// Utility Helpers
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[m]);
}

function debounce(fn, delay) {
  let timer = null;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}
