import { withWorkspaceGraph, type GraphParams, type GraphQuery } from "@/lib/falkordb";

export type GraphProjectionEvent = {
  id: number | string;
  workspace_id: string;
  entity_type: string;
  entity_id: string;
  entity_version: number;
  operation: "upsert" | "delete";
  payload: Record<string, unknown>;
  attempts: number;
};

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

async function parentAvailable(query: GraphQuery, label: "Investigation" | "Task" | "Fact", id: string, type: string) {
  const marker = await query(
    "MATCH (m:ProjectionMarker {entity_type: $type, entity_id: $parent_id}) RETURN m.operation",
    3000,
    { type, parent_id: id },
  );
  if (marker[0]?.[0] === "delete") return false;
  const rows = await query("MATCH (n:" + label + " {id: $parent_id}) RETURN n.id", 3000, { parent_id: id });
  if (rows.length) return true;
  throw new Error("Projection dependency is not ready");
}

async function project(query: GraphQuery, event: GraphProjectionEvent) {
  const payload = event.payload;
  const params = {
    entity_type: event.entity_type,
    entity_id: event.entity_id,
    version: event.entity_version,
    workspace_id: event.workspace_id,
    operation: event.operation,
  };
  const marker = `MERGE (m:ProjectionMarker {entity_type: $entity_type, entity_id: $entity_id})
    ON CREATE SET m.version = 0
    WITH m WHERE m.version < $version
    SET m.version = $version, m.operation = $operation, m.workspace_id = $workspace_id
    WITH m`;

  if (event.operation === "delete") {
    if (event.entity_type === "investigation_task_handoffs") {
      await query(`${marker}
        MATCH (:Task)-[r:HANDED_OFF_TO {id: $entity_id}]->(:Person)
        DELETE r
        WITH 1 AS done
        MATCH (m:ProjectionMarker {entity_type: $entity_type, entity_id: $entity_id})
        DELETE m`, 5000, params);
    } else {
      if (event.entity_type === "workspace_github_records" || event.entity_type === "workspace_github_record_versions") {
        if (event.entity_type === "workspace_github_records" && text(payload.record_type) === "security_finding") {
          await query(`${marker}
            MATCH (n:SecurityFinding {id: $entity_id})
            OPTIONAL MATCH (n)-[:AFFECTS]->(d:Dependency)
            WITH m, n, collect(DISTINCT d) AS dependencies
            OPTIONAL MATCH (n)-[:IDENTIFIES]->(v:Vulnerability)
            WITH m, n, dependencies, collect(DISTINCT v) AS vulnerabilities
            DETACH DELETE n
            FOREACH (d IN dependencies | DETACH DELETE d)
            FOREACH (v IN vulnerabilities | DETACH DELETE v)`, 5000, params);
          return;
        }
        await query(`${marker}
          MATCH (n {id: $entity_id})
          DETACH DELETE n`, 5000, params);
        return;
      }
      const label = event.entity_type === "investigations" ? "Investigation"
        : event.entity_type === "investigation_events" ? "InvestigationEvent"
          : event.entity_type === "investigation_tasks" ? "Task"
            : event.entity_type === "investigation_facts" ? "Fact"
              : event.entity_type === "investigation_fact_versions" ? "FactVersion"
                : event.entity_type === "investigation_attempts" ? "Attempt" : null;
      if (!label) throw new Error("Unsupported projection entity");
      await query(`${marker}
        MATCH (n:${label} {id: $entity_id})
        DETACH DELETE n`, 5000, params);
    }
    return;
  }

  if (event.entity_type === "investigations") {
    await query(`${marker}
      MERGE (n:Investigation {id: $entity_id})
      SET n.workspace_id = $workspace_id, n.version = $version,
          n.acl_role = 'workspace', n.title = $title, n.status = $status,
          n.created_at = $created_at, n.updated_at = $updated_at
      RETURN n.id`, 5000, {
      ...params, title: text(payload.title), status: text(payload.status),
      created_at: text(payload.created_at), updated_at: text(payload.updated_at),
    });
    return;
  }

  if (event.entity_type === "workspace_github_records") {
    const recordType = text(payload.record_type);
    const repositorySourceId = `github:repo:${text(payload.repository_id)}`;
    const shared = {
      ...params,
      source_id: text(payload.record_id), source_version: text(payload.provider_version),
      source_url: text(payload.source_url), title: text(payload.title), body: text(payload.body),
      path: text(payload.path), author: text(payload.author), updated_at: text(payload.updated_at),
      captured_at: text(payload.captured_at), repository_source_id: repositorySourceId,
      repository_name: text(payload.repository_name), repository_url: text(payload.repository_url),
      default_branch: text(payload.default_branch),
    };
    if (recordType === "security_finding") {
      const details = typeof payload.details === "object" && payload.details !== null && !Array.isArray(payload.details)
        ? payload.details as Record<string, unknown> : {};
      const packageName = text(details.packageName);
      const ecosystem = text(details.ecosystem);
      const vulnerabilitySourceId = text(details.ghsaId) || text(details.cveId) || text(payload.record_id);
      const dependencyId = `${event.entity_id}:dependency`;
      const vulnerabilityId = `${event.entity_id}:vulnerability`;
      await query(`MERGE (r:Repository {source_id: $repository_source_id})
        ON CREATE SET r.id = $repository_source_id, r.workspace_id = $workspace_id, r.acl_role = 'workspace',
                      r.source_type = 'github', r.source_url = $repository_url, r.name = $repository_name,
                      r.default_branch = $default_branch
        WITH r
        MERGE (n:SecurityFinding {source_id: $source_id})
        SET n.id = $entity_id, n.workspace_id = $workspace_id, n.acl_role = 'admin',
            n.source_type = 'github_dependabot', n.source_version = $source_version, n.source_url = $source_url,
            n.title = $title, n.body = $body, n.path = $path, n.updated_at = $updated_at,
            n.captured_at = $captured_at, n.details = $details
        MERGE (r)-[e:HAS_SECURITY_FINDING {id: $source_id}]->(n)
        SET e.workspace_id = $workspace_id, e.acl_role = 'admin', e.source_version = $source_version
        WITH n
        MERGE (v:Vulnerability {id: $vulnerability_id})
        SET v.source_id = $vulnerability_source_id, v.workspace_id = $workspace_id, v.acl_role = 'admin',
            v.source_type = 'github_advisory', v.source_version = $source_version, v.source_url = $source_url,
            v.title = $advisory_title, v.severity = $severity, v.ghsa_id = $ghsa_id, v.cve_id = $cve_id,
            v.cvss_score = $cvss_score, v.cwes = $cwes
        MERGE (n)-[ident:IDENTIFIES {id: $source_id}]->(v)
        SET ident.workspace_id = $workspace_id, ident.acl_role = 'admin', ident.source_version = $source_version
        WITH n
        FOREACH (_ IN CASE WHEN $package_name = '' OR $ecosystem = '' THEN [] ELSE [1] END |
          MERGE (d:Dependency {id: $dependency_id})
          SET d.source_id = $dependency_source_id, d.workspace_id = $workspace_id, d.acl_role = 'admin',
              d.source_type = 'github_dependabot', d.source_version = $source_version,
              d.name = $package_name, d.ecosystem = $ecosystem, d.vulnerable_version_range = $version_range,
              d.first_patched_version = $patched_version
          MERGE (n)-[a:AFFECTS {id: $source_id}]->(d)
          SET a.workspace_id = $workspace_id, a.acl_role = 'admin', a.source_version = $source_version
        )
        RETURN n.source_id`, 5000, {
        ...shared,
        details: JSON.stringify(details), vulnerability_id: vulnerabilityId,
        vulnerability_source_id: vulnerabilitySourceId, advisory_title: text(details.ghsaId) || text(details.cveId) || text(payload.title),
        severity: text(details.severity), ghsa_id: text(details.ghsaId), cve_id: text(details.cveId),
        cvss_score: typeof details.cvssScore === "number" ? details.cvssScore : null,
        cwes: JSON.stringify(Array.isArray(details.cwes) ? details.cwes : []),
        package_name: packageName, ecosystem, dependency_id: dependencyId,
        dependency_source_id: `github:dependency:${text(payload.repository_id)}:${ecosystem}:${packageName}`,
        version_range: text(details.vulnerableVersionRange), patched_version: text(details.firstPatchedVersion),
      });
      const manifestPath = text(details.manifestPath);
      if (manifestPath) {
        await query(`MATCH (n:SecurityFinding {id: $entity_id})
          MATCH (f:File {source_id: $manifest_source_id})
          MERGE (n)-[r:IN_MANIFEST {id: $source_id}]->(f)
          SET r.workspace_id = $workspace_id, r.acl_role = 'admin', r.source_version = $source_version
          RETURN r.id`, 3000, {
          ...params, source_id: text(payload.record_id), source_version: text(payload.provider_version),
          manifest_source_id: `github:file:${text(payload.repository_id)}:${manifestPath}`,
        });
      }
      return;
    }
    if (recordType === "repository") {
      await query(`MERGE (r:Repository {source_id: $source_id})
        SET r.id = $entity_id, r.workspace_id = $workspace_id, r.acl_role = 'workspace', r.source_id = $source_id,
            r.source_type = 'github', r.source_version = $source_version, r.source_url = $source_url,
            r.name = $title, r.default_branch = $default_branch, r.captured_at = $captured_at
        RETURN r.source_id`, 5000, shared);
      return;
    }
    if (recordType === "check_run") {
      const details = typeof payload.details === "object" && payload.details !== null && !Array.isArray(payload.details)
        ? payload.details as Record<string, unknown> : {};
      await query(`MERGE (c:Commit {source_id: $head_commit_source_id})
        ON CREATE SET c.id = $head_commit_source_id, c.workspace_id = $workspace_id, c.acl_role = 'workspace', c.source_type = 'github'
        WITH c
        MERGE (n:CheckRun {id: $entity_id})
        SET n.source_id = $source_id, n.workspace_id = $workspace_id, n.acl_role = 'workspace',
            n.source_type = 'github', n.source_version = $source_version, n.source_url = $source_url,
            n.name = $title, n.status = $status, n.conclusion = $conclusion, n.summary = $summary,
            n.app_name = $author, n.updated_at = $updated_at, n.captured_at = $captured_at
        MERGE (c)-[r:HAS_CHECK_RUN {id: $source_id}]->(n)
        SET r.workspace_id = $workspace_id, r.acl_role = 'workspace', r.source_version = $source_version
        RETURN n.source_id`, 5000, {
        ...shared, head_commit_source_id: `github:commit:${text(payload.repository_id)}:${text(details.headSha)}`,
        status: text(details.status), conclusion: text(details.conclusion), summary: text(details.summary),
      });
      return;
    }
    const labels = { commit: "Commit", issue: "Issue", pull_request: "PullRequest", file: "File" } as const;
    const relations = { commit: "HAS_COMMIT", issue: "HAS_ISSUE", pull_request: "HAS_PULL_REQUEST", file: "CONTAINS" } as const;
    if (!Object.hasOwn(labels, recordType)) throw new Error("Unsupported GitHub record type");
    const label = labels[recordType as keyof typeof labels];
    const relation = relations[recordType as keyof typeof relations];
    await query(`MERGE (r:Repository {source_id: $repository_source_id})
      ON CREATE SET r.id = $repository_source_id, r.workspace_id = $workspace_id, r.acl_role = 'workspace',
                    r.source_type = 'github', r.source_url = $repository_url, r.name = $repository_name,
                    r.default_branch = $default_branch
      WITH r
      MERGE (n:${label} {source_id: $source_id})
      SET n.id = $entity_id, n.workspace_id = $workspace_id, n.acl_role = 'workspace',
          n.source_type = 'github', n.source_version = $source_version, n.source_url = $source_url,
          n.title = $title, n.body = $body, n.path = $path, n.author = $author,
          n.updated_at = $updated_at, n.captured_at = $captured_at
      MERGE (r)-[e:${relation} {id: $source_id}]->(n)
      SET e.workspace_id = $workspace_id, e.acl_role = 'workspace', e.source_version = $source_version
      RETURN n.source_id`, 5000, shared);
    if (recordType === "pull_request") {
      const details = typeof payload.details === "object" && payload.details !== null && !Array.isArray(payload.details)
        ? payload.details as Record<string, unknown> : {};
      const changedFiles = Array.isArray(details.changedFiles) ? details.changedFiles.flatMap((item) => {
        if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
        const file = item as Record<string, unknown>;
        if (typeof file.path !== "string" || !file.path || file.path.length > 400
          || typeof file.sha !== "string" || !/^[a-f0-9]{40}$/i.test(file.sha)) return [];
        return [{ source_id: `github:file:${text(payload.repository_id)}:${file.path}`, path: file.path,
          sha: file.sha, status: text(file.status).slice(0, 30), edge_id: `${text(payload.record_id)}:changed-file:${file.path}` }];
      }) : [];
      const changedFileParams: GraphParams = { ...params, source_id: text(payload.record_id),
        source_version: text(payload.provider_version),
        file_source_version: text(details.filesSourceVersion) || text(payload.provider_version) };
      const changedFileBindings = changedFiles.map((file, index) => {
        const prefix = `changed_file_${index}`;
        changedFileParams[`${prefix}_source_id`] = file.source_id;
        changedFileParams[`${prefix}_path`] = file.path;
        changedFileParams[`${prefix}_sha`] = file.sha;
        changedFileParams[`${prefix}_status`] = file.status;
        changedFileParams[`${prefix}_edge_id`] = file.edge_id;
        return `{source_id: $${prefix}_source_id, path: $${prefix}_path, sha: $${prefix}_sha, status: $${prefix}_status, edge_id: $${prefix}_edge_id}`;
      }).join(", ");
      await query(`MATCH (p:PullRequest {source_id: $source_id})
        OPTIONAL MATCH (p)-[old:CHANGED_FILE]->()
        WITH p, collect(old) AS previous_edges
        FOREACH (edge IN previous_edges | DELETE edge)
        WITH p
        UNWIND [${changedFileBindings}] AS file
        MERGE (f:File {source_id: file.source_id})
        ON CREATE SET f.id = file.source_id, f.workspace_id = $workspace_id, f.acl_role = 'workspace',
                      f.source_type = 'github', f.path = file.path
        WITH p, f, file
        MERGE (p)-[r:CHANGED_FILE {id: file.edge_id}]->(f)
        SET r.workspace_id = $workspace_id, r.acl_role = 'workspace', r.source_id = $source_id,
            r.source_version = $file_source_version, r.file_sha = file.sha, r.file_status = file.status
        RETURN count(r)`, 5000, changedFileParams);
    }
    return;
  }

  if (event.entity_type === "workspace_github_record_versions") {
    const recordType = text(payload.record_type);
    const labels = { repository: "Repository", commit: "Commit", issue: "Issue", pull_request: "PullRequest", file: "File", security_finding: "SecurityFinding", check_run: "CheckRun" } as const;
    if (!Object.hasOwn(labels, recordType)) throw new Error("Unsupported GitHub history record type");
    const previous = typeof payload.payload === "object" && payload.payload !== null
      ? payload.payload as Record<string, unknown> : {};
    const sourceId = text(payload.record_id);
    const revision = event.entity_version;
    const aclRole = recordType === "security_finding" ? "admin" : "workspace";
    await query(`MERGE (n:${labels[recordType as keyof typeof labels]} {id: $current_record_id})
      ON CREATE SET n.source_id = $source_id, n.workspace_id = $workspace_id, n.acl_role = $acl_role
      WITH n
      MERGE (v:SourceRevision {id: $entity_id})
      SET v.source_id = $revision_source_id, v.workspace_id = $workspace_id, v.acl_role = $acl_role,
          v.source_type = 'github', v.source_version = $source_version, v.source_url = $source_url,
          v.record_type = $record_type, v.revision_number = $revision_number,
          v.title = $title, v.body = $body, v.path = $path, v.author = $author,
          v.updated_at = $updated_at, v.details = $details, v.source_captured_at = $source_captured_at,
          v.archived_at = $archived_at
      MERGE (n)-[r:HAS_REVISION {id: $revision_source_id}]->(v)
      SET r.workspace_id = $workspace_id, r.acl_role = $acl_role, r.source_version = $source_version
      RETURN v.id`, 5000, {
      ...params, current_record_id: text(payload.current_record_id), source_id: sourceId,
      revision_source_id: `${sourceId}@${revision}`, source_version: text(payload.provider_version),
      record_type: recordType, revision_number: revision, acl_role: aclRole,
      source_url: text(previous.source_url), title: text(previous.title), body: text(previous.body),
      path: text(previous.path), author: text(previous.author), updated_at: text(previous.updated_at),
      details: JSON.stringify(previous.details ?? {}),
      source_captured_at: text(previous.captured_at), archived_at: text(payload.archived_at),
    });
    return;
  }

  if (event.entity_type === "investigation_events") {
    const investigationId = text(payload.investigation_id);
    if (!await parentAvailable(query, "Investigation", investigationId, "investigations")) return;
    await query(`${marker}
      MERGE (n:InvestigationEvent {id: $entity_id})
      SET n.workspace_id = $workspace_id, n.version = $version,
          n.acl_role = 'workspace',
          n.investigation_id = $investigation_id,
          n.event_type = $event_type, n.actor_id = $actor_id, n.payload = $payload,
          n.created_at = $created_at
      MERGE (i:Investigation {id: $investigation_id})
      MERGE (i)-[r:HAS_EVENT {id: $entity_id}]->(n)
      SET r.workspace_id = $workspace_id, r.acl_role = 'workspace'
      RETURN n.id`, 5000, {
      ...params, investigation_id: investigationId,
      event_type: text(payload.event_type), actor_id: text(payload.actor_id),
      payload: JSON.stringify(payload.payload ?? {}), created_at: text(payload.created_at),
    });
    return;
  }

  if (event.entity_type === "investigation_facts") {
    const investigationId = text(payload.investigation_id);
    if (!await parentAvailable(query, "Investigation", investigationId, "investigations")) return;
    await query(`${marker}
      MERGE (n:Fact {id: $entity_id})
      SET n.workspace_id = $workspace_id, n.version = $version,
          n.acl_role = 'workspace',
          n.investigation_id = $investigation_id, n.fact_key = $fact_key,
          n.value = $value, n.provenance = $provenance, n.updated_at = $updated_at
      MERGE (i:Investigation {id: $investigation_id})
      MERGE (i)-[r:HAS_FACT {id: $entity_id}]->(n)
      SET r.workspace_id = $workspace_id, r.acl_role = 'workspace'
      RETURN n.id`, 5000, {
      ...params, investigation_id: investigationId, fact_key: text(payload.fact_key),
      value: JSON.stringify(payload.value), provenance: JSON.stringify(payload.provenance ?? []),
      updated_at: text(payload.updated_at),
    });
    return;
  }

  if (event.entity_type === "investigation_fact_versions") {
    const factId = text(payload.fact_id);
    if (!await parentAvailable(query, "Fact", factId, "investigation_facts")) return;
    await query(`${marker}
      MATCH (f:Fact {id: $fact_id})
      MERGE (v:FactVersion {id: $entity_id})
      SET v.workspace_id = $workspace_id, v.version = $version,
          v.acl_role = 'workspace',
          v.investigation_id = $investigation_id, v.fact_key = $fact_key,
          v.value = $value, v.provenance = $provenance,
          v.changed_by = $changed_by, v.created_at = $created_at
      MERGE (f)-[r:HAS_VERSION {id: $entity_id}]->(v)
      SET r.workspace_id = $workspace_id, r.acl_role = 'workspace'
      RETURN v.id`, 5000, {
      ...params, fact_id: factId, investigation_id: text(payload.investigation_id),
      fact_key: text(payload.fact_key), value: JSON.stringify(payload.value),
      provenance: JSON.stringify(payload.provenance ?? []), changed_by: text(payload.changed_by),
      created_at: text(payload.created_at),
    });
    return;
  }

  if (event.entity_type === "investigation_attempts") {
    const investigationId = text(payload.investigation_id);
    if (!await parentAvailable(query, "Investigation", investigationId, "investigations")) return;
    const previousAttemptId = typeof payload.previous_attempt_id === "string" ? payload.previous_attempt_id : null;
    await query(`${marker}
      MERGE (n:Attempt {id: $entity_id})
      SET n.workspace_id = $workspace_id, n.version = $version,
          n.acl_role = 'workspace',
          n.investigation_id = $investigation_id, n.attempt_key = $attempt_key,
          n.attempt_number = $attempt_number, n.previous_attempt_id = $previous_attempt_id,
          n.condition_snapshot = $condition_snapshot, n.outcome = $outcome,
          n.summary = $summary, n.retry_explanation = $retry_explanation,
          n.changed_conditions = $changed_conditions, n.created_at = $created_at
      MERGE (i:Investigation {id: $investigation_id})
      MERGE (i)-[r:HAS_ATTEMPT {id: $entity_id}]->(n)
      SET r.workspace_id = $workspace_id, r.acl_role = 'workspace'
      RETURN n.id`, 5000, {
      ...params, investigation_id: investigationId, attempt_key: text(payload.attempt_key),
      attempt_number: typeof payload.attempt_number === "number" ? payload.attempt_number : 1,
      previous_attempt_id: previousAttemptId,
      condition_snapshot: JSON.stringify(payload.condition_snapshot ?? {}),
      outcome: text(payload.outcome), summary: text(payload.summary),
      retry_explanation: typeof payload.retry_explanation === "string" ? payload.retry_explanation : null,
      changed_conditions: JSON.stringify(payload.changed_conditions ?? []),
      created_at: text(payload.created_at),
    });
    if (previousAttemptId) {
      await query(`MATCH (p:Attempt {id: $previous_id}), (n:Attempt {id: $entity_id})
        MERGE (p)-[r:PREVIOUS_ATTEMPT {id: $entity_id}]->(n)
        SET r.workspace_id = $workspace_id, r.acl_role = 'workspace'`, 3000, {
        previous_id: previousAttemptId, entity_id: event.entity_id, workspace_id: event.workspace_id,
      });
    }
    return;
  }

  if (event.entity_type === "investigation_tasks") {
    const investigationId = text(payload.investigation_id);
    if (!await parentAvailable(query, "Investigation", investigationId, "investigations")) return;
    await query(`${marker}
      MERGE (n:Task {id: $entity_id})
      SET n.workspace_id = $workspace_id, n.version = $version,
          n.acl_role = 'workspace',
          n.investigation_id = $investigation_id, n.title = $title,
          n.details = $details, n.status = $status, n.owner_id = $owner_id,
          n.lease_expires_at = $lease_expires_at, n.created_at = $created_at, n.updated_at = $updated_at
      MERGE (i:Investigation {id: $investigation_id})
      MERGE (i)-[r:HAS_TASK {id: $entity_id}]->(n)
      SET r.workspace_id = $workspace_id, r.acl_role = 'workspace'
      RETURN n.id`, 5000, {
      ...params, investigation_id: investigationId,
      title: text(payload.title), details: JSON.stringify(payload.details ?? {}),
      status: text(payload.status), owner_id: typeof payload.owner_id === "string" ? payload.owner_id : null,
      lease_expires_at: typeof payload.lease_expires_at === "string" ? payload.lease_expires_at : null,
      created_at: text(payload.created_at),
      updated_at: text(payload.updated_at),
    });
    return;
  }

  if (event.entity_type === "investigation_task_handoffs") {
    const taskId = text(payload.task_id);
    if (!await parentAvailable(query, "Task", taskId, "investigation_tasks")) return;
    await query(`${marker}
      MATCH (t:Task {id: $task_id})
      MERGE (p:Person {id: $to_user_id})
      SET p.workspace_id = $workspace_id, p.acl_role = 'workspace'
      MERGE (t)-[r:HANDED_OFF_TO {id: $entity_id}]->(p)
      SET r.workspace_id = $workspace_id, r.version = $version,
          r.acl_role = 'workspace',
          r.from_user_id = $from_user_id, r.to_user_id = $to_user_id,
          r.status = $status, r.requested_at = $requested_at, r.acknowledged_at = $acknowledged_at
      RETURN r.id`, 5000, {
      ...params, task_id: taskId,
      to_user_id: text(payload.to_user_id), from_user_id: text(payload.from_user_id),
      status: text(payload.status), requested_at: text(payload.requested_at),
      acknowledged_at: typeof payload.acknowledged_at === "string" ? payload.acknowledged_at : null,
    });
    return;
  }

  throw new Error("Unsupported projection entity");
}

export function projectGraphEvent(event: GraphProjectionEvent) {
  const graphName = `wp_${event.workspace_id.replaceAll("-", "")}`;
  return withWorkspaceGraph(graphName, (query) => project(query, event));
}
