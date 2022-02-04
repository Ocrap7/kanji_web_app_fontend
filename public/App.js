'use strict';

function noop() { }
function run(fn) {
    return fn();
}
function blank_object() {
    return Object.create(null);
}
function run_all(fns) {
    fns.forEach(run);
}
function is_function(thing) {
    return typeof thing === 'function';
}
function safe_not_equal(a, b) {
    return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
}
function subscribe(store, ...callbacks) {
    if (store == null) {
        return noop;
    }
    const unsub = store.subscribe(...callbacks);
    return unsub.unsubscribe ? () => unsub.unsubscribe() : unsub;
}
function get_store_value(store) {
    let value;
    subscribe(store, _ => value = _)();
    return value;
}
function compute_rest_props(props, keys) {
    const rest = {};
    keys = new Set(keys);
    for (const k in props)
        if (!keys.has(k) && k[0] !== '$')
            rest[k] = props[k];
    return rest;
}
function null_to_empty(value) {
    return value == null ? '' : value;
}

let current_component;
function set_current_component(component) {
    current_component = component;
}
function get_current_component() {
    if (!current_component)
        throw new Error('Function called outside component initialization');
    return current_component;
}
function onMount(fn) {
    get_current_component().$$.on_mount.push(fn);
}
function onDestroy(fn) {
    get_current_component().$$.on_destroy.push(fn);
}
function setContext(key, context) {
    get_current_component().$$.context.set(key, context);
}
function getContext(key) {
    return get_current_component().$$.context.get(key);
}

const dirty_components = [];
const binding_callbacks = [];
const render_callbacks = [];
const flush_callbacks = [];
const resolved_promise = Promise.resolve();
let update_scheduled = false;
function schedule_update() {
    if (!update_scheduled) {
        update_scheduled = true;
        resolved_promise.then(flush);
    }
}
function tick() {
    schedule_update();
    return resolved_promise;
}
function add_render_callback(fn) {
    render_callbacks.push(fn);
}
// flush() calls callbacks in this order:
// 1. All beforeUpdate callbacks, in order: parents before children
// 2. All bind:this callbacks, in reverse order: children before parents.
// 3. All afterUpdate callbacks, in order: parents before children. EXCEPT
//    for afterUpdates called during the initial onMount, which are called in
//    reverse order: children before parents.
// Since callbacks might update component values, which could trigger another
// call to flush(), the following steps guard against this:
// 1. During beforeUpdate, any updated components will be added to the
//    dirty_components array and will cause a reentrant call to flush(). Because
//    the flush index is kept outside the function, the reentrant call will pick
//    up where the earlier call left off and go through all dirty components. The
//    current_component value is saved and restored so that the reentrant call will
//    not interfere with the "parent" flush() call.
// 2. bind:this callbacks cannot trigger new flush() calls.
// 3. During afterUpdate, any updated components will NOT have their afterUpdate
//    callback called a second time; the seen_callbacks set, outside the flush()
//    function, guarantees this behavior.
const seen_callbacks = new Set();
let flushidx = 0; // Do *not* move this inside the flush() function
function flush() {
    const saved_component = current_component;
    do {
        // first, call beforeUpdate functions
        // and update components
        while (flushidx < dirty_components.length) {
            const component = dirty_components[flushidx];
            flushidx++;
            set_current_component(component);
            update(component.$$);
        }
        set_current_component(null);
        dirty_components.length = 0;
        flushidx = 0;
        while (binding_callbacks.length)
            binding_callbacks.pop()();
        // then, once components are updated, call
        // afterUpdate functions. This may cause
        // subsequent updates...
        for (let i = 0; i < render_callbacks.length; i += 1) {
            const callback = render_callbacks[i];
            if (!seen_callbacks.has(callback)) {
                // ...so guard against infinite loops
                seen_callbacks.add(callback);
                callback();
            }
        }
        render_callbacks.length = 0;
    } while (dirty_components.length);
    while (flush_callbacks.length) {
        flush_callbacks.pop()();
    }
    update_scheduled = false;
    seen_callbacks.clear();
    set_current_component(saved_component);
}
function update($$) {
    if ($$.fragment !== null) {
        $$.update();
        run_all($$.before_update);
        const dirty = $$.dirty;
        $$.dirty = [-1];
        $$.fragment && $$.fragment.p($$.ctx, dirty);
        $$.after_update.forEach(add_render_callback);
    }
}

// source: https://html.spec.whatwg.org/multipage/indices.html
const boolean_attributes = new Set([
    'allowfullscreen',
    'allowpaymentrequest',
    'async',
    'autofocus',
    'autoplay',
    'checked',
    'controls',
    'default',
    'defer',
    'disabled',
    'formnovalidate',
    'hidden',
    'ismap',
    'loop',
    'multiple',
    'muted',
    'nomodule',
    'novalidate',
    'open',
    'playsinline',
    'readonly',
    'required',
    'reversed',
    'selected'
]);
const escaped = {
    '"': '&quot;',
    "'": '&#39;',
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;'
};
function escape(html) {
    return String(html).replace(/["'&<>]/g, match => escaped[match]);
}
const missing_component = {
    $$render: () => ''
};
function validate_component(component, name) {
    if (!component || !component.$$render) {
        if (name === 'svelte:component')
            name += ' this={...}';
        throw new Error(`<${name}> is not a valid SSR component. You may need to review your build config to ensure that dependencies are compiled, rather than imported as pre-compiled modules`);
    }
    return component;
}
let on_destroy;
function create_ssr_component(fn) {
    function $$render(result, props, bindings, slots, context) {
        const parent_component = current_component;
        const $$ = {
            on_destroy,
            context: new Map(context || (parent_component ? parent_component.$$.context : [])),
            // these will be immediately discarded
            on_mount: [],
            before_update: [],
            after_update: [],
            callbacks: blank_object()
        };
        set_current_component({ $$ });
        const html = fn(result, props, bindings, slots);
        set_current_component(parent_component);
        return html;
    }
    return {
        render: (props = {}, { $$slots = {}, context = new Map() } = {}) => {
            on_destroy = [];
            const result = { title: '', head: '', css: new Set() };
            const html = $$render(result, props, {}, $$slots, context);
            run_all(on_destroy);
            return {
                html,
                css: {
                    code: Array.from(result.css).map(css => css.code).join('\n'),
                    map: null // TODO
                },
                head: result.title + result.head
            };
        },
        $$render
    };
}
function add_attribute(name, value, boolean) {
    if (value == null || (boolean && !value))
        return '';
    return ` ${name}${value === true && boolean_attributes.has(name) ? '' : `=${typeof value === 'string' ? JSON.stringify(escape(value)) : `"${value}"`}`}`;
}

/*
 * Adapted from https://github.com/reach/router/blob/b60e6dd781d5d3a4bdaaf4de665649c0f6a7e78d/src/lib/utils.js
 *
 * https://github.com/reach/router/blob/master/LICENSE
 */

const isUndefined = value => typeof value === "undefined";

const isFunction = value => typeof value === "function";

const isNumber = value => typeof value === "number";

function createCounter() {
	let i = 0;
	/**
	 * Returns an id and increments the internal state
	 * @returns {number}
	 */
	return () => i++;
}

/**
 * Create a globally unique id
 *
 * @returns {string} An id
 */
function createGlobalId() {
	return Math.random().toString(36).substring(2);
}

const isSSR = typeof window === "undefined";

function addListener(target, type, handler) {
	target.addEventListener(type, handler);
	return () => target.removeEventListener(type, handler);
}

const subscriber_queue = [];
/**
 * Creates a `Readable` store that allows reading by subscription.
 * @param value initial value
 * @param {StartStopNotifier}start start and stop notifications for subscriptions
 */
function readable(value, start) {
    return {
        subscribe: writable(value, start).subscribe
    };
}
/**
 * Create a `Writable` store that allows both updating and reading by subscription.
 * @param {*=}value initial value
 * @param {StartStopNotifier=}start start and stop notifications for subscriptions
 */
function writable(value, start = noop) {
    let stop;
    const subscribers = new Set();
    function set(new_value) {
        if (safe_not_equal(value, new_value)) {
            value = new_value;
            if (stop) { // store is ready
                const run_queue = !subscriber_queue.length;
                for (const subscriber of subscribers) {
                    subscriber[1]();
                    subscriber_queue.push(subscriber, value);
                }
                if (run_queue) {
                    for (let i = 0; i < subscriber_queue.length; i += 2) {
                        subscriber_queue[i][0](subscriber_queue[i + 1]);
                    }
                    subscriber_queue.length = 0;
                }
            }
        }
    }
    function update(fn) {
        set(fn(value));
    }
    function subscribe(run, invalidate = noop) {
        const subscriber = [run, invalidate];
        subscribers.add(subscriber);
        if (subscribers.size === 1) {
            stop = start(set) || noop;
        }
        run(value);
        return () => {
            subscribers.delete(subscriber);
            if (subscribers.size === 0) {
                stop();
                stop = null;
            }
        };
    }
    return { set, update, subscribe };
}
function derived(stores, fn, initial_value) {
    const single = !Array.isArray(stores);
    const stores_array = single
        ? [stores]
        : stores;
    const auto = fn.length < 2;
    return readable(initial_value, (set) => {
        let inited = false;
        const values = [];
        let pending = 0;
        let cleanup = noop;
        const sync = () => {
            if (pending) {
                return;
            }
            cleanup();
            const result = fn(single ? values[0] : values, set);
            if (auto) {
                set(result);
            }
            else {
                cleanup = is_function(result) ? result : noop;
            }
        };
        const unsubscribers = stores_array.map((store, i) => subscribe(store, (value) => {
            values[i] = value;
            pending &= ~(1 << i);
            if (inited) {
                sync();
            }
        }, () => {
            pending |= (1 << i);
        }));
        inited = true;
        sync();
        return function stop() {
            run_all(unsubscribers);
            cleanup();
        };
    });
}

/*
 * Adapted from https://github.com/EmilTholin/svelte-routing
 *
 * https://github.com/EmilTholin/svelte-routing/blob/master/LICENSE
 */

const createKey = ctxName => `@@svnav-ctx__${ctxName}`;

// Use strings instead of objects, so different versions of
// svelte-navigator can potentially still work together
const LOCATION = createKey("LOCATION");
const ROUTER = createKey("ROUTER");
const ROUTE = createKey("ROUTE");
const ROUTE_PARAMS = createKey("ROUTE_PARAMS");
const FOCUS_ELEM = createKey("FOCUS_ELEM");

const paramRegex = /^:(.+)/;

/**
 * Check if `string` starts with `search`
 * @param {string} string
 * @param {string} search
 * @return {boolean}
 */
const startsWith = (string, search) =>
	string.substr(0, search.length) === search;

/**
 * Check if `segment` is a root segment
 * @param {string} segment
 * @return {boolean}
 */
const isRootSegment = segment => segment === "";

/**
 * Check if `segment` is a dynamic segment
 * @param {string} segment
 * @return {boolean}
 */
const isDynamic = segment => paramRegex.test(segment);

/**
 * Check if `segment` is a splat
 * @param {string} segment
 * @return {boolean}
 */
const isSplat = segment => segment[0] === "*";

/**
 * Strip potention splat and splatname of the end of a path
 * @param {string} str
 * @return {string}
 */
const stripSplat = str => str.replace(/\*.*$/, "");

/**
 * Strip `str` of potential start and end `/`
 * @param {string} str
 * @return {string}
 */
const stripSlashes = str => str.replace(/(^\/+|\/+$)/g, "");

/**
 * Split up the URI into segments delimited by `/`
 * @param {string} uri
 * @return {string[]}
 */
function segmentize(uri, filterFalsy = false) {
	const segments = stripSlashes(uri).split("/");
	return filterFalsy ? segments.filter(Boolean) : segments;
}

/**
 * Add the query to the pathname if a query is given
 * @param {string} pathname
 * @param {string} [query]
 * @return {string}
 */
const addQuery = (pathname, query) =>
	pathname + (query ? `?${query}` : "");

/**
 * Normalizes a basepath
 *
 * @param {string} path
 * @returns {string}
 *
 * @example
 * normalizePath("base/path/") // -> "/base/path"
 */
const normalizePath = path => `/${stripSlashes(path)}`;

/**
 * Joins and normalizes multiple path fragments
 *
 * @param {...string} pathFragments
 * @returns {string}
 */
function join(...pathFragments) {
	const joinFragment = fragment => segmentize(fragment, true).join("/");
	const joinedSegments = pathFragments.map(joinFragment).join("/");
	return normalizePath(joinedSegments);
}

// We start from 1 here, so we can check if an origin id has been passed
// by using `originId || <fallback>`
const LINK_ID = 1;
const ROUTE_ID = 2;
const ROUTER_ID = 3;
const USE_FOCUS_ID = 4;
const USE_LOCATION_ID = 5;
const USE_MATCH_ID = 6;
const USE_NAVIGATE_ID = 7;
const USE_PARAMS_ID = 8;
const USE_RESOLVABLE_ID = 9;
const USE_RESOLVE_ID = 10;
const NAVIGATE_ID = 11;

const labels = {
	[LINK_ID]: "Link",
	[ROUTE_ID]: "Route",
	[ROUTER_ID]: "Router",
	[USE_FOCUS_ID]: "useFocus",
	[USE_LOCATION_ID]: "useLocation",
	[USE_MATCH_ID]: "useMatch",
	[USE_NAVIGATE_ID]: "useNavigate",
	[USE_PARAMS_ID]: "useParams",
	[USE_RESOLVABLE_ID]: "useResolvable",
	[USE_RESOLVE_ID]: "useResolve",
	[NAVIGATE_ID]: "navigate",
};

const createLabel = labelId => labels[labelId];

function createIdentifier(labelId, props) {
	let attr;
	if (labelId === ROUTE_ID) {
		attr = props.path ? `path="${props.path}"` : "default";
	} else if (labelId === LINK_ID) {
		attr = `to="${props.to}"`;
	} else if (labelId === ROUTER_ID) {
		attr = `basepath="${props.basepath || ""}"`;
	}
	return `<${createLabel(labelId)} ${attr || ""} />`;
}

function createMessage(labelId, message, props, originId) {
	const origin = props && createIdentifier(originId || labelId, props);
	const originMsg = origin ? `\n\nOccurred in: ${origin}` : "";
	const label = createLabel(labelId);
	const msg = isFunction(message) ? message(label) : message;
	return `<${label}> ${msg}${originMsg}`;
}

const createMessageHandler = handler => (...args) =>
	handler(createMessage(...args));

const fail = createMessageHandler(message => {
	throw new Error(message);
});

// eslint-disable-next-line no-console
const warn = createMessageHandler(console.warn);

const SEGMENT_POINTS = 4;
const STATIC_POINTS = 3;
const DYNAMIC_POINTS = 2;
const SPLAT_PENALTY = 1;
const ROOT_POINTS = 1;

/**
 * Score a route depending on how its individual segments look
 * @param {object} route
 * @param {number} index
 * @return {object}
 */
function rankRoute(route, index) {
	const score = route.default
		? 0
		: segmentize(route.fullPath).reduce((acc, segment) => {
				let nextScore = acc;
				nextScore += SEGMENT_POINTS;

				if (isRootSegment(segment)) {
					nextScore += ROOT_POINTS;
				} else if (isDynamic(segment)) {
					nextScore += DYNAMIC_POINTS;
				} else if (isSplat(segment)) {
					nextScore -= SEGMENT_POINTS + SPLAT_PENALTY;
				} else {
					nextScore += STATIC_POINTS;
				}

				return nextScore;
		  }, 0);

	return { route, score, index };
}

/**
 * Give a score to all routes and sort them on that
 * @param {object[]} routes
 * @return {object[]}
 */
function rankRoutes(routes) {
	return (
		routes
			.map(rankRoute)
			// If two routes have the exact same score, we go by index instead
			.sort((a, b) => {
				if (a.score < b.score) {
					return 1;
				}
				if (a.score > b.score) {
					return -1;
				}
				return a.index - b.index;
			})
	);
}

/**
 * Ranks and picks the best route to match. Each segment gets the highest
 * amount of points, then the type of segment gets an additional amount of
 * points where
 *
 *  static > dynamic > splat > root
 *
 * This way we don't have to worry about the order of our routes, let the
 * computers do it.
 *
 * A route looks like this
 *
 *  { fullPath, default, value }
 *
 * And a returned match looks like:
 *
 *  { route, params, uri }
 *
 * @param {object[]} routes
 * @param {string} uri
 * @return {?object}
 */
function pick(routes, uri) {
	let bestMatch;
	let defaultMatch;

	const [uriPathname] = uri.split("?");
	const uriSegments = segmentize(uriPathname);
	const isRootUri = uriSegments[0] === "";
	const ranked = rankRoutes(routes);

	for (let i = 0, l = ranked.length; i < l; i++) {
		const { route } = ranked[i];
		let missed = false;
		const params = {};

		// eslint-disable-next-line no-shadow
		const createMatch = uri => ({ ...route, params, uri });

		if (route.default) {
			defaultMatch = createMatch(uri);
			continue;
		}

		const routeSegments = segmentize(route.fullPath);
		const max = Math.max(uriSegments.length, routeSegments.length);
		let index = 0;

		for (; index < max; index++) {
			const routeSegment = routeSegments[index];
			const uriSegment = uriSegments[index];

			if (!isUndefined(routeSegment) && isSplat(routeSegment)) {
				// Hit a splat, just grab the rest, and return a match
				// uri:   /files/documents/work
				// route: /files/* or /files/*splatname
				const splatName = routeSegment === "*" ? "*" : routeSegment.slice(1);

				params[splatName] = uriSegments
					.slice(index)
					.map(decodeURIComponent)
					.join("/");
				break;
			}

			if (isUndefined(uriSegment)) {
				// URI is shorter than the route, no match
				// uri:   /users
				// route: /users/:userId
				missed = true;
				break;
			}

			const dynamicMatch = paramRegex.exec(routeSegment);

			if (dynamicMatch && !isRootUri) {
				const value = decodeURIComponent(uriSegment);
				params[dynamicMatch[1]] = value;
			} else if (routeSegment !== uriSegment) {
				// Current segments don't match, not dynamic, not splat, so no match
				// uri:   /users/123/settings
				// route: /users/:id/profile
				missed = true;
				break;
			}
		}

		if (!missed) {
			bestMatch = createMatch(join(...uriSegments.slice(0, index)));
			break;
		}
	}

	return bestMatch || defaultMatch || null;
}

/**
 * Check if the `route.fullPath` matches the `uri`.
 * @param {Object} route
 * @param {string} uri
 * @return {?object}
 */
function match(route, uri) {
	return pick([route], uri);
}

/**
 * Resolve URIs as though every path is a directory, no files. Relative URIs
 * in the browser can feel awkward because not only can you be "in a directory",
 * you can be "at a file", too. For example:
 *
 *  browserSpecResolve('foo', '/bar/') => /bar/foo
 *  browserSpecResolve('foo', '/bar') => /foo
 *
 * But on the command line of a file system, it's not as complicated. You can't
 * `cd` from a file, only directories. This way, links have to know less about
 * their current path. To go deeper you can do this:
 *
 *  <Link to="deeper"/>
 *  // instead of
 *  <Link to=`{${props.uri}/deeper}`/>
 *
 * Just like `cd`, if you want to go deeper from the command line, you do this:
 *
 *  cd deeper
 *  # not
 *  cd $(pwd)/deeper
 *
 * By treating every path as a directory, linking to relative paths should
 * require less contextual information and (fingers crossed) be more intuitive.
 * @param {string} to
 * @param {string} base
 * @return {string}
 */
function resolve(to, base) {
	// /foo/bar, /baz/qux => /foo/bar
	if (startsWith(to, "/")) {
		return to;
	}

	const [toPathname, toQuery] = to.split("?");
	const [basePathname] = base.split("?");
	const toSegments = segmentize(toPathname);
	const baseSegments = segmentize(basePathname);

	// ?a=b, /users?b=c => /users?a=b
	if (toSegments[0] === "") {
		return addQuery(basePathname, toQuery);
	}

	// profile, /users/789 => /users/789/profile
	if (!startsWith(toSegments[0], ".")) {
		const pathname = baseSegments.concat(toSegments).join("/");
		return addQuery((basePathname === "/" ? "" : "/") + pathname, toQuery);
	}

	// ./       , /users/123 => /users/123
	// ../      , /users/123 => /users
	// ../..    , /users/123 => /
	// ../../one, /a/b/c/d   => /a/b/one
	// .././one , /a/b/c/d   => /a/b/c/one
	const allSegments = baseSegments.concat(toSegments);
	const segments = [];

	allSegments.forEach(segment => {
		if (segment === "..") {
			segments.pop();
		} else if (segment !== ".") {
			segments.push(segment);
		}
	});

	return addQuery(`/${segments.join("/")}`, toQuery);
}

/**
 * Normalizes a location for consumption by `Route` children and the `Router`.
 * It removes the apps basepath from the pathname
 * and sets default values for `search` and `hash` properties.
 *
 * @param {Object} location The current global location supplied by the history component
 * @param {string} basepath The applications basepath (i.e. when serving from a subdirectory)
 *
 * @returns The normalized location
 */
function normalizeLocation(location, basepath) {
	const { pathname, hash = "", search = "", state } = location;
	const baseSegments = segmentize(basepath, true);
	const pathSegments = segmentize(pathname, true);
	while (baseSegments.length) {
		if (baseSegments[0] !== pathSegments[0]) {
			fail(
				ROUTER_ID,
				`Invalid state: All locations must begin with the basepath "${basepath}", found "${pathname}"`,
			);
		}
		baseSegments.shift();
		pathSegments.shift();
	}
	return {
		pathname: join(...pathSegments),
		hash,
		search,
		state,
	};
}

const normalizeUrlFragment = frag => (frag.length === 1 ? "" : frag);

/**
 * Creates a location object from an url.
 * It is used to create a location from the url prop used in SSR
 *
 * @param {string} url The url string (e.g. "/path/to/somewhere")
 *
 * @returns {{ pathname: string; search: string; hash: string }} The location
 */
function createLocation(url) {
	const searchIndex = url.indexOf("?");
	const hashIndex = url.indexOf("#");
	const hasSearchIndex = searchIndex !== -1;
	const hasHashIndex = hashIndex !== -1;
	const hash = hasHashIndex ? normalizeUrlFragment(url.substr(hashIndex)) : "";
	const pathnameAndSearch = hasHashIndex ? url.substr(0, hashIndex) : url;
	const search = hasSearchIndex
		? normalizeUrlFragment(pathnameAndSearch.substr(searchIndex))
		: "";
	const pathname = hasSearchIndex
		? pathnameAndSearch.substr(0, searchIndex)
		: pathnameAndSearch;
	return { pathname, search, hash };
}

/**
 * Resolves a link relative to the parent Route and the Routers basepath.
 *
 * @param {string} path The given path, that will be resolved
 * @param {string} routeBase The current Routes base path
 * @param {string} appBase The basepath of the app. Used, when serving from a subdirectory
 * @returns {string} The resolved path
 *
 * @example
 * resolveLink("relative", "/routeBase", "/") // -> "/routeBase/relative"
 * resolveLink("/absolute", "/routeBase", "/") // -> "/absolute"
 * resolveLink("relative", "/routeBase", "/base") // -> "/base/routeBase/relative"
 * resolveLink("/absolute", "/routeBase", "/base") // -> "/base/absolute"
 */
function resolveLink(path, routeBase, appBase) {
	return join(appBase, resolve(path, routeBase));
}

/**
 * Get the uri for a Route, by matching it against the current location.
 *
 * @param {string} routePath The Routes resolved path
 * @param {string} pathname The current locations pathname
 */
function extractBaseUri(routePath, pathname) {
	const fullPath = normalizePath(stripSplat(routePath));
	const baseSegments = segmentize(fullPath, true);
	const pathSegments = segmentize(pathname, true).slice(0, baseSegments.length);
	const routeMatch = match({ fullPath }, join(...pathSegments));
	return routeMatch && routeMatch.uri;
}

/*
 * Adapted from https://github.com/reach/router/blob/b60e6dd781d5d3a4bdaaf4de665649c0f6a7e78d/src/lib/history.js
 *
 * https://github.com/reach/router/blob/master/LICENSE
 */

const POP = "POP";
const PUSH = "PUSH";
const REPLACE = "REPLACE";

function getLocation(source) {
	return {
		...source.location,
		pathname: encodeURI(decodeURI(source.location.pathname)),
		state: source.history.state,
		_key: (source.history.state && source.history.state._key) || "initial",
	};
}

function createHistory(source) {
	let listeners = [];
	let location = getLocation(source);
	let action = POP;

	const notifyListeners = (listenerFns = listeners) =>
		listenerFns.forEach(listener => listener({ location, action }));

	return {
		get location() {
			return location;
		},
		listen(listener) {
			listeners.push(listener);

			const popstateListener = () => {
				location = getLocation(source);
				action = POP;
				notifyListeners([listener]);
			};

			// Call listener when it is registered
			notifyListeners([listener]);

			const unlisten = addListener(source, "popstate", popstateListener);
			return () => {
				unlisten();
				listeners = listeners.filter(fn => fn !== listener);
			};
		},
		/**
		 * Navigate to a new absolute route.
		 *
		 * @param {string|number} to The path to navigate to.
		 *
		 * If `to` is a number we will navigate to the stack entry index + `to`
		 * (-> `navigate(-1)`, is equivalent to hitting the back button of the browser)
		 * @param {Object} options
		 * @param {*} [options.state] The state will be accessible through `location.state`
		 * @param {boolean} [options.replace=false] Replace the current entry in the history
		 * stack, instead of pushing on a new one
		 */
		navigate(to, options) {
			const { state = {}, replace = false } = options || {};
			action = replace ? REPLACE : PUSH;
			if (isNumber(to)) {
				if (options) {
					warn(
						NAVIGATE_ID,
						"Navigation options (state or replace) are not supported, " +
							"when passing a number as the first argument to navigate. " +
							"They are ignored.",
					);
				}
				action = POP;
				source.history.go(to);
			} else {
				const keyedState = { ...state, _key: createGlobalId() };
				// try...catch iOS Safari limits to 100 pushState calls
				try {
					source.history[replace ? "replaceState" : "pushState"](
						keyedState,
						"",
						to,
					);
				} catch (e) {
					source.location[replace ? "replace" : "assign"](to);
				}
			}

			location = getLocation(source);
			notifyListeners();
		},
	};
}

function createStackFrame(state, uri) {
	return { ...createLocation(uri), state };
}

// Stores history entries in memory for testing or other platforms like Native
function createMemorySource(initialPathname = "/") {
	let index = 0;
	let stack = [createStackFrame(null, initialPathname)];

	return {
		// This is just for testing...
		get entries() {
			return stack;
		},
		get location() {
			return stack[index];
		},
		addEventListener() {},
		removeEventListener() {},
		history: {
			get state() {
				return stack[index].state;
			},
			pushState(state, title, uri) {
				index++;
				// Throw away anything in the stack with an index greater than the current index.
				// This happens, when we go back using `go(-n)`. The index is now less than `stack.length`.
				// If we call `go(+n)` the stack entries with an index greater than the current index can
				// be reused.
				// However, if we navigate to a path, instead of a number, we want to create a new branch
				// of navigation.
				stack = stack.slice(0, index);
				stack.push(createStackFrame(state, uri));
			},
			replaceState(state, title, uri) {
				stack[index] = createStackFrame(state, uri);
			},
			go(to) {
				const newIndex = index + to;
				if (newIndex < 0 || newIndex > stack.length - 1) {
					return;
				}
				index = newIndex;
			},
		},
	};
}

// Global history uses window.history as the source if available,
// otherwise a memory history
const canUseDOM = !!(
	!isSSR &&
	window.document &&
	window.document.createElement
);
// Use memory history in iframes (for example in Svelte REPL)
const isEmbeddedPage = !isSSR && window.location.origin === "null";
const globalHistory = createHistory(
	canUseDOM && !isEmbeddedPage ? window : createMemorySource(),
);

// We need to keep the focus candidate in a separate file, so svelte does
// not update, when we mutate it.
// Also, we need a single global reference, because taking focus needs to
// work globally, even if we have multiple top level routers
// eslint-disable-next-line import/no-mutable-exports
let focusCandidate = null;

// eslint-disable-next-line import/no-mutable-exports
let initialNavigation = true;

/**
 * Check if RouterA is above RouterB in the document
 * @param {number} routerIdA The first Routers id
 * @param {number} routerIdB The second Routers id
 */
function isAbove(routerIdA, routerIdB) {
	const routerMarkers = document.querySelectorAll("[data-svnav-router]");
	for (let i = 0; i < routerMarkers.length; i++) {
		const node = routerMarkers[i];
		const currentId = Number(node.dataset.svnavRouter);
		if (currentId === routerIdA) return true;
		if (currentId === routerIdB) return false;
	}
	return false;
}

/**
 * Check if a Route candidate is the best choice to move focus to,
 * and store the best match.
 * @param {{
     level: number;
     routerId: number;
     route: {
       id: number;
       focusElement: import("svelte/store").Readable<Promise<Element>|null>;
     }
   }} item A Route candidate, that updated and is visible after a navigation
 */
function pushFocusCandidate(item) {
	if (
		// Best candidate if it's the only candidate...
		!focusCandidate ||
		// Route is nested deeper, than previous candidate
		// -> Route change was triggered in the deepest affected
		// Route, so that's were focus should move to
		item.level > focusCandidate.level ||
		// If the level is identical, we want to focus the first Route in the document,
		// so we pick the first Router lookin from page top to page bottom.
		(item.level === focusCandidate.level &&
			isAbove(item.routerId, focusCandidate.routerId))
	) {
		focusCandidate = item;
	}
}

/**
 * Reset the focus candidate.
 */
function clearFocusCandidate() {
	focusCandidate = null;
}

function initialNavigationOccurred() {
	initialNavigation = false;
}

/*
 * `focus` Adapted from https://github.com/oaf-project/oaf-side-effects/blob/master/src/index.ts
 *
 * https://github.com/oaf-project/oaf-side-effects/blob/master/LICENSE
 */
function focus(elem) {
	if (!elem) return false;
	const TABINDEX = "tabindex";
	try {
		if (!elem.hasAttribute(TABINDEX)) {
			elem.setAttribute(TABINDEX, "-1");
			let unlisten;
			// We remove tabindex after blur to avoid weird browser behavior
			// where a mouse click can activate elements with tabindex="-1".
			const blurListener = () => {
				elem.removeAttribute(TABINDEX);
				unlisten();
			};
			unlisten = addListener(elem, "blur", blurListener);
		}
		elem.focus();
		return document.activeElement === elem;
	} catch (e) {
		// Apparently trying to focus a disabled element in IE can throw.
		// See https://stackoverflow.com/a/1600194/2476884
		return false;
	}
}

function isEndMarker(elem, id) {
	return Number(elem.dataset.svnavRouteEnd) === id;
}

function isHeading(elem) {
	return /^H[1-6]$/i.test(elem.tagName);
}

function query(selector, parent = document) {
	return parent.querySelector(selector);
}

function queryHeading(id) {
	const marker = query(`[data-svnav-route-start="${id}"]`);
	let current = marker.nextElementSibling;
	while (!isEndMarker(current, id)) {
		if (isHeading(current)) {
			return current;
		}
		const heading = query("h1,h2,h3,h4,h5,h6", current);
		if (heading) {
			return heading;
		}
		current = current.nextElementSibling;
	}
	return null;
}

function handleFocus(route) {
	Promise.resolve(get_store_value(route.focusElement)).then(elem => {
		const focusElement = elem || queryHeading(route.id);
		if (!focusElement) {
			warn(
				ROUTER_ID,
				"Could not find an element to focus. " +
					"You should always render a header for accessibility reasons, " +
					'or set a custom focus element via the "useFocus" hook. ' +
					"If you don't want this Route or Router to manage focus, " +
					'pass "primary={false}" to it.',
				route,
				ROUTE_ID,
			);
		}
		const headingFocused = focus(focusElement);
		if (headingFocused) return;
		focus(document.documentElement);
	});
}

const createTriggerFocus = (a11yConfig, announcementText, location) => (
	manageFocus,
	announceNavigation,
) =>
	// Wait until the dom is updated, so we can look for headings
	tick().then(() => {
		if (!focusCandidate || initialNavigation) {
			initialNavigationOccurred();
			return;
		}
		if (manageFocus) {
			handleFocus(focusCandidate.route);
		}
		if (a11yConfig.announcements && announceNavigation) {
			const { path, fullPath, meta, params, uri } = focusCandidate.route;
			const announcementMessage = a11yConfig.createAnnouncement(
				{ path, fullPath, meta, params, uri },
				get_store_value(location),
			);
			Promise.resolve(announcementMessage).then(message => {
				announcementText.set(message);
			});
		}
		clearFocusCandidate();
	});

const visuallyHiddenStyle =
	"position:fixed;" +
	"top:-1px;" +
	"left:0;" +
	"width:1px;" +
	"height:1px;" +
	"padding:0;" +
	"overflow:hidden;" +
	"clip:rect(0,0,0,0);" +
	"white-space:nowrap;" +
	"border:0;";

/* node_modules\svelte-navigator\src\Router.svelte generated by Svelte v3.45.0 */

const createId$1 = createCounter();
const defaultBasepath = "/";

const Router = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let $location, $$unsubscribe_location;
	let $activeRoute, $$unsubscribe_activeRoute;
	let $prevLocation, $$unsubscribe_prevLocation;
	let $routes, $$unsubscribe_routes;
	let $announcementText, $$unsubscribe_announcementText;
	let { basepath = defaultBasepath } = $$props;
	let { url = null } = $$props;
	let { history = globalHistory } = $$props;
	let { primary = true } = $$props;
	let { a11y = {} } = $$props;

	const a11yConfig = {
		createAnnouncement: route => `Navigated to ${route.uri}`,
		announcements: true,
		...a11y
	};

	// Remember the initial `basepath`, so we can fire a warning
	// when the user changes it later
	const initialBasepath = basepath;

	const normalizedBasepath = normalizePath(basepath);
	const locationContext = getContext(LOCATION);
	const routerContext = getContext(ROUTER);
	const isTopLevelRouter = !locationContext;
	const routerId = createId$1();
	const manageFocus = primary && !(routerContext && !routerContext.manageFocus);
	const announcementText = writable("");
	$$unsubscribe_announcementText = subscribe(announcementText, value => $announcementText = value);
	const routes = writable([]);
	$$unsubscribe_routes = subscribe(routes, value => $routes = value);
	const activeRoute = writable(null);
	$$unsubscribe_activeRoute = subscribe(activeRoute, value => $activeRoute = value);

	// Used in SSR to synchronously set that a Route is active.
	let hasActiveRoute = false;

	// Nesting level of router.
	// We will need this to identify sibling routers, when moving
	// focus on navigation, so we can focus the first possible router
	const level = isTopLevelRouter ? 0 : routerContext.level + 1;

	// If we're running an SSR we force the location to the `url` prop
	const getInitialLocation = () => normalizeLocation(isSSR ? createLocation(url) : history.location, normalizedBasepath);

	const location = isTopLevelRouter
	? writable(getInitialLocation())
	: locationContext;

	$$unsubscribe_location = subscribe(location, value => $location = value);
	const prevLocation = writable($location);
	$$unsubscribe_prevLocation = subscribe(prevLocation, value => $prevLocation = value);
	const triggerFocus = createTriggerFocus(a11yConfig, announcementText, location);
	const createRouteFilter = routeId => routeList => routeList.filter(routeItem => routeItem.id !== routeId);

	function registerRoute(route) {
		if (isSSR) {
			// In SSR we should set the activeRoute immediately if it is a match.
			// If there are more Routes being registered after a match is found,
			// we just skip them.
			if (hasActiveRoute) {
				return;
			}

			const matchingRoute = match(route, $location.pathname);

			if (matchingRoute) {
				hasActiveRoute = true;

				// Return the match in SSR mode, so the matched Route can use it immediatly.
				// Waiting for activeRoute to update does not work, because it updates
				// after the Route is initialized
				return matchingRoute; // eslint-disable-line consistent-return
			}
		} else {
			routes.update(prevRoutes => {
				// Remove an old version of the updated route,
				// before pushing the new version
				const nextRoutes = createRouteFilter(route.id)(prevRoutes);

				nextRoutes.push(route);
				return nextRoutes;
			});
		}
	}

	function unregisterRoute(routeId) {
		routes.update(createRouteFilter(routeId));
	}

	if (!isTopLevelRouter && basepath !== defaultBasepath) {
		warn(ROUTER_ID, 'Only top-level Routers can have a "basepath" prop. It is ignored.', { basepath });
	}

	if (isTopLevelRouter) {
		// The topmost Router in the tree is responsible for updating
		// the location store and supplying it through context.
		onMount(() => {
			const unlisten = history.listen(changedHistory => {
				const normalizedLocation = normalizeLocation(changedHistory.location, normalizedBasepath);
				prevLocation.set($location);
				location.set(normalizedLocation);
			});

			return unlisten;
		});

		setContext(LOCATION, location);
	}

	setContext(ROUTER, {
		activeRoute,
		registerRoute,
		unregisterRoute,
		manageFocus,
		level,
		id: routerId,
		history: isTopLevelRouter ? history : routerContext.history,
		basepath: isTopLevelRouter
		? normalizedBasepath
		: routerContext.basepath
	});

	if ($$props.basepath === void 0 && $$bindings.basepath && basepath !== void 0) $$bindings.basepath(basepath);
	if ($$props.url === void 0 && $$bindings.url && url !== void 0) $$bindings.url(url);
	if ($$props.history === void 0 && $$bindings.history && history !== void 0) $$bindings.history(history);
	if ($$props.primary === void 0 && $$bindings.primary && primary !== void 0) $$bindings.primary(primary);
	if ($$props.a11y === void 0 && $$bindings.a11y && a11y !== void 0) $$bindings.a11y(a11y);

	{
		if (basepath !== initialBasepath) {
			warn(ROUTER_ID, 'You cannot change the "basepath" prop. It is ignored.');
		}
	}

	{
		{
			const bestMatch = pick($routes, $location.pathname);
			activeRoute.set(bestMatch);
		}
	}

	{
		{
			if (isTopLevelRouter) {
				const hasHash = !!$location.hash;

				// When a hash is present in the url, we skip focus management, because
				// focusing a different element will prevent in-page jumps (See #3)
				const shouldManageFocus = !hasHash && manageFocus;

				// We don't want to make an announcement, when the hash changes,
				// but the active route stays the same
				const announceNavigation = !hasHash || $location.pathname !== $prevLocation.pathname;

				triggerFocus(shouldManageFocus, announceNavigation);
			}
		}
	}

	{
		if (manageFocus && $activeRoute && $activeRoute.primary) {
			pushFocusCandidate({ level, routerId, route: $activeRoute });
		}
	}

	$$unsubscribe_location();
	$$unsubscribe_activeRoute();
	$$unsubscribe_prevLocation();
	$$unsubscribe_routes();
	$$unsubscribe_announcementText();

	return `<div style="${"display:none;"}" aria-hidden="${"true"}"${add_attribute("data-svnav-router", routerId, 0)}></div>

${slots.default ? slots.default({}) : ``}

${isTopLevelRouter && manageFocus && a11yConfig.announcements
	? `<div role="${"status"}" aria-atomic="${"true"}" aria-live="${"polite"}"${add_attribute("style", visuallyHiddenStyle, 0)}>${escape($announcementText)}</div>`
	: ``}`;
});

var Router$1 = Router;

/**
 * Check if a component or hook have been created outside of a
 * context providing component
 * @param {number} componentId
 * @param {*} props
 * @param {string?} ctxKey
 * @param {number?} ctxProviderId
 */
function usePreflightCheck(
	componentId,
	props,
	ctxKey = ROUTER,
	ctxProviderId = ROUTER_ID,
) {
	const ctx = getContext(ctxKey);
	if (!ctx) {
		fail(
			componentId,
			label =>
				`You cannot use ${label} outside of a ${createLabel(ctxProviderId)}.`,
			props,
		);
	}
}

const toReadonly = ctx => {
	const { subscribe } = getContext(ctx);
	return { subscribe };
};

/**
 * Access the current location via a readable store.
 * @returns {import("svelte/store").Readable<{
    pathname: string;
    search: string;
    hash: string;
    state: {};
  }>}
 *
 * @example
  ```html
  <script>
    import { useLocation } from "svelte-navigator";

    const location = useLocation();

    $: console.log($location);
    // {
    //   pathname: "/blog",
    //   search: "?id=123",
    //   hash: "#comments",
    //   state: {}
    // }
  </script>
  ```
 */
function useLocation() {
	usePreflightCheck(USE_LOCATION_ID);
	return toReadonly(LOCATION);
}

/**
 * @typedef {{
    path: string;
    fullPath: string;
    uri: string;
    params: {};
  }} RouteMatch
 */

/**
 * @typedef {import("svelte/store").Readable<RouteMatch|null>} RouteMatchStore
 */

/**
 * Access the history of top level Router.
 */
function useHistory() {
	const { history } = getContext(ROUTER);
	return history;
}

/**
 * Access the base of the parent Route.
 */
function useRouteBase() {
	const route = getContext(ROUTE);
	return route ? derived(route, _route => _route.base) : writable("/");
}

/**
 * Resolve a given link relative to the current `Route` and the `Router`s `basepath`.
 * It is used under the hood in `Link` and `useNavigate`.
 * You can use it to manually resolve links, when using the `link` or `links` actions.
 *
 * @returns {(path: string) => string}
 *
 * @example
  ```html
  <script>
    import { link, useResolve } from "svelte-navigator";

    const resolve = useResolve();
    // `resolvedLink` will be resolved relative to its parent Route
    // and the Routers `basepath`
    const resolvedLink = resolve("relativePath");
  </script>

  <a href={resolvedLink} use:link>Relative link</a>
  ```
 */
function useResolve() {
	usePreflightCheck(USE_RESOLVE_ID);
	const routeBase = useRouteBase();
	const { basepath: appBase } = getContext(ROUTER);
	/**
	 * Resolves the path relative to the current route and basepath.
	 *
	 * @param {string} path The path to resolve
	 * @returns {string} The resolved path
	 */
	const resolve = path => resolveLink(path, get_store_value(routeBase), appBase);
	return resolve;
}

/**
 * A hook, that returns a context-aware version of `navigate`.
 * It will automatically resolve the given link relative to the current Route.
 * It will also resolve a link against the `basepath` of the Router.
 *
 * @example
  ```html
  <!-- App.svelte -->
  <script>
    import { link, Route } from "svelte-navigator";
    import RouteComponent from "./RouteComponent.svelte";
  </script>

  <Router>
    <Route path="route1">
      <RouteComponent />
    </Route>
    <!-- ... -->
  </Router>

  <!-- RouteComponent.svelte -->
  <script>
    import { useNavigate } from "svelte-navigator";

    const navigate = useNavigate();
  </script>

  <button on:click="{() => navigate('relativePath')}">
    go to /route1/relativePath
  </button>
  <button on:click="{() => navigate('/absolutePath')}">
    go to /absolutePath
  </button>
  ```
  *
  * @example
  ```html
  <!-- App.svelte -->
  <script>
    import { link, Route } from "svelte-navigator";
    import RouteComponent from "./RouteComponent.svelte";
  </script>

  <Router basepath="/base">
    <Route path="route1">
      <RouteComponent />
    </Route>
    <!-- ... -->
  </Router>

  <!-- RouteComponent.svelte -->
  <script>
    import { useNavigate } from "svelte-navigator";

    const navigate = useNavigate();
  </script>

  <button on:click="{() => navigate('relativePath')}">
    go to /base/route1/relativePath
  </button>
  <button on:click="{() => navigate('/absolutePath')}">
    go to /base/absolutePath
  </button>
  ```
 */
function useNavigate() {
	usePreflightCheck(USE_NAVIGATE_ID);
	const resolve = useResolve();
	const { navigate } = useHistory();
	/**
	 * Navigate to a new route.
	 * Resolves the link relative to the current route and basepath.
	 *
	 * @param {string|number} to The path to navigate to.
	 *
	 * If `to` is a number we will navigate to the stack entry index + `to`
	 * (-> `navigate(-1)`, is equivalent to hitting the back button of the browser)
	 * @param {Object} options
	 * @param {*} [options.state]
	 * @param {boolean} [options.replace=false]
	 */
	const navigateRelative = (to, options) => {
		// If to is a number, we navigate to the target stack entry via `history.go`.
		// Otherwise resolve the link
		const target = isNumber(to) ? to : resolve(to);
		return navigate(target, options);
	};
	return navigateRelative;
}

/* node_modules\svelte-navigator\src\Route.svelte generated by Svelte v3.45.0 */
const createId = createCounter();

const Route = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let isActive;
	let $$restProps = compute_rest_props($$props, ["path","component","meta","primary"]);
	let $activeRoute, $$unsubscribe_activeRoute;
	let $location, $$unsubscribe_location;
	let $parentBase, $$unsubscribe_parentBase;
	let $params, $$unsubscribe_params;
	let { path = "" } = $$props;
	let { component = null } = $$props;
	let { meta = {} } = $$props;
	let { primary = true } = $$props;
	usePreflightCheck(ROUTE_ID, $$props);
	const id = createId();
	const { registerRoute, unregisterRoute, activeRoute } = getContext(ROUTER);
	$$unsubscribe_activeRoute = subscribe(activeRoute, value => $activeRoute = value);
	const parentBase = useRouteBase();
	$$unsubscribe_parentBase = subscribe(parentBase, value => $parentBase = value);
	const location = useLocation();
	$$unsubscribe_location = subscribe(location, value => $location = value);
	const focusElement = writable(null);

	// In SSR we cannot wait for $activeRoute to update,
	// so we use the match returned from `registerRoute` instead
	let ssrMatch;

	const route = writable();
	const params = writable({});
	$$unsubscribe_params = subscribe(params, value => $params = value);
	setContext(ROUTE, route);
	setContext(ROUTE_PARAMS, params);
	setContext(FOCUS_ELEM, focusElement);

	// We need to call useNavigate after the route is set,
	// so we can use the routes path for link resolution
	const navigate = useNavigate();

	// There is no need to unregister Routes in SSR since it will all be
	// thrown away anyway
	if (!isSSR) {
		onDestroy(() => unregisterRoute(id));
	}

	if ($$props.path === void 0 && $$bindings.path && path !== void 0) $$bindings.path(path);
	if ($$props.component === void 0 && $$bindings.component && component !== void 0) $$bindings.component(component);
	if ($$props.meta === void 0 && $$bindings.meta && meta !== void 0) $$bindings.meta(meta);
	if ($$props.primary === void 0 && $$bindings.primary && primary !== void 0) $$bindings.primary(primary);

	{
		{
			// The route store will be re-computed whenever props, location or parentBase change
			const isDefault = path === "";

			const rawBase = join($parentBase, path);

			const updatedRoute = {
				id,
				path,
				meta,
				// If no path prop is given, this Route will act as the default Route
				// that is rendered if no other Route in the Router is a match
				default: isDefault,
				fullPath: isDefault ? "" : rawBase,
				base: isDefault
				? $parentBase
				: extractBaseUri(rawBase, $location.pathname),
				primary,
				focusElement
			};

			route.set(updatedRoute);

			// If we're in SSR mode and the Route matches,
			// `registerRoute` will return the match
			ssrMatch = registerRoute(updatedRoute);
		}
	}

	isActive = !!(ssrMatch || $activeRoute && $activeRoute.id === id);

	{
		if (isActive) {
			const { params: activeParams } = ssrMatch || $activeRoute;
			params.set(activeParams);
		}
	}

	$$unsubscribe_activeRoute();
	$$unsubscribe_location();
	$$unsubscribe_parentBase();
	$$unsubscribe_params();

	return `<div style="${"display:none;"}" aria-hidden="${"true"}"${add_attribute("data-svnav-route-start", id, 0)}></div>
${isActive
	? `${validate_component(Router$1, "Router").$$render($$result, { primary }, {}, {
			default: () => `
		${component !== null
			? `${validate_component(component || missing_component, "svelte:component").$$render($$result, Object.assign({ location: $location }, { navigate }, isSSR ? get_store_value(params) : $params, $$restProps), {}, {})}`
			: `${slots.default
				? slots.default({
						params: isSSR ? get_store_value(params) : $params,
						location: $location,
						navigate
					})
				: ``}`}`
		})}`
	: ``}
<div style="${"display:none;"}" aria-hidden="${"true"}"${add_attribute("data-svnav-route-end", id, 0)}></div>`;
});

var Route$1 = Route;

/* src\Home.svelte generated by Svelte v3.45.0 */

const Home = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	return `<h1>Potato</h1>`;
});

/* src\Login.svelte generated by Svelte v3.45.0 */

const css$3 = {
	code: ".container.svelte-17n50m7.svelte-17n50m7{margin:0 auto;margin-top:50px;padding:20px;padding-top:40px;padding-bottom:0;width:100%;height:100%;max-width:500px;max-height:500px;background-color:var(--sub-color);border-radius:5px;-webkit-box-shadow:-2px 5px 12px 5px rgba(0, 0, 0, 0.22);box-shadow:-2px 5px 12px 5px rgba(0, 0, 0, 0.22)}.container.svelte-17n50m7>input.svelte-17n50m7{width:80%;margin:0 auto;display:block;margin-bottom:40px;border-radius:5px}",
	map: "{\"version\":3,\"file\":\"Login.svelte\",\"sources\":[\"Login.svelte\"],\"sourcesContent\":[\"<script lang=\\\"ts\\\">let email = \\\"\\\";\\r\\nlet password = \\\"\\\";\\r\\n</script>\\r\\n\\r\\n<div>\\r\\n    <h1>Login</h1>\\r\\n    <div class=\\\"container\\\">\\r\\n        <input type=\\\"email\\\" placeholder=\\\"email\\\" bind:value={email} required />\\r\\n        <input\\r\\n            type=\\\"password\\\"\\r\\n            placeholder=\\\"password\\\"\\r\\n            bind:value={password}\\r\\n            required\\r\\n        />\\r\\n    </div>\\r\\n</div>\\r\\n\\r\\n<style>\\r\\n    .container {\\r\\n        margin: 0 auto;\\r\\n        margin-top: 50px;\\r\\n        padding: 20px;\\r\\n        padding-top: 40px;\\r\\n        padding-bottom: 0;\\r\\n        width: 100%;\\r\\n        height: 100%;\\r\\n        max-width: 500px;\\r\\n        max-height: 500px;\\r\\n        background-color: var(--sub-color);\\r\\n        border-radius: 5px;\\r\\n\\r\\n        -webkit-box-shadow: -2px 5px 12px 5px rgba(0, 0, 0, 0.22);\\r\\n        box-shadow: -2px 5px 12px 5px rgba(0, 0, 0, 0.22);\\r\\n    }\\r\\n\\r\\n    .container > input {\\r\\n        width: 80%;\\r\\n        margin: 0 auto;\\r\\n        display: block;\\r\\n        margin-bottom: 40px;\\r\\n        border-radius: 5px;\\r\\n    }\\r\\n</style>\\r\\n\"],\"names\":[],\"mappings\":\"AAkBI,UAAU,8BAAC,CAAC,AACR,MAAM,CAAE,CAAC,CAAC,IAAI,CACd,UAAU,CAAE,IAAI,CAChB,OAAO,CAAE,IAAI,CACb,WAAW,CAAE,IAAI,CACjB,cAAc,CAAE,CAAC,CACjB,KAAK,CAAE,IAAI,CACX,MAAM,CAAE,IAAI,CACZ,SAAS,CAAE,KAAK,CAChB,UAAU,CAAE,KAAK,CACjB,gBAAgB,CAAE,IAAI,WAAW,CAAC,CAClC,aAAa,CAAE,GAAG,CAElB,kBAAkB,CAAE,IAAI,CAAC,GAAG,CAAC,IAAI,CAAC,GAAG,CAAC,KAAK,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,IAAI,CAAC,CACzD,UAAU,CAAE,IAAI,CAAC,GAAG,CAAC,IAAI,CAAC,GAAG,CAAC,KAAK,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,IAAI,CAAC,AACrD,CAAC,AAED,yBAAU,CAAG,KAAK,eAAC,CAAC,AAChB,KAAK,CAAE,GAAG,CACV,MAAM,CAAE,CAAC,CAAC,IAAI,CACd,OAAO,CAAE,KAAK,CACd,aAAa,CAAE,IAAI,CACnB,aAAa,CAAE,GAAG,AACtB,CAAC\"}"
};

const Login = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let email = "";
	let password = "";
	$$result.css.add(css$3);

	return `<div><h1>Login</h1>
    <div class="${"container svelte-17n50m7"}"><input type="${"email"}" placeholder="${"email"}" required class="${"svelte-17n50m7"}"${add_attribute("value", email, 0)}>
        <input type="${"password"}" placeholder="${"password"}" required class="${"svelte-17n50m7"}"${add_attribute("value", password, 0)}></div>
</div>`;
});

/* src\Equation.svelte generated by Svelte v3.45.0 */

const Equation = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let equation;

	onMount(() => {
		window.MQ.StaticMath(equation);
	});

	return `<span class="${"equ"}"${add_attribute("this", equation, 0)}>${slots.default ? slots.default({}) : ``}</span>`;
});

/* src\Graph.svelte generated by Svelte v3.45.0 */

const css$2 = {
	code: ".graph-container.svelte-pmv13l.svelte-pmv13l{display:flex;flex-direction:column;align-items:center;gap:20px}.graph-container.svelte-pmv13l>.graph.svelte-pmv13l{border-radius:10px}",
	map: "{\"version\":3,\"file\":\"Graph.svelte\",\"sources\":[\"Graph.svelte\"],\"sourcesContent\":[\"<script context=\\\"module\\\" lang=\\\"ts\\\">export const colors = typeof window === \\\"undefined\\\" ? {} : window.Desmos.Colors;\\r\\n</script>\\r\\n\\r\\n<script lang=\\\"ts\\\">import { onMount } from \\\"svelte\\\";\\r\\nimport Equation from \\\"./Equation.svelte\\\";\\r\\nexport let equation;\\r\\nexport let color = colors.RED;\\r\\nexport let options = {};\\r\\nexport let bounds = { left: -10, right: 10, bottom: -10, top: 10 };\\r\\nexport let display = (x) => { };\\r\\nexport let width = 200;\\r\\nexport let height = 200;\\r\\nlet element;\\r\\nonMount(() => {\\r\\n    const calc = window.Desmos.GraphingCalculator(element, {\\r\\n        expressions: false,\\r\\n        keypad: false,\\r\\n        settingsMenu: false,\\r\\n        zoomFit: false,\\r\\n    });\\r\\n    calc.setMathBounds(bounds);\\r\\n    if (typeof equation === \\\"string\\\") {\\r\\n        calc.setExpression(Object.assign({ latex: equation, color }, options));\\r\\n    }\\r\\n    else {\\r\\n        for (let eq of equation) {\\r\\n            calc.setExpression(Object.assign({ latex: eq, color }, options));\\r\\n        }\\r\\n    }\\r\\n    display(calc);\\r\\n});\\r\\n</script>\\r\\n\\r\\n<div class=\\\"graph-container\\\">\\r\\n    <Equation>{equation}</Equation>\\r\\n    <div\\r\\n        bind:this={element}\\r\\n        class=\\\"graph\\\"\\r\\n        style=\\\"width: {width}px; height: {height}px;\\\"\\r\\n    />\\r\\n</div>\\r\\n\\r\\n<style>\\r\\n    /* .graph {\\r\\n        width: 200px;\\r\\n        height: 200px;\\r\\n    } */\\r\\n\\r\\n    .graph-container {\\r\\n        display: flex;\\r\\n        flex-direction: column;\\r\\n        align-items: center;\\r\\n        gap: 20px;\\r\\n    }\\r\\n\\r\\n    .graph-container > .graph {\\r\\n        border-radius: 10px;\\r\\n        /* width: 200px;\\r\\n        height: 200px; */\\r\\n    }\\r\\n</style>\\r\\n\"],\"names\":[],\"mappings\":\"AAgDI,gBAAgB,4BAAC,CAAC,AACd,OAAO,CAAE,IAAI,CACb,cAAc,CAAE,MAAM,CACtB,WAAW,CAAE,MAAM,CACnB,GAAG,CAAE,IAAI,AACb,CAAC,AAED,8BAAgB,CAAG,MAAM,cAAC,CAAC,AACvB,aAAa,CAAE,IAAI,AAGvB,CAAC\"}"
};

const colors = typeof window === "undefined"
? {}
: window.Desmos.Colors;

const Graph = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let { equation } = $$props;
	let { color = colors.RED } = $$props;
	let { options = {} } = $$props;

	let { bounds = {
		left: -10,
		right: 10,
		bottom: -10,
		top: 10
	} } = $$props;

	let { display = x => {
		
	} } = $$props;

	let { width = 200 } = $$props;
	let { height = 200 } = $$props;
	let element;

	onMount(() => {
		const calc = window.Desmos.GraphingCalculator(element, {
			expressions: false,
			keypad: false,
			settingsMenu: false,
			zoomFit: false
		});

		calc.setMathBounds(bounds);

		if (typeof equation === "string") {
			calc.setExpression(Object.assign({ latex: equation, color }, options));
		} else {
			for (let eq of equation) {
				calc.setExpression(Object.assign({ latex: eq, color }, options));
			}
		}

		display(calc);
	});

	if ($$props.equation === void 0 && $$bindings.equation && equation !== void 0) $$bindings.equation(equation);
	if ($$props.color === void 0 && $$bindings.color && color !== void 0) $$bindings.color(color);
	if ($$props.options === void 0 && $$bindings.options && options !== void 0) $$bindings.options(options);
	if ($$props.bounds === void 0 && $$bindings.bounds && bounds !== void 0) $$bindings.bounds(bounds);
	if ($$props.display === void 0 && $$bindings.display && display !== void 0) $$bindings.display(display);
	if ($$props.width === void 0 && $$bindings.width && width !== void 0) $$bindings.width(width);
	if ($$props.height === void 0 && $$bindings.height && height !== void 0) $$bindings.height(height);
	$$result.css.add(css$2);

	return `<div class="${"graph-container svelte-pmv13l"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `${escape(equation)}` })}
    <div class="${"graph svelte-pmv13l"}" style="${"width: " + escape(width) + "px; height: " + escape(height) + "px;"}"${add_attribute("this", element, 0)}></div>
</div>`;
});

/* src\Math.svelte generated by Svelte v3.45.0 */

const css$1 = {
	code: "#sidenav.svelte-hickvj.svelte-hickvj{padding-left:20px;position:fixed;display:flex;flex-direction:column;gap:20px}#sidenav.svelte-hickvj>div.svelte-hickvj{cursor:pointer}#sidenav.svelte-hickvj>.svelte-hickvj:not(.navselect){transition:color 400ms linear}#sidenav.svelte-hickvj>.navselect.svelte-hickvj{color:var(--main-color)}@media screen and (max-width: 1450px){#sidenav.svelte-hickvj.svelte-hickvj{display:none}}.graphs.svelte-hickvj.svelte-hickvj{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:40px}h3.svelte-hickvj.svelte-hickvj{text-align:center}h1.svelte-hickvj.svelte-hickvj,h2.svelte-hickvj.svelte-hickvj,h3.svelte-hickvj.svelte-hickvj,h4.svelte-hickvj.svelte-hickvj{color:var(--main-color)}ul.svelte-hickvj.svelte-hickvj{list-style:none}.main.svelte-hickvj.svelte-hickvj{margin:0 auto;margin-top:50px;width:800px;max-width:80%}h2.svelte-hickvj.svelte-hickvj{text-align:center}table.svelte-hickvj.svelte-hickvj{border-collapse:collapse;width:100%}td.svelte-hickvj.svelte-hickvj,th.svelte-hickvj.svelte-hickvj{border:2px solid var(--main-color);text-align:left;padding:8px}body{background:linear-gradient(45deg, #272726, #3d3d3d, #3d3d3d, #272726);background-size:400% 400%;background-attachment:fixed;background-repeat:no-repeat;animation:svelte-hickvj-gradient 800s ease linear infinite;-moz-animation:svelte-hickvj-gradient 800s linear infinite;-webkit-animation:svelte-hickvj-gradient 800s linear infinite}@keyframes svelte-hickvj-gradient{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}",
	map: "{\"version\":3,\"file\":\"Math.svelte\",\"sources\":[\"Math.svelte\"],\"sourcesContent\":[\"<script lang=\\\"ts\\\">import { onMount } from \\\"svelte\\\";\\r\\n// import {MathQuill} from '@trevorhanus/mathquill-types'\\r\\n// const MQ = getInt\\r\\nimport Equation from \\\"./Equation.svelte\\\";\\r\\nimport Graph, { colors } from \\\"./Graph.svelte\\\";\\r\\nlet hash = \\\"trig\\\";\\r\\nlet elements;\\r\\nonMount(() => {\\r\\n    if (window.location.hash !== \\\"\\\") {\\r\\n        hash = window.location.hash.substring(1);\\r\\n    }\\r\\n    elements = document.querySelectorAll(\\\".scroll\\\");\\r\\n});\\r\\nconst switchNav = (nav) => {\\r\\n    hash = nav;\\r\\n    window.location.hash = `#${nav}`;\\r\\n};\\r\\nlet scrollY;\\r\\n$: {\\r\\n    if (elements) {\\r\\n        let element;\\r\\n        for (const elem of elements) {\\r\\n            if (elem.getBoundingClientRect().y + scrollY - 200 < scrollY) {\\r\\n                element = elem;\\r\\n            }\\r\\n        }\\r\\n        if (element && hash !== element.id) {\\r\\n            hash = element.id;\\r\\n        }\\r\\n    }\\r\\n}\\r\\n</script>\\r\\n\\r\\n<svelte:window bind:scrollY />\\r\\n<div class=\\\"content\\\">\\r\\n    <h1>Assigment 0.2</h1>\\r\\n    <h3>By Oliver Clarke</h3>\\r\\n    <div id=\\\"sidenav\\\">\\r\\n        <div\\r\\n            class={hash === \\\"trig\\\" ? \\\"navselect\\\" : \\\"\\\"}\\r\\n            on:click={() => switchNav(\\\"trig\\\")}\\r\\n        >\\r\\n            Trigonometric Equations\\r\\n        </div>\\r\\n        <div\\r\\n            class={hash === \\\"exp\\\" ? \\\"navselect\\\" : \\\"\\\"}\\r\\n            on:click={() => switchNav(\\\"exp\\\")}\\r\\n        >\\r\\n            Exponential Equations\\r\\n        </div>\\r\\n        <div\\r\\n            class={hash === \\\"log\\\" ? \\\"navselect\\\" : \\\"\\\"}\\r\\n            on:click={() => switchNav(\\\"log\\\")}\\r\\n        >\\r\\n            Logarithmic Equations\\r\\n        </div>\\r\\n        <div\\r\\n            class={hash === \\\"comb\\\" ? \\\"navselect\\\" : \\\"\\\"}\\r\\n            on:click={() => switchNav(\\\"comb\\\")}\\r\\n        >\\r\\n            Combinations of functions\\r\\n        </div>\\r\\n    </div>\\r\\n    <div class=\\\"main\\\">\\r\\n        <h2 id=\\\"trig\\\" class=\\\"scroll\\\">Trigonometric Functions</h2>\\r\\n        <p>\\r\\n            Trionometric functions are funcitons which describe the relationship\\r\\n            of the angle of a <strong>right angled</strong> traingle and it's\\r\\n            side lengths. These functions are periodic functinos meaning they\\r\\n            repeat their values at regular intervals.<br />\\r\\n            The most common trig functions are sine, cosine, and tangent with their\\r\\n            respective reciprocals cosecant, secant, and cotangent. All of these\\r\\n            functions have their inverse functions or arc functions that take a side\\r\\n            length and produce an angle.<br />\\r\\n        </p>\\r\\n        <table>\\r\\n            <tr>\\r\\n                <td\\r\\n                    ><Equation\\r\\n                        >sin(x)\\\\ \\\\ \\\\ \\\\ x\\\\ \\\\in\\\\ \\\\R,\\\\ \\\\ \\\\ y\\\\ \\\\in\\\\ [-1, 1]</Equation\\r\\n                    ></td\\r\\n                >\\r\\n                <td>\\r\\n                    <Equation\\r\\n                        >arcsin(x)\\\\ \\\\ \\\\ \\\\ x\\\\ \\\\in\\\\ [-1, 1],\\\\ \\\\ \\\\ y\\\\ \\\\in\\\\\\r\\n                        [-\\\\frac\\\\pi2, \\\\frac\\\\pi2]</Equation\\r\\n                    >\\r\\n                </td>\\r\\n            </tr>\\r\\n            <tr>\\r\\n                <td>\\r\\n                    <Equation\\r\\n                        >cos(x)\\\\ \\\\ \\\\ \\\\ x\\\\ \\\\in\\\\ \\\\R,\\\\ \\\\ \\\\ y\\\\ \\\\in\\\\ [-1, 1]</Equation\\r\\n                    >\\r\\n                </td>\\r\\n                <td>\\r\\n                    <Equation\\r\\n                        >arccos(x)\\\\ \\\\ \\\\ \\\\ x\\\\ \\\\in\\\\ [-1, 1],\\\\ \\\\ \\\\ y\\\\ \\\\in\\\\ [0, \\\\pi]</Equation\\r\\n                    >\\r\\n                </td>\\r\\n            </tr>\\r\\n            <tr>\\r\\n                <td>\\r\\n                    <Equation\\r\\n                        >tan(x)\\\\ \\\\ \\\\ \\\\ x\\\\ \\\\in\\\\ \\\\R\\\\ \\\\ except\\\\ \\\\ x = \\\\frac{\\\"{\\\"}\\\\pi{\\\"}\\\"}{\\\"{\\\"}2{\\\"}\\\"}\\r\\n                        \\\\pm n\\\\pi,\\\\ \\\\ \\\\ y\\\\ \\\\in\\\\ [-\\\\infty, \\\\infty]\\r\\n                    </Equation>\\r\\n                </td>\\r\\n                <td>\\r\\n                    <Equation\\r\\n                        >arctan(x)\\\\ \\\\ \\\\ \\\\ x\\\\ \\\\in\\\\ \\\\R,\\\\ \\\\ \\\\ y\\\\ \\\\in\\\\ [-\\\\frac\\\\pi2,\\r\\n                        \\\\frac\\\\pi2]</Equation\\r\\n                    >\\r\\n                </td>\\r\\n            </tr>\\r\\n        </table>\\r\\n\\r\\n        <p>\\r\\n            The general equation for sin is:\\r\\n            <br />\\r\\n            <br />\\r\\n            <Equation>asin(b(x+c))</Equation>\\r\\n            <br />\\r\\n            <br />\\r\\n            where a is amplitude, b is frequency/amplitude, and c is the phase shift\\r\\n        </p>\\r\\n        <h4>Important Angles</h4>\\r\\n        <table>\\r\\n            <tr>\\r\\n                <th><Equation>\\\\theta</Equation></th>\\r\\n                <th><Equation>sin(\\\\theta)</Equation></th>\\r\\n                <th><Equation>cos(\\\\theta)</Equation></th>\\r\\n                <th><Equation>tan(\\\\theta)</Equation></th>\\r\\n                <th><Equation>csc(\\\\theta)</Equation></th>\\r\\n                <th><Equation>sec(\\\\theta)</Equation></th>\\r\\n                <th><Equation>cot(\\\\theta)</Equation></th>\\r\\n            </tr>\\r\\n            <tr>\\r\\n                <td>0</td>\\r\\n                <td>0</td>\\r\\n                <td>1</td>\\r\\n                <td>0</td>\\r\\n                <td>undefined</td>\\r\\n                <td>1</td>\\r\\n                <td>undefined</td>\\r\\n            </tr>\\r\\n            <tr>\\r\\n                <td><Equation>\\\\frac\\\\pi2</Equation></td>\\r\\n                <td>1</td>\\r\\n                <td>0</td>\\r\\n                <td>undefined</td>\\r\\n                <td>0</td>\\r\\n                <td>undefined</td>\\r\\n                <td>1</td>\\r\\n            </tr>\\r\\n            <tr>\\r\\n                <td><Equation>\\\\pi</Equation></td>\\r\\n                <td>0</td>\\r\\n                <td>-1</td>\\r\\n                <td>0</td>\\r\\n                <td>undefined</td>\\r\\n                <td>-1</td>\\r\\n                <td>undefined</td>\\r\\n            </tr>\\r\\n            <tr>\\r\\n                <td><Equation>\\\\frac\\\\pi6</Equation></td>\\r\\n                <td><Equation>\\\\frac{\\\"{\\\"}1{\\\"}\\\"}{\\\"{\\\"}2{\\\"}\\\"}</Equation></td>\\r\\n                <td><Equation>\\\\frac{\\\"{\\\"}\\\\sqrt3{\\\"}\\\"}{\\\"{\\\"}2{\\\"}\\\"}</Equation></td>\\r\\n                <td><Equation>\\\\frac{\\\"{\\\"}1{\\\"}\\\"}{\\\"{\\\"}\\\\sqrt3{\\\"}\\\"}</Equation></td>\\r\\n                <td><Equation>\\\\sqrt3</Equation></td>\\r\\n                <td><Equation>\\\\frac{\\\"{\\\"}2{\\\"}\\\"}{\\\"{\\\"}\\\\sqrt3{\\\"}\\\"}</Equation></td>\\r\\n                <td>2</td>\\r\\n            </tr>\\r\\n            <tr>\\r\\n                <td><Equation>\\\\frac\\\\pi4</Equation></td>\\r\\n                <td><Equation>\\\\frac{\\\"{\\\"}1{\\\"}\\\"}{\\\"{\\\"}\\\\sqrt2{\\\"}\\\"}</Equation></td>\\r\\n                <td><Equation>\\\\frac{\\\"{\\\"}1{\\\"}\\\"}{\\\"{\\\"}\\\\sqrt2{\\\"}\\\"}</Equation></td>\\r\\n                <td>1</td>\\r\\n                <td>1</td>\\r\\n                <td><Equation>\\\\sqrt2</Equation></td>\\r\\n                <td><Equation>\\\\sqrt2</Equation></td>\\r\\n            </tr>\\r\\n            <tr>\\r\\n                <td><Equation>\\\\frac\\\\pi3</Equation></td>\\r\\n                <td><Equation>\\\\frac{\\\"{\\\"}\\\\sqrt3{\\\"}\\\"}{\\\"{\\\"}2{\\\"}\\\"}</Equation></td>\\r\\n                <td><Equation>\\\\frac{\\\"{\\\"}1{\\\"}\\\"}{\\\"{\\\"}2{\\\"}\\\"}</Equation></td>\\r\\n                <td><Equation>\\\\sqrt3</Equation></td>\\r\\n                <td><Equation>\\\\frac{\\\"{\\\"}1{\\\"}\\\"}{\\\"{\\\"}\\\\sqrt3{\\\"}\\\"}</Equation></td>\\r\\n                <td>2</td>\\r\\n                <td><Equation>\\\\frac{\\\"{\\\"}2{\\\"}\\\"}{\\\"{\\\"}\\\\sqrt3{\\\"}\\\"}</Equation></td>\\r\\n            </tr>\\r\\n        </table>\\r\\n        <h4>Graphs</h4>\\r\\n        <div class=\\\"graphs\\\">\\r\\n            <Graph equation=\\\"y=\\\\sin(x)\\\" />\\r\\n            <Graph equation=\\\"y=\\\\sin(2x)\\\" color={colors.GREEN} />\\r\\n            <Graph equation=\\\"y=4\\\\sin(x)\\\" color={colors.ORANGE} />\\r\\n            <Graph equation=\\\"y=2\\\\cos(3x)\\\" color={colors.PURPLE} />\\r\\n            <Graph equation=\\\"y=\\\\tan(x)\\\" />\\r\\n        </div>\\r\\n        <h4>Unit Circle</h4>\\r\\n        <p>\\r\\n            The unit circle is a circle of radius 1. Because of this, it's easy\\r\\n            to relate sin and cos to a line segment with an origin at (0, 0),\\r\\n            with a length of 1, and angle <Equation>\\\\theta</Equation> since these\\r\\n            functions have a range of [-1, 1]: the angle of the line is used as the\\r\\n            input to these functions, sin yields the y value of the point that the\\r\\n            line falls on while cos produces the x value. The tan function produces\\r\\n            the length of the tangent line of the point on the circle from itself\\r\\n            to the x axis.\\r\\n        </p>\\r\\n        <Graph\\r\\n            equation={[]}\\r\\n            bounds={{ left: -1.2, right: 1.2, bottom: -1.2, top: 1.2 }}\\r\\n            display={(calc) => {\\r\\n                calc.setExpression({\\r\\n                    id: \\\"a\\\",\\r\\n                    latex: \\\"a=0\\\",\\r\\n                    sliderBounds: { min: \\\"0\\\", max: \\\"2*\\\\\\\\pi\\\", isPlaying: true },\\r\\n                });\\r\\n                calc.setExpression({ latex: \\\"y^2+x^2=1\\\", color: colors.RED });\\r\\n                calc.setExpression({\\r\\n                    latex: \\\"y=x\\\\\\\\tan(a) \\\\\\\\{{0<x<\\\\\\\\cos(a)\\\\\\\\}}\\\",\\r\\n                    color: colors.GREEN,\\r\\n                });\\r\\n                calc.setExpression({\\r\\n                    latex: \\\"y=x\\\\\\\\tan(a) \\\\\\\\{{\\\\\\\\cos(a)<x<0\\\\\\\\}}\\\",\\r\\n                    color: colors.GREEN,\\r\\n                });\\r\\n                calc.setExpression({\\r\\n                    latex: \\\"x=\\\\\\\\cos(a) \\\\\\\\{{0<y<\\\\\\\\sin(a)\\\\\\\\}}\\\",\\r\\n                    color: colors.PURPLE,\\r\\n                });\\r\\n                calc.setExpression({\\r\\n                    latex: \\\"x=\\\\\\\\cos(a) \\\\\\\\{{\\\\\\\\sin(a)<y<0\\\\\\\\}}\\\",\\r\\n                    color: colors.PURPLE,\\r\\n                });\\r\\n                calc.setExpression({\\r\\n                    latex: \\\"y=0 \\\\\\\\{{0<x<\\\\\\\\cos(a)\\\\\\\\}}\\\",\\r\\n                    color: colors.ORANGE,\\r\\n                });\\r\\n                calc.setExpression({\\r\\n                    latex: \\\"y=0 \\\\\\\\{{\\\\\\\\cos(a)<x<0\\\\\\\\}}\\\",\\r\\n                    color: colors.ORANGE,\\r\\n                });\\r\\n                calc.setExpression({\\r\\n                    latex: \\\"(\\\\\\\\cos(a), \\\\\\\\sin(a))\\\",\\r\\n                    color: colors.BLACK,\\r\\n                });\\r\\n                calc.setExpression({\\r\\n                    latex: \\\"y=-\\\\\\\\cot(a)(x-\\\\\\\\cos(a))+\\\\\\\\sin(a) \\\\\\\\{{0<y<\\\\\\\\sin(a)\\\\\\\\}}\\\",\\r\\n                    color: colors.BLACK,\\r\\n                });\\r\\n                calc.setExpression({\\r\\n                    latex: \\\"y=-\\\\\\\\cot(a)(x-\\\\\\\\cos(a))+\\\\\\\\sin(a) \\\\\\\\{{\\\\\\\\sin(a)<y<0\\\\\\\\}}\\\",\\r\\n                    color: colors.BLACK,\\r\\n                });\\r\\n                let state = calc.getState();\\r\\n                state.expressions.list[0].slider.isPlaying = true;\\r\\n                state.expressions.list[0].slider.loopMode = \\\"LOOP_FORWARD\\\";\\r\\n                calc.setState(state);\\r\\n            }}\\r\\n            width={400}\\r\\n            height={400}\\r\\n        />\\r\\n        <br />\\r\\n        <p>\\r\\n            As seen on the graph above, a triangle is formed out of the line\\r\\n            described above, which is the hypotenuse, along with the lines\\r\\n            created by the values of cos and sin. Hence, these trig functions\\r\\n            can be used to solve for the side length and angles of a right\\r\\n            triangle. For triangles with a hypotenuse greater than 1, we look\\r\\n            back to the above definition of these functions and see that <Equation\\r\\n                >sin(\\\\theta)=y</Equation\\r\\n            > and <Equation>cos(\\\\theta)=x</Equation>. We also see that they must\\r\\n            be in the range [-1, 1]. For triangles with hypotenuse greater than\\r\\n            1, it is very likely that these side lengths will be greater than 1\\r\\n            which would break this definition. To solve this we can normalize\\r\\n            the x and y values by dividing them by the hypotenuse, gauranteein\\r\\n            that they will be in the range [0, 1]. Therefore we can say <Equation\\r\\n                >sin(\\\\theta)=\\\\frac{\\\"{\\\"}y{\\\"}\\\"}{\\\"{\\\"}hyp{\\\"}\\\"}</Equation\\r\\n            > and <Equation>cos(\\\\theta)=\\\\frac{\\\"{\\\"}x{\\\"}\\\"}{\\\"{\\\"}hyp{\\\"}\\\"}</Equation\\r\\n            >. Tangent can be defined as <Equation\\r\\n                >\\\\tan(\\\\theta) =\\\\frac{\\\"{\\\"}y{\\\"}\\\"}{\\\"{\\\"}x{\\\"}\\\"}</Equation\\r\\n            > or\\r\\n            <Equation\\r\\n                >\\\\tan(\\\\theta) =\\\\frac{\\\"{\\\"}sin(\\\\theta){\\\"}\\\"}{\\\"{\\\"}cos(\\\\theta){\\\"}\\\"}</Equation\\r\\n            >.\\r\\n        </p>\\r\\n        <h4>Examples</h4>\\r\\n        <p>\\r\\n            Given a triangle has an angle of <Equation\\r\\n                >\\\\frac{\\\"{\\\"}\\\\pi{\\\"}\\\"}6</Equation\\r\\n            > with a hypotenuse of 8, find the opposite side of the angle:\\r\\n            <br />\\r\\n            <Equation>\\\\sin(\\\\theta) = \\\\frac{\\\"{\\\"}opp{\\\"}\\\"}{\\\"{\\\"}hyp{\\\"}\\\"}</Equation>\\r\\n            <br />\\r\\n            <Equation>hyp\\\\cdot\\\\sin(\\\\theta) = opp</Equation>\\r\\n            <br />\\r\\n            <Equation>8\\\\cdot\\\\sin(\\\\frac{\\\"{\\\"}\\\\pi{\\\"}\\\"}6) = opp</Equation>\\r\\n            <br />\\r\\n            <Equation>8\\\\cdot\\\\frac{\\\"{\\\"}\\\\sqrt3{\\\"}\\\"}2 = opp</Equation>\\r\\n            <br />\\r\\n            <Equation>4\\\\sqrt3 = opp</Equation>\\r\\n            <br />\\r\\n            <br />\\r\\n            <br />\\r\\n            A triangle has an opposite side length of 50 and an adjacent side length\\r\\n            of 37. Find the angle <Equation>\\\\theta</Equation>:\\r\\n            <br />\\r\\n            <Equation>\\\\tan(\\\\theta) = \\\\frac{\\\"{\\\"}opp{\\\"}\\\"}{\\\"{\\\"}adj{\\\"}\\\"}</Equation>\\r\\n            <br />\\r\\n            <Equation\\r\\n                >\\\\theta = \\\\arctan(\\\\frac{\\\"{\\\"}opp{\\\"}\\\"}{\\\"{\\\"}adj{\\\"}\\\"})</Equation\\r\\n            >\\r\\n            <br />\\r\\n            <Equation>\\\\theta = \\\\arctan(\\\\frac{\\\"{\\\"}50{\\\"}\\\"}{\\\"{\\\"}37{\\\"}\\\"})</Equation>\\r\\n            <br />\\r\\n            <Equation>\\\\theta = 0.9337</Equation>\\r\\n            <br />\\r\\n            <br />\\r\\n            <br />\\r\\n            <br />\\r\\n        </p>\\r\\n\\r\\n        <h2 id=\\\"exp\\\" class=\\\"scroll\\\">Exponential Functions</h2>\\r\\n        <p>\\r\\n            Exponential functions are those that include a variable in the\\r\\n            exponent. They generally take the form:\\r\\n            <br />\\r\\n            <Equation>f(x)=b^x</Equation>\\r\\n            <br />\\r\\n            Where b (the base) is a constant and <Equation>b>0</Equation> and <Equation\\r\\n                >b\\\\ne1</Equation\\r\\n            >.\\r\\n        </p>\\r\\n        <h4>Graphs</h4>\\r\\n        <div class=\\\"graphs\\\">\\r\\n            <Graph equation=\\\"y=2^x\\\" />\\r\\n            <Graph equation=\\\"y=(\\\\frac{'{'}1{'}'}2)^x\\\" color={colors.GREEN} />\\r\\n            <Graph equation=\\\"y=e^x\\\" color={colors.ORANGE} />\\r\\n            <Graph equation=\\\"y=-3^x\\\" />\\r\\n            <Graph\\r\\n                equation=\\\"y=a^x\\\"\\r\\n                bounds={{ left: -8.2, right: 8.2, bottom: -8.2, top: 8.2 }}\\r\\n                color={colors.BLUE}\\r\\n                display={(calc) => {\\r\\n                    calc.setExpression({\\r\\n                        id: \\\"a\\\",\\r\\n                        latex: \\\"a=0.1\\\",\\r\\n                        sliderBounds: {\\r\\n                            min: \\\"0\\\",\\r\\n                            max: \\\"4\\\",\\r\\n                        },\\r\\n                    });\\r\\n\\r\\n                    let state = calc.getState();\\r\\n                    state.expressions.list[1].slider.isPlaying = true;\\r\\n                    calc.setState(state);\\r\\n                }}\\r\\n            />\\r\\n        </div>\\r\\n        <h4>Exponent Rules</h4>\\r\\n        <table>\\r\\n            <tr>\\r\\n                <td>Product Rule</td>\\r\\n                <td><Equation>b^x \\\\cdot b^y=b^{\\\"{\\\"}x+y{\\\"}\\\"}</Equation></td>\\r\\n            </tr>\\r\\n            <tr>\\r\\n                <td>Quotient Rule</td>\\r\\n                <td\\r\\n                    ><Equation\\r\\n                        >\\\\frac{\\\"{\\\"}b^x{\\\"}\\\"}{\\\"{\\\"}b^y{\\\"}\\\"}=b^{\\\"{\\\"}x-y{\\\"}\\\"}</Equation\\r\\n                    ></td\\r\\n                >\\r\\n            </tr>\\r\\n            <tr>\\r\\n                <td>Power Rule</td>\\r\\n                <td><Equation>(b^x)^y=b^{\\\"{\\\"}xy{\\\"}\\\"}</Equation></td>\\r\\n            </tr>\\r\\n            <tr>\\r\\n                <td>Power of Product Rule</td>\\r\\n                <td><Equation>(ab)^x=a^xb^x</Equation></td>\\r\\n            </tr>\\r\\n            <tr>\\r\\n                <td>Power of Quotient Rule</td>\\r\\n                <td\\r\\n                    ><Equation\\r\\n                        >(\\\\frac a b)^x=(\\\\frac{\\\"{\\\"}a^x{\\\"}\\\"}\\r\\n                        {\\\"{\\\"}b^x{\\\"}\\\"})</Equation\\r\\n                    ></td\\r\\n                >\\r\\n            </tr>\\r\\n            <tr>\\r\\n                <td>Exponent of 0</td>\\r\\n                <td><Equation>b^0=1</Equation></td>\\r\\n            </tr>\\r\\n            <tr>\\r\\n                <td>Negative Exponent</td>\\r\\n                <td\\r\\n                    ><Equation>b^{\\\"{\\\"}-x{\\\"}\\\"}=\\\\frac 1 {\\\"{\\\"}b^x{\\\"}\\\"}</Equation\\r\\n                    ></td\\r\\n                >\\r\\n            </tr>\\r\\n            <tr>\\r\\n                <td>Fractional Exponent</td>\\r\\n                <td><Equation>b^{\\\"{\\\"}\\\\frac x y{\\\"}\\\"}=\\\\sqrt[y]b^x</Equation></td>\\r\\n            </tr>\\r\\n        </table>\\r\\n\\r\\n        <br />\\r\\n        <br />\\r\\n        <h2 id=\\\"log\\\" class=\\\"scroll\\\">Logarithmic Functions</h2>\\r\\n        <p>\\r\\n            Logarithmic functions are the inverse functions of exponential\\r\\n            functions. Therefore, if <Equation>y=b^x</Equation>, then <Equation\\r\\n                >x=\\\\log_a y</Equation\\r\\n            > where <Equation>y>0</Equation>. The logarithm with base <Equation\\r\\n                >e</Equation\\r\\n            > has a special name of natural log: <Equation>y=\\\\ln x</Equation>\\r\\n        </p>\\r\\n        <h4>Graphs</h4>\\r\\n        <div class=\\\"graphs\\\">\\r\\n            <Graph\\r\\n                equation=\\\"y=\\\\log_{'{'}10{'}'}x\\\"\\r\\n                bounds={{ left: -2, right: 6, bottom: -4, top: 4 }}\\r\\n            />\\r\\n            <Graph\\r\\n                equation=\\\"y=\\\\ln x\\\"\\r\\n                bounds={{ left: -2, right: 6, bottom: -4, top: 4 }}\\r\\n                color={colors.GREEN}\\r\\n            />\\r\\n\\r\\n            <Graph\\r\\n                equation=\\\"y=\\\\log_{'{'}a{'}'}x\\\"\\r\\n                bounds={{ left: -2, right: 6, bottom: -4, top: 4 }}\\r\\n                color={colors.BLUE}\\r\\n                display={(calc) => {\\r\\n                    calc.setExpression({\\r\\n                        id: \\\"a\\\",\\r\\n                        latex: \\\"a=0.1\\\",\\r\\n                        sliderBounds: {\\r\\n                            min: \\\"0.1\\\",\\r\\n                            max: \\\"4\\\",\\r\\n                        },\\r\\n                    });\\r\\n\\r\\n                    let state = calc.getState();\\r\\n                    state.expressions.list[1].slider.isPlaying = true;\\r\\n                    calc.setState(state);\\r\\n                }}\\r\\n            />\\r\\n        </div>\\r\\n        <h4>Log Rules</h4>\\r\\n        <table>\\r\\n            <tr>\\r\\n                <td>Product Rule</td>\\r\\n                <td><Equation>\\\\log_a xy = \\\\log_a x + \\\\log_a y</Equation></td>\\r\\n            </tr>\\r\\n            <tr>\\r\\n                <td>Quotient Rule</td>\\r\\n                <td\\r\\n                    ><Equation\\r\\n                        >\\\\log_a\\\\frac{\\\"{\\\"}x{\\\"}\\\"}{\\\"{\\\"}y{\\\"}\\\"}=\\\\log_a x - log_a y</Equation\\r\\n                    ></td\\r\\n                >\\r\\n            </tr>\\r\\n            <tr>\\r\\n                <td>Power Rule</td>\\r\\n                <td><Equation>\\\\log_a x^b = b\\\\log_a x</Equation></td>\\r\\n            </tr>\\r\\n            <tr>\\r\\n                <td>Change of Base Rule</td>\\r\\n                <td\\r\\n                    ><Equation\\r\\n                        >\\\\log_a x = \\\\frac{\\\"{\\\"}\\\\log_b x{\\\"}\\\"}{\\\"{\\\"}log_b a{\\\"}\\\"}</Equation\\r\\n                    ></td\\r\\n                >\\r\\n            </tr>\\r\\n            <tr>\\r\\n                <td>Equality Rule</td>\\r\\n                <td><Equation>If \\\\log_a x = log_a y\\\\ then\\\\ x=y</Equation></td>\\r\\n            </tr>\\r\\n            <tr>\\r\\n                <td>Log of 1</td>\\r\\n                <td><Equation>\\\\log_a 1 = 0</Equation></td>\\r\\n            </tr>\\r\\n        </table>\\r\\n        <br />\\r\\n        <br />\\r\\n        <h2 id=\\\"comb\\\" class=\\\"scroll\\\">Combinations of Functions</h2>\\r\\n        <p>\\r\\n            Functions can be added, subtracted, multiplied, and divided much\\r\\n            like regular numbers. The basic forms of this for functions <Equation\\r\\n                >f(x)</Equation\\r\\n            > and <Equation>g(x)</Equation> are:\\r\\n        </p>\\r\\n        <br />\\r\\n        <table>\\r\\n            <tr>\\r\\n                <td>Addition</td>\\r\\n                <td><Equation>(f+g)(x) = f(x) + g(x)</Equation></td>\\r\\n            </tr>\\r\\n            <tr>\\r\\n                <td>Subtraction</td>\\r\\n                <td><Equation>(f-g)(x) = f(x) - g(x)</Equation></td>\\r\\n            </tr>\\r\\n            <tr>\\r\\n                <td>Multiplication</td>\\r\\n                <td><Equation>(f\\\\cdot g)(x) = f(x) \\\\cdot g(x)</Equation></td>\\r\\n            </tr>\\r\\n            <tr>\\r\\n                <td>Division</td>\\r\\n                <td\\r\\n                    ><Equation\\r\\n                        >(\\\\frac f g)(x) = \\\\frac{\\\"{\\\"}f(x){\\\"}\\\"}\\r\\n                        {\\\"{\\\"}g(x){\\\"}\\\"}</Equation\\r\\n                    >\\r\\n                    where <Equation>g(x)\\\\ne0</Equation>\\r\\n                </td>\\r\\n            </tr>\\r\\n        </table>\\r\\n        <p>\\r\\n            The domain of the new combined function includes all the points for\\r\\n            which the all the functions used to compose it are defined at that\\r\\n            point.\\r\\n        </p>\\r\\n        <h4>Composition</h4>\\r\\n        <p>\\r\\n            Composition is slightly different as it is the process of plugging\\r\\n            one function into another:\\r\\n            <br />\\r\\n            <Equation>(f\\\\circ g)(x) = f(g(x))</Equation>\\r\\n            <br />\\r\\n            <br />\\r\\n            Here f is said to be composed of g of x. Functions are evaluated from\\r\\n            the inside out and is not cumulative.\\r\\n            <br />\\r\\n            The domain of a composed function is values of x that are in the domain\\r\\n            of the inner function(s) that are in the domain of the outer.\\r\\n        </p>\\r\\n        <h4>Examples</h4>\\r\\n        Using <Equation>f(x) = -5x-3</Equation> and <Equation\\r\\n            >g(x)=x^2+8x+1</Equation\\r\\n        >:\\r\\n        <br />\\r\\n        <ul>\\r\\n            <li>\\r\\n                Adding:\\r\\n                <br />\\r\\n                <Equation>(f+g)(x) = f(x) + g(x)</Equation>\\r\\n                <br />\\r\\n                <Equation>=(-5x-3) + (x^2+8x+1)</Equation>\\r\\n                <br />\\r\\n                <Equation>=-5x-3+x^2+8x+1</Equation>\\r\\n                <br />\\r\\n                <Equation>=x^2+3x-2</Equation>\\r\\n                <br />\\r\\n                <Equation>=x\\\\in\\\\R</Equation>\\r\\n            </li>\\r\\n            <br />\\r\\n            <li>\\r\\n                Subtracting:\\r\\n                <br />\\r\\n                <Equation>(f-g)(x) = f(x) - g(x)</Equation>\\r\\n                <br />\\r\\n                <Equation>=(-5x-3) - (x^2+8x+1)</Equation>\\r\\n                <br />\\r\\n                <Equation>=-5x-3-x^2-8x-1</Equation>\\r\\n                <br />\\r\\n                <Equation>=-x^2-13x-4</Equation>\\r\\n                <br />\\r\\n                <Equation>=x\\\\in\\\\R</Equation>\\r\\n            </li>\\r\\n            <br />\\r\\n            <li>\\r\\n                Multiplying:\\r\\n                <br />\\r\\n                <Equation>(f\\\\cdot g)(x) = f(x) \\\\cdot g(x)</Equation>\\r\\n                <br />\\r\\n                <Equation>=(-5x-3)(x^2+8x+1)</Equation>\\r\\n                <br />\\r\\n                <Equation>=-5x^3-40x^2-5x-3x^2-24x-3</Equation>\\r\\n                <br />\\r\\n                <Equation>=-5x^3-43x^2-29x-3</Equation>\\r\\n                <br />\\r\\n                <Equation>=x\\\\in\\\\R</Equation>\\r\\n            </li>\\r\\n            <br />\\r\\n            <li>\\r\\n                Dividing:\\r\\n                <br />\\r\\n                <Equation\\r\\n                    >(\\\\frac f g)(x) = \\\\frac{\\\"{\\\"}f(x){\\\"}\\\"}\\r\\n                    {\\\"{\\\"}g(x){\\\"}\\\"}</Equation\\r\\n                >\\r\\n                <br />\\r\\n                <Equation\\r\\n                    >=\\\\frac{\\\"{\\\"}(-5x-3){\\\"}\\\"}\\r\\n                    {\\\"{\\\"}(x^2+8x+1){\\\"}\\\"}</Equation\\r\\n                >\\r\\n                <br />\\r\\n                <Equation>=x\\\\in\\\\R\\\\ except\\\\ x=\\\\pm\\\\sqrt{\\\"{\\\"}15{\\\"}\\\"}-4</Equation>\\r\\n            </li>\\r\\n            <br />\\r\\n            <li>\\r\\n                Composing:\\r\\n                <br />\\r\\n                <Equation>(f\\\\circ g)(x) = f(g(x))</Equation>\\r\\n                <br />\\r\\n                <Equation>=-5(x^2+8x+1)-3</Equation>\\r\\n                <br />\\r\\n                <Equation>=-5x^2-40x-8</Equation>\\r\\n                <br />\\r\\n                <Equation>=x\\\\in\\\\R</Equation>\\r\\n            </li>\\r\\n        </ul>\\r\\n        Compose <Equation>f(x)=\\\\sqrt{\\\"{\\\"}-x-10{\\\"}\\\"}</Equation> and <Equation\\r\\n            >g(x) = x^2+4x</Equation\\r\\n        >:\\r\\n        <br />\\r\\n        <Equation>(f\\\\circ g)(x) = f(g(x))</Equation>\\r\\n        <br />\\r\\n        <Equation>\\\\sqrt{\\\"{\\\"}-(x^2+4x)-10{\\\"}\\\"}</Equation>\\r\\n        <br />\\r\\n        <Equation>\\\\sqrt{\\\"{\\\"}-x^2-4x-10{\\\"}\\\"}</Equation>\\r\\n        <br />\\r\\n        <br />\\r\\n        No values of x satisfy this equation because no values of <Equation\\r\\n            >g(x)</Equation\\r\\n        > are defined in <Equation>f</Equation> i.e. <Equation>g(x)</Equation> will\\r\\n        always produce a negative number for which the square root is not defined\\r\\n        for in the real plane.\\r\\n        <br />\\r\\n        <br />\\r\\n        <br />\\r\\n        <br />\\r\\n        <br />\\r\\n        <br />\\r\\n    </div>\\r\\n</div>\\r\\n\\r\\n<style>\\r\\n    #sidenav {\\r\\n        padding-left: 20px;\\r\\n        position: fixed;\\r\\n        display: flex;\\r\\n        flex-direction: column;\\r\\n        gap: 20px;\\r\\n    }\\r\\n\\r\\n    #sidenav > div {\\r\\n        cursor: pointer;\\r\\n    }\\r\\n\\r\\n    #sidenav > :not(.navselect) {\\r\\n        transition: color 400ms linear;\\r\\n    }\\r\\n\\r\\n    #sidenav > .navselect {\\r\\n        color: var(--main-color);\\r\\n    }\\r\\n\\r\\n    @media screen and (max-width: 1450px) {\\r\\n        #sidenav {\\r\\n            display: none;\\r\\n        }\\r\\n    }\\r\\n\\r\\n    .graphs {\\r\\n        display: flex;\\r\\n        /* padding-top: 50px; */\\r\\n        align-items: center;\\r\\n        justify-content: center;\\r\\n        flex-wrap: wrap;\\r\\n        gap: 40px;\\r\\n    }\\r\\n\\r\\n    h3 {\\r\\n        text-align: center;\\r\\n    }\\r\\n\\r\\n    h1,\\r\\n    h2,\\r\\n    h3,\\r\\n    h4,\\r\\n    h5,\\r\\n    h6 {\\r\\n        color: var(--main-color);\\r\\n    }\\r\\n\\r\\n    ul {\\r\\n        list-style: none;\\r\\n    }\\r\\n\\r\\n    .main {\\r\\n        margin: 0 auto;\\r\\n        margin-top: 50px;\\r\\n        width: 800px;\\r\\n        max-width: 80%;\\r\\n    }\\r\\n\\r\\n    h2 {\\r\\n        text-align: center;\\r\\n    }\\r\\n\\r\\n    table {\\r\\n        /* font-family: arial, sans-serif; */\\r\\n        border-collapse: collapse;\\r\\n        width: 100%;\\r\\n    }\\r\\n\\r\\n    td,\\r\\n    th {\\r\\n        border: 2px solid var(--main-color);\\r\\n        text-align: left;\\r\\n        padding: 8px;\\r\\n    }\\r\\n\\r\\n    /* tr:nth-child(even) {\\r\\n        background-color: var(--sub-color);\\r\\n    } */\\r\\n\\r\\n    :global(body) {\\r\\n        /* width: 100vw;\\r\\n        height: 100vh; */\\r\\n        background: linear-gradient(45deg, #272726, #3d3d3d, #3d3d3d, #272726);\\r\\n        background-size: 400% 400%;\\r\\n        background-attachment: fixed;\\r\\n        background-repeat: no-repeat;\\r\\n        animation: gradient 800s ease linear infinite;\\r\\n        -moz-animation: gradient 800s linear infinite;\\r\\n        -webkit-animation: gradient 800s linear infinite;\\r\\n    }\\r\\n\\r\\n    @keyframes gradient {\\r\\n        0% {\\r\\n            background-position: 0% 50%;\\r\\n        }\\r\\n        50% {\\r\\n            background-position: 100% 50%;\\r\\n        }\\r\\n        100% {\\r\\n            background-position: 0% 50%;\\r\\n        }\\r\\n    }\\r\\n</style>\\r\\n\"],\"names\":[],\"mappings\":\"AAmoBI,QAAQ,4BAAC,CAAC,AACN,YAAY,CAAE,IAAI,CAClB,QAAQ,CAAE,KAAK,CACf,OAAO,CAAE,IAAI,CACb,cAAc,CAAE,MAAM,CACtB,GAAG,CAAE,IAAI,AACb,CAAC,AAED,sBAAQ,CAAG,GAAG,cAAC,CAAC,AACZ,MAAM,CAAE,OAAO,AACnB,CAAC,AAED,sBAAQ,eAAG,KAAK,UAAU,CAAC,AAAC,CAAC,AACzB,UAAU,CAAE,KAAK,CAAC,KAAK,CAAC,MAAM,AAClC,CAAC,AAED,sBAAQ,CAAG,UAAU,cAAC,CAAC,AACnB,KAAK,CAAE,IAAI,YAAY,CAAC,AAC5B,CAAC,AAED,OAAO,MAAM,CAAC,GAAG,CAAC,YAAY,MAAM,CAAC,AAAC,CAAC,AACnC,QAAQ,4BAAC,CAAC,AACN,OAAO,CAAE,IAAI,AACjB,CAAC,AACL,CAAC,AAED,OAAO,4BAAC,CAAC,AACL,OAAO,CAAE,IAAI,CAEb,WAAW,CAAE,MAAM,CACnB,eAAe,CAAE,MAAM,CACvB,SAAS,CAAE,IAAI,CACf,GAAG,CAAE,IAAI,AACb,CAAC,AAED,EAAE,4BAAC,CAAC,AACA,UAAU,CAAE,MAAM,AACtB,CAAC,AAED,8BAAE,CACF,8BAAE,CACF,8BAAE,CACF,EAAE,4BAEC,CAAC,AACA,KAAK,CAAE,IAAI,YAAY,CAAC,AAC5B,CAAC,AAED,EAAE,4BAAC,CAAC,AACA,UAAU,CAAE,IAAI,AACpB,CAAC,AAED,KAAK,4BAAC,CAAC,AACH,MAAM,CAAE,CAAC,CAAC,IAAI,CACd,UAAU,CAAE,IAAI,CAChB,KAAK,CAAE,KAAK,CACZ,SAAS,CAAE,GAAG,AAClB,CAAC,AAED,EAAE,4BAAC,CAAC,AACA,UAAU,CAAE,MAAM,AACtB,CAAC,AAED,KAAK,4BAAC,CAAC,AAEH,eAAe,CAAE,QAAQ,CACzB,KAAK,CAAE,IAAI,AACf,CAAC,AAED,8BAAE,CACF,EAAE,4BAAC,CAAC,AACA,MAAM,CAAE,GAAG,CAAC,KAAK,CAAC,IAAI,YAAY,CAAC,CACnC,UAAU,CAAE,IAAI,CAChB,OAAO,CAAE,GAAG,AAChB,CAAC,AAMO,IAAI,AAAE,CAAC,AAGX,UAAU,CAAE,gBAAgB,KAAK,CAAC,CAAC,OAAO,CAAC,CAAC,OAAO,CAAC,CAAC,OAAO,CAAC,CAAC,OAAO,CAAC,CACtE,eAAe,CAAE,IAAI,CAAC,IAAI,CAC1B,qBAAqB,CAAE,KAAK,CAC5B,iBAAiB,CAAE,SAAS,CAC5B,SAAS,CAAE,sBAAQ,CAAC,IAAI,CAAC,IAAI,CAAC,MAAM,CAAC,QAAQ,CAC7C,cAAc,CAAE,sBAAQ,CAAC,IAAI,CAAC,MAAM,CAAC,QAAQ,CAC7C,iBAAiB,CAAE,sBAAQ,CAAC,IAAI,CAAC,MAAM,CAAC,QAAQ,AACpD,CAAC,AAED,WAAW,sBAAS,CAAC,AACjB,EAAE,AAAC,CAAC,AACA,mBAAmB,CAAE,EAAE,CAAC,GAAG,AAC/B,CAAC,AACD,GAAG,AAAC,CAAC,AACD,mBAAmB,CAAE,IAAI,CAAC,GAAG,AACjC,CAAC,AACD,IAAI,AAAC,CAAC,AACF,mBAAmB,CAAE,EAAE,CAAC,GAAG,AAC/B,CAAC,AACL,CAAC\"}"
};

const Math$1 = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let hash = "trig";
	let elements;

	onMount(() => {
		if (window.location.hash !== "") {
			hash = window.location.hash.substring(1);
		}

		elements = document.querySelectorAll(".scroll");
	});

	let scrollY;
	$$result.css.add(css$1);

	{
		{
			if (elements) {
				let element;

				for (const elem of elements) {
					if (elem.getBoundingClientRect().y + scrollY - 200 < scrollY) {
						element = elem;
					}
				}

				if (element && hash !== element.id) {
					hash = element.id;
				}
			}
		}
	}

	return `
<div class="${"content"}"><h1 class="${"svelte-hickvj"}">Assigment 0.2</h1>
    <h3 class="${"svelte-hickvj"}">By Oliver Clarke</h3>
    <div id="${"sidenav"}" class="${"svelte-hickvj"}"><div class="${escape(null_to_empty(hash === "trig" ? "navselect" : "")) + " svelte-hickvj"}">Trigonometric Equations
        </div>
        <div class="${escape(null_to_empty(hash === "exp" ? "navselect" : "")) + " svelte-hickvj"}">Exponential Equations
        </div>
        <div class="${escape(null_to_empty(hash === "log" ? "navselect" : "")) + " svelte-hickvj"}">Logarithmic Equations
        </div>
        <div class="${escape(null_to_empty(hash === "comb" ? "navselect" : "")) + " svelte-hickvj"}">Combinations of functions
        </div></div>
    <div class="${"main svelte-hickvj"}"><h2 id="${"trig"}" class="${"scroll svelte-hickvj"}">Trigonometric Functions</h2>
        <p>Trionometric functions are funcitons which describe the relationship
            of the angle of a <strong>right angled</strong> traingle and it&#39;s
            side lengths. These functions are periodic functinos meaning they
            repeat their values at regular intervals.<br>
            The most common trig functions are sine, cosine, and tangent with their
            respective reciprocals cosecant, secant, and cotangent. All of these
            functions have their inverse functions or arc functions that take a side
            length and produce an angle.<br></p>
        <table class="${"svelte-hickvj"}"><tr><td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `sin(x)\\ \\ \\ \\ x\\ \\in\\ \\R,\\ \\ \\ y\\ \\in\\ [-1, 1]`
	})}</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `arcsin(x)\\ \\ \\ \\ x\\ \\in\\ [-1, 1],\\ \\ \\ y\\ \\in\\
                        [-\\frac\\pi2, \\frac\\pi2]`
	})}</td></tr>
            <tr><td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `cos(x)\\ \\ \\ \\ x\\ \\in\\ \\R,\\ \\ \\ y\\ \\in\\ [-1, 1]`
	})}</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `arccos(x)\\ \\ \\ \\ x\\ \\in\\ [-1, 1],\\ \\ \\ y\\ \\in\\ [0, \\pi]`
	})}</td></tr>
            <tr><td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `tan(x)\\ \\ \\ \\ x\\ \\in\\ \\R\\ \\ except\\ \\ x = \\frac${escape("{")}\\pi${escape("}")}${escape("{")}2${escape("}")}
                        \\pm n\\pi,\\ \\ \\ y\\ \\in\\ [-\\infty, \\infty]
                    `
	})}</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `arctan(x)\\ \\ \\ \\ x\\ \\in\\ \\R,\\ \\ \\ y\\ \\in\\ [-\\frac\\pi2,
                        \\frac\\pi2]`
	})}</td></tr></table>

        <p>The general equation for sin is:
            <br>
            <br>
            ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `asin(b(x+c))` })}
            <br>
            <br>
            where a is amplitude, b is frequency/amplitude, and c is the phase shift
        </p>
        <h4 class="${"svelte-hickvj"}">Important Angles</h4>
        <table class="${"svelte-hickvj"}"><tr><th class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `\\theta` })}</th>
                <th class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `sin(\\theta)` })}</th>
                <th class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `cos(\\theta)` })}</th>
                <th class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `tan(\\theta)` })}</th>
                <th class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `csc(\\theta)` })}</th>
                <th class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `sec(\\theta)` })}</th>
                <th class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `cot(\\theta)` })}</th></tr>
            <tr><td class="${"svelte-hickvj"}">0</td>
                <td class="${"svelte-hickvj"}">0</td>
                <td class="${"svelte-hickvj"}">1</td>
                <td class="${"svelte-hickvj"}">0</td>
                <td class="${"svelte-hickvj"}">undefined</td>
                <td class="${"svelte-hickvj"}">1</td>
                <td class="${"svelte-hickvj"}">undefined</td></tr>
            <tr><td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `\\frac\\pi2` })}</td>
                <td class="${"svelte-hickvj"}">1</td>
                <td class="${"svelte-hickvj"}">0</td>
                <td class="${"svelte-hickvj"}">undefined</td>
                <td class="${"svelte-hickvj"}">0</td>
                <td class="${"svelte-hickvj"}">undefined</td>
                <td class="${"svelte-hickvj"}">1</td></tr>
            <tr><td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `\\pi` })}</td>
                <td class="${"svelte-hickvj"}">0</td>
                <td class="${"svelte-hickvj"}">-1</td>
                <td class="${"svelte-hickvj"}">0</td>
                <td class="${"svelte-hickvj"}">undefined</td>
                <td class="${"svelte-hickvj"}">-1</td>
                <td class="${"svelte-hickvj"}">undefined</td></tr>
            <tr><td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `\\frac\\pi6` })}</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `\\frac${escape("{")}1${escape("}")}${escape("{")}2${escape("}")}`
	})}</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `\\frac${escape("{")}\\sqrt3${escape("}")}${escape("{")}2${escape("}")}`
	})}</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `\\frac${escape("{")}1${escape("}")}${escape("{")}\\sqrt3${escape("}")}`
	})}</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `\\sqrt3` })}</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `\\frac${escape("{")}2${escape("}")}${escape("{")}\\sqrt3${escape("}")}`
	})}</td>
                <td class="${"svelte-hickvj"}">2</td></tr>
            <tr><td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `\\frac\\pi4` })}</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `\\frac${escape("{")}1${escape("}")}${escape("{")}\\sqrt2${escape("}")}`
	})}</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `\\frac${escape("{")}1${escape("}")}${escape("{")}\\sqrt2${escape("}")}`
	})}</td>
                <td class="${"svelte-hickvj"}">1</td>
                <td class="${"svelte-hickvj"}">1</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `\\sqrt2` })}</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `\\sqrt2` })}</td></tr>
            <tr><td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `\\frac\\pi3` })}</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `\\frac${escape("{")}\\sqrt3${escape("}")}${escape("{")}2${escape("}")}`
	})}</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `\\frac${escape("{")}1${escape("}")}${escape("{")}2${escape("}")}`
	})}</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `\\sqrt3` })}</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `\\frac${escape("{")}1${escape("}")}${escape("{")}\\sqrt3${escape("}")}`
	})}</td>
                <td class="${"svelte-hickvj"}">2</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `\\frac${escape("{")}2${escape("}")}${escape("{")}\\sqrt3${escape("}")}`
	})}</td></tr></table>
        <h4 class="${"svelte-hickvj"}">Graphs</h4>
        <div class="${"graphs svelte-hickvj"}">${validate_component(Graph, "Graph").$$render($$result, { equation: "y=\\sin(x)" }, {}, {})}
            ${validate_component(Graph, "Graph").$$render(
		$$result,
		{
			equation: "y=\\sin(2x)",
			color: colors.GREEN
		},
		{},
		{}
	)}
            ${validate_component(Graph, "Graph").$$render(
		$$result,
		{
			equation: "y=4\\sin(x)",
			color: colors.ORANGE
		},
		{},
		{}
	)}
            ${validate_component(Graph, "Graph").$$render(
		$$result,
		{
			equation: "y=2\\cos(3x)",
			color: colors.PURPLE
		},
		{},
		{}
	)}
            ${validate_component(Graph, "Graph").$$render($$result, { equation: "y=\\tan(x)" }, {}, {})}</div>
        <h4 class="${"svelte-hickvj"}">Unit Circle</h4>
        <p>The unit circle is a circle of radius 1. Because of this, it&#39;s easy
            to relate sin and cos to a line segment with an origin at (0, 0),
            with a length of 1, and angle ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `\\theta` })} since these
            functions have a range of [-1, 1]: the angle of the line is used as the
            input to these functions, sin yields the y value of the point that the
            line falls on while cos produces the x value. The tan function produces
            the length of the tangent line of the point on the circle from itself
            to the x axis.
        </p>
        ${validate_component(Graph, "Graph").$$render(
		$$result,
		{
			equation: [],
			bounds: {
				left: -1.2,
				right: 1.2,
				bottom: -1.2,
				top: 1.2
			},
			display: calc => {
				calc.setExpression({
					id: "a",
					latex: "a=0",
					sliderBounds: { min: "0", max: "2*\\pi", isPlaying: true }
				});

				calc.setExpression({ latex: "y^2+x^2=1", color: colors.RED });

				calc.setExpression({
					latex: "y=x\\tan(a) \\{{0<x<\\cos(a)\\}}",
					color: colors.GREEN
				});

				calc.setExpression({
					latex: "y=x\\tan(a) \\{{\\cos(a)<x<0\\}}",
					color: colors.GREEN
				});

				calc.setExpression({
					latex: "x=\\cos(a) \\{{0<y<\\sin(a)\\}}",
					color: colors.PURPLE
				});

				calc.setExpression({
					latex: "x=\\cos(a) \\{{\\sin(a)<y<0\\}}",
					color: colors.PURPLE
				});

				calc.setExpression({
					latex: "y=0 \\{{0<x<\\cos(a)\\}}",
					color: colors.ORANGE
				});

				calc.setExpression({
					latex: "y=0 \\{{\\cos(a)<x<0\\}}",
					color: colors.ORANGE
				});

				calc.setExpression({
					latex: "(\\cos(a), \\sin(a))",
					color: colors.BLACK
				});

				calc.setExpression({
					latex: "y=-\\cot(a)(x-\\cos(a))+\\sin(a) \\{{0<y<\\sin(a)\\}}",
					color: colors.BLACK
				});

				calc.setExpression({
					latex: "y=-\\cot(a)(x-\\cos(a))+\\sin(a) \\{{\\sin(a)<y<0\\}}",
					color: colors.BLACK
				});

				let state = calc.getState();
				state.expressions.list[0].slider.isPlaying = true;
				state.expressions.list[0].slider.loopMode = "LOOP_FORWARD";
				calc.setState(state);
			},
			width: 400,
			height: 400
		},
		{},
		{}
	)}
        <br>
        <p>As seen on the graph above, a triangle is formed out of the line
            described above, which is the hypotenuse, along with the lines
            created by the values of cos and sin. Hence, these trig functions
            can be used to solve for the side length and angles of a right
            triangle. For triangles with a hypotenuse greater than 1, we look
            back to the above definition of these functions and see that ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `sin(\\theta)=y` })} and ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `cos(\\theta)=x` })}. We also see that they must
            be in the range [-1, 1]. For triangles with hypotenuse greater than
            1, it is very likely that these side lengths will be greater than 1
            which would break this definition. To solve this we can normalize
            the x and y values by dividing them by the hypotenuse, gauranteein
            that they will be in the range [0, 1]. Therefore we can say ${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `sin(\\theta)=\\frac${escape("{")}y${escape("}")}${escape("{")}hyp${escape("}")}`
	})} and ${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `cos(\\theta)=\\frac${escape("{")}x${escape("}")}${escape("{")}hyp${escape("}")}`
	})}. Tangent can be defined as ${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `\\tan(\\theta) =\\frac${escape("{")}y${escape("}")}${escape("{")}x${escape("}")}`
	})} or
            ${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `\\tan(\\theta) =\\frac${escape("{")}sin(\\theta)${escape("}")}${escape("{")}cos(\\theta)${escape("}")}`
	})}.
        </p>
        <h4 class="${"svelte-hickvj"}">Examples</h4>
        <p>Given a triangle has an angle of ${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `\\frac${escape("{")}\\pi${escape("}")}6`
	})} with a hypotenuse of 8, find the opposite side of the angle:
            <br>
            ${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `\\sin(\\theta) = \\frac${escape("{")}opp${escape("}")}${escape("{")}hyp${escape("}")}`
	})}
            <br>
            ${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `hyp\\cdot\\sin(\\theta) = opp`
	})}
            <br>
            ${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `8\\cdot\\sin(\\frac${escape("{")}\\pi${escape("}")}6) = opp`
	})}
            <br>
            ${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `8\\cdot\\frac${escape("{")}\\sqrt3${escape("}")}2 = opp`
	})}
            <br>
            ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `4\\sqrt3 = opp` })}
            <br>
            <br>
            <br>
            A triangle has an opposite side length of 50 and an adjacent side length
            of 37. Find the angle ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `\\theta` })}:
            <br>
            ${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `\\tan(\\theta) = \\frac${escape("{")}opp${escape("}")}${escape("{")}adj${escape("}")}`
	})}
            <br>
            ${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `\\theta = \\arctan(\\frac${escape("{")}opp${escape("}")}${escape("{")}adj${escape("}")})`
	})}
            <br>
            ${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `\\theta = \\arctan(\\frac${escape("{")}50${escape("}")}${escape("{")}37${escape("}")})`
	})}
            <br>
            ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `\\theta = 0.9337` })}
            <br>
            <br>
            <br>
            <br></p>

        <h2 id="${"exp"}" class="${"scroll svelte-hickvj"}">Exponential Functions</h2>
        <p>Exponential functions are those that include a variable in the
            exponent. They generally take the form:
            <br>
            ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `f(x)=b^x` })}
            <br>
            Where b (the base) is a constant and ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `b&gt;0` })} and ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `b\\ne1` })}.
        </p>
        <h4 class="${"svelte-hickvj"}">Graphs</h4>
        <div class="${"graphs svelte-hickvj"}">${validate_component(Graph, "Graph").$$render($$result, { equation: "y=2^x" }, {}, {})}
            ${validate_component(Graph, "Graph").$$render(
		$$result,
		{
			equation: "y=(\\frac" + '{' + "1" + '}' + "2)^x",
			color: colors.GREEN
		},
		{},
		{}
	)}
            ${validate_component(Graph, "Graph").$$render($$result, { equation: "y=e^x", color: colors.ORANGE }, {}, {})}
            ${validate_component(Graph, "Graph").$$render($$result, { equation: "y=-3^x" }, {}, {})}
            ${validate_component(Graph, "Graph").$$render(
		$$result,
		{
			equation: "y=a^x",
			bounds: {
				left: -8.2,
				right: 8.2,
				bottom: -8.2,
				top: 8.2
			},
			color: colors.BLUE,
			display: calc => {
				calc.setExpression({
					id: "a",
					latex: "a=0.1",
					sliderBounds: { min: "0", max: "4" }
				});

				let state = calc.getState();
				state.expressions.list[1].slider.isPlaying = true;
				calc.setState(state);
			}
		},
		{},
		{}
	)}</div>
        <h4 class="${"svelte-hickvj"}">Exponent Rules</h4>
        <table class="${"svelte-hickvj"}"><tr><td class="${"svelte-hickvj"}">Product Rule</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `b^x \\cdot b^y=b^${escape("{")}x+y${escape("}")}`
	})}</td></tr>
            <tr><td class="${"svelte-hickvj"}">Quotient Rule</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `\\frac${escape("{")}b^x${escape("}")}${escape("{")}b^y${escape("}")}=b^${escape("{")}x-y${escape("}")}`
	})}</td></tr>
            <tr><td class="${"svelte-hickvj"}">Power Rule</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `(b^x)^y=b^${escape("{")}xy${escape("}")}`
	})}</td></tr>
            <tr><td class="${"svelte-hickvj"}">Power of Product Rule</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `(ab)^x=a^xb^x` })}</td></tr>
            <tr><td class="${"svelte-hickvj"}">Power of Quotient Rule</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `(\\frac a b)^x=(\\frac${escape("{")}a^x${escape("}")}
                        ${escape("{")}b^x${escape("}")})`
	})}</td></tr>
            <tr><td class="${"svelte-hickvj"}">Exponent of 0</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `b^0=1` })}</td></tr>
            <tr><td class="${"svelte-hickvj"}">Negative Exponent</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `b^${escape("{")}-x${escape("}")}=\\frac 1 ${escape("{")}b^x${escape("}")}`
	})}</td></tr>
            <tr><td class="${"svelte-hickvj"}">Fractional Exponent</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `b^${escape("{")}\\frac x y${escape("}")}=\\sqrt[y]b^x`
	})}</td></tr></table>

        <br>
        <br>
        <h2 id="${"log"}" class="${"scroll svelte-hickvj"}">Logarithmic Functions</h2>
        <p>Logarithmic functions are the inverse functions of exponential
            functions. Therefore, if ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `y=b^x` })}, then ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `x=\\log_a y` })} where ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `y&gt;0` })}. The logarithm with base ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `e` })} has a special name of natural log: ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `y=\\ln x` })}</p>
        <h4 class="${"svelte-hickvj"}">Graphs</h4>
        <div class="${"graphs svelte-hickvj"}">${validate_component(Graph, "Graph").$$render(
		$$result,
		{
			equation: "y=\\log_" + '{' + "10" + '}' + "x",
			bounds: { left: -2, right: 6, bottom: -4, top: 4 }
		},
		{},
		{}
	)}
            ${validate_component(Graph, "Graph").$$render(
		$$result,
		{
			equation: "y=\\ln x",
			bounds: { left: -2, right: 6, bottom: -4, top: 4 },
			color: colors.GREEN
		},
		{},
		{}
	)}

            ${validate_component(Graph, "Graph").$$render(
		$$result,
		{
			equation: "y=\\log_" + '{' + "a" + '}' + "x",
			bounds: { left: -2, right: 6, bottom: -4, top: 4 },
			color: colors.BLUE,
			display: calc => {
				calc.setExpression({
					id: "a",
					latex: "a=0.1",
					sliderBounds: { min: "0.1", max: "4" }
				});

				let state = calc.getState();
				state.expressions.list[1].slider.isPlaying = true;
				calc.setState(state);
			}
		},
		{},
		{}
	)}</div>
        <h4 class="${"svelte-hickvj"}">Log Rules</h4>
        <table class="${"svelte-hickvj"}"><tr><td class="${"svelte-hickvj"}">Product Rule</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `\\log_a xy = \\log_a x + \\log_a y`
	})}</td></tr>
            <tr><td class="${"svelte-hickvj"}">Quotient Rule</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `\\log_a\\frac${escape("{")}x${escape("}")}${escape("{")}y${escape("}")}=\\log_a x - log_a y`
	})}</td></tr>
            <tr><td class="${"svelte-hickvj"}">Power Rule</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `\\log_a x^b = b\\log_a x`
	})}</td></tr>
            <tr><td class="${"svelte-hickvj"}">Change of Base Rule</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `\\log_a x = \\frac${escape("{")}\\log_b x${escape("}")}${escape("{")}log_b a${escape("}")}`
	})}</td></tr>
            <tr><td class="${"svelte-hickvj"}">Equality Rule</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `If \\log_a x = log_a y\\ then\\ x=y`
	})}</td></tr>
            <tr><td class="${"svelte-hickvj"}">Log of 1</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `\\log_a 1 = 0` })}</td></tr></table>
        <br>
        <br>
        <h2 id="${"comb"}" class="${"scroll svelte-hickvj"}">Combinations of Functions</h2>
        <p>Functions can be added, subtracted, multiplied, and divided much
            like regular numbers. The basic forms of this for functions ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `f(x)` })} and ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `g(x)` })} are:
        </p>
        <br>
        <table class="${"svelte-hickvj"}"><tr><td class="${"svelte-hickvj"}">Addition</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `(f+g)(x) = f(x) + g(x)` })}</td></tr>
            <tr><td class="${"svelte-hickvj"}">Subtraction</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `(f-g)(x) = f(x) - g(x)` })}</td></tr>
            <tr><td class="${"svelte-hickvj"}">Multiplication</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `(f\\cdot g)(x) = f(x) \\cdot g(x)`
	})}</td></tr>
            <tr><td class="${"svelte-hickvj"}">Division</td>
                <td class="${"svelte-hickvj"}">${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `(\\frac f g)(x) = \\frac${escape("{")}f(x)${escape("}")}
                        ${escape("{")}g(x)${escape("}")}`
	})}
                    where ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `g(x)\\ne0` })}</td></tr></table>
        <p>The domain of the new combined function includes all the points for
            which the all the functions used to compose it are defined at that
            point.
        </p>
        <h4 class="${"svelte-hickvj"}">Composition</h4>
        <p>Composition is slightly different as it is the process of plugging
            one function into another:
            <br>
            ${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `(f\\circ g)(x) = f(g(x))`
	})}
            <br>
            <br>
            Here f is said to be composed of g of x. Functions are evaluated from
            the inside out and is not cumulative.
            <br>
            The domain of a composed function is values of x that are in the domain
            of the inner function(s) that are in the domain of the outer.
        </p>
        <h4 class="${"svelte-hickvj"}">Examples</h4>
        Using ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `f(x) = -5x-3` })} and ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `g(x)=x^2+8x+1` })}:
        <br>
        <ul class="${"svelte-hickvj"}"><li>Adding:
                <br>
                ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `(f+g)(x) = f(x) + g(x)` })}
                <br>
                ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `=(-5x-3) + (x^2+8x+1)` })}
                <br>
                ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `=-5x-3+x^2+8x+1` })}
                <br>
                ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `=x^2+3x-2` })}
                <br>
                ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `=x\\in\\R` })}</li>
            <br>
            <li>Subtracting:
                <br>
                ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `(f-g)(x) = f(x) - g(x)` })}
                <br>
                ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `=(-5x-3) - (x^2+8x+1)` })}
                <br>
                ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `=-5x-3-x^2-8x-1` })}
                <br>
                ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `=-x^2-13x-4` })}
                <br>
                ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `=x\\in\\R` })}</li>
            <br>
            <li>Multiplying:
                <br>
                ${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `(f\\cdot g)(x) = f(x) \\cdot g(x)`
	})}
                <br>
                ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `=(-5x-3)(x^2+8x+1)` })}
                <br>
                ${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `=-5x^3-40x^2-5x-3x^2-24x-3`
	})}
                <br>
                ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `=-5x^3-43x^2-29x-3` })}
                <br>
                ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `=x\\in\\R` })}</li>
            <br>
            <li>Dividing:
                <br>
                ${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `(\\frac f g)(x) = \\frac${escape("{")}f(x)${escape("}")}
                    ${escape("{")}g(x)${escape("}")}`
	})}
                <br>
                ${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `=\\frac${escape("{")}(-5x-3)${escape("}")}
                    ${escape("{")}(x^2+8x+1)${escape("}")}`
	})}
                <br>
                ${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `=x\\in\\R\\ except\\ x=\\pm\\sqrt${escape("{")}15${escape("}")}-4`
	})}</li>
            <br>
            <li>Composing:
                <br>
                ${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `(f\\circ g)(x) = f(g(x))`
	})}
                <br>
                ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `=-5(x^2+8x+1)-3` })}
                <br>
                ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `=-5x^2-40x-8` })}
                <br>
                ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `=x\\in\\R` })}</li></ul>
        Compose ${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `f(x)=\\sqrt${escape("{")}-x-10${escape("}")}`
	})} and ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `g(x) = x^2+4x` })}:
        <br>
        ${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `(f\\circ g)(x) = f(g(x))`
	})}
        <br>
        ${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `\\sqrt${escape("{")}-(x^2+4x)-10${escape("}")}`
	})}
        <br>
        ${validate_component(Equation, "Equation").$$render($$result, {}, {}, {
		default: () => `\\sqrt${escape("{")}-x^2-4x-10${escape("}")}`
	})}
        <br>
        <br>
        No values of x satisfy this equation because no values of ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `g(x)` })} are defined in ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `f` })} i.e. ${validate_component(Equation, "Equation").$$render($$result, {}, {}, { default: () => `g(x)` })} will
        always produce a negative number for which the square root is not defined
        for in the real plane.
        <br>
        <br>
        <br>
        <br>
        <br>
        <br></div>
</div>`;
});

/* src\Register.svelte generated by Svelte v3.45.0 */

const Register = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	return `<div><h1>Register</h1></div>`;
});

var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

function createCommonjsModule(fn) {
  var module = { exports: {} };
	return fn(module, module.exports), module.exports;
}

var decimal = createCommonjsModule(function (module) {
 (function (globalScope) {


    /*
     *  decimal.js v10.3.1
     *  An arbitrary-precision Decimal type for JavaScript.
     *  https://github.com/MikeMcl/decimal.js
     *  Copyright (c) 2021 Michael Mclaughlin <M8ch88l@gmail.com>
     *  MIT Licence
     */


    // -----------------------------------  EDITABLE DEFAULTS  ------------------------------------ //


    // The maximum exponent magnitude.
    // The limit on the value of `toExpNeg`, `toExpPos`, `minE` and `maxE`.
    var EXP_LIMIT = 9e15,                      // 0 to 9e15

        // The limit on the value of `precision`, and on the value of the first argument to
        // `toDecimalPlaces`, `toExponential`, `toFixed`, `toPrecision` and `toSignificantDigits`.
        MAX_DIGITS = 1e9,                        // 0 to 1e9

        // Base conversion alphabet.
        NUMERALS = '0123456789abcdef',

        // The natural logarithm of 10 (1025 digits).
        LN10 = '2.3025850929940456840179914546843642076011014886287729760333279009675726096773524802359972050895982983419677840422862486334095254650828067566662873690987816894829072083255546808437998948262331985283935053089653777326288461633662222876982198867465436674744042432743651550489343149393914796194044002221051017141748003688084012647080685567743216228355220114804663715659121373450747856947683463616792101806445070648000277502684916746550586856935673420670581136429224554405758925724208241314695689016758940256776311356919292033376587141660230105703089634572075440370847469940168269282808481184289314848524948644871927809676271275775397027668605952496716674183485704422507197965004714951050492214776567636938662976979522110718264549734772662425709429322582798502585509785265383207606726317164309505995087807523710333101197857547331541421808427543863591778117054309827482385045648019095610299291824318237525357709750539565187697510374970888692180205189339507238539205144634197265287286965110862571492198849978748873771345686209167058',

        // Pi (1025 digits).
        PI = '3.1415926535897932384626433832795028841971693993751058209749445923078164062862089986280348253421170679821480865132823066470938446095505822317253594081284811174502841027019385211055596446229489549303819644288109756659334461284756482337867831652712019091456485669234603486104543266482133936072602491412737245870066063155881748815209209628292540917153643678925903600113305305488204665213841469519415116094330572703657595919530921861173819326117931051185480744623799627495673518857527248912279381830119491298336733624406566430860213949463952247371907021798609437027705392171762931767523846748184676694051320005681271452635608277857713427577896091736371787214684409012249534301465495853710507922796892589235420199561121290219608640344181598136297747713099605187072113499999983729780499510597317328160963185950244594553469083026425223082533446850352619311881710100031378387528865875332083814206171776691473035982534904287554687311595628638823537875937519577818577805321712268066130019278766111959092164201989380952572010654858632789',


        // The initial configuration properties of the Decimal constructor.
        DEFAULTS = {

            // These values must be integers within the stated ranges (inclusive).
            // Most of these values can be changed at run-time using the `Decimal.config` method.

            // The maximum number of significant digits of the result of a calculation or base conversion.
            // E.g. `Decimal.config({ precision: 20 });`
            precision: 20,                         // 1 to MAX_DIGITS

            // The rounding mode used when rounding to `precision`.
            //
            // ROUND_UP         0 Away from zero.
            // ROUND_DOWN       1 Towards zero.
            // ROUND_CEIL       2 Towards +Infinity.
            // ROUND_FLOOR      3 Towards -Infinity.
            // ROUND_HALF_UP    4 Towards nearest neighbour. If equidistant, up.
            // ROUND_HALF_DOWN  5 Towards nearest neighbour. If equidistant, down.
            // ROUND_HALF_EVEN  6 Towards nearest neighbour. If equidistant, towards even neighbour.
            // ROUND_HALF_CEIL  7 Towards nearest neighbour. If equidistant, towards +Infinity.
            // ROUND_HALF_FLOOR 8 Towards nearest neighbour. If equidistant, towards -Infinity.
            //
            // E.g.
            // `Decimal.rounding = 4;`
            // `Decimal.rounding = Decimal.ROUND_HALF_UP;`
            rounding: 4,                           // 0 to 8

            // The modulo mode used when calculating the modulus: a mod n.
            // The quotient (q = a / n) is calculated according to the corresponding rounding mode.
            // The remainder (r) is calculated as: r = a - n * q.
            //
            // UP         0 The remainder is positive if the dividend is negative, else is negative.
            // DOWN       1 The remainder has the same sign as the dividend (JavaScript %).
            // FLOOR      3 The remainder has the same sign as the divisor (Python %).
            // HALF_EVEN  6 The IEEE 754 remainder function.
            // EUCLID     9 Euclidian division. q = sign(n) * floor(a / abs(n)). Always positive.
            //
            // Truncated division (1), floored division (3), the IEEE 754 remainder (6), and Euclidian
            // division (9) are commonly used for the modulus operation. The other rounding modes can also
            // be used, but they may not give useful results.
            modulo: 1,                             // 0 to 9

            // The exponent value at and beneath which `toString` returns exponential notation.
            // JavaScript numbers: -7
            toExpNeg: -7,                          // 0 to -EXP_LIMIT

            // The exponent value at and above which `toString` returns exponential notation.
            // JavaScript numbers: 21
            toExpPos: 21,                         // 0 to EXP_LIMIT

            // The minimum exponent value, beneath which underflow to zero occurs.
            // JavaScript numbers: -324  (5e-324)
            minE: -EXP_LIMIT,                      // -1 to -EXP_LIMIT

            // The maximum exponent value, above which overflow to Infinity occurs.
            // JavaScript numbers: 308  (1.7976931348623157e+308)
            maxE: EXP_LIMIT,                       // 1 to EXP_LIMIT

            // Whether to use cryptographically-secure random number generation, if available.
            crypto: false                          // true/false
        },


        // ----------------------------------- END OF EDITABLE DEFAULTS ------------------------------- //


        Decimal, inexact, noConflict, quadrant,
        external = true,

        decimalError = '[DecimalError] ',
        invalidArgument = decimalError + 'Invalid argument: ',
        precisionLimitExceeded = decimalError + 'Precision limit exceeded',
        cryptoUnavailable = decimalError + 'crypto unavailable',
        tag = '[object Decimal]',

        mathfloor = Math.floor,
        mathpow = Math.pow,

        isBinary = /^0b([01]+(\.[01]*)?|\.[01]+)(p[+-]?\d+)?$/i,
        isHex = /^0x([0-9a-f]+(\.[0-9a-f]*)?|\.[0-9a-f]+)(p[+-]?\d+)?$/i,
        isOctal = /^0o([0-7]+(\.[0-7]*)?|\.[0-7]+)(p[+-]?\d+)?$/i,
        isDecimal = /^(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i,

        BASE = 1e7,
        LOG_BASE = 7,
        MAX_SAFE_INTEGER = 9007199254740991,

        LN10_PRECISION = LN10.length - 1,
        PI_PRECISION = PI.length - 1,

        // Decimal.prototype object
        P = { toStringTag: tag };


    // Decimal prototype methods


    /*
     *  absoluteValue             abs
     *  ceil
     *  clampedTo                 clamp
     *  comparedTo                cmp
     *  cosine                    cos
     *  cubeRoot                  cbrt
     *  decimalPlaces             dp
     *  dividedBy                 div
     *  dividedToIntegerBy        divToInt
     *  equals                    eq
     *  floor
     *  greaterThan               gt
     *  greaterThanOrEqualTo      gte
     *  hyperbolicCosine          cosh
     *  hyperbolicSine            sinh
     *  hyperbolicTangent         tanh
     *  inverseCosine             acos
     *  inverseHyperbolicCosine   acosh
     *  inverseHyperbolicSine     asinh
     *  inverseHyperbolicTangent  atanh
     *  inverseSine               asin
     *  inverseTangent            atan
     *  isFinite
     *  isInteger                 isInt
     *  isNaN
     *  isNegative                isNeg
     *  isPositive                isPos
     *  isZero
     *  lessThan                  lt
     *  lessThanOrEqualTo         lte
     *  logarithm                 log
     *  [maximum]                 [max]
     *  [minimum]                 [min]
     *  minus                     sub
     *  modulo                    mod
     *  naturalExponential        exp
     *  naturalLogarithm          ln
     *  negated                   neg
     *  plus                      add
     *  precision                 sd
     *  round
     *  sine                      sin
     *  squareRoot                sqrt
     *  tangent                   tan
     *  times                     mul
     *  toBinary
     *  toDecimalPlaces           toDP
     *  toExponential
     *  toFixed
     *  toFraction
     *  toHexadecimal             toHex
     *  toNearest
     *  toNumber
     *  toOctal
     *  toPower                   pow
     *  toPrecision
     *  toSignificantDigits       toSD
     *  toString
     *  truncated                 trunc
     *  valueOf                   toJSON
     */


    /*
     * Return a new Decimal whose value is the absolute value of this Decimal.
     *
     */
    P.absoluteValue = P.abs = function () {
        var x = new this.constructor(this);
        if (x.s < 0) x.s = 1;
        return finalise(x)
    };


    /*
     * Return a new Decimal whose value is the value of this Decimal rounded to a whole number in the
     * direction of positive Infinity.
     *
     */
    P.ceil = function () {
        return finalise(new this.constructor(this), this.e + 1, 2)
    };


    /*
     * Return a new Decimal whose value is the value of this Decimal clamped to the range
     * delineated by `min` and `max`.
     *
     * min {number|string|Decimal}
     * max {number|string|Decimal}
     *
     */
    P.clampedTo = P.clamp = function (min, max) {
        var k,
            x = this,
            Ctor = x.constructor;
        min = new Ctor(min);
        max = new Ctor(max);
        if (!min.s || !max.s) return new Ctor(NaN)
        if (min.gt(max)) throw Error(invalidArgument + max)
        k = x.cmp(min);
        return k < 0 ? min : x.cmp(max) > 0 ? max : new Ctor(x)
    };


    /*
     * Return
     *   1    if the value of this Decimal is greater than the value of `y`,
     *  -1    if the value of this Decimal is less than the value of `y`,
     *   0    if they have the same value,
     *   NaN  if the value of either Decimal is NaN.
     *
     */
    P.comparedTo = P.cmp = function (y) {
        var i, j, xdL, ydL,
            x = this,
            xd = x.d,
            yd = (y = new x.constructor(y)).d,
            xs = x.s,
            ys = y.s;

        // Either NaN or ±Infinity?
        if (!xd || !yd) {
            return !xs || !ys ? NaN : xs !== ys ? xs : xd === yd ? 0 : !xd ^ xs < 0 ? 1 : -1
        }

        // Either zero?
        if (!xd[0] || !yd[0]) return xd[0] ? xs : yd[0] ? -ys : 0

        // Signs differ?
        if (xs !== ys) return xs

        // Compare exponents.
        if (x.e !== y.e) return x.e > y.e ^ xs < 0 ? 1 : -1

        xdL = xd.length;
        ydL = yd.length;

        // Compare digit by digit.
        for (i = 0, j = xdL < ydL ? xdL : ydL; i < j; ++i) {
            if (xd[i] !== yd[i]) return xd[i] > yd[i] ^ xs < 0 ? 1 : -1
        }

        // Compare lengths.
        return xdL === ydL ? 0 : xdL > ydL ^ xs < 0 ? 1 : -1
    };


    /*
     * Return a new Decimal whose value is the cosine of the value in radians of this Decimal.
     *
     * Domain: [-Infinity, Infinity]
     * Range: [-1, 1]
     *
     * cos(0)         = 1
     * cos(-0)        = 1
     * cos(Infinity)  = NaN
     * cos(-Infinity) = NaN
     * cos(NaN)       = NaN
     *
     */
    P.cosine = P.cos = function () {
        var pr, rm,
            x = this,
            Ctor = x.constructor;

        if (!x.d) return new Ctor(NaN)

        // cos(0) = cos(-0) = 1
        if (!x.d[0]) return new Ctor(1)

        pr = Ctor.precision;
        rm = Ctor.rounding;
        Ctor.precision = pr + Math.max(x.e, x.sd()) + LOG_BASE;
        Ctor.rounding = 1;

        x = cosine(Ctor, toLessThanHalfPi(Ctor, x));

        Ctor.precision = pr;
        Ctor.rounding = rm;

        return finalise(quadrant == 2 || quadrant == 3 ? x.neg() : x, pr, rm, true)
    };


    /*
     *
     * Return a new Decimal whose value is the cube root of the value of this Decimal, rounded to
     * `precision` significant digits using rounding mode `rounding`.
     *
     *  cbrt(0)  =  0
     *  cbrt(-0) = -0
     *  cbrt(1)  =  1
     *  cbrt(-1) = -1
     *  cbrt(N)  =  N
     *  cbrt(-I) = -I
     *  cbrt(I)  =  I
     *
     * Math.cbrt(x) = (x < 0 ? -Math.pow(-x, 1/3) : Math.pow(x, 1/3))
     *
     */
    P.cubeRoot = P.cbrt = function () {
        var e, m, n, r, rep, s, sd, t, t3, t3plusx,
            x = this,
            Ctor = x.constructor;

        if (!x.isFinite() || x.isZero()) return new Ctor(x)
        external = false;

        // Initial estimate.
        s = x.s * mathpow(x.s * x, 1 / 3);

        // Math.cbrt underflow/overflow?
        // Pass x to Math.pow as integer, then adjust the exponent of the result.
        if (!s || Math.abs(s) == 1 / 0) {
            n = digitsToString(x.d);
            e = x.e;

            // Adjust n exponent so it is a multiple of 3 away from x exponent.
            if (s = (e - n.length + 1) % 3) n += (s == 1 || s == -2 ? '0' : '00');
            s = mathpow(n, 1 / 3);

            // Rarely, e may be one less than the result exponent value.
            e = mathfloor((e + 1) / 3) - (e % 3 == (e < 0 ? -1 : 2));

            if (s == 1 / 0) {
                n = '5e' + e;
            } else {
                n = s.toExponential();
                n = n.slice(0, n.indexOf('e') + 1) + e;
            }

            r = new Ctor(n);
            r.s = x.s;
        } else {
            r = new Ctor(s.toString());
        }

        sd = (e = Ctor.precision) + 3;

        // Halley's method.
        // TODO? Compare Newton's method.
        for (; ;) {
            t = r;
            t3 = t.times(t).times(t);
            t3plusx = t3.plus(x);
            r = divide(t3plusx.plus(x).times(t), t3plusx.plus(t3), sd + 2, 1);

            // TODO? Replace with for-loop and checkRoundingDigits.
            if (digitsToString(t.d).slice(0, sd) === (n = digitsToString(r.d)).slice(0, sd)) {
                n = n.slice(sd - 3, sd + 1);

                // The 4th rounding digit may be in error by -1 so if the 4 rounding digits are 9999 or 4999
                // , i.e. approaching a rounding boundary, continue the iteration.
                if (n == '9999' || !rep && n == '4999') {

                    // On the first iteration only, check to see if rounding up gives the exact result as the
                    // nines may infinitely repeat.
                    if (!rep) {
                        finalise(t, e + 1, 0);

                        if (t.times(t).times(t).eq(x)) {
                            r = t;
                            break
                        }
                    }

                    sd += 4;
                    rep = 1;
                } else {

                    // If the rounding digits are null, 0{0,4} or 50{0,3}, check for an exact result.
                    // If not, then there are further digits and m will be truthy.
                    if (!+n || !+n.slice(1) && n.charAt(0) == '5') {

                        // Truncate to the first rounding digit.
                        finalise(r, e + 1, 1);
                        m = !r.times(r).times(r).eq(x);
                    }

                    break
                }
            }
        }

        external = true;

        return finalise(r, e, Ctor.rounding, m)
    };


    /*
     * Return the number of decimal places of the value of this Decimal.
     *
     */
    P.decimalPlaces = P.dp = function () {
        var w,
            d = this.d,
            n = NaN;

        if (d) {
            w = d.length - 1;
            n = (w - mathfloor(this.e / LOG_BASE)) * LOG_BASE;

            // Subtract the number of trailing zeros of the last word.
            w = d[w];
            if (w) for (; w % 10 == 0; w /= 10) n--;
            if (n < 0) n = 0;
        }

        return n
    };


    /*
     *  n / 0 = I
     *  n / N = N
     *  n / I = 0
     *  0 / n = 0
     *  0 / 0 = N
     *  0 / N = N
     *  0 / I = 0
     *  N / n = N
     *  N / 0 = N
     *  N / N = N
     *  N / I = N
     *  I / n = I
     *  I / 0 = I
     *  I / N = N
     *  I / I = N
     *
     * Return a new Decimal whose value is the value of this Decimal divided by `y`, rounded to
     * `precision` significant digits using rounding mode `rounding`.
     *
     */
    P.dividedBy = P.div = function (y) {
        return divide(this, new this.constructor(y))
    };


    /*
     * Return a new Decimal whose value is the integer part of dividing the value of this Decimal
     * by the value of `y`, rounded to `precision` significant digits using rounding mode `rounding`.
     *
     */
    P.dividedToIntegerBy = P.divToInt = function (y) {
        var x = this,
            Ctor = x.constructor;
        return finalise(divide(x, new Ctor(y), 0, 1, 1), Ctor.precision, Ctor.rounding)
    };


    /*
     * Return true if the value of this Decimal is equal to the value of `y`, otherwise return false.
     *
     */
    P.equals = P.eq = function (y) {
        return this.cmp(y) === 0
    };


    /*
     * Return a new Decimal whose value is the value of this Decimal rounded to a whole number in the
     * direction of negative Infinity.
     *
     */
    P.floor = function () {
        return finalise(new this.constructor(this), this.e + 1, 3)
    };


    /*
     * Return true if the value of this Decimal is greater than the value of `y`, otherwise return
     * false.
     *
     */
    P.greaterThan = P.gt = function (y) {
        return this.cmp(y) > 0
    };


    /*
     * Return true if the value of this Decimal is greater than or equal to the value of `y`,
     * otherwise return false.
     *
     */
    P.greaterThanOrEqualTo = P.gte = function (y) {
        var k = this.cmp(y);
        return k == 1 || k === 0
    };


    /*
     * Return a new Decimal whose value is the hyperbolic cosine of the value in radians of this
     * Decimal.
     *
     * Domain: [-Infinity, Infinity]
     * Range: [1, Infinity]
     *
     * cosh(x) = 1 + x^2/2! + x^4/4! + x^6/6! + ...
     *
     * cosh(0)         = 1
     * cosh(-0)        = 1
     * cosh(Infinity)  = Infinity
     * cosh(-Infinity) = Infinity
     * cosh(NaN)       = NaN
     *
     *  x        time taken (ms)   result
     * 1000      9                 9.8503555700852349694e+433
     * 10000     25                4.4034091128314607936e+4342
     * 100000    171               1.4033316802130615897e+43429
     * 1000000   3817              1.5166076984010437725e+434294
     * 10000000  abandoned after 2 minute wait
     *
     * TODO? Compare performance of cosh(x) = 0.5 * (exp(x) + exp(-x))
     *
     */
    P.hyperbolicCosine = P.cosh = function () {
        var k, n, pr, rm, len,
            x = this,
            Ctor = x.constructor,
            one = new Ctor(1);

        if (!x.isFinite()) return new Ctor(x.s ? 1 / 0 : NaN)
        if (x.isZero()) return one

        pr = Ctor.precision;
        rm = Ctor.rounding;
        Ctor.precision = pr + Math.max(x.e, x.sd()) + 4;
        Ctor.rounding = 1;
        len = x.d.length;

        // Argument reduction: cos(4x) = 1 - 8cos^2(x) + 8cos^4(x) + 1
        // i.e. cos(x) = 1 - cos^2(x/4)(8 - 8cos^2(x/4))

        // Estimate the optimum number of times to use the argument reduction.
        // TODO? Estimation reused from cosine() and may not be optimal here.
        if (len < 32) {
            k = Math.ceil(len / 3);
            n = (1 / tinyPow(4, k)).toString();
        } else {
            k = 16;
            n = '2.3283064365386962890625e-10';
        }

        x = taylorSeries(Ctor, 1, x.times(n), new Ctor(1), true);

        // Reverse argument reduction
        var cosh2_x,
            i = k,
            d8 = new Ctor(8);
        for (; i--;) {
            cosh2_x = x.times(x);
            x = one.minus(cosh2_x.times(d8.minus(cosh2_x.times(d8))));
        }

        return finalise(x, Ctor.precision = pr, Ctor.rounding = rm, true)
    };


    /*
     * Return a new Decimal whose value is the hyperbolic sine of the value in radians of this
     * Decimal.
     *
     * Domain: [-Infinity, Infinity]
     * Range: [-Infinity, Infinity]
     *
     * sinh(x) = x + x^3/3! + x^5/5! + x^7/7! + ...
     *
     * sinh(0)         = 0
     * sinh(-0)        = -0
     * sinh(Infinity)  = Infinity
     * sinh(-Infinity) = -Infinity
     * sinh(NaN)       = NaN
     *
     * x        time taken (ms)
     * 10       2 ms
     * 100      5 ms
     * 1000     14 ms
     * 10000    82 ms
     * 100000   886 ms            1.4033316802130615897e+43429
     * 200000   2613 ms
     * 300000   5407 ms
     * 400000   8824 ms
     * 500000   13026 ms          8.7080643612718084129e+217146
     * 1000000  48543 ms
     *
     * TODO? Compare performance of sinh(x) = 0.5 * (exp(x) - exp(-x))
     *
     */
    P.hyperbolicSine = P.sinh = function () {
        var k, pr, rm, len,
            x = this,
            Ctor = x.constructor;

        if (!x.isFinite() || x.isZero()) return new Ctor(x)

        pr = Ctor.precision;
        rm = Ctor.rounding;
        Ctor.precision = pr + Math.max(x.e, x.sd()) + 4;
        Ctor.rounding = 1;
        len = x.d.length;

        if (len < 3) {
            x = taylorSeries(Ctor, 2, x, x, true);
        } else {

            // Alternative argument reduction: sinh(3x) = sinh(x)(3 + 4sinh^2(x))
            // i.e. sinh(x) = sinh(x/3)(3 + 4sinh^2(x/3))
            // 3 multiplications and 1 addition

            // Argument reduction: sinh(5x) = sinh(x)(5 + sinh^2(x)(20 + 16sinh^2(x)))
            // i.e. sinh(x) = sinh(x/5)(5 + sinh^2(x/5)(20 + 16sinh^2(x/5)))
            // 4 multiplications and 2 additions

            // Estimate the optimum number of times to use the argument reduction.
            k = 1.4 * Math.sqrt(len);
            k = k > 16 ? 16 : k | 0;

            x = x.times(1 / tinyPow(5, k));
            x = taylorSeries(Ctor, 2, x, x, true);

            // Reverse argument reduction
            var sinh2_x,
                d5 = new Ctor(5),
                d16 = new Ctor(16),
                d20 = new Ctor(20);
            for (; k--;) {
                sinh2_x = x.times(x);
                x = x.times(d5.plus(sinh2_x.times(d16.times(sinh2_x).plus(d20))));
            }
        }

        Ctor.precision = pr;
        Ctor.rounding = rm;

        return finalise(x, pr, rm, true)
    };


    /*
     * Return a new Decimal whose value is the hyperbolic tangent of the value in radians of this
     * Decimal.
     *
     * Domain: [-Infinity, Infinity]
     * Range: [-1, 1]
     *
     * tanh(x) = sinh(x) / cosh(x)
     *
     * tanh(0)         = 0
     * tanh(-0)        = -0
     * tanh(Infinity)  = 1
     * tanh(-Infinity) = -1
     * tanh(NaN)       = NaN
     *
     */
    P.hyperbolicTangent = P.tanh = function () {
        var pr, rm,
            x = this,
            Ctor = x.constructor;

        if (!x.isFinite()) return new Ctor(x.s)
        if (x.isZero()) return new Ctor(x)

        pr = Ctor.precision;
        rm = Ctor.rounding;
        Ctor.precision = pr + 7;
        Ctor.rounding = 1;

        return divide(x.sinh(), x.cosh(), Ctor.precision = pr, Ctor.rounding = rm)
    };


    /*
     * Return a new Decimal whose value is the arccosine (inverse cosine) in radians of the value of
     * this Decimal.
     *
     * Domain: [-1, 1]
     * Range: [0, pi]
     *
     * acos(x) = pi/2 - asin(x)
     *
     * acos(0)       = pi/2
     * acos(-0)      = pi/2
     * acos(1)       = 0
     * acos(-1)      = pi
     * acos(1/2)     = pi/3
     * acos(-1/2)    = 2*pi/3
     * acos(|x| > 1) = NaN
     * acos(NaN)     = NaN
     *
     */
    P.inverseCosine = P.acos = function () {
        var halfPi,
            x = this,
            Ctor = x.constructor,
            k = x.abs().cmp(1),
            pr = Ctor.precision,
            rm = Ctor.rounding;

        if (k !== -1) {
            return k === 0
                // |x| is 1
                ? x.isNeg() ? getPi(Ctor, pr, rm) : new Ctor(0)
                // |x| > 1 or x is NaN
                : new Ctor(NaN)
        }

        if (x.isZero()) return getPi(Ctor, pr + 4, rm).times(0.5)

        // TODO? Special case acos(0.5) = pi/3 and acos(-0.5) = 2*pi/3

        Ctor.precision = pr + 6;
        Ctor.rounding = 1;

        x = x.asin();
        halfPi = getPi(Ctor, pr + 4, rm).times(0.5);

        Ctor.precision = pr;
        Ctor.rounding = rm;

        return halfPi.minus(x)
    };


    /*
     * Return a new Decimal whose value is the inverse of the hyperbolic cosine in radians of the
     * value of this Decimal.
     *
     * Domain: [1, Infinity]
     * Range: [0, Infinity]
     *
     * acosh(x) = ln(x + sqrt(x^2 - 1))
     *
     * acosh(x < 1)     = NaN
     * acosh(NaN)       = NaN
     * acosh(Infinity)  = Infinity
     * acosh(-Infinity) = NaN
     * acosh(0)         = NaN
     * acosh(-0)        = NaN
     * acosh(1)         = 0
     * acosh(-1)        = NaN
     *
     */
    P.inverseHyperbolicCosine = P.acosh = function () {
        var pr, rm,
            x = this,
            Ctor = x.constructor;

        if (x.lte(1)) return new Ctor(x.eq(1) ? 0 : NaN)
        if (!x.isFinite()) return new Ctor(x)

        pr = Ctor.precision;
        rm = Ctor.rounding;
        Ctor.precision = pr + Math.max(Math.abs(x.e), x.sd()) + 4;
        Ctor.rounding = 1;
        external = false;

        x = x.times(x).minus(1).sqrt().plus(x);

        external = true;
        Ctor.precision = pr;
        Ctor.rounding = rm;

        return x.ln()
    };


    /*
     * Return a new Decimal whose value is the inverse of the hyperbolic sine in radians of the value
     * of this Decimal.
     *
     * Domain: [-Infinity, Infinity]
     * Range: [-Infinity, Infinity]
     *
     * asinh(x) = ln(x + sqrt(x^2 + 1))
     *
     * asinh(NaN)       = NaN
     * asinh(Infinity)  = Infinity
     * asinh(-Infinity) = -Infinity
     * asinh(0)         = 0
     * asinh(-0)        = -0
     *
     */
    P.inverseHyperbolicSine = P.asinh = function () {
        var pr, rm,
            x = this,
            Ctor = x.constructor;

        if (!x.isFinite() || x.isZero()) return new Ctor(x)

        pr = Ctor.precision;
        rm = Ctor.rounding;
        Ctor.precision = pr + 2 * Math.max(Math.abs(x.e), x.sd()) + 6;
        Ctor.rounding = 1;
        external = false;

        x = x.times(x).plus(1).sqrt().plus(x);

        external = true;
        Ctor.precision = pr;
        Ctor.rounding = rm;

        return x.ln()
    };


    /*
     * Return a new Decimal whose value is the inverse of the hyperbolic tangent in radians of the
     * value of this Decimal.
     *
     * Domain: [-1, 1]
     * Range: [-Infinity, Infinity]
     *
     * atanh(x) = 0.5 * ln((1 + x) / (1 - x))
     *
     * atanh(|x| > 1)   = NaN
     * atanh(NaN)       = NaN
     * atanh(Infinity)  = NaN
     * atanh(-Infinity) = NaN
     * atanh(0)         = 0
     * atanh(-0)        = -0
     * atanh(1)         = Infinity
     * atanh(-1)        = -Infinity
     *
     */
    P.inverseHyperbolicTangent = P.atanh = function () {
        var pr, rm, wpr, xsd,
            x = this,
            Ctor = x.constructor;

        if (!x.isFinite()) return new Ctor(NaN)
        if (x.e >= 0) return new Ctor(x.abs().eq(1) ? x.s / 0 : x.isZero() ? x : NaN)

        pr = Ctor.precision;
        rm = Ctor.rounding;
        xsd = x.sd();

        if (Math.max(xsd, pr) < 2 * -x.e - 1) return finalise(new Ctor(x), pr, rm, true)

        Ctor.precision = wpr = xsd - x.e;

        x = divide(x.plus(1), new Ctor(1).minus(x), wpr + pr, 1);

        Ctor.precision = pr + 4;
        Ctor.rounding = 1;

        x = x.ln();

        Ctor.precision = pr;
        Ctor.rounding = rm;

        return x.times(0.5)
    };


    /*
     * Return a new Decimal whose value is the arcsine (inverse sine) in radians of the value of this
     * Decimal.
     *
     * Domain: [-Infinity, Infinity]
     * Range: [-pi/2, pi/2]
     *
     * asin(x) = 2*atan(x/(1 + sqrt(1 - x^2)))
     *
     * asin(0)       = 0
     * asin(-0)      = -0
     * asin(1/2)     = pi/6
     * asin(-1/2)    = -pi/6
     * asin(1)       = pi/2
     * asin(-1)      = -pi/2
     * asin(|x| > 1) = NaN
     * asin(NaN)     = NaN
     *
     * TODO? Compare performance of Taylor series.
     *
     */
    P.inverseSine = P.asin = function () {
        var halfPi, k,
            pr, rm,
            x = this,
            Ctor = x.constructor;

        if (x.isZero()) return new Ctor(x)

        k = x.abs().cmp(1);
        pr = Ctor.precision;
        rm = Ctor.rounding;

        if (k !== -1) {

            // |x| is 1
            if (k === 0) {
                halfPi = getPi(Ctor, pr + 4, rm).times(0.5);
                halfPi.s = x.s;
                return halfPi
            }

            // |x| > 1 or x is NaN
            return new Ctor(NaN)
        }

        // TODO? Special case asin(1/2) = pi/6 and asin(-1/2) = -pi/6

        Ctor.precision = pr + 6;
        Ctor.rounding = 1;

        x = x.div(new Ctor(1).minus(x.times(x)).sqrt().plus(1)).atan();

        Ctor.precision = pr;
        Ctor.rounding = rm;

        return x.times(2)
    };


    /*
     * Return a new Decimal whose value is the arctangent (inverse tangent) in radians of the value
     * of this Decimal.
     *
     * Domain: [-Infinity, Infinity]
     * Range: [-pi/2, pi/2]
     *
     * atan(x) = x - x^3/3 + x^5/5 - x^7/7 + ...
     *
     * atan(0)         = 0
     * atan(-0)        = -0
     * atan(1)         = pi/4
     * atan(-1)        = -pi/4
     * atan(Infinity)  = pi/2
     * atan(-Infinity) = -pi/2
     * atan(NaN)       = NaN
     *
     */
    P.inverseTangent = P.atan = function () {
        var i, j, k, n, px, t, r, wpr, x2,
            x = this,
            Ctor = x.constructor,
            pr = Ctor.precision,
            rm = Ctor.rounding;

        if (!x.isFinite()) {
            if (!x.s) return new Ctor(NaN)
            if (pr + 4 <= PI_PRECISION) {
                r = getPi(Ctor, pr + 4, rm).times(0.5);
                r.s = x.s;
                return r
            }
        } else if (x.isZero()) {
            return new Ctor(x)
        } else if (x.abs().eq(1) && pr + 4 <= PI_PRECISION) {
            r = getPi(Ctor, pr + 4, rm).times(0.25);
            r.s = x.s;
            return r
        }

        Ctor.precision = wpr = pr + 10;
        Ctor.rounding = 1;

        // TODO? if (x >= 1 && pr <= PI_PRECISION) atan(x) = halfPi * x.s - atan(1 / x);

        // Argument reduction
        // Ensure |x| < 0.42
        // atan(x) = 2 * atan(x / (1 + sqrt(1 + x^2)))

        k = Math.min(28, wpr / LOG_BASE + 2 | 0);

        for (i = k; i; --i) x = x.div(x.times(x).plus(1).sqrt().plus(1));

        external = false;

        j = Math.ceil(wpr / LOG_BASE);
        n = 1;
        x2 = x.times(x);
        r = new Ctor(x);
        px = x;

        // atan(x) = x - x^3/3 + x^5/5 - x^7/7 + ...
        for (; i !== -1;) {
            px = px.times(x2);
            t = r.minus(px.div(n += 2));

            px = px.times(x2);
            r = t.plus(px.div(n += 2));

            if (r.d[j] !== void 0) for (i = j; r.d[i] === t.d[i] && i--;);
        }

        if (k) r = r.times(2 << (k - 1));

        external = true;

        return finalise(r, Ctor.precision = pr, Ctor.rounding = rm, true)
    };


    /*
     * Return true if the value of this Decimal is a finite number, otherwise return false.
     *
     */
    P.isFinite = function () {
        return !!this.d
    };


    /*
     * Return true if the value of this Decimal is an integer, otherwise return false.
     *
     */
    P.isInteger = P.isInt = function () {
        return !!this.d && mathfloor(this.e / LOG_BASE) > this.d.length - 2
    };


    /*
     * Return true if the value of this Decimal is NaN, otherwise return false.
     *
     */
    P.isNaN = function () {
        return !this.s
    };


    /*
     * Return true if the value of this Decimal is negative, otherwise return false.
     *
     */
    P.isNegative = P.isNeg = function () {
        return this.s < 0
    };


    /*
     * Return true if the value of this Decimal is positive, otherwise return false.
     *
     */
    P.isPositive = P.isPos = function () {
        return this.s > 0
    };


    /*
     * Return true if the value of this Decimal is 0 or -0, otherwise return false.
     *
     */
    P.isZero = function () {
        return !!this.d && this.d[0] === 0
    };


    /*
     * Return true if the value of this Decimal is less than `y`, otherwise return false.
     *
     */
    P.lessThan = P.lt = function (y) {
        return this.cmp(y) < 0
    };


    /*
     * Return true if the value of this Decimal is less than or equal to `y`, otherwise return false.
     *
     */
    P.lessThanOrEqualTo = P.lte = function (y) {
        return this.cmp(y) < 1
    };


    /*
     * Return the logarithm of the value of this Decimal to the specified base, rounded to `precision`
     * significant digits using rounding mode `rounding`.
     *
     * If no base is specified, return log[10](arg).
     *
     * log[base](arg) = ln(arg) / ln(base)
     *
     * The result will always be correctly rounded if the base of the log is 10, and 'almost always'
     * otherwise:
     *
     * Depending on the rounding mode, the result may be incorrectly rounded if the first fifteen
     * rounding digits are [49]99999999999999 or [50]00000000000000. In that case, the maximum error
     * between the result and the correctly rounded result will be one ulp (unit in the last place).
     *
     * log[-b](a)       = NaN
     * log[0](a)        = NaN
     * log[1](a)        = NaN
     * log[NaN](a)      = NaN
     * log[Infinity](a) = NaN
     * log[b](0)        = -Infinity
     * log[b](-0)       = -Infinity
     * log[b](-a)       = NaN
     * log[b](1)        = 0
     * log[b](Infinity) = Infinity
     * log[b](NaN)      = NaN
     *
     * [base] {number|string|Decimal} The base of the logarithm.
     *
     */
    P.logarithm = P.log = function (base) {
        var isBase10, d, denominator, k, inf, num, sd, r,
            arg = this,
            Ctor = arg.constructor,
            pr = Ctor.precision,
            rm = Ctor.rounding,
            guard = 5;

        // Default base is 10.
        if (base == null) {
            base = new Ctor(10);
            isBase10 = true;
        } else {
            base = new Ctor(base);
            d = base.d;

            // Return NaN if base is negative, or non-finite, or is 0 or 1.
            if (base.s < 0 || !d || !d[0] || base.eq(1)) return new Ctor(NaN)

            isBase10 = base.eq(10);
        }

        d = arg.d;

        // Is arg negative, non-finite, 0 or 1?
        if (arg.s < 0 || !d || !d[0] || arg.eq(1)) {
            return new Ctor(d && !d[0] ? -1 / 0 : arg.s != 1 ? NaN : d ? 0 : 1 / 0)
        }

        // The result will have a non-terminating decimal expansion if base is 10 and arg is not an
        // integer power of 10.
        if (isBase10) {
            if (d.length > 1) {
                inf = true;
            } else {
                for (k = d[0]; k % 10 === 0;) k /= 10;
                inf = k !== 1;
            }
        }

        external = false;
        sd = pr + guard;
        num = naturalLogarithm(arg, sd);
        denominator = isBase10 ? getLn10(Ctor, sd + 10) : naturalLogarithm(base, sd);

        // The result will have 5 rounding digits.
        r = divide(num, denominator, sd, 1);

        // If at a rounding boundary, i.e. the result's rounding digits are [49]9999 or [50]0000,
        // calculate 10 further digits.
        //
        // If the result is known to have an infinite decimal expansion, repeat this until it is clear
        // that the result is above or below the boundary. Otherwise, if after calculating the 10
        // further digits, the last 14 are nines, round up and assume the result is exact.
        // Also assume the result is exact if the last 14 are zero.
        //
        // Example of a result that will be incorrectly rounded:
        // log[1048576](4503599627370502) = 2.60000000000000009610279511444746...
        // The above result correctly rounded using ROUND_CEIL to 1 decimal place should be 2.7, but it
        // will be given as 2.6 as there are 15 zeros immediately after the requested decimal place, so
        // the exact result would be assumed to be 2.6, which rounded using ROUND_CEIL to 1 decimal
        // place is still 2.6.
        if (checkRoundingDigits(r.d, k = pr, rm)) {

            do {
                sd += 10;
                num = naturalLogarithm(arg, sd);
                denominator = isBase10 ? getLn10(Ctor, sd + 10) : naturalLogarithm(base, sd);
                r = divide(num, denominator, sd, 1);

                if (!inf) {

                    // Check for 14 nines from the 2nd rounding digit, as the first may be 4.
                    if (+digitsToString(r.d).slice(k + 1, k + 15) + 1 == 1e14) {
                        r = finalise(r, pr + 1, 0);
                    }

                    break
                }
            } while (checkRoundingDigits(r.d, k += 10, rm))
        }

        external = true;

        return finalise(r, pr, rm)
    };


    /*
     * Return a new Decimal whose value is the maximum of the arguments and the value of this Decimal.
     *
     * arguments {number|string|Decimal}
     *
    P.max = function () {
      Array.prototype.push.call(arguments, this);
      return maxOrMin(this.constructor, arguments, 'lt');
    };
     */


    /*
     * Return a new Decimal whose value is the minimum of the arguments and the value of this Decimal.
     *
     * arguments {number|string|Decimal}
     *
    P.min = function () {
      Array.prototype.push.call(arguments, this);
      return maxOrMin(this.constructor, arguments, 'gt');
    };
     */


    /*
     *  n - 0 = n
     *  n - N = N
     *  n - I = -I
     *  0 - n = -n
     *  0 - 0 = 0
     *  0 - N = N
     *  0 - I = -I
     *  N - n = N
     *  N - 0 = N
     *  N - N = N
     *  N - I = N
     *  I - n = I
     *  I - 0 = I
     *  I - N = N
     *  I - I = N
     *
     * Return a new Decimal whose value is the value of this Decimal minus `y`, rounded to `precision`
     * significant digits using rounding mode `rounding`.
     *
     */
    P.minus = P.sub = function (y) {
        var d, e, i, j, k, len, pr, rm, xd, xe, xLTy, yd,
            x = this,
            Ctor = x.constructor;

        y = new Ctor(y);

        // If either is not finite...
        if (!x.d || !y.d) {

            // Return NaN if either is NaN.
            if (!x.s || !y.s) y = new Ctor(NaN);

            // Return y negated if x is finite and y is ±Infinity.
            else if (x.d) y.s = -y.s;

            // Return x if y is finite and x is ±Infinity.
            // Return x if both are ±Infinity with different signs.
            // Return NaN if both are ±Infinity with the same sign.
            else y = new Ctor(y.d || x.s !== y.s ? x : NaN);

            return y
        }

        // If signs differ...
        if (x.s != y.s) {
            y.s = -y.s;
            return x.plus(y)
        }

        xd = x.d;
        yd = y.d;
        pr = Ctor.precision;
        rm = Ctor.rounding;

        // If either is zero...
        if (!xd[0] || !yd[0]) {

            // Return y negated if x is zero and y is non-zero.
            if (yd[0]) y.s = -y.s;

            // Return x if y is zero and x is non-zero.
            else if (xd[0]) y = new Ctor(x);

            // Return zero if both are zero.
            // From IEEE 754 (2008) 6.3: 0 - 0 = -0 - -0 = -0 when rounding to -Infinity.
            else return new Ctor(rm === 3 ? -0 : 0)

            return external ? finalise(y, pr, rm) : y
        }

        // x and y are finite, non-zero numbers with the same sign.

        // Calculate base 1e7 exponents.
        e = mathfloor(y.e / LOG_BASE);
        xe = mathfloor(x.e / LOG_BASE);

        xd = xd.slice();
        k = xe - e;

        // If base 1e7 exponents differ...
        if (k) {
            xLTy = k < 0;

            if (xLTy) {
                d = xd;
                k = -k;
                len = yd.length;
            } else {
                d = yd;
                e = xe;
                len = xd.length;
            }

            // Numbers with massively different exponents would result in a very high number of
            // zeros needing to be prepended, but this can be avoided while still ensuring correct
            // rounding by limiting the number of zeros to `Math.ceil(pr / LOG_BASE) + 2`.
            i = Math.max(Math.ceil(pr / LOG_BASE), len) + 2;

            if (k > i) {
                k = i;
                d.length = 1;
            }

            // Prepend zeros to equalise exponents.
            d.reverse();
            for (i = k; i--;) d.push(0);
            d.reverse();

            // Base 1e7 exponents equal.
        } else {

            // Check digits to determine which is the bigger number.

            i = xd.length;
            len = yd.length;
            xLTy = i < len;
            if (xLTy) len = i;

            for (i = 0; i < len; i++) {
                if (xd[i] != yd[i]) {
                    xLTy = xd[i] < yd[i];
                    break
                }
            }

            k = 0;
        }

        if (xLTy) {
            d = xd;
            xd = yd;
            yd = d;
            y.s = -y.s;
        }

        len = xd.length;

        // Append zeros to `xd` if shorter.
        // Don't add zeros to `yd` if shorter as subtraction only needs to start at `yd` length.
        for (i = yd.length - len; i > 0; --i) xd[len++] = 0;

        // Subtract yd from xd.
        for (i = yd.length; i > k;) {

            if (xd[--i] < yd[i]) {
                for (j = i; j && xd[--j] === 0;) xd[j] = BASE - 1;
                --xd[j];
                xd[i] += BASE;
            }

            xd[i] -= yd[i];
        }

        // Remove trailing zeros.
        for (; xd[--len] === 0;) xd.pop();

        // Remove leading zeros and adjust exponent accordingly.
        for (; xd[0] === 0; xd.shift()) --e;

        // Zero?
        if (!xd[0]) return new Ctor(rm === 3 ? -0 : 0)

        y.d = xd;
        y.e = getBase10Exponent(xd, e);

        return external ? finalise(y, pr, rm) : y
    };


    /*
     *   n % 0 =  N
     *   n % N =  N
     *   n % I =  n
     *   0 % n =  0
     *  -0 % n = -0
     *   0 % 0 =  N
     *   0 % N =  N
     *   0 % I =  0
     *   N % n =  N
     *   N % 0 =  N
     *   N % N =  N
     *   N % I =  N
     *   I % n =  N
     *   I % 0 =  N
     *   I % N =  N
     *   I % I =  N
     *
     * Return a new Decimal whose value is the value of this Decimal modulo `y`, rounded to
     * `precision` significant digits using rounding mode `rounding`.
     *
     * The result depends on the modulo mode.
     *
     */
    P.modulo = P.mod = function (y) {
        var q,
            x = this,
            Ctor = x.constructor;

        y = new Ctor(y);

        // Return NaN if x is ±Infinity or NaN, or y is NaN or ±0.
        if (!x.d || !y.s || y.d && !y.d[0]) return new Ctor(NaN)

        // Return x if y is ±Infinity or x is ±0.
        if (!y.d || x.d && !x.d[0]) {
            return finalise(new Ctor(x), Ctor.precision, Ctor.rounding)
        }

        // Prevent rounding of intermediate calculations.
        external = false;

        if (Ctor.modulo == 9) {

            // Euclidian division: q = sign(y) * floor(x / abs(y))
            // result = x - q * y    where  0 <= result < abs(y)
            q = divide(x, y.abs(), 0, 3, 1);
            q.s *= y.s;
        } else {
            q = divide(x, y, 0, Ctor.modulo, 1);
        }

        q = q.times(y);

        external = true;

        return x.minus(q)
    };


    /*
     * Return a new Decimal whose value is the natural exponential of the value of this Decimal,
     * i.e. the base e raised to the power the value of this Decimal, rounded to `precision`
     * significant digits using rounding mode `rounding`.
     *
     */
    P.naturalExponential = P.exp = function () {
        return naturalExponential(this)
    };


    /*
     * Return a new Decimal whose value is the natural logarithm of the value of this Decimal,
     * rounded to `precision` significant digits using rounding mode `rounding`.
     *
     */
    P.naturalLogarithm = P.ln = function () {
        return naturalLogarithm(this)
    };


    /*
     * Return a new Decimal whose value is the value of this Decimal negated, i.e. as if multiplied by
     * -1.
     *
     */
    P.negated = P.neg = function () {
        var x = new this.constructor(this);
        x.s = -x.s;
        return finalise(x)
    };


    /*
     *  n + 0 = n
     *  n + N = N
     *  n + I = I
     *  0 + n = n
     *  0 + 0 = 0
     *  0 + N = N
     *  0 + I = I
     *  N + n = N
     *  N + 0 = N
     *  N + N = N
     *  N + I = N
     *  I + n = I
     *  I + 0 = I
     *  I + N = N
     *  I + I = I
     *
     * Return a new Decimal whose value is the value of this Decimal plus `y`, rounded to `precision`
     * significant digits using rounding mode `rounding`.
     *
     */
    P.plus = P.add = function (y) {
        var carry, d, e, i, k, len, pr, rm, xd, yd,
            x = this,
            Ctor = x.constructor;

        y = new Ctor(y);

        // If either is not finite...
        if (!x.d || !y.d) {

            // Return NaN if either is NaN.
            if (!x.s || !y.s) y = new Ctor(NaN);

            // Return x if y is finite and x is ±Infinity.
            // Return x if both are ±Infinity with the same sign.
            // Return NaN if both are ±Infinity with different signs.
            // Return y if x is finite and y is ±Infinity.
            else if (!x.d) y = new Ctor(y.d || x.s === y.s ? x : NaN);

            return y
        }

        // If signs differ...
        if (x.s != y.s) {
            y.s = -y.s;
            return x.minus(y)
        }

        xd = x.d;
        yd = y.d;
        pr = Ctor.precision;
        rm = Ctor.rounding;

        // If either is zero...
        if (!xd[0] || !yd[0]) {

            // Return x if y is zero.
            // Return y if y is non-zero.
            if (!yd[0]) y = new Ctor(x);

            return external ? finalise(y, pr, rm) : y
        }

        // x and y are finite, non-zero numbers with the same sign.

        // Calculate base 1e7 exponents.
        k = mathfloor(x.e / LOG_BASE);
        e = mathfloor(y.e / LOG_BASE);

        xd = xd.slice();
        i = k - e;

        // If base 1e7 exponents differ...
        if (i) {

            if (i < 0) {
                d = xd;
                i = -i;
                len = yd.length;
            } else {
                d = yd;
                e = k;
                len = xd.length;
            }

            // Limit number of zeros prepended to max(ceil(pr / LOG_BASE), len) + 1.
            k = Math.ceil(pr / LOG_BASE);
            len = k > len ? k + 1 : len + 1;

            if (i > len) {
                i = len;
                d.length = 1;
            }

            // Prepend zeros to equalise exponents. Note: Faster to use reverse then do unshifts.
            d.reverse();
            for (; i--;) d.push(0);
            d.reverse();
        }

        len = xd.length;
        i = yd.length;

        // If yd is longer than xd, swap xd and yd so xd points to the longer array.
        if (len - i < 0) {
            i = len;
            d = yd;
            yd = xd;
            xd = d;
        }

        // Only start adding at yd.length - 1 as the further digits of xd can be left as they are.
        for (carry = 0; i;) {
            carry = (xd[--i] = xd[i] + yd[i] + carry) / BASE | 0;
            xd[i] %= BASE;
        }

        if (carry) {
            xd.unshift(carry);
            ++e;
        }

        // Remove trailing zeros.
        // No need to check for zero, as +x + +y != 0 && -x + -y != 0
        for (len = xd.length; xd[--len] == 0;) xd.pop();

        y.d = xd;
        y.e = getBase10Exponent(xd, e);

        return external ? finalise(y, pr, rm) : y
    };


    /*
     * Return the number of significant digits of the value of this Decimal.
     *
     * [z] {boolean|number} Whether to count integer-part trailing zeros: true, false, 1 or 0.
     *
     */
    P.precision = P.sd = function (z) {
        var k,
            x = this;

        if (z !== void 0 && z !== !!z && z !== 1 && z !== 0) throw Error(invalidArgument + z)

        if (x.d) {
            k = getPrecision(x.d);
            if (z && x.e + 1 > k) k = x.e + 1;
        } else {
            k = NaN;
        }

        return k
    };


    /*
     * Return a new Decimal whose value is the value of this Decimal rounded to a whole number using
     * rounding mode `rounding`.
     *
     */
    P.round = function () {
        var x = this,
            Ctor = x.constructor;

        return finalise(new Ctor(x), x.e + 1, Ctor.rounding)
    };


    /*
     * Return a new Decimal whose value is the sine of the value in radians of this Decimal.
     *
     * Domain: [-Infinity, Infinity]
     * Range: [-1, 1]
     *
     * sin(x) = x - x^3/3! + x^5/5! - ...
     *
     * sin(0)         = 0
     * sin(-0)        = -0
     * sin(Infinity)  = NaN
     * sin(-Infinity) = NaN
     * sin(NaN)       = NaN
     *
     */
    P.sine = P.sin = function () {
        var pr, rm,
            x = this,
            Ctor = x.constructor;

        if (!x.isFinite()) return new Ctor(NaN)
        if (x.isZero()) return new Ctor(x)

        pr = Ctor.precision;
        rm = Ctor.rounding;
        Ctor.precision = pr + Math.max(x.e, x.sd()) + LOG_BASE;
        Ctor.rounding = 1;

        x = sine(Ctor, toLessThanHalfPi(Ctor, x));

        Ctor.precision = pr;
        Ctor.rounding = rm;

        return finalise(quadrant > 2 ? x.neg() : x, pr, rm, true)
    };


    /*
     * Return a new Decimal whose value is the square root of this Decimal, rounded to `precision`
     * significant digits using rounding mode `rounding`.
     *
     *  sqrt(-n) =  N
     *  sqrt(N)  =  N
     *  sqrt(-I) =  N
     *  sqrt(I)  =  I
     *  sqrt(0)  =  0
     *  sqrt(-0) = -0
     *
     */
    P.squareRoot = P.sqrt = function () {
        var m, n, sd, r, rep, t,
            x = this,
            d = x.d,
            e = x.e,
            s = x.s,
            Ctor = x.constructor;

        // Negative/NaN/Infinity/zero?
        if (s !== 1 || !d || !d[0]) {
            return new Ctor(!s || s < 0 && (!d || d[0]) ? NaN : d ? x : 1 / 0)
        }

        external = false;

        // Initial estimate.
        s = Math.sqrt(+x);

        // Math.sqrt underflow/overflow?
        // Pass x to Math.sqrt as integer, then adjust the exponent of the result.
        if (s == 0 || s == 1 / 0) {
            n = digitsToString(d);

            if ((n.length + e) % 2 == 0) n += '0';
            s = Math.sqrt(n);
            e = mathfloor((e + 1) / 2) - (e < 0 || e % 2);

            if (s == 1 / 0) {
                n = '5e' + e;
            } else {
                n = s.toExponential();
                n = n.slice(0, n.indexOf('e') + 1) + e;
            }

            r = new Ctor(n);
        } else {
            r = new Ctor(s.toString());
        }

        sd = (e = Ctor.precision) + 3;

        // Newton-Raphson iteration.
        for (; ;) {
            t = r;
            r = t.plus(divide(x, t, sd + 2, 1)).times(0.5);

            // TODO? Replace with for-loop and checkRoundingDigits.
            if (digitsToString(t.d).slice(0, sd) === (n = digitsToString(r.d)).slice(0, sd)) {
                n = n.slice(sd - 3, sd + 1);

                // The 4th rounding digit may be in error by -1 so if the 4 rounding digits are 9999 or
                // 4999, i.e. approaching a rounding boundary, continue the iteration.
                if (n == '9999' || !rep && n == '4999') {

                    // On the first iteration only, check to see if rounding up gives the exact result as the
                    // nines may infinitely repeat.
                    if (!rep) {
                        finalise(t, e + 1, 0);

                        if (t.times(t).eq(x)) {
                            r = t;
                            break
                        }
                    }

                    sd += 4;
                    rep = 1;
                } else {

                    // If the rounding digits are null, 0{0,4} or 50{0,3}, check for an exact result.
                    // If not, then there are further digits and m will be truthy.
                    if (!+n || !+n.slice(1) && n.charAt(0) == '5') {

                        // Truncate to the first rounding digit.
                        finalise(r, e + 1, 1);
                        m = !r.times(r).eq(x);
                    }

                    break
                }
            }
        }

        external = true;

        return finalise(r, e, Ctor.rounding, m)
    };


    /*
     * Return a new Decimal whose value is the tangent of the value in radians of this Decimal.
     *
     * Domain: [-Infinity, Infinity]
     * Range: [-Infinity, Infinity]
     *
     * tan(0)         = 0
     * tan(-0)        = -0
     * tan(Infinity)  = NaN
     * tan(-Infinity) = NaN
     * tan(NaN)       = NaN
     *
     */
    P.tangent = P.tan = function () {
        var pr, rm,
            x = this,
            Ctor = x.constructor;

        if (!x.isFinite()) return new Ctor(NaN)
        if (x.isZero()) return new Ctor(x)

        pr = Ctor.precision;
        rm = Ctor.rounding;
        Ctor.precision = pr + 10;
        Ctor.rounding = 1;

        x = x.sin();
        x.s = 1;
        x = divide(x, new Ctor(1).minus(x.times(x)).sqrt(), pr + 10, 0);

        Ctor.precision = pr;
        Ctor.rounding = rm;

        return finalise(quadrant == 2 || quadrant == 4 ? x.neg() : x, pr, rm, true)
    };


    /*
     *  n * 0 = 0
     *  n * N = N
     *  n * I = I
     *  0 * n = 0
     *  0 * 0 = 0
     *  0 * N = N
     *  0 * I = N
     *  N * n = N
     *  N * 0 = N
     *  N * N = N
     *  N * I = N
     *  I * n = I
     *  I * 0 = N
     *  I * N = N
     *  I * I = I
     *
     * Return a new Decimal whose value is this Decimal times `y`, rounded to `precision` significant
     * digits using rounding mode `rounding`.
     *
     */
    P.times = P.mul = function (y) {
        var carry, e, i, k, r, rL, t, xdL, ydL,
            x = this,
            Ctor = x.constructor,
            xd = x.d,
            yd = (y = new Ctor(y)).d;

        y.s *= x.s;

        // If either is NaN, ±Infinity or ±0...
        if (!xd || !xd[0] || !yd || !yd[0]) {

            return new Ctor(!y.s || xd && !xd[0] && !yd || yd && !yd[0] && !xd

                // Return NaN if either is NaN.
                // Return NaN if x is ±0 and y is ±Infinity, or y is ±0 and x is ±Infinity.
                ? NaN

                // Return ±Infinity if either is ±Infinity.
                // Return ±0 if either is ±0.
                : !xd || !yd ? y.s / 0 : y.s * 0)
        }

        e = mathfloor(x.e / LOG_BASE) + mathfloor(y.e / LOG_BASE);
        xdL = xd.length;
        ydL = yd.length;

        // Ensure xd points to the longer array.
        if (xdL < ydL) {
            r = xd;
            xd = yd;
            yd = r;
            rL = xdL;
            xdL = ydL;
            ydL = rL;
        }

        // Initialise the result array with zeros.
        r = [];
        rL = xdL + ydL;
        for (i = rL; i--;) r.push(0);

        // Multiply!
        for (i = ydL; --i >= 0;) {
            carry = 0;
            for (k = xdL + i; k > i;) {
                t = r[k] + yd[i] * xd[k - i - 1] + carry;
                r[k--] = t % BASE | 0;
                carry = t / BASE | 0;
            }

            r[k] = (r[k] + carry) % BASE | 0;
        }

        // Remove trailing zeros.
        for (; !r[--rL];) r.pop();

        if (carry) ++e;
        else r.shift();

        y.d = r;
        y.e = getBase10Exponent(r, e);

        return external ? finalise(y, Ctor.precision, Ctor.rounding) : y
    };


    /*
     * Return a string representing the value of this Decimal in base 2, round to `sd` significant
     * digits using rounding mode `rm`.
     *
     * If the optional `sd` argument is present then return binary exponential notation.
     *
     * [sd] {number} Significant digits. Integer, 1 to MAX_DIGITS inclusive.
     * [rm] {number} Rounding mode. Integer, 0 to 8 inclusive.
     *
     */
    P.toBinary = function (sd, rm) {
        return toStringBinary(this, 2, sd, rm)
    };


    /*
     * Return a new Decimal whose value is the value of this Decimal rounded to a maximum of `dp`
     * decimal places using rounding mode `rm` or `rounding` if `rm` is omitted.
     *
     * If `dp` is omitted, return a new Decimal whose value is the value of this Decimal.
     *
     * [dp] {number} Decimal places. Integer, 0 to MAX_DIGITS inclusive.
     * [rm] {number} Rounding mode. Integer, 0 to 8 inclusive.
     *
     */
    P.toDecimalPlaces = P.toDP = function (dp, rm) {
        var x = this,
            Ctor = x.constructor;

        x = new Ctor(x);
        if (dp === void 0) return x

        checkInt32(dp, 0, MAX_DIGITS);

        if (rm === void 0) rm = Ctor.rounding;
        else checkInt32(rm, 0, 8);

        return finalise(x, dp + x.e + 1, rm)
    };


    /*
     * Return a string representing the value of this Decimal in exponential notation rounded to
     * `dp` fixed decimal places using rounding mode `rounding`.
     *
     * [dp] {number} Decimal places. Integer, 0 to MAX_DIGITS inclusive.
     * [rm] {number} Rounding mode. Integer, 0 to 8 inclusive.
     *
     */
    P.toExponential = function (dp, rm) {
        var str,
            x = this,
            Ctor = x.constructor;

        if (dp === void 0) {
            str = finiteToString(x, true);
        } else {
            checkInt32(dp, 0, MAX_DIGITS);

            if (rm === void 0) rm = Ctor.rounding;
            else checkInt32(rm, 0, 8);

            x = finalise(new Ctor(x), dp + 1, rm);
            str = finiteToString(x, true, dp + 1);
        }

        return x.isNeg() && !x.isZero() ? '-' + str : str
    };


    /*
     * Return a string representing the value of this Decimal in normal (fixed-point) notation to
     * `dp` fixed decimal places and rounded using rounding mode `rm` or `rounding` if `rm` is
     * omitted.
     *
     * As with JavaScript numbers, (-0).toFixed(0) is '0', but e.g. (-0.00001).toFixed(0) is '-0'.
     *
     * [dp] {number} Decimal places. Integer, 0 to MAX_DIGITS inclusive.
     * [rm] {number} Rounding mode. Integer, 0 to 8 inclusive.
     *
     * (-0).toFixed(0) is '0', but (-0.1).toFixed(0) is '-0'.
     * (-0).toFixed(1) is '0.0', but (-0.01).toFixed(1) is '-0.0'.
     * (-0).toFixed(3) is '0.000'.
     * (-0.5).toFixed(0) is '-0'.
     *
     */
    P.toFixed = function (dp, rm) {
        var str, y,
            x = this,
            Ctor = x.constructor;

        if (dp === void 0) {
            str = finiteToString(x);
        } else {
            checkInt32(dp, 0, MAX_DIGITS);

            if (rm === void 0) rm = Ctor.rounding;
            else checkInt32(rm, 0, 8);

            y = finalise(new Ctor(x), dp + x.e + 1, rm);
            str = finiteToString(y, false, dp + y.e + 1);
        }

        // To determine whether to add the minus sign look at the value before it was rounded,
        // i.e. look at `x` rather than `y`.
        return x.isNeg() && !x.isZero() ? '-' + str : str
    };


    /*
     * Return an array representing the value of this Decimal as a simple fraction with an integer
     * numerator and an integer denominator.
     *
     * The denominator will be a positive non-zero value less than or equal to the specified maximum
     * denominator. If a maximum denominator is not specified, the denominator will be the lowest
     * value necessary to represent the number exactly.
     *
     * [maxD] {number|string|Decimal} Maximum denominator. Integer >= 1 and < Infinity.
     *
     */
    P.toFraction = function (maxD) {
        var d, d0, d1, d2, e, k, n, n0, n1, pr, q, r,
            x = this,
            xd = x.d,
            Ctor = x.constructor;

        if (!xd) return new Ctor(x)

        n1 = d0 = new Ctor(1);
        d1 = n0 = new Ctor(0);

        d = new Ctor(d1);
        e = d.e = getPrecision(xd) - x.e - 1;
        k = e % LOG_BASE;
        d.d[0] = mathpow(10, k < 0 ? LOG_BASE + k : k);

        if (maxD == null) {

            // d is 10**e, the minimum max-denominator needed.
            maxD = e > 0 ? d : n1;
        } else {
            n = new Ctor(maxD);
            if (!n.isInt() || n.lt(n1)) throw Error(invalidArgument + n)
            maxD = n.gt(d) ? (e > 0 ? d : n1) : n;
        }

        external = false;
        n = new Ctor(digitsToString(xd));
        pr = Ctor.precision;
        Ctor.precision = e = xd.length * LOG_BASE * 2;

        for (; ;) {
            q = divide(n, d, 0, 1, 1);
            d2 = d0.plus(q.times(d1));
            if (d2.cmp(maxD) == 1) break
            d0 = d1;
            d1 = d2;
            d2 = n1;
            n1 = n0.plus(q.times(d2));
            n0 = d2;
            d2 = d;
            d = n.minus(q.times(d2));
            n = d2;
        }

        d2 = divide(maxD.minus(d0), d1, 0, 1, 1);
        n0 = n0.plus(d2.times(n1));
        d0 = d0.plus(d2.times(d1));
        n0.s = n1.s = x.s;

        // Determine which fraction is closer to x, n0/d0 or n1/d1?
        r = divide(n1, d1, e, 1).minus(x).abs().cmp(divide(n0, d0, e, 1).minus(x).abs()) < 1
            ? [n1, d1] : [n0, d0];

        Ctor.precision = pr;
        external = true;

        return r
    };


    /*
     * Return a string representing the value of this Decimal in base 16, round to `sd` significant
     * digits using rounding mode `rm`.
     *
     * If the optional `sd` argument is present then return binary exponential notation.
     *
     * [sd] {number} Significant digits. Integer, 1 to MAX_DIGITS inclusive.
     * [rm] {number} Rounding mode. Integer, 0 to 8 inclusive.
     *
     */
    P.toHexadecimal = P.toHex = function (sd, rm) {
        return toStringBinary(this, 16, sd, rm)
    };


    /*
     * Returns a new Decimal whose value is the nearest multiple of `y` in the direction of rounding
     * mode `rm`, or `Decimal.rounding` if `rm` is omitted, to the value of this Decimal.
     *
     * The return value will always have the same sign as this Decimal, unless either this Decimal
     * or `y` is NaN, in which case the return value will be also be NaN.
     *
     * The return value is not affected by the value of `precision`.
     *
     * y {number|string|Decimal} The magnitude to round to a multiple of.
     * [rm] {number} Rounding mode. Integer, 0 to 8 inclusive.
     *
     * 'toNearest() rounding mode not an integer: {rm}'
     * 'toNearest() rounding mode out of range: {rm}'
     *
     */
    P.toNearest = function (y, rm) {
        var x = this,
            Ctor = x.constructor;

        x = new Ctor(x);

        if (y == null) {

            // If x is not finite, return x.
            if (!x.d) return x

            y = new Ctor(1);
            rm = Ctor.rounding;
        } else {
            y = new Ctor(y);
            if (rm === void 0) {
                rm = Ctor.rounding;
            } else {
                checkInt32(rm, 0, 8);
            }

            // If x is not finite, return x if y is not NaN, else NaN.
            if (!x.d) return y.s ? x : y

            // If y is not finite, return Infinity with the sign of x if y is Infinity, else NaN.
            if (!y.d) {
                if (y.s) y.s = x.s;
                return y
            }
        }

        // If y is not zero, calculate the nearest multiple of y to x.
        if (y.d[0]) {
            external = false;
            x = divide(x, y, 0, rm, 1).times(y);
            external = true;
            finalise(x);

            // If y is zero, return zero with the sign of x.
        } else {
            y.s = x.s;
            x = y;
        }

        return x
    };


    /*
     * Return the value of this Decimal converted to a number primitive.
     * Zero keeps its sign.
     *
     */
    P.toNumber = function () {
        return +this
    };


    /*
     * Return a string representing the value of this Decimal in base 8, round to `sd` significant
     * digits using rounding mode `rm`.
     *
     * If the optional `sd` argument is present then return binary exponential notation.
     *
     * [sd] {number} Significant digits. Integer, 1 to MAX_DIGITS inclusive.
     * [rm] {number} Rounding mode. Integer, 0 to 8 inclusive.
     *
     */
    P.toOctal = function (sd, rm) {
        return toStringBinary(this, 8, sd, rm)
    };


    /*
     * Return a new Decimal whose value is the value of this Decimal raised to the power `y`, rounded
     * to `precision` significant digits using rounding mode `rounding`.
     *
     * ECMAScript compliant.
     *
     *   pow(x, NaN)                           = NaN
     *   pow(x, ±0)                            = 1
  
     *   pow(NaN, non-zero)                    = NaN
     *   pow(abs(x) > 1, +Infinity)            = +Infinity
     *   pow(abs(x) > 1, -Infinity)            = +0
     *   pow(abs(x) == 1, ±Infinity)           = NaN
     *   pow(abs(x) < 1, +Infinity)            = +0
     *   pow(abs(x) < 1, -Infinity)            = +Infinity
     *   pow(+Infinity, y > 0)                 = +Infinity
     *   pow(+Infinity, y < 0)                 = +0
     *   pow(-Infinity, odd integer > 0)       = -Infinity
     *   pow(-Infinity, even integer > 0)      = +Infinity
     *   pow(-Infinity, odd integer < 0)       = -0
     *   pow(-Infinity, even integer < 0)      = +0
     *   pow(+0, y > 0)                        = +0
     *   pow(+0, y < 0)                        = +Infinity
     *   pow(-0, odd integer > 0)              = -0
     *   pow(-0, even integer > 0)             = +0
     *   pow(-0, odd integer < 0)              = -Infinity
     *   pow(-0, even integer < 0)             = +Infinity
     *   pow(finite x < 0, finite non-integer) = NaN
     *
     * For non-integer or very large exponents pow(x, y) is calculated using
     *
     *   x^y = exp(y*ln(x))
     *
     * Assuming the first 15 rounding digits are each equally likely to be any digit 0-9, the
     * probability of an incorrectly rounded result
     * P([49]9{14} | [50]0{14}) = 2 * 0.2 * 10^-14 = 4e-15 = 1/2.5e+14
     * i.e. 1 in 250,000,000,000,000
     *
     * If a result is incorrectly rounded the maximum error will be 1 ulp (unit in last place).
     *
     * y {number|string|Decimal} The power to which to raise this Decimal.
     *
     */
    P.toPower = P.pow = function (y) {
        var e, k, pr, r, rm, s,
            x = this,
            Ctor = x.constructor,
            yn = +(y = new Ctor(y));

        // Either ±Infinity, NaN or ±0?
        if (!x.d || !y.d || !x.d[0] || !y.d[0]) return new Ctor(mathpow(+x, yn))

        x = new Ctor(x);

        if (x.eq(1)) return x

        pr = Ctor.precision;
        rm = Ctor.rounding;

        if (y.eq(1)) return finalise(x, pr, rm)

        // y exponent
        e = mathfloor(y.e / LOG_BASE);

        // If y is a small integer use the 'exponentiation by squaring' algorithm.
        if (e >= y.d.length - 1 && (k = yn < 0 ? -yn : yn) <= MAX_SAFE_INTEGER) {
            r = intPow(Ctor, x, k, pr);
            return y.s < 0 ? new Ctor(1).div(r) : finalise(r, pr, rm)
        }

        s = x.s;

        // if x is negative
        if (s < 0) {

            // if y is not an integer
            if (e < y.d.length - 1) return new Ctor(NaN)

            // Result is positive if x is negative and the last digit of integer y is even.
            if ((y.d[e] & 1) == 0) s = 1;

            // if x.eq(-1)
            if (x.e == 0 && x.d[0] == 1 && x.d.length == 1) {
                x.s = s;
                return x
            }
        }

        // Estimate result exponent.
        // x^y = 10^e,  where e = y * log10(x)
        // log10(x) = log10(x_significand) + x_exponent
        // log10(x_significand) = ln(x_significand) / ln(10)
        k = mathpow(+x, yn);
        e = k == 0 || !isFinite(k)
            ? mathfloor(yn * (Math.log('0.' + digitsToString(x.d)) / Math.LN10 + x.e + 1))
            : new Ctor(k + '').e;

        // Exponent estimate may be incorrect e.g. x: 0.999999999999999999, y: 2.29, e: 0, r.e: -1.

        // Overflow/underflow?
        if (e > Ctor.maxE + 1 || e < Ctor.minE - 1) return new Ctor(e > 0 ? s / 0 : 0)

        external = false;
        Ctor.rounding = x.s = 1;

        // Estimate the extra guard digits needed to ensure five correct rounding digits from
        // naturalLogarithm(x). Example of failure without these extra digits (precision: 10):
        // new Decimal(2.32456).pow('2087987436534566.46411')
        // should be 1.162377823e+764914905173815, but is 1.162355823e+764914905173815
        k = Math.min(12, (e + '').length);

        // r = x^y = exp(y*ln(x))
        r = naturalExponential(y.times(naturalLogarithm(x, pr + k)), pr);

        // r may be Infinity, e.g. (0.9999999999999999).pow(-1e+40)
        if (r.d) {

            // Truncate to the required precision plus five rounding digits.
            r = finalise(r, pr + 5, 1);

            // If the rounding digits are [49]9999 or [50]0000 increase the precision by 10 and recalculate
            // the result.
            if (checkRoundingDigits(r.d, pr, rm)) {
                e = pr + 10;

                // Truncate to the increased precision plus five rounding digits.
                r = finalise(naturalExponential(y.times(naturalLogarithm(x, e + k)), e), e + 5, 1);

                // Check for 14 nines from the 2nd rounding digit (the first rounding digit may be 4 or 9).
                if (+digitsToString(r.d).slice(pr + 1, pr + 15) + 1 == 1e14) {
                    r = finalise(r, pr + 1, 0);
                }
            }
        }

        r.s = s;
        external = true;
        Ctor.rounding = rm;

        return finalise(r, pr, rm)
    };


    /*
     * Return a string representing the value of this Decimal rounded to `sd` significant digits
     * using rounding mode `rounding`.
     *
     * Return exponential notation if `sd` is less than the number of digits necessary to represent
     * the integer part of the value in normal notation.
     *
     * [sd] {number} Significant digits. Integer, 1 to MAX_DIGITS inclusive.
     * [rm] {number} Rounding mode. Integer, 0 to 8 inclusive.
     *
     */
    P.toPrecision = function (sd, rm) {
        var str,
            x = this,
            Ctor = x.constructor;

        if (sd === void 0) {
            str = finiteToString(x, x.e <= Ctor.toExpNeg || x.e >= Ctor.toExpPos);
        } else {
            checkInt32(sd, 1, MAX_DIGITS);

            if (rm === void 0) rm = Ctor.rounding;
            else checkInt32(rm, 0, 8);

            x = finalise(new Ctor(x), sd, rm);
            str = finiteToString(x, sd <= x.e || x.e <= Ctor.toExpNeg, sd);
        }

        return x.isNeg() && !x.isZero() ? '-' + str : str
    };


    /*
     * Return a new Decimal whose value is the value of this Decimal rounded to a maximum of `sd`
     * significant digits using rounding mode `rm`, or to `precision` and `rounding` respectively if
     * omitted.
     *
     * [sd] {number} Significant digits. Integer, 1 to MAX_DIGITS inclusive.
     * [rm] {number} Rounding mode. Integer, 0 to 8 inclusive.
     *
     * 'toSD() digits out of range: {sd}'
     * 'toSD() digits not an integer: {sd}'
     * 'toSD() rounding mode not an integer: {rm}'
     * 'toSD() rounding mode out of range: {rm}'
     *
     */
    P.toSignificantDigits = P.toSD = function (sd, rm) {
        var x = this,
            Ctor = x.constructor;

        if (sd === void 0) {
            sd = Ctor.precision;
            rm = Ctor.rounding;
        } else {
            checkInt32(sd, 1, MAX_DIGITS);

            if (rm === void 0) rm = Ctor.rounding;
            else checkInt32(rm, 0, 8);
        }

        return finalise(new Ctor(x), sd, rm)
    };


    /*
     * Return a string representing the value of this Decimal.
     *
     * Return exponential notation if this Decimal has a positive exponent equal to or greater than
     * `toExpPos`, or a negative exponent equal to or less than `toExpNeg`.
     *
     */
    P.toString = function () {
        var x = this,
            Ctor = x.constructor,
            str = finiteToString(x, x.e <= Ctor.toExpNeg || x.e >= Ctor.toExpPos);

        return x.isNeg() && !x.isZero() ? '-' + str : str
    };


    /*
     * Return a new Decimal whose value is the value of this Decimal truncated to a whole number.
     *
     */
    P.truncated = P.trunc = function () {
        return finalise(new this.constructor(this), this.e + 1, 1)
    };


    /*
     * Return a string representing the value of this Decimal.
     * Unlike `toString`, negative zero will include the minus sign.
     *
     */
    P.valueOf = P.toJSON = function () {
        var x = this,
            Ctor = x.constructor,
            str = finiteToString(x, x.e <= Ctor.toExpNeg || x.e >= Ctor.toExpPos);

        return x.isNeg() ? '-' + str : str
    };


    // Helper functions for Decimal.prototype (P) and/or Decimal methods, and their callers.


    /*
     *  digitsToString           P.cubeRoot, P.logarithm, P.squareRoot, P.toFraction, P.toPower,
     *                           finiteToString, naturalExponential, naturalLogarithm
     *  checkInt32               P.toDecimalPlaces, P.toExponential, P.toFixed, P.toNearest,
     *                           P.toPrecision, P.toSignificantDigits, toStringBinary, random
     *  checkRoundingDigits      P.logarithm, P.toPower, naturalExponential, naturalLogarithm
     *  convertBase              toStringBinary, parseOther
     *  cos                      P.cos
     *  divide                   P.atanh, P.cubeRoot, P.dividedBy, P.dividedToIntegerBy,
     *                           P.logarithm, P.modulo, P.squareRoot, P.tan, P.tanh, P.toFraction,
     *                           P.toNearest, toStringBinary, naturalExponential, naturalLogarithm,
     *                           taylorSeries, atan2, parseOther
     *  finalise                 P.absoluteValue, P.atan, P.atanh, P.ceil, P.cos, P.cosh,
     *                           P.cubeRoot, P.dividedToIntegerBy, P.floor, P.logarithm, P.minus,
     *                           P.modulo, P.negated, P.plus, P.round, P.sin, P.sinh, P.squareRoot,
     *                           P.tan, P.times, P.toDecimalPlaces, P.toExponential, P.toFixed,
     *                           P.toNearest, P.toPower, P.toPrecision, P.toSignificantDigits,
     *                           P.truncated, divide, getLn10, getPi, naturalExponential,
     *                           naturalLogarithm, ceil, floor, round, trunc
     *  finiteToString           P.toExponential, P.toFixed, P.toPrecision, P.toString, P.valueOf,
     *                           toStringBinary
     *  getBase10Exponent        P.minus, P.plus, P.times, parseOther
     *  getLn10                  P.logarithm, naturalLogarithm
     *  getPi                    P.acos, P.asin, P.atan, toLessThanHalfPi, atan2
     *  getPrecision             P.precision, P.toFraction
     *  getZeroString            digitsToString, finiteToString
     *  intPow                   P.toPower, parseOther
     *  isOdd                    toLessThanHalfPi
     *  maxOrMin                 max, min
     *  naturalExponential       P.naturalExponential, P.toPower
     *  naturalLogarithm         P.acosh, P.asinh, P.atanh, P.logarithm, P.naturalLogarithm,
     *                           P.toPower, naturalExponential
     *  nonFiniteToString        finiteToString, toStringBinary
     *  parseDecimal             Decimal
     *  parseOther               Decimal
     *  sin                      P.sin
     *  taylorSeries             P.cosh, P.sinh, cos, sin
     *  toLessThanHalfPi         P.cos, P.sin
     *  toStringBinary           P.toBinary, P.toHexadecimal, P.toOctal
     *  truncate                 intPow
     *
     *  Throws:                  P.logarithm, P.precision, P.toFraction, checkInt32, getLn10, getPi,
     *                           naturalLogarithm, config, parseOther, random, Decimal
     */


    function digitsToString(d) {
        var i, k, ws,
            indexOfLastWord = d.length - 1,
            str = '',
            w = d[0];

        if (indexOfLastWord > 0) {
            str += w;
            for (i = 1; i < indexOfLastWord; i++) {
                ws = d[i] + '';
                k = LOG_BASE - ws.length;
                if (k) str += getZeroString(k);
                str += ws;
            }

            w = d[i];
            ws = w + '';
            k = LOG_BASE - ws.length;
            if (k) str += getZeroString(k);
        } else if (w === 0) {
            return '0'
        }

        // Remove trailing zeros of last w.
        for (; w % 10 === 0;) w /= 10;

        return str + w
    }


    function checkInt32(i, min, max) {
        if (i !== ~~i || i < min || i > max) {
            throw Error(invalidArgument + i)
        }
    }


    /*
     * Check 5 rounding digits if `repeating` is null, 4 otherwise.
     * `repeating == null` if caller is `log` or `pow`,
     * `repeating != null` if caller is `naturalLogarithm` or `naturalExponential`.
     */
    function checkRoundingDigits(d, i, rm, repeating) {
        var di, k, r, rd;

        // Get the length of the first word of the array d.
        for (k = d[0]; k >= 10; k /= 10) --i;

        // Is the rounding digit in the first word of d?
        if (--i < 0) {
            i += LOG_BASE;
            di = 0;
        } else {
            di = Math.ceil((i + 1) / LOG_BASE);
            i %= LOG_BASE;
        }

        // i is the index (0 - 6) of the rounding digit.
        // E.g. if within the word 3487563 the first rounding digit is 5,
        // then i = 4, k = 1000, rd = 3487563 % 1000 = 563
        k = mathpow(10, LOG_BASE - i);
        rd = d[di] % k | 0;

        if (repeating == null) {
            if (i < 3) {
                if (i == 0) rd = rd / 100 | 0;
                else if (i == 1) rd = rd / 10 | 0;
                r = rm < 4 && rd == 99999 || rm > 3 && rd == 49999 || rd == 50000 || rd == 0;
            } else {
                r = (rm < 4 && rd + 1 == k || rm > 3 && rd + 1 == k / 2) &&
                    (d[di + 1] / k / 100 | 0) == mathpow(10, i - 2) - 1 ||
                    (rd == k / 2 || rd == 0) && (d[di + 1] / k / 100 | 0) == 0;
            }
        } else {
            if (i < 4) {
                if (i == 0) rd = rd / 1000 | 0;
                else if (i == 1) rd = rd / 100 | 0;
                else if (i == 2) rd = rd / 10 | 0;
                r = (repeating || rm < 4) && rd == 9999 || !repeating && rm > 3 && rd == 4999;
            } else {
                r = ((repeating || rm < 4) && rd + 1 == k ||
                    (!repeating && rm > 3) && rd + 1 == k / 2) &&
                    (d[di + 1] / k / 1000 | 0) == mathpow(10, i - 3) - 1;
            }
        }

        return r
    }


    // Convert string of `baseIn` to an array of numbers of `baseOut`.
    // Eg. convertBase('255', 10, 16) returns [15, 15].
    // Eg. convertBase('ff', 16, 10) returns [2, 5, 5].
    function convertBase(str, baseIn, baseOut) {
        var j,
            arr = [0],
            arrL,
            i = 0,
            strL = str.length;

        for (; i < strL;) {
            for (arrL = arr.length; arrL--;) arr[arrL] *= baseIn;
            arr[0] += NUMERALS.indexOf(str.charAt(i++));
            for (j = 0; j < arr.length; j++) {
                if (arr[j] > baseOut - 1) {
                    if (arr[j + 1] === void 0) arr[j + 1] = 0;
                    arr[j + 1] += arr[j] / baseOut | 0;
                    arr[j] %= baseOut;
                }
            }
        }

        return arr.reverse()
    }


    /*
     * cos(x) = 1 - x^2/2! + x^4/4! - ...
     * |x| < pi/2
     *
     */
    function cosine(Ctor, x) {
        var k, len, y;

        if (x.isZero()) return x

        // Argument reduction: cos(4x) = 8*(cos^4(x) - cos^2(x)) + 1
        // i.e. cos(x) = 8*(cos^4(x/4) - cos^2(x/4)) + 1

        // Estimate the optimum number of times to use the argument reduction.
        len = x.d.length;
        if (len < 32) {
            k = Math.ceil(len / 3);
            y = (1 / tinyPow(4, k)).toString();
        } else {
            k = 16;
            y = '2.3283064365386962890625e-10';
        }

        Ctor.precision += k;

        x = taylorSeries(Ctor, 1, x.times(y), new Ctor(1));

        // Reverse argument reduction
        for (var i = k; i--;) {
            var cos2x = x.times(x);
            x = cos2x.times(cos2x).minus(cos2x).times(8).plus(1);
        }

        Ctor.precision -= k;

        return x
    }


    /*
     * Perform division in the specified base.
     */
    var divide = (function () {

        // Assumes non-zero x and k, and hence non-zero result.
        function multiplyInteger(x, k, base) {
            var temp,
                carry = 0,
                i = x.length;

            for (x = x.slice(); i--;) {
                temp = x[i] * k + carry;
                x[i] = temp % base | 0;
                carry = temp / base | 0;
            }

            if (carry) x.unshift(carry);

            return x
        }

        function compare(a, b, aL, bL) {
            var i, r;

            if (aL != bL) {
                r = aL > bL ? 1 : -1;
            } else {
                for (i = r = 0; i < aL; i++) {
                    if (a[i] != b[i]) {
                        r = a[i] > b[i] ? 1 : -1;
                        break
                    }
                }
            }

            return r
        }

        function subtract(a, b, aL, base) {
            var i = 0;

            // Subtract b from a.
            for (; aL--;) {
                a[aL] -= i;
                i = a[aL] < b[aL] ? 1 : 0;
                a[aL] = i * base + a[aL] - b[aL];
            }

            // Remove leading zeros.
            for (; !a[0] && a.length > 1;) a.shift();
        }

        return function (x, y, pr, rm, dp, base) {
            var cmp, e, i, k, logBase, more, prod, prodL, q, qd, rem, remL, rem0, sd, t, xi, xL, yd0,
                yL, yz,
                Ctor = x.constructor,
                sign = x.s == y.s ? 1 : -1,
                xd = x.d,
                yd = y.d;

            // Either NaN, Infinity or 0?
            if (!xd || !xd[0] || !yd || !yd[0]) {

                return new Ctor(// Return NaN if either NaN, or both Infinity or 0.
                    !x.s || !y.s || (xd ? yd && xd[0] == yd[0] : !yd) ? NaN :

                        // Return ±0 if x is 0 or y is ±Infinity, or return ±Infinity as y is 0.
                        xd && xd[0] == 0 || !yd ? sign * 0 : sign / 0)
            }

            if (base) {
                logBase = 1;
                e = x.e - y.e;
            } else {
                base = BASE;
                logBase = LOG_BASE;
                e = mathfloor(x.e / logBase) - mathfloor(y.e / logBase);
            }

            yL = yd.length;
            xL = xd.length;
            q = new Ctor(sign);
            qd = q.d = [];

            // Result exponent may be one less than e.
            // The digit array of a Decimal from toStringBinary may have trailing zeros.
            for (i = 0; yd[i] == (xd[i] || 0); i++);

            if (yd[i] > (xd[i] || 0)) e--;

            if (pr == null) {
                sd = pr = Ctor.precision;
                rm = Ctor.rounding;
            } else if (dp) {
                sd = pr + (x.e - y.e) + 1;
            } else {
                sd = pr;
            }

            if (sd < 0) {
                qd.push(1);
                more = true;
            } else {

                // Convert precision in number of base 10 digits to base 1e7 digits.
                sd = sd / logBase + 2 | 0;
                i = 0;

                // divisor < 1e7
                if (yL == 1) {
                    k = 0;
                    yd = yd[0];
                    sd++;

                    // k is the carry.
                    for (; (i < xL || k) && sd--; i++) {
                        t = k * base + (xd[i] || 0);
                        qd[i] = t / yd | 0;
                        k = t % yd | 0;
                    }

                    more = k || i < xL;

                    // divisor >= 1e7
                } else {

                    // Normalise xd and yd so highest order digit of yd is >= base/2
                    k = base / (yd[0] + 1) | 0;

                    if (k > 1) {
                        yd = multiplyInteger(yd, k, base);
                        xd = multiplyInteger(xd, k, base);
                        yL = yd.length;
                        xL = xd.length;
                    }

                    xi = yL;
                    rem = xd.slice(0, yL);
                    remL = rem.length;

                    // Add zeros to make remainder as long as divisor.
                    for (; remL < yL;) rem[remL++] = 0;

                    yz = yd.slice();
                    yz.unshift(0);
                    yd0 = yd[0];

                    if (yd[1] >= base / 2) ++yd0;

                    do {
                        k = 0;

                        // Compare divisor and remainder.
                        cmp = compare(yd, rem, yL, remL);

                        // If divisor < remainder.
                        if (cmp < 0) {

                            // Calculate trial digit, k.
                            rem0 = rem[0];
                            if (yL != remL) rem0 = rem0 * base + (rem[1] || 0);

                            // k will be how many times the divisor goes into the current remainder.
                            k = rem0 / yd0 | 0;

                            //  Algorithm:
                            //  1. product = divisor * trial digit (k)
                            //  2. if product > remainder: product -= divisor, k--
                            //  3. remainder -= product
                            //  4. if product was < remainder at 2:
                            //    5. compare new remainder and divisor
                            //    6. If remainder > divisor: remainder -= divisor, k++

                            if (k > 1) {
                                if (k >= base) k = base - 1;

                                // product = divisor * trial digit.
                                prod = multiplyInteger(yd, k, base);
                                prodL = prod.length;
                                remL = rem.length;

                                // Compare product and remainder.
                                cmp = compare(prod, rem, prodL, remL);

                                // product > remainder.
                                if (cmp == 1) {
                                    k--;

                                    // Subtract divisor from product.
                                    subtract(prod, yL < prodL ? yz : yd, prodL, base);
                                }
                            } else {

                                // cmp is -1.
                                // If k is 0, there is no need to compare yd and rem again below, so change cmp to 1
                                // to avoid it. If k is 1 there is a need to compare yd and rem again below.
                                if (k == 0) cmp = k = 1;
                                prod = yd.slice();
                            }

                            prodL = prod.length;
                            if (prodL < remL) prod.unshift(0);

                            // Subtract product from remainder.
                            subtract(rem, prod, remL, base);

                            // If product was < previous remainder.
                            if (cmp == -1) {
                                remL = rem.length;

                                // Compare divisor and new remainder.
                                cmp = compare(yd, rem, yL, remL);

                                // If divisor < new remainder, subtract divisor from remainder.
                                if (cmp < 1) {
                                    k++;

                                    // Subtract divisor from remainder.
                                    subtract(rem, yL < remL ? yz : yd, remL, base);
                                }
                            }

                            remL = rem.length;
                        } else if (cmp === 0) {
                            k++;
                            rem = [0];
                        }    // if cmp === 1, k will be 0

                        // Add the next digit, k, to the result array.
                        qd[i++] = k;

                        // Update the remainder.
                        if (cmp && rem[0]) {
                            rem[remL++] = xd[xi] || 0;
                        } else {
                            rem = [xd[xi]];
                            remL = 1;
                        }

                    } while ((xi++ < xL || rem[0] !== void 0) && sd--)

                    more = rem[0] !== void 0;
                }

                // Leading zero?
                if (!qd[0]) qd.shift();
            }

            // logBase is 1 when divide is being used for base conversion.
            if (logBase == 1) {
                q.e = e;
                inexact = more;
            } else {

                // To calculate q.e, first get the number of digits of qd[0].
                for (i = 1, k = qd[0]; k >= 10; k /= 10) i++;
                q.e = i + e * logBase - 1;

                finalise(q, dp ? pr + q.e + 1 : pr, rm, more);
            }

            return q
        }
    })();


    /*
     * Round `x` to `sd` significant digits using rounding mode `rm`.
     * Check for over/under-flow.
     */
    function finalise(x, sd, rm, isTruncated) {
        var digits, i, j, k, rd, roundUp, w, xd, xdi,
            Ctor = x.constructor;

        // Don't round if sd is null or undefined.
        out: if (sd != null) {
            xd = x.d;

            // Infinity/NaN.
            if (!xd) return x

            // rd: the rounding digit, i.e. the digit after the digit that may be rounded up.
            // w: the word of xd containing rd, a base 1e7 number.
            // xdi: the index of w within xd.
            // digits: the number of digits of w.
            // i: what would be the index of rd within w if all the numbers were 7 digits long (i.e. if
            // they had leading zeros)
            // j: if > 0, the actual index of rd within w (if < 0, rd is a leading zero).

            // Get the length of the first word of the digits array xd.
            for (digits = 1, k = xd[0]; k >= 10; k /= 10) digits++;
            i = sd - digits;

            // Is the rounding digit in the first word of xd?
            if (i < 0) {
                i += LOG_BASE;
                j = sd;
                w = xd[xdi = 0];

                // Get the rounding digit at index j of w.
                rd = w / mathpow(10, digits - j - 1) % 10 | 0;
            } else {
                xdi = Math.ceil((i + 1) / LOG_BASE);
                k = xd.length;
                if (xdi >= k) {
                    if (isTruncated) {

                        // Needed by `naturalExponential`, `naturalLogarithm` and `squareRoot`.
                        for (; k++ <= xdi;) xd.push(0);
                        w = rd = 0;
                        digits = 1;
                        i %= LOG_BASE;
                        j = i - LOG_BASE + 1;
                    } else {
                        break out
                    }
                } else {
                    w = k = xd[xdi];

                    // Get the number of digits of w.
                    for (digits = 1; k >= 10; k /= 10) digits++;

                    // Get the index of rd within w.
                    i %= LOG_BASE;

                    // Get the index of rd within w, adjusted for leading zeros.
                    // The number of leading zeros of w is given by LOG_BASE - digits.
                    j = i - LOG_BASE + digits;

                    // Get the rounding digit at index j of w.
                    rd = j < 0 ? 0 : w / mathpow(10, digits - j - 1) % 10 | 0;
                }
            }

            // Are there any non-zero digits after the rounding digit?
            isTruncated = isTruncated || sd < 0 ||
                xd[xdi + 1] !== void 0 || (j < 0 ? w : w % mathpow(10, digits - j - 1));

            // The expression `w % mathpow(10, digits - j - 1)` returns all the digits of w to the right
            // of the digit at (left-to-right) index j, e.g. if w is 908714 and j is 2, the expression
            // will give 714.

            roundUp = rm < 4
                ? (rd || isTruncated) && (rm == 0 || rm == (x.s < 0 ? 3 : 2))
                : rd > 5 || rd == 5 && (rm == 4 || isTruncated || rm == 6 &&

                    // Check whether the digit to the left of the rounding digit is odd.
                    ((i > 0 ? j > 0 ? w / mathpow(10, digits - j) : 0 : xd[xdi - 1]) % 10) & 1 ||
                    rm == (x.s < 0 ? 8 : 7));

            if (sd < 1 || !xd[0]) {
                xd.length = 0;
                if (roundUp) {

                    // Convert sd to decimal places.
                    sd -= x.e + 1;

                    // 1, 0.1, 0.01, 0.001, 0.0001 etc.
                    xd[0] = mathpow(10, (LOG_BASE - sd % LOG_BASE) % LOG_BASE);
                    x.e = -sd || 0;
                } else {

                    // Zero.
                    xd[0] = x.e = 0;
                }

                return x
            }

            // Remove excess digits.
            if (i == 0) {
                xd.length = xdi;
                k = 1;
                xdi--;
            } else {
                xd.length = xdi + 1;
                k = mathpow(10, LOG_BASE - i);

                // E.g. 56700 becomes 56000 if 7 is the rounding digit.
                // j > 0 means i > number of leading zeros of w.
                xd[xdi] = j > 0 ? (w / mathpow(10, digits - j) % mathpow(10, j) | 0) * k : 0;
            }

            if (roundUp) {
                for (; ;) {

                    // Is the digit to be rounded up in the first word of xd?
                    if (xdi == 0) {

                        // i will be the length of xd[0] before k is added.
                        for (i = 1, j = xd[0]; j >= 10; j /= 10) i++;
                        j = xd[0] += k;
                        for (k = 1; j >= 10; j /= 10) k++;

                        // if i != k the length has increased.
                        if (i != k) {
                            x.e++;
                            if (xd[0] == BASE) xd[0] = 1;
                        }

                        break
                    } else {
                        xd[xdi] += k;
                        if (xd[xdi] != BASE) break
                        xd[xdi--] = 0;
                        k = 1;
                    }
                }
            }

            // Remove trailing zeros.
            for (i = xd.length; xd[--i] === 0;) xd.pop();
        }

        if (external) {

            // Overflow?
            if (x.e > Ctor.maxE) {

                // Infinity.
                x.d = null;
                x.e = NaN;

                // Underflow?
            } else if (x.e < Ctor.minE) {

                // Zero.
                x.e = 0;
                x.d = [0];
                // Ctor.underflow = true;
            } // else Ctor.underflow = false;
        }

        return x
    }


    function finiteToString(x, isExp, sd) {
        if (!x.isFinite()) return nonFiniteToString(x)
        var k,
            e = x.e,
            str = digitsToString(x.d),
            len = str.length;

        if (isExp) {
            if (sd && (k = sd - len) > 0) {
                str = str.charAt(0) + '.' + str.slice(1) + getZeroString(k);
            } else if (len > 1) {
                str = str.charAt(0) + '.' + str.slice(1);
            }

            str = str + (x.e < 0 ? 'e' : 'e+') + x.e;
        } else if (e < 0) {
            str = '0.' + getZeroString(-e - 1) + str;
            if (sd && (k = sd - len) > 0) str += getZeroString(k);
        } else if (e >= len) {
            str += getZeroString(e + 1 - len);
            if (sd && (k = sd - e - 1) > 0) str = str + '.' + getZeroString(k);
        } else {
            if ((k = e + 1) < len) str = str.slice(0, k) + '.' + str.slice(k);
            if (sd && (k = sd - len) > 0) {
                if (e + 1 === len) str += '.';
                str += getZeroString(k);
            }
        }

        return str
    }


    // Calculate the base 10 exponent from the base 1e7 exponent.
    function getBase10Exponent(digits, e) {
        var w = digits[0];

        // Add the number of digits of the first word of the digits array.
        for (e *= LOG_BASE; w >= 10; w /= 10) e++;
        return e
    }


    function getLn10(Ctor, sd, pr) {
        if (sd > LN10_PRECISION) {

            // Reset global state in case the exception is caught.
            external = true;
            if (pr) Ctor.precision = pr;
            throw Error(precisionLimitExceeded)
        }
        return finalise(new Ctor(LN10), sd, 1, true)
    }


    function getPi(Ctor, sd, rm) {
        if (sd > PI_PRECISION) throw Error(precisionLimitExceeded)
        return finalise(new Ctor(PI), sd, rm, true)
    }


    function getPrecision(digits) {
        var w = digits.length - 1,
            len = w * LOG_BASE + 1;

        w = digits[w];

        // If non-zero...
        if (w) {

            // Subtract the number of trailing zeros of the last word.
            for (; w % 10 == 0; w /= 10) len--;

            // Add the number of digits of the first word.
            for (w = digits[0]; w >= 10; w /= 10) len++;
        }

        return len
    }


    function getZeroString(k) {
        var zs = '';
        for (; k--;) zs += '0';
        return zs
    }


    /*
     * Return a new Decimal whose value is the value of Decimal `x` to the power `n`, where `n` is an
     * integer of type number.
     *
     * Implements 'exponentiation by squaring'. Called by `pow` and `parseOther`.
     *
     */
    function intPow(Ctor, x, n, pr) {
        var isTruncated,
            r = new Ctor(1),

            // Max n of 9007199254740991 takes 53 loop iterations.
            // Maximum digits array length; leaves [28, 34] guard digits.
            k = Math.ceil(pr / LOG_BASE + 4);

        external = false;

        for (; ;) {
            if (n % 2) {
                r = r.times(x);
                if (truncate(r.d, k)) isTruncated = true;
            }

            n = mathfloor(n / 2);
            if (n === 0) {

                // To ensure correct rounding when r.d is truncated, increment the last word if it is zero.
                n = r.d.length - 1;
                if (isTruncated && r.d[n] === 0) ++r.d[n];
                break
            }

            x = x.times(x);
            truncate(x.d, k);
        }

        external = true;

        return r
    }


    function isOdd(n) {
        return n.d[n.d.length - 1] & 1
    }


    /*
     * Handle `max` and `min`. `ltgt` is 'lt' or 'gt'.
     */
    function maxOrMin(Ctor, args, ltgt) {
        var y,
            x = new Ctor(args[0]),
            i = 0;

        for (; ++i < args.length;) {
            y = new Ctor(args[i]);
            if (!y.s) {
                x = y;
                break
            } else if (x[ltgt](y)) {
                x = y;
            }
        }

        return x
    }


    /*
     * Return a new Decimal whose value is the natural exponential of `x` rounded to `sd` significant
     * digits.
     *
     * Taylor/Maclaurin series.
     *
     * exp(x) = x^0/0! + x^1/1! + x^2/2! + x^3/3! + ...
     *
     * Argument reduction:
     *   Repeat x = x / 32, k += 5, until |x| < 0.1
     *   exp(x) = exp(x / 2^k)^(2^k)
     *
     * Previously, the argument was initially reduced by
     * exp(x) = exp(r) * 10^k  where r = x - k * ln10, k = floor(x / ln10)
     * to first put r in the range [0, ln10], before dividing by 32 until |x| < 0.1, but this was
     * found to be slower than just dividing repeatedly by 32 as above.
     *
     * Max integer argument: exp('20723265836946413') = 6.3e+9000000000000000
     * Min integer argument: exp('-20723265836946411') = 1.2e-9000000000000000
     * (Math object integer min/max: Math.exp(709) = 8.2e+307, Math.exp(-745) = 5e-324)
     *
     *  exp(Infinity)  = Infinity
     *  exp(-Infinity) = 0
     *  exp(NaN)       = NaN
     *  exp(±0)        = 1
     *
     *  exp(x) is non-terminating for any finite, non-zero x.
     *
     *  The result will always be correctly rounded.
     *
     */
    function naturalExponential(x, sd) {
        var denominator, guard, j, pow, sum, t, wpr,
            rep = 0,
            i = 0,
            k = 0,
            Ctor = x.constructor,
            rm = Ctor.rounding,
            pr = Ctor.precision;

        // 0/NaN/Infinity?
        if (!x.d || !x.d[0] || x.e > 17) {

            return new Ctor(x.d
                ? !x.d[0] ? 1 : x.s < 0 ? 0 : 1 / 0
                : x.s ? x.s < 0 ? 0 : x : 0 / 0)
        }

        if (sd == null) {
            external = false;
            wpr = pr;
        } else {
            wpr = sd;
        }

        t = new Ctor(0.03125);

        // while abs(x) >= 0.1
        while (x.e > -2) {

            // x = x / 2^5
            x = x.times(t);
            k += 5;
        }

        // Use 2 * log10(2^k) + 5 (empirically derived) to estimate the increase in precision
        // necessary to ensure the first 4 rounding digits are correct.
        guard = Math.log(mathpow(2, k)) / Math.LN10 * 2 + 5 | 0;
        wpr += guard;
        denominator = pow = sum = new Ctor(1);
        Ctor.precision = wpr;

        for (; ;) {
            pow = finalise(pow.times(x), wpr, 1);
            denominator = denominator.times(++i);
            t = sum.plus(divide(pow, denominator, wpr, 1));

            if (digitsToString(t.d).slice(0, wpr) === digitsToString(sum.d).slice(0, wpr)) {
                j = k;
                while (j--) sum = finalise(sum.times(sum), wpr, 1);

                // Check to see if the first 4 rounding digits are [49]999.
                // If so, repeat the summation with a higher precision, otherwise
                // e.g. with precision: 18, rounding: 1
                // exp(18.404272462595034083567793919843761) = 98372560.1229999999 (should be 98372560.123)
                // `wpr - guard` is the index of first rounding digit.
                if (sd == null) {

                    if (rep < 3 && checkRoundingDigits(sum.d, wpr - guard, rm, rep)) {
                        Ctor.precision = wpr += 10;
                        denominator = pow = t = new Ctor(1);
                        i = 0;
                        rep++;
                    } else {
                        return finalise(sum, Ctor.precision = pr, rm, external = true)
                    }
                } else {
                    Ctor.precision = pr;
                    return sum
                }
            }

            sum = t;
        }
    }


    /*
     * Return a new Decimal whose value is the natural logarithm of `x` rounded to `sd` significant
     * digits.
     *
     *  ln(-n)        = NaN
     *  ln(0)         = -Infinity
     *  ln(-0)        = -Infinity
     *  ln(1)         = 0
     *  ln(Infinity)  = Infinity
     *  ln(-Infinity) = NaN
     *  ln(NaN)       = NaN
     *
     *  ln(n) (n != 1) is non-terminating.
     *
     */
    function naturalLogarithm(y, sd) {
        var c, c0, denominator, e, numerator, rep, sum, t, wpr, x1, x2,
            n = 1,
            guard = 10,
            x = y,
            xd = x.d,
            Ctor = x.constructor,
            rm = Ctor.rounding,
            pr = Ctor.precision;

        // Is x negative or Infinity, NaN, 0 or 1?
        if (x.s < 0 || !xd || !xd[0] || !x.e && xd[0] == 1 && xd.length == 1) {
            return new Ctor(xd && !xd[0] ? -1 / 0 : x.s != 1 ? NaN : xd ? 0 : x)
        }

        if (sd == null) {
            external = false;
            wpr = pr;
        } else {
            wpr = sd;
        }

        Ctor.precision = wpr += guard;
        c = digitsToString(xd);
        c0 = c.charAt(0);

        if (Math.abs(e = x.e) < 1.5e15) {

            // Argument reduction.
            // The series converges faster the closer the argument is to 1, so using
            // ln(a^b) = b * ln(a),   ln(a) = ln(a^b) / b
            // multiply the argument by itself until the leading digits of the significand are 7, 8, 9,
            // 10, 11, 12 or 13, recording the number of multiplications so the sum of the series can
            // later be divided by this number, then separate out the power of 10 using
            // ln(a*10^b) = ln(a) + b*ln(10).

            // max n is 21 (gives 0.9, 1.0 or 1.1) (9e15 / 21 = 4.2e14).
            //while (c0 < 9 && c0 != 1 || c0 == 1 && c.charAt(1) > 1) {
            // max n is 6 (gives 0.7 - 1.3)
            while (c0 < 7 && c0 != 1 || c0 == 1 && c.charAt(1) > 3) {
                x = x.times(y);
                c = digitsToString(x.d);
                c0 = c.charAt(0);
                n++;
            }

            e = x.e;

            if (c0 > 1) {
                x = new Ctor('0.' + c);
                e++;
            } else {
                x = new Ctor(c0 + '.' + c.slice(1));
            }
        } else {

            // The argument reduction method above may result in overflow if the argument y is a massive
            // number with exponent >= 1500000000000000 (9e15 / 6 = 1.5e15), so instead recall this
            // function using ln(x*10^e) = ln(x) + e*ln(10).
            t = getLn10(Ctor, wpr + 2, pr).times(e + '');
            x = naturalLogarithm(new Ctor(c0 + '.' + c.slice(1)), wpr - guard).plus(t);
            Ctor.precision = pr;

            return sd == null ? finalise(x, pr, rm, external = true) : x
        }

        // x1 is x reduced to a value near 1.
        x1 = x;

        // Taylor series.
        // ln(y) = ln((1 + x)/(1 - x)) = 2(x + x^3/3 + x^5/5 + x^7/7 + ...)
        // where x = (y - 1)/(y + 1)    (|x| < 1)
        sum = numerator = x = divide(x.minus(1), x.plus(1), wpr, 1);
        x2 = finalise(x.times(x), wpr, 1);
        denominator = 3;

        for (; ;) {
            numerator = finalise(numerator.times(x2), wpr, 1);
            t = sum.plus(divide(numerator, new Ctor(denominator), wpr, 1));

            if (digitsToString(t.d).slice(0, wpr) === digitsToString(sum.d).slice(0, wpr)) {
                sum = sum.times(2);

                // Reverse the argument reduction. Check that e is not 0 because, besides preventing an
                // unnecessary calculation, -0 + 0 = +0 and to ensure correct rounding -0 needs to stay -0.
                if (e !== 0) sum = sum.plus(getLn10(Ctor, wpr + 2, pr).times(e + ''));
                sum = divide(sum, new Ctor(n), wpr, 1);

                // Is rm > 3 and the first 4 rounding digits 4999, or rm < 4 (or the summation has
                // been repeated previously) and the first 4 rounding digits 9999?
                // If so, restart the summation with a higher precision, otherwise
                // e.g. with precision: 12, rounding: 1
                // ln(135520028.6126091714265381533) = 18.7246299999 when it should be 18.72463.
                // `wpr - guard` is the index of first rounding digit.
                if (sd == null) {
                    if (checkRoundingDigits(sum.d, wpr - guard, rm, rep)) {
                        Ctor.precision = wpr += guard;
                        t = numerator = x = divide(x1.minus(1), x1.plus(1), wpr, 1);
                        x2 = finalise(x.times(x), wpr, 1);
                        denominator = rep = 1;
                    } else {
                        return finalise(sum, Ctor.precision = pr, rm, external = true)
                    }
                } else {
                    Ctor.precision = pr;
                    return sum
                }
            }

            sum = t;
            denominator += 2;
        }
    }


    // ±Infinity, NaN.
    function nonFiniteToString(x) {
        // Unsigned.
        return String(x.s * x.s / 0)
    }


    /*
     * Parse the value of a new Decimal `x` from string `str`.
     */
    function parseDecimal(x, str) {
        var e, i, len;

        // Decimal point?
        if ((e = str.indexOf('.')) > -1) str = str.replace('.', '');

        // Exponential form?
        if ((i = str.search(/e/i)) > 0) {

            // Determine exponent.
            if (e < 0) e = i;
            e += +str.slice(i + 1);
            str = str.substring(0, i);
        } else if (e < 0) {

            // Integer.
            e = str.length;
        }

        // Determine leading zeros.
        for (i = 0; str.charCodeAt(i) === 48; i++);

        // Determine trailing zeros.
        for (len = str.length; str.charCodeAt(len - 1) === 48; --len);
        str = str.slice(i, len);

        if (str) {
            len -= i;
            x.e = e = e - i - 1;
            x.d = [];

            // Transform base

            // e is the base 10 exponent.
            // i is where to slice str to get the first word of the digits array.
            i = (e + 1) % LOG_BASE;
            if (e < 0) i += LOG_BASE;

            if (i < len) {
                if (i) x.d.push(+str.slice(0, i));
                for (len -= LOG_BASE; i < len;) x.d.push(+str.slice(i, i += LOG_BASE));
                str = str.slice(i);
                i = LOG_BASE - str.length;
            } else {
                i -= len;
            }

            for (; i--;) str += '0';
            x.d.push(+str);

            if (external) {

                // Overflow?
                if (x.e > x.constructor.maxE) {

                    // Infinity.
                    x.d = null;
                    x.e = NaN;

                    // Underflow?
                } else if (x.e < x.constructor.minE) {

                    // Zero.
                    x.e = 0;
                    x.d = [0];
                    // x.constructor.underflow = true;
                } // else x.constructor.underflow = false;
            }
        } else {

            // Zero.
            x.e = 0;
            x.d = [0];
        }

        return x
    }


    /*
     * Parse the value of a new Decimal `x` from a string `str`, which is not a decimal value.
     */
    function parseOther(x, str) {
        var base, Ctor, divisor, i, isFloat, len, p, xd, xe;

        if (str.indexOf('_') > -1) {
            str = str.replace(/(\d)_(?=\d)/g, '$1');
            if (isDecimal.test(str)) return parseDecimal(x, str)
        } else if (str === 'Infinity' || str === 'NaN') {
            if (!+str) x.s = NaN;
            x.e = NaN;
            x.d = null;
            return x
        }

        if (isHex.test(str)) {
            base = 16;
            str = str.toLowerCase();
        } else if (isBinary.test(str)) {
            base = 2;
        } else if (isOctal.test(str)) {
            base = 8;
        } else {
            throw Error(invalidArgument + str)
        }

        // Is there a binary exponent part?
        i = str.search(/p/i);

        if (i > 0) {
            p = +str.slice(i + 1);
            str = str.substring(2, i);
        } else {
            str = str.slice(2);
        }

        // Convert `str` as an integer then divide the result by `base` raised to a power such that the
        // fraction part will be restored.
        i = str.indexOf('.');
        isFloat = i >= 0;
        Ctor = x.constructor;

        if (isFloat) {
            str = str.replace('.', '');
            len = str.length;
            i = len - i;

            // log[10](16) = 1.2041... , log[10](88) = 1.9444....
            divisor = intPow(Ctor, new Ctor(base), i, i * 2);
        }

        xd = convertBase(str, base, BASE);
        xe = xd.length - 1;

        // Remove trailing zeros.
        for (i = xe; xd[i] === 0; --i) xd.pop();
        if (i < 0) return new Ctor(x.s * 0)
        x.e = getBase10Exponent(xd, xe);
        x.d = xd;
        external = false;

        // At what precision to perform the division to ensure exact conversion?
        // maxDecimalIntegerPartDigitCount = ceil(log[10](b) * otherBaseIntegerPartDigitCount)
        // log[10](2) = 0.30103, log[10](8) = 0.90309, log[10](16) = 1.20412
        // E.g. ceil(1.2 * 3) = 4, so up to 4 decimal digits are needed to represent 3 hex int digits.
        // maxDecimalFractionPartDigitCount = {Hex:4|Oct:3|Bin:1} * otherBaseFractionPartDigitCount
        // Therefore using 4 * the number of digits of str will always be enough.
        if (isFloat) x = divide(x, divisor, len * 4);

        // Multiply by the binary exponent part if present.
        if (p) x = x.times(Math.abs(p) < 54 ? mathpow(2, p) : Decimal.pow(2, p));
        external = true;

        return x
    }


    /*
     * sin(x) = x - x^3/3! + x^5/5! - ...
     * |x| < pi/2
     *
     */
    function sine(Ctor, x) {
        var k,
            len = x.d.length;

        if (len < 3) {
            return x.isZero() ? x : taylorSeries(Ctor, 2, x, x)
        }

        // Argument reduction: sin(5x) = 16*sin^5(x) - 20*sin^3(x) + 5*sin(x)
        // i.e. sin(x) = 16*sin^5(x/5) - 20*sin^3(x/5) + 5*sin(x/5)
        // and  sin(x) = sin(x/5)(5 + sin^2(x/5)(16sin^2(x/5) - 20))

        // Estimate the optimum number of times to use the argument reduction.
        k = 1.4 * Math.sqrt(len);
        k = k > 16 ? 16 : k | 0;

        x = x.times(1 / tinyPow(5, k));
        x = taylorSeries(Ctor, 2, x, x);

        // Reverse argument reduction
        var sin2_x,
            d5 = new Ctor(5),
            d16 = new Ctor(16),
            d20 = new Ctor(20);
        for (; k--;) {
            sin2_x = x.times(x);
            x = x.times(d5.plus(sin2_x.times(d16.times(sin2_x).minus(d20))));
        }

        return x
    }


    // Calculate Taylor series for `cos`, `cosh`, `sin` and `sinh`.
    function taylorSeries(Ctor, n, x, y, isHyperbolic) {
        var j, t, u, x2,
            pr = Ctor.precision,
            k = Math.ceil(pr / LOG_BASE);

        external = false;
        x2 = x.times(x);
        u = new Ctor(y);

        for (; ;) {
            t = divide(u.times(x2), new Ctor(n++ * n++), pr, 1);
            u = isHyperbolic ? y.plus(t) : y.minus(t);
            y = divide(t.times(x2), new Ctor(n++ * n++), pr, 1);
            t = u.plus(y);

            if (t.d[k] !== void 0) {
                for (j = k; t.d[j] === u.d[j] && j--;);
                if (j == -1) break
            }

            j = u;
            u = y;
            y = t;
            t = j;
        }

        external = true;
        t.d.length = k + 1;

        return t
    }


    // Exponent e must be positive and non-zero.
    function tinyPow(b, e) {
        var n = b;
        while (--e) n *= b;
        return n
    }


    // Return the absolute value of `x` reduced to less than or equal to half pi.
    function toLessThanHalfPi(Ctor, x) {
        var t,
            isNeg = x.s < 0,
            pi = getPi(Ctor, Ctor.precision, 1),
            halfPi = pi.times(0.5);

        x = x.abs();

        if (x.lte(halfPi)) {
            quadrant = isNeg ? 4 : 1;
            return x
        }

        t = x.divToInt(pi);

        if (t.isZero()) {
            quadrant = isNeg ? 3 : 2;
        } else {
            x = x.minus(t.times(pi));

            // 0 <= x < pi
            if (x.lte(halfPi)) {
                quadrant = isOdd(t) ? (isNeg ? 2 : 3) : (isNeg ? 4 : 1);
                return x
            }

            quadrant = isOdd(t) ? (isNeg ? 1 : 4) : (isNeg ? 3 : 2);
        }

        return x.minus(pi).abs()
    }


    /*
     * Return the value of Decimal `x` as a string in base `baseOut`.
     *
     * If the optional `sd` argument is present include a binary exponent suffix.
     */
    function toStringBinary(x, baseOut, sd, rm) {
        var base, e, i, k, len, roundUp, str, xd, y,
            Ctor = x.constructor,
            isExp = sd !== void 0;

        if (isExp) {
            checkInt32(sd, 1, MAX_DIGITS);
            if (rm === void 0) rm = Ctor.rounding;
            else checkInt32(rm, 0, 8);
        } else {
            sd = Ctor.precision;
            rm = Ctor.rounding;
        }

        if (!x.isFinite()) {
            str = nonFiniteToString(x);
        } else {
            str = finiteToString(x);
            i = str.indexOf('.');

            // Use exponential notation according to `toExpPos` and `toExpNeg`? No, but if required:
            // maxBinaryExponent = floor((decimalExponent + 1) * log[2](10))
            // minBinaryExponent = floor(decimalExponent * log[2](10))
            // log[2](10) = 3.321928094887362347870319429489390175864

            if (isExp) {
                base = 2;
                if (baseOut == 16) {
                    sd = sd * 4 - 3;
                } else if (baseOut == 8) {
                    sd = sd * 3 - 2;
                }
            } else {
                base = baseOut;
            }

            // Convert the number as an integer then divide the result by its base raised to a power such
            // that the fraction part will be restored.

            // Non-integer.
            if (i >= 0) {
                str = str.replace('.', '');
                y = new Ctor(1);
                y.e = str.length - i;
                y.d = convertBase(finiteToString(y), 10, base);
                y.e = y.d.length;
            }

            xd = convertBase(str, 10, base);
            e = len = xd.length;

            // Remove trailing zeros.
            for (; xd[--len] == 0;) xd.pop();

            if (!xd[0]) {
                str = isExp ? '0p+0' : '0';
            } else {
                if (i < 0) {
                    e--;
                } else {
                    x = new Ctor(x);
                    x.d = xd;
                    x.e = e;
                    x = divide(x, y, sd, rm, 0, base);
                    xd = x.d;
                    e = x.e;
                    roundUp = inexact;
                }

                // The rounding digit, i.e. the digit after the digit that may be rounded up.
                i = xd[sd];
                k = base / 2;
                roundUp = roundUp || xd[sd + 1] !== void 0;

                roundUp = rm < 4
                    ? (i !== void 0 || roundUp) && (rm === 0 || rm === (x.s < 0 ? 3 : 2))
                    : i > k || i === k && (rm === 4 || roundUp || rm === 6 && xd[sd - 1] & 1 ||
                        rm === (x.s < 0 ? 8 : 7));

                xd.length = sd;

                if (roundUp) {

                    // Rounding up may mean the previous digit has to be rounded up and so on.
                    for (; ++xd[--sd] > base - 1;) {
                        xd[sd] = 0;
                        if (!sd) {
                            ++e;
                            xd.unshift(1);
                        }
                    }
                }

                // Determine trailing zeros.
                for (len = xd.length; !xd[len - 1]; --len);

                // E.g. [4, 11, 15] becomes 4bf.
                for (i = 0, str = ''; i < len; i++) str += NUMERALS.charAt(xd[i]);

                // Add binary exponent suffix?
                if (isExp) {
                    if (len > 1) {
                        if (baseOut == 16 || baseOut == 8) {
                            i = baseOut == 16 ? 4 : 3;
                            for (--len; len % i; len++) str += '0';
                            xd = convertBase(str, base, baseOut);
                            for (len = xd.length; !xd[len - 1]; --len);

                            // xd[0] will always be be 1
                            for (i = 1, str = '1.'; i < len; i++) str += NUMERALS.charAt(xd[i]);
                        } else {
                            str = str.charAt(0) + '.' + str.slice(1);
                        }
                    }

                    str = str + (e < 0 ? 'p' : 'p+') + e;
                } else if (e < 0) {
                    for (; ++e;) str = '0' + str;
                    str = '0.' + str;
                } else {
                    if (++e > len) for (e -= len; e--;) str += '0';
                    else if (e < len) str = str.slice(0, e) + '.' + str.slice(e);
                }
            }

            str = (baseOut == 16 ? '0x' : baseOut == 2 ? '0b' : baseOut == 8 ? '0o' : '') + str;
        }

        return x.s < 0 ? '-' + str : str
    }


    // Does not strip trailing zeros.
    function truncate(arr, len) {
        if (arr.length > len) {
            arr.length = len;
            return true
        }
    }


    // Decimal methods


    /*
     *  abs
     *  acos
     *  acosh
     *  add
     *  asin
     *  asinh
     *  atan
     *  atanh
     *  atan2
     *  cbrt
     *  ceil
     *  clamp
     *  clone
     *  config
     *  cos
     *  cosh
     *  div
     *  exp
     *  floor
     *  hypot
     *  ln
     *  log
     *  log2
     *  log10
     *  max
     *  min
     *  mod
     *  mul
     *  pow
     *  random
     *  round
     *  set
     *  sign
     *  sin
     *  sinh
     *  sqrt
     *  sub
     *  sum
     *  tan
     *  tanh
     *  trunc
     */


    /*
     * Return a new Decimal whose value is the absolute value of `x`.
     *
     * x {number|string|Decimal}
     *
     */
    function abs(x) {
        return new this(x).abs()
    }


    /*
     * Return a new Decimal whose value is the arccosine in radians of `x`.
     *
     * x {number|string|Decimal}
     *
     */
    function acos(x) {
        return new this(x).acos()
    }


    /*
     * Return a new Decimal whose value is the inverse of the hyperbolic cosine of `x`, rounded to
     * `precision` significant digits using rounding mode `rounding`.
     *
     * x {number|string|Decimal} A value in radians.
     *
     */
    function acosh(x) {
        return new this(x).acosh()
    }


    /*
     * Return a new Decimal whose value is the sum of `x` and `y`, rounded to `precision` significant
     * digits using rounding mode `rounding`.
     *
     * x {number|string|Decimal}
     * y {number|string|Decimal}
     *
     */
    function add(x, y) {
        return new this(x).plus(y)
    }


    /*
     * Return a new Decimal whose value is the arcsine in radians of `x`, rounded to `precision`
     * significant digits using rounding mode `rounding`.
     *
     * x {number|string|Decimal}
     *
     */
    function asin(x) {
        return new this(x).asin()
    }


    /*
     * Return a new Decimal whose value is the inverse of the hyperbolic sine of `x`, rounded to
     * `precision` significant digits using rounding mode `rounding`.
     *
     * x {number|string|Decimal} A value in radians.
     *
     */
    function asinh(x) {
        return new this(x).asinh()
    }


    /*
     * Return a new Decimal whose value is the arctangent in radians of `x`, rounded to `precision`
     * significant digits using rounding mode `rounding`.
     *
     * x {number|string|Decimal}
     *
     */
    function atan(x) {
        return new this(x).atan()
    }


    /*
     * Return a new Decimal whose value is the inverse of the hyperbolic tangent of `x`, rounded to
     * `precision` significant digits using rounding mode `rounding`.
     *
     * x {number|string|Decimal} A value in radians.
     *
     */
    function atanh(x) {
        return new this(x).atanh()
    }


    /*
     * Return a new Decimal whose value is the arctangent in radians of `y/x` in the range -pi to pi
     * (inclusive), rounded to `precision` significant digits using rounding mode `rounding`.
     *
     * Domain: [-Infinity, Infinity]
     * Range: [-pi, pi]
     *
     * y {number|string|Decimal} The y-coordinate.
     * x {number|string|Decimal} The x-coordinate.
     *
     * atan2(±0, -0)               = ±pi
     * atan2(±0, +0)               = ±0
     * atan2(±0, -x)               = ±pi for x > 0
     * atan2(±0, x)                = ±0 for x > 0
     * atan2(-y, ±0)               = -pi/2 for y > 0
     * atan2(y, ±0)                = pi/2 for y > 0
     * atan2(±y, -Infinity)        = ±pi for finite y > 0
     * atan2(±y, +Infinity)        = ±0 for finite y > 0
     * atan2(±Infinity, x)         = ±pi/2 for finite x
     * atan2(±Infinity, -Infinity) = ±3*pi/4
     * atan2(±Infinity, +Infinity) = ±pi/4
     * atan2(NaN, x) = NaN
     * atan2(y, NaN) = NaN
     *
     */
    function atan2(y, x) {
        y = new this(y);
        x = new this(x);
        var r,
            pr = this.precision,
            rm = this.rounding,
            wpr = pr + 4;

        // Either NaN
        if (!y.s || !x.s) {
            r = new this(NaN);

            // Both ±Infinity
        } else if (!y.d && !x.d) {
            r = getPi(this, wpr, 1).times(x.s > 0 ? 0.25 : 0.75);
            r.s = y.s;

            // x is ±Infinity or y is ±0
        } else if (!x.d || y.isZero()) {
            r = x.s < 0 ? getPi(this, pr, rm) : new this(0);
            r.s = y.s;

            // y is ±Infinity or x is ±0
        } else if (!y.d || x.isZero()) {
            r = getPi(this, wpr, 1).times(0.5);
            r.s = y.s;

            // Both non-zero and finite
        } else if (x.s < 0) {
            this.precision = wpr;
            this.rounding = 1;
            r = this.atan(divide(y, x, wpr, 1));
            x = getPi(this, wpr, 1);
            this.precision = pr;
            this.rounding = rm;
            r = y.s < 0 ? r.minus(x) : r.plus(x);
        } else {
            r = this.atan(divide(y, x, wpr, 1));
        }

        return r
    }


    /*
     * Return a new Decimal whose value is the cube root of `x`, rounded to `precision` significant
     * digits using rounding mode `rounding`.
     *
     * x {number|string|Decimal}
     *
     */
    function cbrt(x) {
        return new this(x).cbrt()
    }


    /*
     * Return a new Decimal whose value is `x` rounded to an integer using `ROUND_CEIL`.
     *
     * x {number|string|Decimal}
     *
     */
    function ceil(x) {
        return finalise(x = new this(x), x.e + 1, 2)
    }


    /*
     * Return a new Decimal whose value is `x` clamped to the range delineated by `min` and `max`.
     *
     * x {number|string|Decimal}
     * min {number|string|Decimal}
     * max {number|string|Decimal}
     *
     */
    function clamp(x, min, max) {
        return new this(x).clamp(min, max)
    }


    /*
     * Configure global settings for a Decimal constructor.
     *
     * `obj` is an object with one or more of the following properties,
     *
     *   precision  {number}
     *   rounding   {number}
     *   toExpNeg   {number}
     *   toExpPos   {number}
     *   maxE       {number}
     *   minE       {number}
     *   modulo     {number}
     *   crypto     {boolean|number}
     *   defaults   {true}
     *
     * E.g. Decimal.config({ precision: 20, rounding: 4 })
     *
     */
    function config(obj) {
        if (!obj || typeof obj !== 'object') throw Error(decimalError + 'Object expected')
        var i, p, v,
            useDefaults = obj.defaults === true,
            ps = [
                'precision', 1, MAX_DIGITS,
                'rounding', 0, 8,
                'toExpNeg', -EXP_LIMIT, 0,
                'toExpPos', 0, EXP_LIMIT,
                'maxE', 0, EXP_LIMIT,
                'minE', -EXP_LIMIT, 0,
                'modulo', 0, 9
            ];

        for (i = 0; i < ps.length; i += 3) {
            if (p = ps[i], useDefaults) this[p] = DEFAULTS[p];
            if ((v = obj[p]) !== void 0) {
                if (mathfloor(v) === v && v >= ps[i + 1] && v <= ps[i + 2]) this[p] = v;
                else throw Error(invalidArgument + p + ': ' + v)
            }
        }

        if (p = 'crypto', useDefaults) this[p] = DEFAULTS[p];
        if ((v = obj[p]) !== void 0) {
            if (v === true || v === false || v === 0 || v === 1) {
                if (v) {
                    if (typeof crypto != 'undefined' && crypto &&
                        (crypto.getRandomValues || crypto.randomBytes)) {
                        this[p] = true;
                    } else {
                        throw Error(cryptoUnavailable)
                    }
                } else {
                    this[p] = false;
                }
            } else {
                throw Error(invalidArgument + p + ': ' + v)
            }
        }

        return this
    }


    /*
     * Return a new Decimal whose value is the cosine of `x`, rounded to `precision` significant
     * digits using rounding mode `rounding`.
     *
     * x {number|string|Decimal} A value in radians.
     *
     */
    function cos(x) {
        return new this(x).cos()
    }


    /*
     * Return a new Decimal whose value is the hyperbolic cosine of `x`, rounded to precision
     * significant digits using rounding mode `rounding`.
     *
     * x {number|string|Decimal} A value in radians.
     *
     */
    function cosh(x) {
        return new this(x).cosh()
    }


    /*
     * Create and return a Decimal constructor with the same configuration properties as this Decimal
     * constructor.
     *
     */
    function clone(obj) {
        var i, p, ps;

        /*
         * The Decimal constructor and exported function.
         * Return a new Decimal instance.
         *
         * v {number|string|Decimal} A numeric value.
         *
         */
        function Decimal(v) {
            var e, i, t,
                x = this;

            // Decimal called without new.
            if (!(x instanceof Decimal)) return new Decimal(v)

            // Retain a reference to this Decimal constructor, and shadow Decimal.prototype.constructor
            // which points to Object.
            x.constructor = Decimal;

            // Duplicate.
            if (isDecimalInstance(v)) {
                x.s = v.s;

                if (external) {
                    if (!v.d || v.e > Decimal.maxE) {

                        // Infinity.
                        x.e = NaN;
                        x.d = null;
                    } else if (v.e < Decimal.minE) {

                        // Zero.
                        x.e = 0;
                        x.d = [0];
                    } else {
                        x.e = v.e;
                        x.d = v.d.slice();
                    }
                } else {
                    x.e = v.e;
                    x.d = v.d ? v.d.slice() : v.d;
                }

                return
            }

            t = typeof v;

            if (t === 'number') {
                if (v === 0) {
                    x.s = 1 / v < 0 ? -1 : 1;
                    x.e = 0;
                    x.d = [0];
                    return
                }

                if (v < 0) {
                    v = -v;
                    x.s = -1;
                } else {
                    x.s = 1;
                }

                // Fast path for small integers.
                if (v === ~~v && v < 1e7) {
                    for (e = 0, i = v; i >= 10; i /= 10) e++;

                    if (external) {
                        if (e > Decimal.maxE) {
                            x.e = NaN;
                            x.d = null;
                        } else if (e < Decimal.minE) {
                            x.e = 0;
                            x.d = [0];
                        } else {
                            x.e = e;
                            x.d = [v];
                        }
                    } else {
                        x.e = e;
                        x.d = [v];
                    }

                    return

                    // Infinity, NaN.
                } else if (v * 0 !== 0) {
                    if (!v) x.s = NaN;
                    x.e = NaN;
                    x.d = null;
                    return
                }

                return parseDecimal(x, v.toString())

            } else if (t !== 'string') {
                throw Error(invalidArgument + v)
            }

            // Minus sign?
            if ((i = v.charCodeAt(0)) === 45) {
                v = v.slice(1);
                x.s = -1;
            } else {
                // Plus sign?
                if (i === 43) v = v.slice(1);
                x.s = 1;
            }

            return isDecimal.test(v) ? parseDecimal(x, v) : parseOther(x, v)
        }

        Decimal.prototype = P;

        Decimal.ROUND_UP = 0;
        Decimal.ROUND_DOWN = 1;
        Decimal.ROUND_CEIL = 2;
        Decimal.ROUND_FLOOR = 3;
        Decimal.ROUND_HALF_UP = 4;
        Decimal.ROUND_HALF_DOWN = 5;
        Decimal.ROUND_HALF_EVEN = 6;
        Decimal.ROUND_HALF_CEIL = 7;
        Decimal.ROUND_HALF_FLOOR = 8;
        Decimal.EUCLID = 9;

        Decimal.config = Decimal.set = config;
        Decimal.clone = clone;
        Decimal.isDecimal = isDecimalInstance;

        Decimal.abs = abs;
        Decimal.acos = acos;
        Decimal.acosh = acosh;        // ES6
        Decimal.add = add;
        Decimal.asin = asin;
        Decimal.asinh = asinh;        // ES6
        Decimal.atan = atan;
        Decimal.atanh = atanh;        // ES6
        Decimal.atan2 = atan2;
        Decimal.cbrt = cbrt;          // ES6
        Decimal.ceil = ceil;
        Decimal.clamp = clamp;
        Decimal.cos = cos;
        Decimal.cosh = cosh;          // ES6
        Decimal.div = div;
        Decimal.exp = exp;
        Decimal.floor = floor;
        Decimal.hypot = hypot;        // ES6
        Decimal.ln = ln;
        Decimal.log = log;
        Decimal.log10 = log10;        // ES6
        Decimal.log2 = log2;          // ES6
        Decimal.max = max;
        Decimal.min = min;
        Decimal.mod = mod;
        Decimal.mul = mul;
        Decimal.pow = pow;
        Decimal.random = random;
        Decimal.round = round;
        Decimal.sign = sign;          // ES6
        Decimal.sin = sin;
        Decimal.sinh = sinh;          // ES6
        Decimal.sqrt = sqrt;
        Decimal.sub = sub;
        Decimal.sum = sum;
        Decimal.tan = tan;
        Decimal.tanh = tanh;          // ES6
        Decimal.trunc = trunc;        // ES6

        if (obj === void 0) obj = {};
        if (obj) {
            if (obj.defaults !== true) {
                ps = ['precision', 'rounding', 'toExpNeg', 'toExpPos', 'maxE', 'minE', 'modulo', 'crypto'];
                for (i = 0; i < ps.length;) if (!obj.hasOwnProperty(p = ps[i++])) obj[p] = this[p];
            }
        }

        Decimal.config(obj);

        return Decimal
    }


    /*
     * Return a new Decimal whose value is `x` divided by `y`, rounded to `precision` significant
     * digits using rounding mode `rounding`.
     *
     * x {number|string|Decimal}
     * y {number|string|Decimal}
     *
     */
    function div(x, y) {
        return new this(x).div(y)
    }


    /*
     * Return a new Decimal whose value is the natural exponential of `x`, rounded to `precision`
     * significant digits using rounding mode `rounding`.
     *
     * x {number|string|Decimal} The power to which to raise the base of the natural log.
     *
     */
    function exp(x) {
        return new this(x).exp()
    }


    /*
     * Return a new Decimal whose value is `x` round to an integer using `ROUND_FLOOR`.
     *
     * x {number|string|Decimal}
     *
     */
    function floor(x) {
        return finalise(x = new this(x), x.e + 1, 3)
    }


    /*
     * Return a new Decimal whose value is the square root of the sum of the squares of the arguments,
     * rounded to `precision` significant digits using rounding mode `rounding`.
     *
     * hypot(a, b, ...) = sqrt(a^2 + b^2 + ...)
     *
     * arguments {number|string|Decimal}
     *
     */
    function hypot() {
        var i, n,
            t = new this(0);

        external = false;

        for (i = 0; i < arguments.length;) {
            n = new this(arguments[i++]);
            if (!n.d) {
                if (n.s) {
                    external = true;
                    return new this(1 / 0)
                }
                t = n;
            } else if (t.d) {
                t = t.plus(n.times(n));
            }
        }

        external = true;

        return t.sqrt()
    }


    /*
     * Return true if object is a Decimal instance (where Decimal is any Decimal constructor),
     * otherwise return false.
     *
     */
    function isDecimalInstance(obj) {
        return obj instanceof Decimal || obj && obj.toStringTag === tag || false
    }


    /*
     * Return a new Decimal whose value is the natural logarithm of `x`, rounded to `precision`
     * significant digits using rounding mode `rounding`.
     *
     * x {number|string|Decimal}
     *
     */
    function ln(x) {
        return new this(x).ln()
    }


    /*
     * Return a new Decimal whose value is the log of `x` to the base `y`, or to base 10 if no base
     * is specified, rounded to `precision` significant digits using rounding mode `rounding`.
     *
     * log[y](x)
     *
     * x {number|string|Decimal} The argument of the logarithm.
     * y {number|string|Decimal} The base of the logarithm.
     *
     */
    function log(x, y) {
        return new this(x).log(y)
    }


    /*
     * Return a new Decimal whose value is the base 2 logarithm of `x`, rounded to `precision`
     * significant digits using rounding mode `rounding`.
     *
     * x {number|string|Decimal}
     *
     */
    function log2(x) {
        return new this(x).log(2)
    }


    /*
     * Return a new Decimal whose value is the base 10 logarithm of `x`, rounded to `precision`
     * significant digits using rounding mode `rounding`.
     *
     * x {number|string|Decimal}
     *
     */
    function log10(x) {
        return new this(x).log(10)
    }


    /*
     * Return a new Decimal whose value is the maximum of the arguments.
     *
     * arguments {number|string|Decimal}
     *
     */
    function max() {
        return maxOrMin(this, arguments, 'lt')
    }


    /*
     * Return a new Decimal whose value is the minimum of the arguments.
     *
     * arguments {number|string|Decimal}
     *
     */
    function min() {
        return maxOrMin(this, arguments, 'gt')
    }


    /*
     * Return a new Decimal whose value is `x` modulo `y`, rounded to `precision` significant digits
     * using rounding mode `rounding`.
     *
     * x {number|string|Decimal}
     * y {number|string|Decimal}
     *
     */
    function mod(x, y) {
        return new this(x).mod(y)
    }


    /*
     * Return a new Decimal whose value is `x` multiplied by `y`, rounded to `precision` significant
     * digits using rounding mode `rounding`.
     *
     * x {number|string|Decimal}
     * y {number|string|Decimal}
     *
     */
    function mul(x, y) {
        return new this(x).mul(y)
    }


    /*
     * Return a new Decimal whose value is `x` raised to the power `y`, rounded to precision
     * significant digits using rounding mode `rounding`.
     *
     * x {number|string|Decimal} The base.
     * y {number|string|Decimal} The exponent.
     *
     */
    function pow(x, y) {
        return new this(x).pow(y)
    }


    /*
     * Returns a new Decimal with a random value equal to or greater than 0 and less than 1, and with
     * `sd`, or `Decimal.precision` if `sd` is omitted, significant digits (or less if trailing zeros
     * are produced).
     *
     * [sd] {number} Significant digits. Integer, 0 to MAX_DIGITS inclusive.
     *
     */
    function random(sd) {
        var d, e, k, n,
            i = 0,
            r = new this(1),
            rd = [];

        if (sd === void 0) sd = this.precision;
        else checkInt32(sd, 1, MAX_DIGITS);

        k = Math.ceil(sd / LOG_BASE);

        if (!this.crypto) {
            for (; i < k;) rd[i++] = Math.random() * 1e7 | 0;

            // Browsers supporting crypto.getRandomValues.
        } else if (crypto.getRandomValues) {
            d = crypto.getRandomValues(new Uint32Array(k));

            for (; i < k;) {
                n = d[i];

                // 0 <= n < 4294967296
                // Probability n >= 4.29e9, is 4967296 / 4294967296 = 0.00116 (1 in 865).
                if (n >= 4.29e9) {
                    d[i] = crypto.getRandomValues(new Uint32Array(1))[0];
                } else {

                    // 0 <= n <= 4289999999
                    // 0 <= (n % 1e7) <= 9999999
                    rd[i++] = n % 1e7;
                }
            }

            // Node.js supporting crypto.randomBytes.
        } else if (crypto.randomBytes) {

            // buffer
            d = crypto.randomBytes(k *= 4);

            for (; i < k;) {

                // 0 <= n < 2147483648
                n = d[i] + (d[i + 1] << 8) + (d[i + 2] << 16) + ((d[i + 3] & 0x7f) << 24);

                // Probability n >= 2.14e9, is 7483648 / 2147483648 = 0.0035 (1 in 286).
                if (n >= 2.14e9) {
                    crypto.randomBytes(4).copy(d, i);
                } else {

                    // 0 <= n <= 2139999999
                    // 0 <= (n % 1e7) <= 9999999
                    rd.push(n % 1e7);
                    i += 4;
                }
            }

            i = k / 4;
        } else {
            throw Error(cryptoUnavailable)
        }

        k = rd[--i];
        sd %= LOG_BASE;

        // Convert trailing digits to zeros according to sd.
        if (k && sd) {
            n = mathpow(10, LOG_BASE - sd);
            rd[i] = (k / n | 0) * n;
        }

        // Remove trailing words which are zero.
        for (; rd[i] === 0; i--) rd.pop();

        // Zero?
        if (i < 0) {
            e = 0;
            rd = [0];
        } else {
            e = -1;

            // Remove leading words which are zero and adjust exponent accordingly.
            for (; rd[0] === 0; e -= LOG_BASE) rd.shift();

            // Count the digits of the first word of rd to determine leading zeros.
            for (k = 1, n = rd[0]; n >= 10; n /= 10) k++;

            // Adjust the exponent for leading zeros of the first word of rd.
            if (k < LOG_BASE) e -= LOG_BASE - k;
        }

        r.e = e;
        r.d = rd;

        return r
    }


    /*
     * Return a new Decimal whose value is `x` rounded to an integer using rounding mode `rounding`.
     *
     * To emulate `Math.round`, set rounding to 7 (ROUND_HALF_CEIL).
     *
     * x {number|string|Decimal}
     *
     */
    function round(x) {
        return finalise(x = new this(x), x.e + 1, this.rounding)
    }


    /*
     * Return
     *   1    if x > 0,
     *  -1    if x < 0,
     *   0    if x is 0,
     *  -0    if x is -0,
     *   NaN  otherwise
     *
     * x {number|string|Decimal}
     *
     */
    function sign(x) {
        x = new this(x);
        return x.d ? (x.d[0] ? x.s : 0 * x.s) : x.s || NaN
    }


    /*
     * Return a new Decimal whose value is the sine of `x`, rounded to `precision` significant digits
     * using rounding mode `rounding`.
     *
     * x {number|string|Decimal} A value in radians.
     *
     */
    function sin(x) {
        return new this(x).sin()
    }


    /*
     * Return a new Decimal whose value is the hyperbolic sine of `x`, rounded to `precision`
     * significant digits using rounding mode `rounding`.
     *
     * x {number|string|Decimal} A value in radians.
     *
     */
    function sinh(x) {
        return new this(x).sinh()
    }


    /*
     * Return a new Decimal whose value is the square root of `x`, rounded to `precision` significant
     * digits using rounding mode `rounding`.
     *
     * x {number|string|Decimal}
     *
     */
    function sqrt(x) {
        return new this(x).sqrt()
    }


    /*
     * Return a new Decimal whose value is `x` minus `y`, rounded to `precision` significant digits
     * using rounding mode `rounding`.
     *
     * x {number|string|Decimal}
     * y {number|string|Decimal}
     *
     */
    function sub(x, y) {
        return new this(x).sub(y)
    }


    /*
     * Return a new Decimal whose value is the sum of the arguments, rounded to `precision`
     * significant digits using rounding mode `rounding`.
     *
     * Only the result is rounded, not the intermediate calculations.
     *
     * arguments {number|string|Decimal}
     *
     */
    function sum() {
        var i = 0,
            args = arguments,
            x = new this(args[i]);

        external = false;
        for (; x.s && ++i < args.length;) x = x.plus(args[i]);
        external = true;

        return finalise(x, this.precision, this.rounding)
    }


    /*
     * Return a new Decimal whose value is the tangent of `x`, rounded to `precision` significant
     * digits using rounding mode `rounding`.
     *
     * x {number|string|Decimal} A value in radians.
     *
     */
    function tan(x) {
        return new this(x).tan()
    }


    /*
     * Return a new Decimal whose value is the hyperbolic tangent of `x`, rounded to `precision`
     * significant digits using rounding mode `rounding`.
     *
     * x {number|string|Decimal} A value in radians.
     *
     */
    function tanh(x) {
        return new this(x).tanh()
    }


    /*
     * Return a new Decimal whose value is `x` truncated to an integer.
     *
     * x {number|string|Decimal}
     *
     */
    function trunc(x) {
        return finalise(x = new this(x), x.e + 1, 1)
    }


    // Create and configure initial Decimal constructor.
    Decimal = clone(DEFAULTS);
    Decimal.prototype.constructor = Decimal;
    Decimal['default'] = Decimal.Decimal = Decimal;

    // Create the internal constants from their string values.
    LN10 = new Decimal(LN10);
    PI = new Decimal(PI);


    // Export.


    // AMD.
    if (module.exports) {
        if (typeof Symbol == 'function' && typeof Symbol.iterator == 'symbol') {
            P[Symbol['for']('nodejs.util.inspect.custom')] = P.toString;
            P[Symbol.toStringTag] = 'Decimal';
        }

        module.exports = Decimal;

        // Browser.
    } else {
        if (!globalScope) {
            globalScope = typeof self != 'undefined' && self && self.self == self ? self : window;
        }

        noConflict = globalScope.Decimal;
        Decimal.noConflict = function () {
            globalScope.Decimal = noConflict;
            return Decimal
        };

        globalScope.Decimal = Decimal;
    }
})(commonjsGlobal);
});

const width = writable();
const height = writable();
const context = writable();
const canvas = writable();

/* src\SlopeField.svelte generated by Svelte v3.45.0 */

const css = {
	code: "#editor.svelte-yx75fm.svelte-yx75fm{font-size:1.5em;border-radius:10px}.controls.svelte-yx75fm.svelte-yx75fm{width:300px}.controls-body.svelte-yx75fm.svelte-yx75fm{padding:10px;padding-right:0;width:100%;height:100%;background-color:rgb(107, 107, 107);border-radius:10px;overflow:scroll;overflow-x:hidden;scrollbar-color:rgb(31, 31, 31) rgb(107, 107, 107);scrollbar-width:thin}.controls-body.svelte-yx75fm>.svelte-yx75fm{max-height:40px}input.svelte-yx75fm.svelte-yx75fm{width:40%;background:none;outline:none;border:none;border-radius:0;border-bottom:black solid 1px;-webkit-appearance:none;-moz-appearance:textfield;transition:background-color 200ms ease-in-out}input[type=\"number\"].svelte-yx75fm.svelte-yx75fm:focus{background-color:rgba(0, 0, 0, 0.109)}.input-group.svelte-yx75fm.svelte-yx75fm{display:flex;flex-direction:row;justify-content:center;align-items:center;gap:40px}.main-canvas.svelte-yx75fm.svelte-yx75fm{border:black solid 4px}.container.svelte-yx75fm.svelte-yx75fm{display:flex;padding:10px;justify-content:center}",
	map: "{\"version\":3,\"file\":\"SlopeField.svelte\",\"sources\":[\"SlopeField.svelte\"],\"sourcesContent\":[\"<script lang=\\\"ts\\\">import { onMount } from \\\"svelte\\\";\\r\\nimport \\\"svelte/internal\\\";\\r\\nimport \\\"svelte/store\\\";\\r\\nimport \\\"svelte/types/runtime/transition\\\";\\r\\nimport Decimal from \\\"./decimal\\\";\\r\\nimport { height, width, canvas as canvasStore, context as contextStore, } from \\\"./game\\\";\\r\\nconst pattern = \\\"^d*(.d{0,2})?$\\\";\\r\\nconst start_scale = 80;\\r\\nfunction updateObject(target, src) {\\r\\n    const res = {};\\r\\n    Object.keys(target).forEach((k) => { var _a; return (res[k] = (_a = src[k]) !== null && _a !== void 0 ? _a : target[k]); });\\r\\n    return res;\\r\\n}\\r\\nclass Interface {\\r\\n    constructor() {\\r\\n        this._length = 1;\\r\\n        this._bounds = {\\r\\n            lowx: -5,\\r\\n            highx: 5,\\r\\n            lowy: -5,\\r\\n            highy: 5,\\r\\n        };\\r\\n        this._scale = 1;\\r\\n        this._step = 1;\\r\\n    }\\r\\n    set allBounds(value) {\\r\\n        this._bounds = {\\r\\n            lowx: -value,\\r\\n            highx: value,\\r\\n            lowy: -value,\\r\\n            highy: value,\\r\\n        };\\r\\n    }\\r\\n    get allBounds() {\\r\\n        const comp = [\\r\\n            this._bounds.lowx,\\r\\n            this._bounds.highx,\\r\\n            this._bounds.lowy,\\r\\n            this._bounds.highy,\\r\\n        ];\\r\\n        const sum = comp.reduce((prev, curr) => prev + Math.abs(curr), 0);\\r\\n        if (sum === Math.abs(comp[0]) * comp.length)\\r\\n            return Math.abs(comp[0]);\\r\\n        else\\r\\n            return 0;\\r\\n    }\\r\\n    set length(value) {\\r\\n        if (typeof value === \\\"number\\\")\\r\\n            myInterface._length = value;\\r\\n    }\\r\\n    get length() {\\r\\n        return myInterface.length;\\r\\n    }\\r\\n    set bounds(value) {\\r\\n        if (typeof value === \\\"object\\\")\\r\\n            updateObject(myInterface, value);\\r\\n    }\\r\\n    get bounds() {\\r\\n        return myInterface._bounds;\\r\\n    }\\r\\n    set scale(value) {\\r\\n        if (typeof value === \\\"number\\\")\\r\\n            myInterface._scale = value;\\r\\n    }\\r\\n    get scale() {\\r\\n        return myInterface._scale;\\r\\n    }\\r\\n    animate(property, minValue = 0, maxValue = 1, step = 0.1) {\\r\\n        let delta = step;\\r\\n        setInterval(() => {\\r\\n            const value = this[`_${property}`];\\r\\n            if (value >= maxValue || value <= minValue) {\\r\\n                delta *= -1;\\r\\n            }\\r\\n            this[property] = value + delta;\\r\\n        }, 10);\\r\\n    }\\r\\n}\\r\\nlet myInterface = new Interface();\\r\\nlet canvas;\\r\\nlet context;\\r\\nlet axes = {\\r\\n    x0: 0,\\r\\n    y0: 0,\\r\\n    scale: start_scale,\\r\\n    doNegativeX: true,\\r\\n};\\r\\nconst clamp = (num, min, max) => Math.min(Math.max(num, min), max);\\r\\nconst executeCode = (code) => {\\r\\n    const result = eval(code);\\r\\n    console.log(result);\\r\\n};\\r\\nonMount(() => {\\r\\n    const hscale = 5 / 4;\\r\\n    console.log(window);\\r\\n    width.set(document.body.clientWidth / 2);\\r\\n    height.set(document.body.clientHeight / hscale);\\r\\n    context = canvas.getContext(\\\"2d\\\", {});\\r\\n    canvasStore.set(canvas);\\r\\n    contextStore.set(context);\\r\\n    canvas.width = document.body.clientWidth / 2;\\r\\n    canvas.height = document.body.clientHeight / hscale;\\r\\n    axes = {\\r\\n        x0: Math.round(0.5 + 0.5 * canvas.width),\\r\\n        y0: Math.round(0.5 + 0.5 * canvas.height),\\r\\n        scale: start_scale,\\r\\n        doNegativeX: true,\\r\\n    };\\r\\n    display(myInterface._step, myInterface._scale, myInterface._bounds, myInterface._length);\\r\\n    document.addEventListener(\\\"wheel\\\", scroll, { passive: false });\\r\\n    const anyWindow = window;\\r\\n    anyWindow.sf = myInterface;\\r\\n    anyWindow.YUI().use(\\\"aui-ace-editor\\\", function (Y) {\\r\\n        // code goes here\\r\\n        let editor = new Y.AceEditor({\\r\\n            boundingBox: \\\"#editor\\\",\\r\\n            mode: \\\"javascript\\\",\\r\\n            width: `${document.body.clientWidth / 2 + 300}`,\\r\\n            height: \\\"700\\\",\\r\\n            showPrintMargin: false,\\r\\n        }).render();\\r\\n        let clear;\\r\\n        editor.getEditor().on(\\\"change\\\", () => {\\r\\n            if (clear === undefined) {\\r\\n                clear = setTimeout(() => {\\r\\n                    executeCode(editor.getEditor().getValue());\\r\\n                    clear = undefined;\\r\\n                }, 1000);\\r\\n            }\\r\\n            else {\\r\\n                clearTimeout(clear);\\r\\n                clear = setTimeout(() => {\\r\\n                    executeCode(editor.getEditor().getValue());\\r\\n                    clear = undefined;\\r\\n                }, 1000);\\r\\n            }\\r\\n        });\\r\\n        console.log(editor);\\r\\n        editor.getEditor().setTheme(\\\"ace/theme/monokai\\\");\\r\\n    });\\r\\n});\\r\\nconst scroll = (e) => {\\r\\n    if (e.target != canvas)\\r\\n        return;\\r\\n    e.preventDefault();\\r\\n    // console.log(e);\\r\\n    myInterface._scale +=\\r\\n        (clamp(e.wheelDeltaY, -1, 1) * myInterface._scale) / 20;\\r\\n    // display(\\r\\n    //     myInterface._step,\\r\\n    //     myInterface._scale,\\r\\n    //     myInterface._bounds,\\r\\n    //     myInterface._length\\r\\n    // );\\r\\n    return false;\\r\\n};\\r\\nconst display = (gap, scale, bounds, length) => {\\r\\n    context.clearRect(0, 0, canvas.width, canvas.height);\\r\\n    showAxes(Object.assign(Object.assign({}, axes), { scale: start_scale * scale }));\\r\\n    slope_field(Object.assign(Object.assign({}, axes), { scale: start_scale * scale }), (x, y) => x, gap, bounds, length);\\r\\n};\\r\\n$: {\\r\\n    if (context) {\\r\\n        display(myInterface._step, myInterface._scale, myInterface._bounds, myInterface._length);\\r\\n    }\\r\\n}\\r\\n// $: console.log('ptoaj', myInterface)\\r\\nconst nearest = (value, to) => Math.round(value / to) * to;\\r\\nfunction slope_field(axes, func, gap, bounds, length) {\\r\\n    for (let x = nearest(bounds.lowx, gap); x <= nearest(bounds.highx, gap); x += gap) {\\r\\n        for (let y = nearest(bounds.lowy, gap); y <= nearest(bounds.highy, gap); y += gap) {\\r\\n            line(axes, x, y, func(x, y), length);\\r\\n        }\\r\\n    }\\r\\n}\\r\\nfunction line(axes, x, y, slope, length) {\\r\\n    const lh = (length / 2) * axes.scale;\\r\\n    const x0 = axes.x0;\\r\\n    const y0 = axes.y0;\\r\\n    if (slope == 0) {\\r\\n        context.beginPath();\\r\\n        context.moveTo(x0 + (x * axes.scale + lh), y0 - y * axes.scale);\\r\\n        context.lineTo(x0 + (x * axes.scale - lh), y0 - y * axes.scale);\\r\\n        context.stroke();\\r\\n        return;\\r\\n    }\\r\\n    const xx = lh / Math.sqrt(1 + slope * slope);\\r\\n    const yy = (lh * slope) / Math.sqrt(1 + slope * slope);\\r\\n    const scale = axes.scale;\\r\\n    const iMax = x * scale + xx;\\r\\n    const iMin = x * scale - xx;\\r\\n    context.beginPath();\\r\\n    context.lineWidth = 2;\\r\\n    context.strokeStyle = \\\"rgb(11,153,11)\\\";\\r\\n    context.moveTo(x0 + iMin, y0 - (y * scale - yy));\\r\\n    context.lineTo(x0 + iMax, y0 - (y * scale + yy));\\r\\n    context.stroke();\\r\\n}\\r\\nfunction funGraph(axes, func, color, thick) {\\r\\n    var xx, yy, dx = 4, x0 = axes.x0, y0 = axes.y0, scale = axes.scale;\\r\\n    var iMax = Math.round((context.canvas.width - x0) / dx) + 10;\\r\\n    var iMin = (axes.doNegativeX ? Math.round(-x0 / dx) : 0) - 10;\\r\\n    context.beginPath();\\r\\n    context.lineWidth = thick;\\r\\n    context.strokeStyle = color;\\r\\n    for (var i = iMin; i <= iMax; i++) {\\r\\n        xx = dx * i;\\r\\n        yy = scale * func(xx / scale);\\r\\n        if (i == iMin)\\r\\n            context.moveTo(x0 + xx, y0 - yy);\\r\\n        else\\r\\n            context.lineTo(x0 + xx, y0 - yy);\\r\\n    }\\r\\n    context.stroke();\\r\\n}\\r\\nlet n = 1;\\r\\nlet last_point = start_scale;\\r\\nfunction showAxes(axes) {\\r\\n    var x0 = axes.x0, w = context.canvas.width;\\r\\n    var y0 = axes.y0, h = context.canvas.height;\\r\\n    var xmin = axes.doNegativeX ? 0 : x0;\\r\\n    context.beginPath();\\r\\n    context.strokeStyle = \\\"rgb(0, 0, 0)\\\";\\r\\n    context.moveTo(xmin, y0);\\r\\n    context.lineTo(w, y0); // X axis\\r\\n    context.moveTo(x0, 0);\\r\\n    context.lineTo(x0, h); // Y axis\\r\\n    context.font = \\\"1em Roboto Mono\\\";\\r\\n    context.textAlign = \\\"right\\\";\\r\\n    context.textBaseline = \\\"middle\\\";\\r\\n    // n = Math.max(1/Math.ceil((1/100) * (axes.scale)), 0);\\r\\n    // if\\r\\n    // n = Math.pow(2, Math.ceil(-axes.scale / start_scale / 2 ));\\r\\n    // n = Math.ceil(-axes.scale / 40) + 10\\r\\n    // n = Math.log10(axes.scale / 8)\\r\\n    // n = Math.pow(1 / 2, axes.scale / start_scale);\\r\\n    // let val = 1;\\r\\n    // for (let i = 0; i < axes.scale / start_scale; i++) {\\r\\n    //    val /= 2;\\r\\n    // }\\r\\n    // n = val;\\r\\n    // const prop = 4.5;\\r\\n    // if (n * axes.scale > n * prop * last_point) {\\r\\n    //     n /= 2;\\r\\n    //     last_point = axes.scale;\\r\\n    // }\\r\\n    // if (n * axes.scale < n * (1 / prop) * last_point) {\\r\\n    //     n *= 2;\\r\\n    //     last_point = axes.scale;\\r\\n    // }\\r\\n    if (axes.scale > last_point + last_point / 2) {\\r\\n        n /= 2;\\r\\n    }\\r\\n    else if (axes.scale < last_point + last_point / 2) {\\r\\n        n *= 2;\\r\\n    }\\r\\n    last_point = axes.scale;\\r\\n    console.log(n, axes.scale, axes.scale / start_scale - 1);\\r\\n    for (let i = axes.scale * n; i < context.canvas.height / 2; i += axes.scale * n) {\\r\\n        context.fillText(`${new Decimal(i / axes.scale).toNearest(new Decimal(0.000001))}`, x0 - 5, y0 - i);\\r\\n    }\\r\\n    for (let i = -axes.scale * n; i > -context.canvas.height / 2; i -= axes.scale * n) {\\r\\n        context.fillText(`${new Decimal(i / axes.scale).toNearest(new Decimal(0.000001))}`, x0 - 5, y0 - i);\\r\\n    }\\r\\n    context.textAlign = \\\"center\\\";\\r\\n    context.textBaseline = \\\"top\\\";\\r\\n    for (let i = axes.scale * n; i < context.canvas.width / 2; i += axes.scale * n) {\\r\\n        context.fillText(`${new Decimal(i / axes.scale).toNearest(new Decimal(0.000001))}`, x0 - i, y0 + 5);\\r\\n    }\\r\\n    for (let i = axes.scale * n; i < context.canvas.width / 2; i += axes.scale * n) {\\r\\n        context.fillText(`${new Decimal(i / axes.scale).toNearest(new Decimal(0.000001))}`, x0 + i, y0 + 5);\\r\\n    }\\r\\n    context.stroke();\\r\\n}\\r\\n</script>\\r\\n\\r\\n<div class=\\\"container\\\">\\r\\n    <div class=\\\"controls\\\" style=\\\"height: {$height}px;\\\">\\r\\n        <div class=\\\"controls-body\\\">\\r\\n            <div class=\\\"input-group\\\">\\r\\n                <label for=\\\"length\\\">Length:</label>\\r\\n                <input\\r\\n                    id=\\\"length\\\"\\r\\n                    type=\\\"number\\\"\\r\\n                    bind:value={myInterface._length}\\r\\n                    step=\\\"any\\\"\\r\\n                />\\r\\n            </div>\\r\\n            <div class=\\\"input-group\\\">\\r\\n                <input\\r\\n                    id=\\\"lengthrange\\\"\\r\\n                    type=\\\"range\\\"\\r\\n                    min=\\\"0\\\"\\r\\n                    max=\\\"10\\\"\\r\\n                    step=\\\"0.01\\\"\\r\\n                    bind:value={myInterface._length}\\r\\n                    style=\\\"width: 200px;\\\"\\r\\n                />\\r\\n            </div>\\r\\n\\r\\n            <div class=\\\"input-group\\\">\\r\\n                <label for=\\\"step\\\">Step:</label>\\r\\n                <input\\r\\n                    id=\\\"step\\\"\\r\\n                    type=\\\"number\\\"\\r\\n                    bind:value={myInterface._step}\\r\\n                    step=\\\"any\\\"\\r\\n                />\\r\\n            </div>\\r\\n            <div class=\\\"input-group\\\">\\r\\n                <input\\r\\n                    id=\\\"steprane\\\"\\r\\n                    type=\\\"range\\\"\\r\\n                    min=\\\"0\\\"\\r\\n                    max=\\\"1\\\"\\r\\n                    step=\\\"0.01\\\"\\r\\n                    bind:value={myInterface._step}\\r\\n                    style=\\\"width: 200px;\\\"\\r\\n                />\\r\\n            </div>\\r\\n\\r\\n            <div class=\\\"input-group\\\">\\r\\n                <label for=\\\"lowx\\\">Min X:</label>\\r\\n                <input\\r\\n                    id=\\\"lowx\\\"\\r\\n                    type=\\\"number\\\"\\r\\n                    bind:value={myInterface._bounds.lowx}\\r\\n                    step=\\\"any\\\"\\r\\n                />\\r\\n            </div>\\r\\n            <div class=\\\"input-group\\\">\\r\\n                <input\\r\\n                    type=\\\"range\\\"\\r\\n                    min=\\\"-100\\\"\\r\\n                    max=\\\"100\\\"\\r\\n                    step=\\\"0.01\\\"\\r\\n                    bind:value={myInterface._bounds.lowx}\\r\\n                    style=\\\"width: 200px;\\\"\\r\\n                />\\r\\n            </div>\\r\\n\\r\\n            <div class=\\\"input-group\\\">\\r\\n                <label for=\\\"maxx\\\">Max X:</label>\\r\\n                <input\\r\\n                    id=\\\"maxx\\\"\\r\\n                    type=\\\"number\\\"\\r\\n                    bind:value={myInterface._bounds.highx}\\r\\n                    step=\\\"any\\\"\\r\\n                />\\r\\n            </div>\\r\\n            <div class=\\\"input-group\\\">\\r\\n                <input\\r\\n                    type=\\\"range\\\"\\r\\n                    min=\\\"-100\\\"\\r\\n                    max=\\\"100\\\"\\r\\n                    step=\\\"0.01\\\"\\r\\n                    bind:value={myInterface._bounds.highx}\\r\\n                    style=\\\"width: 200px;\\\"\\r\\n                />\\r\\n            </div>\\r\\n\\r\\n            <div class=\\\"input-group\\\">\\r\\n                <label for=\\\"lowy\\\">Min Y:</label>\\r\\n                <input\\r\\n                    id=\\\"lowy\\\"\\r\\n                    type=\\\"number\\\"\\r\\n                    bind:value={myInterface._bounds.lowy}\\r\\n                    step=\\\"any\\\"\\r\\n                />\\r\\n            </div>\\r\\n            <div class=\\\"input-group\\\">\\r\\n                <input\\r\\n                    type=\\\"range\\\"\\r\\n                    min=\\\"-100\\\"\\r\\n                    max=\\\"100\\\"\\r\\n                    step=\\\"0.01\\\"\\r\\n                    bind:value={myInterface._bounds.lowy}\\r\\n                    style=\\\"width: 200px;\\\"\\r\\n                />\\r\\n            </div>\\r\\n\\r\\n            <div class=\\\"input-group\\\">\\r\\n                <label for=\\\"highy\\\">Max Y:</label>\\r\\n                <input\\r\\n                    id=\\\"highy\\\"\\r\\n                    type=\\\"number\\\"\\r\\n                    bind:value={myInterface._bounds.highy}\\r\\n                    step=\\\"any\\\"\\r\\n                />\\r\\n            </div>\\r\\n            <div class=\\\"input-group\\\">\\r\\n                <input\\r\\n                    type=\\\"range\\\"\\r\\n                    min=\\\"-100\\\"\\r\\n                    max=\\\"100\\\"\\r\\n                    step=\\\"0.01\\\"\\r\\n                    bind:value={myInterface._bounds.highy}\\r\\n                    style=\\\"width: 200px;\\\"\\r\\n                />\\r\\n            </div>\\r\\n\\r\\n            <div class=\\\"input-group\\\">\\r\\n                <label for=\\\"scale\\\">Bounds:</label>\\r\\n                <input\\r\\n                    id=\\\"scale\\\"\\r\\n                    type=\\\"number\\\"\\r\\n                    bind:value={myInterface.allBounds}\\r\\n                    step=\\\"any\\\"\\r\\n                />\\r\\n            </div>\\r\\n            <div class=\\\"input-group\\\">\\r\\n                <input\\r\\n                    type=\\\"range\\\"\\r\\n                    min=\\\"0\\\"\\r\\n                    max=\\\"100\\\"\\r\\n                    step=\\\"0.01\\\"\\r\\n                    bind:value={myInterface.allBounds}\\r\\n                    style=\\\"width: 200px;\\\"\\r\\n                />\\r\\n            </div>\\r\\n\\r\\n            <div class=\\\"input-group\\\">\\r\\n                <label for=\\\"scale\\\">Scale:</label>\\r\\n                <input\\r\\n                    id=\\\"scale\\\"\\r\\n                    type=\\\"number\\\"\\r\\n                    bind:value={myInterface._scale}\\r\\n                    step=\\\"any\\\"\\r\\n                />\\r\\n            </div>\\r\\n            <div class=\\\"input-group\\\">\\r\\n                <input\\r\\n                    type=\\\"range\\\"\\r\\n                    min=\\\"0.1\\\"\\r\\n                    max=\\\"5\\\"\\r\\n                    step=\\\"0.01\\\"\\r\\n                    bind:value={myInterface._scale}\\r\\n                    style=\\\"width: 200px;\\\"\\r\\n                />\\r\\n            </div>\\r\\n        </div>\\r\\n    </div>\\r\\n    <canvas\\r\\n        class=\\\"main-canvas\\\"\\r\\n        bind:this={canvas}\\r\\n        style=\\\"width: {$width}px; height: {$height}px; \\\"\\r\\n    />\\r\\n</div>\\r\\n\\r\\n<div class=\\\"container\\\" style=\\\"margin-top: 50px; \\\">\\r\\n    <div id=\\\"editor\\\" />\\r\\n</div>\\r\\n\\r\\n<style>\\r\\n    #editor {\\r\\n        font-size: 1.5em;\\r\\n        border-radius: 10px;\\r\\n    }\\r\\n\\r\\n    .controls {\\r\\n        width: 300px;\\r\\n    }\\r\\n\\r\\n    .controls-body {\\r\\n        padding: 10px;\\r\\n        padding-right: 0;\\r\\n        width: 100%;\\r\\n        height: 100%;\\r\\n        background-color: rgb(107, 107, 107);\\r\\n        border-radius: 10px;\\r\\n        overflow: scroll;\\r\\n        overflow-x: hidden;\\r\\n        scrollbar-color: rgb(31, 31, 31) rgb(107, 107, 107);\\r\\n        scrollbar-width: thin;\\r\\n        /* display: flex; */\\r\\n        /* justify-content: center; */\\r\\n    }\\r\\n\\r\\n    .controls-body > * {\\r\\n        max-height: 40px;\\r\\n    }\\r\\n\\r\\n    input {\\r\\n        width: 40%;\\r\\n        background: none;\\r\\n        outline: none;\\r\\n        border: none;\\r\\n        border-radius: 0;\\r\\n        border-bottom: black solid 1px;\\r\\n        -webkit-appearance: none;\\r\\n        -moz-appearance: textfield;\\r\\n        transition: background-color 200ms ease-in-out;\\r\\n    }\\r\\n\\r\\n    input[type=\\\"number\\\"]:focus {\\r\\n        background-color: rgba(0, 0, 0, 0.109);\\r\\n    }\\r\\n\\r\\n    .input-group {\\r\\n        display: flex;\\r\\n        flex-direction: row;\\r\\n        justify-content: center;\\r\\n        align-items: center;\\r\\n        gap: 40px;\\r\\n    }\\r\\n\\r\\n    .main-canvas {\\r\\n        /* border-left: black solid 4px; */\\r\\n        border: black solid 4px;\\r\\n    }\\r\\n\\r\\n    .container {\\r\\n        display: flex;\\r\\n        padding: 10px;\\r\\n        justify-content: center;\\r\\n    }\\r\\n</style>\\r\\n\"],\"names\":[],\"mappings\":\"AAscI,OAAO,4BAAC,CAAC,AACL,SAAS,CAAE,KAAK,CAChB,aAAa,CAAE,IAAI,AACvB,CAAC,AAED,SAAS,4BAAC,CAAC,AACP,KAAK,CAAE,KAAK,AAChB,CAAC,AAED,cAAc,4BAAC,CAAC,AACZ,OAAO,CAAE,IAAI,CACb,aAAa,CAAE,CAAC,CAChB,KAAK,CAAE,IAAI,CACX,MAAM,CAAE,IAAI,CACZ,gBAAgB,CAAE,IAAI,GAAG,CAAC,CAAC,GAAG,CAAC,CAAC,GAAG,CAAC,CACpC,aAAa,CAAE,IAAI,CACnB,QAAQ,CAAE,MAAM,CAChB,UAAU,CAAE,MAAM,CAClB,eAAe,CAAE,IAAI,EAAE,CAAC,CAAC,EAAE,CAAC,CAAC,EAAE,CAAC,CAAC,IAAI,GAAG,CAAC,CAAC,GAAG,CAAC,CAAC,GAAG,CAAC,CACnD,eAAe,CAAE,IAAI,AAGzB,CAAC,AAED,4BAAc,CAAG,cAAE,CAAC,AAChB,UAAU,CAAE,IAAI,AACpB,CAAC,AAED,KAAK,4BAAC,CAAC,AACH,KAAK,CAAE,GAAG,CACV,UAAU,CAAE,IAAI,CAChB,OAAO,CAAE,IAAI,CACb,MAAM,CAAE,IAAI,CACZ,aAAa,CAAE,CAAC,CAChB,aAAa,CAAE,KAAK,CAAC,KAAK,CAAC,GAAG,CAC9B,kBAAkB,CAAE,IAAI,CACxB,eAAe,CAAE,SAAS,CAC1B,UAAU,CAAE,gBAAgB,CAAC,KAAK,CAAC,WAAW,AAClD,CAAC,AAED,KAAK,CAAC,IAAI,CAAC,QAAQ,6BAAC,MAAM,AAAC,CAAC,AACxB,gBAAgB,CAAE,KAAK,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,KAAK,CAAC,AAC1C,CAAC,AAED,YAAY,4BAAC,CAAC,AACV,OAAO,CAAE,IAAI,CACb,cAAc,CAAE,GAAG,CACnB,eAAe,CAAE,MAAM,CACvB,WAAW,CAAE,MAAM,CACnB,GAAG,CAAE,IAAI,AACb,CAAC,AAED,YAAY,4BAAC,CAAC,AAEV,MAAM,CAAE,KAAK,CAAC,KAAK,CAAC,GAAG,AAC3B,CAAC,AAED,UAAU,4BAAC,CAAC,AACR,OAAO,CAAE,IAAI,CACb,OAAO,CAAE,IAAI,CACb,eAAe,CAAE,MAAM,AAC3B,CAAC\"}"
};
const start_scale = 80;

function updateObject(target, src) {
	const res = {};

	Object.keys(target).forEach(k => {
		var _a;
		return res[k] = (_a = src[k]) !== null && _a !== void 0 ? _a : target[k];
	});

	return res;
}

const SlopeField = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let $height, $$unsubscribe_height;
	let $width, $$unsubscribe_width;
	$$unsubscribe_height = subscribe(height, value => $height = value);
	$$unsubscribe_width = subscribe(width, value => $width = value);

	class Interface {
		constructor() {
			this._length = 1;
			this._bounds = { lowx: -5, highx: 5, lowy: -5, highy: 5 };
			this._scale = 1;
			this._step = 1;
		}

		set allBounds(value) {
			this._bounds = {
				lowx: -value,
				highx: value,
				lowy: -value,
				highy: value
			};
		}

		get allBounds() {
			const comp = [
				this._bounds.lowx,
				this._bounds.highx,
				this._bounds.lowy,
				this._bounds.highy
			];

			const sum = comp.reduce((prev, curr) => prev + Math.abs(curr), 0);
			if (sum === Math.abs(comp[0]) * comp.length) return Math.abs(comp[0]); else return 0;
		}

		set length(value) {
			if (typeof value === "number") myInterface._length = value;
		}

		get length() {
			return myInterface.length;
		}

		set bounds(value) {
			if (typeof value === "object") updateObject(myInterface, value);
		}

		get bounds() {
			return myInterface._bounds;
		}

		set scale(value) {
			if (typeof value === "number") myInterface._scale = value;
		}

		get scale() {
			return myInterface._scale;
		}

		animate(property, minValue = 0, maxValue = 1, step = 0.1) {
			let delta = step;

			setInterval(
				() => {
					const value = this[`_${property}`];

					if (value >= maxValue || value <= minValue) {
						delta *= -1;
					}

					this[property] = value + delta;
				},
				10
			);
		}
	}

	let myInterface = new Interface();
	let canvas$1;
	let context$1;

	let axes = {
		x0: 0,
		y0: 0,
		scale: start_scale,
		doNegativeX: true
	};

	const clamp = (num, min, max) => Math.min(Math.max(num, min), max);

	const executeCode = code => {
		const result = eval(code);
		console.log(result);
	};

	onMount(() => {
		const hscale = 5 / 4;
		console.log(window);
		width.set(document.body.clientWidth / 2);
		height.set(document.body.clientHeight / hscale);
		context$1 = canvas$1.getContext("2d", {});
		canvas.set(canvas$1);
		context.set(context$1);
		canvas$1.width = document.body.clientWidth / 2;
		canvas$1.height = document.body.clientHeight / hscale;

		axes = {
			x0: Math.round(0.5 + 0.5 * canvas$1.width),
			y0: Math.round(0.5 + 0.5 * canvas$1.height),
			scale: start_scale,
			doNegativeX: true
		};

		display(myInterface._step, myInterface._scale, myInterface._bounds, myInterface._length);
		document.addEventListener("wheel", scroll, { passive: false });
		const anyWindow = window;
		anyWindow.sf = myInterface;

		anyWindow.YUI().use("aui-ace-editor", function (Y) {
			// code goes here
			let editor = new Y.AceEditor({
					boundingBox: "#editor",
					mode: "javascript",
					width: `${document.body.clientWidth / 2 + 300}`,
					height: "700",
					showPrintMargin: false
				}).render();

			let clear;

			editor.getEditor().on("change", () => {
				if (clear === undefined) {
					clear = setTimeout(
						() => {
							executeCode(editor.getEditor().getValue());
							clear = undefined;
						},
						1000
					);
				} else {
					clearTimeout(clear);

					clear = setTimeout(
						() => {
							executeCode(editor.getEditor().getValue());
							clear = undefined;
						},
						1000
					);
				}
			});

			console.log(editor);
			editor.getEditor().setTheme("ace/theme/monokai");
		});
	});

	const scroll = e => {
		if (e.target != canvas$1) return;
		e.preventDefault();

		// console.log(e);
		myInterface._scale += clamp(e.wheelDeltaY, -1, 1) * myInterface._scale / 20;

		// display(
		//     myInterface._step,
		//     myInterface._scale,
		//     myInterface._bounds,
		//     myInterface._length
		// );
		return false;
	};

	const display = (gap, scale, bounds, length) => {
		context$1.clearRect(0, 0, canvas$1.width, canvas$1.height);
		showAxes(Object.assign(Object.assign({}, axes), { scale: start_scale * scale }));
		slope_field(Object.assign(Object.assign({}, axes), { scale: start_scale * scale }), (x, y) => x, gap, bounds, length);
	};

	// $: console.log('ptoaj', myInterface)
	const nearest = (value, to) => Math.round(value / to) * to;

	function slope_field(axes, func, gap, bounds, length) {
		for (let x = nearest(bounds.lowx, gap); x <= nearest(bounds.highx, gap); x += gap) {
			for (let y = nearest(bounds.lowy, gap); y <= nearest(bounds.highy, gap); y += gap) {
				line(axes, x, y, func(x, y), length);
			}
		}
	}

	function line(axes, x, y, slope, length) {
		const lh = length / 2 * axes.scale;
		const x0 = axes.x0;
		const y0 = axes.y0;

		if (slope == 0) {
			context$1.beginPath();
			context$1.moveTo(x0 + (x * axes.scale + lh), y0 - y * axes.scale);
			context$1.lineTo(x0 + (x * axes.scale - lh), y0 - y * axes.scale);
			context$1.stroke();
			return;
		}

		const xx = lh / Math.sqrt(1 + slope * slope);
		const yy = lh * slope / Math.sqrt(1 + slope * slope);
		const scale = axes.scale;
		const iMax = x * scale + xx;
		const iMin = x * scale - xx;
		context$1.beginPath();
		context$1.lineWidth = 2;
		context$1.strokeStyle = "rgb(11,153,11)";
		context$1.moveTo(x0 + iMin, y0 - (y * scale - yy));
		context$1.lineTo(x0 + iMax, y0 - (y * scale + yy));
		context$1.stroke();
	}

	let n = 1;
	let last_point = start_scale;

	function showAxes(axes) {
		var x0 = axes.x0, w = context$1.canvas.width;
		var y0 = axes.y0, h = context$1.canvas.height;
		var xmin = axes.doNegativeX ? 0 : x0;
		context$1.beginPath();
		context$1.strokeStyle = "rgb(0, 0, 0)";
		context$1.moveTo(xmin, y0);
		context$1.lineTo(w, y0); // X axis
		context$1.moveTo(x0, 0);
		context$1.lineTo(x0, h); // Y axis
		context$1.font = "1em Roboto Mono";
		context$1.textAlign = "right";
		context$1.textBaseline = "middle";

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

		for (let i = axes.scale * n; i < context$1.canvas.height / 2; i += axes.scale * n) {
			context$1.fillText(`${new decimal(i / axes.scale).toNearest(new decimal(0.000001))}`, x0 - 5, y0 - i);
		}

		for (let i = -axes.scale * n; i > -context$1.canvas.height / 2; i -= axes.scale * n) {
			context$1.fillText(`${new decimal(i / axes.scale).toNearest(new decimal(0.000001))}`, x0 - 5, y0 - i);
		}

		context$1.textAlign = "center";
		context$1.textBaseline = "top";

		for (let i = axes.scale * n; i < context$1.canvas.width / 2; i += axes.scale * n) {
			context$1.fillText(`${new decimal(i / axes.scale).toNearest(new decimal(0.000001))}`, x0 - i, y0 + 5);
		}

		for (let i = axes.scale * n; i < context$1.canvas.width / 2; i += axes.scale * n) {
			context$1.fillText(`${new decimal(i / axes.scale).toNearest(new decimal(0.000001))}`, x0 + i, y0 + 5);
		}

		context$1.stroke();
	}

	$$result.css.add(css);

	{
		{
			if (context$1) {
				display(myInterface._step, myInterface._scale, myInterface._bounds, myInterface._length);
			}
		}
	}

	$$unsubscribe_height();
	$$unsubscribe_width();

	return `<div class="${"container svelte-yx75fm"}"><div class="${"controls svelte-yx75fm"}" style="${"height: " + escape($height) + "px;"}"><div class="${"controls-body svelte-yx75fm"}"><div class="${"input-group svelte-yx75fm"}"><label for="${"length"}">Length:</label>
                <input id="${"length"}" type="${"number"}" step="${"any"}" class="${"svelte-yx75fm"}"${add_attribute("value", myInterface._length, 0)}></div>
            <div class="${"input-group svelte-yx75fm"}"><input id="${"lengthrange"}" type="${"range"}" min="${"0"}" max="${"10"}" step="${"0.01"}" style="${"width: 200px;"}" class="${"svelte-yx75fm"}"${add_attribute("value", myInterface._length, 0)}></div>

            <div class="${"input-group svelte-yx75fm"}"><label for="${"step"}">Step:</label>
                <input id="${"step"}" type="${"number"}" step="${"any"}" class="${"svelte-yx75fm"}"${add_attribute("value", myInterface._step, 0)}></div>
            <div class="${"input-group svelte-yx75fm"}"><input id="${"steprane"}" type="${"range"}" min="${"0"}" max="${"1"}" step="${"0.01"}" style="${"width: 200px;"}" class="${"svelte-yx75fm"}"${add_attribute("value", myInterface._step, 0)}></div>

            <div class="${"input-group svelte-yx75fm"}"><label for="${"lowx"}">Min X:</label>
                <input id="${"lowx"}" type="${"number"}" step="${"any"}" class="${"svelte-yx75fm"}"${add_attribute("value", myInterface._bounds.lowx, 0)}></div>
            <div class="${"input-group svelte-yx75fm"}"><input type="${"range"}" min="${"-100"}" max="${"100"}" step="${"0.01"}" style="${"width: 200px;"}" class="${"svelte-yx75fm"}"${add_attribute("value", myInterface._bounds.lowx, 0)}></div>

            <div class="${"input-group svelte-yx75fm"}"><label for="${"maxx"}">Max X:</label>
                <input id="${"maxx"}" type="${"number"}" step="${"any"}" class="${"svelte-yx75fm"}"${add_attribute("value", myInterface._bounds.highx, 0)}></div>
            <div class="${"input-group svelte-yx75fm"}"><input type="${"range"}" min="${"-100"}" max="${"100"}" step="${"0.01"}" style="${"width: 200px;"}" class="${"svelte-yx75fm"}"${add_attribute("value", myInterface._bounds.highx, 0)}></div>

            <div class="${"input-group svelte-yx75fm"}"><label for="${"lowy"}">Min Y:</label>
                <input id="${"lowy"}" type="${"number"}" step="${"any"}" class="${"svelte-yx75fm"}"${add_attribute("value", myInterface._bounds.lowy, 0)}></div>
            <div class="${"input-group svelte-yx75fm"}"><input type="${"range"}" min="${"-100"}" max="${"100"}" step="${"0.01"}" style="${"width: 200px;"}" class="${"svelte-yx75fm"}"${add_attribute("value", myInterface._bounds.lowy, 0)}></div>

            <div class="${"input-group svelte-yx75fm"}"><label for="${"highy"}">Max Y:</label>
                <input id="${"highy"}" type="${"number"}" step="${"any"}" class="${"svelte-yx75fm"}"${add_attribute("value", myInterface._bounds.highy, 0)}></div>
            <div class="${"input-group svelte-yx75fm"}"><input type="${"range"}" min="${"-100"}" max="${"100"}" step="${"0.01"}" style="${"width: 200px;"}" class="${"svelte-yx75fm"}"${add_attribute("value", myInterface._bounds.highy, 0)}></div>

            <div class="${"input-group svelte-yx75fm"}"><label for="${"scale"}">Bounds:</label>
                <input id="${"scale"}" type="${"number"}" step="${"any"}" class="${"svelte-yx75fm"}"${add_attribute("value", myInterface.allBounds, 0)}></div>
            <div class="${"input-group svelte-yx75fm"}"><input type="${"range"}" min="${"0"}" max="${"100"}" step="${"0.01"}" style="${"width: 200px;"}" class="${"svelte-yx75fm"}"${add_attribute("value", myInterface.allBounds, 0)}></div>

            <div class="${"input-group svelte-yx75fm"}"><label for="${"scale"}">Scale:</label>
                <input id="${"scale"}" type="${"number"}" step="${"any"}" class="${"svelte-yx75fm"}"${add_attribute("value", myInterface._scale, 0)}></div>
            <div class="${"input-group svelte-yx75fm"}"><input type="${"range"}" min="${"0.1"}" max="${"5"}" step="${"0.01"}" style="${"width: 200px;"}" class="${"svelte-yx75fm"}"${add_attribute("value", myInterface._scale, 0)}></div></div></div>
    <canvas class="${"main-canvas svelte-yx75fm"}" style="${"width: " + escape($width) + "px; height: " + escape($height) + "px;"}"${add_attribute("this", canvas$1, 0)}></canvas></div>

<div class="${"container svelte-yx75fm"}" style="${"margin-top: 50px; "}"><div id="${"editor"}" class="${"svelte-yx75fm"}"></div>
</div>`;
});

/* src\App.svelte generated by Svelte v3.45.0 */

const App = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let { url = "/" } = $$props;
	if ($$props.url === void 0 && $$bindings.url && url !== void 0) $$bindings.url(url);

	return `${validate_component(Router$1, "Router").$$render($$result, { url }, {}, {
		default: () => `<div>${validate_component(Route$1, "Route").$$render(
			$$result,
			{
				path: "/school/calculus/0.2",
				component: Math$1
			},
			{},
			{}
		)}
		${validate_component(Route$1, "Route").$$render(
			$$result,
			{
				path: "/slopefield",
				component: SlopeField
			},
			{},
			{}
		)}
		${validate_component(Route$1, "Route").$$render($$result, { path: "/register", component: Register }, {}, {})}
		${validate_component(Route$1, "Route").$$render($$result, { path: "/login", component: Login }, {}, {})}
		${validate_component(Route$1, "Route").$$render($$result, { path: "/", component: Home }, {}, {})}</div>`
	})}`;
});

module.exports = App;
