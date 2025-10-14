const cjsLoader = require("../../../../../../node/lib/internal/modules/cjs/loader.js");

module.exports = cjsLoader;

const originalModuleLoad = cjsLoader.Module._load;
cjsLoader.Module._load = function (request, parent, isMain) {
	const requestWithoutNode = request.startsWith("node:") ? request.slice(5) : request;
	if(!request.startsWith("node:") && (requestWithoutNode in globalThis.coreModules)) {
		request = `node:${request}`;
	}

	return originalModuleLoad(request, parent, isMain);
};