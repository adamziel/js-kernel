const urlModule = require('../../../node_modules/url/url.js');

// class Url extends urlModule.Url {
// 	constructor(urlStr, base) {
// 		super();
// 		const parsed = new URL(urlStr, base);
// 		this.protocol = parsed.protocol;
// 		this.slashes = parsed.href.includes('//');
// 		this.auth = parsed.username ? `${parsed.username}:${parsed.password}` : null;
// 		this.host = parsed.host;
// 		this.port = parsed.port;
// 		this.hostname = parsed.hostname;
// 		this.hash = parsed.hash;
// 		this.search = parsed.search;
// 		this.query = parsed.searchParams.toString();
// 		this.pathname = parsed.pathname;
// 		this.path = `${parsed.pathname}${parsed.search}`;
// 		this.href = parsed.href;
// 	}
// }

// module.exports = {
// 	...urlModule,
// 	urlParse: (urlStr, base) => {
// 		return new Url(urlStr, base);
// 	},
// 	Url: Url,
// 	URL: Url,
// };

// module.exports = {
// 	...urlModule,
// 	Url: window.URL, //urlModule.Url,
// 	URL: window.URL, //urlModule.Url,
// };

// Parse a URL string into its components
function urlParse(urlStr, parseQueryString, slashesDenoteHost) {
	if (!urlStr) {
		return null;
	}
	
	if (typeof urlStr !== 'string') {
		throw new TypeError("Parameter 'url' must be a string, not " + typeof urlStr);
	}
	
	const result = {
		protocol: null,
		slashes: null,
		auth: null,
		host: null,
		port: null,
		hostname: null,
		hash: null,
		search: null,
		query: null,
		pathname: null,
		path: null,
		href: urlStr
	};
	
	try {
		// Try to use native URL parser
		const parsed = new URL(urlStr);
		
		result.protocol = parsed.protocol;//.slice(0, -1); // Remove trailing ':'
		result.slashes = true;
		result.host = parsed.host;
		result.hostname = parsed.hostname;
		result.port = parsed.port || null;
		result.pathname = parsed.pathname;
		result.search = parsed.search || null;
		result.hash = parsed.hash || null;
		result.href = parsed.href;
		
		// Extract auth from username/password
		if (parsed.username || parsed.password) {
			result.auth = parsed.username;
			if (parsed.password) {
				result.auth += ':' + parsed.password;
			}
		}
		
		// Parse query string if requested
		if (parseQueryString && result.search) {
			result.query = parseQuery(result.search.slice(1));
		} else if (result.search) {
			result.query = result.search.slice(1);
		}
		
		// Set path (pathname + search)
		result.path = (result.pathname || '') + (result.search || '');
		
	} catch (e) {
		// If URL parsing fails, try to parse relative URLs or simple paths
		const hashIndex = urlStr.indexOf('#');
		const queryIndex = urlStr.indexOf('?');
		
		let path = urlStr;
		
		if (hashIndex !== -1) {
			result.hash = urlStr.slice(hashIndex);
			path = urlStr.slice(0, hashIndex);
		}
		
		if (queryIndex !== -1 && (hashIndex === -1 || queryIndex < hashIndex)) {
			const searchEnd = hashIndex !== -1 ? hashIndex : urlStr.length;
			result.search = urlStr.slice(queryIndex, searchEnd);
			path = urlStr.slice(0, queryIndex);
			
			if (parseQueryString) {
				result.query = parseQuery(result.search.slice(1));
			} else {
				result.query = result.search.slice(1);
			}
		}
		
		result.pathname = path;
		result.path = path + (result.search || '');
	}
	
	return result;
}

// Helper to parse query string into object
function parseQuery(queryStr) {
	const result = {};
	if (!queryStr) return result;
	
	const pairs = queryStr.split('&');
	for (const pair of pairs) {
		const [key, value] = pair.split('=');
		const decodedKey = decodeURIComponent(key);
		const decodedValue = value ? decodeURIComponent(value) : '';
		result[decodedKey] = decodedValue;
	}
	
	return result;
}

// Helper to stringify query object
function stringifyQuery(obj) {
	if (!obj || typeof obj !== 'object') return '';
	
	const pairs = [];
	for (const key in obj) {
		if (obj.hasOwnProperty(key)) {
			const value = obj[key];
			pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
		}
	}
	
	return pairs.join('&');
}

// Format a URL object back into a string
function urlFormat(urlObj) {
	if (typeof urlObj === 'string') {
		return urlObj;
	}
	
	if (!urlObj || typeof urlObj !== 'object') {
		return '';
	}
	
	let result = '';
	
	// Protocol
	if (urlObj.protocol) {
		result += urlObj.protocol;
		if (!urlObj.protocol.endsWith(':')) {
			result += ':';
		}
	}
	
	// Slashes
	if (urlObj.slashes || urlObj.protocol) {
		result += '//';
	}
	
	// Auth
	if (urlObj.auth) {
		result += urlObj.auth + '@';
	}
	
	// Host (hostname + port)
	if (urlObj.host) {
		result += urlObj.host;
	} else if (urlObj.hostname) {
		result += urlObj.hostname;
		if (urlObj.port) {
			result += ':' + urlObj.port;
		}
	}
	
	// Pathname
	if (urlObj.pathname) {
		result += urlObj.pathname;
	}
	
	// Search/Query
	if (urlObj.search) {
		result += urlObj.search;
	} else if (urlObj.query) {
		const queryStr = typeof urlObj.query === 'object' 
			? stringifyQuery(urlObj.query)
			: urlObj.query;
		if (queryStr) {
			result += '?' + queryStr;
		}
	}
	
	// Hash
	if (urlObj.hash) {
		if (!urlObj.hash.startsWith('#')) {
			result += '#';
		}
		result += urlObj.hash;
	}
	
	return result;
}

// Resolve a relative URL against a base URL
function urlResolve(from, to) {
	if (!from || !to) {
		return to || from;
	}
	
	try {
		const resolved = new URL(to, from);
		return resolved.href;
	} catch (e) {
		// Fallback: if URL parsing fails, return the 'to' URL
		return to;
	}
}

// Resolve a relative URL object against a base URL
function urlResolveObject(from, to) {
	const resolvedUrl = urlResolve(from, to);
	return urlParse(resolvedUrl, false, true);
}


module.exports = {
	Url: window.URL,
	URL: window.URL,

	parse: urlParse,
	resolve: urlResolve,
	resolveObject: urlResolveObject,
	format: urlFormat,
};