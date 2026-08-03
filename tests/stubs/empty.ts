// Stand-in for the `server-only` package inside Vitest. The real module throws
// when imported outside a React Server Component graph, which would break any
// unit test that transitively touches the data-access layer.
export {}
