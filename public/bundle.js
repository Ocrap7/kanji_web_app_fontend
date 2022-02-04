
(function(l, r) { if (!l || l.getElementById('livereloadscript')) return; r = l.createElement('script'); r.async = 1; r.src = '//' + (self.location.host || 'localhost').split(':')[0] + ':35729/livereload.js?snipver=1'; r.id = 'livereloadscript'; l.getElementsByTagName('head')[0].appendChild(r) })(self.document);
var app = (function () {
    'use strict';

    function noop() { }
    function assign(tar, src) {
        // @ts-ignore
        for (const k in src)
            tar[k] = src[k];
        return tar;
    }
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
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
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
    function component_subscribe(component, store, callback) {
        component.$$.on_destroy.push(subscribe(store, callback));
    }
    function create_slot(definition, ctx, $$scope, fn) {
        if (definition) {
            const slot_ctx = get_slot_context(definition, ctx, $$scope, fn);
            return definition[0](slot_ctx);
        }
    }
    function get_slot_context(definition, ctx, $$scope, fn) {
        return definition[1] && fn
            ? assign($$scope.ctx.slice(), definition[1](fn(ctx)))
            : $$scope.ctx;
    }
    function get_slot_changes(definition, $$scope, dirty, fn) {
        if (definition[2] && fn) {
            const lets = definition[2](fn(dirty));
            if ($$scope.dirty === undefined) {
                return lets;
            }
            if (typeof lets === 'object') {
                const merged = [];
                const len = Math.max($$scope.dirty.length, lets.length);
                for (let i = 0; i < len; i += 1) {
                    merged[i] = $$scope.dirty[i] | lets[i];
                }
                return merged;
            }
            return $$scope.dirty | lets;
        }
        return $$scope.dirty;
    }
    function update_slot_base(slot, slot_definition, ctx, $$scope, slot_changes, get_slot_context_fn) {
        if (slot_changes) {
            const slot_context = get_slot_context(slot_definition, ctx, $$scope, get_slot_context_fn);
            slot.p(slot_context, slot_changes);
        }
    }
    function get_all_dirty_from_scope($$scope) {
        if ($$scope.ctx.length > 32) {
            const dirty = [];
            const length = $$scope.ctx.length / 32;
            for (let i = 0; i < length; i++) {
                dirty[i] = -1;
            }
            return dirty;
        }
        return -1;
    }
    function exclude_internal_props(props) {
        const result = {};
        for (const k in props)
            if (k[0] !== '$')
                result[k] = props[k];
        return result;
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

    // Track which nodes are claimed during hydration. Unclaimed nodes can then be removed from the DOM
    // at the end of hydration without touching the remaining nodes.
    let is_hydrating = false;
    function start_hydrating() {
        is_hydrating = true;
    }
    function end_hydrating() {
        is_hydrating = false;
    }
    function upper_bound(low, high, key, value) {
        // Return first index of value larger than input value in the range [low, high)
        while (low < high) {
            const mid = low + ((high - low) >> 1);
            if (key(mid) <= value) {
                low = mid + 1;
            }
            else {
                high = mid;
            }
        }
        return low;
    }
    function init_hydrate(target) {
        if (target.hydrate_init)
            return;
        target.hydrate_init = true;
        // We know that all children have claim_order values since the unclaimed have been detached if target is not <head>
        let children = target.childNodes;
        // If target is <head>, there may be children without claim_order
        if (target.nodeName === 'HEAD') {
            const myChildren = [];
            for (let i = 0; i < children.length; i++) {
                const node = children[i];
                if (node.claim_order !== undefined) {
                    myChildren.push(node);
                }
            }
            children = myChildren;
        }
        /*
        * Reorder claimed children optimally.
        * We can reorder claimed children optimally by finding the longest subsequence of
        * nodes that are already claimed in order and only moving the rest. The longest
        * subsequence subsequence of nodes that are claimed in order can be found by
        * computing the longest increasing subsequence of .claim_order values.
        *
        * This algorithm is optimal in generating the least amount of reorder operations
        * possible.
        *
        * Proof:
        * We know that, given a set of reordering operations, the nodes that do not move
        * always form an increasing subsequence, since they do not move among each other
        * meaning that they must be already ordered among each other. Thus, the maximal
        * set of nodes that do not move form a longest increasing subsequence.
        */
        // Compute longest increasing subsequence
        // m: subsequence length j => index k of smallest value that ends an increasing subsequence of length j
        const m = new Int32Array(children.length + 1);
        // Predecessor indices + 1
        const p = new Int32Array(children.length);
        m[0] = -1;
        let longest = 0;
        for (let i = 0; i < children.length; i++) {
            const current = children[i].claim_order;
            // Find the largest subsequence length such that it ends in a value less than our current value
            // upper_bound returns first greater value, so we subtract one
            // with fast path for when we are on the current longest subsequence
            const seqLen = ((longest > 0 && children[m[longest]].claim_order <= current) ? longest + 1 : upper_bound(1, longest, idx => children[m[idx]].claim_order, current)) - 1;
            p[i] = m[seqLen] + 1;
            const newLen = seqLen + 1;
            // We can guarantee that current is the smallest value. Otherwise, we would have generated a longer sequence.
            m[newLen] = i;
            longest = Math.max(newLen, longest);
        }
        // The longest increasing subsequence of nodes (initially reversed)
        const lis = [];
        // The rest of the nodes, nodes that will be moved
        const toMove = [];
        let last = children.length - 1;
        for (let cur = m[longest] + 1; cur != 0; cur = p[cur - 1]) {
            lis.push(children[cur - 1]);
            for (; last >= cur; last--) {
                toMove.push(children[last]);
            }
            last--;
        }
        for (; last >= 0; last--) {
            toMove.push(children[last]);
        }
        lis.reverse();
        // We sort the nodes being moved to guarantee that their insertion order matches the claim order
        toMove.sort((a, b) => a.claim_order - b.claim_order);
        // Finally, we move the nodes
        for (let i = 0, j = 0; i < toMove.length; i++) {
            while (j < lis.length && toMove[i].claim_order >= lis[j].claim_order) {
                j++;
            }
            const anchor = j < lis.length ? lis[j] : null;
            target.insertBefore(toMove[i], anchor);
        }
    }
    function append_hydration(target, node) {
        if (is_hydrating) {
            init_hydrate(target);
            if ((target.actual_end_child === undefined) || ((target.actual_end_child !== null) && (target.actual_end_child.parentElement !== target))) {
                target.actual_end_child = target.firstChild;
            }
            // Skip nodes of undefined ordering
            while ((target.actual_end_child !== null) && (target.actual_end_child.claim_order === undefined)) {
                target.actual_end_child = target.actual_end_child.nextSibling;
            }
            if (node !== target.actual_end_child) {
                // We only insert if the ordering of this node should be modified or the parent node is not target
                if (node.claim_order !== undefined || node.parentNode !== target) {
                    target.insertBefore(node, target.actual_end_child);
                }
            }
            else {
                target.actual_end_child = node.nextSibling;
            }
        }
        else if (node.parentNode !== target || node.nextSibling !== null) {
            target.appendChild(node);
        }
    }
    function insert_hydration(target, node, anchor) {
        if (is_hydrating && !anchor) {
            append_hydration(target, node);
        }
        else if (node.parentNode !== target || node.nextSibling != anchor) {
            target.insertBefore(node, anchor || null);
        }
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function empty() {
        return text('');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function to_number(value) {
        return value === '' ? null : +value;
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function init_claim_info(nodes) {
        if (nodes.claim_info === undefined) {
            nodes.claim_info = { last_index: 0, total_claimed: 0 };
        }
    }
    function claim_node(nodes, predicate, processNode, createNode, dontUpdateLastIndex = false) {
        // Try to find nodes in an order such that we lengthen the longest increasing subsequence
        init_claim_info(nodes);
        const resultNode = (() => {
            // We first try to find an element after the previous one
            for (let i = nodes.claim_info.last_index; i < nodes.length; i++) {
                const node = nodes[i];
                if (predicate(node)) {
                    const replacement = processNode(node);
                    if (replacement === undefined) {
                        nodes.splice(i, 1);
                    }
                    else {
                        nodes[i] = replacement;
                    }
                    if (!dontUpdateLastIndex) {
                        nodes.claim_info.last_index = i;
                    }
                    return node;
                }
            }
            // Otherwise, we try to find one before
            // We iterate in reverse so that we don't go too far back
            for (let i = nodes.claim_info.last_index - 1; i >= 0; i--) {
                const node = nodes[i];
                if (predicate(node)) {
                    const replacement = processNode(node);
                    if (replacement === undefined) {
                        nodes.splice(i, 1);
                    }
                    else {
                        nodes[i] = replacement;
                    }
                    if (!dontUpdateLastIndex) {
                        nodes.claim_info.last_index = i;
                    }
                    else if (replacement === undefined) {
                        // Since we spliced before the last_index, we decrease it
                        nodes.claim_info.last_index--;
                    }
                    return node;
                }
            }
            // If we can't find any matching node, we create a new one
            return createNode();
        })();
        resultNode.claim_order = nodes.claim_info.total_claimed;
        nodes.claim_info.total_claimed += 1;
        return resultNode;
    }
    function claim_element_base(nodes, name, attributes, create_element) {
        return claim_node(nodes, (node) => node.nodeName === name, (node) => {
            const remove = [];
            for (let j = 0; j < node.attributes.length; j++) {
                const attribute = node.attributes[j];
                if (!attributes[attribute.name]) {
                    remove.push(attribute.name);
                }
            }
            remove.forEach(v => node.removeAttribute(v));
            return undefined;
        }, () => create_element(name));
    }
    function claim_element(nodes, name, attributes) {
        return claim_element_base(nodes, name, attributes, element);
    }
    function claim_text(nodes, data) {
        return claim_node(nodes, (node) => node.nodeType === 3, (node) => {
            const dataStr = '' + data;
            if (node.data.startsWith(dataStr)) {
                if (node.data.length !== dataStr.length) {
                    return node.splitText(dataStr.length);
                }
            }
            else {
                node.data = dataStr;
            }
        }, () => text(data), true // Text nodes should not update last index since it is likely not worth it to eliminate an increasing subsequence of actual elements
        );
    }
    function claim_space(nodes) {
        return claim_text(nodes, ' ');
    }
    function set_data(text, data) {
        data = '' + data;
        if (text.wholeText !== data)
            text.data = data;
    }
    function set_input_value(input, value) {
        input.value = value == null ? '' : value;
    }
    function set_style(node, key, value, important) {
        node.style.setProperty(key, value, important ? 'important' : '');
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
    const outroing = new Set();
    let outros;
    function group_outros() {
        outros = {
            r: 0,
            c: [],
            p: outros // parent group
        };
    }
    function check_outros() {
        if (!outros.r) {
            run_all(outros.c);
        }
        outros = outros.p;
    }
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
    }

    const globals = (typeof window !== 'undefined'
        ? window
        : typeof globalThis !== 'undefined'
            ? globalThis
            : global);

    function get_spread_update(levels, updates) {
        const update = {};
        const to_null_out = {};
        const accounted_for = { $$scope: 1 };
        let i = levels.length;
        while (i--) {
            const o = levels[i];
            const n = updates[i];
            if (n) {
                for (const key in o) {
                    if (!(key in n))
                        to_null_out[key] = 1;
                }
                for (const key in n) {
                    if (!accounted_for[key]) {
                        update[key] = n[key];
                        accounted_for[key] = 1;
                    }
                }
                levels[i] = n;
            }
            else {
                for (const key in o) {
                    accounted_for[key] = 1;
                }
            }
        }
        for (const key in to_null_out) {
            if (!(key in update))
                update[key] = undefined;
        }
        return update;
    }
    function get_spread_object(spread_props) {
        return typeof spread_props === 'object' && spread_props !== null ? spread_props : {};
    }
    function create_component(block) {
        block && block.c();
    }
    function claim_component(block, parent_nodes) {
        block && block.l(parent_nodes);
    }
    function mount_component(component, target, anchor, customElement) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        if (!customElement) {
            // onMount happens before the initial afterUpdate
            add_render_callback(() => {
                const new_on_destroy = on_mount.map(run).filter(is_function);
                if (on_destroy) {
                    on_destroy.push(...new_on_destroy);
                }
                else {
                    // Edge case - component was destroyed immediately,
                    // most likely as a result of a binding initialising
                    run_all(new_on_destroy);
                }
                component.$$.on_mount = [];
            });
        }
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, append_styles, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            on_disconnect: [],
            before_update: [],
            after_update: [],
            context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false,
            root: options.target || parent_component.$$.root
        };
        append_styles && append_styles($$.root);
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                start_hydrating();
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor, options.customElement);
            end_hydrating();
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
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

    function create_if_block$1(ctx) {
    	let div;
    	let t;

    	return {
    		c() {
    			div = element("div");
    			t = text(/*$announcementText*/ ctx[0]);
    			this.h();
    		},
    		l(nodes) {
    			div = claim_element(nodes, "DIV", {
    				role: true,
    				"aria-atomic": true,
    				"aria-live": true,
    				style: true
    			});

    			var div_nodes = children(div);
    			t = claim_text(div_nodes, /*$announcementText*/ ctx[0]);
    			div_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(div, "role", "status");
    			attr(div, "aria-atomic", "true");
    			attr(div, "aria-live", "polite");
    			attr(div, "style", visuallyHiddenStyle);
    		},
    		m(target, anchor) {
    			insert_hydration(target, div, anchor);
    			append_hydration(div, t);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*$announcementText*/ 1) set_data(t, /*$announcementText*/ ctx[0]);
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    function create_fragment$9(ctx) {
    	let div;
    	let t0;
    	let t1;
    	let if_block_anchor;
    	let current;
    	const default_slot_template = /*#slots*/ ctx[20].default;
    	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[19], null);
    	let if_block = /*isTopLevelRouter*/ ctx[2] && /*manageFocus*/ ctx[4] && /*a11yConfig*/ ctx[1].announcements && create_if_block$1(ctx);

    	return {
    		c() {
    			div = element("div");
    			t0 = space();
    			if (default_slot) default_slot.c();
    			t1 = space();
    			if (if_block) if_block.c();
    			if_block_anchor = empty();
    			this.h();
    		},
    		l(nodes) {
    			div = claim_element(nodes, "DIV", {
    				style: true,
    				"aria-hidden": true,
    				"data-svnav-router": true
    			});

    			children(div).forEach(detach);
    			t0 = claim_space(nodes);
    			if (default_slot) default_slot.l(nodes);
    			t1 = claim_space(nodes);
    			if (if_block) if_block.l(nodes);
    			if_block_anchor = empty();
    			this.h();
    		},
    		h() {
    			set_style(div, "display", "none");
    			attr(div, "aria-hidden", "true");
    			attr(div, "data-svnav-router", /*routerId*/ ctx[3]);
    		},
    		m(target, anchor) {
    			insert_hydration(target, div, anchor);
    			insert_hydration(target, t0, anchor);

    			if (default_slot) {
    				default_slot.m(target, anchor);
    			}

    			insert_hydration(target, t1, anchor);
    			if (if_block) if_block.m(target, anchor);
    			insert_hydration(target, if_block_anchor, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			if (default_slot) {
    				if (default_slot.p && (!current || dirty[0] & /*$$scope*/ 524288)) {
    					update_slot_base(
    						default_slot,
    						default_slot_template,
    						ctx,
    						/*$$scope*/ ctx[19],
    						!current
    						? get_all_dirty_from_scope(/*$$scope*/ ctx[19])
    						: get_slot_changes(default_slot_template, /*$$scope*/ ctx[19], dirty, null),
    						null
    					);
    				}
    			}

    			if (/*isTopLevelRouter*/ ctx[2] && /*manageFocus*/ ctx[4] && /*a11yConfig*/ ctx[1].announcements) if_block.p(ctx, dirty);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(default_slot, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(default_slot, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			if (detaching) detach(t0);
    			if (default_slot) default_slot.d(detaching);
    			if (detaching) detach(t1);
    			if (if_block) if_block.d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    const createId$1 = createCounter();
    const defaultBasepath = "/";

    function instance$7($$self, $$props, $$invalidate) {
    	let $location;
    	let $activeRoute;
    	let $prevLocation;
    	let $routes;
    	let $announcementText;
    	let { $$slots: slots = {}, $$scope } = $$props;
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
    	component_subscribe($$self, announcementText, value => $$invalidate(0, $announcementText = value));
    	const routes = writable([]);
    	component_subscribe($$self, routes, value => $$invalidate(18, $routes = value));
    	const activeRoute = writable(null);
    	component_subscribe($$self, activeRoute, value => $$invalidate(16, $activeRoute = value));

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

    	component_subscribe($$self, location, value => $$invalidate(15, $location = value));
    	const prevLocation = writable($location);
    	component_subscribe($$self, prevLocation, value => $$invalidate(17, $prevLocation = value));
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

    	$$self.$$set = $$props => {
    		if ('basepath' in $$props) $$invalidate(10, basepath = $$props.basepath);
    		if ('url' in $$props) $$invalidate(11, url = $$props.url);
    		if ('history' in $$props) $$invalidate(12, history = $$props.history);
    		if ('primary' in $$props) $$invalidate(13, primary = $$props.primary);
    		if ('a11y' in $$props) $$invalidate(14, a11y = $$props.a11y);
    		if ('$$scope' in $$props) $$invalidate(19, $$scope = $$props.$$scope);
    	};

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty[0] & /*basepath*/ 1024) {
    			if (basepath !== initialBasepath) {
    				warn(ROUTER_ID, 'You cannot change the "basepath" prop. It is ignored.');
    			}
    		}

    		if ($$self.$$.dirty[0] & /*$routes, $location*/ 294912) {
    			// This reactive statement will be run when the Router is created
    			// when there are no Routes and then again the following tick, so it
    			// will not find an active Route in SSR and in the browser it will only
    			// pick an active Route after all Routes have been registered.
    			{
    				const bestMatch = pick($routes, $location.pathname);
    				activeRoute.set(bestMatch);
    			}
    		}

    		if ($$self.$$.dirty[0] & /*$location, $prevLocation*/ 163840) {
    			// Manage focus and announce navigation to screen reader users
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

    		if ($$self.$$.dirty[0] & /*$activeRoute*/ 65536) {
    			// Queue matched Route, so top level Router can decide which Route to focus.
    			// Non primary Routers should just be ignored
    			if (manageFocus && $activeRoute && $activeRoute.primary) {
    				pushFocusCandidate({ level, routerId, route: $activeRoute });
    			}
    		}
    	};

    	return [
    		$announcementText,
    		a11yConfig,
    		isTopLevelRouter,
    		routerId,
    		manageFocus,
    		announcementText,
    		routes,
    		activeRoute,
    		location,
    		prevLocation,
    		basepath,
    		url,
    		history,
    		primary,
    		a11y,
    		$location,
    		$activeRoute,
    		$prevLocation,
    		$routes,
    		$$scope,
    		slots
    	];
    }

    class Router extends SvelteComponent {
    	constructor(options) {
    		super();

    		init(
    			this,
    			options,
    			instance$7,
    			create_fragment$9,
    			safe_not_equal,
    			{
    				basepath: 10,
    				url: 11,
    				history: 12,
    				primary: 13,
    				a11y: 14
    			},
    			null,
    			[-1, -1]
    		);
    	}
    }

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

    const get_default_slot_changes = dirty => ({
    	params: dirty & /*$params*/ 16,
    	location: dirty & /*$location*/ 8
    });

    const get_default_slot_context = ctx => ({
    	params: isSSR ? get_store_value(/*params*/ ctx[9]) : /*$params*/ ctx[4],
    	location: /*$location*/ ctx[3],
    	navigate: /*navigate*/ ctx[10]
    });

    // (97:0) {#if isActive}
    function create_if_block(ctx) {
    	let router;
    	let current;

    	router = new Router$1({
    			props: {
    				primary: /*primary*/ ctx[1],
    				$$slots: { default: [create_default_slot$3] },
    				$$scope: { ctx }
    			}
    		});

    	return {
    		c() {
    			create_component(router.$$.fragment);
    		},
    		l(nodes) {
    			claim_component(router.$$.fragment, nodes);
    		},
    		m(target, anchor) {
    			mount_component(router, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const router_changes = {};
    			if (dirty & /*primary*/ 2) router_changes.primary = /*primary*/ ctx[1];

    			if (dirty & /*$$scope, component, $location, $params, $$restProps*/ 264217) {
    				router_changes.$$scope = { dirty, ctx };
    			}

    			router.$set(router_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(router.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(router.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(router, detaching);
    		}
    	};
    }

    // (113:2) {:else}
    function create_else_block(ctx) {
    	let current;
    	const default_slot_template = /*#slots*/ ctx[17].default;
    	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[18], get_default_slot_context);

    	return {
    		c() {
    			if (default_slot) default_slot.c();
    		},
    		l(nodes) {
    			if (default_slot) default_slot.l(nodes);
    		},
    		m(target, anchor) {
    			if (default_slot) {
    				default_slot.m(target, anchor);
    			}

    			current = true;
    		},
    		p(ctx, dirty) {
    			if (default_slot) {
    				if (default_slot.p && (!current || dirty & /*$$scope, $params, $location*/ 262168)) {
    					update_slot_base(
    						default_slot,
    						default_slot_template,
    						ctx,
    						/*$$scope*/ ctx[18],
    						!current
    						? get_all_dirty_from_scope(/*$$scope*/ ctx[18])
    						: get_slot_changes(default_slot_template, /*$$scope*/ ctx[18], dirty, get_default_slot_changes),
    						get_default_slot_context
    					);
    				}
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(default_slot, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(default_slot, local);
    			current = false;
    		},
    		d(detaching) {
    			if (default_slot) default_slot.d(detaching);
    		}
    	};
    }

    // (105:2) {#if component !== null}
    function create_if_block_1(ctx) {
    	let switch_instance;
    	let switch_instance_anchor;
    	let current;

    	const switch_instance_spread_levels = [
    		{ location: /*$location*/ ctx[3] },
    		{ navigate: /*navigate*/ ctx[10] },
    		isSSR ? get_store_value(/*params*/ ctx[9]) : /*$params*/ ctx[4],
    		/*$$restProps*/ ctx[11]
    	];

    	var switch_value = /*component*/ ctx[0];

    	function switch_props(ctx) {
    		let switch_instance_props = {};

    		for (let i = 0; i < switch_instance_spread_levels.length; i += 1) {
    			switch_instance_props = assign(switch_instance_props, switch_instance_spread_levels[i]);
    		}

    		return { props: switch_instance_props };
    	}

    	if (switch_value) {
    		switch_instance = new switch_value(switch_props());
    	}

    	return {
    		c() {
    			if (switch_instance) create_component(switch_instance.$$.fragment);
    			switch_instance_anchor = empty();
    		},
    		l(nodes) {
    			if (switch_instance) claim_component(switch_instance.$$.fragment, nodes);
    			switch_instance_anchor = empty();
    		},
    		m(target, anchor) {
    			if (switch_instance) {
    				mount_component(switch_instance, target, anchor);
    			}

    			insert_hydration(target, switch_instance_anchor, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const switch_instance_changes = (dirty & /*$location, navigate, isSSR, get, params, $params, $$restProps*/ 3608)
    			? get_spread_update(switch_instance_spread_levels, [
    					dirty & /*$location*/ 8 && { location: /*$location*/ ctx[3] },
    					dirty & /*navigate*/ 1024 && { navigate: /*navigate*/ ctx[10] },
    					dirty & /*isSSR, get, params, $params*/ 528 && get_spread_object(isSSR ? get_store_value(/*params*/ ctx[9]) : /*$params*/ ctx[4]),
    					dirty & /*$$restProps*/ 2048 && get_spread_object(/*$$restProps*/ ctx[11])
    				])
    			: {};

    			if (switch_value !== (switch_value = /*component*/ ctx[0])) {
    				if (switch_instance) {
    					group_outros();
    					const old_component = switch_instance;

    					transition_out(old_component.$$.fragment, 1, 0, () => {
    						destroy_component(old_component, 1);
    					});

    					check_outros();
    				}

    				if (switch_value) {
    					switch_instance = new switch_value(switch_props());
    					create_component(switch_instance.$$.fragment);
    					transition_in(switch_instance.$$.fragment, 1);
    					mount_component(switch_instance, switch_instance_anchor.parentNode, switch_instance_anchor);
    				} else {
    					switch_instance = null;
    				}
    			} else if (switch_value) {
    				switch_instance.$set(switch_instance_changes);
    			}
    		},
    		i(local) {
    			if (current) return;
    			if (switch_instance) transition_in(switch_instance.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			if (switch_instance) transition_out(switch_instance.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(switch_instance_anchor);
    			if (switch_instance) destroy_component(switch_instance, detaching);
    		}
    	};
    }

    // (98:1) <Router {primary}>
    function create_default_slot$3(ctx) {
    	let current_block_type_index;
    	let if_block;
    	let if_block_anchor;
    	let current;
    	const if_block_creators = [create_if_block_1, create_else_block];
    	const if_blocks = [];

    	function select_block_type(ctx, dirty) {
    		if (/*component*/ ctx[0] !== null) return 0;
    		return 1;
    	}

    	current_block_type_index = select_block_type(ctx);
    	if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);

    	return {
    		c() {
    			if_block.c();
    			if_block_anchor = empty();
    		},
    		l(nodes) {
    			if_block.l(nodes);
    			if_block_anchor = empty();
    		},
    		m(target, anchor) {
    			if_blocks[current_block_type_index].m(target, anchor);
    			insert_hydration(target, if_block_anchor, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			let previous_block_index = current_block_type_index;
    			current_block_type_index = select_block_type(ctx);

    			if (current_block_type_index === previous_block_index) {
    				if_blocks[current_block_type_index].p(ctx, dirty);
    			} else {
    				group_outros();

    				transition_out(if_blocks[previous_block_index], 1, 1, () => {
    					if_blocks[previous_block_index] = null;
    				});

    				check_outros();
    				if_block = if_blocks[current_block_type_index];

    				if (!if_block) {
    					if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    					if_block.c();
    				} else {
    					if_block.p(ctx, dirty);
    				}

    				transition_in(if_block, 1);
    				if_block.m(if_block_anchor.parentNode, if_block_anchor);
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(if_block);
    			current = true;
    		},
    		o(local) {
    			transition_out(if_block);
    			current = false;
    		},
    		d(detaching) {
    			if_blocks[current_block_type_index].d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    function create_fragment$8(ctx) {
    	let div0;
    	let t0;
    	let t1;
    	let div1;
    	let current;
    	let if_block = /*isActive*/ ctx[2] && create_if_block(ctx);

    	return {
    		c() {
    			div0 = element("div");
    			t0 = space();
    			if (if_block) if_block.c();
    			t1 = space();
    			div1 = element("div");
    			this.h();
    		},
    		l(nodes) {
    			div0 = claim_element(nodes, "DIV", {
    				style: true,
    				"aria-hidden": true,
    				"data-svnav-route-start": true
    			});

    			children(div0).forEach(detach);
    			t0 = claim_space(nodes);
    			if (if_block) if_block.l(nodes);
    			t1 = claim_space(nodes);

    			div1 = claim_element(nodes, "DIV", {
    				style: true,
    				"aria-hidden": true,
    				"data-svnav-route-end": true
    			});

    			children(div1).forEach(detach);
    			this.h();
    		},
    		h() {
    			set_style(div0, "display", "none");
    			attr(div0, "aria-hidden", "true");
    			attr(div0, "data-svnav-route-start", /*id*/ ctx[5]);
    			set_style(div1, "display", "none");
    			attr(div1, "aria-hidden", "true");
    			attr(div1, "data-svnav-route-end", /*id*/ ctx[5]);
    		},
    		m(target, anchor) {
    			insert_hydration(target, div0, anchor);
    			insert_hydration(target, t0, anchor);
    			if (if_block) if_block.m(target, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, div1, anchor);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			if (/*isActive*/ ctx[2]) {
    				if (if_block) {
    					if_block.p(ctx, dirty);

    					if (dirty & /*isActive*/ 4) {
    						transition_in(if_block, 1);
    					}
    				} else {
    					if_block = create_if_block(ctx);
    					if_block.c();
    					transition_in(if_block, 1);
    					if_block.m(t1.parentNode, t1);
    				}
    			} else if (if_block) {
    				group_outros();

    				transition_out(if_block, 1, 1, () => {
    					if_block = null;
    				});

    				check_outros();
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(if_block);
    			current = true;
    		},
    		o(local) {
    			transition_out(if_block);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div0);
    			if (detaching) detach(t0);
    			if (if_block) if_block.d(detaching);
    			if (detaching) detach(t1);
    			if (detaching) detach(div1);
    		}
    	};
    }

    const createId = createCounter();

    function instance$6($$self, $$props, $$invalidate) {
    	let isActive;
    	const omit_props_names = ["path","component","meta","primary"];
    	let $$restProps = compute_rest_props($$props, omit_props_names);
    	let $activeRoute;
    	let $location;
    	let $parentBase;
    	let $params;
    	let { $$slots: slots = {}, $$scope } = $$props;
    	let { path = "" } = $$props;
    	let { component = null } = $$props;
    	let { meta = {} } = $$props;
    	let { primary = true } = $$props;
    	usePreflightCheck(ROUTE_ID, $$props);
    	const id = createId();
    	const { registerRoute, unregisterRoute, activeRoute } = getContext(ROUTER);
    	component_subscribe($$self, activeRoute, value => $$invalidate(15, $activeRoute = value));
    	const parentBase = useRouteBase();
    	component_subscribe($$self, parentBase, value => $$invalidate(16, $parentBase = value));
    	const location = useLocation();
    	component_subscribe($$self, location, value => $$invalidate(3, $location = value));
    	const focusElement = writable(null);

    	// In SSR we cannot wait for $activeRoute to update,
    	// so we use the match returned from `registerRoute` instead
    	let ssrMatch;

    	const route = writable();
    	const params = writable({});
    	component_subscribe($$self, params, value => $$invalidate(4, $params = value));
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

    	$$self.$$set = $$new_props => {
    		$$invalidate(23, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
    		$$invalidate(11, $$restProps = compute_rest_props($$props, omit_props_names));
    		if ('path' in $$new_props) $$invalidate(12, path = $$new_props.path);
    		if ('component' in $$new_props) $$invalidate(0, component = $$new_props.component);
    		if ('meta' in $$new_props) $$invalidate(13, meta = $$new_props.meta);
    		if ('primary' in $$new_props) $$invalidate(1, primary = $$new_props.primary);
    		if ('$$scope' in $$new_props) $$invalidate(18, $$scope = $$new_props.$$scope);
    	};

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*path, $parentBase, meta, $location, primary*/ 77834) {
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
    				$$invalidate(14, ssrMatch = registerRoute(updatedRoute));
    			}
    		}

    		if ($$self.$$.dirty & /*ssrMatch, $activeRoute*/ 49152) {
    			$$invalidate(2, isActive = !!(ssrMatch || $activeRoute && $activeRoute.id === id));
    		}

    		if ($$self.$$.dirty & /*isActive, ssrMatch, $activeRoute*/ 49156) {
    			if (isActive) {
    				const { params: activeParams } = ssrMatch || $activeRoute;
    				params.set(activeParams);
    			}
    		}
    	};

    	$$props = exclude_internal_props($$props);

    	return [
    		component,
    		primary,
    		isActive,
    		$location,
    		$params,
    		id,
    		activeRoute,
    		parentBase,
    		location,
    		params,
    		navigate,
    		$$restProps,
    		path,
    		meta,
    		ssrMatch,
    		$activeRoute,
    		$parentBase,
    		slots,
    		$$scope
    	];
    }

    class Route extends SvelteComponent {
    	constructor(options) {
    		super();

    		init(this, options, instance$6, create_fragment$8, safe_not_equal, {
    			path: 12,
    			component: 0,
    			meta: 13,
    			primary: 1
    		});
    	}
    }

    var Route$1 = Route;

    /* src\Home.svelte generated by Svelte v3.45.0 */

    function create_fragment$7(ctx) {
    	let h1;
    	let t;

    	return {
    		c() {
    			h1 = element("h1");
    			t = text("Potato");
    		},
    		l(nodes) {
    			h1 = claim_element(nodes, "H1", {});
    			var h1_nodes = children(h1);
    			t = claim_text(h1_nodes, "Potato");
    			h1_nodes.forEach(detach);
    		},
    		m(target, anchor) {
    			insert_hydration(target, h1, anchor);
    			append_hydration(h1, t);
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(h1);
    		}
    	};
    }

    class Home extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, null, create_fragment$7, safe_not_equal, {});
    	}
    }

    /* src\Login.svelte generated by Svelte v3.45.0 */

    function create_fragment$6(ctx) {
    	let div1;
    	let h1;
    	let t0;
    	let t1;
    	let div0;
    	let input0;
    	let t2;
    	let input1;
    	let mounted;
    	let dispose;

    	return {
    		c() {
    			div1 = element("div");
    			h1 = element("h1");
    			t0 = text("Login");
    			t1 = space();
    			div0 = element("div");
    			input0 = element("input");
    			t2 = space();
    			input1 = element("input");
    			this.h();
    		},
    		l(nodes) {
    			div1 = claim_element(nodes, "DIV", {});
    			var div1_nodes = children(div1);
    			h1 = claim_element(div1_nodes, "H1", {});
    			var h1_nodes = children(h1);
    			t0 = claim_text(h1_nodes, "Login");
    			h1_nodes.forEach(detach);
    			t1 = claim_space(div1_nodes);
    			div0 = claim_element(div1_nodes, "DIV", { class: true });
    			var div0_nodes = children(div0);

    			input0 = claim_element(div0_nodes, "INPUT", {
    				type: true,
    				placeholder: true,
    				class: true
    			});

    			t2 = claim_space(div0_nodes);

    			input1 = claim_element(div0_nodes, "INPUT", {
    				type: true,
    				placeholder: true,
    				class: true
    			});

    			div0_nodes.forEach(detach);
    			div1_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(input0, "type", "email");
    			attr(input0, "placeholder", "email");
    			input0.required = true;
    			attr(input0, "class", "svelte-17n50m7");
    			attr(input1, "type", "password");
    			attr(input1, "placeholder", "password");
    			input1.required = true;
    			attr(input1, "class", "svelte-17n50m7");
    			attr(div0, "class", "container svelte-17n50m7");
    		},
    		m(target, anchor) {
    			insert_hydration(target, div1, anchor);
    			append_hydration(div1, h1);
    			append_hydration(h1, t0);
    			append_hydration(div1, t1);
    			append_hydration(div1, div0);
    			append_hydration(div0, input0);
    			set_input_value(input0, /*email*/ ctx[0]);
    			append_hydration(div0, t2);
    			append_hydration(div0, input1);
    			set_input_value(input1, /*password*/ ctx[1]);

    			if (!mounted) {
    				dispose = [
    					listen(input0, "input", /*input0_input_handler*/ ctx[2]),
    					listen(input1, "input", /*input1_input_handler*/ ctx[3])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*email*/ 1 && input0.value !== /*email*/ ctx[0]) {
    				set_input_value(input0, /*email*/ ctx[0]);
    			}

    			if (dirty & /*password*/ 2 && input1.value !== /*password*/ ctx[1]) {
    				set_input_value(input1, /*password*/ ctx[1]);
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(div1);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function instance$5($$self, $$props, $$invalidate) {
    	let email = "";
    	let password = "";

    	function input0_input_handler() {
    		email = this.value;
    		$$invalidate(0, email);
    	}

    	function input1_input_handler() {
    		password = this.value;
    		$$invalidate(1, password);
    	}

    	return [email, password, input0_input_handler, input1_input_handler];
    }

    class Login extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$5, create_fragment$6, safe_not_equal, {});
    	}
    }

    /* src\Equation.svelte generated by Svelte v3.45.0 */

    function create_fragment$5(ctx) {
    	let span;
    	let current;
    	const default_slot_template = /*#slots*/ ctx[2].default;
    	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[1], null);

    	return {
    		c() {
    			span = element("span");
    			if (default_slot) default_slot.c();
    			this.h();
    		},
    		l(nodes) {
    			span = claim_element(nodes, "SPAN", { class: true });
    			var span_nodes = children(span);
    			if (default_slot) default_slot.l(span_nodes);
    			span_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(span, "class", "equ");
    		},
    		m(target, anchor) {
    			insert_hydration(target, span, anchor);

    			if (default_slot) {
    				default_slot.m(span, null);
    			}

    			/*span_binding*/ ctx[3](span);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			if (default_slot) {
    				if (default_slot.p && (!current || dirty & /*$$scope*/ 2)) {
    					update_slot_base(
    						default_slot,
    						default_slot_template,
    						ctx,
    						/*$$scope*/ ctx[1],
    						!current
    						? get_all_dirty_from_scope(/*$$scope*/ ctx[1])
    						: get_slot_changes(default_slot_template, /*$$scope*/ ctx[1], dirty, null),
    						null
    					);
    				}
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(default_slot, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(default_slot, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(span);
    			if (default_slot) default_slot.d(detaching);
    			/*span_binding*/ ctx[3](null);
    		}
    	};
    }

    function instance$4($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	let equation;

    	onMount(() => {
    		window.MQ.StaticMath(equation);
    	});

    	function span_binding($$value) {
    		binding_callbacks[$$value ? 'unshift' : 'push'](() => {
    			equation = $$value;
    			$$invalidate(0, equation);
    		});
    	}

    	$$self.$$set = $$props => {
    		if ('$$scope' in $$props) $$invalidate(1, $$scope = $$props.$$scope);
    	};

    	return [equation, $$scope, slots, span_binding];
    }

    class Equation extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$4, create_fragment$5, safe_not_equal, {});
    	}
    }

    /* src\Graph.svelte generated by Svelte v3.45.0 */

    function create_default_slot$2(ctx) {
    	let t;

    	return {
    		c() {
    			t = text(/*equation*/ ctx[0]);
    		},
    		l(nodes) {
    			t = claim_text(nodes, /*equation*/ ctx[0]);
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*equation*/ 1) set_data(t, /*equation*/ ctx[0]);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    function create_fragment$4(ctx) {
    	let div1;
    	let equation_1;
    	let t;
    	let div0;
    	let current;

    	equation_1 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot$2] },
    				$$scope: { ctx }
    			}
    		});

    	return {
    		c() {
    			div1 = element("div");
    			create_component(equation_1.$$.fragment);
    			t = space();
    			div0 = element("div");
    			this.h();
    		},
    		l(nodes) {
    			div1 = claim_element(nodes, "DIV", { class: true });
    			var div1_nodes = children(div1);
    			claim_component(equation_1.$$.fragment, div1_nodes);
    			t = claim_space(div1_nodes);
    			div0 = claim_element(div1_nodes, "DIV", { class: true, style: true });
    			children(div0).forEach(detach);
    			div1_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(div0, "class", "graph svelte-pmv13l");
    			set_style(div0, "width", /*width*/ ctx[1] + "px");
    			set_style(div0, "height", /*height*/ ctx[2] + "px");
    			attr(div1, "class", "graph-container svelte-pmv13l");
    		},
    		m(target, anchor) {
    			insert_hydration(target, div1, anchor);
    			mount_component(equation_1, div1, null);
    			append_hydration(div1, t);
    			append_hydration(div1, div0);
    			/*div0_binding*/ ctx[8](div0);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			const equation_1_changes = {};

    			if (dirty & /*$$scope, equation*/ 513) {
    				equation_1_changes.$$scope = { dirty, ctx };
    			}

    			equation_1.$set(equation_1_changes);

    			if (!current || dirty & /*width*/ 2) {
    				set_style(div0, "width", /*width*/ ctx[1] + "px");
    			}

    			if (!current || dirty & /*height*/ 4) {
    				set_style(div0, "height", /*height*/ ctx[2] + "px");
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(equation_1.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(equation_1.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div1);
    			destroy_component(equation_1);
    			/*div0_binding*/ ctx[8](null);
    		}
    	};
    }

    const colors = typeof window === "undefined"
    ? {}
    : window.Desmos.Colors;

    function instance$3($$self, $$props, $$invalidate) {
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

    	function div0_binding($$value) {
    		binding_callbacks[$$value ? 'unshift' : 'push'](() => {
    			element = $$value;
    			$$invalidate(3, element);
    		});
    	}

    	$$self.$$set = $$props => {
    		if ('equation' in $$props) $$invalidate(0, equation = $$props.equation);
    		if ('color' in $$props) $$invalidate(4, color = $$props.color);
    		if ('options' in $$props) $$invalidate(5, options = $$props.options);
    		if ('bounds' in $$props) $$invalidate(6, bounds = $$props.bounds);
    		if ('display' in $$props) $$invalidate(7, display = $$props.display);
    		if ('width' in $$props) $$invalidate(1, width = $$props.width);
    		if ('height' in $$props) $$invalidate(2, height = $$props.height);
    	};

    	return [
    		equation,
    		width,
    		height,
    		element,
    		color,
    		options,
    		bounds,
    		display,
    		div0_binding
    	];
    }

    class Graph extends SvelteComponent {
    	constructor(options) {
    		super();

    		init(this, options, instance$3, create_fragment$4, safe_not_equal, {
    			equation: 0,
    			color: 4,
    			options: 5,
    			bounds: 6,
    			display: 7,
    			width: 1,
    			height: 2
    		});
    	}
    }

    /* src\Math.svelte generated by Svelte v3.45.0 */

    const { window: window_1 } = globals;

    function create_default_slot_112(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("sin(x)\\ \\ \\ \\ x\\ \\in\\ \\R,\\ \\ \\ y\\ \\in\\ [-1, 1]");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "sin(x)\\ \\ \\ \\ x\\ \\in\\ \\R,\\ \\ \\ y\\ \\in\\ [-1, 1]");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (84:20) <Equation                          >
    function create_default_slot_111(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("arcsin(x)\\ \\ \\ \\ x\\ \\in\\ [-1, 1],\\ \\ \\ y\\ \\in\\\r\n                        [-\\frac\\pi2, \\frac\\pi2]");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "arcsin(x)\\ \\ \\ \\ x\\ \\in\\ [-1, 1],\\ \\ \\ y\\ \\in\\\r\n                        [-\\frac\\pi2, \\frac\\pi2]");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (92:20) <Equation                          >
    function create_default_slot_110(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("cos(x)\\ \\ \\ \\ x\\ \\in\\ \\R,\\ \\ \\ y\\ \\in\\ [-1, 1]");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "cos(x)\\ \\ \\ \\ x\\ \\in\\ \\R,\\ \\ \\ y\\ \\in\\ [-1, 1]");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (97:20) <Equation                          >
    function create_default_slot_109(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("arccos(x)\\ \\ \\ \\ x\\ \\in\\ [-1, 1],\\ \\ \\ y\\ \\in\\ [0, \\pi]");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "arccos(x)\\ \\ \\ \\ x\\ \\in\\ [-1, 1],\\ \\ \\ y\\ \\in\\ [0, \\pi]");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (104:20) <Equation                          >
    function create_default_slot_108(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;
    	let t4_value = "{" + "";
    	let t4;
    	let t5;
    	let t6_value = "}" + "";
    	let t6;
    	let t7;

    	return {
    		c() {
    			t0 = text("tan(x)\\ \\ \\ \\ x\\ \\in\\ \\R\\ \\ except\\ \\ x = \\frac");
    			t1 = text(t1_value);
    			t2 = text("\\pi");
    			t3 = text(t3_value);
    			t4 = text(t4_value);
    			t5 = text("2");
    			t6 = text(t6_value);
    			t7 = text("\r\n                        \\pm n\\pi,\\ \\ \\ y\\ \\in\\ [-\\infty, \\infty]");
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "tan(x)\\ \\ \\ \\ x\\ \\in\\ \\R\\ \\ except\\ \\ x = \\frac");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "\\pi");
    			t3 = claim_text(nodes, t3_value);
    			t4 = claim_text(nodes, t4_value);
    			t5 = claim_text(nodes, "2");
    			t6 = claim_text(nodes, t6_value);
    			t7 = claim_text(nodes, "\r\n                        \\pm n\\pi,\\ \\ \\ y\\ \\in\\ [-\\infty, \\infty]");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, t4, anchor);
    			insert_hydration(target, t5, anchor);
    			insert_hydration(target, t6, anchor);
    			insert_hydration(target, t7, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (detaching) detach(t4);
    			if (detaching) detach(t5);
    			if (detaching) detach(t6);
    			if (detaching) detach(t7);
    		}
    	};
    }

    // (110:20) <Equation                          >
    function create_default_slot_107(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("arctan(x)\\ \\ \\ \\ x\\ \\in\\ \\R,\\ \\ \\ y\\ \\in\\ [-\\frac\\pi2,\r\n                        \\frac\\pi2]");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "arctan(x)\\ \\ \\ \\ x\\ \\in\\ \\R,\\ \\ \\ y\\ \\in\\ [-\\frac\\pi2,\r\n                        \\frac\\pi2]");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (122:12) <Equation>
    function create_default_slot_106(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("asin(b(x+c))");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "asin(b(x+c))");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (130:20) <Equation>
    function create_default_slot_105(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("\\theta");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "\\theta");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (131:20) <Equation>
    function create_default_slot_104(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("sin(\\theta)");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "sin(\\theta)");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (132:20) <Equation>
    function create_default_slot_103(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("cos(\\theta)");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "cos(\\theta)");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (133:20) <Equation>
    function create_default_slot_102(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("tan(\\theta)");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "tan(\\theta)");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (134:20) <Equation>
    function create_default_slot_101(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("csc(\\theta)");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "csc(\\theta)");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (135:20) <Equation>
    function create_default_slot_100(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("sec(\\theta)");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "sec(\\theta)");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (136:20) <Equation>
    function create_default_slot_99(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("cot(\\theta)");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "cot(\\theta)");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (148:20) <Equation>
    function create_default_slot_98(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("\\frac\\pi2");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "\\frac\\pi2");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (157:20) <Equation>
    function create_default_slot_97(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("\\pi");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "\\pi");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (166:20) <Equation>
    function create_default_slot_96(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("\\frac\\pi6");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "\\frac\\pi6");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (167:20) <Equation>
    function create_default_slot_95(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;
    	let t4_value = "{" + "";
    	let t4;
    	let t5;
    	let t6_value = "}" + "";
    	let t6;

    	return {
    		c() {
    			t0 = text("\\frac");
    			t1 = text(t1_value);
    			t2 = text("1");
    			t3 = text(t3_value);
    			t4 = text(t4_value);
    			t5 = text("2");
    			t6 = text(t6_value);
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "\\frac");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "1");
    			t3 = claim_text(nodes, t3_value);
    			t4 = claim_text(nodes, t4_value);
    			t5 = claim_text(nodes, "2");
    			t6 = claim_text(nodes, t6_value);
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, t4, anchor);
    			insert_hydration(target, t5, anchor);
    			insert_hydration(target, t6, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (detaching) detach(t4);
    			if (detaching) detach(t5);
    			if (detaching) detach(t6);
    		}
    	};
    }

    // (168:20) <Equation>
    function create_default_slot_94(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;
    	let t4_value = "{" + "";
    	let t4;
    	let t5;
    	let t6_value = "}" + "";
    	let t6;

    	return {
    		c() {
    			t0 = text("\\frac");
    			t1 = text(t1_value);
    			t2 = text("\\sqrt3");
    			t3 = text(t3_value);
    			t4 = text(t4_value);
    			t5 = text("2");
    			t6 = text(t6_value);
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "\\frac");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "\\sqrt3");
    			t3 = claim_text(nodes, t3_value);
    			t4 = claim_text(nodes, t4_value);
    			t5 = claim_text(nodes, "2");
    			t6 = claim_text(nodes, t6_value);
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, t4, anchor);
    			insert_hydration(target, t5, anchor);
    			insert_hydration(target, t6, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (detaching) detach(t4);
    			if (detaching) detach(t5);
    			if (detaching) detach(t6);
    		}
    	};
    }

    // (169:20) <Equation>
    function create_default_slot_93(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;
    	let t4_value = "{" + "";
    	let t4;
    	let t5;
    	let t6_value = "}" + "";
    	let t6;

    	return {
    		c() {
    			t0 = text("\\frac");
    			t1 = text(t1_value);
    			t2 = text("1");
    			t3 = text(t3_value);
    			t4 = text(t4_value);
    			t5 = text("\\sqrt3");
    			t6 = text(t6_value);
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "\\frac");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "1");
    			t3 = claim_text(nodes, t3_value);
    			t4 = claim_text(nodes, t4_value);
    			t5 = claim_text(nodes, "\\sqrt3");
    			t6 = claim_text(nodes, t6_value);
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, t4, anchor);
    			insert_hydration(target, t5, anchor);
    			insert_hydration(target, t6, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (detaching) detach(t4);
    			if (detaching) detach(t5);
    			if (detaching) detach(t6);
    		}
    	};
    }

    // (170:20) <Equation>
    function create_default_slot_92(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("\\sqrt3");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "\\sqrt3");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (171:20) <Equation>
    function create_default_slot_91(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;
    	let t4_value = "{" + "";
    	let t4;
    	let t5;
    	let t6_value = "}" + "";
    	let t6;

    	return {
    		c() {
    			t0 = text("\\frac");
    			t1 = text(t1_value);
    			t2 = text("2");
    			t3 = text(t3_value);
    			t4 = text(t4_value);
    			t5 = text("\\sqrt3");
    			t6 = text(t6_value);
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "\\frac");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "2");
    			t3 = claim_text(nodes, t3_value);
    			t4 = claim_text(nodes, t4_value);
    			t5 = claim_text(nodes, "\\sqrt3");
    			t6 = claim_text(nodes, t6_value);
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, t4, anchor);
    			insert_hydration(target, t5, anchor);
    			insert_hydration(target, t6, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (detaching) detach(t4);
    			if (detaching) detach(t5);
    			if (detaching) detach(t6);
    		}
    	};
    }

    // (175:20) <Equation>
    function create_default_slot_90(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("\\frac\\pi4");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "\\frac\\pi4");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (176:20) <Equation>
    function create_default_slot_89(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;
    	let t4_value = "{" + "";
    	let t4;
    	let t5;
    	let t6_value = "}" + "";
    	let t6;

    	return {
    		c() {
    			t0 = text("\\frac");
    			t1 = text(t1_value);
    			t2 = text("1");
    			t3 = text(t3_value);
    			t4 = text(t4_value);
    			t5 = text("\\sqrt2");
    			t6 = text(t6_value);
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "\\frac");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "1");
    			t3 = claim_text(nodes, t3_value);
    			t4 = claim_text(nodes, t4_value);
    			t5 = claim_text(nodes, "\\sqrt2");
    			t6 = claim_text(nodes, t6_value);
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, t4, anchor);
    			insert_hydration(target, t5, anchor);
    			insert_hydration(target, t6, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (detaching) detach(t4);
    			if (detaching) detach(t5);
    			if (detaching) detach(t6);
    		}
    	};
    }

    // (177:20) <Equation>
    function create_default_slot_88(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;
    	let t4_value = "{" + "";
    	let t4;
    	let t5;
    	let t6_value = "}" + "";
    	let t6;

    	return {
    		c() {
    			t0 = text("\\frac");
    			t1 = text(t1_value);
    			t2 = text("1");
    			t3 = text(t3_value);
    			t4 = text(t4_value);
    			t5 = text("\\sqrt2");
    			t6 = text(t6_value);
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "\\frac");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "1");
    			t3 = claim_text(nodes, t3_value);
    			t4 = claim_text(nodes, t4_value);
    			t5 = claim_text(nodes, "\\sqrt2");
    			t6 = claim_text(nodes, t6_value);
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, t4, anchor);
    			insert_hydration(target, t5, anchor);
    			insert_hydration(target, t6, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (detaching) detach(t4);
    			if (detaching) detach(t5);
    			if (detaching) detach(t6);
    		}
    	};
    }

    // (180:20) <Equation>
    function create_default_slot_87(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("\\sqrt2");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "\\sqrt2");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (181:20) <Equation>
    function create_default_slot_86(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("\\sqrt2");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "\\sqrt2");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (184:20) <Equation>
    function create_default_slot_85(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("\\frac\\pi3");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "\\frac\\pi3");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (185:20) <Equation>
    function create_default_slot_84(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;
    	let t4_value = "{" + "";
    	let t4;
    	let t5;
    	let t6_value = "}" + "";
    	let t6;

    	return {
    		c() {
    			t0 = text("\\frac");
    			t1 = text(t1_value);
    			t2 = text("\\sqrt3");
    			t3 = text(t3_value);
    			t4 = text(t4_value);
    			t5 = text("2");
    			t6 = text(t6_value);
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "\\frac");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "\\sqrt3");
    			t3 = claim_text(nodes, t3_value);
    			t4 = claim_text(nodes, t4_value);
    			t5 = claim_text(nodes, "2");
    			t6 = claim_text(nodes, t6_value);
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, t4, anchor);
    			insert_hydration(target, t5, anchor);
    			insert_hydration(target, t6, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (detaching) detach(t4);
    			if (detaching) detach(t5);
    			if (detaching) detach(t6);
    		}
    	};
    }

    // (186:20) <Equation>
    function create_default_slot_83(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;
    	let t4_value = "{" + "";
    	let t4;
    	let t5;
    	let t6_value = "}" + "";
    	let t6;

    	return {
    		c() {
    			t0 = text("\\frac");
    			t1 = text(t1_value);
    			t2 = text("1");
    			t3 = text(t3_value);
    			t4 = text(t4_value);
    			t5 = text("2");
    			t6 = text(t6_value);
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "\\frac");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "1");
    			t3 = claim_text(nodes, t3_value);
    			t4 = claim_text(nodes, t4_value);
    			t5 = claim_text(nodes, "2");
    			t6 = claim_text(nodes, t6_value);
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, t4, anchor);
    			insert_hydration(target, t5, anchor);
    			insert_hydration(target, t6, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (detaching) detach(t4);
    			if (detaching) detach(t5);
    			if (detaching) detach(t6);
    		}
    	};
    }

    // (187:20) <Equation>
    function create_default_slot_82(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("\\sqrt3");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "\\sqrt3");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (188:20) <Equation>
    function create_default_slot_81(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;
    	let t4_value = "{" + "";
    	let t4;
    	let t5;
    	let t6_value = "}" + "";
    	let t6;

    	return {
    		c() {
    			t0 = text("\\frac");
    			t1 = text(t1_value);
    			t2 = text("1");
    			t3 = text(t3_value);
    			t4 = text(t4_value);
    			t5 = text("\\sqrt3");
    			t6 = text(t6_value);
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "\\frac");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "1");
    			t3 = claim_text(nodes, t3_value);
    			t4 = claim_text(nodes, t4_value);
    			t5 = claim_text(nodes, "\\sqrt3");
    			t6 = claim_text(nodes, t6_value);
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, t4, anchor);
    			insert_hydration(target, t5, anchor);
    			insert_hydration(target, t6, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (detaching) detach(t4);
    			if (detaching) detach(t5);
    			if (detaching) detach(t6);
    		}
    	};
    }

    // (190:20) <Equation>
    function create_default_slot_80(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;
    	let t4_value = "{" + "";
    	let t4;
    	let t5;
    	let t6_value = "}" + "";
    	let t6;

    	return {
    		c() {
    			t0 = text("\\frac");
    			t1 = text(t1_value);
    			t2 = text("2");
    			t3 = text(t3_value);
    			t4 = text(t4_value);
    			t5 = text("\\sqrt3");
    			t6 = text(t6_value);
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "\\frac");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "2");
    			t3 = claim_text(nodes, t3_value);
    			t4 = claim_text(nodes, t4_value);
    			t5 = claim_text(nodes, "\\sqrt3");
    			t6 = claim_text(nodes, t6_value);
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, t4, anchor);
    			insert_hydration(target, t5, anchor);
    			insert_hydration(target, t6, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (detaching) detach(t4);
    			if (detaching) detach(t5);
    			if (detaching) detach(t6);
    		}
    	};
    }

    // (205:42) <Equation>
    function create_default_slot_79(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("\\theta");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "\\theta");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (273:73) <Equation                  >
    function create_default_slot_78(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("sin(\\theta)=y");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "sin(\\theta)=y");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (275:18) <Equation>
    function create_default_slot_77(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("cos(\\theta)=x");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "cos(\\theta)=x");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (280:72) <Equation                  >
    function create_default_slot_76(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;
    	let t4_value = "{" + "";
    	let t4;
    	let t5;
    	let t6_value = "}" + "";
    	let t6;

    	return {
    		c() {
    			t0 = text("sin(\\theta)=\\frac");
    			t1 = text(t1_value);
    			t2 = text("y");
    			t3 = text(t3_value);
    			t4 = text(t4_value);
    			t5 = text("hyp");
    			t6 = text(t6_value);
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "sin(\\theta)=\\frac");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "y");
    			t3 = claim_text(nodes, t3_value);
    			t4 = claim_text(nodes, t4_value);
    			t5 = claim_text(nodes, "hyp");
    			t6 = claim_text(nodes, t6_value);
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, t4, anchor);
    			insert_hydration(target, t5, anchor);
    			insert_hydration(target, t6, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (detaching) detach(t4);
    			if (detaching) detach(t5);
    			if (detaching) detach(t6);
    		}
    	};
    }

    // (282:18) <Equation>
    function create_default_slot_75(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;
    	let t4_value = "{" + "";
    	let t4;
    	let t5;
    	let t6_value = "}" + "";
    	let t6;

    	return {
    		c() {
    			t0 = text("cos(\\theta)=\\frac");
    			t1 = text(t1_value);
    			t2 = text("x");
    			t3 = text(t3_value);
    			t4 = text(t4_value);
    			t5 = text("hyp");
    			t6 = text(t6_value);
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "cos(\\theta)=\\frac");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "x");
    			t3 = claim_text(nodes, t3_value);
    			t4 = claim_text(nodes, t4_value);
    			t5 = claim_text(nodes, "hyp");
    			t6 = claim_text(nodes, t6_value);
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, t4, anchor);
    			insert_hydration(target, t5, anchor);
    			insert_hydration(target, t6, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (detaching) detach(t4);
    			if (detaching) detach(t5);
    			if (detaching) detach(t6);
    		}
    	};
    }

    // (283:41) <Equation                  >
    function create_default_slot_74(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;
    	let t4_value = "{" + "";
    	let t4;
    	let t5;
    	let t6_value = "}" + "";
    	let t6;

    	return {
    		c() {
    			t0 = text("\\tan(\\theta) =\\frac");
    			t1 = text(t1_value);
    			t2 = text("y");
    			t3 = text(t3_value);
    			t4 = text(t4_value);
    			t5 = text("x");
    			t6 = text(t6_value);
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "\\tan(\\theta) =\\frac");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "y");
    			t3 = claim_text(nodes, t3_value);
    			t4 = claim_text(nodes, t4_value);
    			t5 = claim_text(nodes, "x");
    			t6 = claim_text(nodes, t6_value);
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, t4, anchor);
    			insert_hydration(target, t5, anchor);
    			insert_hydration(target, t6, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (detaching) detach(t4);
    			if (detaching) detach(t5);
    			if (detaching) detach(t6);
    		}
    	};
    }

    // (286:12) <Equation                  >
    function create_default_slot_73(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;
    	let t4_value = "{" + "";
    	let t4;
    	let t5;
    	let t6_value = "}" + "";
    	let t6;

    	return {
    		c() {
    			t0 = text("\\tan(\\theta) =\\frac");
    			t1 = text(t1_value);
    			t2 = text("sin(\\theta)");
    			t3 = text(t3_value);
    			t4 = text(t4_value);
    			t5 = text("cos(\\theta)");
    			t6 = text(t6_value);
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "\\tan(\\theta) =\\frac");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "sin(\\theta)");
    			t3 = claim_text(nodes, t3_value);
    			t4 = claim_text(nodes, t4_value);
    			t5 = claim_text(nodes, "cos(\\theta)");
    			t6 = claim_text(nodes, t6_value);
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, t4, anchor);
    			insert_hydration(target, t5, anchor);
    			insert_hydration(target, t6, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (detaching) detach(t4);
    			if (detaching) detach(t5);
    			if (detaching) detach(t6);
    		}
    	};
    }

    // (292:45) <Equation                  >
    function create_default_slot_72(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;
    	let t4;

    	return {
    		c() {
    			t0 = text("\\frac");
    			t1 = text(t1_value);
    			t2 = text("\\pi");
    			t3 = text(t3_value);
    			t4 = text("6");
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "\\frac");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "\\pi");
    			t3 = claim_text(nodes, t3_value);
    			t4 = claim_text(nodes, "6");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, t4, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (detaching) detach(t4);
    		}
    	};
    }

    // (296:12) <Equation>
    function create_default_slot_71(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;
    	let t4_value = "{" + "";
    	let t4;
    	let t5;
    	let t6_value = "}" + "";
    	let t6;

    	return {
    		c() {
    			t0 = text("\\sin(\\theta) = \\frac");
    			t1 = text(t1_value);
    			t2 = text("opp");
    			t3 = text(t3_value);
    			t4 = text(t4_value);
    			t5 = text("hyp");
    			t6 = text(t6_value);
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "\\sin(\\theta) = \\frac");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "opp");
    			t3 = claim_text(nodes, t3_value);
    			t4 = claim_text(nodes, t4_value);
    			t5 = claim_text(nodes, "hyp");
    			t6 = claim_text(nodes, t6_value);
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, t4, anchor);
    			insert_hydration(target, t5, anchor);
    			insert_hydration(target, t6, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (detaching) detach(t4);
    			if (detaching) detach(t5);
    			if (detaching) detach(t6);
    		}
    	};
    }

    // (298:12) <Equation>
    function create_default_slot_70(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("hyp\\cdot\\sin(\\theta) = opp");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "hyp\\cdot\\sin(\\theta) = opp");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (300:12) <Equation>
    function create_default_slot_69(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;
    	let t4;

    	return {
    		c() {
    			t0 = text("8\\cdot\\sin(\\frac");
    			t1 = text(t1_value);
    			t2 = text("\\pi");
    			t3 = text(t3_value);
    			t4 = text("6) = opp");
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "8\\cdot\\sin(\\frac");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "\\pi");
    			t3 = claim_text(nodes, t3_value);
    			t4 = claim_text(nodes, "6) = opp");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, t4, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (detaching) detach(t4);
    		}
    	};
    }

    // (302:12) <Equation>
    function create_default_slot_68(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;
    	let t4;

    	return {
    		c() {
    			t0 = text("8\\cdot\\frac");
    			t1 = text(t1_value);
    			t2 = text("\\sqrt3");
    			t3 = text(t3_value);
    			t4 = text("2 = opp");
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "8\\cdot\\frac");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "\\sqrt3");
    			t3 = claim_text(nodes, t3_value);
    			t4 = claim_text(nodes, "2 = opp");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, t4, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (detaching) detach(t4);
    		}
    	};
    }

    // (304:12) <Equation>
    function create_default_slot_67(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("4\\sqrt3 = opp");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "4\\sqrt3 = opp");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (309:34) <Equation>
    function create_default_slot_66(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("\\theta");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "\\theta");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (311:12) <Equation>
    function create_default_slot_65(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;
    	let t4_value = "{" + "";
    	let t4;
    	let t5;
    	let t6_value = "}" + "";
    	let t6;

    	return {
    		c() {
    			t0 = text("\\tan(\\theta) = \\frac");
    			t1 = text(t1_value);
    			t2 = text("opp");
    			t3 = text(t3_value);
    			t4 = text(t4_value);
    			t5 = text("adj");
    			t6 = text(t6_value);
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "\\tan(\\theta) = \\frac");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "opp");
    			t3 = claim_text(nodes, t3_value);
    			t4 = claim_text(nodes, t4_value);
    			t5 = claim_text(nodes, "adj");
    			t6 = claim_text(nodes, t6_value);
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, t4, anchor);
    			insert_hydration(target, t5, anchor);
    			insert_hydration(target, t6, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (detaching) detach(t4);
    			if (detaching) detach(t5);
    			if (detaching) detach(t6);
    		}
    	};
    }

    // (313:12) <Equation                  >
    function create_default_slot_64(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;
    	let t4_value = "{" + "";
    	let t4;
    	let t5;
    	let t6_value = "}" + "";
    	let t6;
    	let t7;

    	return {
    		c() {
    			t0 = text("\\theta = \\arctan(\\frac");
    			t1 = text(t1_value);
    			t2 = text("opp");
    			t3 = text(t3_value);
    			t4 = text(t4_value);
    			t5 = text("adj");
    			t6 = text(t6_value);
    			t7 = text(")");
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "\\theta = \\arctan(\\frac");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "opp");
    			t3 = claim_text(nodes, t3_value);
    			t4 = claim_text(nodes, t4_value);
    			t5 = claim_text(nodes, "adj");
    			t6 = claim_text(nodes, t6_value);
    			t7 = claim_text(nodes, ")");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, t4, anchor);
    			insert_hydration(target, t5, anchor);
    			insert_hydration(target, t6, anchor);
    			insert_hydration(target, t7, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (detaching) detach(t4);
    			if (detaching) detach(t5);
    			if (detaching) detach(t6);
    			if (detaching) detach(t7);
    		}
    	};
    }

    // (317:12) <Equation>
    function create_default_slot_63(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;
    	let t4_value = "{" + "";
    	let t4;
    	let t5;
    	let t6_value = "}" + "";
    	let t6;
    	let t7;

    	return {
    		c() {
    			t0 = text("\\theta = \\arctan(\\frac");
    			t1 = text(t1_value);
    			t2 = text("50");
    			t3 = text(t3_value);
    			t4 = text(t4_value);
    			t5 = text("37");
    			t6 = text(t6_value);
    			t7 = text(")");
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "\\theta = \\arctan(\\frac");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "50");
    			t3 = claim_text(nodes, t3_value);
    			t4 = claim_text(nodes, t4_value);
    			t5 = claim_text(nodes, "37");
    			t6 = claim_text(nodes, t6_value);
    			t7 = claim_text(nodes, ")");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, t4, anchor);
    			insert_hydration(target, t5, anchor);
    			insert_hydration(target, t6, anchor);
    			insert_hydration(target, t7, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (detaching) detach(t4);
    			if (detaching) detach(t5);
    			if (detaching) detach(t6);
    			if (detaching) detach(t7);
    		}
    	};
    }

    // (319:12) <Equation>
    function create_default_slot_62(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("\\theta = 0.9337");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "\\theta = 0.9337");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (331:12) <Equation>
    function create_default_slot_61(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("f(x)=b^x");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "f(x)=b^x");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (333:49) <Equation>
    function create_default_slot_60(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("b>0");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "b>0");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (333:78) <Equation                  >
    function create_default_slot_59(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("b\\ne1");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "b\\ne1");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (367:20) <Equation>
    function create_default_slot_58(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;

    	return {
    		c() {
    			t0 = text("b^x \\cdot b^y=b^");
    			t1 = text(t1_value);
    			t2 = text("x+y");
    			t3 = text(t3_value);
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "b^x \\cdot b^y=b^");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "x+y");
    			t3 = claim_text(nodes, t3_value);
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    		}
    	};
    }

    // (372:21) <Equation                          >
    function create_default_slot_57(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;
    	let t4_value = "{" + "";
    	let t4;
    	let t5;
    	let t6_value = "}" + "";
    	let t6;
    	let t7;
    	let t8_value = "{" + "";
    	let t8;
    	let t9;
    	let t10_value = "}" + "";
    	let t10;

    	return {
    		c() {
    			t0 = text("\\frac");
    			t1 = text(t1_value);
    			t2 = text("b^x");
    			t3 = text(t3_value);
    			t4 = text(t4_value);
    			t5 = text("b^y");
    			t6 = text(t6_value);
    			t7 = text("=b^");
    			t8 = text(t8_value);
    			t9 = text("x-y");
    			t10 = text(t10_value);
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "\\frac");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "b^x");
    			t3 = claim_text(nodes, t3_value);
    			t4 = claim_text(nodes, t4_value);
    			t5 = claim_text(nodes, "b^y");
    			t6 = claim_text(nodes, t6_value);
    			t7 = claim_text(nodes, "=b^");
    			t8 = claim_text(nodes, t8_value);
    			t9 = claim_text(nodes, "x-y");
    			t10 = claim_text(nodes, t10_value);
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, t4, anchor);
    			insert_hydration(target, t5, anchor);
    			insert_hydration(target, t6, anchor);
    			insert_hydration(target, t7, anchor);
    			insert_hydration(target, t8, anchor);
    			insert_hydration(target, t9, anchor);
    			insert_hydration(target, t10, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (detaching) detach(t4);
    			if (detaching) detach(t5);
    			if (detaching) detach(t6);
    			if (detaching) detach(t7);
    			if (detaching) detach(t8);
    			if (detaching) detach(t9);
    			if (detaching) detach(t10);
    		}
    	};
    }

    // (379:20) <Equation>
    function create_default_slot_56(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;

    	return {
    		c() {
    			t0 = text("(b^x)^y=b^");
    			t1 = text(t1_value);
    			t2 = text("xy");
    			t3 = text(t3_value);
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "(b^x)^y=b^");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "xy");
    			t3 = claim_text(nodes, t3_value);
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    		}
    	};
    }

    // (383:20) <Equation>
    function create_default_slot_55(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("(ab)^x=a^xb^x");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "(ab)^x=a^xb^x");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (388:21) <Equation                          >
    function create_default_slot_54(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;
    	let t4;
    	let t5_value = "{" + "";
    	let t5;
    	let t6;
    	let t7_value = "}" + "";
    	let t7;
    	let t8;

    	return {
    		c() {
    			t0 = text("(\\frac a b)^x=(\\frac");
    			t1 = text(t1_value);
    			t2 = text("a^x");
    			t3 = text(t3_value);
    			t4 = space();
    			t5 = text(t5_value);
    			t6 = text("b^x");
    			t7 = text(t7_value);
    			t8 = text(")");
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "(\\frac a b)^x=(\\frac");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "a^x");
    			t3 = claim_text(nodes, t3_value);
    			t4 = claim_space(nodes);
    			t5 = claim_text(nodes, t5_value);
    			t6 = claim_text(nodes, "b^x");
    			t7 = claim_text(nodes, t7_value);
    			t8 = claim_text(nodes, ")");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, t4, anchor);
    			insert_hydration(target, t5, anchor);
    			insert_hydration(target, t6, anchor);
    			insert_hydration(target, t7, anchor);
    			insert_hydration(target, t8, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (detaching) detach(t4);
    			if (detaching) detach(t5);
    			if (detaching) detach(t6);
    			if (detaching) detach(t7);
    			if (detaching) detach(t8);
    		}
    	};
    }

    // (396:20) <Equation>
    function create_default_slot_53(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("b^0=1");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "b^0=1");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (401:21) <Equation>
    function create_default_slot_52(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;
    	let t4;
    	let t5_value = "{" + "";
    	let t5;
    	let t6;
    	let t7_value = "}" + "";
    	let t7;

    	return {
    		c() {
    			t0 = text("b^");
    			t1 = text(t1_value);
    			t2 = text("-x");
    			t3 = text(t3_value);
    			t4 = text("=\\frac 1 ");
    			t5 = text(t5_value);
    			t6 = text("b^x");
    			t7 = text(t7_value);
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "b^");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "-x");
    			t3 = claim_text(nodes, t3_value);
    			t4 = claim_text(nodes, "=\\frac 1 ");
    			t5 = claim_text(nodes, t5_value);
    			t6 = claim_text(nodes, "b^x");
    			t7 = claim_text(nodes, t7_value);
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, t4, anchor);
    			insert_hydration(target, t5, anchor);
    			insert_hydration(target, t6, anchor);
    			insert_hydration(target, t7, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (detaching) detach(t4);
    			if (detaching) detach(t5);
    			if (detaching) detach(t6);
    			if (detaching) detach(t7);
    		}
    	};
    }

    // (407:20) <Equation>
    function create_default_slot_51(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;
    	let t4;

    	return {
    		c() {
    			t0 = text("b^");
    			t1 = text(t1_value);
    			t2 = text("\\frac x y");
    			t3 = text(t3_value);
    			t4 = text("=\\sqrt[y]b^x");
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "b^");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "\\frac x y");
    			t3 = claim_text(nodes, t3_value);
    			t4 = claim_text(nodes, "=\\sqrt[y]b^x");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, t4, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (detaching) detach(t4);
    		}
    	};
    }

    // (416:37) <Equation>
    function create_default_slot_50(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("y=b^x");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "y=b^x");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (416:70) <Equation                  >
    function create_default_slot_49(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("x=\\log_a y");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "x=\\log_a y");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (418:20) <Equation>
    function create_default_slot_48(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("y>0");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "y>0");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (418:70) <Equation                  >
    function create_default_slot_47(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("e");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "e");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (420:49) <Equation>
    function create_default_slot_46(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("y=\\ln x");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "y=\\ln x");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (458:20) <Equation>
    function create_default_slot_45(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("\\log_a xy = \\log_a x + \\log_a y");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "\\log_a xy = \\log_a x + \\log_a y");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (463:21) <Equation                          >
    function create_default_slot_44(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;
    	let t4_value = "{" + "";
    	let t4;
    	let t5;
    	let t6_value = "}" + "";
    	let t6;
    	let t7;

    	return {
    		c() {
    			t0 = text("\\log_a\\frac");
    			t1 = text(t1_value);
    			t2 = text("x");
    			t3 = text(t3_value);
    			t4 = text(t4_value);
    			t5 = text("y");
    			t6 = text(t6_value);
    			t7 = text("=\\log_a x - log_a y");
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "\\log_a\\frac");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "x");
    			t3 = claim_text(nodes, t3_value);
    			t4 = claim_text(nodes, t4_value);
    			t5 = claim_text(nodes, "y");
    			t6 = claim_text(nodes, t6_value);
    			t7 = claim_text(nodes, "=\\log_a x - log_a y");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, t4, anchor);
    			insert_hydration(target, t5, anchor);
    			insert_hydration(target, t6, anchor);
    			insert_hydration(target, t7, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (detaching) detach(t4);
    			if (detaching) detach(t5);
    			if (detaching) detach(t6);
    			if (detaching) detach(t7);
    		}
    	};
    }

    // (470:20) <Equation>
    function create_default_slot_43(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("\\log_a x^b = b\\log_a x");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "\\log_a x^b = b\\log_a x");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (475:21) <Equation                          >
    function create_default_slot_42(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;
    	let t4_value = "{" + "";
    	let t4;
    	let t5;
    	let t6_value = "}" + "";
    	let t6;

    	return {
    		c() {
    			t0 = text("\\log_a x = \\frac");
    			t1 = text(t1_value);
    			t2 = text("\\log_b x");
    			t3 = text(t3_value);
    			t4 = text(t4_value);
    			t5 = text("log_b a");
    			t6 = text(t6_value);
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "\\log_a x = \\frac");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "\\log_b x");
    			t3 = claim_text(nodes, t3_value);
    			t4 = claim_text(nodes, t4_value);
    			t5 = claim_text(nodes, "log_b a");
    			t6 = claim_text(nodes, t6_value);
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, t4, anchor);
    			insert_hydration(target, t5, anchor);
    			insert_hydration(target, t6, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (detaching) detach(t4);
    			if (detaching) detach(t5);
    			if (detaching) detach(t6);
    		}
    	};
    }

    // (482:20) <Equation>
    function create_default_slot_41(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("If \\log_a x = log_a y\\ then\\ x=y");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "If \\log_a x = log_a y\\ then\\ x=y");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (486:20) <Equation>
    function create_default_slot_40(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("\\log_a 1 = 0");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "\\log_a 1 = 0");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (494:72) <Equation                  >
    function create_default_slot_39(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("f(x)");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "f(x)");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (496:18) <Equation>
    function create_default_slot_38(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("g(x)");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "g(x)");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (502:20) <Equation>
    function create_default_slot_37(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("(f+g)(x) = f(x) + g(x)");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "(f+g)(x) = f(x) + g(x)");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (506:20) <Equation>
    function create_default_slot_36(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("(f-g)(x) = f(x) - g(x)");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "(f-g)(x) = f(x) - g(x)");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (510:20) <Equation>
    function create_default_slot_35(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("(f\\cdot g)(x) = f(x) \\cdot g(x)");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "(f\\cdot g)(x) = f(x) \\cdot g(x)");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (515:21) <Equation                          >
    function create_default_slot_34(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;
    	let t4;
    	let t5_value = "{" + "";
    	let t5;
    	let t6;
    	let t7_value = "}" + "";
    	let t7;

    	return {
    		c() {
    			t0 = text("(\\frac f g)(x) = \\frac");
    			t1 = text(t1_value);
    			t2 = text("f(x)");
    			t3 = text(t3_value);
    			t4 = space();
    			t5 = text(t5_value);
    			t6 = text("g(x)");
    			t7 = text(t7_value);
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "(\\frac f g)(x) = \\frac");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "f(x)");
    			t3 = claim_text(nodes, t3_value);
    			t4 = claim_space(nodes);
    			t5 = claim_text(nodes, t5_value);
    			t6 = claim_text(nodes, "g(x)");
    			t7 = claim_text(nodes, t7_value);
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, t4, anchor);
    			insert_hydration(target, t5, anchor);
    			insert_hydration(target, t6, anchor);
    			insert_hydration(target, t7, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (detaching) detach(t4);
    			if (detaching) detach(t5);
    			if (detaching) detach(t6);
    			if (detaching) detach(t7);
    		}
    	};
    }

    // (519:26) <Equation>
    function create_default_slot_33(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("g(x)\\ne0");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "g(x)\\ne0");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (533:12) <Equation>
    function create_default_slot_32(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("(f\\circ g)(x) = f(g(x))");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "(f\\circ g)(x) = f(g(x))");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (543:14) <Equation>
    function create_default_slot_31(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("f(x) = -5x-3");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "f(x) = -5x-3");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (543:52) <Equation              >
    function create_default_slot_30(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("g(x)=x^2+8x+1");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "g(x)=x^2+8x+1");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (551:16) <Equation>
    function create_default_slot_29(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("(f+g)(x) = f(x) + g(x)");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "(f+g)(x) = f(x) + g(x)");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (553:16) <Equation>
    function create_default_slot_28(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("=(-5x-3) + (x^2+8x+1)");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "=(-5x-3) + (x^2+8x+1)");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (555:16) <Equation>
    function create_default_slot_27(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("=-5x-3+x^2+8x+1");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "=-5x-3+x^2+8x+1");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (557:16) <Equation>
    function create_default_slot_26(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("=x^2+3x-2");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "=x^2+3x-2");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (559:16) <Equation>
    function create_default_slot_25(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("=x\\in\\R");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "=x\\in\\R");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (565:16) <Equation>
    function create_default_slot_24(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("(f-g)(x) = f(x) - g(x)");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "(f-g)(x) = f(x) - g(x)");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (567:16) <Equation>
    function create_default_slot_23(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("=(-5x-3) - (x^2+8x+1)");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "=(-5x-3) - (x^2+8x+1)");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (569:16) <Equation>
    function create_default_slot_22(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("=-5x-3-x^2-8x-1");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "=-5x-3-x^2-8x-1");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (571:16) <Equation>
    function create_default_slot_21(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("=-x^2-13x-4");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "=-x^2-13x-4");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (573:16) <Equation>
    function create_default_slot_20(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("=x\\in\\R");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "=x\\in\\R");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (579:16) <Equation>
    function create_default_slot_19(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("(f\\cdot g)(x) = f(x) \\cdot g(x)");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "(f\\cdot g)(x) = f(x) \\cdot g(x)");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (581:16) <Equation>
    function create_default_slot_18(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("=(-5x-3)(x^2+8x+1)");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "=(-5x-3)(x^2+8x+1)");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (583:16) <Equation>
    function create_default_slot_17(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("=-5x^3-40x^2-5x-3x^2-24x-3");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "=-5x^3-40x^2-5x-3x^2-24x-3");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (585:16) <Equation>
    function create_default_slot_16(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("=-5x^3-43x^2-29x-3");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "=-5x^3-43x^2-29x-3");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (587:16) <Equation>
    function create_default_slot_15(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("=x\\in\\R");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "=x\\in\\R");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (593:16) <Equation                      >
    function create_default_slot_14(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;
    	let t4;
    	let t5_value = "{" + "";
    	let t5;
    	let t6;
    	let t7_value = "}" + "";
    	let t7;

    	return {
    		c() {
    			t0 = text("(\\frac f g)(x) = \\frac");
    			t1 = text(t1_value);
    			t2 = text("f(x)");
    			t3 = text(t3_value);
    			t4 = space();
    			t5 = text(t5_value);
    			t6 = text("g(x)");
    			t7 = text(t7_value);
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "(\\frac f g)(x) = \\frac");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "f(x)");
    			t3 = claim_text(nodes, t3_value);
    			t4 = claim_space(nodes);
    			t5 = claim_text(nodes, t5_value);
    			t6 = claim_text(nodes, "g(x)");
    			t7 = claim_text(nodes, t7_value);
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, t4, anchor);
    			insert_hydration(target, t5, anchor);
    			insert_hydration(target, t6, anchor);
    			insert_hydration(target, t7, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (detaching) detach(t4);
    			if (detaching) detach(t5);
    			if (detaching) detach(t6);
    			if (detaching) detach(t7);
    		}
    	};
    }

    // (598:16) <Equation                      >
    function create_default_slot_13(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;
    	let t4;
    	let t5_value = "{" + "";
    	let t5;
    	let t6;
    	let t7_value = "}" + "";
    	let t7;

    	return {
    		c() {
    			t0 = text("=\\frac");
    			t1 = text(t1_value);
    			t2 = text("(-5x-3)");
    			t3 = text(t3_value);
    			t4 = space();
    			t5 = text(t5_value);
    			t6 = text("(x^2+8x+1)");
    			t7 = text(t7_value);
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "=\\frac");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "(-5x-3)");
    			t3 = claim_text(nodes, t3_value);
    			t4 = claim_space(nodes);
    			t5 = claim_text(nodes, t5_value);
    			t6 = claim_text(nodes, "(x^2+8x+1)");
    			t7 = claim_text(nodes, t7_value);
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, t4, anchor);
    			insert_hydration(target, t5, anchor);
    			insert_hydration(target, t6, anchor);
    			insert_hydration(target, t7, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (detaching) detach(t4);
    			if (detaching) detach(t5);
    			if (detaching) detach(t6);
    			if (detaching) detach(t7);
    		}
    	};
    }

    // (603:16) <Equation>
    function create_default_slot_12(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;
    	let t4;

    	return {
    		c() {
    			t0 = text("=x\\in\\R\\ except\\ x=\\pm\\sqrt");
    			t1 = text(t1_value);
    			t2 = text("15");
    			t3 = text(t3_value);
    			t4 = text("-4");
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "=x\\in\\R\\ except\\ x=\\pm\\sqrt");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "15");
    			t3 = claim_text(nodes, t3_value);
    			t4 = claim_text(nodes, "-4");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    			insert_hydration(target, t4, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (detaching) detach(t4);
    		}
    	};
    }

    // (609:16) <Equation>
    function create_default_slot_11(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("(f\\circ g)(x) = f(g(x))");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "(f\\circ g)(x) = f(g(x))");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (611:16) <Equation>
    function create_default_slot_10(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("=-5(x^2+8x+1)-3");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "=-5(x^2+8x+1)-3");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (613:16) <Equation>
    function create_default_slot_9(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("=-5x^2-40x-8");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "=-5x^2-40x-8");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (615:16) <Equation>
    function create_default_slot_8(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("=x\\in\\R");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "=x\\in\\R");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (618:16) <Equation>
    function create_default_slot_7(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;

    	return {
    		c() {
    			t0 = text("f(x)=\\sqrt");
    			t1 = text(t1_value);
    			t2 = text("-x-10");
    			t3 = text(t3_value);
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "f(x)=\\sqrt");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "-x-10");
    			t3 = claim_text(nodes, t3_value);
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    		}
    	};
    }

    // (618:67) <Equation              >
    function create_default_slot_6(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("g(x) = x^2+4x");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "g(x) = x^2+4x");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (622:8) <Equation>
    function create_default_slot_5(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("(f\\circ g)(x) = f(g(x))");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "(f\\circ g)(x) = f(g(x))");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (624:8) <Equation>
    function create_default_slot_4(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;

    	return {
    		c() {
    			t0 = text("\\sqrt");
    			t1 = text(t1_value);
    			t2 = text("-(x^2+4x)-10");
    			t3 = text(t3_value);
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "\\sqrt");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "-(x^2+4x)-10");
    			t3 = claim_text(nodes, t3_value);
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    		}
    	};
    }

    // (626:8) <Equation>
    function create_default_slot_3(ctx) {
    	let t0;
    	let t1_value = "{" + "";
    	let t1;
    	let t2;
    	let t3_value = "}" + "";
    	let t3;

    	return {
    		c() {
    			t0 = text("\\sqrt");
    			t1 = text(t1_value);
    			t2 = text("-x^2-4x-10");
    			t3 = text(t3_value);
    		},
    		l(nodes) {
    			t0 = claim_text(nodes, "\\sqrt");
    			t1 = claim_text(nodes, t1_value);
    			t2 = claim_text(nodes, "-x^2-4x-10");
    			t3 = claim_text(nodes, t3_value);
    		},
    		m(target, anchor) {
    			insert_hydration(target, t0, anchor);
    			insert_hydration(target, t1, anchor);
    			insert_hydration(target, t2, anchor);
    			insert_hydration(target, t3, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    		}
    	};
    }

    // (629:66) <Equation              >
    function create_default_slot_2(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("g(x)");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "g(x)");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (631:25) <Equation>
    function create_default_slot_1(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("f");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "f");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (631:53) <Equation>
    function create_default_slot$1(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("g(x)");
    		},
    		l(nodes) {
    			t = claim_text(nodes, "g(x)");
    		},
    		m(target, anchor) {
    			insert_hydration(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    function create_fragment$3(ctx) {
    	let scrolling = false;

    	let clear_scrolling = () => {
    		scrolling = false;
    	};

    	let scrolling_timeout;
    	let div9;
    	let h1;
    	let t0;
    	let t1;
    	let h3;
    	let t2;
    	let t3;
    	let div4;
    	let div0;
    	let t4;
    	let div0_class_value;
    	let t5;
    	let div1;
    	let t6;
    	let div1_class_value;
    	let t7;
    	let div2;
    	let t8;
    	let div2_class_value;
    	let t9;
    	let div3;
    	let t10;
    	let div3_class_value;
    	let t11;
    	let div8;
    	let h20;
    	let t12;
    	let t13;
    	let p0;
    	let t14;
    	let strong;
    	let t15;
    	let t16;
    	let br0;
    	let t17;
    	let br1;
    	let t18;
    	let table0;
    	let tr0;
    	let td0;
    	let equation0;
    	let t19;
    	let td1;
    	let equation1;
    	let t20;
    	let tr1;
    	let td2;
    	let equation2;
    	let t21;
    	let td3;
    	let equation3;
    	let t22;
    	let tr2;
    	let td4;
    	let equation4;
    	let t23;
    	let td5;
    	let equation5;
    	let t24;
    	let p1;
    	let t25;
    	let br2;
    	let t26;
    	let br3;
    	let t27;
    	let equation6;
    	let t28;
    	let br4;
    	let t29;
    	let br5;
    	let t30;
    	let t31;
    	let h40;
    	let t32;
    	let t33;
    	let table1;
    	let tr3;
    	let th0;
    	let equation7;
    	let t34;
    	let th1;
    	let equation8;
    	let t35;
    	let th2;
    	let equation9;
    	let t36;
    	let th3;
    	let equation10;
    	let t37;
    	let th4;
    	let equation11;
    	let t38;
    	let th5;
    	let equation12;
    	let t39;
    	let th6;
    	let equation13;
    	let t40;
    	let tr4;
    	let td6;
    	let t41;
    	let t42;
    	let td7;
    	let t43;
    	let t44;
    	let td8;
    	let t45;
    	let t46;
    	let td9;
    	let t47;
    	let t48;
    	let td10;
    	let t49;
    	let t50;
    	let td11;
    	let t51;
    	let t52;
    	let td12;
    	let t53;
    	let t54;
    	let tr5;
    	let td13;
    	let equation14;
    	let t55;
    	let td14;
    	let t56;
    	let t57;
    	let td15;
    	let t58;
    	let t59;
    	let td16;
    	let t60;
    	let t61;
    	let td17;
    	let t62;
    	let t63;
    	let td18;
    	let t64;
    	let t65;
    	let td19;
    	let t66;
    	let t67;
    	let tr6;
    	let td20;
    	let equation15;
    	let t68;
    	let td21;
    	let t69;
    	let t70;
    	let td22;
    	let t71;
    	let t72;
    	let td23;
    	let t73;
    	let t74;
    	let td24;
    	let t75;
    	let t76;
    	let td25;
    	let t77;
    	let t78;
    	let td26;
    	let t79;
    	let t80;
    	let tr7;
    	let td27;
    	let equation16;
    	let t81;
    	let td28;
    	let equation17;
    	let t82;
    	let td29;
    	let equation18;
    	let t83;
    	let td30;
    	let equation19;
    	let t84;
    	let td31;
    	let equation20;
    	let t85;
    	let td32;
    	let equation21;
    	let t86;
    	let td33;
    	let t87;
    	let t88;
    	let tr8;
    	let td34;
    	let equation22;
    	let t89;
    	let td35;
    	let equation23;
    	let t90;
    	let td36;
    	let equation24;
    	let t91;
    	let td37;
    	let t92;
    	let t93;
    	let td38;
    	let t94;
    	let t95;
    	let td39;
    	let equation25;
    	let t96;
    	let td40;
    	let equation26;
    	let t97;
    	let tr9;
    	let td41;
    	let equation27;
    	let t98;
    	let td42;
    	let equation28;
    	let t99;
    	let td43;
    	let equation29;
    	let t100;
    	let td44;
    	let equation30;
    	let t101;
    	let td45;
    	let equation31;
    	let t102;
    	let td46;
    	let t103;
    	let t104;
    	let td47;
    	let equation32;
    	let t105;
    	let h41;
    	let t106;
    	let t107;
    	let div5;
    	let graph0;
    	let t108;
    	let graph1;
    	let t109;
    	let graph2;
    	let t110;
    	let graph3;
    	let t111;
    	let graph4;
    	let t112;
    	let h42;
    	let t113;
    	let t114;
    	let p2;
    	let t115;
    	let equation33;
    	let t116;
    	let t117;
    	let graph5;
    	let t118;
    	let br6;
    	let t119;
    	let p3;
    	let t120;
    	let equation34;
    	let t121;
    	let equation35;
    	let t122;
    	let equation36;
    	let t123;
    	let equation37;
    	let t124;
    	let equation38;
    	let t125;
    	let equation39;
    	let t126;
    	let t127;
    	let h43;
    	let t128;
    	let t129;
    	let p4;
    	let t130;
    	let equation40;
    	let t131;
    	let br7;
    	let t132;
    	let equation41;
    	let t133;
    	let br8;
    	let t134;
    	let equation42;
    	let t135;
    	let br9;
    	let t136;
    	let equation43;
    	let t137;
    	let br10;
    	let t138;
    	let equation44;
    	let t139;
    	let br11;
    	let t140;
    	let equation45;
    	let t141;
    	let br12;
    	let t142;
    	let br13;
    	let t143;
    	let br14;
    	let t144;
    	let equation46;
    	let t145;
    	let br15;
    	let t146;
    	let equation47;
    	let t147;
    	let br16;
    	let t148;
    	let equation48;
    	let t149;
    	let br17;
    	let t150;
    	let equation49;
    	let t151;
    	let br18;
    	let t152;
    	let equation50;
    	let t153;
    	let br19;
    	let t154;
    	let br20;
    	let t155;
    	let br21;
    	let t156;
    	let br22;
    	let t157;
    	let h21;
    	let t158;
    	let t159;
    	let p5;
    	let t160;
    	let br23;
    	let t161;
    	let equation51;
    	let t162;
    	let br24;
    	let t163;
    	let equation52;
    	let t164;
    	let equation53;
    	let t165;
    	let t166;
    	let h44;
    	let t167;
    	let t168;
    	let div6;
    	let graph6;
    	let t169;
    	let graph7;
    	let t170;
    	let graph8;
    	let t171;
    	let graph9;
    	let t172;
    	let graph10;
    	let t173;
    	let h45;
    	let t174;
    	let t175;
    	let table2;
    	let tr10;
    	let td48;
    	let t176;
    	let t177;
    	let td49;
    	let equation54;
    	let t178;
    	let tr11;
    	let td50;
    	let t179;
    	let t180;
    	let td51;
    	let equation55;
    	let t181;
    	let tr12;
    	let td52;
    	let t182;
    	let t183;
    	let td53;
    	let equation56;
    	let t184;
    	let tr13;
    	let td54;
    	let t185;
    	let t186;
    	let td55;
    	let equation57;
    	let t187;
    	let tr14;
    	let td56;
    	let t188;
    	let t189;
    	let td57;
    	let equation58;
    	let t190;
    	let tr15;
    	let td58;
    	let t191;
    	let t192;
    	let td59;
    	let equation59;
    	let t193;
    	let tr16;
    	let td60;
    	let t194;
    	let t195;
    	let td61;
    	let equation60;
    	let t196;
    	let tr17;
    	let td62;
    	let t197;
    	let t198;
    	let td63;
    	let equation61;
    	let t199;
    	let br25;
    	let t200;
    	let br26;
    	let t201;
    	let h22;
    	let t202;
    	let t203;
    	let p6;
    	let t204;
    	let equation62;
    	let t205;
    	let equation63;
    	let t206;
    	let equation64;
    	let t207;
    	let equation65;
    	let t208;
    	let equation66;
    	let t209;
    	let h46;
    	let t210;
    	let t211;
    	let div7;
    	let graph11;
    	let t212;
    	let graph12;
    	let t213;
    	let graph13;
    	let t214;
    	let h47;
    	let t215;
    	let t216;
    	let table3;
    	let tr18;
    	let td64;
    	let t217;
    	let t218;
    	let td65;
    	let equation67;
    	let t219;
    	let tr19;
    	let td66;
    	let t220;
    	let t221;
    	let td67;
    	let equation68;
    	let t222;
    	let tr20;
    	let td68;
    	let t223;
    	let t224;
    	let td69;
    	let equation69;
    	let t225;
    	let tr21;
    	let td70;
    	let t226;
    	let t227;
    	let td71;
    	let equation70;
    	let t228;
    	let tr22;
    	let td72;
    	let t229;
    	let t230;
    	let td73;
    	let equation71;
    	let t231;
    	let tr23;
    	let td74;
    	let t232;
    	let t233;
    	let td75;
    	let equation72;
    	let t234;
    	let br27;
    	let t235;
    	let br28;
    	let t236;
    	let h23;
    	let t237;
    	let t238;
    	let p7;
    	let t239;
    	let equation73;
    	let t240;
    	let equation74;
    	let t241;
    	let t242;
    	let br29;
    	let t243;
    	let table4;
    	let tr24;
    	let td76;
    	let t244;
    	let t245;
    	let td77;
    	let equation75;
    	let t246;
    	let tr25;
    	let td78;
    	let t247;
    	let t248;
    	let td79;
    	let equation76;
    	let t249;
    	let tr26;
    	let td80;
    	let t250;
    	let t251;
    	let td81;
    	let equation77;
    	let t252;
    	let tr27;
    	let td82;
    	let t253;
    	let t254;
    	let td83;
    	let equation78;
    	let t255;
    	let equation79;
    	let t256;
    	let p8;
    	let t257;
    	let t258;
    	let h48;
    	let t259;
    	let t260;
    	let p9;
    	let t261;
    	let br30;
    	let t262;
    	let equation80;
    	let t263;
    	let br31;
    	let t264;
    	let br32;
    	let t265;
    	let br33;
    	let t266;
    	let t267;
    	let h49;
    	let t268;
    	let t269;
    	let equation81;
    	let t270;
    	let equation82;
    	let t271;
    	let br34;
    	let t272;
    	let ul;
    	let li0;
    	let t273;
    	let br35;
    	let t274;
    	let equation83;
    	let t275;
    	let br36;
    	let t276;
    	let equation84;
    	let t277;
    	let br37;
    	let t278;
    	let equation85;
    	let t279;
    	let br38;
    	let t280;
    	let equation86;
    	let t281;
    	let br39;
    	let t282;
    	let equation87;
    	let t283;
    	let br40;
    	let t284;
    	let li1;
    	let t285;
    	let br41;
    	let t286;
    	let equation88;
    	let t287;
    	let br42;
    	let t288;
    	let equation89;
    	let t289;
    	let br43;
    	let t290;
    	let equation90;
    	let t291;
    	let br44;
    	let t292;
    	let equation91;
    	let t293;
    	let br45;
    	let t294;
    	let equation92;
    	let t295;
    	let br46;
    	let t296;
    	let li2;
    	let t297;
    	let br47;
    	let t298;
    	let equation93;
    	let t299;
    	let br48;
    	let t300;
    	let equation94;
    	let t301;
    	let br49;
    	let t302;
    	let equation95;
    	let t303;
    	let br50;
    	let t304;
    	let equation96;
    	let t305;
    	let br51;
    	let t306;
    	let equation97;
    	let t307;
    	let br52;
    	let t308;
    	let li3;
    	let t309;
    	let br53;
    	let t310;
    	let equation98;
    	let t311;
    	let br54;
    	let t312;
    	let equation99;
    	let t313;
    	let br55;
    	let t314;
    	let equation100;
    	let t315;
    	let br56;
    	let t316;
    	let li4;
    	let t317;
    	let br57;
    	let t318;
    	let equation101;
    	let t319;
    	let br58;
    	let t320;
    	let equation102;
    	let t321;
    	let br59;
    	let t322;
    	let equation103;
    	let t323;
    	let br60;
    	let t324;
    	let equation104;
    	let t325;
    	let equation105;
    	let t326;
    	let equation106;
    	let t327;
    	let br61;
    	let t328;
    	let equation107;
    	let t329;
    	let br62;
    	let t330;
    	let equation108;
    	let t331;
    	let br63;
    	let t332;
    	let equation109;
    	let t333;
    	let br64;
    	let t334;
    	let br65;
    	let t335;
    	let equation110;
    	let t336;
    	let equation111;
    	let t337;
    	let equation112;
    	let t338;
    	let br66;
    	let t339;
    	let br67;
    	let t340;
    	let br68;
    	let t341;
    	let br69;
    	let t342;
    	let br70;
    	let t343;
    	let br71;
    	let current;
    	let mounted;
    	let dispose;
    	add_render_callback(/*onwindowscroll*/ ctx[4]);

    	equation0 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_112] },
    				$$scope: { ctx }
    			}
    		});

    	equation1 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_111] },
    				$$scope: { ctx }
    			}
    		});

    	equation2 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_110] },
    				$$scope: { ctx }
    			}
    		});

    	equation3 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_109] },
    				$$scope: { ctx }
    			}
    		});

    	equation4 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_108] },
    				$$scope: { ctx }
    			}
    		});

    	equation5 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_107] },
    				$$scope: { ctx }
    			}
    		});

    	equation6 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_106] },
    				$$scope: { ctx }
    			}
    		});

    	equation7 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_105] },
    				$$scope: { ctx }
    			}
    		});

    	equation8 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_104] },
    				$$scope: { ctx }
    			}
    		});

    	equation9 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_103] },
    				$$scope: { ctx }
    			}
    		});

    	equation10 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_102] },
    				$$scope: { ctx }
    			}
    		});

    	equation11 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_101] },
    				$$scope: { ctx }
    			}
    		});

    	equation12 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_100] },
    				$$scope: { ctx }
    			}
    		});

    	equation13 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_99] },
    				$$scope: { ctx }
    			}
    		});

    	equation14 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_98] },
    				$$scope: { ctx }
    			}
    		});

    	equation15 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_97] },
    				$$scope: { ctx }
    			}
    		});

    	equation16 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_96] },
    				$$scope: { ctx }
    			}
    		});

    	equation17 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_95] },
    				$$scope: { ctx }
    			}
    		});

    	equation18 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_94] },
    				$$scope: { ctx }
    			}
    		});

    	equation19 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_93] },
    				$$scope: { ctx }
    			}
    		});

    	equation20 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_92] },
    				$$scope: { ctx }
    			}
    		});

    	equation21 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_91] },
    				$$scope: { ctx }
    			}
    		});

    	equation22 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_90] },
    				$$scope: { ctx }
    			}
    		});

    	equation23 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_89] },
    				$$scope: { ctx }
    			}
    		});

    	equation24 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_88] },
    				$$scope: { ctx }
    			}
    		});

    	equation25 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_87] },
    				$$scope: { ctx }
    			}
    		});

    	equation26 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_86] },
    				$$scope: { ctx }
    			}
    		});

    	equation27 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_85] },
    				$$scope: { ctx }
    			}
    		});

    	equation28 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_84] },
    				$$scope: { ctx }
    			}
    		});

    	equation29 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_83] },
    				$$scope: { ctx }
    			}
    		});

    	equation30 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_82] },
    				$$scope: { ctx }
    			}
    		});

    	equation31 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_81] },
    				$$scope: { ctx }
    			}
    		});

    	equation32 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_80] },
    				$$scope: { ctx }
    			}
    		});

    	graph0 = new Graph({ props: { equation: "y=\\sin(x)" } });

    	graph1 = new Graph({
    			props: {
    				equation: "y=\\sin(2x)",
    				color: colors.GREEN
    			}
    		});

    	graph2 = new Graph({
    			props: {
    				equation: "y=4\\sin(x)",
    				color: colors.ORANGE
    			}
    		});

    	graph3 = new Graph({
    			props: {
    				equation: "y=2\\cos(3x)",
    				color: colors.PURPLE
    			}
    		});

    	graph4 = new Graph({ props: { equation: "y=\\tan(x)" } });

    	equation33 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_79] },
    				$$scope: { ctx }
    			}
    		});

    	graph5 = new Graph({
    			props: {
    				equation: [],
    				bounds: {
    					left: -1.2,
    					right: 1.2,
    					bottom: -1.2,
    					top: 1.2
    				},
    				display: /*func*/ ctx[9],
    				width: 400,
    				height: 400
    			}
    		});

    	equation34 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_78] },
    				$$scope: { ctx }
    			}
    		});

    	equation35 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_77] },
    				$$scope: { ctx }
    			}
    		});

    	equation36 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_76] },
    				$$scope: { ctx }
    			}
    		});

    	equation37 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_75] },
    				$$scope: { ctx }
    			}
    		});

    	equation38 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_74] },
    				$$scope: { ctx }
    			}
    		});

    	equation39 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_73] },
    				$$scope: { ctx }
    			}
    		});

    	equation40 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_72] },
    				$$scope: { ctx }
    			}
    		});

    	equation41 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_71] },
    				$$scope: { ctx }
    			}
    		});

    	equation42 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_70] },
    				$$scope: { ctx }
    			}
    		});

    	equation43 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_69] },
    				$$scope: { ctx }
    			}
    		});

    	equation44 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_68] },
    				$$scope: { ctx }
    			}
    		});

    	equation45 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_67] },
    				$$scope: { ctx }
    			}
    		});

    	equation46 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_66] },
    				$$scope: { ctx }
    			}
    		});

    	equation47 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_65] },
    				$$scope: { ctx }
    			}
    		});

    	equation48 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_64] },
    				$$scope: { ctx }
    			}
    		});

    	equation49 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_63] },
    				$$scope: { ctx }
    			}
    		});

    	equation50 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_62] },
    				$$scope: { ctx }
    			}
    		});

    	equation51 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_61] },
    				$$scope: { ctx }
    			}
    		});

    	equation52 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_60] },
    				$$scope: { ctx }
    			}
    		});

    	equation53 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_59] },
    				$$scope: { ctx }
    			}
    		});

    	graph6 = new Graph({ props: { equation: "y=2^x" } });

    	graph7 = new Graph({
    			props: {
    				equation: "y=(\\frac" + '{' + "1" + '}' + "2)^x",
    				color: colors.GREEN
    			}
    		});

    	graph8 = new Graph({
    			props: { equation: "y=e^x", color: colors.ORANGE }
    		});

    	graph9 = new Graph({ props: { equation: "y=-3^x" } });

    	graph10 = new Graph({
    			props: {
    				equation: "y=a^x",
    				bounds: {
    					left: -8.2,
    					right: 8.2,
    					bottom: -8.2,
    					top: 8.2
    				},
    				color: colors.BLUE,
    				display: func_1
    			}
    		});

    	equation54 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_58] },
    				$$scope: { ctx }
    			}
    		});

    	equation55 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_57] },
    				$$scope: { ctx }
    			}
    		});

    	equation56 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_56] },
    				$$scope: { ctx }
    			}
    		});

    	equation57 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_55] },
    				$$scope: { ctx }
    			}
    		});

    	equation58 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_54] },
    				$$scope: { ctx }
    			}
    		});

    	equation59 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_53] },
    				$$scope: { ctx }
    			}
    		});

    	equation60 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_52] },
    				$$scope: { ctx }
    			}
    		});

    	equation61 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_51] },
    				$$scope: { ctx }
    			}
    		});

    	equation62 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_50] },
    				$$scope: { ctx }
    			}
    		});

    	equation63 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_49] },
    				$$scope: { ctx }
    			}
    		});

    	equation64 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_48] },
    				$$scope: { ctx }
    			}
    		});

    	equation65 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_47] },
    				$$scope: { ctx }
    			}
    		});

    	equation66 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_46] },
    				$$scope: { ctx }
    			}
    		});

    	graph11 = new Graph({
    			props: {
    				equation: "y=\\log_" + '{' + "10" + '}' + "x",
    				bounds: { left: -2, right: 6, bottom: -4, top: 4 }
    			}
    		});

    	graph12 = new Graph({
    			props: {
    				equation: "y=\\ln x",
    				bounds: { left: -2, right: 6, bottom: -4, top: 4 },
    				color: colors.GREEN
    			}
    		});

    	graph13 = new Graph({
    			props: {
    				equation: "y=\\log_" + '{' + "a" + '}' + "x",
    				bounds: { left: -2, right: 6, bottom: -4, top: 4 },
    				color: colors.BLUE,
    				display: func_2
    			}
    		});

    	equation67 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_45] },
    				$$scope: { ctx }
    			}
    		});

    	equation68 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_44] },
    				$$scope: { ctx }
    			}
    		});

    	equation69 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_43] },
    				$$scope: { ctx }
    			}
    		});

    	equation70 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_42] },
    				$$scope: { ctx }
    			}
    		});

    	equation71 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_41] },
    				$$scope: { ctx }
    			}
    		});

    	equation72 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_40] },
    				$$scope: { ctx }
    			}
    		});

    	equation73 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_39] },
    				$$scope: { ctx }
    			}
    		});

    	equation74 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_38] },
    				$$scope: { ctx }
    			}
    		});

    	equation75 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_37] },
    				$$scope: { ctx }
    			}
    		});

    	equation76 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_36] },
    				$$scope: { ctx }
    			}
    		});

    	equation77 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_35] },
    				$$scope: { ctx }
    			}
    		});

    	equation78 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_34] },
    				$$scope: { ctx }
    			}
    		});

    	equation79 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_33] },
    				$$scope: { ctx }
    			}
    		});

    	equation80 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_32] },
    				$$scope: { ctx }
    			}
    		});

    	equation81 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_31] },
    				$$scope: { ctx }
    			}
    		});

    	equation82 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_30] },
    				$$scope: { ctx }
    			}
    		});

    	equation83 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_29] },
    				$$scope: { ctx }
    			}
    		});

    	equation84 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_28] },
    				$$scope: { ctx }
    			}
    		});

    	equation85 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_27] },
    				$$scope: { ctx }
    			}
    		});

    	equation86 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_26] },
    				$$scope: { ctx }
    			}
    		});

    	equation87 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_25] },
    				$$scope: { ctx }
    			}
    		});

    	equation88 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_24] },
    				$$scope: { ctx }
    			}
    		});

    	equation89 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_23] },
    				$$scope: { ctx }
    			}
    		});

    	equation90 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_22] },
    				$$scope: { ctx }
    			}
    		});

    	equation91 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_21] },
    				$$scope: { ctx }
    			}
    		});

    	equation92 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_20] },
    				$$scope: { ctx }
    			}
    		});

    	equation93 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_19] },
    				$$scope: { ctx }
    			}
    		});

    	equation94 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_18] },
    				$$scope: { ctx }
    			}
    		});

    	equation95 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_17] },
    				$$scope: { ctx }
    			}
    		});

    	equation96 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_16] },
    				$$scope: { ctx }
    			}
    		});

    	equation97 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_15] },
    				$$scope: { ctx }
    			}
    		});

    	equation98 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_14] },
    				$$scope: { ctx }
    			}
    		});

    	equation99 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_13] },
    				$$scope: { ctx }
    			}
    		});

    	equation100 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_12] },
    				$$scope: { ctx }
    			}
    		});

    	equation101 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_11] },
    				$$scope: { ctx }
    			}
    		});

    	equation102 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_10] },
    				$$scope: { ctx }
    			}
    		});

    	equation103 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_9] },
    				$$scope: { ctx }
    			}
    		});

    	equation104 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_8] },
    				$$scope: { ctx }
    			}
    		});

    	equation105 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_7] },
    				$$scope: { ctx }
    			}
    		});

    	equation106 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_6] },
    				$$scope: { ctx }
    			}
    		});

    	equation107 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_5] },
    				$$scope: { ctx }
    			}
    		});

    	equation108 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_4] },
    				$$scope: { ctx }
    			}
    		});

    	equation109 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_3] },
    				$$scope: { ctx }
    			}
    		});

    	equation110 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_2] },
    				$$scope: { ctx }
    			}
    		});

    	equation111 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot_1] },
    				$$scope: { ctx }
    			}
    		});

    	equation112 = new Equation({
    			props: {
    				$$slots: { default: [create_default_slot$1] },
    				$$scope: { ctx }
    			}
    		});

    	return {
    		c() {
    			div9 = element("div");
    			h1 = element("h1");
    			t0 = text("Assigment 0.2");
    			t1 = space();
    			h3 = element("h3");
    			t2 = text("By Oliver Clarke");
    			t3 = space();
    			div4 = element("div");
    			div0 = element("div");
    			t4 = text("Trigonometric Equations");
    			t5 = space();
    			div1 = element("div");
    			t6 = text("Exponential Equations");
    			t7 = space();
    			div2 = element("div");
    			t8 = text("Logarithmic Equations");
    			t9 = space();
    			div3 = element("div");
    			t10 = text("Combinations of functions");
    			t11 = space();
    			div8 = element("div");
    			h20 = element("h2");
    			t12 = text("Trigonometric Functions");
    			t13 = space();
    			p0 = element("p");
    			t14 = text("Trionometric functions are funcitons which describe the relationship\r\n            of the angle of a ");
    			strong = element("strong");
    			t15 = text("right angled");
    			t16 = text(" traingle and it's\r\n            side lengths. These functions are periodic functinos meaning they\r\n            repeat their values at regular intervals.");
    			br0 = element("br");
    			t17 = text("\r\n            The most common trig functions are sine, cosine, and tangent with their\r\n            respective reciprocals cosecant, secant, and cotangent. All of these\r\n            functions have their inverse functions or arc functions that take a side\r\n            length and produce an angle.");
    			br1 = element("br");
    			t18 = space();
    			table0 = element("table");
    			tr0 = element("tr");
    			td0 = element("td");
    			create_component(equation0.$$.fragment);
    			t19 = space();
    			td1 = element("td");
    			create_component(equation1.$$.fragment);
    			t20 = space();
    			tr1 = element("tr");
    			td2 = element("td");
    			create_component(equation2.$$.fragment);
    			t21 = space();
    			td3 = element("td");
    			create_component(equation3.$$.fragment);
    			t22 = space();
    			tr2 = element("tr");
    			td4 = element("td");
    			create_component(equation4.$$.fragment);
    			t23 = space();
    			td5 = element("td");
    			create_component(equation5.$$.fragment);
    			t24 = space();
    			p1 = element("p");
    			t25 = text("The general equation for sin is:\r\n            ");
    			br2 = element("br");
    			t26 = space();
    			br3 = element("br");
    			t27 = space();
    			create_component(equation6.$$.fragment);
    			t28 = space();
    			br4 = element("br");
    			t29 = space();
    			br5 = element("br");
    			t30 = text("\r\n            where a is amplitude, b is frequency/amplitude, and c is the phase shift");
    			t31 = space();
    			h40 = element("h4");
    			t32 = text("Important Angles");
    			t33 = space();
    			table1 = element("table");
    			tr3 = element("tr");
    			th0 = element("th");
    			create_component(equation7.$$.fragment);
    			t34 = space();
    			th1 = element("th");
    			create_component(equation8.$$.fragment);
    			t35 = space();
    			th2 = element("th");
    			create_component(equation9.$$.fragment);
    			t36 = space();
    			th3 = element("th");
    			create_component(equation10.$$.fragment);
    			t37 = space();
    			th4 = element("th");
    			create_component(equation11.$$.fragment);
    			t38 = space();
    			th5 = element("th");
    			create_component(equation12.$$.fragment);
    			t39 = space();
    			th6 = element("th");
    			create_component(equation13.$$.fragment);
    			t40 = space();
    			tr4 = element("tr");
    			td6 = element("td");
    			t41 = text("0");
    			t42 = space();
    			td7 = element("td");
    			t43 = text("0");
    			t44 = space();
    			td8 = element("td");
    			t45 = text("1");
    			t46 = space();
    			td9 = element("td");
    			t47 = text("0");
    			t48 = space();
    			td10 = element("td");
    			t49 = text("undefined");
    			t50 = space();
    			td11 = element("td");
    			t51 = text("1");
    			t52 = space();
    			td12 = element("td");
    			t53 = text("undefined");
    			t54 = space();
    			tr5 = element("tr");
    			td13 = element("td");
    			create_component(equation14.$$.fragment);
    			t55 = space();
    			td14 = element("td");
    			t56 = text("1");
    			t57 = space();
    			td15 = element("td");
    			t58 = text("0");
    			t59 = space();
    			td16 = element("td");
    			t60 = text("undefined");
    			t61 = space();
    			td17 = element("td");
    			t62 = text("0");
    			t63 = space();
    			td18 = element("td");
    			t64 = text("undefined");
    			t65 = space();
    			td19 = element("td");
    			t66 = text("1");
    			t67 = space();
    			tr6 = element("tr");
    			td20 = element("td");
    			create_component(equation15.$$.fragment);
    			t68 = space();
    			td21 = element("td");
    			t69 = text("0");
    			t70 = space();
    			td22 = element("td");
    			t71 = text("-1");
    			t72 = space();
    			td23 = element("td");
    			t73 = text("0");
    			t74 = space();
    			td24 = element("td");
    			t75 = text("undefined");
    			t76 = space();
    			td25 = element("td");
    			t77 = text("-1");
    			t78 = space();
    			td26 = element("td");
    			t79 = text("undefined");
    			t80 = space();
    			tr7 = element("tr");
    			td27 = element("td");
    			create_component(equation16.$$.fragment);
    			t81 = space();
    			td28 = element("td");
    			create_component(equation17.$$.fragment);
    			t82 = space();
    			td29 = element("td");
    			create_component(equation18.$$.fragment);
    			t83 = space();
    			td30 = element("td");
    			create_component(equation19.$$.fragment);
    			t84 = space();
    			td31 = element("td");
    			create_component(equation20.$$.fragment);
    			t85 = space();
    			td32 = element("td");
    			create_component(equation21.$$.fragment);
    			t86 = space();
    			td33 = element("td");
    			t87 = text("2");
    			t88 = space();
    			tr8 = element("tr");
    			td34 = element("td");
    			create_component(equation22.$$.fragment);
    			t89 = space();
    			td35 = element("td");
    			create_component(equation23.$$.fragment);
    			t90 = space();
    			td36 = element("td");
    			create_component(equation24.$$.fragment);
    			t91 = space();
    			td37 = element("td");
    			t92 = text("1");
    			t93 = space();
    			td38 = element("td");
    			t94 = text("1");
    			t95 = space();
    			td39 = element("td");
    			create_component(equation25.$$.fragment);
    			t96 = space();
    			td40 = element("td");
    			create_component(equation26.$$.fragment);
    			t97 = space();
    			tr9 = element("tr");
    			td41 = element("td");
    			create_component(equation27.$$.fragment);
    			t98 = space();
    			td42 = element("td");
    			create_component(equation28.$$.fragment);
    			t99 = space();
    			td43 = element("td");
    			create_component(equation29.$$.fragment);
    			t100 = space();
    			td44 = element("td");
    			create_component(equation30.$$.fragment);
    			t101 = space();
    			td45 = element("td");
    			create_component(equation31.$$.fragment);
    			t102 = space();
    			td46 = element("td");
    			t103 = text("2");
    			t104 = space();
    			td47 = element("td");
    			create_component(equation32.$$.fragment);
    			t105 = space();
    			h41 = element("h4");
    			t106 = text("Graphs");
    			t107 = space();
    			div5 = element("div");
    			create_component(graph0.$$.fragment);
    			t108 = space();
    			create_component(graph1.$$.fragment);
    			t109 = space();
    			create_component(graph2.$$.fragment);
    			t110 = space();
    			create_component(graph3.$$.fragment);
    			t111 = space();
    			create_component(graph4.$$.fragment);
    			t112 = space();
    			h42 = element("h4");
    			t113 = text("Unit Circle");
    			t114 = space();
    			p2 = element("p");
    			t115 = text("The unit circle is a circle of radius 1. Because of this, it's easy\r\n            to relate sin and cos to a line segment with an origin at (0, 0),\r\n            with a length of 1, and angle ");
    			create_component(equation33.$$.fragment);
    			t116 = text(" since these\r\n            functions have a range of [-1, 1]: the angle of the line is used as the\r\n            input to these functions, sin yields the y value of the point that the\r\n            line falls on while cos produces the x value. The tan function produces\r\n            the length of the tangent line of the point on the circle from itself\r\n            to the x axis.");
    			t117 = space();
    			create_component(graph5.$$.fragment);
    			t118 = space();
    			br6 = element("br");
    			t119 = space();
    			p3 = element("p");
    			t120 = text("As seen on the graph above, a triangle is formed out of the line\r\n            described above, which is the hypotenuse, along with the lines\r\n            created by the values of cos and sin. Hence, these trig functions\r\n            can be used to solve for the side length and angles of a right\r\n            triangle. For triangles with a hypotenuse greater than 1, we look\r\n            back to the above definition of these functions and see that ");
    			create_component(equation34.$$.fragment);
    			t121 = text(" and ");
    			create_component(equation35.$$.fragment);
    			t122 = text(". We also see that they must\r\n            be in the range [-1, 1]. For triangles with hypotenuse greater than\r\n            1, it is very likely that these side lengths will be greater than 1\r\n            which would break this definition. To solve this we can normalize\r\n            the x and y values by dividing them by the hypotenuse, gauranteein\r\n            that they will be in the range [0, 1]. Therefore we can say ");
    			create_component(equation36.$$.fragment);
    			t123 = text(" and ");
    			create_component(equation37.$$.fragment);
    			t124 = text(". Tangent can be defined as ");
    			create_component(equation38.$$.fragment);
    			t125 = text(" or\r\n            ");
    			create_component(equation39.$$.fragment);
    			t126 = text(".");
    			t127 = space();
    			h43 = element("h4");
    			t128 = text("Examples");
    			t129 = space();
    			p4 = element("p");
    			t130 = text("Given a triangle has an angle of ");
    			create_component(equation40.$$.fragment);
    			t131 = text(" with a hypotenuse of 8, find the opposite side of the angle:\r\n            ");
    			br7 = element("br");
    			t132 = space();
    			create_component(equation41.$$.fragment);
    			t133 = space();
    			br8 = element("br");
    			t134 = space();
    			create_component(equation42.$$.fragment);
    			t135 = space();
    			br9 = element("br");
    			t136 = space();
    			create_component(equation43.$$.fragment);
    			t137 = space();
    			br10 = element("br");
    			t138 = space();
    			create_component(equation44.$$.fragment);
    			t139 = space();
    			br11 = element("br");
    			t140 = space();
    			create_component(equation45.$$.fragment);
    			t141 = space();
    			br12 = element("br");
    			t142 = space();
    			br13 = element("br");
    			t143 = space();
    			br14 = element("br");
    			t144 = text("\r\n            A triangle has an opposite side length of 50 and an adjacent side length\r\n            of 37. Find the angle ");
    			create_component(equation46.$$.fragment);
    			t145 = text(":\r\n            ");
    			br15 = element("br");
    			t146 = space();
    			create_component(equation47.$$.fragment);
    			t147 = space();
    			br16 = element("br");
    			t148 = space();
    			create_component(equation48.$$.fragment);
    			t149 = space();
    			br17 = element("br");
    			t150 = space();
    			create_component(equation49.$$.fragment);
    			t151 = space();
    			br18 = element("br");
    			t152 = space();
    			create_component(equation50.$$.fragment);
    			t153 = space();
    			br19 = element("br");
    			t154 = space();
    			br20 = element("br");
    			t155 = space();
    			br21 = element("br");
    			t156 = space();
    			br22 = element("br");
    			t157 = space();
    			h21 = element("h2");
    			t158 = text("Exponential Functions");
    			t159 = space();
    			p5 = element("p");
    			t160 = text("Exponential functions are those that include a variable in the\r\n            exponent. They generally take the form:\r\n            ");
    			br23 = element("br");
    			t161 = space();
    			create_component(equation51.$$.fragment);
    			t162 = space();
    			br24 = element("br");
    			t163 = text("\r\n            Where b (the base) is a constant and ");
    			create_component(equation52.$$.fragment);
    			t164 = text(" and ");
    			create_component(equation53.$$.fragment);
    			t165 = text(".");
    			t166 = space();
    			h44 = element("h4");
    			t167 = text("Graphs");
    			t168 = space();
    			div6 = element("div");
    			create_component(graph6.$$.fragment);
    			t169 = space();
    			create_component(graph7.$$.fragment);
    			t170 = space();
    			create_component(graph8.$$.fragment);
    			t171 = space();
    			create_component(graph9.$$.fragment);
    			t172 = space();
    			create_component(graph10.$$.fragment);
    			t173 = space();
    			h45 = element("h4");
    			t174 = text("Exponent Rules");
    			t175 = space();
    			table2 = element("table");
    			tr10 = element("tr");
    			td48 = element("td");
    			t176 = text("Product Rule");
    			t177 = space();
    			td49 = element("td");
    			create_component(equation54.$$.fragment);
    			t178 = space();
    			tr11 = element("tr");
    			td50 = element("td");
    			t179 = text("Quotient Rule");
    			t180 = space();
    			td51 = element("td");
    			create_component(equation55.$$.fragment);
    			t181 = space();
    			tr12 = element("tr");
    			td52 = element("td");
    			t182 = text("Power Rule");
    			t183 = space();
    			td53 = element("td");
    			create_component(equation56.$$.fragment);
    			t184 = space();
    			tr13 = element("tr");
    			td54 = element("td");
    			t185 = text("Power of Product Rule");
    			t186 = space();
    			td55 = element("td");
    			create_component(equation57.$$.fragment);
    			t187 = space();
    			tr14 = element("tr");
    			td56 = element("td");
    			t188 = text("Power of Quotient Rule");
    			t189 = space();
    			td57 = element("td");
    			create_component(equation58.$$.fragment);
    			t190 = space();
    			tr15 = element("tr");
    			td58 = element("td");
    			t191 = text("Exponent of 0");
    			t192 = space();
    			td59 = element("td");
    			create_component(equation59.$$.fragment);
    			t193 = space();
    			tr16 = element("tr");
    			td60 = element("td");
    			t194 = text("Negative Exponent");
    			t195 = space();
    			td61 = element("td");
    			create_component(equation60.$$.fragment);
    			t196 = space();
    			tr17 = element("tr");
    			td62 = element("td");
    			t197 = text("Fractional Exponent");
    			t198 = space();
    			td63 = element("td");
    			create_component(equation61.$$.fragment);
    			t199 = space();
    			br25 = element("br");
    			t200 = space();
    			br26 = element("br");
    			t201 = space();
    			h22 = element("h2");
    			t202 = text("Logarithmic Functions");
    			t203 = space();
    			p6 = element("p");
    			t204 = text("Logarithmic functions are the inverse functions of exponential\r\n            functions. Therefore, if ");
    			create_component(equation62.$$.fragment);
    			t205 = text(", then ");
    			create_component(equation63.$$.fragment);
    			t206 = text(" where ");
    			create_component(equation64.$$.fragment);
    			t207 = text(". The logarithm with base ");
    			create_component(equation65.$$.fragment);
    			t208 = text(" has a special name of natural log: ");
    			create_component(equation66.$$.fragment);
    			t209 = space();
    			h46 = element("h4");
    			t210 = text("Graphs");
    			t211 = space();
    			div7 = element("div");
    			create_component(graph11.$$.fragment);
    			t212 = space();
    			create_component(graph12.$$.fragment);
    			t213 = space();
    			create_component(graph13.$$.fragment);
    			t214 = space();
    			h47 = element("h4");
    			t215 = text("Log Rules");
    			t216 = space();
    			table3 = element("table");
    			tr18 = element("tr");
    			td64 = element("td");
    			t217 = text("Product Rule");
    			t218 = space();
    			td65 = element("td");
    			create_component(equation67.$$.fragment);
    			t219 = space();
    			tr19 = element("tr");
    			td66 = element("td");
    			t220 = text("Quotient Rule");
    			t221 = space();
    			td67 = element("td");
    			create_component(equation68.$$.fragment);
    			t222 = space();
    			tr20 = element("tr");
    			td68 = element("td");
    			t223 = text("Power Rule");
    			t224 = space();
    			td69 = element("td");
    			create_component(equation69.$$.fragment);
    			t225 = space();
    			tr21 = element("tr");
    			td70 = element("td");
    			t226 = text("Change of Base Rule");
    			t227 = space();
    			td71 = element("td");
    			create_component(equation70.$$.fragment);
    			t228 = space();
    			tr22 = element("tr");
    			td72 = element("td");
    			t229 = text("Equality Rule");
    			t230 = space();
    			td73 = element("td");
    			create_component(equation71.$$.fragment);
    			t231 = space();
    			tr23 = element("tr");
    			td74 = element("td");
    			t232 = text("Log of 1");
    			t233 = space();
    			td75 = element("td");
    			create_component(equation72.$$.fragment);
    			t234 = space();
    			br27 = element("br");
    			t235 = space();
    			br28 = element("br");
    			t236 = space();
    			h23 = element("h2");
    			t237 = text("Combinations of Functions");
    			t238 = space();
    			p7 = element("p");
    			t239 = text("Functions can be added, subtracted, multiplied, and divided much\r\n            like regular numbers. The basic forms of this for functions ");
    			create_component(equation73.$$.fragment);
    			t240 = text(" and ");
    			create_component(equation74.$$.fragment);
    			t241 = text(" are:");
    			t242 = space();
    			br29 = element("br");
    			t243 = space();
    			table4 = element("table");
    			tr24 = element("tr");
    			td76 = element("td");
    			t244 = text("Addition");
    			t245 = space();
    			td77 = element("td");
    			create_component(equation75.$$.fragment);
    			t246 = space();
    			tr25 = element("tr");
    			td78 = element("td");
    			t247 = text("Subtraction");
    			t248 = space();
    			td79 = element("td");
    			create_component(equation76.$$.fragment);
    			t249 = space();
    			tr26 = element("tr");
    			td80 = element("td");
    			t250 = text("Multiplication");
    			t251 = space();
    			td81 = element("td");
    			create_component(equation77.$$.fragment);
    			t252 = space();
    			tr27 = element("tr");
    			td82 = element("td");
    			t253 = text("Division");
    			t254 = space();
    			td83 = element("td");
    			create_component(equation78.$$.fragment);
    			t255 = text("\r\n                    where ");
    			create_component(equation79.$$.fragment);
    			t256 = space();
    			p8 = element("p");
    			t257 = text("The domain of the new combined function includes all the points for\r\n            which the all the functions used to compose it are defined at that\r\n            point.");
    			t258 = space();
    			h48 = element("h4");
    			t259 = text("Composition");
    			t260 = space();
    			p9 = element("p");
    			t261 = text("Composition is slightly different as it is the process of plugging\r\n            one function into another:\r\n            ");
    			br30 = element("br");
    			t262 = space();
    			create_component(equation80.$$.fragment);
    			t263 = space();
    			br31 = element("br");
    			t264 = space();
    			br32 = element("br");
    			t265 = text("\r\n            Here f is said to be composed of g of x. Functions are evaluated from\r\n            the inside out and is not cumulative.\r\n            ");
    			br33 = element("br");
    			t266 = text("\r\n            The domain of a composed function is values of x that are in the domain\r\n            of the inner function(s) that are in the domain of the outer.");
    			t267 = space();
    			h49 = element("h4");
    			t268 = text("Examples");
    			t269 = text("\r\n        Using ");
    			create_component(equation81.$$.fragment);
    			t270 = text(" and ");
    			create_component(equation82.$$.fragment);
    			t271 = text(":\r\n        ");
    			br34 = element("br");
    			t272 = space();
    			ul = element("ul");
    			li0 = element("li");
    			t273 = text("Adding:\r\n                ");
    			br35 = element("br");
    			t274 = space();
    			create_component(equation83.$$.fragment);
    			t275 = space();
    			br36 = element("br");
    			t276 = space();
    			create_component(equation84.$$.fragment);
    			t277 = space();
    			br37 = element("br");
    			t278 = space();
    			create_component(equation85.$$.fragment);
    			t279 = space();
    			br38 = element("br");
    			t280 = space();
    			create_component(equation86.$$.fragment);
    			t281 = space();
    			br39 = element("br");
    			t282 = space();
    			create_component(equation87.$$.fragment);
    			t283 = space();
    			br40 = element("br");
    			t284 = space();
    			li1 = element("li");
    			t285 = text("Subtracting:\r\n                ");
    			br41 = element("br");
    			t286 = space();
    			create_component(equation88.$$.fragment);
    			t287 = space();
    			br42 = element("br");
    			t288 = space();
    			create_component(equation89.$$.fragment);
    			t289 = space();
    			br43 = element("br");
    			t290 = space();
    			create_component(equation90.$$.fragment);
    			t291 = space();
    			br44 = element("br");
    			t292 = space();
    			create_component(equation91.$$.fragment);
    			t293 = space();
    			br45 = element("br");
    			t294 = space();
    			create_component(equation92.$$.fragment);
    			t295 = space();
    			br46 = element("br");
    			t296 = space();
    			li2 = element("li");
    			t297 = text("Multiplying:\r\n                ");
    			br47 = element("br");
    			t298 = space();
    			create_component(equation93.$$.fragment);
    			t299 = space();
    			br48 = element("br");
    			t300 = space();
    			create_component(equation94.$$.fragment);
    			t301 = space();
    			br49 = element("br");
    			t302 = space();
    			create_component(equation95.$$.fragment);
    			t303 = space();
    			br50 = element("br");
    			t304 = space();
    			create_component(equation96.$$.fragment);
    			t305 = space();
    			br51 = element("br");
    			t306 = space();
    			create_component(equation97.$$.fragment);
    			t307 = space();
    			br52 = element("br");
    			t308 = space();
    			li3 = element("li");
    			t309 = text("Dividing:\r\n                ");
    			br53 = element("br");
    			t310 = space();
    			create_component(equation98.$$.fragment);
    			t311 = space();
    			br54 = element("br");
    			t312 = space();
    			create_component(equation99.$$.fragment);
    			t313 = space();
    			br55 = element("br");
    			t314 = space();
    			create_component(equation100.$$.fragment);
    			t315 = space();
    			br56 = element("br");
    			t316 = space();
    			li4 = element("li");
    			t317 = text("Composing:\r\n                ");
    			br57 = element("br");
    			t318 = space();
    			create_component(equation101.$$.fragment);
    			t319 = space();
    			br58 = element("br");
    			t320 = space();
    			create_component(equation102.$$.fragment);
    			t321 = space();
    			br59 = element("br");
    			t322 = space();
    			create_component(equation103.$$.fragment);
    			t323 = space();
    			br60 = element("br");
    			t324 = space();
    			create_component(equation104.$$.fragment);
    			t325 = text("\r\n        Compose ");
    			create_component(equation105.$$.fragment);
    			t326 = text(" and ");
    			create_component(equation106.$$.fragment);
    			t327 = text(":\r\n        ");
    			br61 = element("br");
    			t328 = space();
    			create_component(equation107.$$.fragment);
    			t329 = space();
    			br62 = element("br");
    			t330 = space();
    			create_component(equation108.$$.fragment);
    			t331 = space();
    			br63 = element("br");
    			t332 = space();
    			create_component(equation109.$$.fragment);
    			t333 = space();
    			br64 = element("br");
    			t334 = space();
    			br65 = element("br");
    			t335 = text("\r\n        No values of x satisfy this equation because no values of ");
    			create_component(equation110.$$.fragment);
    			t336 = text(" are defined in ");
    			create_component(equation111.$$.fragment);
    			t337 = text(" i.e. ");
    			create_component(equation112.$$.fragment);
    			t338 = text(" will\r\n        always produce a negative number for which the square root is not defined\r\n        for in the real plane.\r\n        ");
    			br66 = element("br");
    			t339 = space();
    			br67 = element("br");
    			t340 = space();
    			br68 = element("br");
    			t341 = space();
    			br69 = element("br");
    			t342 = space();
    			br70 = element("br");
    			t343 = space();
    			br71 = element("br");
    			this.h();
    		},
    		l(nodes) {
    			div9 = claim_element(nodes, "DIV", { class: true });
    			var div9_nodes = children(div9);
    			h1 = claim_element(div9_nodes, "H1", { class: true });
    			var h1_nodes = children(h1);
    			t0 = claim_text(h1_nodes, "Assigment 0.2");
    			h1_nodes.forEach(detach);
    			t1 = claim_space(div9_nodes);
    			h3 = claim_element(div9_nodes, "H3", { class: true });
    			var h3_nodes = children(h3);
    			t2 = claim_text(h3_nodes, "By Oliver Clarke");
    			h3_nodes.forEach(detach);
    			t3 = claim_space(div9_nodes);
    			div4 = claim_element(div9_nodes, "DIV", { id: true, class: true });
    			var div4_nodes = children(div4);
    			div0 = claim_element(div4_nodes, "DIV", { class: true });
    			var div0_nodes = children(div0);
    			t4 = claim_text(div0_nodes, "Trigonometric Equations");
    			div0_nodes.forEach(detach);
    			t5 = claim_space(div4_nodes);
    			div1 = claim_element(div4_nodes, "DIV", { class: true });
    			var div1_nodes = children(div1);
    			t6 = claim_text(div1_nodes, "Exponential Equations");
    			div1_nodes.forEach(detach);
    			t7 = claim_space(div4_nodes);
    			div2 = claim_element(div4_nodes, "DIV", { class: true });
    			var div2_nodes = children(div2);
    			t8 = claim_text(div2_nodes, "Logarithmic Equations");
    			div2_nodes.forEach(detach);
    			t9 = claim_space(div4_nodes);
    			div3 = claim_element(div4_nodes, "DIV", { class: true });
    			var div3_nodes = children(div3);
    			t10 = claim_text(div3_nodes, "Combinations of functions");
    			div3_nodes.forEach(detach);
    			div4_nodes.forEach(detach);
    			t11 = claim_space(div9_nodes);
    			div8 = claim_element(div9_nodes, "DIV", { class: true });
    			var div8_nodes = children(div8);
    			h20 = claim_element(div8_nodes, "H2", { id: true, class: true });
    			var h20_nodes = children(h20);
    			t12 = claim_text(h20_nodes, "Trigonometric Functions");
    			h20_nodes.forEach(detach);
    			t13 = claim_space(div8_nodes);
    			p0 = claim_element(div8_nodes, "P", {});
    			var p0_nodes = children(p0);
    			t14 = claim_text(p0_nodes, "Trionometric functions are funcitons which describe the relationship\r\n            of the angle of a ");
    			strong = claim_element(p0_nodes, "STRONG", {});
    			var strong_nodes = children(strong);
    			t15 = claim_text(strong_nodes, "right angled");
    			strong_nodes.forEach(detach);
    			t16 = claim_text(p0_nodes, " traingle and it's\r\n            side lengths. These functions are periodic functinos meaning they\r\n            repeat their values at regular intervals.");
    			br0 = claim_element(p0_nodes, "BR", {});
    			t17 = claim_text(p0_nodes, "\r\n            The most common trig functions are sine, cosine, and tangent with their\r\n            respective reciprocals cosecant, secant, and cotangent. All of these\r\n            functions have their inverse functions or arc functions that take a side\r\n            length and produce an angle.");
    			br1 = claim_element(p0_nodes, "BR", {});
    			p0_nodes.forEach(detach);
    			t18 = claim_space(div8_nodes);
    			table0 = claim_element(div8_nodes, "TABLE", { class: true });
    			var table0_nodes = children(table0);
    			tr0 = claim_element(table0_nodes, "TR", {});
    			var tr0_nodes = children(tr0);
    			td0 = claim_element(tr0_nodes, "TD", { class: true });
    			var td0_nodes = children(td0);
    			claim_component(equation0.$$.fragment, td0_nodes);
    			td0_nodes.forEach(detach);
    			t19 = claim_space(tr0_nodes);
    			td1 = claim_element(tr0_nodes, "TD", { class: true });
    			var td1_nodes = children(td1);
    			claim_component(equation1.$$.fragment, td1_nodes);
    			td1_nodes.forEach(detach);
    			tr0_nodes.forEach(detach);
    			t20 = claim_space(table0_nodes);
    			tr1 = claim_element(table0_nodes, "TR", {});
    			var tr1_nodes = children(tr1);
    			td2 = claim_element(tr1_nodes, "TD", { class: true });
    			var td2_nodes = children(td2);
    			claim_component(equation2.$$.fragment, td2_nodes);
    			td2_nodes.forEach(detach);
    			t21 = claim_space(tr1_nodes);
    			td3 = claim_element(tr1_nodes, "TD", { class: true });
    			var td3_nodes = children(td3);
    			claim_component(equation3.$$.fragment, td3_nodes);
    			td3_nodes.forEach(detach);
    			tr1_nodes.forEach(detach);
    			t22 = claim_space(table0_nodes);
    			tr2 = claim_element(table0_nodes, "TR", {});
    			var tr2_nodes = children(tr2);
    			td4 = claim_element(tr2_nodes, "TD", { class: true });
    			var td4_nodes = children(td4);
    			claim_component(equation4.$$.fragment, td4_nodes);
    			td4_nodes.forEach(detach);
    			t23 = claim_space(tr2_nodes);
    			td5 = claim_element(tr2_nodes, "TD", { class: true });
    			var td5_nodes = children(td5);
    			claim_component(equation5.$$.fragment, td5_nodes);
    			td5_nodes.forEach(detach);
    			tr2_nodes.forEach(detach);
    			table0_nodes.forEach(detach);
    			t24 = claim_space(div8_nodes);
    			p1 = claim_element(div8_nodes, "P", {});
    			var p1_nodes = children(p1);
    			t25 = claim_text(p1_nodes, "The general equation for sin is:\r\n            ");
    			br2 = claim_element(p1_nodes, "BR", {});
    			t26 = claim_space(p1_nodes);
    			br3 = claim_element(p1_nodes, "BR", {});
    			t27 = claim_space(p1_nodes);
    			claim_component(equation6.$$.fragment, p1_nodes);
    			t28 = claim_space(p1_nodes);
    			br4 = claim_element(p1_nodes, "BR", {});
    			t29 = claim_space(p1_nodes);
    			br5 = claim_element(p1_nodes, "BR", {});
    			t30 = claim_text(p1_nodes, "\r\n            where a is amplitude, b is frequency/amplitude, and c is the phase shift");
    			p1_nodes.forEach(detach);
    			t31 = claim_space(div8_nodes);
    			h40 = claim_element(div8_nodes, "H4", { class: true });
    			var h40_nodes = children(h40);
    			t32 = claim_text(h40_nodes, "Important Angles");
    			h40_nodes.forEach(detach);
    			t33 = claim_space(div8_nodes);
    			table1 = claim_element(div8_nodes, "TABLE", { class: true });
    			var table1_nodes = children(table1);
    			tr3 = claim_element(table1_nodes, "TR", {});
    			var tr3_nodes = children(tr3);
    			th0 = claim_element(tr3_nodes, "TH", { class: true });
    			var th0_nodes = children(th0);
    			claim_component(equation7.$$.fragment, th0_nodes);
    			th0_nodes.forEach(detach);
    			t34 = claim_space(tr3_nodes);
    			th1 = claim_element(tr3_nodes, "TH", { class: true });
    			var th1_nodes = children(th1);
    			claim_component(equation8.$$.fragment, th1_nodes);
    			th1_nodes.forEach(detach);
    			t35 = claim_space(tr3_nodes);
    			th2 = claim_element(tr3_nodes, "TH", { class: true });
    			var th2_nodes = children(th2);
    			claim_component(equation9.$$.fragment, th2_nodes);
    			th2_nodes.forEach(detach);
    			t36 = claim_space(tr3_nodes);
    			th3 = claim_element(tr3_nodes, "TH", { class: true });
    			var th3_nodes = children(th3);
    			claim_component(equation10.$$.fragment, th3_nodes);
    			th3_nodes.forEach(detach);
    			t37 = claim_space(tr3_nodes);
    			th4 = claim_element(tr3_nodes, "TH", { class: true });
    			var th4_nodes = children(th4);
    			claim_component(equation11.$$.fragment, th4_nodes);
    			th4_nodes.forEach(detach);
    			t38 = claim_space(tr3_nodes);
    			th5 = claim_element(tr3_nodes, "TH", { class: true });
    			var th5_nodes = children(th5);
    			claim_component(equation12.$$.fragment, th5_nodes);
    			th5_nodes.forEach(detach);
    			t39 = claim_space(tr3_nodes);
    			th6 = claim_element(tr3_nodes, "TH", { class: true });
    			var th6_nodes = children(th6);
    			claim_component(equation13.$$.fragment, th6_nodes);
    			th6_nodes.forEach(detach);
    			tr3_nodes.forEach(detach);
    			t40 = claim_space(table1_nodes);
    			tr4 = claim_element(table1_nodes, "TR", {});
    			var tr4_nodes = children(tr4);
    			td6 = claim_element(tr4_nodes, "TD", { class: true });
    			var td6_nodes = children(td6);
    			t41 = claim_text(td6_nodes, "0");
    			td6_nodes.forEach(detach);
    			t42 = claim_space(tr4_nodes);
    			td7 = claim_element(tr4_nodes, "TD", { class: true });
    			var td7_nodes = children(td7);
    			t43 = claim_text(td7_nodes, "0");
    			td7_nodes.forEach(detach);
    			t44 = claim_space(tr4_nodes);
    			td8 = claim_element(tr4_nodes, "TD", { class: true });
    			var td8_nodes = children(td8);
    			t45 = claim_text(td8_nodes, "1");
    			td8_nodes.forEach(detach);
    			t46 = claim_space(tr4_nodes);
    			td9 = claim_element(tr4_nodes, "TD", { class: true });
    			var td9_nodes = children(td9);
    			t47 = claim_text(td9_nodes, "0");
    			td9_nodes.forEach(detach);
    			t48 = claim_space(tr4_nodes);
    			td10 = claim_element(tr4_nodes, "TD", { class: true });
    			var td10_nodes = children(td10);
    			t49 = claim_text(td10_nodes, "undefined");
    			td10_nodes.forEach(detach);
    			t50 = claim_space(tr4_nodes);
    			td11 = claim_element(tr4_nodes, "TD", { class: true });
    			var td11_nodes = children(td11);
    			t51 = claim_text(td11_nodes, "1");
    			td11_nodes.forEach(detach);
    			t52 = claim_space(tr4_nodes);
    			td12 = claim_element(tr4_nodes, "TD", { class: true });
    			var td12_nodes = children(td12);
    			t53 = claim_text(td12_nodes, "undefined");
    			td12_nodes.forEach(detach);
    			tr4_nodes.forEach(detach);
    			t54 = claim_space(table1_nodes);
    			tr5 = claim_element(table1_nodes, "TR", {});
    			var tr5_nodes = children(tr5);
    			td13 = claim_element(tr5_nodes, "TD", { class: true });
    			var td13_nodes = children(td13);
    			claim_component(equation14.$$.fragment, td13_nodes);
    			td13_nodes.forEach(detach);
    			t55 = claim_space(tr5_nodes);
    			td14 = claim_element(tr5_nodes, "TD", { class: true });
    			var td14_nodes = children(td14);
    			t56 = claim_text(td14_nodes, "1");
    			td14_nodes.forEach(detach);
    			t57 = claim_space(tr5_nodes);
    			td15 = claim_element(tr5_nodes, "TD", { class: true });
    			var td15_nodes = children(td15);
    			t58 = claim_text(td15_nodes, "0");
    			td15_nodes.forEach(detach);
    			t59 = claim_space(tr5_nodes);
    			td16 = claim_element(tr5_nodes, "TD", { class: true });
    			var td16_nodes = children(td16);
    			t60 = claim_text(td16_nodes, "undefined");
    			td16_nodes.forEach(detach);
    			t61 = claim_space(tr5_nodes);
    			td17 = claim_element(tr5_nodes, "TD", { class: true });
    			var td17_nodes = children(td17);
    			t62 = claim_text(td17_nodes, "0");
    			td17_nodes.forEach(detach);
    			t63 = claim_space(tr5_nodes);
    			td18 = claim_element(tr5_nodes, "TD", { class: true });
    			var td18_nodes = children(td18);
    			t64 = claim_text(td18_nodes, "undefined");
    			td18_nodes.forEach(detach);
    			t65 = claim_space(tr5_nodes);
    			td19 = claim_element(tr5_nodes, "TD", { class: true });
    			var td19_nodes = children(td19);
    			t66 = claim_text(td19_nodes, "1");
    			td19_nodes.forEach(detach);
    			tr5_nodes.forEach(detach);
    			t67 = claim_space(table1_nodes);
    			tr6 = claim_element(table1_nodes, "TR", {});
    			var tr6_nodes = children(tr6);
    			td20 = claim_element(tr6_nodes, "TD", { class: true });
    			var td20_nodes = children(td20);
    			claim_component(equation15.$$.fragment, td20_nodes);
    			td20_nodes.forEach(detach);
    			t68 = claim_space(tr6_nodes);
    			td21 = claim_element(tr6_nodes, "TD", { class: true });
    			var td21_nodes = children(td21);
    			t69 = claim_text(td21_nodes, "0");
    			td21_nodes.forEach(detach);
    			t70 = claim_space(tr6_nodes);
    			td22 = claim_element(tr6_nodes, "TD", { class: true });
    			var td22_nodes = children(td22);
    			t71 = claim_text(td22_nodes, "-1");
    			td22_nodes.forEach(detach);
    			t72 = claim_space(tr6_nodes);
    			td23 = claim_element(tr6_nodes, "TD", { class: true });
    			var td23_nodes = children(td23);
    			t73 = claim_text(td23_nodes, "0");
    			td23_nodes.forEach(detach);
    			t74 = claim_space(tr6_nodes);
    			td24 = claim_element(tr6_nodes, "TD", { class: true });
    			var td24_nodes = children(td24);
    			t75 = claim_text(td24_nodes, "undefined");
    			td24_nodes.forEach(detach);
    			t76 = claim_space(tr6_nodes);
    			td25 = claim_element(tr6_nodes, "TD", { class: true });
    			var td25_nodes = children(td25);
    			t77 = claim_text(td25_nodes, "-1");
    			td25_nodes.forEach(detach);
    			t78 = claim_space(tr6_nodes);
    			td26 = claim_element(tr6_nodes, "TD", { class: true });
    			var td26_nodes = children(td26);
    			t79 = claim_text(td26_nodes, "undefined");
    			td26_nodes.forEach(detach);
    			tr6_nodes.forEach(detach);
    			t80 = claim_space(table1_nodes);
    			tr7 = claim_element(table1_nodes, "TR", {});
    			var tr7_nodes = children(tr7);
    			td27 = claim_element(tr7_nodes, "TD", { class: true });
    			var td27_nodes = children(td27);
    			claim_component(equation16.$$.fragment, td27_nodes);
    			td27_nodes.forEach(detach);
    			t81 = claim_space(tr7_nodes);
    			td28 = claim_element(tr7_nodes, "TD", { class: true });
    			var td28_nodes = children(td28);
    			claim_component(equation17.$$.fragment, td28_nodes);
    			td28_nodes.forEach(detach);
    			t82 = claim_space(tr7_nodes);
    			td29 = claim_element(tr7_nodes, "TD", { class: true });
    			var td29_nodes = children(td29);
    			claim_component(equation18.$$.fragment, td29_nodes);
    			td29_nodes.forEach(detach);
    			t83 = claim_space(tr7_nodes);
    			td30 = claim_element(tr7_nodes, "TD", { class: true });
    			var td30_nodes = children(td30);
    			claim_component(equation19.$$.fragment, td30_nodes);
    			td30_nodes.forEach(detach);
    			t84 = claim_space(tr7_nodes);
    			td31 = claim_element(tr7_nodes, "TD", { class: true });
    			var td31_nodes = children(td31);
    			claim_component(equation20.$$.fragment, td31_nodes);
    			td31_nodes.forEach(detach);
    			t85 = claim_space(tr7_nodes);
    			td32 = claim_element(tr7_nodes, "TD", { class: true });
    			var td32_nodes = children(td32);
    			claim_component(equation21.$$.fragment, td32_nodes);
    			td32_nodes.forEach(detach);
    			t86 = claim_space(tr7_nodes);
    			td33 = claim_element(tr7_nodes, "TD", { class: true });
    			var td33_nodes = children(td33);
    			t87 = claim_text(td33_nodes, "2");
    			td33_nodes.forEach(detach);
    			tr7_nodes.forEach(detach);
    			t88 = claim_space(table1_nodes);
    			tr8 = claim_element(table1_nodes, "TR", {});
    			var tr8_nodes = children(tr8);
    			td34 = claim_element(tr8_nodes, "TD", { class: true });
    			var td34_nodes = children(td34);
    			claim_component(equation22.$$.fragment, td34_nodes);
    			td34_nodes.forEach(detach);
    			t89 = claim_space(tr8_nodes);
    			td35 = claim_element(tr8_nodes, "TD", { class: true });
    			var td35_nodes = children(td35);
    			claim_component(equation23.$$.fragment, td35_nodes);
    			td35_nodes.forEach(detach);
    			t90 = claim_space(tr8_nodes);
    			td36 = claim_element(tr8_nodes, "TD", { class: true });
    			var td36_nodes = children(td36);
    			claim_component(equation24.$$.fragment, td36_nodes);
    			td36_nodes.forEach(detach);
    			t91 = claim_space(tr8_nodes);
    			td37 = claim_element(tr8_nodes, "TD", { class: true });
    			var td37_nodes = children(td37);
    			t92 = claim_text(td37_nodes, "1");
    			td37_nodes.forEach(detach);
    			t93 = claim_space(tr8_nodes);
    			td38 = claim_element(tr8_nodes, "TD", { class: true });
    			var td38_nodes = children(td38);
    			t94 = claim_text(td38_nodes, "1");
    			td38_nodes.forEach(detach);
    			t95 = claim_space(tr8_nodes);
    			td39 = claim_element(tr8_nodes, "TD", { class: true });
    			var td39_nodes = children(td39);
    			claim_component(equation25.$$.fragment, td39_nodes);
    			td39_nodes.forEach(detach);
    			t96 = claim_space(tr8_nodes);
    			td40 = claim_element(tr8_nodes, "TD", { class: true });
    			var td40_nodes = children(td40);
    			claim_component(equation26.$$.fragment, td40_nodes);
    			td40_nodes.forEach(detach);
    			tr8_nodes.forEach(detach);
    			t97 = claim_space(table1_nodes);
    			tr9 = claim_element(table1_nodes, "TR", {});
    			var tr9_nodes = children(tr9);
    			td41 = claim_element(tr9_nodes, "TD", { class: true });
    			var td41_nodes = children(td41);
    			claim_component(equation27.$$.fragment, td41_nodes);
    			td41_nodes.forEach(detach);
    			t98 = claim_space(tr9_nodes);
    			td42 = claim_element(tr9_nodes, "TD", { class: true });
    			var td42_nodes = children(td42);
    			claim_component(equation28.$$.fragment, td42_nodes);
    			td42_nodes.forEach(detach);
    			t99 = claim_space(tr9_nodes);
    			td43 = claim_element(tr9_nodes, "TD", { class: true });
    			var td43_nodes = children(td43);
    			claim_component(equation29.$$.fragment, td43_nodes);
    			td43_nodes.forEach(detach);
    			t100 = claim_space(tr9_nodes);
    			td44 = claim_element(tr9_nodes, "TD", { class: true });
    			var td44_nodes = children(td44);
    			claim_component(equation30.$$.fragment, td44_nodes);
    			td44_nodes.forEach(detach);
    			t101 = claim_space(tr9_nodes);
    			td45 = claim_element(tr9_nodes, "TD", { class: true });
    			var td45_nodes = children(td45);
    			claim_component(equation31.$$.fragment, td45_nodes);
    			td45_nodes.forEach(detach);
    			t102 = claim_space(tr9_nodes);
    			td46 = claim_element(tr9_nodes, "TD", { class: true });
    			var td46_nodes = children(td46);
    			t103 = claim_text(td46_nodes, "2");
    			td46_nodes.forEach(detach);
    			t104 = claim_space(tr9_nodes);
    			td47 = claim_element(tr9_nodes, "TD", { class: true });
    			var td47_nodes = children(td47);
    			claim_component(equation32.$$.fragment, td47_nodes);
    			td47_nodes.forEach(detach);
    			tr9_nodes.forEach(detach);
    			table1_nodes.forEach(detach);
    			t105 = claim_space(div8_nodes);
    			h41 = claim_element(div8_nodes, "H4", { class: true });
    			var h41_nodes = children(h41);
    			t106 = claim_text(h41_nodes, "Graphs");
    			h41_nodes.forEach(detach);
    			t107 = claim_space(div8_nodes);
    			div5 = claim_element(div8_nodes, "DIV", { class: true });
    			var div5_nodes = children(div5);
    			claim_component(graph0.$$.fragment, div5_nodes);
    			t108 = claim_space(div5_nodes);
    			claim_component(graph1.$$.fragment, div5_nodes);
    			t109 = claim_space(div5_nodes);
    			claim_component(graph2.$$.fragment, div5_nodes);
    			t110 = claim_space(div5_nodes);
    			claim_component(graph3.$$.fragment, div5_nodes);
    			t111 = claim_space(div5_nodes);
    			claim_component(graph4.$$.fragment, div5_nodes);
    			div5_nodes.forEach(detach);
    			t112 = claim_space(div8_nodes);
    			h42 = claim_element(div8_nodes, "H4", { class: true });
    			var h42_nodes = children(h42);
    			t113 = claim_text(h42_nodes, "Unit Circle");
    			h42_nodes.forEach(detach);
    			t114 = claim_space(div8_nodes);
    			p2 = claim_element(div8_nodes, "P", {});
    			var p2_nodes = children(p2);
    			t115 = claim_text(p2_nodes, "The unit circle is a circle of radius 1. Because of this, it's easy\r\n            to relate sin and cos to a line segment with an origin at (0, 0),\r\n            with a length of 1, and angle ");
    			claim_component(equation33.$$.fragment, p2_nodes);
    			t116 = claim_text(p2_nodes, " since these\r\n            functions have a range of [-1, 1]: the angle of the line is used as the\r\n            input to these functions, sin yields the y value of the point that the\r\n            line falls on while cos produces the x value. The tan function produces\r\n            the length of the tangent line of the point on the circle from itself\r\n            to the x axis.");
    			p2_nodes.forEach(detach);
    			t117 = claim_space(div8_nodes);
    			claim_component(graph5.$$.fragment, div8_nodes);
    			t118 = claim_space(div8_nodes);
    			br6 = claim_element(div8_nodes, "BR", {});
    			t119 = claim_space(div8_nodes);
    			p3 = claim_element(div8_nodes, "P", {});
    			var p3_nodes = children(p3);
    			t120 = claim_text(p3_nodes, "As seen on the graph above, a triangle is formed out of the line\r\n            described above, which is the hypotenuse, along with the lines\r\n            created by the values of cos and sin. Hence, these trig functions\r\n            can be used to solve for the side length and angles of a right\r\n            triangle. For triangles with a hypotenuse greater than 1, we look\r\n            back to the above definition of these functions and see that ");
    			claim_component(equation34.$$.fragment, p3_nodes);
    			t121 = claim_text(p3_nodes, " and ");
    			claim_component(equation35.$$.fragment, p3_nodes);
    			t122 = claim_text(p3_nodes, ". We also see that they must\r\n            be in the range [-1, 1]. For triangles with hypotenuse greater than\r\n            1, it is very likely that these side lengths will be greater than 1\r\n            which would break this definition. To solve this we can normalize\r\n            the x and y values by dividing them by the hypotenuse, gauranteein\r\n            that they will be in the range [0, 1]. Therefore we can say ");
    			claim_component(equation36.$$.fragment, p3_nodes);
    			t123 = claim_text(p3_nodes, " and ");
    			claim_component(equation37.$$.fragment, p3_nodes);
    			t124 = claim_text(p3_nodes, ". Tangent can be defined as ");
    			claim_component(equation38.$$.fragment, p3_nodes);
    			t125 = claim_text(p3_nodes, " or\r\n            ");
    			claim_component(equation39.$$.fragment, p3_nodes);
    			t126 = claim_text(p3_nodes, ".");
    			p3_nodes.forEach(detach);
    			t127 = claim_space(div8_nodes);
    			h43 = claim_element(div8_nodes, "H4", { class: true });
    			var h43_nodes = children(h43);
    			t128 = claim_text(h43_nodes, "Examples");
    			h43_nodes.forEach(detach);
    			t129 = claim_space(div8_nodes);
    			p4 = claim_element(div8_nodes, "P", {});
    			var p4_nodes = children(p4);
    			t130 = claim_text(p4_nodes, "Given a triangle has an angle of ");
    			claim_component(equation40.$$.fragment, p4_nodes);
    			t131 = claim_text(p4_nodes, " with a hypotenuse of 8, find the opposite side of the angle:\r\n            ");
    			br7 = claim_element(p4_nodes, "BR", {});
    			t132 = claim_space(p4_nodes);
    			claim_component(equation41.$$.fragment, p4_nodes);
    			t133 = claim_space(p4_nodes);
    			br8 = claim_element(p4_nodes, "BR", {});
    			t134 = claim_space(p4_nodes);
    			claim_component(equation42.$$.fragment, p4_nodes);
    			t135 = claim_space(p4_nodes);
    			br9 = claim_element(p4_nodes, "BR", {});
    			t136 = claim_space(p4_nodes);
    			claim_component(equation43.$$.fragment, p4_nodes);
    			t137 = claim_space(p4_nodes);
    			br10 = claim_element(p4_nodes, "BR", {});
    			t138 = claim_space(p4_nodes);
    			claim_component(equation44.$$.fragment, p4_nodes);
    			t139 = claim_space(p4_nodes);
    			br11 = claim_element(p4_nodes, "BR", {});
    			t140 = claim_space(p4_nodes);
    			claim_component(equation45.$$.fragment, p4_nodes);
    			t141 = claim_space(p4_nodes);
    			br12 = claim_element(p4_nodes, "BR", {});
    			t142 = claim_space(p4_nodes);
    			br13 = claim_element(p4_nodes, "BR", {});
    			t143 = claim_space(p4_nodes);
    			br14 = claim_element(p4_nodes, "BR", {});
    			t144 = claim_text(p4_nodes, "\r\n            A triangle has an opposite side length of 50 and an adjacent side length\r\n            of 37. Find the angle ");
    			claim_component(equation46.$$.fragment, p4_nodes);
    			t145 = claim_text(p4_nodes, ":\r\n            ");
    			br15 = claim_element(p4_nodes, "BR", {});
    			t146 = claim_space(p4_nodes);
    			claim_component(equation47.$$.fragment, p4_nodes);
    			t147 = claim_space(p4_nodes);
    			br16 = claim_element(p4_nodes, "BR", {});
    			t148 = claim_space(p4_nodes);
    			claim_component(equation48.$$.fragment, p4_nodes);
    			t149 = claim_space(p4_nodes);
    			br17 = claim_element(p4_nodes, "BR", {});
    			t150 = claim_space(p4_nodes);
    			claim_component(equation49.$$.fragment, p4_nodes);
    			t151 = claim_space(p4_nodes);
    			br18 = claim_element(p4_nodes, "BR", {});
    			t152 = claim_space(p4_nodes);
    			claim_component(equation50.$$.fragment, p4_nodes);
    			t153 = claim_space(p4_nodes);
    			br19 = claim_element(p4_nodes, "BR", {});
    			t154 = claim_space(p4_nodes);
    			br20 = claim_element(p4_nodes, "BR", {});
    			t155 = claim_space(p4_nodes);
    			br21 = claim_element(p4_nodes, "BR", {});
    			t156 = claim_space(p4_nodes);
    			br22 = claim_element(p4_nodes, "BR", {});
    			p4_nodes.forEach(detach);
    			t157 = claim_space(div8_nodes);
    			h21 = claim_element(div8_nodes, "H2", { id: true, class: true });
    			var h21_nodes = children(h21);
    			t158 = claim_text(h21_nodes, "Exponential Functions");
    			h21_nodes.forEach(detach);
    			t159 = claim_space(div8_nodes);
    			p5 = claim_element(div8_nodes, "P", {});
    			var p5_nodes = children(p5);
    			t160 = claim_text(p5_nodes, "Exponential functions are those that include a variable in the\r\n            exponent. They generally take the form:\r\n            ");
    			br23 = claim_element(p5_nodes, "BR", {});
    			t161 = claim_space(p5_nodes);
    			claim_component(equation51.$$.fragment, p5_nodes);
    			t162 = claim_space(p5_nodes);
    			br24 = claim_element(p5_nodes, "BR", {});
    			t163 = claim_text(p5_nodes, "\r\n            Where b (the base) is a constant and ");
    			claim_component(equation52.$$.fragment, p5_nodes);
    			t164 = claim_text(p5_nodes, " and ");
    			claim_component(equation53.$$.fragment, p5_nodes);
    			t165 = claim_text(p5_nodes, ".");
    			p5_nodes.forEach(detach);
    			t166 = claim_space(div8_nodes);
    			h44 = claim_element(div8_nodes, "H4", { class: true });
    			var h44_nodes = children(h44);
    			t167 = claim_text(h44_nodes, "Graphs");
    			h44_nodes.forEach(detach);
    			t168 = claim_space(div8_nodes);
    			div6 = claim_element(div8_nodes, "DIV", { class: true });
    			var div6_nodes = children(div6);
    			claim_component(graph6.$$.fragment, div6_nodes);
    			t169 = claim_space(div6_nodes);
    			claim_component(graph7.$$.fragment, div6_nodes);
    			t170 = claim_space(div6_nodes);
    			claim_component(graph8.$$.fragment, div6_nodes);
    			t171 = claim_space(div6_nodes);
    			claim_component(graph9.$$.fragment, div6_nodes);
    			t172 = claim_space(div6_nodes);
    			claim_component(graph10.$$.fragment, div6_nodes);
    			div6_nodes.forEach(detach);
    			t173 = claim_space(div8_nodes);
    			h45 = claim_element(div8_nodes, "H4", { class: true });
    			var h45_nodes = children(h45);
    			t174 = claim_text(h45_nodes, "Exponent Rules");
    			h45_nodes.forEach(detach);
    			t175 = claim_space(div8_nodes);
    			table2 = claim_element(div8_nodes, "TABLE", { class: true });
    			var table2_nodes = children(table2);
    			tr10 = claim_element(table2_nodes, "TR", {});
    			var tr10_nodes = children(tr10);
    			td48 = claim_element(tr10_nodes, "TD", { class: true });
    			var td48_nodes = children(td48);
    			t176 = claim_text(td48_nodes, "Product Rule");
    			td48_nodes.forEach(detach);
    			t177 = claim_space(tr10_nodes);
    			td49 = claim_element(tr10_nodes, "TD", { class: true });
    			var td49_nodes = children(td49);
    			claim_component(equation54.$$.fragment, td49_nodes);
    			td49_nodes.forEach(detach);
    			tr10_nodes.forEach(detach);
    			t178 = claim_space(table2_nodes);
    			tr11 = claim_element(table2_nodes, "TR", {});
    			var tr11_nodes = children(tr11);
    			td50 = claim_element(tr11_nodes, "TD", { class: true });
    			var td50_nodes = children(td50);
    			t179 = claim_text(td50_nodes, "Quotient Rule");
    			td50_nodes.forEach(detach);
    			t180 = claim_space(tr11_nodes);
    			td51 = claim_element(tr11_nodes, "TD", { class: true });
    			var td51_nodes = children(td51);
    			claim_component(equation55.$$.fragment, td51_nodes);
    			td51_nodes.forEach(detach);
    			tr11_nodes.forEach(detach);
    			t181 = claim_space(table2_nodes);
    			tr12 = claim_element(table2_nodes, "TR", {});
    			var tr12_nodes = children(tr12);
    			td52 = claim_element(tr12_nodes, "TD", { class: true });
    			var td52_nodes = children(td52);
    			t182 = claim_text(td52_nodes, "Power Rule");
    			td52_nodes.forEach(detach);
    			t183 = claim_space(tr12_nodes);
    			td53 = claim_element(tr12_nodes, "TD", { class: true });
    			var td53_nodes = children(td53);
    			claim_component(equation56.$$.fragment, td53_nodes);
    			td53_nodes.forEach(detach);
    			tr12_nodes.forEach(detach);
    			t184 = claim_space(table2_nodes);
    			tr13 = claim_element(table2_nodes, "TR", {});
    			var tr13_nodes = children(tr13);
    			td54 = claim_element(tr13_nodes, "TD", { class: true });
    			var td54_nodes = children(td54);
    			t185 = claim_text(td54_nodes, "Power of Product Rule");
    			td54_nodes.forEach(detach);
    			t186 = claim_space(tr13_nodes);
    			td55 = claim_element(tr13_nodes, "TD", { class: true });
    			var td55_nodes = children(td55);
    			claim_component(equation57.$$.fragment, td55_nodes);
    			td55_nodes.forEach(detach);
    			tr13_nodes.forEach(detach);
    			t187 = claim_space(table2_nodes);
    			tr14 = claim_element(table2_nodes, "TR", {});
    			var tr14_nodes = children(tr14);
    			td56 = claim_element(tr14_nodes, "TD", { class: true });
    			var td56_nodes = children(td56);
    			t188 = claim_text(td56_nodes, "Power of Quotient Rule");
    			td56_nodes.forEach(detach);
    			t189 = claim_space(tr14_nodes);
    			td57 = claim_element(tr14_nodes, "TD", { class: true });
    			var td57_nodes = children(td57);
    			claim_component(equation58.$$.fragment, td57_nodes);
    			td57_nodes.forEach(detach);
    			tr14_nodes.forEach(detach);
    			t190 = claim_space(table2_nodes);
    			tr15 = claim_element(table2_nodes, "TR", {});
    			var tr15_nodes = children(tr15);
    			td58 = claim_element(tr15_nodes, "TD", { class: true });
    			var td58_nodes = children(td58);
    			t191 = claim_text(td58_nodes, "Exponent of 0");
    			td58_nodes.forEach(detach);
    			t192 = claim_space(tr15_nodes);
    			td59 = claim_element(tr15_nodes, "TD", { class: true });
    			var td59_nodes = children(td59);
    			claim_component(equation59.$$.fragment, td59_nodes);
    			td59_nodes.forEach(detach);
    			tr15_nodes.forEach(detach);
    			t193 = claim_space(table2_nodes);
    			tr16 = claim_element(table2_nodes, "TR", {});
    			var tr16_nodes = children(tr16);
    			td60 = claim_element(tr16_nodes, "TD", { class: true });
    			var td60_nodes = children(td60);
    			t194 = claim_text(td60_nodes, "Negative Exponent");
    			td60_nodes.forEach(detach);
    			t195 = claim_space(tr16_nodes);
    			td61 = claim_element(tr16_nodes, "TD", { class: true });
    			var td61_nodes = children(td61);
    			claim_component(equation60.$$.fragment, td61_nodes);
    			td61_nodes.forEach(detach);
    			tr16_nodes.forEach(detach);
    			t196 = claim_space(table2_nodes);
    			tr17 = claim_element(table2_nodes, "TR", {});
    			var tr17_nodes = children(tr17);
    			td62 = claim_element(tr17_nodes, "TD", { class: true });
    			var td62_nodes = children(td62);
    			t197 = claim_text(td62_nodes, "Fractional Exponent");
    			td62_nodes.forEach(detach);
    			t198 = claim_space(tr17_nodes);
    			td63 = claim_element(tr17_nodes, "TD", { class: true });
    			var td63_nodes = children(td63);
    			claim_component(equation61.$$.fragment, td63_nodes);
    			td63_nodes.forEach(detach);
    			tr17_nodes.forEach(detach);
    			table2_nodes.forEach(detach);
    			t199 = claim_space(div8_nodes);
    			br25 = claim_element(div8_nodes, "BR", {});
    			t200 = claim_space(div8_nodes);
    			br26 = claim_element(div8_nodes, "BR", {});
    			t201 = claim_space(div8_nodes);
    			h22 = claim_element(div8_nodes, "H2", { id: true, class: true });
    			var h22_nodes = children(h22);
    			t202 = claim_text(h22_nodes, "Logarithmic Functions");
    			h22_nodes.forEach(detach);
    			t203 = claim_space(div8_nodes);
    			p6 = claim_element(div8_nodes, "P", {});
    			var p6_nodes = children(p6);
    			t204 = claim_text(p6_nodes, "Logarithmic functions are the inverse functions of exponential\r\n            functions. Therefore, if ");
    			claim_component(equation62.$$.fragment, p6_nodes);
    			t205 = claim_text(p6_nodes, ", then ");
    			claim_component(equation63.$$.fragment, p6_nodes);
    			t206 = claim_text(p6_nodes, " where ");
    			claim_component(equation64.$$.fragment, p6_nodes);
    			t207 = claim_text(p6_nodes, ". The logarithm with base ");
    			claim_component(equation65.$$.fragment, p6_nodes);
    			t208 = claim_text(p6_nodes, " has a special name of natural log: ");
    			claim_component(equation66.$$.fragment, p6_nodes);
    			p6_nodes.forEach(detach);
    			t209 = claim_space(div8_nodes);
    			h46 = claim_element(div8_nodes, "H4", { class: true });
    			var h46_nodes = children(h46);
    			t210 = claim_text(h46_nodes, "Graphs");
    			h46_nodes.forEach(detach);
    			t211 = claim_space(div8_nodes);
    			div7 = claim_element(div8_nodes, "DIV", { class: true });
    			var div7_nodes = children(div7);
    			claim_component(graph11.$$.fragment, div7_nodes);
    			t212 = claim_space(div7_nodes);
    			claim_component(graph12.$$.fragment, div7_nodes);
    			t213 = claim_space(div7_nodes);
    			claim_component(graph13.$$.fragment, div7_nodes);
    			div7_nodes.forEach(detach);
    			t214 = claim_space(div8_nodes);
    			h47 = claim_element(div8_nodes, "H4", { class: true });
    			var h47_nodes = children(h47);
    			t215 = claim_text(h47_nodes, "Log Rules");
    			h47_nodes.forEach(detach);
    			t216 = claim_space(div8_nodes);
    			table3 = claim_element(div8_nodes, "TABLE", { class: true });
    			var table3_nodes = children(table3);
    			tr18 = claim_element(table3_nodes, "TR", {});
    			var tr18_nodes = children(tr18);
    			td64 = claim_element(tr18_nodes, "TD", { class: true });
    			var td64_nodes = children(td64);
    			t217 = claim_text(td64_nodes, "Product Rule");
    			td64_nodes.forEach(detach);
    			t218 = claim_space(tr18_nodes);
    			td65 = claim_element(tr18_nodes, "TD", { class: true });
    			var td65_nodes = children(td65);
    			claim_component(equation67.$$.fragment, td65_nodes);
    			td65_nodes.forEach(detach);
    			tr18_nodes.forEach(detach);
    			t219 = claim_space(table3_nodes);
    			tr19 = claim_element(table3_nodes, "TR", {});
    			var tr19_nodes = children(tr19);
    			td66 = claim_element(tr19_nodes, "TD", { class: true });
    			var td66_nodes = children(td66);
    			t220 = claim_text(td66_nodes, "Quotient Rule");
    			td66_nodes.forEach(detach);
    			t221 = claim_space(tr19_nodes);
    			td67 = claim_element(tr19_nodes, "TD", { class: true });
    			var td67_nodes = children(td67);
    			claim_component(equation68.$$.fragment, td67_nodes);
    			td67_nodes.forEach(detach);
    			tr19_nodes.forEach(detach);
    			t222 = claim_space(table3_nodes);
    			tr20 = claim_element(table3_nodes, "TR", {});
    			var tr20_nodes = children(tr20);
    			td68 = claim_element(tr20_nodes, "TD", { class: true });
    			var td68_nodes = children(td68);
    			t223 = claim_text(td68_nodes, "Power Rule");
    			td68_nodes.forEach(detach);
    			t224 = claim_space(tr20_nodes);
    			td69 = claim_element(tr20_nodes, "TD", { class: true });
    			var td69_nodes = children(td69);
    			claim_component(equation69.$$.fragment, td69_nodes);
    			td69_nodes.forEach(detach);
    			tr20_nodes.forEach(detach);
    			t225 = claim_space(table3_nodes);
    			tr21 = claim_element(table3_nodes, "TR", {});
    			var tr21_nodes = children(tr21);
    			td70 = claim_element(tr21_nodes, "TD", { class: true });
    			var td70_nodes = children(td70);
    			t226 = claim_text(td70_nodes, "Change of Base Rule");
    			td70_nodes.forEach(detach);
    			t227 = claim_space(tr21_nodes);
    			td71 = claim_element(tr21_nodes, "TD", { class: true });
    			var td71_nodes = children(td71);
    			claim_component(equation70.$$.fragment, td71_nodes);
    			td71_nodes.forEach(detach);
    			tr21_nodes.forEach(detach);
    			t228 = claim_space(table3_nodes);
    			tr22 = claim_element(table3_nodes, "TR", {});
    			var tr22_nodes = children(tr22);
    			td72 = claim_element(tr22_nodes, "TD", { class: true });
    			var td72_nodes = children(td72);
    			t229 = claim_text(td72_nodes, "Equality Rule");
    			td72_nodes.forEach(detach);
    			t230 = claim_space(tr22_nodes);
    			td73 = claim_element(tr22_nodes, "TD", { class: true });
    			var td73_nodes = children(td73);
    			claim_component(equation71.$$.fragment, td73_nodes);
    			td73_nodes.forEach(detach);
    			tr22_nodes.forEach(detach);
    			t231 = claim_space(table3_nodes);
    			tr23 = claim_element(table3_nodes, "TR", {});
    			var tr23_nodes = children(tr23);
    			td74 = claim_element(tr23_nodes, "TD", { class: true });
    			var td74_nodes = children(td74);
    			t232 = claim_text(td74_nodes, "Log of 1");
    			td74_nodes.forEach(detach);
    			t233 = claim_space(tr23_nodes);
    			td75 = claim_element(tr23_nodes, "TD", { class: true });
    			var td75_nodes = children(td75);
    			claim_component(equation72.$$.fragment, td75_nodes);
    			td75_nodes.forEach(detach);
    			tr23_nodes.forEach(detach);
    			table3_nodes.forEach(detach);
    			t234 = claim_space(div8_nodes);
    			br27 = claim_element(div8_nodes, "BR", {});
    			t235 = claim_space(div8_nodes);
    			br28 = claim_element(div8_nodes, "BR", {});
    			t236 = claim_space(div8_nodes);
    			h23 = claim_element(div8_nodes, "H2", { id: true, class: true });
    			var h23_nodes = children(h23);
    			t237 = claim_text(h23_nodes, "Combinations of Functions");
    			h23_nodes.forEach(detach);
    			t238 = claim_space(div8_nodes);
    			p7 = claim_element(div8_nodes, "P", {});
    			var p7_nodes = children(p7);
    			t239 = claim_text(p7_nodes, "Functions can be added, subtracted, multiplied, and divided much\r\n            like regular numbers. The basic forms of this for functions ");
    			claim_component(equation73.$$.fragment, p7_nodes);
    			t240 = claim_text(p7_nodes, " and ");
    			claim_component(equation74.$$.fragment, p7_nodes);
    			t241 = claim_text(p7_nodes, " are:");
    			p7_nodes.forEach(detach);
    			t242 = claim_space(div8_nodes);
    			br29 = claim_element(div8_nodes, "BR", {});
    			t243 = claim_space(div8_nodes);
    			table4 = claim_element(div8_nodes, "TABLE", { class: true });
    			var table4_nodes = children(table4);
    			tr24 = claim_element(table4_nodes, "TR", {});
    			var tr24_nodes = children(tr24);
    			td76 = claim_element(tr24_nodes, "TD", { class: true });
    			var td76_nodes = children(td76);
    			t244 = claim_text(td76_nodes, "Addition");
    			td76_nodes.forEach(detach);
    			t245 = claim_space(tr24_nodes);
    			td77 = claim_element(tr24_nodes, "TD", { class: true });
    			var td77_nodes = children(td77);
    			claim_component(equation75.$$.fragment, td77_nodes);
    			td77_nodes.forEach(detach);
    			tr24_nodes.forEach(detach);
    			t246 = claim_space(table4_nodes);
    			tr25 = claim_element(table4_nodes, "TR", {});
    			var tr25_nodes = children(tr25);
    			td78 = claim_element(tr25_nodes, "TD", { class: true });
    			var td78_nodes = children(td78);
    			t247 = claim_text(td78_nodes, "Subtraction");
    			td78_nodes.forEach(detach);
    			t248 = claim_space(tr25_nodes);
    			td79 = claim_element(tr25_nodes, "TD", { class: true });
    			var td79_nodes = children(td79);
    			claim_component(equation76.$$.fragment, td79_nodes);
    			td79_nodes.forEach(detach);
    			tr25_nodes.forEach(detach);
    			t249 = claim_space(table4_nodes);
    			tr26 = claim_element(table4_nodes, "TR", {});
    			var tr26_nodes = children(tr26);
    			td80 = claim_element(tr26_nodes, "TD", { class: true });
    			var td80_nodes = children(td80);
    			t250 = claim_text(td80_nodes, "Multiplication");
    			td80_nodes.forEach(detach);
    			t251 = claim_space(tr26_nodes);
    			td81 = claim_element(tr26_nodes, "TD", { class: true });
    			var td81_nodes = children(td81);
    			claim_component(equation77.$$.fragment, td81_nodes);
    			td81_nodes.forEach(detach);
    			tr26_nodes.forEach(detach);
    			t252 = claim_space(table4_nodes);
    			tr27 = claim_element(table4_nodes, "TR", {});
    			var tr27_nodes = children(tr27);
    			td82 = claim_element(tr27_nodes, "TD", { class: true });
    			var td82_nodes = children(td82);
    			t253 = claim_text(td82_nodes, "Division");
    			td82_nodes.forEach(detach);
    			t254 = claim_space(tr27_nodes);
    			td83 = claim_element(tr27_nodes, "TD", { class: true });
    			var td83_nodes = children(td83);
    			claim_component(equation78.$$.fragment, td83_nodes);
    			t255 = claim_text(td83_nodes, "\r\n                    where ");
    			claim_component(equation79.$$.fragment, td83_nodes);
    			td83_nodes.forEach(detach);
    			tr27_nodes.forEach(detach);
    			table4_nodes.forEach(detach);
    			t256 = claim_space(div8_nodes);
    			p8 = claim_element(div8_nodes, "P", {});
    			var p8_nodes = children(p8);
    			t257 = claim_text(p8_nodes, "The domain of the new combined function includes all the points for\r\n            which the all the functions used to compose it are defined at that\r\n            point.");
    			p8_nodes.forEach(detach);
    			t258 = claim_space(div8_nodes);
    			h48 = claim_element(div8_nodes, "H4", { class: true });
    			var h48_nodes = children(h48);
    			t259 = claim_text(h48_nodes, "Composition");
    			h48_nodes.forEach(detach);
    			t260 = claim_space(div8_nodes);
    			p9 = claim_element(div8_nodes, "P", {});
    			var p9_nodes = children(p9);
    			t261 = claim_text(p9_nodes, "Composition is slightly different as it is the process of plugging\r\n            one function into another:\r\n            ");
    			br30 = claim_element(p9_nodes, "BR", {});
    			t262 = claim_space(p9_nodes);
    			claim_component(equation80.$$.fragment, p9_nodes);
    			t263 = claim_space(p9_nodes);
    			br31 = claim_element(p9_nodes, "BR", {});
    			t264 = claim_space(p9_nodes);
    			br32 = claim_element(p9_nodes, "BR", {});
    			t265 = claim_text(p9_nodes, "\r\n            Here f is said to be composed of g of x. Functions are evaluated from\r\n            the inside out and is not cumulative.\r\n            ");
    			br33 = claim_element(p9_nodes, "BR", {});
    			t266 = claim_text(p9_nodes, "\r\n            The domain of a composed function is values of x that are in the domain\r\n            of the inner function(s) that are in the domain of the outer.");
    			p9_nodes.forEach(detach);
    			t267 = claim_space(div8_nodes);
    			h49 = claim_element(div8_nodes, "H4", { class: true });
    			var h49_nodes = children(h49);
    			t268 = claim_text(h49_nodes, "Examples");
    			h49_nodes.forEach(detach);
    			t269 = claim_text(div8_nodes, "\r\n        Using ");
    			claim_component(equation81.$$.fragment, div8_nodes);
    			t270 = claim_text(div8_nodes, " and ");
    			claim_component(equation82.$$.fragment, div8_nodes);
    			t271 = claim_text(div8_nodes, ":\r\n        ");
    			br34 = claim_element(div8_nodes, "BR", {});
    			t272 = claim_space(div8_nodes);
    			ul = claim_element(div8_nodes, "UL", { class: true });
    			var ul_nodes = children(ul);
    			li0 = claim_element(ul_nodes, "LI", {});
    			var li0_nodes = children(li0);
    			t273 = claim_text(li0_nodes, "Adding:\r\n                ");
    			br35 = claim_element(li0_nodes, "BR", {});
    			t274 = claim_space(li0_nodes);
    			claim_component(equation83.$$.fragment, li0_nodes);
    			t275 = claim_space(li0_nodes);
    			br36 = claim_element(li0_nodes, "BR", {});
    			t276 = claim_space(li0_nodes);
    			claim_component(equation84.$$.fragment, li0_nodes);
    			t277 = claim_space(li0_nodes);
    			br37 = claim_element(li0_nodes, "BR", {});
    			t278 = claim_space(li0_nodes);
    			claim_component(equation85.$$.fragment, li0_nodes);
    			t279 = claim_space(li0_nodes);
    			br38 = claim_element(li0_nodes, "BR", {});
    			t280 = claim_space(li0_nodes);
    			claim_component(equation86.$$.fragment, li0_nodes);
    			t281 = claim_space(li0_nodes);
    			br39 = claim_element(li0_nodes, "BR", {});
    			t282 = claim_space(li0_nodes);
    			claim_component(equation87.$$.fragment, li0_nodes);
    			li0_nodes.forEach(detach);
    			t283 = claim_space(ul_nodes);
    			br40 = claim_element(ul_nodes, "BR", {});
    			t284 = claim_space(ul_nodes);
    			li1 = claim_element(ul_nodes, "LI", {});
    			var li1_nodes = children(li1);
    			t285 = claim_text(li1_nodes, "Subtracting:\r\n                ");
    			br41 = claim_element(li1_nodes, "BR", {});
    			t286 = claim_space(li1_nodes);
    			claim_component(equation88.$$.fragment, li1_nodes);
    			t287 = claim_space(li1_nodes);
    			br42 = claim_element(li1_nodes, "BR", {});
    			t288 = claim_space(li1_nodes);
    			claim_component(equation89.$$.fragment, li1_nodes);
    			t289 = claim_space(li1_nodes);
    			br43 = claim_element(li1_nodes, "BR", {});
    			t290 = claim_space(li1_nodes);
    			claim_component(equation90.$$.fragment, li1_nodes);
    			t291 = claim_space(li1_nodes);
    			br44 = claim_element(li1_nodes, "BR", {});
    			t292 = claim_space(li1_nodes);
    			claim_component(equation91.$$.fragment, li1_nodes);
    			t293 = claim_space(li1_nodes);
    			br45 = claim_element(li1_nodes, "BR", {});
    			t294 = claim_space(li1_nodes);
    			claim_component(equation92.$$.fragment, li1_nodes);
    			li1_nodes.forEach(detach);
    			t295 = claim_space(ul_nodes);
    			br46 = claim_element(ul_nodes, "BR", {});
    			t296 = claim_space(ul_nodes);
    			li2 = claim_element(ul_nodes, "LI", {});
    			var li2_nodes = children(li2);
    			t297 = claim_text(li2_nodes, "Multiplying:\r\n                ");
    			br47 = claim_element(li2_nodes, "BR", {});
    			t298 = claim_space(li2_nodes);
    			claim_component(equation93.$$.fragment, li2_nodes);
    			t299 = claim_space(li2_nodes);
    			br48 = claim_element(li2_nodes, "BR", {});
    			t300 = claim_space(li2_nodes);
    			claim_component(equation94.$$.fragment, li2_nodes);
    			t301 = claim_space(li2_nodes);
    			br49 = claim_element(li2_nodes, "BR", {});
    			t302 = claim_space(li2_nodes);
    			claim_component(equation95.$$.fragment, li2_nodes);
    			t303 = claim_space(li2_nodes);
    			br50 = claim_element(li2_nodes, "BR", {});
    			t304 = claim_space(li2_nodes);
    			claim_component(equation96.$$.fragment, li2_nodes);
    			t305 = claim_space(li2_nodes);
    			br51 = claim_element(li2_nodes, "BR", {});
    			t306 = claim_space(li2_nodes);
    			claim_component(equation97.$$.fragment, li2_nodes);
    			li2_nodes.forEach(detach);
    			t307 = claim_space(ul_nodes);
    			br52 = claim_element(ul_nodes, "BR", {});
    			t308 = claim_space(ul_nodes);
    			li3 = claim_element(ul_nodes, "LI", {});
    			var li3_nodes = children(li3);
    			t309 = claim_text(li3_nodes, "Dividing:\r\n                ");
    			br53 = claim_element(li3_nodes, "BR", {});
    			t310 = claim_space(li3_nodes);
    			claim_component(equation98.$$.fragment, li3_nodes);
    			t311 = claim_space(li3_nodes);
    			br54 = claim_element(li3_nodes, "BR", {});
    			t312 = claim_space(li3_nodes);
    			claim_component(equation99.$$.fragment, li3_nodes);
    			t313 = claim_space(li3_nodes);
    			br55 = claim_element(li3_nodes, "BR", {});
    			t314 = claim_space(li3_nodes);
    			claim_component(equation100.$$.fragment, li3_nodes);
    			li3_nodes.forEach(detach);
    			t315 = claim_space(ul_nodes);
    			br56 = claim_element(ul_nodes, "BR", {});
    			t316 = claim_space(ul_nodes);
    			li4 = claim_element(ul_nodes, "LI", {});
    			var li4_nodes = children(li4);
    			t317 = claim_text(li4_nodes, "Composing:\r\n                ");
    			br57 = claim_element(li4_nodes, "BR", {});
    			t318 = claim_space(li4_nodes);
    			claim_component(equation101.$$.fragment, li4_nodes);
    			t319 = claim_space(li4_nodes);
    			br58 = claim_element(li4_nodes, "BR", {});
    			t320 = claim_space(li4_nodes);
    			claim_component(equation102.$$.fragment, li4_nodes);
    			t321 = claim_space(li4_nodes);
    			br59 = claim_element(li4_nodes, "BR", {});
    			t322 = claim_space(li4_nodes);
    			claim_component(equation103.$$.fragment, li4_nodes);
    			t323 = claim_space(li4_nodes);
    			br60 = claim_element(li4_nodes, "BR", {});
    			t324 = claim_space(li4_nodes);
    			claim_component(equation104.$$.fragment, li4_nodes);
    			li4_nodes.forEach(detach);
    			ul_nodes.forEach(detach);
    			t325 = claim_text(div8_nodes, "\r\n        Compose ");
    			claim_component(equation105.$$.fragment, div8_nodes);
    			t326 = claim_text(div8_nodes, " and ");
    			claim_component(equation106.$$.fragment, div8_nodes);
    			t327 = claim_text(div8_nodes, ":\r\n        ");
    			br61 = claim_element(div8_nodes, "BR", {});
    			t328 = claim_space(div8_nodes);
    			claim_component(equation107.$$.fragment, div8_nodes);
    			t329 = claim_space(div8_nodes);
    			br62 = claim_element(div8_nodes, "BR", {});
    			t330 = claim_space(div8_nodes);
    			claim_component(equation108.$$.fragment, div8_nodes);
    			t331 = claim_space(div8_nodes);
    			br63 = claim_element(div8_nodes, "BR", {});
    			t332 = claim_space(div8_nodes);
    			claim_component(equation109.$$.fragment, div8_nodes);
    			t333 = claim_space(div8_nodes);
    			br64 = claim_element(div8_nodes, "BR", {});
    			t334 = claim_space(div8_nodes);
    			br65 = claim_element(div8_nodes, "BR", {});
    			t335 = claim_text(div8_nodes, "\r\n        No values of x satisfy this equation because no values of ");
    			claim_component(equation110.$$.fragment, div8_nodes);
    			t336 = claim_text(div8_nodes, " are defined in ");
    			claim_component(equation111.$$.fragment, div8_nodes);
    			t337 = claim_text(div8_nodes, " i.e. ");
    			claim_component(equation112.$$.fragment, div8_nodes);
    			t338 = claim_text(div8_nodes, " will\r\n        always produce a negative number for which the square root is not defined\r\n        for in the real plane.\r\n        ");
    			br66 = claim_element(div8_nodes, "BR", {});
    			t339 = claim_space(div8_nodes);
    			br67 = claim_element(div8_nodes, "BR", {});
    			t340 = claim_space(div8_nodes);
    			br68 = claim_element(div8_nodes, "BR", {});
    			t341 = claim_space(div8_nodes);
    			br69 = claim_element(div8_nodes, "BR", {});
    			t342 = claim_space(div8_nodes);
    			br70 = claim_element(div8_nodes, "BR", {});
    			t343 = claim_space(div8_nodes);
    			br71 = claim_element(div8_nodes, "BR", {});
    			div8_nodes.forEach(detach);
    			div9_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(h1, "class", "svelte-hickvj");
    			attr(h3, "class", "svelte-hickvj");
    			attr(div0, "class", div0_class_value = "" + (null_to_empty(/*hash*/ ctx[0] === "trig" ? "navselect" : "") + " svelte-hickvj"));
    			attr(div1, "class", div1_class_value = "" + (null_to_empty(/*hash*/ ctx[0] === "exp" ? "navselect" : "") + " svelte-hickvj"));
    			attr(div2, "class", div2_class_value = "" + (null_to_empty(/*hash*/ ctx[0] === "log" ? "navselect" : "") + " svelte-hickvj"));
    			attr(div3, "class", div3_class_value = "" + (null_to_empty(/*hash*/ ctx[0] === "comb" ? "navselect" : "") + " svelte-hickvj"));
    			attr(div4, "id", "sidenav");
    			attr(div4, "class", "svelte-hickvj");
    			attr(h20, "id", "trig");
    			attr(h20, "class", "scroll svelte-hickvj");
    			attr(td0, "class", "svelte-hickvj");
    			attr(td1, "class", "svelte-hickvj");
    			attr(td2, "class", "svelte-hickvj");
    			attr(td3, "class", "svelte-hickvj");
    			attr(td4, "class", "svelte-hickvj");
    			attr(td5, "class", "svelte-hickvj");
    			attr(table0, "class", "svelte-hickvj");
    			attr(h40, "class", "svelte-hickvj");
    			attr(th0, "class", "svelte-hickvj");
    			attr(th1, "class", "svelte-hickvj");
    			attr(th2, "class", "svelte-hickvj");
    			attr(th3, "class", "svelte-hickvj");
    			attr(th4, "class", "svelte-hickvj");
    			attr(th5, "class", "svelte-hickvj");
    			attr(th6, "class", "svelte-hickvj");
    			attr(td6, "class", "svelte-hickvj");
    			attr(td7, "class", "svelte-hickvj");
    			attr(td8, "class", "svelte-hickvj");
    			attr(td9, "class", "svelte-hickvj");
    			attr(td10, "class", "svelte-hickvj");
    			attr(td11, "class", "svelte-hickvj");
    			attr(td12, "class", "svelte-hickvj");
    			attr(td13, "class", "svelte-hickvj");
    			attr(td14, "class", "svelte-hickvj");
    			attr(td15, "class", "svelte-hickvj");
    			attr(td16, "class", "svelte-hickvj");
    			attr(td17, "class", "svelte-hickvj");
    			attr(td18, "class", "svelte-hickvj");
    			attr(td19, "class", "svelte-hickvj");
    			attr(td20, "class", "svelte-hickvj");
    			attr(td21, "class", "svelte-hickvj");
    			attr(td22, "class", "svelte-hickvj");
    			attr(td23, "class", "svelte-hickvj");
    			attr(td24, "class", "svelte-hickvj");
    			attr(td25, "class", "svelte-hickvj");
    			attr(td26, "class", "svelte-hickvj");
    			attr(td27, "class", "svelte-hickvj");
    			attr(td28, "class", "svelte-hickvj");
    			attr(td29, "class", "svelte-hickvj");
    			attr(td30, "class", "svelte-hickvj");
    			attr(td31, "class", "svelte-hickvj");
    			attr(td32, "class", "svelte-hickvj");
    			attr(td33, "class", "svelte-hickvj");
    			attr(td34, "class", "svelte-hickvj");
    			attr(td35, "class", "svelte-hickvj");
    			attr(td36, "class", "svelte-hickvj");
    			attr(td37, "class", "svelte-hickvj");
    			attr(td38, "class", "svelte-hickvj");
    			attr(td39, "class", "svelte-hickvj");
    			attr(td40, "class", "svelte-hickvj");
    			attr(td41, "class", "svelte-hickvj");
    			attr(td42, "class", "svelte-hickvj");
    			attr(td43, "class", "svelte-hickvj");
    			attr(td44, "class", "svelte-hickvj");
    			attr(td45, "class", "svelte-hickvj");
    			attr(td46, "class", "svelte-hickvj");
    			attr(td47, "class", "svelte-hickvj");
    			attr(table1, "class", "svelte-hickvj");
    			attr(h41, "class", "svelte-hickvj");
    			attr(div5, "class", "graphs svelte-hickvj");
    			attr(h42, "class", "svelte-hickvj");
    			attr(h43, "class", "svelte-hickvj");
    			attr(h21, "id", "exp");
    			attr(h21, "class", "scroll svelte-hickvj");
    			attr(h44, "class", "svelte-hickvj");
    			attr(div6, "class", "graphs svelte-hickvj");
    			attr(h45, "class", "svelte-hickvj");
    			attr(td48, "class", "svelte-hickvj");
    			attr(td49, "class", "svelte-hickvj");
    			attr(td50, "class", "svelte-hickvj");
    			attr(td51, "class", "svelte-hickvj");
    			attr(td52, "class", "svelte-hickvj");
    			attr(td53, "class", "svelte-hickvj");
    			attr(td54, "class", "svelte-hickvj");
    			attr(td55, "class", "svelte-hickvj");
    			attr(td56, "class", "svelte-hickvj");
    			attr(td57, "class", "svelte-hickvj");
    			attr(td58, "class", "svelte-hickvj");
    			attr(td59, "class", "svelte-hickvj");
    			attr(td60, "class", "svelte-hickvj");
    			attr(td61, "class", "svelte-hickvj");
    			attr(td62, "class", "svelte-hickvj");
    			attr(td63, "class", "svelte-hickvj");
    			attr(table2, "class", "svelte-hickvj");
    			attr(h22, "id", "log");
    			attr(h22, "class", "scroll svelte-hickvj");
    			attr(h46, "class", "svelte-hickvj");
    			attr(div7, "class", "graphs svelte-hickvj");
    			attr(h47, "class", "svelte-hickvj");
    			attr(td64, "class", "svelte-hickvj");
    			attr(td65, "class", "svelte-hickvj");
    			attr(td66, "class", "svelte-hickvj");
    			attr(td67, "class", "svelte-hickvj");
    			attr(td68, "class", "svelte-hickvj");
    			attr(td69, "class", "svelte-hickvj");
    			attr(td70, "class", "svelte-hickvj");
    			attr(td71, "class", "svelte-hickvj");
    			attr(td72, "class", "svelte-hickvj");
    			attr(td73, "class", "svelte-hickvj");
    			attr(td74, "class", "svelte-hickvj");
    			attr(td75, "class", "svelte-hickvj");
    			attr(table3, "class", "svelte-hickvj");
    			attr(h23, "id", "comb");
    			attr(h23, "class", "scroll svelte-hickvj");
    			attr(td76, "class", "svelte-hickvj");
    			attr(td77, "class", "svelte-hickvj");
    			attr(td78, "class", "svelte-hickvj");
    			attr(td79, "class", "svelte-hickvj");
    			attr(td80, "class", "svelte-hickvj");
    			attr(td81, "class", "svelte-hickvj");
    			attr(td82, "class", "svelte-hickvj");
    			attr(td83, "class", "svelte-hickvj");
    			attr(table4, "class", "svelte-hickvj");
    			attr(h48, "class", "svelte-hickvj");
    			attr(h49, "class", "svelte-hickvj");
    			attr(ul, "class", "svelte-hickvj");
    			attr(div8, "class", "main svelte-hickvj");
    			attr(div9, "class", "content");
    		},
    		m(target, anchor) {
    			insert_hydration(target, div9, anchor);
    			append_hydration(div9, h1);
    			append_hydration(h1, t0);
    			append_hydration(div9, t1);
    			append_hydration(div9, h3);
    			append_hydration(h3, t2);
    			append_hydration(div9, t3);
    			append_hydration(div9, div4);
    			append_hydration(div4, div0);
    			append_hydration(div0, t4);
    			append_hydration(div4, t5);
    			append_hydration(div4, div1);
    			append_hydration(div1, t6);
    			append_hydration(div4, t7);
    			append_hydration(div4, div2);
    			append_hydration(div2, t8);
    			append_hydration(div4, t9);
    			append_hydration(div4, div3);
    			append_hydration(div3, t10);
    			append_hydration(div9, t11);
    			append_hydration(div9, div8);
    			append_hydration(div8, h20);
    			append_hydration(h20, t12);
    			append_hydration(div8, t13);
    			append_hydration(div8, p0);
    			append_hydration(p0, t14);
    			append_hydration(p0, strong);
    			append_hydration(strong, t15);
    			append_hydration(p0, t16);
    			append_hydration(p0, br0);
    			append_hydration(p0, t17);
    			append_hydration(p0, br1);
    			append_hydration(div8, t18);
    			append_hydration(div8, table0);
    			append_hydration(table0, tr0);
    			append_hydration(tr0, td0);
    			mount_component(equation0, td0, null);
    			append_hydration(tr0, t19);
    			append_hydration(tr0, td1);
    			mount_component(equation1, td1, null);
    			append_hydration(table0, t20);
    			append_hydration(table0, tr1);
    			append_hydration(tr1, td2);
    			mount_component(equation2, td2, null);
    			append_hydration(tr1, t21);
    			append_hydration(tr1, td3);
    			mount_component(equation3, td3, null);
    			append_hydration(table0, t22);
    			append_hydration(table0, tr2);
    			append_hydration(tr2, td4);
    			mount_component(equation4, td4, null);
    			append_hydration(tr2, t23);
    			append_hydration(tr2, td5);
    			mount_component(equation5, td5, null);
    			append_hydration(div8, t24);
    			append_hydration(div8, p1);
    			append_hydration(p1, t25);
    			append_hydration(p1, br2);
    			append_hydration(p1, t26);
    			append_hydration(p1, br3);
    			append_hydration(p1, t27);
    			mount_component(equation6, p1, null);
    			append_hydration(p1, t28);
    			append_hydration(p1, br4);
    			append_hydration(p1, t29);
    			append_hydration(p1, br5);
    			append_hydration(p1, t30);
    			append_hydration(div8, t31);
    			append_hydration(div8, h40);
    			append_hydration(h40, t32);
    			append_hydration(div8, t33);
    			append_hydration(div8, table1);
    			append_hydration(table1, tr3);
    			append_hydration(tr3, th0);
    			mount_component(equation7, th0, null);
    			append_hydration(tr3, t34);
    			append_hydration(tr3, th1);
    			mount_component(equation8, th1, null);
    			append_hydration(tr3, t35);
    			append_hydration(tr3, th2);
    			mount_component(equation9, th2, null);
    			append_hydration(tr3, t36);
    			append_hydration(tr3, th3);
    			mount_component(equation10, th3, null);
    			append_hydration(tr3, t37);
    			append_hydration(tr3, th4);
    			mount_component(equation11, th4, null);
    			append_hydration(tr3, t38);
    			append_hydration(tr3, th5);
    			mount_component(equation12, th5, null);
    			append_hydration(tr3, t39);
    			append_hydration(tr3, th6);
    			mount_component(equation13, th6, null);
    			append_hydration(table1, t40);
    			append_hydration(table1, tr4);
    			append_hydration(tr4, td6);
    			append_hydration(td6, t41);
    			append_hydration(tr4, t42);
    			append_hydration(tr4, td7);
    			append_hydration(td7, t43);
    			append_hydration(tr4, t44);
    			append_hydration(tr4, td8);
    			append_hydration(td8, t45);
    			append_hydration(tr4, t46);
    			append_hydration(tr4, td9);
    			append_hydration(td9, t47);
    			append_hydration(tr4, t48);
    			append_hydration(tr4, td10);
    			append_hydration(td10, t49);
    			append_hydration(tr4, t50);
    			append_hydration(tr4, td11);
    			append_hydration(td11, t51);
    			append_hydration(tr4, t52);
    			append_hydration(tr4, td12);
    			append_hydration(td12, t53);
    			append_hydration(table1, t54);
    			append_hydration(table1, tr5);
    			append_hydration(tr5, td13);
    			mount_component(equation14, td13, null);
    			append_hydration(tr5, t55);
    			append_hydration(tr5, td14);
    			append_hydration(td14, t56);
    			append_hydration(tr5, t57);
    			append_hydration(tr5, td15);
    			append_hydration(td15, t58);
    			append_hydration(tr5, t59);
    			append_hydration(tr5, td16);
    			append_hydration(td16, t60);
    			append_hydration(tr5, t61);
    			append_hydration(tr5, td17);
    			append_hydration(td17, t62);
    			append_hydration(tr5, t63);
    			append_hydration(tr5, td18);
    			append_hydration(td18, t64);
    			append_hydration(tr5, t65);
    			append_hydration(tr5, td19);
    			append_hydration(td19, t66);
    			append_hydration(table1, t67);
    			append_hydration(table1, tr6);
    			append_hydration(tr6, td20);
    			mount_component(equation15, td20, null);
    			append_hydration(tr6, t68);
    			append_hydration(tr6, td21);
    			append_hydration(td21, t69);
    			append_hydration(tr6, t70);
    			append_hydration(tr6, td22);
    			append_hydration(td22, t71);
    			append_hydration(tr6, t72);
    			append_hydration(tr6, td23);
    			append_hydration(td23, t73);
    			append_hydration(tr6, t74);
    			append_hydration(tr6, td24);
    			append_hydration(td24, t75);
    			append_hydration(tr6, t76);
    			append_hydration(tr6, td25);
    			append_hydration(td25, t77);
    			append_hydration(tr6, t78);
    			append_hydration(tr6, td26);
    			append_hydration(td26, t79);
    			append_hydration(table1, t80);
    			append_hydration(table1, tr7);
    			append_hydration(tr7, td27);
    			mount_component(equation16, td27, null);
    			append_hydration(tr7, t81);
    			append_hydration(tr7, td28);
    			mount_component(equation17, td28, null);
    			append_hydration(tr7, t82);
    			append_hydration(tr7, td29);
    			mount_component(equation18, td29, null);
    			append_hydration(tr7, t83);
    			append_hydration(tr7, td30);
    			mount_component(equation19, td30, null);
    			append_hydration(tr7, t84);
    			append_hydration(tr7, td31);
    			mount_component(equation20, td31, null);
    			append_hydration(tr7, t85);
    			append_hydration(tr7, td32);
    			mount_component(equation21, td32, null);
    			append_hydration(tr7, t86);
    			append_hydration(tr7, td33);
    			append_hydration(td33, t87);
    			append_hydration(table1, t88);
    			append_hydration(table1, tr8);
    			append_hydration(tr8, td34);
    			mount_component(equation22, td34, null);
    			append_hydration(tr8, t89);
    			append_hydration(tr8, td35);
    			mount_component(equation23, td35, null);
    			append_hydration(tr8, t90);
    			append_hydration(tr8, td36);
    			mount_component(equation24, td36, null);
    			append_hydration(tr8, t91);
    			append_hydration(tr8, td37);
    			append_hydration(td37, t92);
    			append_hydration(tr8, t93);
    			append_hydration(tr8, td38);
    			append_hydration(td38, t94);
    			append_hydration(tr8, t95);
    			append_hydration(tr8, td39);
    			mount_component(equation25, td39, null);
    			append_hydration(tr8, t96);
    			append_hydration(tr8, td40);
    			mount_component(equation26, td40, null);
    			append_hydration(table1, t97);
    			append_hydration(table1, tr9);
    			append_hydration(tr9, td41);
    			mount_component(equation27, td41, null);
    			append_hydration(tr9, t98);
    			append_hydration(tr9, td42);
    			mount_component(equation28, td42, null);
    			append_hydration(tr9, t99);
    			append_hydration(tr9, td43);
    			mount_component(equation29, td43, null);
    			append_hydration(tr9, t100);
    			append_hydration(tr9, td44);
    			mount_component(equation30, td44, null);
    			append_hydration(tr9, t101);
    			append_hydration(tr9, td45);
    			mount_component(equation31, td45, null);
    			append_hydration(tr9, t102);
    			append_hydration(tr9, td46);
    			append_hydration(td46, t103);
    			append_hydration(tr9, t104);
    			append_hydration(tr9, td47);
    			mount_component(equation32, td47, null);
    			append_hydration(div8, t105);
    			append_hydration(div8, h41);
    			append_hydration(h41, t106);
    			append_hydration(div8, t107);
    			append_hydration(div8, div5);
    			mount_component(graph0, div5, null);
    			append_hydration(div5, t108);
    			mount_component(graph1, div5, null);
    			append_hydration(div5, t109);
    			mount_component(graph2, div5, null);
    			append_hydration(div5, t110);
    			mount_component(graph3, div5, null);
    			append_hydration(div5, t111);
    			mount_component(graph4, div5, null);
    			append_hydration(div8, t112);
    			append_hydration(div8, h42);
    			append_hydration(h42, t113);
    			append_hydration(div8, t114);
    			append_hydration(div8, p2);
    			append_hydration(p2, t115);
    			mount_component(equation33, p2, null);
    			append_hydration(p2, t116);
    			append_hydration(div8, t117);
    			mount_component(graph5, div8, null);
    			append_hydration(div8, t118);
    			append_hydration(div8, br6);
    			append_hydration(div8, t119);
    			append_hydration(div8, p3);
    			append_hydration(p3, t120);
    			mount_component(equation34, p3, null);
    			append_hydration(p3, t121);
    			mount_component(equation35, p3, null);
    			append_hydration(p3, t122);
    			mount_component(equation36, p3, null);
    			append_hydration(p3, t123);
    			mount_component(equation37, p3, null);
    			append_hydration(p3, t124);
    			mount_component(equation38, p3, null);
    			append_hydration(p3, t125);
    			mount_component(equation39, p3, null);
    			append_hydration(p3, t126);
    			append_hydration(div8, t127);
    			append_hydration(div8, h43);
    			append_hydration(h43, t128);
    			append_hydration(div8, t129);
    			append_hydration(div8, p4);
    			append_hydration(p4, t130);
    			mount_component(equation40, p4, null);
    			append_hydration(p4, t131);
    			append_hydration(p4, br7);
    			append_hydration(p4, t132);
    			mount_component(equation41, p4, null);
    			append_hydration(p4, t133);
    			append_hydration(p4, br8);
    			append_hydration(p4, t134);
    			mount_component(equation42, p4, null);
    			append_hydration(p4, t135);
    			append_hydration(p4, br9);
    			append_hydration(p4, t136);
    			mount_component(equation43, p4, null);
    			append_hydration(p4, t137);
    			append_hydration(p4, br10);
    			append_hydration(p4, t138);
    			mount_component(equation44, p4, null);
    			append_hydration(p4, t139);
    			append_hydration(p4, br11);
    			append_hydration(p4, t140);
    			mount_component(equation45, p4, null);
    			append_hydration(p4, t141);
    			append_hydration(p4, br12);
    			append_hydration(p4, t142);
    			append_hydration(p4, br13);
    			append_hydration(p4, t143);
    			append_hydration(p4, br14);
    			append_hydration(p4, t144);
    			mount_component(equation46, p4, null);
    			append_hydration(p4, t145);
    			append_hydration(p4, br15);
    			append_hydration(p4, t146);
    			mount_component(equation47, p4, null);
    			append_hydration(p4, t147);
    			append_hydration(p4, br16);
    			append_hydration(p4, t148);
    			mount_component(equation48, p4, null);
    			append_hydration(p4, t149);
    			append_hydration(p4, br17);
    			append_hydration(p4, t150);
    			mount_component(equation49, p4, null);
    			append_hydration(p4, t151);
    			append_hydration(p4, br18);
    			append_hydration(p4, t152);
    			mount_component(equation50, p4, null);
    			append_hydration(p4, t153);
    			append_hydration(p4, br19);
    			append_hydration(p4, t154);
    			append_hydration(p4, br20);
    			append_hydration(p4, t155);
    			append_hydration(p4, br21);
    			append_hydration(p4, t156);
    			append_hydration(p4, br22);
    			append_hydration(div8, t157);
    			append_hydration(div8, h21);
    			append_hydration(h21, t158);
    			append_hydration(div8, t159);
    			append_hydration(div8, p5);
    			append_hydration(p5, t160);
    			append_hydration(p5, br23);
    			append_hydration(p5, t161);
    			mount_component(equation51, p5, null);
    			append_hydration(p5, t162);
    			append_hydration(p5, br24);
    			append_hydration(p5, t163);
    			mount_component(equation52, p5, null);
    			append_hydration(p5, t164);
    			mount_component(equation53, p5, null);
    			append_hydration(p5, t165);
    			append_hydration(div8, t166);
    			append_hydration(div8, h44);
    			append_hydration(h44, t167);
    			append_hydration(div8, t168);
    			append_hydration(div8, div6);
    			mount_component(graph6, div6, null);
    			append_hydration(div6, t169);
    			mount_component(graph7, div6, null);
    			append_hydration(div6, t170);
    			mount_component(graph8, div6, null);
    			append_hydration(div6, t171);
    			mount_component(graph9, div6, null);
    			append_hydration(div6, t172);
    			mount_component(graph10, div6, null);
    			append_hydration(div8, t173);
    			append_hydration(div8, h45);
    			append_hydration(h45, t174);
    			append_hydration(div8, t175);
    			append_hydration(div8, table2);
    			append_hydration(table2, tr10);
    			append_hydration(tr10, td48);
    			append_hydration(td48, t176);
    			append_hydration(tr10, t177);
    			append_hydration(tr10, td49);
    			mount_component(equation54, td49, null);
    			append_hydration(table2, t178);
    			append_hydration(table2, tr11);
    			append_hydration(tr11, td50);
    			append_hydration(td50, t179);
    			append_hydration(tr11, t180);
    			append_hydration(tr11, td51);
    			mount_component(equation55, td51, null);
    			append_hydration(table2, t181);
    			append_hydration(table2, tr12);
    			append_hydration(tr12, td52);
    			append_hydration(td52, t182);
    			append_hydration(tr12, t183);
    			append_hydration(tr12, td53);
    			mount_component(equation56, td53, null);
    			append_hydration(table2, t184);
    			append_hydration(table2, tr13);
    			append_hydration(tr13, td54);
    			append_hydration(td54, t185);
    			append_hydration(tr13, t186);
    			append_hydration(tr13, td55);
    			mount_component(equation57, td55, null);
    			append_hydration(table2, t187);
    			append_hydration(table2, tr14);
    			append_hydration(tr14, td56);
    			append_hydration(td56, t188);
    			append_hydration(tr14, t189);
    			append_hydration(tr14, td57);
    			mount_component(equation58, td57, null);
    			append_hydration(table2, t190);
    			append_hydration(table2, tr15);
    			append_hydration(tr15, td58);
    			append_hydration(td58, t191);
    			append_hydration(tr15, t192);
    			append_hydration(tr15, td59);
    			mount_component(equation59, td59, null);
    			append_hydration(table2, t193);
    			append_hydration(table2, tr16);
    			append_hydration(tr16, td60);
    			append_hydration(td60, t194);
    			append_hydration(tr16, t195);
    			append_hydration(tr16, td61);
    			mount_component(equation60, td61, null);
    			append_hydration(table2, t196);
    			append_hydration(table2, tr17);
    			append_hydration(tr17, td62);
    			append_hydration(td62, t197);
    			append_hydration(tr17, t198);
    			append_hydration(tr17, td63);
    			mount_component(equation61, td63, null);
    			append_hydration(div8, t199);
    			append_hydration(div8, br25);
    			append_hydration(div8, t200);
    			append_hydration(div8, br26);
    			append_hydration(div8, t201);
    			append_hydration(div8, h22);
    			append_hydration(h22, t202);
    			append_hydration(div8, t203);
    			append_hydration(div8, p6);
    			append_hydration(p6, t204);
    			mount_component(equation62, p6, null);
    			append_hydration(p6, t205);
    			mount_component(equation63, p6, null);
    			append_hydration(p6, t206);
    			mount_component(equation64, p6, null);
    			append_hydration(p6, t207);
    			mount_component(equation65, p6, null);
    			append_hydration(p6, t208);
    			mount_component(equation66, p6, null);
    			append_hydration(div8, t209);
    			append_hydration(div8, h46);
    			append_hydration(h46, t210);
    			append_hydration(div8, t211);
    			append_hydration(div8, div7);
    			mount_component(graph11, div7, null);
    			append_hydration(div7, t212);
    			mount_component(graph12, div7, null);
    			append_hydration(div7, t213);
    			mount_component(graph13, div7, null);
    			append_hydration(div8, t214);
    			append_hydration(div8, h47);
    			append_hydration(h47, t215);
    			append_hydration(div8, t216);
    			append_hydration(div8, table3);
    			append_hydration(table3, tr18);
    			append_hydration(tr18, td64);
    			append_hydration(td64, t217);
    			append_hydration(tr18, t218);
    			append_hydration(tr18, td65);
    			mount_component(equation67, td65, null);
    			append_hydration(table3, t219);
    			append_hydration(table3, tr19);
    			append_hydration(tr19, td66);
    			append_hydration(td66, t220);
    			append_hydration(tr19, t221);
    			append_hydration(tr19, td67);
    			mount_component(equation68, td67, null);
    			append_hydration(table3, t222);
    			append_hydration(table3, tr20);
    			append_hydration(tr20, td68);
    			append_hydration(td68, t223);
    			append_hydration(tr20, t224);
    			append_hydration(tr20, td69);
    			mount_component(equation69, td69, null);
    			append_hydration(table3, t225);
    			append_hydration(table3, tr21);
    			append_hydration(tr21, td70);
    			append_hydration(td70, t226);
    			append_hydration(tr21, t227);
    			append_hydration(tr21, td71);
    			mount_component(equation70, td71, null);
    			append_hydration(table3, t228);
    			append_hydration(table3, tr22);
    			append_hydration(tr22, td72);
    			append_hydration(td72, t229);
    			append_hydration(tr22, t230);
    			append_hydration(tr22, td73);
    			mount_component(equation71, td73, null);
    			append_hydration(table3, t231);
    			append_hydration(table3, tr23);
    			append_hydration(tr23, td74);
    			append_hydration(td74, t232);
    			append_hydration(tr23, t233);
    			append_hydration(tr23, td75);
    			mount_component(equation72, td75, null);
    			append_hydration(div8, t234);
    			append_hydration(div8, br27);
    			append_hydration(div8, t235);
    			append_hydration(div8, br28);
    			append_hydration(div8, t236);
    			append_hydration(div8, h23);
    			append_hydration(h23, t237);
    			append_hydration(div8, t238);
    			append_hydration(div8, p7);
    			append_hydration(p7, t239);
    			mount_component(equation73, p7, null);
    			append_hydration(p7, t240);
    			mount_component(equation74, p7, null);
    			append_hydration(p7, t241);
    			append_hydration(div8, t242);
    			append_hydration(div8, br29);
    			append_hydration(div8, t243);
    			append_hydration(div8, table4);
    			append_hydration(table4, tr24);
    			append_hydration(tr24, td76);
    			append_hydration(td76, t244);
    			append_hydration(tr24, t245);
    			append_hydration(tr24, td77);
    			mount_component(equation75, td77, null);
    			append_hydration(table4, t246);
    			append_hydration(table4, tr25);
    			append_hydration(tr25, td78);
    			append_hydration(td78, t247);
    			append_hydration(tr25, t248);
    			append_hydration(tr25, td79);
    			mount_component(equation76, td79, null);
    			append_hydration(table4, t249);
    			append_hydration(table4, tr26);
    			append_hydration(tr26, td80);
    			append_hydration(td80, t250);
    			append_hydration(tr26, t251);
    			append_hydration(tr26, td81);
    			mount_component(equation77, td81, null);
    			append_hydration(table4, t252);
    			append_hydration(table4, tr27);
    			append_hydration(tr27, td82);
    			append_hydration(td82, t253);
    			append_hydration(tr27, t254);
    			append_hydration(tr27, td83);
    			mount_component(equation78, td83, null);
    			append_hydration(td83, t255);
    			mount_component(equation79, td83, null);
    			append_hydration(div8, t256);
    			append_hydration(div8, p8);
    			append_hydration(p8, t257);
    			append_hydration(div8, t258);
    			append_hydration(div8, h48);
    			append_hydration(h48, t259);
    			append_hydration(div8, t260);
    			append_hydration(div8, p9);
    			append_hydration(p9, t261);
    			append_hydration(p9, br30);
    			append_hydration(p9, t262);
    			mount_component(equation80, p9, null);
    			append_hydration(p9, t263);
    			append_hydration(p9, br31);
    			append_hydration(p9, t264);
    			append_hydration(p9, br32);
    			append_hydration(p9, t265);
    			append_hydration(p9, br33);
    			append_hydration(p9, t266);
    			append_hydration(div8, t267);
    			append_hydration(div8, h49);
    			append_hydration(h49, t268);
    			append_hydration(div8, t269);
    			mount_component(equation81, div8, null);
    			append_hydration(div8, t270);
    			mount_component(equation82, div8, null);
    			append_hydration(div8, t271);
    			append_hydration(div8, br34);
    			append_hydration(div8, t272);
    			append_hydration(div8, ul);
    			append_hydration(ul, li0);
    			append_hydration(li0, t273);
    			append_hydration(li0, br35);
    			append_hydration(li0, t274);
    			mount_component(equation83, li0, null);
    			append_hydration(li0, t275);
    			append_hydration(li0, br36);
    			append_hydration(li0, t276);
    			mount_component(equation84, li0, null);
    			append_hydration(li0, t277);
    			append_hydration(li0, br37);
    			append_hydration(li0, t278);
    			mount_component(equation85, li0, null);
    			append_hydration(li0, t279);
    			append_hydration(li0, br38);
    			append_hydration(li0, t280);
    			mount_component(equation86, li0, null);
    			append_hydration(li0, t281);
    			append_hydration(li0, br39);
    			append_hydration(li0, t282);
    			mount_component(equation87, li0, null);
    			append_hydration(ul, t283);
    			append_hydration(ul, br40);
    			append_hydration(ul, t284);
    			append_hydration(ul, li1);
    			append_hydration(li1, t285);
    			append_hydration(li1, br41);
    			append_hydration(li1, t286);
    			mount_component(equation88, li1, null);
    			append_hydration(li1, t287);
    			append_hydration(li1, br42);
    			append_hydration(li1, t288);
    			mount_component(equation89, li1, null);
    			append_hydration(li1, t289);
    			append_hydration(li1, br43);
    			append_hydration(li1, t290);
    			mount_component(equation90, li1, null);
    			append_hydration(li1, t291);
    			append_hydration(li1, br44);
    			append_hydration(li1, t292);
    			mount_component(equation91, li1, null);
    			append_hydration(li1, t293);
    			append_hydration(li1, br45);
    			append_hydration(li1, t294);
    			mount_component(equation92, li1, null);
    			append_hydration(ul, t295);
    			append_hydration(ul, br46);
    			append_hydration(ul, t296);
    			append_hydration(ul, li2);
    			append_hydration(li2, t297);
    			append_hydration(li2, br47);
    			append_hydration(li2, t298);
    			mount_component(equation93, li2, null);
    			append_hydration(li2, t299);
    			append_hydration(li2, br48);
    			append_hydration(li2, t300);
    			mount_component(equation94, li2, null);
    			append_hydration(li2, t301);
    			append_hydration(li2, br49);
    			append_hydration(li2, t302);
    			mount_component(equation95, li2, null);
    			append_hydration(li2, t303);
    			append_hydration(li2, br50);
    			append_hydration(li2, t304);
    			mount_component(equation96, li2, null);
    			append_hydration(li2, t305);
    			append_hydration(li2, br51);
    			append_hydration(li2, t306);
    			mount_component(equation97, li2, null);
    			append_hydration(ul, t307);
    			append_hydration(ul, br52);
    			append_hydration(ul, t308);
    			append_hydration(ul, li3);
    			append_hydration(li3, t309);
    			append_hydration(li3, br53);
    			append_hydration(li3, t310);
    			mount_component(equation98, li3, null);
    			append_hydration(li3, t311);
    			append_hydration(li3, br54);
    			append_hydration(li3, t312);
    			mount_component(equation99, li3, null);
    			append_hydration(li3, t313);
    			append_hydration(li3, br55);
    			append_hydration(li3, t314);
    			mount_component(equation100, li3, null);
    			append_hydration(ul, t315);
    			append_hydration(ul, br56);
    			append_hydration(ul, t316);
    			append_hydration(ul, li4);
    			append_hydration(li4, t317);
    			append_hydration(li4, br57);
    			append_hydration(li4, t318);
    			mount_component(equation101, li4, null);
    			append_hydration(li4, t319);
    			append_hydration(li4, br58);
    			append_hydration(li4, t320);
    			mount_component(equation102, li4, null);
    			append_hydration(li4, t321);
    			append_hydration(li4, br59);
    			append_hydration(li4, t322);
    			mount_component(equation103, li4, null);
    			append_hydration(li4, t323);
    			append_hydration(li4, br60);
    			append_hydration(li4, t324);
    			mount_component(equation104, li4, null);
    			append_hydration(div8, t325);
    			mount_component(equation105, div8, null);
    			append_hydration(div8, t326);
    			mount_component(equation106, div8, null);
    			append_hydration(div8, t327);
    			append_hydration(div8, br61);
    			append_hydration(div8, t328);
    			mount_component(equation107, div8, null);
    			append_hydration(div8, t329);
    			append_hydration(div8, br62);
    			append_hydration(div8, t330);
    			mount_component(equation108, div8, null);
    			append_hydration(div8, t331);
    			append_hydration(div8, br63);
    			append_hydration(div8, t332);
    			mount_component(equation109, div8, null);
    			append_hydration(div8, t333);
    			append_hydration(div8, br64);
    			append_hydration(div8, t334);
    			append_hydration(div8, br65);
    			append_hydration(div8, t335);
    			mount_component(equation110, div8, null);
    			append_hydration(div8, t336);
    			mount_component(equation111, div8, null);
    			append_hydration(div8, t337);
    			mount_component(equation112, div8, null);
    			append_hydration(div8, t338);
    			append_hydration(div8, br66);
    			append_hydration(div8, t339);
    			append_hydration(div8, br67);
    			append_hydration(div8, t340);
    			append_hydration(div8, br68);
    			append_hydration(div8, t341);
    			append_hydration(div8, br69);
    			append_hydration(div8, t342);
    			append_hydration(div8, br70);
    			append_hydration(div8, t343);
    			append_hydration(div8, br71);
    			current = true;

    			if (!mounted) {
    				dispose = [
    					listen(window_1, "scroll", () => {
    						scrolling = true;
    						clearTimeout(scrolling_timeout);
    						scrolling_timeout = setTimeout(clear_scrolling, 100);
    						/*onwindowscroll*/ ctx[4]();
    					}),
    					listen(div0, "click", /*click_handler*/ ctx[5]),
    					listen(div1, "click", /*click_handler_1*/ ctx[6]),
    					listen(div2, "click", /*click_handler_2*/ ctx[7]),
    					listen(div3, "click", /*click_handler_3*/ ctx[8])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*scrollY*/ 2 && !scrolling) {
    				scrolling = true;
    				clearTimeout(scrolling_timeout);
    				scrollTo(window_1.pageXOffset, /*scrollY*/ ctx[1]);
    				scrolling_timeout = setTimeout(clear_scrolling, 100);
    			}

    			if (!current || dirty & /*hash*/ 1 && div0_class_value !== (div0_class_value = "" + (null_to_empty(/*hash*/ ctx[0] === "trig" ? "navselect" : "") + " svelte-hickvj"))) {
    				attr(div0, "class", div0_class_value);
    			}

    			if (!current || dirty & /*hash*/ 1 && div1_class_value !== (div1_class_value = "" + (null_to_empty(/*hash*/ ctx[0] === "exp" ? "navselect" : "") + " svelte-hickvj"))) {
    				attr(div1, "class", div1_class_value);
    			}

    			if (!current || dirty & /*hash*/ 1 && div2_class_value !== (div2_class_value = "" + (null_to_empty(/*hash*/ ctx[0] === "log" ? "navselect" : "") + " svelte-hickvj"))) {
    				attr(div2, "class", div2_class_value);
    			}

    			if (!current || dirty & /*hash*/ 1 && div3_class_value !== (div3_class_value = "" + (null_to_empty(/*hash*/ ctx[0] === "comb" ? "navselect" : "") + " svelte-hickvj"))) {
    				attr(div3, "class", div3_class_value);
    			}

    			const equation0_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation0_changes.$$scope = { dirty, ctx };
    			}

    			equation0.$set(equation0_changes);
    			const equation1_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation1_changes.$$scope = { dirty, ctx };
    			}

    			equation1.$set(equation1_changes);
    			const equation2_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation2_changes.$$scope = { dirty, ctx };
    			}

    			equation2.$set(equation2_changes);
    			const equation3_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation3_changes.$$scope = { dirty, ctx };
    			}

    			equation3.$set(equation3_changes);
    			const equation4_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation4_changes.$$scope = { dirty, ctx };
    			}

    			equation4.$set(equation4_changes);
    			const equation5_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation5_changes.$$scope = { dirty, ctx };
    			}

    			equation5.$set(equation5_changes);
    			const equation6_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation6_changes.$$scope = { dirty, ctx };
    			}

    			equation6.$set(equation6_changes);
    			const equation7_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation7_changes.$$scope = { dirty, ctx };
    			}

    			equation7.$set(equation7_changes);
    			const equation8_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation8_changes.$$scope = { dirty, ctx };
    			}

    			equation8.$set(equation8_changes);
    			const equation9_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation9_changes.$$scope = { dirty, ctx };
    			}

    			equation9.$set(equation9_changes);
    			const equation10_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation10_changes.$$scope = { dirty, ctx };
    			}

    			equation10.$set(equation10_changes);
    			const equation11_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation11_changes.$$scope = { dirty, ctx };
    			}

    			equation11.$set(equation11_changes);
    			const equation12_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation12_changes.$$scope = { dirty, ctx };
    			}

    			equation12.$set(equation12_changes);
    			const equation13_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation13_changes.$$scope = { dirty, ctx };
    			}

    			equation13.$set(equation13_changes);
    			const equation14_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation14_changes.$$scope = { dirty, ctx };
    			}

    			equation14.$set(equation14_changes);
    			const equation15_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation15_changes.$$scope = { dirty, ctx };
    			}

    			equation15.$set(equation15_changes);
    			const equation16_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation16_changes.$$scope = { dirty, ctx };
    			}

    			equation16.$set(equation16_changes);
    			const equation17_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation17_changes.$$scope = { dirty, ctx };
    			}

    			equation17.$set(equation17_changes);
    			const equation18_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation18_changes.$$scope = { dirty, ctx };
    			}

    			equation18.$set(equation18_changes);
    			const equation19_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation19_changes.$$scope = { dirty, ctx };
    			}

    			equation19.$set(equation19_changes);
    			const equation20_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation20_changes.$$scope = { dirty, ctx };
    			}

    			equation20.$set(equation20_changes);
    			const equation21_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation21_changes.$$scope = { dirty, ctx };
    			}

    			equation21.$set(equation21_changes);
    			const equation22_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation22_changes.$$scope = { dirty, ctx };
    			}

    			equation22.$set(equation22_changes);
    			const equation23_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation23_changes.$$scope = { dirty, ctx };
    			}

    			equation23.$set(equation23_changes);
    			const equation24_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation24_changes.$$scope = { dirty, ctx };
    			}

    			equation24.$set(equation24_changes);
    			const equation25_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation25_changes.$$scope = { dirty, ctx };
    			}

    			equation25.$set(equation25_changes);
    			const equation26_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation26_changes.$$scope = { dirty, ctx };
    			}

    			equation26.$set(equation26_changes);
    			const equation27_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation27_changes.$$scope = { dirty, ctx };
    			}

    			equation27.$set(equation27_changes);
    			const equation28_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation28_changes.$$scope = { dirty, ctx };
    			}

    			equation28.$set(equation28_changes);
    			const equation29_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation29_changes.$$scope = { dirty, ctx };
    			}

    			equation29.$set(equation29_changes);
    			const equation30_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation30_changes.$$scope = { dirty, ctx };
    			}

    			equation30.$set(equation30_changes);
    			const equation31_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation31_changes.$$scope = { dirty, ctx };
    			}

    			equation31.$set(equation31_changes);
    			const equation32_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation32_changes.$$scope = { dirty, ctx };
    			}

    			equation32.$set(equation32_changes);
    			const equation33_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation33_changes.$$scope = { dirty, ctx };
    			}

    			equation33.$set(equation33_changes);
    			const equation34_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation34_changes.$$scope = { dirty, ctx };
    			}

    			equation34.$set(equation34_changes);
    			const equation35_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation35_changes.$$scope = { dirty, ctx };
    			}

    			equation35.$set(equation35_changes);
    			const equation36_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation36_changes.$$scope = { dirty, ctx };
    			}

    			equation36.$set(equation36_changes);
    			const equation37_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation37_changes.$$scope = { dirty, ctx };
    			}

    			equation37.$set(equation37_changes);
    			const equation38_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation38_changes.$$scope = { dirty, ctx };
    			}

    			equation38.$set(equation38_changes);
    			const equation39_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation39_changes.$$scope = { dirty, ctx };
    			}

    			equation39.$set(equation39_changes);
    			const equation40_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation40_changes.$$scope = { dirty, ctx };
    			}

    			equation40.$set(equation40_changes);
    			const equation41_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation41_changes.$$scope = { dirty, ctx };
    			}

    			equation41.$set(equation41_changes);
    			const equation42_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation42_changes.$$scope = { dirty, ctx };
    			}

    			equation42.$set(equation42_changes);
    			const equation43_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation43_changes.$$scope = { dirty, ctx };
    			}

    			equation43.$set(equation43_changes);
    			const equation44_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation44_changes.$$scope = { dirty, ctx };
    			}

    			equation44.$set(equation44_changes);
    			const equation45_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation45_changes.$$scope = { dirty, ctx };
    			}

    			equation45.$set(equation45_changes);
    			const equation46_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation46_changes.$$scope = { dirty, ctx };
    			}

    			equation46.$set(equation46_changes);
    			const equation47_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation47_changes.$$scope = { dirty, ctx };
    			}

    			equation47.$set(equation47_changes);
    			const equation48_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation48_changes.$$scope = { dirty, ctx };
    			}

    			equation48.$set(equation48_changes);
    			const equation49_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation49_changes.$$scope = { dirty, ctx };
    			}

    			equation49.$set(equation49_changes);
    			const equation50_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation50_changes.$$scope = { dirty, ctx };
    			}

    			equation50.$set(equation50_changes);
    			const equation51_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation51_changes.$$scope = { dirty, ctx };
    			}

    			equation51.$set(equation51_changes);
    			const equation52_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation52_changes.$$scope = { dirty, ctx };
    			}

    			equation52.$set(equation52_changes);
    			const equation53_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation53_changes.$$scope = { dirty, ctx };
    			}

    			equation53.$set(equation53_changes);
    			const equation54_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation54_changes.$$scope = { dirty, ctx };
    			}

    			equation54.$set(equation54_changes);
    			const equation55_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation55_changes.$$scope = { dirty, ctx };
    			}

    			equation55.$set(equation55_changes);
    			const equation56_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation56_changes.$$scope = { dirty, ctx };
    			}

    			equation56.$set(equation56_changes);
    			const equation57_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation57_changes.$$scope = { dirty, ctx };
    			}

    			equation57.$set(equation57_changes);
    			const equation58_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation58_changes.$$scope = { dirty, ctx };
    			}

    			equation58.$set(equation58_changes);
    			const equation59_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation59_changes.$$scope = { dirty, ctx };
    			}

    			equation59.$set(equation59_changes);
    			const equation60_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation60_changes.$$scope = { dirty, ctx };
    			}

    			equation60.$set(equation60_changes);
    			const equation61_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation61_changes.$$scope = { dirty, ctx };
    			}

    			equation61.$set(equation61_changes);
    			const equation62_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation62_changes.$$scope = { dirty, ctx };
    			}

    			equation62.$set(equation62_changes);
    			const equation63_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation63_changes.$$scope = { dirty, ctx };
    			}

    			equation63.$set(equation63_changes);
    			const equation64_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation64_changes.$$scope = { dirty, ctx };
    			}

    			equation64.$set(equation64_changes);
    			const equation65_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation65_changes.$$scope = { dirty, ctx };
    			}

    			equation65.$set(equation65_changes);
    			const equation66_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation66_changes.$$scope = { dirty, ctx };
    			}

    			equation66.$set(equation66_changes);
    			const equation67_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation67_changes.$$scope = { dirty, ctx };
    			}

    			equation67.$set(equation67_changes);
    			const equation68_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation68_changes.$$scope = { dirty, ctx };
    			}

    			equation68.$set(equation68_changes);
    			const equation69_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation69_changes.$$scope = { dirty, ctx };
    			}

    			equation69.$set(equation69_changes);
    			const equation70_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation70_changes.$$scope = { dirty, ctx };
    			}

    			equation70.$set(equation70_changes);
    			const equation71_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation71_changes.$$scope = { dirty, ctx };
    			}

    			equation71.$set(equation71_changes);
    			const equation72_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation72_changes.$$scope = { dirty, ctx };
    			}

    			equation72.$set(equation72_changes);
    			const equation73_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation73_changes.$$scope = { dirty, ctx };
    			}

    			equation73.$set(equation73_changes);
    			const equation74_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation74_changes.$$scope = { dirty, ctx };
    			}

    			equation74.$set(equation74_changes);
    			const equation75_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation75_changes.$$scope = { dirty, ctx };
    			}

    			equation75.$set(equation75_changes);
    			const equation76_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation76_changes.$$scope = { dirty, ctx };
    			}

    			equation76.$set(equation76_changes);
    			const equation77_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation77_changes.$$scope = { dirty, ctx };
    			}

    			equation77.$set(equation77_changes);
    			const equation78_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation78_changes.$$scope = { dirty, ctx };
    			}

    			equation78.$set(equation78_changes);
    			const equation79_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation79_changes.$$scope = { dirty, ctx };
    			}

    			equation79.$set(equation79_changes);
    			const equation80_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation80_changes.$$scope = { dirty, ctx };
    			}

    			equation80.$set(equation80_changes);
    			const equation81_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation81_changes.$$scope = { dirty, ctx };
    			}

    			equation81.$set(equation81_changes);
    			const equation82_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation82_changes.$$scope = { dirty, ctx };
    			}

    			equation82.$set(equation82_changes);
    			const equation83_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation83_changes.$$scope = { dirty, ctx };
    			}

    			equation83.$set(equation83_changes);
    			const equation84_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation84_changes.$$scope = { dirty, ctx };
    			}

    			equation84.$set(equation84_changes);
    			const equation85_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation85_changes.$$scope = { dirty, ctx };
    			}

    			equation85.$set(equation85_changes);
    			const equation86_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation86_changes.$$scope = { dirty, ctx };
    			}

    			equation86.$set(equation86_changes);
    			const equation87_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation87_changes.$$scope = { dirty, ctx };
    			}

    			equation87.$set(equation87_changes);
    			const equation88_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation88_changes.$$scope = { dirty, ctx };
    			}

    			equation88.$set(equation88_changes);
    			const equation89_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation89_changes.$$scope = { dirty, ctx };
    			}

    			equation89.$set(equation89_changes);
    			const equation90_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation90_changes.$$scope = { dirty, ctx };
    			}

    			equation90.$set(equation90_changes);
    			const equation91_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation91_changes.$$scope = { dirty, ctx };
    			}

    			equation91.$set(equation91_changes);
    			const equation92_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation92_changes.$$scope = { dirty, ctx };
    			}

    			equation92.$set(equation92_changes);
    			const equation93_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation93_changes.$$scope = { dirty, ctx };
    			}

    			equation93.$set(equation93_changes);
    			const equation94_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation94_changes.$$scope = { dirty, ctx };
    			}

    			equation94.$set(equation94_changes);
    			const equation95_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation95_changes.$$scope = { dirty, ctx };
    			}

    			equation95.$set(equation95_changes);
    			const equation96_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation96_changes.$$scope = { dirty, ctx };
    			}

    			equation96.$set(equation96_changes);
    			const equation97_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation97_changes.$$scope = { dirty, ctx };
    			}

    			equation97.$set(equation97_changes);
    			const equation98_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation98_changes.$$scope = { dirty, ctx };
    			}

    			equation98.$set(equation98_changes);
    			const equation99_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation99_changes.$$scope = { dirty, ctx };
    			}

    			equation99.$set(equation99_changes);
    			const equation100_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation100_changes.$$scope = { dirty, ctx };
    			}

    			equation100.$set(equation100_changes);
    			const equation101_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation101_changes.$$scope = { dirty, ctx };
    			}

    			equation101.$set(equation101_changes);
    			const equation102_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation102_changes.$$scope = { dirty, ctx };
    			}

    			equation102.$set(equation102_changes);
    			const equation103_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation103_changes.$$scope = { dirty, ctx };
    			}

    			equation103.$set(equation103_changes);
    			const equation104_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation104_changes.$$scope = { dirty, ctx };
    			}

    			equation104.$set(equation104_changes);
    			const equation105_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation105_changes.$$scope = { dirty, ctx };
    			}

    			equation105.$set(equation105_changes);
    			const equation106_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation106_changes.$$scope = { dirty, ctx };
    			}

    			equation106.$set(equation106_changes);
    			const equation107_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation107_changes.$$scope = { dirty, ctx };
    			}

    			equation107.$set(equation107_changes);
    			const equation108_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation108_changes.$$scope = { dirty, ctx };
    			}

    			equation108.$set(equation108_changes);
    			const equation109_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation109_changes.$$scope = { dirty, ctx };
    			}

    			equation109.$set(equation109_changes);
    			const equation110_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation110_changes.$$scope = { dirty, ctx };
    			}

    			equation110.$set(equation110_changes);
    			const equation111_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation111_changes.$$scope = { dirty, ctx };
    			}

    			equation111.$set(equation111_changes);
    			const equation112_changes = {};

    			if (dirty & /*$$scope*/ 1024) {
    				equation112_changes.$$scope = { dirty, ctx };
    			}

    			equation112.$set(equation112_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(equation0.$$.fragment, local);
    			transition_in(equation1.$$.fragment, local);
    			transition_in(equation2.$$.fragment, local);
    			transition_in(equation3.$$.fragment, local);
    			transition_in(equation4.$$.fragment, local);
    			transition_in(equation5.$$.fragment, local);
    			transition_in(equation6.$$.fragment, local);
    			transition_in(equation7.$$.fragment, local);
    			transition_in(equation8.$$.fragment, local);
    			transition_in(equation9.$$.fragment, local);
    			transition_in(equation10.$$.fragment, local);
    			transition_in(equation11.$$.fragment, local);
    			transition_in(equation12.$$.fragment, local);
    			transition_in(equation13.$$.fragment, local);
    			transition_in(equation14.$$.fragment, local);
    			transition_in(equation15.$$.fragment, local);
    			transition_in(equation16.$$.fragment, local);
    			transition_in(equation17.$$.fragment, local);
    			transition_in(equation18.$$.fragment, local);
    			transition_in(equation19.$$.fragment, local);
    			transition_in(equation20.$$.fragment, local);
    			transition_in(equation21.$$.fragment, local);
    			transition_in(equation22.$$.fragment, local);
    			transition_in(equation23.$$.fragment, local);
    			transition_in(equation24.$$.fragment, local);
    			transition_in(equation25.$$.fragment, local);
    			transition_in(equation26.$$.fragment, local);
    			transition_in(equation27.$$.fragment, local);
    			transition_in(equation28.$$.fragment, local);
    			transition_in(equation29.$$.fragment, local);
    			transition_in(equation30.$$.fragment, local);
    			transition_in(equation31.$$.fragment, local);
    			transition_in(equation32.$$.fragment, local);
    			transition_in(graph0.$$.fragment, local);
    			transition_in(graph1.$$.fragment, local);
    			transition_in(graph2.$$.fragment, local);
    			transition_in(graph3.$$.fragment, local);
    			transition_in(graph4.$$.fragment, local);
    			transition_in(equation33.$$.fragment, local);
    			transition_in(graph5.$$.fragment, local);
    			transition_in(equation34.$$.fragment, local);
    			transition_in(equation35.$$.fragment, local);
    			transition_in(equation36.$$.fragment, local);
    			transition_in(equation37.$$.fragment, local);
    			transition_in(equation38.$$.fragment, local);
    			transition_in(equation39.$$.fragment, local);
    			transition_in(equation40.$$.fragment, local);
    			transition_in(equation41.$$.fragment, local);
    			transition_in(equation42.$$.fragment, local);
    			transition_in(equation43.$$.fragment, local);
    			transition_in(equation44.$$.fragment, local);
    			transition_in(equation45.$$.fragment, local);
    			transition_in(equation46.$$.fragment, local);
    			transition_in(equation47.$$.fragment, local);
    			transition_in(equation48.$$.fragment, local);
    			transition_in(equation49.$$.fragment, local);
    			transition_in(equation50.$$.fragment, local);
    			transition_in(equation51.$$.fragment, local);
    			transition_in(equation52.$$.fragment, local);
    			transition_in(equation53.$$.fragment, local);
    			transition_in(graph6.$$.fragment, local);
    			transition_in(graph7.$$.fragment, local);
    			transition_in(graph8.$$.fragment, local);
    			transition_in(graph9.$$.fragment, local);
    			transition_in(graph10.$$.fragment, local);
    			transition_in(equation54.$$.fragment, local);
    			transition_in(equation55.$$.fragment, local);
    			transition_in(equation56.$$.fragment, local);
    			transition_in(equation57.$$.fragment, local);
    			transition_in(equation58.$$.fragment, local);
    			transition_in(equation59.$$.fragment, local);
    			transition_in(equation60.$$.fragment, local);
    			transition_in(equation61.$$.fragment, local);
    			transition_in(equation62.$$.fragment, local);
    			transition_in(equation63.$$.fragment, local);
    			transition_in(equation64.$$.fragment, local);
    			transition_in(equation65.$$.fragment, local);
    			transition_in(equation66.$$.fragment, local);
    			transition_in(graph11.$$.fragment, local);
    			transition_in(graph12.$$.fragment, local);
    			transition_in(graph13.$$.fragment, local);
    			transition_in(equation67.$$.fragment, local);
    			transition_in(equation68.$$.fragment, local);
    			transition_in(equation69.$$.fragment, local);
    			transition_in(equation70.$$.fragment, local);
    			transition_in(equation71.$$.fragment, local);
    			transition_in(equation72.$$.fragment, local);
    			transition_in(equation73.$$.fragment, local);
    			transition_in(equation74.$$.fragment, local);
    			transition_in(equation75.$$.fragment, local);
    			transition_in(equation76.$$.fragment, local);
    			transition_in(equation77.$$.fragment, local);
    			transition_in(equation78.$$.fragment, local);
    			transition_in(equation79.$$.fragment, local);
    			transition_in(equation80.$$.fragment, local);
    			transition_in(equation81.$$.fragment, local);
    			transition_in(equation82.$$.fragment, local);
    			transition_in(equation83.$$.fragment, local);
    			transition_in(equation84.$$.fragment, local);
    			transition_in(equation85.$$.fragment, local);
    			transition_in(equation86.$$.fragment, local);
    			transition_in(equation87.$$.fragment, local);
    			transition_in(equation88.$$.fragment, local);
    			transition_in(equation89.$$.fragment, local);
    			transition_in(equation90.$$.fragment, local);
    			transition_in(equation91.$$.fragment, local);
    			transition_in(equation92.$$.fragment, local);
    			transition_in(equation93.$$.fragment, local);
    			transition_in(equation94.$$.fragment, local);
    			transition_in(equation95.$$.fragment, local);
    			transition_in(equation96.$$.fragment, local);
    			transition_in(equation97.$$.fragment, local);
    			transition_in(equation98.$$.fragment, local);
    			transition_in(equation99.$$.fragment, local);
    			transition_in(equation100.$$.fragment, local);
    			transition_in(equation101.$$.fragment, local);
    			transition_in(equation102.$$.fragment, local);
    			transition_in(equation103.$$.fragment, local);
    			transition_in(equation104.$$.fragment, local);
    			transition_in(equation105.$$.fragment, local);
    			transition_in(equation106.$$.fragment, local);
    			transition_in(equation107.$$.fragment, local);
    			transition_in(equation108.$$.fragment, local);
    			transition_in(equation109.$$.fragment, local);
    			transition_in(equation110.$$.fragment, local);
    			transition_in(equation111.$$.fragment, local);
    			transition_in(equation112.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(equation0.$$.fragment, local);
    			transition_out(equation1.$$.fragment, local);
    			transition_out(equation2.$$.fragment, local);
    			transition_out(equation3.$$.fragment, local);
    			transition_out(equation4.$$.fragment, local);
    			transition_out(equation5.$$.fragment, local);
    			transition_out(equation6.$$.fragment, local);
    			transition_out(equation7.$$.fragment, local);
    			transition_out(equation8.$$.fragment, local);
    			transition_out(equation9.$$.fragment, local);
    			transition_out(equation10.$$.fragment, local);
    			transition_out(equation11.$$.fragment, local);
    			transition_out(equation12.$$.fragment, local);
    			transition_out(equation13.$$.fragment, local);
    			transition_out(equation14.$$.fragment, local);
    			transition_out(equation15.$$.fragment, local);
    			transition_out(equation16.$$.fragment, local);
    			transition_out(equation17.$$.fragment, local);
    			transition_out(equation18.$$.fragment, local);
    			transition_out(equation19.$$.fragment, local);
    			transition_out(equation20.$$.fragment, local);
    			transition_out(equation21.$$.fragment, local);
    			transition_out(equation22.$$.fragment, local);
    			transition_out(equation23.$$.fragment, local);
    			transition_out(equation24.$$.fragment, local);
    			transition_out(equation25.$$.fragment, local);
    			transition_out(equation26.$$.fragment, local);
    			transition_out(equation27.$$.fragment, local);
    			transition_out(equation28.$$.fragment, local);
    			transition_out(equation29.$$.fragment, local);
    			transition_out(equation30.$$.fragment, local);
    			transition_out(equation31.$$.fragment, local);
    			transition_out(equation32.$$.fragment, local);
    			transition_out(graph0.$$.fragment, local);
    			transition_out(graph1.$$.fragment, local);
    			transition_out(graph2.$$.fragment, local);
    			transition_out(graph3.$$.fragment, local);
    			transition_out(graph4.$$.fragment, local);
    			transition_out(equation33.$$.fragment, local);
    			transition_out(graph5.$$.fragment, local);
    			transition_out(equation34.$$.fragment, local);
    			transition_out(equation35.$$.fragment, local);
    			transition_out(equation36.$$.fragment, local);
    			transition_out(equation37.$$.fragment, local);
    			transition_out(equation38.$$.fragment, local);
    			transition_out(equation39.$$.fragment, local);
    			transition_out(equation40.$$.fragment, local);
    			transition_out(equation41.$$.fragment, local);
    			transition_out(equation42.$$.fragment, local);
    			transition_out(equation43.$$.fragment, local);
    			transition_out(equation44.$$.fragment, local);
    			transition_out(equation45.$$.fragment, local);
    			transition_out(equation46.$$.fragment, local);
    			transition_out(equation47.$$.fragment, local);
    			transition_out(equation48.$$.fragment, local);
    			transition_out(equation49.$$.fragment, local);
    			transition_out(equation50.$$.fragment, local);
    			transition_out(equation51.$$.fragment, local);
    			transition_out(equation52.$$.fragment, local);
    			transition_out(equation53.$$.fragment, local);
    			transition_out(graph6.$$.fragment, local);
    			transition_out(graph7.$$.fragment, local);
    			transition_out(graph8.$$.fragment, local);
    			transition_out(graph9.$$.fragment, local);
    			transition_out(graph10.$$.fragment, local);
    			transition_out(equation54.$$.fragment, local);
    			transition_out(equation55.$$.fragment, local);
    			transition_out(equation56.$$.fragment, local);
    			transition_out(equation57.$$.fragment, local);
    			transition_out(equation58.$$.fragment, local);
    			transition_out(equation59.$$.fragment, local);
    			transition_out(equation60.$$.fragment, local);
    			transition_out(equation61.$$.fragment, local);
    			transition_out(equation62.$$.fragment, local);
    			transition_out(equation63.$$.fragment, local);
    			transition_out(equation64.$$.fragment, local);
    			transition_out(equation65.$$.fragment, local);
    			transition_out(equation66.$$.fragment, local);
    			transition_out(graph11.$$.fragment, local);
    			transition_out(graph12.$$.fragment, local);
    			transition_out(graph13.$$.fragment, local);
    			transition_out(equation67.$$.fragment, local);
    			transition_out(equation68.$$.fragment, local);
    			transition_out(equation69.$$.fragment, local);
    			transition_out(equation70.$$.fragment, local);
    			transition_out(equation71.$$.fragment, local);
    			transition_out(equation72.$$.fragment, local);
    			transition_out(equation73.$$.fragment, local);
    			transition_out(equation74.$$.fragment, local);
    			transition_out(equation75.$$.fragment, local);
    			transition_out(equation76.$$.fragment, local);
    			transition_out(equation77.$$.fragment, local);
    			transition_out(equation78.$$.fragment, local);
    			transition_out(equation79.$$.fragment, local);
    			transition_out(equation80.$$.fragment, local);
    			transition_out(equation81.$$.fragment, local);
    			transition_out(equation82.$$.fragment, local);
    			transition_out(equation83.$$.fragment, local);
    			transition_out(equation84.$$.fragment, local);
    			transition_out(equation85.$$.fragment, local);
    			transition_out(equation86.$$.fragment, local);
    			transition_out(equation87.$$.fragment, local);
    			transition_out(equation88.$$.fragment, local);
    			transition_out(equation89.$$.fragment, local);
    			transition_out(equation90.$$.fragment, local);
    			transition_out(equation91.$$.fragment, local);
    			transition_out(equation92.$$.fragment, local);
    			transition_out(equation93.$$.fragment, local);
    			transition_out(equation94.$$.fragment, local);
    			transition_out(equation95.$$.fragment, local);
    			transition_out(equation96.$$.fragment, local);
    			transition_out(equation97.$$.fragment, local);
    			transition_out(equation98.$$.fragment, local);
    			transition_out(equation99.$$.fragment, local);
    			transition_out(equation100.$$.fragment, local);
    			transition_out(equation101.$$.fragment, local);
    			transition_out(equation102.$$.fragment, local);
    			transition_out(equation103.$$.fragment, local);
    			transition_out(equation104.$$.fragment, local);
    			transition_out(equation105.$$.fragment, local);
    			transition_out(equation106.$$.fragment, local);
    			transition_out(equation107.$$.fragment, local);
    			transition_out(equation108.$$.fragment, local);
    			transition_out(equation109.$$.fragment, local);
    			transition_out(equation110.$$.fragment, local);
    			transition_out(equation111.$$.fragment, local);
    			transition_out(equation112.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div9);
    			destroy_component(equation0);
    			destroy_component(equation1);
    			destroy_component(equation2);
    			destroy_component(equation3);
    			destroy_component(equation4);
    			destroy_component(equation5);
    			destroy_component(equation6);
    			destroy_component(equation7);
    			destroy_component(equation8);
    			destroy_component(equation9);
    			destroy_component(equation10);
    			destroy_component(equation11);
    			destroy_component(equation12);
    			destroy_component(equation13);
    			destroy_component(equation14);
    			destroy_component(equation15);
    			destroy_component(equation16);
    			destroy_component(equation17);
    			destroy_component(equation18);
    			destroy_component(equation19);
    			destroy_component(equation20);
    			destroy_component(equation21);
    			destroy_component(equation22);
    			destroy_component(equation23);
    			destroy_component(equation24);
    			destroy_component(equation25);
    			destroy_component(equation26);
    			destroy_component(equation27);
    			destroy_component(equation28);
    			destroy_component(equation29);
    			destroy_component(equation30);
    			destroy_component(equation31);
    			destroy_component(equation32);
    			destroy_component(graph0);
    			destroy_component(graph1);
    			destroy_component(graph2);
    			destroy_component(graph3);
    			destroy_component(graph4);
    			destroy_component(equation33);
    			destroy_component(graph5);
    			destroy_component(equation34);
    			destroy_component(equation35);
    			destroy_component(equation36);
    			destroy_component(equation37);
    			destroy_component(equation38);
    			destroy_component(equation39);
    			destroy_component(equation40);
    			destroy_component(equation41);
    			destroy_component(equation42);
    			destroy_component(equation43);
    			destroy_component(equation44);
    			destroy_component(equation45);
    			destroy_component(equation46);
    			destroy_component(equation47);
    			destroy_component(equation48);
    			destroy_component(equation49);
    			destroy_component(equation50);
    			destroy_component(equation51);
    			destroy_component(equation52);
    			destroy_component(equation53);
    			destroy_component(graph6);
    			destroy_component(graph7);
    			destroy_component(graph8);
    			destroy_component(graph9);
    			destroy_component(graph10);
    			destroy_component(equation54);
    			destroy_component(equation55);
    			destroy_component(equation56);
    			destroy_component(equation57);
    			destroy_component(equation58);
    			destroy_component(equation59);
    			destroy_component(equation60);
    			destroy_component(equation61);
    			destroy_component(equation62);
    			destroy_component(equation63);
    			destroy_component(equation64);
    			destroy_component(equation65);
    			destroy_component(equation66);
    			destroy_component(graph11);
    			destroy_component(graph12);
    			destroy_component(graph13);
    			destroy_component(equation67);
    			destroy_component(equation68);
    			destroy_component(equation69);
    			destroy_component(equation70);
    			destroy_component(equation71);
    			destroy_component(equation72);
    			destroy_component(equation73);
    			destroy_component(equation74);
    			destroy_component(equation75);
    			destroy_component(equation76);
    			destroy_component(equation77);
    			destroy_component(equation78);
    			destroy_component(equation79);
    			destroy_component(equation80);
    			destroy_component(equation81);
    			destroy_component(equation82);
    			destroy_component(equation83);
    			destroy_component(equation84);
    			destroy_component(equation85);
    			destroy_component(equation86);
    			destroy_component(equation87);
    			destroy_component(equation88);
    			destroy_component(equation89);
    			destroy_component(equation90);
    			destroy_component(equation91);
    			destroy_component(equation92);
    			destroy_component(equation93);
    			destroy_component(equation94);
    			destroy_component(equation95);
    			destroy_component(equation96);
    			destroy_component(equation97);
    			destroy_component(equation98);
    			destroy_component(equation99);
    			destroy_component(equation100);
    			destroy_component(equation101);
    			destroy_component(equation102);
    			destroy_component(equation103);
    			destroy_component(equation104);
    			destroy_component(equation105);
    			destroy_component(equation106);
    			destroy_component(equation107);
    			destroy_component(equation108);
    			destroy_component(equation109);
    			destroy_component(equation110);
    			destroy_component(equation111);
    			destroy_component(equation112);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    const func_1 = calc => {
    	calc.setExpression({
    		id: "a",
    		latex: "a=0.1",
    		sliderBounds: { min: "0", max: "4" }
    	});

    	let state = calc.getState();
    	state.expressions.list[1].slider.isPlaying = true;
    	calc.setState(state);
    };

    const func_2 = calc => {
    	calc.setExpression({
    		id: "a",
    		latex: "a=0.1",
    		sliderBounds: { min: "0.1", max: "4" }
    	});

    	let state = calc.getState();
    	state.expressions.list[1].slider.isPlaying = true;
    	calc.setState(state);
    };

    function instance$2($$self, $$props, $$invalidate) {
    	let hash = "trig";
    	let elements;

    	onMount(() => {
    		if (window.location.hash !== "") {
    			$$invalidate(0, hash = window.location.hash.substring(1));
    		}

    		$$invalidate(3, elements = document.querySelectorAll(".scroll"));
    	});

    	const switchNav = nav => {
    		$$invalidate(0, hash = nav);
    		window.location.hash = `#${nav}`;
    	};

    	let scrollY;

    	function onwindowscroll() {
    		$$invalidate(1, scrollY = window_1.pageYOffset);
    	}

    	const click_handler = () => switchNav("trig");
    	const click_handler_1 = () => switchNav("exp");
    	const click_handler_2 = () => switchNav("log");
    	const click_handler_3 = () => switchNav("comb");

    	const func = calc => {
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
    	};

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*elements, scrollY, hash*/ 11) {
    			{
    				if (elements) {
    					let element;

    					for (const elem of elements) {
    						if (elem.getBoundingClientRect().y + scrollY - 200 < scrollY) {
    							element = elem;
    						}
    					}

    					if (element && hash !== element.id) {
    						$$invalidate(0, hash = element.id);
    					}
    				}
    			}
    		}
    	};

    	return [
    		hash,
    		scrollY,
    		switchNav,
    		elements,
    		onwindowscroll,
    		click_handler,
    		click_handler_1,
    		click_handler_2,
    		click_handler_3,
    		func
    	];
    }

    class Math$1 extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$2, create_fragment$3, safe_not_equal, {});
    	}
    }

    /* src\Register.svelte generated by Svelte v3.45.0 */

    function create_fragment$2(ctx) {
    	let div;
    	let h1;
    	let t;

    	return {
    		c() {
    			div = element("div");
    			h1 = element("h1");
    			t = text("Register");
    		},
    		l(nodes) {
    			div = claim_element(nodes, "DIV", {});
    			var div_nodes = children(div);
    			h1 = claim_element(div_nodes, "H1", {});
    			var h1_nodes = children(h1);
    			t = claim_text(h1_nodes, "Register");
    			h1_nodes.forEach(detach);
    			div_nodes.forEach(detach);
    		},
    		m(target, anchor) {
    			insert_hydration(target, div, anchor);
    			append_hydration(div, h1);
    			append_hydration(h1, t);
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    class Register extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, null, create_fragment$2, safe_not_equal, {});
    	}
    }

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

    function create_fragment$1(ctx) {
    	let div18;
    	let div17;
    	let div16;
    	let div0;
    	let label0;
    	let t0;
    	let t1;
    	let input0;
    	let t2;
    	let div1;
    	let input1;
    	let t3;
    	let div2;
    	let label1;
    	let t4;
    	let t5;
    	let input2;
    	let t6;
    	let div3;
    	let input3;
    	let t7;
    	let div4;
    	let label2;
    	let t8;
    	let t9;
    	let input4;
    	let t10;
    	let div5;
    	let input5;
    	let t11;
    	let div6;
    	let label3;
    	let t12;
    	let t13;
    	let input6;
    	let t14;
    	let div7;
    	let input7;
    	let t15;
    	let div8;
    	let label4;
    	let t16;
    	let t17;
    	let input8;
    	let t18;
    	let div9;
    	let input9;
    	let t19;
    	let div10;
    	let label5;
    	let t20;
    	let t21;
    	let input10;
    	let t22;
    	let div11;
    	let input11;
    	let t23;
    	let div12;
    	let label6;
    	let t24;
    	let t25;
    	let input12;
    	let t26;
    	let div13;
    	let input13;
    	let t27;
    	let div14;
    	let label7;
    	let t28;
    	let t29;
    	let input14;
    	let t30;
    	let div15;
    	let input15;
    	let t31;
    	let canvas_1;
    	let t32;
    	let div20;
    	let div19;
    	let mounted;
    	let dispose;

    	return {
    		c() {
    			div18 = element("div");
    			div17 = element("div");
    			div16 = element("div");
    			div0 = element("div");
    			label0 = element("label");
    			t0 = text("Length:");
    			t1 = space();
    			input0 = element("input");
    			t2 = space();
    			div1 = element("div");
    			input1 = element("input");
    			t3 = space();
    			div2 = element("div");
    			label1 = element("label");
    			t4 = text("Step:");
    			t5 = space();
    			input2 = element("input");
    			t6 = space();
    			div3 = element("div");
    			input3 = element("input");
    			t7 = space();
    			div4 = element("div");
    			label2 = element("label");
    			t8 = text("Min X:");
    			t9 = space();
    			input4 = element("input");
    			t10 = space();
    			div5 = element("div");
    			input5 = element("input");
    			t11 = space();
    			div6 = element("div");
    			label3 = element("label");
    			t12 = text("Max X:");
    			t13 = space();
    			input6 = element("input");
    			t14 = space();
    			div7 = element("div");
    			input7 = element("input");
    			t15 = space();
    			div8 = element("div");
    			label4 = element("label");
    			t16 = text("Min Y:");
    			t17 = space();
    			input8 = element("input");
    			t18 = space();
    			div9 = element("div");
    			input9 = element("input");
    			t19 = space();
    			div10 = element("div");
    			label5 = element("label");
    			t20 = text("Max Y:");
    			t21 = space();
    			input10 = element("input");
    			t22 = space();
    			div11 = element("div");
    			input11 = element("input");
    			t23 = space();
    			div12 = element("div");
    			label6 = element("label");
    			t24 = text("Bounds:");
    			t25 = space();
    			input12 = element("input");
    			t26 = space();
    			div13 = element("div");
    			input13 = element("input");
    			t27 = space();
    			div14 = element("div");
    			label7 = element("label");
    			t28 = text("Scale:");
    			t29 = space();
    			input14 = element("input");
    			t30 = space();
    			div15 = element("div");
    			input15 = element("input");
    			t31 = space();
    			canvas_1 = element("canvas");
    			t32 = space();
    			div20 = element("div");
    			div19 = element("div");
    			this.h();
    		},
    		l(nodes) {
    			div18 = claim_element(nodes, "DIV", { class: true });
    			var div18_nodes = children(div18);
    			div17 = claim_element(div18_nodes, "DIV", { class: true, style: true });
    			var div17_nodes = children(div17);
    			div16 = claim_element(div17_nodes, "DIV", { class: true });
    			var div16_nodes = children(div16);
    			div0 = claim_element(div16_nodes, "DIV", { class: true });
    			var div0_nodes = children(div0);
    			label0 = claim_element(div0_nodes, "LABEL", { for: true });
    			var label0_nodes = children(label0);
    			t0 = claim_text(label0_nodes, "Length:");
    			label0_nodes.forEach(detach);
    			t1 = claim_space(div0_nodes);

    			input0 = claim_element(div0_nodes, "INPUT", {
    				id: true,
    				type: true,
    				step: true,
    				class: true
    			});

    			div0_nodes.forEach(detach);
    			t2 = claim_space(div16_nodes);
    			div1 = claim_element(div16_nodes, "DIV", { class: true });
    			var div1_nodes = children(div1);

    			input1 = claim_element(div1_nodes, "INPUT", {
    				id: true,
    				type: true,
    				min: true,
    				max: true,
    				step: true,
    				style: true,
    				class: true
    			});

    			div1_nodes.forEach(detach);
    			t3 = claim_space(div16_nodes);
    			div2 = claim_element(div16_nodes, "DIV", { class: true });
    			var div2_nodes = children(div2);
    			label1 = claim_element(div2_nodes, "LABEL", { for: true });
    			var label1_nodes = children(label1);
    			t4 = claim_text(label1_nodes, "Step:");
    			label1_nodes.forEach(detach);
    			t5 = claim_space(div2_nodes);

    			input2 = claim_element(div2_nodes, "INPUT", {
    				id: true,
    				type: true,
    				step: true,
    				class: true
    			});

    			div2_nodes.forEach(detach);
    			t6 = claim_space(div16_nodes);
    			div3 = claim_element(div16_nodes, "DIV", { class: true });
    			var div3_nodes = children(div3);

    			input3 = claim_element(div3_nodes, "INPUT", {
    				id: true,
    				type: true,
    				min: true,
    				max: true,
    				step: true,
    				style: true,
    				class: true
    			});

    			div3_nodes.forEach(detach);
    			t7 = claim_space(div16_nodes);
    			div4 = claim_element(div16_nodes, "DIV", { class: true });
    			var div4_nodes = children(div4);
    			label2 = claim_element(div4_nodes, "LABEL", { for: true });
    			var label2_nodes = children(label2);
    			t8 = claim_text(label2_nodes, "Min X:");
    			label2_nodes.forEach(detach);
    			t9 = claim_space(div4_nodes);

    			input4 = claim_element(div4_nodes, "INPUT", {
    				id: true,
    				type: true,
    				step: true,
    				class: true
    			});

    			div4_nodes.forEach(detach);
    			t10 = claim_space(div16_nodes);
    			div5 = claim_element(div16_nodes, "DIV", { class: true });
    			var div5_nodes = children(div5);

    			input5 = claim_element(div5_nodes, "INPUT", {
    				type: true,
    				min: true,
    				max: true,
    				step: true,
    				style: true,
    				class: true
    			});

    			div5_nodes.forEach(detach);
    			t11 = claim_space(div16_nodes);
    			div6 = claim_element(div16_nodes, "DIV", { class: true });
    			var div6_nodes = children(div6);
    			label3 = claim_element(div6_nodes, "LABEL", { for: true });
    			var label3_nodes = children(label3);
    			t12 = claim_text(label3_nodes, "Max X:");
    			label3_nodes.forEach(detach);
    			t13 = claim_space(div6_nodes);

    			input6 = claim_element(div6_nodes, "INPUT", {
    				id: true,
    				type: true,
    				step: true,
    				class: true
    			});

    			div6_nodes.forEach(detach);
    			t14 = claim_space(div16_nodes);
    			div7 = claim_element(div16_nodes, "DIV", { class: true });
    			var div7_nodes = children(div7);

    			input7 = claim_element(div7_nodes, "INPUT", {
    				type: true,
    				min: true,
    				max: true,
    				step: true,
    				style: true,
    				class: true
    			});

    			div7_nodes.forEach(detach);
    			t15 = claim_space(div16_nodes);
    			div8 = claim_element(div16_nodes, "DIV", { class: true });
    			var div8_nodes = children(div8);
    			label4 = claim_element(div8_nodes, "LABEL", { for: true });
    			var label4_nodes = children(label4);
    			t16 = claim_text(label4_nodes, "Min Y:");
    			label4_nodes.forEach(detach);
    			t17 = claim_space(div8_nodes);

    			input8 = claim_element(div8_nodes, "INPUT", {
    				id: true,
    				type: true,
    				step: true,
    				class: true
    			});

    			div8_nodes.forEach(detach);
    			t18 = claim_space(div16_nodes);
    			div9 = claim_element(div16_nodes, "DIV", { class: true });
    			var div9_nodes = children(div9);

    			input9 = claim_element(div9_nodes, "INPUT", {
    				type: true,
    				min: true,
    				max: true,
    				step: true,
    				style: true,
    				class: true
    			});

    			div9_nodes.forEach(detach);
    			t19 = claim_space(div16_nodes);
    			div10 = claim_element(div16_nodes, "DIV", { class: true });
    			var div10_nodes = children(div10);
    			label5 = claim_element(div10_nodes, "LABEL", { for: true });
    			var label5_nodes = children(label5);
    			t20 = claim_text(label5_nodes, "Max Y:");
    			label5_nodes.forEach(detach);
    			t21 = claim_space(div10_nodes);

    			input10 = claim_element(div10_nodes, "INPUT", {
    				id: true,
    				type: true,
    				step: true,
    				class: true
    			});

    			div10_nodes.forEach(detach);
    			t22 = claim_space(div16_nodes);
    			div11 = claim_element(div16_nodes, "DIV", { class: true });
    			var div11_nodes = children(div11);

    			input11 = claim_element(div11_nodes, "INPUT", {
    				type: true,
    				min: true,
    				max: true,
    				step: true,
    				style: true,
    				class: true
    			});

    			div11_nodes.forEach(detach);
    			t23 = claim_space(div16_nodes);
    			div12 = claim_element(div16_nodes, "DIV", { class: true });
    			var div12_nodes = children(div12);
    			label6 = claim_element(div12_nodes, "LABEL", { for: true });
    			var label6_nodes = children(label6);
    			t24 = claim_text(label6_nodes, "Bounds:");
    			label6_nodes.forEach(detach);
    			t25 = claim_space(div12_nodes);

    			input12 = claim_element(div12_nodes, "INPUT", {
    				id: true,
    				type: true,
    				step: true,
    				class: true
    			});

    			div12_nodes.forEach(detach);
    			t26 = claim_space(div16_nodes);
    			div13 = claim_element(div16_nodes, "DIV", { class: true });
    			var div13_nodes = children(div13);

    			input13 = claim_element(div13_nodes, "INPUT", {
    				type: true,
    				min: true,
    				max: true,
    				step: true,
    				style: true,
    				class: true
    			});

    			div13_nodes.forEach(detach);
    			t27 = claim_space(div16_nodes);
    			div14 = claim_element(div16_nodes, "DIV", { class: true });
    			var div14_nodes = children(div14);
    			label7 = claim_element(div14_nodes, "LABEL", { for: true });
    			var label7_nodes = children(label7);
    			t28 = claim_text(label7_nodes, "Scale:");
    			label7_nodes.forEach(detach);
    			t29 = claim_space(div14_nodes);

    			input14 = claim_element(div14_nodes, "INPUT", {
    				id: true,
    				type: true,
    				step: true,
    				class: true
    			});

    			div14_nodes.forEach(detach);
    			t30 = claim_space(div16_nodes);
    			div15 = claim_element(div16_nodes, "DIV", { class: true });
    			var div15_nodes = children(div15);

    			input15 = claim_element(div15_nodes, "INPUT", {
    				type: true,
    				min: true,
    				max: true,
    				step: true,
    				style: true,
    				class: true
    			});

    			div15_nodes.forEach(detach);
    			div16_nodes.forEach(detach);
    			div17_nodes.forEach(detach);
    			t31 = claim_space(div18_nodes);
    			canvas_1 = claim_element(div18_nodes, "CANVAS", { class: true, style: true });
    			children(canvas_1).forEach(detach);
    			div18_nodes.forEach(detach);
    			t32 = claim_space(nodes);
    			div20 = claim_element(nodes, "DIV", { class: true, style: true });
    			var div20_nodes = children(div20);
    			div19 = claim_element(div20_nodes, "DIV", { id: true, class: true });
    			children(div19).forEach(detach);
    			div20_nodes.forEach(detach);
    			this.h();
    		},
    		h() {
    			attr(label0, "for", "length");
    			attr(input0, "id", "length");
    			attr(input0, "type", "number");
    			attr(input0, "step", "any");
    			attr(input0, "class", "svelte-yx75fm");
    			attr(div0, "class", "input-group svelte-yx75fm");
    			attr(input1, "id", "lengthrange");
    			attr(input1, "type", "range");
    			attr(input1, "min", "0");
    			attr(input1, "max", "10");
    			attr(input1, "step", "0.01");
    			set_style(input1, "width", "200px");
    			attr(input1, "class", "svelte-yx75fm");
    			attr(div1, "class", "input-group svelte-yx75fm");
    			attr(label1, "for", "step");
    			attr(input2, "id", "step");
    			attr(input2, "type", "number");
    			attr(input2, "step", "any");
    			attr(input2, "class", "svelte-yx75fm");
    			attr(div2, "class", "input-group svelte-yx75fm");
    			attr(input3, "id", "steprane");
    			attr(input3, "type", "range");
    			attr(input3, "min", "0");
    			attr(input3, "max", "1");
    			attr(input3, "step", "0.01");
    			set_style(input3, "width", "200px");
    			attr(input3, "class", "svelte-yx75fm");
    			attr(div3, "class", "input-group svelte-yx75fm");
    			attr(label2, "for", "lowx");
    			attr(input4, "id", "lowx");
    			attr(input4, "type", "number");
    			attr(input4, "step", "any");
    			attr(input4, "class", "svelte-yx75fm");
    			attr(div4, "class", "input-group svelte-yx75fm");
    			attr(input5, "type", "range");
    			attr(input5, "min", "-100");
    			attr(input5, "max", "100");
    			attr(input5, "step", "0.01");
    			set_style(input5, "width", "200px");
    			attr(input5, "class", "svelte-yx75fm");
    			attr(div5, "class", "input-group svelte-yx75fm");
    			attr(label3, "for", "maxx");
    			attr(input6, "id", "maxx");
    			attr(input6, "type", "number");
    			attr(input6, "step", "any");
    			attr(input6, "class", "svelte-yx75fm");
    			attr(div6, "class", "input-group svelte-yx75fm");
    			attr(input7, "type", "range");
    			attr(input7, "min", "-100");
    			attr(input7, "max", "100");
    			attr(input7, "step", "0.01");
    			set_style(input7, "width", "200px");
    			attr(input7, "class", "svelte-yx75fm");
    			attr(div7, "class", "input-group svelte-yx75fm");
    			attr(label4, "for", "lowy");
    			attr(input8, "id", "lowy");
    			attr(input8, "type", "number");
    			attr(input8, "step", "any");
    			attr(input8, "class", "svelte-yx75fm");
    			attr(div8, "class", "input-group svelte-yx75fm");
    			attr(input9, "type", "range");
    			attr(input9, "min", "-100");
    			attr(input9, "max", "100");
    			attr(input9, "step", "0.01");
    			set_style(input9, "width", "200px");
    			attr(input9, "class", "svelte-yx75fm");
    			attr(div9, "class", "input-group svelte-yx75fm");
    			attr(label5, "for", "highy");
    			attr(input10, "id", "highy");
    			attr(input10, "type", "number");
    			attr(input10, "step", "any");
    			attr(input10, "class", "svelte-yx75fm");
    			attr(div10, "class", "input-group svelte-yx75fm");
    			attr(input11, "type", "range");
    			attr(input11, "min", "-100");
    			attr(input11, "max", "100");
    			attr(input11, "step", "0.01");
    			set_style(input11, "width", "200px");
    			attr(input11, "class", "svelte-yx75fm");
    			attr(div11, "class", "input-group svelte-yx75fm");
    			attr(label6, "for", "scale");
    			attr(input12, "id", "scale");
    			attr(input12, "type", "number");
    			attr(input12, "step", "any");
    			attr(input12, "class", "svelte-yx75fm");
    			attr(div12, "class", "input-group svelte-yx75fm");
    			attr(input13, "type", "range");
    			attr(input13, "min", "0");
    			attr(input13, "max", "100");
    			attr(input13, "step", "0.01");
    			set_style(input13, "width", "200px");
    			attr(input13, "class", "svelte-yx75fm");
    			attr(div13, "class", "input-group svelte-yx75fm");
    			attr(label7, "for", "scale");
    			attr(input14, "id", "scale");
    			attr(input14, "type", "number");
    			attr(input14, "step", "any");
    			attr(input14, "class", "svelte-yx75fm");
    			attr(div14, "class", "input-group svelte-yx75fm");
    			attr(input15, "type", "range");
    			attr(input15, "min", "0.1");
    			attr(input15, "max", "5");
    			attr(input15, "step", "0.01");
    			set_style(input15, "width", "200px");
    			attr(input15, "class", "svelte-yx75fm");
    			attr(div15, "class", "input-group svelte-yx75fm");
    			attr(div16, "class", "controls-body svelte-yx75fm");
    			attr(div17, "class", "controls svelte-yx75fm");
    			set_style(div17, "height", /*$height*/ ctx[2] + "px");
    			attr(canvas_1, "class", "main-canvas svelte-yx75fm");
    			set_style(canvas_1, "width", /*$width*/ ctx[3] + "px");
    			set_style(canvas_1, "height", /*$height*/ ctx[2] + "px");
    			attr(div18, "class", "container svelte-yx75fm");
    			attr(div19, "id", "editor");
    			attr(div19, "class", "svelte-yx75fm");
    			attr(div20, "class", "container svelte-yx75fm");
    			set_style(div20, "margin-top", "50px");
    		},
    		m(target, anchor) {
    			insert_hydration(target, div18, anchor);
    			append_hydration(div18, div17);
    			append_hydration(div17, div16);
    			append_hydration(div16, div0);
    			append_hydration(div0, label0);
    			append_hydration(label0, t0);
    			append_hydration(div0, t1);
    			append_hydration(div0, input0);
    			set_input_value(input0, /*myInterface*/ ctx[0]._length);
    			append_hydration(div16, t2);
    			append_hydration(div16, div1);
    			append_hydration(div1, input1);
    			set_input_value(input1, /*myInterface*/ ctx[0]._length);
    			append_hydration(div16, t3);
    			append_hydration(div16, div2);
    			append_hydration(div2, label1);
    			append_hydration(label1, t4);
    			append_hydration(div2, t5);
    			append_hydration(div2, input2);
    			set_input_value(input2, /*myInterface*/ ctx[0]._step);
    			append_hydration(div16, t6);
    			append_hydration(div16, div3);
    			append_hydration(div3, input3);
    			set_input_value(input3, /*myInterface*/ ctx[0]._step);
    			append_hydration(div16, t7);
    			append_hydration(div16, div4);
    			append_hydration(div4, label2);
    			append_hydration(label2, t8);
    			append_hydration(div4, t9);
    			append_hydration(div4, input4);
    			set_input_value(input4, /*myInterface*/ ctx[0]._bounds.lowx);
    			append_hydration(div16, t10);
    			append_hydration(div16, div5);
    			append_hydration(div5, input5);
    			set_input_value(input5, /*myInterface*/ ctx[0]._bounds.lowx);
    			append_hydration(div16, t11);
    			append_hydration(div16, div6);
    			append_hydration(div6, label3);
    			append_hydration(label3, t12);
    			append_hydration(div6, t13);
    			append_hydration(div6, input6);
    			set_input_value(input6, /*myInterface*/ ctx[0]._bounds.highx);
    			append_hydration(div16, t14);
    			append_hydration(div16, div7);
    			append_hydration(div7, input7);
    			set_input_value(input7, /*myInterface*/ ctx[0]._bounds.highx);
    			append_hydration(div16, t15);
    			append_hydration(div16, div8);
    			append_hydration(div8, label4);
    			append_hydration(label4, t16);
    			append_hydration(div8, t17);
    			append_hydration(div8, input8);
    			set_input_value(input8, /*myInterface*/ ctx[0]._bounds.lowy);
    			append_hydration(div16, t18);
    			append_hydration(div16, div9);
    			append_hydration(div9, input9);
    			set_input_value(input9, /*myInterface*/ ctx[0]._bounds.lowy);
    			append_hydration(div16, t19);
    			append_hydration(div16, div10);
    			append_hydration(div10, label5);
    			append_hydration(label5, t20);
    			append_hydration(div10, t21);
    			append_hydration(div10, input10);
    			set_input_value(input10, /*myInterface*/ ctx[0]._bounds.highy);
    			append_hydration(div16, t22);
    			append_hydration(div16, div11);
    			append_hydration(div11, input11);
    			set_input_value(input11, /*myInterface*/ ctx[0]._bounds.highy);
    			append_hydration(div16, t23);
    			append_hydration(div16, div12);
    			append_hydration(div12, label6);
    			append_hydration(label6, t24);
    			append_hydration(div12, t25);
    			append_hydration(div12, input12);
    			set_input_value(input12, /*myInterface*/ ctx[0].allBounds);
    			append_hydration(div16, t26);
    			append_hydration(div16, div13);
    			append_hydration(div13, input13);
    			set_input_value(input13, /*myInterface*/ ctx[0].allBounds);
    			append_hydration(div16, t27);
    			append_hydration(div16, div14);
    			append_hydration(div14, label7);
    			append_hydration(label7, t28);
    			append_hydration(div14, t29);
    			append_hydration(div14, input14);
    			set_input_value(input14, /*myInterface*/ ctx[0]._scale);
    			append_hydration(div16, t30);
    			append_hydration(div16, div15);
    			append_hydration(div15, input15);
    			set_input_value(input15, /*myInterface*/ ctx[0]._scale);
    			append_hydration(div18, t31);
    			append_hydration(div18, canvas_1);
    			/*canvas_1_binding*/ ctx[21](canvas_1);
    			insert_hydration(target, t32, anchor);
    			insert_hydration(target, div20, anchor);
    			append_hydration(div20, div19);

    			if (!mounted) {
    				dispose = [
    					listen(input0, "input", /*input0_input_handler*/ ctx[5]),
    					listen(input1, "change", /*input1_change_input_handler*/ ctx[6]),
    					listen(input1, "input", /*input1_change_input_handler*/ ctx[6]),
    					listen(input2, "input", /*input2_input_handler*/ ctx[7]),
    					listen(input3, "change", /*input3_change_input_handler*/ ctx[8]),
    					listen(input3, "input", /*input3_change_input_handler*/ ctx[8]),
    					listen(input4, "input", /*input4_input_handler*/ ctx[9]),
    					listen(input5, "change", /*input5_change_input_handler*/ ctx[10]),
    					listen(input5, "input", /*input5_change_input_handler*/ ctx[10]),
    					listen(input6, "input", /*input6_input_handler*/ ctx[11]),
    					listen(input7, "change", /*input7_change_input_handler*/ ctx[12]),
    					listen(input7, "input", /*input7_change_input_handler*/ ctx[12]),
    					listen(input8, "input", /*input8_input_handler*/ ctx[13]),
    					listen(input9, "change", /*input9_change_input_handler*/ ctx[14]),
    					listen(input9, "input", /*input9_change_input_handler*/ ctx[14]),
    					listen(input10, "input", /*input10_input_handler*/ ctx[15]),
    					listen(input11, "change", /*input11_change_input_handler*/ ctx[16]),
    					listen(input11, "input", /*input11_change_input_handler*/ ctx[16]),
    					listen(input12, "input", /*input12_input_handler*/ ctx[17]),
    					listen(input13, "change", /*input13_change_input_handler*/ ctx[18]),
    					listen(input13, "input", /*input13_change_input_handler*/ ctx[18]),
    					listen(input14, "input", /*input14_input_handler*/ ctx[19]),
    					listen(input15, "change", /*input15_change_input_handler*/ ctx[20]),
    					listen(input15, "input", /*input15_change_input_handler*/ ctx[20])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*myInterface*/ 1 && to_number(input0.value) !== /*myInterface*/ ctx[0]._length) {
    				set_input_value(input0, /*myInterface*/ ctx[0]._length);
    			}

    			if (dirty[0] & /*myInterface*/ 1) {
    				set_input_value(input1, /*myInterface*/ ctx[0]._length);
    			}

    			if (dirty[0] & /*myInterface*/ 1 && to_number(input2.value) !== /*myInterface*/ ctx[0]._step) {
    				set_input_value(input2, /*myInterface*/ ctx[0]._step);
    			}

    			if (dirty[0] & /*myInterface*/ 1) {
    				set_input_value(input3, /*myInterface*/ ctx[0]._step);
    			}

    			if (dirty[0] & /*myInterface*/ 1 && to_number(input4.value) !== /*myInterface*/ ctx[0]._bounds.lowx) {
    				set_input_value(input4, /*myInterface*/ ctx[0]._bounds.lowx);
    			}

    			if (dirty[0] & /*myInterface*/ 1) {
    				set_input_value(input5, /*myInterface*/ ctx[0]._bounds.lowx);
    			}

    			if (dirty[0] & /*myInterface*/ 1 && to_number(input6.value) !== /*myInterface*/ ctx[0]._bounds.highx) {
    				set_input_value(input6, /*myInterface*/ ctx[0]._bounds.highx);
    			}

    			if (dirty[0] & /*myInterface*/ 1) {
    				set_input_value(input7, /*myInterface*/ ctx[0]._bounds.highx);
    			}

    			if (dirty[0] & /*myInterface*/ 1 && to_number(input8.value) !== /*myInterface*/ ctx[0]._bounds.lowy) {
    				set_input_value(input8, /*myInterface*/ ctx[0]._bounds.lowy);
    			}

    			if (dirty[0] & /*myInterface*/ 1) {
    				set_input_value(input9, /*myInterface*/ ctx[0]._bounds.lowy);
    			}

    			if (dirty[0] & /*myInterface*/ 1 && to_number(input10.value) !== /*myInterface*/ ctx[0]._bounds.highy) {
    				set_input_value(input10, /*myInterface*/ ctx[0]._bounds.highy);
    			}

    			if (dirty[0] & /*myInterface*/ 1) {
    				set_input_value(input11, /*myInterface*/ ctx[0]._bounds.highy);
    			}

    			if (dirty[0] & /*myInterface*/ 1 && to_number(input12.value) !== /*myInterface*/ ctx[0].allBounds) {
    				set_input_value(input12, /*myInterface*/ ctx[0].allBounds);
    			}

    			if (dirty[0] & /*myInterface*/ 1) {
    				set_input_value(input13, /*myInterface*/ ctx[0].allBounds);
    			}

    			if (dirty[0] & /*myInterface*/ 1 && to_number(input14.value) !== /*myInterface*/ ctx[0]._scale) {
    				set_input_value(input14, /*myInterface*/ ctx[0]._scale);
    			}

    			if (dirty[0] & /*myInterface*/ 1) {
    				set_input_value(input15, /*myInterface*/ ctx[0]._scale);
    			}

    			if (dirty[0] & /*$height*/ 4) {
    				set_style(div17, "height", /*$height*/ ctx[2] + "px");
    			}

    			if (dirty[0] & /*$width*/ 8) {
    				set_style(canvas_1, "width", /*$width*/ ctx[3] + "px");
    			}

    			if (dirty[0] & /*$height*/ 4) {
    				set_style(canvas_1, "height", /*$height*/ ctx[2] + "px");
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(div18);
    			/*canvas_1_binding*/ ctx[21](null);
    			if (detaching) detach(t32);
    			if (detaching) detach(div20);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }
    const start_scale = 80;

    function updateObject(target, src) {
    	const res = {};

    	Object.keys(target).forEach(k => {
    		var _a;
    		return res[k] = (_a = src[k]) !== null && _a !== void 0 ? _a : target[k];
    	});

    	return res;
    }

    function instance$1($$self, $$props, $$invalidate) {
    	let $height;
    	let $width;
    	component_subscribe($$self, height, $$value => $$invalidate(2, $height = $$value));
    	component_subscribe($$self, width, $$value => $$invalidate(3, $width = $$value));

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
    			if (typeof value === "number") $$invalidate(0, myInterface._length = value, myInterface);
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
    			if (typeof value === "number") $$invalidate(0, myInterface._scale = value, myInterface);
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
    		$$invalidate(4, context$1 = canvas$1.getContext("2d", {}));
    		canvas.set(canvas$1);
    		context.set(context$1);
    		$$invalidate(1, canvas$1.width = document.body.clientWidth / 2, canvas$1);
    		$$invalidate(1, canvas$1.height = document.body.clientHeight / hscale, canvas$1);

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
    		$$invalidate(0, myInterface._scale += clamp(e.wheelDeltaY, -1, 1) * myInterface._scale / 20, myInterface);

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
    		$$invalidate(4, context$1.lineWidth = 2, context$1);
    		$$invalidate(4, context$1.strokeStyle = "rgb(11,153,11)", context$1);
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
    		$$invalidate(4, context$1.strokeStyle = "rgb(0, 0, 0)", context$1);
    		context$1.moveTo(xmin, y0);
    		context$1.lineTo(w, y0); // X axis
    		context$1.moveTo(x0, 0);
    		context$1.lineTo(x0, h); // Y axis
    		$$invalidate(4, context$1.font = "1em Roboto Mono", context$1);
    		$$invalidate(4, context$1.textAlign = "right", context$1);
    		$$invalidate(4, context$1.textBaseline = "middle", context$1);

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

    		$$invalidate(4, context$1.textAlign = "center", context$1);
    		$$invalidate(4, context$1.textBaseline = "top", context$1);

    		for (let i = axes.scale * n; i < context$1.canvas.width / 2; i += axes.scale * n) {
    			context$1.fillText(`${new decimal(i / axes.scale).toNearest(new decimal(0.000001))}`, x0 - i, y0 + 5);
    		}

    		for (let i = axes.scale * n; i < context$1.canvas.width / 2; i += axes.scale * n) {
    			context$1.fillText(`${new decimal(i / axes.scale).toNearest(new decimal(0.000001))}`, x0 + i, y0 + 5);
    		}

    		context$1.stroke();
    	}

    	function input0_input_handler() {
    		myInterface._length = to_number(this.value);
    		$$invalidate(0, myInterface);
    	}

    	function input1_change_input_handler() {
    		myInterface._length = to_number(this.value);
    		$$invalidate(0, myInterface);
    	}

    	function input2_input_handler() {
    		myInterface._step = to_number(this.value);
    		$$invalidate(0, myInterface);
    	}

    	function input3_change_input_handler() {
    		myInterface._step = to_number(this.value);
    		$$invalidate(0, myInterface);
    	}

    	function input4_input_handler() {
    		myInterface._bounds.lowx = to_number(this.value);
    		$$invalidate(0, myInterface);
    	}

    	function input5_change_input_handler() {
    		myInterface._bounds.lowx = to_number(this.value);
    		$$invalidate(0, myInterface);
    	}

    	function input6_input_handler() {
    		myInterface._bounds.highx = to_number(this.value);
    		$$invalidate(0, myInterface);
    	}

    	function input7_change_input_handler() {
    		myInterface._bounds.highx = to_number(this.value);
    		$$invalidate(0, myInterface);
    	}

    	function input8_input_handler() {
    		myInterface._bounds.lowy = to_number(this.value);
    		$$invalidate(0, myInterface);
    	}

    	function input9_change_input_handler() {
    		myInterface._bounds.lowy = to_number(this.value);
    		$$invalidate(0, myInterface);
    	}

    	function input10_input_handler() {
    		myInterface._bounds.highy = to_number(this.value);
    		$$invalidate(0, myInterface);
    	}

    	function input11_change_input_handler() {
    		myInterface._bounds.highy = to_number(this.value);
    		$$invalidate(0, myInterface);
    	}

    	function input12_input_handler() {
    		myInterface.allBounds = to_number(this.value);
    		$$invalidate(0, myInterface);
    	}

    	function input13_change_input_handler() {
    		myInterface.allBounds = to_number(this.value);
    		$$invalidate(0, myInterface);
    	}

    	function input14_input_handler() {
    		myInterface._scale = to_number(this.value);
    		$$invalidate(0, myInterface);
    	}

    	function input15_change_input_handler() {
    		myInterface._scale = to_number(this.value);
    		$$invalidate(0, myInterface);
    	}

    	function canvas_1_binding($$value) {
    		binding_callbacks[$$value ? 'unshift' : 'push'](() => {
    			canvas$1 = $$value;
    			$$invalidate(1, canvas$1);
    		});
    	}

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty[0] & /*context, myInterface*/ 17) {
    			{
    				if (context$1) {
    					display(myInterface._step, myInterface._scale, myInterface._bounds, myInterface._length);
    				}
    			}
    		}
    	};

    	return [
    		myInterface,
    		canvas$1,
    		$height,
    		$width,
    		context$1,
    		input0_input_handler,
    		input1_change_input_handler,
    		input2_input_handler,
    		input3_change_input_handler,
    		input4_input_handler,
    		input5_change_input_handler,
    		input6_input_handler,
    		input7_change_input_handler,
    		input8_input_handler,
    		input9_change_input_handler,
    		input10_input_handler,
    		input11_change_input_handler,
    		input12_input_handler,
    		input13_change_input_handler,
    		input14_input_handler,
    		input15_change_input_handler,
    		canvas_1_binding
    	];
    }

    class SlopeField extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$1, create_fragment$1, safe_not_equal, {}, null, [-1, -1]);
    	}
    }

    /* src\App.svelte generated by Svelte v3.45.0 */

    function create_default_slot(ctx) {
    	let div;
    	let route0;
    	let t0;
    	let route1;
    	let t1;
    	let route2;
    	let t2;
    	let route3;
    	let t3;
    	let route4;
    	let current;

    	route0 = new Route$1({
    			props: {
    				path: "/school/calculus/0.2",
    				component: Math$1
    			}
    		});

    	route1 = new Route$1({
    			props: {
    				path: "/slopefield",
    				component: SlopeField
    			}
    		});

    	route2 = new Route$1({
    			props: { path: "/register", component: Register }
    		});

    	route3 = new Route$1({
    			props: { path: "/login", component: Login }
    		});

    	route4 = new Route$1({ props: { path: "/", component: Home } });

    	return {
    		c() {
    			div = element("div");
    			create_component(route0.$$.fragment);
    			t0 = space();
    			create_component(route1.$$.fragment);
    			t1 = space();
    			create_component(route2.$$.fragment);
    			t2 = space();
    			create_component(route3.$$.fragment);
    			t3 = space();
    			create_component(route4.$$.fragment);
    		},
    		l(nodes) {
    			div = claim_element(nodes, "DIV", {});
    			var div_nodes = children(div);
    			claim_component(route0.$$.fragment, div_nodes);
    			t0 = claim_space(div_nodes);
    			claim_component(route1.$$.fragment, div_nodes);
    			t1 = claim_space(div_nodes);
    			claim_component(route2.$$.fragment, div_nodes);
    			t2 = claim_space(div_nodes);
    			claim_component(route3.$$.fragment, div_nodes);
    			t3 = claim_space(div_nodes);
    			claim_component(route4.$$.fragment, div_nodes);
    			div_nodes.forEach(detach);
    		},
    		m(target, anchor) {
    			insert_hydration(target, div, anchor);
    			mount_component(route0, div, null);
    			append_hydration(div, t0);
    			mount_component(route1, div, null);
    			append_hydration(div, t1);
    			mount_component(route2, div, null);
    			append_hydration(div, t2);
    			mount_component(route3, div, null);
    			append_hydration(div, t3);
    			mount_component(route4, div, null);
    			current = true;
    		},
    		p: noop,
    		i(local) {
    			if (current) return;
    			transition_in(route0.$$.fragment, local);
    			transition_in(route1.$$.fragment, local);
    			transition_in(route2.$$.fragment, local);
    			transition_in(route3.$$.fragment, local);
    			transition_in(route4.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(route0.$$.fragment, local);
    			transition_out(route1.$$.fragment, local);
    			transition_out(route2.$$.fragment, local);
    			transition_out(route3.$$.fragment, local);
    			transition_out(route4.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			destroy_component(route0);
    			destroy_component(route1);
    			destroy_component(route2);
    			destroy_component(route3);
    			destroy_component(route4);
    		}
    	};
    }

    function create_fragment(ctx) {
    	let router;
    	let current;

    	router = new Router$1({
    			props: {
    				url: /*url*/ ctx[0],
    				$$slots: { default: [create_default_slot] },
    				$$scope: { ctx }
    			}
    		});

    	return {
    		c() {
    			create_component(router.$$.fragment);
    		},
    		l(nodes) {
    			claim_component(router.$$.fragment, nodes);
    		},
    		m(target, anchor) {
    			mount_component(router, target, anchor);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			const router_changes = {};
    			if (dirty & /*url*/ 1) router_changes.url = /*url*/ ctx[0];

    			if (dirty & /*$$scope*/ 2) {
    				router_changes.$$scope = { dirty, ctx };
    			}

    			router.$set(router_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(router.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(router.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(router, detaching);
    		}
    	};
    }

    function instance($$self, $$props, $$invalidate) {
    	let { url = "/" } = $$props;

    	$$self.$$set = $$props => {
    		if ('url' in $$props) $$invalidate(0, url = $$props.url);
    	};

    	return [url];
    }

    class App extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance, create_fragment, safe_not_equal, { url: 0 });
    	}
    }

    const app = new App({
        target: document.getElementById('app'),
        hydrate: true
    });

    return app;

})();
//# sourceMappingURL=bundle.js.map
