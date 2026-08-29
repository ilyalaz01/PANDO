import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createPandoServerComponentClient } from "../../shared/supabase/server";
import {
  AuthenticatedSessionRequiredError,
  verifyPandoSession,
} from "../../shared/supabase/session";
import { ExploreWorkspace } from "../../ui/explore/explore-workspace";
import styles from "../../ui/explore/explore.module.css";
import { loadCurrentDatabaseExploreSourceV1 } from "../../ui/explore/server/database-current-explore-source";
import { loadDatabaseExploreTargetContextV1 } from "../../ui/explore/server/database-explore-target-context";
import { loadDatabaseTargetReadinessV1 } from "../../ui/explore/server/database-target-readiness";
import { composeTargetReadinessView } from "../../ui/explore/server/compose-target-readiness-view";
import { materializeLiveExploreStructure } from "../../ui/explore/server/materialize-live-explore-structure";
import { toExploreStructuralProjectionView } from "../../ui/explore/server/structural-projection-view";
import type {
  ExploreStructuralProjectionView,
  ExploreTargetReadinessView,
} from "../../ui/explore/types";
import { SkipLink } from "../../ui/primitives/skip-link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Explore competency map · PANDO",
  description: "Authorized Map and Outline views of a selected PANDO target.",
};

type ExploreSearchParams = Promise<{
  goal?: string | string[];
  activity?: string | string[];
}>;

function oneValue(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function EmptySelectionState() {
  return (
    <section className={styles.intro} aria-labelledby="explore-title">
      <div>
        <p className={styles.eyebrow}>Choose a target</p>
        <h1 id="explore-title">Give the map a goal to grow around.</h1>
      </div>
      <div className={styles.introNote}>
        <p>Select a saved readiness goal before opening its live competency structure.</p>
        <Link href="/start">Choose a target</Link>
      </div>
    </section>
  );
}

function UnavailableState() {
  return (
    <section className={styles.intro} aria-labelledby="explore-title" role="alert">
      <div>
        <p className={styles.eyebrow}>Explore unavailable</p>
        <h1 id="explore-title">Your saved goal was not changed.</h1>
      </div>
      <div className={styles.introNote}>
        <p>
          PANDO could not correlate the authorized target structure. Reload or choose the target
          again; no representative fixture was substituted.
        </p>
        <Link href="/start">Return to target selection</Link>
      </div>
    </section>
  );
}

export default async function ExplorePage({ searchParams }: { searchParams: ExploreSearchParams }) {
  let client: Awaited<ReturnType<typeof createPandoServerComponentClient>> | undefined;
  try {
    const candidate = await createPandoServerComponentClient();
    const session = await verifyPandoSession(candidate);
    client = session.client;
  } catch (error) {
    if (error instanceof AuthenticatedSessionRequiredError) redirect("/sign-in");
    client = undefined;
  }

  const query = await searchParams;
  const readinessGoalKey = oneValue(query.goal);
  const selectedActivityKey = oneValue(query.activity) ?? null;
  const ambiguousSelector = Array.isArray(query.goal) || Array.isArray(query.activity);
  let projection: ExploreStructuralProjectionView | undefined;
  let targetReadiness: ExploreTargetReadinessView | null = null;
  let initialSelectedNodeId: string | undefined;
  if (client !== undefined && readinessGoalKey !== undefined && !ambiguousSelector) {
    try {
      const targetContext = await loadDatabaseExploreTargetContextV1(client, {
        readinessGoalKey,
      });
      const source = await loadCurrentDatabaseExploreSourceV1(client, {
        readinessGoalKey,
        selectedActivityKey,
      });
      const view = toExploreStructuralProjectionView(
        materializeLiveExploreStructure({ source, targetContext, selectedActivityKey }),
      );
      initialSelectedNodeId =
        selectedActivityKey === null
          ? undefined
          : view.nodes.find(
              ({ entityRef }) =>
                entityRef.entityType === "ACTIVITY" && entityRef.entityId === selectedActivityKey,
            )?.nodeId;
      if (selectedActivityKey !== null && initialSelectedNodeId === undefined) {
        throw new Error("Selected activity is absent from the correlated Explore view.");
      }
      projection = view;
      try {
        targetReadiness = composeTargetReadinessView(
          await loadDatabaseTargetReadinessV1(client, { readinessGoalKey }),
          view,
        );
      } catch {
        targetReadiness = null;
      }
    } catch {
      projection = undefined;
    }
  }

  return (
    <div className={styles.page}>
      <SkipLink targetId="explore-main">Skip to competency explorer</SkipLink>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.brand} href="/start">
            PANDO
          </Link>
          <nav className={styles.headerNav} aria-label="Workspace">
            <p>Live target structure</p>
            <Link href="/today">Today</Link>
            <Link href="/review">Review</Link>
          </nav>
        </div>
      </header>
      <main id="explore-main" tabIndex={-1} className={styles.main}>
        {client === undefined || ambiguousSelector ? (
          <UnavailableState />
        ) : readinessGoalKey === undefined ? (
          <EmptySelectionState />
        ) : projection === undefined ? (
          <UnavailableState />
        ) : (
          <>
            <section className={styles.intro} aria-labelledby="explore-title">
              <div>
                <p className={styles.eyebrow}>One organism · many competencies</p>
                <h1 id="explore-title">See the roots beneath your next move.</h1>
              </div>
              <p className={styles.introNote}>
                This is the live authorized structure for {readinessGoalKey}. Mastery and readiness
                remain hidden until their evidence-derived projections are materialized.
              </p>
            </section>
            <ExploreWorkspace
              key={initialSelectedNodeId ?? projection.projectionId}
              projection={projection}
              readinessGoalKey={readinessGoalKey}
              targetReadiness={targetReadiness}
              {...(initialSelectedNodeId === undefined ? {} : { initialSelectedNodeId })}
            />
          </>
        )}
      </main>
    </div>
  );
}
