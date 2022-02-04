<script lang="ts">
	import { Router, Route } from "svelte-navigator";
	import Home from "./Home.svelte";
	import Login from "./Login.svelte";
	import Math from "./Math.svelte";
	import Register from "./Register.svelte";
	import SlopeField from "./SlopeField.svelte";

	export let url = "/";
</script>

<Router {url}>
	<div>
		<Route path="/school/calculus/0.2" component={Math} />
		<Route path="/slopefield" component={SlopeField} />
		<Route path="/register" component={Register} />
		<Route path="/login" component={Login} />
		<Route path="/" component={Home} />
	</div>
</Router>
