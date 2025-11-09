const estimatedHeapStats = () => {
    var _a, _b, _c, _d, _e, _f, _g;
    // Use performance.memory if available, otherwise provide fallback estimates.
    const memory = performance === null || performance === void 0 ? void 0 : performance.memory;
    if (memory) {
        return {
            total_heap_size: (_a = memory.totalJSHeapSize) !== null && _a !== void 0 ? _a : 0,
            total_heap_size_executable: (_b = memory.jsHeapSizeLimit) !== null && _b !== void 0 ? _b : 0,
            total_physical_size: (_c = memory.totalJSHeapSize) !== null && _c !== void 0 ? _c : 0,
            total_available_size: Math.max(((_d = memory.jsHeapSizeLimit) !== null && _d !== void 0 ? _d : 0) - ((_e = memory.usedJSHeapSize) !== null && _e !== void 0 ? _e : 0), 0),
            used_heap_size: (_f = memory.usedJSHeapSize) !== null && _f !== void 0 ? _f : 0,
            heap_size_limit: (_g = memory.jsHeapSizeLimit) !== null && _g !== void 0 ? _g : 0,
            malloced_memory: 0,
            peak_malloced_memory: 0,
            does_zap_garbage: 0,
            number_of_native_contexts: 1,
            number_of_detached_contexts: 0,
        };
    }
    const limit = 128 * 1024 * 1024;
    return {
        total_heap_size: limit,
        total_heap_size_executable: limit,
        total_physical_size: limit,
        total_available_size: limit,
        used_heap_size: 0,
        heap_size_limit: limit,
        malloced_memory: 0,
        peak_malloced_memory: 0,
        does_zap_garbage: 0,
        number_of_native_contexts: 1,
        number_of_detached_contexts: 0,
    };
};
export const getHeapStatistics = () => {
    return estimatedHeapStats();
};
export const getHeapSpaceStatistics = () => [];
export function serialize(value) {
    stableConsole.log({value})
    // Create a structured representation that can handle special types
    const seen = new WeakMap();
    let refId = 0;

    function serializeValue(val) {
        // Handle primitives
        if (val === null) return { type: 'null' };
        if (val === undefined) return { type: 'undefined' };
        
        const type = typeof val;
        
        if (type === 'boolean' || type === 'number' || type === 'string') {
            return { type, value: val };
        }
        
        if (type === 'bigint') {
            return { type: 'bigint', value: val.toString() };
        }
        
        if (type === 'symbol') {
            return { type: 'symbol', value: val.description };
        }
        
        // Handle circular references
        if (typeof val === 'object') {
            if (seen.has(val)) {
                return { type: 'ref', id: seen.get(val) };
            }
            const id = refId++;
            seen.set(val, id);
        }
        
        // Handle Date
        if (val instanceof Date) {
            return { type: 'Date', value: val.toISOString() };
        }
        
        // Handle RegExp
        if (val instanceof RegExp) {
            return { type: 'RegExp', source: val.source, flags: val.flags };
        }
        
        // Handle Error objects
        if (val instanceof Error) {
            return {
                type: 'Error',
                name: val.name,
                message: val.message,
                stack: val.stack
            };
        }
        
        // Handle Map
        if (val instanceof Map) {
            const entries = Array.from(val.entries()).map(([k, v]) => [
                serializeValue(k),
                serializeValue(v)
            ]);
            return { type: 'Map', entries };
        }
        
        // Handle Set
        if (val instanceof Set) {
            const values = Array.from(val).map(v => serializeValue(v));
            return { type: 'Set', values };
        }
        
        // Handle Buffer (must be before Typed Arrays since Buffer extends Uint8Array)
        if (typeof Buffer !== 'undefined' && val instanceof Buffer) {
            return {
                type: 'Buffer',
                values: Array.from(val)
            };
        }
        
        // Handle Typed Arrays (including Uint8Array, Int8Array, etc.)
        if (ArrayBuffer.isView(val) && !(val instanceof DataView)) {
            const typedArray = val;
            return {
                type: typedArray.constructor.name,
                values: Array.from(typedArray)
            };
        }
        
        // Handle ArrayBuffer
        if (val instanceof ArrayBuffer) {
            return {
                type: 'ArrayBuffer',
                values: Array.from(new Uint8Array(val))
            };
        }
        
        // Handle DataView
        if (val instanceof DataView) {
            return {
                type: 'DataView',
                buffer: Array.from(new Uint8Array(val.buffer)),
                byteOffset: val.byteOffset,
                byteLength: val.byteLength
            };
        }
        
        // Handle Array
        if (Array.isArray(val)) {
            return {
                type: 'Array',
                values: val.map(v => serializeValue(v))
            };
        }
        
        // Handle plain objects
        if (val.constructor === Object || val.constructor === undefined) {
            const entries = Object.entries(val).map(([k, v]) => [k, serializeValue(v)]);
            return { type: 'Object', entries };
        }
        
        // For other objects, try to serialize as plain object
        try {
            const entries = Object.entries(val).map(([k, v]) => [k, serializeValue(v)]);
            return { type: 'Object', entries, className: val.constructor?.name };
        } catch (e) {
            // Don't tolerate errors
            throw e;
        }
    }
    
    const serialized = serializeValue(value);
    const json = JSON.stringify(serialized);
    
    // Convert to Uint8Array (Buffer-like) to match Node.js v8.serialize behavior
    const encoder = new TextEncoder();
    return encoder.encode(json);
}

export function deserialize(buffer) {
    // Convert from Uint8Array/Buffer to string
    let json;
    if (buffer instanceof Uint8Array || buffer instanceof ArrayBuffer) {
        const decoder = new TextDecoder();
        json = decoder.decode(buffer);
    } else if (typeof buffer === 'string') {
        json = buffer;
    } else {
        throw new Error('deserialize expects a Uint8Array, ArrayBuffer, or string');
    }
    
    const serialized = JSON.parse(json);
    const refs = new Map();
    
    function deserializeValue(val) {
        if (!val || typeof val !== 'object' || !val.type) {
            return val;
        }
        
        const { type } = val;
        
        // Handle primitives
        if (type === 'null') return null;
        if (type === 'undefined') return undefined;
        if (type === 'boolean' || type === 'number' || type === 'string') {
            return val.value;
        }
        if (type === 'bigint') return BigInt(val.value);
        if (type === 'symbol') return Symbol(val.value);
        
        // Handle references
        if (type === 'ref') {
            return refs.get(val.id);
        }
        
        // Handle Date
        if (type === 'Date') {
            return new Date(val.value);
        }
        
        // Handle RegExp
        if (type === 'RegExp') {
            return new RegExp(val.source, val.flags);
        }
        
        // Handle Error
        if (type === 'Error') {
            const err = new Error(val.message);
            err.name = val.name;
            err.stack = val.stack;
            return err;
        }
        
        // Handle Map
        if (type === 'Map') {
            const map = new Map();
            for (const [k, v] of val.entries) {
                map.set(deserializeValue(k), deserializeValue(v));
            }
            return map;
        }
        
        // Handle Set
        if (type === 'Set') {
            const set = new Set();
            for (const v of val.values) {
                set.add(deserializeValue(v));
            }
            return set;
        }
        
        // Handle Buffer (must be before Typed Arrays)
        if (type === 'Buffer') {
            if (typeof Buffer !== 'undefined') {
                return Buffer.from(val.values);
            } else {
                // Fall back to Uint8Array if Buffer is not available
                return new Uint8Array(val.values);
            }
        }
        
        // Handle Typed Arrays
        const typedArrayTypes = {
            'Int8Array': Int8Array,
            'Uint8Array': Uint8Array,
            'Uint8ClampedArray': Uint8ClampedArray,
            'Int16Array': Int16Array,
            'Uint16Array': Uint16Array,
            'Int32Array': Int32Array,
            'Uint32Array': Uint32Array,
            'Float32Array': Float32Array,
            'Float64Array': Float64Array,
            'BigInt64Array': BigInt64Array,
            'BigUint64Array': BigUint64Array
        };
        
        if (typedArrayTypes[type]) {
            return new typedArrayTypes[type](val.values);
        }
        
        // Handle ArrayBuffer
        if (type === 'ArrayBuffer') {
            return new Uint8Array(val.values).buffer;
        }
        
        // Handle DataView
        if (type === 'DataView') {
            const buffer = new Uint8Array(val.buffer).buffer;
            return new DataView(buffer, val.byteOffset, val.byteLength);
        }
        
        // Handle Array
        if (type === 'Array') {
            return val.values.map(v => deserializeValue(v));
        }
        
        // Handle Object
        if (type === 'Object') {
            const obj = {};
            for (const [k, v] of val.entries) {
                obj[k] = deserializeValue(v);
            }
            return obj;
        }
        
        return undefined;
    }
    
    return deserializeValue(serialized);
}
export default {
    getHeapStatistics,
    getHeapSpaceStatistics,
    serialize,
    deserialize,
};
