/*
	A QR code, drawn on the page: window.breaqQr(text) gives its modules, rows of true (dark) and false (light), or
	null when the text is too long. For the check-in pass on the team dashboard (a participant's code, nine
	characters), so it is kept small: byte mode, error correction level M, versions 1 to 6 (up to 106 bytes), the
	mask with the lowest penalty. As the standard (ISO/IEC 18004) has it; the Reed-Solomon and the placement follow
	Project Nayuki's QR Code generator (MIT licence).
*/

(function () {

	'use strict';

	// level M, versions 1–6: data codewords per block, error correction codewords per block, blocks
	var VERSIONS = [null, [16, 10, 1], [28, 16, 1], [44, 26, 1], [32, 18, 2], [43, 24, 2], [27, 16, 4]];
	var FORMAT_M = 0;   // level M's two bits in the format information

	function multiply(x, y) {
		var z = 0;
		for (var i = 7; i >= 0; i--) {
			z = (z << 1) ^ ((z >>> 7) * 0x11D);
			z ^= ((y >>> i) & 1) * x;
		}
		return z;
	}

	function divisor(degree) {
		var result = [];
		for (var i = 0; i < degree - 1; i++) result.push(0);
		result.push(1);
		var root = 1;
		for (i = 0; i < degree; i++) {
			for (var j = 0; j < result.length; j++) {
				result[j] = multiply(result[j], root);
				if (j + 1 < result.length) result[j] ^= result[j + 1];
			}
			root = multiply(root, 0x02);
		}
		return result;
	}

	function remainder(data, div) {
		var result = div.map(function () { return 0; });
		data.forEach(function (b) {
			var factor = b ^ result.shift();
			result.push(0);
			div.forEach(function (coef, i) { result[i] ^= multiply(coef, factor); });
		});
		return result;
	}

	function utf8(text) {
		var bytes = [];
		var s = unescape(encodeURIComponent(String(text)));
		for (var i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i));
		return bytes;
	}

	// the data codewords: byte mode, the length, the bytes, the terminator, then the pad bytes
	function codewords(bytes, version) {
		var v = VERSIONS[version];
		var capacity = v[0] * v[2];
		var bits = [];
		function put(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
		put(4, 4);
		put(bytes.length, 8);
		bytes.forEach(function (b) { put(b, 8); });
		put(0, Math.min(4, capacity * 8 - bits.length));
		while (bits.length % 8) bits.push(0);
		var out = [];
		for (var i = 0; i < bits.length; i += 8) {
			var b = 0;
			for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
			out.push(b);
		}
		for (var pad = 0xEC; out.length < capacity; pad ^= 0xEC ^ 0x11) out.push(pad);
		return out;
	}

	// split into blocks, each with its error correction, then interleaved
	function interleaved(data, version) {
		var v = VERSIONS[version];
		var div = divisor(v[1]);
		var blocks = [];
		for (var i = 0; i < v[2]; i++) {
			var d = data.slice(i * v[0], (i + 1) * v[0]);
			blocks.push(d.concat(remainder(d, div)));
		}
		var out = [];
		for (i = 0; i < blocks[0].length; i++) blocks.forEach(function (b) { out.push(b[i]); });
		return out;
	}

	function make(version) {
		var size = version * 4 + 17;
		var modules = [], fixed = [];
		for (var y = 0; y < size; y++) {
			modules.push([]);
			fixed.push([]);
			for (var x = 0; x < size; x++) { modules[y].push(false); fixed[y].push(false); }
		}
		function set(x, y, dark) { modules[y][x] = dark; fixed[y][x] = true; }
		// the timing patterns, the finders (with their separators), the alignment pattern
		for (var i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
		[[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) {
			for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
				var xx = c[0] + dx, yy = c[1] + dy;
				var dist = Math.max(Math.abs(dx), Math.abs(dy));
				if (xx >= 0 && xx < size && yy >= 0 && yy < size) set(xx, yy, dist !== 2 && dist !== 4);
			}
		});
		if (version > 1) {
			var a = size - 7;
			for (var ay = -2; ay <= 2; ay++) for (var ax = -2; ax <= 2; ax++) set(a + ax, a + ay, Math.max(Math.abs(ax), Math.abs(ay)) !== 1);
		}
		var qr = { size: size, modules: modules, fixed: fixed, set: set };
		formatBits(qr, 0);   // keeps the format information's place free of data; the real one goes on after the mask
		return qr;
	}

	function formatBits(qr, mask) {
		var data = (FORMAT_M << 3) | mask;
		var rem = data;
		for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
		var bits = ((data << 10) | rem) ^ 0x5412;
		var size = qr.size;
		function bit(i) { return ((bits >>> i) & 1) !== 0; }
		for (i = 0; i <= 5; i++) qr.set(8, i, bit(i));
		qr.set(8, 7, bit(6));
		qr.set(8, 8, bit(7));
		qr.set(7, 8, bit(8));
		for (i = 9; i < 15; i++) qr.set(14 - i, 8, bit(i));
		for (i = 0; i < 8; i++) qr.set(size - 1 - i, 8, bit(i));
		for (i = 8; i < 15; i++) qr.set(8, size - 15 + i, bit(i));
		qr.set(8, size - 8, true);   // always dark
	}

	function place(qr, data) {
		var size = qr.size, i = 0;
		for (var right = size - 1; right >= 1; right -= 2) {
			if (right === 6) right = 5;
			for (var vert = 0; vert < size; vert++) {
				for (var j = 0; j < 2; j++) {
					var x = right - j;
					var upward = ((right + 1) & 2) === 0;
					var y = upward ? size - 1 - vert : vert;
					if (!qr.fixed[y][x] && i < data.length * 8) {
						qr.modules[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
						i++;
					}
				}
			}
		}
	}

	var MASKS = [
		function (x, y) { return (x + y) % 2 === 0; },
		function (x, y) { return y % 2 === 0; },
		function (x) { return x % 3 === 0; },
		function (x, y) { return (x + y) % 3 === 0; },
		function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
		function (x, y) { return x * y % 2 + x * y % 3 === 0; },
		function (x, y) { return (x * y % 2 + x * y % 3) % 2 === 0; },
		function (x, y) { return ((x + y) % 2 + x * y % 3) % 2 === 0; }
	];

	function applyMask(qr, mask) {
		for (var y = 0; y < qr.size; y++) for (var x = 0; x < qr.size; x++) {
			if (!qr.fixed[y][x] && MASKS[mask](x, y)) qr.modules[y][x] = !qr.modules[y][x];
		}
	}

	// the standard's four penalties: runs of five or more, 2×2 blocks, finder-like patterns, the share of dark
	function penalty(qr) {
		var m = qr.modules, size = qr.size, score = 0, dark = 0;
		function lines(get) {
			for (var a = 0; a < size; a++) {
				var run = 1, row = '';
				for (var b = 0; b < size; b++) {
					var v = get(a, b);
					row += v ? '1' : '0';
					if (b > 0 && v === get(a, b - 1)) {
						run++;
						if (run === 5) score += 3;
						else if (run > 5) score += 1;
					} else run = 1;
				}
				var found = row.match(/(?=10111010000|00001011101)/g);
				if (found) score += 40 * found.length;
			}
		}
		lines(function (y, x) { return m[y][x]; });
		lines(function (x, y) { return m[y][x]; });
		for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
			if (m[y][x]) dark++;
			if (y < size - 1 && x < size - 1) {
				var c = m[y][x];
				if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
			}
		}
		score += Math.floor(Math.abs(dark * 100 / (size * size) - 50) / 5) * 10;
		return score;
	}

	window.breaqQr = function (text) {
		var bytes = utf8(text);
		var version = 1;
		while (version < VERSIONS.length && VERSIONS[version][0] * VERSIONS[version][2] * 8 < 12 + bytes.length * 8) version++;
		if (version >= VERSIONS.length) return null;
		var data = interleaved(codewords(bytes, version), version);
		var best = null, bestScore = Infinity;
		for (var mask = 0; mask < 8; mask++) {
			var qr = make(version);
			place(qr, data);
			applyMask(qr, mask);
			formatBits(qr, mask);
			var score = penalty(qr);
			if (score < bestScore) { bestScore = score; best = qr; }
		}
		return best.modules;
	};

})();
