const {DVRIPClient} = require("../index.js");
const ChildProcess = require("child_process");

//Connects to device, gets its video stream and ingests it to the given ingest server
//Example server: https://github.com/xiongziliang/ZLMediaKit
//It can then be viewed via VLC for example, using the same format URL
//For the sake of simplicity, I'm piping the necessary data directly into ffmpeg -
//this also means that the stream doesnt contain any audio that might possibly exist.

/* eslint-disable no-console */
(async() => {
	try {
		const camIp = "10.0.0.1";
		const rtspIngestIp = "127.0.0.1:554";
		let cam = new DVRIPClient({camIp});

		await cam.connect();
		console.log("Connected!");

		await cam.login({Username: "admin"});
		console.log("Logged in!");

		let encParams = await cam.getEncodeParam();

		const ffmpeg = ChildProcess.spawn("ffmpeg", [
			"-fflags", "+nobuffer+genpts",
			"-analyzeduration", "1",
			"-probesize", "32",
			"-r", encParams.data.MainFormat.Video.FPS, //Not sure if this does anything, doesnt seem to be needed.
			"-use_wallclock_as_timestamps", 1,
			"-i", "pipe:",
			"-c", "copy",
			"-f", "rtsp",
			"-vsync", "vfr",
			"-rtsp_transport", "tcp",
			`rtsp://${rtspIngestIp}/${camIp}`
		], {env: process.env});

		ffmpeg.stderr.on("data", (data) => {
			console.log("FFMPEG Stderr:", data.toString("ascii"));
		});

		let {video, audio} = await cam.getVideoStream({StreamType: "Main"});
		console.log("Got stream!");

		video.pipe(ffmpeg.stdin);

		ffmpeg.on("exit", () => {
			console.log("Ffmpeg Exit");

			ffmpeg.unref();

			cam.disconnect();
		});
	} catch(e) {
		console.log("Failed:", e);
	}
})();
