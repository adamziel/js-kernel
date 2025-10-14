const { decompress: brotliDecompress } = require('brotli-compress/js');
module.exports = require('browserify-zlib');
module.exports.brotliDecompressSync = function (buffer) {
	const uint8Array = new Uint8Array(buffer)
	const decompressedArray = brotliDecompress(uint8Array)
	return Buffer.from(decompressedArray)
}