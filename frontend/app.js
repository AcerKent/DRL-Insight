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
        fileStatus.textContent = '❌ 請上傳 Excel (.xlsx) 格式檔案';

        return;
    }

    fileStatus.textContent = `⏳ 正在讀取 ${file.name}...`;


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
                manufacturer: findCol(['Manufacturer', 'Make', 'Brand', 'Vendor']),
                ctdi: findCol(['MeanCTDIvol', 'CTDIvol', 'CTDI']),
                dlp: findCol(['DLP', 'TotalDLP']),
                scanLength: findCol(['ScanningLength', 'ScanLength', 'Length']),
                filename: findCol(['FilePath', 'FileName', 'File Name', 'SeriesFile', 'StudyUID', 'Filename', 'Name']),
                date: findCol(['StudyDate', 'Study Date', 'Date', 'ExaminationDate', 'ExamDate', 'ReportDate'])
            };

            globalData = json.map(row => {
                // 1. Map content to standard internal keys
                row['Acquisition Protocol'] = String(row[colMap.protocol] || 'Unknown').trim();
                row['Target Region'] = String(row[colMap.region] || 'Unknown').trim();
                row['StudyDescription'] = String(row[colMap.description] || 'Unknown').trim();
                row['Manufacturer'] = String(row[colMap.manufacturer] || 'Unknown').trim();
                
                // 2. Numeric parsing
                row['Mean CTDIvol (mGy)'] = parseFloat(row[colMap.ctdi]) || null;
                row['DLP (mGy.cm)'] = parseFloat(row[colMap.dlp]) || null;
                row['_scanLength'] = parseFloat(row[colMap.scanLength]) || null;
                row['_filename'] = colMap.filename ? String(row[colMap.filename] || '').trim() : '';
                
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

            // --- Compute per-study LW-CTDIv ---
            // Group series rows by filename, then compute length-weighted CTDIvol for each study
            const studyAccum = {}; // { filename: { sumCL: 0, sumL: 0, rows: [] } }
            globalData.forEach(row => {
                const fname = row['_filename'] || `__nofile_${Math.random()}`;
                if (!studyAccum[fname]) studyAccum[fname] = { sumCL: 0, sumL: 0 };
                const ctdi = row['Mean CTDIvol (mGy)'];
                const len  = row['_scanLength'];
                if (ctdi !== null && len !== null) {
                    studyAccum[fname].sumCL += ctdi * len;
                    studyAccum[fname].sumL  += len;
                }
            });

            // studyLWCTDI: { filename -> LW-CTDIv value }
            window.studyLWCTDI = {};
            Object.keys(studyAccum).forEach(fname => {
                const { sumCL, sumL } = studyAccum[fname];
                window.studyLWCTDI[fname] = sumL > 0 ? sumCL / sumL : null;
            });

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

// Render Dynamic Checkboxes (Flat List)
function renderCheckboxes() {
    if (globalData.length === 0) return;
    
    // 1. Get unique categories for current group
    const uniqueCats = new Set();
    globalData.forEach(r => uniqueCats.add(r[currentGroup]));
    const sortedCats = Array.from(uniqueCats).sort();
    
    activeFilters.clear();
    categoryCheckboxes.innerHTML = '';
    
    // 2. Render flat checkbox for each category
    sortedCats.forEach(cat => {
        activeFilters.add(cat); // Default all to active
        
        const label = document.createElement('label');
        label.className = 'checkbox-item';
        
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'cat-checkbox';
        cb.value = cat;
        cb.checked = true;
        cb.addEventListener('change', updateActiveFilters);
        
        label.appendChild(cb);
        label.appendChild(document.createTextNode(cat));
        categoryCheckboxes.appendChild(label);
    });
}

function updateActiveFilters() {
    activeFilters.clear();
    document.querySelectorAll('.cat-checkbox:checked').forEach(cb => {
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

    // 1. Update Summary Metrics
    document.getElementById('val-events').textContent = filteredData.length.toLocaleString();
    
    // Collect unique per-study LW-CTDIv values from filtered data
    const seenFilesAll = new Set();
    const allLwCtdi = [];
    filteredData.forEach(r => {
        const fname = r['_filename'];
        if (!seenFilesAll.has(fname)) {
            seenFilesAll.add(fname);
            const v = window.studyLWCTDI && window.studyLWCTDI[fname];
            if (v != null) allLwCtdi.push(v);
        }
    });
    const allDlp = filteredData.filter(r => r['DLP (mGy.cm)'] !== null).map(r => r['DLP (mGy.cm)']);
    const calculateMean = (arr) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    document.getElementById('val-ctdi').textContent = allLwCtdi.length > 0 ? calculateMean(allLwCtdi).toFixed(2) : '--';
    document.getElementById('val-dlp').textContent = allDlp.length > 0 ? calculateMean(allDlp).toFixed(2) : '--';

    // Update Date Badge
    const sortedDates = filteredData.filter(r => r._timestamp).map(r => r._timestamp).sort();
    if (sortedDates.length > 0) {
        const minDate = new Date(sortedDates[0]).toISOString().split('T')[0];
        const maxDate = new Date(sortedDates[sortedDates.length - 1]).toISOString().split('T')[0];
        document.getElementById('data-date-range').textContent = `${minDate} to ${maxDate}`;
    }

    // Prepare Grouped Data (per-study LW-CTDIv deduplication)
    const groups = {};
    const seenStudyPerCat = new Set(); // track (filename, category) pairs to avoid double-counting
    filteredData.forEach(row => {
        const g = row[currentGroup];
        const fname = row['_filename'];
        const studyKey = `${fname}||${g}`;
        if (!groups[g]) groups[g] = { ctdi: [], dlp: [] };
        
        // LW-CTDIv: only add once per study per category
        if (!seenStudyPerCat.has(studyKey)) {
            seenStudyPerCat.add(studyKey);
            const lwv = window.studyLWCTDI && window.studyLWCTDI[fname];
            if (lwv != null) groups[g].ctdi.push(lwv);
        }
        // DLP: per series (keep existing behaviour)
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
        { x: avgCtdiX, y: avgCtdiY_Mean, type: 'bar', name: '加權平均 (LW Mean)', marker: { color: 'rgba(59, 130, 246, 0.3)', line: {color: colors.blue, width: 1} } },
        { x: avgCtdiX, y: avgCtdiY_Q2, type: 'scatter', mode: 'markers', name: 'P50 (Q2)', marker: { symbol: 'diamond', size: 10, color: colors.teal } },
        { x: avgCtdiX, y: avgCtdiY_Q3, type: 'scatter', mode: 'markers', name: 'P75 (Q3)', marker: { symbol: 'line-ew', size: 16, line: { color: '#ffffff', width: 2 } } }
    ], Object.assign({}, plotLayoutBase, {
        showlegend: true,
        legend: { font: {color: '#94A3B8'}, orientation: "h", y: 1.15 },
        yaxis: { ...plotLayoutBase.yaxis, title: 'LW-CTDIv (mGy)' }
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
        yaxis: { ...plotLayoutBase.yaxis, title: 'LW-CTDIv (mGy)' }, showlegend: false
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
        const fname = row['_filename'];
        const studyTimeKey = `${fname}||${g}||${t}`;
        
        // For LW-CTDIv trend: only add one data point per study per (category, date)
        if (!window._trendSeen) window._trendSeen = new Set();
        if (!window._trendSeen.has(studyTimeKey)) {
            window._trendSeen.add(studyTimeKey);
            const lwv = window.studyLWCTDI && window.studyLWCTDI[fname];
            if (lwv != null) {
                if (!timeGroupsCtdi[g]) timeGroupsCtdi[g] = {};
                if (!timeGroupsCtdi[g][t]) timeGroupsCtdi[g][t] = [];
                timeGroupsCtdi[g][t].push(lwv);
            }
        }
        if (row['DLP (mGy.cm)'] !== null) {
            if (!timeGroupsDlp[g]) timeGroupsDlp[g] = {};
            if (!timeGroupsDlp[g][t]) timeGroupsDlp[g][t] = [];
            timeGroupsDlp[g][t].push(row['DLP (mGy.cm)']);
        }
    });
    window._trendSeen = null; // reset for next call

    const createLineTraces = (dataDict, baseName) => {
        const traces = [];
        Object.keys(dataDict).forEach(cat => {
            const timeMap = dataDict[cat];
            const sortedTimes = Object.keys(timeMap).map(Number).sort();
            const x = [];
            const y_mean = [];
                                    
            sortedTimes.forEach(time => {
                const arr = timeMap[time];
                x.push(new Date(time).toISOString().split('T')[0]);
                y_mean.push(arr.reduce((a,b)=>a+b,0)/arr.length);
                                            });

            // For clarity, we only add markers/lines for Mean
                        traces.push({
                x: x, y: y_mean, mode: 'lines+markers', name: `${cat} (LW Mean)`,
                line: {shape: 'spline', smoothing: 1.3}
            });
        });
        return traces;
    };

    Plotly.newPlot('plot-ctdi-line', createLineTraces(timeGroupsCtdi, 'LW-CTDIv'), Object.assign({}, plotLayoutBase, {
        showlegend: true, legend: { font: {color: '#94A3B8'}, orientation: "h", y: -0.2 }, 
        yaxis: { ...plotLayoutBase.yaxis, title: 'LW-CTDIv (mGy)' }
    }), {responsive: true});

    Plotly.newPlot('plot-dlp-line', createLineTraces(timeGroupsDlp, 'DLP'), Object.assign({}, plotLayoutBase, {
        showlegend: true, legend: { font: {color: '#94A3B8'}, orientation: "h", y: -0.2 },
        yaxis: { ...plotLayoutBase.yaxis, title: 'DLP (mGy.cm)' }
    }), {responsive: true});
}

// Function to open chart in a new tab standalone
function openChartInNewTab(chartId, titleStr) {
    const gd = document.getElementById(chartId);
    if (!gd || !gd.data || gd.data.length === 0) return;

    // Deep clone data and layout to avoid referencing issues
    const data = JSON.parse(JSON.stringify(gd.data));
    const layout = JSON.parse(JSON.stringify(gd.layout));
    
    // Adjust layout for a full-page view
    layout.width = window.innerWidth * 0.9;
    layout.height = window.innerHeight * 0.85;
    layout.paper_bgcolor = '#0B0F19';
    layout.plot_bgcolor = '#0B0F19';
    layout.font = { color: '#E2E8F0', family: 'Inter, sans-serif' };

    const newWin = window.open('', '_blank');
    if (!newWin) {
        alert("請允許瀏覽器彈出新視窗！");
        return;
    }

    newWin.document.write(`
        <!DOCTYPE html>
        <html lang="zh-TW">
        <head>
            <meta charset="UTF-8">
            <title>${titleStr} - DRL Dashboard</title>
            <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
            <style>
                body {
                    margin: 0;
                    padding: 20px;
                    background-color: #0B0F19;
                    color: white;
                    font-family: 'Inter', sans-serif;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    min-height: 100vh;
                }
                h1 {
                    font-size: 1.5rem;
                    font-weight: 500;
                    margin-bottom: 20px;
                }
                #plot-container {
                    width: 90vw;
                    height: 85vh;
                }
            </style>
        </head>
        <body>
            <h1>${titleStr}</h1>
            <div id="plot-container"></div>
            <script>
                const data = ${JSON.stringify(data)};
                const layout = ${JSON.stringify(layout)};
                const config = { responsive: true, displayModeBar: true };
                Plotly.newPlot('plot-container', data, layout, config);
                
                // Keep chart sized to window
                window.addEventListener('resize', () => {
                    Plotly.relayout('plot-container', {
                        width: window.innerWidth * 0.9,
                        height: window.innerHeight * 0.85
                    });
                });
            </script>
        </body>
        </html>
    `);
    newWin.document.close();
}
