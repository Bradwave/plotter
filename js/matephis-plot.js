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
    document.addEventListener("DOMContentLoaded", () => MatephisPlot.init());
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
            try {
                const source = code.textContent;
                let target = code.closest('div.language-matephis') || code.closest('pre');
                if (!target) target = code.parentElement;
                if (target.getAttribute('data-processed')) return;

                const container = document.createElement('div');
                container.className = 'matephis-plot';
                target.parentNode.insertBefore(container, target);
                target.style.display = 'none';

                new MatephisPlot(container, source);
                target.setAttribute('data-processed', 'true');
            } catch (e) {
                console.error("Code Block Plot Error", e);
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
        this.interactions = { isDragging: false, startX: 0, startY: 0, hasMoved: false };

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
        if (this.config.params) this._initSliders();
        if (this.config.interactive) {
            this._initControlsOverlay();
            this._initInteractions();
        }

        // Warning System
        this.warnings = [];
        this._validateConfig();

        // Initial render
        this.draw();
        this._renderWarnings();

        // Lightbox on click
        this.svg.onclick = () => this._openLightbox();

        // Responsive resizing
        this._initResizeObserver();
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
        this.width = targetWidth;
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
        this.svg.setAttribute("width", this.width);
        this.svg.setAttribute("height", this.height);
        this.svg.setAttribute("viewBox", `0 0 ${this.width} ${this.height}`);
        this.svg.setAttribute("class", "matephis-plot-svg");
        if (this.config.interactive) this.svg.classList.add('interactive');
        else this.svg.classList.add('static');

        // this.svg.style.aspectRatio = ... removed to prevent issues, handled by attributes
        
        // Inline Font for Serialized usage (Lightbox)
        this.svg.style.fontFamily = "var(--font-code, monospace)";

        // Groups
        this.bgGroup = document.createElementNS(ns, "g");
        this.secondaryGridGroup = document.createElementNS(ns, "g");
        this.gridGroup = document.createElementNS(ns, "g");
        this.axesGroup = document.createElementNS(ns, "g"); // Axes Lines & Ticks (Always below data)
        this.numbersGroup = document.createElementNS(ns, "g"); // Numbers (Configurable)
        this.dataGroup = document.createElementNS(ns, "g");
        this.dataGroup.setAttribute("clip-path", `url(#clip_${this.uid})`); // Clip Data to Plot Area
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
        }

        this.svg.appendChild(this.labelGroup);
        this.svg.appendChild(this.legendGroup);

        // Create Plot Stage (Relative container for SVG + Overlay)
        this.plotStage = document.createElement("div");
        this.plotStage.className = "matephis-plot-stage";
        this.plotStage.appendChild(this.svg);
        this.wrapper.appendChild(this.plotStage);
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
        const overlay = document.createElement("div");
        overlay.className = "matephis-plot-overlay";

        const mkBtn = (txt, cb) => {
            const b = document.createElement("button");
            b.innerText = txt;
            b.className = "matephis-plot-btn";
            b.onclick = (e) => {
                e.stopPropagation(); // Prevent plot click
                cb();
            };
            return b;
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

        const btnPlus = mkBtn("+", () => zoom(0.9)); // Zoom In = smaller range (10%)
        const btnMinus = mkBtn("-", () => zoom(1.1)); // Zoom Out = larger range (10%)

        const btnReset = mkBtn("↺", () => {
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
        btnReset.title = "Reset View";

        overlay.appendChild(btnPlus);
        overlay.appendChild(btnMinus);
        overlay.appendChild(btnReset);

        this.plotStage.appendChild(overlay);
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
     * Sets up mouse and touch event handlers for pan/zoom interactions.
     * @private
     */
    _initInteractions() {
        if (!this.config.interactive) return;

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

            this.interactions.isDragging = true;
            this.interactions.startX = e.clientX;
            this.interactions.startY = e.clientY;
            this.interactions.hasMoved = false;
            lastX = e.clientX;
            lastY = e.clientY;
            svg.setPointerCapture(e.pointerId);
            e.preventDefault();
        };

        // Pointer move handler (pan)
        svg.onpointermove = (e) => {
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
            this.interactions.isDragging = false;
            svg.releasePointerCapture(e.pointerId);
            if (!this.interactions.hasMoved && !isPinching) {
                this._openLightbox();
            }
        };

        // Wheel Zoom
        svg.onwheel = (e) => {
            if (Date.now() - this.lastScrollTime < 150) return; // Prevent zooming while scrolling page
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

                const newW = viewW * zoomFactor;
                const newH = viewH * zoomFactor;

                // Maintain ratio around mouseX/Y
                const xFrac = (mouseX - xMin) / viewW;
                const yFrac = (mouseY - yMin) / viewH;

                // New Min/Max
                const newXMin = mouseX - xFrac * newW;
                const newXMax = newXMin + newW;
                const newYMin = mouseY - yFrac * newH;
                const newYMax = newYMin + newH;

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
            nXMin += dxGraph;
            nXMax += dxGraph;
            nYMin += dyGraph;
            nYMax += dyGraph;

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
            this.view.xMin += dx;
            this.view.xMax += dx;
            this.view.yMin += dy;
            this.view.yMax += dy;
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

    draw() {
        // Clear dynamic groups
        this.gridGroup.innerHTML = "";
        this.dataGroup.innerHTML = "";
        this.axesGroup.innerHTML = "";
        this.numbersGroup.innerHTML = "";
        this.labelGroup.innerHTML = "";
        this.legendGroup.innerHTML = "";
        this.bgGroup.innerHTML = "";

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
        rect.setAttribute("x", this.padding);
        rect.setAttribute("y", this.padding);
        rect.setAttribute("width", this.width - 2 * this.padding);
        rect.setAttribute("height", this.height - 2 * this.padding);
        rect.setAttribute("fill", "#fff");
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
            if (Math.abs(x) > 1e-9 && this.config.showXTicks === true) {
                this._line(px, mapY(0), px, mapY(0) + 5, axisColor, 2, "", this.axesGroup);
            }
        }


        // X Numbers (Independent Loop)
        const xNumStep = xNumStepObj.val;
        if (this.config.showXNumbers !== false) {
            // Extend scan range slightly to catch border items
            const startNX = Math.ceil((xMin - xNumStep * 0.5) / xNumStep) * xNumStep;
            for (let x = startNX; x <= xMax + xNumStep * 0.5; x += xNumStep) {
                if (Math.abs(x) < 1e-9) continue; // Skip zero

                let px = mapX(x);
                let align = "middle";

                // Clamping Logic (Visual - 10px threshold)
                if (Math.abs(px - this.padding) < 10) {
                    px = this.padding;
                    align = "start";
                } else if (Math.abs(px - (this.width - this.padding)) < 10) {
                    px = this.width - this.padding;
                    align = "end";
                }

                if (px < this.padding || px > this.width - this.padding) continue;

                // Font size for shift calc
                const fsVal = this._getConfigSize('numberSize');

                // Align negative numbers (center the number part)
                if (x < -1e-9 && align === "middle") {
                    // Shift left by half a char width approx (0.3em)
                    px -= fsVal * 0.3;
                }

                this._text(px, mapY(0) + 15, formatTick(x, xNumStepObj.isPi, xNumStep), align, "top", "#666", "normal", this.numbersGroup, fsVal);
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
            if (Math.abs(y) > 1e-9 && this.config.showYTicks === true) {
                this._line(mapX(0) - 5, py, mapX(0), py, axisColor, 2, "", this.axesGroup);
            }
        }

        // Y Numbers (Independent Loop)
        const yNumStep = yNumStepObj.val;
        if (this.config.showYNumbers !== false) {
            const startNY = Math.ceil((yMin - yNumStep * 0.5) / yNumStep) * yNumStep;
            for (let y = startNY; y <= yMax + yNumStep * 0.5; y += yNumStep) {
                if (Math.abs(y) < 1e-9) continue;

                let py = mapY(y);
                let baseline = "middle";

                // Clamping Y (Visual - 10px threshold)
                if (Math.abs(py - (this.height - this.padding)) < 10) {
                    py = this.height - this.padding - 5;
                    baseline = "auto";
                } else if (Math.abs(py - this.padding) < 10) {
                    py = this.padding + 5;
                }

                if (py < this.padding || py > this.height - this.padding) continue;
                this._text(mapX(0) - 5, py, formatTick(y, yNumStepObj.isPi, yNumStep), "end", baseline, "#666", "normal", this.numbersGroup, this._getConfigSize('numberSize'));
            }
        }

        // Origin "0" (Shared)
        if (xMin <= 0 && xMax >= 0 && yMin <= 0 && yMax >= 0) {
            // Check visibility config if needed, usually we want 0 if numbers are on
            if (this.config.showXNumbers !== false || this.config.showYNumbers !== false) {
                const px = mapX(0) - 5; // Align with Y numbers (end anchor)
                const py = mapY(0) + 15; // Align with X numbers (top baseline)
                this._text(px, py, "0", "end", "top", "#666", "normal", this.numbersGroup, this._getConfigSize('numberSize'));
            }
        }
        // Main Axes - To AxesGroup
        const x0 = mapX(0), y0 = mapY(0);
        if (x0 >= this.padding && x0 <= this.width - this.padding) this._line(x0, this.padding, x0, this.height - this.padding, axisColor, 2, "", this.axesGroup);
        if (y0 >= this.padding && y0 <= this.height - this.padding) this._line(this.padding, y0, this.width - this.padding, y0, axisColor, 2, "", this.axesGroup);

        // Arrows - To AxesGroup (part of axes)
        if (this.config.axisArrows) {
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
            if (y0 >= this.padding && y0 <= this.height - this.padding) {
                const axX = this.width - this.padding + 5;
                const axY = y0;
                const arrowXPoly = document.createElementNS(ns, "polygon");
                // Tip at axX, base back 8px, width 6px
                arrowXPoly.setAttribute("points", `${axX},${axY} ${axX - 8},${axY - 4} ${axX - 8},${axY + 4}`);
                arrowXPoly.setAttribute("fill", axisColor);
                this.axesGroup.appendChild(arrowXPoly);
            }

            // Y Arrow (Positive)
            if (x0 >= this.padding && x0 <= this.width - this.padding) {
                const ayX = x0;
                const ayY = this.padding - 5;
                const arrowYPoly = document.createElementNS(ns, "polygon");
                // Tip at ayY, base down 8px, width 6px
                arrowYPoly.setAttribute("points", `${ayX},${ayY} ${ayX - 4},${ayY + 8} ${ayX + 4},${ayY + 8}`);
                arrowYPoly.setAttribute("fill", axisColor);
                this.axesGroup.appendChild(arrowYPoly);
            }
        }

        // Axis Labels
        if (this.config.axisLabels) {
            const lblSize = this._getConfigSize('labelSize');
            this._text(this.width - this.padding + 10, y0, this.config.axisLabels[0], "start", "middle", axisColor, "bold", this.axesGroup, lblSize);
            this._text(x0, this.padding - 15, this.config.axisLabels[1], "middle", "bottom", axisColor, "bold", this.axesGroup, lblSize);
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
                labelPos = { x: mapX(item.labelAt[0]), y: mapY(item.labelAt[1]) };
            }

            if (item.label && this.config.legend) {
                legendItems.push({ color, label: item.label, type: item.points ? 'point' : 'line', dash });
            }

            // Function
            // Function (Adaptive Sampling)
            if (item.fn) {
                try {
                let d = "";
                let started = false;
                const f = new Function("x", `return ${this._makeFn(item.fn)};`);
                // Test call to catch syntax errors early
                try { f(0); } catch(e) { throw new Error(`Function '${item.fn}' error: ${e.message}`); }

                // Adaptive State
                const MAX_DEPTH = 8;
                const TOLERANCE = 0.2; // Tighter tolerance for smoother curves

                const safeMapY = (y) => {
                    const py = mapY(y);
                    if (py < -10000) return -10000;
                    if (py > 10000) return 10000;
                    return py;
                };

                // Helper to check validity (finite + domain)
                const isValid = (x, y) => {
                    if (!isFinite(y)) return false;
                    if (item.domain && (x < item.domain[0] || x > item.domain[1])) return false;
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
                        // Asymptote Break: Huge jump AND opposite signs relative to viewport center (heuristic)? 
                        // Or just huge jump. For 1/x, jump is Infinity. Clampped to 20000.
                        // For tan(x), jump is also huge.
                        // We connect if jump is reasonable.

                        // Heuristic: If jump > 2 * Height, assume asymptote and break.
                        // EXCEPT if "Bridging" a hole? No, if we are here (v1 && v2), we just bridged the hole 
                        // by recursion (midpoint became valid or we reached max depth).
                        // Wait, if we reached max depth and mid was invalid, we are NOT in (v1 && v2) branch?
                        // Correct. This branch is for "we found a valid segment". 

                        if (jump < this.height * 2) {
                            if (!started) { d += `M ${p1X} ${p1Y}`; started = true; }
                            d += ` L ${p2X} ${p2Y}`;
                            if (!item.labelAt) labelPos = { x: p2X, y: p2Y };
                        } else {
                            // Break
                            started = false;
                        }
                    }

                    // Case 2: Bridging a Hole (Removable Discontinuity)
                    // We reached MAX_DEPTH. v1 is valid, v2 is valid, but we couldn't resolve the middle.
                    // This happens for sin(x)/x at 0 (undefined at 0).
                    // x1 is -epsilon, x2 is +epsilon.
                    else if (v1 && v2 && !vm) {
                        // Check continuity
                        const jump = Math.abs(p2Y - p1Y);
                        if (jump < 50) { // arbitrary small threshold for visual continuity
                            // Bridge it!
                            if (!started) { d += `M ${p1X} ${p1Y}`; started = true; }
                            d += ` L ${p2X} ${p2Y}`;
                            if (!item.labelAt) labelPos = { x: p2X, y: p2Y };
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
                if (item.domain) {
                    rMin = Math.max(rMin, item.domain[0]);
                    rMax = Math.min(rMax, item.domain[1]);
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
                    // Default to 2px for better quality (was 5px)
                    const sampleStep = this.config.sampleStep || 2;
                    const coarseSteps = this.width / sampleStep;
                    const dx = (xMax - xMin) / coarseSteps;
                    let curr = rMin;

                    while (curr < rMax - 1e-9) {
                        let next = curr + dx;
                        if (next > rMax) next = rMax;
                        // Avoid tiny last step
                        if (Math.abs(next - rMax) < 1e-9) next = rMax;

                        const isDomainMin = item.domain && (Math.abs(curr - item.domain[0]) < 1e-9);
                        let yStart = evalEdge(curr, isDomainMin, false);

                        const isDomainMax = item.domain && (Math.abs(next - item.domain[1]) < 1e-9);
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
                path.setAttribute("stroke", color);
                path.setAttribute("stroke-width", width);
                if (dash) path.setAttribute("stroke-dasharray", dash);
                if (item.opacity !== undefined) path.setAttribute("opacity", item.opacity);
                this.dataGroup.appendChild(path);
                } catch (e) {
                    this._addWarning(`Error rendering function '${item.fn}': ${e.message}`);
                }
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

                        const seg = (P1, P2) => `M ${mapX(P1[0])} ${mapY(P1[1])} L ${mapX(P2[0])} ${mapY(P2[1])}`;

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

            // Vertical Line
            if (item.x !== undefined) {
                const px = mapX(item.x);
                if (px >= this.padding && px <= this.width - this.padding) {
                    const l = this._line(px, this.padding, px, this.height - this.padding, color, width, dash, this.dataGroup);
                    if (item.opacity !== undefined) l.setAttribute("opacity", item.opacity);
                    if (!item.labelAt) labelPos = { x: px, y: this.padding + 15 };
                }
            }

            // Points
            if (item.points) {
                item.points.forEach(pt => {
                    const px = mapX(pt[0]), py = mapY(pt[1]);
                    if (px >= 0 && px <= this.width && py >= 0 && py <= this.height) {
                        const c = document.createElementNS(ns, "circle");
                        c.setAttribute("cx", px); c.setAttribute("cy", py);
                        c.setAttribute("r", item.radius || 4);
                        c.setAttribute("fill", item.fillColor || color);
                        c.setAttribute("stroke", item.strokeColor || "none");
                        c.setAttribute("stroke-width", item.strokeWidth || 0);
                        if (item.opacity !== undefined) c.setAttribute("opacity", item.opacity);
                        this.dataGroup.appendChild(c);
                        // Use last point for label if no labelAt
                        if (!item.labelAt) labelPos = { x: px, y: py };
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
                const displayLabel = item.label.replace(/\*/g, '·');
                this._text(lx, ly, displayLabel, anchor, "bottom", color, labelWeight, this.labelGroup, this._getConfigSize('labelSize'));
            }
        });

        // --- 4. Legend ---
        if (this.config.legend && legendItems.length > 0) {
            this._drawLegend(legendItems);
        }
    }

    _drawLegend(items) {
        const x = this.width - this.padding - 10;
        const y = this.padding + 10;

        const fs = this._getConfigSize('legendSize');

        // Dynamic width calculation
        let w;
        if (this.config.legendWidth) {
            w = this.config.legendWidth;
        } else {
            let maxLen = 0;
            items.forEach(it => maxLen = Math.max(maxLen, it.label.length));
            // Approx width: Symbol (30) + Chars * (FontSize * 0.6) + Padding (20)
            w = 30 + (maxLen * (fs * 0.6)) + 20;
            if (w < 120) w = 120; // Min width
        }

        const h = items.length * (fs * 1.5) + 10; // Dynamic height based on font size
        const labelWeight = this.config.labelWeight || "normal";

        // bg
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", x - w);
        rect.setAttribute("y", y);
        rect.setAttribute("width", w);
        rect.setAttribute("height", h);
        rect.setAttribute("fill", "white");
        rect.setAttribute("fill-opacity", "0.9");
        rect.setAttribute("stroke", "#eee");
        // rect.setAttribute("rx", 4); // Square corners requested
        this.legendGroup.appendChild(rect);

        items.forEach((item, i) => {
            const ly = y + 15 + i * (fs * 1.5);
            const lx = x - w + 10;
            // Symbol
            const symbolY = ly + (fs / 3); // Align with text baseline shift
            if (item.type === 'point') {
                const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                c.setAttribute("cx", lx + 5); c.setAttribute("cy", symbolY); c.setAttribute("r", 4);
                c.setAttribute("fill", item.color);
                this.legendGroup.appendChild(c);
            } else {
                this._line(lx, symbolY, lx + 15, symbolY, item.color, 2, item.dash, this.legendGroup);
            }

            // Text or MathJax
            if (window.MathJax && item.label.includes("$")) {
                const tex = item.label.replace(/\$/g, "");
                const svgNode = MathJax.tex2svg(tex).querySelector("svg");
                if (svgNode) {
                    // Inject vector math
                    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
                    g.setAttribute("transform", `translate(${lx + 25}, ${ly - 5}) scale(0.015)`); // MathJax scale is usually huge
                    g.setAttribute("fill", "#333"); // Force color
                    // We need to copy paths deeply
                    g.innerHTML = svgNode.innerHTML;
                    // Note: MathJax SVG uses <use> refs, needs <defs>. Complicated.
                    // Simpler fallback for now: just try innerHTML or text fallback if complicated
                    // Actually, standard mathjax output relies on defs. We might break it if we don't copy defs.
                    // Let's stick to text fallback for reliability in this fast iter.
                    this._text(lx + 25, ly + (fs / 3), item.label.replace(/\*/g, '·'), "start", "middle", "#333", labelWeight, this.legendGroup, fs);
                }
            } else {
                this._text(lx + 20, ly + (fs / 3), item.label.replace(/\*/g, '·'), "start", "middle", "#333", labelWeight, this.legendGroup, fs);
            }
        });
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
    _text(x, y, str, anchor, baseline, color, weight = "normal", parent = this.axesGroup, size = null) {
        const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
        t.setAttribute("x", x);
        t.setAttribute("y", y);
        t.setAttribute("text-anchor", anchor);
        t.setAttribute("dominant-baseline", baseline);
        t.setAttribute("fill", color);
        const fSize = (size !== null) ? size + "px" : "18px";
        t.setAttribute("font-size", fSize);
        t.setAttribute("font-weight", weight);
        t.textContent = str;
        t.style.paintOrder = "stroke";
        t.style.stroke = "#fff";
        t.style.strokeWidth = "2.5px";
        parent.appendChild(t);
    }

    // =========================================================================
    // PRIVATE: ERROR HANDLING / VALIDATION
    // =========================================================================

    _validateConfig() {
        const VALID_ROOT_KEYS = [
            "width", "height", "aspectRatio", "cssWidth", "fullWidth", "align",
            "marginLeft", "marginRight", "border", "sliderBorder",
            "xlim", "ylim", "interactive", "theme", "legend", "legendWidth",
            "padding", "grid", "gridOpacity", "axisArrows", "axisLabels",
            "xStep", "yStep", "xStepSecondary", "yStepSecondary", "showSecondaryGrid", "showGrid",
            "xNumberStep", "yNumberStep", "showXNumbers", "showYNumbers",
            "showXTicks", "showYTicks", "secondaryGridOpacity",
            "sampleStep", "fontSize", "renderOrder", "params", "data", "labelWeight",
            "numberSize", "labelSize", "legendSize"
        ];

        const VALID_DATA_KEYS = [
            "fn", "implicit", "points", "x", "color", "opacity", "width", "strokeWidth",
            "dash", "label", "labelAt", "labelOffset", "labelAnchor",
            "domain", "radius", "fillColor", "strokeColor" 
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
                        this._addWarning(`Unknown data option in item ${i+1}: '${key}'`);
                    }
                }
                // Check Essentials
                if (!item.fn && !item.implicit && !item.points && item.x === undefined) {
                    this._addWarning(`Data item ${i+1} has no content (missing 'fn', 'points', 'implicit', or 'x').`);
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

    // =========================================================================
    // PRIVATE: LIGHTBOX
    // =========================================================================

    /**
     * Opens the plot in a lightbox overlay.
     * @private
     */
    _openLightbox() {
        const serializer = new XMLSerializer();
        let source = serializer.serializeToString(this.svg);
        
        if (!source.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
            source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
        }
        
        // Scale up for lightbox while maintaining aspect ratio
        const maxDim = 1200;
        const scale = Math.min(maxDim / this.width, maxDim / this.height);
        const newW = Math.round(this.width * scale);
        const newH = Math.round(this.height * scale);

        source = source.replace(/width="[^"]*"/, `width="${newW}"`);
        source = source.replace(/height="[^"]*"/, `height="${newH}"`);

        const url = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(source)));
        const lb = document.getElementById('lightbox');
        const img = document.getElementById('lightbox-img');
        if (lb && img) {
            lb.style.display = "flex";
            img.src = url;
        }
    }
}

if (typeof module !== 'undefined') module.exports = MatephisPlot;