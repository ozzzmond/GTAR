import { createStageCast2Worker } from '../../workers/stageCast2Worker.ts'
import type { AuthEnv } from '../lib/authCore.ts'

interface Cast2PagesEnv extends AuthEnv {
  CAST2_MODE?: string
  CAST2_ORIGIN?: string
  CAST2_HUB?: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } }
  CAST2_WORKER?: { fetch(request: Request): Promise<Response> }
}

const worker = createStageCast2Worker()

export const onRequest = async (context: { request: Request; env: Cast2PagesEnv }): Promise<Response> => {
  if (context.env.CAST2_WORKER) {
    return context.env.CAST2_WORKER.fetch(context.request)
  }
  return worker.fetch(context.request, context.env)
}
