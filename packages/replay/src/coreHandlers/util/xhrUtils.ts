import type { Breadcrumb, TextEncoderInternal, XhrBreadcrumbData } from '@sentry/types';
import { SENTRY_XHR_DATA_KEY, logger } from '@sentry/utils';

import { DEBUG_BUILD } from '../../debug-build';
import type {
  NetworkMetaWarning,
  ReplayContainer,
  ReplayNetworkOptions,
  ReplayNetworkRequestData,
  XhrHint,
} from '../../types';
import { addNetworkBreadcrumb } from './addNetworkBreadcrumb';
import {
  buildNetworkRequestOrResponse,
  buildSkippedNetworkRequestOrResponse,
  getAllowedHeaders,
  getBodySize,
  getBodyString,
  makeNetworkReplayBreadcrumb,
  mergeWarning,
  parseContentLengthHeader,
  urlMatches,
} from './networkUtils';

/**
 * Capture an XHR breadcrumb to a replay.
 * This adds additional data (where approriate).
 */
export async function captureXhrBreadcrumbToReplay(
  breadcrumb: Breadcrumb & { data: XhrBreadcrumbData },
  hint: Partial<XhrHint>,
  options: ReplayNetworkOptions & { replay: ReplayContainer },
): Promise<void> {
  try {
    const data = _prepareXhrData(breadcrumb, hint, options);

    // Create a replay performance entry from this breadcrumb
    const result = makeNetworkReplayBreadcrumb('resource.xhr', data);
    addNetworkBreadcrumb(options.replay, result);
  } catch (error) {
    DEBUG_BUILD && logger.error('[Replay] Failed to capture xhr breadcrumb', error);
  }
}

/**
 * Enrich a breadcrumb with additional data.
 * This has to be sync & mutate the given breadcrumb,
 * as the breadcrumb is afterwards consumed by other handlers.
 */
export function enrichXhrBreadcrumb(
  breadcrumb: Breadcrumb & { data: XhrBreadcrumbData },
  hint: Partial<XhrHint>,
  options: { textEncoder: TextEncoderInternal },
): void {
  const { xhr, input } = hint;

  if (!xhr) {
    return;
  }

  const reqSize = getBodySize(input, options.textEncoder);
  const resSize = xhr.getResponseHeader('content-length')
    ? parseContentLengthHeader(xhr.getResponseHeader('content-length'))
    : getBodySize(xhr.response, options.textEncoder);

  if (reqSize !== undefined) {
    breadcrumb.data.request_body_size = reqSize;
  }
  if (resSize !== undefined) {
    breadcrumb.data.response_body_size = resSize;
  }
}

function _prepareXhrData(
  breadcrumb: Breadcrumb & { data: XhrBreadcrumbData },
  hint: Partial<XhrHint>,
  options: ReplayNetworkOptions,
): ReplayNetworkRequestData | null {
  const now = Date.now();
  const { startTimestamp = now, endTimestamp = now, input, xhr } = hint;

  const {
    url,
    method,
    status_code: statusCode = 0,
    request_body_size: requestBodySize,
    response_body_size: responseBodySize,
  } = breadcrumb.data;

  if (!url) {
    return null;
  }

  if (!xhr || !urlMatches(url, options.networkDetailAllowUrls) || urlMatches(url, options.networkDetailDenyUrls)) {
    const request = buildSkippedNetworkRequestOrResponse(requestBodySize);
    const response = buildSkippedNetworkRequestOrResponse(responseBodySize);
    return {
      startTimestamp,
      endTimestamp,
      url,
      method,
      statusCode,
      request,
      response,
    };
  }

  const xhrInfo = xhr[SENTRY_XHR_DATA_KEY];
  const networkRequestHeaders = xhrInfo
    ? getAllowedHeaders(xhrInfo.request_headers, options.networkRequestHeaders)
    : {};
  const networkResponseHeaders = getAllowedHeaders(getResponseHeaders(xhr), options.networkResponseHeaders);

  const [requestBody, requestWarning] = options.networkCaptureBodies ? getBodyString(input) : [undefined];
  const [responseBody, responseWarning] = options.networkCaptureBodies ? _getXhrResponseBody(xhr) : [undefined];

  const request = buildNetworkRequestOrResponse(networkRequestHeaders, requestBodySize, requestBody);
  const response = buildNetworkRequestOrResponse(networkResponseHeaders, responseBodySize, responseBody);

  return {
    startTimestamp,
    endTimestamp,
    url,
    method,
    statusCode,
    request: requestWarning ? mergeWarning(request, requestWarning) : request,
    response: responseWarning ? mergeWarning(response, responseWarning) : response,
  };
}

function getResponseHeaders(xhr: XMLHttpRequest): Record<string, string> {
  const headers = xhr.getAllResponseHeaders();

  if (!headers) {
    return {};
  }

  return headers.split('\r\n').reduce((acc: Record<string, string>, line: string) => {
    const [key, value] = line.split(': ');
    acc[key.toLowerCase()] = value;
    return acc;
  }, {});
}

function _getXhrResponseBody(xhr: XMLHttpRequest): [string | undefined, NetworkMetaWarning?] {
  // We collect errors that happen, but only log them if we can't get any response body
  const errors: unknown[] = [];

  try {
    return [xhr.responseText];
  } catch (e) {
    errors.push(e);
  }

  // Try to manually parse the response body, if responseText fails
  try {
    const response = xhr.response;
    return getBodyString(response);
  } catch (e) {
    errors.push(e);
  }

  DEBUG_BUILD && logger.warn('[Replay] Failed to get xhr response body', ...errors);

  return [undefined];
}
