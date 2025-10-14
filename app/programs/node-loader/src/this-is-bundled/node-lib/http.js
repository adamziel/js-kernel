module.exports = require('stream-http');
module.exports.ours = true;
const originalRequest = module.exports.request;
const originalGet = module.exports.get;
/*
Node.js http.request() has two signatures:
http.request(options[, callback])#
http.request(url[, options][, callback])

stream-http only implements the first signature.
*/
module.exports.request = function (...args) {
  // Normalize arguments to handle both signatures:
  // 1. request(options[, callback])
  // 2. request(url[, options][, callback])
  
  let normalizedOptions;
  let normalizedCallback;
  // Check if first argument is a URL (string or URL object)
  if (typeof args[0] === 'string' || args[0] instanceof URL) {
    // Signature: request(url[, options][, callback])
    normalizedCallback = args[2];
    
    const urlObj = typeof args[0] === 'string' ? new URL(args[0]) : args[0];
    normalizedOptions = {
      protocol: urlObj.protocol,
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      ...(args[1] || {})
    };
  } else {
    // Signature: request(options[, callback])
    normalizedOptions = args[0] || {};
    normalizedCallback = args[1]; // second arg is callback in this signature
  }
  
  // Call originalRequest with normalized signature
  const result = normalizedCallback 
    ? originalRequest(normalizedOptions, normalizedCallback)
    : originalRequest(normalizedOptions);

  /**
   * Somewhere among our fetch->http->streams->fetch polyfills,
   * the outgoing request gets aborted. The upstream intention seems
   * to be clearing the stream after finishing, but in reality it is
   * just cancelling every outbound request.
   * 
   * @TODO: Get to the bottom of this and fix it. There's likely something
   *        wrong with our syscalls / internal bindings.
   */
  result.abort = result.destroy = function() {
    // console.log("Abort")
  }
  // console.log("result", result)
  return result;
}
