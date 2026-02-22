/**
 * Matephis Plotting Library
 * 
 * A lightweight SVG-based plotting library for mathematical visualizations.
 * Supports functions, implicit equations, points, interactive pan/zoom,
 * and configurable styling via JSON configuration.
 * 
 * @version 1.0
 */

// Auto-initialize on DOM ready (browser environment only)
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    document.addEventListener("DOMContentLoaded", () => {
        // If MathJax is expected, wait for it
        if (document.getElementById('MathJax-script')) {
            const checkMathJax = () => {
                if (window.MathJax && (window.MathJax.tex2svg || (window.MathJax.startup && window.MathJax.startup.promise))) {
                    // If promise exists, use it to be safe
                    if (window.MathJax.startup && window.MathJax.startup.promise) {
                        window.MathJax.startup.promise.then(() => MatephisPlot.init());
                    } else {
                        MatephisPlot.init();
                    }
                } else {
                    // Poll again shortly
                    setTimeout(checkMathJax, 50);
                }
            };
            checkMathJax();
        } else {
            MatephisPlot.init();
        }
    });
}

class MatephisPlot {
    // =========================================================================
    // STATIC INITIALIZATION
    // =========================================================================

    /**
     * Scans the document for plot containers and initializes them.
     * Handles both explicit `.matephis-plot` divs and `language-matephis` code blocks.
     */
    static init() {
        // Process explicit plot divs
        document.querySelectorAll('.matephis-plot').forEach(container => {
            try {
                if (container.getAttribute('data-processed')) return;
                const source = container.textContent;
                container.innerHTML = "";
                new MatephisPlot(container, source);
                container.setAttribute('data-processed', 'true');
            } catch (e) {
                console.error("Plot Error", e);
                container.innerHTML = `<div style="color:red; border:1px solid red; padding:5px;">Error: ${e.message}</div>`;
            }
        });

        // Process markdown code blocks with language-matephis
        document.querySelectorAll('code.language-matephis').forEach(code => {
            let container;
            let target;
            try {
                target = code.closest('div.language-matephis') || code.closest('pre');
                if (!target) target = code.parentElement;
                if (target.getAttribute('data-processed')) return;

                const source = code.textContent;
                container = document.createElement('div');
                container.className = 'matephis-plot';
                
                target.parentNode.insertBefore(container, target);
                target.style.display = 'none';

                new MatephisPlot(container, source);
                target.setAttribute('data-processed', 'true');
            } catch (e) {
                console.error("Code Block Plot Error", e);
                if (container) {
                    container.innerHTML = `<div style="color:red; border:1px solid red; padding:5px;">Error: ${e.message}</div>`;
                } else if (target) {
                     const errorDiv = document.createElement('div');
                     errorDiv.innerHTML = `<div style="color:red; border:1px solid red; padding:5px;">Error: ${e.message}</div>`;
                     target.parentNode.insertBefore(errorDiv, target);
                }
            }
        });
    }

    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================

    /**
     * Creates a new plot instance.
     * @param {HTMLElement} container - The DOM element to render the plot into.
     * @param {string} source - JSON configuration string for the plot.
     */
    constructor(container, source) {
        this.container = container;
        this.config = JSON.parse(source);
        this.container.innerHTML = "";

        // Unique ID for scoping clip paths
        this.uid = Math.random().toString(36).substr(2, 9);

        // Create wrapper element
        this.wrapper = document.createElement("div");
        this.wrapper.className = "matephis-plot-container";
        if (this.config.border) this.wrapper.classList.add('bordered');
        if (this.config.interactive) this.wrapper.classList.add('interactive');
        this.container.appendChild(this.wrapper);

        // Initialize parameter state from config
        this.params = {};
        if (this.config.params) {
            for (let key in this.config.params) {
                this.params[key] = this.config.params[key].val || 0;
            }
        }

        // View state for pan/zoom
        this.view = { xMin: null, xMax: null, yMin: null, yMax: null };
        this.interactions = { isDragging: false, startX: 0, startY: 0, hasMoved: false, draggingSelection: null, slopeP1: null, slopeP2: null };
        this.selectionMode = null; // 'slope', 'tangent', or null (default/point)

        // Scroll debounce for interaction handling
        this.lastScrollTime = 0;
        window.addEventListener("scroll", () => { this.lastScrollTime = Date.now(); }, { passive: true });

        // Apply layout options
        if (this.config.fullWidth) this.config.cssWidth = "100%";
        if (this.config.cssWidth) {
            this.wrapper.style.maxWidth = this.config.cssWidth;
            this.wrapper.style.width = "100%";
        }

        // Apply alignment
        if (this.config.align === 'center') this.wrapper.classList.add('align-center');
        else if (this.config.align === 'left') this.wrapper.classList.add('align-left');

        // Apply margins
        if (this.config.marginBottom) {
            this.wrapper.style.marginBottom = typeof this.config.marginBottom === 'number' 
                ? `${this.config.marginBottom}px` 
                : this.config.marginBottom;
        }

        // Define color palettes
        this.palettes = {
            black: ["#000000", "#444444", "#6e6e6e", "#929292", "#b6b6b6", "#dadada"],
            red: ["#B01A00", "#8b2e1bff", "#ce452aff", "#e64b2cff", "#fd5a35ff", "#fa7a5d"],
            sunburst: ["#4f000b", "#720026", "#ce4257", "#ff7f51", "#ff9b54"],
            coastal: ["#2b2d42", "#2b2d42", "#edf2f4", "#ef233c", "#d90429"],
            seaside: ["#2B3A67", "#496A81", "#66999B", "#B3AF8F", "#FFC482"],
            default: ["#007bff", "#dc3545", "#28a745", "#fd7e14", "#6f42c1"]
        };

        // Create granular color accessors (e.g., red1, red2, ...)
        Object.keys(this.palettes).forEach(key => {
            if (Array.isArray(this.palettes[key])) {
                this.palettes[key].forEach((c, i) => this.palettes[`${key}${i + 1}`] = c);
            }
        });

        // Initialize components
        this._initSVG();
        
        // Force interactions if selection modes are enabled
        const hasSelection = this.config.pointSelection || this.config.slopeSelection || this.config.tangentSelection;
        
        if (this.config.interactive || hasSelection) {
            this._initControlsOverlay();
            this._initInteractions();
            
            if (!this.config.interactive) {
                // If not globally interactive but has selection, ensure we add basic styles
                this.wrapper.classList.add('interactive');
                this.svg.classList.add('interactive');
                this.svg.classList.remove('static');
                // Remove lightbox click if it was added
                this.svg.onclick = null;
            }
        }
        if (this.config.params && this.config.showSliders !== false) this._initSliders();

        // Warning System
        this.warnings = [];
        this._validateConfig();

        // Initial render
        this.draw();
        this._renderWarnings();

        // Lightbox on click (Only for static plots AND no selection features)
        if (!this.config.interactive && !hasSelection) {
            this.svg.onclick = () => this._openLightbox();
        }

        // Responsive resizing
        this._initResizeObserver();

        // Derivative Trace State
        this.derivativeTrace = [];

        // Derivative Plot Initialization
        if (this.config.addDerivativePlot) {
            this._initDerivativePlot();
        }
    }

    // =========================================================================
    // PRIVATE: SVG INITIALIZATION
    // =========================================================================

    /**
     * Creates the SVG element and all layer groups.
     * @private
     */
    _initSVG() {
        // Calculate initial width
        let targetWidth = this.config.width || 600;
        if (this.config.fullWidth) {
            const cw = this.wrapper.clientWidth;
            if (cw > 50) targetWidth = cw;
            else targetWidth = (window.innerWidth && window.innerWidth > 0) ? window.innerWidth : 1000;
        }
        this.width = Math.max(50, targetWidth); // Safe min width

        // Calculate height based on aspect ratio
        if (this.config.aspectRatio) {
            let ratio = 1;
            if (typeof this.config.aspectRatio === 'string' && this.config.aspectRatio.includes(":")) {
                const parts = this.config.aspectRatio.split(":");
                ratio = parseFloat(parts[0]) / parseFloat(parts[1]);
            } else {
                ratio = parseFloat(this.config.aspectRatio);
            }
            this.height = this.width / ratio;
        } else {
            this.height = this.config.height || this.width;
        }
        this.height = Math.max(50, this.height); // Safe min height

        // Padding (Configurable / Smart Default)
        if (this.config.padding !== undefined) {
            this.padding = this.config.padding;
        } else {
            // Smart default: 10px if no numbers/labels, else 30px (reduced from 35)
            const noNumbers = this.config.showXNumbers === false && this.config.showYNumbers === false;
            const noLabels = !this.config.axisLabels;
            this.padding = (noNumbers && noLabels) ? 10 : 20;
        }

        const ns = "http://www.w3.org/2000/svg";
        this.svg = document.createElementNS(ns, "svg");
        this.svg.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
        this.svg.setAttribute("width", this.width);
        this.svg.setAttribute("height", this.height);
        this.svg.setAttribute("viewBox", `0 0 ${this.width} ${this.height}`);
        this.svg.setAttribute("class", "matephis-plot-svg");
        if (this.config.interactive) this.svg.classList.add('interactive');
        else this.svg.classList.add('static');

        // this.svg.style.aspectRatio = ... removed to prevent issues, handled by attributes

        // Inline Font for Serialized usage (Lightbox)
        this.svg.style.fontFamily = "var(--font-plot, monospace)";

        // Groups
        this.bgGroup = document.createElementNS(ns, "g");
        this.secondaryGridGroup = document.createElementNS(ns, "g");
        this.gridGroup = document.createElementNS(ns, "g");
        this.axesGroup = document.createElementNS(ns, "g"); // Axes Lines & Ticks (Always below data)
        this.numbersGroup = document.createElementNS(ns, "g"); // Numbers (Configurable)
        this.dataGroup = document.createElementNS(ns, "g");
        this.dataGroup.setAttribute("clip-path", `url(#clip_${this.uid})`); // Clip Data to Plot Area
        this.selectionGroup = document.createElementNS(ns, "g"); // Selection Overlay (Top of Data, No Clip?) - Maybe clip.
        // Let's clip selection too, usually desired.
        this.selectionGroup.setAttribute("clip-path", `url(#clip_${this.uid})`);
        this.labelGroup = document.createElementNS(ns, "g");
        this.legendGroup = document.createElementNS(ns, "g");

        // Layer Order
        // 1. Definition (Clip Path)
        const defs = document.createElementNS(ns, "defs");
        const clipPath = document.createElementNS(ns, "clipPath");
        clipPath.setAttribute("id", `clip_${this.uid}`);
        this.clipRect = document.createElementNS(ns, "rect");
        this.clipRect.setAttribute("x", this.padding);
        this.clipRect.setAttribute("y", this.padding);
        this.clipRect.setAttribute("width", Math.max(0, this.width - this.padding * 2));
        this.clipRect.setAttribute("height", Math.max(0, this.height - this.padding * 2));
        clipPath.appendChild(this.clipRect);
        defs.appendChild(clipPath);
        this.svg.appendChild(defs);

        // 2. Backgrounds
        this.svg.appendChild(this.bgGroup);
        this.svg.appendChild(this.secondaryGridGroup);
        this.svg.appendChild(this.gridGroup);
        this.svg.appendChild(this.axesGroup); // Grid & Notches/Axes always below plots

        // 2. Data vs Numbers
        if (this.config.renderOrder === 'numbers-top') {
            this.svg.appendChild(this.dataGroup);
            this.svg.appendChild(this.numbersGroup);
        } else {
            // Default: Numbers Below Data
            this.svg.appendChild(this.numbersGroup);
            this.svg.appendChild(this.dataGroup);
            this.svg.appendChild(this.selectionGroup);
        }

        this.svg.appendChild(this.labelGroup);
        this.svg.appendChild(this.legendGroup);

        // Create Plot Stage (Relative container for SVG + Overlay)
        this.plotStage = document.createElement("div");
        this.plotStage.className = "matephis-plot-stage";
        this.plotStage.appendChild(this.svg);
        this.wrapper.appendChild(this.plotStage);
    }

    /**
     * Initializes the secondary derivative plot.
     * @private
     */
    _initDerivativePlot() {
        const div = document.createElement("div");
        div.className = "matephis-derivative-plot";
        div.style.marginTop = "10px"; // Spacing
        this.wrapper.appendChild(div);

        // Clone config
        const cfg = JSON.parse(JSON.stringify(this.config));
        
        // Remove recursion triggers and features not needed for the secondary plot
        delete cfg.addDerivativePlot;
        delete cfg.traceDerivative;
        delete cfg.title; 
        
        // Remove interaction modes from derivative plot
        delete cfg.slopeSelection;
        delete cfg.tangentSelection;
        delete cfg.pointSelection;
        
        // Pass down actual evaluated params object to derivative plot to fix ReferenceError
        // We removed cfg.params in previous step, but we need to pass `this.params` directly to instance
        // Or keep cfg.params but don't draw sliders? The draw sliders logic is controlled by `config.showSliders`?
        // Actually, deleting cfg.params prevents parsing. Let's keep it, but set a flag to hide sliders if needed.
        // Or just let it inherit the parent's params object later.
        
        // Since we want evaluated values:
        cfg.params = JSON.parse(JSON.stringify(this.config.params || {}));
        
        // Filter out non-function data from the derivative plot
        // (so that points/shapes from the main plot don't bleed over)
        if (cfg.data && Array.isArray(cfg.data)) {
            cfg.data = cfg.data.filter(item => item.fn);
        }
        
        // Disable legend, sliders, and toolbar on derivative plot
        cfg.legend = false;
        cfg.showSliders = false;
        cfg.showToolbar = false;
        cfg.showPoints = false;
        
        // Reset Layout Options to avoid double application
        // Since we are inside the parent wrapper, we want to fill it fully.
        delete cfg.width; 
        delete cfg.height;
        delete cfg.cssWidth;
        delete cfg.fullWidth; // Important: prevents setting max-width on child
        delete cfg.align;
        delete cfg.marginLeft;
        delete cfg.marginRight;
        delete cfg.marginBottom;
        delete cfg.border; // Avoid double border

        // Force full width in container
        cfg.fullWidth = true; // Actually we want width: 100% style, which constructor handles if fullWidth or cssWidth is set.
        // Let's rely on default behavior: if no width/cssWidth, it defaults to fixed width?
        // Wait, default is 600.
        // We want responsive width to parent.
        cfg.cssWidth = "100%"; 

        // Apply global configuration for showing the derivative line in the derivative plot
        cfg.showDerivative = this.config.showDerivativeFunction !== false;
        cfg.hideFunctions = true;

        // Apply Derivative Specifics
        cfg.aspectRatio = (cfg.derivativeAspectRatio !== undefined) ? cfg.derivativeAspectRatio : 2;
        if (cfg.derivativeYLim) cfg.ylim = cfg.derivativeYLim;
        else if (cfg.derivativeAutoY) {
             // Start with default, will update on draw
             cfg.ylim = [-10, 10]; 
        }

        // Title (Optional)
        if (this.config.derivativeTitle) {
            const titleDiv = document.createElement("div");
            titleDiv.className = "matephis-derivative-title";
            titleDiv.textContent = this.config.derivativeTitle;
            titleDiv.style.textAlign = "center";
            titleDiv.style.fontFamily = "sans-serif";
            titleDiv.style.fontSize = "14px";
            titleDiv.style.color = "#666";
            titleDiv.style.marginBottom = "5px";
            div.appendChild(titleDiv);
        }

        // Ensure axes are shown
        cfg.showXAxis = true;
        cfg.showYAxis = true;

        // Instantiate
        // We need to wait for the DOM to be ready? No, div is appended.
        this.derivativePlot = new MatephisPlot(div, JSON.stringify(cfg));
        
        // Link internal selection? 
        // Maybe later.
    }

    /**
     * Syncs the derivative plot view with the main plot.
     * @private
     */
    _syncDerivativePlot() {
        if (!this.derivativePlot) return;

        // Propagate current evaluated params to the derivative plot
        if (this.params) {
            this.derivativePlot.params = Object.assign({}, this.params);
            this.derivativePlot.config.params = this.derivativePlot.config.params || {};
            for (let k in this.params) {
                if (!this.derivativePlot.config.params[k]) this.derivativePlot.config.params[k] = {};
                this.derivativePlot.config.params[k].val = this.params[k];
            }
        }

        // Sync X Limits (View or Config)
        const currentXMin = (this.view && this.view.xMin !== null) ? this.view.xMin : (this.config.xlim ? this.config.xlim[0] : -9.9);
        const currentXMax = (this.view && this.view.xMax !== null) ? this.view.xMax : (this.config.xlim ? this.config.xlim[1] : 9.9);

        // Update Derivative View
        if (!this.derivativePlot.view) this.derivativePlot.view = {};
        this.derivativePlot.view.xMin = currentXMin;
        this.derivativePlot.view.xMax = currentXMax;
        
        // Y Limits: Keep its own, unless Auto Y
        // If AutoY, we need to calculate min/max of the *trace* or the *derivative function* in the current X view?
        // Let's handle AutoY in the drawing/tracing phase where we have data.
        
        this.derivativePlot.draw();
    }

    // =========================================================================
    // PRIVATE: PARAMETER SLIDERS
    // =========================================================================

    /**
     * Creates slider controls for adjustable parameters.
     * @private
     */
    _initSliders() {
        const controls = document.createElement("div");
        controls.className = "matephis-plot-controls";

        for (let key in this.config.params) {
            const p = this.config.params[key];
            const row = document.createElement("div");
            row.className = "matephis-slider-row";
            if (this.config.sliderBorder) row.classList.add('slider-bordered');

            // Label group: "parameter = value"
            const labelGroup = document.createElement("div");
            labelGroup.className = "matephis-slider-label-group";

            const label = document.createElement("span");
            label.innerText = `${key} = `;
            label.className = "matephis-slider-label";

            const valSpan = document.createElement("span");
            valSpan.className = "matephis-slider-val";
            valSpan.innerText = p.val;

            labelGroup.appendChild(label);
            labelGroup.appendChild(valSpan);

            // Min label
            const minLabel = document.createElement("span");
            minLabel.innerText = p.min;
            minLabel.className = "matephis-slider-min";

            // Range slider
            const input = document.createElement("input");
            input.type = "range";
            input.min = p.min;
            input.max = p.max;
            input.step = p.step || 0.1;
            input.value = p.val;

            // Max label
            const maxLabel = document.createElement("span");
            maxLabel.innerText = p.max;
            maxLabel.className = "matephis-slider-max";

            input.addEventListener("input", (e) => {
                const v = parseFloat(e.target.value);
                this.params[key] = v;
                valSpan.innerText = v; // Update number next to label
                this.draw();
            });

            row.appendChild(labelGroup);
            row.appendChild(minLabel);
            row.appendChild(input);
            row.appendChild(maxLabel);

            controls.appendChild(row);
        }
        this.wrapper.appendChild(controls);
    }

    // =========================================================================
    // PRIVATE: CONTROLS OVERLAY
    // =========================================================================

    /**
     * Creates the zoom/pan control overlay buttons.
     * @private
     */
    _initControlsOverlay() {
        if (this.config.showToolbar === false) return; // Allow hiding via config

        const overlay = document.createElement("div");
        overlay.className = "matephis-plot-toolbar"; // Renamed class for new styling logic

        const mkBtn = (iconPath, title, cb) => {
            const b = document.createElement("button");
            b.className = "matephis-plot-btn";
            b.title = title;
            const img = document.createElement("img");
            img.src = iconPath;
            img.style.width = "20px";
            img.style.height = "20px";
            img.draggable = false;
            b.appendChild(img);

            b.onclick = (e) => {
                e.stopPropagation(); // Prevent plot click
                cb();
            };
            return b;
        };

        // Helper to toggle trace
        this.toggleTrace = () => {
             this.isTracing = !this.isTracing;
             if (this.btnTrace) {
                 this.btnTrace.classList.toggle('active', this.isTracing);
             }
        };

        // Helper to clear trace
        this.clearTrace = () => {
            this.derivativeTrace = [];
            
            // Clear from Derivative Plot if exists
            if (this.derivativePlot && this.derivativePlot.config.data) {
                const traceItem = this.derivativePlot.config.data.find(d => d.id === 'derivative-trace');
                if (traceItem) {
                    traceItem.points = [];
                    this.derivativePlot.draw();
                }
            }
            // Clear visuals on main plot
            this._updateSelectionVisuals(this.interactions.currentSelection);
        };

        const zoom = (factor) => {
            if (!this.transform) return;
            const { xMin, xMax, yMin, yMax } = this.transform;
            const cx = (xMin + xMax) / 2;
            const cy = (yMin + yMax) / 2;
            const viewW = (xMax - xMin) * factor;
            const viewH = (yMax - yMin) * factor;

            this.view = {
                xMin: cx - viewW / 2,
                xMax: cx + viewW / 2,
                yMin: cy - viewH / 2,
                yMax: cy + viewH / 2
            };
            this.draw();
        };

        if (this.config.interactive !== false) {
            const btnPlus = mkBtn("assets/img/add.svg", "Zoom In", () => zoom(0.9));
            const btnMinus = mkBtn("assets/img/remove.svg", "Zoom Out", () => zoom(1.1));
            const btnReset = mkBtn("assets/img/center_focus_weak.svg", "Reset View", () => {
                if (this.config.xlim) {
                    this.view.xMin = this.config.xlim[0];
                    this.view.xMax = this.config.xlim[1];
                } else { this.view.xMin = -9.9; this.view.xMax = 9.9; }
    
                if (this.config.ylim) {
                    this.view.yMin = this.config.ylim[0];
                    this.view.yMax = this.config.ylim[1];
                } else { this.view.yMin = -9.9; this.view.yMax = 9.9; }
                this.draw();
            });
            overlay.appendChild(btnPlus);
            overlay.appendChild(btnMinus);
            overlay.appendChild(btnReset);
        }

        // Trace Button (Moved logic below to group with Tangent)

        // Full Screen (Always, per user)
        const btnFull = mkBtn("assets/img/open_in_full.svg", "Full Screen", () => this._openLightbox());
        overlay.appendChild(btnFull);

        // Control Buttons Scope
        let btnPoint, btnSlope, btnTangent;

        // Separator first (if any selection is enabled)
        if (this.config.pointSelection || this.config.slopeSelection || this.config.tangentSelection) {
             const sep = document.createElement("div");
             sep.className = "matephis-plot-separator";
             overlay.appendChild(sep);
        }

        // Point Selection (Touch)
        if (this.config.pointSelection) {
            btnPoint = mkBtn(this.config.pointSelectionIcon || "assets/img/touch_app.svg", "Point Selection", () => {
                if (this.selectionMode === 'point') {
                    this.selectionMode = null;
                    btnPoint.classList.remove('active');
                    this.interactions.draggingSelection = null;
                    this.interactions.currentSelection = null;
                    this._updateSelectionVisuals(null);
                } else {
                    this.selectionMode = 'point';
                    btnPoint.classList.add('active');
                    // Deactivate others
                    if (typeof btnSlope !== 'undefined') btnSlope.classList.remove('active');
                    if (typeof btnTangent !== 'undefined') btnTangent.classList.remove('active');
                    // Clear other interactions
                    this.interactions.slopeP1 = null; this.interactions.slopeP2 = null;
                    this._updateSelectionVisuals(null);
                }
            });
            overlay.appendChild(btnPoint);
            
            // Default Active if set
            if (this.config.pointSelection === true) {
                 this.selectionMode = 'point';
                 btnPoint.classList.add('active');
            }
        }

        if (this.config.slopeSelection) {
            // Determine icon
            const slopeIcon = this.config.slopeSelectionIcon || "assets/img/square_foot.svg";
            btnSlope = mkBtn(slopeIcon, "Slope Selection", () => {
                if (this.selectionMode === 'slope') {
                    this.selectionMode = null;
                    btnSlope.classList.remove('active');
                    this.interactions.slopeP1 = null; this.interactions.slopeP2 = null;
                    this._updateSelectionVisuals(null);
                    if (this.btnTrace) this.btnTrace.classList.add('matephis-hidden');
                } else {
                    this.selectionMode = 'slope';
                    btnSlope.classList.add('active');
                    // Deactivate others
                    if (btnTangent) btnTangent.classList.remove('active');
                    if (btnPoint) btnPoint.classList.remove('active');
                    this._updateSelectionVisuals(null);
                    if (this.btnTrace) {
                        this.btnTrace.classList.add('matephis-hidden');
                    }
                }
            });
            overlay.appendChild(btnSlope);
        }

        if (this.config.tangentSelection) {
            // Group: [Tangent] [Sep] [Trace] [Clean]

            // 1. Tangent Button
            const tangentIcon = this.config.tangentSelectionIcon || "assets/img/snowboarding.svg";
            btnTangent = mkBtn(tangentIcon, "Tangent Selection", () => {
                     if (this.selectionMode === 'tangent') {
                         this.selectionMode = null;
                         btnTangent.classList.remove('active');
                         this._updateSelectionVisuals(null);
                         // Hide Trace UI
                         if (this.btnTrace) this.btnTrace.classList.add('matephis-hidden');
                         if (this.btnClean) this.btnClean.classList.add('matephis-hidden');
                         if (this.traceSep) this.traceSep.classList.add('matephis-hidden');
                     } else {
                         this.selectionMode = 'tangent';
                         btnTangent.classList.add('active');
                         if (btnSlope) btnSlope.classList.remove('active');
                         if (btnPoint) btnPoint.classList.remove('active');
                         this.interactions.slopeP1 = null; this.interactions.slopeP2 = null;
                         this._updateSelectionVisuals(null);
                         // Show Trace UI
                         if (this.btnTrace) this.btnTrace.classList.remove('matephis-hidden');
                         if (this.btnClean) this.btnClean.classList.remove('matephis-hidden');
                         if (this.traceSep) this.traceSep.classList.remove('matephis-hidden');
                     }
                });
            overlay.appendChild(btnTangent);

            // 2. Trace Buttons (if enabled)
            if (this.config.traceDerivative) {
                this.traceSep = document.createElement("div");
                this.traceSep.className = "matephis-plot-separator matephis-hidden"; // Start hidden
                overlay.appendChild(this.traceSep);

                this.btnTrace = mkBtn("assets/img/steppers.svg", "Trace Derivative", () => this.toggleTrace());
                this.btnTrace.classList.add("matephis-hidden"); // Start hidden
                overlay.appendChild(this.btnTrace);

                this.btnClean = mkBtn("assets/img/eraser.svg", "Clear Trace", () => this.clearTrace());
                this.btnClean.classList.add("matephis-hidden"); // Start hidden
                overlay.appendChild(this.btnClean);
            }
        }

        // Place OUTSIDE the plot stage (SVG), below it.
        // If sliders exist, place before them? Or after? user said "below the plot".
        // Appending to wrapper puts it after plotStage.
        this.wrapper.appendChild(overlay);
    }

    // =========================================================================
    // PRIVATE: RESIZE OBSERVER
    // =========================================================================

    /**
     * Sets up ResizeObserver for responsive full-width plots.
     * @private
     */
    _initResizeObserver() {
        if (!window.ResizeObserver) return;

        this.resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                const newW = entry.contentRect.width;
                // Threshold to prevent jitter
                if (newW > 10 && Math.abs(newW - this.width) > 5) {
                    this.width = newW;
                    // Recalculate height based on aspect ratio
                    if (this.config.aspectRatio) {
                        let ratio = 1;
                        if (typeof this.config.aspectRatio === 'string' && this.config.aspectRatio.includes(":")) {
                            const parts = this.config.aspectRatio.split(":");
                            ratio = parseFloat(parts[0]) / parseFloat(parts[1]);
                        } else {
                            ratio = parseFloat(this.config.aspectRatio);
                        }
                        this.height = this.width / ratio;
                    } else {
                        this.height = this.width;
                    }

                    this.svg.setAttribute("width", this.width);
                    this.svg.setAttribute("height", this.height);
                    this.svg.setAttribute("viewBox", `0 0 ${this.width} ${this.height}`);

                    if (this.clipRect) {
                        this.clipRect.setAttribute("width", Math.max(0, this.width - this.padding * 2));
                        this.clipRect.setAttribute("height", Math.max(0, this.height - this.padding * 2));
                    }

                    if (this.transform) {
                        this.transform.width = this.width;
                        this.transform.height = this.height;
                    }
                    this.draw();
                }
            }
        });
        this.resizeObserver.observe(this.wrapper);
    }

    // =========================================================================
    // PRIVATE: INTERACTION HANDLERS
    // =========================================================================

    /**
     * Projects point (px, py) onto segment (x1,y1)-(x2,y2).
     */
    _projectPointOnSegment(px, py, x1, y1, x2, y2) {
        const l2 = (x2 - x1)**2 + (y2 - y1)**2;
        if (l2 === 0) return { x: x1, y: y1, dist: Math.hypot(px - x1, py - y1) };
        let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
        t = Math.max(0, Math.min(1, t));
        const projX = x1 + t * (x2 - x1);
        const projY = y1 + t * (y2 - y1);
        return { x: projX, y: projY, dist: Math.hypot(px - projX, py - projY) };
    }

    /**
     * Finds the closest point on the graph to (x, y).
     * @param {number} x
     * @param {number} y
     * @param {number} [limitToIndex] - Optional index to restrict search to specific function
     */
    _getClosestPointOnGraph(x, y, limitToIndex) {
        if (!this.plotData || this.plotData.length === 0) return null;
        let minDist = Infinity;
        let match = null;
        const threshold = 40; // Pixel threshold

        this.plotData.forEach(item => {
            if (limitToIndex !== undefined && item.index !== limitToIndex) return;

            let dist = Infinity, candX = 0, candY = 0;
            if (item.type === 'point') {
                dist = Math.hypot(x - item.cx, y - item.cy);
                candX = item.cx; candY = item.cy;
            } else if (item.type === 'interpolation' && item.polyline) {
                for (let i = 0; i < item.polyline.length - 1; i++) {
                    const p1 = item.polyline[i];
                    const p2 = item.polyline[i+1];
                    const res = this._projectPointOnSegment(x, y, p1.x, p1.y, p2.x, p2.y);
                    if (res.dist < dist) {
                        dist = res.dist;
                        candX = res.x; candY = res.y;
                    }
                }
            } else {
                const res = this._projectPointOnSegment(x, y, item.x1, item.y1, item.x2, item.y2);
                dist = res.dist;
                candX = res.x; candY = res.y;
            }

            if (dist < threshold && dist < minDist) {
                minDist = dist;
                match = {
                    ...item,
                    x: candX, y: candY, dist: dist
                };
            }
        });
        return match;
    }

    _getPointAtGraphX(valX, index) {
        if (!this.config.data || !this.config.data[index]) return null;
        const item = this.config.data[index];
        // Support for interpolation items in follow mode
        const plotItem = (this.plotData) ? this.plotData.find(pi => pi.index === index) : null;
        if (plotItem && plotItem.type === 'interpolation' && plotItem.polyline) {
             for (let i = 0; i < plotItem.polyline.length - 1; i++) {
                 const p1 = plotItem.polyline[i];
                 const p2 = plotItem.polyline[i+1];
                 const minX = Math.min(p1.valX, p2.valX);
                 const maxX = Math.max(p1.valX, p2.valX);
                 if (valX >= minX && valX <= maxX) {
                      let valY = p1.valY;
                      if (Math.abs(p2.valX - p1.valX) > 1e-9) {
                           const t = (valX - p1.valX) / (p2.valX - p1.valX);
                           valY = p1.valY + t * (p2.valY - p1.valY);
                      }
                      const px = this.transform.mapX(valX);
                      const py = this.safeMapY ? this.safeMapY(valY) : this.transform.mapY(valY);
                      return { type: 'interpolation', index: index, x: px, y: py, valX: valX, valY: valY, dist: 0, polyline: plotItem.polyline };
                 }
             }
             return null;
        }

        if (!item.fn) return null;
        
        try {
            // Domain Constraint
            if (item.domain) {
                 const dMin = this._eval(item.domain[0], "domain min");
                 const dMax = this._eval(item.domain[1], "domain max");
                 if (!isNaN(dMin) && !isNaN(dMax)) {
                     if (valX < dMin) valX = dMin;
                     if (valX > dMax) valX = dMax;
                 }
            }
            
            const f = new Function("x", `return ${this._makeFn(item.fn)};`);
            const valY = f(valX);
            if (!isFinite(valY)) return null;
            
            const px = this.transform.mapX(valX);
            const py = this.safeMapY ? this.safeMapY(valY) : this.transform.mapY(valY);
            
            return {
                type: 'fn',
                index: index,
                x: px, y: py,
                valX: valX, valY: valY,
                dist: 0
            };
        } catch(e) { return null; }
    }

    _getSlopeAt(match) {
        if (!match) return NaN;
        // 1. Explicit Function
        if (match.type === 'fn') {
            const item = this.config.data[match.index];
            const gx = this.transform.unmapX(match.x);
            const eps = 1e-4;
            const f = new Function("x", `return ${this._makeFn(item.fn)};`);
            try {
                const y1 = f(gx - eps);
                const y2 = f(gx + eps);
                if (!isFinite(y1) || !isFinite(y2)) return NaN;
                return (y2 - y1) / (2 * eps);
            } catch(e) { return NaN; }
        }
        // 2. Implicit
        if (match.type === 'implicit') {
             const item = this.config.data[match.index];
             const gx = this.transform.unmapX(match.x);
             const gy = this.transform.unmapY(match.y);
             const eps = 1e-4;
             const F = new Function("x", "y", `return ${this._makeFn(item.implicit)};`);
             try {
                 const fx = (F(gx + eps, gy) - F(gx - eps, gy)) / (2 * eps);
                 const fy = (F(gx, gy + eps) - F(gx, gy - eps)) / (2 * eps);
                 if (Math.abs(fy) < 1e-9) return Infinity; // Vertical tangent
                 return -fx / fy;
             } catch(e) { return NaN; }
        }
        // 3. Vertical Line
        if (match.type === 'vertical') {
            return Infinity;
        }
        // 4. Interpolation
        if (match.type === 'interpolation' && match.polyline) {
             let bestM = NaN;
             let minDist = Infinity;
             // Find closest segment to match.x, match.y
             for (let i = 0; i < match.polyline.length - 1; i++) {
                 const p1 = match.polyline[i];
                 const p2 = match.polyline[i+1];
                 const res = this._projectPointOnSegment(match.x, match.y, p1.x, p1.y, p2.x, p2.y);
                 if (res.dist < minDist) {
                     minDist = res.dist;
                     const dy = p2.valY - p1.valY;
                     const dx = p2.valX - p1.valX;
                     bestM = (Math.abs(dx) < 1e-9) ? Infinity : dy / dx;
                 }
             }
             return bestM;
        }
        return NaN;
    }

    _updateSelectionVisuals(match) {
        this.selectionGroup.innerHTML = "";
        
        // Configurable Selection Style
        const selColor = this.config.selectionColor;
        const selRadius = this.config.selectionRadius || 5;
        const selOutline = this.config.selectionOutlineColor || "white";
        const selOutlineWidth = this.config.selectionOutlineWidth || 2;        
        
        // Helper to draw dot
        const drawDot = (m, color) => {
            if (!m) return;
            const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            c.setAttribute("cx", m.x); c.setAttribute("cy", m.y); c.setAttribute("r", selRadius);
            c.setAttribute("fill", color); c.setAttribute("stroke", selOutline); c.setAttribute("stroke-width", selOutlineWidth);
            this.selectionGroup.appendChild(c);
        };

        const drawLabel = (x, y, txt, col) => {
             this._text(x, y, txt, "start", "alphabetic", col, "bold", "normal", this.selectionGroup, 14);
        };

        // Determine Mode
        if (this.selectionMode === 'slope') {
            const p1 = this.interactions.slopeP1;
            const p2 = this.interactions.slopeP2;
            
            const mainColor = selColor || "#B01A00";
            if (p1) drawDot(p1, mainColor);
            if (p2) drawDot(p2, mainColor);

            if (p1 && p2) {
                const cx = p2.x, cy = p1.y;
                this._line(p1.x, p1.y, cx, cy, mainColor, 1, "5,3", this.selectionGroup);
                this._line(p2.x, p2.y, cx, cy, mainColor, 1, "5,3", this.selectionGroup);
                this._line(p1.x, p1.y, p2.x, p2.y, mainColor, 2, "", this.selectionGroup);

                const gx1 = p1.valX !== undefined ? p1.valX : this.transform.unmapX(p1.x);
                const gy1 = p1.valY !== undefined ? p1.valY : this.transform.unmapY(p1.y);
                const gx2 = p2.valX !== undefined ? p2.valX : this.transform.unmapX(p2.x);
                const gy2 = p2.valY !== undefined ? p2.valY : this.transform.unmapY(p2.y);
                
                const dx = gx2 - gx1;
                const dy = gy2 - gy1;
                const m = dx !== 0 ? dy / dx : Infinity;

                const xLbl = (this.config.axisLabels && this.config.axisLabels[0]) ? `\u0394${this.config.axisLabels[0]}` : "\u0394x";
                const yLbl = (this.config.axisLabels && this.config.axisLabels[1]) ? `\u0394${this.config.axisLabels[1]}` : "\u0394y";

                const lblSize = 12;
                this._text((p1.x + cx)/2, cy + 15, `${xLbl}=${dx.toFixed(2)}`, "middle", "top", mainColor, "normal", "normal", this.selectionGroup, lblSize);
                this._text(cx + 5, (p2.y + cy)/2, `${yLbl}=${dy.toFixed(2)}`, "start", "middle", mainColor, "normal", "normal", this.selectionGroup, lblSize);
                
                const mx = (p1.x + p2.x)/2, my = (p1.y + p2.y)/2;
                let slopeLbl = "";
                const sName = this.config.slopeLabel || "m";
                
                if (this.config.specifySlope) {
                    const xL = (this.config.axisLabels && this.config.axisLabels[0]) ? this.config.axisLabels[0] : "x";
                    const yL = (this.config.axisLabels && this.config.axisLabels[1]) ? this.config.axisLabels[1] : "y";
                    slopeLbl = `${sName}=\u0394${yL}/\u0394${xL}=${m.toFixed(2)}`;
                } else {
                    slopeLbl = `${sName}=${m.toFixed(2)}`;
                }
                
                drawLabel(mx + 10, my - 10, slopeLbl, mainColor);
                
                drawLabel(p1.x + 10, p1.y - 10, `(${gx1.toFixed(1)}, ${gy1.toFixed(1)})`, mainColor);
                drawLabel(p2.x + 10, p2.y - 10, `(${gx2.toFixed(1)}, ${gy2.toFixed(1)})`, mainColor);

                // Trace logic moved to Tangent mode

            } else if (p1) {
                const gx = p1.valX !== undefined ? p1.valX : this.transform.unmapX(p1.x);
                const gy = p1.valY !== undefined ? p1.valY : this.transform.unmapY(p1.y);
                drawLabel(p1.x + 10, p1.y - 10, `(${gx.toFixed(1)}, ${gy.toFixed(1)})`, mainColor);
            }
            return;
        }

        if (this.selectionMode === 'tangent') {
            if (!match) {
                if (this.derivativePlot) {
                    const idx = this.derivativePlot.config.data.findIndex(d => d.id === 'current-derivative-point');
                    if (idx >= 0) {
                        this.derivativePlot.config.data.splice(idx, 1);
                        this.derivativePlot.draw();
                    }
                }
                return;
            }
            const mainColor = selColor || "#B01A00";
            drawDot(match, mainColor);
            
            const gx = match.valX !== undefined ? match.valX : this.transform.unmapX(match.x);
            const gy = match.valY !== undefined ? match.valY : this.transform.unmapY(match.y);
            const m = this._getSlopeAt(match);
            
             if (!isNaN(m)) {
                
                // --- CURRENT DERIVATIVE POINT ---
                if (this.derivativePlot && isFinite(m)) {
                     let dotItem = this.derivativePlot.config.data.find(d => d.id === 'current-derivative-point');
                     if (!dotItem) {
                         dotItem = {
                             id: 'current-derivative-point',
                             type: 'points',
                             points: [[gx, m]],
                             color: mainColor,
                             radius: 4
                         };
                         this.derivativePlot.config.data.push(dotItem);
                     } else {
                         dotItem.points = [[gx, m]];
                     }
                }

                // --- TRACE LOGIC (Moved to Tangent) ---
                if (this.isTracing && isFinite(m)) {
                    const tx = gx;
                    const ty = m;

                    // Avoid duplicate push (simple check)
                    const lastPt = this.derivativeTrace[this.derivativeTrace.length - 1];
                    if (!lastPt || Math.abs(lastPt.x - tx) > 1e-6 || Math.abs(lastPt.y - ty) > 1e-6) {
                        this.derivativeTrace.push({ x: tx, y: ty });
                        
                        // 1. Derivative Plot Active?
                        if (this.derivativePlot) {
                            let traceItem = this.derivativePlot.config.data.find(d => d.id === 'derivative-trace');
                            if (!traceItem) {
                                traceItem = {
                                    id: 'derivative-trace',
                                    type: 'points',
                                    points: [],
                                    color: mainColor,
                                    radius: 2
                                };
                                this.derivativePlot.config.data.push(traceItem);
                            }
                            traceItem.points.push([tx, ty]);

                            // Auto Y
                             if (this.config.derivativeAutoY) {
                                 let yMin = this.derivativePlot.config.ylim ? this.derivativePlot.config.ylim[0] : 1000;
                                 let yMax = this.derivativePlot.config.ylim ? this.derivativePlot.config.ylim[1] : -1000;
                                 
                                 // Expand to fit new point
                                 if (ty < yMin) yMin = ty - 1;
                                 if (ty > yMax) yMax = ty + 1;
                                 
                                 this.derivativePlot.config.ylim = [yMin, yMax];
                                 if (this.derivativePlot.view) {
                                     this.derivativePlot.view.yMin = yMin;
                                     this.derivativePlot.view.yMax = yMax;
                                 }
                             }
                        }
                    }
                }

                if (this.derivativePlot) {
                    this.derivativePlot.draw();
                }
                
                // Render Trace on Main Plot if NO Derivative Plot
                if (!this.derivativePlot && this.derivativeTrace.length > 0) {
                     let d = "";
                     let started = false;
                     this.derivativeTrace.forEach(pt => {
                         const px = this.transform.mapX(pt.x);
                         const py = this.safeMapY ? this.safeMapY(pt.y) : this.transform.mapY(pt.y);
                         if (px >= 0 && px <= this.width && py >= 0 && py <= this.height) {
                             if (!started) { d += `M ${px} ${py}`; started = true; }
                             else d += ` L ${px} ${py}`;
                         } else {
                             started = false; 
                         }
                     });
                     if (d) {
                         const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
                         path.setAttribute("d", d);
                         path.setAttribute("fill", "none");
                         path.setAttribute("stroke", mainColor);
                         path.setAttribute("stroke-width", 2);
                         path.setAttribute("opacity", 0.5);
                         this.selectionGroup.insertBefore(path, this.selectionGroup.firstChild);
                     }
                }
                
                const { xMin, xMax, yMin, yMax, width, height, padding } = this.transform;
                const scaleX = (width - 2*padding) / (xMax - xMin);
                const scaleY = -(height - 2*padding) / (yMax - yMin);
                const screenSlope = m === Infinity ? Infinity : m * (scaleY / scaleX);
                
                let dx, dy;
                const len = 60;
                if (!isFinite(screenSlope)) { dx = 0; dy = len; }
                else {
                    const angle = Math.atan(screenSlope);
                    dx = Math.cos(angle) * len; dy = Math.sin(angle) * len;
                }
                this._line(match.x - dx, match.y - dy, match.x + dx, match.y + dy, mainColor, 2, "", this.selectionGroup);
                
                const sName = this.config.slopeLabel || "m";
                const mStr = isFinite(m) ? m.toFixed(2) : "∞";
                let label = "";
                
                if (this.config.specifySlope) {
                    const xL = (this.config.axisLabels && this.config.axisLabels[0]) ? this.config.axisLabels[0] : "x";
                    const yL = (this.config.axisLabels && this.config.axisLabels[1]) ? this.config.axisLabels[1] : "y";
                    label = `${sName}=d${yL}/d${xL}=${mStr}`;
                } else {
                    label = `${sName}=${mStr}`;
                }

                drawLabel(match.x + 10, match.y - 10, label, mainColor);
            }
             
             drawLabel(match.x + 10, match.y + 20, `(${gx.toFixed(2)}, ${gy.toFixed(2)})`, mainColor);
             return;
        }

        // Default Point Mode
        if (!match) return;
        const c = drawDot(match); // uses internal color logic
        let valX, valY;
        if (this.transform) {
            valX = match.valX !== undefined ? match.valX : this.transform.unmapX(match.x);
            valY = match.valY !== undefined ? match.valY : this.transform.unmapY(match.y);
        }
        if (valX !== undefined) {
             const lbl = `(${parseFloat(valX.toFixed(2))}, ${parseFloat(valY.toFixed(2))})`;
             // Only draw label if not suppressed? No, always draw for simple point.
             drawLabel(match.x + 10, match.y - 10, lbl, c);
        }
    }

    _restoreSelectionVisuals() {
        // Re-calculate screen positions from stored graph values
        if (this.interactions.currentSelection) {
             // Re-project using valX/valY
             const sel = this.interactions.currentSelection;
             if (sel.valX !== undefined && sel.valY !== undefined) {
                 const nx = this.transform.mapX(sel.valX);
                 const ny = this.safeMapY ? this.safeMapY(sel.valY) : this.transform.mapY(sel.valY);
                 // Update match object
                 sel.x = nx; sel.y = ny;
                 this._updateSelectionVisuals(sel);
             }
        } else if (this.interactions.draggingSelection && typeof this.interactions.draggingSelection === 'object') {
             // Fallback for immediate drag (should generally be same as currentSelection)
             const sel = this.interactions.draggingSelection;
             if (sel.valX !== undefined && sel.valY !== undefined) {
                 const nx = this.transform.mapX(sel.valX);
                 const ny = this.safeMapY ? this.safeMapY(sel.valY) : this.transform.mapY(sel.valY);
                 sel.x = nx; sel.y = ny;
                 this._updateSelectionVisuals(sel);
             }
        }
        
        if (this.interactions.slopeP1) {
            const p = this.interactions.slopeP1;
            p.x = this.transform.mapX(p.valX);
            p.y = this.transform.mapY(p.valY);
        }
        if (this.interactions.slopeP2) {
            const p = this.interactions.slopeP2;
            p.x = this.transform.mapX(p.valX);
            p.y = this.transform.mapY(p.valY);
        }
        
        // Redraw based on mode
        this._updateSelectionVisuals(this.interactions.currentSelection || null); 
    }


    /**
     * Sets up mouse and touch event handlers for pan/zoom interactions.
     * @private
     */
    _initInteractions() {
        // Allow if interactive OR if any selection mode is enabled
        const allowSelection = this.config.pointSelection || this.config.slopeSelection || this.config.tangentSelection;
        if (this.config.interactive === false && !allowSelection) return;

        const svg = this.svg;
        let lastX, lastY;
        let isPinching = false;

        // Calculate distance between two touch points
        const getDist = (e) => Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
        );

        // Pointer down handler
        svg.onpointerdown = (e) => {
            if (Date.now() - this.lastScrollTime < 150) return;
            if (e.pointerType === 'touch' && !e.isPrimary) return;

            // Check for Selection Mode
            // Helper to check proximity to existing points (p1, p2)
            const checkProx = (pt, mx, my) => pt ? Math.hypot(pt.x - mx, pt.y - my) < 30 : false;

            if (this.config.pointSelection || this.selectionMode) {
                const rect = svg.getBoundingClientRect();
                const mx = e.clientX - rect.left;
                const my = e.clientY - rect.top;
                
                // Priority 1: Slope Mode Interaction
                if (this.selectionMode === 'slope') {
                    // Check if adjusting existing points
                    if (checkProx(this.interactions.slopeP1, mx, my)) {
                        this.interactions.draggingSelection = 'slopeP1';
                        // Keep visuals, just drag
                         svg.setPointerCapture(e.pointerId); e.preventDefault(); return;
                    }
                    if (checkProx(this.interactions.slopeP2, mx, my)) {
                        this.interactions.draggingSelection = 'slopeP2';
                         svg.setPointerCapture(e.pointerId); e.preventDefault(); return;
                    }

                    const match = this._getClosestPointOnGraph(mx, my);
                    if (match) {
                        // Store Graph Coords
                        match.valX = this.transform.unmapX(match.x);
                        match.valY = this.transform.unmapY(match.y);
                        
                        this.interactions.slopeP1 = match;
                        this.interactions.slopeP2 = { ...match }; // Copy
                        this.interactions.draggingSelection = 'slopeP2'; // Drag P2 to expand
                        this._updateSelectionVisuals(null); // Will read from interactions
                        svg.setPointerCapture(e.pointerId); e.preventDefault(); return;
                    }
                }

                // Priority 2: Tangent Mode
                else if (this.selectionMode === 'tangent') {
                    const match = this._getClosestPointOnGraph(mx, my);
                    if (match) {
                        match.valX = this.transform.unmapX(match.x);
                        match.valY = this.transform.unmapY(match.y);
                        this.interactions.draggingSelection = match;
                        this.interactions.currentSelection = match; // Persist 
                        this._updateSelectionVisuals(match);
                        svg.setPointerCapture(e.pointerId); e.preventDefault(); return;
                    }
                }

                // Priority 3: Point Selection Mode
                else if (this.selectionMode === 'point') {
                    const match = this._getClosestPointOnGraph(mx, my);
                    if (match) {
                        match.valX = this.transform.unmapX(match.x);
                        match.valY = this.transform.unmapY(match.y);
                        this.interactions.draggingSelection = match;
                        this.interactions.currentSelection = match; // Persist
                        this._updateSelectionVisuals(match);
                        svg.setPointerCapture(e.pointerId); e.preventDefault(); return;
                    }
                }
            }

            // Deselection (Click on nothing)
            // Deselection (Click on nothing)
            // Deselection Logic Moved to PointerUp
            
            // Pan Guard
            if (this.config.interactive !== false) {
                this.interactions.isDragging = true;
                this.interactions.startX = e.clientX;
                this.interactions.startY = e.clientY;
                this.interactions.hasMoved = false;
                lastX = e.clientX;
                lastY = e.clientY;
                svg.setPointerCapture(e.pointerId);
                e.preventDefault();
            }
        };

        // Pointer move handler (pan)
        svg.onpointermove = (e) => {
            // Priority: Selection Drag
            if (this.interactions.draggingSelection) {
                 const rect = svg.getBoundingClientRect();
                 const mx = e.clientX - rect.left;
                 const my = e.clientY - rect.top;
                 
                 // Smart Drag Logic
                 let match = null;
                 const ds = this.interactions.draggingSelection;
                 
                 // If dragging an explicit function, snap to X
                 // Need to check the type of thing we are dragging.
                 let targetType = null;
                 let targetIdx = null;

                 // ds is either a string ('slopeP1', 'slopeP2') or an object (match).
                 // If string, we check interactions[ds].
                 // If object, it is the match.
                 
                 let currentObj = null;
                 if (typeof ds === 'string') {
                     currentObj = this.interactions[ds];
                 } else {
                     currentObj = ds;
                 }
                 
                 if (currentObj && currentObj.type === 'fn') {
                     // Force X-only follow
                     const valX = this.transform.unmapX(mx);
                     match = this._getPointAtGraphX(valX, currentObj.index);
                 } else {
                     // Lock to current curve index if exists
                     const limitIndex = (currentObj && currentObj.index !== undefined) ? currentObj.index : undefined;
                     match = this._getClosestPointOnGraph(mx, my, limitIndex);
                     if (match) {
                        match.valX = this.transform.unmapX(match.x);
                        match.valY = this.transform.unmapY(match.y);
                     }
                 }
                 
                 if (match) {
                     if (ds === 'slopeP1') {
                         this.interactions.slopeP1 = match;
                         this._updateSelectionVisuals(null);
                     } else if (ds === 'slopeP2') {
                         this.interactions.slopeP2 = match;
                         this._updateSelectionVisuals(null);
                     } else {
                         // Tangent or Point object
                         this.interactions.draggingSelection = match;
                         this.interactions.currentSelection = match;
                         this._updateSelectionVisuals(match);
                     }
                 }
                 return;
            }

            if (!this.interactions.isDragging || isPinching) return;

            const dx = e.clientX - lastX;
            const dy = e.clientY - lastY;
            lastX = e.clientX;
            lastY = e.clientY;

            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) this.interactions.hasMoved = true;

            if (this.transform && this.interactions.hasMoved) {
                const { xMin, xMax, yMin, yMax, width, height, padding } = this.transform;
                const viewW = xMax - xMin;
                const viewH = yMax - yMin;
                const plotW = width - 2 * padding;
                const plotH = height - 2 * padding;
                const dxUnits = (dx / plotW) * viewW;
                const dyUnits = (dy / plotH) * viewH;
                this._updateRange(-dxUnits, dyUnits);
            }
        };

        // Pointer up handler
        svg.onpointerup = (e) => {
            // Deselection on Release (if no move and no drag target)
            if (!this.interactions.hasMoved && !this.interactions.draggingSelection) {
                 if (this.interactions.currentSelection || this.interactions.slopeP1 || this.interactions.slopeP2) {
                     // Check if we actually clicked ON something (already handled in pointerdown which sets draggingSelection)
                     // If we are here, draggingSelection is null, meaning we clicked background.
                     this.interactions.currentSelection = null;
                     this.interactions.slopeP1 = null;
                     this.interactions.slopeP2 = null;
                     this._updateSelectionVisuals(null);
                 }
            }

            this.interactions.isDragging = false;
            this.interactions.draggingSelection = null;
            svg.releasePointerCapture(e.pointerId);
            // Removed automatic lightbox on click for interactive plots
        };

        // Wheel Zoom
        svg.onwheel = (e) => {
            if (Date.now() - this.lastScrollTime < 150) return; // Prevent zooming while scrolling page
            if (this.config.interactive === false) return; // Disable zoom if not interactive
            e.preventDefault();
            const zoomFactor = e.deltaY > 0 ? 1.05 : 0.95; // Gentler zoom (5%)

            if (this.transform) {
                // Zoom towards mouse pointer
                const rect = svg.getBoundingClientRect();
                const mx = e.clientX - rect.left;
                const my = e.clientY - rect.top;

                // Current Map
                const { unmapX, unmapY, xMin, xMax, yMin, yMax } = this.transform;
                const mouseX = unmapX(mx);
                const mouseY = unmapY(my);

                const viewW = xMax - xMin;
                const viewH = yMax - yMin;

                let newW = viewW * zoomFactor;
                let newH = viewH * zoomFactor;

                // Clamp Zoom Level to limits (zoom out constraint)
                if (this.config.constrainView) {
                    if (this.config.xlim) {
                        const maxW = this.config.xlim[1] - this.config.xlim[0];
                        if (newW > maxW) newW = maxW;
                    }
                    if (this.config.ylim) {
                        const maxH = this.config.ylim[1] - this.config.ylim[0];
                        if (newH > maxH) newH = maxH;
                    }
                }

                // Maintain ratio around mouseX/Y
                const xFrac = (mouseX - xMin) / viewW;
                const yFrac = (mouseY - yMin) / viewH;

                // New Min/Max
                let newXMin = mouseX - xFrac * newW;
                let newXMax = newXMin + newW;
                let newYMin = mouseY - yFrac * newH;
                let newYMax = newYMin + newH;
                
                // Constraints
                if (this.config.constrainView) {
                    if (this.config.xlim) {
                        if (newXMin < this.config.xlim[0]) {
                            const diff = this.config.xlim[0] - newXMin;
                            newXMin += diff; newXMax += diff;
                        }
                        if (newXMax > this.config.xlim[1]) {
                            const diff = this.config.xlim[1] - newXMax;
                            newXMin += diff; newXMax += diff;
                        }
                    }
                    if (this.config.ylim) {
                        if (newYMin < this.config.ylim[0]) {
                            const diff = this.config.ylim[0] - newYMin;
                            newYMin += diff; newYMax += diff;
                        }
                        if (newYMax > this.config.ylim[1]) {
                            const diff = this.config.ylim[1] - newYMax;
                            newYMin += diff; newYMax += diff;
                        }
                    }
                }

                this.view = { xMin: newXMin, xMax: newXMax, yMin: newYMin, yMax: newYMax };
                this.draw();
            }
        };

        // Unified Touch Handler (Scroll Guard + Pan + Pinch)

        let touchStartView = null; // Snapshot of view at touch start
        let touchStartCenter = null; // {x, y}
        let touchStartDist = 0;
        let isTouchActive = false;

        const getTouchCenter = (e) => {
            if (e.touches.length === 0) return null;
            if (e.touches.length === 1) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
            // Multi-touch center
            let sx = 0, sy = 0;
            for (let i = 0; i < e.touches.length; i++) {
                sx += e.touches[i].clientX;
                sy += e.touches[i].clientY;
            }
            return { x: sx / e.touches.length, y: sy / e.touches.length };
        };

        const getTouchDist = (e) => {
            if (e.touches.length < 2) return 1;
            return Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
        };

        const handleTouchStart = (e) => {
            // 1. Scroll Guard
            if (Date.now() - this.lastScrollTime < 150) {
                return;
            }

            // 2. Lock & Initialize
            if (e.touches.length > 0) {
                if (e.cancelable) e.preventDefault(); // Lock scroll

                isTouchActive = true;
                if (this.transform) {
                    const { xMin, xMax, yMin, yMax } = this.transform;
                    touchStartView = { xMin, xMax, yMin, yMax, width: xMax - xMin, height: yMax - yMin };
                }

                touchStartCenter = getTouchCenter(e);
                touchStartDist = getTouchDist(e);
                isPinching = e.touches.length > 1;
            }
        };

        const handleTouchMove = (e) => {
            if (!isTouchActive) return;
            // PREVENT PAN IF SELECTION IS BEING DRAGGED
            if (this.interactions.isDragging) return;

            if (e.cancelable) e.preventDefault(); // Always prevent default if active

            if (!this.transform || !touchStartView || !touchStartCenter) return;

            const currentCenter = getTouchCenter(e);
            if (!currentCenter) return;

            const currentDist = getTouchDist(e);

            // A. Zoom (Scale)
            let scale = 1;
            if (e.touches.length > 1 && touchStartDist > 0) {
                scale = touchStartDist / currentDist;
            }

            // B. Pan (Translation)
            const dxPx = currentCenter.x - touchStartCenter.x;
            const dyPx = currentCenter.y - touchStartCenter.y;

            // 1. Calculate Scaled Dimensions
            const newW = touchStartView.width * scale;
            const newH = touchStartView.height * scale;

            // 2. Apply Scale & Shift
            // Current Plot Dimensions (Screen)
            // Use client rect for accuracy
            const rect = svg.getBoundingClientRect();
            const pW = rect.width;
            const pH = rect.height;

            // Pan Units (in NEW scale)
            const dxUnits = (dxPx / pW) * newW;
            const dyUnits = (dyPx / pH) * newH;

            const dxGraph = -dxUnits; // Drag Right -> Move View Left
            const dyGraph = dyUnits;  // Drag Down -> Move View Up

            // Center Zoom Logic: Scale around CENTER
            const cx = (touchStartView.xMin + touchStartView.xMax) / 2;
            const cy = (touchStartView.yMin + touchStartView.yMax) / 2;

            let nXMin = cx - newW / 2;
            let nXMax = cx + newW / 2;
            let nYMin = cy - newH / 2;
            let nYMax = cy + newH / 2;

            // Apply Pan
            // Constraints Logic (Cloned from Mouse/Wheel logic)
            if (this.config.constrainView) {
                if (this.config.xlim) {
                    if (nXMin < this.config.xlim[0]) {
                        const diff = this.config.xlim[0] - nXMin;
                        nXMin += diff; nXMax += diff;
                    }
                    if (nXMax > this.config.xlim[1]) {
                        const diff = this.config.xlim[1] - nXMax;
                        nXMin += diff; nXMax += diff;
                    }
                }
                if (this.config.ylim) {
                    if (nYMin < this.config.ylim[0]) {
                        const diff = this.config.ylim[0] - nYMin;
                        nYMin += diff; nYMax += diff;
                    }
                    if (nYMax > this.config.ylim[1]) {
                        const diff = this.config.ylim[1] - nYMax;
                        nYMin += diff; nYMax += diff;
                    }
                }
            }

            this.view = { xMin: nXMin, xMax: nXMax, yMin: nYMin, yMax: nYMax };
            this.draw();
        };

        const handleTouchEnd = (e) => {
            if (e.touches.length === 0) {
                isTouchActive = false;
                isPinching = false;
            } else {
                // Rebase gesture
                touchStartCenter = getTouchCenter(e);
                if (this.transform) {
                    const { xMin, xMax, yMin, yMax } = this.transform;
                    touchStartView = { xMin, xMax, yMin, yMax, width: xMax - xMin, height: yMax - yMin };
                }
                touchStartDist = getTouchDist(e);
            }
        };

        // Touch event listeners (passive: false for preventDefault on iOS/Android)
        svg.addEventListener('touchstart', handleTouchStart, { passive: false });
        svg.addEventListener('touchmove', handleTouchMove, { passive: false });
        svg.addEventListener('touchend', handleTouchEnd);
        svg.addEventListener('touchcancel', handleTouchEnd);
    }

    /**
     * Updates the view range by the given deltas.
     * @private
     */
    _updateRange(dx, dy) {
        if (!this.view.xMin && this.transform) {
            this.view.xMin = this.transform.xMin;
            this.view.xMax = this.transform.xMax;
            this.view.yMin = this.transform.yMin;
            this.view.yMax = this.transform.yMax;
        }
        if (this.view.xMin !== null) {
            let nextXMin = this.view.xMin + dx;
            let nextXMax = this.view.xMax + dx;
            let nextYMin = this.view.yMin + dy;
            let nextYMax = this.view.yMax + dy;

            // Constraints
            if (this.config.constrainView) {
                if (this.config.xlim) {
                     if (nextXMin < this.config.xlim[0]) {
                          const shift = this.config.xlim[0] - nextXMin;
                          nextXMin += shift; nextXMax += shift;
                     }
                     if (nextXMax > this.config.xlim[1]) {
                          const shift = this.config.xlim[1] - nextXMax;
                          nextXMin += shift; nextXMax += shift;
                     }
                }
                if (this.config.ylim) {
                     if (nextYMin < this.config.ylim[0]) {
                          const shift = this.config.ylim[0] - nextYMin;
                          nextYMin += shift; nextYMax += shift;
                     }
                     if (nextYMax > this.config.ylim[1]) {
                          const shift = this.config.ylim[1] - nextYMax;
                          nextYMin += shift; nextYMax += shift;
                     }
                }
            }

            this.view.xMin = nextXMin;
            this.view.xMax = nextXMax;
            this.view.yMin = nextYMin;
            this.view.yMax = nextYMax;
            this.draw();
        }
    }

    // =========================================================================
    // PRIVATE: UTILITY METHODS
    // =========================================================================

    /**
     * Gets the color for a data item by index or explicit value.
     * @private
     */
    _getColor(index, explicit) {
        if (explicit) {
            if (this.palettes[explicit]) return this.palettes[explicit];
            if (typeof this.palettes[explicit] === 'string') return this.palettes[explicit];
            return explicit;
        }
        const theme = this.config.theme || "red";
        const palette = this.palettes[theme] || this.palettes.default;
        return palette[index % palette.length];
    }

    /**
     * Parses a mathematical expression string into JavaScript.
     * Handles parameter substitution, implicit multiplication, and math functions.
     * @private
     */
    _makeFn(str) {
        let expr = str;

        // 1. Implicit Multiplication for Parameters (e.g., "ax" -> "a*x")
        // Must be done BEFORE parameter value substitution
        for (let key in this.params) {
            // Param followed by variable (x/y/t) or open parenthesis
            // Lookbehind support in JS is good, but simple regex is safer: capture key, then lookahead
            const re = new RegExp(`(?<![a-zA-Z0-9])(${key})(?=[xyt\\(])`, 'g');
            expr = expr.replace(re, "$1*");
        }

        // Replace parameters with their values
        for (let key in this.params) {
            const re = new RegExp(`\\b${key}\\b`, 'g');
            expr = expr.replace(re, `(${this.params[key]})`);
        }

        // Implicit multiplication: "3x" -> "3*x", ")x" -> ")*x"
        expr = expr.replace(/(\d)([a-zA-Z(])/g, "$1*$2");
        expr = expr.replace(/(\))([a-zA-Z0-9(])/g, "$1*$2");

        // Negative power fix: "-x^2" -> "-(x^2)"
        expr = expr.replace(/(^|[^a-zA-Z0-9])\-([a-z])\^(\d+)/g, "$1-($2^$3)");

        // Convert to JavaScript math
        expr = expr.replace(/\^/g, "**");
        expr = expr.replace(/\b(sin|cos|tan|asin|acos|atan|sqrt|log|exp|abs|floor|ceil|round)\b/g, "Math.$1");
        expr = expr.replace(/\b(pi|PI)\b/g, "Math.PI");
        expr = expr.replace(/\b(e|E)\b/g, "Math.E");

        // Convert implicit equations (e.g., "x^2 + y^2 = 1")
        if (expr.includes("=")) {
            const parts = expr.split("=");
            expr = `(${parts[0]}) - (${parts[1]})`;
        }
        return expr;
    }

    /**
     * Safely evaluates a math expression or returns the number.
     * @private
     */
    _eval(val, context = "value") {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
            try {
                const fn = new Function(`return ${this._makeFn(val)}`);
                return fn();
            } catch (e) {
                console.warn(`Error evaluating ${context}: ${val}`, e);
                return NaN;
            }
        }
        return NaN;
    }

    draw() {
        // Clear dynamic groups
        this.gridGroup.innerHTML = "";
        this.dataGroup.innerHTML = "";
        this.axesGroup.innerHTML = "";
        this.numbersGroup.innerHTML = "";
        this.labelGroup.innerHTML = "";
        this.legendGroup.innerHTML = "";
        this.bgGroup.innerHTML = "";

        // Geometry Cache for Interaction
        this.plotData = [];

        // Grid Opacity
        if (this.config.gridOpacity !== undefined) {
            this.gridGroup.setAttribute("opacity", this.config.gridOpacity);
        } else {
            // Default: 0.8
            this.gridGroup.setAttribute("opacity", 0.8);
        }

        // Bounds
        let xMin = this.config.xlim ? this.config.xlim[0] : -9.9;
        let xMax = this.config.xlim ? this.config.xlim[1] : 9.9;
        let yMin = this.config.ylim ? this.config.ylim[0] : -9.9;
        let yMax = this.config.ylim ? this.config.ylim[1] : 9.9;

        // Use View State if active (Zoom/Pan overrides)
        if (this.view && this.view.xMin !== null) {
            xMin = this.view.xMin; xMax = this.view.xMax;
            yMin = this.view.yMin; yMax = this.view.yMax;
        } else if (this.view) {
            // Init view state
            this.view.xMin = xMin; this.view.xMax = xMax;
            this.view.yMin = yMin; this.view.yMax = yMax;
        }

        // Helper: Eval boundaries for dynamic ranges? (Skip for now, stick to fixed or equalAspect)

        // Equal Aspect
        if (this.config.equalAspect) {
            const plotW = this.width - 2 * this.padding;
            const plotH = this.height - 2 * this.padding;
            const ppU = plotW / (xMax - xMin);
            const reqH = plotH / ppU;
            const yc = (yMin + yMax) / 2;
            yMin = yc - reqH / 2;
            yMax = yc + reqH / 2;
        }

        const mapX = (x) => this.padding + ((x - xMin) / (xMax - xMin)) * (this.width - 2 * this.padding);
        const mapY = (y) => this.height - this.padding - ((y - yMin) / (yMax - yMin)) * (this.height - 2 * this.padding);

        // Save Transform for Interactions
        this.transform = {
            mapX, mapY,
            unmapX: (px) => xMin + ((px - this.padding) / (this.width - 2 * this.padding)) * (xMax - xMin),
            unmapY: (py) => yMin + ((this.height - this.padding - py) / (this.height - 2 * this.padding)) * (yMax - yMin),
            xMin, xMax, yMin, yMax,
            width: this.width, height: this.height, padding: this.padding
        };

        // --- 1. Background ---
        const ns = "http://www.w3.org/2000/svg";
        const rect = document.createElementNS(ns, "rect");
        // Previous config
        // rect.setAttribute("x", this.padding);
        // rect.setAttribute("y", this.padding);
        // rect.setAttribute("width", this.width - 2 * this.padding);
        // rect.setAttribute("height", this.height - 2 * this.padding);
        rect.setAttribute("x", 0);
        rect.setAttribute("y", 0);
        rect.setAttribute("width", this.width);
        rect.setAttribute("height", this.height);
        rect.setAttribute("fill", "none");
        rect.setAttribute("class", "matephis-plot-bg");
        this.bgGroup.appendChild(rect);

        // --- 2. Grid/Axes ---
        const gridColor = "#808080"; // Darker Grey (was #c0c0c0)
        const axisColor = "#333";

        // Auto Step Calculation
        const calculateNiceStep = (range, pixelSize) => {
            const minPxPerStep = 100; // Increased to favor cleaner plots (default step 5 for range 20)
            const targetSteps = Math.max(2, pixelSize / minPxPerStep);
            const rawStep = range / targetSteps;

            // Magnitude
            const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
            const normalized = rawStep / mag;

            let step;
            if (normalized < 1.5) step = 1 * mag;
            else if (normalized < 3) step = 2 * mag;
            else if (normalized < 7) step = 5 * mag;
            else step = 10 * mag;

            return step;
        };

        const autoXStep = calculateNiceStep(xMax - xMin, this.width - 2 * this.padding);
        const autoYStep = calculateNiceStep(yMax - yMin, this.height - 2 * this.padding);

        // Step Parsers
        const parseStep = (val, def) => {
            if (val === undefined) return { val: def, isPi: false };
            if (typeof val === 'number') return { val: val, isPi: false };
            // String check
            const isPi = /pi/i.test(val);
            let num = def;
            try {
                const expr = val.replace(/pi/gi, "Math.PI");
                num = new Function("return " + expr)();
            } catch (e) { }
            return { val: num, isPi: isPi };
        };

        const xStepObj = parseStep(this.config.xStep, autoXStep);
        const yStepObj = parseStep(this.config.yStep, autoYStep);

        // Number Steps (Defaults to Grid Step if not present)
        const xNumStepObj = this.config.xNumberStep !== undefined ? parseStep(this.config.xNumberStep, xStepObj.val) : xStepObj;
        const yNumStepObj = this.config.yNumberStep !== undefined ? parseStep(this.config.yNumberStep, yStepObj.val) : yStepObj;

        const formatTick = (val, isPi, step) => {
            if (!isPi) {
                // Determine precision based on step
                let s = step || 1;
                let p = 0;
                let e = 1;
                // Limit precision to 10 to avoid infinite loops on irrational steps
                while (Math.abs(Math.round(s * e) / e - s) > 1e-9 && p < 10) {
                    e *= 10;
                    p++;
                }
                // Format
                return parseFloat(val.toFixed(p));
            }
            const v = val / Math.PI;
            if (Math.abs(v) < 1e-6) return "0";
            if (Math.abs(v - 1) < 1e-6) return "π";
            if (Math.abs(v + 1) < 1e-6) return "-π";

            // Integers (Check first to avoid 4pi/2)
            if (Math.abs(v - Math.round(v)) < 1e-6) return Math.round(v) + "π";

            // Halves (k * PI/2)
            const d2 = v * 2;
            if (Math.abs(d2 - Math.round(d2)) < 1e-6) {
                const n = Math.round(d2);
                // n=1 -> pi/2, n=3 -> 3pi/2
                return (n === 1 ? "" : n === -1 ? "-" : n) + "π/2";
            }
            // Quarters (k * PI/4)
            const d4 = v * 4;
            if (Math.abs(d4 - Math.round(d4)) < 1e-6) {
                const n = Math.round(d4);
                return (n === 1 ? "" : n === -1 ? "-" : n) + "π/4";
            }

            return v.toFixed(2) + "π";
        };

        const xStep = xStepObj.val;
        const yStep = yStepObj.val;

        this.secondaryGridGroup.innerHTML = "";
        // Default opacity is half of the main grid opacity (0.25 if main is 0.5)
        const mainOpacity = (this.config.gridOpacity !== undefined) ? this.config.gridOpacity : 0.5;
        this.secondaryGridGroup.setAttribute("opacity", (this.config.secondaryGridOpacity !== undefined) ? this.config.secondaryGridOpacity : mainOpacity * 0.5);

        // Secondary defaults to 1/5th of the main step
        const defaultSecX = xStep / 5;
        const defaultSecY = yStep / 5;
        const showSec = this.config.showSecondaryGrid !== false;

        if (showSec && (this.config.xStepSecondary !== undefined || defaultSecX)) {
            const sxStepObj = parseStep(this.config.xStepSecondary, defaultSecX);
            const sxStep = sxStepObj.val;
            const startSX = Math.ceil(xMin / sxStep) * sxStep;
            for (let x = startSX; x <= xMax + 1e-9; x += sxStep) {
                const px = mapX(x);
                if (px < this.padding || px > this.width - this.padding) continue;
                this._line(px, this.padding, px, this.height - this.padding, gridColor, 1.5, "", this.secondaryGridGroup);
            }
        }

        if (showSec && (this.config.yStepSecondary !== undefined || defaultSecY)) {
            const syStepObj = parseStep(this.config.yStepSecondary, defaultSecY);
            const syStep = syStepObj.val;
            const startSY = Math.ceil(yMin / syStep) * syStep;
            for (let y = startSY; y <= yMax + 1e-9; y += syStep) {
                const py = mapY(y);
                if (py < this.padding || py > this.height - this.padding) continue;
                this._line(this.padding, py, this.width - this.padding, py, gridColor, 1.5, "", this.secondaryGridGroup);
            }
        }

        // X Lines
        const startX = Math.ceil(xMin / xStep) * xStep;
        for (let x = startX; x <= xMax + 1e-9; x += xStep) {
            const px = mapX(x);
            if (px < this.padding || px > this.width - this.padding) continue;

            // Grid
            if (this.config.grid !== false) this._line(px, this.padding, px, this.height - this.padding, gridColor, 1.5, "", this.gridGroup);

            // Ticks (Default False) -- To AxesGroup
            if (this.config.showXTicks === true) {
                if (this.config.boxPlot) {
                     // Bottom Ticks
                     this._line(px, this.height - this.padding, px, this.height - this.padding - 5, axisColor, 2, "", this.axesGroup);
                     // Top Ticks (if not partial)
                     if (!this.config.boxPlotPartial) {
                         this._line(px, this.padding, px, this.padding + 5, axisColor, 2, "", this.axesGroup);
                     }
                } else if (Math.abs(x) > 1e-9) {
                    this._line(px, mapY(0), px, mapY(0) + 5, axisColor, 2, "", this.axesGroup);
                }
            }
        }


        // X Numbers (Independent Loop)
        const xNumStep = xNumStepObj.val;
        if (this.config.showXNumbers !== false) {
            // Extend scan range slightly to catch border items
            const startNX = Math.ceil((xMin - xNumStep * 0.5) / xNumStep) * xNumStep;
            
            // X-Axis Sticky Logic
            let axisY = mapY(0);
            let numY = axisY + 15;
            let numBaseline = "top";
            let isStickyX = false;
            
            if (this.config.boxPlot) {
                if (this.config.boxNumbersInside) {
                    numY = this.height - this.padding - 2;
                    numBaseline = "bottom";
                    isStickyX = true;
                } else {
                    numY = this.height - this.padding + 12;
                    numBaseline = "hanging";
                }
            } else {
                // Clamp to Top
                if (axisY < this.padding) {
                    numY = this.padding + 5;
                    numBaseline = "hanging";
                    isStickyX = true; 
                }
                // Clamp to Bottom
                else if (axisY > this.height - this.padding) {
                    numY = this.height - this.padding - 5;
                    numBaseline = "bottom";
                    isStickyX = true;
                }
            }

            for (let x = startNX; x <= xMax + xNumStep * 0.5; x += xNumStep) {
                if (Math.abs(x) < 1e-9) continue; // Skip zero

                let px = mapX(x);
                let align = "middle";

                // Clamping Logic (Visual - 4px threshold)
                // This keeps specific numbers inside if they hit the side walls
                if (Math.abs(px - this.padding) < 4) {
                    px = this.padding;
                    align = "start";
                } else if (Math.abs(px - (this.width - this.padding)) < 4) {
                    px = this.width - this.padding;
                    align = "end";
                }

                if (px < this.padding || px > this.width - this.padding) continue;

                // Font size for shift calc
                const baseFs = this._getConfigSize('numberSize');
                const fsVal = isStickyX ? baseFs * 0.85 : baseFs;
                const colVal = isStickyX ? "#999" : "#666";

                // Align negative numbers (center the number part)
                if (x < -1e-9 && align === "middle") {
                    // Shift left by half a char width approx (0.3em)
                    px -= fsVal * 0.3;
                }

                this._text(px, numY, formatTick(x, xNumStepObj.isPi, xNumStep), align, numBaseline, colVal, "normal", "normal", this.numbersGroup, fsVal);
            }
        }
        // Y Lines
        const startY = Math.ceil(yMin / yStep) * yStep;
        for (let y = startY; y <= yMax + 1e-9; y += yStep) {
            const py = mapY(y);
            if (py < this.padding || py > this.height - this.padding) continue;

            // Grid
            if (this.config.grid !== false) this._line(this.padding, py, this.width - this.padding, py, gridColor, 1.5, "", this.gridGroup);

            // Ticks
            if (this.config.showYTicks === true) {
                if (this.config.boxPlot) {
                     // Left Ticks
                     this._line(this.padding, py, this.padding + 5, py, axisColor, 2, "", this.axesGroup);
                     // Right Ticks (if not partial)
                     if (!this.config.boxPlotPartial) {
                         this._line(this.width - this.padding, py, this.width - this.padding - 5, py, axisColor, 2, "", this.axesGroup);
                     }
                } else if (Math.abs(y) > 1e-9) {
                    this._line(mapX(0) - 5, py, mapX(0), py, axisColor, 2, "", this.axesGroup);
                }
            }
        }

        // Y Numbers (Independent Loop)
        const yNumStep = yNumStepObj.val;
        if (this.config.showYNumbers !== false) {
            const startNY = Math.ceil((yMin - yNumStep * 0.5) / yNumStep) * yNumStep;
            
            // Y-Axis Sticky Logic
            let axisX = mapX(0);
            let numX = axisX - 5;
            let numAlign = "end";
            let isStickyY = false;
            
            if (this.config.boxPlot) {
                if (this.config.boxNumbersInside) {
                    numX = this.padding + 4;
                    numAlign = "start";
                    isStickyY = true;
                } else {
                    numX = this.padding - 8;
                    numAlign = "end";
                }
            } else {
                // Clamp to Left
                if (axisX < this.padding) {
                    numX = this.padding + 5;
                    numAlign = "start";
                    isStickyY = true;
                }
                // Clamp to Right
                else if (axisX > this.width - this.padding) {
                    numX = this.width - this.padding - 5;
                    numAlign = "end";
                    isStickyY = true;
                }
            }

            for (let y = startNY; y <= yMax + yNumStep * 0.5; y += yNumStep) {
                if (Math.abs(y) < 1e-9) continue;

                let py = mapY(y);
                let baseline = "middle";

                // Clamping Y (Visual - 2px threshold)
                if (Math.abs(py - (this.height - this.padding)) < 2) {
                    py = this.height - this.padding - 5;
                    baseline = "auto";
                } else if (Math.abs(py - this.padding) < 2) {
                    py = this.padding + 5;
                }

                if (py < this.padding || py > this.height - this.padding) continue;
                
                const baseFs = this._getConfigSize('numberSize');
                const fsVal = isStickyY ? baseFs * 0.85 : baseFs;
                const colVal = isStickyY ? "#999" : "#666";

                this._text(numX, py, formatTick(y, yNumStepObj.isPi, yNumStep), numAlign, baseline, colVal, "normal", "normal", this.numbersGroup, fsVal);
            }
        }

        // Origin "0" (Shared)
        if (xMin <= 0 && xMax >= 0 && yMin <= 0 && yMax >= 0) {
            // Check visibility config if needed, usually we want 0 if numbers are on
            if (this.config.showXNumbers !== false || this.config.showYNumbers !== false) {
                const px = mapX(0) - 5; // Align with Y numbers (end anchor)
                const py = mapY(0) + 15; // Align with X numbers (top baseline)
                this._text(px, py, "0", "end", "top", "#666", "normal", "normal", this.numbersGroup, this._getConfigSize('numberSize'));
            }
        }
        // Main Axes - To AxesGroup
        const x0 = mapX(0), y0 = mapY(0);
        
        if (this.config.boxPlot) {
            // Box Style
            // Bottom
            this._line(this.padding, this.height - this.padding, this.width - this.padding, this.height - this.padding, axisColor, 2, "", this.axesGroup);
            // Left
            this._line(this.padding, this.padding, this.padding, this.height - this.padding, axisColor, 2, "", this.axesGroup);
            
            if (!this.config.boxPlotPartial) {
                // Top
                this._line(this.padding, this.padding, this.width - this.padding, this.padding, axisColor, 2, "", this.axesGroup);
                // Right
                this._line(this.width - this.padding, this.padding, this.width - this.padding, this.height - this.padding, axisColor, 2, "", this.axesGroup);
            }
        } else {
            // Standard Axes at 0
            const showY = this.config.showYAxis !== false;
            const showX = this.config.showXAxis !== false;

            if (showY && x0 >= this.padding && x0 <= this.width - this.padding) this._line(x0, this.padding, x0, this.height - this.padding, axisColor, 2, "", this.axesGroup);
            if (showX && y0 >= this.padding && y0 <= this.height - this.padding) this._line(this.padding, y0, this.width - this.padding, y0, axisColor, 2, "", this.axesGroup);
        }

        // Arrows - To AxesGroup (part of axes)
        if (this.config.axisArrows && !this.config.boxPlot) {
            const defs = document.createElementNS(ns, "defs");
            const markerW = 10, markerH = 10;
            const arrowPath = `M 0 0 L 10 5 L 0 10 z`; // Basic triangle

            // X Arrow Marker
            const mkX = document.createElementNS(ns, "marker");
            mkX.setAttribute("id", "arrowX");
            mkX.setAttribute("viewBox", "0 0 10 10");
            mkX.setAttribute("refX", "0");
            mkX.setAttribute("refY", "5");
            mkX.setAttribute("markerWidth", 6);
            mkX.setAttribute("markerHeight", 6);
            mkX.setAttribute("orient", "auto");
            const pX = document.createElementNS(ns, "path");
            pX.setAttribute("d", arrowPath);
            pX.setAttribute("fill", axisColor);
            mkX.appendChild(pX);

            // Y Arrow Marker
            const mkY = document.createElementNS(ns, "marker");
            mkY.setAttribute("id", "arrowY");
            mkY.setAttribute("viewBox", "0 0 10 10");
            mkY.setAttribute("refX", "0");
            mkY.setAttribute("refY", "5");
            mkY.setAttribute("markerWidth", 6);
            mkY.setAttribute("markerHeight", 6);
            mkY.setAttribute("orient", "auto");
            const pY = document.createElementNS(ns, "path");
            pY.setAttribute("d", arrowPath);
            pY.setAttribute("fill", axisColor);
            mkY.appendChild(pY);

            defs.appendChild(mkX);
            defs.appendChild(mkY);
            this.axesGroup.appendChild(defs);

            // Draw Arrows Manually (Markers can be tricky with scaling)
            // X Arrow (Positive)
            if (this.config.showXAxis !== false && y0 >= this.padding && y0 <= this.height - this.padding) {
                const axX = this.width - this.padding + 5;
                const axY = y0;
                const arrowXPoly = document.createElementNS(ns, "polygon");
                // Tip at axX, base back 8px, width 6px
                arrowXPoly.setAttribute("points", `${axX},${axY} ${axX - 8},${axY - 4} ${axX - 8},${axY + 4}`);
                arrowXPoly.setAttribute("fill", axisColor);
                this.axesGroup.appendChild(arrowXPoly);
            }

            // Y Arrow (Positive)
            if (this.config.showYAxis !== false && x0 >= this.padding && x0 <= this.width - this.padding) {
                const ayX = x0;
                const ayY = this.padding - 5;
                const arrowYPoly = document.createElementNS(ns, "polygon");
                // Tip at ayY, base down 8px, width 6px
                arrowYPoly.setAttribute("points", `${ayX},${ayY} ${ayX - 4},${ayY + 8} ${ayX + 4},${ayY + 8}`);
                arrowYPoly.setAttribute("fill", axisColor);
                this.axesGroup.appendChild(arrowYPoly);
            }
        }

        // Axis Labels (and Unit Measures)
        if (this.config.axisLabels || this.config.axisUnitMeasures) {
            const lblSize = this._getConfigSize('labelSize');
            const axisWeight = this.config.axisLabelWeight || "bold";
            const axisStyle = this.config.axisLabelStyle || "normal";
            const axisLabelOffset = this.config.axisLabelOffset || 5;
            
            const xL = this.config.axisLabels ? (this.config.axisLabels[0] || "") : "";
            const yL = this.config.axisLabels ? (this.config.axisLabels[1] || "") : "";
            const xU = this.config.axisUnitMeasures ? (this.config.axisUnitMeasures[0] || "") : "";
            const yU = this.config.axisUnitMeasures ? (this.config.axisUnitMeasures[1] || "") : "";

            let xText = xL;
            if (xU) xText = xL ? `${xL} (${xU})` : xU;
            let yText = yL;
            if (yU) yText = yL ? `${yL} (${yU})` : yU;

            if (this.config.boxPlot) {
                // Box Layout Labels
                // X Label: Bottom Right
                // X Label: Right of Axis (BoxPlot)
                if (xText) this._text(this.width - this.padding + 10, this.height - this.padding, xText, "start", "middle", axisColor, axisWeight, axisStyle, this.axesGroup, lblSize, false);
                // Y Label: Top Left
                if (yText) this._text(this.padding, this.padding - axisLabelOffset - 10, yText, "start", "bottom", axisColor, axisWeight, axisStyle, this.axesGroup, lblSize, false);
            } else {
                if (xText) this._text(this.width - this.padding + axisLabelOffset, y0, xText, "start", "middle", axisColor, axisWeight, axisStyle, this.axesGroup, lblSize, false);
                if (yText) this._text(x0, this.padding - axisLabelOffset, yText, "middle", "bottom", axisColor, axisWeight, axisStyle, this.axesGroup, lblSize, false);
            }
        }

        // --- 3. Data ---
        const data = this.config.data || [];
        const legendItems = [];

        data.forEach((item, idx) => {
            const color = this._getColor(idx, item.color);
            const width = item.width || item.strokeWidth || 3;
            const dash = item.dash || "";

            // Label Position Init
            let labelPos = null;
            if (item.labelAt) {
                const lx = this._eval(item.labelAt[0], "labelAt x");
                const ly = this._eval(item.labelAt[1], "labelAt y");
                if (!isNaN(lx) && !isNaN(ly)) {
                    labelPos = { x: mapX(lx), y: mapY(ly) };
                }
            }

            if (item.label && this.config.legend) {
                legendItems.push({ color, label: item.label, type: item.points ? 'point' : (item.type === 'interpolation' ? 'interpolation' : 'line'), dash });
            }

            // Interpolation Type
            if (item.type === 'interpolation' && item.points && Array.isArray(item.points)) {
                try {
                    // Evaluate points
                    const rawPoints = [];
                    item.points.forEach(pt => {
                        const vx = this._eval(pt[0], "interp x");
                        const vy = this._eval(pt[1], "interp y");
                        if (!isNaN(vx) && !isNaN(vy)) rawPoints.push([vx, vy]);
                    });

                    if (rawPoints.length > 1) {
                         const mappedPoints = rawPoints.map(p => [mapX(p[0]), mapY(p[1])]);
                         
                         let finalPoints = [];
                         const smoothness = item.smoothness !== undefined ? item.smoothness : 0; // Default 0
                         
                         if (smoothness > 0) {
                             // Use Curve
                             const segments = item.sampling !== undefined ? item.sampling : 10;
                             finalPoints = this._getCurvePoints(mappedPoints, smoothness, segments);
                         } else {
                             // Use Linear
                             finalPoints = mappedPoints;
                         }

                         // Convert to Path
                         if (finalPoints.length > 0) {
                             const d = "M " + finalPoints.map(p => `${p[0]},${p[1]}`).join(" L ");
                             const path = document.createElementNS(ns, "path");
                             path.setAttribute("d", d);
                             path.setAttribute("fill", "none");
                             path.setAttribute("stroke", color);
                             path.setAttribute("stroke-width", width);
                             if (dash) path.setAttribute("stroke-dasharray", dash);
                             if (item.opacity !== undefined) path.setAttribute("opacity", item.opacity);
                             this.dataGroup.appendChild(path);

                             // Show Points
                             if (item.showPoints && this.config.showPoints !== false) {
                                 mappedPoints.forEach((p, i) => {
                                     // Check visibility bounds? Nah, just draw
                                     const pColor = item.pointColor ? this._getColor(0, item.pointColor) : color;
                                     const pRadius = item.pointRadius || 4;
                                     const pOpacity = item.pointOpacity !== undefined ? item.pointOpacity : (item.opacity !== undefined ? item.opacity : 1);
                                     
                                     const c = document.createElementNS(ns, "circle");
                                     c.setAttribute("cx", p[0]); c.setAttribute("cy", p[1]); c.setAttribute("r", pRadius);
                                     c.setAttribute("fill", pColor);
                                     if (pOpacity !== 1) c.setAttribute("opacity", pOpacity);
                                     
                                     if (item.pointStroke) {
                                         c.setAttribute("stroke", this._getColor(0, item.pointStroke));
                                         c.setAttribute("stroke-width", item.pointStrokeWidth || 1);
                                     } else {
                                         c.setAttribute("stroke", "none");
                                     }
                                     this.dataGroup.appendChild(c);
                                 });
                             }

                             // Cache for Interaction
                             // Generate polyline structure for hit testing
                             const cachedPoly = finalPoints.map(p => ({
                                 x: p[0], y: p[1],
                                 valX: this.transform.unmapX(p[0]),
                                 valY: this.transform.unmapY(p[1]) 
                             }));
                             
                             this.plotData.push({
                                 type: 'interpolation',
                                 isInterpolation: true,
                                 index: idx,
                                 polyline: cachedPoly
                             });

                             if (!item.labelAt) {
                                 const last = finalPoints[finalPoints.length - 1];
                                 labelPos = { x: last[0], y: last[1] };
                             }
                         }
                    }
                } catch (e) { console.warn("Interp Error", e); }
            }

            // Function
            // Function (Adaptive Sampling)
            // Function (Adaptive Sampling)
            if (item.fn) {
                // Prepare tasks: [Original, Derivative?]
                const tasks = [];
                
                // 1. Original Function
                // Hide if configured (e.g. for derivative-only plot)
                if (this.config.hideFunctions !== true) {
                    tasks.push({
                        fnExpr: this._makeFn(item.fn),
                        color: this._getColor(idx, item.color),
                        width: item.width || item.strokeWidth || 3,
                        dash: item.dash || "",
                        opacity: item.opacity,
                        isDerivative: false
                    });
                }

                // 2. Derivative Function
                if (this.config.showDerivative === true) {
                    tasks.push({
                        fnExpr: this._makeFn(item.fn),
                        color: this._getColor(idx, item.color), // same color
                        width: 2, // thinner?
                        dash: "5,5", // dashed
                        opacity: 0.5, // fainter
                        isDerivative: true
                    });
                }

                tasks.forEach(task => {
                    try {
                        let domain = null;
                        if (item.domain && Array.isArray(item.domain)) {
                            const dMin = this._eval(item.domain[0], "domain min");
                            const dMax = this._eval(item.domain[1], "domain max");
                            if (!isNaN(dMin) && !isNaN(dMax)) {
                                domain = [dMin, dMax];
                            }
                        }

                        let d = "";
                        let started = false;
                        
                        let f;
                        if (task.isDerivative) {
                             const baseExpr = task.fnExpr;
                             const baseF = new Function("x", `return ${baseExpr};`);
                             f = (x) => {
                                 const eps = 1e-4;
                                 const y1 = baseF(x - eps);
                                 const y2 = baseF(x + eps);
                                 if (!isFinite(y1) || !isFinite(y2)) return NaN;
                                 return (y2 - y1) / (2 * eps);
                             };
                        } else {
                             f = new Function("x", `return ${task.fnExpr};`);
                        }
                        
                        // Test call to catch syntax errors early
                        if (!task.isDerivative) {
                             try { f(0); } catch (e) { throw new Error(`Function '${item.fn}' error: ${e.message}`); }
                        }

                        // Adaptive State
                        const MAX_DEPTH = 8;
                        const TOLERANCE = 0.2; // Tighter tolerance for smoother curves

                        const safeMapY = (y) => {
                            const py = mapY(y);
                            if (py < -10000) return -10000;
                            if (py > 10000) return 10000;
                            return py;
                        };
                        
                        // Capture raw domain for plotData
                        const rawDomain = domain;

                        // Helper to check validity (finite + domain)
                        const isValid = (x, y) => {
                            if (!isFinite(y)) return false;
                            if (domain && (x < domain[0] || x > domain[1])) return false;
                            return true;
                        };

                        const plotSegment = (x1, y1, x2, y2, depth) => {
                            const xm = (x1 + x2) / 2;
                            let ym;
                            try { ym = f(xm); } catch (e) { ym = NaN; }

                            const p1X = mapX(x1), p1Y = safeMapY(y1);
                            const p2X = mapX(x2), p2Y = safeMapY(y2);
                            const pmX = mapX(xm), pmY = safeMapY(ym);

                            const v1 = isValid(x1, y1);
                            const v2 = isValid(x2, y2);
                            const vm = isValid(xm, ym);

                            // A. Recursion Criteria
                            if (depth < MAX_DEPTH) {
                                let split = false;

                                // 1. Edge Hunting (One valid, one invalid)
                                if (v1 !== v2) split = true;

                                // 2. Hole / Singularity Hunting (Both valid, mid invalid) - e.g. sin(x)/x at 0
                                else if (v1 && v2 && !vm) split = true;

                                // 3. Valid Midpoint Checks
                                else if (v1 && v2 && vm) {
                                    // Curvature / Linearity Check
                                    const linY = p1Y + (p2Y - p1Y) * 0.5;
                                    const error = Math.abs(pmY - linY);
                                    if (error > TOLERANCE) split = true;

                                    // Steep Slope / Asymptote Check
                                    // If dY is huge, subdivide to find the jump
                                    if (Math.abs(p2Y - p1Y) > this.height) split = true;
                                }
                                // 4. Invalid Midpoint but maybe valid edge? (vm false, v1/v2 false) -> Usually skip, 
                                // but if we are "hunting" from coarse loop, we might have v1=false, v2=false, vm=TRUE.
                                // This case is handled by top-level call. Inside recursion, if v1/v2 false, we often stop unless vm is true?
                                // Actually if v1/v2 false and vm true, split!
                                else if (!v1 && !v2 && vm) split = true;

                                if (split) {
                                    plotSegment(x1, y1, xm, ym, depth + 1);
                                    plotSegment(xm, ym, x2, y2, depth + 1);
                                    return;
                                }
                            }

                            // B. Base Case - Draw or Move

                            // Case 1: Both endpoints valid -> Draw Line (unless asymptote break)
                            if (v1 && v2) {
                                const jump = Math.abs(p2Y - p1Y);
                                
                                // Heuristic: If jump > 100px, assume asymptote/discontinuity and break.
                                if (jump < 100) {
                                    if (!started) { d += `M ${p1X} ${p1Y}`; started = true; }
                                    d += ` L ${p2X} ${p2Y}`;
                                    // Push original data to interaction list only if NOT derivative
                                    if (!task.isDerivative) {
                                        this.plotData.push({ type: 'fn', index: idx, x1: p1X, y1: p1Y, x2: p2X, y2: p2Y, domain: rawDomain });
                                        if (!item.labelAt) labelPos = { x: p2X, y: p2Y };
                                    }
                                } else {
                                    // Break
                                    started = false;
                                }
                            }

                            // Case 2: Bridging a Hole (Removable Discontinuity)
                            else if (v1 && v2 && !vm) {
                                // Check continuity
                                const jump = Math.abs(p2Y - p1Y);
                                if (jump < 50) { // arbitrary small threshold for visual continuity
                                    // Bridge it!
                                    if (!started) { d += `M ${p1X} ${p1Y}`; started = true; }
                                    d += ` L ${p2X} ${p2Y}`;
                                    if (!task.isDerivative) {
                                        this.plotData.push({ type: 'fn', index: idx, x1: p1X, y1: p1Y, x2: p2X, y2: p2Y, domain: rawDomain });
                                        if (!item.labelAt) labelPos = { x: p2X, y: p2Y };
                                    }
                                } else {
                                    started = false;
                                }
                            }
                            else {
                                started = false;
                            }
                        };

                        // Initial Coarse Steps with Domain Edge Handling
                        let rMin = xMin, rMax = xMax;
                        if (domain) {
                            rMin = Math.max(rMin, domain[0]);
                            rMax = Math.min(rMax, domain[1]);
                        }

                        // Eval Edge Helper
                        const evalEdge = (x, isMin, isMax) => {
                            let val;
                            try { val = f(x); } catch (e) { }
                            if (isFinite(val)) return val;
                            const eps = 1e-6;
                            if (isMin) { try { val = f(x + eps); } catch (e) { } }
                            if (isMax) { try { val = f(x - eps); } catch (e) { } }
                            return val;
                        };

                        if (rMin < rMax) {
                            // Configurable Sampling Step (pixels)
                            const sampleStep = this.config.sampleStep || 2;
                            const coarseSteps = this.width / sampleStep;
                            const dx = (xMax - xMin) / coarseSteps;
                            let curr = rMin;

                            while (curr < rMax - 1e-9) {
                                let next = curr + dx;
                                if (next > rMax) next = rMax;
                                // Avoid tiny last step
                                if (Math.abs(next - rMax) < 1e-9) next = rMax;

                                const isDomainMin = domain && (Math.abs(curr - domain[0]) < 1e-9);
                                let yStart = evalEdge(curr, isDomainMin, false);

                                const isDomainMax = domain && (Math.abs(next - domain[1]) < 1e-9);
                                let yEnd = evalEdge(next, false, isDomainMax);

                                let yMid;
                                const xMid = (curr + next) / 2;
                                try { yMid = f(xMid); } catch (e) { }

                                const v1 = isValid(curr, yStart);
                                const v2 = isValid(next, yEnd);
                                const vm = isValid(xMid, yMid);

                                if (v1 || v2 || vm) {
                                    if (v1 && !started) {
                                        const pSX = mapX(curr);
                                        const pSY = safeMapY(yStart);
                                        d += `M ${pSX} ${pSY}`;
                                        started = true;
                                    }
                                    plotSegment(curr, yStart, next, yEnd, 0);
                                } else {
                                    started = false;
                                }
                                curr = next;
                            }
                        }

                        const path = document.createElementNS(ns, "path");
                        path.setAttribute("d", d);
                        path.setAttribute("fill", "none");
                        path.setAttribute("stroke", task.color);
                        path.setAttribute("stroke-width", task.width);
                        if (task.dash) path.setAttribute("stroke-dasharray", task.dash);
                        if (task.opacity !== undefined) path.setAttribute("opacity", task.opacity);
                        this.dataGroup.appendChild(path);

                    } catch (e) {
                         this._addWarning(`Error rendering function '${item.fn}': ${e.message}`);
                    }
                });
            }

            // Implicit
            if (item.implicit) {
                const f = new Function("x", "y", `return ${this._makeFn(item.implicit)};`);
                // Use lower resolution if dragging slider (not implemented detection yet, but 60x60 is safe freq)
                const res = 60;
                const dx = (xMax - xMin) / res, dy = (yMax - yMin) / res;
                const grid = [];
                for (let i = 0; i <= res; i++) { grid[i] = []; for (let j = 0; j <= res; j++) grid[i][j] = f(xMin + i * dx, yMin + j * dy); }

                const paths = []; // separate segments
                const lerp = (v0, v1) => Math.abs(v0) / (Math.abs(v0) + Math.abs(v1));

                for (let i = 0; i < res; i++) {
                    for (let j = 0; j < res; j++) {
                        const v0 = grid[i][j], v1 = grid[i + 1][j], v2 = grid[i + 1][j + 1], v3 = grid[i][j + 1];
                        let c = 0; if (v0 > 0) c |= 1; if (v1 > 0) c |= 2; if (v2 > 0) c |= 4; if (v3 > 0) c |= 8;
                        if (c === 0 || c === 15) continue;

                        const xl = xMin + i * dx, xr = xl + dx, yb = yMin + j * dy, yt = yb + dy;
                        const pB = [xl + dx * lerp(v0, v1), yb], pR = [xr, yb + dy * lerp(v1, v2)];
                        const pT = [xl + dx * lerp(v3, v2), yt], pL = [xl, yb + dy * lerp(v0, v3)];



                        const seg = (P1, P2) => {
                            const X1 = mapX(P1[0]), Y1 = mapY(P1[1]), X2 = mapX(P2[0]), Y2 = mapY(P2[1]);
                            this.plotData.push({ type: 'implicit', index: idx, x1: X1, y1: Y1, x2: X2, y2: Y2 });
                            return `M ${X1} ${Y1} L ${X2} ${Y2}`;
                        };

                        switch (c) {
                            case 1: case 14: paths.push(seg(pL, pB)); break;
                            case 2: case 13: paths.push(seg(pB, pR)); break;
                            case 3: case 12: paths.push(seg(pL, pR)); break;
                            case 4: case 11: paths.push(seg(pT, pR)); break;
                            case 5: paths.push(seg(pL, pT) + seg(pB, pR)); break;
                            case 6: case 9: paths.push(seg(pB, pT)); break;
                            case 7: case 8: paths.push(seg(pL, pT)); break;
                            case 10: paths.push(seg(pL, pB) + seg(pT, pR)); break;
                        }
                        if (paths.length && !item.labelAt) labelPos = { x: mapX(pR[0]), y: mapY(pR[1]) }; // Approx
                    }
                }
                const path = document.createElementNS(ns, "path");
                path.setAttribute("d", paths.join(" "));
                path.setAttribute("fill", "none");
                path.setAttribute("stroke", color);
                path.setAttribute("stroke-width", width);
                if (dash) path.setAttribute("stroke-dasharray", dash);
                if (item.opacity !== undefined) path.setAttribute("opacity", item.opacity);
                this.dataGroup.appendChild(path);
            }

            if (item.x !== undefined) {
                const valX = this._eval(item.x, "vertical line x");

                if (!isNaN(valX)) {
                    const px = mapX(valX);
                    if (px >= this.padding && px <= this.width - this.padding) {
                        // Range support for vertical lines
                        let yStart = this.padding;
                        let yEnd = this.height - this.padding;

                        if (item.range && Array.isArray(item.range)) {
                            // Map range values to pixels
                            const r0 = this._eval(item.range[0], "vertical line range start");
                            const r1 = this._eval(item.range[1], "vertical line range end");
                            
                            if (!isNaN(r0) && !isNaN(r1)) {
                                const y1 = mapY(r0);
                                const y2 = mapY(r1);
                                // SVG Y coordinates: mapY(max) is smaller (top) than mapY(min) (bottom)
                                // So usually mapY(range[1]) < mapY(range[0])
                                // But let's just take min/max to be safe
                                const rawYMin = Math.min(y1, y2);
                                const rawYMax = Math.max(y1, y2);

                                yStart = Math.max(this.padding, rawYMin);
                                yEnd = Math.min(this.height - this.padding, rawYMax);
                            }
                        }

                        if (yEnd > yStart) {
                            const l = this._line(px, yStart, px, yEnd, color, width, dash, this.dataGroup);
                            if (item.opacity !== undefined) l.setAttribute("opacity", item.opacity);
                            if (!item.labelAt) labelPos = { x: px, y: yStart + 15 }; // Default label near top of segment
                            
                            // Cache Vertical Line
                            this.plotData.push({
                                type: 'vertical',
                                index: idx,
                                x1: px, y1: yStart,
                                x2: px, y2: yEnd,
                                val: valX 
                            });
                        }
                    }
                }
            }

            // Points (skip if interpolation, it handles its own points)
            if (item.points && item.type !== 'interpolation' && this.config.showPoints !== false) {
                item.points.forEach(pt => {
                    let valX = this._eval(pt[0], "point x");
                    let valY = this._eval(pt[1], "point y");

                    // Proceed only if we have valid numbers
                    if (!isNaN(valX) && !isNaN(valY)) {
                        const px = mapX(valX), py = mapY(valY);
                        // Relaxed bounds check for points slightly off-screen or for drag behavior
                        if (px >= -50 && px <= this.width + 50 && py >= -50 && py <= this.height + 50) {
                            const c = document.createElementNS(ns, "circle");
                            c.setAttribute("cx", px); c.setAttribute("cy", py);
                            c.setAttribute("r", item.radius || 4);
                            
                            const fillColor = item.fillColor ? this._getColor(0, item.fillColor) : color;
                            const strokeColor = item.strokeColor ? this._getColor(0, item.strokeColor) : "none";
                            
                            c.setAttribute("fill", fillColor);
                            c.setAttribute("stroke", strokeColor);
                            c.setAttribute("stroke-width", item.strokeWidth || 0);
                            if (item.opacity !== undefined) c.setAttribute("opacity", item.opacity);
                            this.dataGroup.appendChild(c);
                            
                            // Per-point Label [x, y, "Label"]
                            if (pt[2] && typeof pt[2] === 'string') {
                                const pLabel = pt[2];
                                const lx = px + 8;
                                const ly = py - 8;
                                const fs = this._getConfigSize('labelSize');
                                const lw = this.config.labelWeight || "normal";
                                const ls = this.config.labelStyle || "normal";
                                
                                if (window.MathJax && pLabel.includes("$")) {
                                     this._renderMathJax(pLabel, lx, ly, fs, "#333", "start", "alphabetic", this.labelGroup);
                                } else {
                                     this._text(lx, ly, pLabel, "start", "alphabetic", "#333", lw, ls, this.labelGroup, fs);
                                }
                            }

                            // Use last point for label if no labelAt
                            if (!item.labelAt) labelPos = { x: px, y: py };

                            // Cache Point
                            this.plotData.push({
                                type: 'point',
                                index: idx,
                                cx: px, cy: py,
                                valX: valX, valY: valY
                            });
                        }
                    }
                });
            }

            // Labels (if not legend)
            if (item.label && labelPos && !this.config.legend) {
                // Smart Position
                let anchor = "start";
                let dx = 5, dy = -5;
                if (labelPos.x > this.width - 60) { anchor = "end"; dx = -5; }
                if (labelPos.y < 30) { dy = 15; } // Shift down if too high
                if (labelPos.x < 60) { anchor = "start"; dx = 5; }

                // Manual Overrides
                if (item.labelOffset) { dx += item.labelOffset[0]; dy += item.labelOffset[1]; }
                if (item.labelAnchor) { anchor = item.labelAnchor; }

                // Clamp
                const lx = Math.max(10, Math.min(this.width - 10, labelPos.x + dx));
                const ly = Math.max(10, Math.min(this.height - 10, labelPos.y + dy));

                const labelWeight = this.config.labelWeight || "normal";
                const labelStyle = this.config.labelStyle || "normal";
                const displayLabel = item.label;

                if (window.MathJax && displayLabel.includes("$")) {
                     this._renderMathJax(displayLabel, lx, ly, this._getConfigSize('labelSize'), color, anchor, "bottom", this.labelGroup);
                } else {
                     const cleanLabel = displayLabel.replace(/\*/g, '·');
                     this._text(lx, ly, cleanLabel, anchor, "bottom", color, labelWeight, labelStyle, this.labelGroup, this._getConfigSize('labelSize'));
                }
            }
        });

        // --- 4. Legend ---
        if (this.config.legend && legendItems.length > 0) {
            this._drawLegend(legendItems);
        }

        // Restore Selection Visuals
        this._restoreSelectionVisuals();

        // Sync Derivative Plot
        if (this.derivativePlot) {
             this._syncDerivativePlot();
        }
    }

    _drawLegend(items) {
        // Default Top-Right
        let x = this.width - this.padding - 10;
        let y = this.padding + 10;

        const pos = this.config.legendPosition || 'top-right';

        // Width logic remains... (simplified for this tool call, keeping existing width logic logic implied or using simple replacement)
        // Wait, I need to replace the whole function to safely change the flow.
        
        let w;
        if (this.config.legendWidth) {
            w = this.config.legendWidth;
        } else {
            let maxLen = 0;
            const fs = this._getConfigSize('legendSize');
            items.forEach(it => maxLen = Math.max(maxLen, it.label.length));
            // Tighter packing: 0.5 char width estimate, less padding
            w = 30 + (maxLen * (fs * 0.5)) + 15;
            if (w < 50) w = 50;
        }

        const fs = this._getConfigSize('legendSize');
        
        // bg (Height will be set later)
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("width", w);
        rect.setAttribute("fill", "white");
        rect.setAttribute("fill-opacity", "0.9");
        rect.setAttribute("stroke", "#eee");
        this.legendGroup.appendChild(rect);

        // Calculate Position Start
        // For bottom-aligned, we need to know height beforehand OR shift later.
        // Shifting later is hard with SVG.
        // Let's do a 2-pass approach or just use flow if top-aligned.
        // If bottom-aligned, we might guessing or need to measure.
        // For now, let's assume top-aligned flow logic, and if bottom-aligned, we might be slightly off or need Pre-calc.
        // Let's stick to Pre-calc loop for height.
        
        let totalH = 10; // Top padding
        const RowH = fs * 1.5;
        
        // Pass 1: Calculate Heights
        const rowHeights = items.map(item => {
                if (window.MathJax && item.label.includes("$")) {
                     // Estimaate
                     // If normal text is 1.5 * fs, MathJax fractions might be 2.5 * fs?
                     // Without rendering, we guess.
                     // Better: Render them, measure? No, too slow/complex DOM thrashing.
                     // Heuristic: if it hasfrac, increase height
                     if (item.label.includes("\\frac")) return fs * 2.5;
                     if (item.label.includes("\\sum") || item.label.includes("\\int")) return fs * 2.2;
                     return fs * 1.5;
                 } else if (item.type === 'interpolation') {
                     // Interpolation Label
                     return fs * 1.5;
                 }
                 return fs * 1.5;
        });
        
        totalH = 10 + rowHeights.reduce((a, b) => a + b, 0) + 10; // +10 bottom padding

        // X/Y calculations based on totalH
        if (pos === 'top-left') {
            x = this.padding + 10 + w;
        } else if (pos === 'bottom-right') {
            x = this.width - this.padding - 10;
            y = this.height - this.padding - 10 - totalH;
        } else if (pos === 'bottom-left') {
            x = this.padding + 10 + w;
            y = this.height - this.padding - 10 - totalH;
        }

        rect.setAttribute("x", x - w);
        rect.setAttribute("y", y);
        rect.setAttribute("height", totalH);

        let currentY = y + 10; // Start Y

        items.forEach((item, i) => {
            const h = rowHeights[i];
            const ly = currentY + (h / 2); // Center of row
            
            const lx = x - w + 10;
            // Symbol
            const symbolY = ly; 
            if (item.type === 'point') {
                const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                c.setAttribute("cx", lx + 5); c.setAttribute("cy", symbolY); c.setAttribute("r", 4);
                c.setAttribute("fill", item.color);
                this.legendGroup.appendChild(c);
            } else {
                this._line(lx, symbolY, lx + 15, symbolY, item.color, 2, item.dash, this.legendGroup);
            }

            // Use baseline alignment for better vertical centering
            // Visual middle of text is approx 0.35em above baseline
            const textBaseline = ly + (fs * 0.35);

            // Text or MathJax
            if (window.MathJax && item.label.includes("$")) {
                this._renderMathJax(item.label, lx + 25, textBaseline - 1, fs, "#333", "start", "alphabetic", this.legendGroup);
            } else {
                this._text(lx + 20, textBaseline, item.label.replace(/\*/g, '·'), "start", "alphabetic", "#333", this.config.labelWeight || "normal", this.config.labelStyle || "normal", this.legendGroup, fs);
            }

            
            currentY += h;
        });
    }

    /**
     * Renders MathJax into the SVG.
     * @private
     */
    _renderMathJax(text, x, y, baseSize, color, anchor, baseline, parent) {
        try {
            const tex = text.replace(/^\$|\$$/g, '').replace(/\\$/g, '');
            const mjNode = MathJax.tex2svg(tex);
            const mjSvg = mjNode.querySelector("svg");
            
            if (mjSvg) {
                const svgNode = mjSvg.cloneNode(true);
                svgNode.setAttribute("xmlns", "http://www.w3.org/2000/svg");
                svgNode.setAttribute("xmlns:xlink", "http://www.w3.org/2000/xlink");
                
                // Parse dimensions (usually in 'ex')
                const wAttr = svgNode.getAttribute("width") || "1ex";
                const hAttr = svgNode.getAttribute("height") || "1ex";
                const valign = svgNode.style.verticalAlign || "0ex"; // e.g. -0.25ex

                // Conversion factor: assume 1ex in MathJax ~= 0.5 * baseSize (in pixels)
                const ex2px = baseSize * 0.5; 
                
                const wIdx = parseFloat(wAttr) * ex2px;
                const hIdx = parseFloat(hAttr) * ex2px;
                const vShift = parseFloat(valign) * ex2px;

                svgNode.setAttribute("width", wIdx + "px");
                svgNode.setAttribute("height", hIdx + "px");
                
                // Alignment Logic
                let finalX = x;
                if (anchor === 'end') finalX = x - wIdx;
                else if (anchor === 'middle') finalX = x - wIdx / 2;
                
                let finalY = y;
                // Baseline vs Middle
                if (baseline === 'middle') {
                    // Center vertically around y (bounding box center)
                    finalY = y - (hIdx / 2); 
                } else {
                    // Baseline alignment
                    // y is the target baseline.
                    // MathJax SVG top = Baseline - (Height - Depth)
                    // Depth = -vShift (vShift is usually negative in MathJax)
                    // Top = y - hIdx - vShift
                    finalY = y - hIdx - vShift;
                }

                svgNode.setAttribute("x", finalX);
                svgNode.setAttribute("y", finalY);
                // Ensure self-containment: Check for missing defs (Global Cache Issue)
                // MathJax often uses a global cache. Use references might point to IDs not in this SVG.
                // We must find them in the document and copy them here.
                const uses = svgNode.querySelectorAll("use");
                let defs = svgNode.querySelector("defs");
                if (!defs) {
                    defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
                    svgNode.prepend(defs);
                }

                uses.forEach(use => {
                    const href = use.getAttribute("xlink:href") || use.getAttribute("href");
                    if (href && href.startsWith("#")) {
                        const id = href.substring(1);
                        // Check if it exists inside this SVG
                        if (!svgNode.querySelector(`[id="${id}"]`)) {
                            // Valid ID?
                            // Try to find in global document
                            const globalDef = document.getElementById(id);
                            if (globalDef) {
                                // Clone and append to local defs
                                const clone = globalDef.cloneNode(true);
                                defs.appendChild(clone);
                            }
                        }
                    }
                });

                svgNode.setAttribute("fill", color);
                svgNode.style.color = color; // For currentColor
                
                // Ensure text color is applied to paths if they use currentColor
                svgNode.querySelectorAll('path').forEach(p => p.setAttribute('fill', color));

                parent.appendChild(svgNode);
            } else {
                 this._text(x, y, text, anchor, baseline, color, "normal", "normal", parent, baseSize);
            }
        } catch (e) {
            console.warn("MathJax Render Error", e);
            this._text(x, y, text, anchor, baseline, color, "normal", "normal", parent, baseSize);
        }
    }

    /**
     * Resolves font size from config, with fallback chain.
     * @private
     */
    _getConfigSize(specificKey) {
        if (this.config[specificKey]) {
            return typeof this.config[specificKey] === 'number' ? this.config[specificKey] : parseInt(this.config[specificKey]);
        }
        if (this.config.fontSize) {
            return typeof this.config.fontSize === 'number' ? this.config.fontSize : parseInt(this.config.fontSize);
        }
        return 14;
    }

    /**
     * Creates an SVG line element.
     * @private
     */
    _line(x1, y1, x2, y2, color, width, dash, parent) {
        const l = document.createElementNS("http://www.w3.org/2000/svg", "line");
        l.setAttribute("x1", x1);
        l.setAttribute("y1", y1);
        l.setAttribute("x2", x2);
        l.setAttribute("y2", y2);
        l.setAttribute("stroke", color);
        l.setAttribute("stroke-width", width);
        if (dash) l.setAttribute("stroke-dasharray", dash);
        parent.appendChild(l);
        return l;
    }

    /**
     * Creates an SVG text element with white halo effect.
     * @private
     */
    _text(x, y, str, anchor, baseline, color, weight = "normal", style = "normal", parent = this.axesGroup, size = null, outline = true) {
        const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
        t.setAttribute("x", x);
        t.setAttribute("y", y);
        t.setAttribute("class", "matephis-plot-text");
        t.setAttribute("text-anchor", anchor);
        t.setAttribute("dominant-baseline", baseline);
        t.setAttribute("fill", color);
        const fSize = (size !== null) ? size + "px" : "18px";
        t.setAttribute("font-size", fSize);
        t.setAttribute("font-weight", weight);
        t.setAttribute("font-style", style);
        t.textContent = str;
        if (outline) {
            t.style.paintOrder = "stroke";
            t.style.stroke = "#fff";
            t.style.strokeWidth = "2.5px";
        }
        parent.appendChild(t);
    }

    // =========================================================================
    // PRIVATE: ERROR HANDLING / VALIDATION
    // =========================================================================

    _validateConfig() {
        const VALID_ROOT_KEYS = [
            "width", "height", "aspectRatio", "cssWidth", "fullWidth", "align",
            "marginLeft", "marginRight", "border", "sliderBorder",
            "xlim", "ylim", "interactive", "theme", "legend", "legendWidth", "legendPosition",
            "padding", "marginBottom", "grid", "gridOpacity", "axisArrows", "axisLabels",
            "xStep", "yStep", "xStepSecondary", "yStepSecondary", "showSecondaryGrid", "showGrid",
            "xNumberStep", "yNumberStep", "showXNumbers", "showYNumbers",
            "showXAxis", "showYAxis",
            "showXTicks", "showYTicks", "secondaryGridOpacity",
            "sampleStep", "fontSize", "renderOrder", "params", "showSliders", "data", "labelWeight",
            "numberSize", "labelSize", "legendSize",
            "axisLabelWeight", "axisLabelStyle", "labelStyle", "axisLabelOffset", "axisUnitMeasures",
            "boxPlot", "boxPlotPartial", "constrainView", "boxNumbersInside",
            "pointSelection", "slopeSelection", "tangentSelection", "slopeLabel", "specifySlope",
            "derivativeTitle", "derivativeAutoY", "hideFunctions", "derivativeYScale", "showDerivative", "traceDerivative", "addDerivativePlot", "showDerivativeFunction", "showToolbar", "showDerivativeToolbar", "showPoints"
        ];

        const VALID_DATA_KEYS = [
            "type", "fn", "implicit", "points", "x", "range", "domain",
            "color", "width", "strokeWidth", "dash", "opacity", "fillColor", "strokeColor", "radius",
            "label", "labelAt", "labelOffset", "labelAnchor",
            "smoothness", "sampling", "showPoints", "pointColor", "pointRadius", "pointOpacity", "pointStroke", "pointStrokeWidth" // interpolation
        ];

        // 1. Root Keys
        for (let key in this.config) {
            if (!VALID_ROOT_KEYS.includes(key)) {
                this._addWarning(`Unknown global option: '${key}'`);
            }
        }

        // 2. Data Items
        if (this.config.data) {
            this.config.data.forEach((item, i) => {
                for (let key in item) {
                    if (!VALID_DATA_KEYS.includes(key)) {
                        this._addWarning(`Unknown data option in item ${i + 1}: '${key}'`);
                    }
                }
                // Check Essentials
                if (!item.fn && !item.implicit && !item.points && item.x === undefined) {
                    this._addWarning(`Data item ${i + 1} has no content (missing 'fn', 'points', 'implicit', or 'x').`);
                }
            });
        }
    }

    _addWarning(msg) {
        if (!this.warnings.includes(msg)) {
            this.warnings.push(msg);
        }
    }

    _renderWarnings() {
        // Remove old warnings
        const old = this.wrapper.querySelector(".matephis-plot-warnings");
        if (old) old.remove();

        if (this.warnings.length === 0) return;

        const div = document.createElement("div");
        div.className = "matephis-plot-warnings";
        div.style.borderTop = "1px solid #ffcc00";
        div.style.backgroundColor = "#fffbe6";
        div.style.color = "#5c4b00";
        div.style.padding = "10px";
        div.style.fontSize = "0.85em";
        div.style.width = "100%";
        div.style.marginTop = "0";
        // inherits font-family from wrapper

        const title = document.createElement("strong");
        title.innerText = "⚠️ Plot Warnings:";
        div.appendChild(title);

        const ul = document.createElement("ul");
        ul.style.margin = "5px 0 0 20px";
        ul.style.padding = "0";

        this.warnings.forEach(w => {
            const li = document.createElement("li");
            li.innerText = w;
            ul.appendChild(li);
        });
        div.appendChild(ul);

        this.wrapper.appendChild(div);
    }
    
    // Add visuals restore at end of draw loop
    _restoreSelectionVisualsCheck() {
       this._restoreSelectionVisuals();
    }

    /**
     * Generates points for a Cardinal Spline passing through the given data points.
     * @param {Array} points - Array of [x, y] coordinates
     * @param {number} tension - Smoothness factor (0 to 1), mapped to tension
     * @param {number} numOfSegments - Number of segments between two points
     * @returns {Array} - Array of [x, y] coordinates for the spline
     * @private
     */
    _getCurvePoints(points, tension, numOfSegments) {
        let _pts = [], res = [], 
            x, y,          
            t1x, t2x, t1y, t2y, 
            c1, c2, c3, c4,     
            st, t, i;      

        // Clone points
        for (i = 0; i < points.length; i++) _pts.push(points[i].slice());

        // Duplicate First and Last points to handle open curve boundaries
        _pts.unshift(points[0].slice());
        _pts.push(points[points.length - 1].slice());

        // Map smoothness (0-1) to tension factor 'k'
        // Smoothness 0 => Linear (handled by caller)
        // Smoothness 1 => Catmull-Rom (k=0.5)
        const k = tension * 0.5;

        for (i = 1; i < _pts.length - 2; i++) {
            for (t = 0; t <= numOfSegments; t++) {
                const s = t / numOfSegments;

                // Calc tension vectors
                t1x = (_pts[i + 1][0] - _pts[i - 1][0]) * k;
                t1y = (_pts[i + 1][1] - _pts[i - 1][1]) * k;

                t2x = (_pts[i + 2][0] - _pts[i][0]) * k;
                t2y = (_pts[i + 2][1] - _pts[i][1]) * k;

                // Cardinal Spline basis functions
                c1 = 2 * Math.pow(s, 3) - 3 * Math.pow(s, 2) + 1;
                c2 = -2 * Math.pow(s, 3) + 3 * Math.pow(s, 2);
                c3 = Math.pow(s, 3) - 2 * Math.pow(s, 2) + s;
                c4 = Math.pow(s, 3) - Math.pow(s, 2);

                x = c1 * _pts[i][0] + c2 * _pts[i + 1][0] + c3 * t1x + c4 * t2x;
                y = c1 * _pts[i][1] + c2 * _pts[i + 1][1] + c3 * t1y + c4 * t2y;

                res.push([x, y]);
            }
        }
        return res;
    }

    // =========================================================================
    // PRIVATE: LIGHTBOX
    // =========================================================================

    /**
     * Opens the plot in a lightbox overlay.
     * @private
     */
    _openLightbox() {
        const lb = document.getElementById('lightbox');
        const img = document.getElementById('lightbox-img');
        const svgContainer = document.getElementById('lightbox-svg');
        const caption = document.getElementById('lightbox-caption');

        if (lb && svgContainer) {
            // Feature: Inline SVG Mode (Fixes Fonts & MathJax natively)
            // Instead of serializing to image, we clone the DOM node.
            
            // 1. Prepare Container
            svgContainer.innerHTML = "";
            if (img) img.style.display = "none";
            svgContainer.style.display = "flex"; // Flex to align center
            lb.style.display = "flex";
            if (caption) caption.innerHTML = ""; // Or explicit caption if needed

            // 2. Clone SVG
            const clone = this.svg.cloneNode(true);
            
            // 3. Responsive Sizing
            // 3. Responsive Sizing with Perspective
            // target: 1200px, but constrained by viewport (90% width, 85vh height)
            const maxWidth = Math.min(1200, window.innerWidth * 0.9);
            const maxHeight = window.innerHeight * 0.85;
            
            // Calculate scale to fit within BOTH constraints
            const scaleW = maxWidth / this.width;
            const scaleH = maxHeight / this.height;
            const scale = Math.min(scaleW, scaleH); // Fit start (contain)
            
            const finalW = Math.round(this.width * scale);
            const finalH = Math.round(this.height * scale);
            
            // Apply dimensions to the CONTAINER
            // Since we calculated 'fit', setting explicit px ensures container matches SVG exactly
            svgContainer.style.width = `${finalW}px`;
            svgContainer.style.height = `${finalH}px`;
            
            // The SVG fills the container
            clone.setAttribute("width", "100%");
            clone.setAttribute("height", "100%");
            // Ensure no conflicting inline styles
            clone.style.width = "100%";
            clone.style.height = "100%";
            
            // Ensure ViewBox is present (critical for scaling)
            if (!clone.hasAttribute("viewBox")) {
               clone.setAttribute("viewBox", `0 0 ${this.width} ${this.height}`);
            }

            // Force White Background for Lightbox
            const bgRect = clone.querySelector(".matephis-plot-bg");
            if (bgRect) {
                bgRect.setAttribute("fill", "#fff");
            }
            
            // 4. Append
            svgContainer.appendChild(clone);
        }
    }
}

if (typeof module !== 'undefined') module.exports = MatephisPlot;
