function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function contextualCleanupError(stage, error, { projectId, workdir }) {
  return new Error(
    `isolated auth ${stage} failed for project ${projectId} at ${workdir}: ${describeError(error)}`,
    { cause: error },
  );
}

export function combineAuthGateErrors(primaryError, cleanupError) {
  if (primaryError && cleanupError) {
    return new AggregateError(
      [primaryError, cleanupError],
      "PANDO auth gate and cleanup both failed",
    );
  }
  return primaryError ?? cleanupError;
}

export function formatAuthGateError(error, depth = 0) {
  const prefix = "  ".repeat(depth);
  if (error instanceof AggregateError) {
    return [
      `${prefix}${error.message}`,
      ...error.errors.map((child) => formatAuthGateError(child, depth + 1)),
    ].join("\n");
  }
  return `${prefix}${describeError(error)}`;
}

export async function cleanupAuthGate({
  supabaseStartAttempted,
  closeRuntime,
  stopSupabase,
  removeScratch,
  projectId,
  workdir,
}) {
  const errors = [];
  try {
    await closeRuntime();
  } catch (error) {
    errors.push(contextualCleanupError("runtime cleanup", error, { projectId, workdir }));
  }

  let supabaseStopped = !supabaseStartAttempted;
  if (supabaseStartAttempted) {
    try {
      await stopSupabase();
      supabaseStopped = true;
    } catch (error) {
      errors.push(contextualCleanupError("Supabase cleanup", error, { projectId, workdir }));
    }
  }

  if (supabaseStopped) {
    try {
      await removeScratch();
    } catch (error) {
      errors.push(contextualCleanupError("scratch cleanup", error, { projectId, workdir }));
    }
  }

  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(
      errors,
      `isolated auth cleanup had ${errors.length} failures for project ${projectId} at ${workdir}`,
    );
  }
}
