import { env } from 'cloudflare:workers';
import { bridge, type ApiBinding } from '#lib/api-bridge.ts';
import { nativeApi } from '#lib/native-api.ts';
import type { RequestHandler } from './$types';

// Keep the API binding as an explicit rollback path until native mode is selected.
const dispatch: RequestHandler = ({ request }) =>
  env.AFTERPARTY_NATIVE_API === '1'
    ? nativeApi(request)
    : bridge(request, env.AFTERPARTY_API as ApiBinding | undefined);

export {
  dispatch as GET,
  dispatch as HEAD,
  dispatch as POST,
  dispatch as PUT,
  dispatch as PATCH,
  dispatch as DELETE,
  dispatch as OPTIONS,
};
