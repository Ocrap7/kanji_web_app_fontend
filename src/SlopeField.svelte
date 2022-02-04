<script lang="ts">
    import { onMount } from "svelte";
    import { prevent_default, xlink_attr } from "svelte/internal";
    import { get } from "svelte/store";
    import { scale } from "svelte/types/runtime/transition";
    import Decimal from "./decimal";
    import {
        height,
        pixelRatio,
        width,
        canvas as canvasStore,
        context as contextStore,
    } from "./game";

    const pattern = "^d*(.d{0,2})?$";
    const start_scale = 80;

    function updateObject(target, src) {
        const res = {};
        Object.keys(target).forEach((k) => (res[k] = src[k] ?? target[k]));
        return res;
    }

    class Interface {
        _length: number;
        _bounds: { lowx: number; highx: number; lowy: number; highy: number };
        _scale: number;
        _step: number;

        set allBounds(value: number) {
            this._bounds = {
                lowx: -value,
                highx: value,
                lowy: -value,
                highy: value,
            };
        }

        get allBounds(): number {
            const comp = [
                this._bounds.lowx,
                this._bounds.highx,
                this._bounds.lowy,
                this._bounds.highy,
            ];
            const sum = comp.reduce((prev, curr) => prev + Math.abs(curr), 0);
            if (sum === Math.abs(comp[0]) * comp.length)
                return Math.abs(comp[0]);
            else return 0;
        }

        set length(value: number) {
            if (typeof value === "number") myInterface._length = value;
        }

        get length(): number {
            return myInterface.length;
        }

        set bounds(value: any) {
            if (typeof value === "object") updateObject(myInterface, value);
        }

        get bounds(): any {
            return myInterface._bounds;
        }

        set scale(value: number) {
            if (typeof value === "number") myInterface._scale = value;
        }

        get scale(): number {
            return myInterface._scale;
        }

        constructor() {
            this._length = 1;
            this._bounds = {
                lowx: -5,
                highx: 5,
                lowy: -5,
                highy: 5,
            };
            this._scale = 1;
            this._step = 1;
        }

        animate(property: string, minValue = 0, maxValue = 1, step = 0.1) {
            let delta = step;
            setInterval(() => {
                const value = this[`_${property}`];
                if (value >= maxValue || value <= minValue) {
                    delta *= -1;
                }
                this[property] = value + delta;
            }, 10);
        }
    }

    let myInterface = new Interface();
    let canvas: HTMLCanvasElement;
    let context: CanvasRenderingContext2D;

    let axes = {
        x0: 0, // x0 pixels from left to x=0
        y0: 0, // y0 pixels from top to y=0
        scale: start_scale, // 40 pixels from x=0 to x=1
        doNegativeX: true,
    };

    const clamp = (num, min, max) => Math.min(Math.max(num, min), max);

    const executeCode = (code: string) => {
        const result = eval(code);
        console.log(result);
    };

    onMount(() => {
        const hscale = 5 / 4;
        console.log(window);
        width.set(document.body.clientWidth / 2);
        height.set(document.body.clientHeight / hscale);

        context = canvas.getContext("2d", {});
        canvasStore.set(canvas);
        contextStore.set(context);
        canvas.width = document.body.clientWidth / 2;
        canvas.height = document.body.clientHeight / hscale;

        axes = {
            x0: Math.round(0.5 + 0.5 * canvas.width), // x0 pixels from left to x=0
            y0: Math.round(0.5 + 0.5 * canvas.height), // y0 pixels from top to y=0
            scale: start_scale, // 40 pixels from x=0 to x=1
            doNegativeX: true,
        };

        display(
            myInterface._step,
            myInterface._scale,
            myInterface._bounds,
            myInterface._length
        );

        document.addEventListener("wheel", scroll, { passive: false });
        const anyWindow = window as any;

        anyWindow.sf = myInterface;

        anyWindow.YUI().use("aui-ace-editor", function (Y) {
            // code goes here
            let editor = new Y.AceEditor({
                boundingBox: "#editor",
                mode: "javascript",
                width: `${document.body.clientWidth / 2 + 300}`,
                height: "700",
                showPrintMargin: false,
            }).render();

            let clear;
            editor.getEditor().on("change", () => {
                if (clear === undefined) {
                    clear = setTimeout(() => {
                        executeCode(editor.getEditor().getValue());
                        clear = undefined;
                    }, 1000);
                } else {
                    clearTimeout(clear);
                    clear = setTimeout(() => {
                        executeCode(editor.getEditor().getValue());
                        clear = undefined;
                    }, 1000);
                }
            });

            console.log(editor);
            editor.getEditor().setTheme("ace/theme/monokai");
        });
    });

    const scroll = (e) => {
        if (e.target != canvas) return;
        e.preventDefault();
        // console.log(e);
        myInterface._scale +=
            (clamp(e.wheelDeltaY, -1, 1) * myInterface._scale) / 20;
        // display(
        //     myInterface._step,
        //     myInterface._scale,
        //     myInterface._bounds,
        //     myInterface._length
        // );
        return false;
    };

    const display = (
        gap: number,
        scale: number,
        bounds: any,
        length: number
    ) => {
        context.clearRect(0, 0, canvas.width, canvas.height);
        showAxes({ ...axes, scale: start_scale * scale });
        slope_field(
            { ...axes, scale: start_scale * scale },
            (x, y) => x,
            gap,
            bounds,
            length
        );
    };

    $: {
        if (context) {
            display(
                myInterface._step,
                myInterface._scale,
                myInterface._bounds,
                myInterface._length
            );
        }
    }

    // $: console.log('ptoaj', myInterface)

    const nearest = (value: number, to: number) => Math.round(value / to) * to;

    function slope_field(
        axes,
        func: (x: number, y: number) => number,
        gap: number,
        bounds: any,
        length: number
    ) {
        for (
            let x = nearest(bounds.lowx, gap);
            x <= nearest(bounds.highx, gap);
            x += gap
        ) {
            for (
                let y = nearest(bounds.lowy, gap);
                y <= nearest(bounds.highy, gap);
                y += gap
            ) {
                line(axes, x, y, func(x, y), length);
            }
        }
    }

    function line(axes, x, y, slope, length) {
        const lh = (length / 2) * axes.scale;
        const x0 = axes.x0;
        const y0 = axes.y0;

        if (slope == 0) {
            context.beginPath();
            context.moveTo(x0 + (x * axes.scale + lh), y0 - y * axes.scale);
            context.lineTo(x0 + (x * axes.scale - lh), y0 - y * axes.scale);
            context.stroke();
            return;
        }

        const xx = lh / Math.sqrt(1 + slope * slope);
        const yy = (lh * slope) / Math.sqrt(1 + slope * slope);

        const scale = axes.scale;
        const iMax = x * scale + xx;
        const iMin = x * scale - xx;

        context.beginPath();
        context.lineWidth = 2;
        context.strokeStyle = "rgb(11,153,11)";

        context.moveTo(x0 + iMin, y0 - (y * scale - yy));
        context.lineTo(x0 + iMax, y0 - (y * scale + yy));

        context.stroke();
    }

    function funGraph(
        axes: any,
        func: (x: number) => number,
        color: string,
        thick: number
    ) {
        var xx,
            yy,
            dx = 4,
            x0 = axes.x0,
            y0 = axes.y0,
            scale = axes.scale;
        var iMax = Math.round((context.canvas.width - x0) / dx) + 10;
        var iMin = (axes.doNegativeX ? Math.round(-x0 / dx) : 0) - 10;
        context.beginPath();
        context.lineWidth = thick;
        context.strokeStyle = color;

        for (var i = iMin; i <= iMax; i++) {
            xx = dx * i;
            yy = scale * func(xx / scale);
            if (i == iMin) context.moveTo(x0 + xx, y0 - yy);
            else context.lineTo(x0 + xx, y0 - yy);
        }
        context.stroke();
    }

    let n = 1;
    let last_point = start_scale;

    function showAxes(axes) {
        var x0 = axes.x0,
            w = context.canvas.width;
        var y0 = axes.y0,
            h = context.canvas.height;
        var xmin = axes.doNegativeX ? 0 : x0;
        context.beginPath();
        context.strokeStyle = "rgb(0, 0, 0)";
        context.moveTo(xmin, y0);
        context.lineTo(w, y0); // X axis
        context.moveTo(x0, 0);
        context.lineTo(x0, h); // Y axis

        context.font = "1em Roboto Mono";
        context.textAlign = "right";
        context.textBaseline = "middle";

        // n = Math.max(1/Math.ceil((1/100) * (axes.scale)), 0);
        // if
        // n = Math.pow(2, Math.ceil(-axes.scale / start_scale / 2 ));
        // n = Math.ceil(-axes.scale / 40) + 10
        // n = Math.log10(axes.scale / 8)
        // n = Math.pow(1 / 2, axes.scale / start_scale);
        // let val = 1;
        // for (let i = 0; i < axes.scale / start_scale; i++) {
        //    val /= 2;
        // }
        // n = val;

        // const prop = 4.5;
        // if (n * axes.scale > n * prop * last_point) {
        //     n /= 2;
        //     last_point = axes.scale;
        // }
        // if (n * axes.scale < n * (1 / prop) * last_point) {
        //     n *= 2;
        //     last_point = axes.scale;
        // }
        if (axes.scale > last_point + last_point / 2) {
            n /= 2;
        } else if (axes.scale < last_point + last_point / 2) {
            n *= 2;
        }
        last_point = axes.scale;
        console.log(n, axes.scale, axes.scale / start_scale - 1);

        for (
            let i = axes.scale * n;
            i < context.canvas.height / 2;
            i += axes.scale * n
        ) {
            context.fillText(
                `${new Decimal(i / axes.scale).toNearest(
                    new Decimal(0.000001)
                )}`,
                x0 - 5,
                y0 - i
            );
        }

        for (
            let i = -axes.scale * n;
            i > -context.canvas.height / 2;
            i -= axes.scale * n
        ) {
            context.fillText(
                `${new Decimal(i / axes.scale).toNearest(
                    new Decimal(0.000001)
                )}`,
                x0 - 5,
                y0 - i
            );
        }

        context.textAlign = "center";
        context.textBaseline = "top";
        for (
            let i = axes.scale * n;
            i < context.canvas.width / 2;
            i += axes.scale * n
        ) {
            context.fillText(
                `${new Decimal(i / axes.scale).toNearest(
                    new Decimal(0.000001)
                )}`,
                x0 - i,
                y0 + 5
            );
        }

        for (
            let i = axes.scale * n;
            i < context.canvas.width / 2;
            i += axes.scale * n
        ) {
            context.fillText(
                `${new Decimal(i / axes.scale).toNearest(
                    new Decimal(0.000001)
                )}`,
                x0 + i,
                y0 + 5
            );
        }
        context.stroke();
    }
</script>

<div class="container">
    <div class="controls" style="height: {$height}px;">
        <div class="controls-body">
            <div class="input-group">
                <label for="length">Length:</label>
                <input
                    id="length"
                    type="number"
                    bind:value={myInterface._length}
                    step="any"
                />
            </div>
            <div class="input-group">
                <input
                    id="lengthrange"
                    type="range"
                    min="0"
                    max="10"
                    step="0.01"
                    bind:value={myInterface._length}
                    style="width: 200px;"
                />
            </div>

            <div class="input-group">
                <label for="step">Step:</label>
                <input
                    id="step"
                    type="number"
                    bind:value={myInterface._step}
                    step="any"
                />
            </div>
            <div class="input-group">
                <input
                    id="steprane"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    bind:value={myInterface._step}
                    style="width: 200px;"
                />
            </div>

            <div class="input-group">
                <label for="lowx">Min X:</label>
                <input
                    id="lowx"
                    type="number"
                    bind:value={myInterface._bounds.lowx}
                    step="any"
                />
            </div>
            <div class="input-group">
                <input
                    type="range"
                    min="-100"
                    max="100"
                    step="0.01"
                    bind:value={myInterface._bounds.lowx}
                    style="width: 200px;"
                />
            </div>

            <div class="input-group">
                <label for="maxx">Max X:</label>
                <input
                    id="maxx"
                    type="number"
                    bind:value={myInterface._bounds.highx}
                    step="any"
                />
            </div>
            <div class="input-group">
                <input
                    type="range"
                    min="-100"
                    max="100"
                    step="0.01"
                    bind:value={myInterface._bounds.highx}
                    style="width: 200px;"
                />
            </div>

            <div class="input-group">
                <label for="lowy">Min Y:</label>
                <input
                    id="lowy"
                    type="number"
                    bind:value={myInterface._bounds.lowy}
                    step="any"
                />
            </div>
            <div class="input-group">
                <input
                    type="range"
                    min="-100"
                    max="100"
                    step="0.01"
                    bind:value={myInterface._bounds.lowy}
                    style="width: 200px;"
                />
            </div>

            <div class="input-group">
                <label for="highy">Max Y:</label>
                <input
                    id="highy"
                    type="number"
                    bind:value={myInterface._bounds.highy}
                    step="any"
                />
            </div>
            <div class="input-group">
                <input
                    type="range"
                    min="-100"
                    max="100"
                    step="0.01"
                    bind:value={myInterface._bounds.highy}
                    style="width: 200px;"
                />
            </div>

            <div class="input-group">
                <label for="scale">Bounds:</label>
                <input
                    id="scale"
                    type="number"
                    bind:value={myInterface.allBounds}
                    step="any"
                />
            </div>
            <div class="input-group">
                <input
                    type="range"
                    min="0"
                    max="100"
                    step="0.01"
                    bind:value={myInterface.allBounds}
                    style="width: 200px;"
                />
            </div>

            <div class="input-group">
                <label for="scale">Scale:</label>
                <input
                    id="scale"
                    type="number"
                    bind:value={myInterface._scale}
                    step="any"
                />
            </div>
            <div class="input-group">
                <input
                    type="range"
                    min="0.1"
                    max="5"
                    step="0.01"
                    bind:value={myInterface._scale}
                    style="width: 200px;"
                />
            </div>
        </div>
    </div>
    <canvas
        class="main-canvas"
        bind:this={canvas}
        style="width: {$width}px; height: {$height}px; "
    />
</div>

<div class="container" style="margin-top: 50px; ">
    <div id="editor" />
</div>

<style>
    #editor {
        font-size: 1.5em;
        border-radius: 10px;
    }

    .controls {
        width: 300px;
    }

    .controls-body {
        padding: 10px;
        padding-right: 0;
        width: 100%;
        height: 100%;
        background-color: rgb(107, 107, 107);
        border-radius: 10px;
        overflow: scroll;
        overflow-x: hidden;
        scrollbar-color: rgb(31, 31, 31) rgb(107, 107, 107);
        scrollbar-width: thin;
        /* display: flex; */
        /* justify-content: center; */
    }

    .controls-body > * {
        max-height: 40px;
    }

    input {
        width: 40%;
        background: none;
        outline: none;
        border: none;
        border-radius: 0;
        border-bottom: black solid 1px;
        -webkit-appearance: none;
        -moz-appearance: textfield;
        transition: background-color 200ms ease-in-out;
    }

    input[type="number"]:focus {
        background-color: rgba(0, 0, 0, 0.109);
    }

    .input-group {
        display: flex;
        flex-direction: row;
        justify-content: center;
        align-items: center;
        gap: 40px;
    }

    .main-canvas {
        /* border-left: black solid 4px; */
        border: black solid 4px;
    }

    .container {
        display: flex;
        padding: 10px;
        justify-content: center;
    }
</style>
