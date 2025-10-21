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
	getRandomValues(array) {
		for(let i = 0; i < array.length; i++) {
			array[i] = Math.floor(Math.random() * 256);
		}
		return array;
	},
 };
