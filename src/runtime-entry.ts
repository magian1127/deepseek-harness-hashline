// Compatibility shim for development processes that loaded the versioned Host entry.
// @ts-ignore DSH uses the query to load a versioned compatibility entry.
export { apply, inject, name } from './index.js?entry=0.1.0'