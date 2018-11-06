//How is there no stock way to patternscan a Buffer in Node?
//Written by me, lowkey proud
module.exports = (buffer, startOffset = 0, bytes) => {
	let bytesToFind = [...bytes];

	if(bytesToFind[0] === "?")
		throw "First byte can't be wildcard!";

	let sweepSearch = [];

	while(bytesToFind.length) {
		if(bytesToFind[0] === "?")
			break;

		sweepSearch.push(bytesToFind.shift());
	}

	sweepSearch = Buffer.from(sweepSearch);

	let i = startOffset,
		max = buffer.length - bytesToFind.length;

	while(i !== -1 && i < max) {
		i = buffer.indexOf(sweepSearch, i);

		if(i !== -1) {
			let fullMatch = true;

			for(let occurenceSearch = 0; occurenceSearch < bytesToFind.length; occurenceSearch++) {
				if(bytesToFind[occurenceSearch] !== "?" && buffer[i + occurenceSearch + sweepSearch.length] != bytesToFind[occurenceSearch]) {
					fullMatch = false;
					break;
				}
			}

			if(fullMatch)
				return i;
		} else {
			break;
		}
		i++;
	}

	return -1;
}