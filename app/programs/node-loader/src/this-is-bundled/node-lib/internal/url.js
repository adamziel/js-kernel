const internalUrl = require('../../../../node/lib/internal/url');

module.exports = {
	...internalUrl,
	URL: require('../url').URL,
	pathToFileURL: (filepath) => {
		console.log('pathToFileURL', filepath);
		return new URL(`file://${filepath}`);
	},
};
