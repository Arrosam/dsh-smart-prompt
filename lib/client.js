window.__ModuleLoader__.load({
	id: "dsh-smart-prompt",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		//#region src/command.ts
		/** `/name` — letters, digits, underscore, hyphen; the shape the composer claims. */
		const COMMAND_RE = /^(\s*)\/([A-Za-z0-9_][A-Za-z0-9_-]*)([ \t]*)([\s\S]*)$/;
		/** Only slashes: a command still being typed, or stray slashes after one. */
		const BARE_SLASHES_RE = /^\/+$/;
		/**
		* Split a draft into its command prefix and its body.
		*
		* A bare `/`, a command with no body, and a non-command draft all resolve to a body
		* of `''` or the whole text respectively, so callers can treat `body === ''` as
		* "nothing to enhance" without re-deriving the rule.
		*
		* @param draft - the raw composer text.
		* @returns the prefix, the command token, and the body.
		*/
		function splitCommand(draft) {
			const text = typeof draft === "string" ? draft : "";
			const match = COMMAND_RE.exec(text);
			if (match === null) {
				const bare = text.trim();
				if (BARE_SLASHES_RE.test(bare)) return {
					prefix: bare,
					command: bare,
					body: ""
				};
				return {
					prefix: "",
					command: "",
					body: bare
				};
			}
			const lead = match[1] ?? "";
			const name = match[2] ?? "";
			const gap = match[3] ?? "";
			const rest = match[4] ?? "";
			const restLead = /^\s*/.exec(rest)?.[0] ?? "";
			const body = rest.trim();
			if (body === "" || BARE_SLASHES_RE.test(body)) return {
				prefix: lead + "/" + name,
				command: "/" + name,
				body: ""
			};
			const separator = gap + restLead === "" ? " " : gap + restLead;
			return {
				prefix: lead + "/" + name + separator,
				command: "/" + name,
				body
			};
		}
		//#endregion
		//#region src/client/api.ts
		/** Base path the host mounts the plugin's routes under. */
		const API_BASE = "/dsh-smart-prompt/api/";
		/** Route names under {@link API_BASE}. */
		const ENDPOINT = Object.freeze({
			/** Refine a draft; may answer with follow-up questions instead of a result. */
			improve: "improve",
			/** Ask for more candidate answers (ideas) to one follow-up question. */
			stardea: "stardea",
			/** Answer (or skip) the follow-up questions; answers like `improve`. */
			answer: "answer",
			/** Drop a refine that waits for answers. */
			cancel: "cancel"
		});
		/**
		* POST one JSON body to a plugin route.
		*
		* @param endpoint - the route.
		* @param body - the request body, serialized as JSON.
		* @param signal - aborts the request.
		* @returns the parsed response body.
		* @throws on network failure, abort (see {@link isAbort}) or a body that is not JSON.
		*/
		async function postJson(endpoint, body, signal) {
			return await (await fetch(API_BASE + endpoint, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
				signal
			})).json();
		}
		/** Whether a rejected request was aborted through its signal. */
		function isAbort(error) {
			return error instanceof DOMException && error.name === "AbortError";
		}
		//#endregion
		//#region src/client/store.ts
		const states = /* @__PURE__ */ new Map();
		const listeners = /* @__PURE__ */ new Map();
		function fresh() {
			return {
				phase: "idle",
				backup: "",
				enhanced: "",
				meta: null,
				error: null,
				controller: null,
				actions: null,
				attachmentIds: [],
				serialize: null,
				doneBubbleOwner: null,
				ask: null
			};
		}
		/** State for one session, created on first use. */
		function storeFor(sessionId) {
			let state = states.get(sessionId);
			if (state === void 0) {
				state = fresh();
				states.set(sessionId, state);
			}
			return state;
		}
		/** Subscribe to changes for one session. */
		function subscribe(sessionId, listener) {
			let set = listeners.get(sessionId);
			if (set === void 0) {
				set = /* @__PURE__ */ new Set();
				listeners.set(sessionId, set);
			}
			set.add(listener);
			return () => {
				set?.delete(listener);
			};
		}
		/** Publish a change for one session. */
		function notify(sessionId) {
			const set = listeners.get(sessionId);
			if (set === void 0) return;
			for (const listener of set) try {
				listener();
			} catch {}
		}
		/**
		* Withdraw one session's follow-up panel, if open. Does not notify: every caller settles the
		* phase right after and notifies once for both changes.
		*
		* @param sessionId - the session whose panel goes.
		*/
		function closeAsk(sessionId) {
			const state = storeFor(sessionId);
			if (state.ask === null) return;
			state.ask.unpublish();
			state.ask.stardea.abort();
			state.ask = null;
		}
		/**
		* Reset one session to idle, dropping any stale Revert/Retry information.
		*
		* @param sessionId - the session to reset.
		* @param phase - the phase to land on.
		* @param error - message for the error phase.
		*/
		function clear(sessionId, phase = "idle", error = null) {
			const state = storeFor(sessionId);
			state.phase = phase;
			state.error = error;
			state.backup = "";
			state.enhanced = "";
			state.meta = null;
			state.controller = null;
			state.doneBubbleOwner = null;
			notify(sessionId);
		}
		//#endregion
		//#region src/client/refine.ts
		/**
		* The refine flow, as store transitions. A draft goes to the host; the reply either rewrites
		* the composer, fails, or opens the follow-up panel, whose answers continue the same refine.
		* The composer button, the status bubble and the panel all drive refines through these
		* functions, so each step has one implementation.
		*
		* @module dsh-smart-prompt/client/refine
		*/
		/** `kind` of the pending interaction the follow-up panel is published as. */
		const FOLLOW_UP_KIND = "dsh-smart-prompt-follow-up";
		/**
		* Set once the uiSession mount ran. Refines ask for follow-up questions only while it is set:
		* without it the panel could not be shown, and the host would wait for answers forever.
		*/
		let publisher = null;
		/**
		* Make follow-up questions possible.
		*
		* @param publish - the host's pending-interaction publisher.
		* @returns undoes it (refines started after that ask no questions).
		*/
		function providePublisher(publish) {
			publisher = publish;
			return () => {
				if (publisher === publish) publisher = null;
			};
		}
		/**
		* The interaction if it is this plugin's follow-up panel, else null (the composer-chain
		* selector: another domain's interaction leaves the seat to its own entry).
		*
		* @param value - a session's current pending interaction (any domain's).
		*/
		function asFollowUp(value) {
			if (typeof value !== "object" || value === null) return null;
			const { kind, key, sessionId } = value;
			return kind === "dsh-smart-prompt-follow-up" && typeof key === "string" && typeof sessionId === "string" ? value : null;
		}
		/**
		* Localized copy for a failure reply: the copy for its code, else the host's own message,
		* else the generic failure.
		*/
		function failureText(data, t) {
			const key = "err_" + (typeof data.code === "string" ? data.code : "UNKNOWN");
			const localized = t(key);
			if (localized !== key) return localized;
			return typeof data.message === "string" && data.message !== "" ? data.message : t("err_UNKNOWN");
		}
		/** Localized copy for a request that never got a reply. */
		function transportFailureText(error, t) {
			return isAbort(error) ? t("err_ABORTED") : t("err_UPSTREAM");
		}
		/** End the refine as failed. The draft is untouched; `backup` keeps the request's draft for Retry. */
		function fail(sessionId, message) {
			closeAsk(sessionId);
			const latest = storeFor(sessionId);
			latest.phase = "error";
			latest.error = message;
			latest.controller = null;
			notify(sessionId);
		}
		/** The follow-up questions of a reply, or null when it carries none (or a malformed set). */
		function parseAsk(value) {
			if (typeof value !== "object" || value === null) return null;
			const { runId, questions } = value;
			if (typeof runId !== "string" || runId === "" || !Array.isArray(questions)) return null;
			const valid = questions.flatMap((item) => {
				const question = item;
				return typeof question === "object" && question !== null && typeof question.id === "string" && typeof question.question === "string" ? [{
					id: question.id,
					question: question.question
				}] : [];
			});
			return valid.length > 0 ? {
				runId,
				questions: valid
			} : null;
		}
		/** The well-formed ideas of a `/stardea` reply. */
		function parseIdeas(value) {
			return value.flatMap((item) => {
				const idea = item;
				return typeof idea === "object" && idea !== null && typeof idea.id === "string" && typeof idea.text === "string" && idea.text !== "" ? [{
					id: idea.id,
					text: idea.text,
					source: typeof idea.source === "string" ? idea.source : ""
				}] : [];
			});
		}
		/** Tell the host to drop a waiting refine. The panel is gone either way, so the reply is not needed. */
		function postCancel(runId) {
			return postJson(ENDPOINT.cancel, { runId }).then(() => void 0, () => void 0);
		}
		/** Cancel the refine whose panel is open: the refine ends as cancelled, the draft untouched. */
		function cancelAsk(sessionId, t) {
			const run = storeFor(sessionId).ask;
			if (run === null) return Promise.resolve();
			fail(sessionId, t("err_ABORTED"));
			return postCancel(run.runId);
		}
		/** Show the follow-up panel for a refine the host keeps waiting until it is answered. */
		function openAsk(sessionId, reply, actions, t) {
			const publish = publisher;
			if (publish === null) {
				postCancel(reply.runId);
				fail(sessionId, t("err_ABORTED"));
				return;
			}
			const run = {
				runId: reply.runId,
				questions: reply.questions.map(({ id, question }) => ({
					id,
					question,
					ideas: [],
					selected: /* @__PURE__ */ new Set(),
					custom: "",
					pending: false,
					notice: null
				})),
				actions,
				stardea: new AbortController(),
				unpublish: () => {}
			};
			const state = storeFor(sessionId);
			state.ask = run;
			state.controller = null;
			try {
				run.unpublish = publish({
					kind: FOLLOW_UP_KIND,
					key: run.runId,
					sessionId
				}, () => storeFor(sessionId).ask === run ? cancelAsk(sessionId, t) : Promise.resolve());
			} catch (error) {
				console.error("[dsh-smart-prompt] follow-up panel could not be shown", error);
				cancelAsk(sessionId, t);
				return;
			}
			notify(sessionId);
		}
		/** Apply one refine reply: `/improve` and `/answer` answer in the same shapes. */
		function settle(sessionId, data, actions, t) {
			if (data.ok === true && typeof data.text === "string" && data.text !== "") {
				const latest = storeFor(sessionId);
				latest.enhanced = data.text;
				latest.meta = data.meta !== void 0 ? data.meta : null;
				latest.phase = "done";
				latest.controller = null;
				actions.setDraft(data.text);
				notify(sessionId);
				return;
			}
			const ask = data.ok === true ? parseAsk(data.ask) : null;
			if (ask !== null) openAsk(sessionId, ask, actions, t);
			else fail(sessionId, failureText(data, t));
		}
		/** Send one refine request and apply its reply; aborting `controller` cancels the refine. */
		async function send(sessionId, controller, endpoint, body, actions, t) {
			try {
				settle(sessionId, await postJson(endpoint, body, controller.signal), actions, t);
			} catch (error) {
				fail(sessionId, transportFailureText(error, t));
			}
		}
		/**
		* Send one draft to the host and write the result into the composer.
		*
		* Shared by the composer button and both Retries, so all follow the same state transitions:
		* busy -> done (draft replaced, `backup` keeps `text`), busy -> error (draft untouched), or
		* busy with the follow-up panel open, which continues the refine through {@link submitAsk}.
		* A slash-command draft with no body is ignored.
		*
		* @param sessionId - the session whose composer is rewritten.
		* @param text - the draft to enhance; becomes the Revert target.
		* @param actions - composer actions used to write the result.
		* @param t - localized copy lookup for failure messages.
		*/
		function runImprove(sessionId, text, actions, t) {
			if (splitCommand(text).body === "") return;
			const current = storeFor(sessionId);
			const controller = new AbortController();
			current.controller = controller;
			current.phase = "busy";
			current.error = null;
			current.backup = text;
			current.meta = null;
			current.enhanced = "";
			current.doneBubbleOwner = null;
			notify(sessionId);
			const attachmentIds = current.attachmentIds;
			const serialize = current.serialize;
			(async () => {
				let attachments = [];
				try {
					if (attachmentIds.length > 0 && serialize !== null) attachments = await serialize(attachmentIds);
				} catch {
					fail(sessionId, controller.signal.aborted ? t("err_ABORTED") : t("err_ATTACHMENTS"));
					return;
				}
				await send(sessionId, controller, ENDPOINT.improve, {
					sessionId,
					text,
					...attachments.length > 0 ? { attachments } : {},
					...publisher !== null ? { interactive: true } : {}
				}, actions, t);
			})();
		}
		/**
		* Cancel the session's running refine, whatever it waits on: the open panel's run through
		* `/cancel`, otherwise the request in flight. Both end with the cancelled failure bubble.
		*/
		function cancelRefine(sessionId, t) {
			const current = storeFor(sessionId);
			if (current.ask !== null) cancelAsk(sessionId, t);
			else if (current.controller !== null) current.controller.abort();
		}
		/** Every question's answer: its ticked idea texts (in list order) and own words; blank questions are left out. */
		function answersOf(run) {
			return run.questions.flatMap((question) => {
				const selected = question.ideas.filter((idea) => question.selected.has(idea.id)).map((idea) => idea.text);
				const custom = question.custom.trim();
				if (selected.length === 0 && custom === "") return [];
				return [{
					id: question.id,
					selected,
					...custom !== "" ? { custom } : {}
				}];
			});
		}
		/** Tick or untick one idea of an open question. */
		function toggleIdea(sessionId, question, ideaId) {
			if (!question.selected.delete(ideaId)) question.selected.add(ideaId);
			notify(sessionId);
		}
		/** Record the user's own words for an open question. */
		function setOwnWords(sessionId, question, text) {
			question.custom = text;
			notify(sessionId);
		}
		/** `/answer` with no answers: the host keeps the first rewrite. */
		const NO_ANSWERS = () => [];
		/** Close the panel and continue the refine with the chosen answers. */
		function sendAnswers(sessionId, pick, t) {
			const state = storeFor(sessionId);
			const run = state.ask;
			if (run === null) return;
			const answers = pick(run);
			closeAsk(sessionId);
			const controller = new AbortController();
			state.controller = controller;
			notify(sessionId);
			send(sessionId, controller, ENDPOINT.answer, {
				runId: run.runId,
				answers
			}, run.actions, t);
		}
		/** Submit the panel's answers. */
		function submitAsk(sessionId, t) {
			sendAnswers(sessionId, answersOf, t);
		}
		/** Skip every question; the refine keeps its first rewrite. */
		function skipAsk(sessionId, t) {
			sendAnswers(sessionId, NO_ANSWERS, t);
		}
		/**
		* Ask the host for more ideas for one open question and append them after the existing ones.
		* A failure, or a reply with nothing new, leaves a note under the question and keeps its ideas.
		*
		* @param sessionId - the session whose panel shows the question.
		* @param question - the question, as held by the open run.
		* @param t - localized copy lookup.
		*/
		async function requestIdeas(sessionId, question, t) {
			const run = storeFor(sessionId).ask;
			if (run === null || question.pending || !run.questions.includes(question)) return;
			question.pending = true;
			question.notice = null;
			notify(sessionId);
			let notice = null;
			try {
				const data = await postJson(ENDPOINT.stardea, {
					runId: run.runId,
					questionId: question.id
				}, run.stardea.signal);
				if (data.ok === true && Array.isArray(data.ideas)) {
					const known = new Set(question.ideas.map((idea) => idea.id));
					const before = question.ideas.length;
					for (const idea of parseIdeas(data.ideas)) {
						if (known.has(idea.id)) continue;
						known.add(idea.id);
						question.ideas.push(idea);
					}
					if (question.ideas.length === before) notice = {
						kind: "info",
						text: t("stardeaNoMore")
					};
				} else notice = {
					kind: "error",
					text: failureText(data, t)
				};
			} catch (error) {
				notice = {
					kind: "error",
					text: transportFailureText(error, t)
				};
			}
			question.pending = false;
			question.notice = notice;
			notify(sessionId);
		}
		//#endregion
		//#region src/client/components.ts
		/**
		* The visible pieces: the composer button (star, or Revert | Retry after a refine), the
		* status bar, and the follow-up panel that takes the composer seat while questions are open.
		*
		* @module dsh-smart-prompt/client/components
		*/
		/**
		* Keep a press on the chip from taking focus out of the composer.
		*
		* The host's Lexical setDraft() puts the caret at the end of the new text, but Lexical
		* only applies a selection to the DOM while its contenteditable has focus. A plain
		* button press moved focus onto the chip (and the refine then swaps the star for the
		* Revert | Retry capsule, unmounting the focused button), so the caret ended up outside
		* the input. The host's own toolbar buttons use the same mousedown preventDefault
		* (keepDraftFocus in dsh-client-ui-conversation); click and keyboard activation still work.
		*/
		const keepComposerFocus = (event) => {
			event.preventDefault();
		};
		/**
		* Stroke paths (12x12 grid) for the small line glyphs: a back-arrow for Revert, a circular
		* arrow for Retry, a cross for closing the follow-up panel.
		*/
		const STROKE_ICON_PATH = {
			revert: "M4.6 2.2L1.8 5L4.6 7.8M1.8 5H7.4A3 3 0 0 1 7.4 11H5.2",
			retry: "M10.2 6A4.2 4.2 0 1 1 8.6 2.7M8.9 0.9L9.2 3.2L6.9 3.6",
			close: "M3 3L9 9M9 3L3 9"
		};
		/** Small stroke glyph that inherits the label colour (capsule halves, panel close). */
		function StrokeIcon(className, kind) {
			return react.default.createElement("svg", {
				className,
				viewBox: "0 0 12 12",
				width: "12",
				height: "12",
				"aria-hidden": "true",
				focusable: "false"
			}, react.default.createElement("path", {
				d: STROKE_ICON_PATH[kind],
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.4",
				strokeLinecap: "round",
				strokeLinejoin: "round"
			}));
		}
		/**
		* One labelled capsule button (Revert, Retry, or the failure bubble's Retry). Every one
		* keeps the composer's focus on press.
		*/
		function capsuleButton(className, icon, title, label, onClick) {
			return react.default.createElement("button", {
				type: "button",
				className,
				title,
				onMouseDown: keepComposerFocus,
				onClick
			}, StrokeIcon("dip-capsule-icon", icon), label);
		}
		/** Four-point sparkle outline on a 16x16 grid, centred on (8, 8); the Stardea glyph reuses it. */
		const SPARKLE_PATH = "M8 1.2l1.35 3.9a2 2 0 001.25 1.25l3.9 1.35-3.9 1.35a2 2 0 00-1.25 1.25L8 14.8l-1.35-3.9a2 2 0 00-1.25-1.25L1.5 8.3l3.9-1.35A2 2 0 006.65 5.7L8 1.2z";
		/** Four-point sparkle, filled with the text colour so it follows the host theme. */
		function Sparkle() {
			return react.default.createElement("svg", {
				className: "dip-icon",
				viewBox: "0 0 16 16",
				"aria-hidden": "true",
				focusable: "false"
			}, react.default.createElement("path", {
				d: SPARKLE_PATH,
				fill: "currentColor"
			}));
		}
		/** Read the live draft, preferring the injected hook and falling back to a snapshot prop. */
		function readDraft(props) {
			if (typeof props.useInput === "function") {
				const value = props.useInput((state) => {
					const s = state;
					return s !== null && s !== void 0 && typeof s.draft === "string" ? s.draft : "";
				});
				if (typeof value === "string") return value;
			}
			const fallback = props.input !== void 0 ? props.input.draft : void 0;
			return typeof fallback === "string" ? fallback : "";
		}
		/** Stable empty list: a selector must not return a fresh array on every read. */
		const NO_ATTACHMENTS = Object.freeze([]);
		/** Read the composer's ordered attachment ids (empty on hosts whose input state has none). */
		function readAttachmentIds(props) {
			if (typeof props.useInput !== "function") return NO_ATTACHMENTS;
			const value = props.useInput((state) => {
				const ids = state?.attachmentIds;
				return Array.isArray(ids) ? ids : NO_ATTACHMENTS;
			});
			return Array.isArray(value) ? value : NO_ATTACHMENTS;
		}
		/** Force a re-render whenever this session's store entry changes. */
		function useSessionState(sessionId) {
			const [version, setVersion] = react.default.useState(0);
			react.default.useEffect(() => {
				if (sessionId === void 0) return void 0;
				return subscribe(sessionId, () => {
					setVersion((v) => v + 1);
				});
			}, [sessionId]);
			return version;
		}
		/**
		* Composer button: one click replaces the draft in place; a second click while
		* busy cancels. Disabled on an empty composer or a slash command. While the composer
		* still holds the refined text it renders as the Revert | Retry capsule instead.
		*/
		function ImproveButton(props) {
			const t = props.t;
			const sessionId = props.sessionId;
			useSessionState(sessionId);
			const draft = readDraft(props);
			const attachmentIds = readAttachmentIds(props);
			const split = splitCommand(draft);
			const commandOnly = split.command !== "" && split.body === "";
			const blocked = split.body === "";
			const state = sessionId !== void 0 ? storeFor(sessionId) : null;
			const busy = state !== null && state.phase === "busy";
			const actions = props.inputActions !== void 0 ? props.inputActions : state !== null ? state.actions : null;
			if (state !== null) {
				if (props.inputActions !== void 0 && state.actions !== props.inputActions) state.actions = props.inputActions;
				state.attachmentIds = attachmentIds;
				if (props.serializeAttachments !== void 0) state.serialize = props.serializeAttachments;
			}
			const onClick = react.default.useCallback(() => {
				if (sessionId === void 0 || actions === null) return;
				if (storeFor(sessionId).phase === "busy") {
					cancelRefine(sessionId, t);
					return;
				}
				runImprove(sessionId, draft, actions, t);
			}, [
				sessionId,
				actions,
				draft,
				t
			]);
			const title = busy ? t("buttonTitleBusy") : commandOnly ? t("commandOnlyTitle") : split.command !== "" ? t("buttonTitleCommand") : t("buttonTitle");
			const isDisabled = !busy && (blocked || actions === null);
			const refined = state !== null && !busy && state.phase === "done" && state.enhanced !== "" && draft === state.enhanced;
			const onRevert = react.default.useCallback(() => {
				if (sessionId === void 0) return;
				const backup = storeFor(sessionId).backup;
				clear(sessionId);
				if (actions !== null) actions.setDraft(backup);
			}, [sessionId, actions]);
			const onRetry = react.default.useCallback(() => {
				if (sessionId === void 0 || actions === null) return;
				runImprove(sessionId, storeFor(sessionId).backup, actions, t);
			}, [
				sessionId,
				actions,
				t
			]);
			if (refined) return react.default.createElement("div", {
				className: "dip-root",
				"data-refined": "true",
				role: "group"
			}, capsuleButton("dip-revert", "revert", t("revertTitle"), t("revert"), onRevert), react.default.createElement("span", {
				className: "dip-divider",
				"aria-hidden": "true"
			}), capsuleButton("dip-retry", "retry", t("retryTitle"), t("retry"), onRetry));
			return react.default.createElement("div", {
				className: "dip-root",
				"data-busy": busy ? "true" : "false"
			}, react.default.createElement("button", {
				type: "button",
				className: "dip-btn",
				onMouseDown: keepComposerFocus,
				disabled: isDisabled,
				"aria-label": t("buttonAria"),
				title,
				onClick
			}, Sparkle()));
		}
		/** Token use as `input(cached) - output`, e.g. `1200(3400) - 560`, in plain integers. */
		function tokenReport(usage) {
			return String(usage.input) + "(" + String(usage.cached) + ") - " + String(usage.output);
		}
		/** Human-readable certificate: "保真 12/12 · 1.4x · 2.1s · tokens 1200(3400) - 560". */
		function certificate(meta, t) {
			const parts = [];
			if (meta.anchors.total > 0) parts.push(t("fidelity") + " " + String(meta.anchors.kept) + "/" + String(meta.anchors.total));
			parts.push(meta.ratioLabel);
			parts.push((Math.round(meta.elapsedMs / 100) / 10).toFixed(1) + "s");
			if (meta.contextUsed !== "none") parts.push(t("contextTag"));
			if (meta.questions !== void 0 && meta.questions.answered > 0) parts.push(t("answeredTag") + " " + String(meta.questions.answered) + "/" + String(meta.questions.asked));
			if (meta.usage !== void 0) parts.push(t("tokens") + " " + tokenReport(meta.usage));
			return parts.join(" · ");
		}
		/** Exit duration of the status bubble; must match `dip-bar-out` in styles.ts. */
		const BUBBLE_EXIT_MS = 160;
		/** How long a success bubble stays before it hides. */
		const BUBBLE_DONE_MS = 8e3;
		/** How long a failure bubble stays before the session returns to idle. */
		const BUBBLE_ERROR_MS = 12e3;
		function sameBubble(a, b) {
			return a === b || a !== null && b !== null && a.kind === b.kind && a.text === b.text;
		}
		function bubbleFor(state, phase, hidden, t) {
			if (state === null || phase === "idle" || phase === "busy" || hidden) return null;
			if (phase === "error") return {
				kind: "error",
				text: state.error !== null ? state.error : t("err_UNKNOWN")
			};
			const meta = state.meta;
			const note = meta !== null && meta.note !== "" ? t("preserved") + " " + meta.note : "";
			return {
				kind: "done",
				text: t("done") + (meta !== null ? " · " + certificate(meta, t) : "") + (note !== "" ? " · " + note : "")
			};
		}
		/**
		* Status bar, rendered above the composer card. Reads the store directly,
		* so it needs no slot props beyond the session id.
		*/
		function StatusBar(props) {
			const { sessionId, t } = props;
			useSessionState(sessionId);
			const state = sessionId !== void 0 ? storeFor(sessionId) : null;
			const phase = state !== null ? state.phase : "idle";
			const token = state !== null ? [
				state.enhanced.length,
				state.error ?? "",
				state.meta !== null ? state.meta.elapsedMs : 0
			].join(":") : "";
			const [hiddenToken, setHiddenToken] = react.default.useState(null);
			react.default.useEffect(() => {
				if (sessionId === void 0) return void 0;
				if (phase !== "done" && phase !== "error") return void 0;
				const ms = phase === "done" ? BUBBLE_DONE_MS : BUBBLE_ERROR_MS;
				const timer = window.setTimeout(() => {
					if (phase === "done") setHiddenToken(token);
					else clear(sessionId);
				}, ms);
				return () => {
					window.clearTimeout(timer);
				};
			}, [
				sessionId,
				phase,
				token
			]);
			const claim = react.default.useRef({
				sessionId,
				token: {}
			});
			if (claim.current.sessionId !== sessionId) claim.current = {
				sessionId,
				token: {}
			};
			const self = claim.current.token;
			const claimable = state !== null && phase === "done" && state.doneBubbleOwner === null;
			react.default.useEffect(() => {
				if (claimable && state !== null) state.doneBubbleOwner = self;
			}, [
				claimable,
				state,
				self
			]);
			const doneHidden = hiddenToken === token || state !== null && state.doneBubbleOwner !== null && state.doneBubbleOwner !== self;
			const bubble = bubbleFor(state, phase, phase === "done" && doneHidden, t);
			const [shown, setShown] = react.default.useState(null);
			const [leaving, setLeaving] = react.default.useState(null);
			if (!sameBubble(bubble, shown)) {
				setLeaving(bubble === null ? shown : null);
				setShown(bubble);
			}
			react.default.useEffect(() => {
				if (leaving === null) return void 0;
				const timer = window.setTimeout(() => {
					setLeaving(null);
				}, BUBBLE_EXIT_MS);
				return () => {
					window.clearTimeout(timer);
				};
			}, [leaving]);
			const onRetry = react.default.useCallback((event) => {
				event.stopPropagation();
				if (sessionId === void 0) return;
				const current = storeFor(sessionId);
				if (current.phase !== "error" || current.actions === null) return;
				runImprove(sessionId, current.backup, current.actions, t);
			}, [sessionId, t]);
			const visible = bubble ?? leaving;
			if (visible === null) return null;
			const canRetry = visible.kind === "error" && state !== null && state.actions !== null && splitCommand(state.backup).body !== "";
			return react.default.createElement("div", {
				className: "dip-bar",
				"data-kind": visible.kind,
				"data-state": bubble === null ? "leaving" : "entering"
			}, react.default.createElement("span", { className: "dip-bar-text" }, visible.text), canRetry ? capsuleButton("dip-bar-retry", "retry", t("retryFailedTitle"), t("retry"), onRetry) : null);
		}
		//#endregion
		//#region src/client/follow-up.ts
		/**
		* The follow-up panel: while a refine waits for answers it takes the composer seat (a
		* `conversation.composer` chain entry), shows the draft being refined, and lets the user
		* answer each question with Stardea ideas, own words, or both.
		*
		* Everything it shows lives in the session store (see `AskRun`); the panel only renders it
		* and forwards the user's actions to the refine flow.
		*
		* @module dsh-smart-prompt/client/follow-up
		*/
		/** Locale key of each idea source's tag; an idea from an unknown source shows no tag. */
		const SOURCE_TAG_KEY = Object.freeze({
			web: "sourceWeb",
			conversation: "sourceConversation",
			proposal: "sourceProposal"
		});
		/** Short burst rays (16x16 grid) on the diagonals between the Stardea star's four points. */
		const STARDEA_RAYS_PATH = "M12.2 3.8L13.6 2.4M3.8 3.8L2.4 2.4M12.2 12.2L13.6 13.6M3.8 12.2L2.4 13.6";
		/** Shrinks the composer sparkle about its centre so the rays fit around it. */
		const STARDEA_STAR_TRANSFORM = "translate(8 8) scale(.68) translate(-8 -8)";
		/**
		* The Stardea glyph: a four-point star with burst rays. `pops` counts clicks: a new count
		* remounts the svg, which replays the pop/burst animation in styles.ts once per click.
		* The star sits in its own group because the animation's CSS transform would otherwise
		* replace the path's shrinking transform.
		*/
		function StardeaGlyph(pops) {
			return react.default.createElement("svg", {
				key: pops,
				className: "dip-stardea-glyph",
				viewBox: "0 0 16 16",
				"data-pop": pops > 0 ? "true" : "false",
				"aria-hidden": "true",
				focusable: "false"
			}, react.default.createElement("g", { className: "dip-stardea-star" }, react.default.createElement("path", {
				d: SPARKLE_PATH,
				transform: STARDEA_STAR_TRANSFORM,
				fill: "currentColor"
			})), react.default.createElement("path", {
				className: "dip-stardea-rays",
				d: STARDEA_RAYS_PATH,
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.4",
				strokeLinecap: "round"
			}));
		}
		/** The Stardea button of one question; busy (and disabled) while its request runs. */
		function StardeaButton(props) {
			const { busy, t } = props;
			const [pops, setPops] = react.default.useState(0);
			const onClick = () => {
				setPops((count) => count + 1);
				props.onClick();
			};
			return react.default.createElement("button", {
				type: "button",
				className: "dip-stardea",
				"aria-label": t("stardeaAria"),
				title: t("stardeaAria"),
				"data-busy": busy ? "true" : "false",
				disabled: busy,
				onClick
			}, StardeaGlyph(pops), react.default.createElement("span", { className: "dip-stardea-label" }, t("stardea")));
		}
		/** One idea as a checkbox; ticking it adds the idea's text to the question's answer. */
		function IdeaOption(sessionId, question, idea, t) {
			const tagKey = Object.hasOwn(SOURCE_TAG_KEY, idea.source) ? SOURCE_TAG_KEY[idea.source] : void 0;
			return react.default.createElement("label", {
				key: idea.id,
				className: "dip-idea"
			}, react.default.createElement("input", {
				type: "checkbox",
				className: "dip-idea-check",
				checked: question.selected.has(idea.id),
				onChange: () => {
					toggleIdea(sessionId, question, idea.id);
				}
			}), react.default.createElement("span", { className: "dip-idea-text" }, idea.text), tagKey !== void 0 ? react.default.createElement("span", {
				className: "dip-idea-source",
				"data-source": idea.source
			}, t(tagKey)) : null);
		}
		/** One question: its text, the Stardea button, its ideas, the last Stardea note, and own words. */
		function QuestionBlock(props) {
			const { sessionId, question, t } = props;
			const textId = react.default.useId();
			const notice = question.notice;
			return react.default.createElement("div", {
				className: "dip-ask-q",
				role: "group",
				"aria-labelledby": textId
			}, react.default.createElement("div", { className: "dip-ask-q-head" }, react.default.createElement("p", {
				className: "dip-ask-q-text",
				id: textId
			}, question.question), react.default.createElement(StardeaButton, {
				busy: question.pending,
				t,
				onClick: () => {
					requestIdeas(sessionId, question, t);
				}
			})), question.ideas.length > 0 ? react.default.createElement("div", { className: "dip-ideas" }, question.ideas.map((idea) => IdeaOption(sessionId, question, idea, t))) : null, notice !== null ? react.default.createElement("p", {
				className: "dip-ask-error",
				"data-kind": notice.kind,
				role: notice.kind === "error" ? "alert" : "status"
			}, notice.text) : null, react.default.createElement("textarea", {
				className: "dip-ask-own",
				rows: 2,
				placeholder: t("askOwnWords"),
				"aria-label": t("askOwnWords"),
				"aria-describedby": textId,
				value: question.custom,
				onChange: (event) => {
					setOwnWords(sessionId, question, event.target.value);
				}
			}));
		}
		/**
		* The composer-chain entry. Renders only for this plugin's interaction and only while the
		* session's open run is the one the interaction names; anything else renders nothing.
		*
		* @param props - the chain's props: `matched` is the interaction the entry's selector returned.
		*/
		function FollowUpPanel(props) {
			const { t } = props;
			const interaction = asFollowUp(props.matched);
			useSessionState(interaction?.sessionId);
			const titleId = react.default.useId();
			const originalId = react.default.useId();
			const card = react.default.useRef(null);
			react.default.useEffect(() => {
				const node = card.current;
				if (node === null || typeof document === "undefined") return;
				const active = document.activeElement;
				if (active === null || active === document.body || active.getClientRects().length === 0) node.focus();
			}, [interaction?.key]);
			if (interaction === null) return null;
			const { sessionId } = interaction;
			const state = storeFor(sessionId);
			const run = state.ask;
			if (run === null || run.runId !== interaction.key) return null;
			return react.default.createElement("div", { className: "dip-ask" }, react.default.createElement("section", {
				ref: card,
				className: "dip-ask-card",
				"aria-labelledby": titleId,
				tabIndex: -1
			}, react.default.createElement("header", { className: "dip-ask-head" }, react.default.createElement("h2", {
				className: "dip-ask-title",
				id: titleId
			}, t("askTitle")), react.default.createElement("button", {
				type: "button",
				className: "dip-ask-close",
				"aria-label": t("askCancel"),
				title: t("askCancel"),
				onClick: () => {
					cancelRefine(sessionId, t);
				}
			}, StrokeIcon("dip-ask-close-icon", "close"))), react.default.createElement("div", { className: "dip-ask-body" }, react.default.createElement("div", {
				className: "dip-ask-label",
				id: originalId
			}, t("askOriginal")), react.default.createElement("div", {
				className: "dip-ask-original",
				role: "region",
				"aria-labelledby": originalId,
				tabIndex: 0
			}, state.backup), run.questions.map((question) => react.default.createElement(QuestionBlock, {
				key: question.id,
				sessionId,
				question,
				t
			}))), react.default.createElement("footer", { className: "dip-ask-foot" }, react.default.createElement("button", {
				type: "button",
				className: "dip-ask-btn dip-ask-skip",
				onClick: () => {
					skipAsk(sessionId, t);
				}
			}, t("askSkip")), react.default.createElement("button", {
				type: "button",
				className: "dip-ask-btn dip-ask-submit",
				onClick: () => {
					submitAsk(sessionId, t);
				}
			}, t("askSubmit")))));
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* Client-side copy (zh / en) registered through the harness locale service.
		* Host errors carry stable codes; the codes are translated here so the message
		* matches the interface language rather than the host's.
		*
		* @module dsh-smart-prompt/client/locales
		*/
		/** Locale namespace. */
		const NS = "dsh-smart-prompt";
		const zh = {
			buttonAria: "把草稿改写为更清晰、更贴 Agent 执行的提示词",
			buttonTitle: "一键增强提示词（直接替换，可撤回）",
			buttonTitleBusy: "正在增强…点击取消",
			buttonTitleCommand: "一键增强提示词（保留斜杠命令前缀，只改写正文）",
			commandOnlyTitle: "斜杠命令后还没有正文，无可改写内容",
			modeLight: "轻",
			modeStandard: "标准",
			modeDetailed: "详细模式",
			modeLightHint: "轻档：只去废话、消歧义，几乎不改结构",
			modeStandardHint: "标准档：结构化重述，让 Agent 能直接执行",
			modeDetailedHint: "详细模式：写清下一步、执行注意事项和每个细节的标准，让 Agent 无需再猜",
			revert: "撤回",
			revertTitle: "恢复增强前的原文",
			retry: "重试",
			retryTitle: "基于原文重新生成增强结果",
			retryFailedTitle: "重新发送这次请求（沿用已回答的追问）",
			settingsMode: "改写方式",
			settingsModel: "改写所用模型",
			settingsModelConversation: "会话中的模型",
			settingsModelDedicated: "指定模型",
			settingsModelConversationHint: "使用当前会话选择的模型；会话未选时用默认模型",
			settingsModelDedicatedHint: "始终使用下面选择的模型，与会话无关",
			settingsPickModel: "模型",
			settingsChooseModel: "选择一个模型",
			settingsLoadingModels: "正在加载模型…",
			settingsUnavailableModel: "当前不可用",
			settingsPickModelRequired: "请选择一个模型后再保存",
			settingsEffort: "思考强度",
			settingsEffortDefault: "模型默认",
			settingsCatalogError: "模型列表加载失败。",
			settingsRetry: "重试",
			settingsUnavailable: "当前环境不提供本插件的设置",
			settingsReadOnly: "设置为只读，无法在此修改",
			settingsSaveFailed: "保存未成功",
			settingsSave: "保存",
			settingsSaving: "正在保存…",
			settingsMaxQuestions: "追问数量上限",
			settingsMaxQuestionsHint: "信息不足时，最多向你追问几个问题",
			settingsLookupRounds: "会话检索轮数",
			settingsLookupRoundsHint: "改写时信息不足，最多检索和读取会话记录几轮（0–10）；0 表示关闭",
			settingsStardeaIdeas: "星念每次想法数",
			settingsStardeaIdeasHint: "每点一次星念，最多给出几个新想法（1–8）",
			settingsStardeaRounds: "星念检索轮数",
			settingsStardeaRoundsHint: "每点一次星念，最多检索几轮（0–10）；0 表示不检索，只直接给建议",
			settingsStardeaWeb: "星念联网搜索",
			settingsStardeaWebHint: "允许星念用 DSH 的网络搜索找想法；需要检索轮数大于 0，且 DSH 已配置网络搜索",
			answeredTag: "已补充",
			done: "已增强",
			canceled: "已取消，原文未改动",
			fidelity: "保真",
			contextTag: "已参考会话",
			preserved: "已回灌",
			tokens: "Token",
			askTitle: "补充几个信息，让提示词更准确",
			askOriginal: "你的原文",
			askOwnWords: "用自己的话回答（可选）",
			askSkip: "跳过",
			askSubmit: "提交",
			askCancel: "取消这次增强",
			stardea: "星念",
			stardeaAria: "星念：为这个问题想几个候选答案",
			stardeaNoMore: "没有新的想法了，可再点一次",
			sourceWeb: "网络",
			sourceConversation: "会话",
			sourceProposal: "建议",
			err_EMPTY: "输入框为空",
			err_COMMAND: "斜杠命令后没有可改写的正文",
			err_TOO_LONG: "草稿过长",
			err_ATTACHMENTS: "附件还没准备好（文件可能仍在上传），请稍后再试",
			err_BAD_BODY: "请求格式错误",
			err_NO_ROUTE: "未找到可用模型：请先在设置里选默认模型",
			err_TIMEOUT: "增强超时，原文未改动",
			err_ABORTED: "已取消，原文未改动",
			err_EMPTY_OUTPUT: "模型没有返回内容，原文未改动",
			err_TOOL_CALL: "模型返回了工具调用而非提示词，原文未改动",
			err_LENGTH_EXCEEDED: "增强结果超出长度上限，已保留原文（可切「轻」档或调高上限）",
			err_UPSTREAM: "模型调用失败，原文未改动",
			err_NO_RUN: "这次改写已结束，请重新点击增强",
			err_UNKNOWN: "增强失败，原文未改动"
		};
		const en = {
			buttonAria: "Rewrite the draft into a sharper, agent-ready prompt",
			buttonTitle: "Improve prompt (replaces in place, undoable)",
			buttonTitleBusy: "Improving… click to cancel",
			buttonTitleCommand: "Improve prompt (keeps the slash-command prefix, rewrites only the body)",
			commandOnlyTitle: "Nothing to rewrite yet — this is only a slash command",
			modeLight: "Light",
			modeStandard: "Standard",
			modeDetailed: "Detailed",
			modeLightHint: "Light: remove filler and ambiguity, keep the structure",
			modeStandardHint: "Standard: restructure so an agent can execute it directly",
			modeDetailedHint: "Detailed: spell out the next steps, cautions and the standard for every detail so the agent never has to guess",
			revert: "Revert",
			revertTitle: "Restore the draft from before the enhancement",
			retry: "Retry",
			retryTitle: "Regenerate the improved prompt from the original draft",
			retryFailedTitle: "Send this request again (keeps your answers to the follow-up questions)",
			settingsMode: "Improvement method",
			settingsModel: "Model used to improve prompts",
			settingsModelConversation: "Conversation model",
			settingsModelDedicated: "Dedicated model",
			settingsModelConversationHint: "Uses the model selected in the conversation, or the default model if none is selected",
			settingsModelDedicatedHint: "Always uses the model chosen below, whatever the conversation uses",
			settingsPickModel: "Model",
			settingsChooseModel: "Choose a model",
			settingsLoadingModels: "Loading models…",
			settingsUnavailableModel: "unavailable",
			settingsPickModelRequired: "Choose a model before saving",
			settingsEffort: "Reasoning effort",
			settingsEffortDefault: "Model default",
			settingsCatalogError: "Couldn't load the model list.",
			settingsRetry: "Retry",
			settingsUnavailable: "Settings for this plugin are not available here",
			settingsReadOnly: "Settings are read-only here",
			settingsSaveFailed: "Couldn't save",
			settingsSave: "Save",
			settingsSaving: "Saving…",
			settingsMaxQuestions: "Follow-up questions",
			settingsMaxQuestionsHint: "Most questions to ask you when the draft is missing information",
			settingsLookupRounds: "Session lookup rounds",
			settingsLookupRoundsHint: "Most rounds of searching and reading this session while rewriting a draft that is missing information (0–10); 0 turns it off",
			settingsStardeaIdeas: "Stardea ideas per click",
			settingsStardeaIdeasHint: "Most new ideas each Stardea click suggests (1–8)",
			settingsStardeaRounds: "Stardea search rounds",
			settingsStardeaRoundsHint: "Most search rounds per Stardea click (0–10); 0 suggests ideas without searching",
			settingsStardeaWeb: "Stardea web search",
			settingsStardeaWebHint: "Lets Stardea search the web with DSH's web search; needs search rounds above 0 and a web search provider in DSH",
			answeredTag: "answered",
			done: "Improved",
			canceled: "Cancelled — draft untouched",
			fidelity: "fidelity",
			contextTag: "context used",
			preserved: "re-appended",
			tokens: "tokens",
			askTitle: "A few details would make this prompt sharper",
			askOriginal: "Your draft",
			askOwnWords: "Answer in your own words (optional)",
			askSkip: "Skip",
			askSubmit: "Submit",
			askCancel: "Cancel this improvement",
			stardea: "Stardea",
			stardeaAria: "Stardea: suggest candidate answers to this question",
			stardeaNoMore: "No new ideas this time — try again",
			sourceWeb: "web",
			sourceConversation: "conversation",
			sourceProposal: "proposal",
			err_EMPTY: "The composer is empty",
			err_COMMAND: "A slash command with no body has nothing to rewrite",
			err_TOO_LONG: "Draft is too long",
			err_ATTACHMENTS: "The attachments are not ready yet (a file may still be uploading); try again shortly",
			err_BAD_BODY: "Malformed request",
			err_NO_ROUTE: "No model available — pick a default model in settings first",
			err_TIMEOUT: "Enhancement timed out — draft untouched",
			err_ABORTED: "Cancelled — draft untouched",
			err_EMPTY_OUTPUT: "The model returned nothing — draft untouched",
			err_TOOL_CALL: "The model returned a tool call instead of a prompt — draft untouched",
			err_LENGTH_EXCEEDED: "Result exceeded the length ceiling — draft kept (try Light mode or raise the ceiling)",
			err_UPSTREAM: "Model call failed — draft untouched",
			err_NO_RUN: "This refinement has ended — click improve again",
			err_UNKNOWN: "Enhancement failed — draft untouched"
		};
		//#endregion
		//#region src/client/styles.ts
		/**
		* Plugin-owned CSS, scoped by a data attribute and torn down with the fiber.
		*
		* ## Material: a plain capsule in the host's own design tokens
		*
		* The button is a single-purpose control (click = improve), so it carries no mode
		* switch, hover expansion, glow or animated light. It reuses the host's `--dsw-alias-*`
		* tokens (border, label, hover background — the same ones the composer toolbar uses)
		* so it follows the page in both themes. The Revert | Retry capsule shares the plate.
		*
		* `.dip-root` — the capsule (border + radius)
		*   `.dip-btn`     — the improve action; sparkle icon in `currentColor`
		*   `.dip-revert` / `.dip-divider` / `.dip-retry` — the refined state's two halves
		*
		* `.dip-ask` — the follow-up panel in the composer seat, framed like the host's own
		* question card (same seat padding, card radius, surface and elevation tokens)
		*   `.dip-ask-original` — the draft being refined, read-only and scrollable
		*   `.dip-ask-q` — one question: `.dip-stardea` (pop/burst on click), `.dip-idea` checkboxes,
		*   `.dip-ask-error` (last Stardea note), `.dip-ask-own` (own words)
		*
		* @module dsh-smart-prompt/client/styles
		*/
		const STYLE_ATTR = "dsh-smart-prompt";
		/** Hover/press fill for every half of the capsule: the host's interactive hover token. */
		const HOVER_BG = "var(--dsw-alias-interactive-bg-hover)";
		/** Keyboard focus ring: the host's primary business colour. */
		const FOCUS_RING = "inset 0 0 0 2px var(--dsw-alias-state-business-primary)";
		/** Submit: the host's primary button fill and its foreground label colour. */
		const PRIMARY_FILL = "var(--dsw-alias-button-primary-fill,var(--dsw-alias-state-business-primary))";
		const PRIMARY_LABEL = "var(--dsw-alias-label-primary-foreground,#fff)";
		/** Length of one Stardea pop/burst; short enough to never delay reading the new ideas. */
		const STARDEA_POP = "420ms cubic-bezier(.2,.8,.2,1) both";
		const css = [
			".dip-root{position:relative;display:inline-flex;align-items:stretch;height:30px;box-sizing:border-box;",
			"border:1px solid var(--dsw-alias-border-l2);border-radius:999px;overflow:hidden;user-select:none;",
			"vertical-align:middle;flex:none;background:transparent;color:var(--dsw-alias-label-secondary)}",
			".dip-btn,.dip-revert,.dip-retry{display:inline-flex;align-items:center;justify-content:center;gap:5px;",
			"height:100%;box-sizing:border-box;border:0;outline:none;background:transparent;color:inherit;cursor:pointer;",
			"font:inherit;font-size:12px;line-height:1;white-space:nowrap;transition:background-color .15s,color .15s}",
			".dip-btn{padding:0 12px}",
			".dip-revert,.dip-retry{padding:0 10px}",
			".dip-btn:hover:not(:disabled),.dip-revert:hover,.dip-retry:hover{background:" + HOVER_BG + ";color:var(--dsw-alias-label-primary)}",
			".dip-btn:focus-visible,.dip-revert:focus-visible,.dip-retry:focus-visible{box-shadow:" + FOCUS_RING + "}",
			".dip-btn:disabled{cursor:default;color:var(--dsw-alias-label-tertiary)}",
			".dip-icon{width:14px;height:14px;flex:none;display:block}",
			".dip-capsule-icon{display:block;flex:none}",
			".dip-root[data-busy=\"true\"] .dip-btn{cursor:progress;color:var(--dsw-alias-state-business-primary)}",
			".dip-root[data-busy=\"true\"] .dip-icon{animation:dip-icon-spin .8s linear infinite}",
			".dip-divider{width:1px;align-self:stretch;margin:7px 0;background:var(--dsw-alias-border-l2);pointer-events:none}",
			".dip-bar{position:absolute;left:0;right:0;bottom:var(--dsh-composer-stack-gap,6px);width:fit-content;margin:0 auto;display:flex;align-items:center;gap:8px;",
			"max-width:100%;box-sizing:border-box;padding:5px 10px;",
			"border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-base));",
			"font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);box-shadow:var(--dsw-shadow-lv3,0 4px 14px rgba(0,0,0,.18))}",
			".dip-bar[data-state=\"entering\"]{animation:dip-bar-in 200ms cubic-bezier(.2,.8,.2,1) both}",
			".dip-bar[data-state=\"leaving\"]{animation:dip-bar-out 160ms ease-in both;pointer-events:none}",
			".dip-bar[data-kind=\"error\"]{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 50%,transparent);color:var(--dsw-alias-label-primary)}",
			".dip-bar-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".dip-sep{opacity:.4}",
			".dip-bar-retry{display:inline-flex;align-items:center;gap:4px;flex:none;height:22px;padding:0 8px;box-sizing:border-box;",
			"border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);",
			"font:inherit;font-size:12px;line-height:1;white-space:nowrap;cursor:pointer;outline:none;transition:background-color .15s,color .15s}",
			".dip-bar-retry:hover{background:" + HOVER_BG + ";color:var(--dsw-alias-label-primary)}",
			".dip-bar-retry:focus-visible{box-shadow:" + FOCUS_RING + "}",
			".dip-set-row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:12px 0}",
			".dip-set-row+.dip-set-row{border-top:.5px solid var(--dsw-alias-border-l2)}",
			".dip-set-text{flex:1;min-width:0}",
			".dip-set-label{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}",
			".dip-set-hint{margin:2px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}",
			".dip-set-control{flex:none}",
			".dip-set-dedicated{display:grid;gap:10px;padding:0 0 12px}",
			".dip-set-field{display:grid;gap:4px}",
			".dip-set-select,.dip-set-number{height:32px;padding:0 8px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);",
			"background:var(--dsw-alias-bg-base);border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md)}",
			".dip-set-number{width:72px}",
			".dip-set-number[aria-invalid=\"true\"]{border-color:var(--dsw-alias-state-error-primary)}",
			".dip-set-error{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-state-error-primary)}",
			".dip-set-link{padding:0;border:0;background:0 0;font:inherit;color:var(--dsw-alias-state-business-primary);cursor:pointer}",
			".dip-ask{display:flex;justify-content:center;padding:6px calc(var(--dsh-composer-side-clearance,16px) + 16px) 10px}",
			".dip-ask-card{width:100%;max-width:var(--dsh-chat-content-width,100%);max-height:min(60vh,520px);display:flex;flex-direction:column;",
			"box-sizing:border-box;overflow:hidden;outline:none;border-radius:var(--dsw-radius-xl,16px);background:var(--dsw-specific-input-major,var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-base)));box-shadow:var(--dsw-elevation-panel,var(--dsw-shadow-lv3,0 4px 14px rgba(0,0,0,.18)));",
			"color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}",
			".dip-ask-card *{box-sizing:border-box}",
			".dip-ask-head{flex:none;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:16px 16px 8px 20px}",
			".dip-ask-title{margin:0;font-size:15px;font-weight:500;line-height:22px}",
			".dip-ask-close{flex:none;display:grid;place-items:center;width:24px;height:24px;padding:0;border:0;border-radius:999px;outline:none;",
			"background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}",
			".dip-ask-close:hover{background:" + HOVER_BG + ";color:var(--dsw-alias-label-primary)}",
			".dip-ask-close-icon{display:block}",
			".dip-ask-body{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:12px;padding:0 20px 4px}",
			".dip-ask-label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
			".dip-ask-original{flex:none;max-height:110px;overflow-y:auto;margin-top:-8px;padding:8px 12px;white-space:pre-wrap;overflow-wrap:anywhere;",
			"font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-base);",
			"border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);outline:none}",
			".dip-ask-q{flex:none;display:flex;flex-direction:column;gap:6px;padding-top:12px;border-top:.5px solid var(--dsw-alias-border-l2)}",
			".dip-ask-q-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}",
			".dip-ask-q-text{margin:0;flex:1;min-width:0;font-weight:500;overflow-wrap:anywhere}",
			".dip-ideas{display:flex;flex-direction:column;gap:1px}",
			".dip-idea{display:flex;align-items:flex-start;gap:8px;padding:6px 8px;border-radius:var(--dsw-radius-md);cursor:pointer;transition:background-color .12s}",
			".dip-idea:hover{background:" + HOVER_BG + "}",
			".dip-idea-check{flex:none;width:14px;height:14px;margin:4px 0 0;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}",
			".dip-idea-text{flex:1;min-width:0;overflow-wrap:anywhere}",
			".dip-idea-source{flex:none;padding:0 6px;border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;",
			"font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}",
			".dip-ask-error{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
			".dip-ask-error[data-kind=\"error\"]{color:var(--dsw-alias-state-error-primary)}",
			".dip-ask-own{display:block;width:100%;min-height:44px;resize:vertical;padding:8px 12px;font:inherit;font-size:14px;line-height:22px;",
			"color:var(--dsw-alias-label-primary);caret-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-bg-base);",
			"border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);outline:none}",
			".dip-ask-own::placeholder{color:var(--dsw-alias-label-tertiary)}",
			".dip-ask-own:focus{border-color:var(--dsw-alias-state-business-primary)}",
			".dip-ask-foot{flex:none;display:flex;justify-content:flex-end;gap:8px;padding:10px 16px 14px}",
			".dip-ask-btn{height:30px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;outline:none;",
			"background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:1;cursor:pointer;transition:background-color .15s,color .15s}",
			".dip-ask-skip:hover{background:" + HOVER_BG + ";color:var(--dsw-alias-label-primary)}",
			".dip-ask-submit{border-color:transparent;background:" + PRIMARY_FILL + ";color:" + PRIMARY_LABEL + ";font-weight:500}",
			".dip-ask-submit:hover{background:var(--dsw-alias-button-primary-hover," + PRIMARY_FILL + ")}",
			".dip-ask-close:focus-visible,.dip-ask-btn:focus-visible,.dip-stardea:focus-visible{box-shadow:" + FOCUS_RING + "}",
			".dip-ask-original:focus-visible,.dip-idea-check:focus-visible,.dip-ask-card:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}",
			".dip-ask-card:focus-visible{outline-offset:-2px}",
			".dip-stardea{flex:none;display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 10px 0 8px;box-sizing:border-box;",
			"border:1px solid var(--dsw-alias-border-l2);border-radius:999px;outline:none;background:transparent;",
			"color:var(--dsw-alias-state-business-primary);font:inherit;font-size:12px;line-height:1;white-space:nowrap;cursor:pointer;transition:background-color .15s}",
			".dip-stardea:hover:not(:disabled){background:" + HOVER_BG + "}",
			".dip-stardea:disabled{cursor:progress}",
			".dip-stardea-glyph{width:16px;height:16px;flex:none;display:block;overflow:visible}",
			".dip-stardea-star,.dip-stardea-rays{transform-origin:8px 8px}",
			".dip-stardea-glyph[data-pop=\"true\"] .dip-stardea-star{animation:dip-stardea-pop " + STARDEA_POP + "}",
			".dip-stardea-glyph[data-pop=\"true\"] .dip-stardea-rays{animation:dip-stardea-burst " + STARDEA_POP + "}",
			".dip-stardea[data-busy=\"true\"] .dip-stardea-glyph{animation:dip-icon-spin .8s linear infinite}",
			"@keyframes dip-icon-spin{to{transform:rotate(360deg)}}",
			"@keyframes dip-bar-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}",
			"@keyframes dip-bar-out{from{opacity:1;transform:none}to{opacity:0;transform:translateY(6px)}}",
			"@keyframes dip-stardea-pop{0%{transform:scale(.6)}45%{transform:scale(1.3)}100%{transform:scale(1)}}",
			"@keyframes dip-stardea-burst{0%{opacity:0;transform:scale(.4)}45%{opacity:1;transform:scale(1.35)}100%{opacity:1;transform:scale(1)}}",
			"@media (prefers-reduced-motion: reduce){",
			".dip-icon,.dip-btn,.dip-revert,.dip-retry,.dip-bar,.dip-bar-retry,.dip-idea,.dip-ask-btn,.dip-stardea,",
			".dip-stardea-glyph,.dip-stardea-star,.dip-stardea-rays{animation:none!important;transition-duration:.01ms!important}",
			"}"
		].join("\n");
		//#endregion
		//#region src/settings-fields.ts
		/**
		* The settings-page fields' closed value sets, defaults and bounds.
		*
		* Pure data with no host imports, so both halves read the same values: the host Config
		* schema and resolver (config.ts) and the browser settings section (client/settings.ts),
		* which validates before Save and must agree with what the schema accepts.
		*
		* @module dsh-smart-prompt/settings-fields
		*/
		/**
		* Settings-page mode choices, in display order. `detailed` is `standard` with a different
		* prompt template only, so every mode-keyed decision outside the template treats it as
		* `standard` (same length ceiling, same optional acceptance clause).
		*/
		const MODE_VALUES = [
			"standard",
			"detailed",
			"light"
		];
		/** Settings-page model-source choices, in display order. */
		const MODEL_SOURCE_VALUES = ["conversation", "dedicated"];
		/** Mode used when none is saved. */
		const DEFAULT_MODE = "standard";
		/** Model source used when none is saved. */
		const DEFAULT_MODEL_SOURCE = "conversation";
		/**
		* Whether a value is one of a closed set of choices.
		*
		* @param value - anything.
		* @param allowed - the choices.
		* @returns true when `value` is one of them.
		*/
		function isOneOf(value, allowed) {
			return allowed.includes(value);
		}
		//#endregion
		//#region src/client/settings.ts
		/**
		* The plugin's settings section on the DSH 0.2+ Plugins page (`plugins.bundle.config`).
		*
		* Fields are the host Config's `.volatile()` keys, edited through the host's shared
		* `configForms` entry form and saved together with the host `SettingsForm` (staged:
		* only Save writes). The improvement mode lives here since the composer button lost
		* its switch.
		*
		* Host primitives are reached through the runtime `require` the module loader gives the
		* bundle, and described structurally here, so a primitives version skew degrades to "no
		* settings section" instead of breaking the composer button.
		*
		* @module dsh-smart-prompt/client/settings
		*/
		/** Profile entry id of the host half (cordis.patch.yml) — the configForms key. */
		const ENTRY_ID = "dsh-smart-prompt";
		/** Package name — the `plugins.bundle.config` key. */
		const PACKAGE_NAME = "dsh-smart-prompt";
		/** Field names, as declared in the host Config. */
		const FIELD = {
			mode: "defaultMode",
			source: "modelSource",
			provider: "provider",
			model: "model",
			effort: "dedicatedReasoningEffort",
			maxQuestions: "maxQuestions",
			lookupRounds: "sessionLookupRounds",
			stardeaIdeas: "stardeaIdeas",
			stardeaRounds: "stardeaRounds",
			stardeaWeb: "stardeaWebSearch"
		};
		/** The whole-number fields, bounded by the same constants as the host Config schema. */
		const NUMBER_FIELDS = {
			maxQuestions: {
				field: FIELD.maxQuestions,
				min: 1,
				max: Infinity,
				fallback: 5,
				label: "settingsMaxQuestions",
				hint: "settingsMaxQuestionsHint"
			},
			lookupRounds: {
				field: FIELD.lookupRounds,
				min: 0,
				max: 10,
				fallback: 3,
				label: "settingsLookupRounds",
				hint: "settingsLookupRoundsHint"
			},
			stardeaIdeas: {
				field: FIELD.stardeaIdeas,
				min: 1,
				max: 8,
				fallback: 4,
				label: "settingsStardeaIdeas",
				hint: "settingsStardeaIdeasHint"
			},
			stardeaRounds: {
				field: FIELD.stardeaRounds,
				min: 0,
				max: 10,
				fallback: 1,
				label: "settingsStardeaRounds",
				hint: "settingsStardeaRoundsHint"
			}
		};
		/** The number fields in display order. */
		const NUMBER_KEYS = Object.keys(NUMBER_FIELDS);
		/** Settings-page label and hint of each mode; the display order comes from MODE_VALUES. */
		const MODE_COPY = {
			standard: {
				label: "modeStandard",
				hint: "modeStandardHint"
			},
			detailed: {
				label: "modeDetailed",
				hint: "modeDetailedHint"
			},
			light: {
				label: "modeLight",
				hint: "modeLightHint"
			}
		};
		/**
		* Draft text of an on/off field. The host form model stages every field as text and ships
		* only text and number specs, so a switch stages one of these and {@link settingsFlagField}
		* turns it into the boolean the host Config schema declares.
		*/
		const FLAG_TEXT = Object.freeze({
			on: "true",
			off: "false"
		});
		/**
		* Conversion spec of an on/off field, in the shape of the host's `settingsTextField`.
		*
		* @param field - field name in the host Config.
		* @returns the spec: an empty draft clears the field (the schema default applies again),
		*   'true'/'false' set it, anything else is invalid and blocks the save.
		*/
		function settingsFlagField(field) {
			return {
				field,
				format: (value) => value === true ? FLAG_TEXT.on : value === false ? FLAG_TEXT.off : "",
				parse: (text) => text === "" ? { kind: "clear" } : text === FLAG_TEXT.on ? {
					kind: "set",
					value: true
				} : text === FLAG_TEXT.off ? {
					kind: "set",
					value: false
				} : void 0
			};
		}
		/** A staged on/off draft as a boolean; empty (nothing saved) reads as the default. */
		function flagOf(text, fallback) {
			return text === FLAG_TEXT.on ? true : text === FLAG_TEXT.off ? false : fallback;
		}
		/** Separator inside the `<select>` value; provider/model ids never contain it. */
		const ROUTE_SEP = "\0";
		/** Mode and source fields store a closed set; anything else reads as the default. */
		function pick(text, allowed, fallback) {
			return isOneOf(text, allowed) ? text : fallback;
		}
		/**
		* Build the section's state store and actions over one configForms entry.
		*
		* @param primitives - host settings primitives.
		* @param scope - `configForms.get(ENTRY_ID)`.
		* @param loadCatalog - reads the host model catalog.
		* @returns the store, the actions the component injects, and a disposer.
		*/
		function settingsSection(primitives, scope, loadCatalog) {
			const form = new primitives.SettingsFormModel(scope, [
				primitives.settingsTextField(FIELD.mode),
				primitives.settingsTextField(FIELD.source),
				primitives.settingsTextField(FIELD.provider),
				primitives.settingsTextField(FIELD.model),
				primitives.settingsTextField(FIELD.effort),
				...NUMBER_KEYS.map((key) => primitives.settingsNumberField(NUMBER_FIELDS[key].field)),
				settingsFlagField(FIELD.stardeaWeb)
			]);
			let catalog = {
				status: "idle",
				groups: []
			};
			const catalogListeners = /* @__PURE__ */ new Set();
			const formStore = form.bind(() => {
				const source = pick(form.field(FIELD.source).text, MODEL_SOURCE_VALUES, DEFAULT_MODEL_SOURCE);
				const provider = form.field(FIELD.provider).text;
				const model = form.field(FIELD.model).text;
				const numbers = Object.fromEntries(NUMBER_KEYS.map((key) => [key, form.field(NUMBER_FIELDS[key].field).text]));
				const shell = form.shell();
				return {
					...shell,
					invalid: shell.invalid || source === "dedicated" && (provider === "" || model === "") || NUMBER_KEYS.some((key) => !validNumber(numbers[key], NUMBER_FIELDS[key])),
					mode: pick(form.field(FIELD.mode).text, MODE_VALUES, DEFAULT_MODE),
					source,
					provider,
					model,
					effort: form.field(FIELD.effort).text,
					...numbers,
					stardeaWebSearch: flagOf(form.field(FIELD.stardeaWeb).text, false)
				};
			});
			let cachedForm;
			let cachedOut;
			const stable = {
				getSnapshot: () => {
					const current = formStore.getSnapshot();
					if (cachedOut === void 0 || cachedForm !== current || cachedOut.catalog !== catalog) {
						cachedForm = current;
						cachedOut = {
							...current,
							catalog
						};
					}
					return cachedOut;
				},
				subscribe: (listener) => {
					catalogListeners.add(listener);
					const off = formStore.subscribe(listener);
					return () => {
						catalogListeners.delete(listener);
						off();
					};
				}
			};
			const setCatalog = (next) => {
				catalog = next;
				for (const listener of catalogListeners) listener();
			};
			let disposed = false;
			const refreshCatalog = () => {
				if (disposed || catalog.status === "loading") return;
				setCatalog({
					status: "loading",
					groups: catalog.groups
				});
				loadCatalog().then((groups) => {
					if (!disposed) setCatalog(groups === void 0 ? {
						status: "error",
						groups: []
					} : {
						status: "ready",
						groups
					});
				}, () => {
					if (!disposed) setCatalog({
						status: "error",
						groups: []
					});
				});
			};
			const base = form.actions();
			const actions = {
				save: base.save,
				discard: base.discard,
				setMode: (mode) => {
					base.edit(FIELD.mode, mode);
				},
				setSource: (source) => {
					base.edit(FIELD.source, source);
					if (source === "dedicated") refreshCatalog();
				},
				setRoute: (provider, model, effort) => {
					base.edit(FIELD.provider, provider);
					base.edit(FIELD.model, model);
					base.edit(FIELD.effort, effort);
				},
				setEffort: (effort) => {
					base.edit(FIELD.effort, effort);
				},
				setMaxQuestions: (text) => {
					base.edit(FIELD.maxQuestions, text);
				},
				setLookupRounds: (text) => {
					base.edit(FIELD.lookupRounds, text);
				},
				setStardeaIdeas: (text) => {
					base.edit(FIELD.stardeaIdeas, text);
				},
				setStardeaRounds: (text) => {
					base.edit(FIELD.stardeaRounds, text);
				},
				setStardeaWebSearch: (on) => {
					base.edit(FIELD.stardeaWeb, on ? FLAG_TEXT.on : FLAG_TEXT.off);
				},
				refreshCatalog
			};
			if (stable.getSnapshot().source === "dedicated") refreshCatalog();
			return {
				store: stable,
				actions,
				dispose: () => {
					disposed = true;
					form.dispose();
				}
			};
		}
		/** Empty (the default) or a whole number within the field's bounds. */
		function validNumber(text, spec) {
			if (text === "") return true;
			const value = Number(text);
			return Number.isInteger(value) && value >= spec.min && value <= spec.max;
		}
		/**
		* Render the settings section.
		*
		* @param primitives - host settings primitives.
		* @returns the slot component.
		*/
		function SettingsSection(primitives) {
			const { SettingsForm, SegmentedControl, Switch } = primitives;
			return function SmartPromptSettings(props) {
				const { t } = props;
				const state = props.useSmartPromptSettings((s) => s);
				const baseId = react.default.useId();
				if (props.view === "summary") return null;
				const disabled = !state.writable || state.saving;
				const models = state.catalog.groups.flatMap((group) => group.models.map((model) => ({
					group,
					model
				})));
				const current = models.find((m) => m.group.id === state.provider && m.model.id === state.model);
				const efforts = current?.model.reasoning?.efforts ?? [];
				const routeValue = state.provider !== "" && state.model !== "" ? state.provider + ROUTE_SEP + state.model : "";
				const row = (label, hint, control) => react.default.createElement("div", { className: "dip-set-row" }, react.default.createElement("div", { className: "dip-set-text" }, react.default.createElement("div", { className: "dip-set-label" }, label), react.default.createElement("div", { className: "dip-set-hint" }, hint)), react.default.createElement("div", { className: "dip-set-control" }, control));
				const numberRow = (key, onEdit) => {
					const spec = NUMBER_FIELDS[key];
					const value = state[key];
					return row(t(spec.label), t(spec.hint), react.default.createElement("input", {
						className: "dip-set-number",
						type: "number",
						min: spec.min,
						max: Number.isFinite(spec.max) ? spec.max : void 0,
						step: 1,
						inputMode: "numeric",
						"aria-label": t(spec.label),
						placeholder: String(spec.fallback),
						value,
						disabled,
						"aria-invalid": !validNumber(value, spec),
						onChange: (event) => {
							onEdit(event.target.value);
						}
					}));
				};
				return react.default.createElement(SettingsForm, {
					labels: {
						unavailable: t("settingsUnavailable"),
						readOnly: t("settingsReadOnly"),
						saveFailed: t("settingsSaveFailed"),
						save: t("settingsSave"),
						saving: t("settingsSaving")
					},
					state,
					onSave: props.save,
					onDiscard: props.discard
				}, row(t("settingsMode"), t(MODE_COPY[state.mode].hint), react.default.createElement(SegmentedControl, {
					id: baseId + "-mode",
					value: state.mode,
					label: t("settingsMode"),
					disabled,
					options: MODE_VALUES.map((value) => ({
						value,
						label: t(MODE_COPY[value].label)
					})),
					onChange: (next) => {
						props.setMode(next);
					}
				})), row(t("settingsModel"), state.source === "dedicated" ? t("settingsModelDedicatedHint") : t("settingsModelConversationHint"), react.default.createElement(SegmentedControl, {
					id: baseId + "-source",
					value: state.source,
					label: t("settingsModel"),
					disabled,
					options: [{
						value: "conversation",
						label: t("settingsModelConversation")
					}, {
						value: "dedicated",
						label: t("settingsModelDedicated")
					}],
					onChange: (next) => {
						props.setSource(next);
					}
				})), state.source === "dedicated" ? react.default.createElement("div", { className: "dip-set-dedicated" }, state.catalog.status === "error" ? react.default.createElement("p", {
					className: "dip-set-error",
					role: "alert"
				}, t("settingsCatalogError"), " ", react.default.createElement("button", {
					type: "button",
					className: "dip-set-link",
					onClick: props.refreshCatalog
				}, t("settingsRetry"))) : null, react.default.createElement("label", { className: "dip-set-field" }, react.default.createElement("span", { className: "dip-set-label" }, t("settingsPickModel")), react.default.createElement("select", {
					className: "dip-set-select",
					value: routeValue,
					disabled: disabled || state.catalog.status === "loading",
					onChange: (event) => {
						const [provider = "", model = ""] = event.target.value.split(ROUTE_SEP);
						const picked = models.find((m) => m.group.id === provider && m.model.id === model);
						props.setRoute(provider, model, picked?.model.reasoning?.defaultEffort ?? "");
					}
				}, react.default.createElement("option", {
					value: "",
					disabled: true
				}, state.catalog.status === "loading" ? t("settingsLoadingModels") : t("settingsChooseModel")), routeValue !== "" && current === void 0 ? react.default.createElement("option", { value: routeValue }, state.provider + "/" + state.model + " · " + t("settingsUnavailableModel")) : null, ...state.catalog.groups.map((group) => react.default.createElement("optgroup", {
					key: group.id,
					label: group.name
				}, ...group.models.map((model) => react.default.createElement("option", {
					key: model.id,
					value: group.id + ROUTE_SEP + model.id
				}, model.name)))))), efforts.length > 0 ? react.default.createElement("label", { className: "dip-set-field" }, react.default.createElement("span", { className: "dip-set-label" }, t("settingsEffort")), react.default.createElement("select", {
					className: "dip-set-select",
					value: state.effort,
					disabled,
					onChange: (event) => {
						props.setEffort(event.target.value);
					}
				}, react.default.createElement("option", { value: "" }, t("settingsEffortDefault")), ...efforts.map((effort) => react.default.createElement("option", {
					key: effort.id,
					value: effort.id
				}, effort.name)))) : null, state.provider === "" || state.model === "" ? react.default.createElement("p", { className: "dip-set-error" }, t("settingsPickModelRequired")) : null) : null, numberRow("maxQuestions", props.setMaxQuestions), numberRow("lookupRounds", props.setLookupRounds), numberRow("stardeaIdeas", props.setStardeaIdeas), numberRow("stardeaRounds", props.setStardeaRounds), row(t("settingsStardeaWeb"), t("settingsStardeaWebHint"), react.default.createElement(Switch, {
					checked: state.stardeaWebSearch,
					label: t("settingsStardeaWeb"),
					disabled,
					onChange: (next) => {
						props.setStardeaWebSearch(next);
					}
				})));
			};
		}
		//#endregion
		//#region src/client/index.ts
		/**
		* dsh-smart-prompt — client half.
		*
		* Slot entries:
		* - `conversation.input.right` — the sparkle button in the composer tool row.
		* - `conversation.input.overlay` — the floating "improved · certificate" bubble. The host pins
		*   this slot's anchor at zero height to the top edge of the composer card, so the bubble
		*   never takes layout space (the `conversation.input.dock` row it used to sit in did).
		* - `conversation.composer` (chain) — the follow-up panel, which takes the composer seat while
		*   a refine waits for answers. Only on hosts with the `uiSession` pending-interaction registry.
		* - `plugins.bundle.config` — the settings section, on hosts that serve settings forms.
		*
		* Slot contract verified against @deepseek-ai/dsh-client-ui-conversation 0.1.5-rc.1:
		* a session-scoped entry receives `useInput` + `inputActions` (the standard session
		* props) plus whatever `inject` adds — here the `sessionId`.
		*
		* @module dsh-smart-prompt/client
		*/
		/** Required client services. */
		const inject = ["slots", "locale"];
		/**
		* Host primitives module the settings section renders with. Loaded through the module
		* loader's `require` at apply time (see tsdown externals), never bundled.
		*/
		const PRIMITIVES_MODULE = "@deepseek-ai/dsh-client-ui-primitives";
		/**
		* The Remote `session` namespace is its own service, `remote.session`, provided once the
		* Host mounts it. Reading `remote.session` through the `remote` service throws unless the
		* plugin injects it, and injecting it would gate the composer button on it.
		*/
		const REMOTE_SESSION_SERVICE = "remote.session";
		/** Host service that serves plugin settings forms (`@deepseek-ai/dsh-client-ui-settings`). */
		const CONFIG_FORMS_SERVICE = "configForms";
		/**
		* Host service holding the composer seat's pending interactions. Never injected: the composer
		* button must not wait for it, so the panel is mounted whenever it appears.
		*/
		const UI_SESSION_SERVICE = "uiSession";
		/** Host slots this plugin fills. */
		const SLOT = Object.freeze({
			button: "conversation.input.right",
			bar: "conversation.input.overlay",
			composer: "conversation.composer",
			settings: "plugins.bundle.config"
		});
		/** Entry id of the follow-up panel in the composer chain. */
		const FOLLOW_UP_ENTRY_ID = "dsh-smart-prompt-follow-up";
		/**
		* Precedence of the follow-up panel among a session's pending interactions (larger wins).
		* Equal to the host's ordinary question card (1; its plan review is 2), so neither outranks
		* the other and a plan review still comes first.
		*/
		const FOLLOW_UP_PRECEDENCE = 1;
		/** Order of both composer entries within their slots: just before the host's submit action. */
		const COMPOSER_ORDER = 40;
		/**
		* Register one session-scoped composer entry for the plugin's lifetime. A failed
		* registration is logged and leaves the rest of the plugin running.
		*
		* @param ctx - the plugin context that owns the registration.
		* @param slot - the slot name.
		* @param id - the entry id.
		* @param inject - extra props for the entry, per session.
		* @param render - the entry component.
		* @param label - the effect label.
		* @param logName - how the failure log names the entry.
		*/
		function registerComposerEntry(ctx, slot, id, inject, render, label, logName) {
			registerSlotEntry(ctx, {
				name: slot,
				id,
				order: COMPOSER_ORDER,
				locale: NS,
				inject
			}, render, label, logName);
		}
		/**
		* Register one slot entry while `ctx` lives. A failed registration is logged and leaves the
		* rest of the plugin running.
		*
		* @param ctx - the context that owns the registration.
		* @param options - the entry's registration options; `name` is the slot.
		* @param render - the entry component.
		* @param label - the effect label.
		* @param logName - how the failure log names the entry.
		*/
		function registerSlotEntry(ctx, options, render, label, logName) {
			ctx.effect(() => {
				try {
					return ctx.slots.inject(options.name, function* () {
						yield ctx.slots.register(options, render);
					});
				} catch (error) {
					console.error("[dsh-smart-prompt] " + logName + " slot registration failed", error);
					return () => {};
				}
			}, "dsh-smart-prompt: " + label);
		}
		/**
		* Make the follow-up panel available while `ctx` lives: register the pending-interaction
		* domain the panel is published through, and the composer-chain entry that renders it.
		* Without the registry (older hosts) nothing happens, and refines ask no questions.
		*
		* @param ctx - context that owns the registrations (disposed with the `uiSession` service).
		* @param uiSession - the host's Session UI service, if provided.
		* @param t - localized copy lookup.
		*/
		function mountFollowUp(ctx, uiSession, t) {
			if (typeof uiSession?.registerPendingInteraction !== "function") return;
			let publish;
			try {
				publish = uiSession.registerPendingInteraction(() => FOLLOW_UP_PRECEDENCE);
			} catch (error) {
				console.error("[dsh-smart-prompt] follow-up registration failed; refines ask no questions", error);
				return;
			}
			ctx.effect(() => providePublisher(publish), "dsh-smart-prompt: follow-up questions");
			registerSlotEntry(ctx, {
				name: SLOT.composer,
				id: FOLLOW_UP_ENTRY_ID,
				locale: NS,
				select: ({ pendingInteraction }) => asFollowUp(pendingInteraction)
			}, (slotProps) => react.default.createElement(FollowUpPanel, Object.assign({}, slotProps, { t })), "follow-up panel", "follow-up panel");
		}
		function loadPrimitives() {
			try {
				const mod = typeof require === "function" ? require(PRIMITIVES_MODULE) : void 0;
				return mod !== void 0 && typeof mod.SettingsFormModel === "function" && typeof mod.SettingsForm === "function" && typeof mod.SegmentedControl === "function" && typeof mod.Switch === "function" && typeof mod.settingsTextField === "function" && typeof mod.settingsNumberField === "function" ? mod : void 0;
			} catch {
				return;
			}
		}
		/**
		* Attach the client half.
		*
		* @param ctx - client context carrying `slots` and `locale`.
		*/
		function apply(ctx) {
			let t = (key) => en[key] !== void 0 ? en[key] : key;
			ctx.effect(() => {
				if (typeof document === "undefined") return void 0;
				document.querySelectorAll("style[data-plugin=\"" + STYLE_ATTR + "\"]").forEach((node) => {
					node.remove();
				});
				const style = document.createElement("style");
				style.dataset.plugin = STYLE_ATTR;
				style.textContent = css;
				document.head.appendChild(style);
				return () => {
					style.remove();
				};
			}, "dsh-smart-prompt: styles");
			if (ctx.locale !== void 0) {
				ctx.effect(() => ctx.locale.register(NS, {
					zh,
					en
				}), "dsh-smart-prompt: locale");
				try {
					t = ctx.locale.bind(NS);
				} catch (error) {
					console.error("[dsh-smart-prompt] locale bind failed; using the built-in English copy", error);
				}
			} else console.error("[dsh-smart-prompt] no locale service; using the built-in English copy");
			if (ctx.slots === void 0) {
				console.error("[dsh-smart-prompt] no slots service; composer entries not registered");
				return;
			}
			const serializeAttachments = async (ids) => {
				const conversation = ctx.get?.("conversation");
				if (typeof conversation?.serializeDraftAttachments !== "function") return [];
				return (await conversation.serializeDraftAttachments(ids)).attachments ?? [];
			};
			registerComposerEntry(ctx, SLOT.button, "dsh-smart-prompt-button", (sessionId) => ({
				sessionId,
				serializeAttachments
			}), (slotProps) => react.default.createElement(ImproveButton, Object.assign({}, slotProps, { t })), "composer button", "button");
			registerComposerEntry(ctx, SLOT.bar, "dsh-smart-prompt-bar", (sessionId) => ({ sessionId }), (slotProps) => react.default.createElement(StatusBar, {
				sessionId: slotProps !== void 0 && typeof slotProps.sessionId === "string" ? slotProps.sessionId : void 0,
				t
			}), "status bar", "status bar");
			const followUp = (owner) => {
				mountFollowUp(owner, owner.get?.(UI_SESSION_SERVICE), t);
			};
			if (typeof ctx.inject === "function") ctx.inject([UI_SESSION_SERVICE], followUp);
			else followUp(ctx);
			const primitives = loadPrimitives();
			if (primitives === void 0) return;
			const Section = SettingsSection(primitives);
			const loadCatalog = async () => {
				const response = await (ctx.get?.(REMOTE_SESSION_SERVICE))?.modelCatalog?.();
				return response?.ok === true ? response.value?.groups ?? [] : void 0;
			};
			const mount = (owner) => {
				mountSettings(owner, owner.get?.(CONFIG_FORMS_SERVICE), primitives, Section, loadCatalog, t);
			};
			if (typeof ctx.inject === "function") ctx.inject([CONFIG_FORMS_SERVICE], mount);
			else mount(ctx);
		}
		/**
		* Register the settings section on the Plugins page while the host serves its entry.
		*
		* @param ctx - context that owns the registration (disposed with it).
		* @param configForms - the host settings-forms service; nothing is registered without it.
		*/
		function mountSettings(ctx, configForms, primitives, Section, loadCatalog, t) {
			if (configForms === void 0) return;
			const remote = ctx.get?.("remote");
			ctx.effect(() => {
				try {
					const section = settingsSection(primitives, configForms.get(ENTRY_ID), loadCatalog);
					const stopServing = configForms.whileServed([ENTRY_ID], () => ctx.slots.inject(SLOT.settings, () => ctx.slots.register({
						name: SLOT.settings,
						key: PACKAGE_NAME,
						locale: NS,
						inject: () => ({
							hooks: { smartPromptSettings: section.store },
							...section.actions
						})
					}, (props) => react.default.createElement(Section, Object.assign({}, props, { t })))));
					const offAdapters = remote?.$on?.("llm/adapters-updated", section.actions.refreshCatalog);
					return () => {
						stopServing();
						offAdapters?.();
						section.dispose();
					};
				} catch (error) {
					console.error("[dsh-smart-prompt] settings section registration failed", error);
					return () => {};
				}
			}, "dsh-smart-prompt: settings section");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map