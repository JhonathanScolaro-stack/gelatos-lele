//#region src/vapid.ts
/**
* VAPID — Voluntary Application Server Identification (RFC 8292). The ECDSA
* P-256 key pair and signed JWT that identify an application server to a push
* service, so it will accept pushes for its subscriptions.
*/
/**
* Convert a URL-safe base64 string to a Uint8Array.
*
* @throws {DOMException} `InvalidCharacterError` when the input isn't valid base64url.
*/
const urlBase64ToUint8Array = (base64String) => {
	if (!base64String) return /* @__PURE__ */ new Uint8Array(0);
	const base64 = (base64String + "=".repeat((4 - base64String.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/");
	const rawData = atob(base64);
	const outputArray = new Uint8Array(rawData.length);
	for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
	return outputArray;
};
/**
* Convert a Uint8Array to a URL-safe base64 string (no padding).
*/
const uint8ArrayToUrlBase64 = (array) => {
	let binary = "";
	const chunkSize = 32768;
	for (let i = 0; i < array.length; i += chunkSize) binary += String.fromCharCode(...array.subarray(i, i + chunkSize));
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
/**
* Generate a new VAPID key pair using ECDSA P-256.
* Returns keys as URL-safe base64 strings.
*
* @throws {Error} if the platform exports the generated key without its private scalar.
* @example
* ```ts
* const { publicKey, privateKey } = await generateVapidKeys();
* console.log({ publicKey, privateKey });
* ```
* @see {@link https://web-push.thelazyweb.dev/guides/runtime-setup/ | Runtime setup}
* @see {@link https://web-push.thelazyweb.dev/guides/rotate-vapid-keys/ | Rotate VAPID keys}
*/
const generateVapidKeys = async () => {
	const keyPair = await crypto.subtle.generateKey({
		name: "ECDSA",
		namedCurve: "P-256"
	}, true, ["sign", "verify"]);
	const publicKeyRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
	const privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
	if (!privateKeyJwk.d) throw new Error("Generated P-256 key exported without a private scalar");
	return {
		publicKey: uint8ArrayToUrlBase64(new Uint8Array(publicKeyRaw)),
		privateKey: uint8ArrayToUrlBase64(urlBase64ToUint8Array(privateKeyJwk.d))
	};
};
const encodeJwtSegment = (segment) => uint8ArrayToUrlBase64(new TextEncoder().encode(JSON.stringify(segment)));
const decodeVapidKey = (value, name) => {
	try {
		return urlBase64ToUint8Array(value);
	} catch (cause) {
		throw new Error(`VAPID ${name} is not URL-safe base64`, { cause });
	}
};
/**
* Rebuild the ECDSA signing key from the raw VAPID key pair. Web Crypto has no
* "raw" import for private keys, so the P-256 point is split into the JWK
* coordinates it does accept.
*
* @throws {Error} if either key is the wrong length or encoding, or the pair
* isn't a valid P-256 key.
*/
const importSigningKey = async (publicKey, privateKey) => {
	const publicKeyArray = decodeVapidKey(publicKey, "public key");
	const privateKeyArray = decodeVapidKey(privateKey, "private key");
	if (publicKeyArray.length !== 65 || publicKeyArray[0] !== 4) throw new Error("VAPID public key must be a 65-byte uncompressed P-256 point");
	if (privateKeyArray.length !== 32) throw new Error("VAPID private key must be a 32-byte P-256 scalar");
	const jwk = {
		kty: "EC",
		crv: "P-256",
		x: uint8ArrayToUrlBase64(publicKeyArray.slice(1, 33)),
		y: uint8ArrayToUrlBase64(publicKeyArray.slice(33)),
		d: uint8ArrayToUrlBase64(privateKeyArray)
	};
	try {
		return await crypto.subtle.importKey("jwk", jwk, {
			name: "ECDSA",
			namedCurve: "P-256"
		}, false, ["sign"]);
	} catch (cause) {
		throw new Error("VAPID keys are not a valid P-256 key pair", { cause });
	}
};
/**
* Create a VAPID JWT for authenticating with push services.
*
* @throws {Error} if the expiration isn't a whole number from 1 to 86400 seconds, the subject is
* not a `mailto:`/`https://` URI, or either key is malformed.
*/
const createVapidJwt = async (options) => {
	const { audience, subject, publicKey, privateKey, expiration = 43200 } = options;
	if (!Number.isInteger(expiration) || expiration < 1 || expiration > 86400) throw new Error("VAPID JWT expiration must be a whole number of seconds from 1 to 86400");
	if (!/^(mailto:|https:\/\/)/.test(subject)) throw new Error("VAPID subject must be a 'mailto:' or 'https://' URI");
	const unsignedToken = [{
		typ: "JWT",
		alg: "ES256"
	}, {
		aud: audience,
		exp: Math.floor(Date.now() / 1e3) + expiration,
		sub: subject
	}].map(encodeJwtSegment).join(".");
	const signingKey = await importSigningKey(publicKey, privateKey);
	const signature = await crypto.subtle.sign({
		name: "ECDSA",
		hash: "SHA-256"
	}, signingKey, new TextEncoder().encode(unsignedToken));
	return `${unsignedToken}.${uint8ArrayToUrlBase64(new Uint8Array(signature))}`;
};
//#endregion
export { createVapidJwt, generateVapidKeys, uint8ArrayToUrlBase64, urlBase64ToUint8Array };
