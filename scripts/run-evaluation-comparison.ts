import { readFile } from "node:fs/promises";
import {
  buildAgentSystemPrompt, completeWithModel, openAiToolDefinitions,
  readModelConfig, runToolSelectionLoop, validateAgentAnswer, type AgentEvidenceRef,
} from "../src/lib/agent-runner";
import { collectEvalEvidence, expectedPathCoverage, lexicalClaimScores, markdownEvalMemory, retrieveEvalText, visibleEvalRecords, type EvalCase, type EvalRecord } from "../src/lib/evaluation";
import { workflowDomainLabel, type WorkflowDomain } from "../src/lib/workflow-domains";
import { mcpTools } from "../src/lib/mcp-tools";

type Fixture = { version: number; dataClass: string; cases: Array<EvalCase & { domain?: WorkflowDomain; question: string; expected: EvalCase["expected"] & { outcome: string } }> };
type ModeResult = {
  mode: string;
  status: "completed" | "failed";
  failure?: string;
  abstained?: boolean;
  inputBytes: number;
  promptTokens?: number;
  completionTokens?: number;
  tokenUsageSource?: "provider" | "estimated";
  toolCalls?: number;
  pathCoverage?: number;
  claimTokenRecall?: number;
  claimTokenF1?: number;
  citations?: number;
  failureReasons: string[];
};

const encoder = new TextEncoder();
const MAX_INPUT_BUDGET = 128_000;
const MAX_OUTPUT_TOKENS = 1800;
const MODES = ["graph_agent", "text_retrieval", "markdown_memory"] as const;
type Mode = typeof MODES[number];
const config = readModelConfig();
if (!config) {
  console.error("Set AI_BASE_URL, AI_API_KEY, and AI_MODEL to run the comparison; values are never printed.");
  process.exitCode = 2;
} else {
  const budgetValue = Number(process.env.AI_EVAL_CONTEXT_BUDGET_BYTES ?? 32_000);
  if (!Number.isInteger(budgetValue) || budgetValue < 8_000 || budgetValue > MAX_INPUT_BUDGET) {
    console.error(`AI_EVAL_CONTEXT_BUDGET_BYTES must be an integer between 8000 and ${MAX_INPUT_BUDGET}.`);
    process.exitCode = 2;
  } else {
    const fixtures = await Promise.all(["engineering-incidents.v1.json", "domain-workflows.v1.json"].map(async (file) =>
      JSON.parse(await readFile(new URL(`../eval/${file}`, import.meta.url), "utf8")) as Fixture));
    const cases = fixtures.flatMap((fixture) => fixture.cases);
    const maxCases = Number(process.env.AI_EVAL_MAX_CASES ?? cases.length);
    if (!Number.isInteger(maxCases) || maxCases < 1 || maxCases > cases.length) {
      console.error(`AI_EVAL_MAX_CASES must be between 1 and ${cases.length}.`);
      process.exitCode = 2;
    } else {
      const selectedCases = cases.slice(0, maxCases);
      const results: Array<{ caseId: string; domain: string; mode: ModeResult }> = [];
      for (const testCase of selectedCases) {
        const domain = testCase.domain ?? "general";
        const records = visibleEvalRecords(testCase);
        for (const mode of MODES) {
          const outcome = await runCase(mode, testCase, records, domain, budgetValue, config);
          results.push({ caseId: testCase.id, domain: workflowDomainLabel(domain), mode: outcome });
        }
      }
      const summary = MODES.map((mode) => {
        const selected = results.filter((item) => item.mode.mode === mode);
        const values = selected.map((item) => item.mode);
        const completed = values.filter((value) => value.status === "completed");
        const average = (key: "pathCoverage" | "claimTokenRecall" | "claimTokenF1") => {
          const numbers = completed.flatMap((value) => typeof value[key] === "number" ? [value[key] as number] : []);
          return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
        };
        return { mode, completed: completed.length, failed: values.length - completed.length,
          abstentionMatches: selected.filter(({ caseId, mode: result }) => result.status === "completed"
            && result.abstained === (cases.find((item) => item.id === caseId)?.expected.outcome === "abstain")).length,
          meanExpectedPathCoverage: average("pathCoverage"), meanClaimTokenRecall: average("claimTokenRecall"), meanClaimTokenF1: average("claimTokenF1"),
          totalInputBytes: values.reduce((sum, value) => sum + value.inputBytes, 0),
          promptTokens: values.every((value) => value.promptTokens !== undefined) ? values.reduce((sum, value) => sum + (value.promptTokens ?? 0), 0) : null,
          completionTokens: values.every((value) => value.completionTokens !== undefined) ? values.reduce((sum, value) => sum + (value.completionTokens ?? 0), 0) : null,
        };
      });
      console.log(JSON.stringify({
        dataClass: "synthetic_test_fixture_only",
        model: config.model,
        inputBudget: { bytesPerCaseRun: budgetValue, outputTokensPerCaseRun: MAX_OUTPUT_TOKENS, definition: "Hard cap on cumulative serialized model request-body bytes for each mode/case; tool schemas and repeated graph-agent calls count toward the cap." },
        cases: selectedCases.map((item) => item.id),
        metrics: { expectedPathCoverage: "share of reference paths whose every node/edge was available in model context", claimTokenRecall: "mean per-reference-claim lexical token recall; not semantic grading", claimTokenF1: "lexical token F1 against reference claims; not semantic grading" },
        summary, results,
        failures: results.filter((item) => item.mode.failureReasons.length > 0).map(({ caseId, domain, mode }) => ({ caseId, domain, mode: mode.mode, reasons: mode.failureReasons })),
      }, null, 2));
    }
  }
}

async function runCase(
  mode: Mode, testCase: Fixture["cases"][number], records: EvalRecord[], domain: WorkflowDomain,
  inputBudget: number, model: NonNullable<ReturnType<typeof readModelConfig>>,
): Promise<ModeResult> {
  let inputBytes = 0;
  let promptTokens = 0;
  let hasPromptTokens = true;
  let completionTokens = 0;
  let tokenUsageSource: "provider" | "estimated" = "provider";
  let remainingOutputTokens = MAX_OUTPUT_TOKENS;
  const seenIds = new Set<string>();
  const observed = new Map<string, AgentEvidenceRef>();
  let toolCalls = 0;

  const account = (messages: Array<{ role: string; content: string | null }>, tools: unknown[]) => {
    const body = { model: model.model, messages, tools, tool_choice: "auto", parallel_tool_calls: false, temperature: 0, max_tokens: remainingOutputTokens };
    const bytes = encoder.encode(JSON.stringify(body)).byteLength;
    if (inputBytes + bytes > inputBudget) throw new Error("input_context_budget_exceeded");
    inputBytes += bytes;
  };
  const countCompletion = (completion: { usage?: { prompt_tokens?: number; completion_tokens?: number }; choices?: Array<{ message?: unknown }> }) => {
    if (typeof completion.usage?.prompt_tokens === "number") promptTokens += completion.usage.prompt_tokens;
    else hasPromptTokens = false;
    const used = typeof completion.usage?.completion_tokens === "number"
      ? completion.usage.completion_tokens
      : Math.max(1, Math.ceil(encoder.encode(JSON.stringify(completion.choices?.[0]?.message ?? {})).byteLength / 4));
    if (typeof completion.usage?.completion_tokens !== "number") tokenUsageSource = "estimated";
    completionTokens += used;
    remainingOutputTokens -= used;
    if (remainingOutputTokens < 0) throw new Error("output_token_budget_exceeded");
  };

  try {
    let answer: ReturnType<typeof validateAgentAnswer>;
    if (mode === "graph_agent") {
      const names = new Set(["resolve_entity", "trace_entity"]);
      const tools = openAiToolDefinitions(names);
      const graph = fixtureGraph(testCase, records);
      const result = await runToolSelectionLoop(testCase.question, testCase.id, tools, {
        complete: async (messages, suppliedTools) => {
          account(messages, suppliedTools);
          if (remainingOutputTokens < 1) throw new Error("output_token_budget_exceeded");
          const completion = await completeWithModel(messages, suppliedTools, model, undefined, remainingOutputTokens);
          countCompletion(completion);
          return completion;
        },
        invoke: async (name, args) => {
          toolCalls++;
          if (name === "resolve_entity") {
            const found = graph.nodes.find((item) => item.id === args.identifier || item.sourceId === args.identifier);
            return found ? { ok: true, value: { resolved: true, entity: found } } : { ok: true, value: { resolved: false, ambiguous: false, candidates: [] } };
          }
          if (name === "trace_entity") {
            const paths = graphPaths(graph.nodes, graph.edges, String(args.entityId ?? ""));
            return { ok: true, value: { paths } };
          }
          return { ok: false, error: "Tool is unavailable in this evaluation mode." };
        },
        onToolCall: async ({ result }) => {
          const captured = collectEvalEvidence(result);
          captured.records.forEach((id) => seenIds.add(id));
          captured.refs.forEach((ref, key) => observed.set(key, ref));
        },
      }, { operationKey: `eval:${testCase.id}`, workflowDomain: domain });
      answer = result;
    } else {
      const retrieved = mode === "text_retrieval" ? retrieveEvalText(records, testCase.question) : records;
      const context = fitContext(retrieved, testCase, domain, inputBudget, model.model);
      context.records.forEach((record) => {
        seenIds.add(record.id);
        observed.set(`${record.sourceId}\u0000${record.version}`, { sourceId: record.sourceId, version: record.version });
      });
      const messages = [
        { role: "system" as const, content: buildAgentSystemPrompt(domain) },
        { role: "user" as const, content: `Use only the authorized synthetic evidence below. Every factual claim must cite exact sourceId and version values.\n\n${context.text}\n\nQuestion: ${testCase.question}` },
      ];
      account(messages, []);
      const completion = await completeWithModel(messages, [], model, undefined, MAX_OUTPUT_TOKENS);
      countCompletion(completion);
      answer = validateAgentAnswer(completion.choices?.[0]?.message?.content, observed);
    }
    const claimScores = lexicalClaimScores(testCase.expected.claims, answer.claims.map((claim) => claim.text));
    const pathCoverage = expectedPathCoverage(testCase.expected.evidencePaths, seenIds);
    const expectedAbstention = testCase.expected.outcome === "abstain";
    const failureReasons: string[] = [];
    if (answer.abstained !== expectedAbstention) failureReasons.push(expectedAbstention ? "expected_abstention_missed" : "unexpected_abstention");
    if (pathCoverage < 1) failureReasons.push("reference_path_not_available_in_model_context");
    if (testCase.expected.claims.length && claimScores.f1 < 0.2) failureReasons.push("low_reference_claim_token_overlap");
    if (answer.claims.length && answer.citations.length === 0) failureReasons.push("claims_without_valid_citations");
    return { mode, status: "completed", abstained: answer.abstained, inputBytes,
      ...(hasPromptTokens ? { promptTokens } : {}), completionTokens, tokenUsageSource, toolCalls,
      pathCoverage, claimTokenRecall: claimScores.recall, claimTokenF1: claimScores.f1,
      citations: answer.citations.length, failureReasons };
  } catch (error) {
    const failure = error instanceof Error ? error.message : "evaluation_failed";
    return { mode, status: "failed", failure, inputBytes, ...(hasPromptTokens ? { promptTokens } : {}),
      completionTokens, tokenUsageSource, toolCalls, failureReasons: [failure] };
  }
}

function fitContext(records: EvalRecord[], testCase: Fixture["cases"][number], domain: WorkflowDomain, budget: number, model: string) {
  const selected: EvalRecord[] = [];
  const render = (items: EvalRecord[]) => markdownEvalMemory(items);
  for (const record of records) {
    const candidate = [...selected, record];
    const messages = [
      { role: "system", content: buildAgentSystemPrompt(domain) },
      { role: "user", content: `Use only the authorized synthetic evidence below. Every factual claim must cite exact sourceId and version values.\n\n${render(candidate)}\n\nQuestion: ${testCase.question}` },
    ];
    const bytes = encoder.encode(JSON.stringify({ model, messages, tools: [], tool_choice: "auto", parallel_tool_calls: false, temperature: 0, max_tokens: MAX_OUTPUT_TOKENS })).byteLength;
    if (bytes > budget) break;
    selected.push(record);
  }
  return { records: selected, text: render(selected) || "No authorized evidence was retrieved." };
}

function fixtureGraph(testCase: Fixture["cases"][number], records: EvalRecord[]) {
  const recordByKey = new Map(records.map((record) => [`${record.kind}:${record.id}`, record]));
  const nodes = testCase.nodes.filter((node) => recordByKey.has(`node:${node.id}`)).map((node) => {
    const ref = recordByKey.get(`node:${node.id}`)!;
    return { id: node.id, type: node.type, text: ref.text, sourceId: ref.sourceId, version: ref.version };
  });
  const edges = testCase.edges.filter((edge) => recordByKey.has(`edge:${edge.id}`)).map((edge) => {
    const ref = recordByKey.get(`edge:${edge.id}`)!;
    return { id: edge.id, type: edge.type, from: edge.from, to: edge.to, text: ref.text, sourceId: ref.sourceId, version: ref.version };
  });
  return { nodes, edges };
}

function graphPaths(nodes: ReturnType<typeof fixtureGraph>["nodes"], edges: ReturnType<typeof fixtureGraph>["edges"], startId: string) {
  if (!nodes.some((node) => node.id === startId)) return [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const paths: Array<{ nodes: typeof nodes; edges: typeof edges }> = [];
  const walk = (nodeIds: string[], edgeIds: string[], depth: number) => {
    if (edgeIds.length) paths.push({ nodes: nodeIds.map((id) => byId.get(id)!), edges: edgeIds.map((id) => edges.find((edge) => edge.id === id)!) });
    if (depth >= 4 || paths.length >= 40) return;
    const current = nodeIds.at(-1)!;
    for (const edge of edges) {
      const next = edge.from === current ? edge.to : edge.to === current ? edge.from : "";
      if (next && !nodeIds.includes(next)) walk([...nodeIds, next], [...edgeIds, edge.id], depth + 1);
      if (paths.length >= 40) return;
    }
  };
  walk([startId], [], 0);
  return paths;
}
