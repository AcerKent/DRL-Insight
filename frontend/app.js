// Basic configuration for Clinical dark mode plots
const plotLayoutBase = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: {
        family: "'Manrope', sans-serif",
        color: '#94A3B8',
        size: 11
    },
    margin: { t: 10, r: 20, l: 40, b: 100 },
    xaxis: {
        gridcolor: 'rgba(255,255,255,0.05)',
        zerolinecolor: 'rgba(255,255,255,0.1)',
        automargin: true,
        tickangle: -45
    },
    yaxis: {
        gridcolor: 'rgba(255,255,255,0.05)',
        zerolinecolor: 'rgba(255,255,255,0.1)'
    },
    showlegend: false
};

const colors = {
    teal: '#00F0FF',
    purple: '#B026FF',
    blue: '#3B82F6'
};

// Global State
let globalData = [];
let currentGroup = 'Acquisition Protocol';
let activeFilters = new Set();

// DOM Elements
const fileInput = document.getElementById('file-input');
const dropZone = document.getElementById('drop-zone');
const fileStatus = document.getElementById('file-status');
const groupSelect = document.getElementById('group-select');
const filtersContainer = document.getElementById('filters-container');
const categoryCheckboxes = document.getElementById('category-checkboxes');
const chartsWrapper = document.getElementById('charts-wrapper');

// Tab Switching Logic
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        // Remove active class from all buttons and panes
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        
        // Add active class to clicked button and target pane
        e.target.classList.add('active');
        const targetId = e.target.getAttribute('data-target');
        document.getElementById(targetId).classList.add('active');

        // Resize plots to fix layout issues when tabs are hidden initially
        const plotIds = ['plot-ctdi-hist', 'plot-dlp-hist', 'plot-ctdi-box', 'plot-dlp-box', 'plot-ctdi-line', 'plot-dlp-line'];
        plotIds.forEach(id => {
            const el = document.getElementById(id);
            if(el) Plotly.Plots.resize(el);
        });
    });
});

// Drag and Drop Logic
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
        handleFile(e.dataTransfer.files[0]);
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) {
        handleFile(e.target.files[0]);
    }
});

// File Handling & Parsing
function handleFile(file) {
    if(!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
        fileStatus.textContent = '❌ 請上傳有效的 Excel (.xlsx) 檔案';
        return;
    }

    fileStatus.textContent = `⏳ 解析中: ${file.name}...`;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, {type: 'array', cellDates: true});
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            
            // Convert to JSON
            const json = XLSX.utils.sheet_to_json(worksheet, {raw: false});
            
            // Column Mapping (Robust Search)
            const keys = Object.keys(json[0] || {});
            const findCol = (keywords) => keys.find(k => keywords.some(kw => k.toLowerCase().replace(/[\s\(\)_]/g,'').includes(kw.toLowerCase())));
            
            const colMap = {
                protocol: findCol(['AcquisitionProtocol', 'Protocol', 'ExamName', 'Procedure']),
                region: findCol(['TargetRegion', 'Region', 'BodyPart', 'Location']),
                description: findCol(['StudyDescription', 'Description']),
                ctdi: findCol(['MeanCTDIvol', 'CTDIvol', 'CTDI']),
                dlp: findCol(['DLP', 'TotalDLP']),
                date: findCol(['StudyDate', 'Study Date', 'Date', 'ExaminationDate', 'ExamDate', 'ReportDate'])
            };

            globalData = json.map(row => {
                // 1. Map content to standard internal keys
                row['Acquisition Protocol'] = String(row[colMap.protocol] || 'Unknown').trim();
                row['Target Region'] = String(row[colMap.region] || 'Unknown').trim();
                row['StudyDescription'] = String(row[colMap.description] || 'Unknown').trim();
                
                // 2. Numeric parsing
                row['Mean CTDIvol (mGy)'] = parseFloat(row[colMap.ctdi]) || null;
                row['DLP (mGy.cm)'] = parseFloat(row[colMap.dlp]) || null;
                
                // 3. Date Parsing
                let dateStr = row[colMap.date] ? String(row[colMap.date]).trim() : '';
                if(dateStr) {
                    // DICOM format YYYYMMDD
                    if(/^\d{8}$/.test(dateStr)) {
                        dateStr = dateStr.slice(0,4) + '-' + dateStr.slice(4,6) + '-' + dateStr.slice(6,8);
                    }
                    dateStr = dateStr.replace(/\//g, '-');
                    const ts = new Date(dateStr).getTime();
                    if(!isNaN(ts)) row._timestamp = ts;
                }
                return row;
            }).filter(row => row['Mean CTDIvol (mGy)'] !== null || row['DLP (mGy.cm)'] !== null);

            fileStatus.textContent = `✅ 成功讀取 ${globalData.length} 筆紀錄`;
            filtersContainer.style.display = 'flex';
            chartsWrapper.style.opacity = '1';
            chartsWrapper.style.pointerEvents = 'all';
            
            renderCheckboxes();
            updateDashboard();

        } catch (err) {
            console.error(err);
            fileStatus.textContent = '❌ 解析 Excel 失敗 (詳見開發者工具主控台)';
        }
    };
    reader.readAsArrayBuffer(file);
}

// Group Selection
groupSelect.addEventListener('change', (e) => {
    currentGroup = e.target.value;
    renderCheckboxes();
    updateDashboard();
});

// Select / Deselect All
document.getElementById('btn-select-all').addEventListener('click', () => {
    document.querySelectorAll('.cat-checkbox').forEach(cb => cb.checked = true);
    updateActiveFilters();
});

document.getElementById('btn-deselect-all').addEventListener('click', () => {
    document.querySelectorAll('.cat-checkbox').forEach(cb => cb.checked = false);
    updateActiveFilters();
});

// Render Dynamic Checkboxes (Tree Structure)
function renderCheckboxes() {
    if (globalData.length === 0) return;
    
    // 1. Get unique categories for current group
    const uniqueCats = new Set();
    globalData.forEach(r => uniqueCats.add(r[currentGroup]));
    const sortedCats = Array.from(uniqueCats).sort();
    
    // 2. Build Tree Structure
    const tree = {};
    activeFilters.clear();
    
    sortedCats.forEach(cat => {
        activeFilters.add(cat); // Default all leaf nodes to active
        // Split by standard dash, full-width dash, or underscore
        const parts = cat.split(/[-－_]/).map(s => s.trim()).filter(s => s);
        
        // If it can't be split, or only has 1 part, put it in root
        if(parts.length <= 1) {
            tree[cat] = { _isLeaf: true, originalValue: cat };
            return;
        }

        // Build nested object
        let currentLevel = tree;
        for(let i=0; i<parts.length; i++) {
            const part = parts[i];
            if(i === parts.length - 1) {
                // Leaf node
                currentLevel[part] = { _isLeaf: true, originalValue: cat };
            } else {
                // Folder node
                if(!currentLevel[part]) currentLevel[part] = {};
                currentLevel = currentLevel[part];
            }
        }
    });

    // 3. Render Tree HTML Recursive
    categoryCheckboxes.innerHTML = '';
    
    function buildNode(container, nodeMap, parentPath = '') {
        const keys = Object.keys(nodeMap).filter(k => k !== '_isLeaf' && k !== 'originalValue').sort();
        
        keys.forEach(key => {
            const node = nodeMap[key];
            
            if(node._isLeaf) {
                // Render standard Leaf Checkbox
                const label = document.createElement('label');
                label.className = 'checkbox-item';
                
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.className = 'cat-checkbox leaf-checkbox';
                cb.value = node.originalValue;
                cb.checked = true;
                
                cb.addEventListener('change', updateActiveFilters);
                
                label.appendChild(cb);
                label.appendChild(document.createTextNode(key)); // Show only the final part name
                container.appendChild(label);
            } else {
                // Render Folder (details/summary)
                const details = document.createElement('details');
                details.open = false; // Default collapsed as requested by user
                
                const summary = document.createElement('summary');
                
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.className = 'cat-checkbox folder-checkbox';
                cb.checked = true;
                
                // Clicking the folder checkbox toggles all its children
                cb.addEventListener('change', (e) => {
                    e.stopPropagation(); // Don't trigger details toggle
                    const isChecked = e.target.checked;
                    const childBoxes = details.querySelectorAll('.leaf-checkbox');
                    childBoxes.forEach(childCb => {
                        childCb.checked = isChecked;
                    });
                    // Also update nested folder checkboxes
                    details.querySelectorAll('.folder-checkbox').forEach(fcb => {
                       fcb.checked = isChecked;
                    });
                    updateActiveFilters();
                });

                // Prevent details toggle when clicking checkbox
                cb.addEventListener('click', e => e.stopPropagation());

                summary.appendChild(cb);
                const titleSpan = document.createElement('span');
                titleSpan.textContent = key;
                titleSpan.style.fontWeight = 'bold';
                summary.appendChild(titleSpan);
                
                details.appendChild(summary);
                
                // Container for children
                const groupDiv = document.createElement('div');
                groupDiv.className = 'tree-group';
                
                // Recurse
                buildNode(groupDiv, node);
                
                details.appendChild(groupDiv);
                container.appendChild(details);
            }
        });
    }

    buildNode(categoryCheckboxes, tree);
}

function updateActiveFilters() {
    activeFilters.clear();
    // Only target leaf checkboxes, as they hold the actual 'originalValue' representing the full category name
    document.querySelectorAll('.leaf-checkbox:checked').forEach(cb => {
        activeFilters.add(cb.value);
    });
    
    // Visually update parent folder checkboxes manually based on children
    document.querySelectorAll('details').forEach(details => {
        const folderCb = details.querySelector('summary .folder-checkbox');
        if(folderCb) {
            const leaves = Array.from(details.querySelectorAll('.leaf-checkbox'));
            if(leaves.length > 0) {
                const checkedLeaves = leaves.filter(l => l.checked);
                if (checkedLeaves.length === 0) {
                    folderCb.checked = false;
                    folderCb.indeterminate = false;
                } else if (checkedLeaves.length === leaves.length) {
                    folderCb.checked = true;
                    folderCb.indeterminate = false;
                } else {
                    folderCb.checked = false;
                    folderCb.indeterminate = true;
                }
            }
        }
    });

    updateDashboard();
}

// Update Dashboard UI
function updateDashboard() {
    if (globalData.length === 0) return;

    // Filter data based on active checkboxes
    const filteredData = globalData.filter(row => activeFilters.has(row[currentGroup]));

    // If everything is filtered out, clear charts/metrics
    if (filteredData.length === 0) {
        document.getElementById('val-events').textContent = '0';
        document.getElementById('val-ctdi').textContent = '--';
        document.getElementById('val-dlp').textContent = '--';
        ['plot-ctdi-hist', 'plot-dlp-hist', 'plot-ctdi-box', 'plot-dlp-box', 'plot-ctdi-line', 'plot-dlp-line'].forEach(id => {
            Plotly.purge(id);
        });
        return;
    }

    // Percentile Helper Function
    const getPercentile = (arr, p) => {
        if (arr.length === 0) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        const index = (sorted.length - 1) * p;
        const lower = Math.floor(index);
        const upper = Math.ceil(index);
        const weight = index % 1;
        if (lower === upper) return sorted[lower];
        return sorted[lower] * (1 - weight) + sorted[upper] * weight;
    };

    // 1. Update Metrics (Mean - as requested)
    document.getElementById('val-events').textContent = filteredData.length.toLocaleString();
    
    const allCtdi = filteredData.filter(r => r['Mean CTDIvol (mGy)'] !== null).map(r => r['Mean CTDIvol (mGy)']);
    const allDlp = filteredData.filter(r => r['DLP (mGy.cm)'] !== null).map(r => r['DLP (mGy.cm)']);
    
    const calculateMean = (arr) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    document.getElementById('val-ctdi').textContent = allCtdi.length > 0 ? calculateMean(allCtdi).toFixed(2) : '--';
    document.getElementById('val-dlp').textContent = allDlp.length > 0 ? calculateMean(allDlp).toFixed(2) : '--';

    // Update Date Badge
    const sortedDates = filteredData.filter(r => r._timestamp).map(r => r._timestamp).sort();
    if (sortedDates.length > 0) {
        const minDate = new Date(sortedDates[0]).toISOString().split('T')[0];
        const maxDate = new Date(sortedDates[sortedDates.length - 1]).toISOString().split('T')[0];
        document.getElementById('data-date-range').textContent = `${minDate} to ${maxDate}`;
    }

    // Prepare Grouped Data
    const groups = {};
    filteredData.forEach(row => {
        const g = row[currentGroup];
        if (!groups[g]) groups[g] = { ctdi: [], dlp: [] };
        if (row['Mean CTDIvol (mGy)'] !== null) groups[g].ctdi.push(row['Mean CTDIvol (mGy)']);
        if (row['DLP (mGy.cm)'] !== null) groups[g].dlp.push(row['DLP (mGy.cm)']);
    });

    const categories = Object.keys(groups).sort();

    // Arrays for Plotly Boxplots
    const boxCtdiData = [];
    const boxDlpData = [];
    
    // Arrays for Plotly Histograms (Grouped Bar Charts)
    const avgCtdiX = [];
    const avgCtdiY_Mean = [];
    const avgCtdiY_Q2 = [];
    const avgCtdiY_Q3 = [];
    
    const avgDlpX = [];
    const avgDlpY_Mean = [];
    const avgDlpY_Q2 = [];
    const avgDlpY_Q3 = [];

    categories.forEach(cat => {
        const c_arr = groups[cat].ctdi;
        const d_arr = groups[cat].dlp;

        if (c_arr.length > 0) {
            boxCtdiData.push({ y: c_arr, type: 'box', name: cat, marker: {color: colors.teal} });
            avgCtdiX.push(cat);
            avgCtdiY_Mean.push(c_arr.reduce((a, b) => a + b, 0) / c_arr.length);
            avgCtdiY_Q2.push(getPercentile(c_arr, 0.50));
            avgCtdiY_Q3.push(getPercentile(c_arr, 0.75));
        }
        if (d_arr.length > 0) {
            boxDlpData.push({ y: d_arr, type: 'box', name: cat, marker: {color: colors.purple} });
            avgDlpX.push(cat);
            avgDlpY_Mean.push(d_arr.reduce((a, b) => a + b, 0) / d_arr.length);
            avgDlpY_Q2.push(getPercentile(d_arr, 0.50));
            avgDlpY_Q3.push(getPercentile(d_arr, 0.75));
        }
    });

    // --- Render Histograms (Mean with Q2 and Q3 overlaid as points) ---
    Plotly.newPlot('plot-ctdi-hist', [
        { x: avgCtdiX, y: avgCtdiY_Mean, type: 'bar', name: '平均值 (Mean)', marker: { color: 'rgba(59, 130, 246, 0.3)', line: {color: colors.blue, width: 1} } },
        { x: avgCtdiX, y: avgCtdiY_Q2, type: 'scatter', mode: 'markers', name: 'P50 (Q2)', marker: { symbol: 'diamond', size: 10, color: colors.teal } },
        { x: avgCtdiX, y: avgCtdiY_Q3, type: 'scatter', mode: 'markers', name: 'P75 (Q3)', marker: { symbol: 'line-ew', size: 16, line: { color: '#ffffff', width: 2 } } }
    ], Object.assign({}, plotLayoutBase, {
        showlegend: true,
        legend: { font: {color: '#94A3B8'}, orientation: "h", y: 1.15 },
        yaxis: { ...plotLayoutBase.yaxis, title: 'CTDIvol (mGy)' }
    }), {responsive: true});

    Plotly.newPlot('plot-dlp-hist', [
        { x: avgDlpX, y: avgDlpY_Mean, type: 'bar', name: '平均值 (Mean)', marker: { color: 'rgba(59, 130, 246, 0.3)', line: {color: colors.blue, width: 1} } },
        { x: avgDlpX, y: avgDlpY_Q2, type: 'scatter', mode: 'markers', name: 'P50 (Q2)', marker: { symbol: 'diamond', size: 10, color: colors.purple } },
        { x: avgDlpX, y: avgDlpY_Q3, type: 'scatter', mode: 'markers', name: 'P75 (Q3)', marker: { symbol: 'line-ew', size: 16, line: { color: '#ffffff', width: 2 } } }
    ], Object.assign({}, plotLayoutBase, {
        showlegend: true,
        legend: { font: {color: '#94A3B8'}, orientation: "h", y: 1.15 },
        yaxis: { ...plotLayoutBase.yaxis, title: 'DLP (mGy.cm)' }
    }), {responsive: true});

    // --- Render Boxplots ---
    Plotly.newPlot('plot-ctdi-box', boxCtdiData, Object.assign({}, plotLayoutBase, {
        yaxis: { ...plotLayoutBase.yaxis, title: 'CTDIvol (mGy)' }, showlegend: false
    }), {responsive: true});

    Plotly.newPlot('plot-dlp-box', boxDlpData, Object.assign({}, plotLayoutBase, {
        yaxis: { ...plotLayoutBase.yaxis, title: 'DLP (mGy.cm)' }, showlegend: false
    }), {responsive: true});


    // --- Render Line Charts (Trend over time) ---
    // Group by Date + Category
    const timeGroupsCtdi = {}; // { 'Protocol': { timestamp1: [vals], timestamp2: [vals] } }
    const timeGroupsDlp = {};

    filteredData.forEach(row => {
        if (!row._timestamp) return;
        const g = row[currentGroup];
        const t = row._timestamp;
        
        if (row['Mean CTDIvol (mGy)'] !== null) {
            if (!timeGroupsCtdi[g]) timeGroupsCtdi[g] = {};
            if (!timeGroupsCtdi[g][t]) timeGroupsCtdi[g][t] = [];
            timeGroupsCtdi[g][t].push(row['Mean CTDIvol (mGy)']);
        }
        if (row['DLP (mGy.cm)'] !== null) {
            if (!timeGroupsDlp[g]) timeGroupsDlp[g] = {};
            if (!timeGroupsDlp[g][t]) timeGroupsDlp[g][t] = [];
            timeGroupsDlp[g][t].push(row['DLP (mGy.cm)']);
        }
    });

    const createLineTraces = (dataDict, baseName) => {
        const traces = [];
        Object.keys(dataDict).forEach(cat => {
            const timeMap = dataDict[cat];
            const sortedTimes = Object.keys(timeMap).map(Number).sort();
            const x = [];
            const y_mean = [];
            const y_q2 = [];
            const y_q3 = [];
            
            sortedTimes.forEach(time => {
                const arr = timeMap[time];
                x.push(new Date(time).toISOString().split('T')[0]);
                y_mean.push(arr.reduce((a,b)=>a+b,0)/arr.length);
                y_q2.push(getPercentile(arr, 0.5));
                y_q3.push(getPercentile(arr, 0.75));
            });

            // For clarity, we only add markers/lines for Mean, and maybe subtle lines for others
            // Or just add all three. Let's add all three with consistent naming.
            traces.push({
                x: x, y: y_mean, mode: 'lines+markers', name: `${cat} (Mean)`,
                line: {shape: 'spline', smoothing: 1.3}
            });
            traces.push({
                x: x, y: y_q2, mode: 'lines', name: `${cat} (Q2)`,
                line: {dash: 'dash', width: 1, shape: 'spline'}
            });
            traces.push({
                x: x, y: y_q3, mode: 'lines', name: `${cat} (Q3)`,
                line: {dash: 'dot', width: 1, shape: 'spline'}
            });
        });
        return traces;
    };

    Plotly.newPlot('plot-ctdi-line', createLineTraces(timeGroupsCtdi, 'CTDIvol'), Object.assign({}, plotLayoutBase, {
        showlegend: true, legend: { font: {color: '#94A3B8'}, orientation: "h", y: -0.2 }, 
        yaxis: { ...plotLayoutBase.yaxis, title: 'CTDIvol (mGy)' }
    }), {responsive: true});

    Plotly.newPlot('plot-dlp-line', createLineTraces(timeGroupsDlp, 'DLP'), Object.assign({}, plotLayoutBase, {
        showlegend: true, legend: { font: {color: '#94A3B8'}, orientation: "h", y: -0.2 },
        yaxis: { ...plotLayoutBase.yaxis, title: 'DLP (mGy.cm)' }
    }), {responsive: true});
}
