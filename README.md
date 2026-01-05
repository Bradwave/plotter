# Matephis Plotter

A powerful, interactive graphing tool built with the **Matephis Plot** library. This application provides a user-friendly interface to create, customize, and explore mathematical plots, supporting explicit functions, implicit equations, points, and dynamic parameters.

## Features

-   **Interactive Plotting:** Pan and zoom to explore functions.
-   **Multiple Data Types:** Plot explicit functions (`y = f(x)`), implicit equations (`x^2 + y^2 = 1`), vertical lines, and points.
-   **Dynamic Parameters:** Define parameters (e.g., `a`, `b`) and adjust them in real-time using sliders.
-   **Customizable Styling:** Rich theming options, grid controls, axis labeling, and legend positioning.
-   **JSON Configuration:** Full control over the plot via a dedicated JSON editor.

## JSON Configuration Reference

The plotter is powered by a JSON configuration object. You can edit this directly in the "JSON Configuration" panel.

### Global Settings

| Key | Type | Description |
| :--- | :--- | :--- |
| `width` | `number` | Width of the plot in pixels (default: `600`). |
| `height` | `number` | Height of the plot in pixels. Ignored if `aspectRatio` is set. |
| `aspectRatio` | `number` / `string` | Aspect ratio (width/height), e.g., `1.5` or `"16:9"`. |
| `fullWidth` | `boolean` | If `true`, the plot takes the full width of its container. |
| `xlim` | `[min, max]` | Initial X-axis range (e.g., `[-10, 10]`). |
| `ylim` | `[min, max]` | Initial Y-axis range (e.g., `[-10, 10]`). |
| `padding` | `number` | Internal padding in pixels (default: auto). |
| `border` | `boolean` | Show a border around the plot. |
| `interactive` | `boolean` | Enable pan/zoom interactions. |
| `theme` | `string` | Color theme: `"default"`, `"red"`, `"black"`, `"sunburst"`, `"coastal"`, `"seaside"`. |

### Grid & Axes

| Key | Type | Description |
| :--- | :--- | :--- |
| `grid` | `boolean` | Show/hide the main grid. |
| `gridOpacity` | `number` | Opacity of the main grid lines (0-1). |
| `showSecondaryGrid`| `boolean` | Show/hide the finer secondary grid. |
| `axisLabels` | `[x, y]` | Labels for the axes (e.g., `["Time", "Velocity"]`). |
| `axisArrows` | `boolean` | Add arrowheads to the axes. |
| `xStep` / `yStep` | `number` / `string` | Grid spacing (e.g., `1`, `0.5`, `"pi"`). |
| `showXNumbers` | `boolean` | Show/hide numbers on the X-axis. |
| `showXTicks` | `boolean` | Show/hide tick marks on the X-axis. |

### Legend

| Key | Type | Description |
| :--- | :--- | :--- |
| `legend` | `boolean` | Enable the legend. |
| `legendPosition` | `string` | `"top-right"`, `"top-left"`, `"bottom-right"`, `"bottom-left"`. |
| `legendWidth` | `number` | Fixed width for the legend box. |

### Data Items (`data` Array)

The `data` array contains objects representing what to draw.

#### 1. Explicit Function
Draws a curve where `y` is a function of `x`.
```json
{
  "fn": "sin(x) * x",
  "color": "red",
  "width": 3,
  "label": "y = x sin(x)",
  "domain": [-5, 5] // Optional: limit x range
}
```

#### 2. Implicit Equation
Draws curves where the equation is true.
```json
{
  "implicit": "x^2 + y^2 = 25",
  "color": "blue",
  "width": 2,
  "label": "Circle"
}
```
*Note: Supports implicit multiplication (e.g., `2xy` is treated as `2*x*y`).*

#### 3. Vertical Line
```json
{
  "x": 3,
  "color": "green",
  "dash": "5,5",
  "label": "Threshold"
}
```

#### 4. Points
Plots a set of coordinate points.
```json
{
  "points": [[1, 2], [3, 4], [5, 1]],
  "color": "#ff00ff",
  "radius": 5,
  "fillColor": "yellow"
}
```

### Parameters (`params` Object)

Define variables that can be used in functions and controlled via sliders.

```json
"params": {
  "a": { "val": 1, "min": -5, "max": 5, "step": 0.1 },
  "k": { "val": 2 }
}
```
**Usage:** Use the parameter name in your functions (e.g., `"fn": "a * x^2 + k"`).

## Basic Usage Guide

1.  **Add Data:** Use the "Data" section in the sidebar to add functions, implicit equations, or points.
2.  **Adjust Settings:** Use the "Plot Settings" and "Grid & Axis" sections to customize the visual appearance.
3.  **Use Parameters:**
    -   Click "+ Add Parameter" to create a new variable (e.g., `k`).
    -   Use this variable in your function definitions (e.g., `sin(k * x)`).
    -   Adjust the slider to see dynamic changes.
4.  **JSON Mode:** For advanced control, expand the "JSON Configuration" panel at the bottom left to edit the configuration object directly.
5.  **Export/Share:** Copy the JSON configuration to share your plot setup or embed it in other applications using the Matephis library.

## Implicit Multiplication
The parser supports implicit multiplication for defined parameters and standard variables.
-   `ax` -> `a * x` (if `a` is a parameter)
-   `2x` -> `2 * x`
-   `x(x+1)` -> `x * (x+1)`
