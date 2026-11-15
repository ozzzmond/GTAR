import type { ExtensionContext } from '../contract'
export function activate(ctx: ExtensionContext): () => void { return ctx.startBandSync?.() ?? (() => {}) }
