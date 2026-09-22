window.__ModuleLoader__.load({
	id: "dsh-workbuddy-connect",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/status-paths.ts
		/** Node-free constants and types shared by the Host and browser halves. */
		/** Plugin-owned status endpoint consumed by its browser half. */
		const WORKBUDDY_STATUS_PATH = "/plugins/dsh-workbuddy-connect/status";
		/**
		* Plugin-owned probe control endpoint.
		*
		* Separate from the status route because it accepts writes: the status route's
		* loopback Host/Origin guard protects against a DNS-rebinding *page*, which is
		* not the same as authorizing a state-changing action. This route therefore
		* also requires the in-process key the browser half receives with the status
		* document.
		*/
		const WORKBUDDY_PROBE_PATH = "/plugins/dsh-workbuddy-connect/probe";
		/**
		* The international (WorkBuddy AI) variant's own pair of routes.
		*
		* Kept as separate constants rather than a computed suffix so both halves
		* reference literal strings: the browser bundle and the host bundle are built
		* independently, and a shared expression is one build-config drift away from
		* the desk asking a route the host never mounted.
		*/
		const WORKBUDDY_AI_STATUS_PATH = "/plugins/dsh-workbuddy-connect/ai/status";
		const WORKBUDDY_AI_PROBE_PATH = "/plugins/dsh-workbuddy-connect/ai/probe";
		/**
		* Plugin-owned sign-in endpoints, one per variant.
		*
		* Each variant signs in against its own realm, so each needs its own route: the
		* realm is chosen by which provider the user is looking at, never by a value the
		* browser sends. A POST here starts an attempt (or polls one, or signs out);
		* see {@link WorkBuddyWebLoginRequest}.
		*/
		const WORKBUDDY_LOGIN_PATH = "/plugins/dsh-workbuddy-connect/login";
		const WORKBUDDY_AI_LOGIN_PATH = "/plugins/dsh-workbuddy-connect/ai/login";
		//#endregion
		//#region src/client/status-document.ts
		/**
		* Whether a parsed status response really is a status document.
		*
		* A 200 is not a promise about the body: it may be empty, literal `null`, a
		* non-JSON page from a proxy, or an array. Both halves of the browser plugin
		* read the same route, so both must agree on what is valid — storing an
		* unreadable value puts something in state that the next render dereferences.
		*
		* The check is deliberately limited to the discriminator (plus `error`'s
		* `message`, which the error paragraph renders): validating optional fields
		* here would reject documents the host legitimately omits fields from.
		*/
		function isWorkBuddyWebStatus(value) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
			const wrapped = value;
			const status = wrapped["status"];
			if (status === "signed-out" || status === "signed-in") return true;
			return status === "error" && typeof wrapped["message"] === "string";
		}
		//#endregion
		//#region src/client/quota-settings-store.ts
		let pollIntervalMs = 3e5;
		const toggles = {
			cn: false,
			ai: false
		};
		/**
		* Reference-stable views of the two mutable records below.
		*
		* `useSyncExternalStore` compares snapshots by IDENTITY, so a getter that
		* builds a fresh object on every call makes its subscriber re-render forever
		* and React kills the entry (error #185 — the same crash the settings card's
		* unstable projection caused). The snapshot objects are therefore replaced
		* wholesale only when the underlying record actually changes.
		*/
		let togglesSnapshot = {
			cn: false,
			ai: false
		};
		const signIn = {
			cn: false,
			ai: false
		};
		let signInSnapshot = {
			cn: false,
			ai: false
		};
		let revision = 0;
		const listeners = /* @__PURE__ */ new Set();
		function bump() {
			revision += 1;
			for (const listener of listeners) listener();
		}
		/** Update the shared poll interval (from the settings document). */
		function setQuotaPollMs(ms) {
			if (Number.isFinite(ms) && ms >= 6e4 && pollIntervalMs !== ms) {
				pollIntervalMs = ms;
				bump();
			}
		}
		/** Read the configured poll interval. */
		function quotaPollMs() {
			return pollIntervalMs;
		}
		/** Update both sidebar toggles (from the settings document). */
		function setQuotaToggles(cn, ai) {
			if (toggles.cn !== cn || toggles.ai !== ai) {
				toggles.cn = cn;
				toggles.ai = ai;
				togglesSnapshot = { ...toggles };
				bump();
			}
		}
		/** Read the current toggles. */
		function quotaToggles() {
			return togglesSnapshot;
		}
		/** Record a variant's sign-in state from any successful status poll. */
		function noteQuotaSignIn(variantId, signedIn) {
			if (variantId === "workbuddy" && signIn.cn !== signedIn) {
				signIn.cn = signedIn;
				signInSnapshot = { ...signIn };
				bump();
			} else if (variantId === "workbuddy-ai" && signIn.ai !== signedIn) {
				signIn.ai = signedIn;
				signInSnapshot = { ...signIn };
				bump();
			}
		}
		/** Read the cached sign-in state. */
		function quotaSignInState() {
			return signInSnapshot;
		}
		/** Subscribe to any flag change; returns the disposer. */
		function onQuotaSettingsChange(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
		/** The current revision — the useSyncExternalStore snapshot value. */
		function quotaSettingsRevision() {
			return revision;
		}
		/** Which variant a status route belongs to, from the route path. */
		function variantOfStatusPath(statusPath) {
			return statusPath.includes("/ai/") ? "workbuddy-ai" : "workbuddy";
		}
		/**
		* The last status document per variant, shared by EVERY quota surface.
		*
		* The sidebar cards and the dashboard each used to fetch independently, so a
		* dashboard refresh updated the panel while the sidebar card kept showing its
		* previous read until its own next tick — two different numbers for one
		* account on one screen. One store, one write path
		* ({@link noteQuotaStatus}), and every subscriber re-renders through the
		* same revision: whatever surface refreshed last, all of them show it.
		*
		* Documents are kept by identity (never mutated), so reference comparisons
		* in useSyncExternalStore selectors stay cheap and stable.
		*/
		const statusDocuments = {
			cn: void 0,
			ai: void 0
		};
		/**
		* Publish one variant's freshly fetched status document. Downstream
		* subscribers (both sidebar cards and the dashboard, through whichever
		* observable wraps this store) re-render on the revision bump.
		*/
		function noteQuotaStatus(variantId, status) {
			if (variantId === "workbuddy" && statusDocuments.cn !== status) {
				statusDocuments.cn = status;
				statusFetchedAt.cn = Date.now();
				bump();
			} else if (variantId === "workbuddy-ai" && statusDocuments.ai !== status) {
				statusDocuments.ai = status;
				statusFetchedAt.ai = Date.now();
				bump();
			}
			noteQuotaSignIn(variantId, status.status === "signed-in");
		}
		/** Read one variant's latest status document. */
		function quotaStatus(variantId) {
			return variantId === "workbuddy" ? statusDocuments.cn : statusDocuments.ai;
		}
		/** When each variant's document was last fetched (per publish, not per read). */
		const statusFetchedAt = {
			cn: void 0,
			ai: void 0
		};
		/** Read the time a variant's current document was fetched, if any. */
		function quotaStatusFetchedAt(variantId) {
			return variantId === "workbuddy" ? statusFetchedAt.cn : statusFetchedAt.ai;
		}
		/**
		* Whether ONE variant's shared document is fresh enough to skip a fetch:
		* the user's rule — a click/mount/interval tick within the configured
		* interval of the last successful read reuses the cached document, and only
		* a variant with NO result yet (or a failed read that never landed one)
		* forces the upstream call. The interval is a cache lifetime, not a metronome.
		*
		* A `maxAgeMs` of the poll interval comes from the settings document; a
		* failed last read is NOT tracked here (callers gate failures themselves),
		* because "the last read failed" still means "no usable result".
		*
		* @param variantId - which variant's freshness to test.
		* @param maxAgeMs - the configured poll interval (cache lifetime).
		*/
		function quotaStatusIsFresh(variantId, maxAgeMs) {
			const fetchedAt = variantId === "workbuddy" ? statusFetchedAt.cn : statusFetchedAt.ai;
			const document = variantId === "workbuddy" ? statusDocuments.cn : statusDocuments.ai;
			if (fetchedAt === void 0 || document === void 0) return false;
			return Date.now() - fetchedAt < maxAgeMs;
		}
		//#endregion
		//#region src/client/QuotaSettingsCard.tsx
		/**
		* The shared quota-settings card: one card above the two variant cards that
		* configures both sidebar quota widgets.
		*
		* Like the built-in plugin cards, it registers into `settings.plugin.item`
		* keyed by its own settings namespace (`workbuddy-quota`), binds that
		* namespace through the client settings scope, and writes through the scope's
		* revision-fenced `set` — the same durable-write path every preference row
		* uses. A toggle commits on click: each click is one explicit user choice,
		* and the scope's ordering makes the last one win, so no staged-draft form is
		* needed for two booleans and a number.
		*
		* The two toggles gate the CN and international sidebar cards respectively;
		* the interval is one shared poll period. Toggles are disabled while their
		* variant is signed out: a quota card for an account nobody is signed into
		* would render an error forever, so the setting waits for a session.
		*/
		/** The default poll interval shown before a value is stored. */
		const POLL_DEFAULT_MS = 3e5;
		/** Floor the schema also enforces; mirrored here for immediate UI feedback. */
		const POLL_MIN_MS = 6e4;
		/** Read the section values out of a scope snapshot (defaults when absent). */
		function project(scope) {
			if (scope === void 0) return {
				status: "unavailable",
				writable: false,
				values: {
					sidebarQuotaCN: false,
					sidebarQuotaAI: false,
					autoCheckInCN: false,
					autoCheckInAI: false,
					quotaPollMs: POLL_DEFAULT_MS
				}
			};
			const snapshot = scope.getSnapshot();
			const value = snapshot.value ?? {};
			return {
				status: snapshot.status,
				writable: snapshot.writable,
				values: {
					sidebarQuotaCN: value.sidebarQuotaCN === true,
					sidebarQuotaAI: value.sidebarQuotaAI === true,
					autoCheckInCN: value.autoCheckInCN === true,
					autoCheckInAI: value.autoCheckInAI === true,
					quotaPollMs: typeof value.quotaPollMs === "number" ? value.quotaPollMs : POLL_DEFAULT_MS
				}
			};
		}
		/**
		* Stable-reference projection cache.
		*
		* React's useSyncExternalStore requires getSnapshot() to return THE SAME
		* reference between renders unless the store actually changed. project()
		* builds a fresh object every call, which re-renders forever and crashes the
		* card with React error #185 ("maximum update depth exceeded") — exactly the
		* crash the slot ledger reported. The cache below compares the projection
		* FIELD BY FIELD and keeps the previous object unless a value actually moved,
		* so a scope handed a fresh-but-equal snapshot object every read (which a test
		* double does, and a normalizing host may too) cannot spin the card.
		*/
		let cachedScope;
		let cachedProjection;
		const UNAVAILABLE = {
			status: "unavailable",
			writable: false,
			values: {
				sidebarQuotaCN: false,
				sidebarQuotaAI: false,
				autoCheckInCN: false,
				autoCheckInAI: false,
				quotaPollMs: POLL_DEFAULT_MS
			}
		};
		function stableProject(scope) {
			if (scope === void 0) return UNAVAILABLE;
			const next = project(scope);
			if (cachedProjection === void 0 || cachedScope !== scope || cachedProjection.status !== next.status || cachedProjection.writable !== next.writable || cachedProjection.values.sidebarQuotaCN !== next.values.sidebarQuotaCN || cachedProjection.values.sidebarQuotaAI !== next.values.sidebarQuotaAI || cachedProjection.values.autoCheckInCN !== next.values.autoCheckInCN || cachedProjection.values.autoCheckInAI !== next.values.autoCheckInAI || cachedProjection.values.quotaPollMs !== next.values.quotaPollMs) {
				cachedScope = scope;
				cachedProjection = next;
			}
			return cachedProjection;
		}
		/** One toggle row: label, hint, and a switch drawn to the shell's proportions. */
		function ToggleRow({ label, hint, checked, disabled, disabledHint, onToggle }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: rowStyle$1,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: rowTextStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: labelStyle$1,
						children: label
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: hintStyle,
						children: disabled === true && disabledHint !== void 0 ? disabledHint : hint
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					role: "switch",
					"aria-checked": checked,
					disabled,
					"aria-label": label,
					onClick: () => {
						if (disabled) return;
						onToggle(!checked);
					},
					style: {
						...switchStyle,
						background: checked ? "var(--dsw-alias-brand-primary)" : "var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.2))",
						justifyContent: checked ? "flex-end" : "flex-start",
						opacity: disabled === true ? .45 : 1,
						cursor: disabled === true ? "not-allowed" : "pointer"
					},
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: knobStyle })
				})]
			});
		}
		/**
		* The quota-settings controls on their own, with no card chrome.
		*
		* This is the half the unified WorkBuddy card embeds at the top of its body.
		* It owns its subscriptions: the scope projection (which values are saved) and
		* the shared sign-in store (which variant has a session), so a toggle
		* re-gates the moment a poll anywhere lands a document — no remount, and no
		* prop-drilling through the slot injection.
		*/
		function QuotaSettingsContent({ t = (key) => key, scope, signedIn }) {
			const subscribe = (0, react.useCallback)((onStoreChange) => {
				return scope?.subscribe(onStoreChange) ?? (() => {});
			}, [scope]);
			const projection = (0, react.useSyncExternalStore)(subscribe, () => stableProject(scope));
			const liveSignIn = (0, react.useSyncExternalStore)(onQuotaSettingsChange, quotaSignInState);
			const [probe, setProbe] = (0, react.useState)();
			(0, react.useEffect)(() => {
				let disposed = false;
				const probeOne = async (path) => {
					try {
						const body = await (await fetch(path, { headers: { accept: "application/json" } })).json();
						if (disposed || !isWorkBuddyWebStatus(body)) return void 0;
						noteQuotaSignIn(variantOfStatusPath(path), body.status === "signed-in");
						return body.status === "signed-in";
					} catch {
						return;
					}
				};
				(async () => {
					const [cn, ai] = await Promise.all([probeOne(WORKBUDDY_STATUS_PATH), probeOne(WORKBUDDY_AI_STATUS_PATH)]);
					if (!disposed) setProbe({
						cn: cn === true,
						ai: ai === true
					});
				})();
				return () => {
					disposed = true;
				};
			}, []);
			if (projection.status === "unavailable") return null;
			const reported = signedIn?.();
			/**
			* Whether one variant has a usable session, decided by whoever can best tell.
			*
			* An explicit `signedIn` reader (what the unified card passes once it has a
			* poll's answer) is authoritative. Otherwise — and that is the case this
			* exists for — a stale optimistic `true` in the store must never be enough:
			* the shared store may hold a sign-in fact from a document that has since
			* been replaced by a signed-out one. So the CURRENT document is consulted,
			* and a document saying `signed-out` closes the toggle regardless of what
			* any cached flag says.
			*/
			const deriveSigned = (variant, variantId) => {
				if (reported !== void 0) return Boolean(reported[variant]);
				const currentStatus = quotaStatus(variantId);
				if (currentStatus?.status === "signed-out") return false;
				const live = liveSignIn[variant];
				if (probe !== void 0) {
					if (!probe[variant]) return Boolean(live && currentStatus?.status === "signed-in");
					return Boolean(live);
				}
				return Boolean(live && currentStatus?.status === "signed-in");
			};
			const signed = {
				cn: deriveSigned("cn", "workbuddy"),
				ai: deriveSigned("ai", "workbuddy-ai")
			};
			const write = (field, value) => {
				if (field === "sidebarQuotaCN" && value === true && !signed.cn) return;
				if (field === "sidebarQuotaAI" && value === true && !signed.ai) return;
				if (field === "autoCheckInCN" && value === true && !signed.cn) return;
				if (field === "autoCheckInAI" && value === true && !signed.ai) return;
				scope?.set(field, value);
			};
			const minutes = Math.max(POLL_MIN_MS / 6e4, Math.round(projection.values.quotaPollMs / 6e4));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					flexDirection: "column",
					gap: 4
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToggleRow, {
						label: t("quotaToggleCN"),
						hint: t("quotaToggleHint"),
						checked: projection.values.sidebarQuotaCN,
						disabled: !signed.cn,
						disabledHint: t("quotaSignInRequired"),
						onToggle: (next) => write("sidebarQuotaCN", next)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToggleRow, {
						label: t("quotaToggleAI"),
						hint: t("quotaToggleHint"),
						checked: projection.values.sidebarQuotaAI,
						disabled: !signed.ai,
						disabledHint: t("quotaSignInRequired"),
						onToggle: (next) => write("sidebarQuotaAI", next)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToggleRow, {
						label: t("quotaAutoCheckInCN"),
						hint: t("quotaAutoCheckInCNHint"),
						checked: projection.values.autoCheckInCN,
						disabled: !signed.cn,
						disabledHint: t("quotaSignInRequired"),
						onToggle: (next) => write("autoCheckInCN", next)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToggleRow, {
						label: t("quotaAutoCheckInAI"),
						hint: t("quotaAutoCheckInAIHint"),
						checked: projection.values.autoCheckInAI,
						disabled: !signed.ai,
						disabledHint: t("quotaSignInRequired"),
						onToggle: (next) => write("autoCheckInAI", next)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							...rowStyle$1,
							borderBottom: "none",
							paddingBottom: 0
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: rowTextStyle,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: labelStyle$1,
								children: t("quotaPollLabel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: hintStyle,
								children: t("quotaPollHint")
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: pollFieldStyle,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "number",
								min: POLL_MIN_MS / 6e4,
								step: 1,
								value: minutes,
								"aria-label": t("quotaPollLabel"),
								onChange: (event) => {
									const mins = Number.parseInt(event.target.value, 10);
									if (Number.isFinite(mins) && mins > 0) write("quotaPollMs", Math.max(POLL_MIN_MS, mins * 6e4));
								},
								style: inputStyle
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: hintStyle,
								children: t("quotaPollUnit")
							})]
						})]
					}),
					projection.writable === false ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: hintStyle,
						children: t("quotaSettingsSaveFailed")
					}) : null
				]
			});
		}
		/**
		* One settings row: NO box of its own (the bordered rows read as nested
		* cards, which the user ruled against) — rows are separated by a hairline
		* bottom rule like the settings shell's own preference lists.
		*/
		const rowStyle$1 = {
			display: "flex",
			alignItems: "center",
			gap: 12,
			borderBottom: ".5px solid var(--dsw-alias-border-l2)",
			paddingBottom: 10
		};
		const rowTextStyle = {
			display: "flex",
			flex: 1,
			minWidth: 0,
			flexDirection: "column",
			gap: 2
		};
		const labelStyle$1 = {
			fontSize: 13,
			fontWeight: 500,
			lineHeight: 1.5,
			color: "var(--dsw-alias-label-primary)"
		};
		const hintStyle = {
			fontSize: 12,
			lineHeight: 1.5,
			color: "var(--dsw-alias-label-tertiary)"
		};
		const switchStyle = {
			flex: "none",
			display: "flex",
			width: 36,
			height: 20,
			borderRadius: 10,
			borderWidth: "1px",
			borderStyle: "solid",
			borderColor: "var(--dsw-alias-border-l2)",
			padding: 1,
			cursor: "pointer",
			alignItems: "center",
			transition: "background .16s"
		};
		const knobStyle = {
			display: "block",
			width: 16,
			height: 16,
			borderRadius: "50%",
			background: "var(--dsw-alias-bg-layer-1, #fff)",
			boxShadow: "0 1px 2px rgba(0,0,0,0.2)"
		};
		const pollFieldStyle = {
			display: "flex",
			alignItems: "center",
			gap: 6,
			flex: "none"
		};
		const inputStyle = {
			boxSizing: "border-box",
			width: 55,
			padding: "5px 8px",
			borderWidth: "1px",
			borderStyle: "solid",
			borderColor: "var(--dsw-alias-border-l2)",
			borderRadius: 8,
			background: "var(--dsw-alias-bg-layer-2)",
			color: "var(--dsw-alias-label-primary)",
			font: "inherit",
			fontSize: 13,
			textAlign: "right"
		};
		//#endregion
		//#region src/client/WorkBuddyPluginCard.tsx
		/** WorkBuddy status card contributed to Harness Plugin configuration. */
		/** CN WorkBuddy; the plugin's long-standing card and default. */
		const CN_CARD_VARIANT = {
			id: "workbuddy",
			titleKey: "title",
			introKey: "intro",
			signedOutKey: "signedOutHint",
			statusPath: WORKBUDDY_STATUS_PATH,
			probePath: WORKBUDDY_PROBE_PATH,
			loginPath: WORKBUDDY_LOGIN_PATH
		};
		/** International WorkBuddy AI. */
		const AI_CARD_VARIANT = {
			id: "workbuddy-ai",
			titleKey: "titleAI",
			introKey: "introAI",
			signedOutKey: "signedOutHintAI",
			statusPath: WORKBUDDY_AI_STATUS_PATH,
			probePath: WORKBUDDY_AI_PROBE_PATH,
			loginPath: WORKBUDDY_AI_LOGIN_PATH
		};
		/** Both cards, in display order. */
		const CARD_VARIANTS = [CN_CARD_VARIANT, AI_CARD_VARIANT];
		const POLL_INTERVAL_MS = 6e4;
		const cardStyle = {
			listStyle: "none",
			borderWidth: "0.5px",
			borderStyle: "solid",
			borderColor: "var(--dsw-alias-border-l4)",
			borderRadius: 16,
			background: "var(--dsw-alias-bg-layer-3)",
			transition: "border-color .16s, background .16s"
		};
		/** Hover, matching the built-in card's `:hover`. Inline styles cannot express a pseudo-class. */
		const cardHoverStyle = { borderColor: "var(--dsw-alias-label-dimmed)" };
		/** Expanded, matching the built-in card's open state. */
		const cardOpenStyle = {
			background: "var(--dsw-alias-bg-layer-2)",
			borderColor: "var(--dsw-alias-label-dimmed)"
		};
		const headerStyle = {
			boxSizing: "border-box",
			width: "100%",
			display: "flex",
			alignItems: "center",
			gap: 12,
			borderWidth: 0,
			borderStyle: "solid",
			borderColor: "transparent",
			borderRadius: 12,
			padding: "14px 16px",
			background: "transparent",
			color: "inherit",
			font: "inherit",
			textAlign: "left",
			cursor: "pointer",
			appearance: "none"
		};
		/**
		* The built-in header's keyboard focus ring.
		*
		* `:focus-visible` is what makes the ring appear for keyboard navigation but not
		* for a mouse click, and an inline style cannot express a pseudo-class — so the
		* component tracks it and applies this instead. Without it the header falls back
		* to the browser's own outline, which is the black box that used to appear on
		* focus where the built-in card shows a brand-coloured ring.
		*/
		const headerFocusStyle = {
			outline: "2px solid var(--dsw-alias-brand-primary)",
			outlineOffset: -2
		};
		const headTextStyle = {
			display: "flex",
			flex: 1,
			minWidth: 0,
			flexDirection: "column",
			gap: 4
		};
		const nameStyle = {
			fontSize: 15,
			lineHeight: 1.4,
			fontWeight: 600,
			color: "var(--dsw-alias-label-primary)"
		};
		const descriptionStyle = {
			fontSize: 13,
			lineHeight: 1.5,
			color: "var(--dsw-alias-label-tertiary)"
		};
		/**
		* The disclosure chevron, drawn to match the Settings panel's own card.
		*
		* The built-in card renders `IconChevronDownOutline14` from the client's shared
		* icon catalog, which the shell seeds into the module table. This plugin does
		* not request that catalog, so the same outline is drawn here from the same path
		* data: the text `⌄` glyph this replaces had a different shape, weight, and
		* baseline from the icon the cards beside it use.
		*/
		function ChevronDownIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: 14,
				height: 14,
				viewBox: "0 0 14 14",
				fill: "none",
				xmlns: "http://www.w3.org/2000/svg",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z",
					fill: "currentColor"
				})
			});
		}
		/** The built-in card's chevron rule: tertiary color, and only the rotation animates. */
		const chevronStyle = {
			flex: "none",
			display: "flex",
			color: "var(--dsw-alias-label-tertiary)",
			transition: "transform .16s"
		};
		const cardBodyStyle = {
			borderTop: ".5px solid var(--dsw-alias-border-l2)",
			margin: "0 16px",
			padding: "12px 0 8px"
		};
		const bodyStyle = {
			margin: 0,
			fontSize: 13,
			lineHeight: 1.5,
			color: "var(--dsw-alias-label-tertiary)"
		};
		const rowStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			flexWrap: "wrap",
			gap: 12
		};
		const statusStyle = {
			display: "flex",
			alignItems: "center",
			gap: 8,
			fontSize: 13,
			fontWeight: 500,
			lineHeight: 1.5,
			color: "var(--dsw-alias-label-primary)"
		};
		/** The built-in secondary button: transparent, hairline border, 8px radius. */
		const buttonStyle$1 = {
			boxSizing: "border-box",
			padding: "5px 14px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 8,
			background: "transparent",
			color: "var(--dsw-alias-label-secondary)",
			font: "inherit",
			fontSize: 13,
			lineHeight: 1.5,
			cursor: "pointer"
		};
		const errorStyle = {
			...bodyStyle,
			color: "var(--dsw-alias-state-error-primary)"
		};
		const quotaListStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 18,
			paddingTop: 2
		};
		const quotaGroupStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 10
		};
		const quotaTitleStyle = {
			margin: 0,
			fontSize: 13,
			lineHeight: 1.5,
			fontWeight: 600,
			color: "var(--dsw-alias-label-primary)"
		};
		const quotaLabelStyle = {
			display: "flex",
			justifyContent: "space-between",
			gap: 12,
			fontSize: 13,
			lineHeight: 1.5,
			color: "var(--dsw-alias-label-secondary)"
		};
		const modelBadgeStyle = {
			display: "flex",
			alignItems: "center",
			gap: 6,
			flexWrap: "wrap"
		};
		const modelOfferStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 2
		};
		const modelRateStyle = {
			fontSize: 12,
			lineHeight: 1.5,
			color: "var(--dsw-alias-label-tertiary)"
		};
		const contextPreferenceStyle = {
			display: "flex",
			alignItems: "flex-start",
			gap: 9,
			padding: "10px 12px",
			border: ".5px solid var(--dsw-alias-border-l4)",
			borderRadius: 8,
			background: "var(--dsw-alias-bg-layer-3)",
			color: "var(--dsw-alias-label-primary)",
			fontSize: 13,
			lineHeight: 1.5
		};
		const contextPreferenceCopyStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 2
		};
		/** The right-hand cell of one context-window row: value and its note on one line. */
		const contextPickerRowStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "flex-end",
			gap: 8,
			flexWrap: "wrap"
		};
		/**
		* The promotional badge chip: the theme's soft success tint for the fill and its
		* solid tone for the text. Both tokens exist in the shipped theme — the
		* `-subtle` spelling this used to carry does not, which silently fell back to a
		* hand-picked green and read as off-brand.
		*/
		const modelBadgeChipStyle = {
			padding: "1px 8px",
			borderRadius: 999,
			fontSize: 11,
			lineHeight: "18px",
			background: "var(--dsw-alias-state-success-tertiary)",
			color: "var(--dsw-alias-state-success-primary)"
		};
		/**
		* Localize an upstream promotional badge label, with an unknown-badge fallback.
		*
		* The CN catalog spells badges in Chinese (`限时免费`, `夜间折扣`); the
		* international document's `modelPromotions` carries English (`Free now`). Both
		* are mapped so the same promotion reads consistently in either UI language,
		* and anything else passes through verbatim — an unrecognized badge is still
		* information the upstream chose to show.
		*/
		function modelBadgeLabel(badge, t) {
			if (badge === "限时免费") return t("badgeLimitedFree");
			if (badge === "夜间折扣") return t("badgeNightDiscount");
			if (badge === "Free now") return t("badgeFreeNow");
			return badge;
		}
		const progressTrackStyle = {
			height: 10,
			overflow: "hidden",
			borderRadius: 999,
			background: "var(--dsw-alias-bg-layer-3, rgba(128, 128, 128, 0.12))",
			border: "1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.2))",
			boxSizing: "border-box"
		};
		/**
		* Inline confirmation box for a paid detection. Replaces the previous
		* `window.confirm`: the decision is one line plus two buttons, and a modal
		* alert for that is heavier than the action it guards.
		*/
		const confirmBoxStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 10,
			padding: "10px 12px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 8,
			background: "var(--dsw-alias-bg-layer-1)"
		};
		const confirmRowStyle$1 = {
			display: "flex",
			justifyContent: "flex-end",
			gap: 8
		};
		/** One probeable model's row: name on the left, state and action on the right. */
		const probeRowStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			gap: 12
		};
		const probeRowEndStyle = {
			display: "inline-flex",
			alignItems: "center",
			gap: 8,
			flex: "0 0 auto"
		};
		/**
		* Tab strip for the card body. Kept visually light — a full pill would compete
		* with the section headings, and the card is already the densest surface the
		* plugin owns.
		*/
		const tabBarStyle = {
			display: "flex",
			gap: 4,
			marginTop: 4,
			borderBottom: "1px solid var(--dsw-alias-border-l2)"
		};
		const tabStyle = {
			padding: "6px 12px",
			border: 0,
			borderBottom: "2px solid transparent",
			background: "transparent",
			color: "var(--dsw-alias-label-tertiary)",
			font: "inherit",
			fontSize: 13,
			lineHeight: "20px",
			cursor: "pointer"
		};
		const tabActiveStyle = {
			borderBottom: "2px solid var(--dsw-alias-brand-primary)",
			color: "var(--dsw-alias-label-primary)",
			fontWeight: 600
		};
		const tabPanelStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 18,
			paddingTop: 16
		};
		/**
		* The unified card's variant switcher: a segmented control, not the tab strip
		* above it.
		*
		* It sits at the TOP of the card body and chooses WHICH account the rest of
		* the card shows, so it reads as a container switcher — an inset track with a
		* raised active segment — while the strip below stays a flat underline for
		* switching sections within one account. The tints are the theme's own layer
		* tokens, so the control matches the settings shell's other segmented picks.
		*/
		const segmentedContainerStyle = {
			display: "flex",
			alignItems: "center",
			background: "var(--dsw-alias-bg-layer-1, rgba(20, 20, 20, 0.6))",
			borderWidth: "1px",
			borderStyle: "solid",
			borderColor: "var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.08))",
			borderRadius: 8,
			padding: 3,
			gap: 4,
			marginTop: 14,
			marginBottom: 16
		};
		function segmentedTabItemStyle(active) {
			return {
				flex: 1,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				gap: 8,
				padding: "6px 12px",
				borderRadius: 6,
				borderWidth: "1px",
				borderStyle: "solid",
				borderColor: active ? "var(--dsw-alias-border-l4, rgba(255, 255, 255, 0.18))" : "transparent",
				background: active ? "var(--dsw-alias-bg-layer-3, rgba(255, 255, 255, 0.08))" : "transparent",
				color: active ? "var(--dsw-alias-label-primary, #fff)" : "var(--dsw-alias-label-tertiary, #8c8c8c)",
				fontWeight: active ? 500 : 400,
				fontSize: 13,
				lineHeight: "18px",
				cursor: "pointer",
				appearance: "none",
				outline: "none",
				transition: "all .16s ease"
			};
		}
		/**
		* Primary action of the inline confirmation. Fill and text colour come from the
		* theme as a pair: `brand-primary` is a light accent here, so pairing it with a
		* hardcoded white would render white-on-white.
		*/
		const primaryButtonStyle$1 = {
			...buttonStyle$1,
			borderWidth: "1px",
			borderStyle: "solid",
			borderColor: "var(--dsw-alias-button-primary-fill)",
			background: "var(--dsw-alias-button-primary-fill)",
			color: "var(--dsw-alias-label-primary-foreground)"
		};
		function progressFillStyle(percent) {
			return {
				width: `${Math.max(0, Math.min(100, percent))}%`,
				height: "100%",
				borderRadius: "inherit",
				background: "var(--dsw-alias-brand-primary, #1677ff)"
			};
		}
		/**
		* Status dot colour. Takes `'loading'` as well as the document's own states:
		* before the first response the card knows nothing about the account, so it must
		* not borrow the signed-out grey — that would read as "nothing is wrong, nobody
		* is signed in" when the truth is "not read yet".
		*/
		function dotStyle(status) {
			return {
				width: 8,
				height: 8,
				borderRadius: "50%",
				flex: "0 0 auto",
				background: status === "signed-in" ? "var(--dsw-alias-state-success-primary, #22a06b)" : status === "error" ? "var(--dsw-alias-state-error-primary, #d92d20)" : "var(--dsw-alias-label-dimmed, #9aa0a6)"
			};
		}
		function formatNumber(value) {
			return new Intl.NumberFormat(void 0).format(value);
		}
		function formatTime(ms) {
			return new Intl.DateTimeFormat(void 0, {
				dateStyle: "medium",
				timeStyle: "short"
			}).format(new Date(ms));
		}
		function formatCycleReset(time) {
			const parsed = Date.parse(time);
			if (!Number.isNaN(parsed)) return formatTime(parsed);
			return time;
		}
		/**
		* One billing package as a labeled progress bar.
		*
		* A package whose allowance the upstream never reported (`size` not positive)
		* has no percentage to state. It must not fall back to 100%: the plugin would be
		* claiming a full quota it knows nothing about, which is the opposite of the
		* honest "remaining N" line printed below it. Unknown size therefore renders the
		* percent slot as unknown copy and an unfilled, indeterminate track.
		*/
		function CreditBar({ label, remain, size, unlimited, packageEndTime, t }) {
			const expiryNode = packageEndTime === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				style: modelRateStyle,
				children: [
					t("quotaExpires"),
					" ",
					formatCycleReset(packageEndTime)
				]
			});
			if (unlimited === true) {
				const quotaText = t("unlimitedQuota");
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: quotaGroupStyle,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: quotaLabelStyle,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontWeight: 600,
									color: "var(--dsw-alias-label-primary)"
								},
								children: label
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									...bodyStyle,
									fontWeight: 500,
									color: "var(--dsw-alias-label-primary)"
								},
								children: t("quotaRemainStats", { remain: "∞" })
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: progressTrackStyle,
							role: "progressbar",
							"aria-label": label,
							"aria-valuetext": quotaText
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: rowStyle,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: bodyStyle,
								children: quotaText
							}), expiryNode]
						})
					]
				});
			}
			const sizeKnown = size > 0;
			const isZeroQuota = size === 0 && remain === 0;
			const used = Math.max(0, size - remain);
			const usedPercent = size > 0 ? Math.min(100, Math.max(0, Math.round(used / size * 100))) : 0;
			const leftText = sizeKnown ? `${formatNumber(used)} / ${formatNumber(size)} (${t("quotaUsedPercent", { percent: usedPercent })})` : isZeroQuota ? `0 / 0 (${t("quotaUsedPercent", { percent: 0 })})` : t("creditPackageUnknownSize", { remain: formatNumber(remain) });
			const rightText = sizeKnown || isZeroQuota ? t("quotaRemainStats", { remain: formatNumber(remain) }) : t("percentUnknown");
			const indeterminate = !sizeKnown && !isZeroQuota;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: quotaGroupStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: quotaLabelStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontWeight: 600,
								color: "var(--dsw-alias-label-primary)"
							},
							children: label
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								...bodyStyle,
								fontWeight: 500,
								color: remain > 0 ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-label-tertiary)"
							},
							children: rightText
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: progressTrackStyle,
						role: "progressbar",
						"aria-label": label,
						...indeterminate ? { "aria-valuetext": leftText } : {
							"aria-valuemin": 0,
							"aria-valuemax": 100,
							"aria-valuenow": usedPercent
						},
						children: size > 0 && usedPercent > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { style: progressFillStyle(usedPercent) }) : null
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: rowStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: bodyStyle,
							children: leftText
						}), expiryNode]
					})
				]
			});
		}
		/**
		* One model offer row: name, promotional badges, and the billing rate.
		*
		* The rate sits under the name rather than beside it because the row already
		* spends its horizontal budget on badges; stacking keeps long model names and
		* several badges from squeezing the rate into an ellipsis.
		*/
		function ModelOfferRow({ model, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: modelOfferStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: quotaLabelStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: model.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: modelBadgeStyle,
						children: [model.badges?.map((badge) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: modelBadgeChipStyle,
							children: modelBadgeLabel(badge, t)
						}, badge)), model.free === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: modelBadgeChipStyle,
							children: t("freeModel")
						}) : null]
					})]
				}), model.credits === void 0 ? model.rateUnknown === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: modelRateStyle,
					children: t("rateUnknown")
				}) : null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: modelRateStyle,
					children: t("rate", { rate: model.credits })
				})]
			});
		}
		/**
		* Context capacity, listed in full.
		*
		* Every model the upstream reports a capacity for, largest first. A one-line
		* summary with the exceptions on hover was tried and rejected: capacity is
		* reference data you scan by model, and hiding most of it behind a hover made
		* the common case (a model you already have in mind) the hard one to look up.
		*
		* Purely a report of the upstream's own numbers. The plugin offers no tier
		* picker: the CN catalog declares one capacity per model and publishes no
		* alternatives, so a menu there would mean inventing client-side policy. The
		* international document does declare alternatives (`supportedLengths`), and
		* they are shown as a secondary figure rather than merged into one number —
		* the default is the budget actually requested, while the larger value is a
		* ceiling the upstream would accept.
		*/
		function ContextTable({ models, t, useMaximumContextWindow, disabled, onUseMaximumContextWindow }) {
			const known = (models ?? []).filter((model) => model.contextWindow !== void 0).sort((a, b) => b.contextWindow - a.contextWindow);
			const canSelectMaximum = known.some((model) => model.maxContextWindow !== void 0 && model.maxContextWindow > (model.defaultContextWindow ?? model.contextWindow ?? 0));
			const showPreference = onUseMaximumContextWindow !== void 0 && (canSelectMaximum || useMaximumContextWindow === true);
			if (known.length === 0 && !showPreference) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: quotaListStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						style: quotaTitleStyle,
						children: t("contextHeading")
					}),
					showPreference && onUseMaximumContextWindow !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						style: contextPreferenceStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: useMaximumContextWindow === true,
							disabled,
							onChange: (event) => {
								onUseMaximumContextWindow(event.currentTarget.checked);
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: contextPreferenceCopyStyle,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("useMaximumContextWindow") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: modelRateStyle,
								children: t("useMaximumContextWindowHint")
							})]
						})]
					}) : null,
					known.map((model) => {
						const capacity = model.contextWindow;
						const alternative = model.maxContextWindow !== void 0 && model.maxContextWindow > capacity ? model.maxContextWindow : void 0;
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: quotaLabelStyle,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: model.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: contextPickerRowStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: formatTokens(capacity) }), alternative !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: modelRateStyle,
									children: t("contextUpTo", { size: formatTokens(alternative) })
								}) : model.defaultContextWindow !== void 0 && model.defaultContextWindow < capacity ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: modelRateStyle,
									children: t("contextDefault", { size: formatTokens(model.defaultContextWindow) })
								}) : null]
							})]
						}, model.id);
					})
				]
			});
		}
		/**
		* Compact token count for display: the catalog's own round numbers (`200000`,
		* `1000000`) read better as `200K` / `1M`, and no precision is lost because
		* these values are always whole thousands.
		*/
		function formatTokens(tokens) {
			if (tokens >= 1e6 && tokens % 1e6 === 0) return `${tokens / 1e6}M`;
			if (tokens >= 1e3 && tokens % 1e3 === 0) return `${tokens / 1e3}K`;
			return String(tokens);
		}
		/**
		* Reasoning-effort detection section: consent switches, per-model detection,
		* and the recorded observations.
		*
		* Two deliberate UX rules from the plan (§3.1, §3.2):
		* - the confirmation is shown *before* any request, and its copy states the
		*   credit caveat;
		* - a `non-validating` result is presented as an observation about the
		*   parameter ("this model does not check it"), never as a statement that a
		*   level is unsupported.
		*/
		function ProbeSection({ probe, t, onDetect, onClear, busy }) {
			const [pending, setPending] = (0, react.useState)();
			const [runningModel, setRunningModel] = (0, react.useState)();
			(0, react.useEffect)(() => {
				if (pending !== void 0 && !probe.candidates.includes(pending)) setPending(void 0);
			}, [pending, probe.candidates]);
			const runningArmed = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				if (runningModel === void 0) return;
				if (busy || probe.running) {
					runningArmed.current = true;
					return;
				}
				if (!runningArmed.current) return;
				runningArmed.current = false;
				setRunningModel(void 0);
			}, [
				runningModel,
				busy,
				probe.running
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: quotaListStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						style: quotaTitleStyle,
						children: t("probeHeading")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: bodyStyle,
						children: t("probeIntro")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: bodyStyle,
						children: t("probeConsentHint")
					}),
					probe.running ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: bodyStyle,
						children: t("probeRunningGeneric")
					}) : null,
					probe.candidates.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: bodyStyle,
						children: t("probeResultEmpty")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: quotaGroupStyle,
						children: probe.candidates.map((id) => {
							const result = probe.results.find((entry) => entry.id === id);
							const name = result?.name ?? id;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: modelOfferStyle,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: probeRowStyle,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: name }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											style: probeRowEndStyle,
											children: [result === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: modelBadgeChipStyle,
												children: result.validation === "validating" && result.efforts.length > 0 ? result.efforts.join(" / ") : t(result.validation === "non-validating" ? "probeResultNotValidating" : "probeResultUnknown")
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												style: buttonStyle$1,
												disabled: probe.running || busy,
												onClick: () => {
													setPending(id);
												},
												children: runningModel === id ? t("probeRunning", { model: id }) : t(result === void 0 ? "probeStart" : "probeRedetect")
											})]
										})]
									}),
									result === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: modelRateStyle,
										children: t("probeResultAt", { time: formatTime(result.probedAt) })
									}),
									pending === id ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: confirmBoxStyle,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											style: bodyStyle,
											children: t("probeConfirmBody", { model: name })
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: confirmRowStyle$1,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												style: buttonStyle$1,
												onClick: () => {
													setPending(void 0);
												},
												children: t("cancel")
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												style: primaryButtonStyle$1,
												disabled: probe.running || busy,
												onClick: () => {
													setRunningModel(id);
													setPending(void 0);
													onDetect(id);
												},
												children: t("probeConfirmAction")
											})]
										})]
									}) : null
								]
							}, id);
						})
					}),
					probe.results.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						style: buttonStyle$1,
						disabled: busy,
						onClick: () => {
							onClear();
						},
						children: t("probeClear")
					})
				]
			});
		}
		function CheckInLogTable({ logs = [], t, onCheckIn, onRefresh, onClear, busy, checkingIn, clearing, disabled, notice }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: quotaListStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							flexWrap: "wrap",
							gap: 8
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							style: quotaTitleStyle,
							children: t("tabCheckIn")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								alignItems: "center",
								gap: 6
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: buttonStyle$1,
									disabled: disabled || busy || checkingIn,
									onClick: onCheckIn,
									children: checkingIn ? t("checkInChecking") : t("checkInNow")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: buttonStyle$1,
									disabled: busy || checkingIn,
									onClick: onRefresh,
									children: busy ? t("checkInRefreshing") : t("checkInRefresh")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: buttonStyle$1,
									disabled: busy || clearing || !logs || logs.length === 0,
									onClick: onClear,
									children: clearing ? t("checkInClearing") : t("checkInClear")
								})
							]
						})]
					}),
					notice === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: bodyStyle,
						children: notice
					}),
					!logs || logs.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: descriptionStyle,
						children: t("checkInLogEmpty")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							flexDirection: "column",
							gap: 6
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								borderBottom: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.15))",
								paddingBottom: 6,
								fontSize: 12,
								color: "var(--dsw-alias-label-tertiary)"
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: { flex: 2 },
									children: t("checkInLogTime")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: { flex: 3 },
									children: t("checkInLogResult")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										flex: 1,
										textAlign: "right"
									},
									children: t("checkInLogAmount")
								})
							]
						}), logs.map((log) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								alignItems: "center",
								padding: "6px 0",
								fontSize: 13,
								borderBottom: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.08))"
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										flex: 2,
										color: "var(--dsw-alias-label-secondary)"
									},
									children: formatTime(log.timestamp)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: {
										flex: 3,
										display: "flex",
										alignItems: "center",
										gap: 6
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
										width: 6,
										height: 6,
										borderRadius: "50%",
										flexShrink: 0,
										background: log.status === "claimed" ? "var(--dsw-alias-status-success, #52c41a)" : log.status === "already-claimed" ? "var(--dsw-alias-status-info, #1890ff)" : log.status === "no-campaign" ? "var(--dsw-alias-label-tertiary, #999)" : "var(--dsw-alias-status-error, #f5222d)"
									} }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: log.status === "claimed" ? t("autoCheckInStatusClaimed", { amount: log.amount ?? 100 }) : log.status === "already-claimed" ? t("autoCheckInStatusAlready") : log.status === "no-campaign" ? t("autoCheckInStatusNoCampaign") : t("autoCheckInStatusError", { message: log.message ?? "" }) })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										flex: 1,
										textAlign: "right",
										fontWeight: 600,
										color: log.amount ? "var(--dsw-alias-brand-primary)" : "inherit"
									},
									children: log.amount ? `+${log.amount}` : "-"
								})
							]
						}, log.id))]
					})
				]
			});
		}
		/** Render WorkBuddy sign-in state and credit as one expandable card. */
		function WorkBuddyPluginCard(props) {
			const { t, scope, signedIn, variant, unified } = props;
			if (t === void 0) throw new Error("WorkBuddy plugin card requires its translation function");
			const isUnified = unified === true;
			const liveSignIn = (0, react.useSyncExternalStore)(onQuotaSettingsChange, quotaSignInState);
			const [activeVariantId, setActiveVariantId] = (0, react.useState)("workbuddy");
			const currentVariant = isUnified ? activeVariantId === "workbuddy" ? CN_CARD_VARIANT : AI_CARD_VARIANT : variant ?? CN_CARD_VARIANT;
			const [open, setOpen] = (0, react.useState)(false);
			/** Whether the pointer is over the card; drives the same border tint the built-in card gets on hover. */
			const [hovered, setHovered] = (0, react.useState)(false);
			/** Keyboard focus on the header, reproducing the built-in's `:focus-visible` ring. */
			const [headerFocused, setHeaderFocused] = (0, react.useState)(false);
			/**
			* The document to render. `undefined` means *not read yet*, which is a
			* distinct state from "signed out": seeding this with a signed-out document
			* told an already-signed-in user they were signed out for the whole first
			* round trip (and forever, if the read never settled).
			*/
			const [status, setStatus] = (0, react.useState)();
			/**
			* Whether the last **successful** read found a usable credential.
			*
			* Kept apart from `status` because the poll's liveness must depend on what the
			* account actually is, not on what the card last displayed: a failed read
			* leaves this untouched, so a transient failure cannot disarm the interval,
			* while a genuine signed-out answer still stops it.
			*
			* `undefined` therefore means "no successful read yet", which is also the
			* condition that decides whether a failed read has anything to preserve.
			*
			* Named `...State` because in unified mode the injected sign-in reader is
			* `signedIn` — the two are different things and must not shadow each other.
			*/
			const [signedInState, setSignedInState] = (0, react.useState)();
			/**
			* Why the most recent read failed, when it did. Rendered as a notice beside
			* whatever document is still on screen, rather than replacing it.
			*/
			const [readFailure, setReadFailure] = (0, react.useState)();
			const [busy, setBusy] = (0, react.useState)(false);
			/**
			* The in-flight sign-in attempt, when there is one.
			*
			* `state` is the attempt to poll and `url` is where the human was sent, kept
			* so the card can offer the link again after a re-render or a popup blocker
			* stopped the automatic tab.
			*/
			const [signIn, setSignIn] = (0, react.useState)();
			/** Why the most recent sign-in attempt failed, when it did. */
			const [signInError, setSignInError] = (0, react.useState)();
			/** Outcome of the most recent credential import, for the card to report. */
			const [importNotice, setImportNotice] = (0, react.useState)();
			/** The hidden file input the import button drives. */
			const importInput = (0, react.useRef)(null);
			const [tab, setTab] = (0, react.useState)("status");
			const [checkingIn, setCheckingIn] = (0, react.useState)(false);
			const [clearingLogs, setClearingLogs] = (0, react.useState)(false);
			const [checkInNotice, setCheckInNotice] = (0, react.useState)();
			const mounted = (0, react.useRef)(true);
			/**
			* Identity of the newest read that may write. Assigned when a read *starts*,
			* so a response is superseded by anything begun after it — "the response whose
			* request started last wins". Without this, a slow poll begun before a manual
			* action could settle after the action's own refresh and restore the older
			* document.
			*/
			const readSeq = (0, react.useRef)(0);
			/** Manual requests in flight, so unmount can abort them like the poll's. */
			const manualControllers = (0, react.useRef)(/* @__PURE__ */ new Set());
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
					for (const controller of manualControllers.current) controller.abort();
					manualControllers.current.clear();
				};
			}, []);
			/** Register a manual request's controller so unmount aborts it. */
			const trackController = (0, react.useCallback)(() => {
				const controller = new AbortController();
				manualControllers.current.add(controller);
				return controller;
			}, []);
			/**
			* The in-process key authorizing this card's writes, or undefined until a
			* document carrying one has been read.
			*
			* Derived once rather than read off each use site: the `error` arm carries no
			* key, and reaching for `status.loginKey` in three places is three chances to
			* dereference a state that has none.
			*/
			const actionKey = status === void 0 || status.status === "error" ? void 0 : status.loginKey;
			/**
			* Read the status document and apply it under the two policies the card's
			* correctness rests on:
			*
			* - a non-document body (empty, `null`, a non-JSON page) is a failed read, not
			*   something to store and then dereference in the render;
			* - a failed read never discards a document already on screen. It is recorded
			*   and shown as a notice beside that document; only when nothing has been
			*   read yet does the failure itself become the rendered state.
			*
			* Returns whether this read produced the current document.
			*/
			const refresh = (0, react.useCallback)(async (signal) => {
				const seq = ++readSeq.current;
				const current = () => mounted.current && signal?.aborted !== true && seq === readSeq.current;
				try {
					const response = await fetch(currentVariant.statusPath, {
						headers: { accept: "application/json" },
						credentials: "same-origin",
						...signal === void 0 ? {} : { signal }
					});
					const value = await response.json().catch(() => void 0);
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					if (!isWorkBuddyWebStatus(value)) throw new Error(t("statusResponseInvalid"));
					if (!current()) return false;
					setStatus(value);
					if (value.status === "signed-in") {
						setSignedInState(true);
						noteQuotaStatus(currentVariant.id, value);
					} else if (value.status === "signed-out") {
						setSignedInState(false);
						noteQuotaStatus(currentVariant.id, value);
					}
					setReadFailure(void 0);
					return true;
				} catch (error) {
					const message = error instanceof Error ? error.message : t("requestFailed");
					if (current()) {
						setReadFailure(message);
						setStatus((previous) => previous === void 0 ? {
							status: "error",
							message
						} : previous);
					}
					return false;
				}
			}, [
				currentVariant.statusPath,
				currentVariant.id,
				t
			]);
			(0, react.useEffect)(() => {
				if (!open) return;
				setStatus(void 0);
				setSignedInState(void 0);
				setReadFailure(void 0);
				setSignIn(void 0);
				setSignInError(void 0);
				setImportNotice(void 0);
				setCheckingIn(false);
				setClearingLogs(false);
				setCheckInNotice(void 0);
				const controller = new AbortController();
				refresh(controller.signal);
				return () => {
					controller.abort();
				};
			}, [
				open,
				currentVariant.statusPath,
				refresh
			]);
			(0, react.useEffect)(() => {
				if (!open || signedInState === false) return;
				const controller = new AbortController();
				const timer = window.setInterval(() => {
					refresh(controller.signal);
				}, POLL_INTERVAL_MS);
				return () => {
					window.clearInterval(timer);
					controller.abort();
				};
			}, [
				open,
				refresh,
				signedInState
			]);
			const manualRefresh = async () => {
				setBusy(true);
				const controller = trackController();
				try {
					await refresh(controller.signal);
				} finally {
					manualControllers.current.delete(controller);
					if (mounted.current) setBusy(false);
				}
			};
			/**
			* Ask the host to re-read the credential and re-fetch this variant's catalog.
			*
			* Shares the probe route's key and guards: it is a write that spends an
			* upstream request, so it does not belong on the read-only status GET. A
			* failure is surfaced through the refreshed document's `catalog.error` rather
			* than thrown away, so the reason survives the round trip.
			*/
			const refreshModels = (0, react.useCallback)(async () => {
				const key = status?.status === "signed-in" ? status.probeKey : void 0;
				if (key === void 0) return;
				setBusy(true);
				const controller = trackController();
				try {
					const response = await fetch(currentVariant.probePath, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"X-WorkBuddy-Probe-Key": key
						},
						credentials: "same-origin",
						signal: controller.signal,
						body: JSON.stringify({ action: "refresh" })
					});
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
				} catch (error) {
					if (mounted.current && controller.signal.aborted !== true) setReadFailure(error instanceof Error ? error.message : t("requestFailed"));
					manualControllers.current.delete(controller);
					return;
				} finally {
					if (mounted.current) setBusy(false);
				}
				try {
					await refresh(controller.signal);
				} finally {
					manualControllers.current.delete(controller);
				}
			}, [
				currentVariant.probePath,
				refresh,
				status,
				t,
				trackController
			]);
			const manualCheckIn = (0, react.useCallback)(async () => {
				const key = status?.status === "signed-in" ? status.probeKey : void 0;
				if (key === void 0) return;
				setCheckingIn(true);
				setCheckInNotice(void 0);
				const controller = trackController();
				try {
					const response = await fetch(currentVariant.probePath, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"X-WorkBuddy-Probe-Key": key
						},
						credentials: "same-origin",
						signal: controller.signal,
						body: JSON.stringify({ action: "checkin" })
					});
					const value = await response.json().catch(() => void 0);
					if (!response.ok) {
						const message = typeof value === "object" && value !== null && "error" in value ? String(value["error"]) : `HTTP ${response.status}`;
						throw new Error(message);
					}
					const result = typeof value === "object" && value !== null ? value : {};
					if (result.state === "claimed") setCheckInNotice(t("autoCheckInStatusClaimed", { amount: result.amount ?? 100 }));
					else if (result.state === "already-claimed") setCheckInNotice(t("autoCheckInStatusAlready"));
					else if (result.state === "no-campaign") setCheckInNotice(t("autoCheckInStatusNoCampaign"));
					else if (result.reason) setCheckInNotice(t("autoCheckInStatusError", { message: result.reason }));
				} catch (error) {
					if (mounted.current && controller.signal.aborted !== true) {
						const message = error instanceof Error ? error.message : t("requestFailed");
						setCheckInNotice(t("autoCheckInStatusError", { message }));
					}
				} finally {
					manualControllers.current.delete(controller);
					if (mounted.current) setCheckingIn(false);
				}
				try {
					await refresh(controller.signal);
				} finally {
					manualControllers.current.delete(controller);
				}
			}, [
				currentVariant.probePath,
				refresh,
				status,
				t,
				trackController
			]);
			const clearCheckInLogs = (0, react.useCallback)(async () => {
				const key = status?.status === "signed-in" ? status.probeKey : void 0;
				if (key === void 0) return;
				setClearingLogs(true);
				setCheckInNotice(void 0);
				const controller = trackController();
				try {
					const response = await fetch(currentVariant.probePath, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"X-WorkBuddy-Probe-Key": key
						},
						credentials: "same-origin",
						signal: controller.signal,
						body: JSON.stringify({ action: "clear-checkin-logs" })
					});
					const value = await response.json().catch(() => void 0);
					if (!response.ok) {
						const message = typeof value === "object" && value !== null && "error" in value ? String(value["error"]) : `HTTP ${response.status}`;
						throw new Error(message);
					}
				} catch (error) {
					if (mounted.current && controller.signal.aborted !== true) {
						const message = error instanceof Error ? error.message : t("requestFailed");
						setCheckInNotice(t("autoCheckInStatusError", { message }));
					}
				} finally {
					manualControllers.current.delete(controller);
					if (mounted.current) setClearingLogs(false);
				}
				try {
					await refresh(controller.signal);
				} finally {
					manualControllers.current.delete(controller);
				}
			}, [
				currentVariant.probePath,
				refresh,
				status,
				t,
				trackController
			]);
			/**
			* Run one control action and refresh the card's state afterwards.
			*
			* The key travels in a header, not the body: it authorizes the write, and
			* the host never accepts a prompt, a sentinel, or a model outside its own
			* catalog from here.
			*/
			const control = (0, react.useCallback)(async (action) => {
				const key = status?.status === "signed-in" ? status.probeKey : void 0;
				if (key === void 0) return;
				setBusy(true);
				const controller = trackController();
				try {
					const response = await fetch(currentVariant.probePath, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"X-WorkBuddy-Probe-Key": key
						},
						credentials: "same-origin",
						signal: controller.signal,
						body: JSON.stringify(action)
					});
					const value = await response.json().catch(() => void 0);
					if (!response.ok) {
						const message = typeof value === "object" && value !== null && "error" in value ? String(value["error"]) : `HTTP ${response.status}`;
						throw new Error(message);
					}
					if (action.action === "set-maximum-context-window" && (typeof value !== "object" || value === null || value["state"] !== "updated")) {
						const reason = typeof value === "object" && value !== null && "reason" in value ? String(value["reason"]) : t("requestFailed");
						throw new Error(reason);
					}
					await refresh(controller.signal);
				} catch (error) {
					if (mounted.current && controller.signal.aborted !== true) setReadFailure(error instanceof Error ? error.message : t("requestFailed"));
				} finally {
					manualControllers.current.delete(controller);
					if (mounted.current) setBusy(false);
				}
			}, [
				currentVariant.probePath,
				refresh,
				status,
				t,
				trackController
			]);
			/**
			* Start a detection. Confirmation happens inline in the section, so this is
			* only ever called after the user has already agreed.
			*/
			const confirmDetect = (0, react.useCallback)((modelId) => {
				control({
					action: "probe",
					model: modelId
				});
			}, [control]);
			/**
			* Start a fresh attempt against this variant's realm, and send the browser to it.
			*
			* Shared by the signed-out card's sign-in button and by the signed-in card's
			* account switch, which differ only in whether a credential was discarded
			* first. The card never names the realm: the route it posts to belongs to this
			* variant, so the host decides which upstream is signed in to. The returned
			* URL is opened here rather than by the host because only the page can open a
			* tab the user's popup blocker will accept as a response to their click.
			*/
			const startAttempt = (0, react.useCallback)(async (key) => {
				setSignInError(void 0);
				setBusy(true);
				const controller = trackController();
				try {
					const response = await fetch(currentVariant.loginPath, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"X-WorkBuddy-Login-Key": key
						},
						credentials: "same-origin",
						signal: controller.signal,
						body: JSON.stringify({ action: "begin" })
					});
					const value = await response.json().catch(() => void 0);
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					const record = typeof value === "object" && value !== null ? value : {};
					const state = typeof record["state"] === "string" ? record["state"] : "";
					const url = typeof record["url"] === "string" ? record["url"] : "";
					if (state === "" || url === "") throw new Error(t("requestFailed"));
					setSignIn({
						state,
						url
					});
					window.open(url, "_blank", "noopener,noreferrer");
				} catch (error) {
					if (mounted.current && controller.signal.aborted !== true) setSignInError(error instanceof Error ? error.message : t("requestFailed"));
				} finally {
					manualControllers.current.delete(controller);
					if (mounted.current) setBusy(false);
				}
			}, [
				currentVariant.loginPath,
				t,
				trackController
			]);
			/** The signed-out card's sign-in button. */
			const beginSignIn = (0, react.useCallback)(async () => {
				const key = actionKey;
				if (key === void 0) return;
				await startAttempt(key);
			}, [actionKey, startAttempt]);
			/** Remove the stored credential and forget the account. */
			const signOut = (0, react.useCallback)(async () => {
				if (status?.status !== "signed-in" || status.loginKey === void 0) return;
				const key = status.loginKey;
				setBusy(true);
				const controller = trackController();
				try {
					const response = await fetch(currentVariant.loginPath, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"X-WorkBuddy-Login-Key": key
						},
						credentials: "same-origin",
						signal: controller.signal,
						body: JSON.stringify({ action: "logout" })
					});
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					setSignIn(void 0);
					const signedOutDoc = {
						status: "signed-out",
						loginKey: key
					};
					setStatus(signedOutDoc);
					setSignedInState(false);
					noteQuotaStatus(currentVariant.id, signedOutDoc);
					noteQuotaSignIn(currentVariant.id, false);
					await refresh(controller.signal);
				} catch (error) {
					if (mounted.current && controller.signal.aborted !== true) setReadFailure(error instanceof Error ? error.message : t("requestFailed"));
				} finally {
					manualControllers.current.delete(controller);
					if (mounted.current) setBusy(false);
				}
			}, [
				currentVariant.id,
				currentVariant.loginPath,
				refresh,
				status,
				t,
				trackController
			]);
			/**
			* Replace the signed-in account: discard the stored credential, then start a
			* fresh attempt.
			*
			* One action rather than two, because the halves are only useful together: a
			* user switching accounts has no reason to stay signed out in between, and
			* making them press sign-out and then sign-in would leave a window where the
			* card shows no account and the second button is easy to miss.
			*
			* The credential is the only thing discarded — the previous account's saved
			* catalog and probe records are keyed by account, so they are left alone and
			* simply stop applying.
			*/
			const switchAccount = (0, react.useCallback)(async () => {
				const key = actionKey;
				if (key === void 0) return;
				setBusy(true);
				setImportNotice(void 0);
				setSignInError(void 0);
				const controller = trackController();
				try {
					const response = await fetch(currentVariant.loginPath, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"X-WorkBuddy-Login-Key": key
						},
						credentials: "same-origin",
						signal: controller.signal,
						body: JSON.stringify({ action: "logout" })
					});
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					setSignIn(void 0);
					const signedOutDoc = {
						status: "signed-out",
						loginKey: key
					};
					setStatus(signedOutDoc);
					setSignedInState(false);
					noteQuotaStatus(currentVariant.id, signedOutDoc);
					noteQuotaSignIn(currentVariant.id, false);
					await refresh(controller.signal);
				} catch (error) {
					if (mounted.current && controller.signal.aborted !== true) setReadFailure(error instanceof Error ? error.message : t("requestFailed"));
					return;
				} finally {
					manualControllers.current.delete(controller);
					if (mounted.current) setBusy(false);
				}
				await startAttempt(key);
			}, [
				actionKey,
				currentVariant.id,
				currentVariant.loginPath,
				refresh,
				startAttempt,
				t,
				trackController
			]);
			/**
			* Poll the active attempt until it settles.
			*
			* Polling lives here rather than in the route because the browser already
			* holds the cadence machinery (and this way an abandoned tab stops polling on
			* its own). A `failed` answer ends the attempt and is reported; `pending`
			* keeps waiting.
			*/
			(0, react.useEffect)(() => {
				if (signIn === void 0) return;
				let cancelled = false;
				const timer = setInterval(() => {
					(async () => {
						const key = actionKey;
						if (key === void 0) return;
						try {
							const value = await (await fetch(currentVariant.loginPath, {
								method: "POST",
								headers: {
									"Content-Type": "application/json",
									"X-WorkBuddy-Login-Key": key
								},
								credentials: "same-origin",
								body: JSON.stringify({
									action: "poll",
									state: signIn.state
								})
							})).json().catch(() => void 0);
							if (cancelled || !mounted.current) return;
							const record = typeof value === "object" && value !== null ? value : {};
							const outcome = record["status"];
							if (outcome === "complete") {
								setSignIn(void 0);
								setSignInError(void 0);
								noteQuotaSignIn(currentVariant.id, true);
								await refresh();
								return;
							}
							if (outcome === "failed") {
								setSignIn(void 0);
								setSignInError(typeof record["message"] === "string" ? record["message"] : t("requestFailed"));
							}
						} catch {}
					})();
				}, 2e3);
				return () => {
					cancelled = true;
					clearInterval(timer);
				};
			}, [
				actionKey,
				currentVariant.id,
				currentVariant.loginPath,
				signIn,
				refresh,
				t
			]);
			/**
			* Adopt a credential file the user picked.
			*
			* The browser reads the file and posts its text; the host parses and validates
			* it. The card never inspects the document itself — the realm check and the
			* write belong to the side that owns the credential store, and a card that
			* decided either would be a second, weaker authority.
			*/
			const importCredential = (0, react.useCallback)(async (file) => {
				if (status?.status !== "signed-out" || status.loginKey === void 0) return;
				const key = status.loginKey;
				setImportNotice(void 0);
				setBusy(true);
				const controller = trackController();
				try {
					const document = await file.text();
					const response = await fetch(currentVariant.loginPath, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"X-WorkBuddy-Login-Key": key
						},
						credentials: "same-origin",
						signal: controller.signal,
						body: JSON.stringify({
							action: "import",
							document
						})
					});
					const value = await response.json().catch(() => void 0);
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					const record = typeof value === "object" && value !== null ? value : {};
					if (record["status"] === "imported") {
						const account = typeof record["nickname"] === "string" && record["nickname"] !== "" ? record["nickname"] : typeof record["uid"] === "string" && record["uid"] !== "" ? record["uid"] : "";
						setImportNotice({
							kind: "done",
							text: t("importDone", { account: account === "" ? "—" : account })
						});
						noteQuotaSignIn(currentVariant.id, true);
						await refresh(controller.signal);
						return;
					}
					setImportNotice({
						kind: "failed",
						text: t("importFailed", { message: typeof record["message"] === "string" ? record["message"] : t("requestFailed") })
					});
				} catch (error) {
					if (mounted.current && controller.signal.aborted !== true) setImportNotice({
						kind: "failed",
						text: t("importFailed", { message: error instanceof Error ? error.message : t("requestFailed") })
					});
				} finally {
					manualControllers.current.delete(controller);
					if (mounted.current) setBusy(false);
				}
			}, [
				currentVariant.id,
				currentVariant.loginPath,
				refresh,
				status,
				t,
				trackController
			]);
			const cardTitle = isUnified ? t("unifiedTitle") : t(currentVariant.titleKey);
			const cardIntro = isUnified ? t("unifiedIntro") : t(currentVariant.introKey);
			const label = status === void 0 ? t("loading") : status.status === "signed-in" ? status.nickname === void 0 ? t("signedInAs", { nickname: "" }).trimEnd().replace(/[:：]$/, "") : t("signedInAs", { nickname: status.nickname }) : status.status === "error" ? t("requestFailed") : t("signedOut");
			/**
			* The dot inside each segment of the variant switcher.
			*
			* The variant on screen reports what its own read found — including
			* 'loading' before the first document lands, which is a different fact from
			* "signed out". The other variant can only be judged by what the shared
			* store has heard from some other surface.
			*
			* An explicit `signedIn` reader is authoritative when present; the store is
			* the fallback. They are NOT OR'd: an optimistic store `true` surviving a
			* sign-out would light a dot for an account nobody is in.
			*/
			const reported = signedIn?.();
			const cnSignedIn = reported !== void 0 ? reported.cn : liveSignIn.cn;
			const aiSignedIn = reported !== void 0 ? reported.ai : liveSignIn.ai;
			const cnDotStatus = isUnified && activeVariantId === "workbuddy" ? status === void 0 ? "loading" : status.status : cnSignedIn ? "signed-in" : "signed-out";
			const aiDotStatus = isUnified && activeVariantId === "workbuddy-ai" ? status === void 0 ? "loading" : status.status : aiSignedIn ? "signed-in" : "signed-out";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				style: {
					...cardStyle,
					...hovered ? cardHoverStyle : {},
					...open ? cardOpenStyle : {}
				},
				onMouseEnter: () => {
					setHovered(true);
				},
				onMouseLeave: () => {
					setHovered(false);
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					style: {
						...headerStyle,
						...headerFocused ? headerFocusStyle : {}
					},
					"aria-expanded": open,
					"aria-label": `${t(open ? "collapse" : "expand")}: ${cardTitle}`,
					onClick: () => {
						setOpen(!open);
					},
					onFocus: (event) => {
						let keyboard = true;
						try {
							keyboard = event.currentTarget.matches(":focus-visible");
						} catch {
							keyboard = true;
						}
						if (keyboard) setHeaderFocused(true);
					},
					onBlur: () => {
						setHeaderFocused(false);
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: headTextStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: nameStyle,
							children: cardTitle
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: descriptionStyle,
							children: cardIntro
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							...chevronStyle,
							transform: open ? "rotate(180deg)" : "none"
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChevronDownIcon, {})
					})]
				}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: cardBodyStyle,
					children: [
						isUnified ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(QuotaSettingsContent, {
							t,
							scope,
							signedIn
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: segmentedContainerStyle,
							role: "tablist",
							"aria-label": "WorkBuddy Version Selection",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								role: "tab",
								"aria-selected": activeVariantId === "workbuddy",
								style: segmentedTabItemStyle(activeVariantId === "workbuddy"),
								onClick: () => setActiveVariantId("workbuddy"),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: dotStyle(cnDotStatus),
									"aria-hidden": "true"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("variantTabCN") })]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								role: "tab",
								"aria-selected": activeVariantId === "workbuddy-ai",
								style: segmentedTabItemStyle(activeVariantId === "workbuddy-ai"),
								onClick: () => setActiveVariantId("workbuddy-ai"),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: dotStyle(aiDotStatus),
									"aria-hidden": "true"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("variantTabAI") })]
							})]
						})] }) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							style: quotaTitleStyle,
							children: t("accountHeading")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: rowStyle,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: statusStyle,
									role: "status",
									"aria-busy": status === void 0,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										"aria-hidden": "true",
										style: dotStyle(status === void 0 ? "loading" : status.status)
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: label })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: buttonStyle$1,
									disabled: busy,
									onClick: () => {
										manualRefresh();
									},
									children: busy ? t("refreshing") : t("refresh")
								}),
								status?.status !== "signed-in" || status.loginKey === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: buttonStyle$1,
									disabled: busy,
									onClick: () => {
										switchAccount();
									},
									children: busy ? t("switchingAccount") : t("switchAccount")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: buttonStyle$1,
									disabled: busy,
									onClick: () => {
										signOut();
									},
									children: busy ? t("signingOut") : t("signOut")
								})] })
							]
						}),
						readFailure === void 0 || signedInState === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: errorStyle,
							children: t("statusRefreshFailed", { message: readFailure })
						}),
						status?.status === "signed-in" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							status.expiresAt === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: bodyStyle,
								children: t("accessTokenExpires", { time: formatTime(status.expiresAt) })
							}),
							status.catalog === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: rowStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: bodyStyle,
									children: [status.catalog.source === "live" && status.catalog.fetchedAt !== void 0 ? t("catalogLive", { time: formatTime(status.catalog.fetchedAt) }) : status.catalog.source === "saved" && status.catalog.fetchedAt !== void 0 ? t("catalogSaved", { time: formatTime(status.catalog.fetchedAt) }) : t("catalogFallback"), status.catalog.appVersion === void 0 ? "" : ` · ${t("catalogAppVersion", { version: status.catalog.appVersion })}`]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: buttonStyle$1,
									disabled: busy,
									onClick: () => {
										refreshModels();
									},
									children: busy ? t("refreshingModels") : t("refreshModels")
								})]
							}),
							status.catalog?.error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: errorStyle,
								children: t("catalogError", { message: status.catalog.error })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								role: "tablist",
								style: tabBarStyle,
								children: [
									"status",
									"context",
									"details",
									"checkin"
								].map((id) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									role: "tab",
									"aria-selected": tab === id,
									onClick: () => {
										setTab(id);
									},
									style: {
										...tabStyle,
										...tab === id ? tabActiveStyle : {}
									},
									children: t(id === "status" ? "tabStatus" : id === "context" ? "tabContext" : id === "details" ? "tabDetails" : "tabCheckIn")
								}, id))
							}),
							tab === "status" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: tabPanelStyle,
								children: [
									status.credits === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: quotaListStyle,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: rowStyle,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
												style: quotaTitleStyle,
												children: t("creditsHeading")
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: bodyStyle,
												children: status.credits.unlimited === true ? t("creditsTotalUnlimited") : t("creditsTotal", { total: formatNumber(status.credits.total) })
											})]
										}), status.credits.cycleResetTime === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											style: descriptionStyle,
											children: t("cycleResetAt", { time: formatCycleReset(status.credits.cycleResetTime) })
										})]
									}),
									status.creditsError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										style: errorStyle,
										children: t("creditsError", { message: status.creditsError })
									}),
									status.probe === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProbeSection, {
										probe: status.probe,
										t,
										busy,
										onDetect: confirmDetect,
										onClear: () => {
											control({ action: "clear" });
										}
									})
								]
							}) : tab === "context" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: tabPanelStyle,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ContextTable, {
									models: status.models,
									t,
									disabled: busy,
									...status.useMaximumContextWindow === void 0 ? {} : { useMaximumContextWindow: status.useMaximumContextWindow },
									...currentVariant.id === AI_CARD_VARIANT.id ? { onUseMaximumContextWindow: (enabled) => {
										control({
											action: "set-maximum-context-window",
											enabled
										});
									} } : {}
								})
							}) : tab === "details" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: tabPanelStyle,
								children: [status.credits === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: quotaListStyle,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
										style: quotaTitleStyle,
										children: t("creditsDetailHeading")
									}), status.credits.accounts.filter((account) => account.packageName === "enterprise" || account.remain > 0 || account.unlimited === true).map((account, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CreditBar, {
										label: account.packageName === "enterprise" ? t("packageEnterprise") : account.packageName,
										remain: account.remain,
										size: account.size,
										unlimited: account.unlimited,
										packageEndTime: account.packageEndTime,
										t
									}, `${account.packageName}-${String(index)}`))]
								}), status.models === void 0 || status.models.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: quotaListStyle,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
										style: quotaTitleStyle,
										children: t("modelsHeading")
									}), status.models.filter((model) => model.free === true || (model.badges?.length ?? 0) > 0).map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelOfferRow, {
										model,
										t
									}, model.id))]
								})]
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: tabPanelStyle,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CheckInLogTable, {
									logs: status.checkIn?.logs,
									t,
									busy,
									checkingIn,
									clearing: clearingLogs,
									disabled: status.status !== "signed-in",
									...checkInNotice === void 0 ? {} : { notice: checkInNotice },
									onCheckIn: () => {
										manualCheckIn();
									},
									onRefresh: () => {
										manualRefresh();
									},
									onClear: () => {
										clearCheckInLogs();
									}
								})
							})
						] }) : null,
						status?.status === "signed-out" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: status.reason === void 0 ? bodyStyle : errorStyle,
								children: status.reason ?? t(currentVariant.signedOutKey)
							}),
							status.loginKey === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: rowStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: buttonStyle$1,
									disabled: busy || signIn !== void 0,
									onClick: () => {
										beginSignIn();
									},
									children: signIn === void 0 ? t("signIn") : t("signingIn")
								}), signIn === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
									href: signIn.url,
									target: "_blank",
									rel: "noopener noreferrer",
									style: bodyStyle,
									children: t("signInOpenAgain")
								})]
							}),
							signIn === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: bodyStyle,
								children: t("signInWaiting")
							}),
							signInError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: errorStyle,
								children: t("signInFailed", { message: signInError })
							}),
							status.loginKey === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: rowStyle,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: bodyStyle,
										children: t("importHeading")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: buttonStyle$1,
										disabled: busy || signIn !== void 0,
										onClick: () => {
											importInput.current?.click();
										},
										children: busy ? t("importing") : t("importAction")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										ref: importInput,
										type: "file",
										accept: ".json,application/json",
										style: { display: "none" },
										onChange: (event) => {
											const file = event.target.files?.[0];
											event.target.value = "";
											if (file !== void 0) importCredential(file);
										}
									})
								]
							}),
							status.loginKey === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: bodyStyle,
								children: t("importHint")
							}),
							importNotice === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: importNotice.kind === "failed" ? errorStyle : bodyStyle,
								children: importNotice.text
							})
						] }) : null,
						status?.status === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: errorStyle,
							children: status.message
						}) : null
					]
				}) : null]
			});
		}
		//#endregion
		//#region src/client/WorkBuddyProbeControl.tsx
		/**
		* Per-model reasoning-effort entry beside the Composer's model selector.
		*
		* Interaction follows the Fast Mode control `dsh-codex-connect` ships in this
		* same seat, which is the established shape for composer chrome here:
		*
		* - a **static inline label** next to the icon names the feature ("Reasoning
		*   levels"), set smaller and dimmer than the surrounding chrome so it reads as
		*   an annotation on the icon. It never carries state: the verified levels
		*   already appear in the model dropdown (the adapter exposes them as
		*   selectable efforts), so repeating them here would duplicate the real answer
		*   and make the label's width jump as results change.
		* - a **hover/focus tooltip** carries the state and the click's purpose, the way
		*   Fast Mode's tooltip explains its current speed.
		* - the **confirmation** is a small bubble anchored to the control, not a
		*   `window.confirm`. Probing spends real credit, so a confirmation stays — but
		*   it belongs next to the thing it acts on, sized to one line plus two small
		*   buttons.
		*
		* @module dsh-workbuddy-connect/client/probe-control
		*/
		/**
		* The card (and therefore the routes) a selected provider belongs to.
		*
		* The control serves both WorkBuddy providers from one seat, so the provider id
		* is what selects the status and probe endpoints. Returning `undefined` for any
		* other provider is what keeps the icon off every non-WorkBuddy model.
		*/
		function cardVariantFor(provider) {
			return CARD_VARIANTS.find((card) => card.id === provider);
		}
		/** How often the control re-checks state when the window regains focus. */
		const RECONCILE_MS = 6e4;
		const wrapperStyle = {
			display: "inline-flex",
			position: "relative",
			alignItems: "center",
			transform: "translateY(2px)",
			marginRight: -8
		};
		const buttonStyle = {
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			gap: 2,
			height: 30,
			padding: "0 6px",
			border: 0,
			borderRadius: 8,
			background: "transparent",
			color: "var(--dsw-alias-label-secondary)",
			font: "inherit",
			whiteSpace: "nowrap",
			cursor: "pointer"
		};
		/**
		* The inline label. Smaller and dimmer than the surrounding chrome on purpose:
		* it names the feature, so it should read as an annotation attached to the icon
		* rather than compete with the adjacent model selector.
		*/
		const labelStyle = {
			fontSize: 11,
			lineHeight: "16px",
			color: "var(--dsw-alias-label-tertiary)"
		};
		/** Tooltip bubble: the Fast Mode shape (nowrap, one line, above the control). */
		const tooltipStyle = {
			position: "absolute",
			left: "50%",
			bottom: "calc(100% + 8px)",
			zIndex: 1e3,
			transform: "translateX(-50%)",
			padding: "4px 8px",
			borderRadius: 6,
			background: "var(--dsw-specific-tip, #1f2329)",
			boxShadow: "var(--dsw-shadow-lv2)",
			color: "var(--dsw-alias-label-primary, #fff)",
			fontSize: 12,
			lineHeight: "18px",
			whiteSpace: "nowrap",
			pointerEvents: "none"
		};
		/** Confirmation bubble: same anchor, but interactive and allowed to wrap. */
		const confirmStyle = {
			position: "absolute",
			right: 0,
			bottom: "calc(100% + 8px)",
			zIndex: 1001,
			display: "flex",
			flexDirection: "column",
			gap: 8,
			width: 260,
			padding: "10px 12px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 8,
			background: "var(--dsw-alias-bg-layer-1, #fff)",
			boxShadow: "var(--dsw-shadow-lv2)",
			color: "var(--dsw-alias-label-primary)",
			fontSize: 12,
			lineHeight: "18px"
		};
		const confirmRowStyle = {
			display: "flex",
			justifyContent: "flex-end",
			gap: 8
		};
		const confirmButtonStyle = {
			padding: "3px 10px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 6,
			background: "transparent",
			color: "inherit",
			font: "inherit",
			fontSize: 12,
			cursor: "pointer"
		};
		/**
		* Primary action inside the confirmation bubble.
		*
		* The fill and its text colour must come as a pair: `brand-primary` resolves to
		* a light accent in this theme, so hardcoding `color: #fff` on top of it renders
		* white-on-white. `button-primary-fill` + `label-primary-foreground` is the
		* theme's own pair for exactly this, and is what `dsh-codex-connect` uses for
		* the same job.
		*/
		const primaryButtonStyle = {
			...confirmButtonStyle,
			border: "1px solid var(--dsw-alias-button-primary-fill)",
			background: "var(--dsw-alias-button-primary-fill)",
			color: "var(--dsw-alias-label-primary-foreground)"
		};
		/**
		* Result note: a single line + a dismiss button, anchored to the control's
		* right side. Smaller than the confirmation bubble because it carries an
		* *outcome*, not a *decision* — the work is done, the user only has to read
		* and dismiss.
		*/
		const noteStyle = {
			position: "absolute",
			right: 0,
			bottom: "calc(100% + 8px)",
			zIndex: 1001,
			display: "flex",
			alignItems: "center",
			gap: 12,
			padding: "6px 10px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 8,
			background: "var(--dsw-alias-bg-layer-1)",
			boxShadow: "var(--dsw-shadow-lv2)",
			color: "var(--dsw-alias-label-primary)",
			fontSize: 12,
			lineHeight: "18px",
			whiteSpace: "nowrap"
		};
		/**
		* The note's dismiss action. Outlined rather than bare text: inside an already
		* bordered bubble, an unbordered word does not read as something you can click.
		* Matches the outlined pill convention the plugin's other secondary actions use.
		*/
		const noteDismissStyle = {
			padding: "2px 8px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 6,
			background: "transparent",
			color: "var(--dsw-alias-label-secondary)",
			font: "inherit",
			fontSize: 12,
			lineHeight: "18px",
			cursor: "pointer"
		};
		/**
		* The feature's static inline label. Deliberately not a state readout — see the
		* module comment.
		*/
		function useLabel(t) {
			return t("probeLabel");
		}
		/** Pick the model's recorded observation out of the probe section. */
		function resultFor(status, model) {
			if (status.status !== "signed-in") return void 0;
			return status.probe?.results.find((result) => result.id === model);
		}
		/**
		* The one-line tooltip: current state first, then what a click does — the same
		* two-part shape Fast Mode uses.
		*
		* A recorded result outranks a remembered failure. `failed` only means "the last
		* run from this control did not complete"; the host can record a result for the
		* same model at any time (a detection started from the settings card, another
		* conversation, or a finished sweep), and the levels the user paid for are the
		* more useful answer than the stale failure. Failure copy is what remains when
		* there is no result to report.
		*/
		function tooltipText(t, model, state) {
			if (state.busy) return t("probeRunning", { model });
			const result = state.result;
			if (result !== void 0) {
				if (result.validation === "validating" && result.efforts.length > 0) return t("probeTooltipVerified", { levels: result.efforts.join(" / ") });
				if (result.validation === "non-validating") return t("probeTooltipNotValidating");
				return t("probeTooltipRetry");
			}
			if (state.failed) return t("probeTooltipRetry");
			return t("probeTooltipIdle", { model });
		}
		/** Model-independent shell: resolves the selection, then delegates per model. */
		function WorkBuddyProbeControl({ directory, t }) {
			const subscribe = (0, react.useCallback)((listener) => directory.subscribe(listener), [directory]);
			const snapshot = (0, react.useCallback)(() => directory.getSnapshot(), [directory]);
			const selection = (0, react.useSyncExternalStore)(subscribe, snapshot, snapshot).current;
			const card = selection == null ? void 0 : cardVariantFor(selection.provider);
			const key = card === void 0 || selection == null ? void 0 : `${card.id}:${selection.model}`;
			return card === void 0 || selection == null || key === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelProbe, {
				model: selection.model,
				card,
				label: useLabel(t),
				t
			}, key);
		}
		function ModelProbe({ model, card, label, t }) {
			const [status, setStatus] = (0, react.useState)();
			const [busy, setBusy] = (0, react.useState)(false);
			const [confirming, setConfirming] = (0, react.useState)(false);
			const [tooltipVisible, setTooltipVisible] = (0, react.useState)(false);
			const [failed, setFailed] = (0, react.useState)(false);
			const [note, setNote] = (0, react.useState)();
			const inFlight = (0, react.useRef)(false);
			const mounted = (0, react.useRef)(false);
			const readSeq = (0, react.useRef)(0);
			const tooltipId = (0, react.useId)();
			const refresh = (0, react.useCallback)(async (signal) => {
				const seq = ++readSeq.current;
				const response = await fetch(card.statusPath, {
					credentials: "same-origin",
					headers: { accept: "application/json" },
					...signal === void 0 ? {} : { signal }
				});
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				const value = await response.json().catch(() => void 0);
				if (!isWorkBuddyWebStatus(value)) throw new Error(t("statusResponseInvalid"));
				if (mounted.current && !signal?.aborted && seq === readSeq.current) setStatus(value);
			}, [card.statusPath, t]);
			(0, react.useEffect)(() => {
				mounted.current = true;
				const controller = new AbortController();
				const load = () => {
					refresh(controller.signal).catch(() => {});
				};
				load();
				const timer = window.setInterval(load, RECONCILE_MS);
				window.addEventListener("focus", load);
				return () => {
					mounted.current = false;
					controller.abort();
					window.clearInterval(timer);
					window.removeEventListener("focus", load);
				};
			}, [refresh]);
			const probe = status?.status === "signed-in" ? status.probe : void 0;
			const key = status?.status === "signed-in" ? status.probeKey : void 0;
			const result = status === void 0 ? void 0 : resultFor(status, model);
			const visible = probe?.candidates.includes(model) === true || result !== void 0;
			(0, react.useEffect)(() => {
				if (result !== void 0) setFailed(false);
			}, [result]);
			(0, react.useEffect)(() => {
				setConfirming(false);
				setNote(void 0);
			}, [model]);
			const detect = async () => {
				if (key === void 0 || inFlight.current || probe?.running === true) return;
				inFlight.current = true;
				setNote(void 0);
				setConfirming(false);
				setBusy(true);
				setFailed(false);
				try {
					const response = await fetch(card.probePath, {
						method: "POST",
						credentials: "same-origin",
						headers: {
							"Content-Type": "application/json",
							"X-WorkBuddy-Probe-Key": key
						},
						body: JSON.stringify({
							action: "probe",
							model
						})
					});
					const body = await response.json();
					if (!response.ok || body.state !== "ok" || body.validation !== "validating" && body.validation !== "non-validating" || !Array.isArray(body.efforts) || !body.efforts.every((effort) => typeof effort === "string")) throw new Error("probe failed");
					if (mounted.current) {
						const completed = {
							id: model,
							name: model,
							validation: body.validation,
							efforts: body.efforts,
							probedAt: Date.now()
						};
						setNote(completed);
					}
					refresh().catch(() => {});
				} catch {
					if (mounted.current) setFailed(true);
				} finally {
					inFlight.current = false;
					if (mounted.current) setBusy(false);
				}
			};
			if (!visible) return null;
			const text = tooltipText(t, model, {
				busy,
				result,
				failed
			});
			const disabled = busy || probe?.running === true || key === void 0;
			const showTooltip = tooltipVisible && !confirming && note === void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				style: wrapperStyle,
				onMouseEnter: () => {
					setTooltipVisible(true);
				},
				onMouseLeave: () => {
					setTooltipVisible(false);
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						"aria-label": text,
						"aria-describedby": showTooltip ? tooltipId : void 0,
						"aria-busy": busy,
						"aria-expanded": confirming,
						disabled,
						onClick: () => {
							setConfirming(true);
						},
						onFocus: () => {
							setTooltipVisible(true);
						},
						onBlur: () => {
							setTooltipVisible(false);
						},
						style: {
							...buttonStyle,
							opacity: disabled && !confirming ? .6 : 1,
							cursor: disabled ? "default" : "pointer"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
							width: "16",
							height: "16",
							viewBox: "0 0 24 24",
							fill: "none",
							stroke: "currentColor",
							strokeWidth: "1.6",
							"aria-hidden": "true",
							focusable: "false",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
									cx: "12",
									cy: "12",
									r: "9"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
									cx: "12",
									cy: "12",
									r: "4"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 12 20 4" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
									cx: "12",
									cy: "12",
									r: "1"
								})
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: labelStyle,
							children: label
						})]
					}),
					showTooltip && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						id: tooltipId,
						role: "tooltip",
						style: tooltipStyle,
						children: text
					}),
					confirming && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: confirmStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("probeBubbleBody") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: confirmRowStyle,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: confirmButtonStyle,
								onClick: () => {
									setConfirming(false);
								},
								children: t("cancel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: primaryButtonStyle,
								onClick: () => {
									detect();
								},
								children: t("probeConfirmAction")
							})]
						})]
					}),
					note === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						role: "status",
						"aria-live": "polite",
						style: noteStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: noteText(t, note) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: noteDismissStyle,
							onClick: () => {
								setNote(void 0);
							},
							children: t("probeNoteDismiss")
						})]
					})
				]
			});
		}
		/** Compose the one-line outcome string the note bubble shows. */
		function noteText(t, result) {
			if (result.validation === "validating" && result.efforts.length > 0) return t("probeNoteVerified", { levels: result.efforts.join(" / ") });
			if (result.validation === "non-validating") return t("probeNoteNotValidating");
			return t("probeNoteUnknown");
		}
		//#endregion
		//#region src/client/quota-merge.ts
		/**
		* Group credit accounts by (packageName, packageEndTime) and sum each group.
		*
		* A missing figure counts as 0 (the user's ruling): a package whose total the
		* upstream did not report contributes nothing to the group's `size` rather
		* than poisoning the bar into "unknown". A group whose summed `size` is still
		* 0 keeps an honest "unknown total" rendering in the card — the merge never
		* invents a denominator. `unlimited` is sticky: one unlimited member makes the
		* whole group unlimited, and its sums are not displayed as a quota.
		*
		* MERGE KEY IS THE NAME ALONE (the user's correction): same-named packages
		* whose expiries differ by seconds (stacked purchase batches) must still be
		* one overview row — keying on the expiry exploded 28 same-named packages
		* back into 28 separate bars the moment the host started reporting real
		* dates. The expiry travels on the group (earliest of the members) for the
		* sort/visibility rules; the itemised per-expiry breakdown lives in the
		* dashboard's table.
		*
		* @param accounts - the status document's per-package credit entries.
		* @returns one group per distinct package NAME, in first-seen order.
		*/
		function mergeCreditAccounts(accounts) {
			const groups = /* @__PURE__ */ new Map();
			for (const account of accounts) {
				const key = account.packageName;
				const existing = groups.get(key);
				if (existing === void 0) {
					groups.set(key, {
						packageName: account.packageName,
						packageEndTime: account.packageEndTime,
						remain: account.remain,
						size: account.size,
						unlimited: account.unlimited === true
					});
					continue;
				}
				existing.remain += account.remain;
				existing.size += account.size;
				existing.unlimited = existing.unlimited || account.unlimited === true;
				if (existing.packageEndTime !== void 0 && account.packageEndTime !== void 0) {
					const a = Date.parse(existing.packageEndTime);
					const b = Date.parse(account.packageEndTime);
					if (!Number.isNaN(a) && !Number.isNaN(b) && b < a) existing.packageEndTime = account.packageEndTime;
				} else existing.packageEndTime = existing.packageEndTime ?? account.packageEndTime;
			}
			return [...groups.values()];
		}
		/** Clamp helper shared by the card's percent math. */
		function clampPercent(remain, size) {
			if (!(size > 0)) return void 0;
			const percent = remain / size * 100;
			if (!Number.isFinite(percent)) return void 0;
			return Math.min(100, Math.max(0, percent));
		}
		/** Parse an upstream expiry string ("YYYY-MM-DD HH:mm:ss") into a timestamp; undefined when unparseable. */
		function parseExpiry(value) {
			if (value === void 0) return void 0;
			const parsed = Date.parse(value);
			return Number.isNaN(parsed) ? void 0 : parsed;
		}
		/** Whether a group is spent (remain 0) and NOT unlimited. */
		function isSpent(group) {
			return !group.unlimited && group.remain <= 0;
		}
		/** Whether a spent group's expiry date has already passed (undated → false: no proof of expiry). */
		function isExpired(group, now) {
			if (!isSpent(group)) return false;
			const expiry = parseExpiry(group.packageEndTime);
			return expiry !== void 0 && expiry < now;
		}
		/**
		* SIDEBAR overview rule (the user's spec, restored after it was wrongly
		* applied to the panel):
		*
		* - A group with credit LEFT (remain > 0, or unlimited) renders.
		* - A SPENT group (remain 0) renders ONLY when EVERY group is spent AND it
		*   is not expired — the account's standing quota whose emptiness is itself
		*   the news. When anything still has credit, spent rows are noise.
		* - An EXPIRED group (spent and its expiry date has passed) renders
		*   NOWHERE, whatever the rest of the account looks like.
		*
		* Applied AFTER the merge so the sums are settled before the test.
		* "Now" is injectable for tests.
		*
		* @param groups - merged groups, in first-seen order.
		* @param now - current timestamp (defaults to Date.now()).
		* @returns the groups to display, in first-seen order.
		*/
		function visibleQuotaGroups(groups, now = Date.now()) {
			const hasCredit = groups.some((group) => group.unlimited || group.remain > 0);
			return groups.filter((group) => {
				if (group.unlimited || group.remain > 0) return true;
				return !hasCredit && !isExpired(group, now);
			});
		}
		/**
		* PANEL detail-table ordering (the user's spec): every row renders — the
		* panel is the itemised ledger — but spent-yet-still-active rows sink to the
		* BOTTOM (lowest priority), and expired rows are dropped entirely. Rows keep
		* their first-seen order within each band.
		*
		* @param rows - per-package rows, unmerged, in first-seen order.
		* @param now - current timestamp (defaults to Date.now()).
		*/
		function sortPackageRows(rows, now = Date.now()) {
			const live = [];
			const spent = [];
			for (const row of rows) {
				const unlimited = row.unlimited === true;
				const expiry = parseExpiry(row.packageEndTime);
				if (!unlimited && row.remain <= 0 && expiry !== void 0 && expiry < now) continue;
				if (unlimited || row.remain > 0) live.push(row);
				else spent.push(row);
			}
			return [...live, ...spent];
		}
		//#endregion
		//#region src/client/SidebarQuotaCard.tsx
		/**
		* The sidebar footer quota card + the center-column dashboard it opens.
		*
		* The structure is a direct port of commandcode's plans & quota panel
		* (src/client/panel-view.tsx + panel.ts), which the user held up as the
		* reference: the card IS the button (the shell supplies no chrome), it renders
		* one block per merged package group — the group's remain/total, its
		* percentage and its bar — carries the last-updated time in the card's top
		* row, and opens a dashboard in the layout's keyed `main` slot on click. In
		* the 56px rail it collapses to a 36px icon button carrying the ring.
		*
		* Data comes from the variant's status route (poll, paused while hidden);
		* strings come from the `panel.workbuddy-quota` locale namespace; classes come
		* from `./quota-styles.ts` (`wbp-` prefix).
		*/
		/** Fallback translator: renders keys bare rather than throwing unbound. */
		const fallbackT = (key) => key;
		/** Project the credit accounts into the card's bar list. */
		function buildBars(accounts) {
			const groups = visibleQuotaGroups(mergeCreditAccounts(accounts));
			const bars = [];
			for (const group of groups) {
				const percent = group.unlimited ? void 0 : clampPercent(group.remain, group.size);
				const detail = group.unlimited ? "∞" : percent === void 0 ? `${group.remain.toLocaleString()} · ?` : `${group.remain.toLocaleString()} / ${group.size.toLocaleString()}`;
				bars.push({
					label: group.packageName,
					detail,
					percent: percent === void 0 ? void 0 : `${Math.round(percent)}%`,
					barPercent: percent === void 0 ? 0 : Math.max(2, percent),
					warn: !group.unlimited && percent !== void 0 && percent < 20,
					packageEndTime: group.packageEndTime
				});
			}
			return bars;
		}
		/**
		* The quota ring — commandcode's glyph ported verbatim (`wbp-` classes): a
		* faint track plus an arc whose sweep is the consumption, drawn from 12
		* o'clock. Circumference 2πr = 45.55 at r = 7.25.
		*/
		function Ring({ percent, warn, size }) {
			const clamped = Math.min(100, Math.max(0, percent));
			const circumference = 45.55;
			const dashoffset = Math.round(circumference * (1 - clamped / 100) * 1e3) / 1e3;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "wbp-glyph",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					viewBox: "0 0 20 20",
					width: size,
					height: size,
					focusable: "false",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "10",
						cy: "10",
						r: "7.25",
						fill: "none",
						stroke: "currentColor",
						strokeWidth: "1.5",
						opacity: "0.4"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "10",
						cy: "10",
						r: "7.25",
						fill: "none",
						stroke: warn ? "var(--dsw-alias-state-error-primary)" : "currentColor",
						strokeWidth: "2.5",
						strokeLinecap: "round",
						strokeDasharray: String(circumference),
						strokeDashoffset: String(dashoffset),
						transform: "rotate(-90 10 10)"
					})]
				})
			});
		}
		/**
		* The dashboard's detail rows: EVERY package as the upstream reported it —
		* no merging, exhausted ones included. The sidebar card shows the merged
		* overview; this panel is the itemised ledger, so collapsing here would
		* destroy the only place a per-package figure is visible.
		*/
		function buildPackageRows(accounts) {
			return sortPackageRows(accounts).map((account) => {
				const percent = account.unlimited === true ? void 0 : clampPercent(account.remain, account.size);
				return {
					name: account.packageName,
					remain: account.remain,
					size: account.size,
					percent,
					warn: account.unlimited !== true && percent !== void 0 && percent < 20,
					packageEndTime: account.packageEndTime
				};
			});
		}
		/** Time-of-day formatter for the updated stamp. */
		function timeText(ms) {
			return new Date(ms).toLocaleTimeString(void 0, {
				hour: "2-digit",
				minute: "2-digit"
			});
		}
		/** One variant's sidebar quota card. */
		function SidebarQuotaCard(props) {
			const { t = fallbackT, statusPath, open } = props;
			const variantId = statusPath !== void 0 ? variantOfStatusPath(statusPath) : "workbuddy";
			const nameKey = variantId === "workbuddy-ai" ? "quotaCardAI" : "quotaCardCN";
			const wide = props.wide !== false;
			const [failed, setFailed] = (0, react.useState)(false);
			(0, react.useSyncExternalStore)(onQuotaSettingsChange, quotaSettingsRevision);
			const enabled = variantId === "workbuddy" ? quotaToggles().cn : quotaToggles().ai;
			const status = quotaStatus(variantId);
			const signedIn = status?.status === "signed-in";
			(0, react.useEffect)(() => {
				if (statusPath === void 0 || !enabled) return void 0;
				let disposed = false;
				let timer;
				const controller = new AbortController();
				const refresh = async () => {
					try {
						const response = await fetch(statusPath, {
							signal: controller.signal,
							headers: { accept: "application/json" }
						});
						const body = await response.json();
						if (disposed) return;
						if (!response.ok || !isWorkBuddyWebStatus(body)) {
							setFailed(true);
							return;
						}
						setFailed(false);
						noteQuotaStatus(variantId, body);
					} catch {
						if (!disposed) setFailed(true);
					}
				};
				const isHidden = () => typeof document !== "undefined" && document.hidden;
				const loop = () => {
					if (isHidden()) return;
					refresh();
				};
				timer = window.setInterval(loop, Math.max(6e4, quotaPollMs()));
				refresh();
				const onVisible = () => {
					if (!isHidden()) loop();
				};
				if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
				return () => {
					disposed = true;
					controller.abort();
					if (timer !== void 0) window.clearInterval(timer);
					if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
				};
			}, [
				statusPath,
				enabled,
				variantId
			]);
			if (enabled === false) return null;
			const credits = status !== void 0 && "credits" in status ? status.credits : void 0;
			const bars = credits === void 0 ? [] : buildBars(credits.accounts ?? []);
			const lowest = bars.reduce((acc, bar) => {
				if (bar.percent === void 0) return acc;
				const value = Number.parseFloat(bar.percent);
				if (!Number.isFinite(value)) return acc;
				return acc === void 0 ? value : Math.min(acc, value);
			}, void 0);
			const ringPercent = failed || status === void 0 ? 0 : credits?.unlimited === true ? 100 : lowest ?? 0;
			const ringWarn = failed || lowest !== void 0 && lowest < 20;
			const fetchedAt = quotaStatusFetchedAt(variantId);
			const title = [
				t(nameKey),
				...bars.map((bar) => `${bar.label} ${bar.detail}${bar.percent === void 0 ? "" : ` (${bar.percent})`}`),
				fetchedAt !== void 0 ? `${t("quotaUpdated")} ${timeText(fetchedAt)}` : ""
			].filter((part) => part !== "").join(" · ");
			if (!wide) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: "wbp-railButton",
				"aria-label": title,
				title,
				disabled: !signedIn,
				onClick: () => {
					if (!signedIn) return;
					open?.();
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ring, {
					percent: ringPercent,
					warn: ringWarn,
					size: 18
				})
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: "wbp-foot",
				"aria-label": title,
				title,
				disabled: !signedIn,
				onClick: () => {
					if (!signedIn) return;
					open?.();
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "wbp-footTop",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ring, {
							percent: ringPercent,
							warn: ringWarn,
							size: 16
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "wbp-footName",
							children: t(nameKey)
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: { flex: 1 } }),
						fetchedAt !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "wbp-updated",
							children: [
								t("quotaUpdated"),
								" ",
								timeText(fetchedAt)
							]
						}) : null
					]
				}), failed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "wbp-footRow",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "wbp-footLabel",
						children: t("quotaError")
					})
				}) : bars.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "wbp-footRow",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "wbp-footLabel",
						children: status === void 0 ? "…" : !("credits" in status) ? t("quotaNotSignedIn") : status.creditsError ?? t("quotaError")
					})
				}) : bars.map((bar, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "wbp-footRow",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "wbp-footHead",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "wbp-footLabel",
								title: bar.packageEndTime !== void 0 ? `${t("quotaExpires")} ${bar.packageEndTime}` : t("quotaNoExpiry"),
								children: bar.label
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "wbp-footAmount",
								children: bar.detail
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "wbp-footPct",
								children: bar.percent ?? ""
							})
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "wbp-footBar",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: bar.warn ? "wbp-footFill wbp-footFillWarn" : "wbp-footFill",
							style: { width: `${bar.barPercent}%` }
						})
					})]
				}, `${index}\u0000${bar.label}\u0000${bar.packageEndTime ?? ""}`))]
			});
		}
		/**
		* The center-column dashboard, registered into the layout's keyed `main` slot
		* under the id the footer cards select, so card → panel is one navigation
		* entry. One variant at a time, switched by tabs (commandcode's account-tab
		* pattern): CN and international are separate accounts with separate package
		* lists, so mixing them into one column would misattribute every number.
		*
		* The panel fetches BOTH routes itself on mount and on the shared poll
		* interval — a user opening the panel must never wait for the sidebar cards'
		* next tick, and must never see a stale "sign in" just because no poll had
		* run yet. The tab defaults to the variant whose card was clicked.
		*/
		function QuotaDashboard(props) {
			const { t = fallbackT, statusPaths, refresh, close, useQuotaDashboard, onVariantPicked } = props;
			(0, react.useSyncExternalStore)(onQuotaSettingsChange, quotaSettingsRevision);
			const state = useQuotaDashboard((s) => s);
			const followedPath = state.activePath;
			const [userPicked, setUserPicked] = (0, react.useState)(void 0);
			const activePathResolved = userPicked ?? followedPath;
			const activeVariant = variantOfStatusPath(activePathResolved);
			const status = quotaStatus(activeVariant);
			const loading = state.loading;
			const fetchedAt = state.fetchedAt;
			const credits = status !== void 0 && "credits" in status ? status.credits : void 0;
			const rows = credits === void 0 ? [] : buildPackageRows(credits.accounts ?? []);
			const nameKey = activeVariant === "workbuddy-ai" ? "quotaCardAI" : "quotaCardCN";
			const signedIn = status?.status === "signed-in";
			const totalRemain = credits?.total ?? 0;
			const totalSize = credits?.totalSize ?? credits?.accounts.reduce((sum, account) => sum + account.size, 0) ?? 0;
			const totalPercent = clampPercent(totalRemain, totalSize);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "wbp-main",
				role: "region",
				"aria-label": t("quotaDashboardTitle"),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "wbp-mainInner",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
							className: "wbp-header",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "wbp-headerText",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
										className: "wbp-title",
										children: t("quotaDashboardTitle")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "wbp-subtitle",
										children: t("quotaDashboardSubtitle")
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "wbp-spacer" }),
								fetchedAt !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "wbp-meta",
									children: [
										t("quotaUpdated"),
										" ",
										timeText(fetchedAt)
									]
								}) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "wbp-refresh",
									disabled: loading,
									onClick: () => refresh(),
									children: loading ? t("quotaRefreshing") : t("quotaRefresh")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "wbp-close",
									"aria-label": t("quotaClose"),
									title: t("quotaClose"),
									onClick: () => close(),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										"aria-hidden": "true",
										children: "×"
									})
								})
							]
						}),
						statusPaths.length > 1 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "wbp-tabs",
							role: "tablist",
							"aria-label": t("quotaDashboardTitle"),
							children: statusPaths.map((path) => {
								const key = variantOfStatusPath(path) === "workbuddy-ai" ? "quotaCardAI" : "quotaCardCN";
								return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									role: "tab",
									"aria-selected": path === activePathResolved,
									className: path === activePathResolved ? "wbp-tab wbp-tabActive" : "wbp-tab",
									onClick: () => {
										setUserPicked(path);
										onVariantPicked(path);
									},
									children: t(key)
								}, path);
							})
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: "wbp-card",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "wbp-cardHead",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "wbp-avatar",
										children: activeVariant === "workbuddy-ai" ? "AI" : "CN"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "wbp-cardIdentity",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "wbp-cardTitle",
											children: t(nameKey)
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "wbp-cardOwner",
											children: signedIn ? status.nickname ?? "" : t("quotaNotSignedIn")
										})]
									}),
									credits?.unlimited === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "wbp-badge",
										children: t("quotaUnlimited")
									}) : null
								]
							}), !signedIn ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "wbp-notice",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "wbp-noticeTitle",
									children: t("quotaNotSignedIn")
								})
							}) : credits === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "wbp-notice wbp-noticeError",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "wbp-noticeTitle",
									children: t("quotaError")
								})
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
									className: "wbp-totalLine",
									children: [
										t("quotaTotalRemain"),
										" ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
											className: "wbp-totalValue",
											children: totalRemain.toLocaleString()
										})
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "wbp-totalSub",
									children: t("quotaTotalShare", {
										percent: totalPercent === void 0 ? t("quotaUnknownTotal") : `${totalPercent.toFixed(2)}%`,
										remain: totalRemain.toLocaleString(),
										size: totalSize.toLocaleString()
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "wbp-bar",
									role: "progressbar",
									"aria-label": t("quotaTotal"),
									...totalPercent === void 0 ? { "aria-valuetext": t("quotaUnknownTotal") } : {
										"aria-valuemin": 0,
										"aria-valuemax": 100,
										"aria-valuenow": Math.round(totalPercent)
									},
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: totalPercent !== void 0 && totalPercent < 20 ? "wbp-barFill wbp-barFillWarn" : "wbp-barFill",
										style: {
											width: totalPercent === void 0 ? "100%" : `${Math.max(2, totalPercent)}%`,
											opacity: totalPercent === void 0 ? .25 : 1
										}
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									className: "wbp-blockTitle",
									children: t("quotaByPackage")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
									className: "wbp-table",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("quotaColPackage") }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("quotaColRemain") }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("quotaColExpiry") })
									] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: rows.map((row, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: row.name }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("td", {
											className: "wbp-num",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: "wbp-numText",
												children: [
													row.remain.toLocaleString(),
													" / ",
													row.size.toLocaleString()
												]
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "wbp-miniBar",
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: row.warn ? "wbp-footFill wbp-footFillWarn" : "wbp-footFill",
													style: {
														display: "block",
														height: "100%",
														borderRadius: 999,
														width: row.percent === void 0 ? "100%" : `${Math.max(2, row.percent)}%`,
														opacity: row.percent === void 0 ? .25 : 1
													}
												})
											})]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
											className: "wbp-expiry",
											children: row.packageEndTime ?? t("quotaNoExpiry")
										})
									] }, `${index}\u0000${row.name}\u0000${row.packageEndTime ?? ""}`)) })]
								}),
								credits.cycleResetTime !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
									className: "wbp-windowReset",
									children: [
										t("quotaExpires"),
										" ",
										credits.cycleResetTime
									]
								}) : null
							] })]
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/quota-styles.ts
		/**
		* Stylesheet for the WorkBuddy quota surfaces (the sidebar footer card and the
		* dashboard it opens) — a direct translation of commandcode's panel stylesheet
		* (src/client/panel-styles.ts), which the user held up as the reference look.
		* Classes are `wbp-` prefixed to stay clear of commandcode's `ccp-` set: both
		* plugins inject GLOBAL CSS into the same document, so the prefixes must not
		* collide.
		*
		* Same contract as the original: returned as a string (no DOM side effects at
		* import time), installed once by the client entry keyed by `data-plugin-css`,
		* and removed when the plugin's fiber unwinds. Every colour comes from a
		* harness theme alias with a neutral fallback.
		*/
		/** Stylesheet id (the `data-plugin-css` value that makes injection idempotent). */
		const QUOTA_CSS_ID = "dsh-workbuddy-connect/QuotaPanel.module.css";
		/** Install the stylesheet once; returns its disposer. */
		function injectQuotaCss() {
			if (typeof document === "undefined") return () => {};
			if (document.querySelector(`style[data-plugin-css="dsh-workbuddy-connect/QuotaPanel.module.css"]`) !== null) return () => {};
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-workbuddy-connect";
			tag.dataset.pluginCss = QUOTA_CSS_ID;
			tag.textContent = QUOTA_CSS;
			document.head.appendChild(tag);
			return () => {
				tag.remove();
			};
		}
		/** The quota panel stylesheet. */
		const QUOTA_CSS = `
/* ------------------------------------------------- sidebar footer card */
/* The shell's foot area renders this list ABOVE the Settings seat. The shell
   supplies no chrome: the entry is the button. Deliberately quiet — a surface
   beside Settings should read as part of the column — one hover step and a
   hairline border, exactly like commandcode's card.

   The shell's container is a flex ROW whose occupants each declare a
   full-width line, so as a row it overflows the column. The fix is the same
   load-bearing anchored rule commandcode ships (their issue #48): force the
   sidebar's footer-action container into a column, anchored to "_footArea"
   because "footerActions" is also used by the ask-user-question dialog — an
   unanchored rule would stack THAT dialog's buttons too. Anchoring keeps the
   fix scoped to the sidebar; the descendant combinator survives a wrapper
   appearing between the two. The rule is idempotent when commandcode is also
   installed (same selector, same declaration) and makes this plugin
   self-sufficient when it is not. */
[class*="_footArea"] [class*="_footerActions"]{flex-direction:column}
.wbp-foot{box-sizing:border-box;flex:0 0 auto;width:100%;min-width:0;font:inherit;color:var(--dsw-alias-label-secondary);text-align:left;cursor:pointer;background:0 0;border:1px solid transparent;border-radius:10px;flex-direction:column;gap:6px;margin:0 0 4px;padding:8px;display:flex}
.wbp-foot:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}
.wbp-foot:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
/* A signed-out variant's card is inert (the click is blocked at the handler):
   it must not invite the click it will ignore, so it drops the pointer cursor
   and the hover tint — the same disabled look the settings switches use. */
.wbp-foot:disabled{opacity:.5;cursor:default}
.wbp-foot:disabled:hover{color:var(--dsw-alias-label-secondary);background:0 0;border-color:transparent}
.wbp-railButton:disabled{opacity:.5;cursor:default}
.wbp-railButton:disabled:hover{color:var(--dsw-alias-label-secondary);background:0 0}
.wbp-footTop{align-items:center;gap:8px;min-width:0;display:flex}
.wbp-footName{white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-primary);min-width:0;overflow:hidden;font-size:13px;font-weight:500;line-height:20px}
.wbp-updated{flex:none;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:14px;font-variant-numeric:tabular-nums;white-space:nowrap}
/* One block per merged package group: a head line carrying the group's own
   remain/total, then the FULL-WIDTH bar under it. Stacking the two lets the
   card show the figures — the reason this surface exists — without squeezing
   the bar into what is left beside them. */
.wbp-footRow{flex-direction:column;gap:4px;min-width:0;display:flex}
.wbp-footHead{align-items:baseline;gap:8px;min-width:0;display:flex}
.wbp-footLabel{flex:1;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wbp-footAmount{flex:none;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums;white-space:nowrap}
/* The card's markup must stay PHRASING content — it renders inside the shell's
   own button — so these bars are spans, not divs. display:block is
   load-bearing on BOTH: an inline box ignores width and height outright, so
   without it the fill collapses to 0x0 and the bar shows no usage. */
.wbp-footBar{display:block;background:var(--dsw-alias-bg-layer-2);border-radius:999px;height:5px;overflow:hidden}
.wbp-footFill{display:block;background:var(--dsw-alias-brand-primary);border-radius:999px;height:100%;transition:width .3s ease}
.wbp-footFillWarn{background:var(--dsw-alias-state-error-primary)}
.wbp-footPct{flex:none;width:34px;color:var(--dsw-alias-label-secondary);text-align:right;font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}

/* The 56px rail: one icon button on the shell's own rail geometry (36px cell),
   so the collapsed column keeps a single glyph like its siblings. */
.wbp-railButton{box-sizing:border-box;width:36px;height:36px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:1px solid transparent;border-radius:8px;flex:none;justify-content:center;align-items:center;margin:0 0 4px;padding:0;display:inline-flex}
.wbp-railButton:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.wbp-railButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}

/* The ring glyph. Sized entirely by its own width/height attribute, so the
   footer row and the rail button can each ask for their own. */
.wbp-glyph{flex:none;justify-content:center;align-items:center;display:inline-flex;color:var(--dsw-alias-brand-primary)}
.wbp-ringWarn{color:var(--dsw-alias-state-error-primary)}

/* ------------------------------------------------------------ dashboard */
/* The center column in the layout frame: fill it, scroll the content column,
   and cap the reading width like the harness's own panels. */
.wbp-main{background:var(--dsw-alias-bg-layer-1);width:100%;height:100%;overflow:auto;display:block}
.wbp-mainInner{max-width:760px;margin:0 auto;padding:24px 20px 40px;flex-direction:column;gap:14px;display:flex;color:var(--dsw-alias-label-primary)}
.wbp-header{align-items:center;gap:10px;display:flex;flex-wrap:wrap}
.wbp-headerText{flex-direction:column;gap:2px;display:flex;min-width:0}
.wbp-title{margin:0;font-size:18px;font-weight:600;line-height:1.4}
.wbp-subtitle{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}
.wbp-spacer{flex:1}
.wbp-meta{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5;font-variant-numeric:tabular-nums}
/* The dashboard's exit: an icon-sized glyph button. */
.wbp-close{min-width:28px;justify-content:center;padding-left:0;padding-right:0;box-sizing:border-box;align-items:center;cursor:pointer;font:inherit;color:var(--dsw-alias-label-secondary);background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;height:28px;display:inline-flex}
.wbp-close:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.wbp-close:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.wbp-close span{font-size:16px;line-height:1}
.wbp-refresh{box-sizing:border-box;align-items:center;cursor:pointer;font:inherit;color:var(--dsw-alias-label-secondary);background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:4px 12px;display:inline-flex;gap:6px;font-size:12px;line-height:18px}
.wbp-refresh:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.wbp-refresh:disabled{opacity:.5;cursor:default}
.wbp-refresh:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}

/* Notices: signed-out and error states. */
.wbp-notice{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;padding:12px 14px;flex-direction:column;gap:4px;display:flex}
.wbp-noticeError{border-color:var(--dsw-alias-state-error-primary)}
.wbp-noticeTitle{margin:0;font-size:13px;font-weight:600;line-height:1.5}
.wbp-noticeHint{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.55}

/* One card per variant. */
.wbp-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:14px;padding:16px 18px;flex-direction:column;gap:16px;display:flex}
.wbp-cardHead{align-items:center;gap:10px;display:flex;flex-wrap:wrap}
.wbp-avatar{flex:none;width:28px;height:28px;color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-module-platform);border-radius:50%;justify-content:center;align-items:center;font-size:12px;font-weight:600;line-height:1;display:inline-flex}
.wbp-cardIdentity{flex-direction:column;gap:1px;min-width:0;display:flex}
.wbp-cardTitle{font-size:13px;font-weight:600;line-height:1.4}
.wbp-cardOwner{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px}

/* Quota blocks: each merged group is a label row plus the track. */
.wbp-windows{flex-direction:column;gap:14px;display:flex}
.wbp-window{flex-direction:column;gap:6px;display:flex}
.wbp-windowHead{align-items:baseline;gap:8px;display:flex}
.wbp-windowLabel{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:1.5}
.wbp-windowValue{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5;font-variant-numeric:tabular-nums;white-space:nowrap}
.wbp-windowPct{color:var(--dsw-alias-label-primary);min-width:38px;text-align:right;font-size:12px;font-weight:600;line-height:1.5;font-variant-numeric:tabular-nums}
.wbp-bar{overflow:hidden;background:var(--dsw-alias-bg-layer-1);border-radius:999px;height:8px}
.wbp-barFill{background:var(--dsw-alias-brand-primary);border-radius:999px;height:100%;transition:width .3s ease}
.wbp-barFillWarn{background:var(--dsw-alias-state-error-primary)}
.wbp-windowReset{color:var(--dsw-alias-label-tertiary);margin:0;font-size:11px;line-height:1.5}

/* Badges. */
.wbp-badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-brand-primary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:600;line-height:17px}
.wbp-badgeError{background:transparent;color:var(--dsw-alias-state-error-primary)}
.wbp-badgeMuted{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px;max-width:220px;overflow:hidden;text-overflow:ellipsis}

/* Overall remaining + share line, ahead of the detail table. */
.wbp-totalLine{margin:0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.wbp-totalValue{font-size:22px;font-weight:600;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;margin-left:6px}
.wbp-totalSub{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;font-variant-numeric:tabular-nums}

/* Detail table: every package, unmerged. Column heads are the settings
   shell's tertiary smallcaps; numbers are tabular; the mini bar rides under
   the figures in the same cell like the reference layout. */
.wbp-table{width:100%;border-collapse:collapse;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.wbp-table th{text-align:left;color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:600;line-height:1.5;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--dsw-alias-border-l2);padding:4px 8px}
.wbp-table td{padding:7px 8px;border-bottom:1px solid var(--dsw-alias-border-l2);vertical-align:top}
.wbp-table tr:last-child td{border-bottom:0}
.wbp-num{min-width:150px}
.wbp-numText{display:block;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);margin-bottom:3px}
.wbp-miniBar{display:block;height:4px;border-radius:999px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.wbp-expiry{white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}

/* Variant switch: plain buttons, like the settings page's usage carousel. */
.wbp-tabs{flex-wrap:wrap;gap:6px;display:flex}
.wbp-tab{align-items:center;font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 10px;font-size:12px;line-height:18px;display:inline-flex;gap:6px}
.wbp-tab:hover:not(.wbp-tabActive){color:var(--dsw-alias-label-primary)}
.wbp-tabActive{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary)}

@media (prefers-reduced-motion:reduce){.wbp-footFill,.wbp-barFill{transition:none}}
`;
		//#endregion
		//#region src/client/locales.ts
		/** Plugin-card copy registered under the settings.workbuddy locale namespace. */
		const en = {
			title: "WorkBuddy",
			intro: "Use the models in the WorkBuddy desktop app directly in DSH — zero configuration, ready out of the box.",
			titleAI: "WorkBuddy AI",
			introAI: "Use the models in the WorkBuddy AI international desktop app directly in DSH — zero configuration, ready out of the box.",
			/** The single unified card's title: it owns both variants and the quota settings. */
			unifiedTitle: "WorkBuddy",
			unifiedIntro: "Manage WorkBuddy (China) and WorkBuddy AI (international) models, credentials, and sidebar quota displays.",
			/** The segmented switcher's two halves. */
			variantTabCN: "China",
			variantTabAI: "International",
			expand: "Expand",
			collapse: "Collapse",
			loading: "Loading account…",
			signedOut: "Not signed in",
			signedOutHint: "Sign in to WorkBuddy to use its models in DSH.",
			signedOutHintAI: "Sign in to WorkBuddy AI to use its international models in DSH.",
			signIn: "Sign in",
			signInWaiting: "Waiting for you to finish signing in the browser…",
			signInOpenAgain: "Open the sign-in page again",
			signingIn: "Signing in…",
			signInFailed: "Sign-in failed: {message}",
			signInCancelled: "Sign-in cancelled",
			signOut: "Sign out",
			signingOut: "Signing out…",
			importHeading: "Or use a credential file",
			importHint: "Choose a workbuddy.json you already have. It is validated and stored for this product only.",
			importAction: "Choose file…",
			importing: "Importing…",
			importFailed: "Import failed: {message}",
			importDone: "Imported {account}",
			switchAccount: "Switch account",
			switchingAccount: "Switching…",
			signedInAs: "Signed in as {nickname}",
			accessTokenExpires: "Access token expires {time} (refresh is automatic)",
			creditsHeading: "Remaining credit",
			tabStatus: "Status",
			tabContext: "Context window",
			tabDetails: "Credit details",
			tabCheckIn: "Check-in log",
			checkInLogTime: "Check-in time",
			checkInLogResult: "Result",
			checkInLogAmount: "Credits",
			checkInLogEmpty: "No check-in logs recorded yet.",
			checkInNow: "Check in now",
			checkInChecking: "Checking in…",
			checkInRefresh: "Refresh",
			checkInRefreshing: "Refreshing…",
			checkInClear: "Clear logs",
			checkInClearing: "Clearing…",
			autoCheckInStatusClaimed: "Checked in today (+{amount} Credits)",
			autoCheckInStatusAlready: "Already checked in today",
			autoCheckInStatusNoCampaign: "No active benefit campaign today",
			autoCheckInStatusError: "Check-in error: {message}",
			creditsDetailHeading: "By package",
			creditsTotal: "Total: {total}",
			creditsTotalUnlimited: "Total: Unlimited",
			unlimitedQuota: "Unlimited",
			packageEnterprise: "Enterprise quota",
			cycleResetAt: "Resets {time}",
			percentRemaining: "{percent}% remaining",
			percentUsed: "{percent}% used",
			percentUnknown: "Used share unknown",
			exactRemaining: "{remain} / {size} remaining",
			exactUsed: "{used} / {size} used",
			creditPackageUnknownSize: "{remain} remaining",
			quotaUsedPercent: "Used {percent}%",
			quotaRemainStats: "Remaining {remain}",
			creditsError: "Credit unavailable: {message}",
			refresh: "Refresh",
			refreshing: "Refreshing…",
			refreshModels: "Refresh model list",
			refreshingModels: "Refreshing models…",
			catalogLive: "Model list updated {time}",
			catalogSaved: "Showing the saved model list from {time}",
			catalogFallback: "Showing the built-in model list (not yet updated from WorkBuddy)",
			catalogError: "Last update failed: {message}",
			catalogAppVersion: "App version {version}",
			requestFailed: "Request failed",
			statusRefreshFailed: "Refresh failed: {message} — showing the last known state",
			statusResponseInvalid: "WorkBuddy returned an unreadable status reply",
			accountHeading: "Account",
			modelsHeading: "Model offers",
			contextHeading: "Context window",
			contextUpTo: "up to {size}",
			contextDefault: "default {size}",
			useMaximumContextWindow: "Use the largest declared context window",
			useMaximumContextWindowHint: "Applies to WorkBuddy AI models that offer a larger window.",
			freeModel: "Free",
			badgeLimitedFree: "Limited-time free",
			badgeNightDiscount: "Night discount",
			badgeFreeNow: "Free now",
			rate: "{rate} credits per message",
			rateUnknown: "Price unavailable — refresh to update",
			probeLabel: "Reasoning levels",
			probeTooltipIdle: "Detect the reasoning levels {model} accepts",
			probeTooltipVerified: "Accepted levels: {levels} · click to detect again",
			probeTooltipNotValidating: "This model does not check the effort parameter",
			probeTooltipRetry: "Detection did not complete · click to retry",
			probeBubbleBody: "Send test requests to confirm the available reasoning levels. May consume a small amount of credit.",
			probeConfirmAction: "Confirm",
			probeNoteVerified: "Detected: {levels}",
			probeNoteNotValidating: "This model does not check the effort parameter",
			probeNoteUnknown: "Detection did not complete",
			probeNoteDismiss: "Got it",
			probeHeading: "Reasoning effort detection",
			probeResultNoLevels: "No tested levels were accepted.",
			probeIntro: "Some models reason but declare no selectable effort levels. Detecting which levels a model accepts sends a few real requests that may consume credit.",
			probeConsentHint: "Each detection sends test requests to one model to confirm its available reasoning levels, and may consume a small amount of credit.",
			probeStart: "Detect",
			probeRedetect: "Detect again",
			probeRunning: "Detecting {model}…",
			probeRunningGeneric: "Detecting…",
			probeClear: "Clear detected results",
			probeCandidates: "Detectable models: {count}",
			probeConfirmBody: "Send test requests to {model} to confirm its available reasoning levels. May consume a small amount of credit.",
			cancel: "Cancel",
			probeResultVerified: "Verified levels: {levels}",
			probeResultNotValidating: "This model does not check the effort parameter",
			probeResultUnknown: "Detection did not complete",
			probeResultAt: "Detected {time}",
			probeResultEmpty: "No detectable models right now.",
			probeFailed: "Detection failed: {message}",
			quotaSettingsTitle: "WorkBuddy sidebar display",
			quotaSettingsIntro: "Show remaining credit beside the sidebar Settings seat. Each toggle needs its variant signed in.",
			quotaToggleCN: "Show CN credit card",
			quotaToggleAI: "Show international credit card",
			quotaToggleHint: "Show this account’s remaining credit in the sidebar footer.",
			quotaAutoCheckInCN: "WorkBuddy (China) Daily Auto Check-in",
			quotaAutoCheckInCNHint: "Automatically check in at 10:00 (UTC+8) every day to claim daily credits.",
			quotaAutoCheckInAI: "WorkBuddy AI (International) Daily Auto Check-in",
			quotaAutoCheckInAIHint: "Automatically check in at 10:00 (UTC+8) every day to claim international benefits.",
			quotaSignInRequired: "Sign in first to enable this card.",
			quotaPollLabel: "Refresh interval",
			quotaPollHint: "Applies to both quota cards. Longer is kinder to the billing endpoint.",
			quotaPollUnit: "min",
			quotaSettingsSave: "Save",
			quotaSettingsSaving: "Saving…",
			quotaSettingsDiscard: "Discard",
			quotaSettingsDirty: "Unsaved changes",
			quotaSettingsInvalid: "A value is invalid — fix it before saving",
			quotaSettingsSaveFailed: "Save did not land — retry",
			quotaSettingsSavedHint: "Saved",
			quotaCardCN: "WorkBuddy credit",
			quotaCardAI: "WorkBuddy AI credit",
			quotaUnknownTotal: "total unknown",
			quotaUnlimited: "Unlimited",
			quotaExpires: "Expires",
			quotaNoExpiry: "No expiry",
			quotaError: "Credit unavailable",
			quotaNotSignedIn: "Sign in to see the remaining credit",
			quotaUpdated: "Updated",
			quotaDashboardTitle: "WorkBuddy quota",
			quotaDashboardSubtitle: "Remaining credit by package, per product",
			quotaRefresh: "Refresh",
			quotaRefreshing: "Refreshing…",
			quotaClose: "Close",
			quotaByPackage: "By package",
			quotaTotal: "Total",
			quotaTotalRemain: "Remaining",
			quotaTotalShare: "{percent} of this cycle’s granted total ({remain} / {size})",
			quotaColPackage: "Package",
			quotaColRemain: "Remaining / Total",
			quotaColExpiry: "Expires"
		};
		const zh = {
			title: "WorkBuddy（国内版）",
			intro: "登录 WorkBuddy 国内版后，在侧栏底部查看剩余积分，并直接使用它的模型。",
			titleAI: "WorkBuddy（国际版）",
			introAI: "登录 WorkBuddy AI 国际版后，在侧栏底部查看剩余积分，并直接使用它的模型。",
			unifiedTitle: "WorkBuddy",
			unifiedIntro: "统一管理 WorkBuddy（国内版）与 WorkBuddy AI（国际版）模型、凭证及侧栏额度展示。",
			variantTabCN: "国内版",
			variantTabAI: "国际版",
			expand: "展开",
			collapse: "收起",
			loading: "正在读取账号…",
			signedOut: "未登录",
			signedOutHint: "登录 WorkBuddy 后即可在 DSH 中使用它的模型。",
			signedOutHintAI: "登录 WorkBuddy AI 国际版后即可在 DSH 中使用它的模型。",
			signIn: "登录",
			signInWaiting: "请在浏览器中完成登录…",
			signInOpenAgain: "重新打开登录页面",
			signingIn: "正在登录…",
			signInFailed: "登录失败：{message}",
			signInCancelled: "已取消登录",
			signOut: "退出登录",
			signingOut: "正在退出…",
			switchAccount: "切换账号",
			switchingAccount: "正在切换…",
			importHeading: "或使用凭证文件",
			importHint: "选择你已有的 workbuddy.json。插件会校验并只保存到本产品名下。",
			importAction: "选择文件…",
			importing: "正在导入…",
			importFailed: "导入失败：{message}",
			importDone: "已导入 {account}",
			signedInAs: "已登录：{nickname}",
			accessTokenExpires: "访问令牌 {time} 过期（自动续期）",
			creditsHeading: "剩余积分",
			tabStatus: "状态",
			tabContext: "上下文窗口",
			tabDetails: "额度明细",
			tabCheckIn: "签到日志",
			checkInLogTime: "签到时间",
			checkInLogResult: "签到结果",
			checkInLogAmount: "获得额度",
			checkInLogEmpty: "暂无签到日志记录。",
			checkInNow: "立即签到",
			checkInChecking: "正在签到…",
			checkInRefresh: "刷新",
			checkInRefreshing: "正在刷新…",
			checkInClear: "清空日志",
			checkInClearing: "正在清空…",
			autoCheckInStatusClaimed: "今日已完成签到（+{amount} 积分）",
			autoCheckInStatusAlready: "今日已完成签到",
			autoCheckInStatusNoCampaign: "今日无可用签到福利活动",
			autoCheckInStatusError: "签到出错：{message}",
			creditsDetailHeading: "按套餐",
			creditsTotal: "合计：{total}",
			creditsTotalUnlimited: "合计：不限额",
			unlimitedQuota: "不限额",
			packageEnterprise: "企业额度",
			cycleResetAt: "重置时间：{time}",
			percentRemaining: "剩余 {percent}%",
			percentUsed: "已使用 {percent}%",
			percentUnknown: "已用占比未知",
			exactRemaining: "剩余 {remain} / {size}",
			exactUsed: "已使用 {used} / {size}",
			creditPackageUnknownSize: "剩余 {remain}",
			quotaUsedPercent: "已使用 {percent}%",
			quotaRemainStats: "剩余 {remain}",
			creditsError: "积分查询失败：{message}",
			refresh: "刷新",
			refreshing: "正在刷新…",
			refreshModels: "刷新模型列表",
			refreshingModels: "正在刷新模型…",
			catalogLive: "模型列表更新于 {time}",
			catalogSaved: "当前显示已保存的模型列表，更新于 {time}",
			catalogFallback: "当前显示内置模型列表（尚未从 WorkBuddy 更新）",
			catalogError: "上次更新失败：{message}",
			catalogAppVersion: "App 版本 {version}",
			requestFailed: "请求失败",
			statusRefreshFailed: "刷新失败：{message} — 当前显示的是上次成功获取的状态",
			statusResponseInvalid: "WorkBuddy 返回的状态数据无法识别",
			accountHeading: "账号",
			modelsHeading: "模型优惠",
			contextHeading: "上下文窗口",
			contextUpTo: "最高 {size}",
			contextDefault: "默认 {size}",
			useMaximumContextWindow: "使用上游声明的最大上下文窗口",
			useMaximumContextWindowHint: "仅作用于 WorkBuddy AI 中声明了更大窗口的模型。",
			freeModel: "免费",
			badgeLimitedFree: "限时免费",
			badgeNightDiscount: "夜间折扣",
			badgeFreeNow: "限时免费",
			rate: "{rate} 积分/次",
			rateUnknown: "价格未知 — 刷新后更新",
			probeLabel: "推理等级",
			probeTooltipIdle: "检测 {model} 可用的推理档位",
			probeTooltipVerified: "已接受：{levels} · 点击可重新检测",
			probeTooltipNotValidating: "该模型不校验该参数",
			probeTooltipRetry: "检测未完成 · 点击重试",
			probeBubbleBody: "发送探测请求以确认可用推理档位。可能消耗少量积分。",
			probeConfirmAction: "确认检测",
			probeNoteVerified: "已检测：{levels}",
			probeNoteNotValidating: "该模型不校验该参数",
			probeNoteUnknown: "检测未完成",
			probeNoteDismiss: "知道了",
			probeHeading: "推理档位检测",
			probeResultNoLevels: "本次测试的档位均未被接受。",
			probeIntro: "部分模型具备思考能力，但没有声明可选档位。检测会发送少量真实请求，可能消耗积分。",
			probeConsentHint: "每次检测会向该模型发送探测请求，以确认可用推理档位，可能消耗少量积分。",
			probeStart: "开始检测",
			probeRedetect: "重新检测",
			probeRunning: "正在检测 {model}…",
			probeRunningGeneric: "正在检测…",
			probeClear: "清除已探测结果",
			probeCandidates: "可检测模型：{count} 个",
			probeConfirmBody: "向 {model} 发送探测请求，以确认可用推理档位。可能消耗少量积分。",
			cancel: "取消",
			probeResultVerified: "已验证接受的档位：{levels}",
			probeResultNotValidating: "该模型不校验该参数",
			probeResultUnknown: "检测未完成",
			probeResultAt: "检测于 {time}",
			probeResultEmpty: "当前没有可检测的模型。",
			probeFailed: "检测失败：{message}",
			quotaSettingsTitle: "WorkBuddy侧栏展示",
			quotaSettingsIntro: "在侧栏设置项旁展示剩余积分。开关需要对应账号已登录。",
			quotaToggleCN: "展示国内版额度",
			quotaToggleAI: "展示国际版额度",
			quotaToggleHint: "在侧栏底部展示该账号的剩余积分。",
			quotaAutoCheckInCN: "WorkBuddy（国内版）每日自动签到",
			quotaAutoCheckInCNHint: "每天 10:00 (UTC+8) 自动签到领取每日积分额度。",
			quotaAutoCheckInAI: "WorkBuddy AI（国际版）每日自动签到",
			quotaAutoCheckInAIHint: "每天 10:00 (UTC+8) 自动检测并领取国际版可用福利额度。",
			quotaSignInRequired: "请先登录后再开启。",
			quotaPollLabel: "刷新间隔",
			quotaPollHint: "对两张额度卡片同时生效。间隔越长对计费接口越友好。",
			quotaPollUnit: "分钟",
			quotaSettingsSave: "保存",
			quotaSettingsSaving: "保存中…",
			quotaSettingsDiscard: "放弃更改",
			quotaSettingsDirty: "有未保存的更改",
			quotaSettingsInvalid: "有数值不合法，请修正后再保存",
			quotaSettingsSaveFailed: "保存未生效，请重试",
			quotaSettingsSavedHint: "已保存",
			quotaCardCN: "WorkBuddy 积分",
			quotaCardAI: "WorkBuddy AI 积分",
			quotaUnknownTotal: "总量未知",
			quotaUnlimited: "不限量",
			quotaExpires: "到期",
			quotaNoExpiry: "无到期时间",
			quotaError: "积分信息不可用",
			quotaNotSignedIn: "登录后显示剩余积分",
			quotaUpdated: "更新于",
			quotaDashboardTitle: "WorkBuddy 额度",
			quotaDashboardSubtitle: "按套餐展示各产品的剩余积分",
			quotaRefresh: "刷新",
			quotaRefreshing: "刷新中…",
			quotaClose: "关闭",
			quotaByPackage: "按套餐",
			quotaTotal: "合计",
			quotaTotalRemain: "剩余积分",
			quotaTotalShare: "占本轮总额度 {percent}（{remain} / {size}）",
			quotaColPackage: "资源包",
			quotaColRemain: "剩余 / 总量",
			quotaColExpiry: "到期时间"
		};
		//#endregion
		//#region src/client/index.tsx
		/** Browser half: WorkBuddy account status, quota cards, and plugin settings. */
		/** Stable browser-plugin name. */
		const name = "dsh-workbuddy-connect-client";
		/**
		* Client services required by the Plugin configuration contribution.
		*
		* DSH 0.1.2 removed `@deepseek-ai/dsh-client-runtime` (the package that used to
		* hold the browser `ClientContext` alias and the `slots` service). The services
		* this card relies on now come from narrower packages: the `slots` registry
		* moved to `@deepseek-ai/dsh-client-ui-renderer`, `locale` stayed in
		* `@deepseek-ai/dsh-client-locale`, and the `settings.plugin.item` slot is
		* declared by `@deepseek-ai/dsh-client-ui-settings-plugins`. All three are
		* named in the package's `dsh.client.inject` list, so cordis has activated
		* them before this plugin's fiber starts.
		*/
		const inject = [
			"slots",
			"locale",
			"remote",
			"remote.session",
			"settingsScope"
		];
		/** The settings namespaces each variant's card and section use (host-side constants, mirrored for paths). */
		const VARIANT_STATUS = {
			workbuddy: WORKBUDDY_STATUS_PATH,
			"workbuddy-ai": WORKBUDDY_AI_STATUS_PATH
		};
		/**
		* Register card copy, the unified WorkBuddy card, and the sidebar quota cards.
		*
		* The entire body is wrapped so that a DSH slot-API breaking change (for
		* example the rc.6 to rc.7 `id` to `key` / `order` to `priority` rename) degrades
		* to a `console.error` instead of throwing into the DSH loader and raising
		* the red "Failed to load plugins" banner. The host provider keeps working:
		* the `workbuddy` model channel is unaffected, and `dsh-workbuddy-connect
		* status` reports host health via the heartbeat file.
		*
		* Card ORDER: the Plugins tab dispatches `settings.plugin.item` in
		* priority-ascending order, so the unified card keeps the seat the shared
		* quota-settings card held (10) and takes the place of the two variant cards
		* that used to follow it: WorkBuddy (10), then the sibling plugins' bands.
		*
		* NOTE: the try/catch boundary of this function is mirrored (duplicated) in
		* `tests/client-fallback.spec.ts`, because the real client entry imports
		* browser-only DSH packages that cannot load in the Node test environment.
		* That test therefore does not import this function; it replicates its
		* shape. If you change the guarded body or the `console.error` message here,
		* update the mirrored `apply()` in that spec too, or the fallback test will
		* silently diverge from this real implementation.
		*/
		function apply(ctx) {
			try {
				const namespace = "settings.workbuddy";
				ctx.effect(() => ctx.locale.register(namespace, {
					zh,
					en
				}), "dsh-workbuddy-connect: settings copy");
				const t = ctx.locale.bind(namespace);
				let quotaScope;
				try {
					const scope = ctx.settingsScope.bind({ namespace: "workbuddy-quota" });
					quotaScope = scope;
					const applySnapshot = () => {
						const value = scope.getSnapshot().value;
						setQuotaToggles(value?.sidebarQuotaCN === true, value?.sidebarQuotaAI === true);
						if (typeof value?.quotaPollMs === "number") setQuotaPollMs(value.quotaPollMs);
					};
					applySnapshot();
					scope.subscribe(applySnapshot);
				} catch (error) {
					console.error("[dsh-workbuddy-connect] quota settings scope unavailable (sidebar cards stay hidden):", error);
				}
				ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
					name: "settings.plugin.item",
					key: "workbuddy",
					priority: 10,
					inject: () => ({
						t,
						scope: quotaScope,
						signedIn: () => quotaSignInState(),
						unified: true
					})
				}, WorkBuddyPluginCard));
				const QUOTA_PANEL_ID = "workbuddy-quota-panel";
				const CONVERSATION_PANEL_ID = "conversation";
				const dashboardDocuments = {
					cn: void 0,
					ai: void 0
				};
				let dashboardFetchedAt;
				let dashboardLoading = false;
				let dashboardRequestedPath = WORKBUDDY_STATUS_PATH;
				/** Whether the dashboard is the CURRENT center panel (its mount owns this). */
				let quotaPanelOpen = false;
				const dashboardListeners = /* @__PURE__ */ new Set();
				/**
				* The observable source the dashboard reads through the inject face's
				* `hooks` compartment. The renderer caches an inject face ONCE per entry
				* and SPREADS it into props — a face getter is read exactly once and
				* frozen, which is why face-carried documents/activePath went stale. The
				* hooks channel survives: `bindInjectSources` converts each hooks member
				* into a `use<Name>` selector hook, and the hook reads the CURRENT
				* snapshot on every render (the same mechanism commandcode's usage store
				* rides).
				*
				* STABILITY CONTRACT: useSyncExternalStore requires getSnapshot() to
				* return the SAME reference between changes — a fresh object per call
				* re-renders forever and React kills the entry (error #185, the same
				* class of crash the settings card's unstable projection caused). So the
				* snapshot is a CACHED object, replaced wholesale by publish(); every
				* mutator builds the next snapshot and publishes exactly once.
				*/
				let dashboardSnap = {
					documents: [void 0, void 0],
					fetchedAt: void 0,
					loading: false,
					activePath: WORKBUDDY_STATUS_PATH
				};
				const rebuildSnapshot = () => {
					const next = {
						documents: [dashboardDocuments.cn, dashboardDocuments.ai],
						fetchedAt: dashboardFetchedAt,
						loading: dashboardLoading,
						activePath: dashboardRequestedPath
					};
					if (JSON.stringify(next) !== JSON.stringify(dashboardSnap)) {
						dashboardSnap = next;
						for (const listener of dashboardListeners) listener();
					}
				};
				const dashboardSource = {
					getSnapshot: () => dashboardSnap,
					subscribe: (listener) => {
						dashboardListeners.add(listener);
						return () => {
							dashboardListeners.delete(listener);
						};
					}
				};
				const notifyDashboard = () => {
					rebuildSnapshot();
				};
				/**
				* Refresh ONE variant's document (the one the panel is showing) — not
				* both. The earlier version fetched both routes on every panel mount, so
				* clicking the CN card also refreshed the AI card's data and timestamp;
				* the user ruled each click refreshes only what it shows.
				*
				* Freshness rule (also the user's): if the shared document for THIS
				* variant is newer than the configured interval, the fetch is SKIPPED —
				* a click shows the cached numbers instead of re-billing upstream. A
				* variant with NO result yet always fetches. A manual Refresh click
				* (force=true) bypasses the freshness check: an explicit user action
				* always re-reads.
				*/
				const refreshDashboard = async (options = {}) => {
					if (dashboardLoading) return;
					const variantId = variantOfStatusPath(dashboardRequestedPath);
					if (options.force !== true && quotaStatusIsFresh(variantId, quotaPollMs())) return;
					dashboardLoading = true;
					rebuildSnapshot();
					try {
						const result = await (variantId === "workbuddy" ? fetchStatusDocument(WORKBUDDY_STATUS_PATH) : fetchStatusDocument(WORKBUDDY_AI_STATUS_PATH));
						if (result !== void 0) noteQuotaStatus(variantId, result);
						dashboardFetchedAt = Date.now();
					} finally {
						dashboardLoading = false;
						rebuildSnapshot();
					}
				};
				let dashboardTimer;
				const startDashboardPoll = () => {
					if (dashboardTimer !== void 0) return;
					refreshDashboard();
					dashboardTimer = window.setInterval(() => {
						if (document.hidden) return;
						refreshDashboard();
					}, Math.max(6e4, quotaPollMs()));
				};
				const stopDashboardPoll = () => {
					if (dashboardTimer === void 0) return;
					window.clearInterval(dashboardTimer);
					dashboardTimer = void 0;
				};
				async function fetchStatusDocument(path) {
					try {
						const response = await fetch(path, { headers: { accept: "application/json" } });
						const body = await response.json();
						return response.ok && isWorkBuddyWebStatus(body) ? body : void 0;
					} catch {
						return;
					}
				}
				function QuotaDashboardWithLifecycle(props) {
					(0, react.useEffect)(() => {
						quotaPanelOpen = true;
						startDashboardPoll();
						return () => {
							quotaPanelOpen = false;
							stopDashboardPoll();
						};
					}, []);
					return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(QuotaDashboard, { ...props });
				}
				const panelFace = () => ({
					hooks: { quotaDashboard: dashboardSource },
					t,
					statusPaths: [WORKBUDDY_STATUS_PATH, WORKBUDDY_AI_STATUS_PATH],
					refresh: () => {
						refreshDashboard({ force: true });
					},
					onVariantPicked: (path) => {
						dashboardRequestedPath = path;
						notifyDashboard();
						refreshDashboard();
					},
					close: () => {
						const layout = ctx.get("layout");
						if (typeof layout?.selectPanel !== "function") return;
						try {
							layout.selectPanel(null);
						} catch {
							try {
								layout.selectPanel(CONVERSATION_PANEL_ID);
							} catch (error) {
								console.error("[dsh-workbuddy-connect] could not close the quota panel:", error);
							}
						}
					}
				});
				ctx.effect(() => injectQuotaCss(), "dsh-workbuddy-connect: quota styles");
				try {
					ctx.slots.inject("main", () => ctx.slots.register({
						name: "main",
						key: QUOTA_PANEL_ID,
						locale: "panel.workbuddy-quota",
						inject: panelFace
					}, QuotaDashboardWithLifecycle));
				} catch (error) {
					console.error("[dsh-workbuddy-connect] could not register the quota dashboard:", error);
				}
				ctx.inject(["layout"], (layoutCtx) => {
					if (typeof layoutCtx.get("layout")?.selectPanel !== "function") return;
					try {
						for (const variant of CARD_VARIANTS) {
							const statusPath = VARIANT_STATUS[variant.id];
							if (statusPath === void 0) continue;
							const injected = {
								t,
								statusPath,
								open: () => {
									const current = layoutCtx.get("layout");
									if (typeof current?.selectPanel !== "function") return;
									if (quotaPanelOpen && dashboardRequestedPath === statusPath) {
										current.selectPanel(null);
										return;
									}
									dashboardRequestedPath = statusPath;
									notifyDashboard();
									refreshDashboard();
									current.selectPanel(QUOTA_PANEL_ID);
								}
							};
							layoutCtx.slots.inject("sidebar.footer.action", () => layoutCtx.slots.register({
								name: "sidebar.footer.action",
								id: variant.id === "workbuddy" ? "workbuddy-quota" : "workbuddy-quota-ai",
								order: variant.id === "workbuddy" ? 20 : 21,
								locale: "panel.workbuddy-quota",
								inject: () => injected
							}, SidebarQuotaCard));
						}
					} catch (error) {
						console.error("[dsh-workbuddy-connect] could not register the sidebar footer card:", error);
					}
				});
				ctx.inject(["modelDirectories"], (scope) => {
					scope.slots.inject("conversation.input.right", () => scope.slots.register({
						name: "conversation.input.right",
						id: "workbuddy-probe",
						order: 10,
						inject: (sessionId) => ({
							directory: scope.modelDirectories.directoryFor(sessionId).store,
							t
						})
					}, WorkBuddyProbeControl));
				});
			} catch (error) {
				console.error("[dsh-workbuddy-connect] client card failed to load (host provider unaffected):", error);
			}
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
