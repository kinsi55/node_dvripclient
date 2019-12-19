const {Socket} = require("net");
const EventEmitter = require("events");


const ResponseCodes = require("../constants/ResponseCodes");
const MessageIds = require("../constants/Messages");

const PatternScanner = require("../helpers/PatternScanner");
const {CmdResponseParser} = require("../helpers/Parsers");


const HEADER_LENGTH_BYTES = 20;
const HEADER_SIZE_OFFSET = 16;


const CommandHeader = Buffer.from([0xFF, 0x01, 0, 0]);
const ResponseHeaderPattern_Video = [0xFF, 0x01, "?", 0];
const NewlineBuffer = Buffer.from("\n");
const NullByte = Buffer.alloc(1);
const NullUint32 = Buffer.concat([NullByte, NullByte, NullByte, NullByte]);

/**
 * Client for various Surveillance cameras and DVR's operating under the DVR-IP protocol, also known as NetSurveillance or Sofia
 * @extends EventEmitter
 */
class DVRIPClient extends EventEmitter {
	/**
	 * Create new DVRIPClient
	 * @param {Object} settings
	 * @param {string} settings.camIp IP address of the device
	 * @param {number} [settings.camMediaPort=34567] "Media port" of the device
	 * @param {number} [settings.commandTimeoutMs=5000] Milliseconds to wait before commands timeout
	 */
	constructor({camIp, camMediaPort = 34567, commandTimeoutMs = 5000}) {
		super();

		this._socket = new Socket();

		this._socket.setKeepAlive(true, 10000);

		this._settings = {
			camIp,
			camMediaPort,
			commandTimeoutMs
		};

		this._callbacks = {};
		this._cmdSeq = 0;
		this.setSessionId();

		(() => {
			let responseBuffer;
			let RespbufferWasUnsaturated = false;

			//Incoming messages could be split. Gotta somehow stitch them together around the known protocol
			this._socket.on("data", (data) => {
				if(!responseBuffer) {
					responseBuffer = data;
				} else {
					responseBuffer = Buffer.concat([responseBuffer, data]);
				}

				while(responseBuffer) {
					//Check if we can see a response header...
					let headerOffset = -1;

					if(!RespbufferWasUnsaturated) {
						headerOffset = responseBuffer.indexOf(CommandHeader);

						//With the Extra / Secondary stream the third byte is 1, with the Mainstream its 0,
						//might as well patternsearch because who knows how much more inconsistencies there are.
						if(headerOffset === -1 && this._videoStream)
							headerOffset = PatternScanner(responseBuffer, 0, ResponseHeaderPattern_Video);

						//Check if the resp header is present entirely
						if(headerOffset === -1)
							return;

						if(responseBuffer.length <= HEADER_LENGTH_BYTES)
							return RespbufferWasUnsaturated = true;
					} else {
						headerOffset = 0;
					}

					//Check if the entirety of the associcated response has been received already
					const respLenAval = responseBuffer.length - headerOffset;
					//We could use the Response parser at this point to avoid using
					//"bare numbers", but for the sake of optimization I wont here.
					const requiredRespLen = responseBuffer.readUInt32LE(headerOffset + HEADER_SIZE_OFFSET) + HEADER_LENGTH_BYTES;
					//We've already seen a full response header, just the response body was partially missing.
					//No need to re-check whenever we receive the next bit of data
					if(respLenAval < requiredRespLen)
						return RespbufferWasUnsaturated = true;

					RespbufferWasUnsaturated = false;

					//Failsafe.. Should technically never happen due to TCP being sorted and non-lossy
					if(headerOffset !== 0) {
						let newBuffer = Buffer.allocUnsafe(responseBuffer.length - headerOffset);

						responseBuffer.copy(newBuffer, 0, headerOffset);

						responseBuffer = newBuffer;
						headerOffset = 0;
					}

					this.dataParser(responseBuffer);

					//Nothing more to currently parse after this cycle. Memory can finally be free'd
					if(requiredRespLen === responseBuffer.length)
						return responseBuffer = undefined;

					responseBuffer = responseBuffer.slice(requiredRespLen);
				}
			});
		})();

		this._socket.on("close", () => {
			//I dont think there is any point to having an unauthenticated connection, so lets "ignore"
			//emitting of the connection:lost event if we are unauthenticated. This also doubles as
			//not emitting a connection:lost when manually calling disconnect()
			if(this.SessionId.buffer !== NullUint32) {
				this.disconnect();

				this.emit("connection:lost");
			} else {
				this.emit("connection:closed");
			}
		});
	}

	/**
	 * Parser called for incoming messages
	 *
	 * @private
	 * @param {Buffer} responseBuffer Buffer of data to parse
	 */
	dataParser(responseBuffer) {
		let {SequenceID, CmdResponse} = CmdResponseParser.parse(responseBuffer);

		//Sometimes the sequence ID in the response will be +1 of what we've sent. I dont even know.
		let theCb = this._callbacks[SequenceID] || this._callbacks[SequenceID - 1];

		if(theCb) {
			const {resolve, reject} = theCb();

			//Ascii(123) = Opening curly bracket
			if(CmdResponse[0] !== 123)
				return resolve(CmdResponse.toString("utf8"));

			try {
				let parsed = JSON.parse(CmdResponse);

				let toRet = {
					Ret: parsed.Ret,
					SessionID: parsed.SessionID
				};

				if(parsed.Ret && !ResponseCodes.SuccessCodes[parsed.Ret]) {
					if(parsed.Ret === ResponseCodes.ErrorsToCode.NOT_LOGGEDIN && this._isLoggedIn) {
						this.setSessionId();
						this._isLoggedIn = false;
					}

					toRet.ErrorMessage = ResponseCodes.ErrorCodes[parsed.Ret] || "Unknown error";

					return reject(toRet);
				}

				if(parsed.Name) {
					toRet.data = parsed[parsed.Name];
					toRet.name = parsed.Name;
				} else {
					let retMap = {};

					for(let dataKey in parsed) {
						if(dataKey !== "SessionID" && dataKey !== "Ret")
							retMap[dataKey] = parsed[dataKey];
					}

					toRet.data = retMap;
				}

				if(toRet.data && toRet.data.length === 1)
					toRet.data = toRet.data[0];

				resolve(toRet);
			} catch(e) {
				reject(`Failed to parse what seemed like a JSON response: ${CmdResponse.toString("utf8")}`);
			}
		}
	}

	/**
	 * Enable / Change Keepalive worker
	 * @private
	 * @param {number} interval Seconds to wait inbetween keepalive messages
	 */
	setupAliveKeeper(interval = 20) {
		if(this._aliveKeeperInterval)
			clearInterval(this._aliveKeeperInterval);

		this._aliveKeeperInterval = setInterval(() => {
			this.sendMessage({
				MessageName: "KeepAlive",
				Command: "KEEPALIVE_REQ",
				IgnoreResponse: true
			});
		}, interval * 1000);
	}

	/**
	 * Get if we are connected
	 * @return {boolean}
	 */
	get IsConnected() { return this._socket && !this._socket.destroyed && this._socket.remoteAddress }

	/**
	 * Get if we are logged in
	 * @return {boolean}
	 */
	get IsLoggedIn() { return this.IsConnected && this._isLoggedIn }

	/**
	 * Get current session. The buffer is passed by reference, so dont modify it.
	 * @return {DVRIPSession}
	 */
	get SessionId() { return this._sessionId }

	/**
	 * Set session ID used for communication
	 *
	 * @param {Buffer|string|DVRIPSession} [byteBuffer] Session to use
	 */
	setSessionId(newSessionId = NullUint32) {
		let newSess;

		if(newSessionId instanceof Buffer) {
			if(newSessionId.length !== 4)
				throw "Session ID must be 4 bytes long";

			//Cloning the Buffer here so we arent relieant on a user-space passed buffer.
			newSess = {buffer: Buffer.from(newSessionId), string: `0x${newSessionId.toString("hex")}`};
		} else if(typeof newSessionId === "string") {
			if(newSessionId.length !== 10)
				throw "Invalid Session ID string";

			newSess = {buffer: Buffer.from(newSessionId.substr(2) /*Skip "0x"*/, "hex").reverse(), string: newSessionId};
		} else if(typeof newSessionId === "object" && newSessionId.buffer && newSessionId.string) {
			newSess = newSessionId;
		} else {
			throw "newSessionId must be a Buffer or String";
		}

		this._sessionId = Object.freeze(newSess);
	}

	/**
	 * Write passed bytebuffer to socket
	 *
	 * @param {Buffer} byteBuffer Buffer to write
	 * @returns {boolean} Returns return of {@link net.Socket.write}
	 */
	writeRaw(byteBuffer) {
		if(!this.IsConnected)
			throw "Not connected";

		return this._socket.write(byteBuffer);
	}

	/**
	 * Helper to build a message body
	 *
	 * @param {Object} messageinfo Details required to build the message
	 * @param {string} [messageinfo.MessageName] "Name" field of the message
	 * @param {Object} messageinfo.MessageData Object containing the messages data
	 * @returns {string} built message body
	 */
	buildMessageBody({MessageName = undefined, MessageData = {}}) {
		let data = {
			Name: MessageName,
			...MessageData
		};

		if(this.IsLoggedIn)
			data.SessionId = this.SessionId.string;

		//If name is undefined stringify will not add it to
		//the stringified result this is desired behaviour.
		return JSON.stringify(data);
	}

	/**
	 * Helper to build a message packet
	 *
	 * @param {Object} messageinfo Details required to build the message
	 * @param {number} messageinfo.Command ID of message
	 * @param {Buffer} [messageinfo.MessageBody] Buffer of message body to include
	 * @returns {DVRIPMessage} Object containing the messages details
	 */
	buildMessage({Command, MessageBody}) {
		const cmdSeq = this._cmdSeq++;

		let msgLen = 0;

		if(MessageBody)
			msgLen = MessageBody.length + 1;

		const fromBuffer = [
			...CommandHeader,
			...this.SessionId.buffer,
			cmdSeq, cmdSeq >> 8, cmdSeq >> 16, cmdSeq >> 24,
			0, 0, //Reserved?
			Command, Command >> 8,
			msgLen, msgLen >> 8, msgLen >> 16, msgLen >> 24,
		];

		let builtMessage = Buffer.from(fromBuffer);

		if(MessageBody) {
			builtMessage = Buffer.concat([
				builtMessage,
				MessageBody,
				NewlineBuffer
			]);
		}

		return {cmdSeq, builtMessage};
	}

	/**
	 * Build and send a message
	 *
	 * @param {Object} messageinfo - Details required to build the message
	 * @param {string|number} messageinfo.Command ID of command to send
	 * @param {string} [messageinfo.MessageName] "Name" field of the message body
	 * @param {Object} [messageinfo.MessageData] Body of the message
	 * @param {boolean} [messageinfo.IgnoreResponse=false] Instantly resolve the Promise and ignore the response to the message
	 * @returns {Promise}
	 */
	//eslint-disable-next-line no-unused-vars
	sendMessage({Command, MessageName = undefined, MessageData = undefined, IgnoreResponse = false}) {
		if(!this.IsConnected)
			throw "Not connected";

		if(typeof Command === "string")
			Command = MessageIds[Command];

		if(!Command || Command !== parseInt(Command, 10))
			throw "Unknown/Invalid Command variable passed";

		return new Promise(async (resolve, reject) => {
			const MessageBody = MessageData || MessageName ? Buffer.from(this.buildMessageBody({MessageData, MessageName})) : undefined;
			const {cmdSeq, builtMessage} = this.buildMessage({Command, MessageBody});

			this.writeRaw(builtMessage);

			if(IgnoreResponse)
				return resolve();

			let timeoutReject = setTimeout(() => {
				if(this._callbacks[cmdSeq]) {
					reject("Execution timed out");

					delete this._callbacks[cmdSeq];

					timeoutReject = undefined;
				}
			}, this._settings.commandTimeoutMs);

			const promiseWrapper = () => {
				if(!timeoutReject)
					return;

				clearTimeout(timeoutReject);
				delete this._callbacks[cmdSeq];

				return {resolve, reject};
			};

			this._callbacks[cmdSeq] = promiseWrapper;
		});
	}

	/**
	 * Connect to predefined device
	 *
	 * @returns {Promise}
	 */
	connect() {
		if(this._socket.connecting || this.IsConnected)
			throw "Already connected";

		return new Promise((resolve, reject) => {
			const errorCb = () => {
				this.emit("connection:failed");

				reject("Failed to connect");
			};

			this._socket.once("error", errorCb);

			this._socket.setNoDelay(true);

			this._socket.connect(this._settings.camMediaPort, this._settings.camIp, () => {
				if(this._socket)
					this._socket.removeListener("error", errorCb);

				this.emit("connection:established");

				resolve();
			});
		});
	}

	/**
	 * Disconnect from device
	 */
	disconnect() {
		this._isLoggedIn = false;
		this.setSessionId();

		if(this._streamClient)
			this._streamClient.disconnect();

		clearInterval(this._aliveKeeperInterval);

		if(!this.IsConnected)
			return;

		this._socket.end().unref();
	}

	/**
	 * Authenticate with given account
	 *
	 * @param {Object} loginInfo
	 * @param {string} loginInfo.Username
	 * @param {string} [loginInfo.Password=""]
	 * @param {boolean} [UseHash=true]
	 * @returns {Promise} Promise resolves with aquired Session ID
	 */
	async login({Username = "admin", Password = ""}, UseHash = true) {
		if(this._isLoggedIn)
			throw "Already logged in";

		this._cmdSeq = 0;

		//Absolutely stupid custom password "hashing". Special thanks to https://github.com/tothi/pwn-hisilicon-dvr#password-hash-function
		//There isnt really any protection involved with this... An attacker can just as well sniff the hash and use that to authenticate.
		//By checking out the Github link you should come to the conclusion that any device of this kind should *never* be directly
		//exposed to the internet anways.
		if(UseHash) {
			const pw_md5 = createHash("md5").update(Password).digest();
			let HashBuilder = "";

			for(let i = 0; i < 8; i++) {
				let n = (pw_md5[2 * i] + pw_md5[2 * i + 1]) % 62;
				if(n > 9)
					n += (n > 35) ? 13 : 7;

				HashBuilder += String.fromCharCode(n + 48);
			}

			Password = HashBuilder;
		}

		const Response = await this.executeHelper("LOGIN_REQ2", undefined, {
			EncryptType: UseHash ? "MD5" : "NONE",
			LoginType: "DVRIP-Node",
			UserName: Username,
			PassWord: Password
		});

		if(!Response.SessionID || !Response.SessionID.length)
			throw "Login response did not contain a Session Id with a known field!";

		this._isLoggedIn = true;

		this.setSessionId(Response.SessionID);

		if(Response.data.AliveInterval)
			this.setupAliveKeeper(Response.data.AliveInterval);

		this.emit("login:success");

		return this.SessionId;
	}

	/**
	 * Grabs the video stream of the Device
	 *
	 * @param {Object} streamInfo
	 * @param {string} [streamInfo.StreamType="Main"] Substream to grab. Known to work are "Main" and "Extra1"
	 * @param {string} [streamInfo.Channel=0] Videochannel to grab. Probably only useful for DVR's and not for IP Cams
	 * @param {string} [streamInfo.CombinMode="CONNECT_ALL"] Unknown. "CONNECT_ALL" and "NONE" work
	 * @returns {Promise} Promise resolves with a {@link DVRIPStream} object
	 */
	async getVideoStream({StreamType = "Main", Channel = 0, CombinMode = "CONNECT_ALL"}) {
		if(this._streamClient)
			throw "There already is an active Videostream instance. Please call stopVideoStream before requesting a new one with this DVRIPClient instance";
		//We gotta inline-require it because otherwise they would globally require each other.
		this._streamClient = new (require("./dvripstreamclient.js"))(this._settings);
		this._streamClient._isLoggedIn = true;
		this._streamClient.setSessionId(this.SessionId);

		try {
			await this._streamClient.connect();
			await this._streamClient.claimVideoStream(arguments[0]);

			await this.executeHelper("MONITOR_REQ", "OPMonitor", {
				Action: "Start",
				Parameter: {Channel, CombinMode, StreamType, TransMode: "TCP"}
			});
		} catch(err) {
			this._streamClient.disconnect();
			delete this._streamClient;

			throw err;
		}

		this._streamClient.on("connection:lost", () => {
			this._streamClient = undefined;

			this.emit("videostream:lost");
		});

		return {video: this._streamClient._videoStream, audio: this._streamClient._audioStream};
	}

	/**
	 * Ends active video stream. Options have to match the getVideoStream() call
	 *
	 * @param {Object} streamInfo
	 * @param {string} [streamInfo.StreamType="Main"] Substream to end. Known to work are "Main" and "Extra1"
	 * @param {string} [streamInfo.Channel=0] Videochannel to end. Probably only useful for DVR's and not for IP Cams
	 * @param {string} [streamInfo.CombinMode="CONNECT_ALL"] Unknown. "CONNECT_ALL" and "NONE" work
	 * @returns {Promise} Promise resolves with {@link DVRIPCommandResponse} of called underlying command
	 */
	async stopVideoStream({StreamType = "Main", Channel = 0, CombinMode = "NONE"}) {
		if(!this._streamClient)
			throw "There no active Videostream instance";

		try {
			return await this.executeHelper("MONITOR_REQ", "OPMonitor", {
				Action: "Stop",
				Parameter: {Channel, CombinMode, StreamType, TransMode: "TCP"}
			});
		} catch(err) {
			throw err;
		} finally {
			const toDisco = this._streamClient;

			if(toDisco)
				setImmediate(toDisco.disconnect);

			delete this._streamClient;
		}
	}

	getOneHelper(Command, MessageName) { return this.sendMessage({Command, MessageName}) }
	getMultipleHelper(toGet) {
		return Promise.all(
			toGet.map(x => this.sendMessage(x))
		);
	}

	executeHelper(Command, MessageName, MessageData) {
		return this.sendMessage({
			Command,
			MessageName,
			//Some messages (E.g.) the LOGIN_REQ2 do not actually have a MessageName...
			//thus we obviously cannot wrap the data of those like we have to with other messages
			MessageData: (!MessageName ? MessageData : {
				[MessageName]: MessageData
			})
		});
	}
	setHelper(MessageName, MessageData, Command = "CONFIG_SET") {
		return this.executeHelper(Command, MessageName, [MessageData]);
	}

	getSystemFunction() { return this.getOneHelper("ABILITY_GET", "SystemFunction") }
	getSystemTime() { return this.getOneHelper("TIMEQUERY_REQ", "OPTimeQuery") }
	getSystemInfo() { return this.getOneHelper("SYSINFO_REQ", "SystemInfo") }
	getStorageInfo() { return this.getOneHelper("SYSINFO_REQ", "StorageInfo") }


	getAuthorityList() { return this.getOneHelper("FULLAUTHORITYLIST_GET") }
	getAuthorityGroups() { return this.getOneHelper("GROUPS_GET") }
	getUsers() { return this.getOneHelper("USERS_GET") }
	getExUsersMap() { return this.getOneHelper("CONFIG_GET", "System.ExUserMap") }


	getEncodeParam() { return this.getOneHelper("CONFIG_GET", "Simplify.Encode") }
	getAdvancedEncodeParams() {
		return this.getMultipleHelper([
			{Command: "CONFIG_GET", MessageName: "AVEnc.EncodeStaticParam"},
			{Command: "CONFIG_GET", MessageName: "AVEnc.SmartH264"}
		]);
	}

	getImageParams() {
		return this.getMultipleHelper([
			{Command: "CONFIG_GET", MessageName: "Camera.Param.[0]"},
			{Command: "CONFIG_GET", MessageName: "Camera.ParamEx.[0]"},
			{Command: "CONFIG_GET", MessageName: "Camera.ClearFog"}
		]);
	}

	//eslint-disable-next-line no-unused-vars
	getLogs({BeginTime = "2000-01-01 00:00:00", EndTime = "2030-01-01 00:00:00", LogPosition = 0, Type = "LogAll"} = {}) {
		return this.executeHelper("LOGSEARCH_REQ", "OPLogQuery", arguments[0]);
	}

	clearLogs() { return this.executeHelper("SYSMANAGER_REQ", "OPLogManager", {Action: "RemoveAll"}) }

	rebootDevice() { return this.executeHelper("SYSMANAGER_REQ", "OPMachine", {Action: "Reboot"}) }
}

module.exports = DVRIPClient;