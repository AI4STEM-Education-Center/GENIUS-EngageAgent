# GENIUS 接入准备、材料标签与反馈数据设计

日期：2026-11-17。对应 #179、#196、#181 及用户追加的统计需求。

**状态：本文前半部分保留接入设计；下方“已实现的 v1 接入契约”对应本次真实代码。适配器和交互已实施，真实 GENIUS 数据仍须由正式上游服务按契约提供。部署与验收以交付记录为准。** 需求证据和当前缺口见 [逐条核对报告](v84-requirement-audit-20261117.md)。

## 1. 交付目标

GENIUS 尚未提供真实画像/签到接口时，教师能明确知道当前数据来自何处、哪些可用，仍可填写背景并生成材料。上线正式服务后，只接入经过契约验证的 adapter；TeacherView、经验选择、分享和学生阅读不需要重做。不能承诺任何未知上游格式都能“零修改即用”。

完整链路：

```text
GENIUS provider / 当前本地数据
  → 内部标准课堂上下文（来源、状态、版本）
  → 教师审阅的有效上下文 + 独立手工补充
  → 推荐 / Use as is / Adapt / Generate
  → 固定的实际生成输入快照 + 材料版本
  → 私有保存
     ├─ 分享：公开标签摘要 + 可选教师备注 + 审阅
     └─ 发送：固定 publication 版本 → 学生阅读/问题/评分
```

## 2. 内部数据契约（提案，不是虚构 GENIUS endpoint）

保留现有 API 的兼容响应。新增一个本应用内部聚合服务 `ClassroomContextService`，由服务端依授权取得数据；前端不直接依赖外部字段名。

```ts
type Provider = "genius" | "engageagent-local";
type Availability =
  | "loading" | "not_connected" | "empty" | "ready"
  | "stale" | "error" | "forbidden";

type SourceEnvelope<T> = {
  schemaVersion: 1;
  provider: Provider;
  status: Availability;
  classId: string;
  assignmentId?: string;
  sourceId?: string;
  sourceVersion?: string;
  observedAt?: string;
  syncedAt?: string;
  value?: T;                // 仅 ready/stale 有值；unknown 不是 0
  retryable?: boolean;
  reasonCode?: string;
};

type ReportedExperience = {
  activityId: string;       // provider 命名空间下的稳定 ID
  label: string;
  categoryId?: string;
  studentCount?: number;
  didCount?: number;
  watchedCount?: number;
};

type SelectedExperience = {
  kind: "reported" | "ai_suggested" | "teacher_entered";
  activityId?: string;
  sourceVersion?: string;
  label: string;
  fit: "unknown" | "checking" | "good" | "weak" | "error";
  fitReason?: string;
  focusSignature: string;  // lesson version + strategy + focus IDs
  confirmedAt?: string;
};

type ClassroomContext = {
  schemaVersion: 1;
  scope: { classId: string; assignmentId: string; lessonId: string; lessonVersion: string };
  profile: SourceEnvelope<ClassProfileAnswers>;
  checkIn: SourceEnvelope<{
    responseCount: number;
    analyzedAt?: string;
    activities: ReportedExperience[];
  }>;
  manualSupplement: { text: string; revision: number; updatedAt: string };
  selection?: SelectedExperience;
  effectiveSummary: string;
  effectiveContextVersion: string;
};
```

`ClassProfileAnswers` 复用当前字段；来源包裹层新增，不将存储者/最后编辑者误当数据来源。独立组件可以有不同状态：画像 ready 时，签到仍可能 empty。错误响应不得把另一班级缓存作为 fallback。

Adapter 职责：授权检查、班级/任务映射、字段语义转换、版本排序、超时/重试、响应校验。正式 `GeniusProvider` 未启用前，生产使用明确标识的 local provider。模拟 provider 只在开发/测试注入，不向线上教师展示合成学生数。

## 3. 教师交互状态

| 状态 | 显示文字/内容 | 可做的动作 | 行为约束 |
| --- | --- | --- | --- |
| loading | Loading class information… / 正在读取班级信息 | 可编辑已保存的本次补充；不显示假人数 | 请求有超时；不无限 loading |
| not_connected | GENIUS data is not connected yet / GENIUS 数据尚未接入 | 使用本地画像、选择 AI 经验或自定义经验 | 不显示 Synced from GENIUS，不把未接入说成学生尚未回答 |
| empty | No check-in responses yet / 暂无签到回答 | 自填或 AI 建议；Refresh | 只有确认成功返回空集合才显示 0 |
| ready | From GENIUS（或 From EngageAgent）+ updated time + 摘要 | 查看详情、使用、补充、刷新 | 来源/时间可见，不要求教师阅读技术 ID |
| stale | Using data from [time]; refresh needed / 正使用上次数据 | 重试；明确沿用旧摘要 | 保留当前手工输入；旧值仍能看出时间，不悄悄冒充最新 |
| error | Class information could not be updated / 更新失败 | 重试；有授权且适用的旧缓存可继续使用 | 无缓存则沿手工路径；不能显示其他班级数据 |
| forbidden | This class information is not available to this account / 当前账号无权访问 | 返回班级列表；刷新登录 | 清除该来源的展示缓存，不用本地旁路读取受限数据 |

Class profile 弹层：来源与时间置于标题下；GENIUS 正式提供可信编辑地址后显示 Edit in GENIUS；尚未有地址时不放无效按钮。当前本地表单作为可用路径保留，显示其本地来源。

Classroom context 默认呈现“自动摘要 + 我的补充”。自动摘要折叠展示，保持可审阅；手工补充单独编辑。必要时提供“以当前摘要为基础编辑”的显式操作，存为 override，避免用 `useEffect` 覆盖教师的输入。生成前查看的 effectiveSummary 必须与服务端真正使用的版本一致。

## 4. 数据更新与教师编辑的关系

1. 初次进入：并行读取画像/签到和教师已保存补充，合并生成有效摘要；恢复原选择的 activityId。
2. 同班级新签到到达：显示“New check-in information is available”及新旧人数/更新时间，不自动改变教师已选经验。
3. 教师选择 Use updated information：刷新来源快照并重新计算适配度；保留手工补充。
4. 选中经验已消失/改名：用稳定 ID 判断；消失则保留历史标签并提示“来自较早数据”，让教师更换或确认继续使用，不能静默映射到另一经验。
5. 切换课程、策略或焦点：使用 scope + focusSignature 隔离选择；重新计算 fit。显示计算中，弱匹配仍可选择但有理由；好匹配少于两项时建议 AI/自填。
6. 新数据不自动重新生成现有材料。已有 draft 显示“Context updated; adapt this draft?”操作。
7. 当前私有材料可以改编；学生收到的 publication 保持原版本，直到教师明确再次发送。
8. 并发编辑/保存：沿用 revision 冲突响应，保留本地输入；上游过期/乱序响应不得覆盖较新版本。

## 5. 生成输入、公开标签和推荐

### 5.1 固定生成输入快照

在服务端启动 Generate / Adapt / Revise 时记录 `GenerationInputSnapshot`，而不是到分享时再次推算：

- snapshotId、schemaVersion、materialId、materialRevision、parentRevision、operation、timestamp。
- course / lesson / lessonVersion、topic、objective、target concept；strategy、focus IDs 与文字、analogy method、format。
- gradeBand 的标准值，实际 quiz summary 的统计口径和有效样本量；所选经验 ID / kind / label / sourceVersion。
- profile/checkIn 版本、effectiveContextVersion、实际使用的摘要与教师补充；缺失字段明确记录 unavailable/not supplied。
- promptVersion/revision/hash、实际 text/image/video model 配置、生成/改编参数和模型调用状态。
- 实际输入的私有快照留在受授权范围；公开 Gallery API 不返回原始学生回答、班级 ID 或个人画像原始内容。

当前 deck 中已经有部分 model/prompt provenance，迁移时复用；增加 Gallery Source / CopySnapshot 的完整引用，不重复创建第二套无法关联的版本。

### 5.2 可分享摘要

从快照派生 `PublicTeachingTags`：七类简明标签 + 折叠完整摘要。每个字段可附 `origin = captured | reconstructed | teacher_confirmed | unknown`，生成时捕获和事后补写要区分。

分享窗口主区域：缩略预览、标题、年级（标准选项）、七标签摘要、Include teacher notes、Share。Advanced 放 description / topic 展示修正 / 额外关键词 / 可分享课堂摘要。自动填入安全摘要让教师审阅；保留不能自动判断的人工审阅，不声称自动清理能保证识别图片和自由文本中的一切信息。

教师修改标签不修改历史真实输入，只形成发布元数据的新 revision。界面需要能区分“Generated with”和“Teacher-described suitability”，避免改了年级标签就声称当初按该年级生成。

### 5.3 推荐规则

保持最多三条、置顶、无合适则隐藏。先通过已知课程身份/版本、策略、格式以及焦点兼容性筛选，再对七维已知匹配排序，显示原因。统一 gradeBand/quizBand 枚举，经验使用活动 ID 和经过验证的等价映射；未知字段不加分。不能用两个不同课程同为 Lesson 3 作为匹配。

没有经验等价映射时只使用明确文本匹配，不宣传语义理解。推荐策略与阈值设为版本化规则，固定验收用例：合适、部分未知、弱相关、不相干、跨课程同编号、相同内容不同版本、无结果、最多三条及排序稳定。

会议中的“选格式后自动生成”是独立交互决策；在明确采用前，不因为切换格式而发起付费生成。现有显式 Generate 行为需在需求表中标记，不能悄悄当成自动方案已完成。

## 6. 历史作者与标签补齐

不是“不能编造，所以什么都不做”。提供以下可验证流程：

1. 对历史材料生成只读 completeness report：ownerId、creatorName、来源链、原始生成记录、标签缺失字段及可恢复来源。
2. 有 authenticated ownerId + 可信账号资料时，可补作者展示名；不能由正文风格或当前登录者推测作者。
3. 有原始生成快照时直接恢复；仅有可确定的保存内容时标为 reconstructed，并记录 sourceRevision/依据。年级、当时班级背景等无法推出的字段保持 unknown。
4. 有权限的 owner 在 Material details → Complete details 中确认/补充；无可验证归属的材料走受控维护流程，普通教师不能“认领”别人的作品。
5. AI 可以提出关键词/主题建议，但必须标为建议并经教师确认；不伪造历史实际 prompt 输入。
6. 迁移先 dry run，带 idempotency key 与逐条记录；不覆盖已验证值。数据库改写使用新 metadata revision，提供可回退的旧值。
7. 补齐后重新进入推荐候选，统计和 provenance 保持稳定；未补齐材料仍可浏览，缺失原因可见。

## 7. 反馈与学生表现准备

保存数、发送数、学习者访问数、评分、科学问题和测验结果是不同事件：

```text
MaterialSaved      materialId / revision / authorizedTeacherKey
MaterialPublished  materialId / revision / publicationId / class-task scope
MaterialViewed     publicationId / pseudonymousLearnerKey / timestamp
QuestionSubmitted  questionId / publicationId / materialRevision / timestamp
MaterialRated      publicationId / learnerKey / rating / timestamp
AssessmentLinked   comparableAssessmentId / lessonVersion / timepoint
```

事件 ID 用于去重；实际学生身份/班级 scope 留在授权后端，公开 Gallery 返回聚合值。现有反馈已根据发布时间排除旧响应，应保留这项规则并补稳定 publicationId。

UI 主卡显示评分和样本量；详情显示时间范围、原版/改编版范围、参与人数、问题分类有效分母。多人多个材料时，学生在当前材料上下文提问并自动关联 publicationId；跨材料问题可以显式归为整项活动，不强行给所有材料记一次。

未来测验区先设计：未连接、没有可比数据、样本不足、可比较四种状态。只有同一概念、可比题目/评分、前后时间点和配对学习者数据具备后，显示“Observed score change / 观察到的分数变化”、样本量、缺失比例；不据此自动声称材料导致学习提升。当前评分/问题统计继续使用已有真实数据。

## 8. 验收矩阵和上线条件

| 组 | 必须通过的行为 |
| --- | --- |
| provider contract | 完整/部分/未知字段映射；schema 不兼容明确失败；stable IDs；权限与班级映射；正式沙箱/测试数据联调 |
| 状态 | loading、未接入、空、ready、stale、有/无缓存错误、forbidden 全部有真实 UI；unknown 不显示 0 |
| 更新 | 新数据到达不覆盖手工补充；切换班级不会串数据；乱序/重复响应不倒退；恢复选择与确认旧经验 |
| 生成一致性 | 教师预览上下文与实际快照 hash 一致；AI 建议无伪造人数；Generate / Adapt / Revise 均记录真实输入 |
| 分享 | 七标签继承并可审阅；公开与私有字段隔离；去备注只影响共享快照；旧记录 unknown/reconstructed 可辨 |
| 推荐 | 同课号跨课程不误配；标准枚举/经验 ID；少于三条不凑数；不合适隐藏；原因对应真实得分 |
| 历史迁移 | dry run 可审阅；重复执行无重复改写；错误归属不覆盖；metadata revision 可回退 |
| 发布/学生 | 私有修改不改变已发送版本；旧评分不跨 publication；多材料问题正确归属；重新打开状态一致 |
| 真实联调启用 | adapter contract 测试通过、身份/班级作用域校验、真实代表班级对照、生产 smoke 通过后才启用 GENIUS 来源标识 |

可以现在完成除最后一行真实联调以外的设计、实现和模拟验收。上游就绪后仍需正式字段映射和真实数据验证，但无需重写教师交互。


## 已实现的 v1 接入契约（2026-11-17）

- 应用内接口：`GET /api/classroom-context?classId=…&assignmentId=…`，先验证教师的班级/任务权限。返回来源、更新时间、版本与独立 profile/check-in 状态。
- 服务端配置：`GENIUS_CONTEXT_ENDPOINT` 与 `GENIUS_CONTEXT_TOKEN`。两者默认留空，明确使用 EngageAgent 本地资料。生产预检要求 HTTPS 和完整配置；Amplify 将配置写入服务端运行环境，不公开到浏览器。
- 启用后，服务端对该 URL 发 GET，带 `classId`、`assignmentId` 查询和服务身份 Bearer token。上游必须对授权的服务身份限定可读范围。8 秒超时、禁止重定向；响应须匹配请求的班级/任务。
- 响应结构：`{schemaVersion:1, classId, assignmentId, version, updatedAt, profile, checkIn}`。`profile` 为现有 ClassProfileAnswers（locale、groups、groupAlternative、classType、englishLearners、iepOr504）或 null。`checkIn` 为 `{responseCount, activities:[{id,label,studentCount,didCount,watchedCount,category?}]}` 或 null。ID 必须稳定，数量必须非负且不超出样本量；不得提供学生身份或原始回答。该契约是我们已实现的 adapter 边界，不是假设 GENIUS 已发布了某条路径。
- 已有数据按教师与班级/任务隔离保存。失败保留有来源日期的旧数据；401/403 清除可展示缓存并拒绝旧快照引用；返回旧版本不会覆盖新版本。
- 教师确认新资料才改变后续生成依据，手工补充不覆盖。生成、改编、修改保存接受的快照引用，恢复材料仍使用其记录的依据。
- 文本、图片、视频调用均保存实际提示词与模型/参数的私有记录；图像引用只记摘要，不将大幅像素数据塞入 DynamoDB。公开 Gallery 只显示受审阅标签与安全生成摘要；生成原始班级背景不公开。
- 经验匹配按教师、任务、课程内容、策略、焦点及签到版本缓存一天；显式 Refresh 重新分析。报告经验与 AI/手工经验分别记录来源。
- 历史材料的拥有者可补录标签，服务器记录修改者、前后值及版本；并发旧版本返回 409。补录不会冒充已捕获的生成输入，不修改共享材料正文或既有学生发布版本。
- 学生多材料问题绑定 `contentItemId + publishedAt`；服务端拒绝过期或异班版本。公开反馈说明样本数、统计时间与当前发布版本口径。尚无前后测服务，因此不计算学习提升。

测试覆盖：本地/空数据/版本固定/跨教师隔离/跨任务隔离/断线缓存/权限撤销/输入记录防伪/格式匹配/公开隐私/标签并发更新/学生问题发布版本绑定。内置浏览器使用独立模拟服务验证更新、断线和失权状态；模拟数据不会进入生产配置。
