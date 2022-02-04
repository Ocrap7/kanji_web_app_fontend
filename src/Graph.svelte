<script context="module" lang="ts">
    export const colors =
        typeof window === "undefined" ? {} : (window as any).Desmos.Colors;
</script>

<script lang="ts">
    import { onMount } from "svelte";

    import Equation from "./Equation.svelte";

    export let equation: string | string[];
    export let color: string = colors.RED;
    export let options: any = {};
    export let bounds: {
        left: number;
        right: number;
        bottom: number;
        top: number;
    } = { left: -10, right: 10, bottom: -10, top: 10 };

    export let display = (x) => {};

    export let width = 200;
    export let height = 200;

    let element;

    onMount(() => {
        const calc = (window as any).Desmos.GraphingCalculator(element, {
            expressions: false,
            keypad: false,
            settingsMenu: false,
            zoomFit: false,
        });
        calc.setMathBounds(bounds);
        if (typeof equation === "string") {
            calc.setExpression({ latex: equation, color, ...options });
        } else {
            for (let eq of equation) {
                calc.setExpression({ latex: eq, color, ...options });
            }
        }
        display(calc);
    });
</script>

<div class="graph-container">
    <Equation>{equation}</Equation>
    <div
        bind:this={element}
        class="graph"
        style="width: {width}px; height: {height}px;"
    />
</div>

<style>
    /* .graph {
        width: 200px;
        height: 200px;
    } */

    .graph-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 20px;
    }

    .graph-container > .graph {
        border-radius: 10px;
        /* width: 200px;
        height: 200px; */
    }
</style>
