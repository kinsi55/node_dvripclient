const {Parser} = require("binary-parser");

const VideoPacketParser = new Parser()
	.skip(4) //Header
	.skip(8) //SessionID, SequenceID
	.skip(2) //Channel, Endflag
	.uint16le("MessageId", {assert: 1412}) //MessageIds.MONITOR_DATA
	.uint32le("Size")
	.buffer("RawBody", {length: "Size"});

const CmdResponseParser = new Parser()
	.buffer("_Header", {length: 4})
	.buffer("SessionID", {length: 4})
	.uint32le("SequenceID")
	.uint8("Channel")
	.uint8("Endflag")
	.uint16le("MessageId")
	.uint32le("Size")
	.buffer("CmdResponse", {length: function() { return this.Size-2 }})//\n and Zerobyte trailing responses are included in the Size
	.uint16("_Footer", {assert: function() { return (0x0A << 8) + this.Endflag }});

module.exports = {VideoPacketParser, CmdResponseParser};