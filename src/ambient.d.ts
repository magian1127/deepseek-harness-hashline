declare module '@deepseek-ai/dsh-llm' {
  export class HarnessError extends Error {
    readonly code: string
    constructor(message: string, code: string, options?: ErrorOptions)
  }
}

declare module '@deepseek-ai/schemastery' {
  const z: any
  export default z
}

declare module 'react' {
  const React: any
  export default React
}
