<script lang="ts">
    import { onMount } from "svelte";

    let equation;

    onMount(() => {
        (window as any).MQ.StaticMath(equation)
    });
</script>

<span class="equ" bind:this={equation}> <slot /></span>
