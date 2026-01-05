/**
 * Matephis Plotter - Main Logic
 */

// Default Configuration State
const DEFAULT_STATE = {
    // Auto size (fill container)
    width: null, 
    height: null,
    xlim: [-9.9, 9.9],
    ylim: [-9.9, 9.9],
    aspectRatio: "1:1",
    theme: "red",
    border: true,
    axisLabels: ["x", "y"], 
    
    // Axis Visibility
    showXNumbers: true,
    showYNumbers: true,
    showXTicks: false,
    showYTicks: false,
    
    interactive: true,
    gridOpacity: 0.8,
    
    // Legend
    legend: false,
    legendPosition: 'top-right',
    
    // Params
    params: {
        "a": { val: 1, min: -5, max: 5, step: 0.1 },
    },
    data: [
        { type: "fun", fn: "x^2", color: "red", width: 2 }
    ]
};

let appState = JSON.parse(JSON.stringify(DEFAULT_STATE));

document.addEventListener("DOMContentLoaded", () => {
    init();
});

function init() {
    loadState();
    bindGlobalEvents();
    syncUIToState();
    setupCollapsibles();
    initSidebarResizer();
    updatePlot(); // Ensure plot is visible on reload
}

// ... existing loadState ...

function initSidebarResizer() {
    const resizer = document.getElementById("json-resizer");
    const panel = document.getElementById("json-section-wrapper");
    const header = document.getElementById("json-collapse-header");
    const icon = document.getElementById("json-collapse-icon");
    
    let isResizing = false;
    let lastDownY = 0;
    let startHeight = 0;

    // Toggle Collapse
    header.addEventListener("click", () => {
        if (isResizing) return;
        const isCollapsed = panel.classList.toggle("collapsed");
        icon.innerText = isCollapsed ? "expand_less" : "expand_more"; // Swapped logic standard
        
        // If expanding, ensure we have a decent height if it was crushed
        if (!isCollapsed && panel.getBoundingClientRect().height < 100) {
           panel.style.height = "250px";
        }
    });

    // Resize Logic
    resizer.addEventListener("mousedown", (e) => {
        isResizing = true;
        lastDownY = e.clientY;
        startHeight = panel.getBoundingClientRect().height;
        panel.classList.add("resizing"); // Disable transition
        document.body.style.cursor = "ns-resize";
        e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
        if (!isResizing) return;
        const delta = lastDownY - e.clientY; // Drag up -> Increase height
        const newHeight = startHeight + delta;
        
        // Constraints
        const maxH = window.innerHeight - 150; // Keep some top space
        if (newHeight > 48 && newHeight < maxH) {
            panel.style.height = newHeight + "px";
        }
    });

    document.addEventListener("mouseup", () => {
        if (isResizing) {
            isResizing = false;
            panel.classList.remove("resizing");
            document.body.style.cursor = "";
            
            // If user dragged it very small, maybe snap to collapse?
            if (panel.getBoundingClientRect().height < 50) {
                 panel.classList.add("collapsed");
                 panel.style.height = ""; // Reset inline to allow CSS to handle it? OR keep it.
                 // Better: set specific collapsed height or remove inline to let class win
                 icon.innerText = "expand_less";
            } else {
                 panel.classList.remove("collapsed");
                 icon.innerText = "expand_more";
            }
        }
    });
}

function loadState() {
    try {
        const stored = localStorage.getItem("matephis-plotter-state");
        if (stored) {
            const loaded = JSON.parse(stored);
            appState = { ...DEFAULT_STATE, ...loaded };
            if(loaded.data) appState.data = loaded.data;
            if(loaded.params) appState.params = loaded.params;
        }
    } catch (e) {
        console.warn("Failed to load state", e);
    }
}

function saveState() {
    try {
        localStorage.setItem("matephis-plotter-state", JSON.stringify(appState));
    } catch (e) {
        console.warn("Failed to save state", e);
    }
}

function updatePlot() {
    const container = document.getElementById("plot-target");
    
    // Auto-size Logic
    if (appState.width === null && appState.height === null) {
        container.classList.add("plot-auto-size");
        container.style.width = "";
        container.style.height = "";
        container.style.aspectRatio = "1/1";
    } else {
        container.classList.remove("plot-auto-size");
        // Apply manual size if specified, allowing container to grow/shrink
        if (appState.width) container.style.width = appState.width + "px";
        if (appState.height) container.style.height = appState.height + "px";
        
        // Remove enforced aspect ratio if not auto (let library handle it or user params)
        // If appState.aspectRatio is set, the library usually handles the VIEWBOX.
        // We shouldn't force container aspect ratio unless we want to clip it.
        container.style.aspectRatio = ""; 
    }

    container.innerHTML = "";
    saveState();
    try {
        const config = cleanStateForLib(appState);
        const jsonString = JSON.stringify(config);
        if (typeof MatephisPlot !== 'undefined') {
            new MatephisPlot(container, jsonString);
        } else {
            console.warn("MatephisPlot library not loaded.");
            container.innerHTML = "Error: Library not loaded.";
        }
    } catch (e) {
        console.error("Render Error:", e);
        container.innerHTML = `Error: ${e.message}`;
    }
}

function cleanStateForLib(state) {
    const config = JSON.parse(JSON.stringify(state));
    
    // Compact Size: Only include if set
    if (!config.width) {
        config.fullWidth = true; // Still need this for library responsiveness
        delete config.width;
    } else {
        config.width = parseInt(config.width);
    }
    
    if (!config.height) delete config.height;
    else config.height = parseInt(config.height);
    
    // Compact Defaults
    if (!config.xStep) delete config.xStep;
    if (!config.yStep) delete config.yStep;
    if (!config.xStepSecondary) delete config.xStepSecondary;
    if (!config.yStepSecondary) delete config.yStepSecondary;
    
    if (!config.legend) delete config.legend;
    if (!config.legendSize) delete config.legendSize;
    if (!config.legendWidth) delete config.legendWidth;
    if (config.legendPosition === 'top-right') delete config.legendPosition; // Default
    
    if (!config.padding) delete config.padding;
    if (config.gridOpacity === 0.8) delete config.gridOpacity; 
    
    // Axis visibility defaults (assuming true is default)
    if (config.showXNumbers === true) delete config.showXNumbers;
    if (config.showYNumbers === true) delete config.showYNumbers;
    if (config.showXTicks === false) delete config.showXTicks;
    if (config.showYTicks === false) delete config.showYTicks;

    if (config.theme === 'default') delete config.theme;

    config.showSliders = false;
    
    if (config.data) {
        config.data.forEach(item => {
            delete item.type;
            if (!item.dash) delete item.dash;
            if (!item.domain) delete item.domain;
            if (!item.label) delete item.label;
            if (!item.labelAt) delete item.labelAt;
            
            if (item.width === 2) delete item.width; // Default width
            else if (item.width) item.width = parseFloat(item.width);
            
            if (item.opacity) item.opacity = parseFloat(item.opacity);
            if (item.color === 'red' && config.theme === 'red') delete item.color; // Contextual default? Maybe risky.
        });
    }
    return config;
}

function bindGlobalEvents() {
    bindInput("g-width", "width", true);
    bindInput("g-height", "height", true);
    bindLimitInput("g-xmin", "xlim", 0);
    bindLimitInput("g-xmax", "xlim", 1);
    bindLimitInput("g-ymin", "ylim", 0);
    bindLimitInput("g-ymax", "ylim", 1);
    bindInput("g-aspect", "aspectRatio");
    bindInput("g-padding", "padding", true);
    
    bindInput("g-xstep", "xStep", true);
    bindInput("g-ystep", "yStep", true);
    
    document.getElementById("g-legend").onchange = (e) => { appState.legend = e.target.checked; refresh(); };
    bindInput("g-legendsize", "legendSize", true);
    // document.getElementById("g-legendwidth") removed from UI? No, check if still there.
    // I simplified Index.html but kept ids? No, let's check bound ids in HTML.
    // If IDs are missing, bindInput fails gracefully.
    bindInput("g-legendwidth", "legendWidth", true);
    document.getElementById("g-legendpos").onchange = (e) => { appState.legendPosition = e.target.value; refresh(); };
    
    document.getElementById("g-shownumbers-x").onchange = (e) => { appState.showXNumbers = e.target.checked; refresh(); };
    document.getElementById("g-shownumbers-y").onchange = (e) => { appState.showYNumbers = e.target.checked; refresh(); };
    document.getElementById("g-showticks-x").onchange = (e) => { appState.showXTicks = e.target.checked; refresh(); };
    document.getElementById("g-showticks-y").onchange = (e) => { appState.showYTicks = e.target.checked; refresh(); };
    
    document.getElementById("g-xlabel").oninput = (e) => {
         if (!appState.axisLabels) appState.axisLabels = ["", ""];
         appState.axisLabels[0] = e.target.value; refresh();
    };
    document.getElementById("g-ylabel").oninput = (e) => {
         if (!appState.axisLabels) appState.axisLabels = ["", ""];
         appState.axisLabels[1] = e.target.value; refresh();
    };

    document.getElementById("g-interactive").onchange = (e) => { appState.interactive = e.target.checked; refresh(); };

    document.getElementById("g-grid").onchange = (e) => {
        appState.gridOpacity = e.target.checked ? 0.5 : 0;
        appState.grid = e.target.checked;
        appState.showGrid = e.target.checked; refresh();
    };
    
    document.getElementById("g-theme").onchange = (e) => { appState.theme = e.target.value; refresh(); };
    document.getElementById("refresh-btn").onclick = () => updatePlot();
    
    document.getElementById("copy-json-btn").onclick = () => {
        navigator.clipboard.writeText(JSON.stringify(cleanStateForLib(appState), null, 2));
    };
    
    document.getElementById("update-from-json-btn").onclick = () => {
        try {
            const raw = document.getElementById("json-editor").value;
            const newState = JSON.parse(raw);
            if (newState.data) {
                newState.data.forEach(d => {
                    if(!d.type) {
                        if(d.fn) d.type = 'fun';
                        else if(d.points) d.type = 'point'; 
                        else if(d.implicit) d.type = 'implicit';
                        else if(d.x !== undefined) d.type = 'xline';
                        else d.type = 'fun';
                    }
                });
            }
            appState = newState;
            syncUIToState(); updatePlot();
        } catch (e) { alert("Invalid JSON"); }
    };
}

function syncUIToState() {
    document.getElementById("g-width").value = appState.width || "";
    document.getElementById("g-height").value = appState.height || "";
    document.getElementById("g-xmin").value = appState.xlim[0];
    document.getElementById("g-xmax").value = appState.xlim[1];
    document.getElementById("g-ymin").value = appState.ylim[0];
    document.getElementById("g-ymax").value = appState.ylim[1];
    document.getElementById("g-aspect").value = appState.aspectRatio;
    document.getElementById("g-padding").value = appState.padding || "";
    
    document.getElementById("g-xstep").value = appState.xStep || "";
    document.getElementById("g-ystep").value = appState.yStep || "";
    
    document.getElementById("g-legend").checked = !!appState.legend;
    document.getElementById("g-legendsize").value = appState.legendSize || "";
    // Check if g-legendwidth exists
    const lw = document.getElementById("g-legendwidth"); if(lw) lw.value = appState.legendWidth || "";
    document.getElementById("g-legendpos").value = appState.legendPosition || "top-right";
    
    document.getElementById("g-shownumbers-x").checked = appState.showXNumbers !== false;
    document.getElementById("g-shownumbers-y").checked = appState.showYNumbers !== false;
    document.getElementById("g-showticks-x").checked = appState.showXTicks === true;
    document.getElementById("g-showticks-y").checked = appState.showYTicks === true;

    document.getElementById("g-interactive").checked = appState.interactive !== false;
    document.getElementById("g-grid").checked = appState.grid !== false;
    document.getElementById("g-theme").value = appState.theme || 'default';
    
    if (appState.axisLabels && Array.isArray(appState.axisLabels)) {
        document.getElementById("g-xlabel").value = appState.axisLabels[0] || "";
        document.getElementById("g-ylabel").value = appState.axisLabels[1] || "";
    }
    
    renderParams();
    renderItems();
    updateJSONEditor();
}

function bindInput(id, key, isNum = false) {
    const el = document.getElementById(id); if(!el) return;
    el.oninput = (e) => {
        let val = e.target.value;
        if (val === "") val = null;
        else if (isNum) val = parseFloat(val);
        appState[key] = val; updateJSONEditor(); updatePlot();
    };
}
function bindLimitInput(id, arrayName, index) {
    const el = document.getElementById(id);
    el.onchange = (e) => {
        let val = e.target.value;
        if (val === "") {
            val = (index === 0) ? -9.9 : 9.9;
            e.target.value = val;
        }
        if(!appState[arrayName]) appState[arrayName] = [-9.9, 9.9];
        appState[arrayName][index] = parseFloat(val); 
        updateJSONEditor(); updatePlot();
    };
}
function refresh() { updateJSONEditor(); updatePlot(); }
function updateJSONEditor() { 
    // Use custom formatter for "inline" style
    document.getElementById("json-editor").value = formatJSON(cleanStateForLib(appState));
}

function formatJSON(obj) {
    // Custom stringifier to keep objects compact
    let json = JSON.stringify(obj, null, 2);
    
    // Collapse simple arrays like [1, 2] to one line
    json = json.replace(/\[\s+([\d.-]+),\s+([\d.-]+)\s+\]/g, "[$1, $2]");
    
    // Collapse Data Items to single lines if possible
    // We regex replace the "data": [ ... ] block content
    // This is a bit hacky but works for simple structures. 
    // Better: Helper function to stringify specific objects compactly.
    
    const lines = [];
    lines.push("{");
    const keys = Object.keys(obj);
    keys.forEach((key, i) => {
        const val = obj[key];
        let valStr = "";
        
        if (key === 'data' && Array.isArray(val)) {
            valStr = "[\n";
            val.forEach((item, j) => {
                // Stringify item tightly
                let itemStr = "{ ";
                
                // --- CUSTOM ORDERING LOGIC ---
                // Prioritize "type" identifying keys
                const orderedKeys = [];
                // 1. Identification (Infer type since 'type' prop is deleted)
                if (item.fn !== undefined) orderedKeys.push('fn');
                else if (item.implicit !== undefined) orderedKeys.push('implicit');
                else if (item.points !== undefined) orderedKeys.push('points');
                else if (item.x !== undefined) orderedKeys.push('x');
                
                // 2. Common props
                // 'type' is usually deleted, so we don't handle it here.
                
                // 3. Other properties
                Object.keys(item).forEach(k => {
                   if (!orderedKeys.includes(k) && k !== 'type') orderedKeys.push(k);
                });
                
                orderedKeys.forEach((k, m) => {
                    let v = item[k];
                    // Omissions
                    if (k === 'color' && !v) return; // Skip empty color
                    if (k === 'color' && v === 'red' && obj.theme === 'red') return; // Skip red if default
                    
                    if (Array.isArray(v)) v = JSON.stringify(v).replace(/,/g, ", ");
                    else if (typeof v === 'string') v = `"${v}"`;
                    
                    itemStr += `"${k}": ${v}`;
                    if (m < orderedKeys.length - 1) itemStr += ", ";
                });
                // Trim trailing comma if any (from skipped items)
                itemStr = itemStr.replace(/, $/, ""); 
                
                itemStr += " }";
                valStr += "    " + itemStr;
                if (j < val.length - 1) valStr += ",";
                valStr += "\n";
            });
            valStr += "  ]";
        } else if (key === 'xlim' || key === 'ylim') {
            valStr = JSON.stringify(val).replace(/,/g, ", "); 
        } else if (key === 'params') {
             valStr = JSON.stringify(val, null, 2).replace(/\n/g, "\n  "); 
        } else {
            valStr = JSON.stringify(val);
        }
        
        lines.push(`  "${key}": ${valStr}` + (i < keys.length - 1 ? "," : ""));
    });
    lines.push("}");
    return lines.join("\n");
}

// ==========================================
// RENDER PARAMS (New Style: .component-row)
// ==========================================
function renderParams() {
    const list = document.getElementById("params-list"); list.innerHTML = "";
    if (!appState.params) appState.params = {};
    Object.keys(appState.params).forEach(key => {
        const p = appState.params[key];
        const row = document.createElement("div"); row.className = "component-row";
        row.innerHTML = `
            <div class="control-row" style="margin-bottom:6px">
                <input type="text" value="${key}" class="input-sm" style="font-weight:bold" onchange="renameParam('${key}', this.value)">
                <div class="inputs-compact">
                    <input type="number" value="${p.min}" class="input-sm" onchange="updateParam('${key}','min',this.value)">
                    <span style="color:#ccc">..</span>
                    <input type="number" value="${p.max}" class="input-sm" onchange="updateParam('${key}','max',this.value)">
                </div>
                <button class="delete-btn" onclick="deleteParam('${key}')">×</button>
            </div>
            <div class="control-row">
                 <input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.val}" oninput="updateParam('${key}', 'val', this.value)">
                 <span style="font-size:0.7em; color:var(--color-accent); width:30px; text-align:right;">${p.val}</span>
            </div>
        `;
        list.appendChild(row);
    });
}
window.addParam = () => {
    let i = 1; let name = "k";
    while (appState.params[name]) { name = "p" + i; i++; }
    appState.params[name] = { val: 1, min: 0, max: 10, step: 0.1 }; renderParams(); refresh();
};
document.getElementById("add-param-btn").onclick = window.addParam;
window.deleteParam = (key) => { delete appState.params[key]; renderParams(); refresh(); };
window.renameParam = (oldKey, newKey) => {
    if (oldKey === newKey) return;
    if (appState.params[newKey]) { renderParams(); return; }
    appState.params[newKey] = appState.params[oldKey]; delete appState.params[oldKey]; renderParams(); refresh();
};
window.updateParam = (key, field, val) => {
    appState.params[key][field] = parseFloat(val);
    if(field === 'val') updatePlot(); else { renderParams(); refresh(); }
};

// ==========================================
// RENDER ITEMS (New Style: Item Cards)
// ==========================================
const COLOR_PALETTE = [
    "#B01A00", "#d32f2f", "#c2185b", "#7b1fa2", "#512da8", 
    "#1976d2", "#0288d1", "#0097a7", "#00796b", "#388e3c", 
    "#689f38", "#afb42b", "#fbc02d", "#ffa000", "#f57c00", 
    "#e64a19", "#5d4037", "#616161", "#455a64", "#000000"
];

function renderItems() {
    const list = document.getElementById("items-list"); list.innerHTML = "";
    if (!appState.data) appState.data = [];
    appState.data.forEach((item, index) => {
        const div = document.createElement("div");
        div.className = "item-card active-type-" + item.type;
        let inputs = "";
        let typeBadge = "";
        
        // Define Type Label
        if(item.type === 'fun') typeBadge = 'fn';
        else if(item.type === 'point') typeBadge = 'pt';
        else if(item.type === 'implicit') typeBadge = 'im';
        else if(item.type === 'xline') typeBadge = 'xL';
        else typeBadge = item.type;

        // Header Inputs
        if (item.type === "fun") {
            inputs = `<input type="text" value="${item.fn}" placeholder="x^2" class="input-bold" style="flex:1; border:none; background:transparent;" onchange="updateItem(${index}, 'fn', this.value)">`;
        } else if (item.type === "point") {
            const pt = (item.points && item.points[0]) ? item.points[0] : [0,0];
            inputs = `<div class="inputs-compact" style="flex:1;">
                <input type="number" value="${pt[0]}" class="input-bold input-md" onchange="updateItemPoint(${index}, 0, this.value)">
                <span class="input-bold" style="color:#aaa">,</span>
                <input type="number" value="${pt[1]}" class="input-bold input-md" onchange="updateItemPoint(${index}, 1, this.value)">
            </div>`;
        } else if (item.type === "implicit") {
            inputs = `<input type="text" value="${item.fn || item.implicit}" placeholder="x^2+y^2=1" class="input-bold" style="flex:1; border:none;" onchange="updateItem(${index}, 'implicit', this.value)">`;
        } else if (item.type === "xline") {
            inputs = `<div class="inputs-compact" style="flex:1; padding-left:4px;">
                <span class="input-bold">x =</span>
                <input type="number" value="${item.x}" class="input-bold input-md" onchange="updateItem(${index}, 'x', this.value)">
            </div>`;
        }

        const detailsId = `details-${index}`;
        
        // Color Picker HTML
        let colorHtml = `<div class="color-picker-row">`;
        COLOR_PALETTE.forEach(c => {
            const active = (item.color === c || (!item.color && c==='red')) ? 'active' : '';
            colorHtml += `<div class="color-swatch ${active}" style="background-color:${c}" onclick="updateItem(${index}, 'color', '${c}')"></div>`;
        });
        colorHtml += `</div>`;

        const details = `
            <div id="${detailsId}" class="collapsible-content collapsed" style="border-top:1px solid #f0f0f0; margin-top:8px; padding-top:12px;">
                <div class="control-row mb-1">
                    <span class="control-label">Line</span>
                    <div class="inputs-compact">
                        <input type="number" value="${item.width||2}" placeholder="W" class="input-sm" onchange="updateItem(${index}, 'width', this.value)">
                        <input type="text" value="${item.dash||''}" placeholder="Dash" class="input-md" onchange="updateItem(${index}, 'dash', this.value)">
                    </div>
                </div>
                ${item.type==='fun' ? `
                <div class="control-row mb-1">
                    <span class="control-label">Domain</span>
                    <div class="inputs-compact">
                       <input type="number" value="${item.domain?item.domain[0]:''}" placeholder="-∞" class="input-sm" onchange="updateItemDomain(${index},0,this.value)">
                       <span style="color:#ccc">..</span>
                       <input type="number" value="${item.domain?item.domain[1]:''}" placeholder="+∞" class="input-sm" onchange="updateItemDomain(${index},1,this.value)">
                    </div>
                </div>`:''}
                <div class="control-row mb-1">
                   <span class="control-label">Label</span>
                   <input type="text" value="${item.label||''}" placeholder="Aa" onchange="updateItem(${index}, 'label', this.value)">
                </div>
                
                <div style="margin-top:8px;">
                    <span class="control-label" style="display:block; margin-bottom:4px;">Color</span>
                    ${colorHtml}
                </div>
            </div>`;
        
        div.innerHTML = `
            <div class="item-card-header">
                <div style="display:flex; align-items:center; gap:8px; width:100%">
                    <span class="item-type">${typeBadge}</span>
                    ${inputs}
                    
                    <button class="btn-icon" title="Settings" onclick="document.getElementById('${detailsId}').classList.toggle('collapsed')">
                        <span class="material-symbols-outlined" style="font-size:18px">settings</span>
                    </button>
                    <button class="btn-icon danger" title="Delete" onclick="deleteItem(${index})">
                        <span class="material-symbols-outlined" style="font-size:18px">delete</span>
                    </button>
                </div>
            </div>
            <div class="item-card-body" style="padding:0 12px 12px 12px">
                ${details}
            </div>
        `;
        list.appendChild(div);
    });
}
window.addItem = (t) => { let n={type:t,color:"red",width:2}; if(t==="fun")n.fn="sin(x)"; if(t==="point"){n.points=[[0,0]];n.radius=4;} if(t==="implicit")n.implicit="x^2+y^2=9"; if(t==="xline")n.x=2; appState.data.push(n); renderItems(); refresh(); };
window.deleteItem = (i) => { appState.data.splice(i, 1); renderItems(); refresh(); };
window.updateItem = (i, f, v) => { appState.data[i][f] = v; refresh(); };
window.updateItemPoint = (i, c, v) => { const it=appState.data[i]; if(!it.points)it.points=[[0,0]]; it.points[0][c]=parseFloat(v); refresh(); };
window.updateItemDomain = (i, idx, v) => { const it=appState.data[i]; if(v===""){if(it.domain)delete it.domain;}else{if(!it.domain)it.domain=[-10,10];it.domain[idx]=parseFloat(v);} refresh(); };

function setupCollapsibles() { 
    document.querySelectorAll('.section-header-collapsible').forEach(h => { 
        h.onclick = () => { 
            const t = document.getElementById(h.getAttribute('data-target')); 
            if (t) { 
                t.classList.toggle('collapsed');
                const icon = h.querySelector('.dropdown-icon');
                if(icon) icon.innerText = t.classList.contains('collapsed') ? 'expand_more' : 'expand_less';
            }
        };
    });
}
