const cryptoBrowserifyModule = require('../../../node_modules/crypto-browserify/index.js');

module.exports = {
	...cryptoBrowserifyModule,
	getBundledRootCertificates() {
		return [];
	},
	getExtraCACertificates() {
		return [];
	},
	getSystemCACertificates() {
		return [];
	},
	getUserRootCertificates() {
		return [];
	},
 };
