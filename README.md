# dsh-smart-prompt

> 本插件 fork 自 hoyyang 的 [dsh-improve-prompt](https://github.com/hoyyang/dsh-improve-prompt)（MIT），现更名为 **dsh-smart-prompt**。下文的历史记录描述的是原项目。

![banner](https://raw.githubusercontent.com/hoyyang/dsh-improve-prompt/main/assets/banner.jpg)

**输入框里那颗 ✦ 按钮，点一下把你的草稿改写成 Agent 真能照着做的提示词——直接替换，可撤回，而且保证不丢东西。**

[**English**](README.en.md) · [Releases](https://github.com/hoyyang/dsh-improve-prompt/releases) · [更新日志](CHANGELOG.md)

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-improve-prompt"><img alt="npm" src="https://img.shields.io/npm/v/dsh-improve-prompt?color=2b6cff"></a>
  <a href="https://www.npmjs.com/package/dsh-improve-prompt"><img alt="downloads" src="https://img.shields.io/npm/dm/dsh-improve-prompt?color=2b6cff"></a>
  <a href="https://github.com/hoyyang/dsh-improve-prompt/releases"><img alt="release" src="https://img.shields.io/github/v/release/hoyyang/dsh-improve-prompt?color=38bdf8"></a>
  <img alt="dsh" src="https://img.shields.io/badge/dsh-%3E%3D0.1.1--rc.2-38bdf8">
  <a href="https://github.com/hoyyang/dsh-improve-prompt/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/hoyyang/dsh-improve-prompt/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-green"></a>
  <a href="https://github.com/hoyyang/dsh-improve-prompt/stargazers"><img alt="stars" src="https://img.shields.io/github/stars/hoyyang/dsh-improve-prompt?color=f5c542"></a>
</p>

## 安装

```sh
dsh plugin --profile web add github:Arrosam/dsh-smart-prompt
# 或直接从 GitHub 装（构建产物已随仓库提交，无需本地构建）
```

重启 `dsh web`，输入框工具行（发送键左侧）出现 **✦** 即成功。**零配置**：不需要 API Key，走 harness 自带的模型服务与凭据存储。最低 `dsh >= 0.1.1-rc.2`（实测 `0.1.5-rc.1`）。

```sh
dsh plugin --profile web remove dsh-smart-prompt   # 卸载
```

## 核心功能

- **一键直替** — 点击 ✦ 后 1–3 秒内把草稿**替换**成更清晰、更贴 Agent 执行的版本，不弹预览、不打断输入。
- **一键撤回** — 替换后 8 秒内可**恢复**原文；你一旦手动编辑，撤回条自动消失，绝不覆盖你的新输入。
- **保真闸** — 机械**提取**草稿里的硬事实（文件路径、文件名、标识符、数字与版本、URL、`反引号`代码、@引用），逐条**验证**改写结果里是否还在；缺失触发一次点名修复调用，仍缺则确定性**回灌**「保留原始细节」块——硬事实零丢失。生态里其他同类插件只在 system prompt 里写一句"请保留原文信息"，没有一家去验证。
- **长度闸** — 结果超预算（标准档 2.5x、且**不低于 200 字符绝对下限**）时执行一次带明确字符预算的收敛调用；仍超则**拒绝写回**、保留原文并说明原因，堵住"一句话需求变成三十行规格书"。
- **质量凭证** — 状态条直接**显示** `已增强 · 保真 5/5 · 1.0x · 2.2s`，结果可不可信一眼可查。
- **两档位** — 轻（≤1.2x，去废话消歧义）/ 标准（≤2.5x，结构化重述）；档位记忆在本地，芯片右侧 **⇄** 一键切换。
- **斜杠命令支持** — `/bugfix <正文>` 的命令前缀**原样保留**，只把后面的正文改写成更清晰版本；只有斜杠命令没正文时按钮才禁用。
- **可取消** — 增强中再次点击 ✦ 即**中断**上游请求（`AbortSignal`），草稿保持不动。
- **失败即原文** — 无模型 / 超时 / 空输出 / 网络失败时**绝不改动**你的输入，只给一句可读提示。
- **智能会话上下文** — 草稿含指代（它 / 那个 / 刚才 / it / this）或 ≤12 字无实词时自动**携带**最近 N 轮「你的原话 + 助手正文结论尾部」；本地正则判定，零额外调用。工具结果、注入上下文、图片、源码一律不带。
- **零配置开箱** — 不需要 API Key；可选配置项全部有默认值（见「进阶用法」），不配置也能用。
- **提示词模板可覆盖** — 行为知识全在 `prompts/*.md`，把同名文件放进 `$DSH_HOME/dsh-smart-prompt/prompts/` 即可**替换**纪律层与档位模板，不改一行代码。
- **本地 HTTP 接口** — `POST /dsh-smart-prompt/api/improve` 把增强能力**暴露**给自己的脚本与工具（仅回环）。
- **短草稿保护** — 长度预算取 `max(200, 字数 × 比例)`，三行以内的短草稿不会被比例预算误杀（该缺陷在实机测试中发现并已修复，有 4 个测试锁死）。

### 和已有 5 个同类插件差在哪

不做预览对比面板、不做语音识别、不做自更新、不做多阶段 LLM 流水线、不做模型链 / 看门狗、不做记忆链、不扫项目源码、不做澄清提问闭环。**只做一件事：点一下，拿到更好的提示词，并且确信它没改坏你的意思。**

**每次点击最多 2 次 LLM 调用**（一次生成 + 一次修复），不是流水线。

## 快速上手

1. **输入**一句口语草稿——一句话、有错别字都行：
   > 就是那个 帮我把 src/host/config.ts 里的 maxRatioFor 改成 2.5 呗，用 `pnpm build` 验证一下
2. **点击**输入框工具栏的 **✦ 星芒圆标**——悬停时芯片向左展开成「✦ 标准 │ ⇄」（平时收起为 28px 星芒圆标，草稿非空时呼吸微光）
3. 等 1–3 秒，草稿被替换：
   > 把 `src/host/config.ts` 里的 `maxRatioFor` 改成 `2.5`；用 `pnpm build` 验证一下。
4. 看输入框上方的质量凭证状态条：`已增强 · 保真 5/5 · 1.0x · 2.2s`
5. **点**「撤回」**恢复**原文（替换后 8 秒内有效；你一旦手动编辑，撤回条自动消失）
6. **点击**芯片右侧的 **⇄** 即时切换轻 / 标准档位（档位记忆在本地）
7. **点击** ✦ 再次**取消**增强中的本次请求，草稿不动

### 使用示例

真实输入 → 输出对照（①–④ 为本机对真实模型的实测，见「真实实测对照」全记录；后两行为文档化行为）：

| 输入 | 输出 |
|---|---|
| 就是那个 帮我把 src/host/config.ts 里的 maxRatioFor 改成 2.5 呗，顺便看看 https://example.com/a?b=1 那个文档，用 `pnpm build` 验证一下 | 把 `src/host/config.ts` 里的 `maxRatioFor` 改成 `2.5`，同时看一下 https://example.com/a?b=1 这个文档，然后用 `pnpm build` 验证一下。（保真 5/5 · 1.0x） |
| I was kind of wondering if you could maybe take a look at the login flow and see if there is any way we could possibly make it a bit faster | Take a look at the login flow and see if there's any way we can make it faster — it feels slow to me.（0.6x 轻档） |
| 加个功能 | 加个功能（信息不足时不编造，原样返回是正确行为） |
| 把那个接口加上限流 | 给那个接口加上限流 + 结构化追问：(TBD: 具体接口 / 阈值窗口 / 超限行为)，事实零编造 |
| /bugfix ISS-202607-00090605A 用户反馈填充后密码框被清空，帮忙查一下 | `/bugfix ISS-202607-00090605A` 前缀逐字保留 + 只改写后面的正文 |
| 增强进行中再点击一次 ✦ | 真正中断上游请求，草稿保持原样 |
| 点「撤回」（替换后 8 秒内） | 原文逐字恢复，改写稿丢弃；手动编辑过则撤回条自动消失 |
| 未配置模型时点击 ✦ | 明确报错「未找到可用模型：请先在设置里选默认模型」，原文一字不动 |

脚本与工具集成示例：

```sh
# 用本地 HTTP 接口把增强能力接进脚本（仅回环）
curl -X POST http://127.0.0.1:3080/dsh-smart-prompt/api/improve \
  -H 'content-type: application/json' \
  -d '{"text":"把那个接口加上限流","sessionId":"sess-1","mode":"standard"}'
```

```sh
# 斜杠命令：前缀原样保留，只改写正文
/bugfix ISS-202607-00090605A 用户反馈填充后密码框被清空，帮忙查一下根因
```

覆盖提示词模板（不改代码）：

```sh
# 把同名模板放进该目录即生效
cp my-discipline.md $DSH_HOME/dsh-smart-prompt/prompts/discipline.md
cp my-standard.md $DSH_HOME/dsh-smart-prompt/prompts/standard.md
```

调整默认档位与上限（配置键说明见「进阶用法」）：

```yaml
# profile 的 cordis.patch.yml 片段
- insert:
    - id: dsh-smart-prompt
      config:
        defaultMode: light
        standardMaxRatio: 2.5
```

## 按钮视觉与交互

![四态 × 明暗主题（真实 CSS + 真实 DOM 渲染）](https://raw.githubusercontent.com/hoyyang/dsh-improve-prompt/main/assets/button-states.png)

**精确的形状优先，光次之，且所有光源都收在芯片内部**（外壳 `overflow:hidden`）。芯片平时**收起为 28px 星芒圆标**（草稿非空时呼吸微光），悬停时右缘钉住、向左展开——展开真实改变布局宽度，左邻控件自动平移让位（宿主 trailing 簇右缘锚定，间距恒定）。底板是**恒深海军蓝玻璃**，两个主题同一块板、不反白；描边是宽度无关的 `conic-gradient`；配色是插件自己的青 → 电光蓝 → 金（与 banner 同源）。主按钮与档位切换 **⇄** 融合为一颗**分体玻璃芯片**：一块底板两个区，档位区自带电光蓝图池，中间 1px 发丝分隔线只分开命中区、绝不穿过字形。

| 状态 | 表现 |
|---|---|
| 收起（默认） | 28px 星芒圆标 + 草稿非空时的呼吸微光（空草稿=暗星）|
| 悬停展开 | 右缘钉住、向左展开成完整分体芯片（左邻控件自动平移让位，间距恒定）|
| 完全展开 | 深色玻璃芯片（主区青色光池 + 档位区电光蓝图池）+ 完整渐变描边 + 发丝分隔线；描边提亮并慢速绕行（3.4s/圈）|
| 点按 | 星芒**冲击波**光环自图标扩散收束 + 描边单圈快闪 + 光池脉冲（芯片几何零变化）|
| **执行中** | **与悬停明显不同**：2px **彗星描边**（长尾）、底边**扫动的能量条**、整块芯片**呼吸充能**、图标自转 |
| 禁用 / 焦点 | 去饱和压暗、描边熄灭；`focus-visible` 保留焦点环 |
| 降低动效 | `prefers-reduced-motion` 下动画全停；执行中改用一条**静止全宽能量条**表达 |

### 文字清晰度：硬性约束 + 像素实测

没有任何光源在文字底下——火花只占图标位（净空 9px）、描边被 `mask-composite` 限制在 1px 边框带、能量条只占底部 2px（y25..27，两个文字盒都在 y8..20）、分隔线两端各留 7px 不触顶底。底板永不半透明，所以对比度在两主题、全状态下都成立。主标签与切换 **⇄** 双目标分别由 **3x 截图的像素**算出（底板是渐变，计算色值回答不了）：

| 状态 | 主标签 暗/浅 | 切换 ⇄ 暗/浅 |
|---|---|---|
| 闲置 | 8.45 / 8.45 | 9.97 / 9.97 |
| 悬停（主区） | 8.78 / 8.77 | 10.57 / 10.49 |
| 悬停（档位区） | 9.09 / 9.09 | 9.36 / 9.36 |
| 点按 | 8.35 / 8.35 | 9.56 / 9.56 |
| 执行中 | 8.47 / 8.47 | 10.21 / 10.21 |
| 禁用 | 5.43 / 5.43 | 11.56 / 11.56 |

最差 **5.43:1**（禁用态主标签；WCAG AA 正文要求 ≥4.5:1），切换 **⇄** 在禁用态反而最亮（11.56:1），因为主区禁用时切换档位仍然可用。`npm run harness:button` 会生成一个把本插件按钮与 dsh-plan-board 真实按钮并排的对照页，可复现全部结论。

## 典型场景

1. **口语化需求一次说清** —— 「帮我看看能不能把那个登录接口改得快一点，就是感觉有点慢」→ 去掉口水词，保留你的判断（"感觉有点慢"），不替你决定优化手段。
2. **带路径与标识符的改动请求** —— 保真闸价值最大的场景：文件路径、函数名、版本号、URL、反引号代码在改写后逐字保留，不会被同义替换吃掉。
3. **英文长句去废话** —— 轻档把 "I was kind of wondering if you could maybe..." 压成一句可执行的英文请求。
4. **续写式草稿** —— 上一轮刚讨论完某个接口，本轮只写「把那个接口加上限流」；智能上下文把最近几轮带上，改写结果能接上刚才的方案。
5. **点错了 / 结果不满意** —— 8 秒内点「撤回」恢复原文；你一旦手动编辑过，撤回条自动消失，绝不覆盖你的新输入。
6. **空泛草稿不硬编** —— 「加个功能」这类输入不会被编成一份虚构需求书：模型被纪律层要求"宁可不改也不编"，你看到的是原样返回或结构化 (TBD) 追问。
7. **斜杠命令带长正文** —— `/bugfix <一大段复述>`：前缀逐字保留，只有正文被改写成排查步骤清晰的版本，命令解析不受影响。
8. **脚本与工具集成** —— 通过 `POST /dsh-smart-prompt/api/improve` 把同一套增强管线接进你自己的脚本、CI 或编辑器工具，仅回环不出网。
9. **中英混合草稿** —— 中文句子里夹英文路径、函数名、版本号：保真闸把它们当硬事实逐字保留，翻译腔不会吃掉标识符。
10. **长草稿怕膨胀** —— 口语化长段输入标准档：结构化重述受 2.5x 预算约束，超预算先收敛一次，仍超则拒绝写回，不会悄悄给你三十行规格书。
11. **报错原文直接贴** —— 把栈报错或校验日志整段贴进草稿：路径、类名、版本号被当硬事实逐字保留，你的诉求被改写成一句可执行的排查请求。

## 你会看到什么

- **质量凭证** —— 状态条：`已增强 · 保真 5/5 · 1.0x · 2.2s`
- **撤回入口** —— 同一条上的「撤回」按钮，8 秒自动消失（失败提示停留 12 秒）
- **回灌提示** —— 只剩确定性兜底时才出现：`已增强 · 保真 5/5 · 1.4x · 3.1s · 已回灌 src/a.ts`
- **原文保留块** —— 回灌时正文末尾追加 `保留原始细节 / Preserved original details:` 加逐条硬事实
- **失败提示（原文不动）** —— 「增强超时（180000ms），原文未改动」/「未找到可用模型：请先在设置里选默认模型」/「增强结果超出长度上限（…），已保留原文」
- **档位标签** —— 按钮上直接显示当前档位（轻 / 标准）；芯片右侧的 **⇄** 一键切换
- **芯片两态** —— 平时 28px 星芒圆标，悬停展开为「✦ 标准 │ ⇄」分体玻璃芯片（左邻控件自动让位）
- **接口返回** —— `POST /api/improve` 返回改写正文与凭证字段（保真计数 / 长度比 / contextUsed / 耗时），脚本可直接消费
- **取消反馈** —— 中断后状态条立即消失、草稿原样保留，无残留定时器与半截文本

## 真实实测对照

以下四组都是本机对真实模型跑出来的结果，不是构造的演示。

**① 中文 + 硬事实（标准档）**

```text
输入：就是那个 帮我把 src/host/config.ts 里的 maxRatioFor 改成 2.5 呗，顺便看看 https://example.com/a?b=1 那个文档，用 `pnpm build` 验证一下
输出：把 `src/host/config.ts` 里的 `maxRatioFor` 改成 `2.5`，同时看一下 https://example.com/a?b=1 这个文档，然后用 `pnpm build` 验证一下。
凭证：保真 5/5 · 1.0x · 2.2s
```

要点：路径、标识符、版本号、URL、反引号代码逐字保留；只删掉"就是那个""呗"这类噪声。

**② 英文口语（轻档）**

```text
输入：I was kind of wondering if you could maybe take a look at the login flow and see if there is any way we could possibly make it a bit faster, it feels slow to me
输出：Take a look at the login flow and see if there's any way we can make it faster — it feels slow to me.
凭证：0.6x
```

**③ 空泛输入（标准档）—— 不硬编**

```text
输入：加个功能
输出：加个功能
凭证：1.0x
```

要点：模型被要求"信息不足时不要发明需求"，原样返回是正确行为。

**④ 不确定处显式标注（标准档）**

```text
输入：把那个接口加上限流
输出：给那个接口加上限流。

- 目标接口：(TBD: 具体是哪个接口/路由)
- 限流规则（阈值与时间窗口）：(TBD: 例如每秒/每分钟允许多少次)
- 超限后的行为：(TBD: 例如返回 429 还是拒绝/排队)
- 除新增限流外，原有逻辑保持不变。
```

要点：**结构补上了，事实一个没编。** 信息缺口用 `(TBD: …)` 显式留给你，而不是猜一个填进去。

## 进阶用法

全部配置可选、全部有默认值；行为可按需调整的三条路径：

- **改配置** —— `cordis.patch.yml` 调整默认档位、长度上限、超时、上下文轮数（见下方配置表）。
- **改提示词** —— 覆盖 `prompts/*.md` 模板，纪律层与档位文案随你改，不动代码。
- **接脚本** —— `POST /dsh-smart-prompt/api/improve` 把增强能力接进脚本与工具。

### 配置

写在 profile 的 `cordis.patch.yml`：

```yaml
- insert:
    - id: dsh-smart-prompt
      name: 'dsh-smart-prompt'
      config:
        defaultMode: standard      # light | standard
        lightMaxRatio: 1.2         # 轻档长度上限
        standardMaxRatio: 2.5      # 标准档长度上限
        acceptanceCriteria: false  # 标准档追加"可验证验收条款"
        temperature: 0.3
        maxTokens: 8192
        timeoutMs: 180000
        maxInputChars: 20000
        contextTurns: 3            # 会话上下文轮数；0 = 关闭
        contextChars: 6000
        smartContext: true         # 智能判定是否带上下文
        fidelityGate: true         # 保真闸
        lengthGate: true           # 长度闸
        provider: ''               # 与 model 成对填写则覆盖会话模型
        model: ''
        reasoningEffort: low        # 默认 low：改写是浅任务，避免深思考拖到超时；off/high/max 可改
        logFailures: true
```

**模型路由**：显式 `provider` + `model` → `agentDefaultModel` 当前选择 → 最近一次真实模型调用的路由。三者皆无 → 明确报错，不动草稿。

### 改提示词不用改代码

行为知识全在 `prompts/*.md`：`discipline.md`（全局纪律）+ `light.md` / `standard.md`（档位模板）。覆盖方式：把同名文件放到 `$DSH_HOME/dsh-smart-prompt/prompts/`。

### 本地 HTTP 接口

`GET /dsh-smart-prompt/api/config` 读当前档位与上限；`POST /dsh-smart-prompt/api/improve`（body `{text, sessionId?, mode?}`）执行增强。仅回环。

## 工作原理

```
composer 草稿
   │
   ├─ 本地守卫（空 / 只有斜杠命令没正文 / 超长）──────► 拒绝，零模型流量
   ├─ 斜杠命令前缀切分（/bugfix 正文 → 前缀原样保留，只改写正文）
   │
   ├─ 智能上下文判定（本地正则）──命中──► 读会话最近 N 轮（仅人话 + 助手正文）
   │
   ├─ 保真闸：抽取硬事实（本地，零调用）
   │
   ├─ 第 1 次 LLM 调用（system = prompts/discipline.md + prompts/<mode>.md）
   │
   ├─ 两道闸同时判定
   │     ├─ 有缺失 或 超预算 ──► 第 2 次调用（两条抱怨一次说清）
   │     └─ 都过 ─────────────► 直接产出
   │
   ├─ 仍缺硬事实 ──► 确定性回灌「保留原始细节」块（保证零丢失）
   │
   └─ 最终长度判定（回灌优先于上限）──► 写回 or 拒绝并说明
```

宿主半是一个回环路由 + 编排器，浏览器半只在 `conversation.input.right` 注册一个按钮、在 `conversation.input.overlay` 注册一个状态条。**运行时依赖为 0**（`@deepseek-ai/dsh-llm` 只作类型导入，构建后擦除）。

## 可靠性与验收

发布前跑过的验证，逐条都是实跑结果：

1. **88 个单测全绿** —— 纯函数（硬事实抽取 / 保真校验 / 长度判定 / 上下文判定 / 输出规范化 / 会话历史 / 斜杠命令切分）＋ 用 stub 模型驱动的**完整编排**（修复轮、回灌、拒绝、超时、取消、上游异常、注入防护）＋ **加载真实 client bundle** 的界面行为（注册契约 / 禁用态 / 点击回填 / 失败不动草稿 / 撤回 / 档位记忆 / 本地化与回退）。
2. **host / client 双 TypeScript 严格检查**通过（`npm run typecheck` 与 `typecheck:client`）。
3. **冷启动三故障静态检测全绿**：link 依赖 junction、bundle manifest、disabled 状态矛盾；外加 `dsh --dump-config` 组合复检无错误。
4. **卸载即净实测**：路由注销、junction 删除、profile 清单零残留、loader entry 与 client 模块表清理。
5. **重装幂等实测**：二次注入返回「已激活运行，跳过注入」，不产生重复条目。
6. **反向安装验收**：在隔离 staging home 里分别用 `dsh plugin add dsh-improve-prompt`（npm）与 `dsh plugin add github:hoyyang/dsh-improve-prompt` 各装一次，产物完整、配置组合正确。
7. **真实模型端到端**：含路径 + 标识符 + 版本号 + URL + 反引号代码的草稿 → 保真 `5/5`、`1.0x`（见上方实测对照①）。
8. **轻档去废话实测**：英文口语长句 → `0.6x`（对照②）；空泛输入 → 原样返回（对照③）。
9. **智能上下文实测**：同一句「把那个接口加上限流」带 sessionId 时报 `contextUsed: anaphora` 并真的引用了会话内容；不带 sessionId 时报 `none` 并改用 TBD 标注。
10. **实机修掉一个真实设计缺陷**：9 字草稿按 2.5x 只允许 22 字，被长度闸误杀——正是最需要增强的那类输入。改为 `max(200, 字数 × 比例)`，并补 4 个测试锁死语义。

## 常见问题

**增强后没变化？** 草稿已经很精确时，纪律层要求"只做轻量清理"，不改内容是正确的输出。

**状态条显示「已回灌 xxx」？** 模型两次都没保住某个硬事实，插件确定性把它补回正文末尾。内容零丢失，代价是格式上多了一小块。

**为什么短草稿会变长好几倍？** 长度闸对短草稿用的是 200 字符绝对预算而非比例——否则它最需要的三行结构会被拒掉。

**带了会话上下文吗？** 状态条显示 `已参考会话` 就是带了。默认只在草稿含指代或过短时才带；`contextTurns: 0` 可完全关闭。

**用的是哪个模型？** 跟随你当前会话的默认模型；想固定成更便宜的模型，填 `provider` + `model`。

## 本地构建

```sh
pnpm install
npm run build          # host: tsc → lib/
npm run build:client   # client: tsdown → lib/client.js（window.__ModuleLoader__ 格式）
npm test               # 88 个单测
npm run typecheck && npm run typecheck:client
```

## 许可证

[MIT](LICENSE)
