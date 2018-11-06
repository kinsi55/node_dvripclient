const ResponseCodes = require("./constants/ResponseCodes");
const DVRIPClient = require("./lib/dvripclient.js");
const DVRIPStreamClient = require("./lib/dvripstreamclient.js");

/**
 * @typedef {Object} DVRIPStream
 * @property {stream.PassThrough} audio audio part of the stream. ALAW 8000Hz for me, no idea if its the same for all.
 * @property {stream.PassThrough} video video part of the stream. Probably raw H264 / H265
 */

/**
 * @typedef {Object} DVRIPSession
 * @property {buffer} Buffer Session ID in form of a Buffer
 * @property {string} string Session ID in form of a string
 */

/**
 * @typedef {Object} DVRIPCommandResponse
 * @property {number} Ret Reponse code
 * @property {string} SessionID Session ID returned by server
 * @property {string} [SessionID] Name of the command this is a response to
 * @property {Object} [data] Data / Result of command
 */

/**
 * @typedef {Object} DVRIPMessage
 * @property {number} cmdSeq Sequence ID included in the message
 * @property {Buffer} builtMessage Message packet ready to be sent
 */

module.exports = {DVRIPClient, DVRIPStreamClient, ResponseCodes};