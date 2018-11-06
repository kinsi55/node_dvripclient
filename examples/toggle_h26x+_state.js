const {DVRIPClient} = require("../index.js");

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

		let encParams = await cam.getAdvancedEncodeParams();

		if(!encParams[1].data.hasOwnProperty("SmartH264"))
			throw "Failed to get current H26x+ State";

		console.log("Current H26x+ state:", encParams[1].data.SmartH264);

		encParams[1].data.SmartH264 = !encParams[1].data.SmartH264;

		await cam.setHelper(encParams[1].name, encParams[1].data);

		encParams = await cam.getAdvancedEncodeParams();

		console.log("H26x+ State after attempting to toggle:", encParams[1].data.SmartH264);

		cam.disconnect();
	} catch(e) {
		console.log("Failed:", e);
	}
})();