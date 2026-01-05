/**
 * Matephis Plotter - Main Logic
 */

// Default Configuration State
let appState = {
    width: 600,
    height: 600,
    xlim: [-10, 10],
    ylim: [-10, 10],
    aspectRatio: "1:1",
    theme: "red",
    border: true,
    axisLabels: true,
    showXNumbers: true,
    showYNumbers: true,
    interactive: true,
    params: {
        "a": { val: 1, min: -5, max: 5, step: 0.1 },
        "b": { val: 0, min: -5, max: 5, step: 0.1 }
    },
    data: [
        { type: "fun", fn: "x^2", color: "red", width: 2 }
    ]
};

document.addEventListener("DOMContentLoaded", () => {
    init();
});

function init() {
    bindGlobalEvents();
    renderParams();
    renderItems();
    updateJSONEditor();
    updatePlot();
    setupCollapsibles();
}

// ==========================================
// Plot Rendering
// ==========================================

function updatePlot() {
    const container = document.getElementById("plot-target");
    container.innerHTML = ""; // Clear
    
    // Convert appState to pure JSON string for the library
    try {
        // Deep clone to avoid mutations by the library if any
        const config = JSON.parse(JSON.stringify(appState));
        
        // Ensure numeric types
        config.width = parseInt(config.width);
        config.height = parseInt(config.height);
        
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

// ==========================================
// UI Rendering & Events
// ==========================================

function bindGlobalEvents() {
    // Width / Height
    bindInput("g-width", "width", true);
    bindInput("g-height", "height", true);
    
    // Limits
    bindLimitInput("g-xmin", "xlim", 0);
    bindLimitInput("g-xmax", "xlim", 1);
    bindLimitInput("g-ymin", "ylim", 0);
    bindLimitInput("g-ymax", "ylim", 1);
    
    // Aspect
    bindInput("g-aspect", "aspectRatio");
    
    // Toggles
    bindCheckbox("g-grid", "gridOpacity", 0.8, 0); // Hacky mapping if opacity used, or check lib supports bool 'grid'
    // Actually lib uses gridOpacity > 0 to show grid usually, or just draws it. 
    // Let's assume standard implementation.
    
    document.getElementById("g-labels").onchange = (e) => {
        appState.axisLabels = e.target.checked;
        refresh();
    };

    document.getElementById("g-grid").onchange = (e) => {
        appState.gridOpacity = e.target.checked ? 0.5 : 0;
        refresh();
    };
    
    // Theme
    document.getElementById("g-theme").onchange = (e) => {
        appState.theme = e.target.value;
        refresh();
    };
    
    // Refresh Button
    document.getElementById("refresh-btn").onclick = () => updatePlot();
    
    // JSON
    document.getElementById("copy-json-btn").onclick = () => {
        navigator.clipboard.writeText(JSON.stringify(appState, null, 2));
    };
    
    document.getElementById("update-from-json-btn").onclick = () => {
        try {
            const raw = document.getElementById("json-editor").value;
            appState = JSON.parse(raw);
            // Re-render UI from new state
            syncUIToState(); 
            updatePlot();
        } catch (e) {
            alert("Invalid JSON");
        }
    };
}

function syncUIToState() {
    document.getElementById("g-width").value = appState.width;
    document.getElementById("g-height").value = appState.height;
    document.getElementById("g-xmin").value = appState.xlim[0];
    document.getElementById("g-xmax").value = appState.xlim[1];
    document.getElementById("g-ymin").value = appState.ylim[0];
    document.getElementById("g-ymax").value = appState.ylim[1];
    document.getElementById("g-aspect").value = appState.aspectRatio;
    document.getElementById("g-theme").value = appState.theme || 'default';
    document.getElementById("g-labels").checked = appState.axisLabels !== false;
    
    renderParams();
    renderItems();
    updateJSONEditor();
}

function bindInput(id, key, isNum = false) {
    const el = document.getElementById(id);
    if(!el) return;
    el.oninput = (e) => {
        let val = e.target.value;
        if (isNum) val = parseFloat(val);
        appState[key] = val;
        // Debounce simple updates? For now direct
        updateJSONEditor();
        updatePlot();
    };
}

function bindLimitInput(id, arrayName, index) {
    const el = document.getElementById(id);
    el.oninput = (e) => {
        const val = parseFloat(e.target.value);
        if(!appState[arrayName]) appState[arrayName] = [-10, 10];
        appState[arrayName][index] = val;
        updateJSONEditor();
        updatePlot();
    };
}

function bindCheckbox(id, key, trueVal = true, falseVal = false) {
    // Simplified logic handled manually above for specific complex cases
}

function refresh() {
    updateJSONEditor();
    updatePlot();
}

function updateJSONEditor() {
    document.getElementById("json-editor").value = JSON.stringify(appState, null, 2);
}

// ==========================================
// Section: Parameters
// ==========================================

function renderParams() {
    const list = document.getElementById("params-list");
    list.innerHTML = "";
    
    if (!appState.params) appState.params = {};
    
    Object.keys(appState.params).forEach(key => {
        const p = appState.params[key];
        const row = document.createElement("div");
        row.className = "item-card";
        row.innerHTML = `
            <div class="item-card-header">
                <input type="text" value="${key}" style="width: 50px; font-weight:bold;" 
                    onchange="renameParam('${key}', this.value)">
                <button class="delete-btn" onclick="deleteParam('${key}')">×</button>
            </div>
            <div class="control-row">
                <input type="number" value="${p.min}" onchange="updateParam('${key}', 'min', this.value)">
                <input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.val}"
                     oninput="updateParam('${key}', 'val', this.value)">
                <input type="number" value="${p.max}" onchange="updateParam('${key}', 'max', this.value)">
            </div>
            <div style="text-align: center; font-size: 0.7rem; margin-top: 4px;">Value: ${p.val}</div>
        `;
        list.appendChild(row);
    });
}

window.addParam = () => {
    const name = prompt("Parameter Name:", "k");
    if (name && !appState.params[name]) {
        appState.params[name] = { val: 1, min: 0, max: 10, step: 0.1 };
        renderParams();
        refresh();
    }
};
document.getElementById("add-param-btn").onclick = window.addParam;

window.deleteParam = (key) => {
    delete appState.params[key];
    renderParams();
    refresh();
};

window.renameParam = (oldKey, newKey) => {
    if (oldKey === newKey) return;
    if (appState.params[newKey]) {
        alert("Name already exists");
        renderParams(); // reset UI
        return;
    }
    appState.params[newKey] = appState.params[oldKey];
    delete appState.params[oldKey];
    renderParams();
    refresh();
};

window.updateParam = (key, field, val) => {
    appState.params[key][field] = parseFloat(val);
    if(field === 'val') {
        // Optimization: Don't re-render entire params list on slider drag
        // Just update plot
        updatePlot(); 
        // Update number display in that specific card if we wanted to be fancy
    } else {
        renderParams(); // Re-render for min/max changes
        refresh();
    }
};

// ==========================================
// Section: Items
// ==========================================

function renderItems() {
    const list = document.getElementById("items-list");
    list.innerHTML = "";
    
    if (!appState.data) appState.data = [];
    
    appState.data.forEach((item, index) => {
        const div = document.createElement("div");
        div.className = "item-card";
        
        let inputs = "";
        
        if (item.type === "fun") {
            inputs = `
                <div class="control-group">
                    <input type="text" value="${item.fn}" placeholder="x^2" onchange="updateItem(${index}, 'fn', this.value)">
                </div>
            `;
        } else if (item.type === "point") {
            inputs = `
                <div class="inputs-compact">
                    <span>(</span>
                    <input type="text" value="${item.x || 0}" style="width: 60px" onchange="updateItem(${index}, 'x', this.value)">
                    <span>,</span>
                    <input type="text" value="${item.y || 0}" style="width: 60px" onchange="updateItem(${index}, 'y', this.value)">
                    <span>)</span>
                </div>
                <div class="control-row" style="margin-top:8px;">
                     <span class="control-label">Label</span>
                     <input type="text" value="${item.label || ''}" placeholder="P" onchange="updateItem(${index}, 'label', this.value)">
                </div>
            `;
        } else if (item.type === "implicit") {
            inputs = `
                <div class="control-group">
                    <input type="text" value="${item.fn}" placeholder="x^2 + y^2 = 1" onchange="updateItem(${index}, 'fn', this.value)">
                </div>
            `;
        } else if (item.type === "xline") {
             inputs = `
                <div class="control-row">
                    <span class="control-label">x = </span>
                    <input type="number" value="${item.x}" onchange="updateItem(${index}, 'x', this.value)">
                </div>
            `;
        }

        // Common Styles (Color)
        const common = `
            <div class="control-row" style="margin-top: 8px; border-top: 1px solid #eee; padding-top: 8px;">
                <input type="text" value="${item.color || 'red'}" style="width: 80px;" onchange="updateItem(${index}, 'color', this.value)">
                <label style="font-size: 0.7rem;">Color</label>
                <button class="delete-btn" onclick="deleteItem(${index})">Delete</button>
            </div>
        `;

        div.innerHTML = `
            <div class="item-card-header">
                <span class="item-type">${item.type.toUpperCase()}</span>
            </div>
            ${inputs}
            ${common}
        `;
        list.appendChild(div);
    });
}

window.addItem = (type) => {
    let newItem = { type: type, color: "red" };
    if (type === "fun") newItem.fn = "sin(x)";
    if (type === "point") { newItem.x = 0; newItem.y = 0; }
    if (type === "implicit") newItem.fn = "x^2 + y^2 = 9";
    if (type === "xline") newItem.x = 2;
    
    appState.data.push(newItem);
    renderItems();
    refresh();
};

window.deleteItem = (index) => {
    appState.data.splice(index, 1);
    renderItems();
    refresh();
};

window.updateItem = (index, field, val) => {
    const item = appState.data[index];
    // Auto-detect numbers for some fields
    if (field === 'x' || field === 'y') {
        const num = parseFloat(val);
        if (!isNaN(num)) val = num;
    }
    item[field] = val;
    refresh();
};

// ==========================================
// Utils
// ==========================================

function setupCollapsibles() {
    document.querySelectorAll('.section-header-collapsible').forEach(header => {
        header.onclick = () => {
            const targetId = header.getAttribute('data-target');
            const target = document.getElementById(targetId);
            if (target) {
                target.classList.toggle('collapsed');
                // Rotate icon
                const icon = header.querySelector('.dropdown-icon');
                if (icon) {
                    icon.style.transform = target.classList.contains('collapsed') ? 'rotate(-90deg)' : 'rotate(0deg)';
                }
            }
        };
    });
}
