# #179 / #181 / #196 逐条验收与全部已分配任务核对

> Baseline audit of main `4a33033`. The subsequent implementation and validation are tracked in [Material workflow delivery](material-context-delivery-20261117.md).

核对日期：2026-11-17。负责人：HarveyYellow / Jingyuan Huang。

**结论：主流程已可用；三个任务不能统一表述为“已完全对齐原型”。上游没有正式数据服务，不妨碍现在完成接入结构、状态交互和模拟契约验收；这些准备工作目前仍有缺口，应由本项目继续完成。**

## 1. 依据、版本与判定方法

- GitHub 仓库：`AI4STEM-Education-Center/GENIUS-EngageAgent`；本次重新读取 HarveyYellow 的全部已分配 issue，共 10 个：7 Open，3 Closed。#179、#181、#196 均没有补充评论。
- 当前代码基线：`4a33033fdb0b2c7f4bac82a834816666ecf5ce87`，与远端 main 一致。对应 PR #221 合并后的生产版本；上轮已确认 Amplify 117 成功。
- 原型：用户提供的 `EngageAgent-UI-v8.4-prototype_1 (1).html`。以下 H 编号对应该原始文件的行号和函数名；原型是独立演示，不具有真实后端。
- 讨论：用户粘贴的会议文本。本次未取得其中 SharePoint DOCX 附件的完整正文，不能声称已审阅那些附件。
- 本次后台内置浏览器：实际查看原型 Step 2/3，以及生产教师任务、Class profile、独立 Gallery、保存材料编辑、Share to Gallery。未使用个人浏览器或桌面监控。
- 上轮真实生产验收：AI 经验建议、6 页 Analogy 幻灯片及 3 张图、私有保存再打开、发布到合成测试班级、学生两条问题及评分、刷新完成状态、视频文字改编后保存。见此前 production-acceptance.json；这些属于已有实测证据，不能冒充本次重新逐项实测。
- 本次是需求审查和接入设计；不修改生产数据，不重新运行付费生成，不把文档设计称为已上线实现。

判定使用：**已实现**（注明代码或实测证据）、**部分实现**、**未实现**、**待完整验收**、**有意差异**。测试通过只能证明测试覆盖的行为，不能代替需求覆盖；Closed 也不能代替产品验收。

## 2. 要求优先级及原型冲突

| 项目 | Issue / HTML / 讨论的差别 | 本次验收采用的规则 |
| --- | --- | --- |
| Step 3 推荐位置与数量 | HTML 在生成区背景输入下展示，最多 2 条；没有匹配时显示空提示 | 采用用户后来明确要求：生成区域最上方、最多 3 条、相关性排序，无合适材料隐藏 |
| 是否先选择 Gallery / 从零生成 | #179 截图含旧版 Start from Scratch / A Gallery item；新版 HTML 是推荐卡 | 不恢复旧二选一入口。自动查询推荐，教师可 Use as is / Adapt / Generate new |
| 完全自动复用或生成 | 会议文本提出“有相同内容则显示，否则自动生成”；现实现仍需点击生成 | 这是比当前交互更强的会议方案，尚未完整实现。不能声称与该句话完全一致；最新直接指令明确了前三条推荐规则，但没有清楚取消所有生成按钮 |
| 选择几个焦点 | HTML 的 Cognitive Conflict 一处单选，Engaged Critiquing 1–2 | 按 #179 明文，误解点允许 1–2；保留目前按策略选本课程焦点的能力 |
| 材料归属 | HTML 有顶层 Gallery，但大量操作仍依赖演示班级状态 | 按用户要求，材料独立于班级；发送时再选择班级/任务 |
| 学生反馈 | HTML 七类标签不包含完整评分/提问统计 | 属于用户追加要求；作为独立反馈信息保留，不能混入“原始生成参数” |
| 原型假数据和按钮 | GLIB、EXPERIENCES、AI_EXP 为静态数据；Edit in GENIUS 只是 toast；部分分享选项未被提交逻辑使用 | 复现交互意图，不复制假统计、无效按钮或数据丢失缺陷 |

## 3. #179 一对一核对

原文：[2-Engagement material](https://github.com/AI4STEM-Education-Center/GENIUS-EngageAgent/issues/179)，状态 **Open**。下表英文为条款的对应摘要，不冒充逐字引用；完整抓取正文保存在审查证据目录 `assigned-issues.json`。

| ID | English requirement / 中文要求 | HTML 对应 | 当前结果与差距 | 判定 |
| --- | --- | --- | --- | --- |
| 179-01 | Reuse and edit Gallery materials / 复用并修改已有材料，避免重新生成 | H6 Use as is / Adapt；H8 Gallery；H4 编辑器；issue 截图 a/d | 独立副本、直接编辑、服务端保存、再次打开已存在；Use/Open 不自动调用生成。真实保存再打开已验收 | 已实现 |
| 179-02a | Include the class profile / 引入班级画像 | H1 Class profile 与首次填写窗口 | 地区、最多三个人群顺序、班级类型、EL/IEP 支持及本地存取已有；生成和修改会读取画像摘要。原型的只读 From GENIUS / Edit in GENIUS 交互尚未对应 | 本地能力已实现；来源交互部分实现 |
| 179-02b | Use GENIUS profile data / 对应原型的上游画像接入 | H1 From GENIUS | 当前 `/api/class-profile` 是本应用存储；没有 provider adapter、来源版本、同步时间、过期/不可用/权限状态、上游变更确认流程 | 接入准备未完成；真实服务待联调 |
| 179-03a | Replace the survey evidence with experience check-in / 使用经验签到摘要 | H2 Step 2 From the experience check-in | 已用真实本地 survey-analysis 呈现人数、做过/看过、其他经验、少于三人提示；有 loading/error/retry。名称已变，但数据源仍是本地调查分析，不是 GENIUS 服务 | 部分实现 |
| 179-03b | GENIUS supplies experience data / GENIUS 提供经验数据 | H2，issue 明确说明当时服务未提供 | `TaskInterests` 已有分析时间、stale、人数，可复用；UI 未显示缓存过期/分析时间，缺来源和同步契约。选中的经验仅保存文字，没有稳定 activityId/版本/来源 | 接入准备未完成 |
| 179-04a | Select one or two lesson misconceptions for Cognitive Conflict / Engaged Critiquing / 两种策略可选 1–2 个本课误解点 | H2 strategy focus；#179 正文覆盖 HTML 单选演示 | 策略决定焦点类型，课程约束及 1–2 项校验已有；不应退回原型单选 | 已实现 |
| 179-04b | Select lesson core ideas for Analogy / Experience Bridging / 类比与经验桥接选择核心概念 | H2 strategy focus | 核心概念选择、任务/策略/焦点作用域已有，已用于生成、改编及匹配 | 已实现 |
| 179-05a | Put the class profile summary in the generation prompt / 班级摘要必须参与提示词 | H3 defaultCtx 与 Classroom context | 服务端实际拼入画像与教学背景，包含选定经验/年级；并非仅显示 UI 卡片 | 已实现（代码证据） |
| 179-05b | Show editable Classroom context / 展示可编辑的上下文摘要 | H3 defaultCtx 自动预填 | 现在输入框默认空，提示“画像会自动使用”；四张卡能看摘要，但教师无法在输入框直接审阅完整有效上下文。没有“自动摘要 + 我的补充”的清楚版本关系 | 部分实现 |
| 179-06a | Recommend Gallery items by matching task tags / 按任务标签推荐 | H6 七维匹配 | 已比较 lesson / strategy / focus / grade / prior quiz / experience / format；相同课程内容、策略、格式和焦点先筛选，再按已知匹配数排序。最多三条、置顶、无匹配隐藏已完成 | 主要行为已实现 |
| 179-06b | Reliable matching / 参数匹配必须可靠 | H6 七标签 | 年级/quiz/经验仍主要按标准化后的字符串相等判断；分享端自由输入可能让 Grades 7–8 与 Middle school 互不匹配；没有稳定经验 ID 或同义映射。旧材料无 promptTags 会被推荐筛选排除。不是语义推荐，也没有七维总分门槛 | 部分实现，需标准化和旧数据补录 |
| 179-07a | Use the recommendation as is / 原样使用推荐 | H6 Use as is | 复制并保留内容，不触发 AI；编辑/保存/发送为独立动作 | 已实现 |
| 179-07b | Ask AI to adapt to the task / 按当前任务自动改编 | H6 Adapt | 已把当前任务焦点、年级、所选经验、授权班级背景带入并执行一次真实 AI 改编；不再只是打开副本等待手填指令。幻灯片真实改编及保存已有验收 | 已实现（slides）；video 为文字改编 |
| 179-07c | Adapt video media as needed / 视频改编边界（原文未独立指定媒体重生成） | H5 视频活动 | 当前视频改编只改活动文字和问题，保留原画面、证据与阶段，不重新生成 MP4。不能宣传为“视频内容也已自动换成当前班级的场景” | 边界需明确；非逐字 issue 独立条款 |
| 179-08 | Share newly generated materials to Gallery / 新材料可分享 | H7 分享窗口 | 真正分享、服务端归属、独立于发送学生已完成；继承年级/经验/quiz 和 Include teacher notes 有效。分享窗口布局及完整标签摘要仍有下面的差距 | 功能已实现；UI 部分对齐 |

## 4. #179 原型补充交互逐项核对

这些条目来自 HTML 或用户补充，不能全部说成 #179 正文逐字要求。

| ID | HTML / 用户交互 | 当前状态 | 未完成或改进项 |
| --- | --- | --- | --- |
| UI-01 | 带人数的经验选择、AI 建议、自定义经验 | 已实现；AI 示例与真实学生报告明确区分，真实报告才显示人数 | 改用稳定经验 ID 并保存来源；刷新后恢复建议/fit 状态 |
| UI-02 | 切换 core idea 即显示 weak fit；好匹配少于 2 时提示 | fit 能由真实 AI 计算 | 当前要先点 Suggest experiences 才计算报告经验的 fit，未计算时没有清楚标记；缺少原型的不足两项提示 |
| UI-03 | 生成区四张上下文卡、格式选择、Generate/Review 锚点 | 已有 | 卡片的具体排版、背景摘要编辑尚未完全相同；Grade 为合理新增 |
| UI-04 | 新生成材料保存到个人材料库 | slides / video 均已有，可独立重开 | 不应继续列为未实现；后续保留发布版本与私有版本的隔离回归 |
| UI-05 | 缩略图、大预览、正文/备注、标题/正文/思考任务 | 已实现；本次线上看到六页编辑器和备注 tab | 继续统一标题层级/操作密度，不需要重做核心编辑能力 |
| UI-06 | 整套/单页 AI 修改、Undo、变化提示 | 已实现 | 原型的逐缩略图 Revised 标记与“未变页面”摘要未完整对应 |
| UI-07 | 每页 Video link 添加/更新/移除/播放 | 已实现；教师、学生、放大视图使用同一字段 | PPTX 是外部超链接，不是将远程视频嵌入 PowerPoint；这是明确格式边界 |
| UI-08 | Check slides 的 6 类 / 15 项 rubric | 有真实文字/图片检查 | 未按原型逐项展示 rubric、已检查/不适用/待检查状态。原型也只做少量演示启发式，不可照搬“默认通过” |
| UI-09 | 每条问题 → Go to slide → Fix with AI | 已有定位与定向修复 | 当前依赖问题文字中的 Slide N / image ID 正则；无 ID 则整套修改。缺结构化 findingId、稳定 slideId、修复后重检与 Fixed 状态 |
| UI-10 | 教师全屏演示、显示/隐藏 notes、键盘翻页 | 当前有放大预览和翻页 | 放大对话框不等于原型完整 presenter；该套演示交互待补齐 |
| UI-11 | 视频左侧播放器、右侧四阶段；底部下载/分享/发送 | 视频活动、播放和文字修改可用 | 当前 Step 3 仍包含旧的图/视频 Save/Refine 控件和纵向活动区，未达到原型布局；Gallery 视频编辑无清楚的独立 Download video 主按钮 |
| UI-12 | 分享时标题/年级/topic/七标签预览 | 标题与部分默认值已继承 | 年级/quiz 为自由文本，topic 没有对应可编辑入口，缺前置七标签摘要；班级/教学摘要仍空白需重填，窗口比原型长 |
| UI-13 | Include teacher notes | slides 的开关真实生效，共享快照去备注，私有原稿保留 | 已实现；原型演示的提交 handler 没有完整使用此开关，当前实现应保留 |
| UI-14 | Remove class details | 结构化私有课堂背景不随共享快照公开，提供文字/备注/图片审阅确认 | 不会自动识别/清除正文、图片和备注中的所有班级信息。原型也未真正完成自动清理；不能把勾选框等同于自动脱敏完成 |
| UI-15 | 简洁主操作；保存/下载/发送；AI 放 Advanced | slides 主操作已符合用户要求，本次线上确认 | 分享在 Advanced 内属于用户简化后的有意差异；视频仍需要同一套操作收敛 |

## 5. #196 一对一核对

原文：[Gallery](https://github.com/AI4STEM-Education-Center/GENIUS-EngageAgent/issues/196)，状态 **Closed**。

| ID | English requirement / 中文要求 | HTML 对应 | 当前结果 | 严格判定 |
| --- | --- | --- | --- | --- |
| 196-01 | Relate each material to its creator / 建立作者与材料归属 | H8 作者 | 新材料用授权身份记录 ownerId / creatorName；改编保留 derivedFrom。线上新材料正常显示作者，旧材料仍有 Author not recorded | 新数据已实现；历史恢复/补录流程未完成 |
| 196-02 | Track teachers using a material / 跟踪使用教师人数 | H8 “14 teachers using” | 当前按“成功保存可编辑副本”的教师去重，预览/打开/失败/重复保存不增加；UI 如实说明 saved a copy | 已实现此前约定的保存口径；尚不是实际发送/上课使用人数 |
| 196-03a | Tags include all prompt variables / 标签包含生成使用的全部变量 | H6 七类摘要、H7 分享标签；原文比七类更广 | 现有丰富 promptTags，但分享时重新构建，非当次生成输入的完整快照。slides 重建时没有实际诊断/背景；video 只手工构建部分变量。模型/提示词来源在本地 deck 存在，不完整保存在 Gallery Source/CopySnapshot | **部分实现，不能判完全完成** |
| 196-03b | Use tags to suggest Gallery materials / 标签用于推荐 | H6 | 七维已参与排名；标签标准化、真实生成上下文与分享摘要一致性尚不足 | 主要逻辑已有；数据可靠性待完善 |
| 196-04 | Filter by Lesson and strategy / 按课程与策略筛选 | H8 | 组合筛选、格式、年级与作者/标签搜索已有；强于原型互斥快捷按钮 | 已实现，有意保留增强 |
| 196-05 | Preview materials in Gallery / Gallery 内预览 | H8 Preview | 实际预览 slides / video，区分预览和保存副本 | 已实现；原型 Preview 按钮没有完整事件，不能复制无效行为 |

**#196 的关键修正**：应分别保存“私有、可追溯的生成输入快照”和“教师审阅过的公开标签”。原文的 all variables 不等于向其他教师公开班级画像原始信息或学生原话；也不等于把分享时的默认值当成当初真实输入。

历史材料应先判断能恢复什么：已有 ownerId / 来源链 / 原始生成记录可以用于确定性补齐；有依据的重建需标明 reconstructed；未知内容保留未知，同时提供有权限的作者确认、标签补录和审阅流程。当前没有该迁移闭环。

## 6. #181 一对一核对

原文：[3- Student view- material](https://github.com/AI4STEM-Education-Center/GENIUS-EngageAgent/issues/181)，状态 **Open**。正文只有“Change based on the new UI version”和一张截图。以下细项来自截图及 H9，不能称为 issue 的额外文字条款。

| ID | English UI requirement / 中文要求 | 来源 | 当前结果与边界 | 判定 |
| --- | --- | --- | --- | --- |
| 181-01 | Explore and ask / 同一页面阅读、提问、评分 | issue 截图 + H9 | 主流程、标题、问题/评分区域已经对应 | 已实现 |
| 181-02 | Read slides / watch video; page controls / 阅读、播放、页码、翻页、放大 | 截图 + H9 | 真实发布材料可读，页内视频字段也支持；上轮生产读六页并放大验证 | 已实现 |
| 181-03 | Predict before evidence / 先预测再看证据 | H9 Cognitive Conflict | 已有预测门槛及随后对照；按学习者/任务/发布版本隔离，当前同会话刷新可恢复 | 已实现；不是跨设备服务端草稿 |
| 181-04 | Add another question and submit / 多问题提交 | 截图 + H9 | 多问题真实保存，上轮两条问题提交验证 | 已实现 |
| 181-05 | Rate only after question submission / 提问后评分 | 截图 + H9 | 门槛、真实评分及完成状态、重新打开已衔接 | 已实现 |
| 181-06 | Student content only / 学生只见已发送版本 | 实际业务要求，原型不具后端隔离 | 私有备注和编辑配置会剥离；老师私有改动不立即改变学生版本，含 legacy 视频数据处理 | 已实现且有实测/测试证据 |
| 181-07 | Simple material reader / 简洁阅读布局 | 截图为一个 reader | 当前可展示多个已发布材料及逐材料评分；功能更广，但多个 reader 堆叠和多个评分区不等于原型单一画布 | 有意扩展；多材料体验待收敛 |
| 181-08 | Consistent detail behavior / 小屏、键盘、错误状态 | 从原型体验推导的质量项 | 本次未完整重跑所有屏宽、网络故障、各视频 provider 的矩阵 | 待完整验收，不用“全功能 OK”覆盖 |

## 7. 用户追加的表现与评分

| 要求 | 已有 | 仍缺什么 |
| --- | --- | --- |
| 平均评分、评分人数、高评分比例 | 真实评分聚合，不使用演示数；不可用与零值区分 | 显示统计时间/版本范围；避免混合原版和大量改编版后让教师误读 |
| 提问人数、数量、科学问题比例 | 已有统计；科学问题比例基于已分类问题，不伪造未分析结果 | 多材料任务的提问还没有材料级归属，当前为避免重复计数将其排除；需问题提交时带 publicationId/materialRevision |
| 学生在材料上的表现 | 当前可以说明反馈、参与提问和问题类型 | 不能据此称“知识掌握提高”。可以预先设计测验关联、样本量/覆盖率、前后测配对和缺失状态；真实可比数据到位后才显示变化 |
| 实际教师使用 | 成功保存副本教师数已有 | 独立记录发送教师数、实际访问学生数；三种口径不可混名 |

## 8. 其余已分配任务

| Issue / 状态 | English summary / 中文描述 | 与 HTML 的关系 | 当前判定 |
| --- | --- | --- | --- |
| [#83](https://github.com/AI4STEM-Education-Center/GENIUS-EngageAgent/issues/83) Open | Add and verify Analogy prompts across material types / 类比策略提示词及多材料类型验证 | Step 2 Analogy；Step 3 生成，不只是外观 | 已有提示词、生成序列和真实 Analogy slides 验收；正文保留“三类材料”广义要求，9 月里程碑仅优先 text/image，不能用一次 slides 成功宣告全部完成。跨格式、跨课程教学质量验收待补齐 |
| [#84](https://github.com/AI4STEM-Education-Center/GENIUS-EngageAgent/issues/84) Open | Add and verify Cognitive Conflict prompts / 认知冲突提示词与验证 | 误解选择、预测→证据→比较 | 已有实现及真实视频材料；所有格式的科学准确性、冲突序列、学生语言/问题产出仍需成套证据 |
| [#85](https://github.com/AI4STEM-Education-Center/GENIUS-EngageAgent/issues/85) Open | Add and verify Experience Bridge prompts / 经验桥接提示词与验证 | 核心概念、经验选择、生成 | 已有实现；本次没有完成该策略所有材料类型的真实质量验收，不判全部完成 |
| [#26](https://github.com/AI4STEM-Education-Center/GENIUS-EngageAgent/issues/26) Open | Create multiple manual diagnostic questions / 手工批量添加诊断题 | Lessons 题库；HTML Step 1 只部分相关，不能代替正文细则 | 部分实现；见下表 |
| [#28](https://github.com/AI4STEM-Education-Center/GENIUS-EngageAgent/issues/28) Open | Import structured XLSX / CSV questions / 表格结构化导题 | HTML 的 Upload or link 是另一种文档提取流程 | **核心未实现**；现 DOCX/PDF/PPTX 导入不是此需求 |
| [#19](https://github.com/AI4STEM-Education-Center/GENIUS-EngageAgent/issues/19) Closed | Authenticate through GENIUS SSO / 使用 GENIUS 单点登录 | 原型未实现真实登录 | 已实现；本次测试教师通过 GENIUS 登录 |
| [#18](https://github.com/AI4STEM-Education-Center/GENIUS-EngageAgent/issues/18) Closed | Deploy on the public EngageAgent domain / 部署公开服务 | 原型不处理部署 | 已实现；当前域名可访问，117 为最近已验收部署 |

### #26 的原子验收项

| 原文要求 | 当前证据 | 判定 |
| --- | --- | --- |
| 已登录教师在指定 lesson 的题库添加题目 | Lessons 编辑器已有授权和课程作用域 | 已有基础 |
| Question + A/B/C/D + 唯一正确答案 | LessonForm 有四选项与单选 select；正文允许 radio 或类似单选，select 合格 | 已实现 |
| 每个选项均有合法 diagnosticCategory，包括正确答案 | 当前是 wrongOptionMisconceptions，明确不允许正确选项带 misconception；不是通用诊断类别字段 | 未满足该 schema |
| Add Another 先验证当前题，再加入临时列表 | 现有多卡片草稿编辑，不是这个验证后加入的交互 | 部分实现 |
| 提交前可改/删/排序/增加/改选项及答案 | LessonForm 操作已存在 | 已实现 |
| Save All 时重验必填、答案及同题重复选项 | lessonProblems 有字段级问题和重复选项检查；draft save 与 publish 校验层不同 | 部分对应，需按该入口验收 |
| 同批及现有题库的题干去重 | 检查 item ID 重复不能代替题干重复 | 未实现对应规则 |
| 至少 5 题 | `MIN_QUIZ_ITEMS = 4` | 明确不符 |
| sourceType = manual | 当前题目模型无此来源字段 | 未实现 |
| 精确保存数量、逐字段错误、其他题内容保留 | 字段错误/草稿保留有基础；未核实符合正文的 Save All 精确计数流程 | 部分实现/待验收 |

### #28 的原子验收项

| 原文要求组 | 当前判定 |
| --- | --- |
| `.xlsx` / `.csv`，首工作表、UTF-8、引号内逗号 | 未实现；当前 QUIZ_FILE_KINDS 仅 docx/pdf/pptx |
| 下载模板、必需列说明、合法诊断类别列表 | 对应结构化导入入口未实现 |
| trim 表头和值、必需列检查、重复必需表头拒绝、额外列警告 | 未实现该 parser |
| 空行忽略、空文件/全无效禁止导入、错误文件类型先拒绝 | 未实现该 structured import 流程 |
| A–D 大小写规范化，存字母不是选项全文 | 未实现对应文件导入；现通用题目模型有 A–D，不等于导入验收通过 |
| 四选项诊断类别验证、同题选项重复、文件内/既有题干重复 | 未实现完整规则 |
| 逐行预览 total / valid / invalid / duplicates，保持原始行号 | 未实现 |
| 显式确认后仅导入有效行，不受其他无效行阻断 | 未实现 |
| sourceType = fileImport；至少 5 题；成功/失败/重复汇总 | 未实现 |
| 下载原始行号和具体错误的报告 | 未实现 |

三个旧 prompt 任务的正文还要求：科学准确、课程对应、正确策略顺序、学生易读语言、学生自己提出科学问题、一致图片、SSO/发布/评分不回归。HTML 的固定演示内容不能验证生成质量；应按“策略 × 实际支持格式 × 代表课程”保留生成输出和人工质量检查结果。

## 9. 为什么外部未就绪不等于内部可以不做

本次检查 GENIUS `genius-platform-main` 的 `528a2a1ed3fd494354ebefef89d027eba81b701d`：Class 模型仅有基本班级字段，已检查主分支路由和文件树未发现完整画像/经验签到服务契约。它不能证明其他分支没有开发，也不应成为本项目交互欠账的理由。

- [上游 Class 模型](https://github.com/AI4STEM-Education-Center/GENIUS_Learning_Platform/blob/528a2a1ed3fd494354ebefef89d027eba81b701d/express-server/src/models/Class.ts)
- [上游 classes 路由](https://github.com/AI4STEM-Education-Center/GENIUS_Learning_Platform/blob/528a2a1ed3fd494354ebefef89d027eba81b701d/express-server/src/routes/classes.ts)
- #173（同事任务，Closed）是班级画像；#178（同事任务，Closed）是策略页面。不能因为相关任务关闭就认为 provider 联调契约已经存在。

现在能做：内部标准模型、来源适配层、不可用/空/过期/失败状态、手工补充优先级、更新确认、生成快照、公开标签派生、历史补录、反馈归属以及契约 fixtures。真正仍需上游提供：正式 endpoint / 字段语义 / 身份授权与班级映射 / 版本更新约定，然后完成真实联调。

详细设计和验收条件见 [GENIUS 接入准备与材料数据设计](v84-genius-readiness-design-20261117.md)。这份设计在本次已经写明，但 runtime adapter、同步状态和迁移闭环尚未因此自动上线。

## 10. 后续执行顺序

1. **P0：上下文接入准备**（179-02b/03b/05b、UI-02）。先统一内部数据和状态，自动形成可审阅上下文，明确本地来源/GENIUS 来源及更新时间；用 mock provider 验收所有状态。
2. **P0：生成快照与标签**（196-03、179-06b、UI-12）。生成时记录实际输入，公开摘要单独审阅，规范化 grade/quiz/经验 ID，分享显示完整摘要；旧材料可恢复补齐、有权补录。
3. **P1：编辑与分享交互**（UI-08/09/10/11/14/15）。结构化检查项、修复后重检、完整 presenter、视频布局和下载入口、自动摘要与清理建议。
4. **P1：学生及反馈细节**（181-07/08、反馈表）。单一画布切换多材料，问题绑定发布版本，统计带口径和时间；准备前后测数据契约但不虚构提升。
5. **独立待办：#26 / #28**。补手工题 schema/去重/5 题规则、真正的 XLSX/CSV parser 与确认导入；它们不能被材料 UI 修改顺带算完成。
6. **质量验收：#83 / #84 / #85**。完整生成样本矩阵和教学质量证据补齐后，再决定是否满足关闭条件。

## 11. HTML 对照定位

| 编号 | 原始 HTML 行号 | 内容/函数 |
| --- | --- | --- |
| H1 | 721–769；1825 | openProfileRO、首次画像表单；Edit in GENIUS toast |
| H2 | 1111–1177 | EXPERIENCES / AI_EXP；策略焦点；经验人数、weak fit 和不足提示 |
| H3 | 1300–1353 | defaultCtx、Step 3 起点卡、上下文、格式、生成/审阅锚点及操作区 |
| H4 | 1359–1369；1384–1398；1951–1975 | slides 编辑、whole/single revise、video link、presenter |
| H5 | 1374–1377 | 视频播放器与活动阶段布局 |
| H6 | 1628–1653；1832–1834 | 七标签、匹配/排序、Use/Adapt；max 2 的演示规则 |
| H7 | 1491–1513；1907–1908 | 分享窗口及实际提交 handler（有演示缺陷） |
| H8 | 1616–1625；1655–1665 | 静态 Gallery、作者/人数、过滤、Preview |
| H9 | 1754–1779 | Explore and ask：预测、阅读、问题、评分 |
| H10 | 1409–1456 | 六类十五项 rubric、演示检查、Fix / Go to slide |

## 12. 关键代码依据

均以本报告所列 main SHA 为基线。引用函数/字段便于后续版本重定位。

| 内容 | 文件与位置 |
| --- | --- |
| 本地画像字段/摘要 | `lib/class-profile.ts:47`；`app/api/class-profile/route.ts`；`lib/material-classroom-context.ts` |
| 经验来源与过期字段 | `lib/task-interests.ts:47`；`app/components/StrategyStep.tsx:141`（CheckInEvidence） |
| 经验适配度交互 | `app/components/MaterialExperiencePicker.tsx:12`；`app/api/material-experiences/route.ts` |
| 背景默认空、分享参数 | `app/components/TeacherView.tsx:400`、`:540`、`:2083`、`:2115` |
| 真实 prompt 变量 | `lib/slides/prompts.ts:163`；deck 本地 provenance 在 `lib/slides/model.ts:39` |
| 标签重构/七维匹配 | `lib/material-gallery-tags.ts:14`（galleryPromptTags）、galleryMatches |
| 服务端快照/推荐筛选 | `lib/material-gallery-server.ts:22`、`:33`、`:690` |
| 分享默认值与手工摘要 | `app/components/ShareSlidesDialog.tsx:21`、`:77`、`:90`、`:123` |
| 检查定位与修复 | `lib/slides/review-target.ts:3`；`app/components/SlidesWorkspace.tsx:428`、`:637` |
| 视频文字改编 | `lib/material-video-adaptation.ts:9`；`app/components/GalleryWorkspace.tsx:284` |
| 反馈口径及多材料排除 | `lib/material-gallery-feedback.ts:45` |
| 题库最少四题/重复选项 | `lib/lessons.ts:23`、`:155`、`:163`；`app/components/lessons/LessonForm.tsx:264` |
| 非 XLSX/CSV 的现有导入 | `lib/task-quiz-file.ts:27`、`:174` |

审查证据位于 `/Users/jingyuanhuang/.codex/workspaces/EngageAgent-v84-audit-20261117`：原始 issue JSON、issue 截图、原型/线上截屏、upstream model/route snapshot、SHA/文件散列清单。凭据不在证据包中。
