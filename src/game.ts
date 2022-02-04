import { onMount } from 'svelte'
import { writable } from 'svelte/store'

export const width = writable();
export const height = writable();
export const pixelRatio = writable();
export const context = writable();
export const canvas = writable();
