const {PassThrough} = require("stream");

const VideopacketPayloads = require("../constants/VideopacketPayloads");
const MessageIds = require("../constants/Messages");

const {VideoPacketParser} = require("../helpers/Parsers");

const DVRIPClient = require("./dvripclient.js");

const HEADER_MESSAGEID_OFFSET = 14;

/**
 * Extension of DVRIPClient to support Audio / Videostreaming
 * @extends DVRIPClient
 */
class DVRIPStreamClient extends DVRIPClient {
	dataParser(responseBuffer) {
		const MessageId = responseBuffer.readUInt16LE(HEADER_MESSAGEID_OFFSET);
		if(!this._videoStream || MessageId !== MessageIds.MONITOR_DATA)
			return super.dataParser(responseBuffer);

		let {RawBody} = VideoPacketParser.parse(responseBuffer);

		//0x000001 = NAL Unit Seperator
		if(RawBody[0] !== 0 || RawBody[1] !== 0 || RawBody[2] !== 1)
			return this._videoStream.write(RawBody);

		let PayloadType = RawBody[3];

		//Failing to remove these 8-16 bytes for these messages for some reason makes FFMPEG unhappy.
		//The output is apparently still a valid video stream.
		if(PayloadType === VideopacketPayloads.IFrame || PayloadType === VideopacketPayloads.PlusEnc)
			this._videoStream.write(RawBody.slice(16));
		else
			this._videoStream.write(RawBody.slice(8));
	}

	disconnect() {
		super.disconnect();

		if(this._videoStream) {
			setImmediate(() => {
				if(!this._videoStream)
					return;

				this._videoStream.end();

				this._videoStream.destroy();

				delete this._videoStream;
			});
		}

		if(this._audioStream) {
			setImmediate(() => {
				if(!this._audioStream)
					return;

				this._audioStream.end();

				this._audioStream.destroy();

				delete this._audioStream;
			});
		}

		if(this._socket)
			delete this._socket;
	}

	/**
	 * Claim video stream on this connection, thus allowing the parent connection to start it
	 *
	 * @param {Object} streamInfo
	 * @param {string} [streamInfo.StreamType="Main"] Substream to claim. Known to work are "Main" and "Extra1"
	 * @param {string} [streamInfo.Channel=0] Videochannel to claim. Probably only useful for DVR's and not for IP Cams
	 * @param {string} [streamInfo.CombinMode="CONNECT_ALL"] Unknown. "CONNECT_ALL" and "NONE" work
	 * @returns {Promise} Promise resolves with {@link DVRIPCommandResponse} of called underlying command
	 */
	async claimVideoStream({StreamType = "Main", Channel = 0, CombinMode = "CONNECT_ALL"}) {
		const Result = await this.executeHelper("MONITOR_CLAIM", "OPMonitor", {
			Action: "Claim",
			Parameter: {Channel, CombinMode, StreamType, TransMode: "TCP"}
		});

		this._socket.setTimeout(5000);

		this._videoStream = new PassThrough();
		this._audioStream = new PassThrough();

		return Result;
	}
}

module.exports = DVRIPStreamClient;