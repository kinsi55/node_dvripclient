const ErrorsToCode = Object.freeze({
	NOT_LOGGEDIN: 105
});

const RespsToCode = Object.freeze({
	OK: 100
});

const ErrorCodes = Object.freeze({
	101: "Unknown error",
	102: "Version not supported",
	103: "Illegal request",
	104: "User has already logged in",
	105: "User is not logged in",
	106: "Username or Password is incorrect",
	107: "Insufficient permission",
	108: "Timeout",
	109: "Find failed, file not found",
	112: "User already exists",
	113: "User does not exist",
	114: "User group already exists",
	115: "User group does not exist",
	116: "Reserved",
	117: "Message is malformed",
	118: "No PTZ protocol is set",
	119: "No query to file",
	120: "Configured to be enabled",
	121: "Digital channel is not enabled",
	202: "User is not logged in",
	203: "Incorrect password",
	204: "User is illegal",
	205: "User is locked",
	206: "User is in the blacklist",
	207: "User already logged in",
	208: "Invalid input",
	209: "User already exists",
	210: "Object not found",
	211: "Object does not exist",
	212: "Account in use",
	213: "Permission table error",
	214: "Illegal password",
	215: "Password does not match",
	216: "Keep account number",
	502: "Illegal command",
	504: "Talk channel is not open",
	512: "Update did not start",
	513: "Update data error",
	514: "Update failed",
	521: "Failed to restore default config",
	523: "Default config is illegal",
	604: "Write file error",
	605: "Features are not supported",
	606: "Verification failed",
	607: "Configuration does not exist",
	608: "Configuration parsing error"
});

const SuccessCodes = Object.freeze({
	100: "Success",
	110: "Find success, returned all files",
	111: "Find success, returned part of files",
	150: "Success, device restart required",
	503: "Talk channel has ben opened",
	511: "Update started",
	515: "Update succeeded",
	522: "Device restart required",
	602: "Application restart required",
	603: "System restart required",
	605: "Features are not supported"
});

module.exports = {ErrorCodes, SuccessCodes, ErrorsToCode, RespsToCode};