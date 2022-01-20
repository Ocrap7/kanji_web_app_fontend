<script lang="ts">
    let email = "";
    let password = "";
</script>

<div>
    <h1>Login</h1>
    <div class="container">
        <input type="email" placeholder="email" bind:value={email} required />
        <input
            type="password"
            placeholder="password"
            bind:value={password}
            required
        />
    </div>
</div>

<style>
    .container {
        margin: 0 auto;
        margin-top: 50px;
        padding: 20px;
        padding-top: 40px;
        padding-bottom: 0;
        width: 100%;
        height: 100%;
        max-width: 500px;
        max-height: 500px;
        background-color: var(--sub-color);
        border-radius: 5px;

        -webkit-box-shadow: -2px 5px 12px 5px rgba(0, 0, 0, 0.22);
        box-shadow: -2px 5px 12px 5px rgba(0, 0, 0, 0.22);
    }

    .container > input {
        width: 80%;
        margin: 0 auto;
        display: block;
        margin-bottom: 40px;
        border-radius: 5px;
    }
</style>
