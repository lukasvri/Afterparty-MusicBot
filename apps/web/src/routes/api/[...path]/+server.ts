import { nativeApi } from '#lib/server/native-api.ts';
import type { RequestHandler } from './$types';

const dispatch: RequestHandler = ({ request }) => nativeApi(request);

export {
  dispatch as GET,
  dispatch as HEAD,
  dispatch as POST,
  dispatch as PUT,
  dispatch as PATCH,
  dispatch as DELETE,
  dispatch as OPTIONS,
};
