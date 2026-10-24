# Changelog

## Unreleased

- **Higher output limit**: the default `maxTokens` (most output tokens per model call) is now **32000**, up from 8192. Reasoning models count their thinking against this limit. A small limit could be used up by thinking alone, and the refine then failed with "The model returned nothing" (seen with opencode's free DeepSeek V4.1 Flash). A `maxTokens` set in the plugin config still applies. If the problem continues, set a thinking level for the model, such as **Low**.

## 1.1.0

- **Hold the star to switch modes**: hold the ✦ star in the composer for 300 ms, or slide it at least 16 px sideways, and a capsule-shaped mode bar opens above it. Left to right it shows **Detailed ← Standard → Light**, each with its icon and name (zh: 详细 / 标准 / 轻量). The bar floats over the page (drawn in the page body at a fixed position), so it never pushes or moves the composer or anything else. It opens with the active mode under the pointer. Each 88 px of sideways slide moves the selection one mode, starting from half a segment. Letting go saves the selected mode. Sliding past either end stays on that end instead of wrapping around. Esc, a cancelled pointer, or letting go without sliding keeps the mode. It saves the same `defaultMode` setting as **Improvement method** in plugin settings, through the same settings form, so the two stay in sync. A click without holding or sliding still improves (or cancels).
- **A star icon per mode**: the star shows the active mode, right after a switch and after a reload. Detailed is a stretched star writing on a page, Standard keeps the ✦ unchanged, and Light is a lightning bolt.
- **First-use window**: the first time the star appears with switching available, a small window above the composer explains the hold-and-slide and what each mode does. It shows once per browser (recorded in the browser's local storage), never takes the composer's place, and closes with **Got it**, ×, or a click on the star.
- **Settings hint**: **Improvement method** in plugin settings now reminds you that holding the star and sliding left or right switches it too.

- **Standard mode asks one question at a time**: the default mode (Standard) now runs Detailed mode's whole follow-up flow. Gaps only you can decide are asked through the follow-up panel **one question at a time**, and after each answer the next question opens until nothing is missing or the follow-up limit (**Follow-up questions**, default 5) is reached in total. Standard no longer writes `(TBD: …)` notes: when the limit is reached, when you click **Skip**, or when questions cannot be asked (limit 0, or no session), the remaining gaps are filled with guesses, each listed under **Guessed details** (`## 猜测补充`) at the end of the rewrite. **×** still cancels with the draft untouched. Only Standard changes: its prompt template (`prompts/standard.md`) gains the follow-up rules, and its follow-up policy is now the same as Detailed's. Detailed is unchanged. Light is unchanged and keeps its single round of questions (every question at once, **Skip** keeps the first rewrite).

## 1.0.1

- **Detailed mode (详细模式)**: a third improvement method, next to Standard and Light. It rewrites the draft as an execution specification: the ordered next steps, the cautions to watch while executing, and the exact standard for every concrete detail. The prompt sets no length target — the bar is that the executing agent never has to guess a detail. Vague descriptions that name a direction instead of a result — short qualifiers ("softer"), requests ("give me a sense of…"), analogies ("light like feather"), mood references ("a vibe of kawaii bass") — are not guessed at: it asks what exactly you want through the follow-up questions and reminds you that **Stardea (星念)** can propose candidate answers for them. It never writes `(TBD: …)` notes: gaps only you can decide are asked **one question at a time** — after each answer the next question opens until nothing is missing or the follow-up limit (**Follow-up questions**, default 5) is reached in total. When the limit is reached, when you click **Skip**, or when questions cannot be asked (limit 0, or no session), the remaining gaps are filled with guesses, each listed under **Guessed details** (`## 猜测补充`) at the end of the rewrite. **×** still cancels with the draft untouched. Standard and Light keep their single round of questions. Besides its prompt template (`prompts/detailed.md`) and these follow-up rounds, it shares Standard's logic and settings (same length ceiling through `standardMaxRatio`, uncapped by default; same optional `acceptanceCriteria` clause) and is registered the same way. The mode appears in **Improvement method** in plugin settings and in `GET /api/config` (`modes` and `maxRatio.detailed`).

## 1.0.0

Includes everything from 0.11.0 and 0.12.0 below, which were never released separately.

- **Workspace knowledge (`SMART-PROMPT.md`)**: every refine reads `SMART-PROMPT.md` at the session's workspace root and puts it at the start of the request, the way `AGENTS.md` is given to agents. After a successful refine, one more call in the same conversation updates the file (or creates it) with lasting knowledge about the workspace: what the project is, your vocabulary and shorthand, files and commands you keep mentioning, and standing preferences. It never records the current request, progress, guesses or secrets. The update runs after the result is shown and its failures are ignored. Limit: `knowledgeChars` (default 4000; 0 turns it off). A file over the limit is read clipped and never rewritten.
- **Last turn always included**: the last exchange of the conversation (your message and the assistant's final reply, without tool calls or thinking) is now sent with every refine, not only with drafts like "do the same". The status shows `context used`.

### From 0.12.0

- **Stardea (星念)**: every follow-up question has a **Stardea** button. A click suggests answers, found through a search of the current conversation, the model's own proposals and, if turned on, DSH's web search. Each suggestion is labeled with its source. Clicking again adds different suggestions below the earlier ones.
- **Stardea settings**: three new rows on the settings page. **Stardea ideas per click**: 1 to 8, default 4. **Stardea search rounds**: the most search rounds per click, 0 to 10, default 1; with 0, Stardea only proposes its own ideas. **Stardea web search**: off by default. **Session lookup rounds** now limits only the rewrite.
- **New question panel**: follow-up questions now open in the plugin's own panel in place of the composer, instead of DSH's question card. The panel shows your original draft, so you can see what you wrote. You can tick one or more suggestions, with or without your own words. **Skip** keeps the first rewrite with its `(TBD: …)` notes, and **×** cancels the refine.
- **Answers keep every part**: an answer made of ticked suggestions and your own words passes all of them to the rewrite. Before, your own words replaced the ticked choice.
- **Token report**: the note after a refine shows its tokens as `input(cached) - output`: input that missed the cache, input read from the cache, and output, over every model call including Stardea. It appears only when the provider reports token use.
- **Cheaper repeated calls**: all model calls of one refine now continue a single conversation with the same system prompt and tools. Each call starts with the previous request unchanged, so providers with prompt caching bill the repeated part as cache hits. Earlier lookup results stay available to later calls. Session lookups are now tool results instead of a `<session_lookup>` block. If the model rejects tools, the refine continues without them and the results are written into the request.

### From 0.11.0

- **Attachments**: images and files attached in the composer are now sent to the refining model with the draft. Text files are read, up to the first 20,000 characters of each. If a file is still uploading, the refine stops and asks you to try again.
- **Earlier images**: when session context is included, the images you attached to those earlier messages are sent too. Which messages are included has not changed.
- **Session lookups**: when the draft depends on something said earlier, the refining model can search the conversation and read earlier messages: your messages and the assistant's replies only. Set **Session lookup rounds** in the plugin settings: 0 to 10, default 3. 0 turns lookups off. Each round is one more model call. If the model doesn't support tools, the refine continues without lookups.
- **Clearer failures**: when the model call itself fails, the error bubble now says the call failed instead of "the model returned nothing".
- **Request size**: the improve endpoint's body limit now scales with DSH's per-message image limit, so drafts with images fit.

## 0.10.1

- **Fix**: after a refine, switching to another session and back showed the success bubble again, even after it had hidden. It now shows once per refine. Error bubbles are unchanged.

## 0.10.0

- **Retry on failure**: the error bubble has a **Retry** button that sends the same draft again. Answers you gave to follow-up questions are kept for that draft, so a retry does not open the question card again. They are dropped once a refinement succeeds.
- **Longer prompts**: Standard mode no longer has a length cap (`standardMaxRatio` now defaults to `0`, meaning no cap). Light mode allows 2× the draft (was 1.2×), and the minimum length budget is 600 characters (was 200).

## 0.9.1

- **Fix**: the settings section could be missing from the Plugins page. DSH starts browser plugins in no fixed order, and when this plugin started before DSH's settings service, it skipped the section until the next restart. It now waits for the service.

## 0.9.0

- **Follow-up questions**: when the draft is missing information only you can give, DSH's question card asks short questions (at most 5 by default; set it under **Follow-up questions** in the plugin settings). Your answers are folded into a second rewrite. If you answer "I don't know", the prompt tells the agent to find it out itself or to propose options. Skipping or closing the card keeps the first rewrite with its `(TBD: …)` notes.
- **Fix**: the settings page could not load the model list for "Dedicated model".
- **CI**: checks the new plugin name.

## 0.8.0 (dsh-smart-prompt)

Forked and renamed from dsh-improve-prompt.

- **Renamed to `dsh-smart-prompt`**: package name, profile entry id, client module id, local API route (`/dsh-smart-prompt/api/...`) and prompt-override folder (`$DSH_HOME/dsh-smart-prompt/prompts/`).
- **Plugin icon** (`assets/icon.svg`): shown on the DSH Plugins page.
- **Settings section** on the DSH 0.2 Plugins page: improvement method (Standard / Light) and the model used (the conversation's model, or a dedicated model with its own reasoning effort).
- **Simple composer button**: a plain capsule with only the sparkle; click improves, no mode switch or hover expansion.

## 0.7.3

修复在新版 DSH（0.2.x，实测 0.2.1-alpha.2）上宿主半边无法加载（`dsh-improve-prompt: failed to import`）：

- **`schemastery` → `@deepseek-ai/schemastery`**：`src/config.ts`（及 `src/index.ts`）原先 import 裸包名 `schemastery`，但 DSH 宿主与 profile 只提供带作用域的 `@deepseek-ai/schemastery`（profile 默认 `autoInstallPeers: false`，不会补装裸包），于是 `ERR_MODULE_NOT_FOUND`、插件整体不激活。现改为与其他官方/社区插件一致的 `@deepseek-ai/schemastery`，peerDependencies 与 `scripts/build.sh` 的链接同步改名。
- 91/91 单测、双端 typecheck 通过；在 0.2.1-alpha.2 的 profile 中 `import('dsh-improve-prompt')` 恢复正常。

## 0.7.2

深思考模型适配（GLM-5.3-flash @ effort=max 实测驱动，2026-09-24）：默认模型切到深思考后，「点击无结果」高频复现——单次 90 字改写实测耗时 50.5s（占 60s 超时预算 84%），草稿稍复杂即 `TIMEOUT`；思考 token 计入 completion 上限，复杂草稿可烧光 2000 token 报 `EMPTY`。

- **默认值重定**：`timeoutMs` 60000 → **180000**；`maxTokens` 2000 → **8192**；`reasoningEffort` 留空（继承全局 effort）→ **low**（改写是浅任务；宿主对 session-title 同思路降思考；zhipuai 网关禁 disabled，low 为延迟地板；deepseek/zhipuai 双侧适配器均合法）。旧配置经 resolveConfig 防御式回落，零升级风险。
- **失败可观测**：TIMEOUT / EMPTY_OUTPUT / TOOL_CALL / UPSTREAM / LENGTH_EXCEEDED 等全部 `ok:false` 路径现在落 `ctx.logger.warn`（带错误码与耗时）——此前只有抛异常路径落日志，排查无痕。
- **错误条 6s → 12s**：失败提示更容易被看到。
- **凭证模型名去双前缀**：selection 携带 `zhipuai/glm-5.3-flash` 时不再渲染成 `zhipuai/zhipuai/…`。
- 测试 88 → **91**（新默认值 / effort 透传 / 单前缀凭证三断言）；typecheck 双端零错。

## 0.7.1

两处光学微调（用户实测截图驱动）：

- **星芒在收起圆标里下坠 1px**：root 是 border-box 高 28（边框 2 + 内容 26），而 `.dip-btn` 固定高 28 → 内容向下溢出 1px，图标跟着低 1px。root 高度 28 → **30**（内容区恢复 28），实测 iconDy +1.0px → 0。
- **▾ 小三角换 **⇄ 双向箭头 SVG**：U+25BE 的墨迹天生偏在 em 框下半（盒子居中≠光学居中），且三角暗示下拉而这不是下拉框。改为 12×10 SVG 双向箭头（上箭头向右/下箭头向左），stroke 继承当前色 + drop-shadow，光学居中可控。

## 0.7.0

收放自如：整颗芯片收起为 28px 星芒圆标，悬停时右缘钉住、向左展开成完整分体芯片。

- **收起态两层暗示**：星芒品牌锚 + 草稿非空时**呼吸微光**（借 dsh-concise 的 data-on 语言）；空草稿=暗星（禁用语义不变）。档位徽点（金/青角标）试过一版——用户读作「未读通知」类角标，当场移除。
- **真宽度动画 28px↔~88px，右缘钉死**：label/分隔线/▾ 用 max-width+opacity 收放（dsh-concise label 工艺），主区 gap/padding 动画。**邻居位移是宿主布局自动行为**——实测宿主 trailing 簇 `.trailing{flex:none;gap:12px;margin-left:auto}`，我们变宽 Δ 时仅左侧 dsh-concise 平移 Δ、与模型按钮/meter/发送的间距恒定，**dsh-concise 零改动**（harness 新增 trailing 模拟行，4 项断言实证：mock 平移=Δ、右缘 drift≤0.5px、picker 不动）。
- **悬停缩放全删**：lift/scale 从 hover/active 移除，展开即悬停响应；busy 充能呼吸保留，执行中芯片强制保持展开（「点我取消」可见）。
- **点按动效 = 能量而非几何**：星芒**冲击波**（dip-burst 光环自图标扩散收束）+ conic 描边**单圈快闪**（0.35s 一次）+ 光池亮度脉冲；芯片几何零变化。
- **对比度重测**（label+▾ 双目标 × 5 展开态 × 双主题，3x 像素双簇分割）：最差 **5.46:1**（禁用态主标签）≥ AA；几何 18/18 全过；88/88 单测。
- 过程修正：EXPANDED 选择器由逗号分组改为 **:is()**（逗号分组会把声明泄漏给组内首个选择器——`.dip-root:hover` 自己吃到 label 的 max-width，像素实测抓出）；火花 sprite 左移 1px 保住 9px 净空承诺。

## 0.6.0

分体玻璃：档位切换器从「composer 上的一个裸字符」融进主按钮的玻璃芯片。

v0.1 以来，档位切换 **⌄** 一直是主按钮旁边一个 16×22 的透明裸按钮——一个 9px 的字符直接落在 composer 自己的背景上，浅色主题下就是一颗几乎看不见的灰点，和左边的玻璃药丸完全割裂（用户原话：完全看不清、完全割裂）。

- **一颗芯片两个区**：`.dip-root` 本身成为玻璃芯片（底板 / conic 描边 / 光池 / 阴影全部升到芯片级），主区（✦ + 档位标签）与 24×28 的档位区（**▾**）共用同一块恒深海军蓝玻璃；中间 1px 发丝分隔线（两端渐隐 + 微辉光）只分开命中区，几何断言保证不穿任何字形。
- **档位区自带光池**：右侧电光蓝图池让切换区读作芯片的组成部分，而不是贴上去的凸起；悬停该区时浮起玻璃高光。
- **状态全覆盖**：hover 上浮/描边流光、busy 彗星 + 能量条 + 充能呼吸（覆盖整颗芯片）、disabled 降饱和（切换档位保持可用，▾ 反而是全状态最亮）、focus-visible 内嵌环、`prefers-reduced-motion` 全适配。
- **对比度按 3x 像素实测**（主标签与 ▾ 双目标 × 6 状态 × 双主题）：最差 **5.43:1**（禁用态主标签），全部 ≥ AA 正文 4.5:1；18 项几何断言全过（分隔线不穿字形、能量条只占底部 2px、火花净空 9px、切换命中区 ≥24×28）。
- 交互不变：主区点击 = 增强/取消，**▾** 点击 = 循环切换轻/标准；编排 / 保真闸 / 长度闸零改动。
- 美术基准：image-prompt（product-commerce-visual 模板）+ dsh-image-gen 生成的分体玻璃芯片材质图，三方对照（材质图 ↔ CSS 渲染 ↔ 像素实测）。

## 0.5.1

README / 素材收敛（用户反馈：README 贴那么多按钮图干啥）。

- 同一张 button-states.png 在两处重复贴出 → 每份 README 只留 banner + 1 张状态图；设计章节 40 行 → 15 行（迭代叙事留在本文件）。
- 删除零引用死素材 2.5MB（components.png / banner.png / banner.svg / ring-128* / bloom-192* / bloom-128-q），assets 2.9MB → 416KB。

## 0.5.0

执行中的动效与悬停拉开明显差距（用户反馈：两者看不出大区别）。

- **问题**：此前 busy 与 hover 的区别只有"描边转快一点 + 图标自转"，静态一看几乎一样，也不够酷。
- **现在 busy 有三样 hover 完全没有的东西**：
  1. **彗星描边**：1px 匀速环 → 2px 带长尾的渐变彗星（尾长从 8% 拖到 70%），1s 一圈；
  2. **底边能量条**：药丸底部内沿一条 2px 不确定进度条来回扫动（1.5s），——**结构上不可能压到文字**：它只占 28px 高药丸的 y25..27，而文字盒是 y8..20，已加断言；
  3. **整块芯片呼吸充能**：scale 1→1.028 的 2.1s 呼吸，配合光池与火花 1.1s 脉动。
- **hover 同时收敛**（把差距拉开）：描边由 2.6s 放慢到 3.4s、不透明度降到 .85，不再有扫动条/呼吸/彗星尾。
- **无动效环境**：`prefers-reduced-motion` 下 busy 用一条**静止的全宽能量条**表达"进行中"，不靠动效也能区别于 hover。
- 新增 3 条断言：能量条只占底部 2px、busy 有独立的 dip-sweep / dip-charge 关键帧、芯片自身带充能动画。
- 复测（动画冻结、3x 截图像素）：八组状态×主题最差 **9.83:1**（AA 正文 ≥4.5:1）。

## 0.4.0

按钮第五版：**对齐参照的工艺水准，而不是照搬它的配色。**

- **参照系换成 dsh-plan-board**（同一工具栏里做得对的插件）。把它的 CSS 与 DOM 从源码逐字提取进对照页，并排、同背景、同缩放做 1:1 对比，量出三处硬差距：
  - **底板随主题反白** → 浅色主题下白底 + 青色图标 + 青色描边糊成一片青（这就是"看着费劲"的直接原因）。改为**恒深海军蓝玻璃**（`#061024→#0c2144`），两个主题同一块板。
  - **112° 线性渐变在 66px 宽按钮上只显示前 1/4**（紫/洋红根本没出现）——改为宽度无关的 `conic-gradient` 描边。
  - **光在药丸外面** → 改为四个径向光池 `inset:0` + `overflow:hidden`，光出不去。
- **配色保持自己的**：青 `#22d3ee` → 电光蓝 `#2b6cff` → 金 `#f5c542`（与 banner 同源）；新增测试断言**不得出现参照插件的紫/洋红**。
- **材质三细节**（对照生成的美术基准图补出）：顶部镜面高光带、下缘暖金、光池之间保留暗底。最后一条修掉了"芯片读成蓝色果冻"。
- **清晰度改按像素实测**（底板是渐变，计算色值回答不了）：八组状态×主题最差 **8.77:1**（AA 正文 ≥4.5:1），比上一版的 6.90:1 更好。
- **美术自检方法可复现**：`npm run harness:button` 出对照页（含参照真实按钮）；image-prompt（`product-commerce-visual` 模板）+ dsh-image-gen 出本配色的材质基准图；三方对照后补工艺再复测。
- 素材沿用：图标火花（生成素材）仍在图标位，宽幅光带保持弃用（在 28px 控件上只会变雾）。

## 0.3.0

按钮第三版：**先是精确的形状，然后才是光**。前两版都栽在同一个错误上——把"炫酷"理解成"更多光"。

- **0.1.x 版**：只有一根发丝描边 + 无材质，状态区分太弱。
- **0.2.0 版**：加了一整层宽幅光晕（生成素材），实测**把整行输入区糊住**，还盖到相邻的"模型"文字上——28px 控件上大面积发光=雾。
- **0.3.0（本版）原则**：药丸是精确物件，**所有光源收在它内部**。
  - 底板：闲置幽灵态；悬停起切成主题实色 + 顶部 1px 高光 + 清晰 1px 描边 + ≤10px 彩色投影（有悬浮感不外溢）。
  - 描边光：1px 圆锥渐变沿边框带走一圈，只带 2px drop-shadow —— 读作"边上跑过的光"，不是轮廓线也不是雾。
  - 图标：内联 SVG **固定青色**（装饰件不跟随文字色：浅色主题下 currentColor 会变近黑，与身后的火花打架）+ 3px 紧致辉光；悬停放大 1.14 转 90°，进行中自转。
  - 火花：生成的星芒素材缩到 18px 贴在图标位，**盒宽 3+18=21px，标签盒从 30px 起**，留 9px 净空。
  - 文字：**去掉 text-shadow**——实测底板 13.74:1 不需要它，而深字加深影在浅色主题下会糊成灰晕。
- **素材结论**：本轮用 image-prompt 重新出提示词、dsh-image-gen 生成两张——紧凑星芒留下了（24px 下干净可读），**宽幅极光带被弃用**：形状对了但体量对 28px 控件太大，只会变雾。素材留在 assets/ 作依据，不进包。
- **清晰度**：九种状态最差 **4.90:1** 全过（AA 正文 ≥4.5:1）；火花盒与文字盒不相交、文字盒在药丸内边距内、亮态底板为实色三条不变量由自检页逐状态断言。
- 包体反而变小：内联素材从 0.2.0 的约 15KB base64 降到约 6.4KB。

## 0.2.0


按钮视觉重做（用 image-prompt 风格库出提示词 + dsh-image-gen 生成光效素材），并把"文字始终清晰可读"从口头约束变成可复现的机器验证。

- **两层生成素材**：星芒（brand-identity-package 风格）与能量环（ui-screenshot-system 风格）由 gpt-image-2 生成，提示词**禁止任何文字**；素材转成预乘 alpha RGBA、压掉黑底噪声、裁切量化后内联为 data URI（合计约 15KB base64）。**按钮文字始终由代码绘制**——生图模型渲染文字不可靠，这个分工同时保证文字在任意 DPI 下都是矢量清晰。
- **分层结构保证清晰度**：光效画在药丸自身背景之下（.dip-fx 在 .dip-seat 内、药丸 z-index:1），.dip-label 是最高层 z-index:2；旋转渐变描边用 mask-composite 只占 1px 边框带。**亮光晕 ⇒ 不透明底板**：光环可见时药丸必为实色底板。
- **交互**：闲置呼吸星芒 → 悬停旋转渐变描边 + 星芒放大旋转 + 图标辉光 → 点按 .955 缩放下沉 → 进行中能量环脉动 + 描边加速 + 图标自转 + 星芒呼吸；focus-visible 焦点环；prefers-reduced-motion 全停动效（只停动效，不影响清晰度）。
- **硬性约束机器验证**：新增 scripts/button-harness.mjs，用**真实 CSS + 真实组件 DOM** 生成自检页面，逐状态计算对比度（把祖先组不透明度折算进有效前景，避免禁用态 .82 被忽略而报出偏高数字），并断言"星芒盒与文字盒不相交""文字盒在药丸内边距内""可见光环 ⇒ 不透明底板"。最差 **4.90:1**，九种状态全部通过（AA 正文要求 ≥4.5:1）。
- **禁用态可读性修复**：原 label-dimmed + opacity:.55 实测仅 2.63:1，改为 label-secondary + .82（6.15:1 / 4.90:1）。
- 新增 2 个回归测试锁住清晰度不变量（FX 层不得使用混合模式、标签层级与忙碌态底板规则、光环仅忙碌可见）。
- 实测：88/88 单测、host/client 双类型检查、克隆副本 pnpm install --frozen-lockfile 复现 CI 全绿。

## 0.1.3

- **修掉斜杠命令被整句拒绝的设计缺陷**（用户实测反馈）：此前任何以 `/` 开头的草稿都被当作"无可改写内容"直接禁用按钮——但 `/bugfix ISS-… 用户反馈填充后密码框被清空` 这类草稿，命令后面的正文恰恰最该被增强。
  - 新增 `src/command.ts` 作为唯一权威切分：`/name` 前缀 + 用户原始分隔符（含换行/缩进）逐字保留，只把正文交给模型。
  - 两道闸门（保真 / 长度）与智能上下文判定全部改为作用于**正文**，长度比也按正文计算（命令前缀不再稀释预算）。
  - 按钮仅在"只有斜杠命令、后面没有正文"时禁用，tooltip 说明原因。
  - 新增 11 个测试：切分纯函数、命令+正文端到端（前缀回填、正文保真修复、长度按正文算）、命令无正文仍拒绝、界面启用/禁用与文案键。
- README 同步（斜杠命令行为、单测数 86）。

## 0.1.2

- **修掉「本机能过、干净环境必炸」**：`src/index.ts` 不再 `import type { Context } from 'cordis'`。本地能过是因为 `scripts/build.sh` 把 `node_modules/cordis` 链到本机 dsh 安装里的 `@deepseek-ai/cordis`；CI 里 pnpm 装的是 npm 同名包，没有该导出，类型检查直接失败。现改为宿主上下文与模型请求/流式分片全部就地结构化声明，构建产物只依赖 TypeScript 与 `@types/node`。
- 新增 GitHub Actions CI（双类型检查 + 71 单测 + 已提交产物可加载 + manifest 装配契约）与 CI 徽章。
- 已在克隆副本中用 `pnpm install --frozen-lockfile` 完整复现 CI 并全绿。

## 0.1.1

文档与渠道发布版（代码与 0.1.0 一致）。

- README 补齐证据类别：典型场景、你会看到什么、四组真实实测对照（中文硬事实 / 英文口语轻档 / 空泛输入不硬编 / 不确定处显式 TBD）、10 条逐项验收清单
- 双语 README 同步；图片改用绝对 URL，保证 GitHub 与 npm 两处渲染一致
- 发布渠道：npm `dsh-improve-prompt@0.1.1`、GitHub Release 预构建 tgz

## 0.1.0

首个版本。

- composer 工具行星芒按钮：一键直替草稿 + 一键撤回 + 增强中取消（真中断）
- **保真闸**：抽取硬事实（路径 / 文件名 / 标识符 / 数字版本 / URL / 反引号代码 / @引用），逐条校验；缺失触发一次点名修复调用，仍缺则确定性回灌
- **长度闸**：比例上限 + 200 字符绝对下限；超预算触发一次带字符预算的收敛调用，仍超则拒绝写回并说明
- 智能会话上下文（本地正则判定；只带人话与助手正文；每轮尾部 600 字符）
- 两档位（轻 / 标准），档位记忆在本地
- 行为知识外置：`prompts/discipline.md` + `prompts/light.md` + `prompts/standard.md`，支持 `$DSH_HOME` 覆盖
- 多语言（zh / en），错误码本地化
- 单次点击最多 2 次 LLM 调用；失败一律不动草稿
- 71 个单测：纯函数、stub 模型驱动的完整编排、以及**加载真实 client bundle** 的界面行为（注册契约 / 禁用态 / 点击回填 / 失败不动草稿 / 撤回 / 档位记忆 / 本地化与回退）
- host / client 双类型检查（`npm run typecheck` / `typecheck:client`）

### 设计取舍（来自实测）

- **比例闸需要绝对下限**：实机测试中 9 字草稿「把那个接口加上限流」被 2.5x 误杀 → 改为 `max(200, len x ratio)`
- **回灌优先于长度上限**：保真优先于简洁，长度闸让位于确定性回灌，并在状态条如实显示比值
- **运行时零 harness 依赖**：`@deepseek-ai/dsh-llm` 只作类型导入（构建后擦除），消息对象按结构就地构造，避免插件自带的 npm 版本与宿主运行时版本不一致
- **服务的非抛出访问**：`agentDefaultModel` / `sessions` 未列入 `inject`，改用 `ctx.get()`，让插件在缺少这些服务的 profile 里也能加载