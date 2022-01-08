<script lang="ts">
	import { Router, Route } from "svelte-navigator";
	import Home from "./Home.svelte";
	import Login from "./Login.svelte";
	import Register from "./Register.svelte";

	export let url = "/";
</script>

<Router {url}>
	<div>
		<Route path="/register" component={Register} />
		<Route path="/login" component={Login} />
		<Route path="/" component={Home} />
	</div>
</Router>
