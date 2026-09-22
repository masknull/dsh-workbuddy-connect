#!/usr/bin/env node
import { C as resolveLoginRegion, E as WorkBuddyCredentialStore, T as WORKBUDDY_CREDENTIAL_SOURCE, Z as resolveAppVersion, f as WORKBUDDY_CONNECT_VERSION, i as variantFor, k as WorkBuddyUpstreamClient, l as readHostHeartbeat, m as FALLBACK_WORKBUDDY_MODELS, n as CN_VARIANT, p as FALLBACK_WORKBUDDY_AI_MODELS, r as WORKBUDDY_VARIANTS, s as isHeartbeatProcessAlive, u as workbuddyHostHeartbeatPath, x as WorkBuddyLoginClient } from "./variants-_a5XpsZh.js";
import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
//#region src/bin.ts
/** Standalone status/diagnostics CLI for the dsh-workbuddy-connect bundle. */
const JSON_SCHEMA_VERSION = 1;
/** Remove token-like strings from an unexpected diagnostic message. */
function safeMessage(error) {
	return (error instanceof Error ? error.message : String(error)).replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[redacted token]").replace(/(\b(?:code|token|refresh_token|access_token)=)[^&\s]+/giu, "$1[redacted]");
}
function printHelp() {
	process.stdout.write([
		"Usage: dsh-workbuddy-connect <doctor|import|login|status|logout> [--provider <id>] [--json] [--file <path>]",
		"",
		"  doctor   secret-free environment diagnostics",
		"  import   adopt a credential document you already have (see --file)",
		"  login    sign in through the browser (prints a URL, then waits for it)",
		"  status   sign-in state and remaining WorkBuddy credit",
		"  logout   remove the stored credential",
		"",
		"  --provider  which product to act on; defaults to workbuddy",
		`              one of: ${WORKBUDDY_VARIANTS.map((variant) => variant.id).join(", ")}`,
		"  --json      emit one secret-free JSON document (doctor/status only)",
		"  --file      credential document to import; \"-\" reads standard input",
		"",
		"  The import format is the workbuddy.json shape:",
		"    {\"auth\":{\"accessToken\":\"…\",\"refreshToken\":\"…\",\"expiresAt\":<seconds>,\"domain\":\"…\"},",
		"     \"account\":{\"uid\":\"…\",\"nickname\":\"…\"},\"region\":\"cn\"|\"global\"}",
		""
	].join("\n"));
}
function printJson(value) {
	process.stdout.write(`${JSON.stringify(value)}\n`);
}
/** One variant's store plus the client that performs its refreshes. */
function makeStore(variant) {
	const client = new WorkBuddyUpstreamClient();
	return new WorkBuddyCredentialStore({
		variant,
		refresh: (credential) => client.refreshToken(credential)
	});
}
/** Fallback roster size for one variant. */
function fallbackCount(variant) {
	return variant.id === CN_VARIANT.id ? FALLBACK_WORKBUDDY_MODELS.length : FALLBACK_WORKBUDDY_AI_MODELS.length;
}
async function doctor(jsonOutput, variant) {
	const store = makeStore(variant);
	const status = await store.status();
	const heartbeat = await readHostHeartbeat();
	const hostAlive = heartbeat !== void 0 && isHeartbeatProcessAlive(heartbeat);
	const appVersion = variant.region === "global" ? await resolveAppVersion() : void 0;
	const report = {
		schemaVersion: JSON_SCHEMA_VERSION,
		package: "dsh-workbuddy-connect",
		version: WORKBUDDY_CONNECT_VERSION,
		node: process.version,
		provider: variant.id,
		displayName: variant.displayName,
		realm: variant.region,
		credentialFile: store.ownAuthPath(),
		...appVersion === void 0 ? {} : { catalogUserAgent: {
			version: appVersion.version,
			source: appVersion.source,
			...appVersion.bundle === void 0 ? {} : { bundle: appVersion.bundle }
		} },
		hostHeartbeat: {
			path: workbuddyHostHeartbeatPath(),
			present: heartbeat !== void 0,
			...heartbeat === void 0 ? {} : {
				registeredAt: heartbeat.registeredAt,
				pid: heartbeat.pid
			},
			processAlive: hostAlive
		},
		signIn: status.state,
		fallbackModels: fallbackCount(variant),
		hints: [...status.state === "signed-in" ? [] : [`Sign in with \`dsh-workbuddy-connect login --provider ${variant.id}\`, or from the plugin's settings card.`], ...hostAlive ? [] : ["Host bundle not running in this DSH profile (or the process exited). The browser card is unavailable until DSH starts the plugin; the login command above still works."]]
	};
	if (jsonOutput) printJson(report);
	else process.stdout.write([
		`${variant.displayName} Connect ${WORKBUDDY_CONNECT_VERSION} on ${process.version}`,
		`Realm: ${report.realm}`,
		`Credential file: ${report.credentialFile}`,
		`Host bundle: ${hostAlive ? `running (pid ${heartbeat.pid})` : heartbeat !== void 0 ? "stale heartbeat (process exited)" : "not started"}`,
		`Sign-in state: ${report.signIn}`,
		`Static fallback models: ${report.fallbackModels}`,
		...appVersion === void 0 ? [] : [`Catalog User-Agent version: ${appVersion.version} (${appVersion.source})`],
		...report.hints.map((hint) => `Hint: ${hint}`),
		""
	].join("\n"));
	return status.state === "signed-in" ? 0 : 1;
}
async function status(jsonOutput, variant) {
	const store = makeStore(variant);
	const client = new WorkBuddyUpstreamClient();
	const authStatus = await store.status();
	const heartbeat = await readHostHeartbeat();
	const hostAlive = heartbeat !== void 0 && isHeartbeatProcessAlive(heartbeat);
	const hostState = hostAlive ? "running" : heartbeat !== void 0 ? "stale" : "not-started";
	if (authStatus.state !== "signed-in") {
		if (jsonOutput) printJson({
			schemaVersion: JSON_SCHEMA_VERSION,
			package: "dsh-workbuddy-connect",
			version: WORKBUDDY_CONNECT_VERSION,
			provider: variant.id,
			status: "signed-out",
			hostBundle: hostState
		});
		else process.stdout.write(`${variant.displayName} Connect: signed out\nHost bundle: ${hostState}\n`);
		return 1;
	}
	let credits;
	try {
		const credential = await store.current();
		if (credential !== void 0) {
			const fetched = await client.fetchCredits(credential);
			credits = {
				total: fetched.total,
				...fetched.unlimited === true ? { unlimited: true } : {}
			};
		}
	} catch (error) {
		credits = {
			total: 0,
			error: safeMessage(error)
		};
	}
	const expiresAt = authStatus.expiresAtMs !== void 0 ? new Date(authStatus.expiresAtMs).toISOString() : void 0;
	if (jsonOutput) {
		printJson({
			schemaVersion: JSON_SCHEMA_VERSION,
			package: "dsh-workbuddy-connect",
			version: WORKBUDDY_CONNECT_VERSION,
			provider: variant.id,
			status: "signed-in",
			...expiresAt === void 0 ? {} : { accessTokenExpires: expiresAt },
			...authStatus.nickname === void 0 ? {} : { nickname: authStatus.nickname },
			...authStatus.domain === void 0 || authStatus.domain === "" ? {} : { domain: authStatus.domain },
			...authStatus.region === void 0 ? {} : { realm: authStatus.region },
			credits: credits?.total,
			...credits?.unlimited === true ? { creditsUnlimited: true } : {},
			...credits?.error === void 0 ? {} : { creditsError: credits.error },
			hostBundle: hostState
		});
		return 0;
	}
	process.stdout.write([
		`${variant.displayName} Connect: signed in${authStatus.nickname === void 0 ? "" : ` as ${authStatus.nickname}`}`,
		...expiresAt === void 0 ? [] : [`Access token expires ${expiresAt} (refresh is automatic)`],
		credits?.error !== void 0 ? `Remaining credit: unavailable (${credits.error})` : credits?.unlimited === true ? "Remaining credit: unlimited" : `Remaining credit: ${credits?.total ?? "unknown"}`,
		`Host bundle: ${hostAlive ? `running (pid ${heartbeat.pid})` : hostState === "stale" ? "stale heartbeat (DSH process exited)" : "not started in this profile"}`,
		"Client card: load failures are logged to the browser console only; the host provider is unaffected.",
		""
	].join("\n"));
	return 0;
}
/** How often the login command re-polls the upstream while waiting for the browser. */
const LOGIN_POLL_INTERVAL_MS = 2e3;
/** How long the login command waits for the browser before giving up. */
const LOGIN_TIMEOUT_MS = 3e5;
/**
* Adopt a credential document the user already has.
*
* This is the path for a credential obtained elsewhere — a `workbuddy.json`
* written by the sibling tooling, or one pulled off another machine — so the
* plugin never has to be the thing that obtained it. The document is validated
* before anything is written, and the summary deliberately reports facts about
* the credential (which product, which account, when it expires) rather than the
* credential itself.
*
* @param variant - which product to import for.
* @param file - the document's path, or `-` for standard input.
* @returns the process exit code.
*/
async function importCredential(variant, file) {
	const store = makeStore(variant);
	let text;
	if (file === "-") text = await readStdin();
	else try {
		text = await readFile(file, "utf8");
	} catch (error) {
		process.stderr.write(`dsh-workbuddy-connect: cannot read ${file}: ${safeMessage(error)}\n`);
		return 1;
	}
	let credential;
	try {
		credential = await store.importDocument(text);
	} catch (error) {
		process.stderr.write(`dsh-workbuddy-connect: import refused: ${safeMessage(error)}\n`);
		return 1;
	}
	const expires = credential.expiresAtMs > 0 ? new Date(credential.expiresAtMs).toISOString() : "(no expiry stated)";
	process.stdout.write([
		`${variant.displayName} Connect: imported ${credential.uid === "" ? "an account" : `account ${credential.uid}`}${credential.nickname === void 0 ? "" : ` (${credential.nickname})`}`,
		`Credential file: ${store.ownAuthPath()}`,
		`Realm: ${credential.region ?? variant.region}`,
		`Access token expires: ${expires}`,
		""
	].join("\n"));
	return 0;
}
/** Read standard input to the end; used by `import --file -`. */
async function readStdin() {
	const chunks = [];
	for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	return Buffer.concat(chunks).toString("utf8");
}
/**
* Sign in from the terminal.
*
* Prints the URL and polls until the browser half finishes. This exists for the
* environments the settings card cannot reach — a headless profile, a TUI, a
* machine where DSH is not running — so a user is never required to have the
* browser half working in order to obtain a credential.
*
* @param variant - which product to sign in to.
* @returns the process exit code.
*/
async function login(variant) {
	const store = makeStore(variant);
	const client = new WorkBuddyLoginClient();
	const attempt = await client.begin(variant.region);
	process.stdout.write([
		`Sign in to ${variant.displayName} by opening this URL in a browser:`,
		"",
		`  ${attempt.authUrl}`,
		"",
		`Waiting for the sign-in to complete (up to ${Math.round(LOGIN_TIMEOUT_MS / 6e4)} minutes)…`,
		""
	].join("\n"));
	const deadline = Date.now() + LOGIN_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const outcome = await client.poll(attempt);
		if (outcome.status === "complete") {
			const region = resolveLoginRegion(variant.region, outcome.tokens.domain);
			if (region !== variant.region) {
				process.stderr.write(`dsh-workbuddy-connect: this sign-in returned a ${region === "cn" ? "WorkBuddy (CN)" : "WorkBuddy AI"} account, which belongs to the other provider; run login with --provider ${region === "cn" ? CN_VARIANT.id : "workbuddy-ai"}\n`);
				return 1;
			}
			await store.save({
				accessToken: outcome.tokens.accessToken,
				refreshToken: outcome.tokens.refreshToken,
				expiresAtMs: outcome.tokens.expiresInSec > 0 ? Date.now() + outcome.tokens.expiresInSec * 1e3 : 0,
				domain: outcome.tokens.domain,
				uid: outcome.account.uid,
				...outcome.account.enterpriseId === void 0 ? {} : { enterpriseId: outcome.account.enterpriseId },
				...outcome.account.nickname === void 0 ? {} : { nickname: outcome.account.nickname },
				source: WORKBUDDY_CREDENTIAL_SOURCE
			});
			process.stdout.write(`${variant.displayName} Connect: signed in${outcome.account.nickname === void 0 ? "" : ` as ${outcome.account.nickname}`} (credential stored at ${store.ownAuthPath()})\n`);
			return 0;
		}
		await new Promise((resolve) => setTimeout(resolve, LOGIN_POLL_INTERVAL_MS));
	}
	process.stderr.write("dsh-workbuddy-connect: timed out waiting for the browser sign-in; run login again to get a fresh URL\n");
	return 1;
}
/** Execute one boot-free command. */
async function run(argv) {
	if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
		printHelp();
		return 0;
	}
	const [rawAction, ...flags] = argv;
	if (![
		"doctor",
		"import",
		"login",
		"logout",
		"status"
	].includes(rawAction)) {
		process.stderr.write(`dsh-workbuddy-connect: expected doctor, import, login, logout, or status; got ${JSON.stringify(rawAction)}\n`);
		return 1;
	}
	const action = rawAction;
	const jsonOutput = flags.includes("--json");
	let providerId;
	let file;
	const rest = [];
	for (let index = 0; index < flags.length; index += 1) {
		const flag = flags[index];
		if (flag === "--provider") {
			providerId = flags[index + 1];
			index += 1;
			continue;
		}
		if (flag.startsWith("--provider=")) {
			providerId = flag.slice(11);
			continue;
		}
		if (flag === "--file") {
			file = flags[index + 1];
			index += 1;
			continue;
		}
		if (flag.startsWith("--file=")) {
			file = flag.slice(7);
			continue;
		}
		rest.push(flag);
	}
	const variant = providerId === void 0 ? CN_VARIANT : variantFor(providerId);
	if (variant === void 0) {
		process.stderr.write(`dsh-workbuddy-connect: unknown provider ${JSON.stringify(providerId)}; expected one of ${WORKBUDDY_VARIANTS.map((v) => v.id).join(", ")}\n`);
		return 1;
	}
	if (rest.filter((flag) => flag !== "--json").length > 0 || jsonOutput && action !== "doctor" && action !== "status") {
		process.stderr.write(`dsh-workbuddy-connect: invalid options for ${action}: ${flags.join(" ")}\n`);
		return 1;
	}
	if (action === "import" && file === void 0) {
		process.stderr.write("dsh-workbuddy-connect: import needs --file <path> (or --file - for standard input)\n");
		return 1;
	}
	if (action !== "import" && file !== void 0) {
		process.stderr.write(`dsh-workbuddy-connect: --file applies to import, not ${action}\n`);
		return 1;
	}
	try {
		switch (action) {
			case "doctor": return await doctor(jsonOutput, variant);
			case "import": return await importCredential(variant, file);
			case "login": return await login(variant);
			case "status": return await status(jsonOutput, variant);
			case "logout": {
				const store = makeStore(variant);
				await store.logout();
				process.stdout.write(`${variant.displayName} Connect: signed out; removed ${store.ownAuthPath()}\n`);
				return 0;
			}
		}
	} catch (error) {
		process.stderr.write(`dsh-workbuddy-connect: ${action} failed: ${safeMessage(error)}\n`);
		return 1;
	}
}
if (process.argv[1] !== void 0 && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) process.exitCode = await run(process.argv.slice(2));
//#endregion
export { run };
