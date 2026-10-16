import { handleRevokeShare, onRequestOptions, type Env } from './share';

export { onRequestOptions };

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  return handleRevokeShare(request, env);
};
