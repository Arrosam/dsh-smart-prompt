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
				if (/^\/+$/.test(bare)) return {
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
			if (body === "" || /^\/+$/.test(body)) return {
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
				doneBubbleOwner: null
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
		* Reset one session to idle, dropping any stale Revert/Retry information.
		*
		* @param sessionId - the session to reset.
		* @param phase - the phase to land on.
		* @param error - message for the error phase.
		*/
		function clear(sessionId, phase = "idle", error = null) {
			const state = storeFor(sessionId);
			const actions = state.actions;
			state.phase = phase;
			state.error = error;
			state.backup = "";
			state.enhanced = "";
			state.meta = null;
			state.controller = null;
			state.actions = actions;
			state.doneBubbleOwner = null;
			notify(sessionId);
		}
		//#endregion
		//#region src/client/components.ts
		/**
		* The two visible pieces: the composer button (star, or Revert | Retry after a refine)
		* and the status bar.
		*
		* @module dsh-smart-prompt/client/components
		*/
		const API = "/dsh-smart-prompt/api/improve";
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
		/** Stroke paths (12x12 grid) for the capsule glyphs: a back-arrow for Revert, a circular arrow for Retry. */
		const CAPSULE_ICON_PATH = {
			revert: "M4.6 2.2L1.8 5L4.6 7.8M1.8 5H7.4A3 3 0 0 1 7.4 11H5.2",
			retry: "M10.2 6A4.2 4.2 0 1 1 8.6 2.7M8.9 0.9L9.2 3.2L6.9 3.6"
		};
		/** Small stroke glyph for one half of the Revert | Retry capsule; inherits the label colour. */
		function CapsuleIcon(kind) {
			return react.default.createElement("svg", {
				className: "dip-capsule-icon",
				viewBox: "0 0 12 12",
				width: "12",
				height: "12",
				"aria-hidden": "true",
				focusable: "false"
			}, react.default.createElement("path", {
				d: CAPSULE_ICON_PATH[kind],
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.4",
				strokeLinecap: "round",
				strokeLinejoin: "round"
			}));
		}
		/** Four-point sparkle, filled with the text colour so it follows the host theme. */
		function Sparkle() {
			return react.default.createElement("svg", {
				className: "dip-icon",
				viewBox: "0 0 16 16",
				"aria-hidden": "true",
				focusable: "false"
			}, react.default.createElement("path", {
				d: "M8 1.2l1.35 3.9a2 2 0 001.25 1.25l3.9 1.35-3.9 1.35a2 2 0 00-1.25 1.25L8 14.8l-1.35-3.9a2 2 0 00-1.25-1.25L1.5 8.3l3.9-1.35A2 2 0 006.65 5.7L8 1.2z",
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
		* Send one draft to the host and write the result into the composer.
		*
		* Shared by the composer button and the status bar's Retry, so both follow the same
		* state transitions: busy -> done (draft replaced, `backup` keeps `text`) or
		* busy -> error (draft untouched). A slash-command draft with no body is ignored.
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
			(async () => {
				try {
					const data = await (await fetch(API, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							sessionId,
							text
						}),
						signal: controller.signal
					})).json();
					const latest = storeFor(sessionId);
					if (data.ok === true && typeof data.text === "string" && data.text !== "") {
						latest.enhanced = data.text;
						latest.meta = data.meta !== void 0 ? data.meta : null;
						latest.phase = "done";
						latest.controller = null;
						actions.setDraft(data.text);
						notify(sessionId);
						return;
					}
					const key = "err_" + (typeof data.code === "string" ? data.code : "UNKNOWN");
					const localized = t(key);
					latest.phase = "error";
					latest.error = localized !== key ? localized : typeof data.message === "string" && data.message !== "" ? data.message : t("err_UNKNOWN");
					latest.controller = null;
					notify(sessionId);
				} catch (error) {
					const latest = storeFor(sessionId);
					latest.controller = null;
					const aborted = error instanceof DOMException && error.name === "AbortError";
					latest.phase = "error";
					latest.error = aborted ? t("err_ABORTED") : t("err_UPSTREAM");
					notify(sessionId);
				}
			})();
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
			const split = splitCommand(draft);
			const commandOnly = split.command !== "" && split.body === "";
			const blocked = split.body === "";
			const state = sessionId !== void 0 ? storeFor(sessionId) : null;
			const busy = state !== null && state.phase === "busy";
			const actions = props.inputActions !== void 0 ? props.inputActions : state !== null ? state.actions : null;
			if (state !== null && props.inputActions !== void 0 && state.actions !== props.inputActions) state.actions = props.inputActions;
			const onClick = react.default.useCallback(() => {
				if (sessionId === void 0 || actions === null) return;
				const current = storeFor(sessionId);
				if (current.phase === "busy") {
					if (current.controller !== null) current.controller.abort();
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
			}, react.default.createElement("button", {
				type: "button",
				className: "dip-revert",
				title: t("revertTitle"),
				onMouseDown: keepComposerFocus,
				onClick: onRevert
			}, CapsuleIcon("revert"), t("revert")), react.default.createElement("span", {
				className: "dip-divider",
				"aria-hidden": "true"
			}), react.default.createElement("button", {
				type: "button",
				className: "dip-retry",
				title: t("retryTitle"),
				onMouseDown: keepComposerFocus,
				onClick: onRetry
			}, CapsuleIcon("retry"), t("retry")));
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
		/** Human-readable certificate: "保真 12/12 · 1.4x · 2.1s". */
		function certificate(meta, t) {
			const parts = [];
			if (meta.anchors.total > 0) parts.push(t("fidelity") + " " + String(meta.anchors.kept) + "/" + String(meta.anchors.total));
			parts.push(meta.ratioLabel);
			parts.push((Math.round(meta.elapsedMs / 100) / 10).toFixed(1) + "s");
			if (meta.contextUsed !== "none") parts.push(t("contextTag"));
			if (meta.questions !== void 0 && meta.questions.answered > 0) parts.push(t("answeredTag") + " " + String(meta.questions.answered) + "/" + String(meta.questions.asked));
			return parts.join(" · ");
		}
		/** Exit duration of the status bubble; must match `dip-bar-out` in styles.ts. */
		const BUBBLE_EXIT_MS = 160;
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
				const ms = phase === "done" ? 8e3 : 12e3;
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
			}, react.default.createElement("span", { className: "dip-bar-text" }, visible.text), canRetry ? react.default.createElement("button", {
				type: "button",
				className: "dip-bar-retry",
				title: t("retryFailedTitle"),
				onMouseDown: keepComposerFocus,
				onClick: onRetry
			}, CapsuleIcon("retry"), t("retry")) : null);
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
			modeLightHint: "轻档：只去废话、消歧义，几乎不改结构",
			modeStandardHint: "标准档：结构化重述，让 Agent 能直接执行",
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
			answeredTag: "已补充",
			done: "已增强",
			canceled: "已取消，原文未改动",
			fidelity: "保真",
			contextTag: "已参考会话",
			preserved: "已回灌",
			err_EMPTY: "输入框为空",
			err_COMMAND: "斜杠命令后没有可改写的正文",
			err_TOO_LONG: "草稿过长",
			err_BAD_BODY: "请求格式错误",
			err_NO_ROUTE: "未找到可用模型：请先在设置里选默认模型",
			err_TIMEOUT: "增强超时，原文未改动",
			err_ABORTED: "已取消，原文未改动",
			err_EMPTY_OUTPUT: "模型没有返回内容，原文未改动",
			err_TOOL_CALL: "模型返回了工具调用而非提示词，原文未改动",
			err_LENGTH_EXCEEDED: "增强结果超出长度上限，已保留原文（可切「轻」档或调高上限）",
			err_UPSTREAM: "模型调用失败，原文未改动",
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
			modeLightHint: "Light: remove filler and ambiguity, keep the structure",
			modeStandardHint: "Standard: restructure so an agent can execute it directly",
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
			answeredTag: "answered",
			done: "Improved",
			canceled: "Cancelled — draft untouched",
			fidelity: "fidelity",
			contextTag: "context used",
			preserved: "re-appended",
			err_EMPTY: "The composer is empty",
			err_COMMAND: "A slash command with no body has nothing to rewrite",
			err_TOO_LONG: "Draft is too long",
			err_BAD_BODY: "Malformed request",
			err_NO_ROUTE: "No model available — pick a default model in settings first",
			err_TIMEOUT: "Enhancement timed out — draft untouched",
			err_ABORTED: "Cancelled — draft untouched",
			err_EMPTY_OUTPUT: "The model returned nothing — draft untouched",
			err_TOOL_CALL: "The model returned a tool call instead of a prompt — draft untouched",
			err_LENGTH_EXCEEDED: "Result exceeded the length ceiling — draft kept (try Light mode or raise the ceiling)",
			err_UPSTREAM: "Model call failed — draft untouched",
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
		* @module dsh-smart-prompt/client/styles
		*/
		const STYLE_ATTR = "dsh-smart-prompt";
		/** Hover/press fill for every half of the capsule: the host's interactive hover token. */
		const HOVER_BG = "var(--dsw-alias-interactive-bg-hover)";
		/** Keyboard focus ring: the host's primary business colour. */
		const FOCUS_RING = "inset 0 0 0 2px var(--dsw-alias-state-business-primary)";
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
			"font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);box-shadow:0 4px 14px rgba(0,0,0,.18)}",
			".dip-bar[data-state=\"entering\"]{animation:dip-bar-in 200ms cubic-bezier(.2,.8,.2,1) both}",
			".dip-bar[data-state=\"leaving\"]{animation:dip-bar-out 160ms ease-in both;pointer-events:none}",
			".dip-bar[data-kind=\"error\"]{border-color:rgba(220,90,70,.5);color:var(--dsw-alias-label-primary)}",
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
			"@keyframes dip-icon-spin{to{transform:rotate(360deg)}}",
			"@keyframes dip-bar-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}",
			"@keyframes dip-bar-out{from{opacity:1;transform:none}to{opacity:0;transform:translateY(6px)}}",
			"@media (prefers-reduced-motion: reduce){",
			".dip-icon,.dip-btn,.dip-revert,.dip-retry,.dip-bar,.dip-bar-retry{animation:none!important;transition-duration:.01ms!important}",
			"}"
		].join("\n");
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
			maxQuestions: "maxQuestions"
		};
		/** Shown when the field is empty; must match `DEFAULT_MAX_QUESTIONS` in the host config. */
		const DEFAULT_MAX_QUESTIONS = 5;
		/** Smallest accepted question cap (the host schema's `min(1)`). */
		const MIN_QUESTIONS = 1;
		/** Separator inside the `<select>` value; provider/model ids never contain it. */
		const ROUTE_SEP = "\0";
		/** Mode and source fields store a closed set; anything else reads as the default. */
		function pick(text, allowed, fallback) {
			return allowed.includes(text) ? text : fallback;
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
				primitives.settingsNumberField(FIELD.maxQuestions)
			]);
			let catalog = {
				status: "idle",
				groups: []
			};
			const catalogListeners = /* @__PURE__ */ new Set();
			const formStore = form.bind(() => {
				const source = pick(form.field(FIELD.source).text, ["conversation", "dedicated"], "conversation");
				const provider = form.field(FIELD.provider).text;
				const model = form.field(FIELD.model).text;
				const maxQuestions = form.field(FIELD.maxQuestions).text;
				const shell = form.shell();
				return {
					...shell,
					invalid: shell.invalid || source === "dedicated" && (provider === "" || model === "") || maxQuestions !== "" && !validQuestionCap(maxQuestions),
					mode: pick(form.field(FIELD.mode).text, ["standard", "light"], "standard"),
					source,
					provider,
					model,
					effort: form.field(FIELD.effort).text,
					maxQuestions
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
		function validQuestionCap(text) {
			const value = Number(text);
			return Number.isInteger(value) && value >= MIN_QUESTIONS;
		}
		/**
		* Render the settings section.
		*
		* @param primitives - host settings primitives.
		* @returns the slot component.
		*/
		function SettingsSection(primitives) {
			const { SettingsForm, SegmentedControl } = primitives;
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
				}, row(t("settingsMode"), state.mode === "light" ? t("modeLightHint") : t("modeStandardHint"), react.default.createElement(SegmentedControl, {
					id: baseId + "-mode",
					value: state.mode,
					label: t("settingsMode"),
					disabled,
					options: [{
						value: "standard",
						label: t("modeStandard")
					}, {
						value: "light",
						label: t("modeLight")
					}],
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
				}, effort.name)))) : null, state.provider === "" || state.model === "" ? react.default.createElement("p", { className: "dip-set-error" }, t("settingsPickModelRequired")) : null) : null, row(t("settingsMaxQuestions"), t("settingsMaxQuestionsHint"), react.default.createElement("input", {
					className: "dip-set-number",
					type: "number",
					min: MIN_QUESTIONS,
					step: 1,
					inputMode: "numeric",
					"aria-label": t("settingsMaxQuestions"),
					placeholder: String(DEFAULT_MAX_QUESTIONS),
					value: state.maxQuestions,
					disabled,
					"aria-invalid": state.maxQuestions !== "" && !validQuestionCap(state.maxQuestions),
					onChange: (event) => {
						props.setMaxQuestions(event.target.value);
					}
				})));
			};
		}
		//#endregion
		//#region src/client/index.ts
		/**
		* dsh-smart-prompt — client half.
		*
		* Two slot entries and nothing else:
		* - `conversation.input.right` — the sparkle button in the composer tool row.
		* - `conversation.input.overlay` — the floating "improved · certificate" bubble. The host pins
		*   this slot's anchor at zero height to the top edge of the composer card, so the bubble
		*   never takes layout space (the `conversation.input.dock` row it used to sit in did).
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
		function loadPrimitives() {
			try {
				const mod = typeof require === "function" ? require(PRIMITIVES_MODULE) : void 0;
				return mod !== void 0 && typeof mod.SettingsFormModel === "function" && typeof mod.SettingsForm === "function" && typeof mod.SegmentedControl === "function" && typeof mod.settingsTextField === "function" && typeof mod.settingsNumberField === "function" ? mod : void 0;
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
			ctx.effect(() => {
				try {
					return ctx.slots.inject("conversation.input.right", function* () {
						yield ctx.slots.register({
							name: "conversation.input.right",
							id: "dsh-smart-prompt-button",
							order: 40,
							locale: NS,
							inject: (sessionId) => ({ sessionId })
						}, (slotProps) => react.default.createElement(ImproveButton, Object.assign({}, slotProps, { t })));
					});
				} catch (error) {
					console.error("[dsh-smart-prompt] button slot registration failed", error);
					return () => {};
				}
			}, "dsh-smart-prompt: composer button");
			ctx.effect(() => {
				try {
					return ctx.slots.inject("conversation.input.overlay", function* () {
						yield ctx.slots.register({
							name: "conversation.input.overlay",
							id: "dsh-smart-prompt-bar",
							order: 40,
							locale: NS,
							inject: (sessionId) => ({ sessionId })
						}, (slotProps) => react.default.createElement(StatusBar, {
							sessionId: slotProps !== void 0 && typeof slotProps.sessionId === "string" ? slotProps.sessionId : void 0,
							t
						}));
					});
				} catch (error) {
					console.error("[dsh-smart-prompt] status bar slot registration failed", error);
					return () => {};
				}
			}, "dsh-smart-prompt: status bar");
			const primitives = loadPrimitives();
			if (primitives === void 0) return;
			const Section = SettingsSection(primitives);
			const loadCatalog = async () => {
				const response = await (ctx.get?.(REMOTE_SESSION_SERVICE))?.modelCatalog?.();
				return response?.ok === true ? response.value?.groups ?? [] : void 0;
			};
			if (typeof ctx.inject === "function") ctx.inject([CONFIG_FORMS_SERVICE], (inner) => {
				mountSettings(inner, inner.get?.(CONFIG_FORMS_SERVICE), primitives, Section, loadCatalog, t);
			});
			else mountSettings(ctx, ctx.get?.(CONFIG_FORMS_SERVICE), primitives, Section, loadCatalog, t);
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
					const stopServing = configForms.whileServed([ENTRY_ID], () => ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
						name: "plugins.bundle.config",
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