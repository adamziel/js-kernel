import undici from '../../../../deps/undici/undici.js';

const {
    Request: NodeRequest,
    Response: NodeResponse,
    Headers: NodeHeaders,
    FormData: NodeFormData
} = undici;

console.log({NodeRequest})

const browserFetch = window.fetch.bind(window);

function headersToEntries(headers) {
    if (!headers) {
        return [];
    }
    const entries = [];
    headers.forEach((value, key) => {
        entries.push([key, value]);
    });
    return entries;
}

function defineReadonly(target, key, value) {
    try {
        Object.defineProperty(target, key, {
            configurable: true,
            enumerable: true,
            value,
            writable: false,
        });
    } catch {
        // Ignore if the property is already defined and non-configurable.
    }
}

async function extractBrowserBody(request) {
    if (request.method === 'GET' || request.method === 'HEAD') {
        return { body: undefined, requiresDuplex: false };
    }

    if (!request.body) {
        return { body: undefined, requiresDuplex: false };
    }

    if (typeof request.body.getReader === 'function' && typeof ReadableStream === 'function') {
        const reader = request.body.getReader();
        const stream = new ReadableStream({
            async pull(controller) {
                try {
                    const { done, value } = await reader.read();
                    if (done) {
                        reader.releaseLock?.();
                        controller.close();
                        return;
                    }
                    controller.enqueue(value);
                } catch (error) {
                    controller.error(error);
                }
            },
            cancel(reason) {
                reader.releaseLock?.();
                return reader.cancel?.(reason);
            }
        });
        return { body: stream, requiresDuplex: true };
    }

    const arrayBuffer = await request.arrayBuffer();
    return { body: arrayBuffer, requiresDuplex: false };
}

function createNodeResponse(response) {
    const responseInit = {
        status: response.status,
        statusText: response.statusText,
        headers: headersToEntries(response.headers)
    };

    const nodeResponse = new NodeResponse(response.body ?? null, responseInit);

    if (typeof response.url === 'string') {
        defineReadonly(nodeResponse, 'url', response.url);
    }

    if (typeof response.redirected === 'boolean') {
        defineReadonly(nodeResponse, 'redirected', response.redirected);
    }

    if (typeof response.type === 'string') {
        defineReadonly(nodeResponse, 'type', response.type);
    }

    return nodeResponse;
}

export async function fetch(input, init) {
    const request = input instanceof NodeRequest && init === undefined
        ? input
        : new NodeRequest(input, init);

    const headersEntries = headersToEntries(request.headers);
    const headersInit = headersEntries.length > 0 ? headersEntries : undefined;
    const { body, requiresDuplex } = await extractBrowserBody(request);

    const browserInit = {
        method: request.method,
        signal: request.signal ?? undefined,
    };

    if (headersInit) {
        browserInit.headers = headersInit;
    }

    if (body !== undefined) {
        browserInit.body = body;
    }

    if (requiresDuplex && typeof ReadableStream === 'function') {
        browserInit.duplex = 'half';
    }

    if (request.credentials && request.credentials !== 'same-origin') {
        browserInit.credentials = request.credentials;
    }

    if (request.cache && request.cache !== 'default') {
        browserInit.cache = request.cache;
    }

    if (request.integrity) {
        browserInit.integrity = request.integrity;
    }

    if (request.keepalive) {
        browserInit.keepalive = request.keepalive;
    }

    if (request.redirect && request.redirect !== 'follow') {
        browserInit.redirect = request.redirect;
    }

    if (request.referrer && request.referrer !== 'about:client') {
        browserInit.referrer = request.referrer;
    }

    if (request.referrerPolicy && request.referrerPolicy !== '') {
        browserInit.referrerPolicy = request.referrerPolicy;
    }

    if (request.mode && request.mode !== 'cors') {
        browserInit.mode = request.mode;
    }

    if (request.priority && request.priority !== 'auto') {
        browserInit.priority = request.priority;
    }

    const response = await browserFetch(request.url, browserInit);
    return createNodeResponse(response);
}

export const Request = NodeRequest;
export const Response = NodeResponse;
export const Headers = NodeHeaders;
export const FormData = NodeFormData;

export default fetch;
