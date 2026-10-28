import { createVapidJwt, uint8ArrayToUrlBase64 } from "./vapid.mjs";
import { InvalidSubscriptionError } from "./errors.mjs";
import { assertPayloadWithinLimit, encryptPayload, validatePushInputs } from "./encrypt.mjs";
//#region src/send.ts
/**
* The HTTP half of a push: VAPID auth (RFC 8292) over an aes128gcm-encrypted
* body (RFC 8291), plus the status handling that decides delivered / gone / error.
*/
/** RFC 9110 §10.2.3: `Retry-After` is either delta-seconds or an HTTP-date. */
const parseRetryAfterMs = (retryAfter) => {
	if (retryAfter === null) return null;
	const trimmed = retryAfter.trim();
	if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1e3;
	const date = Date.parse(trimmed);
	return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
};
/**
* Error thrown when the push service rejects a send with a non-2xx status,
* other than 404/410 ("gone"), which resolve to `false` instead. Carries the
* status, response body, endpoint, and the `Retry-After` header both verbatim
* (`retryAfter`) and parsed to milliseconds-from-now (`retryAfterMs`).
*
* @see {@link https://web-push.thelazyweb.dev/guides/handle-errors/ | Handle errors and retries}
* @see {@link https://web-push.thelazyweb.dev/guides/secure-endpoints/ | Secure your endpoints}
*/
var WebPushError = class extends Error {
	/** The push service's HTTP status */
	statusCode;
	/** The push service's response body, cut off after its first 4 KB */
	body;
	/**
	* The full subscription endpoint, a capability URL: anyone holding it can
	* push to the device. Route on it, but keep it out of logs; serializers
	* that honor `toJSON` get a truncated one.
	*/
	endpoint;
	/** The `Retry-After` header verbatim: delta-seconds or an HTTP-date */
	retryAfter;
	/** `Retry-After` as milliseconds from now; `null` when absent or unparseable */
	retryAfterMs;
	constructor(message, statusCode, body, endpoint, retryAfter = null) {
		super(message);
		this.name = "WebPushError";
		this.statusCode = statusCode;
		this.body = body;
		this.endpoint = endpoint;
		this.retryAfter = retryAfter;
		this.retryAfterMs = parseRetryAfterMs(retryAfter);
	}
	/**
	* Truncates `endpoint` and `body` for serialization. Without this,
	* `JSON.stringify` on the error would emit every enumerable field,
	* persisting the full capability URL into any structured log.
	*/
	toJSON() {
		return {
			name: this.name,
			message: this.message,
			statusCode: this.statusCode,
			endpoint: this.endpoint.slice(0, 50),
			body: this.body.slice(0, 200),
			retryAfter: this.retryAfter,
			retryAfterMs: this.retryAfterMs
		};
	}
};
var RawBytes = class {
	#bytes;
	constructor(bytes) {
		this.#bytes = bytes;
	}
	get bytes() {
		return this.#bytes;
	}
};
/**
* Mark a payload as already serialized: the string or bytes are encrypted and
* delivered verbatim, so your service worker's parsing is the other half of
* the contract. The example service worker expects `PushPayload` JSON and will
* throw on anything else — which is also why the send functions take this
* wrapper rather than a bare string: a misdirected string would type-check,
* deliver, and only fail inside `event.data.json()` on the device.
*
* @see {@link https://web-push.thelazyweb.dev/guides/migrate-from-web-push/ | Migrate from web-push}
*/
const rawPayload = (payload) => new RawBytes(typeof payload === "string" ? new TextEncoder().encode(payload) : payload);
const encodePayload = (payload) => payload instanceof RawBytes ? payload.bytes : new TextEncoder().encode(JSON.stringify(payload));
/**
* Derive a valid `topic` from an arbitrary string, for collapse keys that
* don't fit the RFC 8030 §5.4 charset or length (`message:${id}`, a URL, …).
* Deterministic — the same input always yields the same topic, which is what
* makes push-service collapse work — and opaque, so the key's content never
* appears in a header the push service can read (only the payload is
* encrypted; headers are plaintext to the service). The first 32 base64url
* characters of a SHA-256 digest carry 192 bits, leaving collisions
* negligible.
*
* Strings that are already valid topics are hashed too, never passed through:
* a conditional pass-through would make near-identical inputs produce
* unrelated wire values. Set {@link SendPushOptions.topic} directly when you
* need an exact header value.
*
* @see {@link https://web-push.thelazyweb.dev/guides/collapse-notifications/ | Collapse and expire notifications}
* @see {@link https://www.rfc-editor.org/rfc/rfc8030#section-5.4 | RFC 8030 §5.4}
*/
const topicFromString = async (input) => {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
	return uint8ArrayToUrlBase64(new Uint8Array(digest)).slice(0, 32);
};
/** RFC 8030 §5.4: a collapse key of at most 32 URL-safe base64 characters. */
const assertValidTopic = (topic) => {
	if (topic !== void 0 && !/^[A-Za-z0-9\-_]{1,32}$/.test(topic)) throw new Error("Topic must be 1-32 URL-safe base64 characters");
};
const subscriptionKeys = ({ keys }) => {
	if (typeof keys?.p256dh !== "string" || typeof keys.auth !== "string") throw new InvalidSubscriptionError("Invalid subscription: missing its p256dh or auth key");
	return [keys.p256dh, keys.auth];
};
const PUSH_SERVICE_HOST = /^(?:fcm\.googleapis\.com|(?:[\w-]+\.)+(?:notify\.windows\.com|push\.services\.mozilla\.com|push\.apple\.com))$/;
/**
* Whether an endpoint is an `https:` URL on a browser's push service: Google's
* for Chromium browsers, Microsoft's for Edge, Mozilla's or Apple's. The send
* functions post to whatever endpoint a subscription names, so a server that
* takes subscriptions from browsers can check them here first, and stop a
* hostile client from aiming its sends at internal hosts.
*
* @see {@link https://web-push.thelazyweb.dev/guides/secure-endpoints/ | Secure your endpoints}
*/
const isPushServiceEndpoint = (endpoint) => {
	if (!URL.canParse(endpoint)) return false;
	const url = new URL(endpoint);
	return url.protocol === "https:" && PUSH_SERVICE_HOST.test(url.hostname);
};
/** The JWT `aud` claim is the push service origin, not the full endpoint. */
const pushServiceOrigin = (endpoint) => {
	if (!URL.canParse(endpoint)) throw new InvalidSubscriptionError("Invalid subscription endpoint: not a URL");
	const url = new URL(endpoint);
	if (url.protocol !== "https:") throw new InvalidSubscriptionError("Invalid subscription endpoint: must be an https: URL (RFC 8030 §3)");
	return `${url.protocol}//${url.host}`;
};
/** 404 Not Found and 410 Gone both mean the subscription should be deleted. */
const isSubscriptionGone = (status) => status === 404 || status === 410;
const DEFAULT_TIMEOUT_MS = 3e4;
const DEFAULT_TTL_S = 86400;
const DEFAULT_VAPID_EXPIRATION_S = 43200;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const wholeTimeoutMs = (timeoutMs) => Math.ceil(timeoutMs);
/** RFC 8030 §5.2: `TTL` is delta-seconds, a non-negative integer. */
const wholeTtl = (ttl) => Math.floor(ttl);
const assertValidTimeout = (timeoutMs) => {
	const wholeMs = wholeTimeoutMs(timeoutMs);
	if (Number.isNaN(wholeMs) || wholeMs < 1 || wholeMs > MAX_TIMEOUT_MS) throw new Error(`timeoutMs must be from 1 to ${MAX_TIMEOUT_MS} milliseconds`);
};
const assertValidTtl = (ttl) => {
	if (ttl !== void 0 && (!Number.isSafeInteger(wholeTtl(ttl)) || ttl < 0)) throw new Error("ttl must be a number of seconds, 0 or more");
};
const assertValidSendOptions = ({ topic, ttl, timeoutMs = DEFAULT_TIMEOUT_MS }) => {
	assertValidTopic(topic);
	assertValidTtl(ttl);
	assertValidTimeout(timeoutMs);
};
const requestSignal = (signal, timeoutMs) => signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
const buildPushHeaders = ({ jwt, vapidPublicKey, ttl, urgency, topic }) => {
	const headers = {
		Authorization: `vapid t=${jwt}, k=${vapidPublicKey}`,
		"Content-Encoding": "aes128gcm",
		"Content-Type": "application/octet-stream",
		TTL: String(ttl)
	};
	if (urgency) headers.Urgency = urgency;
	if (topic) headers.Topic = topic;
	return headers;
};
/**
* Push services answer in a few hundred bytes. The endpoint is chosen by the
* subscriber, so without a cap a hostile one could stream an unbounded body
* into memory on every send.
*/
const MAX_RESPONSE_BODY_BYTES = 4096;
const readBodyPrefix = async (response) => {
	if (!response.body) return "";
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let text = "";
	let bytesRead = 0;
	while (bytesRead < MAX_RESPONSE_BODY_BYTES) {
		const { done, value } = await reader.read();
		if (done) return text + decoder.decode();
		text += decoder.decode(value.subarray(0, MAX_RESPONSE_BODY_BYTES - bytesRead), { stream: true });
		bytesRead += value.length;
	}
	reader.cancel().catch(ignore);
	return text;
};
const ignore = () => {};
const postToPushService = async (subscription, payloadBytes, jwt, vapidPublicKey, options) => {
	const { logger, ttl = DEFAULT_TTL_S, urgency, topic, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
	const encryptedPayload = await encryptPayload(payloadBytes, subscription.keys.p256dh, subscription.keys.auth);
	const response = await fetch(subscription.endpoint, {
		method: "POST",
		headers: buildPushHeaders({
			jwt,
			vapidPublicKey,
			ttl: wholeTtl(ttl),
			urgency,
			topic
		}),
		body: encryptedPayload,
		signal: requestSignal(signal, wholeTimeoutMs(timeoutMs))
	});
	const settled = response.ok || isSubscriptionGone(response.status);
	if (settled && !logger?.debug) {
		response.body?.cancel().catch(ignore);
		return response.ok;
	}
	const responseText = await readBodyPrefix(response);
	const keptTtl = response.headers.get("ttl");
	logger?.debug?.("Push response", {
		endpoint: subscription.endpoint.slice(0, 50),
		status: response.status,
		statusText: response.statusText,
		body: responseText.slice(0, 200),
		location: response.headers.get("location")?.slice(0, 50) ?? null,
		ttl: keptTtl === null ? null : Number(keptTtl)
	});
	if (settled) return response.ok;
	throw new WebPushError(response.status === 429 ? `Push rate limit exceeded: ${response.statusText}` : `Push service error: ${response.status} ${response.statusText}`, response.status, responseText, subscription.endpoint, response.headers.get("retry-after"));
};
/**
* Send a push notification to a subscription endpoint.
*
* Each request carries a timeout (default 30s) and, when provided, the
* caller's `signal`; hitting either rejects with the abort reason.
*
* @param payload A {@link PushPayload} is JSON-serialized; a {@link rawPayload}
* wrapper is encrypted and sent verbatim
* @returns `true` once the push service accepts the message, `false` when the
* subscription is gone (404/410) and should be deleted from your store
* @throws {WebPushError} on rate limits (429) and other push service errors
* @throws {TypeError} when `fetch` never reaches the push service: DNS, TLS, a dropped connection
* @throws {DOMException} `TimeoutError` after `timeoutMs`
* @throws the `signal`'s abort reason when it aborts: an `AbortError` `DOMException`
* unless you passed `abort()` a reason of your own
* @throws {InvalidSubscriptionError} when the subscription's endpoint isn't an
* `https:` URL or its keys are missing or malformed: delete it
* @throws {Error} on your own invalid input: VAPID config, payload size,
* `topic`, `ttl` or `timeoutMs`
* @example
* ```ts
* const delivered = await sendPushNotification(subscription, payload, vapid);
* if (!delivered) await removeFromStore(subscription.endpoint);
* ```
* @see {@link https://web-push.thelazyweb.dev/guides/handle-errors/ | Handle errors and retries}
* @see {@link https://web-push.thelazyweb.dev/guides/collapse-notifications/ | Collapse and expire notifications}
*/
const sendPushNotification = async (subscription, payload, vapid, options = {}) => {
	assertValidSendOptions(options);
	const payloadBytes = encodePayload(payload);
	validatePushInputs(payloadBytes, ...subscriptionKeys(subscription));
	const jwt = await createVapidJwt({
		audience: pushServiceOrigin(subscription.endpoint),
		subject: vapid.subject,
		publicKey: vapid.publicKey,
		privateKey: vapid.privateKey,
		expiration: options.vapidExpiration ?? DEFAULT_VAPID_EXPIRATION_S
	});
	return postToPushService(subscription, payloadBytes, jwt, vapid.publicKey, options);
};
/**
* Send one notification to every subscription through a bounded worker pool.
*
* Per-subscription failures never reject the batch: `delivered` counts the
* sends the push service accepted, endpoints it reported gone (404/410) come
* back in `gone` for deletion, and every other failed send comes back in
* `failed` with its error. One VAPID JWT is signed per push-service origin
* rather than per message, since the token is scoped to the origin, and
* re-signed at half its lifetime, so a batch that outlasts `vapidExpiration`
* never sends an expired one. Aborting `options.signal` stops workers from
* starting new sends; subscriptions never attempted count toward none of the three.
*
* @param payload A {@link PushPayload} is JSON-serialized; a {@link rawPayload}
* wrapper is encrypted and sent verbatim
* @throws {Error} on caller input — invalid VAPID config, oversized payload,
* invalid `topic`, `ttl`, `concurrency`, or `timeoutMs` — before anything is sent.
* A malformed subscription is per-subscription data and lands in `failed` as an
* {@link InvalidSubscriptionError}.
* @example
* ```ts
* const { delivered, gone, failed } = await sendPushBatch(subscriptions, payload, vapid);
* await removeFromStore(gone);
* for (const { endpoint, error } of failed) console.warn("push failed", endpoint, error);
* ```
* @see {@link https://web-push.thelazyweb.dev/guides/send-to-many/ | Send to many}
* @see {@link https://web-push.thelazyweb.dev/guides/handle-errors/ | Handle errors and retries}
*/
const sendPushBatch = async (subscriptions, payload, vapid, options = {}) => {
	const { concurrency = 100, ...sendOptions } = options;
	if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("concurrency must be a positive integer");
	assertValidSendOptions(sendOptions);
	const payloadBytes = encodePayload(payload);
	assertPayloadWithinLimit(payloadBytes);
	const vapidExpiration = sendOptions.vapidExpiration ?? DEFAULT_VAPID_EXPIRATION_S;
	const vapidJwtFor = (audience) => createVapidJwt({
		audience,
		subject: vapid.subject,
		publicKey: vapid.publicKey,
		privateKey: vapid.privateKey,
		expiration: vapidExpiration
	});
	await vapidJwtFor("https://push.invalid");
	const jwtByOrigin = /* @__PURE__ */ new Map();
	const cachedJwtFor = (origin) => {
		const cached = jwtByOrigin.get(origin);
		if (cached && Date.now() < cached.refreshAt) return cached.jwt;
		const signedAtMs = Math.floor(Date.now() / 1e3) * 1e3;
		const jwt = vapidJwtFor(origin);
		jwtByOrigin.set(origin, {
			jwt,
			refreshAt: signedAtMs + vapidExpiration * 1e3 / 2
		});
		return jwt;
	};
	let delivered = 0;
	const gone = [];
	const failed = [];
	const sendOne = async (subscription) => {
		try {
			if (!subscription) throw new InvalidSubscriptionError("Invalid subscription: not an object");
			validatePushInputs(payloadBytes, ...subscriptionKeys(subscription));
			const jwt = await cachedJwtFor(pushServiceOrigin(subscription.endpoint));
			if (await postToPushService(subscription, payloadBytes, jwt, vapid.publicKey, sendOptions)) delivered += 1;
			else gone.push(subscription.endpoint);
		} catch (error) {
			failed.push({
				endpoint: subscription?.endpoint ?? "",
				error
			});
		}
	};
	const queue = subscriptions.values();
	const worker = async () => {
		for (const subscription of queue) {
			if (sendOptions.signal?.aborted) return;
			await sendOne(subscription);
		}
	};
	await Promise.all(Array.from({ length: Math.min(concurrency, subscriptions.length) }, worker));
	return {
		delivered,
		gone,
		failed
	};
};
//#endregion
export { InvalidSubscriptionError, WebPushError, isPushServiceEndpoint, rawPayload, sendPushBatch, sendPushNotification, topicFromString };
