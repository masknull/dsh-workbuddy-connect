# 本分支相对上游的改动（Usage Ledger）

> 本文件只描述**本分支新增了什么**、**为什么必须在这里做**，以及**如何验证**。
> 上游是 [`masknull/dsh-workbuddy-connect`](https://github.com/masknull/dsh-workbuddy-connect)（MIT）。
> 本分支：`593653436/dsh-workbuddy-connect` → `feature/usage-stats`。

## 一句话

上游能显示**当前余额**，但看不到**用掉了多少、花在哪**。本分支在 shim 出口挂一个只读的用量记账器，
把每次请求的**真实计费积分**（上游回传的 `credit`）和**精确 token 拆分**逐条落盘，全量保留、不自动清理。

## 为什么必须在这一层做

这是全链路唯一同时看得到两样东西的位置。核实过的三条事实：

| 层 | token 明细 | 计费 `credit` | 说明 |
|---|---|---|---|
| WorkBuddy 上游 SSE | ✅ | ✅ | 末尾分片带完整 `usage` |
| **本插件的 shim（本分支改动点）** | ✅ | ✅ | 出站前唯一能同时读到两者的地方 |
| `pi-ai` 的 `parseChunkUsage()` | ⚠️ 归一化为 `input/output/cacheRead` | ❌ **丢弃** | 只保留标准字段，`credit` 不向上传 |
| DSH 会话文件 | ❌ 不存 | ❌ 不存 | 会话里没有 usage 记录 |
| 网页控制台 | ❌ | ⚠️ 汇总 | 导出上限 3000 行，且按范围服务端缓存 |

因此：**记账放在本插件，才能得到实测值而不是换算值。**

## 新增文件

| 文件 | 作用 |
|---|---|
| `src/usage-ledger.ts` | 记账核心：SSE 扫描、记录构造、NDJSON 追加、按日聚合、手动合并 |
| `tests/usage-ledger.spec.ts` | 36 条单元测试（分片跨界、撕裂行、并发写、写盘失败降级…） |
| `tests/shim-usage.spec.ts` | 10 条集成测试（真实往返落账、**转发字节不变**、无 usage 不落账…） |
| `docs/usage-ledger.md` | 本文件 |

## 改动文件

| 文件 | 改动 |
|---|---|
| `src/shim.ts` | `WorkBuddyShimOptions` 增加可选的 `ledger` / `region`；在 `chatCompletions()` 的 `pipe` 前挂 tap |

**改动刻意保持最小**：`ledger` 不传时行为与上游完全一致（有测试守着这条）。

## 记了哪些字段

```jsonc
{
  "at": "2026-10-02T03:00:00.000Z",  // 完成时刻
  "region": "cn",                    // cn | global
  "uid": "09febad7-…",               // 账号 uid，多账号可区分
  "model": "deepseek-v4.1-flash",    // 实际请求的模型
  "prompt": 40008,                   // 总输入
  "cacheHit": 0,                     // 命中缓存（按 1/42 计费）
  "cacheMiss": 40008,                // 未命中（全价）
  "completion": 1,                   // 输出（含 reasoning）
  "reasoning": 0,                    // 思维链 token
  "credit": 1.14,                    // ★ 上游回传的真实计费积分
  "ms": 1234,                        // 耗时
  "done": true                       // 是否收到 [DONE]
}
```

## 两个决定设计的上游事实

1. **`credit` 只有 2 位小数**。实测 40,008 未命中 token → `1.14`；一次 20 token 的小请求直接记为 `0`。
   所以**逐条累加积分会偏低**。因此账本同时保留精确 token 计数：token 总量永远准确，
   积分可用余额读数对账（差额即舍入损耗）。
2. **同一响应只落一次账**，且请求可能流式数分钟，所以在流结束（`end` / `close`）时才写入，
   此时 `done` 与耗时都已确定；客户端中途放弃则标记 `abort` 且不落账。

## 存储与保留策略

```
$DSH_HOME/profiles/<profile>/.dsh-workbuddy-connect/
├── .workbuddy-auth.json          # 凭据（上游既有）
└── usage/
    ├── usage-ledger.ndjson       # 全量逐请求明细（本分支新增）
    └── usage-rollup.ndjson       # 手动合并产生的区间汇总（仅显式操作时写入）
```

- **全量保留，永不自动清理。**
- 只有人工在界面上选定日期区间点「合并」，才把该区间折成一条汇总写入 `usage-rollup.ndjson`；
  **默认连明细都保留**，要真正删除必须显式选择清除。
- 每行一次 `appendFile`，通过单条 Promise 队列串行化，因此并发请求不会写出交错的半行。

## 几个刻意的取舍

- **失败必须静默**：记账失败（磁盘满、权限）只上报 `onError`，绝不让聊天请求失败。
  理由：统计是旁路，不该影响主链路 —— 有测试守着。
- **不改写字节**：tap 只读 `Buffer` 副本，转发给 pi-ai 的流与上游逐字节一致，
  所以加上统计不会改变模型行为。有测试比对整段响应文本。
- **opt-in**：不传 `ledger` 时 shim 行为完全不变，便于上游合并时降低顾虑。

## 如何验证

```bash
pnpm install
pnpm test          # 期望 34 → 36 个文件、427 → 473 条全绿
pnpm run typecheck
pnpm run build
```

真实数据验证（会消耗极少量积分）：

```bash
# 在 DSH 里正常对话几次，然后
node -e "…"   # 或直接用 UI 的「统计」页
cat $DSH_HOME/profiles/web/.dsh-workbuddy-connect/usage/usage-ledger.ndjson
```

已实测（2026-10-02，国内版 `deepseek-v4.1-flash`）：

| prompt | cacheMiss | completion | credit | 反推费率 |
|---|---|---|---|---|
| 40,008 | 40,008 | 1 | **1.14** | 28.5 积分/1M |

与本目录早先独立测得的「高峰 ×2 后 28.5 积分/1M」一致 —— 两条互相独立的路径得出同一费率。

## 尚未完成（后续提交）

- 宿主 HTTP 路由（`/usage/summary`、`/usage/records`）暴露给前端
- 客户端的「统计」标签页（趋势条状图、按模型聚合、积分↔token↔人民币、手动合并入口）
- README 中英双份的功能章节更新
