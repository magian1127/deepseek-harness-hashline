declare module 'react' {
  const React: any
  export default React
}
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  export const DiffBlock: any
  export const DisclosureRow: any
  export const ReadBlock: any
  export const StateDot: any
  export const writeClipboard: (text: string) => Promise<boolean>
}