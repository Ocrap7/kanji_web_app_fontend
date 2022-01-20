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

/* node_modules/svelte-navigator/src/Router.svelte generated by Svelte v3.45.0 */

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

/* node_modules/svelte-navigator/src/Route.svelte generated by Svelte v3.45.0 */
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

/* src/Home.svelte generated by Svelte v3.45.0 */

const Home = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	return `<h1>Potato</h1>`;
});

/* src/Login.svelte generated by Svelte v3.45.0 */

const css = {
	code: ".container.svelte-17n50m7.svelte-17n50m7{margin:0 auto;margin-top:50px;padding:20px;padding-top:40px;padding-bottom:0;width:100%;height:100%;max-width:500px;max-height:500px;background-color:var(--sub-color);border-radius:5px;-webkit-box-shadow:-2px 5px 12px 5px rgba(0, 0, 0, 0.22);box-shadow:-2px 5px 12px 5px rgba(0, 0, 0, 0.22)}.container.svelte-17n50m7>input.svelte-17n50m7{width:80%;margin:0 auto;display:block;margin-bottom:40px;border-radius:5px}",
	map: "{\"version\":3,\"file\":\"Login.svelte\",\"sources\":[\"Login.svelte\"],\"sourcesContent\":[\"<script lang=\\\"ts\\\">\\n    let email = \\\"\\\";\\n    let password = \\\"\\\";\\n</script>\\n\\n<div>\\n    <h1>Login</h1>\\n    <div class=\\\"container\\\">\\n        <input type=\\\"email\\\" placeholder=\\\"email\\\" bind:value={email} required />\\n        <input\\n            type=\\\"password\\\"\\n            placeholder=\\\"password\\\"\\n            bind:value={password}\\n            required\\n        />\\n    </div>\\n</div>\\n\\n<style>\\n    .container {\\n        margin: 0 auto;\\n        margin-top: 50px;\\n        padding: 20px;\\n        padding-top: 40px;\\n        padding-bottom: 0;\\n        width: 100%;\\n        height: 100%;\\n        max-width: 500px;\\n        max-height: 500px;\\n        background-color: var(--sub-color);\\n        border-radius: 5px;\\n\\n        -webkit-box-shadow: -2px 5px 12px 5px rgba(0, 0, 0, 0.22);\\n        box-shadow: -2px 5px 12px 5px rgba(0, 0, 0, 0.22);\\n    }\\n\\n    .container > input {\\n        width: 80%;\\n        margin: 0 auto;\\n        display: block;\\n        margin-bottom: 40px;\\n        border-radius: 5px;\\n    }\\n</style>\\n\"],\"names\":[],\"mappings\":\"AAmBI,UAAU,8BAAC,CAAC,AACR,MAAM,CAAE,CAAC,CAAC,IAAI,CACd,UAAU,CAAE,IAAI,CAChB,OAAO,CAAE,IAAI,CACb,WAAW,CAAE,IAAI,CACjB,cAAc,CAAE,CAAC,CACjB,KAAK,CAAE,IAAI,CACX,MAAM,CAAE,IAAI,CACZ,SAAS,CAAE,KAAK,CAChB,UAAU,CAAE,KAAK,CACjB,gBAAgB,CAAE,IAAI,WAAW,CAAC,CAClC,aAAa,CAAE,GAAG,CAElB,kBAAkB,CAAE,IAAI,CAAC,GAAG,CAAC,IAAI,CAAC,GAAG,CAAC,KAAK,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,IAAI,CAAC,CACzD,UAAU,CAAE,IAAI,CAAC,GAAG,CAAC,IAAI,CAAC,GAAG,CAAC,KAAK,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,IAAI,CAAC,AACrD,CAAC,AAED,yBAAU,CAAG,KAAK,eAAC,CAAC,AAChB,KAAK,CAAE,GAAG,CACV,MAAM,CAAE,CAAC,CAAC,IAAI,CACd,OAAO,CAAE,KAAK,CACd,aAAa,CAAE,IAAI,CACnB,aAAa,CAAE,GAAG,AACtB,CAAC\"}"
};

const Login = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let email = "";
	let password = "";
	$$result.css.add(css);

	return `<div><h1>Login</h1>
    <div class="${"container svelte-17n50m7"}"><input type="${"email"}" placeholder="${"email"}" required class="${"svelte-17n50m7"}"${add_attribute("value", email, 0)}>
        <input type="${"password"}" placeholder="${"password"}" required class="${"svelte-17n50m7"}"${add_attribute("value", password, 0)}></div>
</div>`;
});

/* src/Register.svelte generated by Svelte v3.45.0 */

const Register = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	return `<div><h1>Register</h1></div>`;
});

/* src/App.svelte generated by Svelte v3.45.0 */

const App = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let { url = "/" } = $$props;
	if ($$props.url === void 0 && $$bindings.url && url !== void 0) $$bindings.url(url);

	return `${validate_component(Router$1, "Router").$$render($$result, { url }, {}, {
		default: () => `<div>${validate_component(Route$1, "Route").$$render($$result, { path: "/register", component: Register }, {}, {})}
		${validate_component(Route$1, "Route").$$render($$result, { path: "/login", component: Login }, {}, {})}
		${validate_component(Route$1, "Route").$$render($$result, { path: "/", component: Home }, {}, {})}</div>`
	})}`;
});

module.exports = App;
