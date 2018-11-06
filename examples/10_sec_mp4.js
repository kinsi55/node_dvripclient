const {DVRIPClient} = require("../index.js");
const fs = require("fs");
const ChildProcess = require("child_process");

//Connects to device, captures 10 seconds of the Main video feed
//And afterwards Muxes the seperately received Audio and Video stream to an Mp4

/* eslint-disable no-console */
(async() => {
	try {
		let cam = new DVRIPClient({camIp: "10.0.0.1"});

		await cam.connect();
		console.log("Connected!");

		await cam.login({Username: "admin"});
		console.log("Logged in!");

		let encParams = await cam.getEncodeParam();

		let {video, audio} = await cam.getVideoStream({StreamType: "Main"});
		console.log("Got stream!");

		let audioWriter = fs.createWriteStream("10secStream.mp4.wav").on("error", (err) => {
			throw err;
		});

		let videoWriter = fs.createWriteStream("10secStream.mp4.h26x").on("error", (err) => {
			throw err;
		});

		audio.pipe(audioWriter);
		video.pipe(videoWriter);

		video.once("data", () => {
			console.log("Receiving 10 seconds of footage...");

			setTimeout(async () => {
				await cam.stopVideoStream({StreamType: "Main"});

				audioWriter.end();
				videoWriter.end();

				setImmediate(() => {
					console.log("Muxing Audio & Video together...");

					let ffmpeg = ChildProcess.spawn("ffmpeg", [
						"-r", encParams.data.MainFormat.Video.FPS,
						"-i", "10secStream.mp4.h26x",
						"-f", "alaw",
						"-ar", "8000",
						"-ac", "1",
						"-i", "10secStream.mp4.wav",
						"-c:v", "copy",
						"-c:a", "mp3",
						"-ar", "44100",

						"-f", "mp4",
						"-y",
						"10secStream_muxed.mp4"
					], {env: process.env});

					ffmpeg.on("exit", () => {
						console.log("Done!");

						ffmpeg.unref();

						process.exit();
					});

					ffmpeg.stderr.on("data", (data) => {
						console.log("FFMPEG Stderr:", data.toString("ascii"));
					});
				});

				cam.disconnect();
			}, 10000);
		});
	} catch(e) {
		console.log("Failed:", e);
	}
})();